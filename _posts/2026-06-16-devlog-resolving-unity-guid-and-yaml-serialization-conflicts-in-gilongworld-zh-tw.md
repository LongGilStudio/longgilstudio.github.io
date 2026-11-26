---
title: "深度技術報告：GilongWorld 專案功能分支開發中的 Unity GUID 與 YAML 序列化參照錯誤修復實錄"
date: 2026-06-16 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, guid, serialization, assetdatabase, git]
description: "深入剖析 Unity 的 GUID 識別碼系統與 YAML 序列化架構，並分享在拆分功能分支時解決參照斷裂問題的實戰方案。"
lang: zh-TW
translation_id: gilongworld-unity-guid-serialization
---

## **系統背景與 Long Gil Studio 的結構性危機**

在大型娛樂軟體的開發生命週期中，重構系統架構以因應新的設計需求是一項無法避免的挑戰。由 Long Gil Studio 工程團隊於 Unity 平台開發的 **GilongWorld** 專案，在系統規模擴展過程中遭遇了一道嚴峻的技術瓶頸。核心難題源自於一項實際的維運與開發需求：開發團隊必須將一項現有功能拆分為兩個完全獨立的開發方向，以支援遊戲中各自專屬的自訂（custom）遊玩機制。這項要求意味著新功能分支必須繼承原功能的完整邏輯基礎、資料結構與視覺資源，但同時又必須實現絕對隔離，以確保對新分支的任何更動都不會引發連鎖效應（ripple effect）而損毀原功能。

由於這兩項功能源自共同起點，初始目錄結構中包含大量在實體層面完全重複的檔案——從 C# 原始碼檔案（Script）、Prefab、Material、Texture，到 Animation 設定檔。Long Gil Studio 的終極目標是將這兩塊資源徹底分離。然而，在 Unity Editor 環境中執行一般複製（duplicate）操作時，卻立即引發了嚴重的參照斷裂現象：新資源區塊（Prefab、`ScriptableObject`）的整體內部連結系統竟自動牢牢綁定到原分支的舊原始碼與資源檔案上。這起事件開啟了一連串旨在恢復資料結構完整性的漫長技術攻關。Long Gil Studio 尋找解方的歷程不僅是一次常規的除錯過程，更是一堂關於 Unity 序列化（serialization）系統與資源資料庫（`AssetDatabase`）本質的深刻課題。

## **剖析 Unity 的序列化（Serialization）架構與識別碼體系**

要徹底理解為何一般資料夾複製會導致參照斷裂與重疊，必須對 Unity Engine 的資源管理架構進行深度剖析。不同於作業系統檔案管理員通常依賴實體檔案路徑（file path）或檔名來定位文件，Unity 運作著一套專屬的內部資料庫系統，專為免疫實體儲存空間變動所帶來的影響而設計[^1]。

### **YAML 序列化語言與客觀資料結構**

Unity Engine 採用了一套高效能的序列化函式庫，實作了 YAML（YAML Ain't Markup Language）規格的子集，用以儲存 Scene、Prefab、Material 與 `ScriptableObject` 等絕大多數設計資源的資料狀態[^2]。這項架構決策旨在提供一種透明且人類可讀的純文字格式，讓程式設計師能透過 Git 等版本控制系統（Version Control System）輕鬆追蹤變更，並高效率地解決資料衝突[^3]。

使用純文字編輯器檢視任一 Prefab 或 Scene 檔案的原始碼時，YAML 結構會揭露出一張由物件宣告與參照超連結構成的繁複網路。YAML 檔案中的每個物件皆透過形如 `!u!{CLASS ID} &{FILE ID}` 的特殊識別字串進行定義[^2]。這兩項要素構成了 Unity 中所有相依性圖表（dependency graph）的基石。

**Class ID** 是一個整數（integer）值，用來指定物件所屬的底層類別（class），該值寫死（hardcode）在 Unity Engine 的 C++ 原始碼中[^2]。舉例來說，數字 `1` 代表 `GameObject`，`4` 代表 `Transform` 元件，而 `114` 則代表 `MonoBehaviour`（亦即由使用者自訂的 C# 腳本）[^2]。與此同時，**File ID**（本機檔案識別碼）是一個數值，代表該物件本身在單一檔案有限範圍內的識別碼[^2]。File ID 用於解析位於同一檔案內部之物件間的交叉參照，例如當 `Transform` 元件需要參照其父層 `GameObject` 時[^2]。針對 3D 模型檔案（Model files）或由 Unity 管理的內部資源，File ID 通常是龐大且無法預測的隨機數字，於 Unity 首次探索並解析該檔案時產生並指派[^4]。至於位在函式庫二進位檔（DLL）中的 C# 原始碼檔案（`.cs`），Unity 則採取更具決定性（deterministic）的作法。系統藉由 MD4 密碼學雜湊演算法來計算本機 File ID。具體演算法會依據公式 `"s\0\0\0" + t.Namespace + t.Name` 擷取文字字串之 MD4 雜湊值的前四個位元組，以產生小端序（little-endian）的 32 位元整數[^4]。

