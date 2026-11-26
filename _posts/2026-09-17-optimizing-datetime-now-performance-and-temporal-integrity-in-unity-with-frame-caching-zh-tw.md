---
title: "Unity Engine 效能與時間資料完整性最佳化：系統機制、DateTime.Now 瓶頸分析與影格快取方案"
date: 2026-09-17 03:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, datetime, csharp, dotnet, frame-caching, multithreading, anticheat]
description: "深入解析 .NET 執行階段中 DateTime.Now 與 DateTime.UtcNow 的內部機制，量化效能瓶頸、時間撕裂（temporal tearing）現象，以及 Unity Engine 中執行緒安全的影格快取架構解決方案。"
lang: zh-TW
translation_id: unity-datetime-now-frame-caching
math: true
---

存取與處理即時時間資料，是在基於 Unity Engine 建置的即時應用程式中最基礎、卻也潛藏諸多架構風險的任務之一[^1]。儘管 .NET 基礎類別庫（BCL）中的 `System.DateTime` 結構提供了完整的曆法與時間處理工具，但在持續執行的更新迴圈（熱路徑，hot paths）中直接呼叫 `System.DateTime.Now` 屬性，會造成嚴重的效能瓶頸並破壞狀態完整性[^2]。

本報告將深入剖析作業系統層級與執行階段（.NET/Mono/IL2CPP）的內部運作機制，透過效能剖析（profiling）數據量化運算成本，分析時間撕裂（*temporal tearing*）現象，並全面評估影格快取（*Frame Caching*）解決方案及相關的架構設計規範[^2]。

---

## **1. .NET 執行階段中 DateTime.Now 與 DateTime.UtcNow 的內部機制**

`System.DateTime` 結構是以單一 64 位元值欄位（`UInt64 _dateData`）來儲存[^6]。在此資料配置中：
- **低 62 位元**代表自西曆 0001 年 1 月 1 日 00:00:00 起累積的 Tick 數量，每個 tick 對應 $100\text{ ns}$（$10^{-7}\text{ s}$ 或 $0.1\ \mu\text{s}$）[^1]。
- **最高 2 位元**保留用於儲存 `DateTimeKind` 旗標，用以辨識三種情境狀態之一：`Utc`、`Local` 或 `Unspecified`[^1]。

### **DateTime.UtcNow 的底層執行流程**

`DateTime.UtcNow` 屬性代表協調世界時，在設計上針對運算週期進行了極致最佳化[^2]。當處理程序呼叫 `DateTime.UtcNow` 時，.NET 執行階段會直接從系統的硬體計時器執行讀取操作[^2]：

- 在 **Windows** 作業系統上，原始碼透過一個標記為跳過編譯最佳化屏障（`TargetedPatchingOptOut`）的內建函式指標，直接呼叫 Win32 API 函式 `GetSystemTimeAsFileTime`[^2]。
- 在 **POSIX** 系列作業系統（包含 Android 上的 Linux 核心以及 iOS/macOS 上的 Darwin 核心）上，系統會執行底層呼叫 `clock_gettime(CLOCK_REALTIME, ...)`[^5]。

由作業系統傳回的原始時間值只需加上一個固定補償常數以對齊西曆時間基準，接著便連同 `DateTimeKind.Utc` 標籤直接封裝進 `DateTime` 結構中[^2]。此流程不需要任何查表解析、不會配置記憶體，且能在數奈秒內完成[^2]。

### **DateTime.Now 的複雜解析流程**

相較於 `DateTime.UtcNow`，判定本地時間（`DateTime.Now`）則需要一連串繁複的轉換作業[^2]。`DateTime.Now` 屬性並非直接從硬體讀取獨立的本地時鐘數值；相反地，它完全建立在 `DateTime.UtcNow` 的結果之上，並結合一連串的時區偏移量計算[^2]：

```csharp
public static DateTime Now 
{
    get 
    {
        DateTime utcNow = UtcNow;
        bool isAmbiguousDst = false;
        long offset = TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc(utcNow, out isAmbiguousDst).Ticks;
        long ticks = utcNow.Ticks + offset;
        
        if (ticks > DateTime.MaxValue.Ticks)
            return new DateTime(DateTime.MaxValue.Ticks, DateTimeKind.Local);
        if (ticks < DateTime.MinValue.Ticks)
            return new DateTime(DateTime.MinValue.Ticks, DateTimeKind.Local);
            
        return new DateTime(ticks, DateTimeKind.Local);
    }
}
```

