---
title: "面向 Unity 6 的 CLAUDE.md 架构部署战略：Prompt Caching 优化、Agent 技能集成及 Unity 6.7 LTS 升级路线图"
date: 2026-11-25 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, claude-code, ai-agents, prompt-caching, coreclr, render-graph, awaitable, gilongworld]
description: "面向 Unity 6（6000.5 至 6.7 LTS）项目的分层 CLAUDE.md 架构设计战略：利用 Prompt Caching 降低 90% 成本、集成 Agent Skills 并强制规范 Awaitable 异步规则。"
lang: zh-CN
translation_id: unity6-claude-md-prompt-caching-skills
---

软件开发中的生成式人工智能与实时图形工具的融合，正在重塑整个电子游戏和交互式应用行业的生产方式。在这一生态体系中，Claude Code 凭借其精密的分层上下文管理架构，脱颖而出成为一款卓越的命令行编程智能体。该行为引导系统的核心是 `CLAUDE.md` 配置文件——一个确保 AI 智能体始终在组织规范框架内运行的项目元数据仓库[^1]。与此同时，Unity 平台正随着 Unity 6 发布系列经历一场代际转折。当前的 6000.5 版本不仅是一次功能更新，更是一场深入底层的核心重构，标志着旧有系统的终结，并为预计于 2027 年初发布的长期支持版本（Long-Term Support）Unity 6.7 LTS 奠定基础[^2]。

构建一个能够适应 Unity 6 持续演进的 `CLAUDE.md` 结构，需要融合三大复杂的技术支柱。第一是管控并优化 Anthropic 的提示词缓存（Prompt Caching）系统，以在不丢失技术上下文的前提下，彻底降低长会话过程中的计算资源（token）开销[^3]。第二是通过 `Unity-Technologies/skills` 仓库集成智能体技能（Agent Skills）生态，在不膨胀静态内存的情况下充分发挥与 Unity 命令行界面自动交互的能力[^5]。第三是深入理解 Unity 6000.5 中的最新技术机制——从基于 `Awaitable` 的异步编程、RenderGraph 图形架构，到对 CoreCLR 的支持路线图——从而制定出精准的 AI 引导规则集，并在项目向 6.7 LTS 演进的过程中保持抗过时能力[^6]。本篇全面分析将勾勒出一套战略规划，旨在打造一个同步、高效且能灵活应对未来变化的开发环境。

## **Claude Code 中的前缀内存动力学与 Prompt Caching 优化**

在庞大代码库中配合大语言模型（LLM）工作时的核心挑战，是上下文漂移（context drift）以及处理成本的指数级增长。Claude Code 通过一项名为 Prompt Caching 的基础架构机制解决了这一难题。该特性基于对模型在读取和解析前缀文本段落时生成的中间数学矩阵（特别是 KV 缓存中的 Key 和 Value 矩阵）进行存储[^3]。

在开发环境中运行时，对于存活时间（TTL）为 5 分钟的缓存配置，首次写入缓存（cache write）需要比常规 token 处理高出 25% 的费用；对于 1 小时 TTL 的配置，成本则为两倍[^4]。然而，真正的价值体现在后续的缓存读取（cache read）中——此时消耗成本仅为基础价格的约 10%，相当于为整个项目上下文节省高达 90% 的费用[^4]。要使该机制生效，输入结构必须绝对满足前缀匹配约束（prefix match constraint）。哪怕文本序列中发生任何极其微小的变化（哪怕仅是一个字节或一个空格字符），从该位置起往后的所有缓存都会立即失效，迫使系统从头重新计算矩阵运算[^3]。

深刻理解这一严苛要求后，Claude Code 被设计为按照稳定性递减的顺序来编排发送给服务器的文本布局（prompt layout）。数据块以固定的系统提示词（System Prompt，约 4,000 tokens）开头，紧接着是工具定义（Tool Definitions），随后是 `CLAUDE.md` 文件的内容，最后以动态对话历史结尾[^3]。得益于这种顺序，同一系统内的多位用户可以共享 System Prompt 缓存，而协同开发同一代码库的工程师则会共享 `CLAUDE.md` 文件的缓存[^3]。为了保护该前缀免受实时波动（例如日期变更或 git 状态更新结果）的干扰，Claude Code 绝不会直接修改 System Prompt，而是将这些动态数据放入位于序列末尾最新一条用户消息中的 `<system-reminder>` 语义标签内，从而确保上方昂贵的前缀不被打乱[^3]。

有纪律地管理工作会话是保护缓存投入的关键。开发人员的许多常见操作可能会无意间破坏这一结构，导致不必要的成本飙升。

| 开发者操作 | 对上下文（Context）结构的影响 | Prompt Cache 状态 |
| :---- | :---- | :---- |
| **在会话中途编辑 `CLAUDE.md` 文件** | 直接修改系统前缀的静态部分。 | 全部缓存完全失效，强制重新计算（Cache Miss）[^10]。 |
| **更改努力程度（Effort）或 Fast Mode** | 在会话初始化部分插入新的配置参数或标头标签。 | 由于参数属于缓存键（Cache Key）的一部分，从而初始化全新的缓存链[^4]。 |
| **使用 `/compact` 命令清理上下文** | 截断并摘要对话历史，以释放内存空间。 | 由于重建后的对话历史改变了断点（Breakpoint）之后的结构，导致旧缓存失效[^1]。 |
| **切换模型架构（Model Switching）** | 在 Claude 3.5 Sonnet 与 Claude 3 Opus 之间切换。 | 由于每个模型的 KV 矩阵结构各异且无法共享，导致缓存丢失[^3]。 |
| **动态加载更多 MCP Server 工具** | 在发送序列的开头重新声明静态工具列表。 | 由于工具定义发生变化，导致根前缀失效[^3]。 |

