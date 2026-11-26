---
title: "深度技术报告：Unity 6 分析工具生态与《GilongWorld》实战性能优化策略"
date: 2026-10-22 03:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, profiler, optimization, analysis, urp, render-graph, gilongworld]
description: 全面解析 Unity 6 的 Window > Analysis 菜单中的 13 款分析工具、深度隐藏诊断工具，以及开放世界项目《GilongWorld》的实战性能优化策略。
lang: zh-CN
translation_id: unity6-analysis-tools-gilongworld
---

## **《GilongWorld》的技术特性与性能挑战分析**

由 Long Gil Studio 与开发者 Huynh Long Gil 共同开发并发行的《*GilongWorld*》，是一款定位高品质（AAA Indie）的科幻动作角色扮演结合开放世界（Sci-Fi Action RPG Open World）类型的独立游戏项目[^1]。《*GilongWorld*》在技术架构上最大的复杂度，在于五项最消耗系统资源的玩法机制必须在第三人称（Third Person）沙盒环境中同步运行[^2]。游戏一方面需要动作角色扮演战斗系统的高帧率响应速度，应对来自科幻武器、爆破炸弹与毒素的大量粒子特效（VFX）；另一方面还必须维持包含拥有独立属性面板与超自然技能的龙族在内的神话生物驯服与指挥系统[^2]。这套伙伴生物系统通过骨骼动画矩阵变换、寻路算法以及主角与坐骑编队之间持续的状态数据通信，对处理器造成了巨大压力[^2]。

除了战斗与人工智能带来的负载外，《*GilongWorld*》还融合了允许玩家将荒野改造成坚固堡垒的基地建造机制，并结合了培育外星作物的农业系统以及炼制仙药、药丸和爆炸物的炼金系统[^2]。从引擎架构来看，允许玩家自由建造建筑会在运行时生成数以千计的动态对象，从而导致内存碎片化、破坏传统的静态合批（Static Batching）能力，同时迫使物理系统与导航网格持续刷新[^2]。与此同时，农耕系统在玩家跨越未探索领土时需要大范围的生长状态更新循环与持久化数据存储机制，而炼金系统则要求在用户界面上管理数百种复杂的合成配方[^2]。上述所有多机制组合都必须运行在 Steam 平台预设的硬件预算框架内，并满足基于 DirectX 12 指令集运行的写实画面强制要求[^2]。

| 系统参数 | 最低配置（Minimum） | 推荐配置（Recommended） | 《GilongWorld》的架构影响与优化约束 |
| :---- | :---- | :---- | :---- |
| **操作系统与 API** | Windows 10 (DirectX 12)[^2] | Windows 10/11 (DirectX 12)[^2] | 必须依照现代 DX12 标准优化图形命令流（Render Thread）与 GPU 缓冲区管理[^2]。 |
| **处理器（CPU）** | Intel Core i5-8500 / AMD Ryzen 5 2600X[^2] | Intel Core i5-11600K / AMD Ryzen 5 5600[^2] | 受限于 6 个物理核心；所有生物 AI、基地物理与农业循环都必须转移至多线程（Job System / Burst）[^2]。 |
| **系统内存（RAM）** | **16 GB RAM**[^2] | **16 GB RAM**[^2] | 两档配置之间绝对不会提升的内存上限；严禁出现内存泄漏（Memory Leak）与 AssetBundle 中的资源重复[^2]。 |
| **显卡（GPU）** | GTX 1060 / RX 6500 XT[^2] | RTX 2080 / RX 6700 XT[^2] | RX 6500 XT 仅有 4 GB 显存且显存带宽较窄；必须复用临时渲染纹理（Transient Resources）并彻底压缩纹理[^2]。 |
| **存储空间** | **35 GB** 可用空间[^2] | **50 GB** 可用空间[^2] | 庞大的资源规模（35–50 GB）会带来加载流式传输瓶颈（Asset Streaming）风险，并拉长编辑器内的导入（Import）耗时[^2]。 |

从上述配置参数表中可以发现一个核心技术矛盾：虽然存储空间从 35 GB 扩展至 50 GB，图形处理能力也从入门级 GTX 1060 / RX 6500 XT 跃升至高端 RTX 2080 / RX 6700 XT，但系统内存容量在最低配置与推荐配置中却始终维持在 16 GB 不变[^2]。由于 Windows 10/11 操作系统与 DirectX 12 驱动程序本身已经占用了相当可观的后台内存，《*GilongWorld*》的运行时进程在容纳整个开放世界地形、玩家建造的堡垒结构、驯服生物模型以及炼金特效时，必须承受极其严苛的内存上限[^2]。此外，工作界面中出现 Render Graph Viewer、Performance Markers 与 Project Auditor 等专用工具，表明该项目正基于搭配现代 Universal Render Pipeline（URP）渲染流程的 Unity 6 平台进行开发[^10]。熟练掌握 `Window > Analysis` 菜单中的全部 13 款工具以及各类隐藏诊断工具，是破解这一性能难题的关键所在[^13]。

![《GilongWorld》硬件预算与 Unity 6 Analysis 工具矩阵](/assets/img/posts/2026-10-22/gilongworld-hardware-budget-analysis-tools.png){: .shadow .rounded-10 }
_图 1：《GilongWorld》硬件预算（16 GB RAM、35–50 GB、GTX 1060 / RX 6500 XT、i5-8500）与 Unity 6 Analysis 工具及隐藏工具矩阵_

## **Analysis 菜单中 13 款工具的详细解析及《GilongWorld》实战应用**

为了优化像《*GilongWorld*》这样复杂的项目，`Window > Analysis` 菜单中的 13 款工具被划分为四个专业功能组，分别对应 Unity Engine 的核心架构层级[^13]。

### **第 1 组：运行时与编辑器性能分析（Runtime & Editor Performance Profiling）**

第一组工具充当雷达系统，在整个游戏与编辑器运行期间持续监控 CPU 执行时间、内存占用情况及帧延迟[^8]。

#### **Profiler (Ctrl+7)**

Profiler 是一款按帧采集应用程序遥测数据的工具，它基于 Unity Engine C++ 源码中的内置性能标记与通过 `ProfilerMarker` API 在 C# 代码中定义的自定义标记协同工作[^19]。采集的数据被拆分为多个专用模块，包括 CPU Usage、Rendering、Memory、Audio、Physics、UI and UI Details、File Access、Global Illumination、Video 以及 Asset Loading[^8]。在《*GilongWorld*》的实际研发中，该工具在控制战斗与炼金合成期间的 CPU 尖峰（CPU Spikes）方面起着决定性作用[^2]。当玩家引爆炼金炸药或神话生物释放大范围技能时，分析 CPU Usage 模块能够帮助技术团队精确判断卡顿是源于主线程上的粒子对象实例化与垃圾内存分配（GC Allocation），还是源于渲染线程在处理 DirectX 12 绘制命令时过载[^2]。同时，跟踪 Asset Loading 与 File Access 两个模块，可以让工程师在玩家骑乘坐骑穿越未探索区域时检查从 35–50 GB 存储包读取数据的速度，确保异步资源加载线程不会阻塞主线程[^2]。

