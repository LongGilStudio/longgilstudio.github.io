---
title: "Rapport de recherche technique approfondi : Mécanisme de fonctionnement, architecture système et impact de DelayedActionManager dans l'environnement Addressables d'Unity"
date: 2026-10-01 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, addressables, memory-management, async, delayedactionmanager, optimization]
description: Analyse approfondie de l'architecture ComponentSingleton de DelayedActionManager dans Unity Addressables, du mécanisme d'exécution LateUpdate, de la gestion des exceptions de proxy C#/C++ et des stratégies d'optimisation mémoire des AssetBundles.
lang: fr
translation_id: unity-addressables-delayedactionmanager
---

L'Addressable Asset System (appelé plus couramment Addressables) représente une avancée architecturale révolutionnaire d'Unity, offrant une solution de gestion de contenu flexible, robuste et optimisée basée sur l'infrastructure traditionnelle des AssetBundles[^1]. Lors de la conception et de l'exploitation de jeux ou d'applications interactives à grande échelle, la gestion de flux de données asynchrones pour charger et libérer automatiquement les ressources constitue une exigence essentielle. L'un des composants fondamentaux assurant cette tâche complexe, tout en déroutant fréquemment les ingénieurs logiciels lors de l'analyse de la hiérarchie (Hierarchy), est un objet généré automatiquement nommé `DelayedActionManager`, logé à l'intérieur de la scène `DontDestroyOnLoad`[^2].

Ce rapport technique propose une dissection complète de la nature architecturale de `DelayedActionManager`, explique les raisons de sa présence dans l'espace `DontDestroyOnLoad`, analyse son mécanisme d'exécution au sein de la boucle temps réel d'Unity, et décortique les défis liés à la gestion mémoire, les phénomènes de fuite mémoire (memory leaks) ainsi que les exceptions courantes liées aux threads et au cycle de vie. À travers l'analyse de la conception système et des bonnes pratiques éprouvées, ce document apporte un éclairage approfondi pour aider les architectes logiciels à optimiser la stabilité de leurs applications.

## L'évolution du système de chargement des ressources et les fondations asynchrones

Avant d'explorer les microstructures de `DelayedActionManager`, il est indispensable de comprendre le contexte dans lequel le système Addressables a vu le jour. Dans les anciennes versions d'Unity, les développeurs dépendaient généralement du dossier `Resources` ou utilisaient directement des scripts AssetBundle bruts[^4]. Le mécanisme `Resources.Load()` fonctionne comme un utilisateur qui irait lui-même dans un entrepôt : il exige un chemin de répertoire exact et le thread d'exécution principal (main thread) est contraint de se bloquer jusqu'à ce que la ressource soit localisée et chargée en mémoire[^4]. Le défaut de cette méthode est qu'elle entrave la scalabilité de l'application et provoque de graves chutes du nombre d'images par seconde (FPS drop) lors du traitement de grands volumes de données.

Pour résoudre ce problème, Addressables agit comme un service de logistique moderne. Le développeur se contente de fournir l'identifiant de la ressource (address/key), et le système route automatiquement la requête pour trouver la ressource sur le stockage local (Local) ou la télécharger depuis des serveurs de réseau de diffusion de contenu (CDN - Content Delivery Network)[^4]. Plus important encore, l'ensemble de ce cycle s'effectue de manière asynchrone. L'appel de chargement, typiquement `Addressables.LoadAssetAsync`, ne renvoie pas l'objet immédiatement mais retourne un handle d'orientation nommé `AsyncOperationHandle`[^4]. Cette interface fournit un mécanisme de rappel (callback) lorsque la ressource est prête, permettant au thread principal de l'application de continuer à traiter la logique physique et graphique sans interruption[^4].

Ce passage d'un modèle synchrone à un modèle entièrement asynchrone entraîne un défi architectural majeur : lorsqu'un processus de chargement de ressource prend plusieurs secondes en raison d'une bande passante réseau lente, l'application peut déjà avoir basculé vers une scène (scene) totalement différente[^1]. La gestion des fonctions de rappel (callbacks), des files d'attente de commandes (command queues) et du comptage de références (reference counting) exige une entité d'administration centrale, indépendante du cycle de création et de destruction des scènes ordinaires. C'est précisément la raison pour laquelle les développeurs d'Unity ont intégré le modèle de scène `DontDestroyOnLoad` au cœur d'Addressables.

