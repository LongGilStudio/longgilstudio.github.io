---
title: "Optimisation des performances Unity : comprendre et corriger les allocations mémoire (GC Alloc) de Resources.FindObjectsOfTypeAll"
date: 2026-09-25 09:26:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, memory, gc-alloc, csharp, dotnet, beginner-guide]
description: Guide détaillé pour les débutants expliquant pourquoi l'abus de Resources.FindObjectsOfTypeAll provoque des saccades (frame spikes) dans Unity et les 4 meilleures méthodes d'optimisation.
lang: fr
translation_id: unity-gc-alloc-resources-findobjectsoftypeall
math: true
---

Lors du développement d'un jeu avec Unity, vous avez certainement déjà eu besoin de rechercher un `GameObject` ou un `Component` précis. Unity fournit de nombreuses fonctions telles que `Find`, `FindObjectOfType`, et tout particulièrement `Resources.FindObjectsOfTypeAll`.

Bien que `Resources.FindObjectsOfTypeAll` soit extrêmement puissante car elle peut **tout** trouver (y compris les objets désactivés — inactifs, les prefabs dans les dossiers du projet ou les ressources qui n'ont pas encore été instanciées), elle constitue également l'un des « tueurs » silencieux des performances de votre jeu si elle n'est pas utilisée correctement.

Cet article vous aidera à comprendre pourquoi cette méthode est si dangereuse, comment les outils d'analyse (Profiler / Project Auditor) la signalent, et vous présentera en détail les méthodes d'optimisation permettant d'éliminer complètement les déchets mémoire (Garbage Collection Allocation — GC Alloc).

---

## **1. Pourquoi `Resources.FindObjectsOfTypeAll` nuit-elle aux performances ?**

Lorsque vous exécutez l'Unity Memory Profiler ou Project Auditor, vous pouvez rencontrer un avertissement jaune (Moderate) :
> *"Resources.FindObjectsOfTypeAll() allocates managed memory."*

Pour comprendre pourquoi, examinons le fonctionnement interne de cette méthode sous le capot du moteur (noyau C++) :

1. **Analyse complète de la mémoire (Coût CPU élevé)** : Contrairement à `FindObjectOfType`, qui ne parcourt que les objets actifs dans la Scene, `Resources.FindObjectsOfTypeAll` parcourt **toute** la mémoire du moteur. Elle passe en revue tous les objets de la Scene, les objets de l'Éditeur (si vous êtes dans l'Éditeur), ainsi que toutes les ressources (Assets) chargées en RAM. Plus le projet est grand, plus cette fonction s'exécute lentement.
2. **Création de déchets mémoire (GC Allocation)** : À chaque fin d'exécution, cette méthode crée **systématiquement** un nouveau tableau (`Array`) sur le Managed Heap de C# pour stocker les résultats renvoyés.

