---
title: "Unity 6 渲染架构：摒弃 MPB 以实现深度材质优化"
date: 2026-04-19 12:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, rendering, optimization, shaders, dots, longgilstudio]
description: "全面解析 Unity 6 中从 MaterialPropertyBlock 向 RSUV 与 GPU Resident Drawer 的架构演进，以实现 AAA 级渲染性能。"
lang: zh-CN
translation_id: unity6-material-rsuv-grd
math: true
---

## **执行摘要（Executive Summary）**

向 Unity 6 的迁移标志着渲染管线在处理大规模实例化几何体（instanced geometry）方式上的一次根本性架构变革。在游戏开发的历史上，当多个对象共享同一材质却需要各自独立的属性变体（例如颜色染色——color tints）时，优化方案通常依赖于 `MaterialPropertyBlock`（MPB）应用程序编程接口（API）与标准 GPU Instancing 系统的组合。然而，对 Unity 6 中 Universal Render Pipeline（URP）和 High Definition Render Pipeline（HDRP）的深入分析表明，这种遗留（legacy）方法已不再是最优路径，在许多场景下甚至会造成严重的性能退化。

对用户为“Long Gil Studio DevLog”提供的文档草稿进行评估后，可以发现其中混杂了在旧版本中成立的传统优化理论，以及对 Unity 6 现代渲染特性的严重误解。具体而言，草稿推荐使用的 `MaterialPropertyBlock` 与 Unity 6 全新的 **GPU Resident Drawer（GRD）** 技术及其底层的 **BatchRendererGroup（BRG）** API 直接冲突。[^1] 为了获得最大的渲染吞吐量，开发者必须采用 **Renderer Shader User Value（RSUV）**，或者彻底转向 **Data-Oriented Technology Stack（DOTS）**。[^3]

本研究报告针对渲染瓶颈、Scriptable Render Pipeline（SRP）Batcher 的工作机制、材质复制引发的系统性后果，以及在 Unity 6 中实现 AAA 级渲染性能所需的现代范式进行了全面深入的技术剖析。此外，报告还提供了一份经过修正、专业整合的技术文章，可供发布于 Long Gil Studio DevLog。

## **第一部分：Long Gil Studio 原始草稿的技术评估**

最初的草稿提出了一个非常具体的渲染问题：优化一个包含无数完全相同对象的场景，这些对象共享同一个材质，但需要各自独立的颜色修改。草稿准确地识别出了错误的设计模式（anti-patterns），却指定了一个在 Unity 6 架构背景下会降低性能的解决方案。

### **原始草稿中的正确之处**

1. **材质复制（Material Duplication）的惩罚：** 草稿正确指出，为每个对象创建独立的材质实例（例如通过 `GetComponent<Renderer>().material.color`）会导致内存膨胀（memory bloat）并彻底破坏绘制调用合批（draw call batching）。[^5] 访问 `.material` 属性会迫使 Unity 引擎静默克隆（clone）该材质，从而永久性地使 SRP Batcher 或 GPU Instancing 系统丧失将这些对象合并到单次 SetPass 调用中的能力。[^5]
2. **MaterialPropertyBlock（MPB）的机制：** 草稿准确指出 MPB 充当了一个数据覆盖缓冲区（data override buffer），允许渲染器在不创建新材质副本的情况下向 GPU 传递逐实例（per-instance）属性。[^7]
3. **字符串（String）属性与整数标识符（Integer IDs）：** 草稿恰当地强调了使用字符串查找着色器属性所带来的中央处理器（CPU）开销，主张通过 `Shader.PropertyToID()` 命令预先缓存整数标识符以优化循环。[^7]

### **严重偏差与过时范式**

1. **将 MPB 视为 Unity 6 中的“AAA 标准”：** 原始草稿中最显著的缺陷是声称 MPB 代表了 Unity 6 的最优“AAA”解决方案。尽管 MPB 在 Built-In Render Pipeline（旧架构）中是标准做法，但在现代 SRP 架构中它却起着破坏性作用。[^8] 对一个 GameObject 应用 MPB 会立即将该对象逐出 SRP Batcher 管线。[^10]
2. **对传统 GPU Instancing 的依赖：** 草稿承认 MPB 会破坏 SRP Batcher，并建议退而求其次使用传统的 GPU Instancing。尽管从技术上讲，可以通过手动破坏 SRP 兼容性并启用 Instancing 来实现这一点，但这会迫使引擎绕过高度优化的 SRP 架构。[^12]
3. **忽略 GPU Resident Drawer（GRD）：** Unity 6 引入了 GPU Resident Drawer，该系统将绘制调用（draw call）的生成卸载至计算着色器（compute shaders），可将 CPU 渲染开销降低高达 50%。[^14] 只要存在 `MaterialPropertyBlock`，就会严格禁止该 GameObject 参与 GRD。[^1] 在 Unity 6 中推荐使用 MPB，实质上阻碍了项目利用引擎最强大的全新优化特性。
4. **遗漏 Renderer Shader User Value（RSUV）：** 在 Unity 6.3 LTS 中引入的 RSUV 是处理简单逐对象变体时 MPB 的直接架构替代品。[^15] RSUV 允许为每个渲染器向着色器传递一个 24 位整数，同时完全不会破坏 SRP Batcher 或 GPU Resident Drawer。[^3]

