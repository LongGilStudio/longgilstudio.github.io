---
title: "深度技术研究报告：Unity Addressables 环境下 DelayedActionManager 的运行机制、系统架构与影响分析"
date: 2026-10-01 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, addressables, memory-management, async, delayedactionmanager, optimization]
description: 深入剖析 Unity Addressables 中 DelayedActionManager 的 ComponentSingleton 架构、LateUpdate 执行机制、C#/C++ 代理异常处理及 AssetBundle 内存优化策略。
lang: zh-CN
translation_id: unity-addressables-delayedactionmanager
---

Addressable Asset System（简称 Addressables，可寻址资源系统）代表了 Unity 架构上的一次革命性飞跃，基于传统的 AssetBundles 底层提供了一套灵活、强大且经过优化的内容管理方案[^1]。在设计与运营大型游戏或交互式应用的过程中，管理异步数据管线以自动加载和释放资源是一项核心需求。然而，在承担这一复杂职责的核心组件中，有一个在软件工程师检查层级视图（Hierarchy）时常常令人困惑的自动生成对象——它就是位于 `DontDestroyOnLoad` 场景中的 `DelayedActionManager`[^2]。

本技术报告将深入剖析 `DelayedActionManager` 的架构本质，阐明其存在于 `DontDestroyOnLoad` 空间的原因，分析其在 Unity 实时主循环内部执行机制中的运作方式，并全面拆解与内存管理、内存泄漏（memory leaks）以及常见线程与生命周期异常（exceptions）相关的挑战。通过对系统设计数据与最佳实践的深入分析，本文旨在提供深刻洞察，帮助软件架构师优化应用的稳定性。

## 资源加载系统的演进与异步基础

在深入探讨 `DelayedActionManager` 的微观结构之前，了解 Addressables 系统的诞生背景是必要前提。在早期 Unity 版本中，开发者通常依赖 `Resources` 文件夹或直接使用原始的 AssetBundle 脚本[^4]。`Resources.Load()` 机制类似于用户亲自走进仓库取货：它需要精确的目录路径，并且主线程（main thread）必须阻塞（block），直到找到资源并将其加载到内存中为止[^4]。这种方法的缺陷在于阻碍了应用的扩展性，并且在处理大数据量时会导致严重的帧率（FPS）下降。

为解决这一难题，Addressables 如同一套现代化的物流配送服务。开发者只需提供资源的标识符（address/key），系统便会自动路由，判断是从本地存储（Local）查找资源，还是从内容分发网络（CDN - Content Delivery Network）服务器下载[^4]。最重要的是，这整个周期均以异步（asynchronous）方式运行。资源加载指令（典型如 `Addressables.LoadAssetAsync`）不会立即返回对象，而是返回一个名为 `AsyncOperationHandle` 的导向句柄[^4]。该接口在资源就绪时提供回调（callback）机制，使应用的主线程能够继续不间断地处理物理和图形渲染逻辑[^4]。

从完全同步模式向完全异步模式的转变带来了一项重大的架构挑战：当由于网络带宽较慢导致资源加载过程耗时数秒时，应用可能已经切换到了一个完全不同的场景（scene）[^1]。管理回调函数（callbacks）、任务队列（command queues）以及引用计数（reference counting）需要一个不受常规场景创建与销毁生命周期影响的中心管理实体。这正是 Unity 开发者将 `DontDestroyOnLoad` 场景模型集成到 Addressables 核心中的原因。

## DontDestroyOnLoad（DDOL）场景与全局持久化架构

在 Unity 环境下，加载新场景的操作（通过默认 Single 模式的 `SceneManager.LoadScene`）会自动触发内存清理机制。引擎会销毁（destroy）属于上一个场景的所有 `GameObject` 和 `Component`，以确保释放不再使用的资源[^7]。尽管叠加场景加载（Additive scenes）功能允许同时维持多个活动场景以管理全局状态（例如一个专门用于 Game Manager 的场景和另一个用于关卡 Level 的场景），但 `DontDestroyOnLoad`（DDOL）机制仍然是保护底层对象的一项关键系统技术[^7]。