## La scène DontDestroyOnLoad (DDOL) et l'architecture de persistance globale

Dans l'environnement Unity, le chargement d'une nouvelle scène (via `SceneManager.LoadScene` en mode Single par défaut) déclenche automatiquement le mécanisme de nettoyage de la mémoire. Le moteur détruit l'ensemble des `GameObject` et `Component` appartenant à la scène précédente afin de libérer les ressources qui ne sont plus utilisées[^7]. Bien que le chargement additif de scènes (Additive scenes) permette de maintenir plusieurs scènes actives en parallèle pour gérer l'état global (par exemple, une scène dédiée au Game Manager et une autre au Level), le mécanisme `DontDestroyOnLoad` (DDOL) reste une technique système essentielle pour protéger les objets de bas niveau[^7].

L'apparition de la scène `DontDestroyOnLoad` dans l'interface de l'éditeur Unity lorsque l'on appuie sur Play n'est pas un bug, mais un mécanisme caché par défaut du moteur destiné à regrouper les objets marqués pour ne pas être détruits lors d'un changement de scène[^9]. Pour qu'un `GameObject` soit accepté dans cette zone protégée, Unity impose une règle stricte : cet objet doit se situer au niveau racine (root level) de la scène[^8]. Toute tentative d'appliquer la fonction `DontDestroyOnLoad(gameObject)` à un objet enfant imbriqué (nested object) échouera et consignera un avertissement[^8].

Pour le système Addressables, les opérations de chargement et de libération des ressources ont un cycle de vie qui s'étend à travers plusieurs scènes différentes. Par exemple, le suivi de l'état de téléchargement d'un AssetBundle depuis un serveur distant ne peut pas être annulé en plein vol simplement parce que le joueur vient de franchir un portail de changement de niveau. L'utilisation du mécanisme `RuntimeInitializeOnLoadMethod` combiné à un patron Singleton avancé permet au code source d'Addressables de créer automatiquement un objet racine et de le placer dans la scène DDOL dès le démarrage de l'application[^2]. Cela explique pourquoi, même lorsque le développeur n'écrit aucune ligne de code liée à DDOL, un objet nommé `DelayedActionManager` apparaît automatiquement dans le coin inférieur gauche de la liste des scènes[^2].

## Structure interne et rôle technique de DelayedActionManager

Une étude approfondie du code source et de la documentation API du package Addressables montre que `DelayedActionManager` est une classe concrète située dans l'espace de noms `UnityEngine.ResourceManagement.Util`[^11]. Sa structure ne correspond pas à une simple classe utilitaire statique (static utility class), mais à un composant directement attaché à un `GameObject` par héritage d'une architecture de base[^12].

### Le modèle ComponentSingleton et l'automatisation de l'initialisation

L'architecture de `DelayedActionManager` repose sur le patron de conception `ComponentSingleton`, une classe fondamentale définie dans le même espace de noms[^13]. L'utilisation du patron Singleton sur un composant (`Component`) plutôt que sur une classe C# pure confère au système la capacité d'interagir directement avec la boucle d'événements temps réel (`PlayerLoop`) d'Unity.

Lorsque `ResourceManager` reçoit pour la première fois une requête de chargement ou de mise à jour d'état (par exemple `Addressables.LoadAssetAsync` ou des opérations de diagnostic réseau), il fait appel à l'instance `DelayedActionManager`. À ce moment précis, `ComponentSingleton` exécute automatiquement une séquence cachée comprenant : la création d'un `GameObject` vide, son nommage en `"DelayedActionManager"`, l'attachement du script correspondant et l'appel immédiat à `DontDestroyOnLoad` pour le placer dans l'espace de protection global[^2]. Cette conception à initialisation paresseuse (lazy initialization) garantit que les ressources système ne sont consommées que lorsque la gestion des tâches différées est réellement requise, levant ainsi le voile sur les interrogations fréquentes des développeurs quant à l'apparition « magique » de cet objet dans l'interface[^3].

### Analyse du mécanisme de planification et de la phase LateUpdate

La mission centrale de `DelayedActionManager` est de jouer le rôle d'ordonnanceur central (central scheduler) pour les actions différées, les fonctions de rappel (callbacks), les coroutines et la gestion mémoire à un niveau granulaire[^11]. Une subtilité architecturale d'une importance capitale réside dans le fait que toute la logique de traitement des files d'attente est routée pour s'exécuter à l'intérieur de la méthode `LateUpdate()` du cycle de vie d'Unity[^11].

