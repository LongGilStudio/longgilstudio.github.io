---
title: "Architettura di rendering in Unity 6: abbandonare MPB per ottimizzare a fondo i Material"
date: 2026-04-19 12:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, rendering, optimization, shaders, dots, longgilstudio]
description: "Analisi completa del cambio architetturale da MaterialPropertyBlock a RSUV e GPU Resident Drawer per ottenere prestazioni AAA in Unity 6."
lang: it
translation_id: unity6-material-rsuv-grd
math: true
---

## **Sintesi esecutiva (Executive Summary)**

La transizione a Unity 6 segna un cambiamento architetturale fondamentale nel modo in cui le render pipeline elaborano la geometria istanziata (instanced geometry) su larga scala. Nella storia dello sviluppo di videogiochi, l'ottimizzazione di numerosi oggetti che condividono un unico material ma richiedono variazioni di proprietà distinte (come variazioni di colore — color tints) si è affidata tipicamente all'interfaccia di programmazione delle applicazioni (API) `MaterialPropertyBlock` (MPB) combinata con il sistema standard di GPU Instancing. Tuttavia, un'analisi approfondita di Universal Render Pipeline (URP) e High Definition Render Pipeline (HDRP) in Unity 6 rivela che questo approccio legacy non è più la strada ottimale e, in molti casi, provoca un grave degrado delle prestazioni.

L'esame della bozza tecnica fornita dall'utente per «Long Gil Studio DevLog» evidenzia una commistione tra teoria di ottimizzazione legacy — valida nelle versioni precedenti — e un serio fraintendimento delle moderne funzionalità di rendering di Unity 6. In particolare, la raccomandazione di usare `MaterialPropertyBlock` entra in conflitto diretto con la nuova tecnologia **GPU Resident Drawer (GRD)** di Unity 6 e con la sottostante API **BatchRendererGroup (BRG)**.[^1] Per ottenere il massimo throughput di rendering, gli sviluppatori devono adottare obbligatoriamente **Renderer Shader User Value (RSUV)** oppure migrare completamente al **Data-Oriented Technology Stack (DOTS)**.[^3]

Questo report di ricerca offre un'analisi tecnica approfondita dei colli di bottiglia del rendering, dei meccanismi di funzionamento dello Scriptable Render Pipeline (SRP) Batcher, delle conseguenze sistemiche della duplicazione dei material e dei paradigmi moderni necessari per raggiungere prestazioni di rendering di livello AAA in Unity 6. Inoltre, fornisce un articolo tecnico corretto e redatto in modo professionale, pronto per la pubblicazione su Long Gil Studio DevLog.

## **Parte I: Valutazione tecnica della bozza originale di Long Gil Studio**

Il testo della bozza iniziale presenta un problema di rendering molto specifico: ottimizzare una Scena contenente innumerevoli oggetti identici che condividono un singolo material ma richiedono modifiche di colore distinte per ciascun oggetto. La bozza identifica correttamente gli anti-pattern, ma prescrive una soluzione che degrada le prestazioni nel contesto architetturale di Unity 6.

### **Punti accurati della bozza originale**

1. **Penalità della duplicazione dei Material (Material Duplication):** La bozza afferma correttamente che la creazione di istanze di material separate per ogni oggetto (ad esempio tramite `GetComponent<Renderer>().material.color`) porta a un rigonfiamento della memoria (memory bloat) e distrugge completamente l'accorpamento delle chiamate di disegno (draw call batching).[^5] L'accesso alla proprietà `.material` costringe il motore Unity a clonare silenziosamente il material, eliminando in modo permanente la capacità di SRP Batcher o GPU Instancing di raggruppare tali oggetti in un'unica chiamata `SetPass`.[^5]
2. **Meccanismo di `MaterialPropertyBlock` (MPB):** La bozza identifica correttamente che MPB agisce come un buffer di sovrascrittura dati (data override buffer), consentendo al renderer di passare proprietà per-instance alla GPU senza creare una nuova copia del material.[^7]
3. **Proprietà stringa (String) rispetto agli identificatori interi (Integer IDs):** La bozza evidenzia opportunamente la latenza dell'unità di elaborazione centrale (CPU) causata dall'uso di stringhe per cercare le proprietà dello shader, sostenendo l'inizializzazione di identificatori interi tramite `Shader.PropertyToID()` per ottimizzare i cicli.[^7]

### **Inesattezze critiche e paradigmi obsoleti**

1. **MPB come «standard AAA» in Unity 6:** La lacuna più rilevante nella bozza originale è l'affermazione che MPB rappresenti la soluzione «AAA» ottimale per Unity 6. Sebbene MPB fosse lo standard nella Built-In Render Pipeline (architettura legacy), agisce come un fattore distruttivo nelle moderne architetture SRP.[^8] L'applicazione di un MPB a un GameObject esclude immediatamente tale oggetto dal flusso dell'SRP Batcher.[^10]
2. **Dipendenza dal GPU Instancing legacy:** La bozza riconosce che MPB interrompe l'SRP Batcher e suggerisce di ripiegare sul GPU Instancing tradizionale come soluzione di fallback. Sebbene ciò sia tecnicamente fattibile rompendo manualmente la compatibilità SRP e abilitando l'Instancing, costringe il motore a bypassare l'architettura SRP altamente ottimizzata.[^12]
3. **Omissione del GPU Resident Drawer (GRD):** Unity 6 introduce il GPU Resident Drawer, un sistema che sposta la generazione dei comandi di draw call sui compute shader, riducendo il costo di elaborazione CPU fino al 50%.[^14] La presenza di un `MaterialPropertyBlock` vieta rigorosamente a un GameObject di partecipare al GRD.[^1] Raccomandare MPB in Unity 6 impedisce di fatto ai progetti di sfruttare la nuova funzionalità di ottimizzazione più potente del motore.
4. **Mancanza del Renderer Shader User Value (RSUV):** Introdotto in Unity 6.3 LTS, RSUV è il sostituto architetturale diretto di MPB per gestire semplici variazioni per singolo oggetto.[^15] RSUV consente di passare un intero a 24 bit nello shader per ciascun renderer senza interrompere né l'SRP Batcher né il GPU Resident Drawer.[^3]

