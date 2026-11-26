---
title: "Unity 6 HDRP 多場景空間整合架構：技術分析與全方位解決方案"
date: 2026-05-12 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, hdrp, rendering, lighting, shadows, volumetrics, apv]
description: 深入解析在 Unity 6 中透過 Light Layers、方向光陰影、體積霧、天空盒、後製處理以及 Adaptive Probe Volumes 合併兩個 HDRP 場景空間的技術方案。
lang: zh-TW
translation_id: unity6-hdrp-multi-scene-light-layers
---

## **初始驗證：以 Light Layers 為基礎的光照隔離架構**

在使用 Unity 6 高畫質算繪管線（High Definition Render Pipeline，HDRP）開發複雜圖形專案的過程中，將兩個完全獨立的環境或場景空間（scenes）整合進同一個實體場景檔案，會帶來嚴峻的架構挑戰。選擇以 **Light Layers**（即 Rendering Layers，算繪層）作為核心機制來隔離各組 Directional Light 光源，並限制其對特定物件群組的影響範圍，是一項完全正確的技術決策，且嚴格符合引擎的核心設計文件規範。[^1]

目前方案所採用的組態設定流程，包含進入 Frame Settings 與 HDRP Asset 啟用 Light Layers，接著在 Directional Light 的 General 區塊自訂 Light Layer 參數，最後於 Mesh Renderer 的 Additional Settings 中同步 Rendering Layer Mask 參數。這套操作鏈成功建立了一條單向光學通訊通道，確保屬於第一個空間（場景 1）的多邊形網格（mesh）僅計算來自第一個空間太陽（Directional Light 1）的光照反射，第二個空間（場景 2）亦然。[^1]

從更深層的技術本質來看，Unity HDRP 算繪系統支援透過 LayerMasks 以位元為單位對緩衝區（G-buffer）進行分類。三維圖形環境中的算繪器（Renderer）理論上最多可支援 32 個不同的算繪層（rendering layers）。然而，為了最佳化運算效能與顯示記憶體（VRAM）頻寬，目前所有使用 Rendering Layers 機制的 HDRP 效果（包含直接光照、貼花 Decal 效果以及體積系統）僅支援對緩衝區中的前 16 層進行運算。[^1] 這代表指派 Layer 1 與 Layer 2 完全處於安全區間內，並能確保效能穩定性。在 ShaderGraph 中透過 `Sample Buffer` 節點結合 `RenderingLayerMask` 進行介入，也開啟了自訂專屬著色器的可能性，使其僅在對應層級的光源照射下才顯現特定效果。[^1]

不過，目前方案的侷限在於它僅解決了物理基礎算繪（Physically Based Rendering - PBR）技術的第一大支柱：**直接光照（Direct Lighting）**。在 Unity 6 HDRP 中，一套完整且逼真的環境生態系是由無數相互交織的複雜系統構成。當兩個空間被迫共用同一個世界座標系（world space）時，直接光照的獨立性會立刻被陰影洩漏（shadow leaking）、大氣體積串擾（volumetrics）、天空盒偏差（skybox）以及間接反射光照污染（Global Illumination）所瓦解。要完善此解決方案，必須對整套算繪管線系統進行大規模介入，以確保這兩個空間在視覺上真正做到彼此隱形。

## **方向光陰影（Directional Shadows）的複雜架構限制**

在分離光照通道之後，最大的技術障礙出現在陰影貼圖（Shadow Mapping）流程。在 HDRP 的預設組態下，系統會自動同步 Light Rendering Layers 與 Shadow Rendering Layers。這項機制預設任何從光源接收光子的幾何表面，同時也會扮演該光源的遮光體並投射陰影。[^1] 但 Unity 的算繪管線中存在一項寫死（hard-coded）的核心物理限制：無論是通用算繪管線（URP）還是高畫質算繪管線（HDRP），單一攝影機在任意時間點都僅支援**唯一一個**具備即時投射陰影能力（real-time shadow-casting）的 Directional Light 光源。[^4]

不同於影響範圍局部化的點光源（Point Light）或聚光燈（Spot Light），Directional Light 代表覆蓋全域的太陽光。為了在不耗盡電腦資源的情況下處理龐大區域的陰影，HDRP 採用了串聯陰影貼圖（Cascade Shadow Maps - CSM）技術。[^6] 系統不會產生單張超高解析度的陰影貼圖，而是將攝影機的視錐體空間劃分為多個層級（預設通常為 4 個 cascades，可在 Volume 的 `HD Shadow Settings` 中自訂）。[^6] 每個串聯層級都需要引擎執行一次獨立的幾何通道（geometry pass），並產製一張專屬的陰影貼圖。因此，單一 Directional Light 實際上需要持續算繪多達 4 張陰影貼圖。[^6]

如果 Unity 允許兩個 Directional Light 光源同時透過 CSM 技術產生陰影，每個影格必須運算的陰影貼圖數量將會暴增至 8 張高解析度貼圖，進而耗盡顯示記憶體頻寬，並使影格率（FPS）驟降至連頂級硬體系統都無法接受的程度。[^4] 當使用者的場景中同時存在兩個 Directional Light 時，Unity 會剝奪其中之一的陰影投射權限。第二道光源將只扮演提供色彩貢獻（color contribution）的角色，而無法在地面產生陰影遮蔽（drop shadows），致使第二個空間顯得扁平、缺乏層次且違背物理常理。[^4]