## **第二部分：渲染瓶颈（Bottlenecks）的根本原因分析**

要理解为何特定的 API 调用会摧毁帧率（frame rate），就必须审视中央处理器（CPU）与图形处理器（GPU）之间的通信模型。现代硬件架构要求这两个处理器之间保持紧密且对延迟敏感的同步。

### **CPU-GPU 通信开销（Overhead）**

渲染一帧画面需要 CPU 遍历相机视锥体内的所有可见对象（frustum culling），确定它们的材质属性，将所需的纹理（textures）与着色器绑定（bind）到 GPU 内存中，并发出绘制命令（draw command）。该管线中开销最大的操作并非 GPU 绘制多边形（polygons），而是在绘制调用之前必须执行的状态切换——通常称为 **SetPass 调用**。[^5]

每当 CPU 遇到一个新材质时，都必须暂停渲染管线以将新参数上传至 GPU。[^18] 如果一个场景中包含 10,000 个敌人，且每个敌人都拥有一个独立的材质实例以呈现不同的护甲颜色，CPU 就必须执行 10,000 次状态切换。这会产生巨大的 CPU 开销（CPU Overhead），导致 GPU 空闲等待 CPU 指令的瓶颈。

### **`.material` 属性引发的内存碎片化**

当脚本访问 `Renderer.material` 以修改颜色时，引擎必须保护原始共享资产（asset）的完整性。它会在内部对该材质执行一次 `Instantiate()`。这会带来两项严重的性能惩罚：

1. **破坏合批（Batching）：** 该对象不再与同类对象共享材质引用。Unity 会立即停止对该对象执行任何形式的 Static Batching、Dynamic Batching 或 SRP Batching。[^5] 显卡必须将其作为完全独立的实体进行处理。
2. **垃圾回收（Garbage Collection）与内存泄漏（Memory Leaks）：** 新克隆的材质创建在由 C# 管理的托管堆（Heap）上。当对象被销毁时，它不会自动被垃圾回收。除非开发者显式调用 `Destroy(renderer.material)`，否则该内存会一直保持分配状态。这会造成内存泄漏，迫使垃圾回收器（Garbage Collector — GC）触发标记-清除（Mark-and-Sweep）过程，引发导致帧率骤降的严重卡顿尖峰（spikes）。[^5]

## **第三部分：SRP Batcher 的架构与传统 GPU Instancing 的过时**

Scriptable Render Pipeline（SRP）从根本上重组了 Unity 管理着色器数据的方式。理解 SRP Batcher 是认清旧式优化方法在 Unity 6 中为何彻底失效的关键。

### **SRP Batcher 的工作原理**

在旧管线（Built-in）中，材质通过独立的统一变量（separate uniform variables）将数据上传至 GPU。SRP Batcher 改用大型、持久化的 GPU 缓冲区——即**常量缓冲区（Constant Buffers — CBUFFERs）**来取代这一方式。[^11]

SRP 架构要求着色器将其变量拆分为两个独立的缓冲区数据块[^11]：

* `UnityPerMaterial`：一个包含由所有使用同一材质的对象所共享属性的 CBUFFER（例如基础颜色、金属度贴图——metallic maps、光滑度）。
* `UnityPerDraw`：一个包含特定绘制调用独有属性的 CBUFFER（例如对象的空间变换矩阵——transformation matrices）。

由于 `UnityPerMaterial` 缓冲区持久驻留在 GPU 内存中，只要连续的对象共享同一着色器变体（shader variant），CPU 就不再需要在渲染循环中重新上传材质属性。[^18] SRP Batcher 只需绑定（bind）这个持久化缓冲区，并更新体积小得多的 `UnityPerDraw` 缓冲区。这种设计显著降低了 CPU 开销，有时可将渲染吞吐量提升 1.2 倍至 4 倍。[^21]

### **与 `MaterialPropertyBlock` 的核心冲突**

`MaterialPropertyBlock` API 最初是为了在渲染器级别覆盖材质属性而设计的。然而，由于 SRP Batcher 依赖于 `UnityPerMaterial` CBUFFER 的严格隔离与持久性，注入 MPB 会直接破坏这种内存布局。[^8]

一旦应用了 MPB，Unity 就无法再保证持久化的材质缓冲区能够统一应用于该对象。因此，引擎被迫将该对象强行踢出 SRP Batcher 管线。[^9] Unity 官方文档明确确认：*“请注意，此功能与 SRP Batcher 不兼容。在 URP 或 HDRP 中使用 MPB 很可能会导致性能下降。”*[^8]

### **遗留后备方案：`Graphics.DrawMeshInstanced`**

过去，当开发者需要大量逐实例变体（例如一片拥有不同色调树木的森林）时，他们会接受失去 SRP Batcher 的代价，转而使用 GPU Instancing。[^12] 这需要通过在 `UnityPerMaterial` 缓冲区外部声明属性，并在材质上勾选“Enable GPU Instancing”，从而手动破坏着色器的 SRP 兼容性。[^13]

