---
title: "Unity 6 HDRP 多场景空间集成架构：技术分析与完整解决方案"
date: 2026-05-12 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, hdrp, rendering, lighting, shadows, volumetrics, apv]
description: 深入分析如何在 Unity 6 中通过 Light Layers、方向光阴影、体积雾、天空盒、后处理以及 Adaptive Probe Volumes 合并两个 HDRP 场景空间。
lang: zh-CN
translation_id: unity6-hdrp-multi-scene-light-layers
---

## **初始验证：基于 Light Layers 的光照隔离基础**

在使用 Unity 6 高清渲染管线（High Definition Render Pipeline，HDRP）开发复杂图形项目的过程中，将两个完全孤立的环境或场景空间（scenes）整合到同一个物理场景文件中，会带来严峻的架构挑战。选择使用 **Light Layers**（即 Rendering Layers，渲染层）作为核心机制来隔离各个 Directional Light 光源，并将其影响范围限制在特定的物体分组上，是一个完全正确的技术决策，完全符合引擎的核心设计文档规范。[^1]

当前方案所采用的配置流程包括：进入 Frame Settings 和 HDRP Asset 启用 Light Layers，随后在 Directional Light 的 General 部分自定义 Light Layer 参数，最后在 Mesh Renderer 的 Additional Settings 中同步 Rendering Layer Mask 参数。这一连串操作成功建立了单向光学通信通道，确保属于第一个空间（场景 1）的多边形网格（mesh）仅计算来自第一个空间太阳光（Directional Light 1）的光照反射，第二个空间（场景 2）亦然。[^1]

从更深层的技术本质来看，Unity HDRP 渲染系统支持通过 LayerMasks 按位对缓冲区（G-buffer）进行分类。三维图形环境中的渲染器（Renderer）理论上最多可支持 32 个不同的渲染层（rendering layers）。然而，为了优化计算性能与显存（VRAM）带宽，当前所有使用 Rendering Layers 机制的 HDRP 效果（包括直接光照、贴花 Decal 效果以及体积效果）仅支持对缓冲区中的前 16 层进行计算。[^1] 这意味着分配 Layer 1 和 Layer 2 完全处于安全区间内，能够确保性能稳定性。在 ShaderGraph 中通过 `Sample Buffer` 节点结合 `RenderingLayerMask` 进行干预，也为自定义专属着色器打开了大门，使其仅在对应层级的光源照射下才呈现特定效果。[^1]

然而，当前方案的局限性在于它只解决了基于物理的渲染（Physically Based Rendering - PBR）技术中的第一大支柱：**直接光照（Direct Lighting）**。在 Unity 6 HDRP 中，一个完整且逼真的环境生态系统由无数相互交织的复杂系统构成。当两个空间被迫共享同一个世界坐标系（world space）时，直接光照的独立性会立刻被阴影泄露（shadow leaking）、大气体积串扰（volumetrics）、天空盒偏差（skybox）以及间接反射光照污染（Global Illumination）所破坏。要完善该方案，必须对整个渲染管线系统进行大规模干预，以确保这两个空间在视觉上真正做到彼此不可见。

## **多方向光阴影（Directional Shadows）的复杂架构限制**

在隔离光照通道之后，最大的技术障碍出现在阴影贴图（Shadow Mapping）流程中。在 HDRP 的默认配置下，系统会自动同步 Light Rendering Layers 与 Shadow Rendering Layers。这一机制默认任何从光源接收光子的几何表面，同时也会充当该光源的遮挡体并投射阴影。[^1] 但 Unity 渲染管线中存在一项硬编码（hard-coded）的核心物理限制：无论是通用渲染管线（URP）还是高清渲染管线（HDRP），单个摄像机在任意时刻都只支持**唯一一个**能够实时投射阴影（real-time shadow-casting）的 Directional Light 光源。[^4]

与影响范围局部化的点光源（Point Light）或聚光灯（Spot Light）不同，Directional Light 代表覆盖全局的太阳光。为了在不耗尽计算机资源的前提下处理超大区域的阴影，HDRP 采用了级联阴影贴图（Cascade Shadow Maps - CSM）技术。[^6] 系统不会生成单张超高分辨率的阴影贴图，而是将摄像机视锥体空间划分为多个层级（默认通常为 4 个 cascades，可在 Volume 的 `HD Shadow Settings` 中自定义）。[^6] 每个级联层级都需要引擎执行一次独立的几何通道（geometry pass），并生成一张专用的阴影贴图。因此，单个 Directional Light 实际上需要持续渲染多达 4 张阴影贴图。[^6]

如果 Unity 允许两个 Directional Light 光源同时通过 CSM 技术生成阴影，每帧需要计算的高分辨率阴影贴图数量将暴增至 8 张，导致显存带宽枯竭，并使帧率（FPS）骤降至即便顶尖硬件系统也无法接受的程度。[^4] 当用户场景中同时存在两个 Directional Light 时，Unity 会剥夺其中一个的阴影投射权限。第二个光源将只承担提供颜色贡献（color contribution）的作用，而无法在地面上形成阴影遮蔽（drop shadows），从而使第二个空间显得扁平、缺乏层次感且违背物理规律。[^4]