此外，若未妥善防範，來自空間 1 物件的陰影仍可能意外投射到空間 2 的物件上，即使兩者完全不接收對方的直接光照亦然。為了阻斷這種幾何洩漏，必須解決 Shadow Layers 的分離問題。預設情況下陰影會與光照保持同步，但為了取得完全控制權，架構師必須點選 Directional Light，導覽至 Shadows 區塊並勾選 **Custom Shadow Layers** 核取方塊。[^1] 這項功能可將 Shadow Rendering Layers 與 Light's Rendering Layers 解耦，確保空間 1 中的網格（Mesh）僅在 Shadow Layer 1 通道投射陰影，並對空間 2 的陰影射線追蹤流程完全隱形。[^1]

## **突破多環境陰影投射限制的應對策略**

為了跨越 Unity 6 單一太陽投射陰影的限制，必須分析兩個空間內物件的靜態與動態屬性，進而套用以下兩種技術介入策略之一。每種策略皆伴隨精密的組態操作，藉以繞過 CSM 的系統限制。

### **以 Box-Shaped Spot Light 模擬太陽光的策略**

如果兩個空間都要求高強度的動態陰影（dynamic shadows）互動，例如隨風搖曳的樹木、持續移動的角色以及輪替的晝夜循環，那麼使用兩個 Directional Light 是不可能達成的。取而代之的最佳解法，是將空間 2 的 Directional Light 替換為具備盒子空間形狀（Box shape）的 **Spot Light** 光源。[^8]

Spot Light 在資源管理方式上與 Directional Light 截然不同：它只算繪**唯一一張陰影貼圖**（一個 shadow map），而非四張串聯層級貼圖。[^6] 藉此，它擺脫了引擎嚴苛的限制。[^4] 在 Spot Light 的組態介面中，將 `Shape` 屬性切換為 `Box`，可讓系統建立一個定向照明體積，在局部有限區域內精準模擬太陽光的平行光線路徑。[^8]

然而，Spot Light 的物理特性在於光線會隨距離衰減（distance attenuation）。現實中的太陽在地球尺度範圍內並不存在此種衰減。要克服這點，只需進入 Spot Light 的進階設定，找到 **Range Attenuation** 屬性並加以調整或停用即可。[^8] 當光強衰減被消除後，這盞呈 Box 形狀的 Spot Light 將立即產生均勻、平行的照明效果，並可依需求投射出硬陰影或軟陰影，與傳統 Directional Light 毫無二致，同時透過 Light Layer 2 實現徹底隔離。[^8]

### **混合快取陰影（Mixed Cached Shadows）策略**

如果空間 1 或空間 2 主要由建築、地形、道路等靜態結構組成，僅有玩家角色等少數動態實體，那麼善用 **Mixed Cached Shadows**（混合快取陰影）功能將是一項突破性的架構決策。[^7] 自 HDRP 13.x 與 14.0 版本起（在 Unity 6 中已成為標準配備），這項功能已針對 Directional Light 開放，允許將陰影貼圖拆分為靜態與動態兩條獨立的資料流。[^7]

啟用此方案的流程需要專案管理系統與局部物件之間的同步配合。首要步驟是進行組態設定以允許 HDRP 配置記憶體。需在屬性檢視器（Inspector）視窗中開啟 HDRP Asset 組態檔案，沿著 *Lighting > Shadows > Directional Light Shadows* 路徑進入，並務必勾選 **Allow Mixed Cached Shadows** 選項。[^7] 接著，針對場景中的 Directional Light 進行操作：在 Light 分頁中展開 Shadows 區塊並勾選 **Always draw dynamic**，隨後將光源的 **Update Mode** 參數從 *Every Frame*（每個影格）變更為 *On Demand*（依需求）或 *OnEnable*。[^7] 最後，選取環境中的所有靜態物件，並在其 `Mesh Renderer` 元件上啟用 **Static Shadow Caster** 選項。[^7]

就內部運作機制而言，當系統運行於此模式時，HDRP 會為 Directional Light 的已快取（cached）與未快取（non-cached）陰影共用同一個 Shadow Atlas。[^10] 針對標記為靜態的物件，其陰影僅會被繪製進記憶體緩衝區一次；而針對動態物件，其陰影則會持續更新。[^7] 隨後，HDRP 執行一次 blit（Bit Block Transfer，位元區塊傳輸）運算，將快取貼圖中的資料合併至動態貼圖中，藉此省下極為可觀的幾何繪製呼叫（geometry draw calls）處理時間。[^7]

雖然這項方案無法直接讓兩個 Directional Light 隨時同時投射陰影，但它釋放了運算資源，讓系統得以依據攝影機位置在光源之間快速切換陰影算繪權限（shadow rendering authority），或是以一個 Directional Light 負責快取陰影，並搭配局部光源處理動態陰影。[^5] 需注意的是，由於 Directional Light 的串聯陰影貼圖（cascade shadow maps）具有視角相依性（view-dependent），攝影機穿越各串聯邊界時可能會在陰影邊緣引發視覺偏移。為避免此問題，必須撰寫一支 C# 腳本，每當攝影機移動特定距離時便呼叫 `RequestShadowMapRendering` 函式以重新整理快取貼圖。[^7] API 亦提供了 `SetShadowResolution()` 與 `SetShadowUpdateMode()` 等函式，方便於執行階段即時掌控此緩衝區。[^7]

