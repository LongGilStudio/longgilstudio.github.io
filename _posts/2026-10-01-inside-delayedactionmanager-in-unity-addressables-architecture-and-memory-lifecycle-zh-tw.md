---
title: "深度技術研究報告：Unity Addressables 環境中 DelayedActionManager 的運作機制、系統架構與影響分析"
date: 2026-10-01 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, addressables, memory-management, async, delayedactionmanager, optimization]
description: 深入剖析 Unity Addressables 中 DelayedActionManager 的 ComponentSingleton 架構、LateUpdate 執行機制、C#/C++ 代理例外處理及 AssetBundle 記憶體最佳化策略。
lang: zh-TW
translation_id: unity-addressables-delayedactionmanager
---

Addressable Asset System（簡稱 Addressables）代表了 Unity 架構上一項劃時代的演進，建立於傳統 AssetBundles 基礎之上，提供一套彈性、強大且經過最佳化的內容管理解決方案[^1]。在設計與維運大型遊戲或互動式應用程式的過程中，管理非同步資料管線以自動載入並釋放資源是一項基本需求。在肩負這項複雜任務的核心元件之中，有一個在軟體工程師檢視階層視窗（Hierarchy）時常感到困惑的自動生成物件，正是安靜棲身於 `DontDestroyOnLoad` 場景內的 `DelayedActionManager`[^2]。

本技術報告將深入解構 `DelayedActionManager` 的整體架構本質，說明它存在於 `DontDestroyOnLoad` 空間的原因，分析其在 Unity 即時迴圈內部的執行機制，同時剖析與記憶體管理、記憶體洩漏（memory leaks）以及常見執行緒與生命週期例外狀況（exceptions）相關的挑戰。透過分析系統設計資料與最佳實務，本文件致力於提供深刻見解，協助軟體架構師最佳化應用程式的穩定性。

## 資源載入系統的演進與非同步基礎

在深入探討 `DelayedActionManager` 的微觀結構之前，理解 Addressables 系統誕生的背景是必要前提。在早期版本的 Unity 中，開發者通常依賴 `Resources` 資料夾，或是直接使用原始的 AssetBundle 腳本[^4]。`Resources.Load()` 機制的運作方式猶如使用者親自走進倉庫找貨：必須提供精確的目錄路徑，且主執行緒（main thread）被迫凍結（block），直到找到資源並載入記憶體為止[^4]。這種作法的缺點在於阻礙了應用程式的擴展性，並在處理大量資料時引發嚴重的影格率下降（FPS drop）。

為了解決這項難題，Addressables 就像一項現代化的物流服務。開發者只需提供資源的識別碼（address/key），系統便會自動路由，判斷是要從本機儲存空間（Local）尋找資源，還是從內容傳遞網路（CDN - Content Delivery Network）伺服器下載[^4]。最重要的是，這整個週期皆以非同步（asynchronous）方式執行。載入資源的指令（典型如 `Addressables.LoadAssetAsync`）不會立即回傳物件，而是回傳一個名為 `AsyncOperationHandle` 的導向控點（handle）[^4]。該介面在資源就緒時提供回呼（callback）機制，讓應用程式的主執行緒能持續不中斷地處理物理運算與圖形算繪邏輯[^4]。

從完全同步模式轉向完全非同步模式，隨之帶來了一項重大的架構挑戰：當資源下載流程因網路頻寬較慢而耗費數秒才完成時，應用程式可能早已切換到一個截然不同的場景（scene）[^1]。管理回呼函式（callbacks）、工作佇列（command queues）以及參考計數（reference counting），需要一個不受常規場景建立與銷毀生命週期影響的中央管理實體。這正是 Unity 開發者將 `DontDestroyOnLoad` 場景模型整合至 Addressables 核心的原因。

## DontDestroyOnLoad（DDOL）場景與全域持久化架構

在 Unity 環境中，載入新場景的操作（透過預設 Single 模式的 `SceneManager.LoadScene`）會自動觸發記憶體清理機制。引擎會銷毀（destroy）屬於上一個場景的所有 `GameObject` 與 `Component`，以確保釋放不再使用的資源[^7]。雖然附加場景載入（Additive scenes）功能允許同時維持多個啟用中的場景來管理全域狀態（例如一個專用於 Game Manager 的場景與另一個用於關卡 Level 的場景），但 `DontDestroyOnLoad`（DDOL）機制依然是保護底層物件的重要系統技術[^7]。

