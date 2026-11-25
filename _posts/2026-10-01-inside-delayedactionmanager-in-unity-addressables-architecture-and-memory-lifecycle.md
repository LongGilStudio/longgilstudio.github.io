---
title: "Deep Technical Report: Architecture, Execution Lifecycle, and Memory Impact of DelayedActionManager in Unity Addressables"
date: 2026-10-01 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, addressables, memory-management, async, delayedactionmanager, optimization]
description: An in-depth analysis of DelayedActionManager's ComponentSingleton architecture in Unity Addressables, LateUpdate scheduling, C#/C++ proxy exceptions, and AssetBundle memory best practices.
lang: en
translation_id: unity-addressables-delayedactionmanager
---

The Addressable Asset System (commonly known as Addressables) represents a revolutionary architectural step forward in Unity, delivering a flexible, robust, and optimized content management solution built atop traditional AssetBundles[^1]. When engineering and operating large-scale games or interactive applications, managing asynchronous data pipelines to automatically load and release assets is a fundamental requirement. One of the core components handling this complex responsibility—yet frequently puzzling software engineers inspecting the Hierarchy—is an automatically spawned object named `DelayedActionManager` residing inside the `DontDestroyOnLoad` scene[^2].

This technical report provides a comprehensive architectural dissection of `DelayedActionManager`, explaining why it exists inside `DontDestroyOnLoad`, analyzing its execution flow within Unity's real-time PlayerLoop, and examining memory management challenges, memory leaks, and common threading or lifecycle exceptions. Through system design analysis and proven best practices, this document equips software architects to maximize application stability.

## The Evolution of Asset Loading and Asynchronous Foundations

Before diving into the micro-architecture of `DelayedActionManager`, understanding the context behind Addressables is essential. In older Unity versions, developers commonly relied on the `Resources` folder or raw AssetBundle scripts[^4]. `Resources.Load()` behaves like walking into a warehouse manually: it requires an exact directory path and blocks the main thread until the asset is located and loaded into memory[^4]. The drawback of this synchronous approach is that it prevents scalability and triggers severe FPS drops when handling large datasets.

To solve this, Addressables operates like a modern logistics service. Developers only provide an asset identifier (address/key), and the system automatically resolves whether to fetch the asset from local storage or download it from a Content Delivery Network (CDN)[^4]. Crucially, this entire lifecycle executes asynchronously. Loading calls such as `Addressables.LoadAssetAsync` do not return the asset immediately; instead, they return a handle known as `AsyncOperationHandle`[^4]. This interface exposes completion callbacks when the asset is ready, allowing the main thread to continue executing physics and rendering logic uninterrupted[^4].

Shifting from a fully synchronous to an asynchronous model introduces a major architectural challenge: when an asset download takes several seconds over slow network bandwidth, the application may have already transitioned into an entirely different scene[^1]. Managing callbacks, command queues, and reference counts requires a central coordinator unaffected by the creation and destruction lifecycle of regular scenes. That is precisely why Unity engineers integrated the `DontDestroyOnLoad` pattern into the core of Addressables.

## The DontDestroyOnLoad (DDOL) Scene and Global Persistence Architecture

In Unity, loading a new scene (via `SceneManager.LoadScene` in default Single mode) automatically triggers memory cleanup. The engine destroys all `GameObject` and `Component` instances belonging to the previous scene to release unused resources[^7]. Although additive scene loading allows multiple scenes to coexist to manage global state (for instance, one scene dedicated to a Game Manager and another to a Level), `DontDestroyOnLoad` (DDOL) remains a critical low-level mechanism for protecting persistent system objects[^7].

The appearance of the `DontDestroyOnLoad` scene in the Unity Editor Hierarchy upon entering Play Mode is not a bug—it is a built-in engine mechanism that groups objects marked to survive scene transitions[^9]. For a `GameObject` to enter this protected space, Unity enforces a strict rule: the object must sit at the root level of the scene hierarchy[^8]. Any attempt to call `DontDestroyOnLoad(gameObject)` on a nested child object fails and logs a warning[^8].

