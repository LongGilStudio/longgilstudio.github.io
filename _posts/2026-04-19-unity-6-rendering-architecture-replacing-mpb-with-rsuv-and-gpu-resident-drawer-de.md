---
title: "Rendering-Architektur in Unity 6: Verzicht auf MPB zur tiefgehenden Material-Optimierung"
date: 2026-04-19 12:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, rendering, optimization, shaders, dots, longgilstudio]
description: "Umfassende Analyse des Architekturwechsels von MaterialPropertyBlock zu RSUV und dem GPU Resident Drawer für AAA-Performance in Unity 6."
lang: de
translation_id: unity6-material-rsuv-grd
math: true
---

## **Zusammenfassung (Executive Summary)**

Der Übergang zu Unity 6 markiert einen grundlegenden architektonischen Wandel in der Art und Weise, wie Render-Pipelines instanziierte Geometrie (instanced geometry) in großem Umfang verarbeiten. In der Geschichte der Spieleentwicklung stützte sich die Optimierung zahlreicher Objekte, die ein gemeinsames Material teilen, aber individuelle Eigenschaftsvarianten (wie Farbvariationen — Color Tints) erfordern, üblicherweise auf die Application Programming Interface (API) `MaterialPropertyBlock` (MPB) in Verbindung mit dem Standard-GPU-Instancing-System. Eine eingehende Analyse der Universal Render Pipeline (URP) und der High Definition Render Pipeline (HDRP) in Unity 6 zeigt jedoch, dass dieser veraltete Ansatz (Legacy) nicht mehr der optimale Weg ist und in vielen Fällen zu massiven Leistungseinbußen führt.

Die Prüfung des vom Nutzer bereitgestellten Dokumententwurfs für das „Long Gil Studio DevLog“ offenbart eine Mischung aus veralteter Optimierungstheorie, die in früheren Versionen zutreffend war, und einem schwerwiegenden Missverständnis der modernen Rendering-Funktionen von Unity 6. Konkret steht die Empfehlung von `MaterialPropertyBlock` im direkten Widerspruch zur neuen Technologie **GPU Resident Drawer (GRD)** von Unity 6 und der darunterliegenden API **BatchRendererGroup (BRG)**.[^1] Um maximale Rendering-Performance zu erreichen, müssen Entwickler zwingend **Renderer Shader User Value (RSUV)** einsetzen oder vollständig auf den **Data-Oriented Technology Stack (DOTS)** umsteigen.[^3]

Dieser Forschungsbericht bietet eine gründliche technische Analyse der Rendering-Engpässe, der Funktionsweise des Scriptable Render Pipeline (SRP) Batchers, der systemischen Folgen von Material-Duplizierung sowie der modernen Muster, die für Rendering-Performance auf AAA-Niveau in Unity 6 erforderlich sind. Darüber hinaus liefert der Bericht einen überarbeiteten, professionell aufbereiteten Fachartikel für die Veröffentlichung im Long Gil Studio DevLog.

## **Teil I: Technische Bewertung des ursprünglichen Entwurfs von Long Gil Studio**

Der ursprüngliche Entwurf beschreibt ein sehr spezifisches Rendering-Problem: die Optimierung einer Szene mit unzähligen identischen Objekten, die ein einziges Material teilen, aber individuelle Farbmodifikationen benötigen. Der Entwurf identifiziert die Anti-Patterns korrekt, schlägt jedoch eine Lösung vor, die im architektonischen Kontext von Unity 6 die Leistung verschlechtert.

### **Korrekte Punkte des ursprünglichen Entwurfs**

1. **Nachteile der Material-Duplizierung (Material Duplication):** Der Entwurf hält korrekt fest, dass die Erstellung separater Material-Instanzen pro Objekt (z. B. über `GetComponent<Renderer>().material.color`) zu Speicheraufblähung (Memory Bloat) führt und das Zusammenfassen von Zeichenaufrufen (Draw Call Batching) vollständig zerstört.[^5] Der Zugriff auf die Eigenschaft `.material` zwingt die Unity-Engine dazu, stillschweigend einen Klon dieses Materials anzulegen, wodurch dem SRP Batcher oder GPU Instancing dauerhaft die Möglichkeit genommen wird, diese Objekte in einem einzigen `SetPass`-Aufruf zu gruppieren.[^5]
2. **Mechanismus von `MaterialPropertyBlock` (MPB):** Der Entwurf erkennt richtig, dass MPB als Daten-Überschreibungspuffer (Data Override Buffer) fungiert, mit dem der Renderer Instanz-spezifische Eigenschaften (per-instance) an die GPU übergeben kann, ohne einen neuen Material-Klon zu erzeugen.[^7]
3. **String-Eigenschaften vs. Integer-IDs:** Der Entwurf hebt treffend die CPU-Latenz hervor, die durch die Verwendung von Zeichenketten (Strings) zum Nachschlagen von Shader-Eigenschaften entsteht, und befürwortet die Vorab-Initialisierung von Integer-Bezeichnern über `Shader.PropertyToID()` zur Optimierung von Schleifen.[^7]

### **Schwerwiegende Fehler und veraltete Paradigmen**

1. **MPB als „AAA-Standard“ in Unity 6:** Der gravierendste Mangel im ursprünglichen Entwurf ist die Behauptung, MPB stelle die optimale „AAA“-Lösung für Unity 6 dar. Während MPB in der alten Built-In Render Pipeline (Legacy-Architektur) Standard war, wirkt er in modernen SRP-Architekturen als störender Störfaktor.[^8] Die Anwendung eines MPB auf ein GameObject schließt dieses Objekt sofort aus der SRP-Batcher-Pipeline aus.[^10]
2. **Abhängigkeit vom Legacy-GPU-Instancing:** Der Entwurf räumt ein, dass MPB den SRP Batcher aufbricht, und schlägt als Ausweichlösung klassisches GPU Instancing vor. Obwohl dies technisch durch manuelles Brechen der SRP-Kompatibilität und Aktivieren von Instancing machbar ist, zwingt es die Engine dazu, die hochoptimierte SRP-Architektur zu umgehen.[^12]
3. **Ignorieren des GPU Resident Drawer (GRD):** Unity 6 führt den GPU Resident Drawer ein — ein System, das die Erzeugung von Draw Calls auf Compute Shader auslagert und den CPU-Verarbeitungsaufwand um bis zu 50 % senkt.[^14] Das Vorhandensein eines `MaterialPropertyBlock` verbietet einem GameObject strikt die Teilnahme am GRD.[^1] MPB in Unity 6 zu empfehlen verhindert faktisch, dass Projekte die leistungsstärkste neue Optimierungsfunktion der Engine nutzen können.
4. **Fehlen von Renderer Shader User Value (RSUV):** Eingeführt in Unity 6.3 LTS, ist RSUV der direkte architektonische Ersatz für MPB bei einfachen Variationen pro Objekt.[^15] RSUV erlaubt die Übergabe eines 24-Bit-Integers an den Shader für jeden Renderer, ohne den SRP Batcher oder den GPU Resident Drawer zu unterbrechen.[^3]

