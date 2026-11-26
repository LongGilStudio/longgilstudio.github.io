---
title: "Architecture de rendu dans Unity 6 : abandonner MPB pour optimiser les Materials en profondeur"
date: 2026-04-19 12:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, rendering, optimization, shaders, dots, longgilstudio]
description: "Analyse complète du changement architectural de MaterialPropertyBlock vers RSUV et le GPU Resident Drawer pour atteindre des performances AAA dans Unity 6."
lang: fr
translation_id: unity6-material-rsuv-grd
math: true
---

## **Résumé exécutif (Executive Summary)**

La transition vers Unity 6 marque un changement architectural fondamental dans la manière dont les pipelines de rendu (render pipelines) traitent la géométrie instanciée (instanced geometry) à grand volume. Dans l'histoire du développement de jeux vidéo, l'optimisation de nombreux objets partageant un même material mais nécessitant des variations de propriétés distinctes (comme des variations de couleur — color tints) reposait généralement sur l'interface de programmation d'applications (API) `MaterialPropertyBlock` (MPB) combinée au système standard de GPU Instancing. Toutefois, une analyse approfondie de l'Universal Render Pipeline (URP) et du High Definition Render Pipeline (HDRP) dans Unity 6 révèle que cette approche héritée (legacy) n'est plus la voie optimale et que, dans de nombreux cas, elle provoque une grave dégradation des performances.

L'évaluation du brouillon technique fourni par l'utilisateur pour « Long Gil Studio DevLog » met en évidence un mélange entre une théorie d'optimisation héritée, valable dans les anciennes versions, et une incompréhension critique des fonctionnalités de rendu modernes de Unity 6. Plus précisément, la recommandation d'utiliser `MaterialPropertyBlock` entre en conflit direct avec la nouvelle technologie **GPU Resident Drawer (GRD)** de Unity 6 et l'API **BatchRendererGroup (BRG)** sous-jacente.[^1] Pour atteindre un débit de rendu maximal, les développeurs doivent impérativement adopter **Renderer Shader User Value (RSUV)** ou migrer entièrement vers le **Data-Oriented Technology Stack (DOTS)**.[^3]

Ce rapport de recherche fournit une analyse technique approfondie des goulots d'étranglement du rendu, des mécanismes de fonctionnement du Scriptable Render Pipeline (SRP) Batcher, des conséquences systémiques de la duplication de materials, ainsi que des modèles modernes indispensables pour obtenir des performances de rendu de niveau AAA dans Unity 6. De plus, il propose un article technique corrigé et rédigé de manière professionnelle pour publication sur le Long Gil Studio DevLog.

## **Partie I : Évaluation technique du brouillon original de Long Gil Studio**

Le texte du brouillon initial expose un problème de rendu très précis : optimiser une Scène contenant d'innombrables objets identiques partageant un seul et même material, mais exigeant des modifications de couleur distinctes par objet. Le brouillon identifie correctement les anti-patterns (modèles de conception erronés), mais prescrit une solution qui dégrade les performances dans le contexte architectural de Unity 6.

### **Les points exacts du brouillon original**

1. **La pénalité de la duplication de Material (Material Duplication) :** Le brouillon indique à juste titre que la création d'instances de material distinctes pour chaque objet (par exemple via `GetComponent<Renderer>().material.color`) entraîne un gonflement de la mémoire (memory bloat) et détruit totalement le regroupement des appels de dessin (draw call batching).[^5] L'accès à la propriété `.material` force le moteur Unity à cloner silencieusement le material, privant définitivement le SRP Batcher ou le GPU Instancing de la capacité de regrouper ces objets dans un seul appel `SetPass`.[^5]
2. **Mécanisme de `MaterialPropertyBlock` (MPB) :** Le brouillon identifie correctement que MPB agit comme un tampon de surcharge de données (data override buffer), permettant au renderer de transmettre des propriétés par instance (per-instance) au GPU sans créer de nouveau clone de material.[^7]
3. **Propriétés par chaîne de caractères (String) vs identifiants entiers (Integer IDs) :** Le brouillon souligne pertinemment la latence de l'unité centrale (CPU) engendrée par l'utilisation de chaînes de caractères pour rechercher les propriétés de shader, en préconisant la mise en cache d'identifiants entiers via `Shader.PropertyToID()` pour optimiser les boucles.[^7]

### **Erreurs critiques et paradigmes obsolètes**

1. **MPB présenté comme un « standard AAA » dans Unity 6 :** La faille la plus importante du brouillon original réside dans l'affirmation que MPB représente la solution « AAA » optimale pour Unity 6. Bien que MPB fût la norme dans l'ancien Built-In Render Pipeline, il agit comme un facteur destructeur dans les architectures SRP modernes.[^8] L'application d'un MPB à un GameObject exclut immédiatement cet objet du flux du SRP Batcher.[^10]
2. **Dépendance au GPU Instancing hérité :** Le brouillon reconnaît que MPB casse le SRP Batcher et suggère de se rabattre sur le GPU Instancing traditionnel comme solution de secours. Bien que cela soit techniquement réalisable en brisant manuellement la compatibilité SRP et en activant l'Instancing, cela force le moteur à contourner l'architecture SRP hautement optimisée.[^12]
3. **Omission du GPU Resident Drawer (GRD) :** Unity 6 introduit le GPU Resident Drawer, un système qui délègue la génération des draw calls aux compute shaders, réduisant la charge CPU jusqu'à 50 %.[^14] La présence d'un `MaterialPropertyBlock` interdit strictement à un GameObject de participer au GRD.[^1] Recommander MPB dans Unity 6 empêche fondamentalement les projets d'exploiter la fonctionnalité d'optimisation la plus puissante du moteur.
4. **Absence du Renderer Shader User Value (RSUV) :** Introduit dans Unity 6.3 LTS, RSUV est le remplaçant architectural direct de MPB pour gérer des variations simples par objet.[^15] RSUV permet de transmettre un entier de 24 bits au shader pour chaque renderer sans casser ni le SRP Batcher ni le GPU Resident Drawer.[^3]