此過程以取得目前 UTC 時間為起點，接著查詢 `TimeZoneInfo.Local` 物件以確定裝置的時區組態[^2]。資源耗費的核心在於 `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc` 函式，執行階段必須在此將目前時間點與時區調整規則（*Adjustment Rules*）表及日光節約時間（*Daylight Saving Time - DST*）規範進行比對，藉以判斷當前時刻是否正處於需要加計一小時的區間內[^2]。

在精確算出以 Tick 為單位的偏移量後，系統會與 `utcNow.Ticks` 進行算術相加、檢查數值邊界溢位條件，並以 `DateTimeKind.Local` 標籤建構新的 `DateTime` 結構執行個體[^2]。

取自官方 .NET Runtime 原始碼庫的效能剖析數據，提供了 `DateTime.get_Now()` 方法詳細的執行時間分配比例[^4]：

| `System.DateTime.get_Now()` 中的執行元件 | 累計時間比例（Inclusive %） | 操作的技術本質 |
| :--- | :---: | :--- |
| `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc` | **88.1%** | 查詢時區轉換規則、檢查 DST 旗標、計算偏移量[^4] |
| `System.DateTime.get_UtcNow()` | **5.8%** | 讀取硬體計數器的系統呼叫（Syscall）[^2] |
| 邊界檢查與結構封裝運算 | **6.1%** | 驗證 64 位元整數溢位並賦予 `DateTimeKind.Local` 標籤[^4][^7] |

> [!IMPORTANT]
> 上述數據證明，從硬體時鐘讀取時間本身僅佔總執行成本的 **~5.8%**，而高達 **~88.1%** 的處理時間都消耗在時區解析與日光節約時間規則的運算上[^4]。

### **行動平台環境（Mono 與 IL2CPP）下加劇的複雜度**

在透過 Mono 或 IL2CPP 執行 Unity 的行動平台上，`DateTime.Now` 的複雜程度更會倍數放大[^5]。Windows 透過集中式的登錄檔（Registry）維護時區資訊，而 Android 等行動作業系統則將這些資料儲存在分散於 `/apex/com.android.tzdata/` 或 `/system/usr/share/zoneinfo` 等系統目錄中的二進位 `tzdata` 資料庫（`ZoneInfoDB`）內[^5]。

當 `TimeZoneInfo.Local` 初次初始化或需要重新驗證時，Mono/IL2CPP 執行階段被迫執行檔案 I/O 操作、剖析二進位資料，甚至必須透過 Java 原生介面（JNI）對 `java.util.TimeZone` 類別發起跨執行階段呼叫，才能取得時區識別碼[^5]。

> [!WARNING]
> 若時區資料庫檔案格式損毀、在自訂 ROM 中被變更存放路徑，或檔案存取權限受限，呼叫 `DateTime.Now` 便可能拋出嚴重的 `System.TimeZoneNotFoundException` 例外狀況；若未以例外處理區塊妥善包覆，將導致應用程式無預警閃退[^10]。

---

## **2. 效能基準測試分析與影格預算影響**

各種時間存取方法的執行成本會因底層架構與作業系統快取狀態的不同而產生極大落差[^5]。下表彙整了 Unity 與 .NET 環境中常見計時機制的標準化基準測試結果[^4]：

| 時間取得方法 | 預估執行時間 | 相對速度比率 | 核心執行機制 | 造成影格突波（Frame Spike）的風險 |
| :--- | :---: | :---: | :--- | :--- |
| `UnityEngine.Time.time` | $\sim 1\text{ - }2\text{ ns}$ | 最佳化極致（引擎原生） | 直接讀取於影格開頭快取的浮點數型別變數 | 完全無風險 |
| `System.DateTime.UtcNow` | $\sim 15\text{ - }20\text{ ns}$ | 比 `Now` 快 $\sim 15\text{ - }20\times$ | 透過極簡系統呼叫直接讀取硬體時鐘[^2] | 微乎其微 |
| `System.DateTime.Now`（熱路徑，Warm Path） | $\sim 280\text{ - }350\text{ ns}$ | 基準對照標準（$1\times$） | 呼叫 UtcNow、存取時區快取、計算 DST 偏移量[^2] | 若反覆呼叫則為中至高風險 |
| `System.DateTime.Now`（冷路徑 / 行動裝置） | $\sim 1\text{ - }5\text{ ms}$ | 慢數千倍（$\gt 3.000\times$） | 初始化 AndroidTzData 資料表、磁碟 I/O、讀取二進位資料[^5] | 極高（導致畫面凍結） |