在 Unity 编辑器中点击 Play 按钮时层级视图中出现的 `DontDestroyOnLoad` 场景并非错误，而是引擎默认的隐藏机制，用于归集那些被标记为在切换场景时不被销毁的对象[^9]。为了让一个 `GameObject` 被接纳进这个安全区，Unity 设定了一条强制规则：该对象必须位于场景的根层级（root level）[^8]。任何试图对子对象（nested object）调用 `DontDestroyOnLoad(gameObject)` 函数的操作都会失败，并记录一条警告[^8]。

对于 Addressables 系统而言，资源的加载和释放过程是生命周期横跨多个不同场景的操作。例如，跟踪从远程服务器下载 AssetBundle 的状态，不能仅仅因为玩家穿过了一扇切换关卡的门就中途取消。将 `RuntimeInitializeOnLoadMethod` 机制与增强型单例（Singleton）设计模式相结合，使 Addressables 源码能够在应用启动时自动创建一个根对象并将其放入 DDOL 场景中[^2]。这也解释了为什么即便开发者没有编写任何与 DDOL 相关的代码，一个名为 `DelayedActionManager` 的对象仍会自动出现在场景列表的左下角[^2]。

## DelayedActionManager 的内部结构与技术角色

深入研究 Addressables 包的源码与 API 文档可以发现，`DelayedActionManager` 是位于 `UnityEngine.ResourceManagement.Util` 命名空间下的一个具体类（concrete class）[^11]。它的结构并非单纯的静态工具类（static utility class），而是通过继承基础架构直接挂载到 `GameObject` 上的一个组件（Component）[^12]。

### ComponentSingleton 模式与初始化自动化

`DelayedActionManager` 的架构建立在 `ComponentSingleton` 设计模式之上，这是在同一命名空间中定义的基础类[^13]。在组件（Component）而非纯 C# 类上实现单例模式，赋予了系统直接与 Unity 实时事件循环（`PlayerLoop`）交互的能力。

当 `ResourceManager` 系统首次收到加载或状态更新请求（例如 `Addressables.LoadAssetAsync` 或网络诊断操作）时，它会调用 `DelayedActionManager` 实例。此时，`ComponentSingleton` 模式会自动执行一套隐藏流程：创建一个空的 `GameObject`，将其命名为 `"DelayedActionManager"`，将对应脚本挂载到它身上，并立即调用 `DontDestroyOnLoad` 函数将其放入全局保护空间中[^2]。这种延迟初始化（lazy initialization）设计确保了只有在真正需要延迟任务管理功能时才会消耗系统资源，解答了开发者们关于该对象在界面上“神奇”出现的常见疑问[^3]。

### 调度机制与 LateUpdate 阶段分析

`DelayedActionManager` 的核心职责是充当延迟操作、回调函数（callbacks）、协程（coroutine）以及微观层面内存管理的中央调度器（central scheduler）[^11]。其架构中一个微妙却极其关键的差异在于，所有队列处理逻辑都会被路由到 Unity 生命周期的 `LateUpdate()` 函数内部执行[^11]。

选择 `LateUpdate` 而非传统的 `Update`，解决了一个与数据一致性相关的深层架构难题。下表展示了 Unity 的执行顺序以及 `LateUpdate` 阶段在保护 Addressables 数据方面所起的作用：

| 执行阶段（PlayerLoop） | 典型职责 | 对 Addressables 与 DelayedActionManager 的作用 |
| :--- | :--- | :--- |
| **FixedUpdate** | 处理物理模拟、静态/动态碰撞。 | 游戏逻辑可能会在碰撞后触发对象销毁请求。 |
| **Update** | 玩家输入（Input）、移动、AI 逻辑、游戏状态更新。 | 手动调用 `Addressables.LoadAssetAsync` 或 `Release`。`GameObject` 可能在此处被 `Destroy()`。 |
| **LateUpdate** | 更新相机位置、后期处理（post-processing）调整。 | `DelayedActionManager` 清理内存、更新引用计数变量并触发异步回调，以确保不与 `Update` 阶段的销毁指令发生冲突[^11]。 |