下表針對構成 Unity 資源網路的三個識別碼層級進行了詳盡對照：

| 識別碼分類 | 技術作用域 | 產生來源與所套用演算法 | 在系統架構中的核心角色 |
| :--- | :--- | :--- | :--- |
| **Class ID** | 全域（深度整合於引擎內部） | 於 Unity 的 C++ 原始碼中靜態預先定義。 | 判定原生元件類型（`GameObject`、`Transform`、`Camera`、`Collider` 等）[^2]。 |
| **File ID** | 區域（僅限於單一 YAML 檔案內部） | 圖形資源採用隨機數字；C# 腳本/DLL 採用 MD4 雜湊[^4]。 | 識別 Prefab/Scene 內部的子項目。解析內部物件圖參照[^5]。 |
| **GUID** | 全域（貫穿整個專案） | 全域唯一識別碼 UUID v4（十六進位，32 個無連字號的字元）[^7]。 | 識別實體資源檔案。解析專案中不同檔案之間交叉參照的唯一金鑰[^1]。 |

### **中繼資料（`.meta`）檔案與全域識別碼 GUID 的重要性**

當系統必須處理獨立檔案之間的跨檔案連結參照時，真正的複雜度便隨之浮現。在參照位於單一 YAML 檔案作用域之外的物件時，本機 File ID 將變得毫無價值，因為它在專案數以千計的不同檔案之間極可能自然發生重複[^2]。為了建構一套完整的資料庫，Unity 需要一個專屬的輔助識別碼，能夠在整個系統尺度上精準鎖定完整的目標檔案。這正是 **Global Unique Identifier（GUID）** 發揮作用的舞台。

每當 Unity Editor 偵測到有新的資源檔案透過匯入（import）、新建或複製首次進入專案時，系統便會自動產生一個伴隨的中繼資料檔案。該中繼資料檔案與原檔案同名，並加上 `.meta` 副檔名[^1]。`.meta` 檔案扮演著資源「身分證」的角色，內含匯入設定資訊（Import Settings），以及最關鍵的 `guid` 屬性。這項屬性是一個由 32 個十六進位（hexadecimal）字元構成的唯一雜湊字串，例如 `8c9c1e4a88e724a60a9ac0b0bb6a52c31`。

當遊戲中的某個物件需要參照另一項資源時，YAML 序列化語法會透過一套特定的關聯陣列語法將這兩個識別碼結合起來：`{fileID: X, guid: Y, type: Z}`[^2]。在這項結構中，`fileID` 參數用來定位隱藏於目標檔案內部的特定物件；`guid` 參數提供直接指向目標資源 `.meta` 檔案的 32 位元字串；而 `type` 參數則向 `AssetDatabase` 系統指明搜尋資源的方式[^4]。一般而言，`type: 2` 用於未包含於原始碼中的外部參照資源，而 `type: 3` 通常代表屬於內部原始碼腳本的資源[^4]。

正是拜這種分離式儲存機制所賜，開發工程師得以在作業系統層級自由重新命名檔案、將檔案搬移至不同資料夾，而不致破壞專案的邏輯結構。Unity `AssetDatabase` 系統總是在幕後默默掃描 `.meta` 檔案來維護 GUID 對照表，而非仰賴脆弱易斷的相對檔案路徑[^1]。然而，對 GUID 的絕對依賴，卻也正是 Long Gil Studio 陷入難題的起源。

## **除錯編年史：Long Gil Studio 的解方追尋之旅**

將單一功能區塊拆分為兩個獨立實體的過程，起初看似僅是一場單純的檔案管理作業。然而，當 Long Gil Studio 開發團隊實際動手執行時，卻迅速墜入一連串攸關 Unity 圖形資料完整性的複雜問題網之中。這段歷程宛如一連串的試誤（trial-and-error）紀錄，從最直覺的手法一路推進至深層的系統級程式設計方案。

### **第一階段：檔案重新命名（Renaming）與直接複製手法的無力**

工程團隊最初的直覺反應，是在 Unity Editor 介面中直接將 `Feature_A` 資料夾複製（duplicate）為 `Feature_B` 資料夾，旨在建立一塊獨立的實體資料。然而，「交叉參照回舊來源」的現象隨即出現[^10]。

