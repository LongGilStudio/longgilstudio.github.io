---
title: "Ausführlicher technischer Forschungsbericht: Funktionsweise, Systemarchitektur und Auswirkungen von DelayedActionManager in Unity Addressables"
date: 2026-10-01 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, addressables, memory-management, async, delayedactionmanager, optimization]
description: Tiefgehende Analyse der ComponentSingleton-Architektur von DelayedActionManager in Unity Addressables, des LateUpdate-Ausführungsmechanismus, der Behandlung von C#/C++-Proxy-Ausnahmen sowie von Strategien zur AssetBundle-Speicheroptimierung.
lang: de
translation_id: unity-addressables-delayedactionmanager
---

Das Addressable Asset System (kurz Addressables) stellt einen revolutionären architektonischen Fortschritt in Unity dar und bietet eine flexible, leistungsfähige und optimierte Content-Management-Lösung auf Basis der traditionellen AssetBundles[^1]. Bei der Entwicklung und dem Betrieb groß angelegter Spiele oder interaktiver Anwendungen ist die Verwaltung asynchroner Datenströme zum automatischen Laden und Freigeben von Ressourcen eine zentrale Anforderung. Eine der Kernkomponenten, die diese komplexe Aufgabe übernimmt – Softwareentwickler jedoch bei der Analyse der Hierarchie (Hierarchy) häufig verwirrt –, ist ein automatisch erzeugtes Objekt namens `DelayedActionManager`, das sich innerhalb der Szene `DontDestroyOnLoad` befindet[^2].

Dieser technische Bericht widmet sich einer umfassenden Analyse der architektonischen Natur von `DelayedActionManager`, erklärt die Gründe für seine Existenz im Bereich `DontDestroyOnLoad`, untersucht seinen Ausführungsmechanismus innerhalb der Echtzeitschleife von Unity und beleuchtet die Herausforderungen im Zusammenhang mit der Speicherverwaltung, Speicherlecks (Memory Leaks) sowie häufig auftretenden Threading- und Lebenszyklus-Ausnahmen. Durch die Auswertung von Systemdesign-Daten und Best Practices vermittelt dieses Dokument tiefgreifende Erkenntnisse, die Softwarearchitekten bei der Optimierung der Anwendungsstabilität unterstützen.

## Die Evolution des Asset-Ladesystems und asynchrone Grundlagen

Bevor wir tiefer in die Mikrostrukturen von `DelayedActionManager` eintauchen, ist das Verständnis des Entstehungskontexts von Addressables eine zwingende Voraussetzung. In älteren Unity-Versionen verließen sich Entwickler häufig auf den Ordner `Resources` oder nutzten direkt rohe AssetBundle-Skripte[^4]. Der Mechanismus von `Resources.Load()` funktioniert ähnlich wie das eigenhändige Betreten eines Lagerhauses: Er erfordert einen exakten Verzeichnispfad, und der Hauptthread (Main Thread) wird gezwungen zu blockieren (block), bis die Ressource gefunden und in den Arbeitsspeicher geladen wurde[^4]. Der Nachteil dieser Methode besteht darin, dass sie die Skalierbarkeit der Anwendung einschränkt und bei großen Datenmengen zu schwerwiegenden Einbrüchen der Bildwiederholrate (FPS Drop) führt.

Um dieses Problem zu lösen, agiert Addressables wie ein moderner Logistikdienst. Entwickler geben lediglich die Kennung der Ressource (Address/Key) an, und das System routet die Anfrage automatisch, um die Ressource entweder aus dem lokalen Speicher (Local) abzurufen oder von Servern eines Content Delivery Network (CDN) herunterzuladen[^4]. Entscheidend ist, dass dieser gesamte Zyklus asynchron abläuft. Ein Ladebefehl, typischerweise `Addressables.LoadAssetAsync`, gibt das Objekt nicht sofort zurück, sondern liefert ein Handle namens `AsyncOperationHandle`[^4]. Diese Schnittstelle stellt einen Callback-Mechanismus bereit, sobald die Ressource einsatzbereit ist, sodass der Hauptthread der Anwendung Physik- und Grafiklogik ohne Unterbrechung weiterverarbeiten kann[^4].

