---
title: "Unity-Performance-Optimierung: Speicherallokationen (GC Alloc) durch Resources.FindObjectsOfTypeAll verstehen und beheben"
date: 2026-09-25 09:26:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, memory, gc-alloc, csharp, dotnet, beginner-guide]
description: Ausführlicher Einsteiger-Leitfaden zu den Ursachen von Rucklern (Frame Spikes) durch übermäßigen Einsatz von Resources.FindObjectsOfTypeAll in Unity und den 4 besten Optimierungsmethoden.
lang: de
translation_id: unity-gc-alloc-resources-findobjectsoftypeall
math: true
---

Bei der Spieleentwicklung mit Unity bist du sicher schon auf Situationen gestoßen, in denen du ein bestimmtes `GameObject` oder eine `Component` suchen musstest. Unity bietet dafür zahlreiche Funktionen wie `Find`, `FindObjectOfType` und insbesondere `Resources.FindObjectsOfTypeAll`.

Obwohl `Resources.FindObjectsOfTypeAll` extrem leistungsstark ist, weil sie **alles** finden kann (einschließlich deaktivierter Objekte — inactive, Prefabs in Projektordnern oder noch nicht gespawnter Ressourcen), ist sie zugleich einer der stillen „Killer“, die die Performance deines Spiels zerstören, wenn sie nicht richtig eingesetzt wird.

Dieser Artikel hilft dir genau zu verstehen, warum diese Methode so gefährlich ist, wie Analyse-Tools (Profiler / Project Auditor) davor warnen, und führt dich detailliert durch die Optimierungsmethoden, um Speichermüll (Garbage Collection Allocation — GC Alloc) vollständig zu beseitigen.

---

## **1. Warum schadet `Resources.FindObjectsOfTypeAll` der Performance?**

Wenn du den Unity Memory Profiler oder Project Auditor ausführst, stößt du möglicherweise auf eine gelbe Warnung (Moderate):
> *"Resources.FindObjectsOfTypeAll() allocates managed memory."*

Um zu verstehen, warum das passiert, müssen wir uns ansehen, wie diese Funktion unter der Haube der Engine (C++-Kern) arbeitet:

1. **Durchsuchen des gesamten Speichers (Hohe CPU-Last)**: Im Gegensatz zu `FindObjectOfType`, die nur aktive Objekte in der Scene durchsucht, durchsucht `Resources.FindObjectsOfTypeAll` den **gesamten** Speicher der Engine. Sie durchläuft alle Scene-Objekte, Editor-Objekte (wenn man sich im Editor befindet) sowie alle bereits in den RAM geladenen Ressourcen (Assets). Je größer das Projekt, desto langsamer läuft diese Funktion.
2. **Erzeugen von Speichermüll (GC Allocation)**: Jedes Mal, wenn diese Funktion fertig ausgeführt wurde, erstellt sie **immer** ein neues Array (`Array`) auf dem Managed Heap von C#, um die zurückgegebenen Ergebnisse aufzunehmen.

**Die Folge:** Wenn du diese Methode wiederholt aufrufst (z. B. in `Update()` oder bei jedem Klick auf einen UI-Button), wirfst du laufend Müll (alte Arrays) in den Speicher. Sobald der Speicher voll ist, wird der Garbage Collector (GC) von Unity gezwungen einzugreifen. Dieser Bereinigungsprozess lässt das Spiel für einen kurzen Moment einfrieren und verursacht für die Spieler ein sehr unangenehmes **Ruckeln (Stuttering)**.

---

## **2. 4 Optimierungsmethoden (Best Practices)**

Um dieses Problem gründlich zu lösen, kannst du je nach Anwendungsfall eine der folgenden 4 bewährten Methoden anwenden, die aus der Erfahrung von Unity-Optimierungsingenieuren stammen.

### **Methode 1: Direkte Referenz über den Inspector (Am meisten empfohlen)**
Der schnellste Weg mit 0 CPU- und RAM-Kosten besteht darin, **gar nichts zu suchen**. Anstatt Code zum Suchen eines Objekts zu verwenden, deklariere eine `public`- oder `[SerializeField]`-Variable und ziehe das Objekt per Drag-and-drop direkt im Inspector von Unity hinein.

```csharp
// ❌ VERMEIDEN: Kostspielige Suche
void Start() {
    // Diese Methode erzeugt GC Alloc
    myManager = (GameManager)Resources.FindObjectsOfTypeAll(typeof(GameManager))[0]; 
}

// ✅ AM BESTEN: Direkte Referenz
[SerializeField] private GameManager myManager; 
// (GameManager im Unity Editor per Drag-and-drop in dieses Feld ziehen)
```

### **Methode 2: Caching (Zwischenspeicherung) und Singleton**
Wenn du zwingend per Code suchen musst, **solltest du nur ein einziges Mal suchen** (z. B. in `Awake()` oder `Start()`) und das Ergebnis anschließend in einer Variable speichern (cachen), um es bei weiteren Aufrufen wiederzuverwenden.