| 多場景陰影方案比較 | 權限切換式 Directional Light                           | Box-Shaped Spot Light                                    | Mixed Cached Shadows                                          |
| :----------------- | :----------------------------------------------------- | :------------------------------------------------------- | :------------------------------------------------------------ |
| **運作機制**       | 透過腳本關閉光源 1 陰影，開啟光源 2 陰影。[^5]         | 使用有界體積光源模擬平行太陽光。[^8]                     | 快取靜態陰影緩衝區，持續更新動態陰影。[^7]                    |
| **VRAM 資源消耗**  | 低（僅啟用 1 組串聯系統）。[^6]                        | 中（額外增加 1 張非串聯陰影貼圖）。[^6]                  | 極高（需平行儲存靜態與動態貼圖）。[^7]                        |
| **Light Layers 支援** | 支援（完整支援）。[^1]                              | 支援（完整支援）。[^1]                                   | 支援（完整支援）。[^1]                                        |
| **適用範圍**       | 適合兩個空間不會同時出現在螢幕上的情境。               | 極適合交錯區域，需要兩個太陽同時投射陰影的情況。[^4]     | 最適合廣闊但以靜態物件為主的場景。[^7]                        |
| **技術限制**       | 突然切換可能會造成視覺上的中斷突兀感。                 | 需謹慎調整 Range Attenuation 與 Box 體積尺寸。[^8]       | 當攝影機移動時需要撰寫 C# 程式（`RequestShadowMapRendering`）。[^7] |

## **大氣體積（Volumetrics）管理與天空盒隔離**

直接光照與陰影僅佔物理算繪管線藍圖的一半，另一半則屬於天空、大氣層以及螢幕特效。在原始問題的敘述中，使用者曾提及使用「獨立 Volume」。HDRP 的 Volume 架構是一個依據攝影機相對於邊界框（bounding boxes）的空間位置來內插（interpolation）屬性數值的平台，而非透過每個 Mesh 上的獨立 LayerMask 進行分類。[^11] 這種設計哲學上的差異代表大氣系統並不在乎該物件屬於場景 1 還是場景 2，它只在乎攝影機目前位於何處。

要在合併兩個場景的同時維持各自的環境識別度，先決條件是將整體設計思維從 Global Volume（全域體積）徹底轉換為 **Local Volume**（局部體積）。Global Volume 無論攝影機位於 3D 世界的何處都會對其產生影響，這將產生一層均一的覆蓋效果，進而破壞兩個空間的隔離性。[^11]

環境隔離流程需要下列操作：移除或降低預設 Global Volume 的 **Priority**（優先順序）。[^12] 建立兩個分別對應兩個空間的空白 GameObject，各自新增 `Volume` 元件並將 **Mode** 設定為 **Local**。[^11] 必須額外掛載一個啟用 **Is Trigger** 屬性的 `Box Collider`（或 `Mesh Collider`）元件，以定義該大氣空間存在的實體邊界。[^11] 空間 1 與空間 2 之間的轉換是透過 **Blend Distance**（混合距離）參數加以控制。Blend Distance 數值規定了從 Box Collider 邊緣向內退縮的距離，圖形參數將在此區間內開始進行內插。若將 Blend Distance 設為 `0`，當玩家跨越界線時空間將會立刻被「硬切」；若調高此數值，環境效果（如霧氣、光線色彩）則會平順地交融在一起。[^13]

### **以 Visual Environment 覆寫天空盒**

在 Unity 6 HDRP 中，天空不再透過 Built-in RP 舊有的 Environment Lighting 視窗來定義，而是完全由名為 **Visual Environment** 的專用 Volume Override 所主導。[^15] 分離天空需要為空間 1 與空間 2 的 Local Volume 個別指派 Visual Environment。

透過啟用 **Sky Type** 參數，系統允許選擇截然不同的天空類型，例如為空間 1 指定 `Physically Based Sky`（如晴朗的正午），為空間 2 指定 `HDRI Sky`（如朦朧的月夜）。[^15] 由於 Volume 架構是基於攝影機運作，當攝影機進入空間 1 的 Box Collider 時，引擎無需任何一行程式碼即可自動運算並呈現對應的天空畫面。它同時也掌管了 `Cloud Layer`（雲層）與 `Ambient Indirect Lighting`（環境間接光照）參數，確保天空不僅供觀賞，還能準確參與全域反射色調的貢獻，藉此徹底消除空間 1 意外反射出空間 2 天空的現象。[^16]

### **以 Local Volumetric Fog 實現大氣獨立化**

HDRP 中的霧氣分為兩種類型。傳統的 Exponential Fog 僅根據 Z-buffer 深度覆蓋一層單一色彩。然而，為了滿足次世代的圖形品質，**Volumetric Fog**（體積霧）會直接與光束互動，營造出逼真的上帝光（God-rays）效果。[^18] 若透過一般 Volume 使用 Volumetric Fog，仍存在擴散至相鄰空間邊界的風險。徹底的解法是使用專用元件：**Local Volumetric Fog**。[^18]

`Local Volumetric Fog` 是一個可如同定向方盒般塑形邊界的實體霧氣體積。[^18] 為了正常運作，系統要求在 Project Settings（*Quality > HDRP > Lighting > Volumetrics*）、HDRP Asset 以及攝影機的 Frame Settings 中啟用相關旗標（flags）。[^18] 此元件透過 `Density Mask 3D Texture` 提供對密度的絕對掌控權，讓霧氣得以自然翻騰流動，而非呈現均勻濃稠的塊狀。[^18] 光散射顏色（`Single Scattering Albedo`）則決定了 Directional Light 穿透時霧氣所呈現的色調。[^19]