## **Partie II : Analyse des causes profondes des goulots d'étranglement (Bottlenecks) du rendu**

Pour comprendre pourquoi certains appels d'API détruisent la fréquence d'images (frame rate), il est nécessaire d'examiner le modèle de communication entre l'unité centrale (CPU) et le processeur graphique (GPU). L'architecture matérielle moderne exige une synchronisation étroite, mais sensible à la latence, entre ces deux processeurs.

### **Surcoût de communication CPU-GPU (Overhead)**

Le rendu d'une image oblige le CPU à parcourir tous les objets visibles dans le champ de vision de la Caméra (frustum culling), à déterminer leurs propriétés de material, à lier (bind) les textures et shaders requis dans la mémoire du GPU, puis à émettre une commande de dessin (draw command). L'opération la plus coûteuse de ce pipeline n'est pas le tracé des polygones par le GPU, mais les changements d'état obligatoires avant l'appel de dessin — communément appelés appels **SetPass**.[^5]

Chaque fois que le CPU rencontre un nouveau material, il doit interrompre le pipeline de rendu pour téléverser les nouveaux paramètres vers le GPU.[^18] Si une Scène contient 10 000 ennemis et que chacun possède une instance de material unique pour afficher une couleur d'armure différente, le CPU doit exécuter 10 000 changements d'état. Cela génère un surcoût CPU colossal (CPU Overhead), créant un goulot d'étranglement où le GPU reste inactif en attendant les instructions du CPU.

### **Fragmentation mémoire de la propriété `.material`**

Lorsqu'un script accède à `Renderer.material` pour modifier une couleur, le moteur est contraint de protéger l'intégrité de la ressource (asset) partagée d'origine. Il exécute alors un `Instantiate()` interne sur ce material. Cela inflige deux lourdes pénalités de performance :

1. **Destruction du Batching :** L'objet ne partage plus la référence de material avec ses pairs. Immédiatement, Unity désactive toute forme de Static Batching, Dynamic Batching ou SRP Batching pour cet objet.[^5] La carte graphique devra le traiter comme une entité totalement indépendante.
2. **Garbage Collection et fuites mémoire (Memory Leaks) :** La nouvelle copie du material est allouée sur le tas géré (Heap) par C#. Elle n'est pas automatiquement libérée par le ramasse-miettes lorsque l'objet est détruit. À moins que le développeur n'appelle explicitement `Destroy(renderer.material)`, la mémoire reste allouée. Cela crée une fuite mémoire qui finit par forcer le Garbage Collector (GC) à déclencher une passe Mark-and-Sweep, provoquant des pics de latence (spikes) et des chutes brutales de FPS.[^5]

## **Partie III : Architecture du SRP Batcher et obsolescence du GPU Instancing traditionnel**

Le Scriptable Render Pipeline (SRP) a fondamentalement réorganisé la manière dont Unity gère les données des shaders. Comprendre le SRP Batcher est essentiel pour saisir pourquoi les anciennes méthodes d'optimisation échouent complètement dans Unity 6.

### **Fonctionnement du SRP Batcher**

Dans les pipelines hérités (Built-in), les materials envoyaient les données au GPU via des variables uniformes séparées. Le SRP Batcher remplace cette approche par de grands tampons GPU persistants appelés **Constant Buffers (CBUFFERs)**.[^11]

L'architecture SRP impose aux shaders de séparer leurs variables en deux blocs de tampons distincts[^11] :

* `UnityPerMaterial` : un CBUFFER contenant les propriétés partagées par tous les objets utilisant le même material (par exemple : couleur de base, cartes métalliques — metallic maps, rugosité/lissage).
* `UnityPerDraw` : un CBUFFER contenant les propriétés propres à un appel de dessin spécifique (par exemple : les matrices de transformation spatiale de l'objet).

Parce que le tampon `UnityPerMaterial` réside de manière persistante dans la mémoire du GPU, le CPU n'a plus besoin de renvoyer les propriétés du material dans la boucle de rendu tant que des objets consécutifs partagent la même variante de shader (shader variant).[^18] Le SRP Batcher se contente de lier ce tampon persistant et de mettre à jour le tampon `UnityPerDraw`, beaucoup plus petit. Cette conception réduit considérablement le coût CPU, accélérant parfois le rendu d'un facteur 1,2x à 4x.[^21]

### **Le conflit fondamental avec `MaterialPropertyBlock`**

L'API `MaterialPropertyBlock` a été conçue à l'origine pour surcharger les propriétés d'un material au niveau du renderer. Cependant, comme le SRP Batcher repose sur la séparation stricte et la persistance du CBUFFER `UnityPerMaterial`, l'injection d'un MPB viole directement cette disposition mémoire.[^8]

Lorsqu'un MPB est appliqué, Unity ne peut plus garantir que le tampon persistant du material s'applique uniformément à l'objet. Par conséquent, le moteur est forcé d'éjecter brutalement l'objet du pipeline du SRP Batcher.[^9] La documentation officielle de Unity confirme explicitement : *« Notez que cette fonctionnalité n'est pas compatible avec le SRP Batcher. L'utilisation de MPB dans URP ou HDRP est susceptible d'entraîner une baisse de performance. »*[^8]

### **La solution de repli héritée : `Graphics.DrawMeshInstanced`**

Historiquement, lorsqu'un développeur avait besoin de variations massives (par exemple, une forêt d'arbres aux teintes différentes), il acceptait la perte du SRP Batcher et revenait au GPU Instancing.[^12] Cela nécessitait de casser manuellement la compatibilité SRP du shader en déclarant une propriété en dehors du tampon `UnityPerMaterial` et en cochant « Enable GPU Instancing » sur le material.[^13]