### **遊戲迴圈中的影格預算限制**

在即時互動應用程式中，包含運動力學模擬、物理運算、遊戲邏輯處理以及向 GPU 送出繪製指令在內的全部工作負載，都必須在以下公式所定義的有限時間區間內完成：

$$
T_{\text{frame}} = \frac{1000\text{ ms}}{\text{Target FPS}}
$$

- 在標準的 **$60\text{ Hz}$**（$60\text{ FPS}$）螢幕更新率下，每個影格的時間預算為 **$16.67\text{ ms}$**。
- 在 **$120\text{ Hz}$**（$120\text{ FPS}$）高更新率顯示器上，此數值則大幅縮減至僅剩 **$8.33\text{ ms}$**。

若程式碼架構在實體更新迴圈內部散落了大量 `DateTime.Now` 呼叫——例如數十名非玩家角色（NPC）的技能冷卻計時系統、增益狀態檢查系統或依現實時間運作的活動判定邏輯——每一影格就會累積數百至數千次的系統呼叫。

以每影格 **500 次熱路徑 `DateTime.Now` 呼叫**計算，系統光是在時區偏移運算上就會消耗約 **$\sim 0.15\text{ ms}$**（$150\,\mu\text{s}$），佔用高達 **$120\text{ Hz}$** 單一影格總預算的 **$\sim 1.8\%$**。此等耗損會直接引發掉幀與局部畫面卡頓現象，這也說明了為何靜態分析工具 Unity Project Auditor 會將持續更新路徑中使用 `DateTime.Now` 標記為高嚴重性的紅色警示（*Major Issue*）[^3]。

---

## **3. 時間撕裂（Temporal Tearing）現象與資料完整性錯誤**

除了導致 CPU 效能下滑外，分散呼叫 `DateTime.Now` 以擷取單一時間點各個組成欄位的做法，還會引發嚴重的資料原子性（*Data Atomicity*）缺陷。原始程式碼在執行彼此獨立的比較運算時便會遭遇此漏洞：

```csharp
if (requirement.CheckYear)   results.Add(DateTime.Now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(DateTime.Now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(DateTime.Now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(DateTime.Now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(DateTime.Now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(DateTime.Now.Second == requirement.Second);
```

### **異常混合狀態的生成機制**

`DateTime.Now` 屬性的本質是一個在呼叫瞬間依據客觀時間產生相依狀態的方法呼叫，而非靜態資料欄位[^20]。每當程式碼存取 `.Year`、`.Month` 或 `.Day` 等子屬性時，系統就會重新執行一次完整的作業系統查詢週期[^2]。

儘管相鄰程式碼行之間的間隔僅有短短數微秒，但執行程序仍可能因作業系統的時間分片多工排程機制而遭到搶佔中斷，或者執行時機恰巧跨越系統時鐘的自然進位邊界[^8]。

> [!CAUTION]
> **邊界交接錯誤情境（Boundary Edge-Case）：**  
> 假設執行緒正好在 2024 年 8 月 31 日 `23:59:59.999` 執行月份檢查程式碼。`DateTime.Now.Month` 依據此時間點進行運算並傳回 **8 月**。  
>  
> 緊接著在該指令完成後、下一行日期檢查指令尚未執行前，系統時鐘跨入 2024 年 9 月 1 日 `00:00:00.000`。當 `DateTime.Now.Day` 觸發時，作業系統提供新的時間戳記，使得該屬性傳回 **1 日**。  
>  
> 結果導致邏輯系統擷取到一個拼湊出的混合狀態：**8 月 1 日**——一個在物理時間進程中當時根本不曾存在過的時間點！

若該時間戳記被用來觸發限時活動、驗證定期登入獎勵或記錄遊戲內交易歷程，這種時間偏差就可能破壞條件判斷邏輯，造成功能意外鎖定或讓玩家得以重複領取獎勵。

---

## **4. 影格快取解決方案的技術評估**