在 Unity 編輯器介面按下 Play 鍵時，階層視窗中出現 `DontDestroyOnLoad` 場景並非錯誤，而是引擎預設的隱藏機制，用來歸納標記為切換場景時不被銷毀的物件[^9]。為了讓一個 `GameObject` 獲准進入這個安全區，Unity 制定了一項強制規則：該物件必須位於場景的根階層（root level）[^8]。任何試圖對子物件（nested object）呼叫 `DontDestroyOnLoad(gameObject)` 函式的嘗試都會失敗，並記錄一則警告[^8]。

對於 Addressables 系統而言，資源載入與釋放流程是生命週期橫跨多個不同場景的操作。舉例來說，追蹤從遠端伺服器下載 AssetBundle 的狀態，不可能只因為玩家剛穿過一道切換關卡的門就半途取消。將 `RuntimeInitializeOnLoadMethod` 機制結合進階單例（Singleton）設計模式，使 Addressables 原始碼能在應用程式啟動時自動建立一個根物件，並將其放入 DDOL 場景之中[^2]。這說明了為何即使開發者未曾撰寫任何與 DDOL 相關的程式碼，一個名為 `DelayedActionManager` 的物件仍會自動出現在場景清單的左下角[^2]。

## DelayedActionManager 的內部結構與技術角色

深入研究 Addressables 套件的原始碼與 API 文件後可發現，`DelayedActionManager` 是位於 `UnityEngine.ResourceManagement.Util` 命名空間中的具體類別（concrete class）[^11]。它的結構並非單純的靜態公用類別（static utility class），而是透過繼承基礎架構、直接掛載於 `GameObject` 上的元件（Component）[^12]。

### ComponentSingleton 模式與初始化自動化

`DelayedActionManager` 的架構建立在 `ComponentSingleton` 設計模式之上，這是在同一命名空間內定義的基礎類別[^13]。在元件（Component）而非純 C# 類別上採用單例模式，賦予了系統直接與 Unity 即時事件迴圈（`PlayerLoop`）互動的能力。

當 `ResourceManager` 系統首次收到載入或狀態更新請求（例如 `Addressables.LoadAssetAsync` 或網路診斷操作）時，它會呼叫 `DelayedActionManager` 執行個體。此時，`ComponentSingleton` 模式會自動執行一套隱藏流程：建立一個空的 `GameObject`，命名為 `"DelayedActionManager"`，將對應腳本掛載至該物件，並立即呼叫 `DontDestroyOnLoad` 函式將其納入全域保護空間[^2]。這種延遲初始化（lazy initialization）設計確保了唯有在真正需要延遲工作管理功能時才會消耗系統資源，也解答了開發者對於該物件為何會「神奇地」出現在介面上的常見疑問[^3]。

### 排程機制與 LateUpdate 階段剖析

`DelayedActionManager` 的核心任務，是擔任延遲動作、回呼函式（callbacks）、協程（coroutine）以及微觀層級記憶體管理的中央排程器（central scheduler）[^11]。其架構中一個細微卻極為關鍵的差異，在於所有佇列處理邏輯都會被導向至 Unity 生命週期的 `LateUpdate()` 函式內部執行[^11]。

選擇 `LateUpdate` 而非傳統的 `Update`，解決了一項攸關資料一致性的深層架構問題。下表說明了 Unity 的執行順序，以及 `LateUpdate` 階段在保護 Addressables 資料方面所扮演的角色：

| 執行階段（PlayerLoop） | 典型職責 | 對 Addressables 與 DelayedActionManager 的角色 |
| :--- | :--- | :--- |
| **FixedUpdate** | 處理物理模擬、靜態／動態碰撞。 | 遊戲邏輯可能會在碰撞發生後觸發物件銷毀請求。 |
| **Update** | 玩家輸入（Input）、移動、AI 邏輯、遊戲狀態更新。 | 手動呼叫 `Addressables.LoadAssetAsync` 或 `Release`。`GameObject` 可能於此處被 `Destroy()`。 |
| **LateUpdate** | 更新攝影機位置、後製處理（post-processing）調整。 | `DelayedActionManager` 清理記憶體、更新參考計數變數並呼叫非同步回呼，以確保不與 `Update` 階段的銷毀指令發生衝突[^11]。 |

