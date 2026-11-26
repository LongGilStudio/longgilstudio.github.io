---
title: "Optimisation des performances et intégrité temporelle dans Unity Engine : mécanismes système, analyse du goulot d'étranglement DateTime.Now et solution de Frame Caching"
date: 2026-09-17 03:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, datetime, csharp, dotnet, frame-caching, multithreading, anticheat]
description: Analyse approfondie des mécanismes internes de DateTime.Now et DateTime.UtcNow dans le runtime .NET, quantification des goulots d'étranglement de performance, phénomène de déchirement temporel (temporal tearing) et solution architecturale de Frame Caching thread-safe dans Unity Engine.
lang: fr
translation_id: unity-datetime-now-frame-caching
math: true
---

La récupération et le traitement des données temporelles en temps réel constituent l'une des tâches fondamentales, mais aussi l'une des plus risquées sur le plan architectural, dans les applications temps réel développées avec Unity Engine[^1]. Bien que la structure `System.DateTime` de la bibliothèque de classes de base .NET (BCL) fournisse des outils complets pour la gestion du calendrier, l'appel direct à la propriété `System.DateTime.Now` dans des boucles de mise à jour continues (hot paths) crée de graves goulots d'étranglement de performance et compromet l'intégrité de l'état[^2].

Ce rapport approfondit l'analyse des mécanismes internes au niveau du système d'exploitation et de l'environnement d'exécution (.NET/Mono/IL2CPP), quantifie le coût de calcul à l'aide de données de profilage, analyse le phénomène de déchirement temporel (*temporal tearing*) et évalue de manière exhaustive la solution de mise en cache par image (*Frame Caching*) ainsi que les standards architecturaux associés[^2].

---

## **1. Mécanismes internes de DateTime.Now et DateTime.UtcNow dans le runtime .NET**

La structure `System.DateTime` est stockée sous la forme d'un unique champ de valeur sur 64 bits (`UInt64 _dateData`)[^6]. Dans cette structure :
- **Les 62 bits de poids faible** représentent le nombre de Ticks accumulés depuis 00:00:00 le 1er janvier 0001 du calendrier grégorien, chaque tick correspondant à $100\text{ ns}$ ($10^{-7}\text{ s}$ ou $0.1\ \mu\text{s}$)[^1].
- **Les 2 bits de poids fort** sont réservés au stockage des indicateurs `DateTimeKind`, permettant d'identifier l'un des trois états contextuels : `Utc`, `Local` ou `Unspecified`[^1].

### **Flux d'exécution bas niveau de DateTime.UtcNow**

La propriété `DateTime.UtcNow` représente le temps universel coordonné et est conçue pour une optimisation maximale en termes de cycles processeur[^2]. Lorsqu'un processus appelle `DateTime.UtcNow`, l'environnement d'exécution .NET effectue une lecture directe depuis le minuteur matériel du système[^2] :

- Sur **Windows**, le code appelle directement la fonction Win32 API `GetSystemTimeAsFileTime` via un pointeur de fonction intrinsèque annoté pour contourner les barrières d'optimisation de compilation (`TargetedPatchingOptOut`)[^2].
- Sur les systèmes d'exploitation de type **POSIX** (y compris le noyau Linux sur Android et le noyau Darwin sur iOS/macOS), le système exécute l'appel bas niveau `clock_gettime(CLOCK_REALTIME, ...)`[^5].

La valeur temporelle brute renvoyée par le système d'exploitation nécessite uniquement l'ajout d'une constante de décalage fixe pour être synchronisée avec l'époque de référence du calendrier grégorien, puis est directement empaquetée dans une structure `DateTime` avec l'indicateur `DateTimeKind.Utc`[^2]. Ce processus ne requiert aucune résolution de table de correspondance, n'alloue aucune mémoire sur le tas et s'achève en quelques milliardièmes de seconde[^2].

### **Flux de résolution complexe de DateTime.Now**

À l'inverse de `DateTime.UtcNow`, la détermination de l'heure locale (`DateTime.Now`) exige une chaîne complexe d'opérations de conversion[^2]. La propriété `DateTime.Now` ne lit pas une horloge locale indépendante depuis le matériel ; elle repose entièrement sur le résultat de `DateTime.UtcNow` combiné à une séquence de calculs de décalage horaire[^2] :

```csharp
public static DateTime Now 
{
    get 
    {
        DateTime utcNow = UtcNow;
        bool isAmbiguousDst = false;
        long offset = TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc(utcNow, out isAmbiguousDst).Ticks;
        long ticks = utcNow.Ticks + offset;
        
        if (ticks > DateTime.MaxValue.Ticks)
            return new DateTime(DateTime.MaxValue.Ticks, DateTimeKind.Local);
        if (ticks < DateTime.MinValue.Ticks)
            return new DateTime(DateTime.MinValue.Ticks, DateTimeKind.Local);
            
        return new DateTime(ticks, DateTimeKind.Local);
    }
}
```

