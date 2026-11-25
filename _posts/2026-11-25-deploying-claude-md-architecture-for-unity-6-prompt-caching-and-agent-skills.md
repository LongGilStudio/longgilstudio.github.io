---
title: "Strategic Architecture for Deploying CLAUDE.md in Unity 6: Optimizing Prompt Caching, Agent Skills, and the Roadmap to Unity 6.7 LTS"
date: 2026-11-25 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, claude-code, ai-agents, prompt-caching, coreclr, render-graph, awaitable, gilongworld]
description: Strategic design for a hierarchical CLAUDE.md architecture in Unity 6 (6000.5 to 6.7 LTS), cutting token costs by 90% with Prompt Caching, integrating Agent Skills, and enforcing Awaitable async rules.
lang: en
translation_id: unity6-claude-md-prompt-caching-skills
---

The convergence of generative AI in software engineering and real-time 3D graphics engines is fundamentally reshaping production pipelines across the video game and interactive software industries. Within this ecosystem, Claude Code has emerged as a premier command-line coding agent powered by sophisticated hierarchical context-management architectures. At the heart of this behavioral guidance system lies `CLAUDE.md`, a project metadata store that keeps AI agents aligned with an organization's engineering standards[^1]. Simultaneously, Unity is undergoing a generational shift with the Unity 6 release train. The current `6000.5` release is not merely a feature update—it is a deep core refactoring that signals the retirement of legacy subsystems and lays the foundation for the upcoming Unity 6.7 LTS (Long-Term Support) release slated for early 2027[^2].

Designing a `CLAUDE.md` structure resilient to Unity 6's rapid evolution requires uniting three complex pillars. First is governing and optimizing Anthropic's **Prompt Caching** to slash token costs during extended engineering sessions without sacrificing technical context[^3]. Second is integrating the **Agent Skills** ecosystem via `Unity-Technologies/skills`, unlocking automated Unity CLI workflows without bloating static context memory[^5]. Third is mastering the newest internals of Unity 6000.5—from asynchronous programming with `Awaitable` and the `RenderGraph` pipeline to the upcoming CoreCLR runtime roadmap—so AI rules remain accurate and future-proof as projects advance toward 6.7 LTS[^6]. This report outlines a strategic blueprint for building a synchronized, high-performance, and future-ready AI-assisted Unity development environment.

## **Prefix Memory Dynamics and Optimizing Prompt Caching in Claude Code**

The core challenge when operating Large Language Models (LLMs) over massive game repositories is context drift coupled with exponentially rising inference costs. Claude Code solves this via a foundational architectural mechanism called **Prompt Caching**. This feature persists intermediate mathematical matrices (specifically Key and Value matrices in the KV cache) generated while the model processes prefix text segments[^3].

In active development environments, an initial cache write incurs a 25% surcharge over standard token pricing for a 5-minute TTL cache, or double the base cost for a 1-hour TTL configuration[^4]. The true payoff arrives on subsequent cache reads, where token consumption drops to roughly 10% of the base rate—delivering up to **90% cost savings** across the shared project prefix[^4]. For caching to hit, inputs must satisfy a strict **prefix match constraint**. Even a single-byte or whitespace modification anywhere inside the prefix invalidates the entire KV cache from that point onward, forcing full matrix recomputation from scratch[^3].

Respecting this constraint, Claude Code structures outgoing prompt payloads in descending order of stability: starting with the immutable System Prompt (~4,000 tokens), followed by Tool Definitions, then `CLAUDE.md` contents, and finally the dynamic conversation history[^3]. Because of this ordering, multiple users share the System Prompt cache while engineers collaborating on the same repository share the `CLAUDE.md` cache[^3]. To shield this valuable prefix from real-time volatility (such as changing dates or git status updates), Claude Code never mutates the System Prompt directly; instead, it injects dynamic metadata inside `<system-reminder>` tags appended to the latest user message at the tail of the prompt[^3].

Disciplined session hygiene is essential to protect your caching investment. Several routine developer actions can inadvertently shatter the prefix cache and trigger unexpected token spikes:

| Developer Action | Impact on Context Layout | Prompt Cache State |
| :--- | :--- | :--- |
| **Editing `CLAUDE.md` mid-session** | Directly mutates the static prefix block. | Entire cache invalidated; forces full recomputation (Cache Miss)[^10]. |
| **Changing Effort level or Fast Mode** | Injects new configuration parameters or header tags at session initialization. | Initializes an entirely new cache chain because parameters form part of the Cache Key[^4]. |
| **Running `/compact` to prune context** | Truncates and summarizes conversation history to free context space. | Invalidates prior cache because rebuilt history alters structure past the Breakpoint[^1]. |
| **Model Switching mid-session** | Switching between models (e.g., Sonnet vs. Opus). | Cache lost because KV matrices are model-specific and cannot be shared[^3]. |
| **Dynamically loading MCP Server tools** | Mutates static tool definitions at the head of the prompt. | Invalidates the root prefix because tool schemas changed[^3]. |

To preserve throughput, caching must work hand-in-hand with intelligent command design. Claude Code's Plan Mode exemplifies machine-learning-aware optimization. Rather than stripping file-editing tool definitions from the prompt to put the AI in read-only mode—which would mutate tool schemas and bust the cache—Claude Code keeps all tools intact in the prefix, registers `EnterPlanMode` and `ExitPlanMode` from startup, and appends a conversational instruction prohibiting edits[^3]. This enables seamless state transitions while retaining the 90% cache-read discount. When architecting rules for Unity 6, tech leads must apply these exact mechanics so guidance loads in the right place at the right time.

## **Hierarchical Memory Strategy for Game Development Ecosystems**

Claude Code's instruction store is not restricted to a single flat file; it operates through a six-tier **configuration resolution hierarchy**. These layers span Managed Policies, User Global rules, Project Root configuration, Project Local overrides, path-scoped Modular Rules, and AI-synthesized Auto Memory[^1]. Precedence flows from narrow to broad: granular local or directory-level rules override global defaults whenever conflicts arise[^13].

At the center stands the repository root `CLAUDE.md`. It acts as the immutable "constitution" defining the game's engine version, C# standard, rendering pipeline, and core architecture[^14]. Many teams instinctively author thousand-line instruction files hoping to micromanage every agent action. However, an empirical study analyzing 1,650 Claude Code sessions overturned several myths about `CLAUDE.md` layout: varying file length (from 25 to 500 lines), reordering rules (top, middle, or bottom), or splitting files via `@import` statements produced no statistically significant difference in compliance[^16]. What truly dictates adherence is task nature: models follow rules **71.3%** of the time when authoring greenfield code, dropping to **45.1%** when modifying existing code—because pre-existing code visible in context competes directly with written rules[^16].

Consequently, the recommendation to keep `CLAUDE.md` under 200 lines is a soft cleanliness target rather than a hard software truncation limit[^16]. The strict 200-line truncation cap actually applies to `MEMORY.md`, the index file of the Auto Memory subsystem[^16].