為了徹底消除多餘的運算成本並根絕時間撕裂現象，最佳化的解決方案是採用每影格快取模型（*Frame Caching / Per-frame Memoization*），以 Unity Engine 的影格計數器（`UnityEngine.Time.frameCount`）作為判定資料有效性的鍵值[^22]。

### **影格快取的運作流程分析**

實作快取機制的原始碼架構如下：

```csharp
private static DateTime _cachedSystemTime;  
private static int _lastSystemTimeFrame = -1;

private static DateTime GetCurrentSystemTime()  
{  
    if (Application.isPlaying)  
    {  
        int currentFrame = Time.frameCount;  
        if (_lastSystemTimeFrame != currentFrame)  
        {  
            _lastSystemTimeFrame = currentFrame;  
            _cachedSystemTime = DateTime.Now;  
        }  
        return _cachedSystemTime;  
    }  
    return DateTime.Now;  
}
```

當時間驗證邏輯需要進行查詢時，僅需取得一次時間並存入區域變數，接著便能貫穿所有條件檢查重複使用：

```csharp
DateTime now = GetCurrentSystemTime();  
if (requirement.CheckYear)   results.Add(now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(now.Second == requirement.Second);
```

此機制帶來了兩項決定性的改善：

1. **降低運算複雜度：** 從相依於實體數量的線性複雜度 $\mathcal{O}(N)$，大幅降至每個顯示影格恆定的 $\mathcal{O}(1)$ 複雜度。同一影格內於首次呼叫之後產生的所有查詢，均僅直接讀取儲存在靜態記憶體中的 64 位元 `DateTime` 結構數值，完全省去向作業系統呼叫及計算時區的成本[^2]。
2. **確保時間快照的原子性（*Snapshot Atomicity*）：** 變數 `now` 如同整個影格期間不可變動的時間切片，確保從年、月直到秒的所有子屬性彼此一致，絕不會被系統中斷切分。

### **實際部署時的邊界限制與風險分析**

儘管影格快取方案在 Unity 主執行緒上徹底解決了問題，但將其套用至大型軟體架構時，仍須審慎評估三項關鍵的技術限制：

1. **主執行緒親和性限制（Main Thread Affinity）：** `UnityEngine.Time.frameCount` 屬性屬於引擎內部 C++ 層級的 API，且與主執行緒緊密綁定[^24]。若有背景處理程序——例如背景工作執行緒（`Task.Run`）、非同步網路處理程序或 C# Job System 中的任務——呼叫 `GetCurrentSystemTime()` 方法，Unity 會立刻拋出 `UnityException: get_frameCount can only be called from the main thread` 例外狀況並中斷執行流程[^24]。
2. **Update 與 FixedUpdate 之間的節奏落差：** Unity 的執行生命週期包含兩個獨立的更新迴圈：圖形算繪迴圈（`Update`）與固定步長物理模擬迴圈（`FixedUpdate`）[^25]。引擎只會在跨入下一個新的算繪影格時，才將 `Time.frameCount` 數值加一[^22]。當用戶端裝置發生影格率驟降時，引擎可能會被迫在同一個算繪影格內連續觸發多個 `FixedUpdate` 週期以追趕物理模擬進度[^23]。此時，位於同一個算繪週期內的所有 `FixedUpdate` 步驟都會讀到完全相同的快取值 `_cachedSystemTime`，這可能無法真實反映連續物理模擬步驟之間的時間推移[^26]。
3. **資料競爭風險（Data Race）：** 在缺乏記憶體屏障（*Memory Barriers*）或存取權限鎖定的情況下存取全域靜態變數 `_cachedSystemTime` 與 `_lastSystemTimeFrame`，當多核心處理器架構啟用指令亂序執行（*out-of-order execution*）且工作執行緒同時進行讀寫時，將導致資料衝突的風險。

### **實作執行緒安全（Thread-Safe）的時間提供系統**

為了解決上述所有技術限制，時間系統應標準化為一套專屬服務，使其具備辨識執行緒執行環境的能力，確保存取安全並自動處理邊界例外狀況：

