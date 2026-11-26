---
title: "Unity 6 算繪架構：捨棄 MPB 以實現深度材質最佳化"
date: 2026-04-19 12:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, rendering, optimization, shaders, dots, longgilstudio]
description: "全面剖析 Unity 6 中從 MaterialPropertyBlock 轉向 RSUV 與 GPU Resident Drawer 的架構演進，以達成 AAA 級算繪效能。"
lang: zh-TW
translation_id: unity6-material-rsuv-grd
math: true
---

## **執行摘要（Executive Summary）**

轉向 Unity 6 標誌著算繪管線（render pipelines）在處理大量實例化幾何體（instanced geometry）方式上的一場根本性架構變革。在遊戲開發史上，當眾多物件共用同一份材質卻需要各自的屬性變體（例如色彩調整——color tints）時，最佳化方案通常仰賴 `MaterialPropertyBlock`（MPB）應用程式介面（API）搭配標準 GPU Instancing 系統。然而，對 Unity 6 中 Universal Render Pipeline（URP）與 High Definition Render Pipeline（HDRP）的深入分析顯示，這種舊有（legacy）作法已不再是最佳途徑，且在諸多情境下會導致嚴重的效能衰退。

檢視使用者為「Long Gil Studio DevLog」所提供的文件草稿後，可發現其中混雜了在舊版中成立的傳統最佳化理論，以及對 Unity 6 現代算繪特性的嚴重誤解。具體而言，草稿建議使用 `MaterialPropertyBlock` 的作法，直接與 Unity 6 全新的 **GPU Resident Drawer（GRD）** 技術及其底層的 **BatchRendererGroup（BRG）** API 相衝突。[^1] 為了達到極致的算繪吞吐量，開發者必須採用 **Renderer Shader User Value（RSUV）**，或是徹底轉換至 **Data-Oriented Technology Stack（DOTS）**。[^3]

本研究報告針對算繪瓶頸、Scriptable Render Pipeline（SRP）Batcher 的運作機制、材質複製造成的系統性後果，以及在 Unity 6 中實現 AAA 級算繪效能所需的現代範式進行了徹底的技術分析。此外，報告亦提供了一篇經過修訂並專業統整的技術文章，供 Long Gil Studio DevLog 發表之用。

## **第一部分：Long Gil Studio 原始草稿的技術評估**

最初的草稿文件提出了一個非常具體的算繪問題：最佳化一個包含無數相同物件的場景，這些物件共用單一材質，但需要各自獨立的顏色修改。草稿準確地指出了錯誤的設計模式（anti-patterns），卻指定了一項在 Unity 6 架構脈絡下會使效能惡化的解決方案。

### **原始草稿的正確要點**

1. **材質複製（Material Duplication）的懲罰：** 草稿正確指出，為每個物件建立獨立的材質實例（例如透過 `GetComponent<Renderer>().material.color`）會造成記憶體膨脹（memory bloat）並徹底摧毀繪製呼叫批次處理（draw call batching）。[^5] 存取 `.material` 屬性會迫使 Unity 引擎在背景靜默複製（clone）該材質，進而永久剝奪 SRP Batcher 或 GPU Instancing 系統將這些物件群組至單一 SetPass 呼叫中的能力。[^5]
2. **MaterialPropertyBlock（MPB）的運作機制：** 草稿正確辨識出 MPB 扮演資料覆寫緩衝區（data override buffer）的角色，讓算繪器能在不建立新材質複本的情況下，將逐實例（per-instance）屬性傳遞至 GPU。[^7]
3. **字串（String）屬性與整數識別碼（Integer IDs）：** 草稿恰當地強調了使用字串查詢著色器屬性所產生的中央處理器（CPU）延遲，並主張透過 `Shader.PropertyToID()` 指令預先建立整數識別碼以最佳化迴圈。[^7]

### **嚴重偏差與過時範式**

1. **將 MPB 視為 Unity 6 中的「AAA 標準」：** 原始草稿最重大的缺陷在於宣稱 MPB 代表 Unity 6 的最佳「AAA」解決方案。儘管 MPB 在 Built-In Render Pipeline（舊有架構）中是標準作法，但在現代 SRP 架構中它卻是個具有破壞性的反模式。[^8] 將 MPB 套用至 GameObject 會立即將該物件移出 SRP Batcher 管線。[^10]
2. **仰賴舊式 GPU Instancing：** 草稿承認 MPB 會破壞 SRP Batcher，並建議退而採用傳統 GPU Instancing 作為備案。雖然透過手動破壞 SRP 相容性並啟用 Instancing 在技術上可行，但這會迫使引擎繞過高度最佳化的 SRP 架構。[^12]
3. **忽略 GPU Resident Drawer（GRD）：** Unity 6 推出了 GPU Resident Drawer，這套系統將繪製呼叫（draw call）的產生作業卸載至計算著色器（compute shaders），可將 CPU 算繪成本降低高達 50%。[^14] 只要物件存在 `MaterialPropertyBlock`，即嚴格禁止該 GameObject 參與 GRD。[^1] 在 Unity 6 中推薦使用 MPB，本質上阻礙了專案運用引擎最強大的全新最佳化功能。
4. **遺漏 Renderer Shader User Value（RSUV）：** 於 Unity 6.3 LTS 推出的 RSUV，是在處理簡易逐物件變體時直接取代 MPB 的架構方案。[^15] RSUV 允許針對每個算繪器將一個 24 位元整數傳遞至著色器，同時不會破壞 SRP Batcher 或 GPU Resident Drawer。[^3]