#### **Profiler (Standalone Process)**

通过 `Window > Analysis > Profiler (Standalone Process)` 路径启动时，Unity 会将 Profiler 窗口分离为一个完全独立于 Unity Editor 进程的操作系统进程[^16]。这种进程隔离机制解决了两大技术难题：第一，在主编辑器内部绘制 Profiler 图表界面及存储历史数据本身也会消耗 CPU 与内存，连接到游戏独立构建版本（standalone builds）时容易干扰测量结果；第二，该独立进程专为分析 Unity Editor 自身的性能而设计[^16]。应用到《*GilongWorld*》时，在最低目标配置（Core i5-8500 与 16 GB RAM）上测试构建包时，使用 Profiler (Standalone Process) 能够将 Profiler UI 的开销从被测进程中剥离，从而采集最精准的数据[^2]。此外，Long Gil Studio 开发团队还可以利用它诊断内部设计工具——如炼金配方编辑器、生物属性配置工具或 Scene View 中的基地建造工具——从而迅速揪出拖慢日常工作流的具体编辑器函数[^2]。

#### **Profile Analyzer**

与标准 Profiler 窗口侧重于逐一剖析单个帧的细节不同，Profile Analyzer 是一款针对连续多帧序列进行数学统计分析的工具，旨在发现系统性的性能瓶颈[^20]。通过汇总成百上千帧内各性能标记的执行时间，并支持将代码修改前后的两份记录直接并排对比，该工具能够消除帧间随机波动造成的测量偏差[^24]。在像《*GilongWorld*》这样交互密度极高的开放世界中，数百株外星作物正在生长的同时，玩家堡垒周围还有数十只野生生物在移动，因此每一帧的处理耗时始终剧烈波动[^2]。如果只看 Profiler 中的某一帧，程序员极易对优化效果做出误判。将基地内一场长时间战斗的采样数据导入 Profile Analyzer，便能提供严谨的定量证据，验证多线程改造后驯服生物寻路脚本或农场更新循环的中位处理时间缩减幅度[^2]。

#### **Performance Markers**

作为 Unity 6 生态中新增于 `Window > Analysis > Performance Markers` 路径的窗口，该工具通过 Performance Trackers（查询前缀 `perf:`）和 Profiler Markers（查询前缀 `profile:`）两大数据源充分释放 Unity Search 搜索引擎的威力[^14]。它以统计表格的形式呈现两类标记的数据：`ProfilerMarker`（开启 Profiler 时激活，用于记录执行时间与内存分配详情）和 `EditorPerformanceTracker`（始终在编辑器内以极低开销运行，用于记录各项任务的执行时间）[^21]。Performance Markers 的核心优势在于其基于时间和内存单位的定量查询过滤器，例如 `avg>1ms`、`avg<512kb`、`lastTime<1ms`、`peak=0.5`、`count>1000` 或 `total=0.5`；同时支持双击任意标记来开启局部 Deep Profiling，并打开仅展示该标记下属调用树的 Profiler 窗口[^14]。对于《*GilongWorld*》，当基地建造放置系统或生物距离感知系统需要通过 Burst Job 与 `RaycastCommand` 在每帧执行数百次射线检测时，工程师只需打开 Performance Markers 直接检索 `Physics.Raycast`，即可确认其平均耗时处于微秒级（例如在调试模式下为 3.7 微秒），而无需在庞大的整帧层级树中手动翻找[^2]。

### **第 2 组：图形与渲染管线调试（Graphics & Rendering Pipeline Debugging）**

面对基于 DirectX 12 指令集实现科幻写实画风，同时还需确保 GTX 1060 与 RX 6500 XT 等主流显卡流畅运行的双重挑战，图形工具组是释放 GPU 瓶颈的关键钥匙[^2].

#### **Frame Debugger**

Frame Debugger 允许在任意一帧冻结渲染流程，并将整帧拆解为发送给 GPU 的有序绘制事件（Draw Calls）序列[^10]。在逐一检查每个绘制步骤时，开发者可以观察该绘制命令完成瞬间的渲染目标缓冲区状态，检查传入着色器（Shader）的参数，并查明对象未能合批（batching）的原因[^10]。在《*GilongWorld*》中，当玩家建造出一座由数千个墙体、地板、冶金机器构成且周围环绕外星农田与坐骑群的大型堡垒时，通过 DirectX 12 提交的绘制调用数量可能急剧攀升，从而压垮 Core i5-8500 处理器[^2]。在正对基地的视角下使用 Frame Debugger，可以让图形工程师立刻验证 URP 的合批机制（SRP Batcher）是否在拼接建筑部件上有效运转，抑或是被不统一的材质变体所打断[^2]。

#### **Rendering Debugger**

Rendering Debugger 是集成在 URP 渲染流程中的实时诊断工具，允许在游戏运行时直接检查并覆写材质属性、光照模式以及图像缓冲区图层，而无需重新编译着色器[^27]。在《*GilongWorld*》中，使用炼金炸弹、剧毒迷雾并配合生物超自然技能的战斗场景经常会叠加多层半透明粒子[^2]。在显存带宽严重受限的最低配置显卡 RX 6500 XT 上，这些毒雾带来的像素过度绘制（Overdraw）会迅速拉低帧率[^2]。通过激活 Rendering Debugger，技术美术可以开启过度绘制密度检查模式，并在开放世界的不同光照条件下核查科幻 PBR 材质通道的准确性，从而实时微调粒子尺寸[^2]。

#### **Render Graph Viewer**

在 Unity 6 的 `Window > Analysis > Render Graph Viewer` 路径下引入的这款工具，能够直观展示每一帧中经过优化的完整 Universal Render Pipeline 渲染链[^13]。Render Graph 系统不再让程序员手动分配和释放图像缓冲区——这种做法极易导致内存泄漏或通过全局变量引发隐式依赖冲突——而是要求每个渲染通道（`ScriptableRenderPass`）必须在 `RecordRenderGraph` 方法内明确声明资源的读取（`AccessFlags.Read`）与写入（`AccessFlags.Write`）意图[^6]。基于这些声明，Render Graph 编译器会自动构建依赖图谱并执行三大核心优化：自动剔除对最终输出画面无贡献的渲染通道（Culling）、为生命周期不重叠的临时缓冲区（Transient Textures）复用 GPU 显存，以及将多个连续兼容的渲染通道合并为单一流程（Pass Merging）[^6]。

