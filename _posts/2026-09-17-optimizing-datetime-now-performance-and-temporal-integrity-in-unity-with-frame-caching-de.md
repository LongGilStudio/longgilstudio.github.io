---
title: "Leistungsoptimierung und zeitliche Datenintegrität in der Unity Engine: Systemmechanismen, Engpassanalyse von DateTime.Now und Frame-Caching-Lösung"
date: 2026-09-17 03:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, datetime, csharp, dotnet, frame-caching, multithreading, anticheat]
description: Tiefgehende Analyse der internen Mechanismen von DateTime.Now und DateTime.UtcNow in der .NET-Runtime, Quantifizierung von Leistungsengpässen, Temporal-Tearing-Phänomen und einer thread-sicheren Frame-Caching-Architektur in der Unity Engine.
lang: de
translation_id: unity-datetime-now-frame-caching
math: true
---

Das Abrufen und Verarbeiten von Echtzeit-Zeitdaten gehört zu den grundlegenden, aber architektonisch risikoreichen Aufgaben in Echtzeitanwendungen auf Basis der Unity Engine[^1]. Obwohl die Struktur `System.DateTime` aus der .NET Base Class Library (BCL) umfassende Werkzeuge für die Kalenderverarbeitung bereitstellt, erzeugt der direkte Aufruf der Eigenschaft `System.DateTime.Now` innerhalb kontinuierlicher Update-Schleifen (Hot Paths) gravierende Leistungsengpässe und beeinträchtigt die Zustandsintegrität[^2].

Dieser Bericht analysiert eingehend die internen Mechanismen auf Ebene des Betriebssystems und der Laufzeitumgebung (.NET/Mono/IL2CPP), quantifiziert den Rechenaufwand anhand von Profiling-Daten, untersucht das Phänomen des zeitlichen Zerreißens (*temporal tearing*) und bewertet umfassend die Lösung des bildweisen Cachings (*Frame Caching*) sowie die zugehörigen Architekturstandards[^2].

---

## **1. Interne Mechanismen von DateTime.Now und DateTime.UtcNow in der .NET-Runtime**

Die Struktur `System.DateTime` wird als einzelnes 64-Bit-Wertfeld (`UInt64 _dateData`) gespeichert[^6]. In dieser Struktur gilt:
- **Die unteren 62 Bits** repräsentieren die akkumulierte Anzahl an Ticks seit 00:00:00 Uhr am 1. Januar 0001 nach dem gregorianischen Kalender, wobei jeder Tick $100\text{ ns}$ ($10^{-7}\text{ s}$ bzw. $0.1\ \mu\text{s}$) entspricht[^1].
- **Die obersten 2 Bits** sind für die Speicherung der `DateTimeKind`-Flags reserviert, wodurch einer von drei Kontextzuständen identifiziert werden kann: `Utc`, `Local` oder `Unspecified`[^1].

### **Low-Level-Ausführungsfluss von DateTime.UtcNow**

Die Eigenschaft `DateTime.UtcNow` repräsentiert die koordinierte Weltzeit und ist auf maximale Effizienz hinsichtlich der Prozessorzyklen ausgelegt[^2]. Wenn ein Prozess `DateTime.UtcNow` aufruft, führt die .NET-Laufzeitumgebung einen direkten Lesevorgang vom Hardware-Timer des Systems durch[^2]:

- Unter **Windows** ruft der Quellcode direkt die Win32-API-Funktion `GetSystemTimeAsFileTime` über einen intrinsischen Funktionszeiger auf, der so annotiert ist, dass Compiler-Optimierungsbarrieren umgangen werden (`TargetedPatchingOptOut`)[^2].
- Auf **POSIX**-basierten Betriebssystemen (einschließlich des Linux-Kernels auf Android und des Darwin-Kernels auf iOS/macOS) führt das System den Low-Level-Aufruf `clock_gettime(CLOCK_REALTIME, ...)` aus[^5].

Der vom Betriebssystem zurückgegebene Rohzeitwert erfordert lediglich das Hinzufügen einer festen Offset-Konstante zur Synchronisierung mit dem Bezugspunkt des gregorianischen Kalenders und wird anschließend direkt mit dem Flag `DateTimeKind.Utc` in das `DateTime`-Struct verpackt[^2]. Dieser Vorgang erfordert keine Auflösung von Nachschlagetabellen, keine Speicherallokation und wird innerhalb weniger Nanosekunden abgeschlossen[^2].