## **第二部分：算繪（Rendering）瓶頸的根本原因分析**

欲理解為何特定 API 呼叫會摧毀影格率（frame rate），必須檢視中央處理器（CPU）與圖形處理器（GPU）之間的通訊模型。現代硬體架構要求這兩顆微處理器之間維持緊密且對延遲極度敏感的同步機制。

### **CPU-GPU 通訊負荷（Overhead）**

算繪單一影格需要 CPU 遍歷相機視野內的所有可見物件（frustum culling）、判定其材質屬性、將所需的貼圖（textures）與著色器繫結（bind）至 GPU 記憶體，並發出繪製命令（draw command）。此管線中代價最高的作業並非 GPU 繪製多邊形（polygons），而是繪製呼叫前必須執行的狀態切換——通常稱為 **SetPass 呼叫**。[^5]

每當 CPU 遇到一個新材質時，就必須暫停算繪管線以將新參數上傳至 GPU。[^18] 若一個場景中包含 10,000 名敵人，且每名敵人都擁有獨立的材質實例以呈現不同的護甲顏色，CPU 就必須執行 10,000 次狀態切換。這會產生極為龐大的 CPU 負荷（CPU Overhead），導致 GPU 閒置等待 CPU 指令的瓶頸狀況。

### **`.material` 屬性的記憶體碎片化**

當腳本存取 `Renderer.material` 以變更顏色時，引擎必須保護原始共用資產（asset）的完整性。它會在內部對該材質執行一次 `Instantiate()` 指令。這會對效能施加兩項嚴厲懲罰：

1. **摧毀批次處理（Batching）：** 該物件不再與同類物件共用材質參考。Unity 會立即停止對該物件執行任何形式的 Static Batching、Dynamic Batching 或 SRP Batching。[^5] 顯示卡必須將其視為完全獨立的實體進行處理。
2. **垃圾回收（Garbage Collection）與記憶體洩漏（Memory Leaks）：** 新建立的材質複本位於由 C# 管理的受控堆積（Heap）記憶體區域。當物件被銷毀時，它不會自動進行垃圾回收。除非開發者明確呼叫 `Destroy(renderer.material)` 指令，否則該記憶體仍會持續維持配置狀態。這會製造記憶體洩漏，導致垃圾回收器（Garbage Collector — GC）必須觸發標記與清除（Mark-and-Sweep）程序，進而引起造成 FPS 驟降的嚴重卡頓尖峰（spikes）。[^5]

## **第三部分：SRP Batcher 架構與傳統 GPU Instancing 的淘汰**

Scriptable Render Pipeline（SRP）從根本上重組了 Unity 管理著色器資料的方式。了解 SRP Batcher 是體會為何舊有最佳化方法在 Unity 6 中徹底失敗的關鍵。

### **SRP Batcher 的運作機制**

在舊有管線（Built-in）中，材質是透過個別的統一變數（separate uniform variables）將資料上傳至 GPU。SRP Batcher 改用大型、永續性的 GPU 緩衝區——即**常數緩衝區（Constant Buffers — CBUFFERs）**來取代此作法。[^11]

SRP 架構強制著色器將其變數拆分為兩個獨立的緩衝區區塊[^11]：

* `UnityPerMaterial`：一個包含由所有使用相同材質的物件所共用之屬性的 CBUFFER（例如基礎顏色、金屬感貼圖——metallic maps、平滑度）。
* `UnityPerDraw`：一個包含特定繪製呼叫專屬屬性的 CBUFFER（例如物件的空間轉換矩陣——transformation matrices）。

由於 `UnityPerMaterial` 緩衝區永續駐留於 GPU 記憶體中，只要連續的物件共用相同的著色器變體（shader variant），CPU 就不再需要在算繪迴圈中重新上傳材質屬性。[^18] SRP Batcher 僅需繫結（bind）此永續緩衝區，並更新體積小得多的 `UnityPerDraw` 緩衝區即可。這項設計大幅降低了 CPU 負荷，有時可將算繪吞吐量提升達 1.2 倍至 4 倍。[^21]

### **與 `MaterialPropertyBlock` 的核心衝突**

`MaterialPropertyBlock` API 最初是為了在算繪器層級覆寫材質屬性而設計。然而，由於 SRP Batcher 仰賴 `UnityPerMaterial` CBUFFER 的嚴格分離與永續性，注入 MPB 會直接違反此記憶體配置。[^8]

一旦套用了 MPB，Unity 便無法再保證永續性的材質緩衝區能一致地套用至該物件。因此，引擎被迫強硬地將該物件逐出 SRP Batcher 管線。[^9] Unity 官方文件明確證實：*「請注意，此功能與 SRP Batcher 不相容。在 URP 或 HDRP 中使用 MPB 很可能會導致效能下滑。」*[^8]

### **舊有備案：`Graphics.DrawMeshInstanced`**