**Conséquence :** Si vous appelez cette méthode de manière répétée (par exemple dans `Update()`, ou à chaque clic sur un bouton de l'interface UI), vous jetez constamment des déchets (anciens tableaux) en mémoire. Lorsque la mémoire est saturée, le ramasse-miettes (Garbage Collector — GC) de Unity est forcé de se déclencher. Ce processus de nettoyage fige brièvement le jeu, provoquant un phénomène de **saccades (stuttering)** très désagréable pour le joueur.

---

## **2. Les 4 méthodes d'optimisation (Bonnes pratiques)**

Pour résoudre ce problème à la racine, selon votre situation, vous pouvez appliquer l'une des 4 méthodes éprouvées suivantes, issues de l'expérience des ingénieurs en optimisation Unity.

### **Méthode 1 : Référence directe via l'Inspector (La plus recommandée)**
L'approche la plus rapide, qui ne coûte 0 CPU et 0 RAM, consiste à **ne rien rechercher du tout**. Au lieu d'utiliser du code pour trouver un objet, déclarez une variable `public` ou `[SerializeField]` et glissez-déposez cet objet directement depuis l'interface Inspector de Unity.

```csharp
// ❌ À ÉVITER : Recherche coûteuse
void Start() {
    // Cette fonction va générer une GC Alloc
    myManager = (GameManager)Resources.FindObjectsOfTypeAll(typeof(GameManager))[0]; 
}

// ✅ OPTIMAL : Référence directe
[SerializeField] private GameManager myManager; 
// (Glissez-déposez GameManager dans ce champ dans l'éditeur Unity)
```

### **Méthode 2 : Mise en cache (Caching) et Singleton**
Si vous devez absolument rechercher un objet par le code, **ne le faites qu'une seule fois** (par exemple dans `Awake()` ou `Start()`), puis stockez-le (cache) dans une variable pour les utilisations suivantes.

Pour les systèmes partagés comme `UIManager` ou `AudioManager`, utilisez le patron Singleton ou une propriété statique (`static`) pour un accès global sans aucun coût de recherche.

```csharp
// ❌ À ÉVITER : Appeler la recherche en continu à chaque besoin de texte
public string GetLocalizedText(string key) {
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetText(key);
}

// ✅ MIEUX : Mettre en cache dans une variable static (ne chercher qu'une fois)
public static UIManager SharedUIManager;

void Awake() {
    if (SharedUIManager == null) 
        SharedUIManager = FindAnyObjectByType<UIManager>(); // Recherche unique
}

public string GetLocalizedText(string key) {
    return SharedUIManager.GetText(key); // Réutilisation immédiate, coût 0
}
```

### **Méthode 3 : Passer aux API modernes d'Unity 6**
Auparavant, dans les premières versions d'Unity 2023, pour remplacer `FindObjectsOfType`, Unity utilisait l'énumération `FindObjectsSortMode` :

```csharp
// ⚠️ Ancien (Unity 2023.1 - 2023.2) :
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
```
Cependant, **à partir d'Unity 6, l'énumération `FindObjectsSortMode` a officiellement été marquée comme obsolète (Deprecated / Obsolete)** en raison de la transition du moteur des `InstanceID` 32 bits vers un nouveau mécanisme d'identification d'objets et de la suppression du tri afin de maximiser les performances.

Selon la documentation officielle d'Unity 6, vous devez utiliser les surcharges standardisées suivantes :

```csharp
// ❌ Ancien (Unity 2022 et antérieur - Lent, impose le tri du tableau)
var managers = FindObjectsOfType<GameManager>();

// ✅ Standard Unity 6 : Récupérer n'importe quel objet unique (Le plus rapide, Zero-Alloc)
// N'alloue pas de tableau sur le Heap, renvoie immédiatement le premier objet trouvé
var manager = FindAnyObjectByType<GameManager>(); 

// ✅ Standard Unity 6 : Récupérer une liste de plusieurs objets (Sans le paramètre SortMode devenu Obsolete)
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude);
```

> 💡 **Astuce :** `FindAnyObjectByType<T>()` est nettement plus performant que `FindFirstObjectByType<T>()` si vous n'avez qu'une seule instance (comme un Manager/Controller), car il ne se soucie pas de l'ordre dans la hiérarchie et renvoie immédiatement le premier objet trouvé.

#### ⚠️ **Idée reçue courante : `Resources.FindObjectsOfTypeNonAlloc` existe-t-elle ?**
De nombreux développeurs connaissent les fonctions de réutilisation de tableau d'Unity (comme `Physics.RaycastNonAlloc` ou `GetComponentsNonAlloc`) et supposent que `Resources` possède une fonction `NonAlloc` similaire.
En réalité, d'après la documentation officielle d'Unity : **Il n'existe ABSOLUMENT AUCUNE fonction `Resources.FindObjectsOfTypeNonAlloc`**. `Resources.FindObjectsOfTypeAll` créera **toujours** un nouveau tableau sur le Managed Heap à chaque appel.

Si vous devez suivre la liste de tous les objets dans la Scene tout en visant **zéro GC Alloc absolu**, utilisez le modèle d'**Auto-enregistrement (Static Registration Pattern)** :

```csharp
// ✅ Solution Zero GC Alloc : Auto-enregistrement dans la liste à l'activation
public class Enemy : MonoBehaviour 
{
    // Liste statique partagée, réutilise la mémoire sans nouvelle allocation
    public static readonly List<Enemy> ActiveEnemies = new();

    void OnEnable()  => ActiveEnemies.Add(this);
    void OnDisable() => ActiveEnemies.Remove(this);
}

// Partout dans le jeu où l'accès est nécessaire :
// Utilisez directement Enemy.ActiveEnemies — Des dizaines de fois plus rapide que Find et 0 GC Alloc !
```

### **Méthode 4 : Encapsuler le code éditeur avec `#if UNITY_EDITOR`**
Il arrive que vous téléchargiez un plugin sur l'Asset Store (par exemple un système d'animation ou un outil UI) qui contient `Resources.FindObjectsOfTypeAll`. Le plus souvent, ces fonctions ne servent qu'à alimenter des boutons utilitaires dans l'environnement de développement (Editor).

Pour éviter que ces fonctions ne « fuitent » dans la version finale du jeu (Build Player) et ne déclenchent des avertissements, vous pouvez les encapsuler avec la directive de préprocesseur `#if UNITY_EDITOR`. Le code à l'intérieur sera entièrement supprimé lors de l'exportation du jeu.