此外，如果不加注意，即使两个空间彼此不接收对方的直接光照，来自空间 1 物体的阴影仍可能意外投射到空间 2 的物体上。为了防止这种几何泄露，必须解决 Shadow Layers 的分离问题。默认情况下阴影与光照保持同步，但为了实现完全控制，架构师需要选中 Directional Light，导航至 Shadows 部分并勾选 **Custom Shadow Layers** 复选框。[^1] 该功能允许将 Shadow Rendering Layers 与 Light's Rendering Layers 解耦，从而保证空间 1 中的网格（Mesh）仅在 Shadow Layer 1 通道上投射阴影，对空间 2 的阴影射线追踪过程完全隐形。[^1]

## **多环境场景下的阴影投射突破策略**

为了突破 Unity 6 单太阳投射阴影的限制，需要分析两个空间内对象的静态与动态特性，从而采用以下两种技术干预策略之一。每种策略都附带有精细的配置操作，用以绕过 CSM 限制机制。

### **使用 Box-Shaped Spot Light 模拟太阳光的策略**

如果两个空间都需要高强度的动态阴影（dynamic shadows）交互，例如随风摇曳的树木、持续移动的角色以及交替的昼夜循环，那么使用两个 Directional Light 是不可能实现的。相反，最优方案是将空间 2 的 Directional Light 替换为采用盒子空间形状（Box shape）的 **Spot Light** 光源。[^8]

Spot Light 在资源管理方式上与 Directional Light 截然不同：它只渲染**唯一一张阴影贴图**（一个 shadow map），而不是四张级联贴图。[^6] 借此，它摆脱了引擎的严苛限制。[^4] 在 Spot Light 的配置界面中，将 `Shape` 属性切换为 `Box`，可以让系统生成一个定向照明体积，在局部受限区域内精确模拟太阳光的平行光线路径。[^8]

不过，Spot Light 的物理特性是光照会随距离衰减（distance attenuation）。现实中的太阳在地球尺度范围内不存在这种衰减。要解决这一问题，只需进入 Spot Light 的高级设置，找到 **Range Attenuation** 属性并进行调整或禁用即可。[^8] 当光强衰减被消除后，这个呈 Box 形状的 Spot Light 将立即产生均匀、平行的光照，并投射出可自定义的硬阴影或软阴影，与传统 Directional Light 毫无二致，同时还能通过 Light Layer 2 实现彻底隔离。[^8]

### **混合缓存阴影（Mixed Cached Shadows）策略**

如果空间 1 或空间 2 主要由建筑、地形、道路等静态结构组成，仅包含玩家角色等少数动态实体，那么利用 **Mixed Cached Shadows**（混合缓存阴影）功能将是一项突破性的架构决策。[^7] 从 HDRP 13.x 和 14.0 版本开始（在 Unity 6 中已成为标准功能），该特性已面向 Directional Light 开放，允许将阴影贴图拆分为静态与动态两条独立的数据流。[^7]

启用该方案需要项目管理系统与局部对象之间的协同配置。首先，需要配置以允许 HDRP 分配内存。在 Inspector 窗口中打开 HDRP Asset 配置文件，按路径 *Lighting > Shadows > Directional Light Shadows* 进入，并必须勾选 **Allow Mixed Cached Shadows** 选项。[^7] 接下来，对场景中的 Directional Light 进行操作：在 Light 选项卡中展开 Shadows 部分并勾选 **Always draw dynamic**，随后将光源的 **Update Mode** 参数从 *Every Frame*（每帧）设置为 *On Demand*（按需）或 *OnEnable*。[^7] 最后，选中环境中的所有静态物体，并在其 `Mesh Renderer` 组件上启用 **Static Shadow Caster** 选项。[^7]

在内部运行机制上，当系统处于该模式时，HDRP 会为 Directional Light 的已缓存（cached）和未缓存（non-cached）阴影共用同一个 Shadow Atlas。[^10] 对于标记为静态的物体，其阴影仅会被绘制到内存缓冲区一次；而对于动态物体，其阴影则会持续更新。[^7] 随后，HDRP 执行一次 blit（Bit Block Transfer，位块传输）操作，将缓存贴图中的数据合并到动态贴图中，从而节省海量的几何绘制调用（geometry draw calls）处理时间。[^7]

尽管该方案不能直接让两个 Directional Light 始终同时投射阴影，但它释放了计算资源，使系统能够根据摄像机位置在光源之间快速切换阴影渲染权限（shadow rendering authority），或者将一个 Directional Light 用于缓存阴影，再配合局部光源处理动态阴影。[^5] 需要注意的是，由于 Directional Light 的级联阴影贴图（cascade shadow maps）具有视角相关性（view-dependent），摄像机穿过各级联边界时可能会在阴影边缘引发视觉偏差。为防止这种情况，需要编写一个 C# 脚本，每当摄像机移动超过一定距离时调用 `RequestShadowMapRendering` 函数以刷新缓存贴图。[^7] API 中还提供了 `SetShadowResolution()` 和 `SetShadowUpdateMode()` 等函数，用于在运行时对该缓冲区进行精细控制。[^7]