過去，當開發者需要大量變體（例如一片由不同色彩樹木組成的森林）時，往往會接受失去 SRP Batcher 的代價並退回使用 GPU Instancing。[^12] 這需要透過在 `UnityPerMaterial` 緩衝區外部宣告屬性，並在材質上勾選「Enable GPU Instancing」，以手動方式破壞著色器的 SRP 相容性。[^13]

雖然 GPU Instancing 能藉由傳遞轉換矩陣陣列與顏色資料來減少繪製呼叫，但它伴隨著嚴重的限制。[^12] 它難以應付嚴重的過度繪製（overdraw）現象，要求網格（meshes）必須完全一致，並且每影格都會對 CPU 造成收集與上傳實例陣列（instance arrays）的沉重負擔。在 Unity 6 中，這套作法已完全被 GPU Resident Drawer 架構所取代。[^23]

## **第四部分：`MaterialPropertyBlock`（MPB）與 Unity 6 生態系的不相容性**

對 MPB 進行更深入的分析顯示，它不僅會破壞 SRP Batcher，還會對 Unity 6 中的除錯工具（debugging tools）與光照系統（lighting systems）構成結構性風險。

### **對光照貼圖（Lightmap）資料與全域照明（Global Illumination）的影響**

誤用 MPB 最少被提及的後果之一，便是徹底清除光照貼圖（Lightmap）資料。當你建立一個 `new MaterialPropertyBlock()` 並透過 `Renderer.SetPropertyBlock()` 指派時，傳入的屬性區塊將會完全覆寫算繪器的區域狀態。[^24]

如果你的物件正使用預先烘焙（baked）的全域照明（GI）系統，關於 Lightmap UV 座標與光照探針（Light Probe）係數的資訊會隱含儲存於算繪器自身的屬性區塊之中。[^24] 如果你在設定顏色前未先呼叫 `Renderer.GetPropertyBlock(block)`，便會意外抹除物件的光照資訊。儘管 Long Gil Studio 的原始草稿妥善處理了 `GetPropertyBlock` 的部分，但在數千個物件上反覆呼叫此 API 本身仍會產生不容忽視的額外 CPU 延遲。

| 最佳化技術 | 是否造成記憶體洩漏 | 相容 SRP Batcher | 相容 GRD | 相容 DOTS | 使用建議 |
| :----------------------------- | :------------ | :---------------------- | :-------------- | :--------------- | :-------------------- |
| **`Material.color`** | 是 | 否 | 否 | 否 | 絕對避免 |
| **`MaterialPropertyBlock`** | 否 | 否 | 否 | 否 | 僅供舊版 Built-in 專案 |
| **GPU Instancing** | 否 | 否（衝突） | 否 | 否 | Unity 2020–2022 |
| **Renderer Shader User Value** | 否 | 是 | 是 | 是 | Unity 6.3+ 標準方案 |

如上表所示，MPB 已屬於上一世代的技術。它雖然解決了記憶體問題，卻破壞了 Unity 6 整套現代算繪管線。

## **第五部分：架構轉折點：GPU Resident Drawer（GRD）與 `BatchRendererGroup`（BRG）**

Unity 6 引進了一條具革命性的算繪路徑：GPU Resident Drawer。此系統將運作模式從由 CPU 控制繪製命令產生，轉變為高度自主且由 GPU 驅動的算繪迴圈。[^1]

### **GPU Resident Drawer 的架構**

GPU Resident Drawer 建構於底層的 `BatchRendererGroup`（BRG）API 之上。[^1] CPU 不再評估哪些物件屬於可見範圍（視錐體剔除——frustum culling）並發出單一或實例化的繪製呼叫，而是將整個場景的空間與材質資料上傳至 GPU。[^25] 接著，計算著色器（compute shaders）會完全在 GPU 上執行視錐體剔除、遮擋剔除（occlusion culling）以及繪製命令產生。[^14]

效能提升幅度相當驚人。透過採用間接算繪（`DrawInstancedIndirect`），複雜場景中用於算繪的 CPU 工作量最多可降低達 50%。[^14] 更進一步地，當搭配 GPU Occlusion Culling 使用時，三角形處理量（triangle processing）可減少近 90%，同時 GPU 影格時間（frame time）縮減超過一半。[^28]

### **`BatchRendererGroup`（BRG）API 與剔除（Culling）**

GRD 的背後是 `BatchRendererGroup`。BRG 要求使用者透過一個 `OnPerformCulling` 回呼函式進行初始化。[^30] 在此處，CPU 僅需組態可見度（visibility）並輸出陣列形式的繪製呼叫命令。物件資料（轉換矩陣、顏色、旗標）會上傳至 `GraphicsBuffer`。[^25] 這使得數百萬個三角形僅需少數幾次 SetPass 呼叫即可送交給 GPU。

### **MPB 與 GRD 的致命不相容性**

關於 Unity 6 最佳化最重要的資訊，在於 GPU Resident Drawer 適用性條件的嚴苛與脆弱性。一個物件若要交由 GRD 處理，必須遵守嚴格的資料配置規則。[^2]

Unity 6.1+ 官方文件明確指出，使用 `MaterialPropertyBlock` API 的 GameObject 會立即被排除於 GPU Resident Drawer 之外。[^1] 此外，物件不得掛載仰賴逐實例回呼（例如 `OnRenderObject`）的腳本。[^2]