在 Render Graph Viewer 界面中，渲染通道沿水平轴从左向右排列，而图像资源与数据缓冲区则沿垂直轴自上而下排列[^10]。该工具用绿色标识读取操作，用红色标识写入操作，并在已成功合并的通道下方显示一条连续的蓝线（例如从 Draw Opaque Objects 到 Setup Post FX 的 5 个通道序列）[^6]。此外，该窗口还提供过滤器来显示 Unsafe Pass（例如 `AddBlitPass` 或使用旧版兼容 API `SetRenderTarget` 的通道）和 Compute Pass，并支持点击直接跳转至 C# 代码编辑器中定义该通道的代码行[^10]。

![展示 Read/Write 操作、Merged Native Render Pass 与 Shared GPU Memory Pool 的 Render Graph 示意图](/assets/img/posts/2026-10-22/render-graph-pass-merging.png){: .shadow .rounded-10 }
_图 2：Render Graph 示意图，展示了 Read（绿色）/ Write（红色）操作、Merged Native Render Pass 以及通过 Shared GPU Memory Pool 实现的 Transient Texture 复用机制_

将 Render Graph Viewer 应用于《*GilongWorld*》时，技术团队在开发科幻热成像扫描护目镜、炼金毒素致盲效果或驯服生物时的发光特效等自定义后处理效果时，可以直接优化 GTX 1060 与 RX 6500 XT 上的显存占用[^2]。通过观察依赖图表，图形工程师能立刻发现诸如 Copy Color 之类的冗余缓冲区拷贝步骤，并确认通道间共享的所有数据均通过 `FrameData` 对象传递，而非采用会拖累性能的全局变量[^10]。

### **第 3 组：物理、输入与界面调试（Physics, Input & IMGUI Debugging）**

第三组工具直接介入物理交互层、玩家输入信号识别系统以及开发工具界面层。

#### **Physics Debugger**

Physics Debugger 支持在 Scene 的三维空间中直接可视化所有碰撞体几何形状、物理刚体的活动状态以及层级碰撞矩阵。对于《*GilongWorld*》而言，自由建造基地与对抗巨型神话生物的双重机制结合，带来了极高的物理系统过载风险[^2]。当玩家拼接数百面堡垒墙壁、冶炼设备与农田地块时，若未能将其正确设为静态碰撞体或未能让其进入休眠状态（Sleeping），物理模拟线程就会在 Core i5-8500 处理器上消耗大量 CPU 周期[^2]。使用 Physics Debugger 可以让工程师直观审查整座堡垒结构以剔除不必要的复杂网格碰撞体（Mesh Collider），同时还能在高节奏战斗中核查绑定在巨龙与野生生物骨骼上的受击判定区（Hitbox）贴合度[^2]。

#### **Input Debugger**

Input Debugger 是针对输入系统的深度诊断工具，可实时监控硬件设备状态、输入事件流以及控制动作映射的激活状态。在像《*GilongWorld*》这样包含多重玩法的游戏中，玩家必须不断切换于多种控制语境之间：从第三人称角色战斗操作、向驯服生物下达技能指令、打开炼金制药面板，到建造堡垒时的网格对齐模式以及收获农作物[^2]。一旦发生冲突 Bug，导致原本用于放置建筑构件的鼠标左键点击意外触发武器攻击或投掷爆炸药瓶，Input Debugger 就能帮助程序员精准追踪究竟是哪套控制指令在游戏状态切换后仍潜伏于后台且未及时关闭[^2]。

#### **IMGUI Debugger**

IMGUI Debugger 用于检查采用传统 Immediate Mode GUI 系统编写的界面的布局结构、渲染规则及调用栈。在《*GilongWorld*》的开发过程中，尽管面向玩家的主 UI 可能采用更新的技术构建，但 IMGUI 依然广泛存在于 Unity Editor 的内部工具窗口或用于召唤生物及测试炼金配方的作弊控制台（Cheat Console）中[^2]。当某个编辑器设计工具窗口出现面板错位或无法响应鼠标点击时，IMGUI Debugger 会明确指出是哪个 UI 控件抢占了输入焦点，让工具程序员得以立即修复。

### **第 4 组：源代码、资源与项目配置审计（Static Analysis, Asset Pipeline & Code Quality）**

第四组工具如同在源代码与资源数据库层级运行的自动化质量控制系统，能够在产品打包前夕就阻止体积膨胀与性能退化问题[^17].

#### **Code Coverage**

Code Coverage 与自动化测试框架 Unity Test Framework 深度集成，用于统计通过 Edit Mode 与 Play Mode 测试所覆盖执行的 C# 代码行、条件分支及方法的百分比[^20]。对于《*GilongWorld*》来说，诸如炼金仙药配比算法、外星作物生长周期计算公式、基地资源管理系统以及驯服生物战力属性换算表等具有严密数学与规则逻辑的系统，要求做到绝对精准[^2]. 通过为核心系统构建自动化测试套件并借助 Code Coverage 进行追踪，技术团队能够发掘尚未覆盖到的边界逻辑分支（例如收获作物时的背包溢出情形，或叠加毒素伤害的计算漏洞），从而保障游戏的长期稳定性[^2].

#### **Import Activity**

可通过 `Window > Analysis > Import Activity` 打开，或在 Project 窗口 / Inspector 标题栏中右键点击任意资源并选择 `View in Import Activity Window` 启动，该工具完整揭示了资源导入至 Asset Database 的全过程历史与性能数据[^11]。Import Activity 界面提供每个资源的 GUID 标识符、源文件大小（`Asset Size`）、以毫秒为单位的导入耗时（`Duration`）、触发资源重新导入的具体原因（`Reason for Import`）、在 `Library` 文件夹中生成的文件列表及对应的 Artifact ID（`Produced Files / Artifacts`，包含来自 `PreviewImporter` 的预览文件），以及该资源的完整依赖链（`Dependencies`）[^12]。特别是点击工具栏中的 `Show Overview` 后，概览面板会统计出依赖项最多的资源列表（`Most Dependencies`）与导入耗时最长的资源列表（`Longest Import Duration`），并提供 `Analyze Import Process` 功能来自动指出导入流程中的隐患及修复建议[^11]。