| 多场景阴影方案对比 | 权限切换式 Directional Light                       | Box-Shaped Spot Light                                    | Mixed Cached Shadows                                          |
| :----------------- | :------------------------------------------------- | :------------------------------------------------------- | :------------------------------------------------------------ |
| **运行机制**       | 通过脚本关闭光源 1 阴影，开启光源 2 阴影。[^5]     | 使用有界体积光源模拟平行太阳光。[^8]                     | 缓存静态阴影缓冲区，持续更新动态阴影。[^7]                    |
| **显存资源消耗**   | 低（仅激活 1 套级联系统）。[^6]                    | 中（额外增加 1 张非级联阴影贴图）。[^6]                  | 极高（需要并行存储静态与动态贴图）。[^7]                      |
| **Light Layers 支持** | 支持（全面支持）。[^1]                          | 支持（全面支持）。[^1]                                   | 支持（全面支持）。[^1]                                        |
| **适用范围**       | 适用于两个空间不会同时出现在屏幕上的情况。         | 非常适合交叠区域，需要两个太阳同时投射阴影的场景。[^4]   | 最适合宏大但以静态物体为主的场景。[^7]                        |
| **技术局限性**     | 突然切换可能会导致视觉跳变中断。                   | 需要谨慎调节 Range Attenuation 与 Box 体积尺寸。[^8]     | 当摄像机移动时需要编写 C# 代码（`RequestShadowMapRendering`）。[^7] |

## **大气渲染体积（Volumetrics）管理与天空盒隔离**

直接光照与阴影只占物理渲染管线蓝图的一半，另一半则属于天空、大气层以及屏幕特效。在原始问题的描述中，用户曾提到使用“独立 Volume”。HDRP 的 Volume 架构是一个基于空间位置对属性值进行插值（interpolation）的平台，其依据是摄像机相对于包围盒（bounding boxes）的位置，而非通过每个 Mesh 上的独立 LayerMask 进行分类。[^11] 这一设计理念的差异意味着大气系统并不关心物体属于场景 1 还是场景 2，它只关心摄像机当前身处何处。

要在合并两个场景的同时保留各自的环境特征，前提条件是将整体设计思路从 Global Volume（全局体积）彻底转向 **Local Volume**（局部体积）。Global Volume 无论摄像机在 3D 世界中处于何处都会对其产生影响，这会形成一层统一的环境覆盖，从而摧毁两个空间的隔离性。[^11]

环境隔离流程需要以下操作：移除或降低默认 Global Volume 的 **Priority**（优先级）。[^12] 创建两个分别对应两个空间的空 GameObject，各自添加 `Volume` 组件并将模式（**Mode**）设置为 **Local**。[^11] 必须为其附加一个启用了 **Is Trigger** 属性的 `Box Collider`（或 `Mesh Collider`）组件，以界定该大气空间存在的物理边界。[^11] 空间 1 与空间 2 之间的过渡由 **Blend Distance**（混合距离）参数控制。Blend Distance 数值规定了从 Box Collider 边缘向内回退的距离，图形参数将在此范围内开始插值。如果将 Blend Distance 设为 `0`，玩家跨过边界线时空间会立刻发生“硬切”；若增大该数值，环境效果（如雾效、光照色彩）则会平滑过渡融合。[^13]

### **使用 Visual Environment 覆盖天空盒**

在 Unity 6 HDRP 中，天空不再通过 Built-in RP 旧式的 Environment Lighting 窗口来定义，而是完全由一个名为 **Visual Environment** 的专用 Volume Override 主导。[^15] 分离天空需要分别为空间 1 和空间 2 的 Local Volume 添加 Visual Environment 覆盖项。

通过启用 **Sky Type** 参数，系统允许为不同空间选择截然不同的天空类型，例如为空间 1 指定 `Physically Based Sky`（比如晴朗的正午），为空间 2 指定 `HDRI Sky`（朦胧的月夜）。[^15] 由于 Volume 架构基于摄像机位置运作，当摄像机进入空间 1 的 Box Collider 时，引擎无需任何一行代码即可自动计算并切换对应的天空画面。它同时还控制着 `Cloud Layer`（云层）和 `Ambient Indirect Lighting`（环境间接光照）参数，确保天空不仅用于观赏，还能准确参与全局环境反射色调的贡献，从而彻底消除空间 1 意外反射空间 2 天空的现象。[^16]

### **使用 Local Volumetric Fog 实现大气独立化**

HDRP 中的雾效分为两类。传统的 Exponential Fog 仅依据 Z-buffer 深度叠加一层单色色调。而为了达到次世代图形品质，**Volumetric Fog**（体积雾）会与光束直接交互，生成逼真的丁达尔光柱（God-rays）效果。[^18] 如果通过常规 Volume 使用 Volumetric Fog，它仍然存在向相邻空间边界扩散的风险。彻底的解决方案是使用专用组件：**Local Volumetric Fog**。[^18]

`Local Volumetric Fog` 是一个可像定向盒体一样塑造边界的物理雾团。[^18] 要使其正常运行，必须在 Project Settings（*Quality > HDRP > Lighting > Volumetrics*）、HDRP Asset 以及摄像机的 Frame Settings 中启用对应的标志位（flags）。[^18] 该组件通过 `Density Mask 3D Texture` 提供对密度的精细控制，使雾气自然翻涌流动，而非呈均质浓块状。[^18] 光散射颜色（`Single Scattering Albedo`）决定了 Directional Light 穿透时雾气的色彩倾向。[^19]