虽然 GPU Instancing 通过传递变换矩阵数组和颜色数据减少了绘制调用次数，但它伴随着严重的局限性。[^12] 它难以应对严重的过绘制（overdraw）问题，要求网格（meshes）必须完全相同，并且每帧都会给 CPU 带来收集和上传实例数组（instance arrays）的沉重负担。在 Unity 6 中，这种方法已被 GPU Resident Drawer 架构完全取代。[^23]

## **第四部分：`MaterialPropertyBlock`（MPB）与 Unity 6 生态系统的不兼容性**

对 MPB 的进一步分析表明，它不仅会破坏 SRP Batcher，还会给 Unity 6 中的调试工具（debugging tools）和光照系统（lighting systems）带来结构性风险。

### **对光照贴图（Lightmap）数据与全局光照（Global Illumination）的影响**

不当使用 MPB 最少被提及的后果之一是抹除光照贴图（Lightmap）数据。当你创建一个 `new MaterialPropertyBlock()` 并通过 `Renderer.SetPropertyBlock()` 赋值时，传入的属性块会完全覆盖渲染器的局部状态。[^24]

如果你的对象正在使用烘焙（baked）全局光照（GI）系统，关于 Lightmap UV 坐标和光照探针（Light Probe）系数的信息就隐式存储在渲染器自身的属性块中。[^24] 如果在设置颜色之前没有先调用 `Renderer.GetPropertyBlock(block)`，你就会无意中清除掉对象的光照信息。尽管 Long Gil Studio 的原始草稿妥善处理了 `GetPropertyBlock` 部分，但在数千个对象上反复调用该 API 本身也会带来不容忽视的额外 CPU 延迟。

| 优化技术 | 是否导致内存泄漏 | 兼容 SRP Batcher | 兼容 GRD | 兼容 DOTS | 使用建议 |
| :----------------------------- | :------------ | :---------------------- | :-------------- | :--------------- | :-------------------- |
| **`Material.color`** | 是 | 否 | 否 | 否 | 绝对避免 |
| **`MaterialPropertyBlock`** | 否 | 否 | 否 | 否 | 仅限旧版 Built-in 项目 |
| **GPU Instancing** | 否 | 否（冲突） | 否 | 否 | Unity 2020–2022 |
| **Renderer Shader User Value** | 否 | 是 | 是 | 是 | Unity 6.3+ 标准方案 |

如上表所示，MPB 现已属于上一代技术。它解决了内存泄漏问题，却破坏了 Unity 6 整套现代渲染管线。

## **第五部分：架构转折点：GPU Resident Drawer（GRD）与 `BatchRendererGroup`（BRG）**

Unity 6 引入了一条革命性的渲染路径：GPU Resident Drawer。该系统将渲染模式从 CPU 主导生成绘制指令，转变为高度自治的 GPU 驱动渲染循环。[^1]

### **GPU Resident Drawer 的架构**

GPU Resident Drawer 基于底层的 `BatchRendererGroup`（BRG）API 运行。[^1] CPU 不再评估哪些对象可见（视锥体剔除——frustum culling）并发出单个或实例化绘制调用，而是将整个场景的空间与材质数据上传到 GPU。[^25] 随后，计算着色器（compute shaders）完全在 GPU 上执行视锥体剔除、遮挡剔除（occlusion culling）以及绘制命令生成。[^14]

性能提升极其显著。通过采用间接渲染（`DrawInstancedIndirect`），复杂场景中渲染所需的 CPU 工作量可减少高达 50%。[^14] 此外，当与 GPU Occlusion Culling 结合使用时，三角形处理量（triangle processing）可减少近 90%，同时 GPU 帧时间（frame time）缩短一半以上。[^28]

### **`BatchRendererGroup`（BRG）API 与剔除（Culling）**

支撑 GRD 的是 `BatchRendererGroup`。BRG 需要用户通过一个 `OnPerformCulling` 回调函数进行初始化。[^30] 在此过程中，CPU 只需配置可见性（visibility）并输出批处理的绘制调用指令。对象数据（变换矩阵、颜色、标记位）被上传至 `GraphicsBuffer`。[^25] 这使得数百万个三角形只需极少次数的 SetPass 调用即可提交给 GPU。

### **MPB 与 GRD 的致命不兼容性**

关于 Unity 6 优化最关键的信息在于 GPU Resident Drawer 准入要求的严格性。一个对象要想由 GRD 处理，必须遵循严苛的数据布局规则。[^2]

Unity 6.1+ 官方文档明确声明，使用 `MaterialPropertyBlock` API 的 GameObject 会立即被 GPU Resident Drawer 排除在外。[^1] 此外，对象不能挂载依赖逐实例回调（如 `OnRenderObject`）的脚本。[^2]

当开发者挂载 MPB 来更改对象颜色时，实际上是在无意中迫使引擎针对该特定对象回退到基于 CPU 的传统渲染路径。如果在即时战略游戏中的 10,000 个士兵单位上执行此操作，CPU 开销会急剧飙升，彻底抵消升级至 Unity 6 引擎带来的全部收益。