Le choix de `LateUpdate` plutôt que du traditionnel `Update` résout un problème architectural profond lié à la cohérence des données. Le tableau suivant illustre l'ordre d'exécution d'Unity et le rôle de la phase `LateUpdate` dans la protection des données Addressables.

| Phase d'exécution (PlayerLoop) | Fonctions typiques | Rôle vis-à-vis d'Addressables et de DelayedActionManager |
| :--- | :--- | :--- |
| **FixedUpdate** | Traitement de la simulation physique, collisions statiques/dynamiques. | La logique de jeu peut déclencher une demande de destruction d'objet après une collision. |
| **Update** | Entrées du joueur (Input), déplacements, logique d'IA, mise à jour de l'état du jeu. | Les méthodes `Addressables.LoadAssetAsync` ou `Release` sont appelées manuellement. Des GameObjects peuvent subir `Destroy()` à ce stade. |
| **LateUpdate** | Mise à jour de la position de la caméra, ajustements de post-traitement (post-processing). | `DelayedActionManager` nettoie la mémoire, met à jour les compteurs de références et appelle les callbacks asynchrones afin d'éviter tout conflit avec les destructions survenues en phase `Update`[^11]. |

Si `ResourceManager` exécutait immédiatement les callbacks de fin de tâche au milieu de la phase `Update`, il courrait un risque élevé d'interagir avec un sous-système (par exemple le moteur graphique ou l'interface utilisateur) se trouvant dans un état intermédiaire, dont le calcul de la frame n'est pas encore achevé. En différant (delaying) l'appel des fonctions `OnComplete` ou la décrémentation des compteurs de références (ref-count decrements) jusqu'à `LateUpdate()`, `DelayedActionManager` garantit que l'ensemble de l'état logique de la frame courante est stabilisé[^11]. Les données issues de nombreux rapports de traces de pile (stack traces) montrent que la méthode `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` constitue le dernier palier avant que le contrôle ne soit rendu au code utilisateur[^15].

## Dissection des exceptions système et des traces de pile (Stack Traces)

Bien que conçu avec un haut degré de sûreté, la complexité du mécanisme asynchrone, combinée à des manipulations inappropriées du cycle de vie côté développeur, place souvent `DelayedActionManager` au cœur d'exceptions graves. Les rapports d'erreur fournissent des indices essentiels sur la façon dont le système interagit avec la mémoire managée (managed memory) et la mémoire native (native memory).

### Erreur NullReferenceException et conflit de cycle de vie du proxy C# - C++

Un scénario d'erreur très fréquent dans l'environnement Addressables est l'apparition de l'exception `ArgumentNullException: Value cannot be null. Parameter name: obj` provenant de la méthode `StartCoroutine_Auto` de `DelayedActionManager`[^19]. Cette erreur n'est pas une défaillance interne d'Unity, mais résulte d'une désynchronisation entre le ramasse-miettes C# (Garbage Collector) et la gestion des pointeurs natifs du code C++ sous-jacent[^19].

Dans Unity, les objets tels que `GameObject` ou `MonoBehaviour` sont en réalité des classes mandataires (proxy classes) écrites en C#, contenant une référence interne qui pointe vers l'objet natif alloué en C++ dans le moteur[^19]. Lorsque le développeur appelle `Destroy(gameObject)`, l'objet C++ est immédiatement détruit et sa zone mémoire est restituée, rendant la référence interne nulle[^19]. Toutefois, l'objet proxy C# peut continuer à exister dans la mémoire managée pendant un certain laps de temps jusqu'à ce que le ramasse-miettes le collecte[^19].

La catastrophe survient lorsque les développeurs combinent des expressions anonymes (lambdas/closures) avec les processus asynchrones d'Addressables. Une expression lambda a la particularité de « capturer » les variables du contexte qui l'entoure. Considérons le modèle de code suivant :

```csharp
// Une action mise en file d'attente dans DelayedActionManager
DelayedAction(null, () => {
    _crawlerRobot.BreakAwayLowerBody();
    if (isLevelLoad) {
        PhysicsUtil.ManualSimulation(2);
    }
});
```