```csharp
using System;  
using System.Threading;  
using UnityEngine;

public static class SystemTimeProvider  
{  
    private static DateTime _mainThreadCachedTime;  
    private static int _lastFrameCount = -1;  
    private static int _mainThreadId;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]  
    private static void Initialize()  
    {  
        _mainThreadId = Thread.CurrentThread.ManagedThreadId;  
        _lastFrameCount = -1;  
    }

    public static DateTime CurrentLocalTime  
    {  
        get  
        {  
            if (Application.isPlaying && Thread.CurrentThread.ManagedThreadId == _mainThreadId)  
            {  
                int currentFrame = Time.frameCount;  
                if (_lastFrameCount != currentFrame)  
                {  
                    _lastFrameCount = currentFrame;  
                    _mainThreadCachedTime = DateTime.Now;  
                }  
                return _mainThreadCachedTime;  
            }  

            return DateTime.Now;  
        }  
    }

    public static DateTime CurrentUtcTime => DateTime.UtcNow;  
}
```

此架構確保主執行緒始終能享有每影格快取帶來的優勢，無須擔憂重複運算成本；與此同時，背景執行緒與 Editor 編輯模式仍可透過直接備援（fallback）機制維持穩定運作，徹底杜絕引擎拋出違反執行緒存取權限例外的風險[^24]。

---

## **5. 遊戲引擎架構中的時間領域劃分規範**

遊戲開發中常見的一項錯誤，是將各種不同的時間使用目的混雜在同一個系統 API 中[^2]。為了維持最佳效能與遊戲狀態的一致性，系統架構必須在各個獨立的時間領域之間劃定明確界線：

| 時間領域（Time Domain） | 建議採用的標準 API | 主要使用情境 | 誤用 API 的風險 |
| :--- | :--- | :--- | :--- |
| **內部遊戲玩法模擬** | `UnityEngine.Time.time`、`Time.deltaTime` | 物理座標運算、角色移動、技能冷卻時間 | 暫停遊戲（`timeScale = 0`）時會凍結；若需要真實時間則失去精確度[^26] |
| **即時介面呈現** | `UnityEngine.Time.unscaledTime`、`Time.realtimeSinceStartup` | 遊戲暫停期間的選單 UI 動畫、轉場過場特效 | 與用戶端處理程序工作階段緊密綁定，無法映射至現實世界曆法 |
| **演算法效能測量** | `System.Diagnostics.Stopwatch` | 量測演算法執行時間、程式碼區塊效能剖析、偵測效能漏失[^7] | `DateTime.Now` 解析度僅約 $\sim 15.6\text{ ms}$，靈敏度不足以進行基準測試[^7] |
| **反作弊驗證邏輯** | 與伺服器同步的 Unix Epoch（UTC）[^28] | 體力系統、寶箱開啟倒數、線上活動時間限制[^28] | 若輕信單機用戶端時鐘，玩家即可竄改作業系統時間來作弊獲取道具[^28] |
| **本地曆法顯示** | `SystemTimeProvider.CurrentLocalTime` | 在 UI 狀態列呈現使用者當地的現實時間[^2] | 若未經快取而持續呼叫原生 `DateTime.Now` 將造成畫面掉幀卡頓[^2] |

### **伺服器時間同步與防作弊機制（Anti-Cheat）**

對於具備連線功能的遊戲而言，允許用戶端依據單機的 `DateTime.Now` 或 `DateTime.UtcNow` 自行驗證行為時間戳記，會製造嚴重的資安漏洞[^28]。使用者能輕易調整作業系統的時鐘設定，藉以快轉建築倒數計時或重置活動次數[^28]。

要徹底杜絕此類作弊手法，標準化架構要求用戶端必須以單調時鐘（*monotonic clock*）為基礎建立虛擬時間基準[^5]：

1. **發送同步查詢：** 當用戶端建立網路連線時，向服務伺服器發送時間同步查詢，以取得具權威性的 UTC 標準 Unix Epoch 時間戳記[^28]。
2. **量測往返延遲：** 用戶端記錄封包的往返時間（$RTT$），並透過下列公式估算回應抵達當下的伺服器標準時間：
   $$T_{\text{server}} = T_{\text{server\_reply}} + \frac{RTT}{2}$$
3. **計算單調偏移量：** 用戶端計算並儲存與硬體單調計數器之間的固定差值：
   $$\Delta t = T_{\text{server}} - \text{Time.realtimeSinceStartupAsDouble}$$