確保場景 1 的霧氣空間不與場景 2 混合的關鍵在於 **Blending Mode** 參數。[^19] 系統預設使用 **Additive**（疊加）模式，會導致霧氣彼此疊加累積。將 Blending Mode 切換為 **Overwrite**（覆寫）後，這塊體積霧將會毫不留情地取代並清除位於其範圍內的背景場景所有霧氣參數。[^19] 當兩個 `Local Volumetric Fog` 體積在兩場景交界處重疊時，**Priority** 參數將決定哪一層顯示在最上方，其依循的原則是：HDRP 會先算繪優先順序較低的體積，最後再算繪優先順序較高的體積。[^19]

### **對 Volume Layer Mask 與後製處理的常見誤解**

Unity 開發人員在嘗試為不同物件分離 Bloom、Depth of Field 或 Color Grading 等後製處理（Post-processing）效果時，普遍存在一個認知盲點。許多人會試圖調整攝影機上的 **Volume Layer Mask** 屬性，期待它能像 Light Layers 一樣運作。[^20] 事實上，`Volume Layer Mask` 完全無法控制*哪些物件*套用後製效果；它僅控制*哪台攝影機*會受到*哪個 Volume* 的影響。[^20]

原因在於 Post-processing 本質上是一個**螢幕空間（Screen Space）**的算繪流程。當畫面抵達 Post-processing 階段時，所有三維物件都已經被「壓平」成為包含色彩（RGB）與深度（Depth）資料的 2D 像素陣列。系統此時已不再知曉哪個像素來自場景 1、哪個來自場景 2。[^22] 因此，企圖使用 Volume Mask 讓 Bloom 僅套用於場景 1 是不可能達成的。[^22]

如果分離兩個環境的需求嚴格到必須讓後製效果或算繪演算法在畫面重疊的情況下仍保持完全獨立（例如：場景 1 中的手持武器疊加算繪於場景 2 的背景之上），傳統的做法是 Camera Stacking（攝影機堆疊）。但在 HDRP 中，Camera Stacking 極度耗費資源且會引發無數同步錯誤。[^22] Unity 官方唯一支援且標準的架構方案是 **Custom Pass Volume**。[^25]

Custom Pass 允許將自訂算繪指令注入（inject）圖形管線的特定階段（例如：*Before Transparent*、*After Post-Process*）。透過將 Custom Pass Volume 設定為在 Local 或 Camera 模式下運作[^27]，並鎖定特定的 `LayerMask`，系統可以單獨算繪空間 2 的整組物件，套用一套獨立的後製著色器，接著在不破壞空間深度遮蔽（depth occlusion）資訊或損毀緩衝區的前提下，將其合成（composite）於空間 1 之上。[^25] 著色器中的 `_FadeValue` 變數與 C# API 中的 `CustomPass.fadeValue`，能讓架構師在 `0` 到 `1` 的刻度範圍內平順地淡入淡出並切換這些顯示層，打造出無懈可擊的視覺分離效果。[^27]

## **透過 Adaptive Probe Volumes (APV) 控制間接反射光照**

直接光照能帶來鮮明的光影張力，但真正將萬物錨定於現實感的卻是間接光照（Global Illumination - GI）。照射在空間 2 綠色草地表面的光線會吸收光譜，並將綠色光線反彈至鄰近的牆面上。在合併兩個空間的情境下，它們在場景檔案中的實體距離可能非常靠近。若缺乏隔離手段，來自空間 1 的熾烈紅光將會劇烈洩漏（`light bleeding`）到空間 2 中，徹底破壞美術指導（Art Direction）。

自 Unity 6 起，間接光照基礎架構隨著 **Adaptive Probe Volumes (APV)** 的問世經歷了一場革命。[^28] 這項技術宣告了繁瑣的手動擺放 Light Probe Groups 時代正式終結。APV 會以稱為「磚塊」（bricks）的結構自動佈設一組光照資料收集點（Light Probes）網格。[^28] 每塊磚內部包含一個 4×4×4 的矩陣（總計 64 個 probes）。[^28] APV 的智慧演算法會分析幾何密度：在複雜且狹窄的區域，它會細分磚塊以提升光照解析度；在空曠的空間中，則使用較大且稀疏的磚塊以節省記憶體。[^28] 更進一步地，APV 能與體積霧（Volumetric Fog）及粒子系統（VFX Graph）完美互動，確保圖形環境的連貫一致性。[^28]

### **APV 中的 Rendering Layers 支援與限制**

為了確保間接光照系統同樣遵守兩個空間的邊界，第一步所設定的 Light Layers 功能必須與 APV 系統同步。APV 完全理解並支援 **Rendering Layer Masks**，但在最佳化層面受限於嚴格的約束條件：為了保護記憶體空間與讀取速度，APV 在烘焙儲存的資料區塊中，同一時間最多僅允許 **4 個 Rendering Layers Masks** 運作。[^29]

Unity 的全域「光照烘焙」（baking）流程極為精密。系統會從每個 probe 發射數百萬條射線（ray tests）以探測周圍空間並執行遮蔽分析（occlusion analysis）。[^30] 在光線反彈的過程中，它們會不斷撞擊已預先指派 rendering layers 標籤的幾何表面（例如空間 1 的 Layer 1 與空間 2 的 Layer 2）。由於單一 probe 僅能攜帶已定義的 4 個遮罩中的唯一一個，Unity 會採用多數決演算法來指派該遮罩：如果某個 probe 的大多數射線擊中了 Layer 1，該 probe 就會被鎖定至 Layer 1。[^30]