## **Teil II: Ursachenanalyse von Rendering-Engpässen (Bottlenecks)**

Um zu verstehen, warum bestimmte API-Aufrufe die Bildrate (Frame Rate) zerstören, muss das Kommunikationsmodell zwischen Hauptprozessor (CPU) und Grafikprozessor (GPU) untersucht werden. Moderne Hardware-Architekturen erfordern eine enge, aber latenzempfindliche Synchronisation zwischen diesen beiden Prozessoren.

### **CPU-GPU-Kommunikationsaufwand (Overhead)**

Das Rendern eines Frames erfordert, dass die CPU alle im Sichtfeld der Kamera sichtbaren Objekte durchläuft (Frustum Culling), deren Material-Eigenschaften ermittelt, die benötigten Texturen und Shader in den GPU-Speicher bindet und schließlich einen Zeichenbefehl (Draw Command) absetzt. Der teuerste Vorgang in dieser Pipeline ist nicht das Zeichnen von Polygonen durch die GPU, sondern die vor dem Zeichenaufruf zwingend erforderlichen Zustandswechsel — üblicherweise als **SetPass Calls** bezeichnet.[^5]

Immer wenn die CPU auf ein neues Material trifft, muss sie die Render-Pipeline anhalten, um die neuen Parameter auf die GPU hochzuladen.[^18] Enthält eine Szene 10.000 Gegner und besitzt jeder Gegner eine eigene Material-Instanz für eine andere Rüstungsfarbe, muss die CPU 10.000 Zustandswechsel durchführen. Dies erzeugt enormen CPU-Overhead und führt zu einem Engpass, bei dem die GPU untätig auf Anweisungen der CPU wartet.

### **Speicherfragmentierung durch die Eigenschaft `.material`**

Wenn ein Skript auf `Renderer.material` zugreift, um die Farbe zu ändern, muss die Engine die Integrität des ursprünglich geteilten Assets schützen. Sie führt intern ein `Instantiate()` auf diesem Material aus. Dies zieht zwei schwerwiegende Leistungseinbußen nach sich:

1. **Zerstörung des Batchings:** Das Objekt teilt keine Material-Referenz mehr mit seinen gleichartigen Objekten. Unverzüglich stoppt Unity jede Form von Static Batching, Dynamic Batching oder SRP Batching für dieses Objekt.[^5] Die Grafikkarte muss es als völlig eigenständige Entität verarbeiten.
2. **Garbage Collection und Speicherlecks (Memory Leaks):** Der neu erzeugte Material-Klon entsteht auf dem von C# verwalteten Heap. Er wird nicht automatisch vom Garbage Collector bereinigt, wenn das Objekt zerstört wird. Sofern der Entwickler nicht explizit `Destroy(renderer.material)` aufruft, bleibt der Speicher belegt. Dies erzeugt ein Speicherleck, das den Garbage Collector (GC) zwingt, Mark-and-Sweep-Durchläufe auszulösen, was zu massiven Rucklern (Spikes) und plötzlichen FPS-Einbrüchen führt.[^5]

## **Teil III: Architektur des SRP Batchers und die Veralterung des klassischen GPU Instancing**

Die Scriptable Render Pipeline (SRP) hat die Art und Weise, wie Unity Shader-Daten verwaltet, grundlegend neu organisiert. Das Verständnis des SRP Batchers ist entscheidend, um nachzuvollziehen, warum alte Optimierungsmethoden in Unity 6 vollständig versagen.

### **Funktionsweise des SRP Batchers**

In älteren Pipelines (Built-in) luden Materials ihre Daten über separate Uniform-Variablen auf die GPU. Der SRP Batcher ersetzt diesen Ansatz durch große, persistente GPU-Puffer, sogenannte **Constant Buffers (CBUFFERs)**.[^11]

Die SRP-Architektur schreibt vor, dass Shader ihre Variablen in zwei getrennte Pufferblöcke aufteilen[^11]:

* `UnityPerMaterial`: Ein CBUFFER mit Eigenschaften, die von allen Objekten geteilt werden, die dasselbe Material verwenden (z. B. Basisfarbe, Metallic Maps, Glätte/Rauheit).
* `UnityPerDraw`: Ein CBUFFER mit Eigenschaften, die für den jeweiligen Zeichenaufruf einzigartig sind (z. B. räumliche Transformationsmatrizen des Objekts).

Da der `UnityPerMaterial`-Puffer dauerhaft im GPU-Speicher verbleibt, muss die CPU während der Render-Schleife keine Material-Eigenschaften erneut hochladen, solange aufeinanderfolgende Objekte dieselbe Shader-Variante (Shader Variant) teilen.[^18] Der SRP Batcher bindet lediglich diesen persistenten Puffer und aktualisiert den deutlich kleineren `UnityPerDraw`-Puffer. Dieses Design senkt den CPU-Aufwand drastisch und steigert die Rendering-Geschwindigkeit mitunter um das 1,2- bis 4-Fache.[^21]

### **Der Kernkonflikt mit `MaterialPropertyBlock`**

Die `MaterialPropertyBlock`-API wurde ursprünglich entwickelt, um Material-Eigenschaften auf Renderer-Ebene zu überschreiben. Da der SRP Batcher jedoch auf der strikten Trennung und Persistenz des `UnityPerMaterial`-CBUFFERs basiert, verletzt das Injizieren eines MPB dieses Speicherlayout direkt.[^8]

Sobald ein MPB angewendet wird, kann Unity nicht mehr garantieren, dass der persistente Material-Puffer einheitlich auf das Objekt zutrifft. Folglich ist die Engine gezwungen, das Objekt abrupt aus der Pipeline des SRP Batchers zu entfernen.[^9] Die offizielle Unity-Dokumentation bestätigt ausdrücklich: *„Beachten Sie, dass diese Funktion nicht mit dem SRP Batcher kompatibel ist. Die Verwendung von MPB in URP oder HDRP führt wahrscheinlich zu einem Leistungsabfall.“*[^8]