4. **存取防作弊時間：** 在整個應用程式生命週期中，所有需要檢查現實時間的遊戲邏輯僅需讀取以下數值：
   $$\text{CurrentRealTime} = \text{Time.realtimeSinceStartupAsDouble} + \Delta t$$
   由於引擎的啟動時間計數器採用源自硬體的單調遞增機制（`clock_gettime(CLOCK_MONOTONIC)` 或 `QueryPerformanceCounter`），此數值會持續線性遞增，且完全不受任何竄改作業系統日曆時鐘的操作影響[^5]。

### **透過 TimeProvider（.NET 8+）轉向現代化架構**

自 .NET 8 版本起，Microsoft 正式重構了整套時間管理模型，推出 `System.TimeProvider` 抽象類別以全面取代 `DateTime.Now` 或 `DateTime.UtcNow` 等直接靜態呼叫[^20]。針對現代 Unity 專案，開發人員可透過 `Microsoft.Bcl.TimeProvider` 相容性套件導入此架構，藉此提升程式碼的模組化程度[^32]:

```csharp
public sealed class GameTimeService  
{  
    private readonly TimeProvider _timeProvider;

    public GameTimeService(TimeProvider timeProvider = null)  
    {  
        _timeProvider = timeProvider ?? TimeProvider.System;  
    }

    public DateTimeOffset GetCurrentTime() => _timeProvider.GetLocalNow();  
}
```

轉移至這套抽象化模型可帶來兩項重大的技術優勢：

> [!TIP]
> 1. **獨立的單元測試（Unit Testing）：** 得以徹底落實單元測試模式[^20]。工程師可將模擬物件 `FakeTimeProvider` 注入商業邏輯中，藉以精確模擬跳躍跨越複雜時間交界點（例如 DST 時區切換或跨年時刻）的測試案例，而無須等待真實時間流逝或介入調整系統時鐘[^20]。  
> 2. **型別安全的 `DateTimeOffset`：** `GetLocalNow()` 方法傳回的是 `DateTimeOffset` 結構而非 `DateTime`[^20]。`DateTimeOffset` 結構會將時間點連同明確的時區偏移量（*offset*）固定儲存，徹底消除 `DateTimeKind.Unspecified` 旗標所造成的模糊狀態，並確保資料經網路序列化（serialization）傳送時的完整性[^1]。

---

## **5. 實務導入：RequirementsManager 系統最佳化（案例研究）**

在使用 RPG Builder 框架的實際生產專案（GLW 專案）中，`RequirementsManager.cs` 類別曾被發現存在嚴重的效能問題。具體來說，遊戲的時間條件檢查系統（例如要求活動在特定的月、日、時觸發）會零散地連續多次呼叫 `DateTime.Now`：

```csharp
if(requirement.CheckYear) results.Add(DateTime.Now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(DateTime.Now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(DateTime.Now.Day == requirement.Day);
// ... 針對 Hour、Minute、Second 重複執行
```

**舊版程式碼衍生的問題：**
1. **極為龐大的 CPU 額外負擔：** 僅僅為了檢查 1 項 requirement，系統就可能觸發多達 7～10 次的 `DateTime.Now` 呼叫（包含在 `GetWeekNumber()` 等輔助函式內的呼叫）。若有 100 個實體同時進行檢查，每影格就會向作業系統發出數千次 Syscall，造成嚴重的效能瓶頸（bottleneck）。
2. **Temporal Tearing（時刻錯位）：** 若秒（或分、日）的交接時刻正好落入上述指令的讀取過程之間（例如在第 999 毫秒），`Month` 變數可能取自舊月份，但 `Day` 變數卻取自新日期，導致遊戲拼湊出一個現實中完全不存在的錯誤時間點。

**實際部署的解決方案（Per-Frame Caching）：**
直接整合影格快取架構，運用 `Time.frameCount` 作為快取失效標記（cache invalidation）。此做法採用靜態生命週期而非仰賴 Update 迴圈：

```csharp
private static DateTime _cachedSystemTime;
private static int _lastSystemTimeFrame = -1;

private static DateTime GetCurrentSystemTime()
{
    if (Application.isPlaying) 
    {
        int currentFrame = Time.frameCount;
        
        // 每影格僅從作業系統讀取一次真實時間
        if (_lastSystemTimeFrame != currentFrame)
        {
            _lastSystemTimeFrame = currentFrame;
            _cachedSystemTime = DateTime.Now; 
        }
        
        return _cachedSystemTime;
    }
    return DateTime.Now; // Editor 模式
}
```

