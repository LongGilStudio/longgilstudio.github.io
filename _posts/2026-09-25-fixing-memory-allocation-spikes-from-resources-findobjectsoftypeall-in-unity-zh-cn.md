---
title: "Unity 性能优化：理解并解决 Resources.FindObjectsOfTypeAll 导致的内存分配（GC Alloc）飙升问题"
date: 2026-09-25 09:26:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, memory, gc-alloc, csharp, dotnet, beginner-guide]
description: "面向初学者的详细指南：剖析在 Unity 中滥用 Resources.FindObjectsOfTypeAll 导致卡顿掉帧（frame spike）的根本原因，并介绍 4 种最标准的优化方法。"
lang: zh-CN
translation_id: unity-gc-alloc-resources-findobjectsoftypeall
math: true
---

在使用 Unity 开发游戏的过程中，你肯定遇到过需要查找某个 `GameObject` 或 `Component` 的情况。Unity 为此提供了很多方法，比如 `Find`、`FindObjectOfType`，尤其是 `Resources.FindObjectsOfTypeAll`。

尽管 `Resources.FindObjectsOfTypeAll` 非常强大，因为它可以找到**所有对象**（包括处于未激活状态——inactive——的对象、文件夹中的预制体，或是尚未生成出来的资源），但如果使用不当，它也会成为悄悄扼杀你游戏性能的“隐形杀手”之一。

本文将帮助你深入理解为什么这个方法如此危险、性能分析工具（Profiler / Project Auditor）会如何发出警告，并详细讲解各种优化方法，助你彻底消除托管内存垃圾（Garbage Collection Allocation，简称 GC Alloc）。

---

## **1. 为什么 `Resources.FindObjectsOfTypeAll` 会损害性能？**

当你运行 Unity Memory Profiler 或 Project Auditor 时，可能会遇到这样一条黄色（Moderate，中等）警告：
> *"Resources.FindObjectsOfTypeAll() allocates managed memory."*

要理解背后的原因，我们需要看看这个方法在引擎底层（C++ 核心）是如何运作的：

1. **扫描整个内存（极高的 CPU 开销）**：与只扫描场景（Scene）中处于激活状态对象的 `FindObjectOfType` 不同，`Resources.FindObjectsOfTypeAll` 会扫描引擎的**整个**内存。它会遍历所有 Scene 对象、Editor 对象（如果在编辑器中运行），以及所有已加载到内存（RAM）中的资源（Assets）。项目越庞大，这个函数执行起来就越慢。
2. **制造内存垃圾（GC Allocation）**：每次这个函数执行完毕后，它**总是**会在 C# 的托管堆（Managed Heap）上创建一个全新的数组（Array），用来存放返回结果。

**后果：** 如果你频繁调用这个方法（例如在 `Update()` 中，或每次点击 UI 按钮时），你就是在不断地向内存中倾倒垃圾（旧数组）。当垃圾堆满时，Unity 的垃圾回收器（Garbage Collector — GC）就会被强制触发。这个清理过程会让游戏短暂卡住，给玩家带来非常糟糕的**卡顿掉帧（stuttering）**体验。

---

## **2. 4 种优化方法（最佳实践）**

要彻底解决这个问题，根据具体场景的不同，你可以采用以下 4 种由 Unity 性能优化工程师总结出的标准最佳实践之一。

### **方法 1：通过 Inspector 面板直接引用（最推荐）**
最快且消耗 0 CPU / 内存的方法，就是**根本不去查找**。与其写代码去搜索对象，不如声明一个 `public` 或 `[SerializeField]` 字段，然后直接从 Unity 的 Inspector 界面把对象拖拽进去。

```csharp
// ❌ 避免：开销高昂的查找
void Start() {
    // 这个函数会产生 GC Alloc
    myManager = (GameManager)Resources.FindObjectsOfTypeAll(typeof(GameManager))[0]; 
}

// ✅ 最佳：直接引用
[SerializeField] private GameManager myManager; 
// （在 Unity Editor 中将 GameManager 拖放到这个槽位中）
```