Ce processus commence par récupérer l'heure UTC actuelle, puis interroge l'objet `TimeZoneInfo.Local` pour déterminer la configuration de fuseau horaire de l'appareil[^2]. Le principal poste de consommation de ressources réside dans la fonction `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc`, où le runtime doit confronter l'horodatage actuel à la table des règles d'ajustement de fuseau horaire (*Adjustment Rules*) et aux conventions d'heure d'été (*Daylight Saving Time - DST*) afin de déterminer si l'instant présent se situe dans une période d'ajout d'une heure[^2].

Une fois le décalage exact exprimé en Ticks déterminé, le système effectue une addition arithmétique avec `utcNow.Ticks`, vérifie les conditions de débordement aux bornes et instancie une nouvelle structure `DateTime` avec l'étiquette `DateTimeKind.Local`[^2].

Les données de profilage de performance issues du dépôt officiel du runtime .NET fournissent la répartition détaillée du temps d'exécution de la méthode `DateTime.get_Now()`[^4] :

| Composant d'exécution dans `System.DateTime.get_Now()` | Part du temps cumulé (Inclusive %) | Nature technique de l'opération |
| :--- | :---: | :--- |
| `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc` | **88.1%** | Recherche des règles de conversion de fuseau horaire, vérification du drapeau DST, calcul du décalage[^4] |
| `System.DateTime.get_UtcNow()` | **5.8%** | Appel système (Syscall) de lecture du compteur matériel[^2] |
| Vérifications de bornes et empaquetage de la struct | **6.1%** | Validation de débordement d'entier 64 bits et attribution de `DateTimeKind.Local`[^4][^7] |

> [!IMPORTANT]
> Ces données démontrent que la lecture proprement dite de l'heure depuis l'horloge matérielle ne représente que **~5.8%** du coût total d'exécution, tandis que jusqu'à **~88.1%** du temps de traitement est consommé par la résolution du fuseau horaire et le calcul des règles d'heure d'été[^4].

### **Complexité accrue sur les environnements mobiles (Mono & IL2CPP)**

Sur les plateformes mobiles exécutant Unity via Mono ou IL2CPP, la complexité de `DateTime.Now` est multipliée par plusieurs facteurs[^5]. Alors que Windows maintient un Registre centralisé pour les informations de fuseaux horaires, les systèmes d'exploitation mobiles tels qu'Android stockent ces données dans la base binaire `tzdata` (`ZoneInfoDB`) répartie dans des répertoires système comme `/apex/com.android.tzdata/` ou `/system/usr/share/zoneinfo`[^5].

Lorsque `TimeZoneInfo.Local` est initialisé pour la première fois ou doit être revalidé, l'environnement Mono/IL2CPP est contraint d'effectuer des opérations d'E/S sur fichiers, d'analyser des données binaires ou même d'exécuter des appels inter-environnements via Java Native Interface (JNI) vers la classe `java.util.TimeZone` pour obtenir l'identifiant du fuseau horaire[^5].

> [!WARNING]
> Si le fichier de base de données des fuseaux horaires est corrompu, déplacé sur des ROM personnalisées ou restreint par des droits d'accès aux fichiers, l'appel à `DateTime.Now` peut lever une exception critique `System.TimeZoneNotFoundException`, provoquant un plantage brutal de l'application s'il n'est pas encapsulé dans des blocs de gestion d'exceptions[^10].

---

## **2. Analyse comparative des performances et impact sur le budget de trame**

Le coût d'exécution des méthodes de récupération temporelle varie considérablement selon l'architecture sous-jacente et l'état du cache du système d'exploitation[^5]. Le tableau ci-dessous synthétise les résultats normalisés des mesures de performance entre les mécanismes temporels courants dans Unity et .NET[^4] :