Lorsque ce code est exécuté, la variable `_crawlerRobot` (qui est un proxy C#) est capturée par la fermeture (closure)[^19]. Si la logique du jeu détruit `_crawlerRobot` au cours de cette même frame, le pointeur C++ sous-jacent disparaît. Mais comme `DelayedActionManager` a planifié l'exécution de cette lambda pour la phase `LateUpdate` (ou lors d'une frame ultérieure), au moment où la lambda est effectivement déclenchée, elle tente d'accéder au membre `BreakAwayLowerBody()` d'un pointeur C++ déjà mort[^19]. La conséquence inévitable est que le système lève une `NullReferenceException` ou affiche le message d'erreur « L'objet a été détruit mais vous essayez toujours d'y accéder »[^19].

Pour pallier ce risque architectural, les spécialistes logiciels recommandent deux solutions de conception :

1. Éviter l'abus d'imbrication d'expressions lambda (lambdas nesting) lors du traitement de changements d'état de bas niveau[^19].
2. Toujours effectuer une vérification de nullité sûre, en s'appuyant sur le fait qu'Unity a surchargé (overloaded) l'opérateur `==` en C# pour inspecter directement l'état du pointeur C++ sous-jacent[^19].

### Conflit de PlayerLoop et erreur « Assertion failed on expression: ShouldRunBehaviour() »

Lors de la gestion de version (version control) des packages Addressables, de nombreux développeurs signalent que l'éditeur Unity (Unity Editor) est inondé d'un message d'erreur de bas niveau : `Assertion failed on expression: 'ShouldRunBehaviour()'` dans le fichier `MonoBehaviour.cpp`[^3].

La trace d'exécution (stack trace) indique que ce processus prend directement sa source dans le `GameObject` `"DelayedActionManager"` situé dans la scène `DontDestroyOnLoad`[^3]. L'analyse de la cause racine (Root Cause Analysis) révèle une faille dans la gestion du flux d'exécution du mode Play (Play Mode) de l'éditeur Unity. Lorsque l'éditeur subit un rechargement de domaine (Domain Reload) ou lorsque le processus de chargement des ressources n'est pas encore terminé au moment où l'utilisateur appuie sur Arrêter (Stop), `DelayedActionManager` se retrouve piégé à l'état d'objet orphelin (orphaned object)[^3].

Parce qu'il est marqué `DontDestroyOnLoad`, il tente de poursuivre ses cycles `LateUpdate` et ses vérifications de comportement (behaviour checks) alors même que l'environnement d'exécution natif d'Unity (`PlayerLoop`) a ordonné l'arrêt complet de toutes les tâches[^3]. Ce problème a été particulièrement critique lors de la transition du package Addressables `1.16.x` vers `1.18.x`, contraignant de nombreuses équipes à revenir manuellement à la version `1.17.17` afin de garantir la stabilité de l'API synchrone et d'éliminer les blocages de file d'attente[^3].

### L'évolution de DelayedActionManager à travers l'historique des versions

Un point intéressant mis en évidence par l'étude de la documentation API et des journaux de modifications (changelogs) d'Unity Addressables est l'existence cyclique de `DelayedActionManager`. Des versions comme `0.7.5` et `1.11.2` annonçaient explicitement dans leurs notes de mise à jour la refactorisation de l'interface des scripts de build (build script interface) avec le message : « Removed DelayedActionManager. Removed ISceneProvider. Users can implement custom scene loading »[^20]. Cette décision visait initialement à simplifier la couche API et à déléguer le contrôle à la classe personnalisable `AsyncOperationBase`[^20].

Pourtant, les rapports de bugs des versions post-LTS (Long-Term Support) telles que `1.18.15`, `1.19.19` et `1.21.21` révèlent le retour constant de `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` dans les traces de pile[^11]. Cela reflète la philosophie de conception itérative (iterative design) d'Unity : après l'avoir supprimé par souci de simplification, les ingénieurs système ont constaté que l'absence d'un gestionnaire centralisé de tâches différées engendrait des difficultés insurmontables pour la collecte des événements de diagnostic (`DiagnosticEventCollector`), le traitement des tables de préchargement (preload tables) et la sûreté mémoire lors de la fermeture de l'application[^11]. `DelayedActionManager` a donc été repensé et rétabli en tant qu'utilitaire système interne, qui n'est plus exposé dans l'interface publique mais assume la responsabilité des risques de libération (disposal) à l'extinction de l'application[^20].

## Mécanisme de comptage de références et dynamique des fuites mémoire

L'existence de `DelayedActionManager` est intimement liée à l'un des piliers les plus complexes d'Addressables : le système de gestion mémoire (Memory Management). Plutôt que de s'en remettre entièrement au Garbage Collector, Addressables contrôle la présence des données en RAM via un mécanisme de comptage de références (Reference Counting)[^23].

### Dynamique des références et hiérarchie des dépendances

Chaque fois que le système reçoit une requête de chargement d'une ressource, le compteur de références de cette ressource est incrémenté de 1. Une fois l'utilisation terminée, l'appel à `Addressables.Release` ordonne au système de décrémenter ce compteur[^23]. La règle d'or est que le système n'autorise la libération de la mémoire physique contenant la ressource que lorsque son compteur de références retombe à la valeur absolue de 0[^23].

La complexité croît de façon exponentielle car Addressables gère les dépendances via l'architecture AssetBundle. Lors du chargement d'une ressource (par exemple un matériau - Material), le système ne charge pas seulement ce matériau lui-même, mais charge automatiquement l'ensemble des AssetBundles contenant ses dépendances (par exemple des Textures)[^25]. Le graphe de dépendances (dependency graph) est calculé au niveau du Bundle, ce qui signifie que si une ressource dans le Bundle A référence une ressource dans le Bundle B, l'intégralité du Bundle B doit être chargée dans la mémoire hôte[^26].

La contrainte technique la plus rigide d'Unity dans cette architecture est la suivante : **l'utilisateur ne peut pas décharger partiellement (partially unload) le contenu d'un AssetBundle**[^23]. Pour illustrer ce principe, prenons un AssetBundle nommé `"stuff"` contenant trois ressources indépendantes : `Arbre`, `Char` et `Vache`[^23].

1. Lorsque la ressource `Arbre` est chargée, l'outil d'analyse mémoire (Profiler) affiche une référence pour `Arbre` et une référence correspondante pour le bundle `stuff`[^23].
2. Lorsque la ressource `Char` est ensuite chargée, le compteur de `Char` passe à 1 et celui de `stuff` passe à 2[^23].
3. Si le jeu exécute l'instruction `Release(Arbre)`, le compteur d'`Arbre` redescend à 0 et sa barre bleue dans le Profiler disparaît[^23].
4. Cependant, les données physiques d'`Arbre` restent intactes en mémoire système. Comme `Char` maintient toujours une connexion qui garde le compteur de l'AssetBundle `stuff` supérieur à 0, aucune ressource de ce bundle ne peut être détruite tant que le bundle entier n'est pas complètement libéré[^23].

### Syndrome d'« Asset Churn » et gonflement de la mémoire (Memory Bloat)

Le phénomène selon lequel des ressources sont continuellement chargées, libérées, puis immédiatement rechargées dans un court laps de temps est défini comme l'« Asset Churn » (rotation frénétique des ressources)[^23]. Cette faille apparaît fréquemment lors des transitions entre niveaux (levels). Supposons que le Niveau 1 utilise la ressource `Bateau` et que le Niveau 2 utilise la ressource `Avion` (partageant toutes deux une texture `Camouflage`). À la sortie du Niveau 1, le développeur libère `Bateau`, ce qui amène Addressables à décharger immédiatement la texture `Camouflage` de la mémoire. Une milliseconde plus tard, lorsque le Niveau 2 instancie `Avion`, le système contraint le disque dur à effectuer un cycle d'E/S complet pour recharger cette même texture `Camouflage` depuis le début[^23]. Ce processus génère des pics (spikes) soudains de temps de frame et pousse la consommation mémoire vers des seuils critiques, en particulier sur matériel mobile[^27].

Par ailleurs, l'oubli d'un appel `Release` entraîne une accumulation de références orphelines, faisant dériver la consommation de RAM de quelques centaines de mégaoctets jusqu'à plusieurs gigaoctets en seulement quelques changements de scène[^28]. Comme ni `DelayedActionManager` ni Addressables lui-même ne suivent le nombre d'instances créées via la méthode `Instantiate` standard de `MonoBehaviour`, toute erreur de suivi d'un handle mémoire crée une fuite mémoire permanente[^6].

### Architecture de compression des données et pression sur l'allocation mémoire

La taille des AssetBundles et la méthode de compression choisie influent directement sur la manière dont les données résident en RAM. Le choix de l'algorithme de compression détermine si un AssetBundle occupera durablement un large bloc de mémoire ou s'il pourra optimiser la bande passante.

Tableau récapitulatif des caractéristiques des algorithmes de compression AssetBundle et de leur impact sur le stockage[^29] :

| Algorithme de compression | Reconnaissance des fichiers locaux | Nécessite le chargement complet du Bundle en RAM | Impact sur les performances et le stockage |
| :--- | :--- | :--- | :--- |
| **LZMA** | Non. Le Bundle est compressé en un bloc monolithique. | **Oui.** L'intégralité du fichier doit être décompressée en mémoire. | Taux de compression le plus élevé et taille de téléchargement réduite, mais provoque un gonflement aigu de la mémoire (Memory Bloat) et une forte consommation CPU lors de l'extraction[^29]. |
| **LZ4** | Oui. Compression par blocs (chunk-based). | **Non.** Ne charge que les segments de données réellement consultés. | Recommandé comme norme par défaut (default). Permet la mise en cache directe sur le disque local sans charger toutes les métadonnées en RAM[^29]. |
| **Uncompressed** | Oui. Accès indépendant par ressource. | **Non.** Accès direct. | Aucun temps de décompression, taille de fichier brute la plus élevée. Optimal pour un chargement instantané si la bande passante disque le permet[^29]. |

Lorsque l'on demande une minuscule ressource issue d'un énorme AssetBundle compressé en LZMA, l'intégralité du fichier (y compris l'en-tête, les métadonnées et les tables de cache de streaming) doit être transférée du disque dur vers la RAM[^27]. Cette erreur de conception transforme les AssetBundles volumineux en véritables bombes à retardement provoquant des plantages par manque de mémoire (OOM crashes)[^27].