### **方法 2：缓存（Caching）与单例模式（Singleton）**
如果你必须通过代码来查找，**应该只查找一次**（例如在 `Awake()` 或 `Start()` 中），然后将其保存（缓存）到一个变量中，供后续使用。

对于 `UIManager` 或 `AudioManager` 这类全局共享的系统，请使用单例模式（Singleton）或静态属性（Static Property）来实现全局访问，从而避免重复查找的开销。

```csharp
// ❌ 避免：每次需要文本时都重复调用查找函数
public string GetLocalizedText(string key) {
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetText(key);
}

// ✅ 更好：缓存到 static 变量中（只查找 1 次）
public static UIManager SharedUIManager;

void Awake() {
    if (SharedUIManager == null) 
        SharedUIManager = FindAnyObjectByType<UIManager>(); // 只查找 1 次
}

public string GetLocalizedText(string key) {
    return SharedUIManager.GetText(key); // 立即复用，0 额外开销
}
```

### **方法 3：升级到 Unity 6 现代 API**
此前在 Unity 2023 早期版本中，用于替代 `FindObjectsOfType` 时，Unity 曾使用过 `FindObjectsSortMode` 枚举：

```csharp
// ⚠️ 旧版（Unity 2023.1 - 2023.2）：
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
```

然而，**从 Unity 6 开始，`FindObjectsSortMode` 枚举已被正式标记为过时（Deprecated / Obsolete）**，因为引擎已从 32 位 `InstanceID` 迁移到了新的对象标识机制，并去除了排序开销以最大化性能。

根据 Unity 6 的官方文档，你应当使用以下标准化的重载（overload）方法：

```csharp
// ❌ 旧版（Unity 2022 及更早版本 —— 慢，强制对数组进行排序）
var managers = FindObjectsOfType<GameManager>();

// ✅ Unity 6 标准：获取任意 1 个对象（最快，Zero-Alloc）
// 不在堆上分配数组，直接返回找到的第一个对象
var manager = FindAnyObjectByType<GameManager>(); 

// ✅ Unity 6 标准：获取多个对象列表（无需已废弃的 SortMode 参数）
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude);
```

> 💡 **提示：** 如果你只有一个实例（例如 Manager / Controller），`FindAnyObjectByType<T>()` 的性能要远优于 `FindFirstObjectByType<T>()`，因为它不关心层级（Hierarchy）顺序，会直接返回找到的第一个对象。

#### ⚠️ **常见误区：是否存在 `Resources.FindObjectsOfTypeNonAlloc`？**
很多开发者熟悉 Unity 中复用数组的函数（如 `Physics.RaycastNonAlloc` 或 `GetComponentsNonAlloc`），因而以为 `Resources` 也有类似的 `NonAlloc` 版本。
事实上，根据 Unity 官方文档：**完全不存在 `Resources.FindObjectsOfTypeNonAlloc` 这个函数**。每次调用 `Resources.FindObjectsOfTypeAll` 时，它**总是**会在托管堆上分配一个新数组。

如果你需要跟踪场景中的所有对象列表，同时又想实现**绝对的 0 GC Alloc**，请使用**静态注册模式（Static Registration Pattern）**：

```csharp
// ✅ Zero GC Alloc 方案：激活时自动向列表注册
public class Enemy : MonoBehaviour 
{
    // 全局共享的静态列表，复用内存而不产生新的分配
    public static readonly List<Enemy> ActiveEnemies = new();

    void OnEnable()  => ActiveEnemies.Add(this);
    void OnDisable() => ActiveEnemies.Remove(this);
}

// 游戏中任何需要访问的地方：
// 直接使用 Enemy.ActiveEnemies —— 比 Find 快几十倍，且完全 0 GC Alloc！
```

### **方法 4：用 `#if UNITY_EDITOR` 包裹仅限编辑器使用的代码**
有时你从 Asset Store 下载了一个插件（例如动画系统、UI 工具），里面包含了 `Resources.FindObjectsOfTypeAll`。通常这些函数只是用来支持开发环境中（Editor）的便捷按钮功能。

为了防止这些函数“溜进”最终的游戏打包产物（Build Player）并引发警告，你可以用预处理指令 `#if UNITY_EDITOR` 将它们包裹起来。当你导出游戏时，里面的代码会被彻底剔除。