确保场景 1 的雾效空间不与场景 2 混合的关键在于 **Blending Mode** 参数。[^19] 系统默认采用 **Additive**（叠加）模式，导致不同雾效相互累加。通过将 Blending Mode 更改为 **Overwrite**（覆盖），该局部雾体积将会毫不留情地替换并清除其作用域内背景场景的所有雾效参数。[^19] 当两个 `Local Volumetric Fog` 体积在两场景交界处重叠时，**Priority** 参数将决定哪一层显示在最上方，其遵循的规则是：HDRP 先渲染优先级较低的体积，最后渲染优先级较高的体积。[^19]

### **关于 Volume Layer Mask 与后处理的常见误区**

在尝试为不同物体分离 Bloom、Depth of Field 或 Color Grading 等后处理（Post-processing）效果时，Unity 开发者普遍存在一个认知误区。许多人尝试调整摄像机上的 **Volume Layer Mask** 属性，期望它像 Light Layers 一样工作。[^20] 实际上，`Volume Layer Mask` 完全无法控制*哪些物体*接收后处理效果；它只控制*哪台摄像机*受*哪个 Volume* 的影响。[^20]

原因在于 Post-processing 本质上是一个**屏幕空间（Screen Space）**渲染过程。当画面进入 Post-processing 阶段时，所有三维物体已经被“压平”成包含颜色（RGB）与深度（Depth）数据的二维像素数组。渲染系统此时已不再知晓哪个像素源自场景 1、哪个源自场景 2。[^22] 因此，试图通过 Volume Mask 让 Bloom 仅作用于场景 1 是不可能实现的。[^22]

如果分离两个环境的需求严苛到必须让后处理效果或渲染算法在画面重叠的同时保持完全独立（例如：场景 1 中的第一人称手持武器叠加渲染在场景 2 的背景之上），传统方案是 Camera Stacking（摄像机叠加）。但在 HDRP 中，Camera Stacking 极其消耗资源，且会引发无数同步错误。[^22] Unity 官方唯一推荐且规范的解决方案是 **Custom Pass Volume** 架构。[^25]

Custom Pass 允许向图形管线的特定阶段（例如：*Before Transparent*、*After Post-Process*）注入自定义渲染命令。通过将 Custom Pass Volume 设置为 Local 或 Camera 模式[^27]并指定特定的 `LayerMask`，系统可以单独渲染空间 2 的整组物体，应用一套独立的后处理着色器，然后再在不破坏空间深度遮挡（depth occlusion）信息或损坏缓冲区的前提下，将其合成（composite）到空间 1 之上。[^25] 着色器中的 `_FadeValue` 变量与 C# API 中的 `CustomPass.fadeValue` 允许架构师在 `0` 到 `1` 的范围内对这些渲染层进行平滑淡入淡出与切换，从而实现完美的视觉隔离。[^27]

## **利用 Adaptive Probe Volumes (APV) 控制间接反射光照**

直接光照带来明暗对比与光彩，但真正将所有物体锚定在真实感中的是间接光照（Global Illumination - GI）。照射在空间 2 绿色草地表面的光线会吸收光谱，并将绿色反射光弹射到邻近的墙壁上。在合并两个空间的背景下，它们在场景文件中的物理距离可能非常接近。如果不采取隔离措施，来自空间 1 的炽烈红光将会剧烈泄露（`light bleeding`）到空间 2 中，彻底破坏美术指导（Art Direction）。

自 Unity 6 起，随着 **Adaptive Probe Volumes (APV)** 的问世，间接光照基础设施迎来了一场革命。[^28] 这项技术标志着繁琐的手动放置 Light Probe Groups 时代的终结。APV 会以被称为“砖块”（bricks）的结构自动铺设光照数据采集点（Light Probes）网格。[^28] 每个砖块包含一个 4×4×4 的矩阵（共 64 个 probes）。[^28] APV 的智能算法会分析几何密度：在复杂且狭窄的区域，它会细分砖块以提高光照分辨率；在空旷空间中，则使用较大的稀疏砖块以节省内存。[^28] 更重要的是，APV 能够与体积雾（Volumetric Fog）和粒子系统（VFX Graph）完美协同，确保图形环境整体的一致性。[^28]

### **APV 对 Rendering Layers 的支持与限制**

为了确保间接光照系统同样尊重两个空间的边界，第一步配置的 Light Layers 必须与 APV 系统保持同步。APV 完全理解并支持 **Rendering Layer Masks**，但在优化方面受到严格限制：为了保护内存占用与读取速度，APV 在烘焙存储的数据块中最多仅允许同时启用 **4 个 Rendering Layers Masks**。[^29]

Unity 的全局“光照烘焙”（baking）过程极为精密。系统会从每个 probe 发射数百万条射线（ray tests）以探测周围空间并执行遮挡分析（occlusion analysis）。[^30] 在光线反弹过程中，它们会不断碰撞已预先标记 rendering layers 标签的几何表面（例如空间 1 的 Layer 1 和空间 2 的 Layer 2）。由于每个 probe 在已定义的 4 个掩码中只能携带唯一一个掩码，Unity 会采用多数表决算法来分配该掩码：如果某个 probe 的绝大多数射线命中了 Layer 1，该 probe 就会被锁定到 Layer 1。[^30]