## **Parte II: Analisi delle cause alla radice dei colli di bottiglia (Bottlenecks) nel rendering**

Per comprendere perché determinate chiamate API distruggono il frame rate, occorre esaminare il modello di comunicazione tra l'unità di elaborazione centrale (CPU) e l'unità di elaborazione grafica (GPU). L'architettura hardware moderna richiede una sincronizzazione stretta, ma sensibile alla latenza, tra questi due processori.

### **Sovraccarico di comunicazione CPU-GPU (Overhead)**

Il processo di rendering di un fotogramma richiede che la CPU scorra tutti gli oggetti visibili nel campo visivo della Camera (frustum culling), determini le relative proprietà del material, associ (bind) le texture e gli shader necessari nella memoria della GPU ed emetta un comando di disegno (draw command). L'operazione più costosa in questa pipeline non è la rasterizzazione dei poligoni da parte della GPU, bensì i cambi di stato obbligatori prima della chiamata di disegno — comunemente noti come chiamate **SetPass**.[^5]

Ogni volta che la CPU incontra un nuovo material, deve mettere in stallo la pipeline di rendering per caricare i nuovi parametri sulla GPU.[^18] Se una Scena contiene 10.000 nemici e ogni nemico possiede un'istanza di material unica per gestire un diverso colore dell'armatura, la CPU deve eseguire 10.000 cambi di stato. Ciò genera un enorme sovraccarico CPU (CPU Overhead), creando un collo di bottiglia in cui la GPU rimane inattiva in attesa di istruzioni dalla CPU.

### **Frammentazione della memoria causata dalla proprietà `.material`**

Quando uno script accede a `Renderer.material` per modificare il colore, il motore è costretto a proteggere l'integrità dell'asset condiviso originale. Esegue quindi un `Instantiate()` interno su quel material. Questo comporta due gravi penalità prestazionali:

1. **Distruzione del Batching:** L'oggetto non condivide più il riferimento del material con gli altri oggetti simili. Immediatamente, Unity disattiva qualsiasi forma di Static Batching, Dynamic Batching o SRP Batching per quell'oggetto.[^5] La scheda grafica dovrà elaborarlo come un'entità completamente indipendente.
2. **Garbage Collection e perdite di memoria (Memory Leaks):** La nuova copia del material viene allocata sull'Heap gestito da C#. Non viene raccolta automaticamente dal garbage collector quando l'oggetto viene distrutto. A meno che lo sviluppatore non chiami esplicitamente `Destroy(renderer.material)`, la memoria rimane allocata. Ciò genera un memory leak che costringe il Garbage Collector (GC) ad attivare il processo di Mark-and-Sweep, causando gravi picchi di latenza (spikes) e cali improvvisi di FPS.[^5]

## **Parte III: Architettura dell'SRP Batcher e obsolescenza del GPU Instancing tradizionale**

La Scriptable Render Pipeline (SRP) ha riorganizzato dalle fondamenta il modo in cui Unity gestisce i dati degli shader. Comprendere l'SRP Batcher è cruciale per valutare perché i vecchi metodi di ottimizzazione falliscano completamente in Unity 6.

### **Meccanismo di funzionamento dell'SRP Batcher**

Nelle pipeline precedenti (Built-in), i material caricavano i dati sulla GPU tramite variabili uniformi separate. L'SRP Batcher sostituisce questo approccio utilizzando ampi buffer GPU persistenti denominati **Constant Buffers (CBUFFERs)**.[^11]

L'architettura SRP impone agli shader di separare le proprie variabili in due blocchi di buffer distinti[^11]:

* `UnityPerMaterial`: un CBUFFER contenente le proprietà condivise da tutti gli oggetti che utilizzano lo stesso material (ad esempio: colore di base, mappe metalliche — metallic maps, ruvidezza/levigatezza).
* `UnityPerDraw`: un CBUFFER contenente le proprietà univoche per la specifica chiamata di disegno (ad esempio: le matrici di trasformazione spaziale dell'oggetto).

Poiché il buffer `UnityPerMaterial` persiste nella memoria della GPU, la CPU non ha più bisogno di ricaricare le proprietà del material durante il ciclo di rendering se oggetti consecutivi condividono la stessa variante di shader (shader variant).[^18] L'SRP Batcher deve semplicemente associare (bind) questo buffer persistente e aggiornare il buffer `UnityPerDraw`, molto più piccolo. Questo design riduce drasticamente il costo CPU, aumentando talvolta la velocità di rendering da 1,2x a 4x.[^21]

### **Il conflitto fondamentale con `MaterialPropertyBlock`**

L'API `MaterialPropertyBlock` è stata progettata originariamente per sovrascrivere le proprietà del material a livello di renderer. Tuttavia, poiché l'SRP Batcher si basa sulla separazione rigorosa e sulla persistenza del CBUFFER `UnityPerMaterial`, l'iniezione di un MPB viola direttamente questo layout di memoria.[^8]

Quando viene applicato un MPB, Unity non può più garantire che il buffer persistente del material si applichi uniformemente all'oggetto. Di conseguenza, il motore è costretto a estromettere bruscamente l'oggetto dalla pipeline dell'SRP Batcher.[^9] La documentazione ufficiale di Unity conferma esplicitamente: *«Si noti che questa funzionalità non è compatibile con l'SRP Batcher. L'uso di MPB in URP o HDRP comporterà probabilmente un calo delle prestazioni.»*[^8]

### **La soluzione di ripiego legacy: `Graphics.DrawMeshInstanced`**

Storicamente, se uno sviluppatore aveva bisogno di enormi variazioni (ad esempio una foresta di alberi con colori diversi), accettava la perdita dell'SRP Batcher e ripiegava sul GPU Instancing.[^12] Ciò richiedeva di rompere manualmente la compatibilità SRP dello shader dichiarando una proprietà al di fuori del buffer `UnityPerMaterial` e abilitando «Enable GPU Instancing» sul material.[^13]

Sebbene il GPU Instancing riduca le draw call passando array di matrici di trasformazione e dati di colore, presenta gravi limitazioni.[^12] Soffre in presenza di overdraw pesante, richiede che le mesh siano identiche e impone un pesante carico sulla CPU per raccogliere e caricare gli array di istanze (instance arrays) a ogni fotogramma. In Unity 6, questo metodo è stato completamente sostituito dall'architettura GPU Resident Drawer.[^23]

## **Parte IV: Incompatibilità di `MaterialPropertyBlock` (MPB) con l'ecosistema Unity 6**

Un'analisi più approfondita di MPB dimostra che esso non si limita a interrompere l'SRP Batcher, ma introduce anche rischi strutturali per gli strumenti di debug (debugging tools) e i sistemi di illuminazione (lighting systems) in Unity 6.

### **Impatto sui dati di Lightmap e sulla Global Illumination**

Una delle conseguenze meno citate dell'uso improprio di MPB è la cancellazione dei dati di Lightmap. Quando si crea un `new MaterialPropertyBlock()` e lo si assegna tramite `Renderer.SetPropertyBlock()`, il blocco di proprietà passato sovrascrive completamente lo stato locale del renderer.[^24]

Se l'oggetto utilizza il sistema di Global Illumination (GI) precalcolata (baked), le informazioni sulle coordinate UV della Lightmap e i coefficienti dei Light Probe sono memorizzati implicitamente proprio all'interno del property block del renderer.[^24] Se non si chiama `Renderer.GetPropertyBlock(block)` prima di impostare il colore, si cancellano involontariamente le informazioni di illuminazione dell'oggetto. Sebbene la bozza originale di Long Gil Studio abbia gestito correttamente questa parte con `GetPropertyBlock`, il solo fatto di chiamare ripetutamente questa API su migliaia di oggetti introduce una latenza CPU aggiuntiva non trascurabile.

| Tecnica di ottimizzazione      | Causa leak di RAM | Compatibile SRP Batcher | Compatibile GRD | Compatibile DOTS | Utilizzo consigliato        |
| :----------------------------- | :---------------- | :---------------------- | :-------------- | :--------------- | :-------------------------- |
| **`Material.color`**           | Sì                | No                      | No              | No               | Evitare assolutamente       |
| **`MaterialPropertyBlock`**    | No                | No                      | No              | No               | Per vecchi progetti Built-in |
| **GPU Instancing**             | No                | No (Conflitto)          | No              | No               | Unity 2020-2022             |
| **Renderer Shader User Value** | No                | Sì                      | Sì              | Sì               | Standard Unity 6.3+         |

Come indica la tabella sopra, MPB è ormai una tecnica di vecchia generazione. Risolve il problema della RAM ma compromette l'intera pipeline di rendering moderna di Unity 6.

## **Parte V: Il punto di svolta architetturale: GPU Resident Drawer (GRD) e `BatchRendererGroup` (BRG)**

Unity 6 introduce un percorso di rendering rivoluzionario: il **GPU Resident Drawer**. Questo sistema sposta il paradigma dalla generazione delle draw call guidata dalla CPU a un ciclo di rendering altamente autonomo guidato dalla GPU.[^1]

### **Architettura del GPU Resident Drawer**

Il GPU Resident Drawer si basa sull'API di basso livello `BatchRendererGroup` (BRG).[^1] Anziché far valutare alla CPU quali oggetti siano visibili (frustum culling) ed emettere chiamate di disegno singole o istanziate, la CPU carica l'intero set di dati spaziali e materiali della scena sulla GPU.[^25] I compute shader eseguono poi l'eliminazione degli oggetti fuori inquadratura, l'eliminazione degli oggetti occlusi (occlusion culling) e la generazione dei comandi di disegno interamente sulla GPU.[^14]

I guadagni prestazionali sono straordinari. Utilizzando il rendering indiretto (`DrawInstancedIndirect`), il carico di lavoro CPU richiesto per il rendering può diminuire fino al 50% nelle scene complesse.[^14] Inoltre, in combinazione con il GPU Occlusion Culling, l'elaborazione dei triangoli può ridursi di quasi il 90%, mentre il tempo di elaborazione per fotogramma (frame buffer time) della GPU si riduce di oltre la metà.[^28]

### **L'API `BatchRendererGroup` (BRG) e il Culling**

Dietro al GRD opera `BatchRendererGroup`. BRG richiede l'inizializzazione con una funzione di callback `OnPerformCulling`.[^30] Qui la CPU si limita a configurare la visibilità e produrre chiamate di disegno in forma di array. I dati dell'oggetto (trasformazioni, colori, flag) vengono caricati in un `GraphicsBuffer`.[^25] Ciò consente di inviare milioni di triangoli alla GPU con pochissime chiamate `SetPass`.

### **L'incompatibilità fatale di MPB con GRD**

L'informazione più importante riguardo all'ottimizzazione in Unity 6 è la fragilità dei requisiti di idoneità per il GPU Resident Drawer. Affinché un oggetto venga elaborato dal GRD, deve rispettare rigorose regole di layout dei dati.[^2]

La documentazione ufficiale di Unity 6.1+ dichiara chiaramente che i GameObject che utilizzano l'API `MaterialPropertyBlock` vengono immediatamente esclusi dal GPU Resident Drawer.[^1] Inoltre, l'oggetto non deve avere script che utilizzano callback per-instance come `OnRenderObject`.[^2]

Quando uno sviluppatore applica un MPB per cambiare il colore di un oggetto, costringe involontariamente il motore a tornare alla modalità di rendering legacy basata su CPU per quello specifico oggetto. Se ciò viene fatto su 10.000 unità militari in un gioco strategico in tempo reale, il sovraccarico della CPU schizza alle stelle in modo vertiginoso, annullando completamente i vantaggi dell'aggiornamento al motore Unity 6.

## **Parte VI: Lo standard moderno: Renderer Shader User Value (RSUV) in Unity 6.3**

Riconoscendo lo stallo architetturale creato dall'incompatibilità di MPB con le pipeline moderne, Unity ha introdotto la funzionalità **Renderer Shader User Value (RSUV)** nella versione Unity 6.3 LTS.[^15] RSUV funge da sostituto definitivo per `MaterialPropertyBlock` quando gli sviluppatori devono applicare semplici personalizzazioni per-instance su molti renderer che condividono un unico material.[^3]

### **Meccanismo di funzionamento di RSUV**

RSUV aggira le complesse modifiche di buffer che rappresentavano il punto debole di MPB. Sfrutta invece un canale intero a 24 bit estremamente efficiente, passato direttamente insieme ai dati di disegno standard del renderer.[^3] Poiché questo intero è integrato nella struttura dati esistente invece di richiedere una sovrascrittura di un buffer separato (buffer override), mantiene una compatibilità assoluta sia con l'SRP Batcher che con il GPU Resident Drawer.[^3]

### **Implementazione e codifica Bitwise (Bitwise Encoding)**

Per utilizzare RSUV per la variazione di colore, la CPU deve codificare i valori RGB desiderati in un singolo intero senza segno a 24 bit (`uint`). Ogni canale di colore (Rosso — Red, Verde — Green, Blu — Blue) occupa 8 bit (fornendo valori da 0 a 255).[^3]

L'operazione di codifica utilizza gli operatori bitwise di scorrimento a sinistra (`<<`) e OR bitwise (`|`). La formula matematica si esprime così:

$$
Color_{uint} = (Blue_{byte} \ll 16) | (Green_{byte} \ll 8) | (Red_{byte})
$$

Nell'implementazione pratica in C#, l'iterazione su un array di componenti `MeshRenderer` per applicare un colore tint casuale garantisce prestazioni molto elevate senza alcuna allocazione di memoria spazzatura (zero garbage allocation)[^3]:

```csharp
MeshRenderer allMeshRenderers = FindObjectsByType<MeshRenderer>(FindObjectsSortMode.InstanceID);  
foreach (MeshRenderer meshRenderer in allMeshRenderers)  
{  
    // Calcola un colore casuale (usando lo spazio colore HSV per tinte più vivaci)  
    Color32 targetColor = Color.HSVToRGB(UnityEngine.Random.Range(0f, 1f), 1f, 1f);  

    // Codifica RGB in un intero a 24 bit (Blu, Verde, Rosso)  
    uint encodedColor = ((uint)targetColor.b << 16) |   
                        ((uint)targetColor.g << 8) |   
                        ((uint)targetColor.r << 0);  

    // Applica il valore direttamente al renderer tramite la nuova API di Unity 6.3
    meshRenderer.SetShaderUserValue(encodedColor);  
}
```

### **Decodifica nello Shader (Shader Decoding)**

Lato GPU, lo shader deve decomprimere (unpack) questo intero a 24 bit riportandolo a un valore colore `float4` normalizzato. Unity fornisce la variabile integrata `unity_RendererUserValue` per accedere a questo blocco dati.[^3]

Il processo di decodifica usa l'operatore bitwise di scorrimento a destra (`>>`) e l'operatore AND bitwise (`&`) con una bitmask pari a `255` per isolare ciascun segmento da 8 bit. Successivamente, viene moltiplicato per il reciproco di 255 (`1.0 / 255.0`) per normalizzare il valore nell'intervallo tra `0.0` e `1.0`.[^3]

$$
Channel_{normalized} = ((unity\_RendererUserValue \gg Shift) \ \& \ 255) \times 0.0039215
$$

In High-Level Shader Language (HLSL) o tramite un nodo Custom Function in Shader Graph, la logica di decompressione è espressa come segue[^3]:

```hlsl
uint c = unity_RendererUserValue;  
float4 instanceColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  // Canale Rosso (Red)  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  // Canale Verde (Green)  
    (float)((c >> 16) & 255) * (1.0 / 255.0), // Canale Blu (Blue)  
    1.0 // Alpha fisso  
);
```

Questo cambio di paradigma dimostra una profonda strategia di ottimizzazione: scambiare la complessità delle strutture dati (come MPB) con il calcolo matematico (RSUV). I processori GPU sono straordinariamente efficienti nelle operazioni bitwise, il che rende il costo di decodifica praticamente invisibile (con un costo in cicli di clock minimo). Nel frattempo, preservare i flussi di SRP Batcher e GPU Resident Drawer produce una drastica riduzione del tempo per fotogramma (frame-time).[^16]

## **Parte VII: Soluzione su scala estrema: DOTS, ECS e `URPMaterialPropertyOverride`**

Per i progetti che operano su una scala superiore alla capacità di gestione dei GameObject standard (ad esempio simulazioni di folle con centinaia di migliaia di unità indipendenti — boids, enormi eserciti RTS), il Data-Oriented Technology Stack (DOTS) di Unity fornisce l'architettura di rendering definitiva.[^4]

### **Gestione della memoria orientata ai dati (Data-Oriented Memory)**

A differenza dei limiti dei sistemi orientati agli oggetti in cui i GameObject sono sparsi nell'Heap, le entità (entities) nell'Entity Component System (ECS) esistono esclusivamente sotto forma di array contigui di dati in memoria.[^4] Questo layout di memoria si allinea perfettamente alla struttura richiesta dall'API `BatchRendererGroup` (BRG) per ottenere le massime prestazioni.

All'interno del pacchetto Entities Graphics, gli sviluppatori possono utilizzare il componente `URPMaterialPropertyOverride`.[^4] Questo sistema consente di sovrascrivere le proprietà del material per ogni entità (per-entity material overrides) senza utilizzare minimamente la dannosa API `MaterialPropertyBlock`.

### **Meccanismo di funzionamento del DOTS Instancing**

Quando un'entità viene elaborata in DOTS, lo shader configurato per DOTS Instancing (selezionando *Override Property Declaration* e scegliendo *Hybrid Per Instance* in Shader Graph) riceve un intero univoco a 32 bit (un valore di metadati — metadata value).[^34] Questo intero rappresenta un offset all'interno di un `GraphicsBuffer` persistente sulla GPU.[^34]

Lo shader usa questo offset per caricare i dati di proprietà specifici per l'istanza che sta attualmente renderizzando.[^34] Ciò che distingue il DOTS Instancing è questo: se più entità condividono lo stesso valore di proprietà, il DOTS Instancing consente loro di caricare quel valore dalla stessa posizione in memoria (lo stesso offset), risparmiando cicli GPU e riducendo la duplicazione di memoria.[^34] Poiché le proprietà vengono caricate tramite offset anziché essere confinate nei tradizionali constant buffer, la dimensione di una draw call non è più rigorosamente limitata, permettendo un numero enorme di istanze.

```csharp
// Esempio di assegnazione dei valori RSUV tramite il sistema DOTS / Burst Compile

public partial struct MaterialMeshInfoSystem : ISystem   
{  
    public void OnUpdate(ref SystemState state)   
    {  
        var entityManager = state.EntityManager;  
        // Elaborazione parallela scrivendo i valori direttamente in un NativeArray  
        // Offre una velocità di esecuzione che MonoBehaviour non potrà mai raggiungere.  
    }  
}
```

La modifica dei valori dei component delle entità tramite Bursted Background Jobs (job in background compilati con il Burst Compiler) può essere eseguita a una velocità sorprendente.[^4] I giocatori possono avere recinzioni che cambiano colore in base all'inclinazione del terreno, oppure erba che cambia tinta in base all'altitudine, tutto disegnato in un unico flusso di draw call senza alcun collo di bottiglia.[^4]

## **Parte VIII: Analisi delle soluzioni alternative (Alternative Solutions)**

La bozza originale di Long Gil Studio accennava brevemente alle tecniche di ottimizzazione alternative. L'analisi seguente ne conferma la fattibilità collocandole però nel contesto dei limiti fisici del motore Unity 6.

1. **Vertex Colors (Colorazione dei vertici della Mesh):**
   * *Meccanismo:* Codificare i dati di colore direttamente nei vertici della mesh 3D. Lo shader legge l'attributo `TEXCOORD` o `COLOR` dalla mesh.
   * *Efficacia:* Estremamente leggero e preserva perfettamente tutte le funzionalità di batching nonché la compatibilità GRD.[^36]
   * *Punto debole:* Modificare i colori dei vertici a runtime richiede di intervenire sull'array di dati della mesh (`mesh.colors`). Questa azione crea una copia della mesh in RAM, causando stalli della CPU e allocazioni di memoria spazzatura. I vertex color rimangono ottimali solo per variazioni statiche già «cotte» (baked) in software come Blender o Maya.
2. **Texture Atlasing e UV Offsets:**
   * *Meccanismo:* Unire più variazioni di colore in un singolo atlante di texture (texture atlas) e spostare le coordinate UV dei diversi oggetti per campionare pixel specifici.[^36]
   * *Efficacia:* Questa tecnica mantiene un solo material e una sola texture, garantendo compatibilità assoluta con l'SRP Batcher.[^36]
   * *Punto debole:* Analogamente ai vertex color, modificare dinamicamente le coordinate UV su oggetti diversi a runtime richiede spesso la creazione di istanze di mesh univoche, reintroducendo il rigonfiamento della memoria (memory bloat). Tuttavia, per il design di ambienti statici o giochi Voxel (come Minecraft), è la tecnica imbattibile.
3. **`Graphics.DrawMeshInstanced` a basso livello:**
   * *Meccanismo:* Aggirare completamente la gerarchia dei GameObject per inviare direttamente le matrici di coordinate e gli array di colori alla GPU tramite codice C#.[^37]
   * *Efficacia:* Offre prestazioni immense per sistemi come algoritmi di stormi (flocking) o fogliame procedurale.[^38]
   * *Punto debole in Unity 6:* L'introduzione dell'API `BatchRendererGroup` e del GPU Resident Drawer ha «democratizzato» queste prestazioni, eliminando la necessità di scrivere codice complesso di culling e invio draw nella maggior parte degli scenari di sviluppo comuni.[^19] Mantenere un sistema `DrawMeshInstanced` personalizzato richiede oggi più risorse ingegneristiche rispetto al lasciare che il GPU Resident Drawer lo automatizzi.

## **Parte IX: Struttura dei contenuti consigliata per il Long Gil Studio DevLog**

Sulla base della valutazione tecnica completa, il testo seguente rappresenta l'articolo DevLog consigliato, interamente revisionato e caratterizzato da un'elevata qualità ingegneristica. Abbandona il metodo MPB difettoso e guida i lettori verso i veri standard architetturali di Unity 6: RSUV e GPU Resident Drawer.

---

**Unity 6: Ottimizzare migliaia di oggetti che condividono un Material — Abbandonare MPB per l'architettura moderna**

**Di Long Gil Studio**

**🇻🇳 EDIZIONE VIETNAMITA (Tradotta in italiano)**

**1. Il collo di bottiglia del rendering: il problema della duplicazione dei Material**

Durante lo sviluppo di giochi su larga scala emerge una sfida architetturale estremamente comune: «Come cambiare il colore di migliaia di oggetti che condividono un unico material senza far calare gli FPS?»

Molti programmatori usano il comando `GetComponent<Renderer>().material.color`. È un errore fatale (anti-pattern). Chiamare `.material` costringe Unity a creare silenziosamente un clone di quel material in RAM. La conseguenza è un grave memory leak, l'attivazione continua della Garbage Collection e la distruzione totale del sistema di Batching. La GPU resta a secco, mentre la CPU va in sovraccarico elaborando migliaia di Draw Call separate.

**2. La trappola legacy: perché `MaterialPropertyBlock` è «morto» in Unity 6**

In passato, la soluzione «da Pro» era usare `MaterialPropertyBlock` (MPB) per passare dati per ogni oggetto senza dover clonare il material. **Ma se stai usando Unity 6 (URP/HDRP), devi smettere subito di usare questo metodo.**

Unity 6 si affida pesantemente al flusso **SRP Batcher** e a una tecnologia rivoluzionaria: il **GPU Resident Drawer (GRD)**. GRD sposta l'intero flusso di elaborazione del rendering (generazione delle Draw Call, Culling) sui Compute Shader della GPU, riducendo fino al 50% il tempo di calcolo della CPU. Tuttavia, secondo la documentazione core del motore, quando colleghi un `MaterialPropertyBlock` a un oggetto, quell'oggetto viene immediatamente escluso dall'SRP Batcher e perde completamente la compatibilità con il GPU Resident Drawer. Usare MPB significa costringere Unity a tornare al vecchio flusso di rendering, lento ed esoso di CPU, per tutto il tuo esercito.

**3. Il nuovo standard di Unity 6: Renderer Shader User Value (RSUV)**

Per risolvere definitivamente questo stallo, l'aggiornamento Unity 6.3 LTS ha introdotto **Renderer Shader User Value (RSUV)**. Questa API permette di passare direttamente un intero a 24 bit al renderer. Poiché RSUV non richiede nuove allocazioni di buffer, mantiene al 100% la compatibilità sia con l'SRP Batcher che con il GPU Resident Drawer.

**Passo 1: Codifica C# (Zero Garbage Allocation)**

Invece di usare le stringhe (string) come in MPB, codifichiamo il colore RGB in un intero a 24 bit tramite operazioni bitwise di scorrimento dei bit:

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Codifica i 3 canali Blu, Verde e Rosso in un intero a 24 bit  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Applica il valore (Assolutamente sicuro per l'architettura SRP e GRD!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Passo 2: Decodifica in Shader Graph**

All'interno di Shader Graph, crea un nodo **Custom Function** (Type: String, Name: DecodeColor) con output Vector4. Incolla il seguente codice HLSL per decomprimere l'intero riportandolo al colore standard:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Collega questo output al pin Base Color del Fragment Shader. Ora hai infinite variazioni di colore con latenza CPU pari a zero e sfrutti al massimo la potenza del sistema GPU Resident Drawer.

**Esempio: Implementazione pratica in uno script Shader (senza Shader Graph)**

Se scrivi un custom shader via codice (HLSL), puoi intervenire nella funzione `BuildSurfaceData` per decodificare `unity_RendererUserValue` e moltiplicarlo per `BaseColor` come mostrato nello snippet seguente:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // Decodifica RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // Applica il colore rsuvColor
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ... 
}
```

*Approfondisci qui:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Oltre la soglia dei 100.000 oggetti: la soluzione DOTS / ECS**

Se il tuo gioco richiede il rendering di centinaia di migliaia di unità indipendenti (come eserciti colossali), il sistema tradizionale dei GameObject farà inevitabilmente da collo di bottiglia alla CPU, per quanto ottimizzi il rendering. Per questa scala, passa alla struttura Unity DOTS. L'uso del componente `URPMaterialPropertyOverride` consente un layout di memoria Data-Oriented che comunica direttamente a basso livello con l'API `BatchRendererGroup`, garantendo prestazioni AAA ineguagliabili.

---

**🇺🇸 EDIZIONE INGLESE (Tradotta in italiano)**

**1. Il collo di bottiglia del rendering: duplicazione dei Material**

Nello sviluppo di giochi ad alta densità si presenta una sfida architetturale comune: «Come cambio il colore di migliaia di oggetti che condividono lo stesso material senza distruggere le prestazioni?»

Gli sviluppatori scelgono spesso per abitudine `GetComponent<Renderer>().material.color`. È un anti-pattern fatale. Accedere a `.material` costringe Unity a clonare silenziosamente il material sull'heap gestito. Ciò provoca un grave rigonfiamento della memoria, innesca picchi di garbage collection e distrugge il draw call batching, portando il sovraccarico della CPU a livelli ingestibili mentre lascia a digiuno la GPU.

**2. La trappola legacy: perché `MaterialPropertyBlock` è morto in Unity 6**

Storicamente, la soluzione «Pro» era usare un `MaterialPropertyBlock` (MPB) per passare dati per-instance senza clonare i material. **Se usi Unity 6 (URP/HDRP), devi smettere immediatamente di utilizzare questo metodo.**

Unity 6 si basa fortemente sull'**SRP Batcher** e sul nuovo rivoluzionario **GPU Resident Drawer (GRD)**. Il GRD sposta il frustum culling e la generazione delle draw call sui compute shader della GPU, riducendo il tempo di rendering della CPU fino al 50%. Tuttavia, secondo la documentazione principale del motore, applicare un `MaterialPropertyBlock` a un oggetto lo squalifica immediatamente dall'SRP Batcher e ne interrompe completamente la compatibilità con il GPU Resident Drawer. Usando MPB costringi Unity a tornare a un percorso di rendering legacy, lento e limitato dalla CPU, per i tuoi enormi eserciti.

**3. Lo standard di Unity 6: Renderer Shader User Value (RSUV)**

Per risolvere questo stallo architetturale, Unity 6.3 LTS introduce **Renderer Shader User Value (RSUV)**. Questa API ti permette di passare un intero a 24 bit direttamente nel payload dati di base del renderer. Poiché evita di modificare i constant buffer persistenti, RSUV mantiene il 100% di compatibilità sia con l'SRP Batcher che con il GPU Resident Drawer.

**Passo 1: La codifica C# (Zero Memory Allocation)**

Invece di passare stringhe e creare blocchi, impacchettiamo matematicamente un colore RGB in un intero senza segno a 24 bit tramite operazioni bitwise:

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Codifica i canali Blu, Verde e Rosso in un singolo intero a 24 bit  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Applica il valore nativamente (100% sicuro per SRP e GRD!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Passo 2: La decodifica nello Shader**

Nel tuo Shader Graph, crea un nodo **Custom Function** (Type: String, Name: DecodeColor) con un output Vector4. Incolla questo codice HLSL per decomprimere l'intero in un colore float normalizzato:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Collega questo output all'ingresso Base Color del tuo fragment. Ora disponi di infinite variazioni di colore senza alcuna penalità sulle draw call, sfruttando appieno il GPU Resident Drawer.

**Esempio: Implementazione reale in un Custom Shader (senza Shader Graph)**

Se stai scrivendo un custom shader in codice (HLSL), puoi modificare la funzione `BuildSurfaceData` per decodificare `unity_RendererUserValue` e moltiplicarlo con `BaseColor` come mostrato nel codice qui sotto:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // Decodifica RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // Applica rsuvColor
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ...
}
```

*Vedi anche:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Oltre i 100.000 oggetti: DOTS / ECS**

Se il tuo gioco richiede il rendering di centinaia di migliaia di unità dinamiche, i GameObject standard finiranno comunque per saturare il thread principale della CPU indipendentemente dalle ottimizzazioni grafiche. Per una scala massiva, passa a Unity DOTS. L'uso del componente `URPMaterialPropertyOverride` consente layout di memoria rigorosamente Data-Oriented. Questo si interfaccia direttamente con l'API di basso livello `BatchRendererGroup`, raggiungendo prestazioni pure di livello AAA senza eguali.

---

## **Parte X: Raccomandazioni strategiche per i team di sviluppo**

L'analisi dei modelli di rendering moderni evidenzia una netta separazione tra le vecchie conoscenze di ottimizzazione (legacy) e l'architettura contemporanea del motore. Il punto chiave per gli ingegneri grafici è che modificare i data buffer per singolo oggetto è intrinsecamente ostile all'esecuzione parallela e ai cicli di rendering guidati dalla GPU. Non è possibile trasferire a Unity 6 la mentalità di ottimizzazione di Unity 5.x o Unity 2019.

Per ottenere le massime prestazioni in Unity 6, i team di sviluppo devono applicare rigorosamente i seguenti protocolli:

1. **Audit sull'utilizzo di MPB (Audit for MPB Usage):** Strumenti di profiling (come Unity Profiler) e Frame Debugger dovrebbero essere utilizzati continuamente per individuare ed eliminare alla radice i casi in cui `MaterialPropertyBlock` viene applicato a geometria istanziata in massa (mass-instanced geometry). La comodità a breve termine di MPB è ampiamente superata dalla perdita sistematica della funzionalità GPU Resident Drawer. I team devono introdurre avvisi nel codice sorgente o script CI/CD per rilevare l'istanziazione non necessaria di MPB.
2. **Adottare strategie di codifica Bitwise (Bitwise Encoding Strategies):** L'adozione di Renderer Shader User Value (RSUV) richiede un cambiamento nella metodologia di programmazione. Technical Artist e programmatori gameplay devono collaborare per definire schemi rigorosi di impacchettamento bitwise entro il limite di 24 bit di RSUV, assicurando che stati di dati eterogenei (colore, danno, ID squadra — team ID) vengano serializzati in modo efficiente prima di raggiungere il renderer. Ad esempio, è possibile allocare 4 bit per «ID fazione» (16 fazioni possibili), 8 bit per «Stato di danno» (256 livelli) e 12 bit per «Custom Tint» (colore personalizzato) — il tutto decodificato simultaneamente tramite bitmask all'interno dello shader.
3. **Valutare le soglie per la transizione a ECS (Evaluate Thresholds for ECS Transition):** Sebbene RSUV risolva il collo di bottiglia delle variazioni di material per i GameObject, i limiti della CPU relativi a calcoli fisici, calcoli delle trasformazioni (transform calculations) e culling dei GameObject permangono. I progetti che prevedono più di 10.000 entità attive dinamiche (dynamic agents) dovrebbero progettare proattivamente prototipi che implementino DOTS (Entity Component System). Sfruttare il componente `URPMaterialPropertyOverride`[^34] per dialogare nativamente con l'API `BatchRendererGroup` è l'unica strada per sbloccare appieno il potenziale hardware dei PC moderni e delle console di nuova generazione.

## **Riferimenti**

[^1]: Enable the GPU Resident Drawer in URP - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html](https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html)  
[^2]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^3]: Set and use the RSUV - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html)  
[^4]: Migrated my game to ECS/DOTS and material overrides are awesome! : r/Unity3D - Reddit, consultato il 19 aprile 2026, [https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated\_my\_game\_to\_ecsdots\_and\_material/](https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated_my_game_to_ecsdots_and_material/)  
[^5]: Why You Should Stop Swapping Materials in Unity (And What to Do Instead) - Medium, consultato il 19 aprile 2026, [https://medium.com/@MTCrypto\_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e](https://medium.com/@MTCrypto_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e)  
[^6]: Material Property Blocks - using them to store the original color of a material upon instantiation : r/Unity3D - Reddit, consultato il 19 aprile 2026, [https://www.reddit.com/r/Unity3D/comments/10jyr9b/material\_property\_blocks\_using\_them\_to\_store\_the/](https://www.reddit.com/r/Unity3D/comments/10jyr9b/material_property_blocks_using_them_to_store_the/)  
[^7]: Instancing and Material Property Blocks | Ronja's tutorials, consultato il 19 aprile 2026, [https://www.ronja-tutorials.com/post/048-material-property-blocks/](https://www.ronja-tutorials.com/post/048-material-property-blocks/)  
[^8]: Scripting API: MaterialPropertyBlock - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html](https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html)  
[^9]: Unity 6 and custom material bug - Spine Forum, consultato il 19 aprile 2026, [https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug](https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug)  
[^10]: Scriptable Render Pipeline (SRP) Batcher - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html)  
[^11]: Scriptable Render Pipeline Batcher - Unity 6.3 User Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html)  
[^12]: GPU instancing - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html](https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html)  
[^13]: Remove SRP Batcher compatibility for GameObjects | High Definition Render Pipeline | 17.0.4 - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html)  
[^14]: Beginning Game Development: GPU Resident Drawer | by Lem Apperson - Medium, consultato il 19 aprile 2026, [https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3](https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3)  
[^15]: Introduction to RSUV - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html)  
[^16]: Renderer Shader User Value sample - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html](https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html)  
[^17]: Speed Up Your Game Rendering in Unity3D: The Secret to Changing Material Colors, consultato il 19 aprile 2026, [https://www.youtube.com/watch?v=CjfMAhU7cY8](https://www.youtube.com/watch?v=CjfMAhU7cY8)  
[^18]: Scriptable Render Pipeline Batcher - Unity User Manual 2021.3 (LTS), consultato il 19 aprile 2026, [https://docs.unity.cn/Manual/SRPBatcher.html](https://docs.unity.cn/Manual/SRPBatcher.html)  
[^19]: Unity Draw Call Batching: The Ultimate Guide (2026 Update), consultato il 19 aprile 2026, [https://thegamedev.guru/unity-performance/draw-call-optimization/](https://thegamedev.guru/unity-performance/draw-call-optimization/)  
[^20]: Scriptable Render Pipeline Batcher - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html)  
[^21]: SRP Batcher: Speed up your rendering - Unity, consultato il 19 aprile 2026, [https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering](https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering)  
[^22]: Remove SRP Batcher compatibility for GameObjects in URP - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html)  
[^23]: GPU Instancing not working? Why amount of batches doesn't change? : r/Unity3D - Reddit, consultato il 19 aprile 2026, [https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu\_instancing\_not\_working\_why\_amount\_of\_batches/](https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu_instancing_not_working_why_amount_of_batches/)  
[^24]: Scripting API: Renderer.GetPropertyBlock - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html)  
[^25]: Create batches with the BatchRendererGroup API in URP - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html)  
[^26]: Use the GPU Resident Drawer | High Definition Render Pipeline | 17.0.4 - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html)  
[^27]: Create draw commands with the BatchRendererGroup API | High Definition Render Pipeline, consultato il 19 aprile 2026, [https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html](https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html)  
[^28]: Unity Tip Tuesday: GPU Resident Drawer & GPU occlusion culling - YouTube, consultato il 19 aprile 2026, [https://www.youtube.com/shorts/0PenzdQFlv0](https://www.youtube.com/shorts/0PenzdQFlv0)  
[^29]: Graphics Features and Tools in Unity 6 Feel Like MAGIC! STP, Resident Drawer, and Occlusion Culling! - YouTube, consultato il 19 aprile 2026, [https://www.youtube.com/watch?v=trdeAq3WPkQ](https://www.youtube.com/watch?v=trdeAq3WPkQ)  
[^30]: Initialize a BatchRendererGroup object in URP - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html)  
[^31]: Boost performance of your game in Unity 6 with GPU Resident Drawer - The Knights of U, consultato il 19 aprile 2026, [https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/](https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/)  
[^32]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^33]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html)  
[^34]: DOTS Instancing shaders in URP - Unity - Manual, consultato il 19 avril 2026, [https://docs.unity3d.com/Manual/dots-instancing-shaders.html](https://docs.unity3d.com/Manual/dots-instancing-shaders.html)  
[^35]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html)  
[^36]: One Material multiple colors possible? : r/Unity3D - Reddit, consultato il 19 aprile 2026, [https://www.reddit.com/r/Unity3D/comments/9oi8kz/one\_material\_multiple\_colors\_possible/](https://www.reddit.com/r/Unity3D/comments/9oi8kz/one_material_multiple_colors_possible/)  
[^37]: Single-pass instanced rendering and custom shaders - Unity - Manual, consultato il 19 aprile 2026, [https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html](https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html)  
[^38]: Use Graphics.DrawMeshInstanced or similar but vary the color on a per object basis?, consultato il 19 aprile 2026, [https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use\_graphicsdrawmeshinstanced\_or\_similar\_but\_vary/](https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use_graphicsdrawmeshinstanced_or_similar_but_vary/)