### **Komplexer Auflösungsfluss von DateTime.Now**

Im Gegensatz zu `DateTime.UtcNow` erfordert die Bestimmung der Ortszeit (`DateTime.Now`) eine komplexe Kette von Konvertierungsoperationen[^2]. Die Eigenschaft `DateTime.Now` liest keine unabhängige lokale Uhr aus der Hardware; stattdessen basiert sie vollständig auf dem Ergebnis von `DateTime.UtcNow` in Kombination mit einer Reihe von Zeitzonen-Offset-Berechnungen[^2]:

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

Dieser Prozess beginnt mit dem Abrufen der aktuellen UTC-Zeit und fragt anschließend das Objekt `TimeZoneInfo.Local` ab, um die Zeitzonenkonfiguration des Geräts zu ermitteln[^2]. Der Schwerpunkt des Ressourcenverbrauchs liegt in der Funktion `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc`, in der die Laufzeitumgebung den aktuellen Zeitstempel mit der Tabelle der Zeitzonen-Anpassungsregeln (*Adjustment Rules*) und den Sommerzeit-Konventionen (*Daylight Saving Time - DST*) abgleichen muss, um festzustellen, ob der aktuelle Zeitpunkt in einer Phase mit einer zusätzlichen Stunde liegt[^2].

Nach der exakten Bestimmung des Offsets in Ticks führt das System eine arithmetische Addition mit `utcNow.Ticks` durch, prüft die Grenzbedingungen auf Überlauf und initialisiert eine neue `DateTime`-Struktur mit dem Tag `DateTimeKind.Local`[^2].

Leistungs-Profiling-Daten aus dem offiziellen .NET-Runtime-Repository liefern die detaillierte Ausführungszeitverteilung der Methode `DateTime.get_Now()`[^4]:

| Ausführungskomponente in `System.DateTime.get_Now()` | Kumulativer Zeitanteil (Inclusive %) | Technische Natur der Aufgabe |
| :--- | :---: | :--- |
| `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc` | **88.1%** | Nachschlagen von Zeitzonen-Konvertierungsregeln, Prüfung des DST-Flags, Offset-Berechnung[^4] |
| `System.DateTime.get_UtcNow()` | **5.8%** | Systemaufruf (Syscall) zum Auslesen des Hardware-Zählers[^2] |
| Grenzprüfungen und Struct-Verpackung | **6.1%** | Validierung von 64-Bit-Integer-Überlauf und Zuweisung von `DateTimeKind.Local`[^4][^7] |

> [!IMPORTANT]
> Die obigen Daten belegen, dass das eigentliche Auslesen der Zeit von der Hardware-Uhr lediglich **~5.8%** der gesamten Ausführungskosten ausmacht, während bis zu **~88.1%** der Verarbeitungszeit für die Zeitzonenauflösung und die Berechnung der Sommerzeitregeln aufgewendet werden[^4].

### **Verstärkte Komplexität in mobilen Umgebungen (Mono & IL2CPP)**

Auf mobilen Plattformen, die Unity über Mono oder IL2CPP ausführen, vervielfacht sich die Komplexität von `DateTime.Now` noch weiter[^5]. Während Windows eine zentrale Registrierungsdatenbank (Registry) für Zeitzoneninformationen pflegt, speichern mobile Betriebssysteme wie Android diese Daten in der binären Datenbank `tzdata` (`ZoneInfoDB`), die verteilt in Systemverzeichnissen wie `/apex/com.android.tzdata/` oder `/system/usr/share/zoneinfo` liegt[^5].

Wenn `TimeZoneInfo.Local` zum ersten Mal initialisiert wird oder neu validiert werden muss, ist die Mono/IL2CPP-Umgebung gezwungen, Datei-I/O-Operationen durchzuführen, Binärdaten zu parsen oder sogar umgebungsübergreifende Aufrufe über das Java Native Interface (JNI) an die Klasse `java.util.TimeZone` auszuführen, um die Zeitzonen-ID zu ermitteln[^5].