For Addressables, asset loading and unloading operations span across multiple scenes. For example, tracking the download progress of a remote AssetBundle cannot simply be aborted because the player walked through a level-transition portal. Using `RuntimeInitializeOnLoadMethod` combined with an enhanced Singleton pattern allows Addressables to instantiate a root object and move it into DDOL automatically[^2]. This explains why, even without writing a single line of DDOL code, an object named `DelayedActionManager` appears in the bottom-left corner of the scene hierarchy[^2].

## Internal Structure and Technical Role of DelayedActionManager

Inspecting the source code and API documentation of the Addressables package reveals that `DelayedActionManager` is a concrete class inside the `UnityEngine.ResourceManagement.Util` namespace[^11]. Rather than being a simple static utility class, it is a `Component` attached directly to a `GameObject` via inheritance from a base singleton architecture[^12].

### The ComponentSingleton Pattern and Automatic Initialization

The architecture of `DelayedActionManager` is built upon `ComponentSingleton`, a foundational class defined in the same namespace[^13]. Implementing a Singleton as a Unity `Component` rather than a pure C# class gives the system direct access to Unity's real-time `PlayerLoop` events.

When `ResourceManager` receives its first load or state-update request (such as `Addressables.LoadAssetAsync` or diagnostic operations), it accesses the `DelayedActionManager` instance. At that moment, `ComponentSingleton` automatically executes a hidden sequence: it creates an empty `GameObject`, names it `"DelayedActionManager"`, attaches the script component, and immediately invokes `DontDestroyOnLoad` to place it in global persistence[^2]. This lazy initialization guarantees that system resources are consumed only when delayed-task management is actually needed—demystifying its "magical" appearance in the Hierarchy[^3].

### Scheduling Mechanism and LateUpdate Execution

The primary responsibility of `DelayedActionManager` is to serve as a central scheduler for delayed actions, callbacks, coroutines, and micro-level memory management[^11]. A subtle yet vital architectural detail is that all queue-processing logic is routed to execute inside Unity's `LateUpdate()` lifecycle phase[^11].

Choosing `LateUpdate` over traditional `Update` solves a deep architectural problem involving data consistency. The table below illustrates Unity's execution order and the role of `LateUpdate` in safeguarding Addressables state:

| PlayerLoop Execution Phase | Typical Responsibilities | Role in Addressables & DelayedActionManager |
| :--- | :--- | :--- |
| **FixedUpdate** | Physics simulation, static/dynamic collisions. | Game logic may trigger object destruction requests following collisions. |
| **Update** | Player input, movement, AI logic, gameplay state updates. | `Addressables.LoadAssetAsync` or `Release` are called manually; GameObjects may be passed to `Destroy()`. |
| **LateUpdate** | Camera positioning, post-processing adjustments. | `DelayedActionManager` cleans up memory, decrements reference counts, and invokes async callbacks without conflicting with `Update`-phase destructions[^11]. |

If `ResourceManager` invoked completion callbacks immediately mid-`Update`, it would risk interacting with subsystems (such as graphics or UI) that are in an intermediate, half-computed frame state. By deferring `OnComplete` callbacks and reference-count decrements until `LateUpdate()`, `DelayedActionManager` ensures that the frame's primary logic state has stabilized[^11]. Stack traces across production crash reports consistently show `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` as the final bridge before control returns to user code[^15].

## Dissecting System Exceptions and Stack Traces

Despite its defensive design, asynchronous complexity combined with improper object lifecycle handling often places `DelayedActionManager` at the center of serious runtime exceptions. Error logs offer critical clues about how the system interacts with managed memory versus native memory.

### NullReferenceException and C# – C++ Proxy Lifecycle Conflicts

A common failure scenario in Addressables is `ArgumentNullException: Value cannot be null. Parameter name: obj` originating from `DelayedActionManager`'s `StartCoroutine_Auto` method[^19]. This error is not an internal Unity bug; rather, it stems from the mismatch between C# Garbage Collection and native C++ pointer management underneath[^19].