### **Die Legacy-Ausweichlösung: `Graphics.DrawMeshInstanced`**

Historisch gesehen nahm ein Entwickler bei Bedarf an massiven Variationen (z. B. einem Wald aus unterschiedlich gefärbten Bäumen) den Verlust des SRP Batchers in Kauf und griff auf GPU Instancing zurück.[^12] Dies erforderte das manuelle Brechen der SRP-Kompatibilität des Shaders, indem eine Eigenschaft außerhalb des `UnityPerMaterial`-Puffers deklariert und „Enable GPU Instancing“ am Material aktiviert wurde.[^13]

Obwohl GPU Instancing die Anzahl der Draw Calls reduziert, indem Arrays von Transformationsmatrizen und Farbdaten übergeben werden, bringt es gravierende Einschränkungen mit sich.[^12] Es kämpft mit starkem Overdraw, setzt identische Meshes voraus und belastet die CPU erheblich, da Instanz-Arrays in jedem Frame gesammelt und hochgeladen werden müssen. In Unity 6 wurde dieses Verfahren vollständig durch die GPU-Resident-Drawer-Architektur ersetzt.[^23]

## **Teil IV: Inkompatibilität von `MaterialPropertyBlock` (MPB) mit dem Unity-6-Ökosystem**

Eine tiefere Analyse von MPB zeigt, dass es nicht nur den SRP Batcher aufbricht, sondern auch strukturelle Risiken für Debugging-Werkzeuge und Beleuchtungssysteme (Lighting Systems) in Unity 6 birgt.

### **Auswirkungen auf Lightmap-Daten und Global Illumination**

Eine der am wenigsten beachteten Folgen einer unsachgemäßen Verwendung von MPB ist das Löschen von Lightmap-Daten. Wenn Sie ein `new MaterialPropertyBlock()` erstellen und über `Renderer.SetPropertyBlock()` zuweisen, überschreibt der übergebene Eigenschaftsblock den lokalen Zustand des Renderers vollständig.[^24]

Verwendet Ihr Objekt gebackene Global Illumination (GI), werden die Informationen zu Lightmap-UV-Koordinaten und Light-Probe-Koeffizienten implizit genau in diesem Property Block des Renderers gespeichert.[^24] Wenn Sie vor dem Setzen der Farbe nicht `Renderer.GetPropertyBlock(block)` aufrufen, löschen Sie versehentlich die Beleuchtungsinformationen des Objekts. Obwohl der ursprüngliche Entwurf von Long Gil Studio diesen `GetPropertyBlock`-Teil korrekt behandelt hat, verursacht allein der wiederholte Aufruf dieser API bei Tausenden von Objekten eine nicht zu vernachlässigende zusätzliche CPU-Latenz.

| Optimierungstechnik            | Verursacht RAM-Leck | SRP-Batcher-kompatibel | GRD-kompatibel | DOTS-kompatibel | Empfohlene Verwendung       |
| :----------------------------- | :------------------ | :--------------------- | :------------- | :-------------- | :-------------------------- |
| **`Material.color`**           | Ja                  | Nein                   | Nein           | Nein            | Unbedingt vermeiden         |
| **`MaterialPropertyBlock`**    | Nein                | Nein                   | Nein           | Nein            | Für alte Built-in-Projekte  |
| **GPU Instancing**             | Nein                | Nein (Konflikt)        | Nein           | Nein            | Unity 2020–2022             |
| **Renderer Shader User Value** | Nein                | Ja                     | Ja             | Ja              | Unity 6.3+ Standard         |

Wie die obige Tabelle zeigt, ist MPB heute eine Technik der Vorgängergeneration. Sie löst das RAM-Problem, zerstört jedoch die gesamte moderne Render-Pipeline von Unity 6.

## **Teil V: Der architektonische Wendepunkt: GPU Resident Drawer (GRD) und `BatchRendererGroup` (BRG)**

Unity 6 führt einen revolutionären Render-Pfad ein: den **GPU Resident Drawer**. Dieses System verlagert das Paradigma von einer CPU-gesteuerten Draw-Call-Erzeugung hin zu einer hochgradig autonomen, GPU-gesteuerten Render-Schleife.[^1]

### **Architektur des GPU Resident Drawer**

Der GPU Resident Drawer basiert auf der Low-Level-API `BatchRendererGroup` (BRG).[^1] Anstatt dass die CPU auswertet, welche Objekte sichtbar sind (Frustum Culling), und einzelne oder instanziierte Draw Calls absetzt, lädt die CPU sämtliche räumlichen Daten und Material-Daten der Szene auf die GPU hoch.[^25] Compute Shader übernehmen anschließend das Aussortieren von Objekten außerhalb der Kamera, das Verdeckungs-Culling (Occlusion Culling) und die Erzeugung von Zeichenbefehlen vollständig auf der GPU.[^14]

Die Leistungssteigerung ist beeindruckend. Durch indirektes Rendering (`DrawInstancedIndirect`) lässt sich der CPU-Arbeitsaufwand für das Rendering in komplexen Szenen um bis zu 50 % reduzieren.[^14] Darüber hinaus kann in Kombination mit GPU Occlusion Culling die Dreiecksverarbeitung um nahezu 90 % gesenkt werden, während sich die GPU-Frame-Zeit (Frame Buffer Time) mehr als halbiert.[^28]

### **Die `BatchRendererGroup`-API (BRG) und Culling**

Hinter dem GRD steht `BatchRendererGroup`. BRG erfordert die Initialisierung mit einer Callback-Funktion `OnPerformCulling`.[^30] Hier konfiguriert die CPU lediglich die Sichtbarkeit und gibt gebündelte Zeichenaufrufe in Array-Form aus. Objektdaten (Transforms, Farben, Flags) werden in einen `GraphicsBuffer` geladen.[^25] Dadurch können Millionen von Dreiecken mit nur wenigen `SetPass`-Aufrufen an die GPU gesendet werden.

### **Die fatale Inkompatibilität von MPB mit GRD**