为了维持高吞吐性能，缓存机制必须与智能化的命令设计相结合。Claude Code 的 Plan Mode 命令便是机器学习认知优化的典型范例。为了将 AI 置入只读状态，如果移除具有源代码编辑能力的工具，将会改变工具定义并破坏缓存；因此 Claude Code 并没有这样做，而是在前缀结构中完整保留所有工具。它仅在启动时便追加了 `EnterPlanMode` 和 `ExitPlanMode` 两个新工具，同时在对话历史中加入要求模型不得执行编辑操作的指令[^3]。这使得状态切换极其顺滑，同时不会损失缓存读取带来的 90% 折扣。在为 Unity 6 制定规划时，项目管理者必须仔细分析这些机制，以确保任何规则都能在正确的位置、正确的时机加载。

## **面向游戏开发生态系统的分层记忆框架策略**

Claude Code 的指令仓库并不局限于单一文本文件，而是通过一套包含六个不同优先级层级的配置解析层次结构（resolution hierarchy）来运行。该体系涵盖企业级策略（Managed Policy）、用户全局配置、项目级配置、个人本地配置、基于文件路径的规则，以及最终由 AI 自主归纳的自动记忆（Auto Memory）[^1]。在这一架构中，优先级遵循从窄到宽的原则：当发生冲突时，本地级别或子目录中的精细配置将覆盖全局配置[^13]。

整个系统的核心是位于项目根目录下的 `CLAUDE.md` 文件。这里是存放不可变规则的中心，用于定义游戏所用的引擎环境、编程语言、渲染系统以及基础架构[^14]。开发者往往倾向于编写长达数千行的配置文件，希望借此控制智能体的每一个行为。然而，一项基于 1,650 次 Claude Code 会话的大规模研究打破了关于该文件结构的诸多成见。分析结果表明，改变文件长度（从 25 行到 500 行）、调整规则位置（文件开头、中间或末尾），甚至使用交叉导入（imports）语法拆分文件，均未在 AI 的规则遵守度上产生具有统计学意义的差异[^16]。真正决定成败的因素在于任务的本质：当被要求生成全新代码片段时，模型对规则的遵守率高达 71.3%；但当需要修改已存在的代码片段时，该比率骤降至仅 45.1%，因为屏幕上的旧代码本身建立了一个与规则文件相竞争的上下文[^16]。

因此，将 `CLAUDE.md` 控制在 200 行以内的建议仅仅是数据整洁度方面的软性优化目标（soft target），而并非软件强制截断的边界（truncation point）[^16]。真正的 200 行截断限制实际上适用于 `MEMORY.md`——即自动记忆（Auto Memory）系统的索引文件[^16]。

| 配置管理层 | 实际文件路径 / 存储位置 | 在 Unity 项目中的角色 | Git 系统中的跟踪状态 |
| :---- | :---- | :---- | :---- |
| **用户级规则（User Global）** | `~/.claude/CLAUDE.md` | 开发者的个人偏好（例如：错误报告风格、代码格式化偏好）[^13]。 | 不跟踪（位于本机）[^13]。 |
| **项目核心规则（Project Root）** | `./CLAUDE.md` | 面向整个团队的通用设置（例如：HDRP 要求、C# 9.0、引擎架构、标准路径名称）[^13]。 | 跟踪并共享（Committed）[^13]。 |
| **个人覆盖规则（Project Local）** | `./.claude/CLAUDE.local.md` | 临时笔记、特定于开发者机器的测试信息、本地开发服务器连接字符串[^13]。 | 通过 `.gitignore` 排除（Ignored）[^13]。 |
| **按路径划分的规则（Modular Rules）** | 包含 `paths:` 的 `.claude/rules/*.md` | 针对子系统的配置（例如：`**/*CustomPass*.cs` 应用 HDRP Custom Pass 规则，`**/*Editor.cs` 应用 UI Toolkit 规则）[^13]。 | 跟踪并共享（Committed）[^19]。 |
| **自动记忆（Auto Memory）** | `~/.claude/projects/<id>/memory/MEMORY.md` | AI 自主归纳的关于调试方式、库历史记录或会话中重复错误的认知[^17]。 | 不跟踪（本地分散存储）[^17]。 |

一个经常被误解的组件是自动记忆（Auto Memory）系统。该系统旨在解决上下文重复问题，每当 Claude Code 检测到重复的编码习惯时，便会自动将 Markdown 文件写入个人配置目录中[^17]。然而，在通过工作树（worktrees）分片机制对同一份代码库进行并行开发的多智能体团队（multi-agent teams）环境中，自动记忆暴露了致命弱点：它不是线程安全的（not thread-safe）[^22]。多个智能体同时尝试覆盖写入 `MEMORY.md` 文件，会因版本竞争条件（race condition）而导致数据丢失[^22]。更有甚者，在上下文压缩（compaction）过程中，垃圾或错误的笔记可能会留存下来，并获得与原始指令同等的高度优先级，从而导致智能体自信地给出错误的规则[^23]。定期审查并将自动记忆中的有用知识迁移至永久性的模块化规则系统（Modular Rules），是必不可少的治理步骤。

模块化规则系统 `.claude/rules/` 是处理 Unity 架构复杂性的理想工具。通过在 YAML frontmatter 的 `paths:` 字段中使用通配符模式（glob patterns），架构师可以配置使 Shader 编程规则仅在 AI 与 `.shader` 或 `.hlsl` 文件交互时才被加载[^19]。如果没有 `paths:` 属性，该文件将会像 `CLAUDE.md` 一样在每次会话开始时自动加载，从而引发上下文饱和（context saturation）的风险[^19]。此外，跨工具兼容性同样值得提倡：如果团队正在维护一份 `AGENTS.md` 文件（一种受数十款其他智能体支持的开放标准），最佳实践并非全盘重写，而是在 `CLAUDE.md` 内部使用 `@AGENTS.md` 交叉导入语法实现信息的无缝衔接，打造单一事实来源（single source of truth）[^1].