然而，这种自动化机制在边界区域会演变成一场灾难。悬浮在空间 1 与空间 2 之间的光照采集点会混杂两边的采样数据，引发交叉光照污染或难以预料的斑驳明暗方块伪影（`probe flares/square artifacts`）。[^31]

### **使用 Probe Adjustment Volume (PAV) 隔离光照**

为了抑制算法的自主判断并强制系统遵循创作者的意图，架构师必须部署名为 **Probe Adjustment Volume (PAV)** 的干预工具。[^29]

PAV 是一种局部逻辑控制体积，拥有在 APV 数据传递给物体之前于最底层对其进行修改的权限。该体积中最核心的功能是 **Override Rendering Layer Mask**（覆盖渲染层掩码）。[^30] 隔离两个环境的实施步骤如下：

1. 创建一个 Box 形状的 `Probe Adjustment Volume`，严密包覆空间 1 的全部网格结构。
2. 在 PAV 的 Inspector 面板内，启用 **Override Rendering Layer Mask** 功能。[^32]
3. 彻底取消勾选所有不属于空间 1 的层（包括空间 2 的 Layer 2），仅保留 **Layer 1**。[^29]

当这一流程完成后，隔离机制便已确立。在运行时（runtime），当角色或动态物体在空间 1 的范围内移动时，其渲染器（renderer）会查询 APV 网格。得益于 PAV 的覆盖配置，该物体将仅被允许从带有 Layer 1 标签的 probe 中提取并采样（sample）光照数据。[^29] 所有从空间 2 意外反弹过来的光光子数据都会在缓冲区层级被拒绝访问。至此，两个空间之间的间接光照隔离已达到绝对隔离级别。

此外，如果合并两个场景是为了实现瞬移（teleportation）或时间切换（例如同一区域在空间 1 为白天，在空间 2 为夜晚），Unity 6 还提供了 **Lighting Scenarios**（光照方案）功能来配合 APV。[^28] 在 HDRP Asset 中启用该选项后，每个空间的烘焙数据都可以保存到不同的方案资产中。在运行时，`ProbeReferenceVolume` API 允许在几毫秒内激活并切换方案。甚至启用 *Scenario Blending* 后，还可以通过 `BlendLightingScenario` 等 C# 函数逐帧（frame）将空间 1 的 GI 数据平滑插值过渡到空间 2，在不造成 CPU 瓶颈的前提下呈现最梦幻且专业的转场效果。[^33]

## **内存优化与底层资源治理**

当强迫 Unity 这类引擎为两个复杂环境并行渲染多套光照、阴影和大气层系统时，GPU 的显存（VRAM）将承受极端压力。一名系统架构师的功力不仅体现在让一切能够运行，更在于维持最低的帧耗时（frametimes）以及彻底消除光学瑕疵（artifacts）。

### **通过 Dynamic Rescale 释放 Atlas 空间**

阴影缓冲区中的空间争夺是对图形完整性最大的威胁。如前所述，HDRP 通过在 HDRP Asset 中声明的静态 Atlas 系统（默认尺寸通常为 4096 × 4096 像素）来分配阴影空间。[^6] 如果来自 Spot Light（用于模拟空间 2 的太阳）和 Point Lights 的阴影数量超出了这一面积预算，实体的阴影就会出现破碎甚至消失。[^34]

预防性解决方案是在 HDRP Asset 中同时为 *Punctual Light Shadows* 和 *Area Light Shadows* 启用 **Dynamic Rescale**（动态重缩放）功能。[^7] 当该功能激活时，HDRP 会分析光束在屏幕上所占的面积比例。距离较远或被部分遮挡的光源会被按指数级强制缩小阴影分辨率，从而在 Atlas 中为靠近摄像机的核心阴影区域腾出空间。[^7] 不过需要特别注意的是，Dynamic Rescale 算法对 Mixed Cached Shadows 中已静态缓存的阴影贴图（cached shadow maps）无效，因为静态数据无法在不破坏物理映射关联的情况下进行动态伸缩。[^7]

### **严格控制 Max Shadows on Screen 与 Shadow Bias**

HDRP Asset 的 Shadows 部分中的 **Max Shadows on Screen** 参数为硬件单帧允许计算的阴影数量设定了一个绝对硬上限。[^6] 如果摄像机处于某个能够同时窥见两个空间一部分的角度，该上限会很快被突破，导致引擎随机丢弃阴影。因此，必须结合使用遮挡剔除（occlusion culling）以及位于两空间边界之间的物理遮挡几何体，以最大限度减少加载到内存缓冲区中的对象数量。[^22]

在进行光源模拟和分通道处理时，由于非线性投射角度的原因，光线穿透网格泄露（light leaking）以及阴影痤疮（shadow acne）现象会更频繁地发生。管理每个 Light 组件上的 **Shadow Bias** 系统是维持画面品质的关键。[^34] 微调 *Near Plane* 参数以推后阴影投射的起始点；增大 *Normal Bias* 以沿表面法线方向偏移阴影采样表面，防止错误的自阴影；并为倾斜表面校准 *Slope-Scale Depth Bias*。[^34] 这些微调配合高质量的阴影过滤（Shadow filtering）技术，例如 PCF（Percentage-Closer Filtering）或 PCSS（Percentage-Closer Soft Shadows），能够确保柔和的阴影边缘并掩盖双光源方案带来的所有瑕疵。[^34]