需要特别注意的一个技术细节是，由于后台运行着 Artifact 垃圾清理机制，先前的导入历史列表（`Show previous imports`）会在重启 Unity Editor 时被自动清除；若想在多个工作会话之间保留该历史以便进行深度分析，工程师需要进入 `Edit > Project Settings > Editor`，找到 `Asset Pipeline` 并关闭 `Remove unused Artifacts on Restart` 选项[^11]。此外，自定义脚本中 `OnPostprocessAllAssets` 方法的处理时间不会被计入概览表中单个资源的独立导入耗时内[^37]。在《*GilongWorld*》项目中，高达 35–50 GB 的资源库包含大量会衍生出材质与动画等众多子 artifact 的龙类及神话生物 `.fbx` 模型，外加在切换平台或修改依赖文件时极易触发批量重导的复杂 Compute Shader 系统，因此 Import Activity 是缩短整个开发团队等待时间不可或缺的利器[^2]。

#### **Project Auditor**

Project Auditor（由 `com.unity.project-auditor` 配合规则包 `com.unity.project-auditor-rules` 运行，并自 Unity 6.4 版本起直接内置于编辑器中）是一款全面的静态分析工具，专门扫描 C# 源代码、资源、项目设置以及构建报告（`BuildReport`）并给出优化警告[^15]。Project Auditor 的一项独特优势在于它能够解析并可视化展示 `BuildReport` 对象——这份包含每个构建步骤耗时（`Build Steps`）和各资源占用体积（`Size information`）的数据在每次打包完成后通常处于隐藏状态[^18]。通过在 `ProjectAuditorConfig` 配置文件（通常位于 `Assets/Editor`）中启用 `Save Build Reports` 选项，每次打包报告都会作为资源自动保存至 `Assets/BuildReports` 文件夹中，随时可供查阅[^18]。

在《*GilongWorld*》的实战中，运行 Project Auditor 可以全面排查战斗、农耕与炼金系统的源代码，在提交测试前尽早发现导致 GC 垃圾内存分配或拖慢 CPU 的 API 调用[^2]。同时，其 `BuildReport` 与资源审查功能还能帮助技术团队将安装体积严格控制在 35–50 GB 范围内，迅速识别出未按 DirectX 12 标准与 16 GB RAM 上限要求进行正确压缩的纹理或音频文件[^2]。

## **按《GilongWorld》开发阶段划分的工具配置策略**

如果零散地使用全部 13 款分析工具，或者等到项目接近尾声时才开始性能测量，极易导致不得不重写核心架构的风险。对于像《*GilongWorld*》这样包含多重系统的开放世界项目，应当沿着生产生命周期的五个阶段，按照战略路线图系统性地启用 Analysis 菜单中的工具[^2]。

| 开发阶段 | 《GilongWorld》重点技术目标 | 需使用的核心 Analysis 工具 | 标准执行频率与流程 |
| :---- | :---- | :---- | :---- |
| **1. 前期制作与资源入库（Pre-Production & Asset Ingestion）** | 规范 3D 生物模型、科幻基地建筑、纹理与音效（35–50 GB 规模）的导入流程[^2]。 | Import Activity、Project Auditor（Assets 与 Settings 分支）[^11]。 | 每当添加新资源包或编写 `AssetPostprocessor` 脚本时进行检查，以将导入耗时降至最低[^11]。 |
| **2. 核心功能开发（Feature Prototyping & Iteration）** | 开发动作 RPG 战斗机制、坐骑控制、基地建筑网格放置、农耕及炼金界面[^2]。 | Input Debugger、Physics Debugger、Performance Markers、IMGUI Debugger[^7]。 | 在编写每个新功能代码时每日使用，以验证碰撞逻辑、输入绑定及新函数的微秒级开销[^7]。 |
| **3. 图形与特效开发（LookDev, Shaders & VFX）** | 搭建开放世界光照、在 DirectX 12 下为 URP 编写 Custom Renderer Feature、制作毒雾/炼金炸药特效[^2]。 | Render Graph Viewer、Rendering Debugger、Frame Debugger[^13]。 | 在编写 `RecordRenderGraph` 或调整 Material/VFX 时直接保持开启，以确保 Pass 顺利合并且无过度绘制[^6]。 |
| **4. 持续集成与自动化测试（Automated Testing & CI/CD）** | 保护炼金配方精度、基地存档/读档完整性，防止低质量代码合入主分支[^2]。 | Code Coverage、Project Auditor（通过 CLI `-batchmode` 运行）[^20]。 | 在构建服务器上每晚或每次创建合并分支时通过命令行参数 `-executeMethod` 自动执行[^40]。 |
| **5. 深度优化与版本锁定（Deep Optimization & Pre-Release）** | 确保在 Core i5-8500 + GTX 1060 / RX 6500 XT 上保持稳定 FPS，内存严格控制在 16 GB RAM 以内，打包体积控制在 35–50 GB 以下[^2]。 | Profiler、Profiler (Standalone Process)、Profile Analyzer、Project Auditor (BuildReport)[^16]。 | 在运行于最低目标硬件的独立构建版本上进行测量；始终使用 Profile Analyzer 对修复前后的采样做统计学对比[^23]。 |

在第一阶段，当 3D 美术团队持续向项目中提交神话生物模型、基地建筑组件与科幻材质时，必须立即启用 Import Activity 与 Project Auditor 的资源检查分支来建立标准导入规则集（Presets），防止单个配置不当的资源拖长全组的编译等待时间[^2]. 进入第二阶段功能开发后，玩法程序员应当常驻打开 Performance Markers 窗口，输入 `avg>1ms` 或 `avg<512kb` 等快捷查询来检验刚写完的算法（如基地放置时的地面检测射线）的执行开销，并同步开启 Physics Debugger 与 Input Debugger 来微调战斗手感及坐骑操控响应[^2].

当项目步入第三阶段图形打磨时，Render Graph Viewer、Rendering Debugger 与 Frame Debugger 三剑客便成为图形团队的核心工作台，用于把控 URP 中的每一道 Render Pass，确保所有炼金特效与科幻光照都能在 DirectX 12 上充分利用通道合并与临时显存复用机制[^2]。与此同时，在第四阶段持续集成中，Code Coverage 与 Project Auditor 应通过命令行以无头模式（headless）启动 Unity，纳入自动化检查流水线[^20]：

```bash
path/to/unity/executable -batchmode -quit -projectPath path/to/your/project -executeMethod ProjectAuditorCI.AuditAndExport
```

在该自动化脚本中，工程师可以实例化针对 `Assembly-CSharp` 程序集、指定 `IssueCategory.Code` 类别的 `AnalysisParams` 对象，并结合 `AnalysisParams.WithAdditionalDiagnosticRules` 方法提高特定检查规则的严重级别（Severity），将扫描结果导出为 `.json` 文件，从而在破坏性能的代码合入主开发分支之前就及时拦截[^40]。最后，在发布前的全面优化阶段，将连接在最低配置硬件运行包上的 Profiler (Standalone Process) 与 Profile Analyzer 以及 Project Auditor 中的 `BuildReport` 结合起来，即可确保《*GilongWorld*》在 16 GB RAM 与 GTX 1060 / RX 6500 XT 显卡的限制下绝对稳定运行[^2]。