```csharp
#if UNITY_EDITOR 
// Ce code ne s'exécute que lorsque vous travaillez dans l'éditeur Unity
// Il sera totalement supprimé lors du Build vers .exe, .apk
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    if (reOfType != null) return reOfType.ToList();
    return null;
}
#endif 
```

---

## **3. Cas pratiques : corriger le problème à la racine dans un projet de jeu**

Pour bien comprendre comment appliquer ces techniques en pratique, examinons les 2 scénarios les plus courants où un projet reçoit des avertissements de déchets mémoire de la part d'Unity Project Auditor ou du Profiler à cause de paquets d'assets tiers :

### **Scénario 1 : Le système de localisation UI scanne toute la RAM à chaque changement de langue**
* **Problème** : À chaque fois qu'un texte d'interface UI doit être affiché ou qu'un son d'interface est joué, la fonction utilitaire appelle `Resources.FindObjectsOfTypeAll(typeof(UIManager))[0]`. Cela fait que chaque ouverture de menu scanne toute la RAM et génère un tableau jetable sur le Heap.
* **Solution** :
  1. Utiliser `FindAnyObjectByType<UIManager>()` pour effectuer la recherche une seule et unique fois à l'initialisation (`Awake`).
  2. Créer une propriété statique `SharedUIManager` pour mettre la référence en cache, transformant la recherche en un accès instantané en $O(1)$ avec **0 octet de déchet**.

```csharp
// ❌ AVANT OPTIMISATION : Scanne toute la mémoire et crée des déchets à chaque appel
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetLocalizedText(tableID, tableKey);
}

// ✅ APRÈS OPTIMISATION : Exploite le cache statique (Zero GC Alloc)
public class LocalizationManager : MonoBehaviour 
{
    public static LocalizationManager instance;
    public UIManager UIManagerAsset;

    // Cache d'accès rapide pour tout le jeu
    public static UIManager SharedUIManager => instance != null ? instance.UIManagerAsset : null;

    void Awake() 
    {
        instance = this;
        // Utilise l'API Unity 6 pour chercher une seule fois, sans allocation de tableau
        if (UIManagerAsset == null) 
            UIManagerAsset = FindAnyObjectByType<UIManager>(); 
    }
}

// Partout où un texte est nécessaire, il suffit d'appeler via le Cache :
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = LocalizationManager.SharedUIManager;
    return tempUIM != null ? tempUIM.GetLocalizedText(tableID, tableKey) : null;
}
```

---

### **Scénario 2 : Des utilitaires Éditeur tiers s'infiltrent dans le Build final du jeu**
* **Problème** : De nombreux paquets d'outils (comme les systèmes d'Animation ou de Level Design) incluent des fonctions de recherche de ressources `Resources.FindObjectsOfTypeAll` pour faire fonctionner les boutons Reset ou Setup dans l'Éditeur. Même si le gameplay ne les appelle jamais, le fait que ce code reste exposé dans le code source runtime amène Unity à signaler le Build du jeu (Player) avec des avertissements GC Alloc.
* **Solution** : Encapsuler tout ce bloc de recherche de ressources avec la directive de préprocesseur `#if UNITY_EDITOR`. Lorsque vous compilez le jeu en fichier d'installation (`.exe`, `.apk`), Unity retranche automatiquement et complètement ces lignes de code du runtime.

```csharp
// ❌ AVANT OPTIMISATION : Code de recherche de ressources Éditeur exposé dans le Runtime
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}

// ✅ APRÈS OPTIMISATION : Encapsulé par la directive de préprocesseur #if UNITY_EDITOR
#if UNITY_EDITOR
// Ce bloc n'existe que dans l'éditeur Unity, supprimé à 100 % lors du Build du jeu
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}
#endif
```

---

## **Conclusion**

Pour ceux qui débutent sur Unity, les « déchets mémoire » (GC Allocation) restent un concept assez abstrait car C# effectue le nettoyage automatiquement. Pourtant, en programmation de jeux vidéo, générer des déchets en continu entraîne des saccades bien visibles à l'écran.

Règle d'or : **Tenez-vous à l'écart de la famille des fonctions `Find` (en particulier `Resources.FindObjectsOfTypeAll`) dans les boucles comme `Update()` ou les événements appelés fréquemment.** Privilégiez les références via l'Inspector, tirez parti du cache (Cache / Singleton), passez à l'API standard d'Unity 6 (`FindAnyObjectByType`), et protégez les utilitaires Éditeur avec `#if UNITY_EDITOR`. Optimiser ces petits détails permettra à votre jeu de maintenir un 60 FPS stable sur tous les appareils !
