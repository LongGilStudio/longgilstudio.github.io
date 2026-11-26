---
title: "Unity 效能最佳化：深入理解並解決 Resources.FindObjectsOfTypeAll 造成的記憶體配置（GC Alloc）暴衝問題"
date: 2026-09-25 09:26:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, memory, gc-alloc, csharp, dotnet, beginner-guide]
description: "專為初學者撰寫的詳細指南：解析在 Unity 中濫用 Resources.FindObjectsOfTypeAll 導致畫面卡頓（frame spike）的根本原因，並提供 4 種最標準的最佳化做法。"
lang: zh-TW
translation_id: unity-gc-alloc-resources-findobjectsoftypeall
math: true
---

在透過 Unity 開發遊戲的過程中，你一定曾經遇過需要搜尋某個 `GameObject` 或 `Component` 的情況。Unity 提供了許多函式，例如 `Find`、`FindObjectOfType`，以及特別強大的 `Resources.FindObjectsOfTypeAll`。

雖然 `Resources.FindObjectsOfTypeAll` 功能非常強大，因為它能找到**所有東西**（包含處於停用狀態——inactive——的物件、資料夾中的 Prefab，或是尚未生成的資源），但如果沒有正確使用，它往往會成為悄悄拖垮遊戲效能的「隱形殺手」。

這篇文章將帶你徹底了解為什麼這個函式如此危險、效能分析工具（Profiler / Project Auditor）會如何發出警告，並詳細示範各種最佳化方法，以徹底消除託管記憶體垃圾（Garbage Collection Allocation，簡稱 GC Alloc）。

---

## **1. 為什麼 `Resources.FindObjectsOfTypeAll` 會傷害效能？**

當你執行 Unity Memory Profiler 或 Project Auditor 時，可能會看到這條黃色（Moderate，中度）警告：
> *"Resources.FindObjectsOfTypeAll() allocates managed memory."*

為了理解背後原因，我們必須看看這個函式在引擎底層（C++ 核心）是如何運作的：

1. **掃描整個記憶體（極高的 CPU 成本）**：不同於只掃描場景（Scene）中啟用物件的 `FindObjectOfType`，`Resources.FindObjectsOfTypeAll` 會掃描引擎的**全部**記憶體。它會走訪所有的 Scene 物件、Editor 物件（若在編輯器中執行），以及所有已載入 RAM 的資源（Assets）。專案規模越大，這個函式執行起來就越慢。
2. **製造記憶體垃圾（GC Allocation）**：每次這個函式執行結束時，它**總是**會在 C# 的託管堆積（Managed Heap）上配置一個全新的陣列（Array），用來存放回傳的結果。

**後果：** 如果你頻繁呼叫這個函式（例如在 `Update()` 迴圈中，或每次點擊 UI 按鈕時），等於不斷往記憶體裡傾倒垃圾（舊陣列）。當垃圾累積滿載時，Unity 的垃圾回收機制（Garbage Collector — GC）就會被強制觸發。這個清理過程會讓遊戲畫面短暫凍結，造成玩家非常不適的**畫面卡頓（stuttering）**現象。

---

## **2. 4 種最佳化方法（最佳實務）**

要從根本解決這個問題，你可以依據實際情境，套用以下 4 種由 Unity 效能最佳化工程師歸納出的標準做法。

### **方法 1：透過 Inspector 面板直接參照（最推薦）**
最快且消耗 0 CPU 與 0 記憶體的方式，就是**完全不要搜尋**。與其寫程式碼去尋找物件，不如宣告一個 `public` 或 `[SerializeField]` 欄位，再直接從 Unity 的 Inspector 介面把該物件拖曳進去。

```csharp
// ❌ 避免：成本高昂的搜尋
void Start() {
    // 這個函式會產生 GC Alloc
    myManager = (GameManager)Resources.FindObjectsOfTypeAll(typeof(GameManager))[0]; 
}

// ✅ 最佳做法：直接參照
[SerializeField] private GameManager myManager; 
// （在 Unity Editor 中將 GameManager 拖曳到此欄位）
```

### **方法 2：快取（Caching）與單例模式（Singleton）**
如果你非得在程式碼中搜尋，**應該只搜尋唯一一次**（例如在 `Awake()` 或 `Start()` 中），接著將結果儲存（快取）到一個變數裡，供後續重複使用。

