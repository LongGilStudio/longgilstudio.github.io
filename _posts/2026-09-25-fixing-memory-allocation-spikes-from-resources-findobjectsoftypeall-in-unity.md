---
title: "Unity Performance Optimization: Understanding and Fixing Memory Allocation (GC Alloc) Spikes from Resources.FindObjectsOfTypeAll"
date: 2026-09-25 09:26:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, memory, gc-alloc, csharp, dotnet, beginner-guide]
description: A detailed beginner-friendly guide to why overusing Resources.FindObjectsOfTypeAll causes frame spikes and stuttering in Unity, along with the four best optimization techniques to eliminate GC allocations.
lang: en
translation_id: unity-gc-alloc-resources-findobjectsoftypeall
math: true
---

During game development in Unity, you have almost certainly encountered situations where you need to locate a specific `GameObject` or `Component`. Unity provides several APIs for this, such as `Find`, `FindObjectOfType`, and especially `Resources.FindObjectsOfTypeAll`.

Although `Resources.FindObjectsOfTypeAll` is extraordinarily powerful because it can find **everything** (including inactive objects, prefabs sitting in project folders, and assets that have not been spawned), it is also one of the silent "killers" of your game's performance if used improperly.

This article explains why this method is so dangerous, how diagnostic tools (Profiler / Project Auditor) flag it, and walks through the exact optimization methods to completely eliminate managed memory garbage (Garbage Collection Allocation — GC Alloc).

---

## **1. Why Does `Resources.FindObjectsOfTypeAll` Hurt Performance?**

When running the Unity Memory Profiler or Project Auditor, you may encounter a yellow (Moderate) warning:
> *"Resources.FindObjectsOfTypeAll() allocates managed memory."*

To understand why, we need to look at how this method operates under the hood inside the engine (C++ core):

1. **Full Memory Scan (Heavy CPU Cost)**: Unlike `FindObjectOfType`, which only scans active objects in the loaded Scene, `Resources.FindObjectsOfTypeAll` scans the **entire** engine memory. It iterates through all Scene objects, Editor objects (when running in the Editor), and all Assets currently loaded into RAM. The larger your project becomes, the slower this call executes.
2. **Garbage Memory Creation (GC Allocation)**: Every single time this method finishes executing, it **always** allocates a brand-new `Array` on the C# Managed Heap to hold the returned results.

**The Consequence:** If you invoke this method repeatedly (for example, inside `Update()`, or every time a UI button is clicked), you are continuously dumping garbage (discarded arrays) into memory. Once memory fills up, Unity's Garbage Collector (GC) is forced to run. That collection pass briefly freezes the game, producing an unpleasant **stuttering** effect for players.

---

## **2. Four Optimization Methods (Best Practices)**

To resolve this issue once and for all, depending on your use case, you can apply one of the following four proven best practices distilled from Unity optimization engineers.

### **Method 1: Direct Reference via the Inspector (Most Recommended)**
The fastest approach—costing 0 CPU and 0 RAM—is to **avoid searching altogether**. Instead of writing code to look up an object at runtime, declare a `public` or `[SerializeField]` field and drag-and-drop the object into it directly inside the Unity Inspector.

```csharp
// ❌ AVOID: Expensive lookup
void Start() {
    // This call causes GC Alloc
    myManager = (GameManager)Resources.FindObjectsOfTypeAll(typeof(GameManager))[0]; 
}

// ✅ BEST: Direct Inspector reference
[SerializeField] private GameManager myManager; 
// (Drag and drop GameManager into this slot in the Unity Editor)
```

### **Method 2: Caching and the Singleton Pattern**
If you must look up an object in code, **search only once** (for example, in `Awake()` or `Start()`), then cache the reference in a variable for all subsequent uses.

For shared systems such as `UIManager` or `AudioManager`, use the Singleton pattern or a static property for global access with zero lookup overhead.

```csharp
// ❌ AVOID: Repeatedly searching every time text is needed
public string GetLocalizedText(string key) {
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetText(key);
}

// ✅ BETTER: Cache into a static variable (search only once)
public static UIManager SharedUIManager;

void Awake() {
    if (SharedUIManager == null) 
        SharedUIManager = FindAnyObjectByType<UIManager>(); // Search once
}

public string GetLocalizedText(string key) {
    return SharedUIManager.GetText(key); // Instant reuse, zero overhead
}
```

### **Method 3: Upgrading to Modern Unity 6 APIs**
Previously, in early Unity 2023 releases when replacing `FindObjectsOfType`, Unity used the `FindObjectsSortMode` enum:

```csharp
// ⚠️ Legacy (Unity 2023.1 - 2023.2):
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
```

However, **starting from Unity 6 onward, the `FindObjectsSortMode` enum has officially been marked Deprecated / Obsolete** as the engine transitioned from 32-bit `InstanceID`s to a new object identification mechanism and removed sorting overhead to maximize performance.

According to official Unity 6 documentation, you should use the following standardized overloads:

```csharp
// ❌ Legacy (Unity 2022 and earlier - Slow, forces array sorting)
var managers = FindObjectsOfType<GameManager>();

// ✅ Unity 6 Standard: Get any single object (Fastest, Zero-Alloc)
// Does not allocate an array on the Heap; returns the first matching object immediately
var manager = FindAnyObjectByType<GameManager>(); 

// ✅ Unity 6 Standard: Get multiple objects (No obsolete SortMode parameter needed)
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude);
```