## **第六部分：现代标准：Unity 6.3 中的 Renderer Shader User Value（RSUV）**

认识到 MPB 与现代管线不兼容所造成的架构僵局后，Unity 在 Unity 6.3 LTS 版本中推出了 **Renderer Shader User Value（RSUV）** 特性。[^15] 当开发者需要在共享同一材质的多个渲染器上应用简单的逐实例自定义数据时，RSUV 将作为 `MaterialPropertyBlock` 的决定性替代方案。[^3]

### **RSUV 的工作原理**

RSUV 绕过了导致 MPB 缺陷的复杂缓冲区修改操作。相反，它利用了一个随渲染器标准绘制数据一并直接传递的高效 24 位整数通道。[^3] 由于该整数被直接集成在现有数据结构中，而无需额外的缓冲区覆盖（buffer override），因此它与 SRP Batcher 和 GPU Resident Drawer 都保持着 100% 的兼容性。[^3]

### **实现与按位编码（Bitwise Encoding）**

为了使用 RSUV 实现颜色变化，CPU 必须将所需的 RGB 值编码进单个 24 位无符号整数（`uint`）中。每个颜色通道（红——Red、绿——Green、蓝——Blue）占用 8 位（提供 0 到 255 的数值范围）。[^3]

编码运算使用按位左移运算符（`<<`）和按位或运算符（`|`）。其数学表达式如下：

$$
Color_{uint} = (Blue_{byte} \ll 16) | (Green_{byte} \ll 8) | (Red_{byte})
$$

在实际的 C# 实现中，遍历 `MeshRenderer` 组件数组以应用随机染色具有极高的性能，且不会产生任何垃圾内存分配（zero garbage allocation）[^3]：

```csharp
MeshRenderer allMeshRenderers = FindObjectsByType<MeshRenderer>(FindObjectsSortMode.InstanceID);  
foreach (MeshRenderer meshRenderer in allMeshRenderers)  
{  
    // 计算随机颜色（使用 HSV 色彩空间以获得更鲜艳的颜色）  
    Color32 targetColor = Color.HSVToRGB(UnityEngine.Random.Range(0f, 1f), 1f, 1f);  

    // 将 RGB 编码进 24 位整数（蓝、绿、红）  
    uint encodedColor = ((uint)targetColor.b << 16) |   
                        ((uint)targetColor.g << 8) |   
                        ((uint)targetColor.r << 0);  

    // 通过 Unity 6.3 的新 API 直接将数值应用到渲染器
    meshRenderer.SetShaderUserValue(encodedColor);  
}
```

### **着色器端解码（Shader Decoding）**

在 GPU 端，着色器必须将这个 24 位整数解包（unpack）还原为归一化的 `float4` 颜色值。Unity 提供了内置变量 `unity_RendererUserValue` 用于访问该数据块。[^3]

解码过程使用按位右移运算符（`>>`）和带有掩码 `255` 的按位与运算符（`&`）来分离每个 8 位分段，随后乘以 255 的倒数（`1.0 / 255.0`），将数值归一化到 `0.0` 到 `1.0` 的范围内。[^3]

$$
Channel_{normalized} = ((unity\_RendererUserValue \gg Shift) \ \& \ 255) \times 0.0039215
$$

在高级着色器语言（HLSL）中或通过 Shader Graph 中的 Custom Function 节点，解包逻辑如下所示[^3]：

```hlsl
uint c = unity_RendererUserValue;  
float4 instanceColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  // 红色通道 (Red)  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  // 绿色通道 (Green)  
    (float)((c >> 16) & 255) * (1.0 / 255.0), // 蓝色通道 (Blue)  
    1.0 // 固定 Alpha  
);
```

这一范式转变体现了一种深刻的优化策略：用纯数学计算（RSUV）替代数据结构复杂度（如 MPB）。GPU 处理器极其擅长按位运算，这意味着解码成本几乎可以忽略不计（仅消耗极微小的时钟周期——clock cycles）。与此同时，保留 SRP Batcher 和 GPU Resident Drawer 管线带来了帧时间（frame-time）的大幅缩减。[^16]

## **第七部分：超大规模解决方案：DOTS、ECS 与 `URPMaterialPropertyOverride`**

对于运行规模超出标准 GameObject 处理能力的项目（例如包含数十万个独立单位的群体模拟——boids，或超大规模 RTS 军团），Unity 的 Data-Oriented Technology Stack（DOTS）技术提供了终极渲染架构。[^4]

### **面向数据的内存管理（Data-Oriented Memory）**

不同于面向对象（object-oriented）系统中 GameObject 零散分布在堆内存中的限制，实体组件系统（ECS）中的实体（entities）完全以内存中的连续数据数组（contiguous arrays of data）形式存在。[^4] 这种内存布局与 `BatchRendererGroup`（BRG）API 实现最高性能所需的结构完美契合。

在 Entities Graphics 包中，开发者可以使用 `URPMaterialPropertyOverride` 组件。[^4] 该系统允许实现逐实体的材质属性覆盖（per-entity material overrides），而完全无需使用有害的 `MaterialPropertyBlock` API。