### **分层光源数量的硬件限制**

HDRP 与 URP 提供了两种核心渲染路径：Forward+ 与 Deferred。在配置多光照层（Light Layers）的过程中，必须清楚所使用架构的硬性限制。

* 如果项目运行在 **Forward+** 架构下，系统支持每个摄像机高达 256 个光源的庞大数量（桌面端设备）。[^38] 但它被硬性锁定在同一时刻作用于单个物体的**最多 8 个额外光源**这一上限。[^38] 用户通过 Light Layer 1 与 Light Layer 2 进行的分通道设计出色地剔除了无关光源，防止网格触及这 8 个光源的上限。
* 如果项目运行在 **Deferred** 架构下以优化无限光源数量，则需注意一个严重限制：Deferred 机制中的剔除掩码（culling mask）同一时刻最多仅支持区分 **4 个层（layer）**。[^40] 如果项目为了进一步细分空间而滥用过多复杂的 Light Layers（超过 4 个），系统将陷入无法恢复的画面崩坏（graphical artifacts）状态。[^40] 初始方案仅使用 2 个基础层（Layer 1 和 Layer 2）的做法，在内存效率与绝对安全性方面得到了充分验证。[^1]

## **总方案矩阵与系统总结**

通过对 Unity 6 HDRP 各个核心子系统的拆解分析，用户最初的方案已被验证为关键的起点；但要构建一个将 2 个场景合并到 1 个文件中的完整渲染环境，必须由多层策略系统协同配合。下表汇总了本文分析的所有核心深度技术方案：

| HDRP 子系统                               | 初始方案（用户现有）                                                           | 完善方案所需的核心补充技术                                                                                                                                                                                                    |
| :---------------------------------------- | :----------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **直接光照（Direct Lighting）**           | 在 Directional Light 和 Mesh Renderer 上配置 Light Layer 1（场景 1）与 Layer 2（场景 2）。 | **已验证准确无误**。确保将活跃层数保持在最低限度，以避免与 Deferred 架构冲突。[^1]                                                                                                                                            |
| **方向光阴影（Directional Shadows）**     | *尚未处理*。存在触及引擎每帧 1 个方向光阴影上限的风险。[^4]                    | 通过 **Custom Shadow Layers** 解耦阴影。[^1] 若两个空间都需要阴影，请将光源 2 替换为 **Box-shaped Spot Light**（关闭 Range Attenuation）[^8]，或针对静态网格启用 **Mixed Cached Shadows** 技术（在 HDRP Asset 中开启）。[^7] |
| **天空盒（Skybox & Visual Environment）** | *尚未处理*。共享天空将破坏两个空间之间的隔离性。                               | 部署 2 个 **Local Volumes**（搭配 Box Colliders）。使用 **Visual Environment** 覆盖来分配 2 种不同的 Sky Type。调节 Blend Distance 实现平滑插值。[^11]                                                                       |
| **大气雾效（Volumetric Fog）**            | *尚未处理*。Global Volumetric Fog 会跨区域溢流。                               | 替换为 **Local Volumetric Fog** 组件。将 Blending Mode 参数从 Additive 切换为 **Overwrite**，使局部雾效清除背景大气。[^18] 在交叠区域微调 Priority。                                                                         |
| **后处理隔离（Post-Processing）**         | *尚未处理*。（常见误区：误以为 Volume Layer Mask 可作用于独立物体）。[^22]     | 配置 **Custom Pass Volume**。使用着色器 C# API 与 layer masks 独立渲染后处理再进行叠加合成（composite），摒弃低效的 Camera Stacking 方法。[^22]                                                                               |
| **间接光照（Global Illumination / APV）** | *尚未处理*。反弹光（Bounced light）会穿透两个环境的边界发生泄露。              | 使用 **Adaptive Probe Volumes (APV)** 进行同步。部署包覆空间 1 区域的 **Probe Adjustment Volume (PAV)**，启用 **Override Rendering Layer Mask** 以拒绝来自带有 Layer 2 标签的 Probe 的光照数据插值。[^28]                 |

Unity 6 HDRP 的物理模拟图形生态系统是一台精密而严苛的机器，对光照的任何改动都会引发反射、遮挡以及空间折射等连锁物理反应。使用 Light Layers 隔离光照通道是一个展现出深厚引擎理解力的完美起点，但要将这一理论转化为完整的艺术空间，还必须有一整套微配置网络作为支撑。通过彻底落实 Custom Shadow Layers 与 Mixed Cached Shadows 的组合、充分利用 Local Volume Framework 的空间控制威力，并建立起依托 Probe Adjustment Volume 的间接光照分流规范，图形架构师完全可以驱动这台庞大的渲染引擎在单一物理空间内并行运转两个多维现实，且不在视觉质量上做出任何妥协。当设计者真正掌握缓冲区（buffers）的底层结构以及 GPU 处理器上的光子流动规律时，一切几何泄露与光谱污染的边界都能被彻底封堵。

## **参考文献**