## **值得特别关注的隐藏分析工具与扩展诊断包**

除了直接在 `Window > Analysis` 菜单中显示的 13 款工具之外，Unity 生态中还隐藏着许多深层分析工具，它们分布在其他菜单分支、内部诊断设置面板（`Edit > Preferences > Diagnostics`）、命令行启动参数中，或者作为扩展包存在于 Package Manager 内[^43]。对于像《*GilongWorld*》这样技术要求极为严苛的项目，启用这些隐藏工具能够填补默认工具集尚未彻底覆盖的盲区。

### **深度 Memory Profiler 扩展包（`com.unity.memoryprofiler`）**

标准 Profiler 窗口内置的 Memory 模块仅提供按大类统计内存分配体积的宏观计数器[^8]。为了真正驾驭《*GilongWorld*》在最低配置和推荐配置之间恒定不变的 **16 GB RAM** 上限，技术团队必须通过 Package Manager 安装 **Memory Profiler**（`com.unity.memoryprofiler`）扩展包，以解锁专用的内存分析窗口[^2]。该工具支持捕获详尽的全面内存快照（Memory Snapshots），将两个不同时间点的快照置于同一视图进行对比从而精确追踪引发内存泄漏的对象，并能可视化虚拟内存布局图（Memory Layout）以发现内存碎片化现象[^8]。在玩家探索开放世界、持续建造基地、收获作物并召唤数十种不同生物的过程中，对比跨区域移动前后的内存快照，能帮助程序员立即发现尚未从 RAM 中释放的重量级图形资源[^2]。

### **Addressables Analyze 窗口（`Window > Asset Management > Addressables > Analyze`）**

鉴于总存储容量高达 **最低 35 GB、推荐 50 GB**，《*GilongWorld*》的资源打包与加载方式直接决定着硬盘占用和内存消耗[^2]。在使用 Addressables 系统时，一个极其关键的分析工具隐藏在 `Window > Asset Management > Addressables > Analyze` 路径下[^45]。该窗口运行着多项资源布局检查规则——其中最核心的是检测打包体之间重复依赖的规则（`Check Duplicate Bundle Dependencies`）——同时允许程序员根据项目需求编写自定义的 `AnalyzeRules` 规则[^9]。如果某个科幻金属材质、炼金粒子特效或音频文件未做独立拆分，而同时被基地资源组与生物资源组引用，Unity 就会将该资源复制进多个不同的 AssetBundle 中，既浪费磁盘空间，又会在游戏运行时将重复数据载入 16 GB RAM 内存中[^2]。运行 Addressables Analyze 报告将暴露所有这些重复点，帮助工程师以最优结构重组数据包[^9]。

### **UI Toolkit Debugger 与 Event Debugger（`Window > UI Toolkit > Debugger`）**

针对《*GilongWorld*》复杂的用户界面系统——包括多层炼金制作台、物品背包、农场管理界面以及驯服生物名录——如果项目采用现代 UI Toolkit 框架，对应的诊断工具并不在 Analysis 菜单中，而是位于 `Window > UI Toolkit > Debugger`（或在 Play Mode 中通过快捷键 ``Ctrl + Shift + ` ``，抑或点击 Game View 与 UI Builder 窗口角落的三点菜单图标 `⋮` 快速开启）[^2]。UI Toolkit Debugger 的工作方式类似于网页浏览器中的元素检查器，它实时展示 `VisualElement` 层级树、列出所有匹配的 USS 样式选择器（`Matching Selectors`）、允许直接修改显示属性并即时预览结果，还可以切换重绘区域（Repaint）、布局边界（Layout）与线框（Wireframe）的检查叠加层[^43]。

在 UI Builder 中直接进行调试时，开发者需要开启 Preview 模式（视口周围会出现橙色边框）以禁用设计器专用的隐藏鼠标事件捕获层，从而让 `Pick Element` 工具能够准确选中底层的实际 UI 元素[^43]。此外，由于 `ScrollView`、`ListView`、`Slider` 或 `DropdownField` 等复合控件始终包含在 UI Builder 中呈半透明灰色显示的隐藏内部子元素（例如 `#unity-content-container`），将 UI Toolkit Debugger 与 Event Debugger 结合使用，是在为《*GilongWorld*》设计界面时探查内部 USS 类名及追踪鼠标事件流的唯一可靠途径[^56]。

### **Preferences、Project Settings 与命令行参数中的底层诊断开关**

隐藏在 `Edit > Preferences > Diagnostics`（macOS 上为 `Unity > Settings > Diagnostics`）、`Edit > Preferences > Jobs` 以及 Asset Pipeline 设置深处的内部诊断开关，是解决最棘手系统级 Bug 的利器[^12]。

| 隐藏诊断开关 / CLI 参数 | Unity 内启用路径 | 深度诊断机制与《GilongWorld》实战应用 |
| :---- | :---- | :---- |
| **ObjectSetDirty Diagnostic Flag** | `Edit > Preferences > Diagnostics > Core > ObjectSetDirty`（重启编辑器并将 Stack Trace Logging 设为 Full）[^12]。 | 每当对象被标记为已修改（`Increment Dirty(count) : [InstanceID] ObjectName`）或清除脏标记（`Clear Dirty(0)`）时，向 Editor Log 输出完整调用栈[^12]。当《*GilongWorld*》的生物 Prefab 或 Scene 莫名自动变脏导致 Git 冲突并迫使编辑器不断重导资源时，可借此定位元凶[^12]。 |
| **Enable FMOD Profiling** | `Edit > Preferences > Diagnostics > Audio > Enable FMOD Profiling`[^61]。 | 解锁测量 Audio Mixer 中每个音效滤波器（DSP Effect）CPU 占用率的能力[^61]。配合 `Auto Mixer Suspend` 功能（将静音挂起阈值调高至默认的 `-80 dB` 以上），消除后台运行的数百个环境音与生物音效引起的 CPU 卡顿[^61]。 |
| **Jobs Leak Detection Level + CLI Stats** | `Edit > Preferences > Jobs > Leak Detection Level > Enabled with Stack Trace` 配合启动参数 `-log-memory-performance-stats`[^47]。 | 当《*GilongWorld*》使用 Burst Jobs 和 UniTask 处理寻路或射线检测时[^7]，若忘记对 `NativeContainer` 调用 `Dispose()` 或让临时分配器存活超过 4 帧（未使用 `Allocator.Persistent`），就会造成原生内存泄漏[^47]。此设置可打印出引发泄漏的精确调用栈[^47]。 |
| **恢复诊断开关（`--reset-diagnostic-switches`）** | 启动项目时通过 Unity Hub 或 `.bat` 脚本传入 `--reset-diagnostic-switches` 参数[^47]。 | 由于 `Preferences > Diagnostics` 中的标志深入作用于引擎底层并可能引起编辑器不稳定，该命令行参数可作为安全阀，将所有诊断开关恢复至默认状态[^47]。 |
| **隐藏的资源导入流水线优化（Asset Pipeline Tweaks）** | `Project Settings > Editor > Asset Pipeline > Parallel Import` 与 `Preferences > Asset Pipeline > Compress Textures on Import`[^12]。 | 开启 `Parallel Import` 以实现纹理、模型和音频的多线程并行导入；关闭 `Compress Textures on Import`（或在 `EditorUserSettings.asset` 中设置 `m_CompressAssetsOnImport: 0`），关闭 Rider 自动刷新并关闭 `Index on Editor Startup`（`Preferences > Search > Indexing`），从而大幅提升处理 35–50 GB 资源库的迭代速度[^12]。 |

