---
title: "Deep Technical Report: Resolving Unity GUID and YAML Serialization Conflicts When Forking Features in GilongWorld"
date: 2026-06-16 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, guid, serialization, assetdatabase, git]
description: A deep dive into Unity's GUID metadata and YAML serialization architecture, and how Long Gil Studio solved broken cross-references when forking features in GilongWorld.
lang: en
translation_id: gilongworld-unity-guid-serialization
---

## **System Context and the Structural Crisis at Long Gil Studio**

Over the development lifecycle of a large-scale interactive title, refactoring system architecture to accommodate new design requirements is an unavoidable challenge. **GilongWorld**, developed on Unity by the engineering team at Long Gil Studio, encountered a severe technical roadblock while scaling its codebase. The core problem stemmed from a practical operational requirement: the team needed to split an existing feature into two completely independent development branches to support distinct custom gameplay mechanics. This requirement meant the new feature branch had to inherit the full logic foundation, data structures, and visual assets of the original feature, while remaining strictly isolated so that any modification on the new branch would never trigger a ripple effect that breaks the original feature.

Because both features shared a common origin, the initial directory structure contained a large set of physically duplicated files—ranging from C# scripts, Prefabs, Materials, and Textures to Animation configuration assets. Long Gil Studio's primary objective was to achieve complete separation between these two asset trees. However, performing a standard duplicate operation inside the Unity Editor immediately caused a severe reference-breaking failure: the entire internal link graph of the newly duplicated assets (Prefabs and `ScriptableObject` assets) remained tightly bound to the original branch's C# scripts and source assets. This incident triggered a prolonged engineering investigation to restore data structural integrity. Long Gil Studio's journey to a solution was not merely routine debugging—it became a deep study into the true nature of Unity's serialization pipeline and `AssetDatabase` architecture.

## **Dissecting Unity's Serialization Architecture and Identifiers**

To understand why standard folder duplication causes broken and overlapping references, we must examine Unity Engine's asset management architecture at a foundational level. Unlike operating system file managers that locate documents by physical file path or filename, Unity operates an internal database designed to be immune to changes in physical storage location[^1].

### **The YAML Serialization Language and Objective Data Structure**