然而，這項自動化機制在邊界地帶卻會釀成災難。懸浮於空間 1 與空間 2 之間的光照採集點會混雜雙方的資料，造成交叉光害或難以預期的斑駁明暗方塊偽影（`probe flares/square artifacts`）。[^31]

### **以 Probe Adjustment Volume (PAV) 隔離光照**

為了壓制演算法的自主判斷並強制系統服從創作者的意圖，架構師必須部署稱為 **Probe Adjustment Volume (PAV)** 的導向工具。[^29]

PAV 是一種局部邏輯控制體積，具備在 APV 資料傳遞至物件之前於最底層將其修改的權限。此體積中最關鍵的功能是 **Override Rendering Layer Mask**（覆寫算繪層遮罩）。[^30] 分離兩個環境的實作步驟如下：

1. 建立一個 Box 形狀的 `Probe Adjustment Volume`，嚴謹地包覆空間 1 的全部網格結構。
2. 在 PAV 的屬性檢視器（Inspector）面板內，啟用 **Override Rendering Layer Mask** 功能。[^32]
3. 徹底移除所有不屬於空間 1 的層（包含空間 2 的 Layer 2），僅保留 **Layer 1**。[^29]

當此流程完成後，隔離機制隨即建立。在執行階段（runtime），當角色或動態物件於空間 1 的範圍內移動時，其算繪器（renderer）會查詢 APV 網格。受惠於 PAV 的覆寫組態，該物件將僅被允許從帶有 Layer 1 標籤的 probe 中擷取並取樣（sample）光照資料。[^29] 所有從空間 2 意外反彈過來的光光子資料，都會在緩衝區層級遭到拒絕存取。兩個空間之間的間接光照隔離至此已達到絕對隔離。

不僅如此，若合併兩個場景是為了服務瞬間移動（teleportation）或時間變換（例如同一區域在空間 1 為白天、在空間 2 為夜晚），Unity 6 亦提供了搭配 APV 使用的 **Lighting Scenarios**（光照情境）功能。[^28] 透過在 HDRP Asset 中開啟此選項，每個空間的烘焙資料都能儲存在不同的情境資源中。在執行階段，`ProbeReferenceVolume` API 可在數毫秒內啟用並切換情境。甚至啟用 *Scenario Blending* 功能後，還能讓 `BlendLightingScenario` 等 C# 函式逐影格（frame）將空間 1 的 GI 資料平順內插過渡至空間 2，在不造成 CPU 瓶頸的情況下，帶來最夢幻且專業的轉場效果。[^33]

## **記憶體最佳化與底層資源治理**

當強迫 Unity 這類引擎同時為兩個複雜環境算繪多套光照、陰影與大氣層系統時，GPU 的顯示記憶體（VRAM）將承受極端沉重的負擔。一位系統架構師的精湛之處，不僅在於讓所有系統正常運作，更在於確保維持最低的影格延遲時間（frametimes），並徹底根除光學繞射瑕疵（artifacts）。

### **透過 Dynamic Rescale 釋放 Atlas 空間**

陰影緩衝區內的空間爭奪，是圖形完整性最大的威脅。如前所述，HDRP 是透過在 HDRP Asset 中宣告的靜態 Atlas 系統（預設尺寸通常為 4096 × 4096 像素）來配置陰影空間。[^6] 如果來自 Spot Light（用於模擬空間 2 的太陽）與 Point Lights 的陰影數量超過了此面積預算，實體的陰影就會碎裂或消失。[^34]

預防性的解決方案是在 HDRP Asset 中，同時為 *Punctual Light Shadows* 與 *Area Light Shadows* 啟用 **Dynamic Rescale**（動態重新縮放）功能。[^7] 當此功能運作時，HDRP 會分析光束佔據螢幕面積的比例。距離較遠或被部分遮擋的光源，其陰影解析度會被依指數級強制縮小，從而在 Atlas 中為靠近攝影機的關鍵陰影區域讓出空間。[^7] 然而，必須特別留意 Dynamic Rescale 演算法對於 Mixed Cached Shadows 中已靜態快取的陰影貼圖（cached shadow maps）是停用的，因為靜態資料無法在不破壞物理關聯的情況下進行動態伸縮。[^7]

### **嚴格控管 Max Shadows on Screen 與 Shadow Bias**

HDRP Asset 的 Shadows 區塊中的 **Max Shadows on Screen** 參數，為硬體在單一影格中獲准運算的陰影數量設下了絕對的硬性上限。[^6] 如果攝影機處於一個能同時涵蓋兩個空間部分區域的角度，此上限將會非常迅速地被突破，導致引擎隨機捨棄陰影。結合使用遮蔽剔除（occlusion culling）以及位於兩空間邊界之間的實體遮擋幾何體，藉此將載入記憶體緩衝區的物件數量降至最低，是不可或缺的強制措施。[^22]