在需要處理邏輯的位置，所有條件檢查均統一參照同一個時間**快照（snapshot）**：

```csharp
DateTime now = GetCurrentSystemTime();
if(requirement.CheckYear) results.Add(now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(now.Day == requirement.Day);
```

**最佳化後的成果（`MOD-RPGB-008` 修補程式）：** 
- **徹底消除冗餘 Syscall：** 從每影格數千次呼叫降為 $\mathcal{O}(1)$ 層級——每影格的所有運算皆嚴格共用唯一次的 `DateTime.Now` 呼叫。
- **絕對的原子一致性（Atomic consistency）：** 確保 `Year`、`Month`、`Day` 欄位必然源自完全相同的單一時刻。
- **清除 Unity Project Auditor 警示：** 完全消除與 `System.DateTime` 相關的系統效能「Major」層級警告。

---

## **6. 結論**

在 Unity Engine 的高頻更新迴圈中直接使用 `System.DateTime.Now`，無論在硬體效能還是邏輯資料完整性方面，皆構成了嚴重的工程難題[^3]。

- 時區解析與日光節約時間（DST）檢查之系統呼叫的複雜本質，消耗了該屬性超過 **88%** 的執行時間，直接對遊戲引擎的影格預算施加壓力[^4]。
- 同時，從彼此獨立的 `DateTime.Now` 呼叫中存取多個子屬性，會留下時間撕裂（*temporal tearing*）漏洞，進而產生異常混合的時間戳記並破壞遊戲邏輯[^21]。

將影格快取（**Frame Caching**）解決方案與 `Time.frameCount` 屬性相結合，在將 CPU 耗損降至每影格最低恆定水準 **$\mathcal{O}(1)$** 的同時，亦確保時間快照不可變動的原子性，藉此徹底解決了上述兩大問題[^22]。

在商業專案規模進行部署時，此架構需進一步補強執行緒執行保護層（`SystemTimeProvider`），與來自伺服器的權威時間驗證機制（*Server-Authoritative Time*）緊密整合以防範作弊，並朝向以 `TimeProvider` 抽象類別進行標準化的方向邁進，方能全面符合現代軟體工程產業的技術規範[^20]。

---

## **參考文獻**