在 Editor 中進行複製時，Unity 明白同一個專案內的兩項資源無法共用同一組 GUID。系統會自動介入，為 `Feature_B` 資料夾中的每個檔案產生內含全新隨機 GUID 的 `.meta` 檔案[^1]。雖然這確保了資料庫的合法性，卻釀成了一場邏輯災難：剛被複製出來的 Prefab 或 `ScriptableObject` 檔案內部的文字內容（YAML）完全未經 Unity 重新編譯或修改。也就是說，在 `Feature_B/UI_Window.prefab` 檔案內，儲存著原始碼腳本參照的 YAML 區段依然靜態維持在 `{fileID: 11500000, guid: [GUID_OF_OLD_FILE_IN_FEATURE_A]}`[^10]。

導致的後果是，儘管新資料夾已經建立，新開發分支裡的所有介面元件、Prefab 與變數在實體上依然連結著原分支的 `.cs` 原始碼檔案。透過 Inspector 面板對新 Prefab 所做的任何參數更動，都有可能反向覆寫舊控制類別的邏輯，製造出嚴重的迴歸風險（regression risk）。Long Gil Studio 團隊曾嘗試透過重新命名新資料夾內的原始碼檔案與資源檔案來化解問題。然而，重新命名作業僅能改變使用者介面上顯示的字串以及磁碟上的實體檔名，對 `.meta` 檔案內部的 GUID 雜湊碼與 YAML 設定檔中的參照字串毫無影響[^5]。由於 Unity 的資料庫對檔名完全免疫，重新命名方法因無法產生任何連結分離效果而遭到立即淘汰。

### **第二階段：重新建立與手動重新指派連結（Manual Re-linking）的危機**

在重新命名宣告失敗後，團隊轉向了一種手動且成本更為高昂的做法：建立全新的檔案並以人工重新指派整個連結圖。程式設計師必須逐一開啟新建的每個 Prefab 或 `ScriptableObject` 檔案，移除連結失效或仍指向舊分支的元件（Component），加入新的元件，接著再將每一筆圖像與音訊資源逐一拖曳放置到 Inspector 面板上正確的參照欄位中。

對於小型原型專案來說，這種作法或許尚能接受。但對於 GilongWorld 專案中動輒由數十甚至數百個檔案透過 **Nested Prefabs** 架構層層嵌套而成的複雜功能而言，相依性圖表（dependency graph）變得過於龐大，完全超出人力管理範圍。在 UI 介面、`ScriptableObject` 設定物件與動畫控制器（Animation Controller）之間重新指派成千上萬筆交叉參照，耗費了數週的工作時數。

此方法最大的後遺症在於人為疏失（human error）因素[^1]。工程師們不斷面臨連結重疊、遺漏參照，或誤將名稱完全相同但工作區不同的腳本指派錯位的窘境。混雜在數千行屬性之間的單一遺漏參照，也許能順利通過靜態編譯檢查，卻會在專案建置並於執行時期（Runtime）模式運作時，引發 `NullReferenceException` 類型的嚴重系統錯誤。時間上的高度消耗與產品品質的滑落，迫使 Long Gil Studio 必須往更底層尋找自動化解決方案。

### **第三階段：作業系統層級複製（OS-Level Cloning）引發的干擾**

另一派意見則提議改透過作業系統的檔案管理員（Windows 檔案總管或 macOS Finder）來複製資料夾，而非在 Unity Editor 內複製，企圖藉由製造實體複本來「瞞騙」Unity。當在外部執行複製時，內容檔案與內含 GUID 的 `.meta` 檔案都會被一模一樣地複製一份[^3]。

然而，當切換回 Unity Editor 時，卻冒出了一個名為 **識別碼衝突（GUID collision）** 的新問題。`AssetDatabase` 系統偵測到共有同一組 GUID 的兩個檔案同時並存。Unity 的內部衝突處理機制通常會走向兩種結局之一：系統要嘛拒絕載入其中一個檔案，要嘛在完全不通知使用者的情況下，悄悄地以一組全新的隨機字串覆寫其中一個檔案的 GUID——更棘手的是，它並不會更新任何 YAML 參照[^9]。實務報告指出，當面對基於同一套共用結構的多個專案時，即使檔名不同，Unity 也無法分辨具備相同 GUID 之資源間的差異，進而導致 Unity 任意將參照綁定到錯誤的資源上[^1]。這種方法帶來的危險性甚至高過手動重新指派連結。

## **技術突破：不遺失參照的 GUID 重新產生方案**