對於 `UIManager` 或 `AudioManager` 這類共用的系統，請採用單例模式（Singleton）或靜態屬性（Static Property）來進行全域存取，完全省去搜尋成本。

```csharp
// ❌ 避免：每次需要文字時都重複呼叫搜尋函式
public string GetLocalizedText(string key) {
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetText(key);
}

// ✅ 更好的做法：快取到 static 變數中（僅搜尋 1 次）
public static UIManager SharedUIManager;

void Awake() {
    if (SharedUIManager == null) 
        SharedUIManager = FindAnyObjectByType<UIManager>(); // 只搜尋 1 次
}

public string GetLocalizedText(string key) {
    return SharedUIManager.GetText(key); // 立即重複使用，0 額外成本
}
```

### **方法 3：升級至 Unity 6 現代化 API**
過去在 Unity 2023 的早期版本中，用以取代 `FindObjectsOfType` 時，Unity 曾使用 `FindObjectsSortMode` 列舉（enum）：

```csharp
// ⚠️ 舊版（Unity 2023.1 - 2023.2）：
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
```

然而，**從 Unity 6 起，`FindObjectsSortMode` 列舉已正式被標記為過時（Deprecated / Obsolete）**，因為引擎已從 32 位元 `InstanceID` 轉換至全新的物件識別機制，並移除了排序步驟以發揮最大效能。

依據 Unity 6 官方文件，你應該改用下列標準化的多載（overload）函式：

```csharp
// ❌ 舊版（Unity 2022 及更早版本 —— 慢，強制對陣列進行排序）
var managers = FindObjectsOfType<GameManager>();

// ✅ Unity 6 標準：取得任意 1 個物件（最快，Zero-Alloc）
// 不在 Heap 上配置陣列，找到第一個物件便立即回傳
var manager = FindAnyObjectByType<GameManager>(); 

// ✅ Unity 6 標準：取得多個物件清單（不需已淘汰的 SortMode 參數）
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude);
```

> 💡 **小技巧：** 如果你只存在單一實例（例如 Manager / Controller），`FindAnyObjectByType<T>()` 會比 `FindFirstObjectByType<T>()` 更有效率，因為它不在乎階層視窗（Hierarchy）的順序，會直接回傳第一個找到的物件。

#### ⚠️ **常見誤解：是否存在 `Resources.FindObjectsOfTypeNonAlloc`？**
許多開發者熟悉 Unity 中重複使用陣列的函式（像是 `Physics.RaycastNonAlloc` 或 `GetComponentsNonAlloc`），進而誤以為 `Resources` 也有類似的 `NonAlloc` 函式。
事實上，根據 Unity 官方文件：**完全不存在 `Resources.FindObjectsOfTypeNonAlloc` 這個函式**。`Resources.FindObjectsOfTypeAll` 每次被呼叫時，**永遠**都會在 Managed Heap 上配置一個全新的陣列。

如果你需要追蹤場景中所有物件的清單，同時又要求**絕對的 0 GC Alloc**，請採用**靜態註冊模式（Static Registration Pattern）**：

```csharp
// ✅ Zero GC Alloc 解法：啟用時自動向清單註冊
public class Enemy : MonoBehaviour 
{
    // 共用的靜態清單，重複利用記憶體而不產生新配置
    public static readonly List<Enemy> ActiveEnemies = new();

    void OnEnable()  => ActiveEnemies.Add(this);
    void OnDisable() => ActiveEnemies.Remove(this);
}

// 遊戲中任何需要存取的地方：
// 直接使用 Enemy.ActiveEnemies —— 比 Find 快上數十倍且完全 0 GC Alloc！
```

### **方法 4：為編輯器工具程式碼加上 `#if UNITY_EDITOR` 區隔**
有時候你會從 Asset Store 下載外掛套件（例如動畫系統、UI 工具），而裡頭恰好包含 `Resources.FindObjectsOfTypeAll`。通常這類函式僅用來支援開發環境（Editor）中的便利按鈕。

為了避免這些函式「混入」最終的遊戲建置版本（Build Player）並觸發警告，你可以利用前置處理器指示詞 `#if UNITY_EDITOR` 將它們包覆起來。當你匯出遊戲時，裡面的程式碼將會被徹底剔除。