Bien que le GPU Instancing réduise le nombre de draw calls en transmettant des tableaux de matrices de transformation et de données de couleur, il souffre de limitations sévères.[^12] Il gère mal l'overdraw important, exige des maillages (meshes) strictement identiques et impose une lourde charge au CPU pour collecter et téléverser les tableaux d'instances (instance arrays) à chaque image. Dans Unity 6, cette méthode a été entièrement remplacée par l'architecture GPU Resident Drawer.[^23]

## **Partie IV : Incompatibilité de `MaterialPropertyBlock` (MPB) avec l'écosystème Unity 6**

Une analyse plus poussée de MPB révèle qu'il ne se contente pas de casser le SRP Batcher, mais qu'il introduit également des risques structurels pour les outils de débogage (debugging tools) et les systèmes d'éclairage (lighting systems) dans Unity 6.

### **Impact sur les données de Lightmap et la Global Illumination**

L'une des conséquences les moins évoquées d'une mauvaise utilisation de MPB est l'effacement des données de Lightmap. Lorsque vous créez un `new MaterialPropertyBlock()` et que vous l'assignez via `Renderer.SetPropertyBlock()`, le bloc de propriétés transmis écrase complètement l'état local du renderer.[^24]

Si votre objet utilise la Global Illumination (GI) précalculée (baked), les coordonnées UV de Lightmap et les coefficients de Light Probe sont stockés implicitement dans ce même property block du renderer.[^24] Si vous n'appelez pas `Renderer.GetPropertyBlock(block)` avant de définir la couleur, vous effacez accidentellement les informations d'éclairage de l'objet. Bien que le brouillon original de Long Gil Studio ait correctement géré l'appel à `GetPropertyBlock`, le simple fait d'appeler cette API de manière répétée sur des milliers d'objets introduit une latence CPU supplémentaire non négligeable.

| Technique d'optimisation       | Provoque une fuite RAM | Compatible SRP Batcher | Compatible GRD | Compatible DOTS | Usage recommandé             |
| :----------------------------- | :--------------------- | :--------------------- | :------------- | :-------------- | :--------------------------- |
| **`Material.color`**           | Oui                    | Non                    | Non            | Non             | À éviter absolument          |
| **`MaterialPropertyBlock`**    | Non                    | Non                    | Non            | Non             | Anciens projets Built-in     |
| **GPU Instancing**             | Non                    | Non (Conflit)          | Non            | Non             | Unity 2020-2022              |
| **Renderer Shader User Value** | Non                    | Oui                    | Oui            | Oui             | Standard Unity 6.3+          |

Comme l'indique le tableau ci-dessus, MPB est désormais une technique d'ancienne génération. Elle résout le problème de la RAM mais détruit l'intégralité du pipeline de rendu moderne de Unity 6.

## **Partie V : Le tournant architectural : GPU Resident Drawer (GRD) et `BatchRendererGroup` (BRG)**

Unity 6 introduit un chemin de rendu révolutionnaire : le **GPU Resident Drawer**. Ce système fait évoluer le paradigme d'une génération de draw calls pilotée par le CPU vers une boucle de rendu hautement autonome pilotée par le GPU.[^1]

### **Architecture du GPU Resident Drawer**

Le GPU Resident Drawer s'appuie sur l'API bas niveau `BatchRendererGroup` (BRG).[^1] Au lieu que le CPU évalue quels objets sont visibles (frustum culling) et envoie des commandes de dessin unitaires ou instanciées, le CPU téléverse l'ensemble des données spatiales et matérielles de la scène vers le GPU.[^25] Des compute shaders exécutent ensuite l'élimination des objets hors champ, l'élimination des objets occultés (occlusion culling) et la génération des commandes de dessin entièrement sur le GPU.[^14]

Les gains de performance sont spectaculaires. Grâce au rendu indirect (`DrawInstancedIndirect`), la charge de travail CPU requise pour le rendu peut chuter jusqu'à 50 % dans les scènes complexes.[^14] De plus, en combinaison avec le GPU Occlusion Culling, le traitement des triangles peut être réduit de près de 90 %, tandis que le temps d'image (frame buffer time) du GPU est réduit de plus de moitié.[^28]

### **L'API `BatchRendererGroup` (BRG) et le Culling**

Derrière le GRD se trouve `BatchRendererGroup`. BRG nécessite une initialisation avec une fonction de rappel (callback) `OnPerformCulling`.[^30] Ici, le CPU se contente de configurer la visibilité et d'émettre des commandes de dessin regroupées par lots. Les données des objets (transformations, couleurs, drapeaux) sont chargées dans un `GraphicsBuffer`.[^25] Cela permet d'envoyer des millions de triangles au GPU en seulement quelques appels `SetPass`.

### **L'incompatibilité fatale de MPB avec GRD**

L'information la plus critique concernant l'optimisation dans Unity 6 est la fragilité des conditions d'éligibilité au GPU Resident Drawer. Pour qu'un objet soit traité par GRD, il doit respecter des règles strictes d'agencement des données.[^2]

La documentation officielle de Unity 6.1+ déclare explicitement que les GameObjects utilisant l'API `MaterialPropertyBlock` sont immédiatement exclus du GPU Resident Drawer.[^1] En outre, l'objet ne doit pas posséder de scripts utilisant des callbacks par instance comme `OnRenderObject`.[^2]