```csharp
#if UNITY_EDITOR 
// 这段代码仅在 Unity Editor 中工作时运行
// 打包生成 .exe、.apk 文件时会被完全移除
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    if (reOfType != null) return reOfType.ToList();
    return null;
}
#endif 
```

---

## **3. 实战案例：在游戏项目中彻底解决该问题**

为了更清楚如何在实际项目中应用，让我们来看两个当项目被 Unity Project Auditor 或 Profiler 警告存在第三方资源包内存垃圾时最常见的场景：

### **场景 1：UI 本地化系统在每次切换语言或获取文本时反复扫描内存**
* **问题**：每当需要显示一段 UI 文本或播放界面音效时，辅助函数就会调用 `Resources.FindObjectsOfTypeAll(typeof(UIManager))[0]`。这导致每次打开菜单操作都会扫描整个内存并在堆上生成垃圾数组。
* **解决方案**：
  1. 在初始化时（`Awake`）使用 `FindAnyObjectByType<UIManager>()` 仅查找一次。
  2. 创建一个静态属性 `SharedUIManager` 来保存缓存（cache），将查找操作转变为耗时 $O(1)$ 且产生 **0 字节垃圾**的即时访问。

```csharp
// ❌ 优化前：每次调用函数都扫描整个内存并产生垃圾
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetLocalizedText(tableID, tableKey);
}

// ✅ 优化后：利用静态缓存（Zero GC Alloc）
public class LocalizationManager : MonoBehaviour 
{
    public static LocalizationManager instance;
    public UIManager UIManagerAsset;

    // 供整个游戏快速访问的缓存
    public static UIManager SharedUIManager => instance != null ? instance.UIManagerAsset : null;

    void Awake() 
    {
        instance = this;
        // 使用 Unity 6 API 仅查找 1 次，不分配数组
        if (UIManagerAsset == null) 
            UIManagerAsset = FindAnyObjectByType<UIManager>(); 
    }
}

// 任何需要获取文本的地方，只需通过缓存调用：
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = LocalizationManager.SharedUIManager;
    return tempUIM != null ? tempUIM.GetLocalizedText(tableID, tableKey) : null;
}
```

---

### **场景 2：第三方编辑器辅助工具代码漏入游戏打包版本**
* **问题**：许多工具包（例如动画或关卡设计系统）都自带使用 `Resources.FindObjectsOfTypeAll` 的资源查找函数，以支持 Editor 中的 Reset 或 Setup 按钮。即使游戏核心玩法逻辑从未调用过它们，把这些代码暴露在运行时（runtime）源码中依然会导致 Unity 在构建游戏（Player Build）时标记 GC Alloc 警告。
* **解决方案**：用预处理指令 `#if UNITY_EDITOR` 包裹整段查找代码。当你将游戏构建成安装包（`.exe`、`.apk`）时，Unity 会自动从运行时中彻底裁剪掉这些代码行。

```csharp
// ❌ 优化前：Editor 资源查找代码暴露在运行时中
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}

// ✅ 优化后：使用 #if UNITY_EDITOR 预处理指令包裹
#if UNITY_EDITOR
// 此代码块仅存在于 Unity Editor 中，打包游戏时会被 100% 移除
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}
#endif
```

---

## **总结**

对于刚接触 Unity 的开发者来说，“内存垃圾”（GC Allocation）是一个比较抽象的概念，因为 C# 会自动完成清理工作。然而在游戏编程中，持续制造内存垃圾会直接导致屏幕上肉眼可见的卡顿。

黄金法则：**在 `Update()` 等循环或频繁触发的事件中，远离 `Find` 系列函数（尤其是 `Resources.FindObjectsOfTypeAll`）。** 优先使用 Inspector 面板引用，善用缓存（Cache / Singleton），升级到 Unity 6 标准 API（`FindAnyObjectByType`），并用 `#if UNITY_EDITOR` 保护编辑器工具代码。从这些小细节入手进行优化，将帮助你的游戏在各种设备上都能稳定保持 60 FPS！