Unity Engine employs a high-performance serialization library implementing a subset of the YAML (YAML Ain't Markup Language) specification to store the data state of most authoring assets, including Scenes, Prefabs, Materials, and `ScriptableObject` assets[^2]. This architectural choice provides a transparent, human-readable text format that lets engineers track changes through a Version Control System (VCS) like Git and resolve data merge conflicts effectively[^3].

When inspecting any Prefab or Scene file in a plain-text editor, the YAML structure exposes an intricate network of object declarations and reference hyperlinks. Every object inside a YAML file is defined by a special identifier header formatted as `!u!{CLASS ID} &{FILE ID}`[^2]. These two components form the foundation of every dependency graph in Unity.

The **Class ID** is an integer specifying the low-level class an object belongs to, hardcoded inside Unity Engine's C++ source code[^2]. For example, `1` represents `GameObject`, `4` represents `Transform`, and `114` represents `MonoBehaviour` (user-defined custom C# scripts)[^2]. Meanwhile, the **File ID** (local file identifier) is a numeric value representing that specific object's identifier within the boundaries of a single file[^2]. File IDs resolve internal cross-references between objects residing in the same file—such as when a `Transform` component references its parent `GameObject`[^2]. For 3D model files or Unity-managed internal assets, File IDs are typically large, unpredictable random numbers generated and assigned when Unity first discovers and parses the file[^4]. For C# scripts (`.cs`) compiled inside library binaries (DLLs), Unity applies a more deterministic approach: the engine computes the local File ID using an MD4 cryptographic hash. Specifically, the algorithm extracts the first four bytes of the MD4 hash of the string `"s\0\0\0" + t.Namespace + t.Name` to produce a 32-bit little-endian integer[^4].

The table below provides a detailed comparison of the three identifier tiers that structure Unity's asset graph:

| Identifier Type | Technical Scope | Origin & Generation Algorithm | Core Role in System Architecture |
| :--- | :--- | :--- | :--- |
| **Class ID** | Global (Deeply embedded in the Engine) | Statically predefined in Unity's C++ source code. | Identifies native component types (`GameObject`, `Transform`, `Camera`, `Collider`, etc.)[^2]. |
| **File ID** | Local (Scoped to a single YAML file) | Random integer for graphical assets; MD4 hash for C# Scripts/DLLs[^4]. | Identifies sub-elements inside a Prefab or Scene. Resolves internal object-graph references[^5]. |
| **GUID** | Global (Across the entire Project) | Universally Unique Identifier UUID v4 (32-character hexadecimal string without hyphens)[^7]. | Identifies physical asset files. The sole key for resolving cross-references between separate files across the project[^1]. |

### **The Role of Metadata (`.meta`) Files and Global GUIDs**

Real complexity emerges when the system must handle cross-file references between independent assets. When referencing objects outside a single YAML file, the local File ID becomes meaningless on its own because it can naturally collide across thousands of separate files in a project[^2]. To maintain a sound relational database, Unity requires a dedicated auxiliary identifier capable of pinpointing any target file globally across the project. That is the domain of the **Global Unique Identifier (GUID)**.

Whenever the Unity Editor detects a new asset entering the project—via import, creation, or duplication—it automatically generates an accompanying metadata file bearing the original filename plus the `.meta` extension[^1]. The `.meta` file acts as the asset's identity card, storing import configuration (Import Settings) and, most critically, its `guid` property. This property is a unique 32-character hexadecimal hash string, such as `8c9c1e4a88e724a60a9ac0b0bb6a52c31`.

When a game object needs to reference another asset, the YAML serialization syntax combines both identifiers using a specific inline mapping: `{fileID: X, guid: Y, type: Z}`[^2]. In this structure, `fileID` locates the specific sub-object inside the target file, `guid` provides the 32-character key pointing directly to the target asset's `.meta` file, and `type` specifies the lookup strategy for `AssetDatabase`[^4]. Typically, `type: 2` is used for external non-script assets, whereas `type: 3` generally represents internal source script assets[^4].

Because of this decoupled storage mechanism, engineers can freely rename files and move them across directories at the OS level without breaking the project's logical graph. Unity's `AssetDatabase` quietly scans `.meta` files to maintain a GUID lookup table rather than relying on fragile relative file paths[^1]. However, this absolute reliance on GUIDs was also the exact root cause of Long Gil Studio's predicament.

## **Chronicle of Troubleshooting: Long Gil Studio's Search for a Solution**

Splitting a single feature module into two independent entities initially sounded like a straightforward file-management task. Yet as soon as the team at Long Gil Studio began executing it, they ran straight into a web of data-integrity issues across Unity's asset graph. This journey unfolded as a sequence of trial-and-error attempts, progressing from intuitive Editor actions to low-level systems engineering.

### **Phase 1: The Futility of Renaming and Direct Duplication**

The engineers' first instinct was to duplicate `Feature_A` directly into `Feature_B` inside the Unity Editor Project window, aiming to produce a separate physical copy of the data. However, an immediate "cross-reference back to the old source" phenomenon appeared[^10].

When duplicating inside the Editor, Unity enforces the rule that two assets cannot share the same GUID within a single project. The engine automatically intervenes by generating brand-new `.meta` files with fresh random GUIDs for every asset inside `Feature_B`[^1]. While this preserves database validity, it creates a logical catastrophe: Unity neither rewrites nor re-resolves the internal YAML text inside the newly duplicated Prefabs or `ScriptableObject` assets. Consequently, inside `Feature_B/UI_Window.prefab`, the YAML block referencing its controlling script remains statically locked to `{fileID: 11500000, guid: [GUID_OF_OLD_FILE_IN_FEATURE_A]}`[^10].

As a result, even though a new folder existed, every UI component, Prefab, and serialized field on the new branch remained physically wired to the original branch's `.cs` scripts. Any parameter tweak made on the new Prefab in the Inspector risked colliding with or mutating the legacy controller logic, introducing severe regression risk. Long Gil Studio attempted to resolve this by renaming the scripts and assets in the new folder. However, renaming only changes the display string and physical filename on disk—it leaves the GUID inside the `.meta` file and all YAML reference strings untouched[^5]. Because Unity's database is indifferent to filenames, renaming was immediately discarded as ineffective for decoupling references.

### **Phase 2: The Crisis of Fresh Recreation and Manual Re-linking**

After renaming failed, the team pivoted to a manual and costly fallback: creating fresh assets from scratch and manually rewiring the entire dependency graph. Programmers had to open every newly created Prefab or `ScriptableObject`, remove components pointing to the old branch, attach the newly created components, and manually drag and drop every sprite, material, and audio reference back into the Inspector.

For a small prototype, that approach might be tolerable. For a complex production feature in GilongWorld—spanning dozens or hundreds of interconnected files built with Nested Prefabs—the dependency graph quickly became too massive to manage manually. Re-linking thousands of cross-references across UI views, `ScriptableObject` configs, and Animation Controllers consumed weeks of engineering time.

The greatest flaw in this approach was human error[^1]. Engineers constantly faced overlapping links, missed references, or accidentally bound identically named scripts from the wrong namespace or directory. A single missed reference buried among thousands of serialized properties could pass static compilation undetected, only to trigger fatal `NullReferenceException` failures at runtime. Exhausted schedules and rising defect risk forced Long Gil Studio to pursue automation at a deeper architectural layer.

### **Phase 3: OS-Level Cloning Interference**

Another proposal suggested copying the directory through the operating system's file manager (Windows Explorer or macOS Finder) instead of the Unity Editor, attempting to "trick" Unity by cloning the physical files. When copying externally, both the asset files and their `.meta` files—along with their GUIDs—are duplicated verbatim[^3].

Upon returning to the Unity Editor, however, a new failure emerged: **GUID Collision**. `AssetDatabase` detected two distinct files sharing the exact same GUID. Unity's internal conflict resolution typically results in one of two outcomes: either it refuses to load one of the assets, or it silently overwrites one file's GUID with a newly generated random string without notifying the user—and crucially, without updating any YAML references[^9]. Field reports confirm that when multiple asset trees share identical structures, Unity cannot distinguish between assets bearing the same GUID regardless of differing filenames, causing references to bind arbitrarily to the wrong asset[^1]. This method proved even more hazardous than manual re-linking.

## **The Technical Breakthrough: Lossless In-Place GUID Regeneration**

Having hit a dead end with standard workflows, Long Gil Studio recognized that the core challenge was not file duplication, but synchronized data remapping. The team needed a deterministic mechanism to batch-update every GUID reference across the entire YAML graph of the newly forked directory consistently. Through researching open-source Unity engineering tools, the team discovered and successfully implemented **local GUID Regeneration**[^1].

This technique intervenes directly at the project's plain-text source layer. Instead of letting the Unity Editor handle duplication passively with default behavior, a custom C# Editor tool scans the target folder tree. It reads every `.meta` file in the new feature branch, generates a brand-new set of GUIDs, builds an in-memory mapping table between old and new GUIDs, and traverses all configuration files to rewrite every matching reference string accurately.

### **Deep Dive into Long Gil Studio's GUID Regeneration Algorithm**

Building on proven open-source implementations (such as scripts by jeffjadulco, ZimM-LostPolygon, and rrazgriz[^1]), the engineering team constructed a strict multi-stage execution pipeline.

#### **Step 1: Entering the Asset Editing State**

Modifying thousands of text files in rapid succession would trigger Unity's automatic asset refresh and recompilation loop mid-flight, freezing the Editor or exhausting memory. Therefore, the algorithm begins by suspending Unity's file-system watcher via `AssetDatabase.StartAssetEditing()`[^7]. This places `AssetDatabase` into a paused batch state, allowing bulk disk I/O operations to proceed unobstructed. Simultaneously, an extension whitelist (`kDefaultFileExtensions`) is initialized to restrict parsing to relevant formats: `*.meta`, `*.mat`, `*.anim`, `*.prefab`, `*.unity`, `*.asset`, `*.guiskin`, `*.fontsettings`, and `*.controller`[^7].

#### **Step 2: Recursive Traversal and Target GUID Extraction**

The system defines its blast radius by gathering the GUIDs currently selected by the engineer in the Project window (`Selection.assetGUIDs`). The algorithm recursively walks all subdirectories and maps each file path back to its physical GUID using `AssetDatabase.AssetPathToGUID(file)`. A subtle safeguard at this stage is explicitly excluding `.meta` files from direct selection filtering (`Path.GetExtension(...) != ".meta"`) so that `guidsToRegenerate` strictly tracks the original content assets[^8].

#### **Step 3: Parsing and Reference Graph Identification**

The most compute-intensive phase is the linear scan across all target text files. For each candidate file, the tool reads the full text content via `File.ReadAllText(filePath)`[^7]. Rather than using Regular Expressions (Regex)—which incur substantial overhead across large YAML payloads—the parser sequentially searches for the 6-character constant prefix `"guid: "`[^7].

Whenever a reference pattern is encountered, the algorithm extracts the exact 32 characters immediately following it. A validation gate `IsGuid(string text)` then runs a tight loop confirming that every character in the 32-character slice conforms strictly to hexadecimal rules (`'0'`–`'9'` and `'a'`–`'f'`)[^7]. This strict verification prevents the tool from accidentally corrupting arbitrary 32-character strings or cryptographic hashes embedded in scripts or graphics data.

#### **Step 4: Constructing the Dual Mapping Dictionaries**

To guarantee that rewriting never damages core Unity Engine assets or external shared dependencies, the tool constructs three critical data structures in RAM[^7]:

1. **The `ownGuids` Set (Internal Assets):** The algorithm reads the first GUID declared inside each `.meta` file and stores it in a `HashSet`. By Unity convention, the first GUID in a `.meta` file always identifies that asset itself. This set acts as a firewall distinguishing assets owned by the forked directory from external assets (such as Unity's built-in `Standard.mat`)[^7].
2. **The `guidOldToNewMap` Dictionary (Replacement Lookup):** For every unique internal GUID discovered, the system generates a brand-new UUID via `Guid.NewGuid().ToString("N")`[^7]. Version 4 UUID generation produces a 32-character hyphen-free string with a near-zero collision probability, ensuring strong data safety.
3. **The `guidsInFileMap` Dictionary (File-to-GUID Index):** A dictionary mapping each file path to the collection of old GUIDs referenced inside that file. This optimizes the write pass by instructing the tool exactly which files to open and which strings to replace.

#### **Step 5: Synchronized Overwrite and State Restoration**

In the final pass, the tool iterates through every file recorded in `guidsInFileMap`. A strict double-validation check is enforced: a candidate old GUID must exist in `ownGuids` **AND** must belong to the user-requested `guidsToRegenerate` set[^8]. This security rule forms the backbone of the solution, completely preventing accidental modification of Engine assets or unintended shared libraries.

Once validated, the string replacement `contents = contents.Replace("guid: " + oldGuid, "guid: " + newGuid)` executes[^7], and the updated text is written back to disk via `File.WriteAllText`. After all files are processed, `AssetDatabase.StopAssetEditing()` wakes Unity's asset tracker, followed by `AssetDatabase.Refresh()` to reindex and recompile the project under the newly isolated GUID graph[^7].

Through this pipeline, Long Gil Studio gained the ability to clone an entire feature system with 100% file-level independence. Engineers can modify Prefabs, refactor scripts, and tune serialized parameters in "Branch B" without causing a single ripple in "Branch A." Branch B's internal reference graph now communicates exclusively over its own isolated set of identifiers, fully satisfying the original feature-forking requirement with zero lingering reference defects.

## **Comprehensive Evaluation of Alternatives in the Unity Ecosystem**

While custom in-place GUID regeneration thoroughly solved Long Gil Studio's deep-customization requirement, the Unity ecosystem offers several built-in architectures aimed at managing asset variations and modular branching. To establish a complete architectural perspective, the team evaluated these alternatives to assess their fit and limitations for large-scale feature forks.

### **5.1 Inheritance-Based Reuse: Prefab Variants**

Introduced in Unity 2018.3, **Prefab Variants** marked a major step forward over traditional Prefabs for managing object variations[^17]. Rather than creating an independent copy, a Prefab Variant acts as an override layer linked directly to a Base Prefab[^17].

Using Variants, engineers can tweak serialized fields, swap materials, or add components, with those edits stored solely on the Variant as delta override metadata[^20]. Meanwhile, whenever core properties on the Base Prefab are updated, those changes automatically propagate down to every child Variant that has not overridden them[^22].

The comparison table below highlights the architectural differences between these two philosophies when applied to feature forking:

| Evaluation Criterion | GUID Regeneration (Deep Fork) | Prefab Variants (Relative Inheritance) |
| :--- | :--- | :--- |
| **Storage Nature** | Fully independent YAML data copy at the file level. | Stores delta overrides layered on top of a Base Prefab[^17]. |
| **Dependency Coupling** | Level 0 (Zero structural links remaining to the source). | High (Coupled to the node hierarchy of the Base Prefab)[^18]. |
| **Script Separation** | Allows diverging and rewriting two independent script sets. | Unsupported; Variants remain bound to the Base Prefab's scripts. |
| **Structural Flexibility** | Free to delete, add, or reorganize the entire Hierarchy. | Restricted; core GameObjects defined by the Base Prefab cannot be deleted[^22]. |
| **System Regression Risk** | Near zero due to total isolation. | High; fixes or edits to the Base Prefab can unexpectedly break Variant behavior[^18]. |

**Verdict for GilongWorld:** Although Prefab Variants excel at gameplay variations (such as creating a blue enemy derived from a red enemy with different health values)[^20], they fall completely short for feature forks requiring independent customization. Long Gil Studio needed to diverge the C# scripts themselves—something Variant architecture cannot support, because Variants only override public serialized fields rather than repointing components to a separate logic implementation[^18]. Tight coupling across hierarchy nodes makes Prefab Variants incompatible with the isolated modular design this task demanded.

### **5.2 Modular Package Architecture: Unity Package Manager (UPM) and Local Packages**

A macro-level strategy to minimize reference collisions is leveraging the **Unity Package Manager (UPM)** to build a multi-package architecture[^25]. This model encapsulates subsystems or features into discrete development packages configured via `package.json` and bounded at compile time by Assembly Definition (`.asmdef`) files[^26].

In a branching scenario, shared infrastructure can live in a Core Package while Feature A and Feature B operate as independent packages consuming shared APIs. Unity supports embedding a **Local Package** via filesystem symlinks or `file:` references, allowing source directories to reside on disk in separate Git repositories outside the main project's `Assets` folder[^27]. Under UPM, GUID collisions and local environment conflicts are governed by Unity's package resolver rather than relying solely on traditional `AssetDatabase` directory scans[^28].

However, adopting this architecture demands substantial upfront analysis and refactoring effort. It excels at isolating C# libraries and runtime systems, but proves far less agile when duplicating large clusters of YAML-heavy Prefabs and UI layouts. For an immediate production split like Long Gil Studio's, restructuring into UPM packages introduced operational overhead disproportionate to the immediate need.

### **5.3 Memory Bloat Risk: Addressables and Shared Assets**

Any deep manipulation of GUIDs requires systems engineers to evaluate downstream impacts on dynamic memory management and asset delivery—especially in projects using the **Addressable Asset System**. Addressables serves as Unity's modern asset management layer, replacing hard scene references with asynchronous loading via dynamic addresses[^30].

A documented architectural hazard arises when applying GUID regeneration blindly: if regeneration splits a large feature folder into two isolated trees, every asset inside that directory—including high-resolution Textures and audio clips—also receives a brand-new GUID[^30]. Even though two duplicated Texture files look identical on disk to the OS, the Addressables packing pipeline treats them as two completely distinct data entities because they carry different GUIDs[^13].

When a Content Build runs, Unity packs copy one into Feature A's AssetBundle and copy two into Feature B's AssetBundle. This duplication causes **memory bloat**, inflating game download sizes and wasting substantial runtime RAM[^13]. To prevent this, architects must establish a dedicated **Shared Resources** zone. Before executing GUID regeneration, all non-logic media assets (Textures, meshes, audio) should be moved outside the target fork directory. Keeping their `.meta` files untouched ensures that after duplication, both the original and forked branches point to the exact same shared GUIDs, preserving memory efficiency across AssetBundles.

## **Recommendations and Lessons Learned from GilongWorld**

Resolving the broken-reference crisis at Long Gil Studio was more than finding a clever Editor script—it demonstrated the critical importance of understanding the underlying protocols beneath Unity Engine's visual UI. The YAML data graph underpins every object interaction, and GUID metadata is the sole language keeping that graph intact[^1].

Intervening directly via **GUID Regeneration** dispelled the misconception that OS-level file operations can be applied safely to an object-oriented asset database like `AssetDatabase`[^1]. The five-step algorithmic pipeline—text scanning, identifier extraction, ownership firewalling, dual-dictionary mapping, and synchronized rewriting—achieved 100% reference accuracy and eliminated the fragile graph breaks that routinely derail manual workflows.

Based on this postmortem, architects working on large-scale Unity titles should enforce standardized safeguards before running complex duplication or branching operations. Maintaining clean version control backups prior to bulk disk rewrites is non-negotiable to prevent irreversible data loss[^7]. Likewise, engineers must remain vigilant against inadvertently changing C# script File IDs through namespace refactoring, which directly severs low-level bindings between serialized Prefabs and runtime scripts[^4].

Long Gil Studio's successful adoption of GUID regeneration not only saved GilongWorld from weeks of error-prone manual rewiring, but also established a resilient engineering foundation—enabling rapid feature branching and custom experimentation without compromising core structural stability.

---

## **References**

[^1]: GUID Regenerator (com.jeffjadulco.guidregenerator) | OpenUPM Unity Package, [https://openupm.com/packages/com.jeffjadulco.guidregenerator/](https://openupm.com/packages/com.jeffjadulco.guidregenerator/)  
[^2]: Understanding Unity's serialization language, YAML, [https://unity.com/blog/engine-platform/understanding-unitys-serialization-language-yaml](https://unity.com/blog/engine-platform/understanding-unitys-serialization-language-yaml)  
[^3]: How to move or copy a Unity project (without breaking it) - Game Dev Beginner, [https://gamedevbeginner.com/how-to-move-or-copy-a-unity-project-without-breaking-it/](https://gamedevbeginner.com/how-to-move-or-copy-a-unity-project-without-breaking-it/)  
[^4]: Unity fileID and GUID - Unity Discussions, [https://discussions.unity.com/t/unity-fileid-and-guid/837621](https://discussions.unity.com/t/unity-fileid-and-guid/837621)  
[^5]: Question about m_Script in YAML Unity prefab format, [https://discussions.unity.com/t/question-about-m_script-in-yaml-unity-prefab-format/469197](https://discussions.unity.com/t/question-about-m_script-in-yaml-unity-prefab-format/469197)  
[^6]: YAML fileID hash function for DLL scripts - Unity Discussions, [https://discussions.unity.com/t/yaml-fileid-hash-function-for-dll-scripts/541112](https://discussions.unity.com/t/yaml-fileid-hash-function-for-dll-scripts/541112)  
[^7]: Unity asset GUIDs regenerator - GitHub Gist, [https://gist.github.com/ZimM-LostPolygon/7e2f8a3e5a1be183ac19](https://gist.github.com/ZimM-LostPolygon/7e2f8a3e5a1be183ac19)  
[^8]: Generate new GUIDs for Unity editor assets in-place. Tested working on 2019.4.31f1. Use at your peril - GitHub Gist, [https://gist.github.com/rrazgriz/1a5ab38f47a473c3272e1207bab6073f](https://gist.github.com/rrazgriz/1a5ab38f47a473c3272e1207bab6073f)  
[^9]: What is Unity GUID — How to Get & Change GUID — 2026 - Makaka Games, [https://makaka.org/unity-tutorials/guid](https://makaka.org/unity-tutorials/guid)  
[^10]: How can you duplicat folders and not share old dependencies? : r/Unity3D - Reddit, [https://www.reddit.com/r/Unity3D/comments/2jn4wk/how_can_you_duplicat_folders_and_not_share_old/](https://www.reddit.com/r/Unity3D/comments/2jn4wk/how_can_you_duplicat_folders_and_not_share_old/)  
[^11]: How can you duplicat folders and not share old dependencies? - Unity Discussions, [https://discussions.unity.com/t/how-can-you-duplicat-folders-and-not-share-old-dependencies/119815](https://discussions.unity.com/t/how-can-you-duplicat-folders-and-not-share-old-dependencies/119815)  
[^12]: jeffjadulco/unity-guid-regenerator: :id - GitHub, [https://github.com/jeffjadulco/unity-guid-regenerator](https://github.com/jeffjadulco/unity-guid-regenerator)  
[^13]: Resources folder and asset loading etiquette - Unity Discussions, [https://discussions.unity.com/t/resources-folder-and-asset-loading-etiquette/593210](https://discussions.unity.com/t/resources-folder-and-asset-loading-etiquette/593210)  
[^14]: How to make references point to the imported asset with new GUID? - Unity Discussions, [https://discussions.unity.com/t/how-to-make-references-point-to-the-imported-asset-with-new-guid/840444](https://discussions.unity.com/t/how-to-make-references-point-to-the-imported-asset-with-new-guid/840444)  
[^15]: I made a tool to regenerate GUID for Unity assets : r/Unity3D, [https://www.reddit.com/r/Unity3D/comments/gex8q5/i_made_a_tool_to_regenerate_guid_for_unity_assets/](https://www.reddit.com/r/Unity3D/comments/gex8q5/i_made_a_tool_to_regenerate_guid_for_unity_assets/)  
[^16]: Sudden "Assembly has duplicate references" on ALL imported assets - Unity Discussions, [https://discussions.unity.com/t/sudden-assembly-has-duplicate-references-on-all-imported-assets/1710510](https://discussions.unity.com/t/sudden-assembly-has-duplicate-references-on-all-imported-assets/1710510)  
[^17]: Create variations of prefabs - Unity - Manual, [https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabVariants.html](https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabVariants.html)  
[^18]: What is the difference between prefab(original) and variant prefab? - Stack Overflow, [https://stackoverflow.com/questions/58299669/what-is-the-difference-between-prefaboriginal-and-variant-prefab](https://stackoverflow.com/questions/58299669/what-is-the-difference-between-prefaboriginal-and-variant-prefab)  
[^19]: Ultimate Guide on Nested Prefab Workflows in Unity | Visual Design Cafe, [https://visualdesigncafe.com/learn/nested-prefabs](https://visualdesigncafe.com/learn/nested-prefabs)  
[^20]: Can someone explain the use case for Prefab variants - Unity Engine, [https://discussions.unity.com/t/can-someone-explain-the-use-case-for-prefab-variants/715072](https://discussions.unity.com/t/can-someone-explain-the-use-case-for-prefab-variants/715072)  
[^21]: Override prefab instances - Unity - Manual, [https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabInstanceOverrides.html](https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabInstanceOverrides.html)  
[^22]: Unity Tips | Part 6 - Prefabs - Daniel Ilett, [https://danielilett.com/2020-05-16-unity-tips-6-prefabs/](https://danielilett.com/2020-05-16-unity-tips-6-prefabs/)  
[^23]: What's the incentive on using prefab variants compared to just duplicating the original prefab? : r/Unity3D - Reddit, [https://www.reddit.com/r/Unity3D/comments/p2g10m/whats_the_incentive_on_using_prefab_variants/](https://www.reddit.com/r/Unity3D/comments/p2g10m/whats_the_incentive_on_using_prefab_variants/)  
[^24]: Is it better to make multiple prefabs or a single configurable prefab? : r/unity - Reddit, [https://www.reddit.com/r/unity/comments/1iu88js/is_it_better_to_make_multiple_prefabs_or_a_single/](https://www.reddit.com/r/unity/comments/1iu88js/is_it_better_to_make_multiple_prefabs_or_a_single/)  
[^25]: Package Development | 0.5.3-exp.1 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.upm.develop@0.5/manual/index.html](https://docs.unity3d.com/Packages/com.unity.upm.develop@0.5/manual/index.html)  
[^26]: Package development workflow - Unity - Manual, [https://docs.unity3d.com/6000.4/Documentation/Manual/CustomPackages.html](https://docs.unity3d.com/6000.4/Documentation/Manual/CustomPackages.html)  
[^27]: Switching between Local and Remote packages in Unity - Jakub Slaby, [https://www.jakubslaby.com/switching-between-local-and-remote-packages-in-unity/](https://www.jakubslaby.com/switching-between-local-and-remote-packages-in-unity/)  
[^28]: Confusion About How to Create a Custom Package - Unity Discussions, [https://discussions.unity.com/t/confusion-about-how-to-create-a-custom-package/739817](https://discussions.unity.com/t/confusion-about-how-to-create-a-custom-package/739817)  
[^29]: Best practices for parallel application + package development workflow - Unity Discussions, [https://discussions.unity.com/t/best-practices-for-parallel-application-package-development-workflow/900302](https://discussions.unity.com/t/best-practices-for-parallel-application-package-development-workflow/900302)  
[^30]: Asset dependencies overview | Addressables | 2.2.2 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@2.2//manual/AssetDependencies.html](https://docs.unity3d.com/Packages/com.unity.addressables@2.2//manual/AssetDependencies.html)  
[^31]: How to handle Addressable duplication for hybrid Scene Objects/Asset reference patterns, [https://discussions.unity.com/t/how-to-handle-addressable-duplication-for-hybrid-scene-objects-asset-reference-patterns/1704264](https://discussions.unity.com/t/how-to-handle-addressable-duplication-for-hybrid-scene-objects-asset-reference-patterns/1704264)