Lorsqu'un développeur attache un MPB pour modifier la teinte d'un objet, il force involontairement le moteur à revenir au mode de rendu CPU hérité pour cet objet précis. Si cela est appliqué à 10 000 unités dans un jeu de stratégie en temps réel, le surcoût CPU grimpe en flèche, annulant totalement les bénéfices de la mise à niveau vers Unity 6.

## **Partie VI : Le standard moderne : Renderer Shader User Value (RSUV) dans Unity 6.3**

Conscient de l'impasse architecturale créée par l'incompatibilité de MPB avec les pipelines modernes, Unity a introduit la fonctionnalité **Renderer Shader User Value (RSUV)** dans la version Unity 6.3 LTS.[^15] RSUV constitue le remplaçant définitif de `MaterialPropertyBlock` lorsque les développeurs doivent appliquer des personnalisations simples par instance sur de nombreux renderers partageant un même material.[^3]

### **Mécanisme de fonctionnement de RSUV**

RSUV contourne les modifications complexes de tampons qui pénalisaient MPB. À la place, il exploite un canal entier de 24 bits extrêmement efficace, transmis directement avec les données de dessin standard du renderer.[^3] Parce que cet entier est intégré dans la structure de données existante au lieu d'exiger un tampon de surcharge (buffer override) séparé, il maintient une compatibilité absolue avec le SRP Batcher et le GPU Resident Drawer.[^3]

### **Implémentation et encodage binaire (Bitwise Encoding)**

Pour utiliser RSUV afin de varier les couleurs, le CPU doit encoder les valeurs RGB souhaitées dans un seul entier non signé de 24 bits (`uint`). Chaque canal de couleur (Rouge — Red, Vert — Green, Bleu — Blue) occupe 8 bits (fournissant des valeurs de 0 à 255).[^3]

L'opération d'encodage utilise les opérateurs binaires de décalage à gauche (`<<`) et OU logique (`|`). L'équation mathématique s'exprime ainsi :

$$
Color_{uint} = (Blue_{byte} \ll 16) | (Green_{byte} \ll 8) | (Red_{byte})
$$

En implémentation C# pratique, itérer sur un tableau de composants `MeshRenderer` pour appliquer une teinte aléatoire offre des performances très élevées sans aucune allocation mémoire sur le tas (zero garbage allocation)[^3] :

```csharp
MeshRenderer allMeshRenderers = FindObjectsByType<MeshRenderer>(FindObjectsSortMode.InstanceID);  
foreach (MeshRenderer meshRenderer in allMeshRenderers)  
{  
    // Calcule une couleur aléatoire (en utilisant l'espace HSV pour des couleurs plus vives)  
    Color32 targetColor = Color.HSVToRGB(UnityEngine.Random.Range(0f, 1f), 1f, 1f);  

    // Encode RGB dans un entier de 24 bits (Bleu, Vert, Rouge)  
    uint encodedColor = ((uint)targetColor.b << 16) |   
                        ((uint)targetColor.g << 8) |   
                        ((uint)targetColor.r << 0);  

    // Applique la valeur directement au renderer via la nouvelle API de Unity 6.3
    meshRenderer.SetShaderUserValue(encodedColor);  
}
```

### **Décodage dans le Shader (Shader Decoding)**

Côté GPU, le shader doit décompresser (unpack) cet entier de 24 bits pour le reconvertir en une valeur de couleur `float4` normalisée. Unity fournit la variable intégrée `unity_RendererUserValue` pour accéder à ce bloc de données.[^3]

Le processus de décodage utilise l'opérateur binaire de décalage à droite (`>>`) et l'opérateur ET binaire (`&`) avec un masque binaire (bitmask) de `255` pour isoler chaque segment de 8 bits. Ensuite, la valeur est multipliée par l'inverse de 255 (`1.0 / 255.0`) afin de la normaliser dans l'intervalle entre `0.0` et `1.0`.[^3]

$$
Channel_{normalized} = ((unity\_RendererUserValue \gg Shift) \ \& \ 255) \times 0.0039215
$$

En langage High-Level Shader Language (HLSL) ou via un nœud Custom Function dans Shader Graph, la logique de décompression s'écrit comme suit[^3] :

```hlsl
uint c = unity_RendererUserValue;  
float4 instanceColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  // Canal Rouge (Red)  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  // Canal Vert (Green)  
    (float)((c >> 16) & 255) * (1.0 / 255.0), // Canal Bleu (Blue)  
    1.0 // Alpha fixe  
);
```

Ce changement de paradigme illustre une stratégie d'optimisation profonde : troquer la complexité des structures de données (comme MPB) contre du calcul mathématique (RSUV). Les processeurs GPU excellent dans les opérations bit à bit, ce qui rend le coût du décodage quasi invisible (quelques cycles d'horloge infimes). Pendant ce temps, la préservation des flux SRP Batcher et GPU Resident Drawer procure une réduction massive du temps de trame (frame-time).[^16]

## **Partie VII : Solution à très grande échelle : DOTS, ECS et `URPMaterialPropertyOverride`**