### **DOTS Instancing 的工作原理**

当一个实体在 DOTS 中被处理时，配置了 DOTS Instancing 的着色器（通过在 Shader Graph 中勾选 *Override Property Declaration* 并选择 *Hybrid Per Instance*）会接收到一个唯一的 32 位整数（即元数据值——metadata value）。[^34] 该整数代表 GPU 上一个稳定 `GraphicsBuffer` 内部的偏移量（offset）。[^34]

着色器利用该偏移量来读取当前正在渲染的实例的特定属性数据。[^34] DOTS Instancing 的独特之处在于：如果多个实体共享相同的属性值，DOTS Instancing 允许它们从内存中的同一位置（同一偏移量）读取该值，从而节省 GPU 周期并最大程度减少内存重复。[^34] 由于属性是通过偏移量读取而非塞入传统的常量缓冲区中，单次绘制调用的大小不再受到严格限制，从而能够支撑极其庞大的实例数量。

```csharp
// 通过 DOTS / Burst Compile 系统分配 RSUV 值的示例 

public partial struct MaterialMeshInfoSystem : ISystem   
{  
    public void OnUpdate(ref SystemState state)   
    {  
        var entityManager = state.EntityManager;  
        // 通过将数值直接写入 NativeArray 实现并行处理  
        // 带来 MonoBehaviour 永远无法企及的执行速度。  
    }  
}
```

通过 Bursted Background Jobs（经由 Burst Compiler 编译的后台作业）修改实体的组件值可以以惊人的速度执行。[^4] 开发者可以让栅栏根据地形坡度改变颜色，或者让草地根据海拔高度改变色泽，所有这些都在单一绘制流（draw stream）中渲染完成而毫无瓶颈。[^4]

## **第八部分：替代方案分析（Alternative Solutions）**

Long Gil Studio 的原始草稿简短提及了几种替代优化技术。以下分析确认了它们的可行性，并将其置于 Unity 6 引擎物理限制的背景下进行考量。

1. **顶点色（Vertex Colors）：**
   * *机制：* 将颜色数据直接编码到 3D 网格的顶点（vertices）中。着色器从网格读取 `TEXCOORD` 或 `COLOR` 属性。
   * *效果：* 极为轻量，且完美保留所有合批功能以及 GRD 兼容性。[^36]
   * *劣势：* 在运行时（runtime）修改顶点色需要操作网格数据数组（`mesh.colors`）。该操作会在内存中创建网格副本，引发 CPU 停顿（stalls）和垃圾内存分配。顶点色至今仍然最适合在 Blender 或 Maya 等软件中预先“烘焙”（baked）好的静态变体。
2. **纹理图集与 UV 偏移（Texture Atlasing 与 UV Offsets）：**
   * *机制：* 将多个颜色变体合并到单个纹理图集（texture atlas）中，并偏移不同对象的 UV 坐标以采样特定的像素。[^36]
   * *效果：* 该技术保留单一材质与单一纹理，确保与 SRP Batcher 保持绝对兼容。[^36]
   * *劣势：* 与顶点色类似，在运行时动态更改不同对象的 UV 坐标通常需要创建独立的网格实例（mesh instances），从而引发内存膨胀（memory bloat）。不过，对于静态环境设计或体素（Voxel）游戏（如《Minecraft》），这是无可匹敌的技术。
3. **底层 `Graphics.DrawMeshInstanced`：**
   * *机制：* 完全绕过 GameObject 层级结构，通过 C# 代码直接将坐标矩阵和颜色数组推送到 GPU。[^37]
   * *效果：* 为集群算法（flocking）或程序化植被（procedural foliage）等系统提供极其强大的性能。[^38]
   * *在 Unity 6 中的劣势：* `BatchRendererGroup` API 与 GPU Resident Drawer 的问世已经将这种高性能“普及化”，在绝大多数常规开发场景中省去了手写复杂剔除（culling）和绘制提交代码的必要。[^19] 如今维护一套自定义的 `DrawMeshInstanced` 系统，比交由 GPU Resident Drawer 自动处理耗费更多工程资源。

## **第九部分：Long Gil Studio DevLog 推荐内容结构**

基于全面的技术评估过程，以下文本部分为经过彻底修订的推荐 DevLog 文章，展现了高水准的技术专业性。它摒弃了有缺陷的 MPB 方法，并引导读者转向 Unity 6 真正的架构标准：RSUV 与 GPU Resident Drawer。

---

**Unity 6：优化共享同一材质的数千个对象 – 摒弃 MPB 迈向现代架构**

**作者：Long Gil Studio**

**🇻🇳 越南语版（简体中文译本）**

**1. 渲染瓶颈：材质复制乱象**

在开发大型游戏的过程中，经常会遇到一个极为普遍的架构难题：“如何在不掉帧的前提下，改变数千个共享同一材质的对象的颜色？”