除了上述内部开关之外，当程序员为《*GilongWorld*》的开放世界编写批量资源处理工具时（例如使用 `AssetDatabase.CopyAsset` 或 `DeleteAsset` 自动生成农作物 Prefab 或基地构件的工具），务必注意将该代码块包裹在调用次数严格成对匹配的 `AssetDatabase.StartAssetEditing()` 与 `AssetDatabase.StopAssetEditing()` 函数之间，以在每条命令执行间隙暂停数据库刷新，从而防止编辑器卡死[^2]。最后，在 DirectX 12 硬件层面上，Unity 已支持将 GPU 性能标记（GPU Performance Markers / `D3DPERF_BeginEvent` 与 `D3DPERF_EndEvent`）直接传递至显卡驱动程序[^2]。在针对 GTX 1060 / RTX 2080 以及 RX 6500 XT / RX 6700 XT 进行最终优化阶段时，技术团队应当结合显卡厂商提供的底层图形分析器（如 NVIDIA Nsight 或 AMD 分析工具）来读取这些标记，精准测量各目标 GPU 架构上 Vertex Shader、Pixel Shader 与 Compute Shader 阶段的实际繁忙时间[^2]。

## **总结与《GilongWorld》实战落地路线图**

为确保像《*GilongWorld*》这样融合了多种复杂机制的大型项目在 DirectX 12 指令集下发挥最佳性能，同时不突破 **16 GB RAM** 上限、**35–50 GB** 存储空间以及最低配置 **Core i5-8500 / Ryzen 5 2600X** 和 **GTX 1060 / RX 6500 XT** 的硬件能力限制，Long Gil Studio 开发团队需要将 Unity 6 的分析工具生态整合为一套贯穿始终的工程工作流[^2]。

在日常研发流程中，启用 Parallel Import、通过 Import Activity 管控依赖链以及善用隐藏的 `ObjectSetDirty` 标志，将在海量资源面前有效保障编辑器的运行响应速度[^11]。在开发战斗、驯服生物、建造堡垒与炼金功能的过程中，常规性地使用 Performance Markers、Physics Debugger、Input Debugger 与 UI Toolkit Debugger，有助于程序员将微观瓶颈扼杀在萌芽状态[^2]。在图形与内存层面，Render Graph Viewer、Frame Debugger、Rendering Debugger、Memory Profiler 扩展包以及 Addressables Analyze 窗口之间的紧密配合，能够确保所有图像缓冲区都得到高效复用，且没有任何资源被重复加载进内存[^6]。最终，在持续集成流水线中自动化运行 Project Auditor 与 Code Coverage，再结合借助 Profiler (Standalone Process) 与 Profile Analyzer 开展的对照分析法，将构筑起坚实的质量控制体系，推动《*GilongWorld*》迈向成熟 AAA Indie 作品的技术水准[^3]。

---

## **参考文献**