## **借助 Unity-Technologies/skills 生态系统实现流程自动化**

一套完善的项目架构不仅要提供方向指引，还必须赋予强大的执行权限。使用 `skills.sh` 协议能够让 AI 智能体突破自然语言处理的局限，成为真正掌控系统的实体[^27]。技能目录（Agent Skills）包含预先封装的行为包，其中带有命令结构与 `SKILL.md` 元数据，充当着标准操作程序（Standard Operating Procedures）的角色[^27]。

官方仓库 `Unity-Technologies/skills` 提供了一套专业工具集，确保项目操作严格遵循标准 API，而非任由 AI 模型“凭空捏造”无法运行的代码片段[^5]。与在会话启动时全量加载的项目指令文件不同，技能系统采用渐进式披露（progressive disclosure）机制运行[^29]。在静默状态下，系统前缀仅记录技能的名称与简短描述（例如：在需要配置内购时使用的 `implement-in-app-purchases`）。只有当用户提出与该描述相匹配的请求时，技能完整的 C# 代码块与交互命令才会被推入执行内存中，从而大幅节省高达 98% 的维护成本[^30]。

通过命令行工具（CLI）进行的集成过程极其简便。只需运行 `npx skills add Unity-Technologies/skills --agent claude-code` 命令，系统即可从 GitHub 克隆源代码；在 GLW 中，共享技能仓库已标准化于 `.agents/skills/` 目录，并通过 `skills-lock.json` 锁定上游 Unity-Technologies 技能版本[^5]。由此，Claude Code 获得了以下超强能力：

| 智能体技能名称（Agent Skill） | 在 Unity 项目中的运行机制与执行能力 |
| :---- | :---- |
| **`unity-cli`** | 提供与 Unity Command Line 的直接交互接口。AI 无需打开图形界面即可自动安装 Unity Editor、初始化空白项目、管理许可证认证（auth），以及配置无界面构建（headless builds）[^5]。 |
| **`unity-package-management`** | 自动操作 Unity Package Manager（UPM）结构。该技能在持续集成（CI/CD）工作流中直接调用 `PackageManager.Client` C# 函数来扫描、添加、移除和更新软件包[^5]。 |
| **`build-live-game`** | 直接对接 Unity Gaming Services（UGS）平台。AI 自动处理玩家身份验证（auth）、云存档管理（cloud save）、服务端云代码（cloud code）、排行榜设置（leaderboards）以及游戏内经济系统（economy）等复杂流程[^5]。 |
| **`ui`（路由器）及其变体** | 扮演智能路由器的角色。分析项目后自动将结构分发至三个专用技能之一：用于按 Flexbox 标准编译 UXML/USS 的 `ui-uitk`，用于直接操作 Canvas 层级的 `ui-ugui`，或用于编写 Unity Editor 扩展的 `ui-imgui`[^5]。 |
| **`setup-multiplayer-services`** | 自动化配置网络基础设施。通过 Unity Multiplayer Services 处理网络拓扑模型（topology）、对局匹配系统（matchmaking）以及房间/会话管理（sessions/lobbies）[^5]。 |
| **`validate-urp-render-graph-renderer-feature`** | 在独立的 URP 项目中非常实用的技能；对于 GLW/HDRP，不将其用作自定义渲染的默认标准，而是优先采用 HDRP Custom Pass 与 `.claude/rules/rendering-rules.md` 规则。 |
| **`shader-graph-create-custom-node`** | 自动生成并处理 HLSL 源代码，以编写兼容 Shader Graph 架构的多功能自定义节点（Custom Nodes）[^5]。 |

将这些技能的使用权委托给 AI，有助于精简 `CLAUDE.md` 文件。架构设计者无需编写数百行文字去解释如何配置 IronSource 广告库，只需安装 `levelplay-unity-integration` 技能即可[^5]。当收到需求时，AI 智能体便已掌握标准的文件格式与最正确的实现路径，涵盖从接入激励视频广告（rewarded ads）到插屏广告（interstitial ads）的方方面面[^5]。

## **面向 Unity 6000.5 的图形与异步编程技术框架结构**

为了制定一套不会过时的项目指令集，必须深入剖析 Unity 6000.5 版本系统核心的深刻变革。从传统编程模型向新一代架构的过渡，要求源代码不仅在当下运行良好，还必须在移动设备平台及高性能电脑上实现能效优化。

### **异步编程：将控制权移交至 UnityEngine.Awaitable**

传统的 Unity 运行环境在单一线程（single thread）中执行，这使得处理资源加载或 AI 计算等复杂任务时，存在导致整个游戏卡死（freeze）的风险[^32]。过去，开发者往往只能依赖协程（Coroutine，它在处理数据返回值方面存在困难，且会通过垃圾回收器 GC 对内存造成压力）或 `System.Threading.Tasks.Task` 系统（一种会带来昂贵类对象分配、并未针对游戏循环进行优化的结构）[^7]。

在 Unity 6 中，平台提供了 `UnityEngine.Awaitable` 结构，这是一种专为优化电子游戏中 `async`/`await` 模式而设计的数据类型[^7]。`Awaitable` 的突破性特点在于其基于对象池（Object Pooling）机制；系统不再每次调用都分配新的内存，而是从池中取出一个空对象加以使用，并在 `await` 调用结束时立即静默清理以便复用[^7]。消除内存分配彻底解决了长期困扰优化工程师的垃圾回收卡顿尖峰（GC spikes）问题[^7]。