## Bonnes pratiques (Best Practices) dans la gouvernance des ressources

Pour maîtriser la complexité du système de comptage de références et limiter la charge pesant sur `DelayedActionManager`, les architectes système doivent appliquer une structure de cycle de vie extrêmement rigoureuse, associée à des techniques d'optimisation de la durée de vie des ressources.

### 1. Synchroniser le cycle d'initialisation et de libération

Tout objet `AsyncOperationHandle` retourné par l'API doit impérativement être libéré à la fin de son cycle d'utilisation[^6]. Ne pas le faire provoque non seulement des fuites mémoire mais expose aussi l'application à des plantages système (crashes)[^6]. Le tableau ci-dessous illustre les paires symétriques obligatoires dans la programmation Addressables :

| Méthode d'initialisation / chargement | Méthode de libération correspondante | Mécanisme de fonctionnement interne |
| :--- | :--- | :--- |
| `Addressables.LoadAssetAsync` | `Addressables.Release(handle)` | Soustrait 1 au compteur de références de l'AssetBundle qui la contient[^6]. |
| `Addressables.InstantiateAsync` | `Addressables.ReleaseInstance(gameObject)` | Détruit l'objet affiché (Instance) et soustrait automatiquement 1 au compteur du Prefab d'origine[^4]. |
| Assignation via `AssetReference` | `reference.ReleaseAsset()` | Équivalent à un appel `Release` via un handle, nettoie les références statiques[^6]. |