如果 `ResourceManager` 在 `Update` 阶段中途立即执行任务完成回调，极有可能与正处于中间态、尚未完成当前帧计算的系统（例如图形系统或用户界面系统）发生交互。通过将 `OnComplete` 函数的调用或引用计数的递减（ref-count decrements）推迟（delaying）到 `LateUpdate()`，`DelayedActionManager` 确保了当前帧的整体逻辑状态已经稳定[^11]。来自大量堆栈跟踪（stack traces）错误报告的数据表明，`UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` 函数是将控制权交还给用户代码之前的最后一道缓冲[^15]。

## 剖析系统异常（System Exceptions）与堆栈跟踪（Stack Traces）

尽管在设计上具备高度安全性，但异步机制的复杂性加上开发者不规范的生命周期管理操作，常常使 `DelayedActionManager` 成为严重异常的爆发中心。错误日志为分析系统如何与托管内存（managed memory）及原生内存（native memory）交互提供了关键线索。

### NullReferenceException 错误与 C# – C++ 代理生命周期冲突

Addressables 环境中一个非常普遍的报错场景，是由 `DelayedActionManager` 的 `StartCoroutine_Auto` 函数抛出的 `ArgumentNullException: Value cannot be null. Parameter name: obj` 异常[^19]。该错误并非 Unity 内部故障，而是源于 C# 的垃圾回收机制（Garbage Collector）与底层 C++ 源码的原生指针管理之间的不一致[^19]。

在 Unity 中，诸如 `GameObject` 或 `MonoBehaviour` 等对象实质上是使用 C# 编写的代理类（proxy classes），内部包含一个指向引擎中通过 C++ 分配的原生对象的指针引用[^19]。当开发者调用 `Destroy(gameObject)` 指令时，C++ 对象会立即被销毁并回收内存，从而使内部引用变为空值（null）[^19]。然而，C# 代理类本身仍可能在托管内存（managed memory）中存活一段时间，直到垃圾回收器扫描并将其清理[^19]。

当开发者将匿名表达式（lambdas/closures，闭包）与 Addressables 的异步流程结合使用时，灾难便会发生。Lambda 表达式具有“捕获”（capture）其周围上下文变量的特性。请看如下代码模式：

```csharp
// 一个被放入 DelayedActionManager 队列中的操作
DelayedAction(null, () => {
    _crawlerRobot.BreakAwayLowerBody();
    if (isLevelLoad) {
        PhysicsUtil.ManualSimulation(2);
    }
});
```

当这段代码执行时，变量 `_crawlerRobot`（一个 C# 代理）被闭包所持有[^19]。如果游戏逻辑就在这一帧内销毁了 `_crawlerRobot`，底层的 C++ 指针就会消失。然而由于 `DelayedActionManager` 已调度该 Lambda 在 `LateUpdate` 阶段（或之后的某一帧）运行，当 Lambda 真正被触发时，它会尝试访问一个已死亡的 C++ 指针上的 `BreakAwayLowerBody()` 成员[^19]。其必然结果便是系统抛出 `NullReferenceException` 异常，或输出“对象已被销毁，但您仍在尝试访问它”的错误提示[^19]。

为了规避这一架构风险，软件专家推荐两种设计方案：

1. 在处理底层状态变更时，避免过度嵌套 Lambda 表达式（lambdas nesting）[^19]。
2. 始终执行安全的空值校验，充分利用 Unity 在 C# 中重载（overloaded）了 `==` 运算符的特性，直接检测底层 C++ 指针的状态[^19]。

### PlayerLoop 冲突与 `"Assertion failed on expression: ShouldRunBehaviour()"` 错误

在 Addressables 包的版本管理过程中，大量开发者报告称 Unity 编辑器（Unity Editor）被一条底层报错信息刷屏：`MonoBehaviour.cpp` 文件中的 `Assertion failed on expression: 'ShouldRunBehaviour()'`[^3]。

堆栈跟踪（stack trace）显示该流程直接源自位于 `DontDestroyOnLoad` 场景中的 `"DelayedActionManager"` 游戏对象[^3]。根因分析（Root Cause Analysis）揭示了 Unity 编辑器播放模式（Play Mode）处理流程中的一个缺陷。当编辑器经历一次域重载（Domain Reload），或者在资源加载处理尚未完成时用户就点击了停止（Stop）游戏，`DelayedActionManager` 会作为一个孤立对象（orphaned object）被遗留下来[^3]。