當開發者掛載 MPB 來變更物件顏色時，便會在無意間迫使引擎針對該特定物件退回至舊有的 CPU 驅動算繪模式。若在即時戰略遊戲中的 10,000 名士兵單位上如此操作，CPU 負荷將會急遽飆升，徹底抵銷升級至 Unity 6 引擎的優勢。

## **第六部分：現代標準：Unity 6.3 中的 Renderer Shader User Value（RSUV）**

體認到 MPB 與現代管線不相容所造成的架構僵局後，Unity 在 Unity 6.3 LTS 版本中推出了 **Renderer Shader User Value（RSUV）** 功能。[^15] 當開發者需要在共用單一材質的多個算繪器上套用簡易的逐實例自訂調整時，RSUV 便成為 `MaterialPropertyBlock` 的最終替代方案。[^3]

### **RSUV 的運作機制**

RSUV 避開了造成 MPB 缺陷的複雜緩衝區修改。取而代之的是，它運用一個隨算繪器標準繪製資料一同直接傳遞的高效 24 位元整數通道。[^3] 由於此整數直接整合於現有的資料結構中，而不需額外要求緩衝區覆寫（buffer override），因此它對 SRP Batcher 與 GPU Resident Drawer 皆維持絕對的相容性。[^3]

### **實作與位元編碼（Bitwise Encoding）**

為了運用 RSUV 進行色彩變化，CPU 必須將所需的 RGB 數值編碼至單一 24 位元無號整數（`uint`）中。每個色彩通道（紅——Red、綠——Green、藍——Blue）佔用 8 個位元（提供 0 至 255 的數值範圍）。[^3]

編碼運算採用位元左移運算子（`<<`）與位元 OR 運算子（`|`）。其數學方程式如下：

$$
Color_{uint} = (Blue_{byte} \ll 16) | (Green_{byte} \ll 8) | (Red_{byte})
$$

在實際的 C# 實作中，走訪 `MeshRenderer` 元件陣列以套用隨機色彩調整可發揮極高效能，且不會產生任何垃圾記憶體配置（zero garbage allocation）[^3]：

```csharp
MeshRenderer allMeshRenderers = FindObjectsByType<MeshRenderer>(FindObjectsSortMode.InstanceID);  
foreach (MeshRenderer meshRenderer in allMeshRenderers)  
{  
    // 計算隨機色彩（使用 HSV 色彩空間以呈現更鮮明的色調）  
    Color32 targetColor = Color.HSVToRGB(UnityEngine.Random.Range(0f, 1f), 1f, 1f);  

    // 將 RGB 編碼進 24 位元整數（藍、綠、紅）  
    uint encodedColor = ((uint)targetColor.b << 16) |   
                        ((uint)targetColor.g << 8) |   
                        ((uint)targetColor.r << 0);  

    // 透過 Unity 6.3 的新 API 直接將數值套用至算繪器
    meshRenderer.SetShaderUserValue(encodedColor);  
}
```

### **著色器端解碼（Shader Decoding）**

在 GPU 端，著色器必須將這個 24 位元整數解包（unpack）還原為正規化的 `float4` 色彩值。Unity 提供了內建變數 `unity_RendererUserValue` 以存取此資料區塊。[^3]

解碼過程使用位元右移運算子（`>>`）以及搭配位元遮罩 `255` 的位元 AND 運算子（`&`），以隔離每個 8 位元區段。隨後乘以 255 的倒數（`1.0 / 255.0`），將數值正規化至 `0.0` 到 `1.0` 的範圍內。[^3]

$$
Channel_{normalized} = ((unity\_RendererUserValue \gg Shift) \ \& \ 255) \times 0.0039215
$$

在高階著色器語言（HLSL）中，或是透過 Shader Graph 的 Custom Function 節點，解包邏輯呈現如下[^3]：

```hlsl
uint c = unity_RendererUserValue;  
float4 instanceColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  // 紅色通道 (Red)  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  // 綠色通道 (Green)  
    (float)((c >> 16) & 255) * (1.0 / 255.0), // 藍色通道 (Blue)  
    1.0 // 固定 Alpha  
);
```

這項範式轉移驗證了一種深層的最佳化策略：以純數學運算（RSUV）換取資料結構的簡化（取代 MPB）。GPU 處理器極度擅長位元運算，這意味著解碼成本幾乎微不可見（僅消耗極微小的時脈週期——clock cycles）。與此同時，完整保留 SRP Batcher 與 GPU Resident Drawer 管線帶來了影格時間（frame-time）的巨幅縮減。[^16]

## **第七部分：極大規模解決方案：DOTS、ECS 與 `URPMaterialPropertyOverride`**

對於運作規模超越標準 GameObject 處理極限的專案（例如包含數十萬個獨立單位的群體模擬——boids，或龐大的 RTS 軍團），Unity 的 Data-Oriented Technology Stack（DOTS）技術提供了終極算繪架構。[^4]

### **資料導向記憶體管理（Data-Oriented Memory）**

不同於物件導向（object-oriented）系統中 GameObject 零散分布於堆積記憶體的限制，實體元件系統（ECS）中的實體（entities）在記憶體中完全以連續資料陣列（contiguous arrays of data）的形式存在。[^4] 這種記憶體配置與 `BatchRendererGroup`（BRG）API 達成最高效能所需的結構完美吻合。