如果 `ResourceManager` 在 `Update` 階段中途立即執行工作完成回呼，將極可能與正處於中間狀態、尚未完成當下影格運算的系統（例如圖形或使用者介面系統）產生互動衝突。透過將 `OnComplete` 函式的呼叫或參考計數的遞減（ref-count decrements）延遲（delaying）至 `LateUpdate()`，`DelayedActionManager` 確保了目前影格的整體邏輯狀態已趨於穩定[^11]。從大量堆疊追蹤（stack traces）錯誤報告蒐集到的資料顯示，`UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` 函式正是控制權交還給使用者程式碼前的最後一道緩衝[^15]。

## 剖析系統例外狀況（System Exceptions）與堆疊追蹤（Stack Traces）

儘管在設計上具備高度安全性，但非同步機制的複雜度加上開發者不夠嚴謹的生命週期管理操作，仍經常使 `DelayedActionManager` 成為嚴重例外狀況的核心焦點。錯誤日誌為系統如何與受控記憶體（managed memory）及原生記憶體（native memory）互動提供了重要線索。

### NullReferenceException 錯誤與 C# – C++ 代理生命週期衝突

Addressables 環境中一個非常常見的錯誤情境，是源自 `DelayedActionManager` 之 `StartCoroutine_Auto` 函式的 `ArgumentNullException: Value cannot be null. Parameter name: obj` 例外狀況[^19]。此錯誤並非 Unity 內部的故障，而是源於 C# 的垃圾回收機制（Garbage Collector）與底層 C++ 原始碼的原生指標管理之間的不一致性[^19]。

在 Unity 中，諸如 `GameObject` 或 `MonoBehaviour` 等物件本質上是使用 C# 撰寫的代理類別（proxy classes），內部包含一個指向引擎中以 C++ 配置之原生物件的參考指標[^19]。當開發者呼叫 `Destroy(gameObject)` 指令時，C++ 物件會立即遭到銷毀並歸還記憶體空間，使內部參考變成 null[^19]。然而，C# 代理類別本身仍可能在受控記憶體（managed memory）中存在一段時間，直到垃圾回收器掃描並清除為止[^19]。

當開發者將匿名運算式（lambdas/closures，閉包）與 Addressables 的非同步流程結合使用時，災難便會發生。Lambda 運算式具備「擷取」（capture）周遭語境變數的特性。請檢視以下程式碼模式：

```csharp
// 一個加入 DelayedActionManager 佇列中的動作
DelayedAction(null, () => {
    _crawlerRobot.BreakAwayLowerBody();
    if (isLevelLoad) {
        PhysicsUtil.ManualSimulation(2);
    }
});
```

當這段程式碼執行時，變數 `_crawlerRobot`（一個 C# 代理）會被閉包所保留[^19]。若遊戲邏輯就在該影格內銷毀了 `_crawlerRobot`，底層的 C++ 指標便會消失。但由於 `DelayedActionManager` 已排程於 `LateUpdate` 階段（或之後的某個影格）執行此 Lambda，當 Lambda 真正被觸發時，它會試圖存取一個已失效之 C++ 指標上的 `BreakAwayLowerBody()` 成員[^19]。其必然結果便是系統擲回 `NullReferenceException` 例外狀況，或顯示「物件已被銷毀，但您仍嘗試存取它」的錯誤訊息[^19]。

為了排除這項架構風險，軟體專家建議採取兩項設計對策：

1. 在處理底層狀態變更時，避免過度巢狀使用 Lambda 運算式（lambdas nesting）[^19]。
2. 務必執行安全的 null 檢查，善用 Unity 已在 C# 中多載（overloaded）了 `==` 運算子的特性，以直接檢查底層 C++ 指標的狀態[^19]。

### PlayerLoop 衝突與 `"Assertion failed on expression: ShouldRunBehaviour()"` 錯誤

在 Addressables 套件的版本管理過程中，大量開發者回報 Unity 編輯器（Unity Editor）的主控台不斷被一則底層錯誤訊息洗版：`MonoBehaviour.cpp` 檔案中的 `Assertion failed on expression: 'ShouldRunBehaviour()'`[^3]。