In Unity, objects such as `GameObject` or `MonoBehaviour` are C# proxy wrappers holding an internal pointer to a native C++ engine object[^19]. When you call `Destroy(gameObject)`, the native C++ object is destroyed and freed, invalidating the internal pointer[^19]. However, the C# proxy object itself continues to exist in managed memory until the Garbage Collector collects it[^19].

Trouble erupts when developers pair anonymous lambda expressions (closures) with asynchronous Addressables operations. A lambda captures surrounding context variables. Consider the following pattern:

```csharp
// An action queued into DelayedActionManager
DelayedAction(null, () => {
    _crawlerRobot.BreakAwayLowerBody();
    if (isLevelLoad) {
        PhysicsUtil.ManualSimulation(2);
    }
});
```

When this runs, `_crawlerRobot` (a C# proxy) is captured by the closure[^19]. If gameplay logic destroys `_crawlerRobot` during that same frame, the native C++ pointer dies. When `DelayedActionManager` subsequently executes the queued lambda during `LateUpdate` (or a later frame), the callback attempts to invoke `BreakAwayLowerBody()` on a dead native pointer[^19]. The inevitable result is a `NullReferenceException` or `"The object of type '...' has been destroyed but you are still trying to access it"`[^19].

To eliminate this architectural hazard, engineers recommend two practices:

1. Avoid excessive nesting of lambda closures when mutating low-level scene state[^19].
2. Always perform Unity-aware null checks, taking advantage of Unity's overloaded `==` operator in C# that inspects the underlying native C++ pointer state[^19].

### PlayerLoop Conflicts and `"Assertion failed on expression: ShouldRunBehaviour()"`

Across various Addressables package versions, many developers have reported the Unity Editor flooding the console with a low-level assertion: `Assertion failed on expression: 'ShouldRunBehaviour()'` in `MonoBehaviour.cpp`[^3].

Stack traces point directly to the `DelayedActionManager` `GameObject` inside `DontDestroyOnLoad`[^3]. Root cause analysis reveals an Editor Play Mode lifecycle edge case: when the Editor undergoes a Domain Reload or when the user presses Stop before pending asset load queues finish, `DelayedActionManager` becomes stranded as an orphaned object[^3].

Because it is marked `DontDestroyOnLoad`, it attempts to continue running `LateUpdate` cycles and behaviour checks even after Unity's native `PlayerLoop` has signaled all behaviours to halt[^3]. This issue was particularly prominent when upgrading from Addressables `1.16.x` to `1.18.x`, prompting many teams at the time to downgrade to `1.17.17` to restore queue stability[^3].

### The Evolution of DelayedActionManager Across Package Versions

An interesting detail in Addressables changelogs is the cyclical presence of `DelayedActionManager`. Releases such as `0.7.5` and `1.11.2` explicitly stated in their build script refactoring notes: *"Removed DelayedActionManager. Removed ISceneProvider. Users can implement custom scene loading"*[^20]. This decision originally aimed to simplify the API surface and delegate control to custom `AsyncOperationBase` implementations[^20].

However, bug reports from post-LTS releases such as `1.18.15`, `1.19.19`, and `1.21.21` show the persistent return of `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` in stack traces[^11]. This reflects Unity's iterative engineering: after attempting to remove it, engine developers realized that lacking a centralized delayed-action manager created intractable issues for `DiagnosticEventCollector`, preload tables, and safe disposal during application shutdown[^11]. `DelayedActionManager` was redesigned and restored as an internal system utility—no longer exposed publicly in the UI, yet responsible for shutdown cleanup and deferred execution safety[^20].

## Reference Counting and Memory Leak Dynamics

The existence of `DelayedActionManager` is tightly coupled with one of Addressables' most intricate pillars: **Memory Management**. Rather than relying purely on the Garbage Collector, Addressables governs RAM residency through explicit **Reference Counting**[^23].

### Reference Dynamics and Bundle-Level Dependencies

Every load request increments an asset's reference count by 1. Once finished, calling `Addressables.Release` decrements that count by 1[^23]. The golden rule is that physical memory holding an asset can only be freed when its reference count reaches absolute zero[^23].

Complexity compounds because Addressables tracks dependencies at the **AssetBundle level**. Loading a single asset (such as a `Material`) automatically loads every AssetBundle containing its dependencies (such as a `Texture`)[^25]. Dependency graphs operate per bundle: if an asset in Bundle A references an asset in Bundle B, all of Bundle B must load into managed/native memory[^26].

Unity enforces one rigid architectural constraint here: **you cannot partially unload the contents of an AssetBundle**[^23]. Consider an AssetBundle named `"stuff"` containing three independent assets: `Tree`, `Tank`, and `Cow`[^23]:

1. When `Tree` is loaded, the Profiler displays a reference count of 1 for `Tree` and 1 for the `stuff` bundle[^23].
2. When `Tank` is subsequently loaded, `Tank`'s count becomes 1 and `stuff`'s count rises to 2[^23].
3. If the game calls `Release(Tree)`, `Tree`'s reference count drops to 0 and its bar disappears in the Profiler[^23].
4. Yet the physical data for `Tree` remains trapped in memory. Because `Tank` still keeps the `stuff` AssetBundle's reference count above 0, nothing inside that bundle is unloaded until the entire bundle hits 0[^23].

### "Asset Churn" Syndrome and Memory Bloat

When assets are repeatedly loaded, released, and immediately reloaded within short spans, it triggers **"Asset Churn"**[^23]. This commonly happens during level transitions: Level 1 uses `Boat` and Level 2 uses `Plane` (both sharing a `Camouflage` texture). Upon exiting Level 1, releasing `Boat` causes Addressables to unload `Camouflage` from memory. One millisecond later, Level 2 spawns `Plane`, forcing disk I/O to reload `Camouflage` from scratch[^23]. This produces severe frame-time spikes and pushes memory usage toward dangerous thresholds, especially on mobile hardware[^27].

Conversely, forgetting a single `Release` call leaks orphan references, causing RAM consumption to drift from hundreds of megabytes into gigabytes across just a few scene loads[^28]. Because neither `DelayedActionManager` nor Addressables tracks instances spawned via standard `MonoBehaviour.Instantiate`, any mismatch in handle tracking results in permanent memory leaks[^6].

### Compression Architecture and Memory Allocation Pressure

AssetBundle sizing and compression algorithms directly dictate how data occupies RAM. Choosing the right compression method determines whether a bundle consumes massive persistent memory or streams efficiently.

Summary of AssetBundle compression characteristics and memory impact[^29]:

| Compression Method | Local File Recognition | Requires Full Bundle Load into RAM | Performance & Storage Impact |
| :--- | :--- | :--- | :--- |
| **LZMA** | No. Compressed as one monolithic stream. | **Yes.** Must decompress the entire archive into memory. | Highest compression ratio and smallest download size, but causes severe Memory Bloat and heavy CPU spikes during extraction[^29]. |
| **LZ4** | Yes. Chunk-based compression. | **No.** Loads only the chunks currently accessed. | Recommended default. Enables direct disk caching without loading full metadata tables into RAM[^29]. |
| **Uncompressed** | Yes. Direct per-asset access. | **No.** Read directly. | Zero decompression overhead, largest file size. Ideal for instant local loading when disk bandwidth permits[^29]. |

Requesting one tiny asset from a massive LZMA-compressed AssetBundle forces the entire archive (headers, metadata, streaming tables) from disk into RAM[^27]. This design mistake turns oversized AssetBundles into ticking time bombs for Out-of-Memory (OOM) crashes[^27].

## Best Practices for Asset Lifecycle Governance

To tame reference-counting complexity and minimize strain on `DelayedActionManager`, system architects must enforce strict lifecycle symmetry alongside bundle optimization techniques.

### 1. Symmetric Load and Release Lifecycles

Every `AsyncOperationHandle` returned by the API must be explicitly released when no longer needed[^6]. Neglecting this causes memory leaks and eventual crashes[^6]. The table below outlines mandatory symmetric pairs in Addressables programming:

| Load / Spawn Method | Symmetric Release Method | Internal Behavior |
| :--- | :--- | :--- |
| `Addressables.LoadAssetAsync` | `Addressables.Release(handle)` | Decrements the containing AssetBundle's reference count by 1[^6]. |
| `Addressables.InstantiateAsync` | `Addressables.ReleaseInstance(gameObject)` | Destroys the spawned instance and automatically decrements the source Prefab's reference count by 1[^4]. |
| Loaded via `AssetReference` | `reference.ReleaseAsset()` | Equivalent to releasing via handle; clears static references[^6]. |

In particular, when configuring gameplay data with `ScriptableObject` assets, holding direct object references (`public Object _worldAsset`) creates hard references that force Unity to load the entire asset into RAM immediately[^27]. The optimal solution is using `AssetReference` (`public AssetReference addressableAsset;`) to enable true on-demand asynchronous loading[^6].

### 2. Low-Level Intervention: `Resources.UnloadUnusedAssets()`

In deadlock scenarios where shared AssetBundles stay pinned in memory due to the "no partial unload" rule (e.g., `Tree` trapped alongside `Tank`), the only escape hatch is the engine's forced cleanup API: `Resources.UnloadUnusedAssets()`[^25].

This call performs a deep scan across all of RAM to identify any asset (including hidden bundle assets) whose actual engine reference count is strictly 0, and forcefully destroys it[^25]. However, this operation is computationally expensive and causes noticeable FPS drops because the CPU stalls logic execution during the sweep[^27]. Engineers should invoke it only during major loading screens, or rely on Unity calling it automatically during non-additive `SceneManager.LoadScene` transitions[^29].

### 3. Planning and Structuring AssetBundles (Bundle Packing Modes)

Organizing Groups in the Addressables configuration directly dictates memory residency and download bandwidth. Selecting the right packing mode per asset category is crucial[^6]:

* **Pack Together**: Best for assets with tightly coupled lifecycles that always appear together, minimizing dependency graph overhead and network I/O[^6].
* **Pack Separately**: Ideal for huge standalone assets or large level maps that are never loaded simultaneously, preventing one large asset from blocking another's release[^6].
* **Pack Together By Label**: Groups scattered assets via label metadata (e.g., tagging `"Halloween 2023"` to bundle all seasonal event assets for clean CDN updates)[^6].

To further trim AssetBundle TypeTree overhead, developers can enable `BuildAssetBundleOptions.DisableWriteTypeTree`, which strips redundant metadata—though it requires rebuilding local groups whenever serialized data structures change[^26].

### 4. Audio and Texture Memory Governance

Optimizing secondary asset types is the most effective way to curb Garbage Collector pressure. Audio load types directly impact RAM[^27]:

* **Long Background Music (BGM)**: Use **Streaming** to buffer tiny chunks from disk[^27].
* **Long Sound Effects**: Use **Compressed In Memory** to keep audio compressed in RAM and decode at playback[^27].
* **Short / Frequent SFX**: Use **Decompress On Load** for instant playback with zero runtime CPU cost[^27].

Additionally, disabling `"Read/Write Enabled"` on Textures and setting UI Cameras' Depth Stencil Format to `None` can cut unnecessary rendering RAM usage by at least 50%[^27].

## Conclusion

Investigating `DelayedActionManager` not only demystifies a hidden object inside `DontDestroyOnLoad`, but reveals the core architectural philosophy behind Unity Addressables. This `ComponentSingleton` acts as a subtle temporal bridge, safeguarding data integrity by funneling releases, asynchronous callbacks, and cleanup queues into the `LateUpdate` phase. It isolates memory state mutations from mid-frame `Update` physics and gameplay logic, serving as a shield against scene-transition corruption.

Yet `DelayedActionManager` is no silver bullet for flawed memory governance. It demands strict discipline from software architects: symmetric load/release pairs, closure-safe C# lambdas that respect native C++ lifetimes, and modular AssetBundle planning to prevent stubborn leaks. By combining asynchronous routing, LZ4 chunked compression, and deliberate `Resources.UnloadUnusedAssets` checkpoints, development teams can build rock-solid, scalable asset architectures across every target platform.

---

## **References**

[^1]: Addressables In Unity - Ali Emre Onur - Medium - [https://aliemreonur.medium.com/addressables-in-unity-eec8b03198d7](https://aliemreonur.medium.com/addressables-in-unity-eec8b03198d7)
[^2]: Latecomer to Chop Chop, with a question...! - Unity Discussions - [https://discussions.unity.com/t/latecomer-to-chop-chop-with-a-question/899280](https://discussions.unity.com/t/latecomer-to-chop-chop-with-a-question/899280)
[^3]: Error: Assertion failed on expression: ShouldRunBehaviour() - [https://discussions.unity.com/t/error-assertion-failed-on-expression-shouldrunbehaviour/839805](https://discussions.unity.com/t/error-assertion-failed-on-expression-shouldrunbehaviour/839805)
[^4]: Addressables - Unity Term Book - [https://unitytermbook.com/en/addressables/](https://unitytermbook.com/en/addressables/)
[^6]: Best Practices | Spatial Creator Toolkit - [https://toolkit.spatial.io/docs/addressables/best-practices](https://toolkit.spatial.io/docs/addressables/best-practices)
[^7]: How to use DontDestroyOnLoad - Scripting - Unity Discussions - [https://discussions.unity.com/t/how-to-use-dontdestroyonload/894016](https://discussions.unity.com/t/how-to-use-dontdestroyonload/894016)
[^8]: DontDestroyOnLoad is not Working on Scene? - Stack Overflow - [https://stackoverflow.com/questions/18328180/dontdestroyonload-is-not-working-on-scene](https://stackoverflow.com/questions/18328180/dontdestroyonload-is-not-working-on-scene)
[^9]: why does "DontDestroyOnLoad" show up when I press play, if its not - [https://www.reddit.com/r/unity/comments/p8pj82/why_does_dontdestroyonload_show_up_when_i_press/](https://www.reddit.com/r/unity/comments/p8pj82/why_does_dontdestroyonload_show_up_when_i_press/)
[^11]: Error when using GetTable() - Unity Engine - Unity Discussions - [https://discussions.unity.com/t/error-when-using-gettable/892883](https://discussions.unity.com/t/error-when-using-gettable/892883)
[^12]: Unity Resource Manager | Package Manager UI website - [https://docs.unity3d.com/Packages/com.unity.resourcemanager@2.2/index.html](https://docs.unity3d.com/Packages/com.unity.resourcemanager@2.2/index.html)
[^13]: Namespace UnityEngine.ResourceManagement.Util | Addressables - [https://docs.unity.cn/Packages/com.unity.addressables@2.0/api/UnityEngine.ResourceManagement.Util.html](https://docs.unity.cn/Packages/com.unity.addressables@2.0/api/UnityEngine.ResourceManagement.Util.html)
[^15]: 어드레서블 Sprite 관련해서 질문이있습니다. - 인프런 - [https://www.inflearn.com/community/questions/1351466/%EC%96%B4%EB%93%9C%EB%A0%88%EC%84%9C%EB%B8%94-sprite-%EA%B4%80%EB%A0%A8%ED%95%B4%EC%84%9C-%EC%A7%88%EB%AC%B8%EC%9D%B4%EC%9E%88%EC%8A%B5%EB%8B%88%EB%8B%A4](https://www.inflearn.com/community/questions/1351466/%EC%96%B4%EB%93%9C%EB%A0%88%EC%84%9C%EB%B8%94-sprite-%EA%B4%80%EB%A0%A8%ED%95%B4%EC%84%9C-%EC%A7%88%EB%AC%B8%EC%9D%B4%EC%9E%88%EC%8A%B5%EB%8B%88%EB%8B%A4)
[^19]: ArgumentNullException in StartCoroutine_Auto - Unity Discussions - [https://discussions.unity.com/t/argumentnullexception-in-startcoroutine-auto/1701939](https://discussions.unity.com/t/argumentnullexception-in-startcoroutine-auto/1701939)
[^20]: Changelog | Addressables | 1.11.2 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@1.11/changelog/CHANGELOG.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.11/changelog/CHANGELOG.html)
[^23]: Memory management overview | Addressables | 2.0.8 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@2.0/manual/MemoryManagement.html](https://docs.unity3d.com/Packages/com.unity.addressables@2.0/manual/MemoryManagement.html)
[^25]: Memory management | Addressables | 1.16.19 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@1.16/manual/MemoryManagement.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.16/manual/MemoryManagement.html)
[^26]: Memory management | Addressables | 1.20.5 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@1.20/manual/MemoryManagement.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.20/manual/MemoryManagement.html)
[^27]: Unity game memory optimization on Android - [https://developer.android.com/games/engines/unity/unity-reduce-memory](https://developer.android.com/games/engines/unity/unity-reduce-memory)
[^28]: Addressables not freeing memory completely? - Unity Discussions - [https://discussions.unity.com/t/addressables-not-freeing-memory-completely/914086](https://discussions.unity.com/t/addressables-not-freeing-memory-completely/914086)
[^29]: Addressables: how to truly unload assets to free memory - [https://discussions.unity.com/t/addressables-how-to-truly-unload-assets-to-free-memory/808301](https://discussions.unity.com/t/addressables-how-to-truly-unload-assets-to-free-memory/808301)

### Further Reading

- How to structure your Unity project (best practice tips) - [https://gamedevbeginner.com/how-to-structure-your-unity-project-best-practice-tips/](https://gamedevbeginner.com/how-to-structure-your-unity-project-best-practice-tips/)
- DontDestroyOnLoad in Unity — Best Practices — Tutorial #1 - [https://makaka.org/unity-tutorials/dont-destroy-on-load](https://makaka.org/unity-tutorials/dont-destroy-on-load)
- Class ComponentSingleton | Addressables | 4.1.0 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@4.1/api/UnityEngine.ResourceManagement.Util.ComponentSingleton-1.html](https://docs.unity3d.com/Packages/com.unity.addressables@4.1/api/UnityEngine.ResourceManagement.Util.ComponentSingleton-1.html)
- Problema ao atribuir SkeletonData a SkeletonAnimation em... - Spine - [https://pt.esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime](https://pt.esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime)
- Problem when assigning SkeletonData to SkeletonAnimation - [https://esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime](https://esotericsoftware.com/forum/d/25965-problem-when-assigning-skeletondata-to-skeletonanimation-at-runtime)
- Scriptable Object inside an Addressable Folder causes Exception - [https://discussions.unity.com/t/scriptable-object-inside-an-addressable-folder-causes-exception/855434](https://discussions.unity.com/t/scriptable-object-inside-an-addressable-folder-causes-exception/855434)
- Changelog | Package Manager UI website - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@0.7/changelog/CHANGELOG.html](https://docs.unity3d.com/Packages/com.unity.addressables@0.7/changelog/CHANGELOG.html)
- Changelog | Addressables | 1.15.2 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@1.15/changelog/CHANGELOG.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.15/changelog/CHANGELOG.html)
- Addressables introduction | Addressables | 4.1.0 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@4.1/manual/AddressableAssetsOverview.html](https://docs.unity3d.com/Packages/com.unity.addressables@4.1/manual/AddressableAssetsOverview.html)
- Explain Addressables For Performance To Me Like I Am A Child - [https://www.reddit.com/r/Unity3D/comments/1brakih/explain_addressables_for_performance_to_me_like_i/](https://www.reddit.com/r/Unity3D/comments/1brakih/explain_addressables_for_performance_to_me_like_i/)
- Addressables: Planning and best practices - Unity - [https://unity.com/blog/engine-platform/addressables-planning-and-best-practices](https://unity.com/blog/engine-platform/addressables-planning-and-best-practices)