在 Entities Graphics 套件中，開發者可以使用 `URPMaterialPropertyOverride` 元件。[^4] 該系統支援逐實體的材質屬性覆寫（per-entity material overrides），而完全不需動用有害的 `MaterialPropertyBlock` API。

### **DOTS Instancing 的運作機制**

當一個實體在 DOTS 中接受處理時，已組態 DOTS Instancing 的著色器（透過在 Shader Graph 中勾選 *Override Property Declaration* 並選擇 *Hybrid Per Instance*）會收到一個唯一的 32 位元整數（一項中繼資料值——metadata value）。[^34] 此整數代表位於 GPU 上穩定 `GraphicsBuffer` 內部的偏移量（offset）。[^34]

著色器利用此偏移量載入其目前正算繪之實例的特定屬性資料。[^34] DOTS Instancing 的獨到之處在於：若多個實體共用相同的屬性值，DOTS Instancing 允許它們從記憶體中的相同位置（相同的偏移量）讀取該數值，從而節省 GPU 週期並將記憶體重複降至最低。[^34] 由於屬性是透過偏移量載入，而非受限於傳統常數緩衝區之中，單次繪製呼叫的大小不再受到嚴格限制，進而實現極為龐大的實例數量。

```csharp
// 透過 DOTS / Burst Compile 系統指派 RSUV 數值的範例 

public partial struct MaterialMeshInfoSystem : ISystem   
{  
    public void OnUpdate(ref SystemState state)   
    {  
        var entityManager = state.EntityManager;  
        // 透過將數值直接寫入 NativeArray 實現平行處理  
        // 帶來 MonoBehaviour 永遠無法企及的執行速度。  
    }  
}
```

透過 Bursted Background Jobs（經由 Burst Compiler 編譯的背景工作）修改實體元件數值，能以驚人的速度執行。[^4] 玩家可以看到柵欄依據地形坡度變換顏色，或是草地依照海拔高度動態調整色澤，且這一切都在單一繪製串流（draw stream）中完成算繪而毫無瓶頸。[^4]

## **第八部分：替代方案分析（Alternative Solutions）**

Long Gil Studio 的原始草稿簡略提及了其他替代最佳化技術。以下分析確認了它們的可行性，並將其置於 Unity 6 引擎物理限制的脈絡中加以評估。

1. **頂點色彩（Vertex Colors）：**
   * *機制：* 將顏色資料直接編碼至 3D 網格的頂點（vertices）中。著色器從網格讀取 `TEXCOORD` 或 `COLOR` 屬性。
   * *效益：* 極為輕量，並完美保留所有批次處理功能以及 GRD 相容性。[^36]
   * *弱點：* 在執行時期（runtime）變更頂點色彩需要操作網格資料陣列（`mesh.colors`）。此舉會在 RAM 中建立網格複本，導致 CPU 停頓（stalls）與垃圾記憶體配置。頂點著色至今仍然最適合用於在 Blender 或 Maya 等軟體中預先「烘焙」（baked）完成的靜態變體。
2. **貼圖圖集與 UV 偏移（Texture Atlasing 與 UV Offsets）：**
   * *機制：* 將多種顏色變體整合進單一張貼圖圖集（texture atlas），並偏移不同物件的 UV 座標以取樣特定的像素。[^36]
   * *效益：* 此技術維持單一材質與單一貼圖，確保與 SRP Batcher 絕對相容。[^36]
   * *弱點：* 與頂點色彩相似，在執行時期動態變更不同物件的 UV 座標通常需要建立獨立的網格實例（mesh instances），進而引發記憶體膨脹（memory bloat）。不過，對於靜態環境設計或體素（Voxel）遊戲（如《Minecraft》）而言，這是無可匹敵的技術。
3. **底層 `Graphics.DrawMeshInstanced`：**
   * *機制：* 完全繞過 GameObject 階層結構，透過 C# 程式碼直接將座標矩陣與顏色陣列推送至 GPU。[^37]
   * *效益：* 為群聚演算法（flocking）或程式化植被（procedural foliage）等系統提供龐大效能。[^38]
   * *在 Unity 6 中的弱點：* `BatchRendererGroup` API 與 GPU Resident Drawer 的問世已將這項效能「普及化」，在大多數常規開發情境中免除了撰寫複雜剔除（culling）與繪製提交程式碼的必要。[^19] 如今維護一套自訂的 `DrawMeshInstanced` 管線，比交由 GPU Resident Drawer 自動化處理耗費更多工程資源。

## **第九部分：Long Gil Studio DevLog 建議內容架構**

基於完整的技術評估流程，以下文字段落為經過全面修訂的建議 DevLog 文章，展現高水準的技術專業性。它捨棄了有缺陷的 MPB 作法，並引導讀者走向 Unity 6 真正的架構標準：RSUV 與 GPU Resident Drawer。

---

**Unity 6：最佳化共用材質的數千個物件 – 捨棄 MPB 邁向現代架構**

**作者：Long Gil Studio**

**🇻🇳 越南語版（繁體中文譯本）**

**1. 算繪瓶頸：材質複製亂象**

在開發大型遊戲的過程中，一個極為常見的架構難題隨之浮現：「如何在不造成影格率下降的前提下，改變數千個共用同一材質的物件顏色？」