由于它被标记为 `DontDestroyOnLoad`，即使 Unity 原生运行环境（`PlayerLoop`）已经下令停止运行所有任务，它仍试图继续执行 `LateUpdate` 周期与行为检查（behaviour checks）[^3]。该错误在从 Addressables 1.16.x 升级到 1.18.x 的过渡期间尤为严重，迫使许多开发团队不得不手动降级回 1.17.17 版本，以确保同步处理 API 的稳定性并消除队列卡死问题[^3]。

### 版本历史中 DelayedActionManager 的演进与变迁

在研究 Unity Addressables 的 API 文档和更新日志（changelogs）时，一个有趣的现象是 `DelayedActionManager` 的周期性存在。诸如 0.7.5 和 1.11.2 等版本曾在更新日志中明确公告了对构建脚本接口（build script interface）的重构，并附带说明：*"Removed DelayedActionManager. Removed ISceneProvider. Users can implement custom scene loading"*[^20]。该决定最初旨在简化 API 层，并将控制权移交给自定义的 `AsyncOperationBase` 类[^20]。

然而，来自 1.18.15、1.19.19 和 1.21.21 等后 LTS（Long-Term Support，长期支持）版本的错误报告，却揭示了 `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` 在调用栈中的持续回归[^11]。这体现了 Unity 的迭代式设计（iterative design）哲学：在为了精简而将其移除后，系统工程师们意识到，缺少一个集中的延迟任务管理器会在收集诊断事件（`DiagnosticEventCollector`）、处理预加载表（preload tables）以及确保应用关闭时的内存安全方面造成无法克服的困难[^11]。`DelayedActionManager` 经过重新设计后作为底层隐式系统工具得以恢复，不再暴露于公开的用户界面中，而是负责处理应用关闭时的清理（disposal）风险[^20]。

## 引用计数机制与内存泄漏动力学

`DelayedActionManager` 的存在与 Addressables 最复杂的支柱之一紧密相连：内存管理（Memory Management）。与完全依赖垃圾回收器不同，Addressables 通过引用计数（Reference Counting）机制来控制数据在内存（RAM）中的驻留[^23]。

### 引用动态与依赖层级

每当系统收到加载某项资源的请求时，该资源的引用计数就会加 1（increment）。使用完毕后，`Addressables.Release` 指令会指示系统减少该计数（decrement）[^23]。黄金法则是：只有当引用计数绝对归零时，系统才允许释放容纳该资源的物理内存[^23]。

由于 Addressables 通过 AssetBundle 架构管理依赖关系，复杂度呈指数级上升。当加载某个资源（例如一个材质 `Material`）时，系统不仅加载该材质本身，还会自动加载包含其依赖项（例如纹理 `Texture`）的所有 AssetBundle[^25]。依赖图（dependency graph）是在 Bundle 级别上计算的，这意味着如果 Bundle A 中的某项资源引用了 Bundle B 中的某项资源，整个 Bundle B 都必须被加载到宿主内存中[^26]。

Unity 在该架构中最刚性的技术限制是：**用户无法部分卸载（partially unload）一个 AssetBundle 的内容**[^23]。为便于理解，假设一个名为 `"stuff"` 的 AssetBundle 包含三个彼此独立的资源：`树`、`坦克` 和 `牛`[^23]：

1. 当加载 `树` 资源时，性能分析器（Profiler）会显示 `树` 有 1 个引用，同时 `stuff` 包对应有 1 个引用[^23]。
2. 当继续加载 `坦克` 资源时，`坦克` 的计数增加为 1，而 `stuff` 的计数上升为 2[^23]。
3. 如果游戏执行 `Release(树)` 指令，`树` 的计数降为 0，Profiler 上的蓝色进度条也会消失[^23]。
4. 然而，`树` 的物理数据依然驻留在系统内存中。由于 `坦克` 仍保持着连接，导致 `stuff` 这个 AssetBundle 的计数大于 0，因此在该 Bundle 被完全释放之前，其中的任何资源都不允许被销毁[^23]。

### “资源抖动（Asset Churn）”综合征与内存膨胀（Memory Bloat）

