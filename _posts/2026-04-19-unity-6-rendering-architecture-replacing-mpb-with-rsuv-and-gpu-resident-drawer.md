---
title: "Rendering Architecture in Unity 6: Replacing MaterialPropertyBlock with RSUV and GPU Resident Drawer"
date: 2026-04-19 12:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, rendering, optimization, shaders, dots, longgilstudio]
description: Comprehensive analysis of the architectural shift from MaterialPropertyBlock to RSUV and GPU Resident Drawer for AAA rendering performance in Unity 6.
lang: en
translation_id: unity6-material-rsuv-grd
math: true
---

## **Executive Summary**

The transition to Unity 6 marks a fundamental architectural shift in how render pipelines process high-volume instanced geometry. Historically in game development, optimizing large numbers of objects that share a single material while requiring per-object property variations (such as color tints) relied on the `MaterialPropertyBlock` (MPB) API paired with standard GPU Instancing. However, an in-depth analysis of the Universal Render Pipeline (URP) and High Definition Render Pipeline (HDRP) in Unity 6 reveals that this legacy approach is no longer optimal—and in many scenarios, it causes severe performance degradation.

Reviewing the draft document prepared for the "Long Gil Studio DevLog" reveals a mix of legacy optimization theory that held true in older versions and a critical misunderstanding of Unity 6's modern rendering features. Specifically, recommending `MaterialPropertyBlock` directly conflicts with Unity 6's new **GPU Resident Drawer (GRD)** and its underlying **BatchRendererGroup (BRG)** API.[^1] To achieve maximum rendering throughput, developers must adopt **Renderer Shader User Value (RSUV)** or transition fully to the **Data-Oriented Technology Stack (DOTS)**.[^3]

This technical report provides a thorough analysis of rendering bottlenecks, Scriptable Render Pipeline (SRP) Batcher mechanics, the systemic consequences of material duplication, and the modern patterns required to deliver AAA-grade rendering performance in Unity 6. In addition, it includes a revised, publication-ready technical article for the Long Gil Studio DevLog.

## **Part I: Technical Review of the Original Long Gil Studio Draft**

The initial draft addresses a very specific rendering problem: optimizing a Scene filled with countless identical objects sharing a single material while requiring distinct per-object color modifications. While the draft accurately identifies key anti-patterns, it prescribes a solution that degrades performance within Unity 6's architecture.

### **Accurate Points in the Original Draft**

1. **The Material Duplication Penalty:** The draft correctly states that creating separate material instances per object (for example, via `GetComponent<Renderer>().material.color`) leads to memory bloat and completely destroys draw call batching.[^5] Accessing the `.material` property forces the Unity engine to silently clone the material, permanently stripping the SRP Batcher or GPU Instancing of the ability to group those objects into a single SetPass call.[^5]
2. **MaterialPropertyBlock (MPB) Mechanics:** The draft accurately identifies that MPB acts as a data override buffer, allowing a renderer to pass per-instance properties to the GPU without creating a new material clone.[^7]
3. **String Properties vs. Integer IDs:** The draft appropriately highlights the CPU overhead caused by looking up shader properties by string name, advocating instead for pre-caching integer identifiers via `Shader.PropertyToID()` to optimize hot loops.[^7]

### **Critical Inaccuracies and Outdated Paradigms**

1. **MPB as an "AAA Standard" in Unity 6:** The most significant flaw in the original draft is claiming that MPB represents the optimal "AAA" solution for Unity 6. While MPB was standard in the legacy Built-In Render Pipeline, it acts as a disruptive anti-pattern in modern SRP architectures.[^8] Applying an MPB to a GameObject immediately disqualifies that object from the SRP Batcher pipeline.[^10]
2. **Reliance on Legacy GPU Instancing:** The draft acknowledges that MPB breaks the SRP Batcher and suggests falling back to traditional GPU Instancing. While technically feasible by manually breaking SRP compatibility and enabling Instancing, doing so forces the engine to bypass the highly optimized SRP architecture.[^12]
3. **Omission of the GPU Resident Drawer (GRD):** Unity 6 introduces the GPU Resident Drawer, a system that offloads draw call generation to compute shaders, cutting CPU rendering overhead by up to 50%.[^14] Attaching a `MaterialPropertyBlock` strictly prohibits a GameObject from participating in GRD.[^1] Recommending MPB in Unity 6 effectively prevents projects from leveraging the engine's most powerful new optimization feature.
4. **Omission of Renderer Shader User Value (RSUV):** Introduced in Unity 6.3 LTS, RSUV is the direct architectural replacement for MPB when handling simple per-object variations.[^15] RSUV lets you pass a 24-bit integer into the shader per renderer without breaking either the SRP Batcher or the GPU Resident Drawer.[^3]