堆疊追蹤（stack trace）指出，此程序直接源自位於 `DontDestroyOnLoad` 場景內的 `"DelayedActionManager"` 遊戲物件[^3]。根本原因分析（Root Cause Analysis）揭露了 Unity 編輯器播放模式（Play Mode）處理流程中的一項漏洞。當編輯器經歷一次網域重新載入（Domain Reload），或是當資源載入流程尚未完成、使用者便按下停止（Stop）按鈕時，`DelayedActionManager` 就會作為一個孤立物件（orphaned object）卡在其中[^3]。

由於它被標記為 `DontDestroyOnLoad`，即使 Unity 原生執行環境（`PlayerLoop`）已下令停止執行所有工作，它仍試圖繼續執行 `LateUpdate` 週期與行為檢查（behaviour checks）[^3]。此錯誤在從 Addressables 1.16.x 轉換至 1.18.x 版本的過程中紀錄最為嚴重，迫使許多開發團隊必須手動降版回 1.17.17，以確保同步處理 API 的穩定性並排除佇列卡死狀況[^3]。

### 版本歷史中 DelayedActionManager 的演變與更迭

在研究 Unity Addressables 的 API 文件與變更紀錄（changelogs）時，一個耐人尋味的細節是 `DelayedActionManager` 的週期性存廢。像是 0.7.5 與 1.11.2 等版本曾於更新日誌中明確公告建置腳本介面（build script interface）的重構，並附帶說明：*"Removed DelayedActionManager. Removed ISceneProvider. Users can implement custom scene loading"*[^20]。這項決策最初旨在簡化 API 層，並將控制權移交給可自訂的 `AsyncOperationBase` 類別[^20]。

然而，來自 1.18.15、1.19.19 與 1.21.21 等後 LTS（Long-Term Support，長期支援）版本的錯誤報告，卻揭露了 `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` 在堆疊鏈中的持續回歸[^11]。這反映出 Unity 的迭代式設計（iterative design）哲學：在為了精簡而將其移除後，系統工程師察覺缺少一個集中的延遲工作管理員，會在蒐集診斷事件（`DiagnosticEventCollector`）、處理預先載入表（preload tables）以及確保應用程式關閉時的記憶體安全方面，製造無法克服的困難[^11]。`DelayedActionManager` 經過重新設計後以隱性系統公用程式的身分恢復，不再暴露於公開的使用者介面上，而是負責處理應用程式關閉時的清理（disposal）風險[^20]。

## 參考計數機制與記憶體洩漏動力學

`DelayedActionManager` 的存在與 Addressables 最錯綜複雜的支柱之一密不可分：記憶體管理（Memory Management）。不同於完全仰賴垃圾回收器，Addressables 透過參考計數（Reference Counting）機制來控管資料在記憶體（RAM）中的存續[^23]。

### 參考動態與相依性階層

每當系統收到載入一項資源的請求時，該資源的參考計數便會遞增 1（increment）。使用完畢後，`Addressables.Release` 指令會指示系統遞減此計數（decrement）[^23]。黃金準則是：唯獨當參考計數回到絕對的 0 值時，系統才允許釋放容納該資源的實體記憶體[^23]。

由於 Addressables 透過 AssetBundle 架構來管理相依性，複雜度隨之呈指數級攀升。當載入一項資源（例如一個材質 `Material`）時，系統不僅會載入該材質本身，還會自動載入包含其相依元件（例如貼圖 `Texture`）的所有 AssetBundle[^25]。相依圖（dependency graph）是在 Bundle 層級進行運算的，這意味著若 Bundle A 中的資源參考了 Bundle B 中的資源，整個 Bundle B 都必須載入主機記憶體之中[^26]。

Unity 在此架構中最剛性的技術限制在於：**使用者無法部分卸載（partially unload）一個 AssetBundle 的內容**[^23]。為了說明清楚，假設一個名為 `"stuff"` 的 AssetBundle 內含三項彼此獨立的資源：`樹`、`坦克` 與 `牛`[^23]：

1. 當 `樹` 資源被載入時，效能分析器（Profiler）會顯示 `樹` 具有 1 個參考，同時 `stuff` 封包對應具有 1 個參考[^23]。
2. 當繼續載入 `坦克` 資源時，`坦克` 的計數升為 1，而 `stuff` 的計數上升至 2[^23]。
3. 若遊戲執行 `Release(樹)` 指令，`樹` 的計數降回 0，Profiler 上的藍色長條也會隨之消失[^23]。
4. 然而，`樹` 的實體資料依然留存在系統記憶體中。由於 `坦克` 仍維持著連線，使 `stuff` AssetBundle 的計數大於 0，因此在整個封包完全釋放之前，該封包內的任何資源都不允許被銷毀[^23]。