> [!WARNING]
> Wenn die Zeitzonendatenbank-Datei beschädigt ist, auf benutzerdefinierten ROMs verschoben wurde oder die Dateizugriffsrechte eingeschränkt sind, kann der Aufruf von `DateTime.Now` eine schwerwiegende `System.TimeZoneNotFoundException` auslösen, was ohne entsprechende Ausnahmebehandlungsblöcke zu einem plötzlichen Anwendungsabsturz führt[^10].

---

## **2. Leistungs-Benchmark-Analyse und Auswirkungen auf das Frame-Budget**

Die Ausführungskosten von Zeitabrufmethoden variieren je nach zugrunde liegender Architektur und dem Cache-Zustand des Betriebssystems erheblich[^5]. Die folgende Tabelle fasst die normalisierten Benchmark-Ergebnisse zwischen gängigen Zeitmechanismen in Unity und .NET zusammen[^4]:

| Methode zum Zeitabruf | Geschätzte Ausführungszeit | Relatives Geschwindigkeitsverhältnis | Kern-Ausführungsmechanismus | Risiko für Frame-Spitzen (Frame Spike) |
| :--- | :---: | :---: | :--- | :--- |
| `UnityEngine.Time.time` | $\sim 1\text{ - }2\text{ ns}$ | Optimal (Engine-nativ) | Direktes Auslesen einer zu Frame-Beginn gecachten Gleitkommavariable | Überhaupt keins |
| `System.DateTime.UtcNow` | $\sim 15\text{ - }20\text{ ns}$ | $\sim 15\text{ - }20\times$ schneller als `Now` | Direktes Auslesen der Hardware-Uhr über minimalen Systemaufruf[^2] | Vernachlässigbar |
| `System.DateTime.Now` (Warm Path) | $\sim 280\text{ - }350\text{ ns}$ | Basis-Referenzwert ($1\times$) | Ruft UtcNow auf, greift auf Zeitzonen-Cache zu, berechnet DST-Offset[^2] | Mittel bis Hoch bei wiederholten Aufrufen |
| `System.DateTime.Now` (Cold Path / Mobil) | $\sim 1\text{ - }5\text{ ms}$ | Tausendfach langsamer ($\gt 3.000\times$) | Initialisiert AndroidTzData-Tabellen, Festplatten-I/O, Binärdaten-Auslesen[^5] | Sehr hoch (Frame-Einfrieren) |

### **Grenzen des Frame-Budgets in der Spielschleife**

In interaktiven Echtzeitanwendungen muss die gesamte Arbeitslast — einschließlich Bewegungssimulation, Physikberechnungen, Spiellogik-Verarbeitung und Übermittlung von Zeichenbefehlen an die GPU — innerhalb eines begrenzten Zeitintervalls abgeschlossen sein, das durch folgende Formel definiert wird:

$$
T_{\text{frame}} = \frac{1000\text{ ms}}{\text{Target FPS}}
$$

- Bei einer Standard-Bildwiederholfrequenz von **$60\text{ Hz}$** ($60\text{ FPS}$) beträgt das Budget pro Frame **$16.67\text{ ms}$**.
- Dieser Wert verkürzt sich auf nur noch **$8.33\text{ ms}$** bei Bildschirmen mit hoher Bildwiederholfrequenz von **$120\text{ Hz}$** ($120\text{ FPS}$).

Eine Codebasis mit zahlreichen verstreuten `DateTime.Now`-Aufrufen innerhalb von Entitäts-Update-Schleifen — etwa Abklingzeit-Timer von Fähigkeiten für Dutzende von Nicht-Spieler-Charakteren (NPCs), Buff-Statusprüfungen oder Echtzeit-Ereignisprüfungen — akkumuliert Hunderte bis Tausende von Systemaufrufen pro Frame.

Bei **500 warmen `DateTime.Now`-Aufrufen** pro Frame verbraucht das System etwa **$\sim 0.15\text{ ms}$** ($150\,\mu\text{s}$) allein für Zeitzonen-Offset-Berechnungen und beansprucht damit bis zu **$\sim 1.8\%$** des gesamten Zeitbudgets eines **$120\text{ Hz}$**-Frames. Dieser Verbrauch verursacht unmittelbar Bildrateneinbrüche und lokales Ruckeln, was erklärt, warum das statische Analysetool Unity Project Auditor die Verwendung von `DateTime.Now` in kontinuierlichen Update-Pfaden mit einer roten Warnung hoher Priorität (*Major Issue*) markiert[^3].