Bei gemeinsam genutzten Systemen wie `UIManager` oder `AudioManager` solltest du das Singleton-Muster oder eine statische Property (`static`) verwenden, um global ohne Suchkosten darauf zuzugreifen.

```csharp
// ❌ VERMEIDEN: Suchfunktion bei jedem Textbedarf erneut aufrufen
public string GetLocalizedText(string key) {
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetText(key);
}

// ✅ BESSER: In einer static-Variable cachen (nur 1-mal suchen)
public static UIManager SharedUIManager;

void Awake() {
    if (SharedUIManager == null) 
        SharedUIManager = FindAnyObjectByType<UIManager>(); // 1-mal suchen
}

public string GetLocalizedText(string key) {
    return SharedUIManager.GetText(key); // Sofortige Wiederverwendung, 0 Kosten
}
```

### **Methode 3: Umstieg auf moderne Unity-6-APIs**
Früher, in den ersten Versionen von Unity 2023, verwendete Unity beim Ersetzen von `FindObjectsOfType` noch das Enum `FindObjectsSortMode`:

```csharp
// ⚠️ Veraltet (Unity 2023.1 - 2023.2):
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
```
Allerdings **wurde das Enum `FindObjectsSortMode` ab Unity 6 offiziell als veraltet (Deprecated / Obsolete) markiert**, da die Engine von 32-Bit-`InstanceID`s auf einen neuen Mechanismus zur Objektidentifikation umgestellt hat und die Sortierung entfernt wurde, um die Performance zu maximieren.

Gemäß der offiziellen Dokumentation von Unity 6 solltest du die folgenden standardisierten Overloads verwenden:

```csharp
// ❌ Veraltet (Unity 2022 und älter - Langsam, erzwingt Array-Sortierung)
var managers = FindObjectsOfType<GameManager>();

// ✅ Unity-6-Standard: 1 beliebiges Objekt abrufen (Am schnellsten, Zero-Alloc)
// Allokiert kein Array auf dem Heap, gibt sofort das erste gefundene Objekt zurück
var manager = FindAnyObjectByType<GameManager>(); 

// ✅ Unity-6-Standard: Liste mehrerer Objekte abrufen (Ohne den inzwischen Obsolete-Parameter SortMode)
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude);
```

> 💡 **Tipp:** `FindAnyObjectByType<T>()` ist deutlich besser optimiert als `FindFirstObjectByType<T>()`, wenn du nur eine einzige Instanz hast (z. B. Manager/Controller), da ihr die Reihenfolge in der Hierarchie egal ist und sie sofort das erste gefundene Objekt zurückgibt.

#### ⚠️ **Häufiges Missverständnis: Gibt es `Resources.FindObjectsOfTypeNonAlloc`?**
Viele Entwickler kennen die Array-wiederverwendenden Funktionen von Unity (wie `Physics.RaycastNonAlloc` oder `GetComponentsNonAlloc`) und nehmen an, dass `Resources` ebenfalls eine ähnliche `NonAlloc`-Funktion besitzt.
Tatsächlich gilt laut der offiziellen Unity-Dokumentation: **Es existiert ÜBERHAUPT KEINE Funktion `Resources.FindObjectsOfTypeNonAlloc`**. `Resources.FindObjectsOfTypeAll` wird bei jedem Aufruf **immer** ein neues Array auf dem Managed Heap erstellen.

Wenn du die Liste aller Objekte in der Scene verfolgen musst und **absolut 0 GC Alloc** erreichen willst, verwende das **Selbstregistrierungs-Muster (Static Registration Pattern)**:

```csharp
// ✅ Zero-GC-Alloc-Lösung: Selbstregistrierung in der Liste bei Aktivierung
public class Enemy : MonoBehaviour 
{
    // Gemeinsame statische Liste, verwendet Speicher ohne Neuallokation wieder
    public static readonly List<Enemy> ActiveEnemies = new();

    void OnEnable()  => ActiveEnemies.Add(this);
    void OnDisable() => ActiveEnemies.Remove(this);
}

// Überall im Spiel, wo Zugriff benötigt wird:
// Direkt Enemy.ActiveEnemies verwenden — Dutzende Male schneller als Find und komplett 0 GC Alloc!
```

### **Methode 4: Editor-Tools mit `#if UNITY_EDITOR` kapseln**
Manchmal lädst du ein Plugin aus dem Asset Store herunter (z. B. ein Animationssystem oder ein UI-Tool), das `Resources.FindObjectsOfTypeAll` enthält. Meistens dienen diese Methoden lediglich dazu, Hilfs-Buttons in der Entwicklungsumgebung (Editor) zu bedienen.

Damit diese Funktionen nicht in die endgültige Spielversion (Build Player) „durchsickern“ und Warnungen auslösen, kannst du sie mit der Präprozessor-Direktive `#if UNITY_EDITOR` umschließen. Der Code darin wird beim Exportieren des Spiels vollständig entfernt.