许多开发者习惯使用 `GetComponent<Renderer>().material.color`。这是一个致命的错误（anti-pattern）。调用 `.material` 会迫使 Unity 在内存中静默创建该材质的一个副本（clone）。后果便是严重的内存泄漏、持续触发垃圾回收（Garbage Collection），以及彻底破坏合批（Batching）系统。GPU 陷入饥饿等待，而 CPU 却因处理数千个独立的 Draw Call 而过载。

**2. 遗留陷阱：为何 `MaterialPropertyBlock` 在 Unity 6 中已“死亡”**

过去，“专业级”的解决方案是使用 `MaterialPropertyBlock`（MPB）在不克隆材质的情况下为每个对象传递数据。**但如果你正在使用 Unity 6（URP/HDRP），必须立即停止使用该方法。**

Unity 6 高度依赖 **SRP Batcher** 管线以及革命性的 **GPU Resident Drawer（GRD）** 技术。GRD 将整套渲染处理流程（Draw Call 生成、剔除/Culling）下放至 GPU 上的计算着色器（Compute Shaders），可帮助减少高达 50% 的 CPU 计算时间。然而，根据引擎核心文档，一旦你为对象附加了 `MaterialPropertyBlock`，该对象就会立刻被逐出 SRP Batcher，并彻底失去与 GPU Resident Drawer 的兼容性。使用 MPB 意味着你正在强迫 Unity 为你的整支军队退回到缓慢且耗费 CPU 的传统渲染管线。

**3. Unity 6 新标准：Renderer Shader User Value（RSUV）**

为了彻底打破这一僵局，Unity 6.3 LTS 更新引入了 **Renderer Shader User Value（RSUV）**。该 API 允许你直接向渲染器传递一个 24 位整数。由于 RSUV 不需要分配新的缓冲区（buffers），它与 SRP Batcher 和 GPU Resident Drawer 均保持 100% 兼容。

**第 1 步：C# 编码（零垃圾内存分配）**

与 MPB 使用字符串（string）不同，我们将使用按位移动（bitwise）运算把 RGB 颜色编码为一个 24 位整数：

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // 将蓝、绿、红三个通道编码进一个 24 位整数  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // 应用数值（对 SRP 与 GRD 架构绝对安全！）  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**第 2 步：在 Shader Graph 上解码**

在 Shader Graph 内部创建一个输出为 `Vector4` 的 **Custom Function** 节点（Type: String, Name: DecodeColor）。粘贴以下 HLSL 代码段以将整数解包还原为标准颜色：

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

将该输出连接到片元着色器（Fragment Shader）的 Base Color 端口。现在，你拥有了零 CPU 延迟的无限色彩变体，同时充分释放了 GPU Resident Drawer 系统的威力。

**示例：在 Shader 脚本中的实战应用（不使用 Shader Graph）**

如果你使用代码（HLSL）编写自定义着色器，可以介入 `BuildSurfaceData` 函数来解码 `unity_RendererUserValue`，并如下方 diff 片段所示将其与 `BaseColor` 相乘：

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // 解码 RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // 应用 rsuvColor 颜色
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ... 
}
```

*了解更多参考内容：*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. 突破 100,000 个对象大关：DOTS / ECS 方案**

如果你的游戏需要渲染数十万个独立单位（例如庞大的军团），无论你把渲染优化得多么出色，传统的 GameObject 系统必然会遇到 CPU 瓶颈。面对这种规模，请转向 Unity DOTS 架构。使用 `URPMaterialPropertyOverride` 组件可以建立面向数据（Data-Oriented）的内存布局，在底层直接与 `BatchRendererGroup` API 系统通信，带来真正 AAA 级水准的无可匹敌的性能。

---

**🇺🇸 英文版（简体中文译本）**

**1. 渲染瓶颈：材质复制**

在开发高密度游戏时，经常会出现一个常见的架构挑战：“如何在不摧毁性能的情况下，更改共享同一材质的数千个对象的颜色？”

开发者通常会默认使用 `GetComponent<Renderer>().material.color`。这是一个致命的反模式（anti-pattern）。访问 `.material` 会迫使 Unity 在托管堆上静默克隆该材质。这会导致严重的内存膨胀，触发垃圾回收尖峰，并摧毁绘制调用合批，在令 GPU 处于饥饿状态的同时将 CPU 开销推高到无法管理的水平。

**2. 遗留陷阱：为何 MaterialPropertyBlock 在 Unity 6 中已成过去式**

历史上，“专业”的解决方案是使用 MaterialPropertyBlock（MPB）在不克隆材质的情况下传递逐实例数据。**如果你正在使用 Unity 6（URP/HDRP），则必须立即停止使用此方法。**

Unity 6 高度依赖 **SRP Batcher** 以及革命性的新特性 **GPU Resident Drawer（GRD）**。GRD 将视锥体剔除与绘制调用生成卸载到 GPU 计算着色器，使 CPU 渲染时间减少高达 50%。然而，根据核心引擎文档，为对象应用 MaterialPropertyBlock 会立即将其排除在 SRP Batcher 之外，并彻底破坏其与 GPU Resident Drawer 的兼容性。使用 MPB 相当于强迫 Unity 为你的庞大军团退回到缓慢、受限于 CPU 的传统渲染路径。

**3. Unity 6 标准：Renderer Shader User Value（RSUV）**

为了解决这一架构僵局，Unity 6.3 LTS 推出了 **Renderer Shader User Value（RSUV）**。该 API 允许你向渲染器的基础数据负载直接传递一个 24 位整数。由于避免了修改持久化常量缓冲区，RSUV 与 SRP Batcher 和 GPU Resident Drawer 均保持 100% 兼容。

**第 1 步：C# 编码（零内存分配）**

我们不再传递字符串和创建块，而是使用按位运算将 RGB 颜色数学打包进一个 24 位无符号整数：

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // 将蓝、绿、红通道编码进单个 24 位整数  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // 原生应用数值（100% 兼容 SRP 与 GRD！）  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**第 2 步：着色器解码**

在你的 Shader Graph 中，创建一个输出为 `Vector4` 的 **Custom Function** 节点（Type: String, Name: DecodeColor）。粘贴此 HLSL 代码以将该整数解包还原为归一化浮点颜色：

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

将该输出连接到你的 Base Color 片元输入。现在你拥有了零绘制调用惩罚的无限色彩变体，同时充分释放了 GPU Resident Drawer 的能力。

**示例：自定义着色器中的实战实现（不使用 Shader Graph）**

如果你使用代码（HLSL）编写自定义着色器，可以如下方 diff 所示修改 `BuildSurfaceData` 函数，以解码 `unity_RendererUserValue` 并将其与 `BaseColor` 相乘：

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // 解码 RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // 应用 rsuvColor
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ...
}
```