Pour les projets opérant à une échelle dépassant les capacités de traitement des GameObjects standard (par exemple : simulations de foules avec des centaines de milliers d'unités indépendantes — boids, armées massives de RTS), la technologie Data-Oriented Technology Stack (DOTS) de Unity offre l'architecture de rendu ultime.[^4]

### **Gestion mémoire orientée données (Data-Oriented Memory)**

Contrairement aux limites du modèle orienté objet où les GameObjects sont dispersés sur le Heap, les entités (entities) dans l'Entity Component System (ECS) existent exclusivement sous forme de tableaux de données contigus en mémoire.[^4] Cet agencement mémoire correspond parfaitement à la structure requise par l'API `BatchRendererGroup` (BRG) pour atteindre ses performances maximales.

Dans le package Entities Graphics, les développeurs peuvent utiliser le composant `URPMaterialPropertyOverride`.[^4] Ce système permet de surcharger les propriétés de material par entité (per-entity material overrides) sans jamais recourir à la néfaste API `MaterialPropertyBlock`.

### **Fonctionnement du DOTS Instancing**

Lorsqu'une entité est traitée dans DOTS, un shader configuré pour le DOTS Instancing (en cochant *Override Property Declaration* et en sélectionnant *Hybrid Per Instance* dans Shader Graph) reçoit un entier unique de 32 bits (une valeur de métadonnée — metadata value).[^34] Cet entier représente un décalage (offset) situé dans un `GraphicsBuffer` persistant sur le GPU.[^34]

Le shader utilise cet offset pour charger les données de propriété propres à l'instance qu'il est en train de dessiner.[^34] Ce qui distingue le DOTS Instancing est le suivant : si plusieurs entités partagent la même valeur de propriété, le DOTS Instancing leur permet de lire cette valeur depuis le même emplacement mémoire (le même offset), économisant des cycles GPU et réduisant la duplication mémoire.[^34] Comme les propriétés sont lues via un offset plutôt que d'être enfermées dans des tampons de constantes traditionnels, la taille d'un draw call n'est plus strictement limitée, autorisant un nombre gigantesque d'instances.

```csharp
// Exemple d'assignation de valeurs RSUV via le système DOTS / Burst Compile

public partial struct MaterialMeshInfoSystem : ISystem   
{  
    public void OnUpdate(ref SystemState state)   
    {  
        var entityManager = state.EntityManager;  
        // Traitement parallèle en écrivant directement les valeurs dans un NativeArray  
        // Offre une vitesse d'exécution que MonoBehaviour ne pourra jamais atteindre.  
    }  
}
```

La modification des valeurs de composants d'entités via des Bursted Background Jobs (tâches d'arrière-plan compilées avec le Burst Compiler) s'exécute à une vitesse fulgurante.[^4] Les joueurs peuvent ainsi voir des clôtures changer de couleur selon l'inclinaison du terrain, ou de l'herbe varier de teinte selon l'altitude, le tout dessiné dans un flux de draw call unique sans aucun goulot d'étranglement.[^4]

## **Partie VIII : Analyse des solutions alternatives (Alternative Solutions)**

Le brouillon original de Long Gil Studio mentionnait brièvement des techniques d'optimisation alternatives. L'analyse ci-dessous valide leur viabilité tout en les replaçant dans le cadre des contraintes physiques du moteur Unity 6.

1. **Vertex Colors (Couleurs par sommet du Mesh) :**
   * *Mécanisme :* Encoder les données de couleur directement dans les sommets (vertices) du maillage 3D. Le shader lit l'attribut `TEXCOORD` ou `COLOR` depuis le mesh.
   * *Efficacité :* Extrêmement léger et préserve parfaitement toutes les fonctionnalités de batching ainsi que la compatibilité GRD.[^36]
   * *Faiblesse :* Modifier les couleurs de sommets à l'exécution (runtime) nécessite de manipuler le tableau de données du mesh (`mesh.colors`). Cette action crée une copie du mesh en RAM, provoquant des blocages CPU et des allocations mémoire parasites. Le Vertex Color reste optimal uniquement pour des variations statiques précalculées (« baked ») dans des logiciels comme Blender ou Maya.
2. **Texture Atlasing et décalages UV (UV Offsets) :**
   * *Mécanisme :* Fusionner plusieurs variations de couleur dans un seul atlas de textures (texture atlas) et décaler les coordonnées UV des différents objets pour échantillonner des pixels précis.[^36]
   * *Efficacité :* Cette technique conserve un seul material et une seule texture, garantissant une compatibilité totale avec le SRP Batcher.[^36]
   * *Faiblesse :* Comme pour les couleurs de sommets, la modification dynamique des coordonnées UV sur différents objets à l'exécution nécessite généralement la création d'instances de maillages uniques, réintroduisant un gonflement mémoire (memory bloat). Toutefois, pour la conception d'environnements statiques ou les jeux Voxel (comme Minecraft), cette technique est imbattable.
3. **API bas niveau `Graphics.DrawMeshInstanced` :**
   * *Mécanisme :* Contourner complètement la hiérarchie des GameObjects pour pousser directement les matrices de coordonnées et les tableaux de couleurs vers le GPU via du code C#.[^37]
   * *Efficacité :* Offre un débit immense pour des systèmes tels que les algorithmes de nuées (flocking) ou le feuillage procédural.[^38]
   * *Faiblesse dans Unity 6 :* L'arrivée de l'API `BatchRendererGroup` et du GPU Resident Drawer a « démocratisé » cette performance, éliminant le besoin d'écrire du code complexe de culling et de soumission de dessins dans la plupart des scénarios courants.[^19] Maintenir un système `DrawMeshInstanced` personnalisé coûte désormais plus d'efforts d'ingénierie que de laisser le GPU Resident Drawer l'automatiser.

## **Partie IX : Structure de contenu recommandée pour le Long Gil Studio DevLog**

Sur la base de cette évaluation technique complète, le texte ci-dessous constitue l'article DevLog recommandé, entièrement révisé et rédigé selon des standards d'ingénierie de haut niveau. Il abandonne l'approche MPB défaillante et guide les lecteurs vers les véritables standards architecturaux de Unity 6 : RSUV et le GPU Resident Drawer.

---