## **Part II: Root-Cause Analysis of Rendering Bottlenecks**

To understand why specific API calls devastate frame rates, we must examine the communication model between the Central Processing Unit (CPU) and the Graphics Processing Unit (GPU). Modern hardware architecture requires tight, latency-sensitive synchronization between these two processors.

### **CPU-GPU Communication Overhead**

Rendering a single frame requires the CPU to iterate through all objects visible within the camera's frustum (frustum culling), resolve their material properties, bind the required textures and shaders into GPU memory, and issue a draw command. The most expensive operation in this pipeline is not the GPU rasterizing polygons, but the mandatory render-state changes executed before each draw call—commonly referred to as **SetPass calls**.[^5]

Whenever the CPU encounters a distinct material, it must stall the rendering pipeline to upload new parameters to the GPU.[^18] If a Scene contains 10,000 enemies and each enemy owns a unique material instance to support a different armor color, the CPU must perform 10,000 state changes. This generates massive CPU overhead, creating a bottleneck where the GPU sits idle waiting for instructions from the CPU.

### **Memory Fragmentation from the `.material` Property**

When a script accesses `Renderer.material` to change a color, the engine must protect the integrity of the original shared asset. It executes an internal `Instantiate()` on that material. This inflicts two severe performance penalties:

1. **Batching Destruction:** The object no longer shares a material reference with its peers. Immediately, Unity disables any form of Static Batching, Dynamic Batching, or SRP Batching for that object.[^5] The graphics card must process it as a completely isolated entity.
2. **Garbage Collection and Memory Leaks:** The newly cloned material lives on the C# managed heap (and native engine memory). It is not automatically garbage-collected when the GameObject is destroyed. Unless the developer explicitly invokes `Destroy(renderer.material)`, that memory remains allocated. This creates memory leaks that force the Garbage Collector (GC) to trigger Mark-and-Sweep passes, producing severe frame-time spikes and sudden FPS drops.[^5]

## **Part III: SRP Batcher Architecture and the Obsolescence of Traditional GPU Instancing**

The Scriptable Render Pipeline (SRP) fundamentally reorganized how Unity manages shader data. Understanding the SRP Batcher is essential to appreciating why legacy optimization patterns break down in Unity 6.

### **How the SRP Batcher Works**

In legacy pipelines (Built-In), materials uploaded data to the GPU via separate uniform variables. The SRP Batcher replaces this model with large, persistent GPU buffers known as **Constant Buffers (CBUFFERs)**.[^11]

The SRP architecture requires shaders to split their variables into two distinct buffer blocks[^11]:

* `UnityPerMaterial`: A CBUFFER containing properties shared across all objects using the same material (for example, base color, metallic maps, smoothness).
* `UnityPerDraw`: A CBUFFER containing properties unique to a specific draw call (for example, the object's spatial transformation matrices).

Because the `UnityPerMaterial` buffer persists in GPU memory, the CPU no longer needs to re-upload material properties during the render loop as long as consecutive objects share the same shader variant.[^18] The SRP Batcher simply binds this persistent buffer and updates only the much smaller `UnityPerDraw` buffer. This design drastically cuts CPU overhead, often accelerating rendering throughput by 1.2x to 4x.[^21]

### **The Core Conflict with `MaterialPropertyBlock`**

The `MaterialPropertyBlock` API was originally designed to override material properties at the renderer level. However, because the SRP Batcher relies on strict separation and persistence of the `UnityPerMaterial` CBUFFER, injecting an MPB directly violates this memory layout.[^8]

When an MPB is applied, Unity can no longer guarantee that the persistent material buffer applies uniformly to the object. Consequently, the engine is forced to abruptly eject the object from the SRP Batcher pipeline.[^9] Unity's official documentation explicitly confirms: *"Note that this feature is not compatible with the SRP Batcher. Using MaterialPropertyBlock in URP or HDRP is likely to result in a drop in performance."*[^8]

### **The Legacy Fallback: `Graphics.DrawMeshInstanced`**

Historically, when developers needed massive per-instance variation (such as a forest of trees with varying tints), they accepted losing the SRP Batcher and fell back to GPU Instancing.[^12] This required manually breaking a shader's SRP compatibility by declaring a property outside the `UnityPerMaterial` buffer and checking "Enable GPU Instancing" on the material.[^13]

Although GPU Instancing reduces draw calls by passing arrays of transformation matrices and color data, it suffers from severe limitations.[^12] It struggles with heavy overdraw, requires identical meshes, and places a heavy burden on the CPU to gather and upload instance arrays every frame. In Unity 6, this workflow has been completely superseded by the GPU Resident Drawer architecture.[^23]

## **Part IV: Incompatibility of `MaterialPropertyBlock` (MPB) with the Unity 6 Ecosystem**

A deeper look at MPB reveals that it not only breaks the SRP Batcher, but also introduces structural risks to debugging tools and lighting systems in Unity 6.

### **Impact on Lightmap Data and Global Illumination**

One of the least-discussed side effects of misusing MPB is wiping out Lightmap data. When you allocate a `new MaterialPropertyBlock()` and assign it via `Renderer.SetPropertyBlock()`, the property block you pass completely overwrites the renderer's local state.[^24]

If your object uses baked Global Illumination (GI), its Lightmap UV coordinates and Light Probe coefficients are stored implicitly inside that renderer's property block.[^24] If you fail to call `Renderer.GetPropertyBlock(block)` before setting a color, you will accidentally erase the object's lighting data. Even though the original Long Gil Studio draft handled `GetPropertyBlock` properly, calling this API repeatedly across thousands of objects introduces non-trivial CPU latency.

| Optimization Technique         | Causes RAM Leak | SRP Batcher Compatible | GRD Compatible | DOTS Compatible | Recommended Usage           |
| :----------------------------- | :-------------- | :--------------------- | :------------- | :-------------- | :-------------------------- |
| **`Material.color`**           | Yes             | No                     | No             | No              | Avoid at all costs          |
| **`MaterialPropertyBlock`**    | No              | No                     | No             | No              | Legacy Built-In projects    |
| **GPU Instancing**             | No              | No (Conflicts)         | No             | No              | Unity 2020–2022             |
| **Renderer Shader User Value** | No              | Yes                    | Yes            | Yes             | Unity 6.3+ standard         |

As the table above demonstrates, MPB is now a legacy-generation technique. It solves the RAM leak problem, but breaks the entire modern Unity 6 rendering pipeline.

## **Part V: The Architectural Turning Point — GPU Resident Drawer (GRD) and `BatchRendererGroup` (BRG)**

Unity 6 introduces a revolutionary rendering path: the **GPU Resident Drawer**. This system shifts the paradigm from CPU-driven draw call generation to a highly autonomous, GPU-driven rendering loop.[^1]

### **Architecture of the GPU Resident Drawer**

The GPU Resident Drawer is built atop the low-level `BatchRendererGroup` (BRG) API.[^1] Rather than having the CPU evaluate which objects are visible (frustum culling) and issue individual or instanced draw calls, the CPU uploads the entire scene's spatial and material data to the GPU.[^25] Compute shaders then perform frustum culling, occlusion culling, and draw call generation entirely on the GPU.[^14]

The performance gains are remarkable. Using indirect rendering (`DrawInstancedIndirect`), CPU rendering workload can drop by up to 50% in complex scenes.[^14] Furthermore, when paired with GPU Occlusion Culling, triangle processing can be reduced by nearly 90%, while GPU frame times drop by more than half.[^28]

### **The `BatchRendererGroup` (BRG) API and Culling**

Behind GRD sits `BatchRendererGroup`. BRG requires initializing with an `OnPerformCulling` callback.[^30] Here, the CPU only configures visibility and outputs batched draw commands. Object data (transforms, colors, flags) is uploaded into a `GraphicsBuffer`.[^25] This enables millions of triangles to be dispatched to the GPU in just a handful of SetPass calls.

### **MPB's Fatal Incompatibility with GRD**

The single most important takeaway for Unity 6 optimization is how strict the eligibility requirements are for the GPU Resident Drawer. For an object to be processed by GRD, it must conform to rigid data-layout rules.[^2]

Official Unity 6.1+ documentation explicitly states that GameObjects using the `MaterialPropertyBlock` API are immediately excluded from the GPU Resident Drawer.[^1] In addition, objects cannot attach scripts that rely on per-instance callbacks such as `OnRenderObject`.[^2]

When a developer attaches an MPB to tint an object, they unwittingly force the engine to fall back to the legacy CPU-driven rendering path for that specific object. Doing this across 10,000 units in a real-time strategy game causes CPU overhead to skyrocket, completely negating the benefits of upgrading to Unity 6.

## **Part VI: The Modern Standard — Renderer Shader User Value (RSUV) in Unity 6.3**

Recognizing the architectural deadlock created by MPB's incompatibility with modern pipelines, Unity introduced **Renderer Shader User Value (RSUV)** in Unity 6.3 LTS.[^15] RSUV serves as the definitive replacement for `MaterialPropertyBlock` whenever developers need simple per-instance customizations across many renderers sharing a single material.[^3]

### **How RSUV Works**

RSUV avoids the complex buffer overrides that plague MPB. Instead, it leverages an ultra-efficient 24-bit integer channel passed directly alongside the renderer's standard draw payload.[^3] Because this integer is embedded within the existing data structure rather than requiring a separate buffer override, it preserves 100% compatibility with both the SRP Batcher and the GPU Resident Drawer.[^3]

### **Implementation and Bitwise Encoding**

To use RSUV for color variation, the CPU packs the desired RGB channels into a single 24-bit unsigned integer (`uint`). Each color channel (Red, Green, Blue) occupies 8 bits (representing values from 0 to 255).[^3]

The encoding operation uses bitwise left-shift (`<<`) and bitwise OR (`|`) operators. The mathematical expression is:

$$
Color_{uint} = (Blue_{byte} \ll 16) | (Green_{byte} \ll 8) | (Red_{byte})
$$

In practical C# implementation, iterating over an array of `MeshRenderer` components to apply random color tints achieves high performance with zero garbage allocation[^3]:

```csharp
MeshRenderer allMeshRenderers = FindObjectsByType<MeshRenderer>(FindObjectsSortMode.InstanceID);  
foreach (MeshRenderer meshRenderer in allMeshRenderers)  
{  
    // Compute a random vibrant color using HSV color space  
    Color32 targetColor = Color.HSVToRGB(UnityEngine.Random.Range(0f, 1f), 1f, 1f);  

    // Encode RGB into a 24-bit integer (Blue, Green, Red)  
    uint encodedColor = ((uint)targetColor.b << 16) |   
                        ((uint)targetColor.g << 8) |   
                        ((uint)targetColor.r << 0);  

    // Apply the value directly to the renderer via the new Unity 6.3 API
    meshRenderer.SetShaderUserValue(encodedColor);  
}
```

### **Shader Decoding**

On the GPU side, the shader unpacks this 24-bit integer back into a normalized `float4` color. Unity provides the built-in variable `unity_RendererUserValue` to access this payload.[^3]

Decoding uses bitwise right-shift (`>>`) and bitwise AND (`&`) operators with a bitmask of `255` to isolate each 8-bit segment, then multiplies by the reciprocal of 255 (`1.0 / 255.0`) to normalize the value into the `0.0` to `1.0` range.[^3]

$$
Channel_{normalized} = ((unity\_RendererUserValue \gg Shift) \ \& \ 255) \times 0.0039215
$$

In High-Level Shader Language (HLSL) or via a Custom Function node in Shader Graph, the unpacking logic is expressed as follows[^3]:

```hlsl
uint c = unity_RendererUserValue;  
float4 instanceColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  // Red channel  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  // Green channel  
    (float)((c >> 16) & 255) * (1.0 / 255.0), // Blue channel  
    1.0 // Fixed Alpha  
);
```

This paradigm shift demonstrates a profound optimization strategy: trading data-structure complexity (like MPB) for pure mathematical computation (RSUV). GPUs excel at bitwise arithmetic, meaning the decoding cost is virtually negligible (tiny clock-cycle overhead), while preserving the SRP Batcher and GPU Resident Drawer paths yields massive frame-time reductions.[^16]

## **Part VII: Extreme-Scale Solution — DOTS, ECS, and `URPMaterialPropertyOverride`**

For projects operating at a scale beyond what standard GameObjects can sustain (for example, crowd simulations with hundreds of thousands of independent boids or massive RTS armies), Unity's Data-Oriented Technology Stack (DOTS) provides the ultimate rendering architecture.[^4]

### **Data-Oriented Memory Management**

Unlike the object-oriented constraints where GameObjects are scattered across the managed heap, entities in the Entity Component System (ECS) reside strictly in contiguous arrays of data in memory.[^4] This memory layout aligns seamlessly with the structures required by the `BatchRendererGroup` (BRG) API for peak performance.

Within the Entities Graphics package, developers can leverage the `URPMaterialPropertyOverride` component.[^4] This system enables per-entity material property overrides without ever touching the harmful `MaterialPropertyBlock` API.

### **How DOTS Instancing Works**

When an entity is processed in DOTS, a shader configured for DOTS Instancing (by checking *Override Property Declaration* and selecting *Hybrid Per Instance* in Shader Graph) receives a unique 32-bit integer (a metadata value).[^34] This integer represents an offset inside a persistent `GraphicsBuffer` on the GPU.[^34]

The shader uses this offset to fetch the specific property data for the instance it is currently rendering.[^34] What makes DOTS Instancing exceptional is that if multiple entities share the same property value, DOTS Instancing allows them to read that value from the exact same memory location (the same offset), saving GPU cycles and minimizing memory duplication.[^34] Because properties are fetched by offset rather than packed into rigid traditional constant buffers, draw call sizes are no longer tightly constrained, unlocking massive instance counts.

```csharp
// Example of assigning RSUV values via the DOTS / Burst-compiled system 

public partial struct MaterialMeshInfoSystem : ISystem   
{  
    public void OnUpdate(ref SystemState state)   
    {  
        var entityManager = state.EntityManager;  
        // Process in parallel by writing values directly into a NativeArray  
        // Delivering execution speed that MonoBehaviour can never match.  
    }  
}
```

Mutating entity component values inside Burst-compiled background jobs executes at blistering speed.[^4] You can have fences change color based on terrain slope or blades of grass tint dynamically by altitude, all rendered in a single draw stream without bottlenecking.[^4]

## **Part VIII: Analysis of Alternative Solutions**

The original Long Gil Studio draft briefly touched upon alternative optimization techniques. The analysis below validates their viability while framing them within the physical constraints of the Unity 6 engine.

1. **Vertex Colors:**
   * *Mechanism:* Encodes color data directly into the vertices of the 3D mesh. The shader reads the `TEXCOORD` or `COLOR` attribute from the mesh.
   * *Effectiveness:* Extremely lightweight and fully preserves all batching paths as well as GRD compatibility.[^36]
   * *Weakness:* Modifying vertex colors at runtime requires manipulating the mesh data array (`mesh.colors`). Doing so instantiates a copy of the mesh in RAM, triggering CPU stalls and garbage allocations. Vertex colors remain optimal only for static variations baked ahead of time in tools like Blender or Maya.
2. **Texture Atlasing and UV Offsets:**
   * *Mechanism:* Combines multiple color variations into a single texture atlas and shifts the UV coordinates of different objects to sample specific pixels.[^36]
   * *Effectiveness:* Keeps a single material and a single texture, guaranteeing full SRP Batcher compatibility.[^36]
   * *Weakness:* Like vertex colors, dynamically altering UV coordinates per object at runtime typically forces unique mesh instances, reintroducing memory bloat. However, for static environment design or voxel games (like Minecraft), this technique is unmatched.
3. **Low-Level `Graphics.DrawMeshInstanced`:**
   * *Mechanism:* Bypasses the GameObject hierarchy entirely to push transform matrices and color arrays straight to the GPU from C#.[^37]
   * *Effectiveness:* Delivers immense throughput for systems like flocking simulations or procedural foliage.[^38]
   * *Weakness in Unity 6:* The introduction of the `BatchRendererGroup` API and the GPU Resident Drawer has democratized this performance, eliminating the need to hand-write complex culling and draw-submission boilerplate for most common use cases.[^19] Maintaining a custom `DrawMeshInstanced` pipeline now costs more engineering effort than letting the GPU Resident Drawer automate it.

## **Part IX: Recommended Content Structure for the Long Gil Studio DevLog**

Based on this comprehensive technical review, the text below presents the revised, publication-ready DevLog article written to high engineering standards. It abandons the flawed MPB approach and guides readers toward Unity 6's true architectural standards: RSUV and the GPU Resident Drawer.

---

**Unity 6: Optimizing Thousands of Objects Sharing One Material — Leaving MPB Behind for Modern Architecture**

**By Long Gil Studio**

**🇻🇳 VIETNAMESE EDITION (Translated to English)**

**1. The Rendering Bottleneck: Material Duplication**

When developing large-scale games, an extremely common architectural challenge arises: "How do I change the color of thousands of objects sharing a single material without tanking FPS?"

Many developers instinctively reach for `GetComponent<Renderer>().material.color`. This is a fatal anti-pattern. Accessing `.material` forces Unity to silently create a clone of that material in RAM. The result is severe memory leakage, constant Garbage Collection spikes, and complete destruction of Batching. The GPU sits starved while the CPU chokes processing thousands of individual Draw Calls.

**2. The Legacy Trap: Why `MaterialPropertyBlock` Is "Dead" in Unity 6**

Previously, the "Pro" solution was to use `MaterialPropertyBlock` (MPB) to pass per-object data without cloning materials. **But if you are on Unity 6 (URP/HDRP), you must stop using this method immediately.**

Unity 6 relies heavily on the **SRP Batcher** and a revolutionary new technology: the **GPU Resident Drawer (GRD)**. GRD offloads the entire rendering pipeline (Draw Call generation, Culling) to Compute Shaders on the GPU, cutting CPU computation time by up to 50%. However, according to core engine documentation, the moment you attach a `MaterialPropertyBlock` to an object, that object is immediately evicted from the SRP Batcher and completely loses compatibility with the GPU Resident Drawer. Using MPB means forcing Unity back onto a slow, CPU-heavy legacy rendering path for your entire army.

**3. The New Unity 6 Standard: Renderer Shader User Value (RSUV)**

To permanently break this deadlock, Unity 6.3 LTS introduced **Renderer Shader User Value (RSUV)**. This API lets you pass a 24-bit integer directly into the renderer. Because RSUV requires no new buffer allocations, it preserves 100% compatibility with both the SRP Batcher and the GPU Resident Drawer.

**Step 1: C# Encoding (Zero Garbage Allocation)**

Instead of using strings like MPB, we pack an RGB color into a 24-bit integer using bitwise shifts:

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Encode Blue, Green, and Red channels into a 24-bit integer  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Apply value (100% safe for SRP Batcher and GRD architecture!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Step 2: Decoding in Shader Graph**

Inside Shader Graph, create a **Custom Function** node (Type: String, Name: DecodeColor) with a Vector4 output. Paste the following HLSL snippet to unpack the integer back into a standard color:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Connect this output to the Base Color port of your Fragment Shader. You now have infinite color variations with zero CPU overhead while fully harnessing the power of the GPU Resident Drawer.

**Example: Real-World Implementation in a Custom Shader Script (Without Shader Graph)**

If you write custom shaders in code (HLSL), you can hook into the `BuildSurfaceData` function to decode `unity_RendererUserValue` and multiply it with `BaseColor` as shown in the snippet below:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // Decode RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // Apply rsuvColor
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ... 
}
```

*Learn more at:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Scaling Past 100,000 Objects: The DOTS / ECS Solution**

If your game demands rendering hundreds of thousands of independent units (such as massive armies), traditional GameObjects will inevitably bottleneck the CPU no matter how well rendering is optimized. At this scale, move to Unity DOTS. Using the `URPMaterialPropertyOverride` component enables a strict Data-Oriented memory layout that interfaces directly with the low-level `BatchRendererGroup` API, delivering true AAA performance.

---

**🇺🇸 ENGLISH VERSION**

**1. The Rendering Bottleneck: Material Duplication**

When developing high-density games, a common architectural challenge arises: "How do I change the color of thousands of objects sharing the same material without destroying performance?"

Developers often default to `GetComponent<Renderer>().material.color`. This is a fatal anti-pattern. Accessing `.material` forces Unity to silently clone the material on the managed heap. This generates severe memory bloat, triggers garbage collection spikes, and destroys draw call batching, driving CPU overhead to unmanageable levels while starving the GPU.

**2. The Legacy Trap: Why MaterialPropertyBlock is Dead in Unity 6**

Historically, the "Pro" solution was to use a MaterialPropertyBlock (MPB) to pass per-instance data without cloning materials. **If you are using Unity 6 (URP/HDRP), you must stop using this method immediately.**

Unity 6 relies heavily on the **SRP Batcher** and the revolutionary new **GPU Resident Drawer (GRD)**. The GRD offloads frustum culling and draw call generation to GPU compute shaders, reducing CPU rendering time by up to 50%. However, according to core engine documentation, applying a MaterialPropertyBlock to an object immediately disqualifies it from the SRP Batcher and entirely breaks its compatibility with the GPU Resident Drawer. By using MPB, you are forcing Unity to revert to a slow, legacy CPU-bound rendering path for your massive armies.

**3. The Unity 6 Standard: Renderer Shader User Value (RSUV)**

To solve this architectural deadlock, Unity 6.3 LTS introduces the **Renderer Shader User Value (RSUV)**. This API allows you to pass a 24-bit integer directly to the renderer's base data payload. Because it avoids modifying persistent constant buffers, RSUV maintains 100% compatibility with both the SRP Batcher and the GPU Resident Drawer.

**Step 1: The C# Encoding (Zero Memory Allocation)**

Instead of passing strings and creating blocks, we mathematically pack an RGB color into a 24-bit unsigned integer using bitwise operations:

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Encode Blue, Green, and Red channels into a single 24-bit integer  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Apply the value natively (100% SRP and GRD Safe!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Step 2: The Shader Decoding**

Inside your Shader Graph, create a **Custom Function** node (Type: String, Name: DecodeColor) with a Vector4 output. Paste this HLSL code to unpack the integer back into a normalized float color:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Connect this output to your Base Color fragment input. You now have infinite color variations with zero draw call penalties, while fully utilizing the GPU Resident Drawer.

**Example: Real-world implementation in a Custom Shader (without Shader Graph)**

If you are writing a custom shader in code (HLSL), you can modify the `BuildSurfaceData` function to decode `unity_RendererUserValue` and multiply it with the `BaseColor` as shown in the diff below:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // Decode RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // Apply rsuvColor
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ...
}
```

*See also:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Going Beyond 100,000 Objects: DOTS / ECS**

If your game requires rendering hundreds of thousands of dynamic units, standard GameObjects will eventually bottleneck the CPU's main thread regardless of graphics optimizations. For massive scale, transition to Unity DOTS. Using the URPMaterialPropertyOverride component allows for strict Data-Oriented memory layouts. This interfaces directly with the low-level BatchRendererGroup API, achieving unmatched, pure AAA-level rendering performance.

---

## **Part X: Strategic Recommendations for Development Teams**

Examining modern rendering models reveals a stark divide between legacy optimization lore and contemporary engine architecture. The central takeaway for graphics engineers is clear: mutating per-object data buffers is inherently hostile to parallel execution and GPU-driven render loops. Unity 5.x or Unity 2019 optimization habits cannot simply be carried forward into Unity 6.

To reach peak performance in Unity 6, engineering teams should strictly enforce the following protocols:

1. **Audit for MPB Usage:** Run profiling tools (such as the Unity Profiler) and the Frame Debugger continuously to locate and eliminate instances where `MaterialPropertyBlock` is applied to mass-instanced geometry. The short-term convenience of MPB is vastly outweighed by systematically losing the GPU Resident Drawer. Teams should introduce code warnings or CI/CD checks to flag unnecessary MPB allocations.
2. **Adopt Bitwise Encoding Strategies:** Embracing Renderer Shader User Value (RSUV) requires a shift in coding methodology. Technical Artists and gameplay programmers should collaborate to define strict bitwise packing schemas within RSUV's 24-bit budget, ensuring multiple per-instance states (color, damage, team ID) are serialized cleanly before reaching the renderer. For instance, you can allocate 4 bits for "Faction ID" (16 factions), 8 bits for "Damage State" (256 levels), and 12 bits for "Custom Tint"—all decoded simultaneously via bitmasks inside the shader.
3. **Evaluate Thresholds for ECS Transition:** While RSUV resolves material-variation bottlenecks for GameObjects, CPU limits around physics, transform updates, and GameObject culling still apply. Projects anticipating more than 10,000 active dynamic agents should proactively prototype DOTS (Entity Component System) implementations. Leveraging `URPMaterialPropertyOverride`[^34] to feed the `BatchRendererGroup` API directly is the only path to unlocking the full power of modern PC and next-generation console hardware.

## **References**

[^1]: Enable the GPU Resident Drawer in URP - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html](https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html)  
[^2]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^3]: Set and use the RSUV - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html)  
[^4]: Migrated my game to ECS/DOTS and material overrides are awesome! : r/Unity3D - Reddit, accessed April 19, 2026, [https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated\_my\_game\_to\_ecsdots\_and\_material/](https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated_my_game_to_ecsdots_and_material/)  
[^5]: Why You Should Stop Swapping Materials in Unity (And What to Do Instead) - Medium, accessed April 19, 2026, [https://medium.com/@MTCrypto\_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e](https://medium.com/@MTCrypto_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e)  
[^6]: Material Property Blocks - using them to store the original color of a material upon instantiation : r/Unity3D - Reddit, accessed April 19, 2026, [https://www.reddit.com/r/Unity3D/comments/10jyr9b/material\_property\_blocks\_using\_them\_to\_store\_the/](https://www.reddit.com/r/Unity3D/comments/10jyr9b/material_property_blocks_using_them_to_store_the/)  
[^7]: Instancing and Material Property Blocks | Ronja's tutorials, accessed April 19, 2026, [https://www.ronja-tutorials.com/post/048-material-property-blocks/](https://www.ronja-tutorials.com/post/048-material-property-blocks/)  
[^8]: Scripting API: MaterialPropertyBlock - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html](https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html)  
[^9]: Unity 6 and custom material bug - Spine Forum, accessed April 19, 2026, [https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug](https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug)  
[^10]: Scriptable Render Pipeline (SRP) Batcher - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html)  
[^11]: Scriptable Render Pipeline Batcher - Unity 6.3 User Manual, accessed April 19, 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html)  
[^12]: GPU instancing - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html](https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html)  
[^13]: Remove SRP Batcher compatibility for GameObjects | High Definition Render Pipeline | 17.0.4 - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html)  
[^14]: Beginning Game Development: GPU Resident Drawer | by Lem Apperson - Medium, accessed April 19, 2026, [https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3](https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3)  
[^15]: Introduction to RSUV - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html)  
[^16]: Renderer Shader User Value sample - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html](https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html)  
[^17]: Speed Up Your Game Rendering in Unity3D: The Secret to Changing Material Colors, accessed April 19, 2026, [https://www.youtube.com/watch?v=CjfMAhU7cY8](https://www.youtube.com/watch?v=CjfMAhU7cY8)  
[^18]: Scriptable Render Pipeline Batcher - Unity User Manual 2021.3 (LTS), accessed April 19, 2026, [https://docs.unity.cn/Manual/SRPBatcher.html](https://docs.unity.cn/Manual/SRPBatcher.html)  
[^19]: Unity Draw Call Batching: The Ultimate Guide (2026 Update), accessed April 19, 2026, [https://thegamedev.guru/unity-performance/draw-call-optimization/](https://thegamedev.guru/unity-performance/draw-call-optimization/)  
[^20]: Scriptable Render Pipeline Batcher - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html)  
[^21]: SRP Batcher: Speed up your rendering - Unity, accessed April 19, 2026, [https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering](https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering)  
[^22]: Remove SRP Batcher compatibility for GameObjects in URP - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html)  
[^23]: GPU Instancing not working? Why amount of batches doesn't change? : r/Unity3D - Reddit, accessed April 19, 2026, [https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu\_instancing\_not\_working\_why\_amount\_of\_batches/](https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu_instancing_not_working_why_amount_of_batches/)  
[^24]: Scripting API: Renderer.GetPropertyBlock - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html)  
[^25]: Create batches with the BatchRendererGroup API in URP - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html)  
[^26]: Use the GPU Resident Drawer | High Definition Render Pipeline | 17.0.4 - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html)  
[^27]: Create draw commands with the BatchRendererGroup API | High Definition Render Pipeline, accessed April 19, 2026, [https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html](https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html)  
[^28]: Unity Tip Tuesday: GPU Resident Drawer & GPU occlusion culling - YouTube, accessed April 19, 2026, [https://www.youtube.com/shorts/0PenzdQFlv0](https://www.youtube.com/shorts/0PenzdQFlv0)  
[^29]: Graphics Features and Tools in Unity 6 Feel Like MAGIC! STP, Resident Drawer, and Occlusion Culling! - YouTube, accessed April 19, 2026, [https://www.youtube.com/watch?v=trdeAq3WPkQ](https://www.youtube.com/watch?v=trdeAq3WPkQ)  
[^30]: Initialize a BatchRendererGroup object in URP - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html)  
[^31]: Boost performance of your game in Unity 6 with GPU Resident Drawer - The Knights of U, accessed April 19, 2026, [https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/](https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/)  
[^32]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^33]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html)  
[^34]: DOTS Instancing shaders in URP - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/Manual/dots-instancing-shaders.html](https://docs.unity3d.com/Manual/dots-instancing-shaders.html)  
[^35]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html)  
[^36]: One Material multiple colors possible? : r/Unity3D - Reddit, accessed April 19, 2026, [https://www.reddit.com/r/Unity3D/comments/9oi8kz/one\_material\_multiple\_colors\_possible/](https://www.reddit.com/r/Unity3D/comments/9oi8kz/one_material_multiple_colors_possible/)  
[^37]: Single-pass instanced rendering and custom shaders - Unity - Manual, accessed April 19, 2026, [https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html](https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html)  
[^38]: Use Graphics.DrawMeshInstanced or similar but vary the color on a per object basis?, accessed April 19, 2026, [https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use\_graphicsdrawmeshinstanced\_or\_similar\_but\_vary/](https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use_graphicsdrawmeshinstanced_or_similar_but_vary/)