*另请参阅：*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. 跨越 100,000 个对象：DOTS / ECS**

如果你的游戏需要渲染数十万个动态单位，无论图形优化做得多好，标准 GameObject 最终都会使 CPU 主线程陷入瓶颈。对于超大规模，请过渡到 Unity DOTS。使用 `URPMaterialPropertyOverride` 组件可实现严格的面向数据内存布局。它直接与底层 `BatchRendererGroup` API 对接，实现无与伦比、纯粹 AAA 级的渲染性能。

---

## **第十部分：开发团队的战略建议**

对现代渲染范式的分析揭示了传统（legacy）优化认知与当代引擎架构之间的重大差异。图形工程师需要把握的核心要点是：修改逐对象的数据缓冲区（data buffers）在本质上与并行执行及 GPU 驱动的渲染循环格格不入。绝不能将 Unity 5.x 或 Unity 2019 的优化思维照搬到 Unity 6 中。

为了在 Unity 6 中达到巅峰性能，开发团队必须严格执行以下准则：

1. **审计 MPB 的使用情况（Audit for MPB Usage）：** 应持续运行性能分析工具（如 Unity Profiler）与 Frame Debugger，定位并彻底根除在批量实例化几何体（mass-instanced geometry）上应用 `MaterialPropertyBlock` 的情况。MPB 带来的短期便利性在系统性丧失 GPU Resident Drawer 特性面前显得微不足道。团队应在源码中建立告警机制或编写 CI/CD 脚本，以检测不必要的 MPB 初始化。
2. **采用按位编码策略（Bitwise Encoding Strategies）：** 采用 Renderer Shader User Value（RSUV）需要编程方法论上的转变。技术美术（Technical Artists）与玩法程序员必须协同合作，针对 RSUV 的 24 位上限定义严格的按位打包方案。必须确保各类数据状态（颜色、伤害、阵营 ID — team ID）在抵达渲染器之前得到高效序列化。例如：可分配 4 位用于“阵营 ID”（支持 16 个阵营），8 位用于“伤害状态”（支持 256 个等级），以及 12 位用于“自定义染色（Custom Tint）”——所有这些都在着色器中通过位掩码（bitmasks）同步解码。
3. **评估 ECS 迁移阈值（Evaluate Thresholds for ECS Transition）：** 尽管 RSUV 解决了 GameObject 的材质变体瓶颈，但与物理计算、变换矩阵计算（transform calculations）以及 GameObject 剔除相关的 CPU 极限依然存在。预计活跃实体数量超过 10,000 个动态代理（dynamic agents）的项目，应当积极、果断地设计 DOTS（Entity Component System）落地的原型（prototypes）。利用 `URPMaterialPropertyOverride`[^34] 组件与 `BatchRendererGroup` API 进行底层交互，是充分释放次世代 PC 与主机硬件潜能的唯一途径。

## **参考文献**