---

## **3. Das Phänomen des Temporal Tearing und Fehler bei der Datenintegrität**

Neben der Verschlechterung der CPU-Leistung führt das Verstreuen von `DateTime.Now`-Aufrufen zum Extrahieren einzelner Komponenten eines Zeitstempels zu einem schwerwiegenden Fehler hinsichtlich der Datenatomarität (*Data Atomicity*). Der ursprüngliche Quellcode gerät bei unabhängigen Vergleichen in diese Sicherheitslücke:

```csharp
if (requirement.CheckYear)   results.Add(DateTime.Now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(DateTime.Now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(DateTime.Now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(DateTime.Now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(DateTime.Now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(DateTime.Now.Second == requirement.Second);
```

### **Mechanismus zur Entstehung anomaler Hybridzustände**

Die Eigenschaft `DateTime.Now` ist im Wesentlichen ein Methodenaufruf, der einen von der objektiven Zeit zum Aufrufzeitpunkt abhängigen Zustand erzeugt, und kein statisches Datenfeld[^20]. Jedes Mal, wenn der Code auf eine Untereigenschaft wie `.Year`, `.Month` oder `.Day` zugreift, führt das System einen völlig neuen Abfragezyklus beim Betriebssystem durch[^2].

Obwohl das Zeitintervall zwischen aufeinanderfolgenden Codezeilen nur wenige Mikrosekunden beträgt, kann der Ausführungsprozess jederzeit durch den Zeitscheiben-Multitasking-Scheduler des Betriebssystems unterbrochen werden, oder der Ausführungszeitpunkt fällt zufällig auf eine natürliche Übergangsgrenze der Systemuhr[^8].

> [!CAUTION]
> **Grenzübergangs-Fehlerszenario (Boundary Edge-Case):**  
> Angenommen, der Thread führt die Monatsprüfungszeile genau um `23:59:59.999` am 31. August 2024 aus. Die Eigenschaft `DateTime.Now.Month` wird auf Basis dieses Zeitstempels berechnet und gibt den Wert **August (8)** zurück.  
>  
> Unmittelbar nach Abschluss dieser Anweisung und bevor die nächste Tagesprüfung ausgeführt wird, springt die Systemuhr auf `00:00:00.000` am 1. September 2024. Wenn die Zeile `DateTime.Now.Day` ausgelöst wird, liefert das Betriebssystem den neuen Zeitstempel und diese Eigenschaft gibt den Wert **Tag 1** zurück.  
>  
> Die Folge ist, dass die Systemlogik einen hybriden Zustand erfasst: **1. August** — ein Zeitpunkt, der im physischen Zeitverlauf überhaupt nicht existiert hat!

Wenn dieser fehlerhafte Zeitstempel verwendet wird, um zeitlich begrenzte Ereignisse auszulösen, regelmäßige Login-Belohnungen zu prüfen oder Transaktionen im Spiel zu protokollieren, kann diese Abweichung die Bedingungsprüfungslogik zerstören, unbeabsichtigte Funktionssperren verursachen oder es Spielern ermöglichen, Belohnungen doppelt einzufordern.

---

## **4. Technische Bewertung der Frame-Caching-Lösung**

Um redundante Rechenkosten vollständig zu eliminieren und das Phänomen des Temporal Tearing konsequent zu verhindern, besteht die optimale Lösung in der Anwendung des Frame-Caching-Modells (*Frame Caching / Per-frame Memoization*), wobei der Frame-Zähler der Unity Engine (`UnityEngine.Time.frameCount`) als Schlüssel zur Bestimmung der Datengültigkeit verwendet wird[^22].

### **Analyse des Betriebsablaufs des Frame-Caches**

Der Quellcode zur Implementierung des Caching-Mechanismus ist wie folgt aufgebaut:

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