Dieser Übergang von einem synchronen zu einem vollständig asynchronen Modell zieht eine große architektonische Herausforderung nach sich: Wenn ein Ladevorgang aufgrund geringer Netzwerkbandbreite mehrere Sekunden dauert, kann die Anwendung bereits in eine völlig andere Szene (Scene) gewechselt sein[^1]. Die Verwaltung von Rückruffunktionen (Callbacks), Aufgabenwarteschlangen (Command Queues) und Referenzzählern (Reference Counting) erfordert eine zentrale Verwaltungsinstanz, die vom Erzeugungs- und Zerstörungszyklus gewöhnlicher Szenen unabhängig ist. Genau aus diesem Grund haben die Unity-Entwickler das `DontDestroyOnLoad`-Szenenmodell in den Kern von Addressables integriert.

## Die DontDestroyOnLoad-Szene (DDOL) und globale Persistenzarchitektur

In Unity löst das Laden einer neuen Szene (über `SceneManager.LoadScene` im standardmäßigen Single-Modus) automatisch den Mechanismus zur Speicherbereinigung aus. Die Engine zerstört sämtliche GameObjects und Components der vorherigen Szene, um sicherzustellen, dass nicht mehr benötigte Ressourcen freigegeben werden[^7]. Obwohl das additive Laden von Szenen (Additive Scenes) es ermöglicht, mehrere Szenen parallel aktiv zu halten, um den globalen Zustand zu verwalten (z. B. eine dedizierte Szene für den Game Manager und eine für das Level), bleibt der Mechanismus `DontDestroyOnLoad` (DDOL) eine entscheidende Systemtechnik zum Schutz von Objekten auf niedriger Ebene[^7].

Das Erscheinen der Szene `DontDestroyOnLoad` in der Oberfläche des Unity-Editors beim Drücken der Play-Taste ist kein Fehler, sondern ein standardmäßiger, verborgener Engine-Mechanismus, der Objekte gruppiert, die beim Szenenwechsel vor der Zerstörung geschützt sind[^9]. Damit ein `GameObject` in diesen geschützten Bereich aufgenommen wird, stellt Unity eine zwingende Regel auf: Dieses Objekt muss sich auf der obersten Ebene (Root Level) der Szene befinden[^8]. Jeder Versuch, `DontDestroyOnLoad(gameObject)` auf ein untergeordnetes Objekt (Nested Object) anzuwenden, schlägt fehl und führt zu einer entsprechenden Warnmeldung[^8].

Für Addressables umspannen Lade- und Freigabeprozesse von Ressourcen einen Lebenszyklus über mehrere verschiedene Szenen hinweg. Beispielsweise darf die Überwachung des Download-Fortschritts eines AssetBundles von einem Remote-Server nicht einfach abgebrochen werden, nur weil der Spieler ein Portal zum Levelwechsel durchschritten hat. Die Kombination aus `RuntimeInitializeOnLoadMethod` und einem erweiterten Singleton-Entwurfsmuster ermöglicht es dem Quellcode von Addressables, direkt beim Anwendungsstart automatisch ein Root-Objekt zu erzeugen und in die DDOL-Szene zu verschieben[^2]. Dies erklärt, warum selbst dann, wenn Entwickler keine einzige Zeile DDOL-Code geschrieben haben, automatisch ein Objekt namens `DelayedActionManager` unten links in der Szenenliste erscheint[^2].

## Interne Struktur und technische Rolle von DelayedActionManager

Eine eingehende Untersuchung des Quellcodes und der API-Dokumentation des Addressables-Pakets zeigt, dass `DelayedActionManager` eine konkrete Klasse (Concrete Class) im Namensraum `UnityEngine.ResourceManagement.Util` ist[^11]. Seine Struktur entspricht nicht bloß einer einfachen statischen Hilfsklasse (Static Utility Class), sondern einer Komponente, die durch Vererbung von einer Basisarchitektur direkt an ein `GameObject` angehängt wird[^12].

### Das ComponentSingleton-Muster und die Automatisierung der Initialisierung

Die Architektur von `DelayedActionManager` basiert auf dem Entwurfsmuster `ComponentSingleton`, einer Basisklasse aus demselben Namensraum[^13]. Die Anwendung des Singleton-Musters auf eine `Component` anstelle einer reinen C#-Klasse verleiht dem System die Fähigkeit, direkt mit der Echtzeit-Ereignisschleife (`PlayerLoop`) von Unity zu interagieren.