> 💡 **Tip:** `FindAnyObjectByType<T>()` is much faster than `FindFirstObjectByType<T>()` when you only have a single instance (such as a Manager or Controller), because it does not care about hierarchy order and immediately returns the first matching object found.

#### ⚠️ **Common Misconception: Does `Resources.FindObjectsOfTypeNonAlloc` Exist?**
Many developers are familiar with Unity's array-reusing APIs (such as `Physics.RaycastNonAlloc` or `GetComponentsNonAlloc`) and assume that `Resources` has a similar `NonAlloc` variant.
In reality, per Unity's official documentation: **There is NO `Resources.FindObjectsOfTypeNonAlloc` method whatsoever**. `Resources.FindObjectsOfTypeAll` will **always** allocate a new array on the Managed Heap every time it is called.

If you need to track a list of all objects in the Scene while achieving **absolute zero GC Alloc**, use the **Static Registration Pattern**:

```csharp
// ✅ Zero GC Alloc solution: Self-register in a static list on enable
public class Enemy : MonoBehaviour 
{
    // Shared static list reusing memory with no new allocations
    public static readonly List<Enemy> ActiveEnemies = new();

    void OnEnable()  => ActiveEnemies.Add(this);
    void OnDisable() => ActiveEnemies.Remove(this);
}

// Anywhere in the game that needs access:
// Use Enemy.ActiveEnemies directly — dozens of times faster than Find with 0 GC Alloc!
```

### **Method 4: Wrapping Editor-Only Code with `#if UNITY_EDITOR`**
Sometimes you import an Asset Store plugin (e.g., an animation framework or UI toolkit) that contains `Resources.FindObjectsOfTypeAll`. More often than not, these calls only power utility buttons inside the Editor.

To prevent these methods from leaking into your final game build (Player Build) and triggering profiler or auditor warnings, wrap them in the `#if UNITY_EDITOR` preprocessor directive. The code inside will be completely stripped out when you export your game.

```csharp
#if UNITY_EDITOR 
// This code only runs inside the Unity Editor
// It is completely stripped when building to .exe or .apk
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    if (reOfType != null) return reOfType.ToList();
    return null;
}
#endif 
```

---

## **3. Real-World Case Studies: Fixing It Completely in Production**

To see how to apply these techniques in practice, let's examine the two most common scenarios where Unity Project Auditor or the Profiler flags GC allocations originating from third-party asset packages:

### **Scenario 1: UI Localization System Scanning All of RAM on Every Language Switch or Lookup**
* **Problem**: Whenever a piece of UI text needs to be displayed or a UI sound plays, a helper method calls `Resources.FindObjectsOfTypeAll(typeof(UIManager))[0]`. As a result, every menu interaction scans all of RAM and allocates a throwaway array on the Managed Heap.
* **Solution**:
  1. Call `FindAnyObjectByType<UIManager>()` once during initialization (`Awake`).
  2. Expose a static `SharedUIManager` property to cache the reference, turning the lookup into an instant $O(1)$ access with **0 bytes of garbage**.

```csharp
// ❌ BEFORE: Scans all of memory and creates garbage on every call
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetLocalizedText(tableID, tableKey);
}

// ✅ AFTER: Uses static cache (Zero GC Alloc)
public class LocalizationManager : MonoBehaviour 
{
    public static LocalizationManager instance;
    public UIManager UIManagerAsset;

    // Fast-access cache for the entire game
    public static UIManager SharedUIManager => instance != null ? instance.UIManagerAsset : null;

    void Awake() 
    {
        instance = this;
        // Use Unity 6 API to search once without array allocation
        if (UIManagerAsset == null) 
            UIManagerAsset = FindAnyObjectByType<UIManager>(); 
    }
}

// Anywhere text is needed, simply read from the Cache:
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = LocalizationManager.SharedUIManager;
    return tempUIM != null ? tempUIM.GetLocalizedText(tableID, tableKey) : null;
}
```

---

### **Scenario 2: Third-Party Editor Utilities Leaking Into the Runtime Build**
* **Problem**: Many tool packages (such as Animation or Level Design systems) include `Resources.FindObjectsOfTypeAll` helpers to power Reset or Setup buttons in the Editor. Even if gameplay code never calls them, leaving this code exposed in runtime assemblies causes Unity to flag the Player Build with GC Alloc warnings.
* **Solution**: Wrap the entire asset-lookup block in the `#if UNITY_EDITOR` preprocessor directive. When you build the game into an executable package (`.exe`, `.apk`), Unity automatically strips those lines completely from the runtime build.

```csharp
// ❌ BEFORE: Editor asset-search code exposed in Runtime
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}

// ✅ AFTER: Wrapped in the #if UNITY_EDITOR preprocessor directive
#if UNITY_EDITOR
// This block exists only in the Unity Editor and is 100% stripped from final builds
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}
#endif
```

---

## **Conclusion**

For newcomers to Unity, "Memory Garbage" (GC Allocation) can feel abstract because C# handles cleanup automatically. In game programming, however, continuously generating garbage leads directly to visible stuttering on screen.

The golden rule: **Stay away from the `Find` family of methods (especially `Resources.FindObjectsOfTypeAll`) inside tight loops like `Update()` or frequently triggered events.** Prioritize direct Inspector references, leverage caching (Cache / Singleton), upgrade to the Unity 6 standard API (`FindAnyObjectByType`), and guard Editor-only utilities behind `#if UNITY_EDITOR`. Optimizing these small details early will help your game maintain a rock-solid 60 FPS across every target device!