Die wichtigste Erkenntnis für die Optimierung in Unity 6 ist die Strenge der Zulässigkeitsvoraussetzungen für den GPU Resident Drawer. Damit ein Objekt vom GRD verarbeitet werden kann, muss es strikte Datenlayout-Regeln einhalten.[^2]

Die offizielle Dokumentation von Unity 6.1+ erklärt ausdrücklich, dass GameObjects, die die `MaterialPropertyBlock`-API verwenden, sofort vom GPU Resident Drawer ausgeschlossen werden.[^1] Außerdem darf das Objekt keine Skripte besitzen, die Per-Instance-Callbacks wie `OnRenderObject` nutzen.[^2]

Wenn ein Entwickler ein MPB anfügt, um die Farbe eines Objekts zu ändern, zwingt er die Engine unbeabsichtigt dazu, für dieses spezifische Objekt in den veralteten CPU-basierten Render-Modus zurückzufallen. Geschieht dies bei 10.000 Militäreinheiten in einem Echtzeit-Strategiespiel, schießt der CPU-Overhead rasant in die Höhe und macht sämtliche Vorteile des Upgrades auf Unity 6 zunichte.

## **Teil VI: Der moderne Standard: Renderer Shader User Value (RSUV) in Unity 6.3**

In Anerkennung der architektonischen Sackgasse, die durch die Inkompatibilität von MPB mit modernen Pipelines entstand, führte Unity in der Version Unity 6.3 LTS die Funktion **Renderer Shader User Value (RSUV)** ein.[^15] RSUV dient als endgültiger Ersatz für `MaterialPropertyBlock`, wenn Entwickler einfache Per-Instance-Anpassungen auf viele Renderer mit demselben Material anwenden müssen.[^3]

### **Funktionsweise von RSUV**

RSUV umgeht die komplexen Puffermodifikationen, die der Nachteil von MPB waren. Stattdessen nutzt es einen hocheffizienten 24-Bit-Integer-Kanal, der direkt zusammen mit den Standard-Zeichendaten des Renderers übergeben wird.[^3] Da dieser Integer in die bestehende Datenstruktur integriert ist und keinen separaten Überschreibungspuffer (Buffer Override) benötigt, bleibt die volle Kompatibilität sowohl mit dem SRP Batcher als auch mit dem GPU Resident Drawer erhalten.[^3]

### **Implementierung und Bitwise-Kodierung (Bitwise Encoding)**

Um RSUV für Farbvariationen zu nutzen, muss die CPU die gewünschten RGB-Werte in einen einzigen vorzeichenlosen 24-Bit-Integer (`uint`) kodieren. Jeder Farbkanal (Rot — Red, Grün — Green, Blau — Blue) belegt 8 Bit (was Werte von 0 bis 255 ermöglicht).[^3]

Die Kodierungsoperation verwendet die bitweisen Operatoren Linksverschiebung (`<<`) und bitweises ODER (`|`). Die mathematische Gleichung lautet:

$$
Color_{uint} = (Blue_{byte} \ll 16) | (Green_{byte} \ll 8) | (Red_{byte})
$$

In der praktischen C#-Implementierung liefert das Durchlaufen eines Arrays von `MeshRenderer`-Komponenten zum Zuweisen eines zufälligen Farbtons eine sehr hohe Performance ohne jegliche Speicherallokation auf dem Managed Heap (Zero Garbage Allocation)[^3]:

```csharp
MeshRenderer allMeshRenderers = FindObjectsByType<MeshRenderer>(FindObjectsSortMode.InstanceID);  
foreach (MeshRenderer meshRenderer in allMeshRenderers)  
{  
    // Berechnet eine zufällige Farbe (HSV-Farbraum für kräftigere Farben)  
    Color32 targetColor = Color.HSVToRGB(UnityEngine.Random.Range(0f, 1f), 1f, 1f);  

    // Kodiert RGB in einen 24-Bit-Integer (Blau, Grün, Rot)  
    uint encodedColor = ((uint)targetColor.b << 16) |   
                        ((uint)targetColor.g << 8) |   
                        ((uint)targetColor.r << 0);  

    // Wendet den Wert über die neue Unity-6.3-API direkt auf den Renderer an
    meshRenderer.SetShaderUserValue(encodedColor);  
}
```

### **Dekodierung im Shader (Shader Decoding)**

Auf GPU-Seite muss der Shader diesen 24-Bit-Integer wieder in einen normalisierten `float4`-Farbwert entpacken (unpack). Unity stellt die eingebaute Variable `unity_RendererUserValue` bereit, um auf diesen Datenblock zuzugreifen.[^3]

Der Dekodiervorgang verwendet den bitweisen Rechtsverschiebungsoperator (`>>`) und den bitweisen UND-Operator (`&`) mit einer Bitmaske von `255`, um jedes 8-Bit-Segment zu isolieren. Anschließend wird mit dem Kehrwert von 255 (`1.0 / 255.0`) multipliziert, um den Wert in den Bereich zwischen `0.0` und `1.0` zu normalisieren.[^3]

$$
Channel_{normalized} = ((unity\_RendererUserValue \gg Shift) \ \& \ 255) \times 0.0039215
$$

In High-Level Shader Language (HLSL) oder über einen Custom-Function-Node in Shader Graph wird die Entpacklogik wie folgt dargestellt[^3]:

```hlsl
uint c = unity_RendererUserValue;  
float4 instanceColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  // Rot-Kanal (Red)  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  // Grün-Kanal (Green)  
    (float)((c >> 16) & 255) * (1.0 / 255.0), // Blau-Kanal (Blue)  
    1.0 // Fester Alpha-Wert  
);
```

Dieser Paradigmenwechsel beweist eine tiefgreifende Optimierungsstrategie: Datenstruktur-Komplexität (wie bei MPB) wird gegen mathematische Berechnung (RSUV) eingetauscht. GPUs sind bei Bitwise-Operationen extrem leistungsfähig, sodass der Dekodieraufwand nahezu unsichtbar bleibt (mit winzigem Taktzyklen-Aufwand). Gleichzeitig führt der Erhalt der SRP-Batcher- und GPU-Resident-Drawer-Pfade zu einer enormen Reduzierung der Frame-Zeit.[^16]

## **Teil VII: Lösung für extreme Skalierung: DOTS, ECS und `URPMaterialPropertyOverride`**