```csharp
#if UNITY_EDITOR 
// 這段程式碼只會在 Unity Editor 中作業時執行
// 建置成 .exe、.apk 檔案時會被完全移除
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    if (reOfType != null) return reOfType.ToList();
    return null;
}
#endif 
```

---

## **3. 實務案例：在遊戲專案中徹底根治問題**

為了更清楚如何在實務中應用，讓我們來看看當專案被 Unity Project Auditor 或 Profiler 警告出現來自第三方資源套件的記憶體垃圾時，最常見的 2 種情境：

### **情境 1：UI 在地化系統每次切換語言時反覆掃描記憶體**
* **問題**：每當需要顯示一段 UI 文字或播放介面音效時，輔助函式便會呼叫 `Resources.FindObjectsOfTypeAll(typeof(UIManager))[0]`。這使得每次開啟選單的操作都會掃描整個 RAM，並在 Heap 上產生垃圾陣列。
* **處理方式**：
  1. 在初始化階段（`Awake`）使用 `FindAnyObjectByType<UIManager>()` 僅搜尋一次。
  2. 建立一個靜態屬性 `SharedUIManager` 來保存快取（cache），將搜尋動作轉化為時間複雜度 $O(1)$ 且產生 **0 位元組垃圾**的即時存取。

```csharp
// ❌ 最佳化前：每次呼叫函式都掃描整個記憶體並製造垃圾
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetLocalizedText(tableID, tableKey);
}

// ✅ 最佳化後：善用靜態快取（Zero GC Alloc）
public class LocalizationManager : MonoBehaviour 
{
    public static LocalizationManager instance;
    public UIManager UIManagerAsset;

    // 供整個遊戲快速存取的快取
    public static UIManager SharedUIManager => instance != null ? instance.UIManagerAsset : null;

    void Awake() 
    {
        instance = this;
        // 使用 Unity 6 API 僅搜尋 1 次，不配置陣列
        if (UIManagerAsset == null) 
            UIManagerAsset = FindAnyObjectByType<UIManager>(); 
    }
}

// 任何需要取得文字的地方，只需透過快取呼叫：
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = LocalizationManager.SharedUIManager;
    return tempUIM != null ? tempUIM.GetLocalizedText(tableID, tableKey) : null;
}
```

---

### **情境 2：第三方編輯器工具程式碼漏入遊戲建置版本**
* **問題**：許多工具套件（例如動畫或關卡設計系統）都內建了使用 `Resources.FindObjectsOfTypeAll` 的資源搜尋函式，用來支援 Editor 中的 Reset 或 Setup 按鈕。即使遊戲遊玩邏輯從未呼叫過它們，只要這段程式碼裸露在執行階段（runtime）原始碼中，依然會讓 Unity 在建置遊戲（Player Build）時標記 GC Alloc 警告。
* **處理方式**：使用前置處理器指示詞 `#if UNITY_EDITOR` 將整段搜尋程式碼包覆起來。當你把遊戲建置為執行檔（`.exe`、`.apk`）時，Unity 會自動將這些程式碼從執行階段完全切除。

```csharp
// ❌ 最佳化前：Editor 資源搜尋程式碼裸露在執行階段中
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}

// ✅ 最佳化後：以 #if UNITY_EDITOR 前置處理器指示詞包覆
#if UNITY_EDITOR
// 此程式碼區塊僅存在於 Unity Editor 中，建置遊戲時會 100% 被移除
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}
#endif
```

---

## **結論**

對於剛接觸 Unity 的開發者而言，「記憶體垃圾」（GC Allocation）是一個相當抽象的概念，因為 C# 會自動完成清理作業。然而在遊戲程式設計中，持續產生垃圾將直接導致螢幕上顯而易見的卡頓現象。

黃金準則：**在 `Update()` 等迴圈或頻繁觸發的事件中，遠離 `Find` 家族函式（特別是 `Resources.FindObjectsOfTypeAll`）。** 優先採用 Inspector 面板參照、善用快取（Cache / Singleton）、升級至 Unity 6 標準 API（`FindAnyObjectByType`），並以 `#if UNITY_EDITOR` 包覆編輯器工具程式碼。從這些小細節著手進行最佳化，將能幫助你的遊戲在各種裝置上都穩定維持 60 FPS！