### 「資源震盪（Asset Churn）」症候群與記憶體膨脹（Memory Bloat）

資源在短時間內接連被載入、釋放，隨即又立刻重新載入的現象，被定義為「Asset Churn」（資源震盪）[^23]。此問題經常出現在關卡（levels）切換的過程中。若第 1 關使用資源 `船` 而第 2 關使用資源 `飛機`（兩者共用同一張 `迷彩` 貼圖）。離開第 1 關時，開發者釋放了 `船`，這會連帶促使 Addressables 立即從記憶體移除 `迷彩` 貼圖。一毫秒過後，當第 2 關生成 `飛機` 時，系統又被迫驅動硬碟執行 I/O 週期，從頭重新載入那張 `迷彩` 貼圖[^23]。這個過程會在影格時間上造成突發尖峰（spikes），並將記憶體推向危險臨界點，在行動裝置硬體上尤其明顯[^27]。

除此之外，遺漏 `Release` 指令會導致垃圾參考不斷累積，使記憶體（RAM）用量僅僅經過幾次場景切換，就從數百 MB 飄移攀升至數 GB 的規模[^28]。由於 `DelayedActionManager` 或 Addressables 本身都不會追蹤以 MonoBehaviour 純粹 `Instantiate` 方法所建立的執行個體（instances）數量，控點追蹤上的任何閃失都會造成永久性的記憶體洩漏[^6]。

### 資料壓縮架構與記憶體配置壓力

AssetBundle 的容量大小與資料壓縮方式，直接影響資料駐留於 RAM 上的方式。選擇何種壓縮方式，決定了 AssetBundle 是會永久佔據龐大的記憶體區塊，還是能發揮頻寬最佳化的能力。

AssetBundle 壓縮演算法特性與儲存影響彙整表[^29]：

| 壓縮演算法 | 本機檔案辨識能力 | 是否需將整個 Bundle 載入 RAM | 效能與儲存影響 |
| :--- | :--- | :--- | :--- |
| **LZMA** | 否。Bundle 以單一整體串流壓縮。 | **是。** 必須將整個檔案解壓縮至記憶體中。 | 壓縮率最高、下載體積最小，但在擷取時會引發急性記憶體膨脹（Memory Bloat）與高強度 CPU 消耗[^29]。 |
| **LZ4** | 是。採用分塊（chunk-based）壓縮。 | **否。** 僅載入目前正在存取的資料部分。 | 建議作為預設（default）標準。允許直接快取（caching）至本機磁碟，無須將全部中繼資料載入 RAM[^29]。 |
| **Uncompressed** | 是。支援獨立辨識各項資源。 | **否。** 直接存取讀取。 | 不耗費解壓縮時間，原始檔案體積最大。在磁碟頻寬允許時最適合即時載入[^29]。 |

當從一個採用 LZMA 壓縮的龐大 AssetBundle 封包中請求一項微小的資源時，整個檔案（包含標頭、中繼資料、串流快取表）都必須被迫從硬碟搬移至 RAM 中[^27]。這項設計失誤會把過大的 AssetBundle 變成隨時引爆應用程式記憶體不足當機（OOM crashes）的定時炸彈[^27]。

## 資源治理的最佳實務（Best Practices）

為了馴服參考計數系統的複雜度並減輕 `DelayedActionManager` 的負擔，系統設計者必須套用極為嚴謹的生命週期架構，並搭配資源生命週期最佳化技術。

### 1. 同步化初始化與釋放週期

由 API 回傳的每一個 `AsyncOperationHandle` 物件，在使用生命週期結束時都必須強制釋放[^6]。未落實這點不僅會引起記憶體洩漏，更有可能導致系統當機（crashes）[^6]。下表展示了 Addressables 程式設計中不可或缺的對稱操作：