**Unity 6 : Optimiser des milliers d'objets partageant un Material — Abandonner MPB pour l'architecture moderne**

**Par Long Gil Studio**

**🇻🇳 ÉDITION VIETNAMIENNE (Traduite en français)**

**1. Le goulot d'étranglement du rendu : le fléau de la duplication de Material**

Lors du développement de jeux à grande échelle, un défi architectural extrêmement courant se pose : « Comment changer la couleur de milliers d'objets partageant un même material sans faire chuter les FPS ? »

De nombreux développeurs utilisent l'instruction `GetComponent<Renderer>().material.color`. C'est une erreur fatale (anti-pattern). Appeler `.material` oblige Unity à créer silencieusement un clone de ce material en RAM. Il en résulte une grave fuite mémoire, des déclenchements incessants du Garbage Collector et une destruction complète du système de Batching. Le GPU est affamé tandis que le CPU s'asphyxie à traiter des milliers de Draw Calls séparés.

**2. Le piège hérité : pourquoi `MaterialPropertyBlock` est « mort » dans Unity 6**

Auparavant, la solution « pro » consistait à utiliser `MaterialPropertyBlock` (MPB) pour transmettre des données par objet sans cloner le material. **Mais si vous utilisez Unity 6 (URP/HDRP), vous devez cesser immédiatement cette méthode.**

Unity 6 repose massivement sur le flux **SRP Batcher** et sur une technologie révolutionnaire : le **GPU Resident Drawer (GRD)**. Le GRD déporte l'ensemble du flux de traitement du rendu (génération des Draw Calls, Culling) vers des Compute Shaders sur le GPU, réduisant jusqu'à 50 % le temps de calcul du CPU. Cependant, selon la documentation centrale du moteur, dès que vous attachez un `MaterialPropertyBlock` à un objet, celui-ci est immédiatement éjecté du SRP Batcher et perd totalement sa compatibilité avec le GPU Resident Drawer. Utiliser MPB revient à forcer Unity à revenir à l'ancien flux de rendu, lent et gourmand en CPU, pour toute votre armée.

**3. Le nouveau standard de Unity 6 : Renderer Shader User Value (RSUV)**

Pour briser définitivement cette impasse, la mise à jour Unity 6.3 LTS a introduit **Renderer Shader User Value (RSUV)**. Cette API vous permet de passer directement un entier de 24 bits au renderer. Comme RSUV ne nécessite aucune nouvelle allocation de tampons (buffers), il conserve une compatibilité à 100 % avec le SRP Batcher et le GPU Resident Drawer.

**Étape 1 : Encodage C# (Zero Garbage Allocation)**

Au lieu d'utiliser des chaînes de caractères (string) comme avec MPB, nous encodons la couleur RGB dans un entier de 24 bits par décalage de bits (bitwise) :

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Encode les 3 canaux Bleu, Vert et Rouge dans un entier de 24 bits  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Applique la valeur (100 % sûr pour l'architecture SRP et GRD !)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Étape 2 : Décodage dans Shader Graph**

Dans Shader Graph, créez un nœud **Custom Function** (Type : String, Name : DecodeColor) avec une sortie Vector4. Collez le code HLSL suivant pour décompresser l'entier en une couleur standard :

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Connectez cette sortie à l'entrée Base Color du Fragment Shader. Vous disposez désormais d'une infinité de variations de couleur avec une latence CPU nulle tout en exploitant pleinement la puissance du GPU Resident Drawer.

**Exemple : Implémentation concrète dans un script Shader (sans Shader Graph)**

Si vous écrivez un custom shader en code (HLSL), vous pouvez intervenir dans la fonction `BuildSurfaceData` pour décoder `unity_RendererUserValue` et le multiplier par `BaseColor` comme dans le fragment ci-dessous :

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // Décodage RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // Application de la couleur rsuvColor
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ... 
}
```

*En savoir plus sur :*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Dépasser le cap des 100 000 objets : la solution DOTS / ECS**

Si votre jeu exige le rendu de centaines de milliers d'unités indépendantes (comme des armées gigantesques), le système traditionnel des GameObjects créera inévitablement un goulot d'étranglement CPU, quelle que soit la qualité de votre optimisation graphique. À cette échelle, passez à l'architecture Unity DOTS. L'utilisation du composant `URPMaterialPropertyOverride` permet d'établir un agencement mémoire Data-Oriented communiquant directement avec l'API bas niveau `BatchRendererGroup`, offrant une performance AAA inégalée.

---

**🇺🇸 ÉDITION ANGLAISE (Traduite en français)**

**1. Le goulot d'étranglement du rendu : duplication de Material**

Lors du développement de jeux à haute densité, un défi architectural fréquent se présente : « Comment modifier la couleur de milliers d'objets partageant le même material sans détruire les performances ? »

Les développeurs choisissent souvent par défaut `GetComponent<Renderer>().material.color`. C'est un anti-pattern fatal. L'accès à `.material` force Unity à cloner silencieusement le material sur le tas géré (managed heap). Cela génère un gonflement mémoire sévère, déclenche des pics de garbage collection et détruit le draw call batching, faisant exploser la charge CPU tout en affamant le GPU.

**2. Le piège hérité : pourquoi `MaterialPropertyBlock` est mort dans Unity 6**

Historiquement, la solution « Pro » consistait à utiliser un `MaterialPropertyBlock` (MPB) pour transmettre des données par instance sans cloner les materials. **Si vous utilisez Unity 6 (URP/HDRP), vous devez cesser d'utiliser cette méthode immédiatement.**

Unity 6 s'appuie fortement sur le **SRP Batcher** et sur le nouveau **GPU Resident Drawer (GRD)** révolutionnaire. Le GRD déporte le frustum culling et la génération des draw calls vers des compute shaders GPU, réduisant le temps de rendu CPU jusqu'à 50 %. Toutefois, selon la documentation centrale du moteur, appliquer un `MaterialPropertyBlock` à un objet le disqualifie immédiatement du SRP Batcher et brise entièrement sa compatibilité avec le GPU Resident Drawer. En utilisant MPB, vous forcez Unity à revenir à un chemin de rendu hérité, lent et limité par le CPU, pour vos armées massives.

**3. Le standard de Unity 6 : Renderer Shader User Value (RSUV)**

Pour résoudre cette impasse architecturale, Unity 6.3 LTS introduit **Renderer Shader User Value (RSUV)**. Cette API vous permet de passer un entier de 24 bits directement dans la charge utile de données de base du renderer. Parce qu'il évite de modifier les tampons de constantes persistants, RSUV maintient une compatibilité à 100 % avec le SRP Batcher et le GPU Resident Drawer.

**Étape 1 : L'encodage C# (Zero Memory Allocation)**

Au lieu de passer des chaînes et de créer des blocs, nous empaquetons mathématiquement une couleur RGB dans un entier non signé de 24 bits à l'aide d'opérations bit à bit :

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Encode les canaux Bleu, Vert et Rouge dans un seul entier de 24 bits  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Applique la valeur nativement (100 % sûr pour SRP et GRD !)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Étape 2 : Le décodage dans le Shader**

Dans votre Shader Graph, créez un nœud **Custom Function** (Type : String, Name : DecodeColor) avec une sortie Vector4. Collez ce code HLSL pour décompresser l'entier en une couleur float normalisée :

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Connectez cette sortie à l'entrée Base Color de votre fragment. Vous disposez maintenant d'une infinité de variations de couleur sans aucune pénalité de draw call, tout en exploitant pleinement le GPU Resident Drawer.

**Exemple : Implémentation réelle dans un Custom Shader (sans Shader Graph)**

Si vous écrivez un custom shader en code (HLSL), vous pouvez modifier la fonction `BuildSurfaceData` pour décoder `unity_RendererUserValue` et la multiplier par `BaseColor` comme indiqué dans l'extrait ci-dessous :

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // Décodage RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // Application de rsuvColor
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ...
}
```