Für Projekte, deren Umfang die Verarbeitungskapazität herkömmlicher GameObjects übersteigt (z. B. Schwarm-Simulationen mit Hunderttausenden unabhängiger Einheiten — Boids, gigantische RTS-Armeen), bietet Unitys Data-Oriented Technology Stack (DOTS) die ultimative Rendering-Architektur.[^4]

### **Datenorientierte Speicherverwaltung (Data-Oriented Memory)**

Anders als bei den Einschränkungen objektorientierter Systeme, in denen GameObjects verstreut im Heap liegen, existieren Entitäten (Entities) im Entity Component System (ECS) ausschließlich als zusammenhängende Daten-Arrays (contiguous arrays of data) im Speicher.[^4] Dieses Speicherlayout passt exakt zu der Struktur, die die `BatchRendererGroup`-API (BRG) für maximale Performance benötigt.

Im Paket Entities Graphics können Entwickler die Komponente `URPMaterialPropertyOverride` nutzen.[^4] Dieses System ermöglicht das Überschreiben von Material-Eigenschaften pro Entität (Per-Entity Material Overrides), ohne jemals die schädliche `MaterialPropertyBlock`-API einzusetzen.

### **Funktionsweise von DOTS Instancing**

Wird eine Entität in DOTS verarbeitet, erhält ein für DOTS Instancing konfigurierter Shader (durch Aktivieren von *Override Property Declaration* und Auswahl von *Hybrid Per Instance* in Shader Graph) einen eindeutigen 32-Bit-Integer (einen Metadatenwert).[^34] Dieser Integer repräsentiert einen Versatz (Offset) innerhalb eines stabilen `GraphicsBuffer` auf der GPU.[^34]

Der Shader nutzt diesen Offset, um die spezifischen Eigenschaftsdaten für die aktuell gerenderte Instanz zu laden.[^34] Das Besondere an DOTS Instancing ist: Teilen mehrere Entitäten denselben Eigenschaftswert, ermöglicht DOTS Instancing ihnen das Laden dieses Werts von exakt derselben Speicheradresse (demselben Offset), was GPU-Zyklen spart und Speicherduplikate minimiert.[^34] Da Eigenschaften per Offset geladen werden statt in starre klassische Constant Buffer gepresst zu sein, ist die Größe eines Draw Calls nicht mehr streng begrenzt, was extrem hohe Instanzzahlen erlaubt.

```csharp
// Beispiel für das Zuweisen von RSUV-Werten über das DOTS- / Burst-Compile-System

public partial struct MaterialMeshInfoSystem : ISystem   
{  
    public void OnUpdate(ref SystemState state)   
    {  
        var entityManager = state.EntityManager;  
        // Parallele Verarbeitung durch direktes Schreiben in ein NativeArray  
        // Bietet eine Ausführungsgeschwindigkeit, die MonoBehaviour niemals erreichen kann.  
    }  
}
```

Das Ändern von Entity-Component-Werten über Bursted Background Jobs (mit dem Burst Compiler kompilierte Hintergrund-Jobs) lässt sich mit atemberaubender Geschwindigkeit ausführen.[^4] Spieler können Zäune haben, deren Farbe sich nach der Geländeneigung richtet, oder Gras, das je nach Höhenlage anders getönt ist — alles gezeichnet in einem einzigen Draw-Call-Strom ohne Engpässe.[^4]

## **Teil VIII: Analyse alternativer Lösungen (Alternative Solutions)**

Der ursprüngliche Entwurf von Long Gil Studio erwähnte kurz alternative Optimierungstechniken. Die folgende Analyse bestätigt deren Machbarkeit, ordnet sie jedoch in die physikalischen Grenzen der Unity-6-Engine ein.

1. **Vertex Colors (Scheitelpunktfarben des Meshs):**
   * *Mechanismus:* Kodierung der Farbdaten direkt in die Scheitelpunkte (Vertices) des 3D-Meshs. Der Shader liest das Attribut `TEXCOORD` oder `COLOR` aus dem Mesh aus.
   * *Effektivität:* Äußerst leichtgewichtig und bewahrt sämtliche Batching-Funktionen sowie die GRD-Kompatibilität vollständig.[^36]
   * *Schwäche:* Das Ändern von Vertex-Farben zur Laufzeit (Runtime) erfordert den Zugriff auf das Mesh-Daten-Array (`mesh.colors`). Diese Aktion erzeugt eine Kopie des Meshs im RAM, was zu CPU-Stalls und unnötigen Speicherallokationen führt. Vertex Colors bleiben daher optimal nur für statische Varianten, die vorab in Programmen wie Blender oder Maya „gebacken“ (baked) wurden.
2. **Texture Atlasing und UV-Offsets:**
   * *Mechanismus:* Zusammenführen mehrerer Farbvarianten in einem einzigen Texturatlas und Verschieben der UV-Koordinaten verschiedener Objekte, um gezielte Pixel abzutasten.[^36]
   * *Effektivität:* Diese Technik belässt es bei einem einzigen Material und einer einzigen Textur und garantiert volle Kompatibilität mit dem SRP Batcher.[^36]
   * *Schwäche:* Ähnlich wie bei Vertex Colors erfordert die dynamische Änderung von UV-Koordinaten auf verschiedenen Objekten zur Laufzeit meist die Erstellung eindeutiger Mesh-Instanzen, was wieder Speicheraufblähung (Memory Bloat) mit sich bringt. Für statisches Umgebungsdesign oder Voxel-Spiele (wie Minecraft) ist diese Technik jedoch unübertroffen.
3. **Low-Level `Graphics.DrawMeshInstanced`:**
   * *Mechanismus:* Vollständiges Umgehen der GameObject-Hierarchie, um Transformationsmatrizen und Farbarrays per C#-Code direkt an die GPU zu senden.[^37]
   * *Effektivität:* Bietet enorme Performance für Systeme wie Schwarm-Algorithmen (Flocking) oder prozedurales Blattwerk.[^38]
   * *Schwäche in Unity 6:* Die Einführung der `BatchRendererGroup`-API und des GPU Resident Drawer hat diese Performance „demokratisiert“ und macht das Schreiben von komplexem Culling- und Draw-Submission-Code in den meisten regulären Entwicklungsszenarien überflüssig.[^19] Ein eigenes `DrawMeshInstanced`-System zu pflegen kostet heute mehr Entwicklungsressourcen, als es vom GPU Resident Drawer automatisieren zu lassen.

## **Teil IX: Empfohlene Inhaltsstruktur für das Long Gil Studio DevLog**