Wenn die Zeitprüfungslogik eine Abfrage benötigt, wird der Zeitstempel ein einziges Mal in eine lokale Variable geladen, um ihn über alle Prüfungen hinweg zu verwenden:

```csharp
DateTime now = GetCurrentSystemTime();  
if (requirement.CheckYear)   results.Add(now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(now.Second == requirement.Second);
```

Dieser Mechanismus bringt zwei entscheidende Verbesserungen mit sich:

1. **Reduzierung der Berechnungskomplexität:** Senkung von einer linearen Komplexität $\mathcal{O}(N)$, die von der Anzahl der Entitäten abhängt, auf ein konstantes Niveau $\mathcal{O}(1)$ pro gerendertem Frame. Alle Abfrageaufrufe nach dem ersten Aufruf innerhalb desselben Frames lesen direkt den im statischen Speicher abgelegten 64-Bit-`DateTime`-Struct-Wert, wodurch die Kosten für Betriebssystemaufrufe und Zeitzonenberechnungen vollständig entfallen[^2].
2. **Wahrung der Atomarität des Zeit-Schnappschusses (*Snapshot Atomicity*):** Die Variable `now` fungiert als unveränderlicher Zeitschnitt für den gesamten Frame und stellt sicher, dass alle Komponenteneigenschaften vom Jahr bis zur Sekunde konsistent sind und nicht durch Systemunterbrechungen getrennt werden können.

### **Analyse der Grenzbeschränkungen und Risiken beim produktiven Einsatz**

Obwohl die Frame-Caching-Lösung das Problem auf dem Hauptthread von Unity vollständig löst, erfordert die Anwendung in großen Softwarearchitekturen eine sorgfältige Prüfung von drei wichtigen technischen Einschränkungen:

1. **Bindung an den Hauptthread (Main Thread Affinity):** Die Eigenschaft `UnityEngine.Time.frameCount` ist eine interne C++-API der Engine und fest an den Hauptthread gebunden[^24]. Wenn ein Hintergrundprozess — beispielsweise ein Hintergrund-Task-Thread (`Task.Run`), ein asynchroner Netzwerkprozess oder ein Task des C# Job Systems — die Methode `GetCurrentSystemTime()` aufruft, wirft Unity sofort die Ausnahme `UnityException: get_frameCount can only be called from the main thread` und unterbricht den Ausführungsfluss[^24].
2. **Taktversatz zwischen Update und FixedUpdate:** Der Ausführungslebenszyklus von Unity enthält zwei unabhängige Aktualisierungstakte: die Grafik-Rendering-Schleife (`Update`) und die Physik-Simulationsschleife mit festem Zeitschritt (`FixedUpdate`)[^25]. Der Wert `Time.frameCount` wird von der Engine nur um eins erhöht, wenn ein neuer Rendering-Frame beginnt[^22]. Falls auf dem Client-Gerät ein Einbruch der Bildrate auftritt, kann die Engine gezwungen sein, mehrere aufeinanderfolgende `FixedUpdate`-Zyklen innerhalb desselben Rendering-Frames auszulösen, um mit dem Fortschritt der Physiksimulation Schritt zu halten[^23]. In diesem Fall lesen alle `FixedUpdate`-Zyklen innerhalb desselben Rendering-Zyklus denselben gecachten Zeitwert `_cachedSystemTime`, was den Zeitfortschritt zwischen aufeinanderfolgenden Physik-Simulationsschritten möglicherweise nicht widerspiegelt[^26].
3. **Risiko von Datenwettläufen (Data Race):** Der Zugriff auf globale statische Variablen `_cachedSystemTime` und `_lastSystemTimeFrame` ohne Speicherbarrieren (*Memory Barriers*) oder Zugriffssperren birgt das Risiko von Datenkonflikten, wenn Nebenthreads auf Mehrkernprozessor-Architekturen mit Befehlsumordnung (*out-of-order execution*) gleichzeitig lesen oder schreiben.

### **Implementierung eines thread-sicheren System Time Providers**

Um alle oben genannten technischen Einschränkungen zu beheben, muss das Zeitsystem als dedizierter Dienst standardisiert werden, der den Ausführungskontext des Threads erkennt, Zugriffssicherheit gewährleistet und Grenzausnahmen automatisch behandelt:

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