在進行光源模擬與分通道處理時，由於非線性投射角度的影響，光線穿透網格洩漏（light leaking）以及陰影粉刺（shadow acne）現象將會更頻繁地出現。管理每個 Light 元件上的 **Shadow Bias** 系統是維持畫面品質的關鍵。[^34] 微調 *Near Plane* 參數以推後陰影投射的起點；調高 *Normal Bias* 以沿表面法線方向偏移陰影取樣表面，防止錯誤的自我陰影；並針對傾斜表面校正 *Slope-Scale Depth Bias*。[^34] 這些細微調整搭配高品質的陰影過濾（Shadow filtering）技術，如 PCF（Percentage-Closer Filtering）或 PCSS（Percentage-Closer Soft Shadows），將能確保陰影邊緣柔和，並掩蓋因使用雙光源所引發的一切缺陷。[^34]

### **分層光源數量的硬體限制**

HDRP 與 URP 提供了兩種核心算繪機制：Forward+ 與 Deferred。在組態多層光照（Light Layers）的過程中，必須清楚掌握所採用架構的限制。

* 若專案運行於 **Forward+** 架構，系統在桌面端裝置上支援每個攝影機高達 256 個光源的龐大數量。[^38] 然而，它被硬性鎖定在同一時間作用於單一物件的**最多 8 個額外光源**上限。[^38] 使用者透過 Light Layer 1 與 Light Layer 2 進行的分通道設計，出色地排除了無關燈光，防止網格觸及這 8 盞燈的上限門檻。
* 若專案運行於 **Deferred** 架構以最佳化無上限的燈光數量，則需留意一項嚴重限制：Deferred 機制中的剔除遮罩（culling mask）同一時間最多僅支援區分 **4 個層（layer）**。[^40] 若專案為了進一步細分空間而濫用過多複雜的 Light Layers（超過 4 個），系統將會陷入無法復原的圖形崩壞（graphical artifacts）狀態。[^40] 初始方案僅採用 2 個基礎層（Layer 1 與 Layer 2）的做法，已充分驗證其在記憶體層面的高效能與絕對安全性。[^1]

## **總解決方案矩陣與系統摘要**

從針對 Unity 6 HDRP 各核心子系統的拆解分析可知，使用者原本的方案已獲驗證為關鍵的起步；但若要建立一個將 2 個場景合併至 1 個檔案中的完整算繪環境，仍須仰賴多層級策略系統的協同運作。下表為所有深度技術手法的總覽對照矩陣：

| HDRP 子系統                               | 初始做法（使用者現有）                                                          | 完善系統所需的核心補充技術方案                                                                                                                                                                                                   |
| :---------------------------------------- | :------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **直接光照（Direct Lighting）**           | 在 Directional Light 與 Mesh Renderer 上組態 Light Layer 1（場景 1）與 Layer 2（場景 2）。 | **已驗證精準無誤**。確保將活躍層數維持在最低限度，以免與 Deferred 架構發生衝突。[^1]                                                                                                                                             |
| **方向光陰影（Directional Shadows）**     | *尚未處理*。面臨觸及引擎每影格 1 組方向光陰影上限的風險。[^4]                   | 透過 **Custom Shadow Layers** 解耦陰影。[^1] 若兩個空間都需要陰影，將光源 2 替換為 **Box-shaped Spot Light**（停用 Range Attenuation）[^8]，或針對靜態網格使用 **Mixed Cached Shadows** 技術（於 HDRP Asset 中啟用）。[^7]      |
| **天空盒（Skybox & Visual Environment）** | *尚未處理*。共用天空將會破壞兩個空間之間的隔離性。                              | 部署 2 個 **Local Volumes**（搭配 Box Colliders）。使用 **Visual Environment** 覆寫以指派 2 種不同的 Sky Type。調整 Blend Distance 以實現平順內插。[^11]                                                                           |
| **大氣霧氣（Volumetric Fog）**            | *尚未處理*。Global Volumetric Fog 將會跨區溢流。                                | 替換為 **Local Volumetric Fog** 元件。將 Blending Mode 參數從 Additive 切換為 **Overwrite**，使局部霧氣清除背景大氣。[^18] 在交疊區域微調 Priority。                                                                              |
| **後製處理分離（Post-Processing）**       | *尚未處理*。（對獨立物件使用 Volume Layer Mask 的常見誤解）。[^22]              | 設定 **Custom Pass Volume**。使用著色器 C# API 與 layer masks 獨立算繪後製處理後再行合成（composite），揚棄低效的 Camera Stacking 方法。[^22]                                                                                     |
| **間接光照（Global Illumination / APV）** | *尚未處理*。反彈光（Bounced light）將穿透 2 個環境的邊界產生洩漏。              | 使用 **Adaptive Probe Volumes (APV)** 進行同步。部署包覆空間 1 區域的 **Probe Adjustment Volume (PAV)**，運用 **Override Rendering Layer Mask** 功能拒絕來自帶有 Layer 2 標籤的 Probe 的光照資料內插。[^28]                 |

Unity 6 HDRP 的物理模擬圖形生態系是一台精密且嚴苛的機器，對光照所做的任何微調都會牽動反射、遮蔽以及空間折射等物理連鎖反應。利用 Light Layers 來隔離光照通道是一個展現深厚引擎理解度的完美起點，但要將這套理論化為完整無缺的藝術空間，必須仰賴一整張微調組態網路的支撐。透過徹底落實 Custom Shadow Layers 與 Mixed Cached Shadows 的整合、善用 Local Volume Framework 的空間控制威力，並建立依托於 Probe Adjustment Volume 的間接光照分流紀律，圖形架構師完全能夠驅使這台龐大的算繪引擎，在單一空間場域內平行運作兩個多維現實，且不在視覺品質上做出任何妥協。當設計者掌握了緩衝區（buffers）的核心結構以及 GPU 處理器上的光子流動規律時，所有幾何洩漏與光譜污染的邊界都將得以徹底封鎖。