| Méthode de récupération temporelle | Temps d'exécution estimé | Ratio de vitesse relatif | Mécanisme d'exécution principal | Risque de pic de trame (Frame Spike) |
| :--- | :---: | :---: | :--- | :--- |
| `UnityEngine.Time.time` | $\sim 1\text{ - }2\text{ ns}$ | Optimal (Natif moteur) | Lecture directe d'une variable à virgule flottante mise en cache en début de frame | Aucun |
| `System.DateTime.UtcNow` | $\sim 15\text{ - }20\text{ ns}$ | $\sim 15\text{ - }20\times$ plus rapide que `Now` | Lecture directe de l'horloge matérielle via un appel système minimal[^2] | Négligeable |
| `System.DateTime.Now` (Warm Path) | $\sim 280\text{ - }350\text{ ns}$ | Référence de base ($1\times$) | Appelle UtcNow, accède au cache de fuseau horaire, calcule le décalage DST[^2] | Moyen à élevé en cas d'appels répétés |
| `System.DateTime.Now` (Cold Path / Mobile) | $\sim 1\text{ - }5\text{ ms}$ | Des milliers de fois plus lent ($\gt 3.000\times$) | Initialise les tables AndroidTzData, E/S disque, lecture de données binaires[^5] | Très élevé (Gel d'image) |

### **Contraintes du budget de trame dans la boucle de jeu**

Dans les applications interactives en temps réel, l'ensemble de la charge de travail — incluant la simulation cinématique, les calculs physiques, le traitement de la logique de jeu et l'envoi des commandes de rendu au GPU — doit être exécuté dans un intervalle de temps fini défini par la formule :

$$
T_{\text{frame}} = \frac{1000\text{ ms}}{\text{Target FPS}}
$$

- À une fréquence de rafraîchissement standard de **$60\text{ Hz}$** ($60\text{ FPS}$), le budget par image est de **$16.67\text{ ms}$**.
- Ce chiffre se réduit à seulement **$8.33\text{ ms}$** pour les écrans à haute fréquence de rafraîchissement de **$120\text{ Hz}$** ($120\text{ FPS}$).

Une base de code contenant de nombreux appels à `DateTime.Now` dispersés dans les boucles de mise à jour d'entités — tels que les compteurs de recharge de compétences pour des dizaines de personnages non-joueurs (PNJ), les vérifications d'état de bonus ou la logique d'événements en heure réelle — accumule des centaines voire des milliers d'appels système à chaque image.

Avec **500 appels chauds à `DateTime.Now`** par image, le système consomme environ **$\sim 0.15\text{ ms}$** ($150\,\mu\text{s}$) rien que pour les calculs de décalage horaire, absorbant jusqu'à **$\sim 1.8\%$** du budget total d'une image à **$120\text{ Hz}$**. Cette surcharge provoque directement des chutes de fréquence d'images et des saccades localisées, ce qui explique pourquoi l'outil d'analyse statique Unity Project Auditor attribue un avertissement rouge de sévérité élevée (*Major Issue*) à l'utilisation de `DateTime.Now` dans les chemins de mise à jour continus[^3].

---

## **3. Phénomène de déchirement temporel (Temporal Tearing) et erreurs d'intégrité des données**

Outre la dégradation des performances CPU, la dispersion des appels à `DateTime.Now` pour extraire individuellement chaque composante d'un horodatage entraîne une faille grave d'atomicité des données (*Data Atomicity*). Le code d'origine rencontre cette vulnérabilité lors de l'exécution de comparaisons indépendantes :

```csharp
if (requirement.CheckYear)   results.Add(DateTime.Now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(DateTime.Now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(DateTime.Now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(DateTime.Now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(DateTime.Now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(DateTime.Now.Second == requirement.Second);
```

### **Mécanisme d'apparition d'états hybrides anormaux**

Par nature, la propriété `DateTime.Now` est un accesseur qui calcule un état dépendant du temps objectif au moment exact de l'appel, et non un champ de données statique[^20]. Chaque fois que le code accède à une sous-propriété telle que `.Year`, `.Month` ou `.Day`, le système exécute un cycle de requête auprès du système d'exploitation entièrement nouveau[^2].

Bien que l'intervalle entre des instructions consécutives ne dure que quelques microsecondes, le fil d'exécution peut parfaitement être interrompu par le mécanisme d'ordonnancement multitâche à partage de temps du système d'exploitation, ou le moment d'exécution peut coïncider avec une frontière de bascule naturelle de l'horloge système[^8].

> [!CAUTION]
> **Scénario d'erreur de transition aux bornes (Boundary Edge-Case) :**  
> Supposons que le thread exécute la vérification du mois exactement à `23:59:59.999` le 31 août 2024. La propriété `DateTime.Now.Month` est évaluée à cet instant et renvoie la valeur **août (8)**.  
>  
> Immédiatement après l'achèvement de cette instruction et avant l'exécution de la vérification du jour suivante, l'horloge système bascule à `00:00:00.000` le 1er septembre 2024. Lorsque l'instruction `DateTime.Now.Day` s'exécute, le système d'exploitation fournit le nouvel horodatage et cette propriété renvoie la valeur **jour 1**.  
>  
> En conséquence, la logique système recueille un état hybride incohérent : **1er août** — un instant temporel qui n'a absolument jamais existé dans le déroulement physique du temps !

Si cet horodatage erroné est utilisé pour déclencher des événements à durée limitée, vérifier la connexion pour des récompenses périodiques ou journaliser des transactions en jeu, cette divergence peut casser la logique de validation conditionnelle, bloquer involontairement des fonctionnalités ou permettre aux joueurs de réclamer des récompenses en double.

---

## **4. Évaluation technique de la solution Frame Caching**

Pour éliminer totalement le coût de calcul redondant et prévenir radicalement le phénomène de déchirement temporel, la solution optimale consiste à déployer un modèle de mise en cache par image (*Frame Caching / Per-frame Memoization*), en utilisant le compteur d'images d'Unity Engine (`UnityEngine.Time.frameCount`) comme clé d'invalidation de la validité des données[^22].

### **Analyse du flux de fonctionnement du cache par image**

Le code d'implémentation du mécanisme de mise en cache est structuré comme suit :

```csharp
private static DateTime _cachedSystemTime;  
private static int _lastSystemTimeFrame = -1;

private static DateTime GetCurrentSystemTime()  
{  
    if (Application.isPlaying)  
    {  
        int currentFrame = Time.frameCount;  
        if (_lastSystemTimeFrame != currentFrame)  
        {  
            _lastSystemTimeFrame = currentFrame;  
            _cachedSystemTime = DateTime.Now;  
        }  
        return _cachedSystemTime;  
    }  
    return DateTime.Now;  
}
```

Lorsque la logique de contrôle temporel doit effectuer une interrogation, l'horodatage est récupéré une seule fois dans une variable locale afin d'être réutilisé tout au long des vérifications :

```csharp
DateTime now = GetCurrentSystemTime();  
if (requirement.CheckYear)   results.Add(now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(now.Second == requirement.Second);
```

Ce mécanisme apporte deux améliorations décisives :

1. **Réduction de la complexité algorithmique :** Elle passe d'une complexité linéaire $\mathcal{O}(N)$ dépendante du nombre d'entités à une complexité constante $\mathcal{O}(1)$ par image rendue. Tout appel survenant après le premier appel au sein d'une même image lit directement la valeur de la structure `DateTime` 64 bits stockée en mémoire statique, éliminant totalement le coût des appels système et des calculs de fuseau horaire[^2].
2. **Préservation de l'atomicité de l'instantané temporel (*Snapshot Atomicity*) :** La variable `now` agit comme une coupe temporelle immuable pour l'ensemble de l'image, garantissant que toutes les composantes, de l'année jusqu'à la seconde, restent cohérentes et ne peuvent être scindées par des interruptions système.

### **Analyse des limites aux bornes et risques lors du déploiement réel**

Bien que la solution de mise en cache par image résolve totalement le problème sur le thread principal d'Unity, son intégration dans des architectures logicielles à grande échelle exige un examen attentif de trois contraintes techniques majeures :

1. **Affinité au thread principal (Main Thread Affinity) :** La propriété `UnityEngine.Time.frameCount` est une API interne de la couche C++ du moteur strictement liée au thread principal[^24]. Si un traitement en arrière-plan — tel qu'une tâche de fond (`Task.Run`), un rappel réseau asynchrone ou une tâche du C# Job System — appelle la méthode `GetCurrentSystemTime()`, Unity lève immédiatement l'exception `UnityException: get_frameCount can only be called from the main thread` et interrompt l'exécution[^24].
2. **Désynchronisation de cadence entre Update et FixedUpdate :** Le cycle de vie d'exécution d'Unity comporte deux rythmes de mise à jour indépendants : la boucle de rendu graphique (`Update`) et la boucle de simulation physique à pas fixe (`FixedUpdate`)[^25]. La valeur `Time.frameCount` n'est incrémentée d'une unité par le moteur que lors du passage à une nouvelle image de rendu[^22]. Si le poste client subit une chute de fréquence d'images, le moteur peut être contraint de déclencher plusieurs cycles `FixedUpdate` consécutifs au cours d'une même image de rendu afin de rattraper la simulation physique[^23]. Dans ce cas, tous les cycles `FixedUpdate` exécutés durant cette même image liront la même valeur en cache `_cachedSystemTime`, ce qui peut ne pas refléter l'écoulement du temps entre des pas de simulation physique successifs[^26].
3. **Risque de concurrence sur les données (Data Race) :** L'accès aux variables statiques globales `_cachedSystemTime` et `_lastSystemTimeFrame` sans mécanisme de barrières mémoire (*Memory Barriers*) ni verrouillage d'accès expose à des conflits de données si des threads secondaires lisent ou écrivent simultanément sur des architectures de processeurs multicœurs utilisant la réorganisation d'instructions (*out-of-order execution*).

### **Implémentation d'un fournisseur de temps système thread-safe**

Pour pallier l'ensemble des contraintes techniques susmentionnées, le système temporel doit être standardisé sous la forme d'un service dédié capable d'identifier le contexte d'exécution du thread, de garantir la sécurité d'accès et de gérer automatiquement les cas limites :

```csharp
using System;  
using System.Threading;  
using UnityEngine;

public static class SystemTimeProvider  
{  
    private static DateTime _mainThreadCachedTime;  
    private static int _lastFrameCount = -1;  
    private static int _mainThreadId;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]  
    private static void Initialize()  
    {  
        _mainThreadId = Thread.CurrentThread.ManagedThreadId;  
        _lastFrameCount = -1;  
    }

    public static DateTime CurrentLocalTime  
    {  
        get  
        {  
            if (Application.isPlaying && Thread.CurrentThread.ManagedThreadId == _mainThreadId)  
            {  
                int currentFrame = Time.frameCount;  
                if (_lastFrameCount != currentFrame)  
                {  
                    _lastFrameCount = currentFrame;  
                    _mainThreadCachedTime = DateTime.Now;  
                }  
                return _mainThreadCachedTime;  
            }

            return DateTime.Now;  
        }  
    }

    public static DateTime CurrentUtcTime => DateTime.UtcNow;  
}
```

Cette architecture garantit que le thread principal bénéficie toujours du cache par image sans craindre les calculs redondants, tandis que les threads d'arrière-plan ou le mode Éditeur maintiennent un fonctionnement stable grâce au mécanisme de repli direct, éliminant tout risque d'exception liée à la violation des droits d'accès aux threads du moteur[^24].

---

## **5. Standards de séparation des domaines temporels dans l'architecture des moteurs de jeu**

Une erreur courante dans le développement de jeux vidéo consiste à mélanger différents besoins d'usage temporel au sein d'une même API système[^2]. Pour préserver des performances optimales et la cohérence de l'état du jeu, l'architecture système doit tracer des frontières nettes entre des domaines temporels indépendants :

| Domaine temporel (Time Domain) | API standard recommandée | Cas d'usage principaux | Risque en cas d'utilisation d'une mauvaise API |
| :--- | :--- | :--- | :--- |
| **Simulation de gameplay interne** | `UnityEngine.Time.time`, `Time.deltaTime` | Calculs de coordonnées physiques, déplacement des personnages, temps de recharge des compétences | Se fige lors de la mise en pause du jeu (`timeScale = 0`) ; manque de précision si l'heure réelle est requise[^26] |
| **Affichage d'interface en temps réel** | `UnityEngine.Time.unscaledTime`, `Time.realtimeSinceStartup` | Animations de menus d'interface (UI), effets de transition lorsque le jeu est en pause | Lié à la session d'exécution du processus client, ne peut être projeté sur le calendrier du monde réel |
| **Mesure de performance algorithmique** | `System.Diagnostics.Stopwatch` | Mesure du temps d'exécution d'algorithmes, profilage de blocs de code, détection de régressions de performance[^7] | La résolution de `DateTime.Now` n'atteint que $\sim 15.6\text{ ms}$, insuffisante pour le benchmarking[^7] |
| **Validation logique anti-triche** | Époque Unix (UTC) synchronisée depuis le serveur[^28] | Systèmes d'énergie, minuteries d'ouverture de coffres, fenêtres d'événements en ligne[^28] | En faisant confiance à l'horloge client, les joueurs peuvent modifier l'heure du système pour exploiter des récompenses[^28] |
| **Affichage du calendrier local** | `SystemTimeProvider.CurrentLocalTime` | Affichage de l'heure réelle de l'utilisateur dans les barres d'état UI[^2] | Provoque des saccades d'image si `DateTime.Now` brut est appelé en continu sans cache[^2] |

### **Mécanismes de synchronisation temporelle serveur et anti-triche (Anti-Cheat)**

Pour les jeux dotés de fonctionnalités en ligne, permettre au client d'auto-valider les horodatages d'exécution d'actions à partir de `DateTime.Now` ou `DateTime.UtcNow` locaux crée une faille de sécurité critique[^28]. Les utilisateurs peuvent facilement modifier les paramètres d'horloge du système d'exploitation pour accélérer les comptes à rebours de construction ou réinitialiser les compteurs d'activité quotidiens[^28].

L'architecture standardisée pour neutraliser ce type de triche impose au client d'établir une horloge virtuelle ancrée sur une horloge monotone (*monotonic clock*)[^5] :

1. **Envoi d'une requête de synchronisation :** Lorsque le client établit une connexion réseau, une requête de synchronisation temporelle est envoyée au serveur de service afin de recevoir l'horodatage standard Unix Epoch en UTC[^28].
2. **Mesure de la latence aller-retour :** Le client mesure le temps aller-retour du paquet ($RTT$) et estime l'horodatage réel du serveur au moment de l'arrivée de la réponse via la formule :
   $$T_{\text{server}} = T_{\text{server\_reply}} + \frac{RTT}{2}$$
3. **Détermination du décalage monotone :** Le client calcule et conserve l'écart fixe par rapport au compteur monotone matériel :
   $$\Delta t = T_{\text{server}} - \text{Time.realtimeSinceStartupAsDouble}$$
4. **Interrogation du temps résistant à la triche :** Tout au long du cycle de vie de l'application, toute logique de gameplay nécessitant de vérifier l'heure réelle évalue simplement la valeur :
   $$\text{CurrentRealTime} = \text{Time.realtimeSinceStartupAsDouble} + \Delta t$$
   Le compteur de temps de démarrage du moteur reposant sur un mécanisme de comptage monotone matériel (`clock_gettime(CLOCK_MONOTONIC)` ou `QueryPerformanceCounter`), cette valeur croît de manière strictement linéaire et demeure totalement immunisée contre toute manipulation de l'horloge calendaire du système d'exploitation[^5].

### **Transition architecturale vers le standard moderne avec TimeProvider (.NET 8+)**

À partir de .NET 8, Microsoft a officiellement restructuré l'ensemble du modèle de gestion du temps en introduisant la classe abstraite `System.TimeProvider` pour remplacer intégralement les appels statiques directs tels que `DateTime.Now` ou `DateTime.UtcNow`[^20]. Pour les projets Unity modernes, via le paquet de compatibilité `Microsoft.Bcl.TimeProvider`, les développeurs peuvent adopter cette architecture afin d'améliorer la modularité du code source[^32]:

```csharp
public sealed class GameTimeService  
{  
    private readonly TimeProvider _timeProvider;

    public GameTimeService(TimeProvider timeProvider = null)  
    {  
        _timeProvider = timeProvider ?? TimeProvider.System;  
    }

    public DateTimeOffset GetCurrentTime() => _timeProvider.GetLocalNow();  
}
```

Le passage à ce modèle d'abstraction offre deux avantages majeurs sur le plan technique :

> [!TIP]
> 1. **Tests unitaires isolés (Unit Testing) :** Permet d'appliquer rigoureusement le modèle de tests unitaires[^20]. Les ingénieurs peuvent injecter un objet simulé `FakeTimeProvider` dans la logique métier afin de simuler avec précision des cas de test sautant à travers des transitions temporelles complexes (telles que le passage à l'heure d'été DST ou le réveillon du Nouvel An) sans avoir à attendre le temps réel ni à modifier l'horloge système[^20].  
> 2. **Type de données `DateTimeOffset` sûr :** La méthode `GetLocalNow()` renvoie une structure `DateTimeOffset` au lieu de `DateTime`[^20]. La structure `DateTimeOffset` stocke de manière immuable un horodatage accompagné d'un décalage horaire explicite (*offset*), éliminant totalement les états ambigus du drapeau `DateTimeKind.Unspecified` et garantissant l'intégrité lors de la sérialisation des données envoyées sur le réseau[^1].

---

## **5. Mise en pratique : optimisation du système RequirementsManager (Étude de cas)**

Dans le cadre d'un projet réel utilisant le framework RPG Builder (Projet GLW), un grave problème de performance a été découvert dans la classe `RequirementsManager.cs`. Plus précisément, le système de vérification des conditions temporelles du jeu (par exemple : exiger qu'un événement se produise exactement à un mois, un jour et une heure donnés) appelait continuellement `DateTime.Now` de manière fragmentée à de multiples reprises :