Diese Architektur stellt sicher, dass der Hauptthread stets von den Vorteilen des Frame-Cachings profitiert, ohne sich um wiederholte Rechenkosten sorgen zu müssen, während Hintergrundthreads oder der Bearbeitungsmodus im Editor durch den direkten Fallback-Mechanismus einen stabilen Betrieb aufrechterhalten und das Risiko von Ausnahmen durch Verletzung der Thread-Zugriffsrechte der Engine vollständig ausgeschlossen wird[^24].

---

## **5. Standards zur Trennung von Zeitdomänen in der Game-Engine-Architektur**

Ein häufiger Fehler in der Spieleentwicklung ist das Vermischen unterschiedlicher Zeitverwendungszwecke in derselben System-API[^2]. Um maximale Leistung und Konsistenz des Spielzustands zu gewährleisten, muss die Systemarchitektur klare Grenzen zwischen unabhängigen Zeitdomänen ziehen:

| Zeitdomäne (Time Domain) | Empfohlene Standard-API | Hauptanwendungsfälle | Risiko bei Verwendung der falschen API |
| :--- | :--- | :--- | :--- |
| **Interne Gameplay-Simulation** | `UnityEngine.Time.time`, `Time.deltaTime` | Berechnung physikalischer Koordinaten, Charakterbewegung, Abklingzeiten von Fähigkeiten | Friert beim Pausieren des Spiels ein (`timeScale = 0`); verliert Genauigkeit, wenn Echtzeit benötigt wird[^26] |
| **Echtzeit-UI-Darstellung** | `UnityEngine.Time.unscaledTime`, `Time.realtimeSinceStartup` | UI-Menüanimationen, Übergangseffekte während das Spiel pausiert ist | Fest an die Prozesssitzung des Clients gebunden, nicht auf reale Kalenderzeit abbildbar |
| **Algorithmus-Leistungsmessung** | `System.Diagnostics.Stopwatch` | Messung der Algorithmuslaufzeit, Codeblock-Profiling, Erkennung von Leistungslecks[^7] | Die Auflösung von `DateTime.Now` beträgt nur $\sim 15.6\text{ ms}$ und ist für Benchmarks zu ungenau[^7] |
| **Anti-Cheat-Logikvalidierung** | Vom Server synchronisierte Unix-Epoch-Zeit (UTC)[^28] | Energiesysteme, Schatztruhen-Öffnungszeiten, Online-Event-Begrenzungen[^28] | Bei Vertrauen in die Client-Uhr können Spieler die Systemzeit verstellen, um Gegenstände zu erschummeln[^28] |
| **Lokale Kalenderanzeige** | `SystemTimeProvider.CurrentLocalTime` | Darstellung der tatsächlichen Benutzerzeit in UI-Statusleisten[^2] | Verursacht Frame-Ruckler bei kontinuierlichen ungecachten Aufrufen von nativem `DateTime.Now`[^2] |

### **Server-Zeitsynchronisationsmechanismus und Anti-Cheat**

Bei Spielen mit Online-Funktionen entsteht eine schwerwiegende Sicherheitslücke, wenn der Client Zeitstempel für Aktionen selbst anhand der lokalen `DateTime.Now` oder `DateTime.UtcNow` validieren darf[^28]. Benutzer können die Uhreinstellungen des Betriebssystems problemlos ändern, um Gebäude-Countdowns vorzuspulen oder Aktivitätsrunden zurückzusetzen[^28].

Die standardisierte Architektur zur Unterbindung dieser Art von Cheating erfordert, dass der Client einen virtuellen Zeitstempel auf Basis einer monotonen Uhr (*monotonic clock*) etabliert[^5]:

1. **Synchronisationsanfrage senden:** Sobald der Client eine Netzwerkverbindung herstellt, wird eine Zeitsynchronisationsanfrage an den Dienstserver gesendet, um den standardisierten Unix-Epoch-Zeitstempel nach UTC zu erhalten[^28].
2. **Round-Trip-Latenz messen:** Der Client erfasst die Paketumlaufzeit ($RTT$) und schätzt den exakten Server-Zeitstempel zum Zeitpunkt des Eintreffens der Antwort mithilfe der Formel:
   $$T_{\text{server}} = T_{\text{server\_reply}} + \frac{RTT}{2}$$