这一结合带来了卓越的性能，但同时也引入了一条必须在规则文件 `.claude/rules/async.md` 中明确警告 AI 模型的终极约束：**绝对不允许在同一个 `Awaitable` 对象上多次使用 `await` 命令**[^7]。当第一次调用结束时，该对象已被归还至公共对象池，并可能已被分配给另一个进程。刻意对其执行第二次 `await` 将引发未定义行为，导致程序线程挂起或抛出底层异常[^7]。

| 技术属性 | `System.Threading.Tasks.Task` | 推荐结构：`UnityEngine.Awaitable` |
| :---- | :---- | :---- |
| **内存分配（Allocation）** | 每次函数调用都会持续产生内存垃圾（GC）[^7]。 | 凭借默认的池化（Pool）设计，几乎不产生内存分配[^7]。 |
| **调用复用（`await`）** | 允许在多个不同位置对同一个任务执行 `await`[^7]。 | **严禁。** 若 `await` 两次及以上将导致内存损坏错误[^7]。 |
| **线程续行（Continuation）** | 通常切回 ThreadPool，在需要返回主线程时会造成至少 1 帧的延迟[^7]。 | 当完成信号发出时，在同一帧内立即同步执行[^7]。 |
| **线程生命周期控制** | 需要复杂的手动 `SynchronizationContext` 处理[^35]。 | 支持极速原生 API：`Awaitable.MainThreadAsync()` 与 `Awaitable.BackgroundThreadAsync()`[^7]。 |

此外，线程切换（thread switching）流程如今变得极其顺畅。在编写代码过程中，AI 智能体可以通过 `await Awaitable.BackgroundThreadAsync()` 将寻路分析运算推送至后台线程。当需要更新图形界面或从 Unity 对象读取数据时，源代码只需调用 `await Awaitable.MainThreadAsync()` 即可安全地将控制权交还主线程[^34]。这种瞬时切换能力使得开发者可以在不违反 Unity API 单线程访问原则的前提下最大化 CPU 带宽[^34]。针对动画事件，Unity 6000.5 还新增了名为 `AnimationEventInfo` 的 `ref struct` 类型结构。这种阻止动态内存分配的结构允许在复杂的角色系统中管理事件而不留下内存垃圾，是高性能项目中应当优先采用的最佳实践（best practice）[^39]。

### **全新图形架构：卓越的 RenderGraph 与 Pass 代码块分化**

在过去十年中，Built-In Render Pipeline（BiRP）系统一直是 Unity 的图形支柱。然而，其单体式架构已无法扩展以满足现代跨平台优化的需求。自 Unity 6 起，项目可以根据规模灵活选择图形平台：追求高度通用性的 **Universal Render Pipeline（URP）**，或追求 AAA 级画质的 **High Definition Render Pipeline（HDRP）**。

无论是使用 URP 还是 HDRP，**Render Graph** 依然是管线用来描述与优化渲染循环（render loop）的核心内部机制。关键在于 AI 智能体必须识别当前项目运行的是哪条管线，从而使用正确的 API：

- **如果项目使用 URP**：必须使用 `ScriptableRendererFeature`、`ScriptableRenderPass`、`RecordRenderGraph`、`AddRasterRenderPass` 以及 `ContextContainer`。
- **如果项目使用 HDRP**：绝对不得使用上述 URP 的 API。相反，必须使用 HDRP Custom Pass 系统：`CustomPass`、`CustomPassVolume`、`FullScreenCustomPass`、`DrawRenderersCustomPass`、`CustomPassContext`，以及 `CustomPassUtils`/`HDUtils` 等辅助工具。

AI 在处理与渲染相关的 ShaderGraph、HLSL 和 C# 代码时的职责，是严格守住当前所配置管线的边界：使用正确的 include 库、设置正确的着色器标签（例如 `"RenderPipeline" = "UniversalPipeline"` 或 `"HDRenderPipeline"`），并应用正确的开发工作流。

### **2D 物理系统更新与 Roslyn 编译器标准化**

除图形之外，尽管项目包含 `com.unity.modules.physicscore2d` 模块，玩法脚本仍应优先采用经过验证的公开 API，如 `UnityEngine.Physics2D`、`Rigidbody2D`、`Collider2D` 与 `PhysicsScene2D`。在未对照当前安装的 Editor/package 中的实际 API 之前，AI 智能体不得擅自将命名空间替换为 `Unity.U2D.Physics`，也不得为 Physics 2D 添加 `UNITY_6000_5_OR_NEWER` 条件编译保护。

同时，Unity 6 采用 Roslyn 编译器，但当前 GLW 项目配置生成的 `.csproj` 文件带有 `<LangVersion>9.0</LangVersion>`。因此，在升级编译器配置并验证 Unity 编译通过之前，AI 不得使用 C# 10+ / C# 12 语法，例如集合表达式（`List<int> values = [1, 2, 3];`）、展开运算符（`[..arrayA, ..arrayB]`）或普通 class/struct 的主构造函数（primary constructors）。

## **2026-2027 战略愿景：迈向 Unity 6.7 LTS 的路线图**

一套成功的架构原则不仅要解决当下的问题，还必须为未来的版本更新做好预案。计划于 2027 年第一季度作为 Unity 6 世代收官版本推出的 Unity 6.7 LTS 平台，将在操作系统、解释器及浏览器环境层面带来根本性的变革[^2]。AI 智能体与软件架构部门必须将这些前瞻认知纳入源代码评估标准之中。