## **參考文獻**

[^1]: Use light rendering layers | High Definition RP | 16.0.6 - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Rendering-Layers.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Rendering-Layers.html)  
[^2]: Light Layers | High Definition RP | 14.0.12 - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Light-Layers.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Light-Layers.html)  
[^3]: Rendering Layers | High Definition RP | 15.0.7 - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Rendering-Layers.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Rendering-Layers.html)  
[^4]: Is it possible to achieve shadows from two directional lights in URP? : r/Unity3D - Reddit, 存取於 2026年5月11日, [https://www.reddit.com/r/Unity3D/comments/1bndl5x/is_it_possible_to_achieve_shadows_from_two/](https://www.reddit.com/r/Unity3D/comments/1bndl5x/is_it_possible_to_achieve_shadows_from_two/)  
[^5]: 2 or more directional lights simultaneously - Unity Discussions, 存取於 2026年5月11日, [https://discussions.unity.com/t/2-or-more-directional-lights-simultaneously/878090](https://discussions.unity.com/t/2-or-more-directional-lights-simultaneously/878090)  
[^6]: Shadows in the High Definition Render Pipeline - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@8.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@8.0/manual/Shadows-in-HDRP.html)  
[^7]: Shadows in the High Definition Render Pipeline | High Definition RP ..., 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Shadows-in-HDRP.html)  
[^8]: Multiple directional light shadow maps - Unity Discussions, 存取於 2026年5月11日, [https://discussions.unity.com/t/multiple-directional-light-shadow-maps/821372](https://discussions.unity.com/t/multiple-directional-light-shadow-maps/821372)  
[^9]: Mixed cached shadows for directional light broken when shadow cascade count is greater than 1 - Unity Discussions, 存取於 2026年5月11日, [https://discussions.unity.com/t/mixed-cached-shadows-for-directional-light-broken-when-shadow-cascade-count-is-greater-than-1/919216](https://discussions.unity.com/t/mixed-cached-shadows-for-directional-light-broken-when-shadow-cascade-count-is-greater-than-1/919216)  
[^10]: Shadows in the High Definition Render Pipeline - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.0/manual/Shadows-in-HDRP.html)  
[^11]: Volumes | High Definition RP | 10.2.2 - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.2/manual/Volumes.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.2/manual/Volumes.html)  
[^12]: HDRP Global Settings Window | High Definition RP | 15.0.7 - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Default-Settings-Window.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Default-Settings-Window.html)  
[^13]: Local Volumetric Fog | High Definition RP | 14.1.0, 存取於 2026年5月11日, [https://docs.unity.cn/cn/Packages-cn/com.unity.render-pipelines.high-definition@14.1/manual/Local-Volumetric-Fog.html](https://docs.unity.cn/cn/Packages-cn/com.unity.render-pipelines.high-definition@14.1/manual/Local-Volumetric-Fog.html)  
[^14]: Different Types of Post-Processing Volumes in Unity HDRP | by Liberty Depriest - Medium, 存取於 2026年5月11日, [https://medium.com/@youngchae.depriest/different-types-of-post-processing-volumes-in-unity-hdrp-4f36e3e6dbc5](https://medium.com/@youngchae.depriest/different-types-of-post-processing-volumes-in-unity-hdrp-4f36e3e6dbc5)  
[^15]: Visual Environment | High Definition RP | 16.0.6 - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Override-Visual-Environment.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Override-Visual-Environment.html)  
[^16]: Create environment lighting | High Definition RP | 16.0.6 - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Environment-Lighting.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Environment-Lighting.html)  
[^17]: Setting The Skybox In Unity HDRP - Vincent Taylor, 存取於 2026年5月11日, [https://vintay.medium.com/setting-the-skybox-in-unity-hdrp-ffc8f7e068ec](https://vintay.medium.com/setting-the-skybox-in-unity-hdrp-ffc8f7e068ec)  
[^18]: Local Volumetric Fog | High Definition RP | 14.0.12 - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Local-Volumetric-Fog.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Local-Volumetric-Fog.html)  
[^19]: Local Volumetric Fog Volume reference | High Definition Render Pipeline | 17.0.4, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/local-volumetric-fog-volume-reference.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/local-volumetric-fog-volume-reference.html)  
[^20]: Field volumeLayerMask | High Definition RP | 15.0.7 - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition%4015.0/api/UnityEngine.Rendering.HighDefinition.HDAdditionalCameraData.volumeLayerMask.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition%4015.0/api/UnityEngine.Rendering.HighDefinition.HDAdditionalCameraData.volumeLayerMask.html)  
[^21]: HDRP Camera | High Definition RP | 14.0.12 - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/HDRP-Camera.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/HDRP-Camera.html)  
[^22]: Unity/URP global volume with volume mask still applies effects to all layers, 存取於 2026年5月11日, [https://gamedev.stackexchange.com/questions/210918/unity-urp-global-volume-with-volume-mask-still-applies-effects-to-all-layers](https://gamedev.stackexchange.com/questions/210918/unity-urp-global-volume-with-volume-mask-still-applies-effects-to-all-layers)  
[^23]: Apply different post processing effects to separate cameras in URP - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/cameras/apply-different-post-proc-to-cameras.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/cameras/apply-different-post-proc-to-cameras.html)  
[^24]: HDRP - Volume Layer Mask - Unity Discussions, 存取於 2026年5月11日, [https://discussions.unity.com/t/hdrp-volume-layer-mask/754924](https://discussions.unity.com/t/hdrp-volume-layer-mask/754924)  
[^25]: [HDRP] Easiest way to force an object to render over everything else? : r/Unity3D - Reddit, 存取於 2026年5月11日, [https://www.reddit.com/r/Unity3D/comments/178uzdg/hdrp_easiest_way_to_force_an_object_to_render/](https://www.reddit.com/r/Unity3D/comments/178uzdg/hdrp_easiest_way_to_force_an_object_to_render/)  
[^26]: Struggling to render hands in separate layer (HDRP) any clean setup that actually works? : r/Unity3D - Reddit, 存取於 2026年5月11日, [https://www.reddit.com/r/Unity3D/comments/1lhpqhv/struggling_to_render_hands_in_separate_layer_hdrp/](https://www.reddit.com/r/Unity3D/comments/1lhpqhv/struggling_to_render_hands_in_separate_layer_hdrp/)  
[^27]: Understand custom pass volumes | High Definition Render Pipeline | 17.0.4, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Custom-Pass-Volume-Workflow.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Custom-Pass-Volume-Workflow.html)  
[^28]: Unity 6's New Global Illumination Lighting Features, 存取於 2026年5月11日, [https://unity.com/blog/engine-platform/new-ways-of-applying-global-illumination-in-unity-6](https://unity.com/blog/engine-platform/new-ways-of-applying-global-illumination-in-unity-6)  
[^29]: Fix issues with Adaptive Probe Volumes | High Definition Render Pipeline | 17.0.4, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/probevolumes-fixissues.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/probevolumes-fixissues.html)  
[^30]: Override rendering layer masks in a volume - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/features/rendering-layer-masks-apv-override-probe-in-a-volume.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/features/rendering-layer-masks-apv-override-probe-in-a-volume.html)  
[^31]: How to use Adaptive Probe Volume Rendering Layer Mask - Unity Discussions, 存取於 2026年5月11日, [https://discussions.unity.com/t/how-to-use-adaptive-probe-volume-rendering-layer-mask/1650216](https://discussions.unity.com/t/how-to-use-adaptive-probe-volume-rendering-layer-mask/1650216)  
[^32]: Override Rendering Layer Mask in Probe Adjustment Volume - Unity Discussions, 存取於 2026年5月11日, [https://discussions.unity.com/t/override-rendering-layer-mask-in-probe-adjustment-volume/1645954](https://discussions.unity.com/t/override-rendering-layer-mask-in-probe-adjustment-volume/1645954)  
[^33]: Bake different lighting setups with Lighting Scenarios | High Definition RP - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/probevolumes-bakedifferentlightingsetups.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/probevolumes-bakedifferentlightingsetups.html)  
[^34]: Shadows in the High Definition Render Pipeline | High Definition RP | 12.0.0 - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@12.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@12.0/manual/Shadows-in-HDRP.html)  
[^35]: Control shadow resolution and quality | High Definition Render Pipeline - Unity - Manual, 存取於 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Shadows-in-HDRP.html)  
[^36]: Using Unity Layers to Control Lighting on Certain Objects (Layer and Occlusion Solution), 存取於 2026年5月11日, [https://www.youtube.com/watch?v=1cjKPU_3A4A](https://www.youtube.com/watch?v=1cjKPU_3A4A)  
[^37]: Prototype_Final/Library/PackageCache/com.unity.render-pipelines.high-definition@10.8.1/Documentation~/Shadows-in-HDRP.md · main · PENGXI WANG / EAE6330_Final · GitLab, 存取於 2026年5月11日, [https://gapp-git.eng.utah.edu/u1066693/eae6330_final/-/blob/main/Prototype_Final/Library/PackageCache/com.unity.render-pipelines.high-definition@10.8.1/Documentation~/Shadows-in-HDRP.md](https://gapp-git.eng.utah.edu/u1066693/eae6330_final/-/blob/main/Prototype_Final/Library/PackageCache/com.unity.render-pipelines.high-definition@10.8.1/Documentation~/Shadows-in-HDRP.md)  
[^38]: Is there a maximum number of light you can create in a Project? - Unity Engine, 存取於 2026年5月11日, [https://discussions.unity.com/t/is-there-a-maximum-number-of-light-you-can-create-in-a-project/910450](https://discussions.unity.com/t/is-there-a-maximum-number-of-light-you-can-create-in-a-project/910450)  
[^39]: Limit of number of Lights in view : r/Unity3D - Reddit, 存取於 2026年5月11日, [https://www.reddit.com/r/Unity3D/comments/sh188j/limit_of_number_of_lights_in_view/](https://www.reddit.com/r/Unity3D/comments/sh188j/limit_of_number_of_lights_in_view/)  
[^40]: Too many layers used to exclude objects from lighting. in deferred only up to 4 layers can be used simultaneously - Unity Discussions, 存取於 2026年5月11日, [https://discussions.unity.com/t/too-many-layers-used-to-exclude-objects-from-lighting-in-deferred-only-up-to-4-layers-can-be-used-simultaneously/1518892](https://discussions.unity.com/t/too-many-layers-used-to-exclude-objects-from-lighting-in-deferred-only-up-to-4-layers-can-be-used-simultaneously/1518892)