3. **Monotonen Offset bestimmen:** Der Client berechnet und speichert die feste Differenz gegenüber dem monotonen Hardware-Zähler:
   $$\Delta t = T_{\text{server}} - \text{Time.realtimeSinceStartupAsDouble}$$
4. **Manipulationssichere Zeit abrufen:** Während des gesamten Anwendungslebenszyklus muss jede Spiellogik, die die Echtzeit prüfen muss, lediglich folgenden Wert abrufen:
   $$\text{CurrentRealTime} = \text{Time.realtimeSinceStartupAsDouble} + \Delta t$$
   Da der Startzeit-Zähler der Engine einen monotonen Hardware-Zählmechanismus nutzt (`clock_gettime(CLOCK_MONOTONIC)` oder `QueryPerformanceCounter`), steigt dieser Wert kontinuierlich linear an und ist völlig immun gegen jede Manipulation der Kalenderuhr des Betriebssystems[^5].

### **Architekturwechsel zum modernen Standard mit TimeProvider (.NET 8+)**

Ab Version .NET 8 hat Microsoft das gesamte Zeitverwaltungsmodell offiziell umgestaltet und die abstrakte Klasse `System.TimeProvider` eingeführt, um direkte statische Aufrufe wie `DateTime.Now` oder `DateTime.UtcNow` vollständig zu ersetzen[^20]. Für moderne Unity-Projekte können Entwickler über das Kompatibilitätspaket `Microsoft.Bcl.TimeProvider` diese Architektur übernehmen, um die Modularität des Quellcodes zu erhöhen[^32]:

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

Der Übergang zu diesem Abstraktionsmodell bietet zwei große technische Vorteile:

> [!TIP]
> 1. **Isoliertes Unit-Testing:** Ermöglicht die konsequente Anwendung des Unit-Testing-Modells[^20]. Ingenieure können ein Mock-Objekt `FakeTimeProvider` in die Geschäftslogik injizieren, um Testfälle mit Sprüngen über komplexe Zeitübergänge (etwa DST-Zeitumstellungen oder Jahreswechsel) präzise zu simulieren, ohne auf Echtzeit warten oder in das System eingreifen zu müssen[^20].  
> 2. **Sicherer Datentyp `DateTimeOffset`:** Die Methode `GetLocalNow()` gibt die Struktur `DateTimeOffset` anstelle von `DateTime` zurück[^20]. Die Struktur `DateTimeOffset` speichert einen Zeitstempel fest zusammen mit einem expliziten Zeitzonen-Offset (*offset*), wodurch mehrdeutige Zustände des Flags `DateTimeKind.Unspecified` vollständig ausgeschlossen werden und die Integrität bei der Serialisierung für die Netzwerkübertragung gewahrt bleibt[^1].

---

## **5. Praktische Umsetzung: Optimierung des RequirementsManager-Systems (Fallstudie)**

Im Rahmen eines realen Projekts auf Basis des RPG-Builder-Frameworks (Projekt GLW) wurde ein schwerwiegendes Leistungsproblem in der Klasse `RequirementsManager.cs` entdeckt. Konkret rief das System zur Prüfung zeitlicher Spielbedingungen (z. B. die Anforderung, dass ein Ereignis genau in einem bestimmten Monat, an einem bestimmten Tag und zu einer bestimmten Stunde stattfindet) kontinuierlich `DateTime.Now` mehrfach und voneinander getrennt auf:

```csharp
if(requirement.CheckYear) results.Add(DateTime.Now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(DateTime.Now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(DateTime.Now.Day == requirement.Day);
// ... Wiederholung für Hour, Minute, Second
```

**Aus dem alten Quellcode entstandene Probleme:**
1. **Extremer CPU-Overhead:** Zur Prüfung eines einzigen Requirements konnte das System bis zu 7–10 `DateTime.Now`-Aufrufe auslösen (einschließlich in Hilfsfunktionen wie `GetWeekNumber()`). Bei 100 gleichzeitig prüfenden Entitäten fielen pro Frame Tausende von Syscalls an das Betriebssystem an, was einen massiven Engpass verursachte.
2. **Temporal Tearing (Zeitpunktversatz):** Fiel der Übergang zwischen Sekunden (oder Minuten, Tagen) genau mitten in den Lesevorgang der obigen Anweisungen (z. B. bei Millisekunde 999), konnte die Variable `Month` noch vom alten Monat stammen, während `Day` bereits vom neuen Tag gelesen wurde. Die Folge war, dass das Spiel einen in der Realität gar nicht existierenden Zeitstempel zusammensetzte.