En particulier, lors de l'utilisation de `ScriptableObject` pour stocker les paramètres du jeu, référencer directement un objet (`public Object _worldAsset`) crée une référence forte (hard reference), forçant l'ensemble du système à charger immédiatement cette ressource en RAM[^27]. La solution optimale consiste à utiliser `AssetReference` (`public AssetReference addressableAsset;`) afin de charger de façon asynchrone à la demande (on-demand loading)[^6].

### 2. Intervention de bas niveau : Resources.UnloadUnusedAssets()

Dans la situation de blocage où des AssetBundles partagés restent coincés en mémoire en raison de la règle « pas de déchargement partiel » (par exemple : `Arbre` bloqué avec `Char`), la seule issue consiste à utiliser une API coercitive issue de la couche de base du moteur : `Resources.UnloadUnusedAssets()`[^25].

Cette fonction exécute une analyse approfondie de toute la RAM afin d'identifier chaque ressource (y compris celles cachées dans des AssetBundles) dont le nombre de références internes réelles (actual engine references) est strictement égal à 0, puis force leur destruction[^25]. Il s'agit toutefois d'une opération extrêmement coûteuse en puissance de calcul, provoquant de sévères chutes de FPS (FPS drops) car le CPU doit suspendre le fil logique pour effectuer ce balayage[^27]. Les ingénieurs ne doivent la déclencher que lors des écrans de transition majeurs (loading screens), ou laisser le système l'appeler automatiquement lors d'un changement de scène avec `SceneManager.LoadScene`[^29].