在常規操作走投無路後，Long Gil Studio 體認到問題的核心並不在於實體檔案的複製，而在於資料的同步運算。團隊需要一套能夠一致且批次更新整個新資料夾 YAML 檔案網路中所有 GUID 識別字串的方法。在研究與探索 Unity 工程社群開源工具組的過程中，團隊發掘並成功套用了本機 **GUID 重新產生（GUID Regeneration）** 技術[^1]。

這項技術是對專案源頭文字結構的直接介入。它不再聽任 Unity Editor 按照預設演算法被動處理複製，而是透過一支自訂的 Editor Script（C#）工具對系統進行掃描與處理。該工具會讀取新功能分支資料夾中的所有 `.meta` 檔案，產生一套全新的 GUID，在記憶體中建立一張舊 GUID 與新 GUID 之間的對照表（mapping table），接著走訪所有設定檔的完整文字內容，精準替換這些字串。

### **深度剖析 Long Gil Studio 的 GUID 重新產生演算法**

立基於經過驗證的開源演算法基礎（如 jeffjadulco、ZimM-LostPolygon 與 rrazgriz 的腳本[^1]），工程團隊打造了一套涵蓋繁複資料處理階段的嚴謹執行流程。

#### **步驟 1：初始化資源編輯狀態（Asset Editing State）**

在瞬間更動數千個文字檔案會觸發 Unity 的自動重新編譯（auto-refresh）機制，導致系統凍結或引發記憶體溢位。因此，演算法起手便呼叫 `AssetDatabase.StartAssetEditing()` API 方法，暫時停用 Unity 的檔案系統監控行程[^7]。此舉會使 `AssetDatabase` 進入暫時休眠狀態，讓硬碟上的批次 I/O 指令得以暢行無阻地執行。同一時間，系統會設定一組有效副檔名篩選器（`kDefaultFileExtensions`），規範需要納入解析的格式，包含 `*.meta`、`*.mat`、`*.anim`、`*.prefab`、`*.unity`、`*.asset`、`*.guiskin`、`*.fontsettings` 以及 `*.controller`[^7]。

#### **步驟 2：遞迴掃描並擷取目標 GUID 集合**

系統透過蒐集使用者在 Project 視窗中所選取區域內的 GUID 清單（`Selection.assetGUIDs`）來界定影響範圍。演算法會遞迴走訪所有子目錄，並透過 `AssetDatabase.AssetPathToGUID(file)` 函式將檔案路徑反向對應成實體 GUID。此步驟的細膩之處在於，演算法刻意將起始的 `.meta` 檔案從直接選取清單中排除（`Path.GetExtension(...) != ".meta"`），藉此建立僅包含原始內容資源的 `guidsToRegenerate` 清單[^8]。

#### **步驟 3：語法解析與連結圖識別**

耗費最多運算資源的階段是對整體文字結構的線性掃描。針對清單中的每個檔案，系統都會透過 `File.ReadAllText(filePath)` 方法開啟並讀取完整字串內容[^7]。考量到正規表示式（Regex）在大型文字區塊上的效能限制，語法解析（parsing）技術並未採用 Regex，而是改採循序搜尋長度為 6 個字元的常數字串 `"guid: "`[^7]。

每當偵測到一筆參照格式，演算法便會擷取緊接在後的整整 32 個字元。緊接著，安全驗證層 `IsGuid(string text)` 即會啟動。該驗證層會執行一個迴圈，確認這 32 個字元是否嚴格遵守十六進位規則（範圍介於 `'0'` 至 `'9'` 以及 `'a'` 至 `'f'` 之間）[^7]。這道嚴密查核排除了演算法意外覆寫 C# 原始碼中的隨機字串，或圖形系統中恰巧同樣為 32 字元長度之加密雜湊資料的風險。

#### **步驟 4：建構雙重對照字典（Dual Mapping Dictionary）**

為確保覆寫過程不致損壞 Unity 的核心資源，系統在 RAM 記憶體中建立了三項關鍵資料結構[^7]：

1. **`ownGuids` 集合（內部資源）：** 演算法會辨識任一 `.meta` 檔案中所出現的第一組 GUID，並將其存入一個 `HashSet` 結構內。Unity 的基本原則是 `.meta` 檔案中的第一組 GUID 永遠代表該資源本身。這項集合宛如一道防火牆，協助系統區分哪些是當前處理資料夾內的資源，哪些屬於外部資源（例如 Unity Engine 預設的 `Standard.mat` 材質）[^7]。
2. **`guidOldToNewMap` 字典（替換字串對應）：** 針對所偵測到的每一組唯一舊 GUID，系統會透過標準函式庫方法 `Guid.NewGuid().ToString("N")` 產生一組全新的 UUID 字串[^7]。UUID 第 4 版（v4）產生演算法確保字串不含連字號，且具備趨近於零的碰撞機率（collision probability），在資料層面提供絕對的安全保障。
3. **`guidsInFileMap` 字典（分佈對照表）：** 一份將檔案路徑（File Path）對應至該檔案內部所呼叫之舊 GUID 陣列的字典。此結構透過直接指示系統應開啟哪個檔案以及應替換哪段字串，大幅最佳化了覆寫階段的效能。