許多開發者常會使用 `GetComponent<Renderer>().material.color` 指令。這是一個致命的錯誤（anti-pattern）。呼叫 `.material` 會迫使 Unity 在 RAM 上靜默建立該材質的複本（clone）。後果便是嚴重的記憶體洩漏、持續觸發垃圾回收（Garbage Collection），並徹底破壞批次處理（Batching）系統。GPU 陷入飢餓等待，而 CPU 則因處理數千個獨立的 Draw Call 而過載。

**2. 舊有陷阱：為何 `MaterialPropertyBlock` 在 Unity 6 中已「死亡」**

過去，「專業級」的解決方案是使用 `MaterialPropertyBlock`（MPB），在不複製材質的前提下為每個物件傳遞資料。**但如果你正在使用 Unity 6（URP/HDRP），必須立即停止這種作法。**

Unity 6 高度仰賴 **SRP Batcher** 管線以及具革命性的 **GPU Resident Drawer（GRD）** 技術。GRD 將整套算繪處理流程（Draw Call 產生、剔除/Culling）下放至 GPU 上的計算著色器（Compute Shaders），有助於減少高達 50% 的 CPU 運算時間。然而，根據引擎核心文件，當你將 `MaterialPropertyBlock` 掛載到物件上時，該物件會立即被移出 SRP Batcher，並徹底喪失與 GPU Resident Drawer 的相容性。使用 MPB 意味著你正強迫 Unity 為你的整支軍隊退回緩慢且耗費 CPU 的舊式算繪管線。

**3. Unity 6 新標準：Renderer Shader User Value（RSUV）**

為徹底解決此一僵局，Unity 6.3 LTS 更新引進了 **Renderer Shader User Value（RSUV）**。此 API 允許你直接向算繪器傳遞一個 24 位元整數。由於 RSUV 不需配置新的緩衝區（buffers），它與 SRP Batcher 及 GPU Resident Drawer 皆維持 100% 的相容性。

**步驟 1：C# 編碼（零垃圾記憶體配置）**

不同於 MPB 使用字串（string），我們將透過位元位移（bitwise）運算，把 RGB 顏色編碼為一個 24 位元整數：

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // 將藍、綠、紅 3 個通道編碼至一個 24 位元整數  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // 套用數值（對 SRP 與 GRD 架構絕對安全！）  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**步驟 2：在 Shader Graph 上解碼**

在 Shader Graph 內部建立一個輸出為 `Vector4` 的 **Custom Function** 節點（Type: String, Name: DecodeColor）。貼上以下 HLSL 程式碼片段，以將整數解包還原為標準顏色：

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

將此輸出連接至片段著色器（Fragment Shader）的 Base Color 連接埠。現在，你已擁有零 CPU 延遲的無限色彩變體，並能徹底發揮 GPU Resident Drawer 系統的強大威力。

**範例：Shader 腳本上的實戰實作（不使用 Shader Graph）**

如果你以程式碼（HLSL）撰寫自訂著色器，可以介入 `BuildSurfaceData` 函式以解碼 `unity_RendererUserValue`，並如下方 diff 片段所示將其與 `BaseColor` 相乘：

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // 解碼 RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // 套用 rsuvColor 顏色
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ... 
}
```

*了解更多參考資訊：*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. 突破 100,000 個物件大關：DOTS / ECS 解決方案**

如果你的遊戲需要算繪數十萬個獨立單位（例如龐大的軍團），無論你將算繪最佳化得多麼出色，傳統的 GameObject 系統必定會在 CPU 端遭遇瓶頸。面對此等規模，請轉向 Unity DOTS 架構。使用 `URPMaterialPropertyOverride` 元件可建立資料導向（Data-Oriented）的記憶體配置，於底層直接與 `BatchRendererGroup` API 系統通訊，帶來真正 AAA 級標準的無敵效能。

---

**🇺🇸 英文版（繁體中文譯本）**

**1. 算繪瓶頸：材質複製**

在開發高密度遊戲時，經常會出現一個常見的架構挑戰：「如何在不毀掉效能的情況下，更改共用相同材質的數千個物件的顏色？」

開發者通常會預設採用 `GetComponent<Renderer>().material.color`。這是一個致命的反模式（anti-pattern）。存取 `.material` 會迫使 Unity 在受控堆積上靜默複製該材質。這會產生嚴重的記憶體膨脹，觸發垃圾回收尖峰，並摧毀繪製呼叫批次處理，在使 GPU 處於飢餓狀態的同時將 CPU 負荷推升至無法管理的水準。

**2. 舊有陷阱：為何 MaterialPropertyBlock 在 Unity 6 中已成過去式**

歷史上，「專業」的解決方案是使用 MaterialPropertyBlock（MPB），在不複製材質的情況下傳遞逐實例資料。**如果你正在使用 Unity 6（URP/HDRP），則必須立即停止使用此方法。**

Unity 6 高度仰賴 **SRP Batcher** 以及革命性的新技術 **GPU Resident Drawer（GRD）**。GRD 將視錐體剔除與繪製呼叫產生作業卸載至 GPU 計算著色器，使 CPU 算繪時間減少高達 50%。然而，根據核心引擎文件，將 MaterialPropertyBlock 套用至物件會立即使其失去 SRP Batcher 資格，並徹底破壞與 GPU Resident Drawer 的相容性。使用 MPB 等同於迫使 Unity 為你的龐大軍團退回緩慢、受限於 CPU 的傳統算繪路徑。

**3. Unity 6 標準：Renderer Shader User Value（RSUV）**

為了解決此架構僵局，Unity 6.3 LTS 推出了 **Renderer Shader User Value（RSUV）**。此 API 允許你直接將一個 24 位元整數傳遞至算繪器的基礎資料承載（payload）。由於避免了修改永續常數緩衝區，RSUV 與 SRP Batcher 及 GPU Resident Drawer 皆維持 100% 相容。

**步驟 1：C# 編碼（零記憶體配置）**

我們不再傳遞字串並建立區塊，而是透過位元運算將 RGB 顏色數學打包進一個 24 位元無號整數：

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // 將藍、綠、紅通道編碼進單一 24 位元整數  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // 原生套用數值（100% 相容 SRP 與 GRD！）  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**步驟 2：著色器解碼**

在你的 Shader Graph 中，建立一個輸出為 `Vector4` 的 **Custom Function** 節點（Type: String, Name: DecodeColor）。貼上此 HLSL 程式碼，以將整數解包還原為正規化浮點顏色：

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

將此輸出連接至你的 Base Color 片段輸入。現在你擁有了零繪製呼叫懲罰的無限色彩變體，同時充分發揮 GPU Resident Drawer 的能力。

**範例：自訂著色器中的實戰實作（不使用 Shader Graph）**

如果你以程式碼（HLSL）撰寫自訂著色器，可如下方 diff 所示修改 `BuildSurfaceData` 函式，以解碼 `unity_RendererUserValue` 並將其與 `BaseColor` 相乘：

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // 解碼 RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // 套用 rsuvColor
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ...
}
```