资源在短时间内被连续加载、释放，随后又立即重新加载的现象，被定义为“Asset Churn”（资源抖动）[^23]。这一漏洞常见于关卡（levels）切换期间。假如第 1 关使用资源 `船`，第 2 关使用资源 `飞机`（两者共享同一张 `迷彩` 纹理）。退出第 1 关时，开发者释放了 `船`，这会导致 Addressables 立即从内存中卸载 `迷彩` 纹理。一毫秒后，当第 2 关实例化 `飞机` 时，系统又被迫驱动磁盘执行 I/O 周期，从头重新加载那张 `迷彩` 纹理[^23]。这一过程会在帧时间上产生剧烈的尖峰（spikes），并将内存占用推向危险阈值，在移动硬件上尤为明显[^27]。

此外，遗漏 `Release` 调用会导致垃圾引用累积，仅仅经过几次场景切换，内存（RAM）占用就会从数百兆字节飙升至吉字节（GB）级别[^28]。由于 `DelayedActionManager` 和 Addressables 本身都不追踪通过 MonoBehaviour 原生 `Instantiate` 方法创建的实例（instances）数量，内存句柄追踪中的任何疏漏都会造成永久性的内存泄漏[^6]。

### 数据压缩架构与内存分配压力

AssetBundle 的体积大小和数据压缩方式直接决定了数据在 RAM 中的驻留方式。压缩方式的选择决定了 AssetBundle 是永久占用大量内存，还是能够优化带宽。

AssetBundle 压缩算法特性与存储影响汇总表[^29]：

| 压缩算法 | 本地文件识别能力 | 是否需要将整个 Bundle 加载到 RAM | 性能与存储影响 |
| :--- | :--- | :--- | :--- |
| **LZMA** | 否。Bundle 被整体压缩为一个流。 | **是。** 必须将整个文件解压到内存中。 | 压缩率最高、下载体积最小，但会在提取时引发急性内存膨胀（Memory Bloat）和极高的 CPU 消耗[^29]。 |
| **LZ4** | 是。基于分块（chunk-based）压缩。 | **否。** 仅加载当前正在访问的数据部分。 | 推荐作为默认（default）标准。允许直接缓存（caching）到本地磁盘，而无需将全部元数据加载到 RAM[^29]。 |
| **Uncompressed** | 是。支持独立识别单个资源。 | **否。** 直接读取访问。 | 不消耗解压时间，原始文件体积最大。在磁盘带宽允许的情况下，最适合即时加载[^29]。 |

当向一个采用 LZMA 压缩的庞大 AssetBundle 请求一项微小的资源时，整个文件（包括文件头、元数据、流式缓存表）都必须从硬盘搬运到 RAM 中[^27]。这一设计失误将庞大的 AssetBundle 变成了随时引发应用内存溢出崩溃（OOM crashes）的定时炸弹[^27]。

## 资源治理中的最佳实践（Best Practices）

为了驾驭引用计数系统的复杂性并减轻 `DelayedActionManager` 的负担，系统架构师必须实施极为严格的生命周期结构，并结合资源生命周期优化技术。

### 1. 同步化初始化与释放周期

API 返回的每一个 `AsyncOperationHandle` 对象，在其使用生命周期结束时都必须被显式释放[^6]。未执行此操作不仅会导致内存泄漏，还可能引发系统崩溃（crashes）[^6]。下表列出了 Addressables 编程中必须成对出现的对称操作：

| 初始化 / 加载方法 | 对应的释放方法 | 内部运作机制 |
| :--- | :--- | :--- |
| `Addressables.LoadAssetAsync` | `Addressables.Release(handle)` | 将包含它的 AssetBundle 的引用计数减 1[^6]。 |
| `Addressables.InstantiateAsync` | `Addressables.ReleaseInstance(gameObject)` | 销毁实例化出来的显示对象（Instance），并自动将源 Prefab 的引用计数减 1[^4]。 |
| 通过 `AssetReference` 赋值 | `reference.ReleaseAsset()` | 类似于通过句柄调用 Release，清理静态引用[^6]。 |

特别需要注意的是，在使用 `ScriptableObject` 存储游戏配置时，直接引用某个对象（`public Object _worldAsset`）会产生硬引用（hard references），迫使系统立即将该资源全部加载到 RAM 中[^27]。最佳解决方案是使用 `AssetReference`（`public AssetReference addressableAsset;`），以实现真正的按需异步加载（on-demand loading）[^6]。