| 初始化／載入方法 | 對應的釋放方法 | 內部運作機制 |
| :--- | :--- | :--- |
| `Addressables.LoadAssetAsync` | `Addressables.Release(handle)` | 將所屬 AssetBundle 的參考計數減 1[^6]。 |
| `Addressables.InstantiateAsync` | `Addressables.ReleaseInstance(gameObject)` | 銷毀顯示中的執行個體（Instance），並自動將來源 Prefab 的計數減 1[^4]。 |
| 透過 `AssetReference` 指派 | `reference.ReleaseAsset()` | 類似透過控點呼叫 Release，清除靜態參考[^6]。 |

特別是在使用 `ScriptableObject` 儲存遊戲設定時，直接參考一個物件（`public Object _worldAsset`）會建立硬參考（hard references），迫使整個系統立即將該資源載入 RAM 之中[^27]。最佳解法是使用 `AssetReference`（`public AssetReference addressableAsset;`），以實現真正的隨需非同步載入（on-demand loading）[^6]。

### 2. 底層介入：`Resources.UnloadUnusedAssets()`

當共用的 AssetBundle 因「無法部分卸載」特性而陷入記憶體死結時（例如 `樹` 資源與 `坦克` 一起卡住），唯一的脫困之道便是使用來自引擎基礎層的強制清理 API：`Resources.UnloadUnusedAssets()`[^25]。

此函式會對整個系統 RAM 執行深度掃描，搜尋所有實際引擎參考數量（actual engine references）完全為 0 的資源（包括隱藏在 AssetBundle 內的資源），並強制予以銷毀[^25]。儘管如此，這是一項運算代價極為高昂的操作，因為 CPU 必須暫停邏輯執行緒以進行清理掃描，進而造成嚴重的影格率下降（FPS drops）[^27]。工程師應僅在大型載入畫面（loading screens）期間觸發此指令，或是在使用 `SceneManager.LoadScene` 切換場景時由系統自動呼叫[^29]。

### 3. 規劃與切分 AssetBundle（Bundle Packing Modes）

在 Addressables 設定介面中組織群組（Groups）的結構，直接決定了記憶體載入效能與下載頻寬。針對資源類型挑選合適的封裝模式（Bundle Mode）是極為關鍵的設計步驟[^6]：

* **Pack Together（共同封裝）**：適用於生命週期緊密結合、永遠同時出現的資源。此作法可將相依圖分析與網路 I/O 的成本降至最低[^6]。
* **Pack Separately（個別封裝）**：最適合體積龐大的獨立資源，或無法保證永遠同時載入的大型地圖。可消除大型資源阻礙其他小型資源釋放的風險[^6]。
* **Pack Together By Label（依標籤封裝）**：允許透過標籤中繼資料將分散各處的資源結合在一起（例如賦予 `"Halloween 2023"` 標籤，將整個活動內容打包進同一個 Bundle，方便透過 CDN 更新）[^6]。

為了進一步削減 AssetBundle 內類型樹目錄表（TypeTree）的負擔，開發者可啟用 `BuildAssetBundleOptions.DisableWriteTypeTree` 選項。此功能會移除不必要的中繼資料，不過在匯出可執行檔之前，需要重新建置本機群組（rebuild local groups）[^26]。

### 4. 音訊與影像記憶體治理（Graphics & Audio）

最佳化輔助資源層是降低垃圾回收器運作頻率最有效的手段。音訊串流的載入格式設定會直接影響記憶體佔用[^27]：

* **長篇背景音樂（BGM）**：應設定為 **Streaming**，以從磁碟逐小塊緩衝載入[^27]。
* **長篇音效**：選擇 **Compressed In Memory**，在 RAM 上維持壓縮狀態並在播放時即時解壓縮[^27]。
* **短促／高頻率音效**：採用 **Decompress On Load**，直接備妥未壓縮資料，免除 CPU 負擔[^27]。

此外，在 Texture 上停用 `"Read/Write enabled"` 選項，並針對介面（UI）圖形攝影機設定移除深度緩衝區（Depth Stencil Format to None），將能減少至少 50% 不必要的算繪 RAM 消耗[^27]。

## 全域互動總結

針對 `DelayedActionManager` 的研究，不僅解開了 `DontDestroyOnLoad` 場景中一個隱藏物件的身世之謎，更揭露了 Unity Addressables 系統的基本設計哲學。這個 `ComponentSingleton` 類別宛如一座精巧的時間橋樑，透過將釋放流程、非同步呼叫與快取處理導向 `LateUpdate` 週期來保全資料的完整性。它將記憶體結構的異動與 `Update` 執行緒中物理或控制邏輯可能帶來的中斷加以隔離，築起一道抵禦場景切換時系統損毀例外狀況的護盾。