*另請參閱：*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. 超越 100,000 個物件：DOTS / ECS**

如果你的遊戲需要算繪數十萬個動態單位，無論圖形最佳化做得再好，標準 GameObject 最終仍會使 CPU 主執行緒遭遇瓶頸。針對超大規模，請轉移至 Unity DOTS。使用 `URPMaterialPropertyOverride` 元件可實現嚴格的資料導向記憶體配置。這能直接與底層 `BatchRendererGroup` API 對接，達成無可匹敵、純粹 AAA 級的算繪效能。

---

## **第十部分：開發團隊的策略建議**

對現代算繪範式的分析顯示了舊有（legacy）最佳化知識與當代引擎架構之間的重要差異。圖形工程師應掌握的核心重點在於：修改逐物件的資料緩衝區（data buffers），在本質上與平行執行及 GPU 驅動的算繪迴圈相衝突。絕不可將 Unity 5.x 或 Unity 2019 的最佳化思維沿用至 Unity 6。

為了在 Unity 6 中達到極致效能，開發團隊必須嚴格執行以下規範：

1. **稽核 MPB 使用情況（Audit for MPB Usage）：** 應持續執行效能分析工具（如 Unity Profiler）與 Frame Debugger，找出並徹底根除將 `MaterialPropertyBlock` 套用於大量實例化幾何體（mass-instanced geometry）的案例。MPB 帶來的短期便利性，在系統性失去 GPU Resident Drawer 功能的代價面前完全微不足道。團隊應在原始碼中建立警告機制或 CI/CD 腳本，以偵測不必要的 MPB 初始化。
2. **採用位元編碼策略（Bitwise Encoding Strategies）：** 採用 Renderer Shader User Value（RSUV）需要程式設計方法論上的轉變。技術美術（Technical Artists）與玩法程式設計師必須協力合作，針對 RSUV 的 24 位元上限定義嚴謹的位元封裝結構。需確保各類資料狀態（顏色、傷害、陣營 ID — team ID）在送達算繪器之前妥善序列化。例如：可分配 4 位元給「陣營 ID」（支援 16 個陣營）、8 位元給「傷害狀態」（支援 256 個等級），以及 12 位元給「自訂色調（Custom Tint）」——所有資訊皆在著色器內透過位元遮罩（bitmasks）同步解碼。
3. **評估 ECS 轉換門檻（Evaluate Thresholds for ECS Transition）：** 儘管 RSUV 解決了 GameObject 的材質變體瓶頸，但與物理運算、轉換矩陣計算（transform calculations）及 GameObject 剔除相關的 CPU 限制依然存在。預期活躍實體數量超過 10,000 個動態代理（dynamic agents）的專案，應積極、果斷地設計 DOTS（Entity Component System）實作原型（prototypes）。善用 `URPMaterialPropertyOverride`[^34] 元件於底層直接與 `BatchRendererGroup` API 通訊，是徹底釋放次世代 PC 與遊戲主機硬體潛能的唯一途徑。

## **參考文獻**