最根本的转变发生在虚拟机运行时（Runtime）层面。在坚守 Mono 十余年之后，Unity 6.7 LTS 和 Unity 6.8 将把 CoreCLR 技术（微软的现代 .NET 运行时）引入官方开发环境，作为桌面平台（Desktop Player）上替代 Mono 并补充 IL2CPP 的系统[^8]。CoreCLR 不仅消除了对旧标准的依赖，还解决了域重载（domain reload）的重大痛点，强化了垃圾回收能力并加速了 ECS（Entity Component System）系统[^8]。由于该新系统具有极高的内存性能优化特性，继续编写肆意进行动态分配的 C# 代码将适得其反。

在底层操作系统环境方面，从 6.7 LTS 开始，Unity 的 Windows Player 分发版将改变库链接方式。可执行文件不再将所有 Microsoft Visual C++ 库静态打包，而是通过 `vcruntime140.dll` 和 `msvcp140.dll` 分发包进行动态链接[^60]。这一变化要求安装包构建系统（Patchers/Installers）中的持续集成（CI/CD）流水线必须确保 C++ Redistributable 运行库与可执行文件 `UnityPlayer.dll` 同步发布[^60]。XR（扩展现实）领域也将在 6.7 版本中见证过时的 OculusXR 包彻底退出历史舞台，让位于跨设备的 OpenXR Meta 平台[^60]。

Web 应用市场同样迎来了令人瞩目的突破。Unity 6.7 LTS 有望凭借 WebGPU 架构确立全新的生产标准，其处理并行渲染调用的效率比传统 WebGL 高出数十倍[^2]。此前受限于 4GB 严苛上限的浏览器内存瓶颈，也将随着 WASM64 编译器的推出而彻底解除，从而将复杂 Web 应用的内存分配上限扩展至高达 16GB[^2]。渐进式资源加载（Progressive asset loading）特性预计可将浏览器中游戏的启动时间缩短高达 40%[^57]。这些工具将使图形团队能够大胆提高表面纹理分辨率，而不必担心应用因过载而崩溃。

## **实践部署路线图与分层系统治理**

将内存结构与编码规范落地到分布式 AI 系统中，需要严格的版本控制流程。应用这项技术并非把所有指令都塞进同一个文件，而是对数据进行分区，以契合 Claude Code 的上下文采集算法。以下流程勾勒出了一套适用于大型 Unity 应用开发团队的自上而下（top-down）部署模型。

**第 1 步：建立公共运行系统治理（架构师行动）** 首先，需要为开发系统配置适当的权限。在 `.claude/settings.json` 文件中声明安全命令，可以让 AI 自动执行验证任务（例如 `dotnet format` 或 `Bash(npm run *)`），而不会因手动安全警告而中断[^62]。该文件中不可或缺的一项设置是配置 `claudeMdExcludes`[^63]。通过指定排除区域（例如 `**/Library/**` 和 `**/Packages/ThirdParty/**`），系统将阻止 AI 扫描包含外部资源包的目录，避免误加载属于开源生态的 `CLAUDE.md` 文件并破坏 Prompt Caching 机制[^63]。同时，针对工程师个人的规则或本地设备测试路由字符串，应保存在 `.claude/CLAUDE.local.md` 文件中，并将该文件添加到版本控制系统的忽略列表（`.gitignore`）中[^13]。

**第 2 步：构建不可变前缀（保持在约 150 行左右）** 位于根目录（Root Directory）的 `CLAUDE.md` 文件必须扮演项目“宪法”的角色，负责建立 AI 绝不允许偏离的核心认知[^14]。该文件将明确声明本项目使用搭配 URP 或 HDRP 的 Unity 6000.5 与 C# 9.0，严格要求所有异步调用必须使用 `Awaitable` 编程结构，禁止在 `Update()` 更新循环中使用会产生垃圾的动态分配代码（allocating code），并尊重 RPG Builder、Malbers、Survival Engine 与 Farming Engine 之间的职责边界。任何超出此框架的复杂解释或专业编码知识都将被删减，以使前缀部分尽可能保持轻量化[^16]。该文件将被提交（commit）到源码服务器，使团队成员的所有克隆（clone）副本都能继承统一的架构规范。

**第 3 步：建立基于上下文的规则网络（`.claude/rules`）** 对于体量庞大的深度知识——例如使用 HLSL 编写 Shader 的指南、Custom Render Pass（针对 URP/HDRP），或使用 UI Toolkit 构建界面的规定——必须将其隔离为模块化规则形式。在 `.claude/rules/` 目录下，每个文本文件（例如 `rendering-rules.md`）都将附带一个包含 `paths:` 关键字的 YAML frontmatter 数据结构（以三个短横线开头的文件头）。通过填入诸如 `paths: ["**/*CustomPass*.cs"]` 的路径匹配表达式，深层渲染指令仅在开发者要求 AI 操作图形功能模块时才会被注入上下文窗口。当切换到编写游戏服务器或数据验证系统时，这部分图形知识块仍保持“休眠”，不会浪费高昂的 token 成本[^19]。

**第 4 步：嵌入技能协议（Agent Skills）** 在存储系统趋于稳定后，项目需要解决与平台及控制环境通信的问题。架构师将打开命令行工具，运行 `npx skills add Unity-Technologies/skills --agent claude-code` 命令直接从 GitHub 下载 `SKILL.md` 文件和脚本代码，随后将 GLW 的共享技能仓库标准化于 `.agents/skills/` 目录中。从此以后，当出现“通过 UPM 安装 Unity In-App Purchasing 库”或“通过 Multiplayer Services 配置游戏服务器”等枯燥的程序性任务时，Claude Code 模型无需自行阅读文档，也无需猜测命令结构。它将利用技能描述（description-as-trigger），通过渐进式披露机制自动匹配、加载并执行预设脚本，以绝对精准的标准完美完成请求[^30]。