Wenn `ResourceManager` zum ersten Mal eine Lade- oder Statusaktualisierungsanfrage erhält (z. B. `Addressables.LoadAssetAsync` oder Netzwerkdiagnoseoperationen), greift er auf die `DelayedActionManager`-Instanz zu. Zu diesem Zeitpunkt führt das `ComponentSingleton`-Muster automatisch einen verborgenen Ablauf aus: Es erzeugt ein leeres `GameObject`, benennt es `"DelayedActionManager"`, hängt das entsprechende Skript daran an und ruft sofort `DontDestroyOnLoad` auf, um es in den globalen Schutzbereich zu überführen[^2]. Dieses Design der verzögerten Initialisierung (Lazy Initialization) stellt sicher, dass Systemressourcen nur dann verbraucht werden, wenn die Verwaltung verzögerter Aufgaben tatsächlich benötigt wird – und klärt damit die verbreitete Frage von Entwicklern nach dem „magischen“ Auftauchen dieses Objekts in der Oberfläche[^3].

### Analyse des Planungsmechanismus und der LateUpdate-Phase

Die Kernaufgabe von `DelayedActionManager` besteht darin, als zentraler Scheduler (Central Scheduler) für verzögerte Aktionen, Callbacks, Coroutinen und die Speicherverwaltung auf Mikroebene zu fungieren[^11]. Ein subtiler, aber äußerst wichtiger architektonischer Unterschied besteht darin, dass die gesamte Logik zur Abarbeitung der Warteschlangen so geleitet wird, dass sie innerhalb der `LateUpdate()`-Methode des Unity-Lebenszyklus ausgeführt wird[^11].

Die bewusste Entscheidung für `LateUpdate` anstelle des herkömmlichen `Update` löst ein tiefgreifendes architektonisches Problem hinsichtlich der Datenkonsistenz. Die folgende Tabelle veranschaulicht die Ausführungsreihenfolge von Unity und die Rolle der `LateUpdate`-Phase beim Schutz von Addressables-Daten.

| Ausführungsphase (PlayerLoop) | Typische Aufgaben | Rolle für Addressables und DelayedActionManager |
| :--- | :--- | :--- |
| **FixedUpdate** | Verarbeitung der Physiksimulation, statische/dynamische Kollisionen. | Spiellogik kann nach Kollisionen Anforderungen zur Objektzerstörung auslösen. |
| **Update** | Spielereingaben (Input), Bewegung, KI-Logik, Aktualisierung des Spielzustands. | Methoden wie `Addressables.LoadAssetAsync` oder `Release` werden manuell aufgerufen. GameObjects können hier per `Destroy()` zerstört werden. |
| **LateUpdate** | Aktualisierung der Kameraposition, Nachbearbeitungseffekte (Post-Processing). | `DelayedActionManager` bereinigt den Speicher, aktualisiert Referenzzähler und ruft asynchrone Callbacks auf, um Konflikte mit Zerstörungsbefehlen aus der `Update`-Phase zu vermeiden[^11]. |

Würde `ResourceManager` Abschluss-Callbacks sofort mitten in der `Update`-Phase ausführen, bestünde ein hohes Risiko, mit einem Subsystem (wie Grafik oder Benutzeroberfläche) zu interagieren, das sich noch in einem Zwischenzustand befindet und die Frame-Berechnung noch nicht abgeschlossen hat. Durch das Verzögern (Delaying) von `OnComplete`-Aufrufen oder der Verringerung von Referenzzählern (Ref-Count Decrements) bis zu `LateUpdate()` stellt `DelayedActionManager` sicher, dass der gesamte logische Zustand des aktuellen Frames stabilisiert ist[^11]. Daten aus zahlreichen Stack-Trace-Berichten belegen, dass `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` den letzten Zwischenschritt bildet, bevor die Kontrolle wieder an den Benutzercode übergeben wird[^15].

## Analyse von Systemausnahmen und Stack Traces

Trotz des auf hohe Sicherheit ausgelegten Designs führt die Komplexität des asynchronen Mechanismus in Kombination mit unsachgemäßer Lebenszyklusverwaltung seitens der Entwickler häufig dazu, dass `DelayedActionManager` im Zentrum schwerwiegender Ausnahmen steht. Fehlerprotokolle liefern wichtige Hinweise darauf, wie das System mit dem verwalteten Speicher (Managed Memory) und dem nativen Speicher (Native Memory) interagiert.

### NullReferenceException und Lebenszykluskonflikt des C#/C++-Proxys