[^1]: [DateTime Struct (System) | Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.datetime?view=net-10.0)  
[^2]: [The Darkness Behind DateTime.Now - DZone](https://dzone.com/articles/darkness-behind-datetimenow)  
[^3]: [Changelog | Project Auditor | 1.0.2 - Unity - Manual](https://docs.unity3d.com/Packages/com.unity.project-auditor@1.0/changelog/CHANGELOG.html)  
[^4]: [Make DateTime.Now as efficient as DateTime.UtcNow · Issue #24277](https://github.com/dotnet/runtime/issues/24277)  
[^5]: [DateTimeOffset.Now TimeZone data impacts Android startup #71004](https://github.com/dotnet/runtime/issues/71004)  
[^6]: [mono/mcs/class/referencesource/mscorlib/system/datetime.cs at main](https://github.com/mono/mono/blob/master/mcs/class/referencesource/mscorlib/system/datetime.cs)  
[^7]: [[C#] DateTime 구조체 파헤치기 - Second Step - 티스토리](https://sikpang.tistory.com/41)  
[^8]: [c# - Optimizing alternatives to DateTime.Now - Stack Overflow](https://stackoverflow.com/questions/1561791/optimizing-alternatives-to-datetime-now)  
[^9]: [DateTime.Now return 1hour off when compared to device time in - Mono #20510](https://github.com/mono/mono/issues/20510)  
[^10]: [TimeZoneNotFoundException in DateTime.Now #8090 - GitHub](https://github.com/xamarin/xamarin-android/issues/8090)  
[^11]: [TimeZoneInfo.Unix.cs - GitHub](https://github.com/dotnet/corert/blob/master/src/System.Private.CoreLib/shared/System/TimeZoneInfo.Unix.cs)  
[^12]: [Abstracting System Time in ASP.NET Applications - Redgate](https://www.red-gate.com/simple-talk/development/dotnet-development/abstracting-system-time-asp-net-applications/)  
[^13]: [TimeZoneNotFoundException on calling DateTimeOffset.Now #5080](https://github.com/dotnet/android/issues/5080)  
[^14]: [mono/mcs/class/corlib/System/TimeZoneInfo.Android.cs at main](https://github.com/mono/mono/blob/master/mcs/class/corlib/System/TimeZoneInfo.Android.cs)  
[^15]: [[Bug] Occasional crash in TouchEffect because of wrong time zone #1999](https://github.com/xamarin/XamarinCommunityToolkit/issues/1999)  
[^16]: [Stopwatch is more efficient than DateTime.Now - Doug Linder](https://vathsalas.wordpress.com/2015/02/12/stopwatch-is-more-efficient-than-datetime-now/)  
[^17]: [C# SDK Release Notes - Realtime 5 - Photon Fusion 2](https://doc.photonengine.com/realtime/v5/getting-started/release-notes)  
[^18]: [Changelog | Project Auditor | 0.10.0 - Unity - Manual](https://docs.unity3d.com/Packages/com.unity.project-auditor@0.10/changelog/CHANGELOG.html)  
[^19]: [[Unity] Project Auditor로 프로젝트 최적화하기 - 조다록 - 티스토리](https://zodang.tistory.com/82)  
[^20]: [TimeProvider and ITimer: Writing Unit Tests with Time in .NET 8](https://www.infoq.com/articles/dotnet-unit-tests-time-timezone/)  
[^21]: [How frequent is DateTime.Now updated ? or is there a more precise - Stack Overflow](https://stackoverflow.com/questions/307582/how-frequent-is-datetime-now-updated-or-is-there-a-more-precise-api-to-get-the)  
[^22]: [Is Update() called on the very first frame in Unity? - GameDev Stack Exchange](https://gamedev.stackexchange.com/questions/163058/is-update-called-on-the-very-first-frame-in-unity)  
[^23]: [Is there an equivalent of Time.frameCount for physics updates? - Unity Discussions](https://discussions.unity.com/t/is-there-an-equivalent-of-time-framecount-for-physics-updates/160506)  
[^24]: [UniTask.Delay restricted to main thread? · Issue #96 - GitHub](https://github.com/Cysharp/UniTask/issues/96)  
[^25]: [Time and frame rate management - Unity - Manual](https://docs.unity3d.com/2021.3/Documentation/Manual/TimeFrameManagement.html)  
[^26]: [Manual: Time and Framerate Management - Unity](https://docs.unity.cn/520/Documentation/Manual/TimeFrameManagement.html)  
[^27]: [What runs more often? Update, FixedUpdate or OnGUI - Unity Discussions](https://discussions.unity.com/t/what-runs-more-often-update-fixedupdate-or-ongui-documentation-mistake/475289)  
[^28]: [Simple server time anti-cheat • Cloud Code - Unity Documentation](https://docs.unity.com/en-us/cloud-code/scripts/use-cases/server-time-anti-cheat)  
[^29]: [Time synchronization | Unity NetCode | 0.0.4-preview.0](https://docs.unity3d.com/Packages/com.unity.netcode@0.0/manual/time-synchronization.html)  
[^30]: [System.DateTime.now and how to avoid time cheats (468724) - Unity Discussions](https://discussions.unity.com/t/system-datetime-now-and-how-to-avoid-time-cheats-468724/468724)  
[^31]: [Unity, NTP time, gets blocked - Stack Overflow](https://stackoverflow.com/questions/29220820/unity-ntp-time-gets-blocked)  
[^32]: [ZLogger v2 Architecture: Leveraging .NET 8 to Maximize Performance](https://neuecc.medium.com/zlogger-v2-architecture-leveraging-net-8-to-maximize-performance-2d9733b43789)  
[^33]: [Microsoft.Extensions.TimeProvider.Testing 10.7.0 - NuGet](https://www.nuget.org/packages/Microsoft.Extensions.TimeProvider.Testing/10.7.0)  
[^34]: [ZLogger v2 による .NET 8活用事例 と Unity C# 11対応の紹介](https://neue.cc/2023/12/19_zlogger2.html)  
[^35]: [referencesource/mscorlib/system/datetimeoffset.cs at main - GitHub](https://github.com/microsoft/referencesource/blob/master/mscorlib/system/datetimeoffset.cs)