Basierend auf der umfassenden technischen Bewertung bildet der folgende Text den überarbeiteten, empfohlenen DevLog-Artikel auf hohem ingenieurtechnischem Niveau. Er verwirft die fehlerhafte MPB-Methode und führt die Leser zu den wahren Architekturstandards von Unity 6: RSUV und dem GPU Resident Drawer.

---

**Unity 6: Tausende Objekte mit demselben Material optimieren — Weg von MPB hin zur modernen Architektur**

**Von Long Gil Studio**

**🇻🇳 VIETNAMESISCHE AUSGABE (Ins Deutsche übersetzt)**

**1. Der Render-Engpass: Das Problem der Material-Duplizierung**

Bei der Entwicklung großer Spiele stellt sich eine äußerst häufige Architekturfrage: „Wie färbt man Tausende von Objekten, die ein gemeinsames Material teilen, um, ohne dass die FPS einbrechen?“

Viele Programmierer verwenden den Befehl `GetComponent<Renderer>().material.color`. Das ist ein fataler Fehler (Anti-Pattern). Der Aufruf von `.material` zwingt Unity dazu, stillschweigend einen Klon dieses Materials im RAM anzulegen. Die Folgen sind gravierende Speicherlecks, ständige Garbage-Collection-Durchläufe und die vollständige Zerstörung des Batching-Systems. Die GPU verhungert, während die CPU bei der Verarbeitung Tausender separater Draw Calls überlastet wird.

**2. Die Legacy-Falle: Warum `MaterialPropertyBlock` in Unity 6 „tot“ ist**

Früher galt als „Pro-Lösung“, `MaterialPropertyBlock` (MPB) zu verwenden, um Daten pro Objekt zu übergeben, ohne das Material klonen zu müssen. **Aber wenn Sie Unity 6 (URP/HDRP) verwenden, müssen Sie diese Methode sofort aufgeben.**

Unity 6 stützt sich stark auf die **SRP-Batcher**-Pipeline und eine revolutionäre Technologie: den **GPU Resident Drawer (GRD)**. GRD verlagert die gesamte Render-Verarbeitung (Erzeugung von Draw Calls, Culling) auf Compute Shader auf der GPU und reduziert die CPU-Rechenzeit um bis zu 50 %. Laut Kerndokumentation der Engine wird ein Objekt jedoch sofort aus dem SRP Batcher entfernt und verliert jegliche Kompatibilität mit dem GPU Resident Drawer, sobald Sie ein `MaterialPropertyBlock` anhängen. Die Nutzung von MPB bedeutet, dass Sie Unity zwingen, für Ihre gesamte Armee auf die langsame, CPU-lastige Legacy-Render-Pipeline zurückzufallen.

**3. Der neue Standard in Unity 6: Renderer Shader User Value (RSUV)**

Um diese Sackgasse endgültig aufzulösen, führte das Update Unity 6.3 LTS **Renderer Shader User Value (RSUV)** ein. Mit dieser API können Sie direkt einen 24-Bit-Integer an den Renderer übergeben. Da RSUV keine neuen Puffer-Allokationen erfordert, bleibt die Kompatibilität sowohl mit dem SRP Batcher als auch mit dem GPU Resident Drawer zu 100 % erhalten.

**Schritt 1: C#-Kodierung (Zero Garbage Allocation)**