Ein sehr häufiges Fehlerszenario in Addressables ist das Auftreten der Ausnahme `ArgumentNullException: Value cannot be null. Parameter name: obj`, die aus der Methode `StartCoroutine_Auto` von `DelayedActionManager` stammt[^19]. Dieser Fehler ist kein interner Bug von Unity, sondern entsteht durch die Diskrepanz zwischen der C#-Speicherbereinigung (Garbage Collector) und der Verwaltung nativer Zeiger im darunterliegenden C++-Code[^19].

In Unity sind Objekte wie `GameObject` oder `MonoBehaviour` im Wesentlichen in C# geschriebene Stellvertreterklassen (Proxy Classes), die eine interne Referenz auf das im nativen C++-Teil der Engine allokierte Objekt halten[^19]. Ruft der Entwickler `Destroy(gameObject)` auf, wird das C++-Objekt sofort zerstört und sein Speicherbereich freigegeben, wodurch die interne Referenz ungültig bzw. null wird[^19]. Die C#-Proxy-Klasse kann jedoch noch eine gewisse Zeit im verwalteten Speicher (Managed Memory) verbleiben, bis der Garbage Collector sie einsammelt[^19].

Zur Katastrophe kommt es, wenn Entwickler anonyme Ausdrücke (Lambdas/Closures) mit den asynchronen Vorgängen von Addressables kombinieren. Ein Lambda-Ausdruck besitzt die Eigenschaft, umgebende Kontextvariablen „einzufangen“ (Capture). Betrachten wir das folgende Code-Muster:

```csharp
// Eine Aktion, die in die Warteschlange von DelayedActionManager eingereiht wird
DelayedAction(null, () => {
    _crawlerRobot.BreakAwayLowerBody();
    if (isLevelLoad) {
        PhysicsUtil.ManualSimulation(2);
    }
});
```