```csharp
#if UNITY_EDITOR 
// Dieser Code läuft nur, wenn du im Unity Editor arbeitest
// Er wird beim Build als .exe oder .apk vollständig entfernt
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    if (reOfType != null) return reOfType.ToList();
    return null;
}
#endif 
```

---

## **3. Praxisbeispiele: Gründliche Behebung im Spieleprojekt**

Um die praktische Anwendung klar zu verstehen, schauen wir uns die 2 häufigsten Szenarien an, in denen ein Projekt vom Unity Project Auditor oder Profiler Speichermüll-Warnungen aus Third-Party-Asset-Paketen erhält:

### **Szenario 1: Das UI-Lokalisierungssystem durchsucht bei jedem Sprachwechsel den gesamten RAM**
* **Problem**: Jedes Mal, wenn ein UI-Text angezeigt werden muss oder ein Interface-Sound abgespielt wird, ruft die Hilfsfunktion `Resources.FindObjectsOfTypeAll(typeof(UIManager))[0]` auf. Das führt dazu, dass jedes Öffnen eines Menüs den gesamten RAM scannt und ein Wegwerf-Array auf dem Heap erzeugt.
* **Lösung**:
  1. `FindAnyObjectByType<UIManager>()` verwenden, um ein einziges Mal bei der Initialisierung (`Awake`) zu suchen.
  2. Eine statische Property `SharedUIManager` zum Zwischenspeichern (Cache) erstellen, wodurch der Suchvorgang zu einem sofortigen $O(1)$-Zugriff mit **0 Byte Müll** wird.

```csharp
// ❌ VOR DER OPTIMIERUNG: Scannt den gesamten Speicher und erzeugt Müll bei jedem Funktionsaufruf
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetLocalizedText(tableID, tableKey);
}

// ✅ NACH DER OPTIMIERUNG: Nutzt den statischen Cache (Zero GC Alloc)
public class LocalizationManager : MonoBehaviour 
{
    public static LocalizationManager instance;
    public UIManager UIManagerAsset;

    // Schnellzugriffs-Cache für das gesamte Spiel
    public static UIManager SharedUIManager => instance != null ? instance.UIManagerAsset : null;

    void Awake() 
    {
        instance = this;
        // Nutzt die Unity-6-API für eine einmalige Suche ohne Array-Allokation
        if (UIManagerAsset == null) 
            UIManagerAsset = FindAnyObjectByType<UIManager>(); 
    }
}

// Überall, wo Text benötigt wird, einfach über den Cache abrufen:
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = LocalizationManager.SharedUIManager;
    return tempUIM != null ? tempUIM.GetLocalizedText(tableID, tableKey) : null;
}
```

---

### **Szenario 2: Editor-Hilfsprogramme von Drittanbietern gelangen in den Spiel-Build**
* **Problem**: Viele Tool-Pakete (wie Animation- oder Level-Design-Systeme) enthalten bereits Ressourcensuchfunktionen wie `Resources.FindObjectsOfTypeAll`, um Reset- oder Setup-Buttons im Editor zu unterstützen. Selbst wenn das Gameplay sie nie aufruft, führt dieser offen im Runtime-Quellcode liegende Code dazu, dass Unity den Spiel-Build (Player) mit GC-Alloc-Warnungen markiert.
* **Lösung**: Diesen gesamten Suchcode-Block mit der Präprozessor-Direktive `#if UNITY_EDITOR` kapseln. Wenn du das Spiel in eine Installationsdatei (`.exe`, `.apk`) baust, entfernt Unity diese Codezeilen automatisch und vollständig aus der Runtime.

```csharp
// ❌ VOR DER OPTIMIERUNG: Editor-Ressourcensuchcode liegt offen in der Runtime
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}

// ✅ NACH DER OPTIMIERUNG: Mit der Präprozessor-Direktive #if UNITY_EDITOR gekapselt
#if UNITY_EDITOR
// Dieser Codeblock existiert nur im Unity Editor und wird beim Spiel-Build zu 100 % entfernt
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}
#endif
```

---

## **Fazit**

Für Einsteiger in Unity ist „Speichermüll“ (GC Allocation) ein recht abstraktes Konzept, da C# die Bereinigung automatisch übernimmt. In der Spieleprogrammierung führt das ständige Erzeugen von Müll jedoch zu deutlich sichtbaren Rucklern auf dem Bildschirm.

Goldene Regel: **Halte dich von der `Find`-Funktionsfamilie (insbesondere `Resources.FindObjectsOfTypeAll`) in Schleifen wie `Update()` oder häufig aufgerufenen Ereignissen fern.** Bevorzuge Referenzen über den Inspector, nutze Zwischenspeicherung (Cache / Singleton), steige auf die Standard-API von Unity 6 (`FindAnyObjectByType`) um und kapsele Editor-Hilfswerkzeuge mit `#if UNITY_EDITOR`. Durch die Optimierung dieser kleinen Details hält dein Spiel auf jedem Gerät stabile 60 FPS!