Statt wie bei MPB Zeichenketten (Strings) zu verwenden, kodieren wir die RGB-Farbe mittels Bitshift-Operationen (Bitwise) in einen 24-Bit-Integer:

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Kodiert die 3 Kanäle Blau, Grün und Rot in einen 24-Bit-Integer  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Wert anwenden (Absolut sicher für SRP- und GRD-Architektur!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Schritt 2: Dekodierung in Shader Graph**

Erstellen Sie in Shader Graph einen **Custom Function**-Node (Type: String, Name: DecodeColor) mit einem Vector4-Ausgang. Fügen Sie folgenden HLSL-Code ein, um den Integer wieder in eine Standardfarbe zu entpacken:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Verbinden Sie diesen Ausgang mit dem Base-Color-Eingang des Fragment Shaders. Nun verfügen Sie über unendlich viele Farbvarianten bei null CPU-Latenz und nutzen die volle Leistung des GPU Resident Drawers.

**Beispiel: Praktische Umsetzung in einem Shader-Skript (ohne Shader Graph)**

Wenn Sie einen Custom Shader im Code (HLSL) schreiben, können Sie in die Funktion `BuildSurfaceData` eingreifen, um `unity_RendererUserValue` zu dekodieren und mit `BaseColor` zu multiplizieren, wie im folgenden Ausschnitt gezeigt:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // RSUV dekodieren
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // Farbe rsuvColor anwenden
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ... 
}
```

*Mehr erfahren unter:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Die 100.000-Objekte-Marke überschreiten: Die DOTS-/ECS-Lösung**

Wenn Ihr Spiel das Rendern von Hunderttausenden unabhängiger Einheiten erfordert (wie gewaltige Armeen), wird das traditionelle GameObject-System unweigerlich zum CPU-Engpass, egal wie gut Sie das Rendering optimieren. Wechseln Sie für diese Größenordnung auf Unity DOTS. Die Verwendung der Komponente `URPMaterialPropertyOverride` ermöglicht ein datenorientiertes Speicherlayout, das direkt auf Low-Level-Ebene mit der `BatchRendererGroup`-API kommuniziert und unübertroffene echte AAA-Performance liefert.

---

**🇺🇸 ENGLISCHE AUSGABE (Ins Deutsche übersetzt)**

**1. Der Rendering-Engpass: Material-Duplizierung**

Bei der Entwicklung dicht besiedelter Spiele entsteht eine typische architektonische Herausforderung: „Wie ändere ich die Farbe von Tausenden von Objekten, die dasselbe Material teilen, ohne die Leistung zu zerstören?“

Entwickler greifen oft standardmäßig zu `GetComponent<Renderer>().material.color`. Das ist ein fatales Anti-Pattern. Der Zugriff auf `.material` zwingt Unity dazu, das Material stillschweigend auf dem Managed Heap zu klonen. Dies führt zu starker Speicheraufblähung, löst Garbage-Collection-Spikes aus und zerstört das Draw Call Batching, wodurch der CPU-Overhead auf unbeherrschbare Werte steigt, während die GPU unterfordert bleibt.

**2. Die Legacy-Falle: Warum `MaterialPropertyBlock` in Unity 6 tot ist**

Historisch gesehen bestand die „Pro“-Lösung darin, einen `MaterialPropertyBlock` (MPB) zu nutzen, um Per-Instance-Daten ohne das Klonen von Materials zu übergeben. **Wenn Sie Unity 6 (URP/HDRP) verwenden, müssen Sie diese Methode sofort einstellen.**

Unity 6 baut stark auf den **SRP Batcher** und den revolutionären neuen **GPU Resident Drawer (GRD)**. Der GRD lagert Frustum Culling und Draw-Call-Erzeugung auf GPU-Compute-Shader aus und reduziert die CPU-Renderzeit um bis zu 50 %. Laut Kerndokumentation der Engine schließt das Anwenden eines `MaterialPropertyBlock` auf ein Objekt dieses jedoch sofort vom SRP Batcher aus und zerstört vollständig seine Kompatibilität mit dem GPU Resident Drawer. Durch den Einsatz von MPB zwingen Sie Unity für Ihre massiven Armeen zurück auf einen langsamen, CPU-gebundenen Legacy-Renderpfad.

**3. Der Unity-6-Standard: Renderer Shader User Value (RSUV)**

Um diese architektonische Sackgasse zu lösen, führt Unity 6.3 LTS **Renderer Shader User Value (RSUV)** ein. Diese API ermöglicht es Ihnen, einen 24-Bit-Integer direkt in die Basis-Nutzdaten des Renderers zu übergeben. Da er Änderungen an persistenten Constant Buffers vermeidet, bewahrt RSUV 100 % Kompatibilität sowohl mit dem SRP Batcher als auch mit dem GPU Resident Drawer.

**Schritt 1: Die C#-Kodierung (Zero Memory Allocation)**

Anstatt Strings zu übergeben und Blöcke anzulegen, packen wir eine RGB-Farbe mathematisch mittels Bitwise-Operationen in einen vorzeichenlosen 24-Bit-Integer:

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Kodiert die Kanäle Blau, Grün und Rot in einen einzigen 24-Bit-Integer  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Wert nativ anwenden (100 % sicher für SRP und GRD!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Schritt 2: Die Shader-Dekodierung**

Erstellen Sie in Ihrem Shader Graph einen **Custom Function**-Node (Type: String, Name: DecodeColor) mit einem Vector4-Ausgang. Fügen Sie diesen HLSL-Code ein, um den Integer wieder in eine normalisierte Float-Farbe zu entpacken:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Verbinden Sie diesen Ausgang mit dem Base-Color-Eingang Ihres Fragments. Sie haben nun unbegrenzte Farbvariationen ohne Draw-Call-Einbußen und nutzen gleichzeitig den GPU Resident Drawer voll aus.

**Beispiel: Reale Umsetzung in einem Custom Shader (ohne Shader Graph)**

Wenn Sie einen Custom Shader im Code (HLSL) schreiben, können Sie die Funktion `BuildSurfaceData` anpassen, um `unity_RendererUserValue` zu dekodieren und mit `BaseColor` zu multiplizieren, wie unten gezeigt:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // RSUV dekodieren
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // rsuvColor anwenden
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ...
}
```

*Siehe auch:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Über 100.000 Objekte hinaus: DOTS / ECS**

Wenn Ihr Spiel das Rendern von Hunderttausenden dynamischer Einheiten erfordert, werden Standard-GameObjects unabhängig von grafischen Optimierungen irgendwann den Hauptthread der CPU ausbremsen. Für massive Skalierung wechseln Sie zu Unity DOTS. Der Einsatz der Komponente `URPMaterialPropertyOverride` ermöglicht strikt datenorientierte Speicherlayouts. Diese kommunizieren direkt mit der Low-Level-API `BatchRendererGroup` und erreichen unvergleichliche, reine AAA-Rendering-Leistung.

---

## **Teil X: Strategische Empfehlungen für Entwicklungsteams**

Die Analyse moderner Render-Modelle zeigt einen wesentlichen Unterschied zwischen altem Optimierungswissen (Legacy) und zeitgenössischer Engine-Architektur. Die zentrale Erkenntnis für Grafik-Ingenieure lautet: Das Verändern von Datenpuffern (Data Buffers) pro Objekt ist von Natur aus feindlich gegenüber paralleler Verarbeitung und GPU-gesteuerten Render-Schleifen. Die Optimierungsdenkweise von Unity 5.x oder Unity 2019 lässt sich nicht auf Unity 6 übertragen.

Um in Unity 6 maximale Leistung zu erzielen, müssen Entwicklungsteams die folgenden Protokolle konsequent durchsetzen:

1. **Audit der MPB-Nutzung (Audit for MPB Usage):** Profiling-Tools (z. B. Unity Profiler) und Frame Debugger sollten kontinuierlich eingesetzt werden, um Fälle aufzuspüren und restlos zu beseitigen, in denen `MaterialPropertyBlock` auf masseninstanziierte Geometrie (mass-instanced geometry) angewendet wird. Der kurzfristige Komfort von MPB wird durch den systematischen Verlust der GPU-Resident-Drawer-Funktion vollständig zunichtegemacht. Teams müssen Warnungen im Quellcode oder CI/CD-Skripte einrichten, um unnötige MPB-Initialisierungen zu erkennen.
2. **Bitwise-Kodierungsstrategien einführen (Bitwise Encoding Strategies):** Die Einführung von Renderer Shader User Value (RSUV) erfordert einen Wandel in der Programmiermethodik. Technical Artists und Gameplay-Programmierer müssen zusammenarbeiten, um strenge Bitwise-Packing-Schemata für das 24-Bit-Budget von RSUV zu definieren. Dabei muss sichergestellt werden, dass vielfältige Datenzustände (Farbe, Schaden, Team-ID) vor Erreichen des Renderers effizient serialisiert werden. Beispielsweise lassen sich 4 Bit für „Fraktions-ID“ (16 Fraktionen), 8 Bit für „Schadenszustand“ (256 Stufen) und 12 Bit für „Custom Tint“ (benutzerdefinierte Farbe) zuweisen — alles gleichzeitig über Bitmasks im Shader dekodiert.
3. **Schwellenwerte für den ECS-Wechsel bewerten (Evaluate Thresholds for ECS Transition):** Obwohl RSUV den Engpass bei Material-Variationen für GameObjects löst, bleiben die CPU-Grenzen bei Physikberechnungen, Transformationsberechnungen (Transform Calculations) und dem Culling von GameObjects bestehen. Projekte, die mehr als 10.000 aktive dynamische Akteure (dynamic agents) erwarten, sollten proaktiv und entschlossen Prototypen mit DOTS (Entity Component System) entwerfen. Die Nutzung der Komponente `URPMaterialPropertyOverride`[^34] zur direkten Kommunikation mit der `BatchRendererGroup`-API ist der einzige Weg, das volle Leistungspotenzial moderner PC-Hardware und Konsolen der nächsten Generation freizusetzen.