#### **步驟 5：同步覆寫與狀態恢復**

在最後一個迴圈裡，系統會依序開啟 `guidsInFileMap` 所指定的每個檔案，並套用雙重交叉審查條件：正在審查的舊 GUID 必須存在於內部資源集合（`ownGuids`）之中，**且**必須位於使用者要求重新產生的資源清單（`guidsToRegenerate`）之內[^8]。這條安全準則是整套解方的骨幹，徹底防止誤改 Engine Assets 或意外更動共用函式庫識別碼的情況。

通過審查後，便會執行字串替換指令 `contents = contents.Replace("guid: " + oldGuid, "guid: " + newGuid)`[^7]。系統接著透過 `File.WriteAllText` 將新的文字字串寫回磁碟。當所有檔案皆處理完畢後，隨即呼叫 `AssetDatabase.StopAssetEditing()` 旗標喚醒 Unity 的監控系統，並緊接著呼叫 `AssetDatabase.Refresh()` 函式，以全新的 GUID 架構重新編譯整個專案[^7]。

Long Gil Studio 藉由這套演算法所達成的成就，是以檔案層級的絕對獨立性完整複製整套功能系統的能力。工程師得以在「分支 B」上修改 Prefab、更動原始碼並重新調整參數，而不會對「分支 A」造成任何波瀾。分支 B 的交叉連結網路如今僅透過一套完全獨立的新識別碼維持內部通訊，毫無技術瑕疵地徹底滿足了最初的功能拆分需求。

## **Unity 生態系中替代方案的全面評估**

雖然透過自訂程式碼重新產生 GUID 已徹底解決了 Long Gil Studio 的深度客製化需求，Unity 生態系依然提供了一系列旨在管理資源重複與功能分支的設計架構。為了建立對系統架構的宏觀視野，研究過程中針對下列替代方案進行了分析，以評估它們在面對大規模分支需求時的相容性與極限。

### **5.1 繼承方案：Prefab Variants 架構**

於 Unity 2018.3 版本推出的 **Prefab Variants** 功能，在取代傳統 Prefab 系統以管理物件架構方面邁出了重要一步[^17]。Prefab Variant 的核心機制並非建立一個全新的獨立複本，而是作為一個直接連結至原始 Prefab（Base Prefab）的覆寫層（override layer）來運作[^17]。

使用 Variant 時，程式設計師可以修改屬性、材質設定或增減元件（component），而這些異動僅會以「覆寫」中繼資料（override metadata）的形式儲存於 Variant 檔案上[^20]。與此同時，一旦 Base Prefab 更新了核心屬性，這些變更將會自動傳播（propagate）至所有尚未覆寫該屬性的子 Variant 中[^22]。

下方的比較分析表釐清了這兩種架構哲學在面對功能分支難題時的差異：

| 評估標準 | GUID 重新產生法（深度分支 - Deep Fork） | Prefab Variants 方法（相對繼承） |
| :--- | :--- | :--- |
| **儲存本質** | 在 YAML 檔案層級維持完全獨立的資料複本。 | 基於原始範本儲存差異資料（delta overrides）[^17]。 |
| **相依程度** | 第 0 級（與來源端不再存有任何結構性連結）。 | 高（相依於 Base Prefab 的節點架構）[^18]。 |
| **原始碼（Script）分離** | 允許分叉並重寫兩套完全獨立的原始碼。 | 不支援；Variant 必須運作在同一套 Base 腳本之上。 |
| **結構變更能力** | 可自由刪除、新增或重塑整個階層架構（Hierarchy）。 | 受限。無法刪除由 Base Prefab 所定義的核心 GameObject[^22]。 |
| **系統迴歸風險** | 因具備絕對隔離，風險趨近於零。 | 高。修復錯誤或調整來源端可能會意外破壞 Variant 分支的功能行為[^18]。 |