### 2. 底层干预：`Resources.UnloadUnusedAssets()`

在共享 AssetBundle 因“无法部分卸载”特性而陷入内存僵局的情况下（例如资源 `树` 与 `坦克` 绑在一起卡住），唯一的解脱途径是调用引擎底层的强制清理 API：`Resources.UnloadUnusedAssets()`[^25]。

该功能会对整个系统 RAM 执行一次深度扫描，查找实际引擎引用数（actual engine references）完全为 0 的所有资源（包括隐藏在 AssetBundle 中的资源），并强制将其销毁[^25]。然而，这是一项计算开销极其昂贵的操作，由于 CPU 必须暂停逻辑线程来执行清理扫描，会引发严重的帧率下降（FPS drops）[^27]。工程师应当仅在大型加载界面（loading screens）期间触发此指令，或者依赖在使用 `SceneManager.LoadScene` 切换场景时由系统自动调用[^29]。

### 3. 规划与拆分 AssetBundle（Bundle Packing Modes）

在 Addressables 配置界面中合理组织分组（Groups）结构，直接决定了内存加载性能和下载带宽。为不同资源类型选择合适的打包模式（Bundle Mode）是至关重要的设计步骤[^6]：

* **Pack Together（共同打包）**：适用于生命周期紧密耦合、总是同时出现的资源。这能最大限度地减少依赖图分析和网络 I/O 的开销[^6]。
* **Pack Separately（单独打包）**：最适合体积庞大的独立资源，或无法保证总是同时加载的大型地图。可消除大资源阻碍其他小资源释放的风险[^6]。
* **Pack Together By Label（按标签打包）**：允许通过标签元数据将分散的资源组合在一起（例如打上 `"Halloween 2023"` 标签，将整个活动内容打包进一个 Bundle 中，便于通过 CDN 更新）[^6]。

为了进一步削减 AssetBundle 中类型树目录表（TypeTree）的开销，开发者可以启用 `BuildAssetBundleOptions.DisableWriteTypeTree` 选项。该特性会剔除冗余的元数据，但在导出可执行文件之前需要重新构建本地分组（rebuild local groups）[^26]。

### 4. 音频与图像内存治理（Graphics & Audio）

优化辅助资源类型是降低垃圾回收器运行频率的最有效手段。音频流的加载格式配置会直接影响内存占用[^27]：

* **长背景音乐（BGM）**：需要配置为 **Streaming**，以便从磁盘分小块缓冲加载[^27]。
* **长音效**：选择 **Compressed In Memory**，在 RAM 中保持压缩状态并在播放时实时解码[^27]。
* **短/高频音效**：使用 **Decompress On Load**，直接常驻未压缩数据以消除 CPU 开销[^27]。

此外，在 Texture 上禁用 `"Read/Write enabled"` 选项，并为界面（UI）图形相机配置剔除深度缓冲区（Depth Stencil Format to None），将能至少减少 50% 不必要的渲染内存占用[^27]。

## 全局交互总结

对 `DelayedActionManager` 的研究不仅揭开了 `DontDestroyOnLoad` 场景中一个隐藏对象的起源之谜，也揭示了 Unity Addressables 系统的核心设计哲学。这个 `ComponentSingleton` 类扮演着精妙的时间桥梁角色，通过将释放流程、异步回调与缓存处理引导至 `LateUpdate` 周期来维护数据的完整性。它将内存结构的变更与 `Update` 线程中物理或控制逻辑可能引发的中断隔离开来，构筑了一道抵御场景切换时系统损坏异常的护盾。

然而，`DelayedActionManager` 并非能够解决内存管理架构内在弱点的万能灵药。它对软件架构师提出了严苛的要求：必须维持完全对称的资源加载/释放周期，设计避免捕获原生 C++ 对象的 C# 匿名表达式（lambdas），并对 AssetBundle 结构进行模块化（modularize）拆分以防范顽固的内存泄漏。通过深入理解异步加载路由、合理运用 LZ4 等压缩方式，并结合 `Resources.UnloadUnusedAssets` 的强制清理能力，开发团队能够构建出稳健且在各平台上具备强大扩展能力的架构模型，而无需担忧永久性资源枯竭的问题。

## **参考文献**

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

### 延伸阅读

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