```csharp
if(requirement.CheckYear) results.Add(DateTime.Now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(DateTime.Now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(DateTime.Now.Day == requirement.Day);
// ... Répéter pour Hour, Minute, Second
```

**Problèmes issus de l'ancien code source :**
1. **Surcharge CPU massive :** Pour vérifier 1 requirement, le système pouvait déclencher jusqu'à 7 à 10 appels à `DateTime.Now` (y compris dans des fonctions auxiliaires comme `GetWeekNumber()`). Avec 100 entités évaluées simultanément, des milliers d'appels système vers l'OS étaient effectués à chaque image, provoquant un goulot d'étranglement sévère.
2. **Temporal Tearing (Décalage d'instant) :** Si le basculement entre deux secondes (ou minutes, jours) tombait exactement au milieu de la lecture des instructions ci-dessus (par exemple à la milliseconde 999), la variable `Month` pouvait être lue sur l'ancien mois tandis que la variable `Day` était lue sur le nouveau jour. En conséquence, le jeu assemblait un horodatage totalement inexistant en réalité.

**Solution déployée en production (Per-Frame Caching) :**
L'architecture Frame Caching a été intégrée directement, en utilisant `Time.frameCount` comme indicateur d'invalidation du cache. Cette approche exploite un cycle de vie statique plutôt qu'une boucle Update :

```csharp
private static DateTime _cachedSystemTime;
private static int _lastSystemTimeFrame = -1;

private static DateTime GetCurrentSystemTime()
{
    if (Application.isPlaying) 
    {
        int currentFrame = Time.frameCount;
        
        // Ne récupérer l'heure réelle depuis l'OS qu'une seule fois par image
        if (_lastSystemTimeFrame != currentFrame)
        {
            _lastSystemTimeFrame = currentFrame;
            _cachedSystemTime = DateTime.Now; 
        }
        
        return _cachedSystemTime;
    }
    return DateTime.Now; // Mode Éditeur
}
```

Là où la logique doit être traitée, l'ensemble des vérifications se réfère à un unique **instantané (snapshot)** temporel :

```csharp
DateTime now = GetCurrentSystemTime();
if(requirement.CheckYear) results.Add(now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(now.Day == requirement.Day);
```

**Résultats après optimisation (Correctif `MOD-RPGB-008`) :**
- **Élimination complète des syscalls redondants :** Au lieu de milliers d'appels, `DateTime.Now` est ramené à une complexité $\mathcal{O}(1)$ — exactement 1 seule fois pour tous les calculs sur chaque image.
- **Cohérence atomique absolue :** Les champs `Year`, `Month` et `Day` appartiennent avec certitude au même instant exact.
- **Nettoyage du rapport Unity Project Auditor :** Suppression totale de l'avertissement « Major » relatif aux performances système liées à `System.DateTime`.

---

## **6. Conclusion**

L'utilisation directe de `System.DateTime.Now` dans les boucles de mise à jour à haute fréquence d'Unity Engine constitue un problème technique majeur tant pour les performances matérielles que pour l'intégrité des données logiques[^3].

- La nature complexe des appels système de résolution des fuseaux horaires et d'évaluation des règles d'heure d'été (DST) consomme plus de **88%** du temps d'exécution de cette propriété, exerçant une pression directe sur le budget de trame du moteur de jeu[^4].
- Parallèlement, la lecture de multiples sous-propriétés à partir d'appels `DateTime.Now` distincts ouvre la porte au déchirement temporel (*temporal tearing*), engendrant des horodatages hybrides qui corrompent la logique de jeu[^21].

La solution de mise en cache par image (**Frame Caching**) associée à la propriété `Time.frameCount` résout radicalement ces deux problèmes en ramenant la consommation CPU à une constante minimale **$\mathcal{O}(1)$** par image, tout en garantissant l'atomicité immuable des instantanés temporels[^22].

Lors d'un déploiement à l'échelle d'un projet commercial, cette architecture doit être complétée par une couche de protection du thread d'exécution (`SystemTimeProvider`), étroitement couplée à un mécanisme de validation temporelle faisant autorité côté serveur (*Server-Authoritative Time*) pour prévenir la triche, et orientée vers une standardisation avec la classe abstraite `TimeProvider` afin de répondre pleinement aux standards d'ingénierie modernes de l'industrie logicielle[^20].

---

## **Références**

[^1]: [DateTime Struct (System) | Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.datetime?view=net-10.0)  
[^2]: [The Darkness Behind DateTime.Now - DZone](https://dzone.com/articles/darkness-behind-datetimenow)  
[^3]: [Changelog | Project Auditor | 1.0.2 - Unity - Manual](https://docs.unity3d.com/Packages/com.unity.project-auditor@1.0/changelog/CHANGELOG.html)  
[^4]: [Make DateTime.Now as efficient as DateTime.UtcNow · Issue #24277](https://github.com/dotnet/runtime/issues/24277)  
[^5]: [DateTimeOffset.Now TimeZone data impacts Android startup #71004](https://github.com/dotnet/runtime/issues/71004)  
[^6]: [mono/mcs/class/referencesource/mscorlib/system/datetime.cs at main](https://github.com/mono/mono/blob/master/mcs/class/referencesource/mscorlib/system/datetime.cs)  
[^7]: [[C#] DateTime 구조체 파헤치기 - Second Step - 티스토리](https://sikpang.tistory.com/41)  
[^8]: [c# - Optimizing alternatives to DateTime.Now - Stack Overflow](https://stackoverflow.com/questions/1561791/optimizing-alternatives-to-datetime-now)  
[^9]: [DateTime.Now return 1hour off when compared to device time in - Mono #20510](https://github.com/mono/mono/issues/20510)  
[^10]: [TimeZoneNotFoundException in DateTime.Now #8090 - GitHub](https://github.com/xamarin/xamarin-android/issues/8090)  
[^11]: [TimeZoneInfo.Unix.cs - GitHub](https://github.com/dotnet/corert/blob/master/src/System.Private.CoreLib/shared/System/TimeZoneInfo.Unix.cs)  
[^12]: [Abstracting System Time in ASP.NET Applications - Redgate](https://www.red-gate.com/simple-talk/development/dotnet-development/abstracting-system-time-asp-net-applications/)  
[^13]: [TimeZoneNotFoundException on calling DateTimeOffset.Now #5080](https://github.com/dotnet/android/issues/5080)  
[^14]: [mono/mcs/class/corlib/System/TimeZoneInfo.Android.cs at main](https://github.com/mono/mono/blob/master/mcs/class/corlib/System/TimeZoneInfo.Android.cs)  
[^15]: [[Bug] Occasional crash in TouchEffect because of wrong time zone #1999](https://github.com/xamarin/XamarinCommunityToolkit/issues/1999)  
[^16]: [Stopwatch is more efficient than DateTime.Now - Doug Linder](https://vathsalas.wordpress.com/2015/02/12/stopwatch-is-more-efficient-than-datetime-now/)  
[^17]: [C# SDK Release Notes - Realtime 5 - Photon Fusion 2](https://doc.photonengine.com/realtime/v5/getting-started/release-notes)  
[^18]: [Changelog | Project Auditor | 0.10.0 - Unity - Manual](https://docs.unity3d.com/Packages/com.unity.project-auditor@0.10/changelog/CHANGELOG.html)  
[^19]: [[Unity] Project Auditor로 프로젝트 최적화하기 - 조다록 - 티스토리](https://zodang.tistory.com/82)  
[^20]: [TimeProvider and ITimer: Writing Unit Tests with Time in .NET 8](https://www.infoq.com/articles/dotnet-unit-tests-time-timezone/)  
[^21]: [How frequent is DateTime.Now updated ? or is there a more precise - Stack Overflow](https://stackoverflow.com/questions/307582/how-frequent-is-datetime-now-updated-or-is-there-a-more-precise-api-to-get-the)  
[^22]: [Is Update() called on the very first frame in Unity? - GameDev Stack Exchange](https://gamedev.stackexchange.com/questions/163058/is-update-called-on-the-very-first-frame-in-unity)  
[^23]: [Is there an equivalent of Time.frameCount for physics updates? - Unity Discussions](https://discussions.unity.com/t/is-there-an-equivalent-of-time-framecount-for-physics-updates/160506)  
[^24]: [UniTask.Delay restricted to main thread? · Issue #96 - GitHub](https://github.com/Cysharp/UniTask/issues/96)  
[^25]: [Time and frame rate management - Unity - Manual](https://docs.unity3d.com/2021.3/Documentation/Manual/TimeFrameManagement.html)  
[^26]: [Manual: Time and Framerate Management - Unity](https://docs.unity.cn/520/Documentation/Manual/TimeFrameManagement.html)  
[^27]: [What runs more often? Update, FixedUpdate or OnGUI - Unity Discussions](https://discussions.unity.com/t/what-runs-more-often-update-fixedupdate-or-ongui-documentation-mistake/475289)  
[^28]: [Simple server time anti-cheat • Cloud Code - Unity Documentation](https://docs.unity.com/en-us/cloud-code/scripts/use-cases/server-time-anti-cheat)  
[^29]: [Time synchronization | Unity NetCode | 0.0.4-preview.0](https://docs.unity3d.com/Packages/com.unity.netcode@0.0/manual/time-synchronization.html)  
[^30]: [System.DateTime.now and how to avoid time cheats (468724) - Unity Discussions](https://discussions.unity.com/t/system-datetime-now-and-how-to-avoid-time-cheats-468724/468724)  
[^31]: [Unity, NTP time, gets blocked - Stack Overflow](https://stackoverflow.com/questions/29220820/unity-ntp-time-gets-blocked)  
[^32]: [ZLogger v2 Architecture: Leveraging .NET 8 to Maximize Performance](https://neuecc.medium.com/zlogger-v2-architecture-leveraging-net-8-to-maximize-performance-2d9733b43789)  
[^33]: [Microsoft.Extensions.TimeProvider.Testing 10.7.0 - NuGet](https://www.nuget.org/packages/Microsoft.Extensions.TimeProvider.Testing/10.7.0)  
[^34]: [ZLogger v2 による .NET 8活用事例 と Unity C# 11対応の紹介](https://neue.cc/2023/12/19_zlogger2.html)  
[^35]: [referencesource/mscorlib/system/datetimeoffset.cs at main - GitHub](https://github.com/microsoft/referencesource/blob/master/mscorlib/system/datetimeoffset.cs)