**針對 GilongWorld 專案的結論：** 儘管 Prefab Variant 在創造遊戲玩法變體上表現卓越（例如從紅色敵人衍生出不同血量的藍色敵人）[^20]，面對以「專屬客製化」（customization）為目的之分支需求時卻完全派不上用場。Long Gil Studio 的專案需要連同 C# 原始碼腳本一併分離，這是 Variant 架構無法支援的，因為它只能覆寫公開變數，而無法改為指向一套全新的邏輯處理器[^18]。圖表節點之間的高度相依性，使 Prefab Variant 成為一種與本次難題所訴求的獨立模組化設計理念背道而馳的作法。

### **5.2 獨立套件架構：Unity Package Manager (UPM) 與 Local Packages**

另一種在更宏觀層面降低參照衝突的方法，是應用 **Unity Package Manager (UPM)** 來建構多套件架構[^25]。此架構模型將元件或功能轉化為各自獨立的開發套件（development packages），透過 `package.json` 檔案進行組態設定，並藉由組件定義檔（`.asmdef`）管理編譯邊界[^26]。

在分支情境下，共用系統可被架構為一個 Core Package，而功能 A 與功能 B 則以獨立套件形式運作，共同取用共享的 API 函式。Unity 支援透過系統符號連結（symlink）嵌入本地資料套件（**Local Package**），讓原始碼資料夾在磁碟上以一個與主專案 `Assets` 資料夾完全分離的 Git 儲存庫形式存在[^27]。當透過 UPM 進行組態時，GUID 重複現象或本機環境衝突將交由 Unity 的套件管理員處理，而非單純仰賴傳統的 `AssetDatabase`[^28]。

然而，導入此架構需要耗費極為龐大的前期分析與重構（refactoring）時間。它在隔離 C# 原始碼與靜態函式庫方面運作得完美無瑕，但在處理大量複製高度依賴 YAML 檔案的 Prefab 與 UI 介面問題上卻顯得效率不彰。因此，針對像 Long Gil Studio 這樣急需即時拆分的實務需求，此方案所帶來的維運額外負擔（overhead）與短期成果並不相稱。

### **5.3 記憶體膨脹隱憂：Addressables 系統與共用檔案**

任何針對 GUID 系統的深層介入，皆要求系統工程師評估其對動態記憶體管理與資源分發機制帶來的衝擊，特別是在專案整合了 **Addressable Asset System** 的情況下。Addressables 扮演著新世代資源管理框架的角色，藉由動態路徑的非同步載入（asynchronous load）機制來取代硬式參照[^30]。

在採用 GUID 重新產生技術時，曾有一項經紀錄的架構風險：若重新產生過程將一個龐大的功能區塊拆分為兩個獨立區塊，則該資料夾結構中所有關聯的資源（例如高解析度 Texture 或音訊檔案）也都會被指派一組新的 GUID[^30]。雖然就作業系統的角度來看，這兩份 Texture 檔案承載著相同的影像內容，Addressables 的封裝系統（packing system）卻會因其擁有兩組不同的識別碼而將它們視為兩個完全獨立的資料實體[^13]。

當觸發 Content Build 編譯流程時，Unity 會將第一份複本壓縮封裝進功能 A 的 AssetBundle，並將第二份複本壓縮封裝進功能 B 的 AssetBundle。這種重複封裝會引發**記憶體膨脹（memory bloat）**現象，不僅拉高遊戲的下載檔案大小，更會在應用程式執行期間（runtime）浪費龐大的 RAM 記憶體[^13]。為了化解這項風險，架構師團隊必須規劃出一塊「共用」儲存區（**Shared Resources**）。在執行 GUID 重新產生指令之前，所有不具程式邏輯性質的視覺與媒體資源都必須先移出處理區域。這些視覺資源的 `.meta` 檔案必須受到完整保護，確保在複製流程過後，新舊兩條組態分支皆指向同一組單一的共用素材 GUID，以維持系統資源管理上的經濟效益。

## **GilongWorld 專案的建議與經驗教訓**

解決 Long Gil Studio 的參照斷裂難題，不僅止於尋得一支最佳化腳本，更實證了透徹理解 Unity Engine 使用者介面底下隱藏協定層的重要性。YAML 格式的資料連結網路是所有物件互動系統的根基，而 GUID 中繼資料正是維繫這張網路的唯一語言[^1]。

藉由建立全新識別碼架構來直接介入的作法（**GUID Regeneration**），破除了將作業系統檔案管理思維套用在 `AssetDatabase` 這類物件導向資料庫上的迷思[^1]。由文字解析、識別碼擷取、記憶體區域控管與內部覆寫組成的五步驟演算法流程確保了百分之百的準確率，成功免除了長年困擾程式設計師的邏輯圖斷裂意外。