Bei der Ausführung dieses Codes wird die Variable `_crawlerRobot` (ein C#-Proxy) von der Closure eingefangen[^19]. Zerstört die Spiellogik `_crawlerRobot` noch in demselben Frame, verschwindet der zugrunde liegende C++-Zeiger. Da `DelayedActionManager` dieses Lambda jedoch für die `LateUpdate`-Phase (oder einen späteren Frame) eingeplant hat, versucht das Lambda bei seiner tatsächlichen Ausführung, auf die Methode `BreakAwayLowerBody()` eines bereits toten C++-Zeigers zuzugreifen[^19]. Die unvermeidliche Folge ist eine `NullReferenceException` oder die Fehlermeldung „Das Objekt wurde zerstört, aber Sie versuchen immer noch, darauf zuzugreifen“[^19].

Um dieses architektonische Risiko zu beheben, empfehlen Softwareexperten zwei Entwurfslösungen:

1. Vermeiden Sie die übermäßige Verschachtelung von Lambda-Ausdrücken (Lambdas Nesting) bei der Behandlung von Zustandsänderungen auf niedriger Ebene[^19].
2. Führen Sie stets eine sichere Null-Prüfung durch und nutzen Sie dabei die Tatsache, dass Unity den C#-Operator `==` überladen (overloaded) hat, um direkt den Zustand des zugrunde liegenden C++-Zeigers zu überprüfen[^19].

### PlayerLoop-Konflikt und der Fehler „Assertion failed on expression: ShouldRunBehaviour()“

Im Rahmen der Versionsverwaltung (Version Control) der Addressables-Pakete berichten zahlreiche Entwickler, dass der Unity-Editor mit einer Low-Level-Fehlermeldung überflutet wird: `Assertion failed on expression: 'ShouldRunBehaviour()'` in der Datei `MonoBehaviour.cpp`[^3].

Der Stack Trace zeigt, dass dieser Vorgang direkt vom `GameObject` `"DelayedActionManager"` in der Szene `DontDestroyOnLoad` ausgeht[^3]. Eine Ursachenanalyse (Root Cause Analysis) deckt eine Schwachstelle in der Behandlung des Play-Mode-Ausführungsflusses im Unity-Editor auf. Wenn der Editor einen Domain Reload durchläuft oder wenn der Ladevorgang von Ressourcen noch nicht abgeschlossen ist, während der Benutzer das Spiel bereits anhält (Stop), bleibt `DelayedActionManager` als verwaistes Objekt (Orphaned Object) zurück[^3].

Da es als `DontDestroyOnLoad` markiert ist, versucht es weiterhin `LateUpdate`-Zyklen und Verhaltensprüfungen (Behaviour Checks) auszuführen, obwohl die native Ausführungsumgebung von Unity (`PlayerLoop`) bereits die vollständige Einstellung aller Aufgaben angeordnet hat[^3]. Dieser Fehler trat am schwerwiegendsten beim Übergang von Addressables `1.16.x` auf `1.18.x` auf und zwang viele Entwicklungsteams zu einem manuellen Downgrade auf Version `1.17.17`, um die Stabilität der synchronen Verarbeitungs-API wiederherzustellen und Warteschlangenblockaden zu beseitigen[^3].

### Die Entwicklung von DelayedActionManager in der Versionshistorie

Ein interessantes Detail bei der Analyse der API-Dokumentation und der Änderungsprotokolle (Changelogs) von Unity Addressables ist die zyklische Präsenz von `DelayedActionManager`. Versionen wie `0.7.5` und `1.11.2` kündigten in ihren Update-Hinweisen ausdrücklich die Umstrukturierung der Build-Skript-Schnittstelle mit folgender Meldung an: „Removed DelayedActionManager. Removed ISceneProvider. Users can implement custom scene loading“[^20]. Diese Entscheidung sollte ursprünglich die API-Schicht vereinfachen und die Kontrolle an die anpassbare Klasse `AsyncOperationBase` übertragen[^20].

Fehlerberichte aus Post-LTS-Versionen (Long-Term Support) wie `1.18.15`, `1.19.19` und `1.21.21` offenbaren jedoch die stetige Rückkehr von `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` in den Stack Traces[^11]. Dies spiegelt die iterative Designphilosophie von Unity wider: Nach der Entfernung zur Verschlankung stellten die Systemingenieure fest, dass das Fehlen eines zentralen Managers für verzögerte Aufgaben unlösbare Probleme bei der Erfassung von Diagnoseereignissen (`DiagnosticEventCollector`), der Verarbeitung von Preload-Tabellen und der Speichersicherheit beim Beenden der Anwendung verursachte[^11]. `DelayedActionManager` wurde daraufhin neu konzipiert und als internes Systemhilfsmittel wiederhergestellt – nicht mehr öffentlich über die Benutzeroberfläche zugänglich, aber verantwortlich für Risiken bei der Ressourcenfreigabe (Disposal) beim Herunterfahren der Anwendung[^20].

## Referenzzählungsmechanismus und Dynamik von Speicherlecks

Die Existenz von `DelayedActionManager` ist eng mit einem der komplexesten Grundpfeiler von Addressables verknüpft: dem Speicherverwaltungssystem (Memory Management). Anders als bei einer vollständigen Abhängigkeit vom Garbage Collector steuert Addressables die Verweildauer von Daten im RAM über einen Referenzzählungsmechanismus (Reference Counting)[^23].

### Referenzdynamik und Abhängigkeitshierarchie

Immer wenn das System eine Anfrage zum Laden einer Ressource erhält, wird der Referenzzähler dieser Ressource um eins erhöht (Increment). Nach Abschluss der Verwendung weist der Befehl `Addressables.Release` das System an, diesen Zähler wieder zu verringern (Decrement)[^23]. Die goldene Regel lautet, dass das System den physischen Speicher einer Ressource erst dann freigeben darf, wenn ihr Referenzzähler exakt den absoluten Wert 0 erreicht[^23].

Die Komplexität steigt exponentiell, da Addressables Abhängigkeiten über die AssetBundle-Architektur verwaltet. Beim Laden einer Ressource (z. B. eines Materials) lädt das System nicht nur das Material selbst, sondern automatisch sämtliche AssetBundles, die dessen abhängige Komponenten enthalten (z. B. Texturen)[^25]. Der Abhängigkeitsgraph (Dependency Graph) wird auf Bundle-Ebene berechnet: Verweist eine Ressource in Bundle A auf eine Ressource in Bundle B, muss das gesamte Bundle B in den Host-Speicher geladen werden[^26].

Die starrste technische Einschränkung von Unity in dieser Architektur lautet: **Benutzer können den Inhalt eines AssetBundles nicht teilweise entladen (partially unload)**[^23]. Zur Veranschaulichung: Angenommen, ein AssetBundle namens `"stuff"` enthält drei unabhängige Ressourcen: `Baum`, `Panzer` und `Kuh`[^23].

1. Wird die Ressource `Baum` geladen, zeigt der Profiler eine Referenz für `Baum` sowie eine entsprechende Referenz für das Bundle `stuff` an[^23].
2. Wird anschließend die Ressource `Panzer` geladen, steigt der Zähler von `Panzer` auf 1 und der Zähler von `stuff` auf 2[^23].
3. Führt das Spiel nun `Release(Baum)` aus, sinkt der Zähler von `Baum` auf 0, und der blaue Balken im Profiler verschwindet[^23].
4. Dennoch verbleiben die physischen Daten von `Baum` vollständig im Systemspeicher. Da `Panzer` weiterhin eine Verbindung aufrechterhält, durch die der Referenzzähler des AssetBundles `stuff` größer als 0 bleibt, darf keine Ressource aus diesem Bundle entfernt werden, bis das gesamte Bundle vollständig freigegeben wurde[^23].

### „Asset Churn“-Syndrom und Speicheraufblähung (Memory Bloat)

Das Phänomen, bei dem Ressourcen innerhalb kurzer Zeit fortlaufend geladen, freigegeben und sofort wieder neu geladen werden, wird als „Asset Churn“ bezeichnet[^23]. Dieses Problem tritt häufig beim Wechsel zwischen Levels auf. Verwendet Level 1 die Ressource `Boot` und Level 2 die Ressource `Flugzeug` (die sich beide eine `Tarnung`-Textur teilen), gibt der Entwickler beim Verlassen von Level 1 `Boot` frei, woraufhin Addressables sofort die `Tarnung`-Textur aus dem Speicher entfernt. Eine Millisekunde später instanziiert Level 2 `Flugzeug`, was die Festplatte zwingt, einen erneuten I/O-Zyklus durchzuführen und genau jene `Tarnung`-Textur von Grund auf neu zu laden[^23]. Dieser Vorgang erzeugt plötzliche Spitzen (Spikes) in der Frame-Zeit und treibt den Speicherverbrauch in gefährliche Bereiche, insbesondere auf mobiler Hardware[^27].

Darüber hinaus führt ein vergessener `Release`-Aufruf zur Ansammlung verwaister Referenzen, wodurch die RAM-Belegung innerhalb weniger Szenenwechsel von einigen hundert Megabyte in den Gigabyte-Bereich anwachsen kann[^28]. Da weder `DelayedActionManager` noch Addressables selbst Instanzen verfolgt, die über das reine `Instantiate` von `MonoBehaviour` erzeugt wurden, führt jeder Fehler bei der Nachverfolgung von Speicher-Handles zu einem dauerhaften Speicherleck[^6].

### Datenkomprimierungsarchitektur und Speicherallokationsdruck

Die Größe von AssetBundles sowie das gewählte Komprimierungsverfahren wirken sich unmittelbar darauf aus, wie Daten im RAM abgelegt werden. Die Wahl der Komprimierungsmethode entscheidet darüber, ob ein AssetBundle dauerhaft eine große Speichermenge belegt oder die Bandbreite effizient optimieren kann.

Zusammenfassende Tabelle der Eigenschaften von AssetBundle-Komprimierungsalgorithmen und deren Speicherauswirkungen[^29]:

| Komprimierungsalgorithmus | Lokale Dateierkennung | Erfordert vollständiges Laden des Bundles in den RAM | Leistungs- & Speicherauswirkungen |
| :--- | :--- | :--- | :--- |
| **LZMA** | Nein. Das Bundle wird als monolithischer Block komprimiert. | **Ja.** Die gesamte Datei muss in den Speicher entpackt werden. | Höchste Kompressionsrate und kleinste Download-Größe, verursacht jedoch akuten Memory Bloat und hohe CPU-Last beim Entpacken[^29]. |
| **LZ4** | Ja. Blockbasierte Komprimierung (Chunk-based). | **Nein.** Lädt nur die jeweils benötigten Datenabschnitte. | Als Standard (Default) empfohlen. Ermöglicht direktes Caching auf dem lokalen Datenträger, ohne alle Metadaten in den RAM laden zu müssen[^29]. |
| **Uncompressed** | Ja. Unabhängige Erkennung jeder einzelnen Ressource. | **Nein.** Direkter Zugriff. | Keine Entpackungszeit, größte Rohdateigröße. Optimal für sofortiges Laden, sofern die Datenträgerbandbreite ausreicht[^29]. |

Wird eine winzige Ressource aus einem riesigen LZMA-komprimierten AssetBundle angefordert, muss die gesamte Datei (einschließlich Header, Metadaten und Streaming-Cache-Tabellen) von der Festplatte in den RAM übertragen werden[^27]. Dieser Designfehler verwandelt übergroße AssetBundles in tickende Zeitbomben, die zu Out-of-Memory-Abstürzen (OOM Crashes) der Anwendung führen[^27].

## Best Practices für die Ressourcenverwaltung

Um die Komplexität des Referenzzählungssystems zu beherrschen und die Belastung von `DelayedActionManager` gering zu halten, müssen Systemarchitekten einen äußerst strikten Lebenszyklus in Verbindung mit Techniken zur Optimierung des Ressourcenlebenszyklus durchsetzen.

### 1. Synchronisierung des Initialisierungs- und Freigabezyklus

Jedes von der API zurückgegebene `AsyncOperationHandle`-Objekt muss am Ende seines Nutzungszyklus zwingend freigegeben werden[^6]. Das Versäumnis verursacht nicht nur Speicherlecks, sondern kann auch Systemabstürze (Crashes) hervorrufen[^6]. Die folgende Tabelle zeigt die obligatorischen symmetrischen Paare in der Addressables-Programmierung:

| Initialisierungs- / Lademethode | Entsprechende Freigabemethode | Interner Funktionsmechanismus |
| :--- | :--- | :--- |
| `Addressables.LoadAssetAsync` | `Addressables.Release(handle)` | Verringert den Referenzzähler des enthaltenden AssetBundles um 1[^6]. |
| `Addressables.InstantiateAsync` | `Addressables.ReleaseInstance(gameObject)` | Zerstört das angezeigte Objekt (Instance) und verringert automatisch den Zähler des ursprünglichen Prefabs um 1[^4]. |
| Zuweisung über `AssetReference` | `reference.ReleaseAsset()` | Entspricht dem Aufruf von `Release` über ein Handle und bereinigt statische Referenzen[^6]. |

Insbesondere bei der Verwendung von `ScriptableObject`-Assets zur Speicherung von Spieleinstellungen erzeugt das direkte Referenzieren eines Objekts (`public Object _worldAsset`) harte Referenzen (Hard References), die das gesamte System zwingen, diese Ressource sofort in den RAM zu laden[^27]. Die optimale Lösung besteht darin, `AssetReference` (`public AssetReference addressableAsset;`) einzusetzen, um bedarfsgerechtes asynchrones Laden (On-Demand Loading) zu ermöglichen[^6].

### 2. Eingriff auf niedriger Ebene: Resources.UnloadUnusedAssets()

In einer Pattsituation, in der gemeinsam genutzte AssetBundles aufgrund der Eigenschaft „kein teilweises Entladen“ im Speicher feststecken (z. B. `Baum` zusammen mit `Panzer`), besteht der einzige Ausweg im Aufruf einer erzwungenen API aus der Basisschicht der Engine: `Resources.UnloadUnusedAssets()`[^25].

Diese Funktion führt einen Tiefenscan durch den gesamten System-RAM durch, um jede Ressource (einschließlich jener, die in AssetBundles verborgen sind) aufzuspüren, deren tatsächliche interne Engine-Referenzanzahl (Actual Engine References) exakt 0 beträgt, und zerstört diese zwangsweise[^25]. Dennoch ist dies ein extrem rechenintensiver Vorgang, der schwerwiegende FPS-Einbrüche (FPS Drops) verursacht, da die CPU den Logik-Thread anhalten muss, um den Bereinigungsprozess durchzuführen[^27]. Ingenieure sollten diesen Befehl nur während großer Ladebildschirme (Loading Screens) auslösen oder die automatische Ausführung durch das System beim Szenenwechsel mit `SceneManager.LoadScene` nutzen[^29].

### 3. Planung und Aufteilung von AssetBundles (Bundle Packing Modes)

Die Strukturierung der Gruppen (Groups) in der Addressables-Konfigurationsoberfläche bestimmt unmittelbar die Speicherladeleistung und die Download-Bandbreite. Die Wahl des passenden Verpackungsmodus (Bundle Mode) für den jeweiligen Ressourcentyp ist ein entscheidender Entwurfsschritt[^6]:

* **Pack Together (Gemeinsam verpacken)**: Für Ressourcen mit eng gekoppeltem Lebenszyklus verwenden, die immer gemeinsam auftreten. Dies minimiert den Aufwand für die Analyse des Abhängigkeitsgraphen sowie Netzwerk-I/O[^6].
* **Pack Separately (Separat verpacken)**: Optimal für riesige, unabhängige Ressourcen oder große Level-Karten, deren gleichzeitiges Laden nicht garantiert werden kann. Verhindert das Risiko, dass eine große Ressource die Freigabe einer anderen, kleineren Ressource blockiert[^6].
* **Pack Together By Label (Nach Label verpacken)**: Ermöglicht das Zusammenführen verstreuter Ressourcen über Label-Metadaten (z. B. Vergabe des Labels `"Halloween 2023"`, um alle Event-Inhalte in einem einzigen Bundle für einfache CDN-Updates zu bündeln)[^6].

Um den Speicherbedarf der Inhaltsverzeichnis-Tabelle (`TypeTree`) im AssetBundle weiter zu reduzieren, können Entwickler die Option `BuildAssetBundleOptions.DisableWriteTypeTree` aktivieren. Diese Funktion entfernt überflüssige Metadaten, erfordert jedoch vor dem Exportieren der ausführbaren Datei ein erneutes Erstellen der lokalen Gruppen (Rebuild Local Groups)[^26].

### 4. Verwaltung des Audio- und Grafikspeichers (Graphics & Audio)

Die Optimierung der Hilfsschichten ist die wirksamste Maßnahme, um die Aktivitätsfrequenz des Garbage Collectors zu senken. Die Konfiguration des Ladeformats von Audiostreams wirkt sich direkt auf den Speicher aus[^27]:

* **Lange Hintergrundmusik (BGM)**: Sollte auf **Streaming** konfiguriert werden, um nur kleine Pufferbereiche von der Festplatte nachzuladen[^27].
* **Lange Soundeffekte**: **Compressed In Memory** wählen, um sie im RAM komprimiert zu halten und bei der Wiedergabe in Echtzeit zu dekodieren[^27].
* **Kurze / häufig genutzte Soundeffekte**: **Decompress On Load** verwenden, um direkt unkomprimierte Daten bereitzuhalten und CPU-Kosten zu vermeiden[^27].

Zudem reduziert das Deaktivieren der Option `"Read/Write enabled"` bei Texturen sowie die Deaktivierung des Tiefenpuffers (Depth Stencil Format auf `None`) für die Benutzeroberflächen-Kamera (UI-Kamera) den unnötigen Rendering-RAM-Bedarf um mindestens 50 %[^27].

## Fazit zur globalen Interaktion

Die Untersuchung von `DelayedActionManager` entschlüsselt nicht nur den Ursprung eines verborgenen Objekts in der `DontDestroyOnLoad`-Szene, sondern legt auch die grundlegende Designphilosophie des Addressables-Systems in Unity offen. Diese `ComponentSingleton`-Klasse fungiert als fein abgestimmte zeitliche Brücke, die die Datenintegrität wahrt, indem sie Freigabeprozesse, asynchrone Aufrufe und Pufferverarbeitung in den `LateUpdate`-Zyklus umleitet. Sie isoliert strukturelle Speicheränderungen von Störungen, die durch Physikcode oder Steuerungslogik im `Update`-Fluss verursacht werden könnten, und bildet so einen Schutzschild gegen Systemkorruptions-Ausnahmen bei Szenenwechseln.

Dennoch ist `DelayedActionManager` kein Zauberstab, der die inhärenten Schwächen einer mangelhaften Speicherverwaltungsarchitektur beheben könnte. Er stellt strenge Anforderungen an Softwarearchitekten: einen vollständig symmetrischen Lade-/Freigabezyklus der Ressourcen aufrechtzuerhalten, anonyme C#-Ausdrücke (Lambdas) so zu gestalten, dass sie keine nativen C++-Objekte in einer Erfassungsschleife festhalten, und die AssetBundle-Struktur zu modularisieren, um hartnäckigen Speicherlecks vorzubeugen. Durch fundiertes Verständnis des asynchronen Lade-Routings, den gezielten Einsatz von Komprimierungsmethoden wie LZ4 sowie die durchdachte Kombination mit der erzwungenen Bereinigung durch `Resources.UnloadUnusedAssets` können Entwicklungsteams solide, plattformübergreifend skalierbare Architekturen entwerfen, ohne eine dauerhafte Erschöpfung der Ressourcen befürchten zu müssen.

## **Referenzen**

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

### Weiterführende Literatur

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