**第 5 步：知识流转生命周期（提取自动记忆）** 工作流程并不止步于配置阶段。每周当模型不断解决任务时，它都会将“血泪经验”自动记录到自动记忆系统的 `MEMORY.md` 目录中[^17]。例如发现某些旧版 Unity 调用方法因 6000.5 版本的兼容性断裂而报错。技术管理专家需要使用 `/memory` 命令读取 AI 自动总结的内容[^20]。由于在多线程（multi-agent）条件下容易被覆盖、出现数据争用，以及在上下文压缩（compaction）后易发生丢失，任何具有长期战略价值的规律都必须经过手动提取，改写为精炼的指令并反向更新至 `.claude/rules/*.md` 的不可变规则文件中[^22]。通过这种方式，项目的“短期记忆”将被巩固为系统的“长期知识”，为迎接即将到来的 Unity 6.7 LTS 发布版本中的底层大改做好最坚实的准备。

---

## **参考文献**

[^1]: CLAUDE.md Examples (2026): 6 Copy-Paste Templates + ... - Morph - [https://www.morphllm.com/claude-md-examples](https://www.morphllm.com/claude-md-examples)
[^2]: What is the Best Unity Version in 2026 — Unity 6.5, 6.3 LTS? - [https://makaka.org/unity-tutorials/best-version](https://makaka.org/unity-tutorials/best-version)
[^3]: How Prompt Caching Actually Works in Claude Code - [https://www.claudecodecamp.com/p/how-prompt-caching-actually-works-in-claude-code](https://www.claudecodecamp.com/p/how-prompt-caching-actually-works-in-claude-code)
[^4]: Claude Code Prompt Caching | Build This Now - BuildThisNow - [https://www.buildthisnow.com/fr/blog/guide/development/claude-code-prompt-caching](https://www.buildthisnow.com/fr/blog/guide/development/claude-code-prompt-caching)
[^5]: GitHub - Unity-Technologies/skills: A collection of reusable skills for - [https://github.com/Unity-Technologies/skills](https://github.com/Unity-Technologies/skills)
[^6]: Render Graph - Introduction - The Knights of U - [https://theknightsofu.com/render-graph-introduction/](https://theknightsofu.com/render-graph-introduction/)
[^7]: Manual: Introduction to asynchronous programming with Awaitable - [https://docs.unity3d.com/6000.0/Documentation/Manual/async-awaitable-introduction.html](https://docs.unity3d.com/6000.0/Documentation/Manual/async-awaitable-introduction.html)
[^8]: Unity's Path to CoreCLR: What the Mono Cutover Means for Your - [https://oceanviewgames.co.uk/blog/posts/unity-path-to-coreclr](https://oceanviewgames.co.uk/blog/posts/unity-path-to-coreclr)
[^10]: Prompt Caching in Claude Code: How to Save Millions of Tokens - [https://www.mindstudio.ai/blog/prompt-caching-claude-code-save-tokens](https://www.mindstudio.ai/blog/prompt-caching-claude-code-save-tokens)
[^13]: The Complete Guide to CLAUDE.md Files for AI Development 2026 - [https://serenitiesai.com/articles/claude-md-complete-guide-2026](https://serenitiesai.com/articles/claude-md-complete-guide-2026)
[^14]: Getting More Out of Claude Code (1) — Memory, Skills, and Hooks - [https://rhcwlq89.github.io/en/blog/claude-code-advanced-guide-1/](https://rhcwlq89.github.io/en/blog/claude-code-advanced-guide-1/)
[^16]: CLAUDE.md Best Practices: What the Evidence Supports (2026) - [https://www.alexdunlop.com/writing/claude-md-best-practices](https://www.alexdunlop.com/writing/claude-md-best-practices)
[^17]: Is CLAUDE.md no longer important? Understanding Claude Code's - [https://note.com/ai__worker/n/nf1d7829fe6a1?hl=en](https://note.com/ai__worker/n/nf1d7829fe6a1?hl=en)
[^19]: Rules | shanraisshan/claude-code-best-practice - DeepWiki - [https://deepwiki.com/shanraisshan/claude-code-best-practice/3.5-rules](https://deepwiki.com/shanraisshan/claude-code-best-practice/3.5-rules)
[^20]: claude-howto/02-memory/README.md at main - GitHub - [https://github.com/luongnv89/claude-howto/blob/main/02-memory/README.md](https://github.com/luongnv89/claude-howto/blob/main/02-memory/README.md)
[^22]: Auto Memory, Auto Forget - DEV Community - [https://dev.to/wkusnierczyk/auto-memory-auto-forget-g05](https://dev.to/wkusnierczyk/auto-memory-auto-forget-g05)
[^23]: Claude Code agents surfacing unverified MEMORY.md content - [https://www.reddit.com/r/ClaudeAI/comments/1tcuiql/claude_code_agents_surfacing_unverified_memorymd/](https://www.reddit.com/r/ClaudeAI/comments/1tcuiql/claude_code_agents_surfacing_unverified_memorymd/)
[^27]: Managing AI Agent Skills with `npx skills`: A Practical Guide - [https://dev.to/toyama0919/managing-ai-agent-skills-with-npx-skills-a-practical-guide-2an8](https://dev.to/toyama0919/managing-ai-agent-skills-with-npx-skills-a-practical-guide-2an8)
[^29]: The Complete Guide to Claude Code V2: CLAUDE.md, MCP - [https://www.reddit.com/r/ClaudeAI/comments/1qcwckg/the_complete_guide_to_claude_code_v2_claudemd_mcp/](https://www.reddit.com/r/ClaudeAI/comments/1qcwckg/the_complete_guide_to_claude_code_v2_claudemd_mcp/)
[^30]: How to Build a Production-Ready Claude Code Skill - [https://towardsdatascience.com/how-to-build-a-production-ready-claude-code-skill/](https://towardsdatascience.com/how-to-build-a-production-ready-claude-code-skill/)
[^32]: Introducing Asynchronous Programming in Unity - Technical Articles - [https://discussions.unity.com/t/introducing-asynchronous-programming-in-unity/1693772](https://discussions.unity.com/t/introducing-asynchronous-programming-in-unity/1693772)
[^34]: unity-coder | Skills Marketplace - LobeHub - [https://lobehub.com/skills/dmitriyyukhanov-claude-plugins-unity-coder](https://lobehub.com/skills/dmitriyyukhanov-claude-plugins-unity-coder)
[^35]: The complete asynchronous programming primer for Unity - Medium - [https://medium.com/my-games-company/the-complete-asynchronous-programming-primer-for-unity-e1b00d26e96b](https://medium.com/my-games-company/the-complete-asynchronous-programming-primer-for-unity-e1b00d26e96b)
[^39]: Unity 6000.5 - [https://unity.com/releases/editor/alpha/6000.5](https://unity.com/releases/editor/alpha/6000.5)
[^57]: Unity Engine 7: Changing the Development Paradigm ... - Inven Global - [https://www.invenglobal.com/articles/24003/unity-engine-7-changing-the-development-paradigm-and-the-roadmap-ahead](https://www.invenglobal.com/articles/24003/unity-engine-7-changing-the-development-paradigm-and-the-roadmap-ahead)
[^60]: Planned breaking changes in Unity 6.7 - Unity Engine - [https://discussions.unity.com/t/planned-breaking-changes-in-unity-6-7/1723293](https://discussions.unity.com/t/planned-breaking-changes-in-unity-6-7/1723293)
[^62]: Setting Up Claude Code for a Project - [https://claude.nagdy.me/learn/project-setup/](https://claude.nagdy.me/learn/project-setup/)
[^63]: Settings - Claude Code - [https://vineetagarwal-code-claude-code.mintlify.app/configuration/settings](https://vineetagarwal-code-claude-code.mintlify.app/configuration/settings)

### 延伸阅读

- What Is Prompt Caching in Claude Code? How to Save Millions of - [https://www.mindstudio.ai/blog/prompt-caching-claude-code-token-savings](https://www.mindstudio.ai/blog/prompt-caching-claude-code-token-savings)
- You Don't Know Claude Code: Architecture, Governance ... - Tw93 - [https://tw93.fun/en/2026-03-12/claude.html](https://tw93.fun/en/2026-03-12/claude.html)
- Claude Code Memory, How /memory and CLAUDE.md Actually Work - [https://blog.vibecoder.me/claude-code-memory-how-memory-command-claude-md-work](https://blog.vibecoder.me/claude-code-memory-how-memory-command-claude-md-work)
- CLAUDE.md for Game Devs: The File That Makes AI Actually - [https://www.mrphilgames.com/blog/claude-md-for-game-devs](https://www.mrphilgames.com/blog/claude-md-for-game-devs)
- GitHub - solanabr/solana-ai-kit: Claude Code / Codex / AI configs for - [https://github.com/solanabr/solana-ai-kit](https://github.com/solanabr/solana-ai-kit)
- Claude Code Memory: Give Your Agent Persistent Context Across - [https://blink.new/blog/claude-code-memory](https://blink.new/blog/claude-code-memory)
- claude-code-best-practice/CLAUDE.md at main - GitHub - [https://github.com/shanraisshan/claude-code-best-practice/blob/main/CLAUDE.md](https://github.com/shanraisshan/claude-code-best-practice/blob/main/CLAUDE.md)
- Cấu Trúc Project Claude Code Mà Mọi Frontend Dev Cần Biết - [https://viblo.asia/p/giai-ma-thu-muc-claude-cau-truc-project-claude-code-ma-moi-frontend-dev-can-biet-k74a9Kjl4eO](https://viblo.asia/p/giai-ma-thu-muc-claude-cau-truc-project-claude-code-ma-moi-frontend-dev-can-biet-k74a9Kjl4eO)
- One Source of Truth for Your AI Agent Rules: Cursor, Claude Code - [https://pub.towardsai.net/your-ai-agent-rules-one-source-of-truth-for-cursor-claude-code-and-every-tool-youll-adopt-next-cd7f1353dbbc](https://pub.towardsai.net/your-ai-agent-rules-one-source-of-truth-for-cursor-claude-code-and-every-tool-youll-adopt-next-cd7f1353dbbc)
- skills.sh - mảnh ghép quan trọng trong "stack agent" hiện tại - vnROM - [https://vnrom.net/2026/02/skills-sh-manh-ghep-quan-trong-trong-stack-agent-hien-tai/](https://vnrom.net/2026/02/skills-sh-manh-ghep-quan-trong-trong-stack-agent-hien-tai/)
- Unity - Manual: Awaitable code example reference - [https://docs.unity.cn/6000.0/Documentation/Manual/async-awaitable-examples.html](https://docs.unity.cn/6000.0/Documentation/Manual/async-awaitable-examples.html)
- On Async/Await with Awaitables as a Coroutine replacement - [https://discussions.unity.com/t/on-async-await-with-awaitables-as-a-coroutine-replacement/1554090](https://discussions.unity.com/t/on-async-await-with-awaitables-as-a-coroutine-replacement/1554090)
- Awaitable completion and continuation - Unity - Manual - [https://docs.unity3d.com/6000.2/Documentation/Manual/async-awaitable-continuations.html](https://docs.unity3d.com/6000.2/Documentation/Manual/async-awaitable-continuations.html)
- Use Unity API from another Thread or call a function in the main - [https://stackoverflow.com/questions/41330771/use-unity-api-from-another-thread-or-call-a-function-in-the-main-thread](https://stackoverflow.com/questions/41330771/use-unity-api-from-another-thread-or-call-a-function-in-the-main-thread)
- Unity 6000.5.0a9 - [https://unity.com/releases/editor/alpha/6000.5.0a9](https://unity.com/releases/editor/alpha/6000.5.0a9)
- Manual: Upgrade to Unity 6.0 LTS - [https://docs.unity3d.com/6000.5/Documentation/Manual/UpgradeGuideUnity6.html](https://docs.unity3d.com/6000.5/Documentation/Manual/UpgradeGuideUnity6.html)
- Manual: Upgrade to Unity 6.5 - [https://docs.unity3d.com/6000.5/Documentation/Manual/UpgradeGuideUnity65.html](https://docs.unity3d.com/6000.5/Documentation/Manual/UpgradeGuideUnity65.html)
- Migrating to Render Graph tutorial: Understanding the RenderGraph - [https://discussions.unity.com/t/migrating-to-render-graph-tutorial-understanding-the-rendergraph-samples/1715833](https://discussions.unity.com/t/migrating-to-render-graph-tutorial-understanding-the-rendergraph-samples/1715833)
- Unity 6 URP Render Graph Deep Dive: Why Rendering Moved to a - [https://gamedevllm.com/en/unity6-urp-render-graph-basics-en/](https://gamedevllm.com/en/unity6-urp-render-graph-basics-en/)
- Write a render pass using the render graph system in URP - [https://docs.unity3d.com/6000.0/Documentation/Manual/urp/render-graph-write-render-pass.html](https://docs.unity3d.com/6000.0/Documentation/Manual/urp/render-graph-write-render-pass.html)
- Unity 6 URP Render Graph Pass Types: AddBlitPass vs - [https://gamedevllm.com/en/unity6-urp-render-graph-pass-types-en/](https://gamedevllm.com/en/unity6-urp-render-graph-pass-types-en/)
- RenderGraph: Creating a RenderPass that alterate the Unity - [https://discussions.unity.com/t/rendergraph-creating-a-renderpass-that-alterate-the-unity-rendering-process/1614145](https://discussions.unity.com/t/rendergraph-creating-a-renderpass-that-alterate-the-unity-rendering-process/1614145)
- Understanding URP: Implementing Renderer Features with Render - [https://discussions.unity.com/t/understanding-urp-implementing-renderer-features-with-render-graph/1712280](https://discussions.unity.com/t/understanding-urp-implementing-renderer-features-with-render-graph/1712280)
- Documentation versions - Unity - Manual - [https://docs.unity3d.com/6000.5/Documentation/Manual/ManualVersions.html](https://docs.unity3d.com/6000.5/Documentation/Manual/ManualVersions.html)
- Custom shaders - Unity - Manual - [https://docs.unity3d.com/6000.5/Documentation/Manual/Shaders.html](https://docs.unity3d.com/6000.5/Documentation/Manual/Shaders.html)
- Physics Core 2D in Unity 6.5 - [https://discussions.unity.com/t/physics-core-2d-in-unity-6-5/1715178](https://discussions.unity.com/t/physics-core-2d-in-unity-6-5/1715178)
- Manual: New in Unity 6.5 - [https://docs.unity3d.com/6000.5/Documentation/Manual/WhatsNewUnity65.html](https://docs.unity3d.com/6000.5/Documentation/Manual/WhatsNewUnity65.html)
- What's new in C# 12 - Microsoft Learn - [https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-12](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-12)
- DaZombieKiller/UnityRoslynUpdater: A tool to update the Roslyn - [https://github.com/DaZombieKiller/UnityRoslynUpdater](https://github.com/DaZombieKiller/UnityRoslynUpdater)
- Create and use a source generator - Unity - Manual - [https://docs.unity3d.com/6000.5/Documentation/Manual/create-source-generator.html](https://docs.unity3d.com/6000.5/Documentation/Manual/create-source-generator.html)
- Roslyn analyzers and source generators - Unity - Manual - [https://docs.unity3d.com/6000.1/Documentation/Manual/roslyn-analyzers.html](https://docs.unity3d.com/6000.1/Documentation/Manual/roslyn-analyzers.html)
- CoreCLR, Scripting, and ECS Status Update - March 2026 - C# & .NET - [https://discussions.unity.com/t/coreclr-scripting-and-ecs-status-update-march-2026/1711852](https://discussions.unity.com/t/coreclr-scripting-and-ecs-status-update-march-2026/1711852)
- Unity's roadmap from 6.4 to 6.8: render pipelines, AI... - daily.dev - [https://daily.dev/posts/unity-s-roadmap-from-6-4-to-6-8-render-pipelines-ai-tools-coreclr-and-web-improvements-feibgy4zs](https://daily.dev/posts/unity-s-roadmap-from-6-4-to-6-8-render-pipelines-ai-tools-coreclr-and-web-improvements-feibgy4zs)
- Unity 6 Development and Migration | OVG - Ocean View Games - [https://oceanviewgames.co.uk/technologies/unity-6](https://oceanviewgames.co.uk/technologies/unity-6)
- How Claude remembers your project - Claude Code Docs - [https://code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)
- How to Use claude.md for AI Coding: Guide for Dev Teams - Apidog - [https://apidog.com/blog/claude-md/](https://apidog.com/blog/claude-md/)
- Claude Code Compaction and Long-Session Operations Guide - [https://hidekazu-konishi.com/entry/claude_code_compaction_and_long_session_guide.html](https://hidekazu-konishi.com/entry/claude_code_compaction_and_long_session_guide.html)