[^1]: Enable the GPU Resident Drawer in URP - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html](https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html)
[^2]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)
[^3]: Set and use the RSUV - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html)
[^4]: Migrated my game to ECS/DOTS and material overrides are awesome! : r/Unity3D - Reddit, 2026 年 4 月 19 日访问, [https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated\_my\_game\_to\_ecsdots\_and\_material/](https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated_my_game_to_ecsdots_and_material/)
[^5]: Why You Should Stop Swapping Materials in Unity (And What to Do Instead) - Medium, 2026 年 4 月 19 日访问, [https://medium.com/@MTCrypto\_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e](https://medium.com/@MTCrypto_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e)
[^6]: Material Property Blocks - using them to store the original color of a material upon instantiation : r/Unity3D - Reddit, 2026 年 4 月 19 日访问, [https://www.reddit.com/r/Unity3D/comments/10jyr9b/material\_property\_blocks\_using\_them\_to\_store\_the/](https://www.reddit.com/r/Unity3D/comments/10jyr9b/material_property_blocks_using_them_to_store_the/)
[^7]: Instancing and Material Property Blocks | Ronja's tutorials, 2026 年 4 月 19 日访问, [https://www.ronja-tutorials.com/post/048-material-property-blocks/](https://www.ronja-tutorials.com/post/048-material-property-blocks/)
[^8]: Scripting API: MaterialPropertyBlock - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html](https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html)
[^9]: Unity 6 and custom material bug - Spine Forum, 2026 年 4 月 19 日访问, [https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug](https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug)
[^10]: Scriptable Render Pipeline (SRP) Batcher - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html)
[^11]: Scriptable Render Pipeline Batcher - Unity 6.3 User Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html)
[^12]: GPU instancing - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html](https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html)
[^13]: Remove SRP Batcher compatibility for GameObjects | High Definition Render Pipeline | 17.0.4 - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html)
[^14]: Beginning Game Development: GPU Resident Drawer | by Lem Apperson - Medium, 2026 年 4 月 19 日访问, [https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3](https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3)
[^15]: Introduction to RSUV - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html)
[^16]: Renderer Shader User Value sample - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html](https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html)
[^17]: Speed Up Your Game Rendering in Unity3D: The Secret to Changing Material Colors, 2026 年 4 月 19 日访问, [https://www.youtube.com/watch?v=CjfMAhU7cY8](https://www.youtube.com/watch?v=CjfMAhU7cY8)
[^18]: Scriptable Render Pipeline Batcher - Unity User Manual 2021.3 (LTS), 2026 年 4 月 19 日访问, [https://docs.unity.cn/Manual/SRPBatcher.html](https://docs.unity.cn/Manual/SRPBatcher.html)
[^19]: Unity Draw Call Batching: The Ultimate Guide (2026 Update), 2026 年 4 月 19 日访问, [https://thegamedev.guru/unity-performance/draw-call-optimization/](https://thegamedev.guru/unity-performance/draw-call-optimization/)
[^20]: Scriptable Render Pipeline Batcher - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html)
[^21]: SRP Batcher: Speed up your rendering - Unity, 2026 年 4 月 19 日访问, [https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering](https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering)
[^22]: Remove SRP Batcher compatibility for GameObjects in URP - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html)
[^23]: GPU Instancing not working? Why amount of batches doesn't change? : r/Unity3D - Reddit, 2026 年 4 月 19 日访问, [https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu\_instancing\_not\_working\_why\_amount\_of\_batches/](https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu_instancing_not_working_why_amount_of_batches/)
[^24]: Scripting API: Renderer.GetPropertyBlock - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html)
[^25]: Create batches with the BatchRendererGroup API in URP - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html)
[^26]: Use the GPU Resident Drawer | High Definition Render Pipeline | 17.0.4 - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html)
[^27]: Create draw commands with the BatchRendererGroup API | High Definition Render Pipeline, 2026 年 4 月 19 日访问, [https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html](https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html)
[^28]: Unity Tip Tuesday: GPU Resident Drawer & GPU occlusion culling - YouTube, 2026 年 4 月 19 日访问, [https://www.youtube.com/shorts/0PenzdQFlv0](https://www.youtube.com/shorts/0PenzdQFlv0)
[^29]: Graphics Features and Tools in Unity 6 Feel Like MAGIC! STP, Resident Drawer, and Occlusion Culling! - YouTube, 2026 年 4 月 19 日访问, [https://www.youtube.com/watch?v=trdeAq3WPkQ](https://www.youtube.com/watch?v=trdeAq3WPkQ)
[^30]: Initialize a BatchRendererGroup object in URP - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html)
[^31]: Boost performance of your game in Unity 6 with GPU Resident Drawer - The Knights of U, 2026 年 4 月 19 日访问, [https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/](https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/)
[^32]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)
[^33]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html)
[^34]: DOTS Instancing shaders in URP - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/Manual/dots-instancing-shaders.html](https://docs.unity3d.com/Manual/dots-instancing-shaders.html)
[^35]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html)
[^36]: One Material multiple colors possible? : r/Unity3D - Reddit, 2026 年 4 月 19 日访问, [https://www.reddit.com/r/Unity3D/comments/9oi8kz/one\_material\_multiple\_colors\_possible/](https://www.reddit.com/r/Unity3D/comments/9oi8kz/one_material_multiple_colors_possible/)
[^37]: Single-pass instanced rendering and custom shaders - Unity - Manual, 2026 年 4 月 19 日访问, [https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html](https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html)
[^38]: Use Graphics.DrawMeshInstanced or similar but vary the color on a per object basis?, 2026 年 4 月 19 日访问, [https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use\_graphicsdrawmeshinstanced\_or\_similar\_but\_vary/](https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use_graphicsdrawmeshinstanced_or_similar_but_vary/)