[^1]: GilongWorld trên Steam - [https://store.steampowered.com/app/4615990/GilongWorld/?l=vietnamese](https://store.steampowered.com/app/4615990/GilongWorld/?l=vietnamese)
[^2]: GilongWorld on Steam - [https://store.steampowered.com/app/4615990/GilongWorld/](https://store.steampowered.com/app/4615990/GilongWorld/)
[^3]: Support Long Gil Studio - Ko-fi - [https://ko-fi.com/A0A01PQDEB/posts](https://ko-fi.com/A0A01PQDEB/posts)
[^4]: GilongWorld - SteamDB - [https://steamdb.info/app/4615990/](https://steamdb.info/app/4615990/)
[^5]: GilongWorld - Steam Community - [https://steamcommunity.com/app/4615990](https://steamcommunity.com/app/4615990)
[^6]: Unity 6 URP Render Graph Deep Dive: Why Rendering Moved to a - [https://gamedevllm.com/en/unity6-urp-render-graph-basics-en/](https://gamedevllm.com/en/unity6-urp-render-graph-basics-en/)
[^7]: Best way to detect a true range of a transform? : r/Unity3D - Reddit - [https://www.reddit.com/r/Unity3D/comments/1s1xhs6/best_way_to_detect_a_true_range_of_a_transform/](https://www.reddit.com/r/Unity3D/comments/1s1xhs6/best_way_to_detect_a_true_range_of_a_transform/)
[^8]: Memory Profiler module introduction • Unity Editor • Unity Docs - [https://docs.unity.com/en-us/engine/6000.5/manual/analysis/profiler/visualizing-data/memory/introduction](https://docs.unity.com/en-us/engine/6000.5/manual/analysis/profiler/visualizing-data/memory/introduction)
[^9]: Suggested Addressables Analyze tool improvements - [https://discussions.unity.com/t/suggested-addressables-analyze-tool-improvements/777614](https://discussions.unity.com/t/suggested-addressables-analyze-tool-improvements/777614)
[^10]: Migrating to Render Graph tutorial: Understanding the RenderGraph - [https://discussions.unity.com/t/migrating-to-render-graph-tutorial-understanding-the-rendergraph-samples/1715833](https://discussions.unity.com/t/migrating-to-render-graph-tutorial-understanding-the-rendergraph-samples/1715833)
[^11]: Import Activity window introduction - Unity Documentation - [https://docs.unity.com/en-us/engine/7000.0/manual/assets-and-media/import-assets/import-analyze/import-activity-window](https://docs.unity.com/en-us/engine/7000.0/manual/assets-and-media/import-assets/import-analyze/import-activity-window)
[^12]: Reducing Assets Import times in Unity - DEV Community - [https://dev.to/attiliohimeki/reducing-assets-import-times-in-unity-2kn2](https://dev.to/attiliohimeki/reducing-assets-import-times-in-unity-2kn2)
[^13]: Analyze a render graph in URP - Unity - Manual - [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/render-graph-view.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/render-graph-view.html)
[^14]: Search performance trackers - Unity Docs - [https://docs.unity.com/en-us/engine/6000.6/manual/unity-editor/editor-navigating-managing/editor-searching/search-overview/search-by-provider/search-performance-and-debugging-overview/search-performance](https://docs.unity.com/en-us/engine/6000.6/manual/unity-editor/editor-navigating-managing/editor-searching/search-overview/search-by-provider/search-performance-and-debugging-overview/search-performance)
[^15]: Project Auditor package - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.project-auditor@latest/](https://docs.unity3d.com/Packages/com.unity.project-auditor@latest/)
[^16]: Running the Profiler in its own process - Unity - Manual - [https://docs.unity3d.com/Manual/profiler-standalone-process.html](https://docs.unity3d.com/Manual/profiler-standalone-process.html)
[^17]: Import Activity window reference - Unity Docs - [https://docs.unity.com/en-us/engine/7000.0/manual/assets-and-media/import-assets/import-analyze/import-activity-window-reference](https://docs.unity.com/en-us/engine/7000.0/manual/assets-and-media/import-assets/import-analyze/import-activity-window-reference)
[^18]: Getting Started with Project Auditor - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.project-auditor@0.10/manual/GettingStarted.html](https://docs.unity3d.com/Packages/com.unity.project-auditor@0.10/manual/GettingStarted.html)
[^19]: Import Activity window - Unity - Manual - [https://docs.unity3d.com/2021.3/Documentation/Manual/ImportActivityWindow.html](https://docs.unity3d.com/2021.3/Documentation/Manual/ImportActivityWindow.html)
[^20]: Search profiler markers - Unity - Manual - [https://docs.unity3d.com/6000.2/Documentation/Manual/search-profiler-markers.html](https://docs.unity3d.com/6000.2/Documentation/Manual/search-profiler-markers.html)
[^21]: Performance Markers Editor Window - Unity Discussions - [https://discussions.unity.com/t/performance-markers-editor-window/1668474](https://discussions.unity.com/t/performance-markers-editor-window/1668474)
[^22]: UI Toolkit Debugger - Unity - Manual - [https://docs.unity3d.com/2022.3/Documentation/Manual/UIE-ui-debugger.html](https://docs.unity3d.com/2022.3/Documentation/Manual/UIE-ui-debugger.html)
[^23]: Understanding Memory usage - Unity Discussions - [https://discussions.unity.com/t/understanding-memory-usage/934773](https://discussions.unity.com/t/understanding-memory-usage/934773)
[^24]: Remote Visualization and Optimization of Fluid Dynamics Using - [https://www.mdpi.com/2076-3417/15/16/9017](https://www.mdpi.com/2076-3417/15/16/9017)
[^25]: Remote Visualization and Optimization in Fluid Dynamics via Mixed - [https://par.nsf.gov/servlets/purl/10597014](https://par.nsf.gov/servlets/purl/10597014)
[^26]: Search profiler markers • Unity Editor • Unity Docs - [https://docs.unity.com/en-us/engine/7000.0/manual/unity-editor/editor-navigating-managing/editor-searching/search-overview/search-by-provider/search-performance-and-debugging-overview/search-profiler-markers](https://docs.unity.com/en-us/engine/7000.0/manual/unity-editor/editor-navigating-managing/editor-searching/search-overview/search-by-provider/search-performance-and-debugging-overview/search-profiler-markers)
[^27]: Render graph system in URP - Unity - Manual - [https://docs.unity3d.com/6000.5/Documentation/Manual/urp/render-graph.html](https://docs.unity3d.com/6000.5/Documentation/Manual/urp/render-graph.html)
[^28]: Render graph system in URP - Unity Docs - [https://docs.unity.com/en-us/engine/6000.0/manual/render-pipelines/universal-render-pipeline/customizing-urp/render-graph](https://docs.unity.com/en-us/engine/6000.0/manual/render-pipelines/universal-render-pipeline/customizing-urp/render-graph)
[^29]: Render Graph Viewer window reference for URP - Unity - Manual - [https://docs.unity3d.com/6000.0/Documentation/Manual/urp/render-graph-viewer-reference.html](https://docs.unity3d.com/6000.0/Documentation/Manual/urp/render-graph-viewer-reference.html)
[^30]: Analyze a render graph in URP - Unity Docs - [https://docs.unity.com/en-us/engine/7000.0/manual/render-pipelines/universal-render-pipeline/customizing-urp/render-graph/view](https://docs.unity.com/en-us/engine/7000.0/manual/render-pipelines/universal-render-pipeline/customizing-urp/render-graph/view)
[^31]: Render Graph - Introduction - The Knights of U - [https://theknightsofu.com/render-graph-introduction/](https://theknightsofu.com/render-graph-introduction/)
[^32]: Introduction of Render Graph in the Universal Render Pipeline (URP) - [https://discussions.unity.com/t/introduction-of-render-graph-in-the-universal-render-pipeline-urp/930355?page=16](https://discussions.unity.com/t/introduction-of-render-graph-in-the-universal-render-pipeline-urp/930355?page=16)
[^33]: Render graph system in URP - Unity - Manual - [https://docs.unity3d.com/6000.0/Documentation/Manual/urp/render-graph.html](https://docs.unity3d.com/6000.0/Documentation/Manual/urp/render-graph.html)
[^34]: Unity 6000.0.23f1 - [https://unity.com/releases/editor/whats-new/6000.0.23f1](https://unity.com/releases/editor/whats-new/6000.0.23f1)
[^35]: Manual: Optimize a render graph - Unity - [https://docs.unity.cn/6000.6/Documentation/Manual/urp/render-graph-optimize.html](https://docs.unity.cn/6000.6/Documentation/Manual/urp/render-graph-optimize.html)
[^36]: Project Auditor • Unity Editor • Unity Docs - [https://docs.unity.com/ko-KR/engine/6000.3/manual/packages-list/packages-all/pack-safe/com-unity-project-auditor](https://docs.unity.com/ko-KR/engine/6000.3/manual/packages-list/packages-all/pack-safe/com-unity-project-auditor)
[^37]: 【Unity2021.2新機能】各アセットのインポート時間が一覧表示 - [https://light11.hatenadiary.com/entry/2021/09/06/201931](https://light11.hatenadiary.com/entry/2021/09/06/201931)
[^38]: Unity Docs - Project Auditor Rules - [https://docs.unity.com/en-us/engine/6000.6/manual/packages-list/packages-all/pack-safe/com-unity-project-auditor-rules](https://docs.unity.com/en-us/engine/6000.6/manual/packages-list/packages-all/pack-safe/com-unity-project-auditor-rules)
[^39]: Importing assets - Unity Docs - [https://docs.unity.com/engine/6000.5/manual/assets-and-media/import-assets](https://docs.unity.com/engine/6000.5/manual/assets-and-media/import-assets)
[^40]: Run Project Auditor from the command line - Unity Documentation - [https://docs.unity.com/en-us/engine/7000.0/manual/analysis/project-auditor/programming/run-from-command-line](https://docs.unity.com/en-us/engine/7000.0/manual/analysis/project-auditor/programming/run-from-command-line)
[^41]: Static code and project analysis with Project Auditor : r/Unity3D - [https://www.reddit.com/r/Unity3D/comments/1cbxlco/static_code_and_project_analysis_with_project/](https://www.reddit.com/r/Unity3D/comments/1cbxlco/static_code_and_project_analysis_with_project/)
[^42]: Creating custom analyzers | Project Auditor | 2.0.0 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.project-auditor@2.0/manual/custom-analyzers.html](https://docs.unity3d.com/Packages/com.unity.project-auditor@2.0/manual/custom-analyzers.html)
[^43]: UI Toolkit Debugger - Unity Docs - [https://docs.unity.com/engine/7000.0/manual/uitoolkits/uielements/uie-test-ui/uie-ui-debugger](https://docs.unity.com/engine/7000.0/manual/uitoolkits/uielements/uie-test-ui/uie-ui-debugger)
[^44]: Memory Profiler module - Unity - Manual - [https://docs.unity3d.com/2022.3/Documentation/Manual/ProfilerMemory.html](https://docs.unity3d.com/2022.3/Documentation/Manual/ProfilerMemory.html)
[^45]: Analyze tool | Addressables | 1.25.1 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@1.25/manual/AnalyzeTool.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.25/manual/AnalyzeTool.html)
[^46]: Reducing Assets Import times in Unity - Technical Articles - [https://discussions.unity.com/t/reducing-assets-import-times-in-unity/1702346](https://discussions.unity.com/t/reducing-assets-import-times-in-unity/1702346)
[^47]: How to get useful information from memory leak log? - [https://discussions.unity.com/t/how-to-get-useful-information-from-memory-leak-log/949612](https://discussions.unity.com/t/how-to-get-useful-information-from-memory-leak-log/949612)
[^48]: Memory Profiler | 1.0.0 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.memoryprofiler@1.0/manual/index.html](https://docs.unity3d.com/Packages/com.unity.memoryprofiler@1.0/manual/index.html)
[^49]: Unity Editor • Unity Docs - Memory Profiler - [https://docs.unity.com/ko-KR/engine/6000.0/manual/packages-list/packages-all/pack-safe/com-unity-memoryprofiler](https://docs.unity.com/ko-KR/engine/6000.0/manual/packages-list/packages-all/pack-safe/com-unity-memoryprofiler)
[^50]: Extended Q&A: Optimizing memory and build size with Addressables - [https://unity.com/blog/engine-platform/extended-q-a-optimizing-memory-and-build-size-with-addressables](https://unity.com/blog/engine-platform/extended-q-a-optimizing-memory-and-build-size-with-addressables)
[^51]: Addressables Analyze window reference - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@2.7/manual/analyze-addressables-window-reference.html](https://docs.unity3d.com/Packages/com.unity.addressables@2.7/manual/analyze-addressables-window-reference.html)
[^52]: Addressables Analyze window | Addressables | 3.1.0 - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@3.1/manual/analyze-addressables-window.html](https://docs.unity3d.com/Packages/com.unity.addressables@3.1/manual/analyze-addressables-window.html)
[^53]: Addressables Analyze | Package Manager UI website - Unity - Manual - [https://docs.unity3d.com/Packages/com.unity.addressables@1.1/manual/AddressableAssetsAnalyze.html](https://docs.unity3d.com/Packages/com.unity.addressables@1.1/manual/AddressableAssetsAnalyze.html)
[^54]: Addressables-Sample - Unity-Technologies - GitHub - [https://github.com/Unity-Technologies/Addressables-Sample](https://github.com/Unity-Technologies/Addressables-Sample)
[^55]: UI Toolkit Debugger - Unity - Manual - [https://docs.unity3d.com/6000.1/Documentation/Manual/UIE-ui-debugger.html](https://docs.unity3d.com/6000.1/Documentation/Manual/UIE-ui-debugger.html)
[^56]: Mastering Unity UI Toolkit: Styling Complex Elements - Medium - [https://medium.com/@lemapp09/mastering-unity-ui-toolkit-styling-complex-elements-9d339636de00](https://medium.com/@lemapp09/mastering-unity-ui-toolkit-styling-complex-elements-9d339636de00)
[^57]: Manual: UI Toolkit - Unity - [https://docs.unity.cn/2020.3/Documentation/Manual/UIElements.html](https://docs.unity.cn/2020.3/Documentation/Manual/UIElements.html)
[^58]: Test UI in UI Builder - Unity Docs - [https://docs.unity.com/en-us/engine/6000.5/manual/uitoolkits/uielements/uibuilder/uib-testing-ui](https://docs.unity.com/en-us/engine/6000.5/manual/uitoolkits/uielements/uibuilder/uib-testing-ui)
[^59]: Test UI - Unity Docs - [https://docs.unity.com/en-us/engine/7000.0/manual/uitoolkits/uielements/uie-test-ui](https://docs.unity.com/en-us/engine/7000.0/manual/uitoolkits/uielements/uie-test-ui)
[^60]: Inspect UI Toolkit events with Event Debugger - Unity Documentation - [https://docs.unity.com/ko-kr/engine/6000.7/manual/uitoolkits/uielements/uie-test-ui/event-debugger](https://docs.unity.com/ko-kr/engine/6000.7/manual/uitoolkits/uielements/uie-test-ui/event-debugger)
[^61]: AudioGroup Inspector - Unity - Manual - [https://docs.unity3d.com/6000.1/Documentation/Manual/AudioMixerInspectors.html](https://docs.unity3d.com/6000.1/Documentation/Manual/AudioMixerInspectors.html)
[^62]: AudioGroup Inspector - Unity - Manual - [https://docs.unity3d.com/6000.6/Documentation/Manual/AudioMixerInspectors.html](https://docs.unity3d.com/6000.6/Documentation/Manual/AudioMixerInspectors.html)
[^63]: Unity 2020.1.0a25 - [https://unity.com/releases/editor/alpha/2020.1.0a25](https://unity.com/releases/editor/alpha/2020.1.0a25)
[^64]: Previous version features and release notes - AMD GPUOpen - [https://gpuopen.com/archived/previous-version-features-release-notes/](https://gpuopen.com/archived/previous-version-features-release-notes/)