**Produktiv umgesetzte Lösung (Per-Frame Caching):**
Die Frame-Caching-Architektur wurde direkt integriert, wobei `Time.frameCount` als Flag für die Cache-Invalidierung diente. Dieser Ansatz nutzt den statischen Lebenszyklus anstelle einer Update-Schleife:

```csharp
private static DateTime _cachedSystemTime;
private static int _lastSystemTimeFrame = -1;

private static DateTime GetCurrentSystemTime()
{
    if (Application.isPlaying) 
    {
        int currentFrame = Time.frameCount;
        
        // Echte Zeit nur ein einziges Mal pro Frame vom Betriebssystem abrufen
        if (_lastSystemTimeFrame != currentFrame)
        {
            _lastSystemTimeFrame = currentFrame;
            _cachedSystemTime = DateTime.Now; 
        }
        
        return _cachedSystemTime;
    }
    return DateTime.Now; // Editor-Modus
}
```

An den Stellen der Logikverarbeitung verweisen sämtliche Prüfungen auf einen einzigen **Zeit-Schnappschuss (Snapshot)**:

```csharp
DateTime now = GetCurrentSystemTime();
if(requirement.CheckYear) results.Add(now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(now.Day == requirement.Day);
```

**Ergebnisse nach der Optimierung (Patch `MOD-RPGB-008`):**
- **Vollständige Beseitigung redundanter Syscalls:** Statt tausender Aufrufe wird `DateTime.Now` auf das Niveau $\mathcal{O}(1)$ gedrückt — exakt 1 Mal für alle Berechnungen pro Frame.
- **Absolute atomare Konsistenz (Atomic consistency):** Die Felder `Year`, `Month` und `Day` gehören garantiert demselben exakten Zeitpunkt an.
- **Bereinigung von Unity Project Auditor:** Vollständige Beseitigung der „Major“-Warnung zur Systemleistung im Zusammenhang mit `System.DateTime`.

---

## **6. Fazit**

Die direkte Verwendung von `System.DateTime.Now` in hochfrequenten Update-Schleifen der Unity Engine stellt ein ernstes technisches Problem sowohl für die Hardware-Leistung als auch für die Integrität logischer Daten dar[^3].

- Die komplexe Natur der Systemaufrufe zur Zeitzonenauflösung und zur Prüfung der Sommerzeit-Konventionen (DST) verbraucht über **88%** der Ausführungszeit dieser Eigenschaft und übt direkten Druck auf das Frame-Budget der Game Engine aus[^4].
- Gleichzeitig öffnet das Abrufen mehrerer Untereigenschaften über getrennte `DateTime.Now`-Aufrufe die Sicherheitslücke des *temporal tearing*, was zur Entstehung hybrider Zeitstempel führt und die Spiellogik zerstört[^21].

Die Lösung des bildweisen Cachings (**Frame Caching**) in Kombination mit der Eigenschaft `Time.frameCount` löst beide Probleme grundlegend, indem sie den CPU-Verbrauch auf ein konstantes Minimum von **$\mathcal{O}(1)$** pro Frame senkt und gleichzeitig unveränderliche Atomarität für Zeit-Schnappschüsse sicherstellt[^22].

Beim Einsatz im kommerziellen Projektmaßstab muss diese Architektur um eine Schutzschicht für den Ausführungsthread (`SystemTimeProvider`) ergänzt, eng mit einem autoritativen Server-Zeitvalidierungsmechanismus (*Server-Authoritative Time*) zur Betrugsprävention verknüpft und auf eine Standardisierung mittels der abstrakten Klasse `TimeProvider` ausgerichtet werden, um den modernen technischen Standards der Softwareindustrie umfassend gerecht zu werden[^20].

---

## **Referenzen**

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