## **Referenzen**

[^1]: Enable the GPU Resident Drawer in URP - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html](https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html)  
[^2]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^3]: Set and use the RSUV - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html)  
[^4]: Migrated my game to ECS/DOTS and material overrides are awesome! : r/Unity3D - Reddit, abgerufen am 19. April 2026, [https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated\_my\_game\_to\_ecsdots\_and\_material/](https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated_my_game_to_ecsdots_and_material/)  
[^5]: Why You Should Stop Swapping Materials in Unity (And What to Do Instead) - Medium, abgerufen am 19. April 2026, [https://medium.com/@MTCrypto\_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e](https://medium.com/@MTCrypto_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e)  
[^6]: Material Property Blocks - using them to store the original color of a material upon instantiation : r/Unity3D - Reddit, abgerufen am 19. April 2026, [https://www.reddit.com/r/Unity3D/comments/10jyr9b/material\_property\_blocks\_using\_them\_to\_store\_the/](https://www.reddit.com/r/Unity3D/comments/10jyr9b/material_property_blocks_using_them_to_store_the/)  
[^7]: Instancing and Material Property Blocks | Ronja's tutorials, abgerufen am 19. April 2026, [https://www.ronja-tutorials.com/post/048-material-property-blocks/](https://www.ronja-tutorials.com/post/048-material-property-blocks/)  
[^8]: Scripting API: MaterialPropertyBlock - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html](https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html)  
[^9]: Unity 6 and custom material bug - Spine Forum, abgerufen am 19. April 2026, [https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug](https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug)  
[^10]: Scriptable Render Pipeline (SRP) Batcher - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html)  
[^11]: Scriptable Render Pipeline Batcher - Unity 6.3 User Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html)  
[^12]: GPU instancing - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html](https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html)  
[^13]: Remove SRP Batcher compatibility for GameObjects | High Definition Render Pipeline | 17.0.4 - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html)  
[^14]: Beginning Game Development: GPU Resident Drawer | by Lem Apperson - Medium, abgerufen am 19. April 2026, [https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3](https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3)  
[^15]: Introduction to RSUV - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html)  
[^16]: Renderer Shader User Value sample - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html](https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html)  
[^17]: Speed Up Your Game Rendering in Unity3D: The Secret to Changing Material Colors, abgerufen am 19. April 2026, [https://www.youtube.com/watch?v=CjfMAhU7cY8](https://www.youtube.com/watch?v=CjfMAhU7cY8)  
[^18]: Scriptable Render Pipeline Batcher - Unity User Manual 2021.3 (LTS), abgerufen am 19. April 2026, [https://docs.unity.cn/Manual/SRPBatcher.html](https://docs.unity.cn/Manual/SRPBatcher.html)  
[^19]: Unity Draw Call Batching: The Ultimate Guide (2026 Update), abgerufen am 19. April 2026, [https://thegamedev.guru/unity-performance/draw-call-optimization/](https://thegamedev.guru/unity-performance/draw-call-optimization/)  
[^20]: Scriptable Render Pipeline Batcher - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html)  
[^21]: SRP Batcher: Speed up your rendering - Unity, abgerufen am 19. April 2026, [https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering](https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering)  
[^22]: Remove SRP Batcher compatibility for GameObjects in URP - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html)  
[^23]: GPU Instancing not working? Why amount of batches doesn't change? : r/Unity3D - Reddit, abgerufen am 19. April 2026, [https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu\_instancing\_not\_working\_why\_amount\_of\_batches/](https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu_instancing_not_working_why_amount_of_batches/)  
[^24]: Scripting API: Renderer.GetPropertyBlock - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html)  
[^25]: Create batches with the BatchRendererGroup API in URP - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html)  
[^26]: Use the GPU Resident Drawer | High Definition Render Pipeline | 17.0.4 - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html)  
[^27]: Create draw commands with the BatchRendererGroup API | High Definition Render Pipeline, abgerufen am 19. April 2026, [https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html](https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html)  
[^28]: Unity Tip Tuesday: GPU Resident Drawer & GPU occlusion culling - YouTube, abgerufen am 19. April 2026, [https://www.youtube.com/shorts/0PenzdQFlv0](https://www.youtube.com/shorts/0PenzdQFlv0)  
[^29]: Graphics Features and Tools in Unity 6 Feel Like MAGIC! STP, Resident Drawer, and Occlusion Culling! - YouTube, abgerufen am 19. April 2026, [https://www.youtube.com/watch?v=trdeAq3WPkQ](https://www.youtube.com/watch?v=trdeAq3WPkQ)  
[^30]: Initialize a BatchRendererGroup object in URP - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html)  
[^31]: Boost performance of your game in Unity 6 with GPU Resident Drawer - The Knights of U, abgerufen am 19. April 2026, [https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/](https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/)  
[^32]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^33]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html)  
[^34]: DOTS Instancing shaders in URP - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/Manual/dots-instancing-shaders.html](https://docs.unity3d.com/Manual/dots-instancing-shaders.html)  
[^35]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html)  
[^36]: One Material multiple colors possible? : r/Unity3D - Reddit, abgerufen am 19. April 2026, [https://www.reddit.com/r/Unity3D/comments/9oi8kz/one\_material\_multiple\_colors\_possible/](https://www.reddit.com/r/Unity3D/comments/9oi8kz/one_material_multiple_colors_possible/)  
[^37]: Single-pass instanced rendering and custom shaders - Unity - Manual, abgerufen am 19. April 2026, [https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html](https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html)  
[^38]: Use Graphics.DrawMeshInstanced or similar but vary the color on a per object basis?, abgerufen am 19. April 2026, [https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use\_graphicsdrawmeshinstanced\_or\_similar\_but\_vary/](https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use_graphicsdrawmeshinstanced_or_similar_but_vary/)