然而，`DelayedActionManager` 並非能化解記憶體管理架構內在弱點的萬靈丹。它對軟體架構師提出了嚴苛的要求：必須維持完全對稱的資源載入／釋放週期、設計避免擷取原生 C++ 物件迴圈的 C# 匿名運算式（lambdas），以及將 AssetBundle 結構模組化（modularize）以防範頑強的記憶體洩漏。只要深入掌握非同步載入路由、妥善運用如 LZ4 等壓縮方式，並結合 `Resources.UnloadUnusedAssets` 的強制清理能力，開發團隊就能打造出穩健且能在各種平台上強力擴展的架構模型，無須再擔憂永久性的資源枯竭問題。

## **參考文獻**

[^1]: Addressables In Unity - Ali Emre Onur - Medium, [https://aliemreonur.medium.com/addressables-in-unity-eec8b03198d7](https://aliemreonur.medium.com/addressables-in-unity-eec8b03198d7)
[^2]: Latecomer to Chop Chop, with a question...! - Unity Discussions, [https://discussions.unity.com/t/latecomer-to-chop-chop-with-a-question/899280](https://discussions.unity.com/t/latecomer-to-chop-chop-with-a-question/899280)
[^3]: Error: Assertion failed on expression: ShouldRunBehaviour(), [https://discussions.unity.com/t/error-assertion-failed-on-expression-shouldrunbehaviour/839805](https://discussions.unity.com/t/error-assertion-failed-on-expression-shouldrunbehaviour/839805)
[^4]: Addressables - Unity Term Book, [https://unitytermbook.com/en/addressables/](https://unitytermbook.com/en/addressables/)
[^6]: Best Practices | Spatial Creator Toolkit, [https://toolkit.spatial.io/docs/addressables/best-practices](https://toolkit.spatial.io/docs/addressables/best-practices)
[^7]: How to use DontDestroyOnLoad - Scripting - Unity Discussions, [https://discussions.unity.com/t/how-to-use-dontdestroyonload/894016](https://discussions.unity.com/t/how-to-use-dontdestroyonload/894016)
[^8]: DontDestroyOnLoad is not Working on Scene? - Stack Overflow, [https://stackoverflow.com/questions/18328180/dontdestroyonload-is-not-working-on-scene](https://stackoverflow.com/questions/18328180/dontdestroyonload-is-not-working-on-scene)
[^9]: why does "DontDestroyOnLoad" show up when I press play, if its not, [https://www.reddit.com/r/unity/comments/p8pj82/why_does_dontdestroyonload_show_up_when_i_press/](https://www.reddit.com/r/unity/comments/p8pj82/why_does_dontdestroyonload_show_up_when_i_press/)
[^11]: Error when using GetTable() - Unity Engine - Unity Discussions, [https://discussions.unity.com/t/error-when-using-gettable/892883](https://discussions.unity.com/t/error-when-using-gettable/892883)
[^12]: Unity Resource Manager | Package Manager UI website, [https://docs.unity3d.com/Packages/com.unity.resourcemanager@2.2/index.html](https://docs.unity3d.com/Packages/com.unity.resourcemanager@2.2/index.html)
[^13]: Namespace UnityEngine.ResourceManagement.Util | Addressables, [https://docs.unity.cn/Packages/com.unity.addressables@2.0/api/UnityEngine.ResourceManagement.Util.html](https://docs.unity.cn/Packages/com.unity.addressables@2.0/api/UnityEngine.ResourceManagement.Util.html)
[^15]: 어드레서블 Sprite 관련해서 질문이있습니다. - 인프런, [https://www.inflearn.com/community/questions/1351466/%EC%96%B4%EB%93%9C%EB%A0%88%EC%84%9C%EB%B8%94-sprite-%EA%B4%80%EB%A0%A8%ED%95%B4%EC%84%9C-%EC%A7%88%EB%AC%B8%EC%9D%B4%EC%9E%88%EC%8A%B5%EB%8B%88%EB%8B%A4](https://www.inflearn.com/community/questions/1351466/%EC%96%B4%EB%93%9C%EB%A0%88%EC%84%9C%EB%B8%94-sprite-%EA%B4%80%EB%A0%A8%ED%95%B4%EC%84%9C-%EC%A7%88%EB%AC%B8%EC%9D%B4%EC%9E%88%EC%8A%B5%EB%8B%88%EB%8B%A4)
[^19]: ArgumentNullException in StartCoroutine_Auto - Unity Discussions, [https://discussions.unity.com/t/argumentnullexception-in-startcoroutine-auto/1701939](https://discussions.unity.com/t/argumentnullexception-in-startcoroutine-auto/1701939)
[^20]: Changelog | Addressables | 1.11.2 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@1.11/changelog/CHANGELOG.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.11/changelog/CHANGELOG.html)
[^23]: Memory management overview | Addressables | 2.0.8 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@2.0/manual/MemoryManagement.html](https://docs.unity3d.com/Packages/com.unity.addressables@2.0/manual/MemoryManagement.html)
[^25]: Memory management | Addressables | 1.16.19 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@1.16/manual/MemoryManagement.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.16/manual/MemoryManagement.html)
[^26]: Memory management | Addressables | 1.20.5 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@1.20/manual/MemoryManagement.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.20/manual/MemoryManagement.html)
[^27]: Unity game memory optimization on Android, [https://developer.android.com/games/engines/unity/unity-reduce-memory](https://developer.android.com/games/engines/unity/unity-reduce-memory)
[^28]: Addressables not freeing memory completely? - Unity Discussions, [https://discussions.unity.com/t/addressables-not-freeing-memory-completely/914086](https://discussions.unity.com/t/addressables-not-freeing-memory-completely/914086)
[^29]: Addressables: how to truly unload assets to free memory, [https://discussions.unity.com/t/addressables-how-to-truly-unload-assets-to-free-memory/808301](https://discussions.unity.com/t/addressables-how-to-truly-unload-assets-to-free-memory/808301)

### 延伸閱讀

- How to structure your Unity project (best practice tips) - [https://gamedevbeginner.com/how-to-structure-your-unity-project-best-practice-tips/](https://gamedevbeginner.com/how-to-structure-your-unity-project-best-practice-tips/)
- DontDestroyOnLoad in Unity — Best Practices — Tutorial #1 - [https://makaka.org/unity-tutorials/dont-destroy-on-load](https://makaka.org/unity-tutorials/dont-destroy-on-load)
- Class ComponentSingleton | Addressables | 4.1.0 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@4.1/api/UnityEngine.ResourceManagement.Util.ComponentSingleton-1.html](https://docs.unity3d.com/Packages/com.unity.addressables@4.1/api/UnityEngine.ResourceManagement.Util.ComponentSingleton-1.html)
- Problema ao atribuir SkeletonData a SkeletonAnimation em… - Spine - [https://pt.esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime](https://pt.esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime)
- Problem when assigning SkeletonData to SkeletonAnimation - [https://esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime](https://esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime)
- Scriptable Object inside an Addressable Folder causes Exception - [https://discussions.unity.com/t/scriptable-object-inside-an-addressable-folder-causes-exception/855434](https://discussions.unity.com/t/scriptable-object-inside-an-addressable-folder-causes-exception/855434)
- Changelog | Package Manager UI website - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@0.7/changelog/CHANGELOG.html](https://docs.unity3d.com/Packages/com.unity.addressables@0.7/changelog/CHANGELOG.html)
- Changelog | Addressables | 1.15.2 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@1.15/changelog/CHANGELOG.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.15/changelog/CHANGELOG.html)
- Addressables introduction | Addressables | 4.1.0 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@4.1/manual/AddressableAssetsOverview.html](https://docs.unity3d.com/Packages/com.unity.addressables@4.1/manual/AddressableAssetsOverview.html)
- Explain Addressables For Performance To Me Like I Am A Child - [https://www.reddit.com/r/Unity3D/comments/1brakih/explain_addressables_for_performance_to_me_like_i/](https://www.reddit.com/r/Unity3D/comments/1brakih/explain_addressables_for_performance_to_me_like_i/)
- Addressables: Planning and best practices - Unity - [https://unity.com/blog/engine-platform/addressables-planning-and-best-practices](https://unity.com/blog/engine-platform/addressables-planning-and-best-practices)