[^1]: Use light rendering layers | High Definition RP | 16.0.6 - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Rendering-Layers.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Rendering-Layers.html)  
[^2]: Light Layers | High Definition RP | 14.0.12 - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Light-Layers.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Light-Layers.html)  
[^3]: Rendering Layers | High Definition RP | 15.0.7 - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Rendering-Layers.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Rendering-Layers.html)  
[^4]: Is it possible to achieve shadows from two directional lights in URP? : r/Unity3D - Reddit, 访问于 2026年5月11日, [https://www.reddit.com/r/Unity3D/comments/1bndl5x/is_it_possible_to_achieve_shadows_from_two/](https://www.reddit.com/r/Unity3D/comments/1bndl5x/is_it_possible_to_achieve_shadows_from_two/)  
[^5]: 2 or more directional lights simultaneously - Unity Discussions, 访问于 2026年5月11日, [https://discussions.unity.com/t/2-or-more-directional-lights-simultaneously/878090](https://discussions.unity.com/t/2-or-more-directional-lights-simultaneously/878090)  
[^6]: Shadows in the High Definition Render Pipeline - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@8.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@8.0/manual/Shadows-in-HDRP.html)  
[^7]: Shadows in the High Definition Render Pipeline | High Definition RP ..., 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Shadows-in-HDRP.html)  
[^8]: Multiple directional light shadow maps - Unity Discussions, 访问于 2026年5月11日, [https://discussions.unity.com/t/multiple-directional-light-shadow-maps/821372](https://discussions.unity.com/t/multiple-directional-light-shadow-maps/821372)  
[^9]: Mixed cached shadows for directional light broken when shadow cascade count is greater than 1 - Unity Discussions, 访问于 2026年5月11日, [https://discussions.unity.com/t/mixed-cached-shadows-for-directional-light-broken-when-shadow-cascade-count-is-greater-than-1/919216](https://discussions.unity.com/t/mixed-cached-shadows-for-directional-light-broken-when-shadow-cascade-count-is-greater-than-1/919216)  
[^10]: Shadows in the High Definition Render Pipeline - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.0/manual/Shadows-in-HDRP.html)  
[^11]: Volumes | High Definition RP | 10.2.2 - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.2/manual/Volumes.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@10.2/manual/Volumes.html)  
[^12]: HDRP Global Settings Window | High Definition RP | 15.0.7 - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Default-Settings-Window.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@15.0/manual/Default-Settings-Window.html)  
[^13]: Local Volumetric Fog | High Definition RP | 14.1.0, 访问于 2026年5月11日, [https://docs.unity.cn/cn/Packages-cn/com.unity.render-pipelines.high-definition@14.1/manual/Local-Volumetric-Fog.html](https://docs.unity.cn/cn/Packages-cn/com.unity.render-pipelines.high-definition@14.1/manual/Local-Volumetric-Fog.html)  
[^14]: Different Types of Post-Processing Volumes in Unity HDRP | by Liberty Depriest - Medium, 访问于 2026年5月11日, [https://medium.com/@youngchae.depriest/different-types-of-post-processing-volumes-in-unity-hdrp-4f36e3e6dbc5](https://medium.com/@youngchae.depriest/different-types-of-post-processing-volumes-in-unity-hdrp-4f36e3e6dbc5)  
[^15]: Visual Environment | High Definition RP | 16.0.6 - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Override-Visual-Environment.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Override-Visual-Environment.html)  
[^16]: Create environment lighting | High Definition RP | 16.0.6 - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Environment-Lighting.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/Environment-Lighting.html)  
[^17]: Setting The Skybox In Unity HDRP - Vincent Taylor, 访问于 2026年5月11日, [https://vintay.medium.com/setting-the-skybox-in-unity-hdrp-ffc8f7e068ec](https://vintay.medium.com/setting-the-skybox-in-unity-hdrp-ffc8f7e068ec)  
[^18]: Local Volumetric Fog | High Definition RP | 14.0.12 - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Local-Volumetric-Fog.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/Local-Volumetric-Fog.html)  
[^19]: Local Volumetric Fog Volume reference | High Definition Render Pipeline | 17.0.4, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/local-volumetric-fog-volume-reference.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/local-volumetric-fog-volume-reference.html)  
[^20]: Field volumeLayerMask | High Definition RP | 15.0.7 - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition%4015.0/api/UnityEngine.Rendering.HighDefinition.HDAdditionalCameraData.volumeLayerMask.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition%4015.0/api/UnityEngine.Rendering.HighDefinition.HDAdditionalCameraData.volumeLayerMask.html)  
[^21]: HDRP Camera | High Definition RP | 14.0.12 - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/HDRP-Camera.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@14.0/manual/HDRP-Camera.html)  
[^22]: Unity/URP global volume with volume mask still applies effects to all layers, 访问于 2026年5月11日, [https://gamedev.stackexchange.com/questions/210918/unity-urp-global-volume-with-volume-mask-still-applies-effects-to-all-layers](https://gamedev.stackexchange.com/questions/210918/unity-urp-global-volume-with-volume-mask-still-applies-effects-to-all-layers)  
[^23]: Apply different post processing effects to separate cameras in URP - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/cameras/apply-different-post-proc-to-cameras.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/cameras/apply-different-post-proc-to-cameras.html)  
[^24]: HDRP - Volume Layer Mask - Unity Discussions, 访问于 2026年5月11日, [https://discussions.unity.com/t/hdrp-volume-layer-mask/754924](https://discussions.unity.com/t/hdrp-volume-layer-mask/754924)  
[^25]: [HDRP] Easiest way to force an object to render over everything else? : r/Unity3D - Reddit, 访问于 2026年5月11日, [https://www.reddit.com/r/Unity3D/comments/178uzdg/hdrp_easiest_way_to_force_an_object_to_render/](https://www.reddit.com/r/Unity3D/comments/178uzdg/hdrp_easiest_way_to_force_an_object_to_render/)  
[^26]: Struggling to render hands in separate layer (HDRP) any clean setup that actually works? : r/Unity3D - Reddit, 访问于 2026年5月11日, [https://www.reddit.com/r/Unity3D/comments/1lhpqhv/struggling_to_render_hands_in_separate_layer_hdrp/](https://www.reddit.com/r/Unity3D/comments/1lhpqhv/struggling_to_render_hands_in_separate_layer_hdrp/)  
[^27]: Understand custom pass volumes | High Definition Render Pipeline | 17.0.4, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Custom-Pass-Volume-Workflow.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Custom-Pass-Volume-Workflow.html)  
[^28]: Unity 6's New Global Illumination Lighting Features, 访问于 2026年5月11日, [https://unity.com/blog/engine-platform/new-ways-of-applying-global-illumination-in-unity-6](https://unity.com/blog/engine-platform/new-ways-of-applying-global-illumination-in-unity-6)  
[^29]: Fix issues with Adaptive Probe Volumes | High Definition Render Pipeline | 17.0.4, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/probevolumes-fixissues.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/probevolumes-fixissues.html)  
[^30]: Override rendering layer masks in a volume - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/features/rendering-layer-masks-apv-override-probe-in-a-volume.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/features/rendering-layer-masks-apv-override-probe-in-a-volume.html)  
[^31]: How to use Adaptive Probe Volume Rendering Layer Mask - Unity Discussions, 访问于 2026年5月11日, [https://discussions.unity.com/t/how-to-use-adaptive-probe-volume-rendering-layer-mask/1650216](https://discussions.unity.com/t/how-to-use-adaptive-probe-volume-rendering-layer-mask/1650216)  
[^32]: Override Rendering Layer Mask in Probe Adjustment Volume - Unity Discussions, 访问于 2026年5月11日, [https://discussions.unity.com/t/override-rendering-layer-mask-in-probe-adjustment-volume/1645954](https://discussions.unity.com/t/override-rendering-layer-mask-in-probe-adjustment-volume/1645954)  
[^33]: Bake different lighting setups with Lighting Scenarios | High Definition RP - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/probevolumes-bakedifferentlightingsetups.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@16.0/manual/probevolumes-bakedifferentlightingsetups.html)  
[^34]: Shadows in the High Definition Render Pipeline | High Definition RP | 12.0.0 - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@12.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@12.0/manual/Shadows-in-HDRP.html)  
[^35]: Control shadow resolution and quality | High Definition Render Pipeline - Unity - Manual, 访问于 2026年5月11日, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Shadows-in-HDRP.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/Shadows-in-HDRP.html)  
[^36]: Using Unity Layers to Control Lighting on Certain Objects (Layer and Occlusion Solution), 访问于 2026年5月11日, [https://www.youtube.com/watch?v=1cjKPU_3A4A](https://www.youtube.com/watch?v=1cjKPU_3A4A)  
[^37]: Prototype_Final/Library/PackageCache/com.unity.render-pipelines.high-definition@10.8.1/Documentation~/Shadows-in-HDRP.md · main · PENGXI WANG / EAE6330_Final · GitLab, 访问于 2026年5月11日, [https://gapp-git.eng.utah.edu/u1066693/eae6330_final/-/blob/main/Prototype_Final/Library/PackageCache/com.unity.render-pipelines.high-definition@10.8.1/Documentation~/Shadows-in-HDRP.md](https://gapp-git.eng.utah.edu/u1066693/eae6330_final/-/blob/main/Prototype_Final/Library/PackageCache/com.unity.render-pipelines.high-definition@10.8.1/Documentation~/Shadows-in-HDRP.md)  
[^38]: Is there a maximum number of light you can create in a Project? - Unity Engine, 访问于 2026年5月11日, [https://discussions.unity.com/t/is-there-a-maximum-number-of-light-you-can-create-in-a-project/910450](https://discussions.unity.com/t/is-there-a-maximum-number-of-light-you-can-create-in-a-project/910450)  
[^39]: Limit of number of Lights in view : r/Unity3D - Reddit, 访问于 2026年5月11日, [https://www.reddit.com/r/Unity3D/comments/sh188j/limit_of_number_of_lights_in_view/](https://www.reddit.com/r/Unity3D/comments/sh188j/limit_of_number_of_lights_in_view/)  
[^40]: Too many layers used to exclude objects from lighting. in deferred only up to 4 layers can be used simultaneously - Unity Discussions, 访问于 2026年5月11日, [https://discussions.unity.com/t/too-many-layers-used-to-exclude-objects-from-lighting-in-deferred-only-up-to-4-layers-can-be-used-simultaneously/1518892](https://discussions.unity.com/t/too-many-layers-used-to-exclude-objects-from-lighting-in-deferred-only-up-to-4-layers-can-be-used-simultaneously/1518892)