*Voir aussi :*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Dépasser les 100 000 objets : DOTS / ECS**

Si votre jeu nécessite le rendu de centaines de milliers d'unités dynamiques, les GameObjects standard finiront par saturer le thread principal du CPU quelles que soient les optimisations graphiques. Pour une échelle massive, passez à Unity DOTS. L'utilisation du composant `URPMaterialPropertyOverride` permet des agencements mémoire strictement orientés données (Data-Oriented). Cela s'interface directement avec l'API bas niveau `BatchRendererGroup`, atteignant des performances pures de niveau AAA inégalées.

---

## **Partie X : Recommandations stratégiques pour les équipes de développement**

L'analyse des modèles de rendu modernes révèle une fracture nette entre les anciennes connaissances d'optimisation (legacy) et l'architecture contemporaine du moteur. Le point essentiel pour les ingénieurs graphiques est le suivant : la modification des tampons de données (data buffers) par objet est intrinsèquement hostile à l'exécution parallèle et aux boucles de rendu pilotées par le GPU. Il n'est plus possible d'appliquer les réflexes d'optimisation de Unity 5.x ou Unity 2019 à Unity 6.

Pour atteindre des performances maximales dans Unity 6, les équipes de développement doivent appliquer rigoureusement les protocoles suivants :

1. **Auditer l'utilisation de MPB (Audit for MPB Usage) :** Les outils de profilage (par exemple : Unity Profiler) et les Frame Debuggers doivent être utilisés en continu pour identifier et éradiquer les cas où `MaterialPropertyBlock` est appliqué à une géométrie instanciée en masse (mass-instanced geometry). La commodité à court terme de MPB est largement éclipsée par la perte systématique du GPU Resident Drawer. Les équipes doivent mettre en place des avertissements dans le code source ou des scripts CI/CD pour détecter les instanciations inutiles de MPB.
2. **Adopter des stratégies d'encodage binaire (Bitwise Encoding Strategies) :** L'adoption du Renderer Shader User Value (RSUV) exige une évolution de la méthodologie de programmation. Les Technical Artists et les programmeurs gameplay doivent collaborer pour définir des schémas de compactage binaire stricts dans la limite des 24 bits de RSUV, garantissant que des états de données variés (couleur, dégâts, ID d'équipe — team ID) soient sérialisés efficacement avant d'atteindre le renderer. Par exemple, il est possible d'allouer 4 bits pour « Faction ID » (16 factions possibles), 8 bits pour « État de dégâts » (256 niveaux) et 12 bits pour « Custom Tint » (teinte personnalisée) — le tout décodé simultanément via des masques binaires (bitmasks) dans le shader.
3. **Évaluer les seuils de transition vers ECS (Evaluate Thresholds for ECS Transition) :** Bien que RSUV résolve le goulot d'étranglement lié aux variations de material pour les GameObjects, les limites CPU concernant les calculs physiques, les calculs de matrices (transform calculations) et le culling des GameObjects subsistent. Les projets prévoyant plus de 10 000 agents dynamiques actifs devraient proactivement concevoir des prototypes déployant DOTS (Entity Component System). L'utilisation du composant `URPMaterialPropertyOverride`[^34] pour dialoguer directement avec l'API `BatchRendererGroup` constitue la seule voie permettant de libérer pleinement le potentiel matériel des PC modernes et des consoles de nouvelle génération.

## **Références**

[^1]: Enable the GPU Resident Drawer in URP - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html](https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html)  
[^2]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^3]: Set and use the RSUV - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html)  
[^4]: Migrated my game to ECS/DOTS and material overrides are awesome! : r/Unity3D - Reddit, consulté le 19 avril 2026, [https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated\_my\_game\_to\_ecsdots\_and\_material/](https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated_my_game_to_ecsdots_and_material/)  
[^5]: Why You Should Stop Swapping Materials in Unity (And What to Do Instead) - Medium, consulté le 19 avril 2026, [https://medium.com/@MTCrypto\_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e](https://medium.com/@MTCrypto_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e)  
[^6]: Material Property Blocks - using them to store the original color of a material upon instantiation : r/Unity3D - Reddit, consulté le 19 avril 2026, [https://www.reddit.com/r/Unity3D/comments/10jyr9b/material\_property\_blocks\_using\_them\_to\_store\_the/](https://www.reddit.com/r/Unity3D/comments/10jyr9b/material_property_blocks_using_them_to_store_the/)  
[^7]: Instancing and Material Property Blocks | Ronja's tutorials, consulté le 19 avril 2026, [https://www.ronja-tutorials.com/post/048-material-property-blocks/](https://www.ronja-tutorials.com/post/048-material-property-blocks/)  
[^8]: Scripting API: MaterialPropertyBlock - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html](https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html)  
[^9]: Unity 6 and custom material bug - Spine Forum, consulté le 19 avril 2026, [https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug](https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug)  
[^10]: Scriptable Render Pipeline (SRP) Batcher - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html)  
[^11]: Scriptable Render Pipeline Batcher - Unity 6.3 User Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html)  
[^12]: GPU instancing - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html](https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html)  
[^13]: Remove SRP Batcher compatibility for GameObjects | High Definition Render Pipeline | 17.0.4 - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html)  
[^14]: Beginning Game Development: GPU Resident Drawer | by Lem Apperson - Medium, consulté le 19 avril 2026, [https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3](https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3)  
[^15]: Introduction to RSUV - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html)  
[^16]: Renderer Shader User Value sample - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html](https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html)  
[^17]: Speed Up Your Game Rendering in Unity3D: The Secret to Changing Material Colors, consulté le 19 avril 2026, [https://www.youtube.com/watch?v=CjfMAhU7cY8](https://www.youtube.com/watch?v=CjfMAhU7cY8)  
[^18]: Scriptable Render Pipeline Batcher - Unity User Manual 2021.3 (LTS), consulté le 19 avril 2026, [https://docs.unity.cn/Manual/SRPBatcher.html](https://docs.unity.cn/Manual/SRPBatcher.html)  
[^19]: Unity Draw Call Batching: The Ultimate Guide (2026 Update), consulté le 19 avril 2026, [https://thegamedev.guru/unity-performance/draw-call-optimization/](https://thegamedev.guru/unity-performance/draw-call-optimization/)  
[^20]: Scriptable Render Pipeline Batcher - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html)  
[^21]: SRP Batcher: Speed up your rendering - Unity, consulté le 19 avril 2026, [https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering](https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering)  
[^22]: Remove SRP Batcher compatibility for GameObjects in URP - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html)  
[^23]: GPU Instancing not working? Why amount of batches doesn't change? : r/Unity3D - Reddit, consulté le 19 avril 2026, [https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu\_instancing\_not\_working\_why\_amount\_of\_batches/](https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu_instancing_not_working_why_amount_of_batches/)  
[^24]: Scripting API: Renderer.GetPropertyBlock - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html)  
[^25]: Create batches with the BatchRendererGroup API in URP - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html)  
[^26]: Use the GPU Resident Drawer | High Definition Render Pipeline | 17.0.4 - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html)  
[^27]: Create draw commands with the BatchRendererGroup API | High Definition Render Pipeline, consulté le 19 avril 2026, [https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html](https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html)  
[^28]: Unity Tip Tuesday: GPU Resident Drawer & GPU occlusion culling - YouTube, consulté le 19 avril 2026, [https://www.youtube.com/shorts/0PenzdQFlv0](https://www.youtube.com/shorts/0PenzdQFlv0)  
[^29]: Graphics Features and Tools in Unity 6 Feel Like MAGIC! STP, Resident Drawer, and Occlusion Culling! - YouTube, consulté le 19 avril 2026, [https://www.youtube.com/watch?v=trdeAq3WPkQ](https://www.youtube.com/watch?v=trdeAq3WPkQ)  
[^30]: Initialize a BatchRendererGroup object in URP - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html)  
[^31]: Boost performance of your game in Unity 6 with GPU Resident Drawer - The Knights of U, consulté le 19 avril 2026, [https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/](https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/)  
[^32]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^33]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html)  
[^34]: DOTS Instancing shaders in URP - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/Manual/dots-instancing-shaders.html](https://docs.unity3d.com/Manual/dots-instancing-shaders.html)  
[^35]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html)  
[^36]: One Material multiple colors possible? : r/Unity3D - Reddit, consulté le 19 avril 2026, [https://www.reddit.com/r/Unity3D/comments/9oi8kz/one\_material\_multiple\_colors\_possible/](https://www.reddit.com/r/Unity3D/comments/9oi8kz/one_material_multiple_colors_possible/)  
[^37]: Single-pass instanced rendering and custom shaders - Unity - Manual, consulté le 19 avril 2026, [https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html](https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html)  
[^38]: Use Graphics.DrawMeshInstanced or similar but vary the color on a per object basis?, consulté le 19 avril 2026, [https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use\_graphicsdrawmeshinstanced\_or\_similar\_but\_vary/](https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use_graphicsdrawmeshinstanced_or_similar_but_vary/)