基於對本次事件的復盤分析，大型遊戲軟體架構師在執行複雜的複製與分支作業時，務必維持一套標準化的工作流程。在磁碟上執行大範圍操作指令前建立版本控制備份系統（version control backup），是避免不可逆資料遺失的最高準則[^7]。與此同時，開發人員亦須謹慎防範因重新命名命名空間（namespace renaming）過程而無意間更動 C# 原始碼檔案（`.cs`）內部的 File ID，因為這將會直接破壞顯示組態與執行腳本之間的底層綁定[^4]。

Long Gil Studio 在發掘並成功套用 GUID 重新產生方案上的突破，不僅將 GilongWorld 專案的開發資源從數千小時的手動組態作業中釋放出來，更建立了穩固的技術基礎——讓系統得以在未來保持彈性的客製化空間，迅速回應各種設計分歧需求，而不需以核心架構的穩定性作為交換代價。

## **參考文獻**

[^1]: GUID Regenerator (com.jeffjadulco.guidregenerator) | OpenUPM Unity Package, [https://openupm.com/packages/com.jeffjadulco.guidregenerator/](https://openupm.com/packages/com.jeffjadulco.guidregenerator/)  
[^2]: Understanding Unity's serialization language, YAML, [https://unity.com/blog/engine-platform/understanding-unitys-serialization-language-yaml](https://unity.com/blog/engine-platform/understanding-unitys-serialization-language-yaml)  
[^3]: How to move or copy a Unity project (without breaking it) - Game Dev Beginner, [https://gamedevbeginner.com/how-to-move-or-copy-a-unity-project-without-breaking-it/](https://gamedevbeginner.com/how-to-move-or-copy-a-unity-project-without-breaking-it/)  
[^4]: Unity fileID and GUID - Unity Discussions, [https://discussions.unity.com/t/unity-fileid-and-guid/837621](https://discussions.unity.com/t/unity-fileid-and-guid/837621)  
[^5]: Question about m_Script in YAML Unity prefab format, [https://discussions.unity.com/t/question-about-m_script-in-yaml-unity-prefab-format/469197](https://discussions.unity.com/t/question-about-m_script-in-yaml-unity-prefab-format/469197)  
[^6]: YAML fileID hash function for DLL scripts - Unity Discussions, [https://discussions.unity.com/t/yaml-fileid-hash-function-for-dll-scripts/541112](https://discussions.unity.com/t/yaml-fileid-hash-function-for-dll-scripts/541112)  
[^7]: Unity asset GUIDs regenerator - GitHub Gist, [https://gist.github.com/ZimM-LostPolygon/7e2f8a3e5a1be183ac19](https://gist.github.com/ZimM-LostPolygon/7e2f8a3e5a1be183ac19)  
[^8]: Generate new GUIDs for Unity editor assets in-place. Tested working on 2019.4.31f1. Use at your peril - GitHub Gist, [https://gist.github.com/rrazgriz/1a5ab38f47a473c3272e1207bab6073f](https://gist.github.com/rrazgriz/1a5ab38f47a473c3272e1207bab6073f)  
[^9]: What is Unity GUID — How to Get & Change GUID — 2026 - Makaka Games, [https://makaka.org/unity-tutorials/guid](https://makaka.org/unity-tutorials/guid)  
[^10]: How can you duplicat folders and not share old dependencies? : r/Unity3D - Reddit, [https://www.reddit.com/r/Unity3D/comments/2jn4wk/how_can_you_duplicat_folders_and_not_share_old/](https://www.reddit.com/r/Unity3D/comments/2jn4wk/how_can_you_duplicat_folders_and_not_share_old/)  
[^11]: How can you duplicat folders and not share old dependencies? - Unity Discussions, [https://discussions.unity.com/t/how-can-you-duplicat-folders-and-not-share-old-dependencies/119815](https://discussions.unity.com/t/how-can-you-duplicat-folders-and-not-share-old-dependencies/119815)  
[^12]: jeffjadulco/unity-guid-regenerator: :id - GitHub, [https://github.com/jeffjadulco/unity-guid-regenerator](https://github.com/jeffjadulco/unity-guid-regenerator)  
[^13]: Resources folder and asset loading etiquette - Unity Discussions, [https://discussions.unity.com/t/resources-folder-and-asset-loading-etiquette/593210](https://discussions.unity.com/t/resources-folder-and-asset-loading-etiquette/593210)  
[^14]: How to make references point to the imported asset with new GUID? - Unity Discussions, [https://discussions.unity.com/t/how-to-make-references-point-to-the-imported-asset-with-new-guid/840444](https://discussions.unity.com/t/how-to-make-references-point-to-the-imported-asset-with-new-guid/840444)  
[^15]: I made a tool to regenerate GUID for Unity assets : r/Unity3D, [https://www.reddit.com/r/Unity3D/comments/gex8q5/i_made_a_tool_to_regenerate_guid_for_unity_assets/](https://www.reddit.com/r/Unity3D/comments/gex8q5/i_made_a_tool_to_regenerate_guid_for_unity_assets/)  
[^16]: Sudden "Assembly has duplicate references" on ALL imported assets - Unity Discussions, [https://discussions.unity.com/t/sudden-assembly-has-duplicate-references-on-all-imported-assets/1710510](https://discussions.unity.com/t/sudden-assembly-has-duplicate-references-on-all-imported-assets/1710510)  
[^17]: Create variations of prefabs - Unity - Manual, [https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabVariants.html](https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabVariants.html)  
[^18]: What is the difference between prefab(original) and variant prefab? - Stack Overflow, [https://stackoverflow.com/questions/58299669/what-is-the-difference-between-prefaboriginal-and-variant-prefab](https://stackoverflow.com/questions/58299669/what-is-the-difference-between-prefaboriginal-and-variant-prefab)  
[^19]: Ultimate Guide on Nested Prefab Workflows in Unity | Visual Design Cafe, [https://visualdesigncafe.com/learn/nested-prefabs](https://visualdesigncafe.com/learn/nested-prefabs)  
[^20]: Can someone explain the use case for Prefab variants - Unity Engine, [https://discussions.unity.com/t/can-someone-explain-the-use-case-for-prefab-variants/715072](https://discussions.unity.com/t/can-someone-explain-the-use-case-for-prefab-variants/715072)  
[^21]: Override prefab instances - Unity - Manual, [https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabInstanceOverrides.html](https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabInstanceOverrides.html)  
[^22]: Unity Tips | Part 6 - Prefabs - Daniel Ilett, [https://danielilett.com/2020-05-16-unity-tips-6-prefabs/](https://danielilett.com/2020-05-16-unity-tips-6-prefabs/)  
[^23]: What's the incentive on using prefab variants compared to just duplicating the original prefab? : r/Unity3D - Reddit, [https://www.reddit.com/r/Unity3D/comments/p2g10m/whats_the_incentive_on_using_prefab_variants/](https://www.reddit.com/r/Unity3D/comments/p2g10m/whats_the_incentive_on_using_prefab_variants/)  
[^24]: Is it better to make multiple prefabs or a single configurable prefab? : r/unity - Reddit, [https://www.reddit.com/r/unity/comments/1iu88js/is_it_better_to_make_multiple_prefabs_or_a_single/](https://www.reddit.com/r/unity/comments/1iu88js/is_it_better_to_make_multiple_prefabs_or_a_single/)  
[^25]: Package Development | 0.5.3-exp.1 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.upm.develop@0.5/manual/index.html](https://docs.unity3d.com/Packages/com.unity.upm.develop@0.5/manual/index.html)  
[^26]: Package development workflow - Unity - Manual, [https://docs.unity3d.com/6000.4/Documentation/Manual/CustomPackages.html](https://docs.unity3d.com/6000.4/Documentation/Manual/CustomPackages.html)  
[^27]: Switching between Local and Remote packages in Unity - Jakub Slaby, [https://www.jakubslaby.com/switching-between-local-and-remote-packages-in-unity/](https://www.jakubslaby.com/switching-between-local-and-remote-packages-in-unity/)  
[^28]: Confusion About How to Create a Custom Package - Unity Discussions, [https://discussions.unity.com/t/confusion-about-how-to-create-a-custom-package/739817](https://discussions.unity.com/t/confusion-about-how-to-create-a-custom-package/739817)  
[^29]: Best practices for parallel application + package development workflow - Unity Discussions, [https://discussions.unity.com/t/best-practices-for-parallel-application-package-development-workflow/900302](https://discussions.unity.com/t/best-practices-for-parallel-application-package-development-workflow/900302)  
[^30]: Asset dependencies overview | Addressables | 2.2.2 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@2.2//manual/AssetDependencies.html](https://docs.unity3d.com/Packages/com.unity.addressables@2.2//manual/AssetDependencies.html)  
[^31]: How to handle Addressable duplication for hybrid Scene Objects/Asset reference patterns, [https://discussions.unity.com/t/how-to-handle-addressable-duplication-for-hybrid-scene-objects-asset-reference-patterns/1704264](https://discussions.unity.com/t/how-to-handle-addressable-duplication-for-hybrid-scene-objects-asset-reference-patterns/1704264)