| Configuration Layer | Actual File Path / Storage Location | Role in a Unity Project | Git Tracking Status |
| :--- | :--- | :--- | :--- |
| **User Global Rules** | `~/.claude/CLAUDE.md` | Personal developer preferences (e.g., error reporting style, formatting habits)[^13]. | Untracked (Local to machine)[^13]. |
| **Project Root Rules** | `./CLAUDE.md` | Shared studio baselines (e.g., HDRP requirement, C# 9.0, core architecture, canonical paths)[^13]. | Tracked & Shared (Committed)[^13]. |
| **Project Local Overrides** | `./.claude/CLAUDE.local.md` | Temporary notes, machine-specific test settings, local dev server strings[^13]. | Excluded via `.gitignore` (Ignored)[^13]. |
| **Path-Scoped Modular Rules** | `.claude/rules/*.md` with `paths:` | Subsystem-specific rules (e.g., `**/*CustomPass*.cs` for HDRP Custom Passes, `**/*Editor.cs` for UI Toolkit)[^13]. | Tracked & Shared (Committed)[^19]. |
| **Auto Memory** | `~/.claude/projects/<id>/memory/MEMORY.md` | AI-synthesized debugging notes, library quirks, or recurring session lessons[^17]. | Untracked (Locally dispersed)[^17]. |

One frequently misunderstood subsystem is **Auto Memory**. Designed to reduce context repetition, it automatically writes Markdown notes into a user's local profile whenever Claude Code observes recurring coding patterns[^17]. Yet in multi-agent workflows operating concurrently via git worktrees, Auto Memory exposes a critical flaw: **it is not thread-safe**[^22]. Concurrent agents writing to `MEMORY.md` overwrite each other via race conditions[^22]. Worse, across context compaction cycles, stale or erroneous notes can survive and gain equal priority to canonical rules, causing agents to confidently enforce wrong constraints[^23]. Periodically auditing Auto Memory and promoting verified insights into permanent Modular Rules is mandatory governance.

The `.claude/rules/` modular rules system is ideally suited to Unity's architectural complexity. By specifying glob patterns in the YAML frontmatter `paths:` field, leads can ensure HLSL shader guidelines load *only* when the agent touches `.shader` or `.hlsl` files[^19]. Rules lacking a `paths:` header load unconditionally at session start just like `CLAUDE.md`, risking context saturation[^19]. Furthermore, cross-tool interoperability is encouraged: if a studio maintains an `AGENTS.md` file (an open standard supported across multiple AI coding tools), the best practice is referencing `@AGENTS.md` inside `CLAUDE.md` rather than duplicating rules, preserving a single source of truth[^1].

## **Workflow Automation with the Unity-Technologies/skills Ecosystem**

A sound architecture does more than issue instructions—it grants reliable execution capabilities. Adopting the `skills.sh` protocol elevates an AI agent from natural-language text generation into a structured system operator[^27]. Agent Skills directories package reusable SOPs (Standard Operating Procedures) containing `SKILL.md` metadata, scripts, and verified API recipes[^27].

The official `Unity-Technologies/skills` repository provides domain-specific tools ensuring project operations follow verified Unity APIs rather than letting LLMs hallucinate invalid code[^5]. Unlike root instruction files loaded upfront, skills rely on **progressive disclosure**[^29]. At idle, the prompt prefix registers only each skill's name and concise trigger description (e.g., `implement-in-app-purchases`). Only when a user request matches that description are the full C# templates and CLI workflows injected into active context—cutting baseline maintenance token overhead by up to **98%**[^30].

Integration via CLI is straightforward. Running `npx skills add Unity-Technologies/skills --agent claude-code` pulls upstream skills from GitHub; in GilongWorld (GLW), shared team skills are standardized under `.agents/skills/` with `skills-lock.json` pinning upstream `Unity-Technologies` revisions[^5]. Key capabilities unlocked include:

| Agent Skill Name | Mechanism & Execution Capability in Unity Projects |
| :--- | :--- |
| **`unity-cli`** | Direct interface to the Unity Command Line: install Unity Editors, scaffold blank projects, manage license auth, and run headless builds without opening the GUI[^5]. |
| **`unity-package-management`** | Automates Unity Package Manager (UPM) operations using `PackageManager.Client` C# calls to scan, add, remove, and update packages inside CI/CD workflows[^5]. |
| **`build-live-game`** | Connects directly to Unity Gaming Services (UGS), automating player auth, Cloud Save, Cloud Code, leaderboards, and in-game economy setup[^5]. |
| **`ui` (Router) & variants** | Acts as a smart router inspecting the project to dispatch to `ui-uitk` (Flexbox UXML/USS), `ui-ugui` (Canvas hierarchy), or `ui-imgui` (Editor extensions)[^5]. |
| **`setup-multiplayer-services`** | Automates networking infrastructure configuration—topology, matchmaking, and sessions/lobbies—via Unity Multiplayer Services[^5]. |
| **`validate-urp-render-graph-renderer-feature`** | Useful for dedicated URP projects; for GLW/HDRP, it is excluded as a default rendering standard in favor of HDRP Custom Passes and `.claude/rules/rendering-rules.md`. |
| **`shader-graph-create-custom-node`** | Generates and validates HLSL code to author versatile Custom Nodes compatible with Shader Graph[^5]. |

Delegating procedural tasks to skills keeps `CLAUDE.md` lean. Instead of embedding hundreds of lines detailing IronSource ad mediation setup, an architect simply installs `levelplay-unity-integration`[^5]. When needed, Claude Code matches the trigger description, loads the verified workflow via progressive disclosure, and configures rewarded or interstitial ads accurately[^5].

## **Graphics & Asynchronous Engineering Rules for Unity 6000.5**

To author project rules that stay relevant, leads must encode the deep architectural shifts introduced in Unity 6000.5. Moving from legacy paradigms to modern pipelines ensures code is both performant today and compatible with upcoming mobile and desktop targets.

### **Asynchronous Programming: Passing the Torch to `UnityEngine.Awaitable`**

Unity's scripting runtime executes primarily on a single main thread, meaning blocking I/O or heavy AI computations risk freezing the entire game[^32]. Historically, developers leaned on Coroutines (which lack clean return values and allocate GC memory) or `System.Threading.Tasks.Task` (which allocates heap objects poorly suited to per-frame game loops)[^7].

Unity 6 introduces `UnityEngine.Awaitable`, a purpose-built type designed to optimize `async`/`await` for real-time games[^7]. `Awaitable`'s breakthrough is internal **Object Pooling**: rather than allocating new heap objects per invocation, the engine checks out a pooled `Awaitable` instance, runs the operation, and silently returns it to the pool once `await` completes[^7]. Eliminating per-call allocations resolves the GC spikes that traditionally plagued async gameplay code[^7].

However, pooling introduces one non-negotiable constraint that `.claude/rules/async.md` must explicitly forbid: **never `await` the same `Awaitable` instance more than once**[^7]. The moment the first `await` finishes, that object returns to the pool and may already be reassigned to another task. A second `await` triggers undefined behavior, hangs, or low-level exceptions[^7].

| Technical Property | `System.Threading.Tasks.Task` | Recommended: `UnityEngine.Awaitable` |
| :--- | :--- | :--- |
| **Memory Allocation** | Continuously allocates managed heap garbage (GC) on each call[^7]. | Near-zero allocation via built-in internal pooling[^7]. |
| **Multiple `await` Calls** | Safe to `await` the same `Task` across multiple call sites[^7]. | **Strictly forbidden.** Causes memory/state corruption if awaited twice[^7]. |
| **Continuation Scheduling** | Often resumes via `ThreadPool`, adding at least 1 frame latency returning to main thread[^7]. | Resumes synchronously within the same frame upon completion signal[^7]. |
| **Thread Lifecycle Control** | Requires complex manual `SynchronizationContext` handling[^35]. | Native high-speed APIs: `Awaitable.MainThreadAsync()` and `Awaitable.BackgroundThreadAsync()`[^7]. |

Thread switching becomes effortless as well: agents can offload pathfinding or heavy math onto a worker thread via `await Awaitable.BackgroundThreadAsync()`, then safely jump back onto the main thread via `await Awaitable.MainThreadAsync()` before touching Unity APIs[^34]. For animation events, Unity 6000.5 also adds the `ref struct` type `AnimationEventInfo`, enabling allocation-free event handling across complex character rigs[^39].

### **Modern Rendering Architecture: RenderGraph and Pipeline Separation**

Over the past decade, the Built-In Render Pipeline (BiRP) served as Unity's monolithic rendering core, unable to scale cleanly across modern hardware. In Unity 6, projects select either **Universal Render Pipeline (URP)** for broad scalability or **High Definition Render Pipeline (HDRP)** for AAA visual fidelity.

While **Render Graph** underpins modern rendering optimization across Unity 6, the AI agent must strictly detect which pipeline the active project runs and emit the matching APIs:

- **If the project uses URP**: Use `ScriptableRendererFeature`, `ScriptableRenderPass`, `RecordRenderGraph`, `AddRasterRenderPass`, and `ContextContainer`.
- **If the project uses HDRP**: Never emit URP APIs above. Instead, enforce HDRP Custom Passes: `CustomPass`, `CustomPassVolume`, `FullScreenCustomPass`, `DrawRenderersCustomPass`, `CustomPassContext`, and helpers like `CustomPassUtils`/`HDUtils`.

When generating ShaderGraph, HLSL, or C# rendering code, the agent must respect pipeline boundaries—selecting matching HLSL include libraries, shader tags (`"RenderPipeline" = "UniversalPipeline"` vs. `"HDRenderPipeline"`), and pass workflows.

### **2D Physics Modules and Roslyn Compiler Standardization**

Even when a project includes `com.unity.modules.physicscore2d`, gameplay scripts should continue targeting verified public APIs such as `UnityEngine.Physics2D`, `Rigidbody2D`, `Collider2D`, and `PhysicsScene2D`. AI agents must never speculatively rewrite namespaces to `Unity.U2D.Physics` or insert `UNITY_6000_5_OR_NEWER` guards without verifying the exact package APIs installed in the Editor.

Likewise, although Unity 6 ships with the Roslyn compiler, GLW's generated `.csproj` files currently target `<LangVersion>9.0</LangVersion>`. Consequently, agents must avoid C# 10+ / C# 12 syntax—such as collection expressions (`List<int> values = [1, 2, 3];`), spread operators (`[..arrayA, ..arrayB]`), or primary constructors on regular classes/structs—until the compiler language version is intentionally upgraded and verified in Unity.

## **Strategic 2026–2027 Vision: Roadmap to Unity 6.7 LTS**

Effective architectural governance solves today's bottlenecks while preparing for tomorrow's platform shifts. Scheduled for Q1 2027 as the culminating release of the Unity 6 cycle, **Unity 6.7 LTS** brings foundational changes across runtime execution, OS linkage, and web deployment[^2].

The most profound shift is the runtime transition. After more than a decade on Mono, Unity 6.7 LTS and 6.8 will introduce Microsoft's modern **CoreCLR** .NET runtime on Desktop Players—replacing legacy Mono and complementing IL2CPP[^8]. CoreCLR accelerates domain reloads, upgrades Garbage Collection throughput, and supercharges ECS (Entity Component System) performance[^8]. Because CoreCLR rewards tight memory discipline, tolerating careless heap allocations in C# gameplay code will run counter to the engine's direction.

At the OS layer, starting in 6.7 LTS, Windows Player builds transition away from statically linking Microsoft Visual C++ libraries to dynamically linking `vcruntime140.dll` and `msvcp140.dll`[^60]. CI/CD patcher and installer pipelines must therefore bundle the Visual C++ Redistributable alongside `UnityPlayer.dll`[^60]. In XR, the legacy `OculusXR` package is retired entirely in 6.7 in favor of unified cross-device Meta OpenXR[^60].

Web deployment also sees major breakthroughs: Unity 6.7 LTS targets production-grade **WebGPU** rendering—accelerating parallel draw calls dramatically over legacy WebGL[^2]—alongside **WASM64**, which lifts the 4 GB browser memory ceiling up to 16 GB[^2], and progressive asset loading projected to trim web startup times by up to 40%[^57].

## **Practical Implementation Roadmap & Hierarchical Governance**

Deploying hierarchical AI memory across a multi-engineer game studio requires disciplined version control—partitioning guidance to align with Claude Code's context-retrieval mechanics rather than dumping everything into one file.

**Step 1: Establish Shared Operational Governance (Architect Setup)**
Configure safe tool permissions in `.claude/settings.json` so the agent can run verification commands (such as `dotnet format` or test scripts) without repetitive manual prompts[^62]. Critically, configure `claudeMdExcludes` to ignore external asset stores (such as `**/Library/**` and `**/Packages/ThirdParty/**`), preventing Claude Code from accidentally ingesting third-party `CLAUDE.md` files and busting Prompt Caching[^63]. Engineer-specific overrides belong in `.claude/CLAUDE.local.md`, excluded via `.gitignore`[^13].

**Step 2: Author the Immutable Prefix (~150 Lines)**
The root `CLAUDE.md` serves as the studio's engineering constitution[^14]. It declares clearly that the project runs Unity 6000.5 with HDRP (or URP) and C# 9.0, mandates `Awaitable` for async flows, forbids per-frame heap allocations inside `Update()`, and defines strict ownership boundaries between third-party frameworks (such as RPG Builder, Malbers, Survival Engine, and Farming Engine). Keep verbose tutorials out of this root file so the cached prefix stays razor-sharp[^16], and commit it to Git so every developer inherits identical baselines.

**Step 3: Build Context-Triggered Modular Rules (`.claude/rules/`)**
Isolate deep domain knowledge—HLSL shader conventions, HDRP Custom Passes, or UI Toolkit stylesheets—into modular files under `.claude/rules/` using YAML `paths:` globs such as `paths: ["**/*CustomPass*.cs"]`. Rendering rules inject into context only when graphics files are touched, staying dormant and saving tokens during gameplay or backend tasks[^19].

**Step 4: Embed Agent Skills**
Run `npx skills add Unity-Technologies/skills --agent claude-code` and standardize shared skills under `.agents/skills/`. Routine workflows—from UPM package management to UGS integration—now execute via progressive disclosure using verified templates rather than guesswork[^30].

**Step 5: Knowledge Promotion Lifecycle (Curating Auto Memory)**
Each week, review notes synthesized by the agent in `MEMORY.md` via `/memory`[^20]. Because Auto Memory is not thread-safe across parallel agent worktrees and degrades under context compaction, extract valuable discoveries (like `6000.5` API quirks) into concise, version-controlled rules inside `.claude/rules/*.md`[^22]. Short-term session observations thus harden into durable studio engineering knowledge well ahead of Unity 6.7 LTS.

---

## **References**

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

### Further Reading

- What Is Prompt Caching in Claude Code? How to Save Millions of - [https://www.mindstudio.ai/blog/prompt-caching-claude-code-token-savings](https://www.mindstudio.ai/blog/prompt-caching-claude-code-token-savings)
- You Don't Know Claude Code: Architecture, Governance ... - Tw93 - [https://tw93.fun/en/2026-03-12/claude.html](https://tw93.fun/en/2026-03-12/claude.html)
- Claude Code Memory, How /memory and CLAUDE.md Actually Work - [https://blog.vibecoder.me/claude-code-memory-how-memory-command-claude-md-work](https://blog.vibecoder.me/claude-code-memory-how-memory-command-claude-md-work)
- CLAUDE.md for Game Devs: The File That Makes AI Actually - [https://www.mrphilgames.com/blog/claude-md-for-game-devs](https://www.mrphilgames.com/blog/claude-md-for-game-devs)
- GitHub - solanabr/solana-ai-kit: Claude Code / Codex / AI configs for - [https://github.com/solanabr/solana-ai-kit](https://github.com/solanabr/solana-ai-kit)
- Claude Code Memory: Give Your Agent Persistent Context Across - [https://blink.new/blog/claude-code-memory](https://blink.new/blog/claude-code-memory)
- claude-code-best-practice/CLAUDE.md at main - GitHub - [https://github.com/shanraisshan/claude-code-best-practice/blob/main/CLAUDE.md](https://github.com/shanraisshan/claude-code-best-practice/blob/main/CLAUDE.md)
- Cấu Trúc Project Claude Code Mà Mọi Frontend Dev Cần Biết - [https://viblo.asia/p/giai-ma-thu-muc-claude-cau-truc-project-claude-code-ma-moi-frontend-dev-can-biet-k74a9Kjl4eO](https://viblo.asia/p/giai-ma-thu-muc-claude-cau-truc-project-claude-code-ma-moi-frontend-dev-can-biet-k74a9Kjl4eO)
- One Source of Truth for Your AI Agent Rules: Cursor, Claude Code - [https://pub.towardsai.net/your-ai-agent-rules-one-source-of-truth-for-cursor-claude-code-and-every-tool-youll-adopt-next-cd7f1353dbbc](https://pub.towardsai.net/your-ai-agent-rules-one-source-of-truth-for-cursor-claude-code-and-every-tool-youll-adopt-next-cd7f1353dbbc)
- skills.sh - mảnh ghép quan trọng trong "stack agent" hiện tại - vnROM - [https://vnrom.net/2026/02/skills-sh-manh-ghep-quan trọng-trong-stack-agent-hien-tai/](https://vnrom.net/2026/02/skills-sh-manh-ghep-quan-trong-trong-stack-agent-hien-tai/)
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