### 3. Planification et fragmentation des AssetBundles (Bundle Packing Modes)

L'organisation de la structure des groupes (Groups) dans l'interface de configuration d'Addressables détermine directement les performances de chargement mémoire et la bande passante de téléchargement. Choisir le mode d'empaquetage (Bundle Mode) adapté à chaque type de ressource est une étape de conception cruciale[^6] :

* **Pack Together (Empaquetage groupé)** : à utiliser pour les ressources ayant un cycle de vie étroitement lié et apparaissant toujours simultanément. Cela réduit les coûts d'analyse du graphe de dépendances et les E/S réseau[^6].
* **Pack Separately (Empaquetage séparé)** : optimal pour les ressources gigantesques, indépendantes, ou les grandes cartes dont on ne peut garantir le chargement simultané. Élimine le risque qu'une ressource lourde bloque la libération d'une autre ressource légère[^6].
* **Pack Together By Label (Empaquetage par étiquette)** : permet de regrouper des ressources dispersées via des métadonnées d'étiquette (par exemple, appliquer l'étiquette `"Halloween 2023"` pour réunir tout le contenu d'un événement dans un même bundle, facilitant la mise à jour via CDN)[^6].

Pour réduire davantage le poids de la table des types (`TypeTree`) dans l'AssetBundle, les développeurs peuvent activer l'option `BuildAssetBundleOptions.DisableWriteTypeTree`. Cette fonctionnalité supprime les métadonnées superflues, mais impose de reconstruire les groupes locaux (rebuild local groups) avant d'exporter l'exécutable[^26].

### 4. Gouvernance de la mémoire audio et graphique (Graphics & Audio)

L'optimisation des couches auxiliaires constitue le moyen le plus efficace de réduire la fréquence d'intervention du ramasse-miettes. La configuration du format de chargement des flux audio influe directement sur la mémoire[^27] :

* **Musique de fond (BGM) longue** : doit être configurée en **Streaming** afin de charger de petits tampons mémoire depuis le disque[^27].
* **Effets sonores longs** : choisir **Compressed In Memory** pour conserver les données compressées en RAM et les décoder en temps réel lors de la lecture[^27].
* **Effets sonores courts / haute fréquence** : utiliser **Decompress On Load** pour disposer directement de données non compressées et supprimer le coût CPU[^27].

Par ailleurs, la désactivation de l'option `"Read/Write enabled"` sur les Textures ainsi que la suppression du tampon de profondeur (Depth Stencil Format réglé sur `None`) pour les caméras d'interface graphique (UI) réduiront d'au moins 50 % la quantité de RAM de rendu superflue[^27].

## Conclusion sur l'interaction globale

L'étude de `DelayedActionManager` ne se contente pas de décrypter l'origine d'un objet caché dans la scène `DontDestroyOnLoad` : elle met en lumière la philosophie de conception fondamentale du système Addressables dans Unity. Cette classe `ComponentSingleton` agit comme une passerelle temporelle subtile, préservant l'intégrité des données en redirigeant les processus de libération, les appels asynchrones et le traitement des tampons vers le cycle `LateUpdate`. Elle isole les modifications structurelles de la mémoire des perturbations susceptibles d'être provoquées par le code physique ou la logique de contrôle s'exécutant dans le flux `Update`, formant ainsi un bouclier contre les exceptions de corruption système lors des transitions de scènes.

Néanmoins, `DelayedActionManager` n'est pas une baguette magique capable de résoudre les faiblesses intrinsèques d'une architecture de gestion mémoire défaillante. Il impose aux architectes logiciels une discipline rigoureuse : maintenir un cycle de chargement/libération des ressources parfaitement symétrique, concevoir des expressions C# anonymes (lambdas) évitant de capturer des objets C++ natifs en fin de vie, et modulariser la structure des AssetBundles pour prévenir les fuites mémoire tenaces. Grâce à une maîtrise approfondie du routage asynchrone, à une utilisation judicieuse de méthodes de compression telles que LZ4 et au recours mesuré à `Resources.UnloadUnusedAssets`, les équipes de développement peuvent concevoir des architectures robustes et hautement évolutives sur toutes les plateformes, sans craindre l'épuisement permanent des ressources.

## **Références**

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

### Lectures complémentaires

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