[^1]: Enable the GPU Resident Drawer in URP - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html](https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html)
[^2]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)
[^3]: Set and use the RSUV - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html)
[^4]: Migrated my game to ECS/DOTS and material overrides are awesome! : r/Unity3D - Reddit, 2026 年 4 月 19 日存取, [https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated\_my\_game\_to\_ecsdots\_and\_material/](https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated_my_game_to_ecsdots_and_material/)
[^5]: Why You Should Stop Swapping Materials in Unity (And What to Do Instead) - Medium, 2026 年 4 月 19 日存取, [https://medium.com/@MTCrypto\_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e](https://medium.com/@MTCrypto_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e)
[^6]: Material Property Blocks - using them to store the original color of a material upon instantiation : r/Unity3D - Reddit, 2026 年 4 月 19 日存取, [https://www.reddit.com/r/Unity3D/comments/10jyr9b/material\_property\_blocks\_using\_them\_to\_store\_the/](https://www.reddit.com/r/Unity3D/comments/10jyr9b/material_property_blocks_using_them_to_store_the/)
[^7]: Instancing and Material Property Blocks | Ronja's tutorials, 2026 年 4 月 19 日存取, [https://www.ronja-tutorials.com/post/048-material-property-blocks/](https://www.ronja-tutorials.com/post/048-material-property-blocks/)
[^8]: Scripting API: MaterialPropertyBlock - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html](https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html)
[^9]: Unity 6 and custom material bug - Spine Forum, 2026 年 4 月 19 日存取, [https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug](https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug)
[^10]: Scriptable Render Pipeline (SRP) Batcher - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html)
[^11]: Scriptable Render Pipeline Batcher - Unity 6.3 User Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html)
[^12]: GPU instancing - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html](https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html)
[^13]: Remove SRP Batcher compatibility for GameObjects | High Definition Render Pipeline | 17.0.4 - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html)
[^14]: Beginning Game Development: GPU Resident Drawer | by Lem Apperson - Medium, 2026 年 4 月 19 日存取, [https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3](https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3)
[^15]: Introduction to RSUV - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html)
[^16]: Renderer Shader User Value sample - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html](https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html)
[^17]: Speed Up Your Game Rendering in Unity3D: The Secret to Changing Material Colors, 2026 年 4 月 19 日存取, [https://www.youtube.com/watch?v=CjfMAhU7cY8](https://www.youtube.com/watch?v=CjfMAhU7cY8)
[^18]: Scriptable Render Pipeline Batcher - Unity User Manual 2021.3 (LTS), 2026 年 4 月 19 日存取, [https://docs.unity.cn/Manual/SRPBatcher.html](https://docs.unity.cn/Manual/SRPBatcher.html)
[^19]: Unity Draw Call Batching: The Ultimate Guide (2026 Update), 2026 年 4 月 19 日存取, [https://thegamedev.guru/unity-performance/draw-call-optimization/](https://thegamedev.guru/unity-performance/draw-call-optimization/)
[^20]: Scriptable Render Pipeline Batcher - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html)
[^21]: SRP Batcher: Speed up your rendering - Unity, 2026 年 4 月 19 日存取, [https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering](https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering)
[^22]: Remove SRP Batcher compatibility for GameObjects in URP - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html)
[^23]: GPU Instancing not working? Why amount of batches doesn't change? : r/Unity3D - Reddit, 2026 年 4 月 19 日存取, [https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu\_instancing\_not\_working\_why\_amount\_of\_batches/](https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu_instancing_not_working_why_amount_of_batches/)
[^24]: Scripting API: Renderer.GetPropertyBlock - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html)
[^25]: Create batches with the BatchRendererGroup API in URP - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html)
[^26]: Use the GPU Resident Drawer | High Definition Render Pipeline | 17.0.4 - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html)
[^27]: Create draw commands with the BatchRendererGroup API | High Definition Render Pipeline, 2026 年 4 月 19 日存取, [https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html](https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html)
[^28]: Unity Tip Tuesday: GPU Resident Drawer & GPU occlusion culling - YouTube, 2026 年 4 月 19 日存取, [https://www.youtube.com/shorts/0PenzdQFlv0](https://www.youtube.com/shorts/0PenzdQFlv0)
[^29]: Graphics Features and Tools in Unity 6 Feel Like MAGIC! STP, Resident Drawer, and Occlusion Culling! - YouTube, 2026 年 4 月 19 日存取, [https://www.youtube.com/watch?v=trdeAq3WPkQ](https://www.youtube.com/watch?v=trdeAq3WPkQ)
[^30]: Initialize a BatchRendererGroup object in URP - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html)
[^31]: Boost performance of your game in Unity 6 with GPU Resident Drawer - The Knights of U, 2026 年 4 月 19 日存取, [https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/](https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/)
[^32]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)
[^33]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html)
[^34]: DOTS Instancing shaders in URP - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/Manual/dots-instancing-shaders.html](https://docs.unity3d.com/Manual/dots-instancing-shaders.html)
[^35]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html)
[^36]: One Material multiple colors possible? : r/Unity3D - Reddit, 2026 年 4 月 19 日存取, [https://www.reddit.com/r/Unity3D/comments/9oi8kz/one\_material\_multiple\_colors\_possible/](https://www.reddit.com/r/Unity3D/comments/9oi8kz/one_material_multiple_colors_possible/)
[^37]: Single-pass instanced rendering and custom shaders - Unity - Manual, 2026 年 4 月 19 日存取, [https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html](https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html)
[^38]: Use Graphics.DrawMeshInstanced or similar but vary the color on a per object basis?, 2026 年 4 月 19 日存取, [https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use\_graphicsdrawmeshinstanced\_or\_similar\_but\_vary/](https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use_graphicsdrawmeshinstanced_or_similar_but_vary/)
