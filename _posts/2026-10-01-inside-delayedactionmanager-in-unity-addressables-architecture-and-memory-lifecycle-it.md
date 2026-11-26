---
title: "Rapporto di ricerca tecnica approfondita: Meccanismo di funzionamento, architettura di sistema e impatto di DelayedActionManager nell'ambiente Addressables di Unity"
date: 2026-10-01 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, addressables, memory-management, async, delayedactionmanager, optimization]
description: Analisi approfondita dell'architettura ComponentSingleton di DelayedActionManager in Unity Addressables, del meccanismo di esecuzione LateUpdate, della gestione delle eccezioni proxy C#/C++ e delle strategie di ottimizzazione della memoria AssetBundle.
lang: it
translation_id: unity-addressables-delayedactionmanager
---

L'Addressable Asset System (abbreviato in Addressables) rappresenta un passo avanti architetturale rivoluzionario in Unity, offrendo una soluzione di gestione dei contenuti flessibile, robusta e ottimizzata basata sui tradizionali AssetBundles[^1]. Durante la progettazione e la gestione di giochi o applicazioni interattive su larga scala, controllare flussi di dati asincroni per caricare e rilasciare automaticamente le risorse è un requisito fondamentale. Uno dei componenti chiave che svolge questo compito complesso, ma che spesso disorienta gli ingegneri del software quando analizzano la gerarchia (Hierarchy), è un oggetto generato automaticamente chiamato `DelayedActionManager` situato all'interno della scena `DontDestroyOnLoad`[^2].

Questo rapporto tecnico approfondisce l'anatomia completa della natura architetturale di `DelayedActionManager`, chiarisce le ragioni della sua esistenza nello spazio `DontDestroyOnLoad`, analizza il meccanismo di esecuzione all'interno del ciclo in tempo reale di Unity e disseziona le sfide legate alla gestione della memoria, ai fenomeni di perdita di memoria (memory leaks) e alle eccezioni di thread più comuni. Attraverso l'analisi dei dati di progettazione del sistema e delle best practice, il documento fornisce una visione approfondita per aiutare gli architetti del software a ottimizzare la stabilità dell'applicazione.

## L'evoluzione del sistema di caricamento delle risorse e le basi asincrone

Prima di addentrarsi nelle microstrutture di `DelayedActionManager`, comprendere il contesto in cui è nato il sistema Addressables è un prerequisito essenziale. Nelle versioni precedenti di Unity, gli sviluppatori dipendevano spesso dalla cartella `Resources` o utilizzavano direttamente script AssetBundle grezzi[^4]. Il meccanismo `Resources.Load()` funziona in modo analogo a un utente che entra personalmente in un magazzino: richiede il percorso esatto della directory e il thread di esecuzione principale (main thread) è costretto a bloccarsi (block) finché la risorsa non viene trovata e caricata in memoria[^4]. Il difetto di questo approccio è che ostacola la scalabilità dell'applicazione e provoca gravi cali dei fotogrammi al secondo (FPS drop) durante l'elaborazione di grandi quantità di dati.

Per risolvere questo problema, Addressables opera come un moderno servizio di spedizione. Lo sviluppatore deve soltanto fornire l'identificativo della risorsa (address/key) e il sistema instrada automaticamente la richiesta per trovare la risorsa nella memoria locale (Local) o scaricarla dai server di una rete di distribuzione dei contenuti (CDN - Content Delivery Network)[^4]. Ancora più importante, l'intero ciclo si svolge in modo asincrono. La chiamata di caricamento, tipicamente `Addressables.LoadAssetAsync`, non restituisce immediatamente l'oggetto, bensì un handle di orientamento chiamato `AsyncOperationHandle`[^4]. Questa interfaccia fornisce un meccanismo di richiamata (callback) quando la risorsa è pronta, consentendo al thread principale dell'applicazione di continuare a elaborare senza interruzioni la logica fisica e grafica[^4].

Questo passaggio da un modello sincrono a uno interamente asincrono comporta una sfida architetturale importante: quando un processo di caricamento di una risorsa richiede diversi secondi a causa di una banda di rete lenta, l'applicazione potrebbe già essere passata a una scena (scene) completamente diversa[^1]. La gestione delle funzioni di callback, delle code di comandi (command queues) e del conteggio dei riferimenti (reference counting) richiede un'entità amministrativa centrale, immune al ciclo di creazione e distruzione delle scene ordinarie. È proprio per questo motivo che gli sviluppatori di Unity hanno integrato il modello di scena `DontDestroyOnLoad` nel nucleo di Addressables.

## La scena DontDestroyOnLoad (DDOL) e l'architettura di persistenza globale

Nell'ambiente Unity, l'operazione di caricamento di una nuova scena (tramite `SceneManager.LoadScene` nella modalità predefinita Single) attiva automaticamente il meccanismo di pulizia della memoria. Il motore distrugge tutti i `GameObject` e i `Component` appartenenti alla scena precedente per garantire il rilascio delle risorse non più utilizzate[^7]. Sebbene il caricamento additivo delle scene (Additive scenes) permetta di mantenere attive più scene in parallelo per gestire lo stato globale (ad esempio una scena dedicata al Game Manager e un'altra al Level), il meccanismo `DontDestroyOnLoad` (DDOL) continua a svolgere il ruolo di tecnica di sistema fondamentale per proteggere gli oggetti di basso livello[^7].

La comparsa della scena `DontDestroyOnLoad` nell'interfaccia dell'Editor di Unity quando si preme Play non è un bug, ma un meccanismo nascosto predefinito del motore pensato per raggruppare gli oggetti contrassegnati per non essere distrutti al caricamento di una scena[^9]. Affinché un `GameObject` venga accettato in questa zona sicura, il sistema Unity impone una regola obbligatoria: tale oggetto deve trovarsi al livello radice (root level) della scena[^8]. Qualsiasi tentativo di applicare `DontDestroyOnLoad(gameObject)` a un oggetto figlio annidato (nested object) fallirà e verrà registrato un avviso[^8].

Per il sistema Addressables, le operazioni di caricamento e rilascio delle risorse hanno un ciclo di vita che abbraccia più scene diverse. Ad esempio, il monitoraggio dello stato di download di un AssetBundle da un server remoto non può essere interrotto a metà soltanto perché il giocatore ha appena attraversato una porta di cambio livello. L'utilizzo del meccanismo `RuntimeInitializeOnLoadMethod` combinato con un pattern Singleton avanzato consente al codice sorgente di Addressables di generare automaticamente un oggetto radice e inserirlo nella scena DDOL fin dall'avvio dell'applicazione[^2]. Ciò spiega perché, anche quando lo sviluppatore non scrive alcuna riga di codice relativa a DDOL, un oggetto chiamato `DelayedActionManager` compaia automaticamente nell'angolo inferiore sinistro dell'elenco delle scene[^2].

## Struttura interna e ruolo tecnico di DelayedActionManager

Esaminando in profondità il codice sorgente e la documentazione API del pacchetto Addressables, `DelayedActionManager` risulta essere una classe concreta (concrete class) collocata nello spazio dei nomi `UnityEngine.ResourceManagement.Util`[^11]. La sua struttura non è quella di una semplice classe di utilità statica (static utility class), bensì di un componente collegato direttamente a un `GameObject` mediante ereditarietà da un'architettura di base[^12].

### Il modello ComponentSingleton e l'automazione dell'inizializzazione

L'architettura di `DelayedActionManager` è costruita sul pattern di progettazione `ComponentSingleton`, una classe fondamentale definita nello stesso spazio dei nomi[^13]. L'uso del pattern Singleton su un componente (`Component`) anziché su una pura classe C# conferisce al sistema la capacità di interagire direttamente con il ciclo di eventi in tempo reale (`PlayerLoop`) di Unity.

Quando il sistema `ResourceManager` riceve per la prima volta una richiesta di caricamento o di aggiornamento dello stato (ad esempio `Addressables.LoadAssetAsync` oppure operazioni di diagnostica di rete), richiama l'istanza di `DelayedActionManager`. In quel momento, il modello `ComponentSingleton` esegue automaticamente una procedura nascosta che comprende: la creazione di un `GameObject` vuoto, l'assegnazione del nome `"DelayedActionManager"`, il collegamento dello script corrispondente e la chiamata immediata a `DontDestroyOnLoad` per inserirlo nello spazio di protezione globale[^2]. Questa progettazione ad inizializzazione pigra (lazy initialization) assicura che le risorse di sistema vengano consumate solo quando la funzionalità di gestione delle azioni differite è effettivamente richiesta, rispondendo ai dubbi comuni degli sviluppatori sulla comparsa «magica» di questo oggetto nell'interfaccia[^3].

### Analisi del meccanismo di pianificazione e della fase LateUpdate

Il compito principale di `DelayedActionManager` è fungere da pianificatore centrale (central scheduler) per le azioni differite, le callback, le coroutine e la gestione della memoria a livello microscopico[^11]. Una differenza sottile ma di importanza cruciale nella sua architettura è che tutta la logica di elaborazione delle code viene instradata per essere eseguita all'interno del metodo `LateUpdate()` del ciclo di vita di Unity[^11].

La scelta progettuale di affidarsi a `LateUpdate` anziché al tradizionale `Update` risolve un problema architetturale profondo relativo alla coerenza dei dati. La tabella seguente illustra l'ordine di esecuzione di Unity e il ruolo della fase `LateUpdate` nella protezione dei dati di Addressables.

| Fase di esecuzione (PlayerLoop) | Funzioni tipiche | Ruolo per Addressables e DelayedActionManager |
| :--- | :--- | :--- |
| **FixedUpdate** | Elaborazione della simulazione fisica, collisioni statiche/dinamiche. | La logica di gioco può attivare richieste di distruzione degli oggetti dopo una collisione. |
| **Update** | Input del giocatore, movimento, logica IA, aggiornamento dello stato di gioco. | I metodi `Addressables.LoadAssetAsync` o `Release` vengono chiamati manualmente. I GameObject possono essere distrutti tramite `Destroy()` qui. |
| **LateUpdate** | Aggiornamento della posizione della Camera, regolazioni di post-elaborazione (post-processing). | `DelayedActionManager` ripulisce la memoria, aggiorna i contatori dei riferimenti e invoca le callback asincrone per evitare conflitti con i comandi di distruzione della fase `Update`[^11]. |

Se il sistema `ResourceManager` eseguisse immediatamente le callback di completamento dell'attività durante la fase `Update`, correrebbe un rischio elevato di interagire con un sottosistema (ad esempio quello grafico o dell'interfaccia utente) in uno stato intermedio, non avendo ancora terminato il calcolo del fotogramma. Differendo (delaying) l'invocazione delle funzioni `OnComplete` o la riduzione dei contatori di riferimenti (ref-count decrements) fino a `LateUpdate()`, `DelayedActionManager` garantisce che l'intero stato logico del fotogramma corrente si sia stabilizzato[^11]. I dati provenienti da numerose segnalazioni di stack trace mostrano che la funzione `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` rappresenta il ponte finale prima che il controllo venga restituito al codice sorgente dell'utente[^15].

## Dissezione delle eccezioni di sistema e degli stack trace

Nonostante sia progettato con un elevato livello di sicurezza, la complessità del meccanismo asincrono, combinata con operazioni di gestione del ciclo di vita non conformi da parte dello sviluppatore, rende spesso `DelayedActionManager` il punto focale di gravi eccezioni. I log degli errori offrono indizi fondamentali sul modo in cui il sistema interagisce con la memoria gestita (managed memory) e con la memoria nativa (native memory).

### Errore NullReferenceException e conflitto di ciclo di vita del proxy C# - C++

Uno scenario di errore molto comune nell'ambiente Addressables è la comparsa dell'eccezione `ArgumentNullException: Value cannot be null. Parameter name: obj` generata dal metodo `StartCoroutine_Auto` di `DelayedActionManager`[^19]. Questo errore non è un malfunzionamento interno di Unity, ma deriva dalla discrepanza tra il meccanismo di raccolta dei rifiuti di C# (Garbage Collector) e la gestione dei puntatori nativi del codice C++ sottostante[^19].

In Unity, oggetti come `GameObject` o `MonoBehaviour` sono in realtà classi proxy scritte in C#, contenenti un riferimento interno che punta all'oggetto nativo allocato in C++ all'interno del motore[^19]. Quando lo sviluppatore invoca `Destroy(gameObject)`, l'oggetto C++ viene immediatamente distrutto e la relativa memoria restituita, rendendo nullo il riferimento interno[^19]. Tuttavia, la classe proxy C# può continuare a esistere nella memoria gestita (managed memory) per un certo periodo finché il Garbage Collector non effettua la scansione[^19].

Il disastro si verifica quando gli sviluppatori combinano espressioni anonime (lambdas/closures) con i processi asincroni di Addressables. Un'espressione lambda ha la proprietà di «catturare» (capture) le variabili del contesto circostante. Si consideri il seguente schema di codice:

```csharp
// Un'azione inserita nella coda di DelayedActionManager
DelayedAction(null, () => {
    _crawlerRobot.BreakAwayLowerBody();
    if (isLevelLoad) {
        PhysicsUtil.ManualSimulation(2);
    }
});
```

Quando questo codice viene eseguito, la variabile `_crawlerRobot` (che è un proxy C#) viene catturata dalla closure[^19]. Se la logica di gioco distrugge `_crawlerRobot` esattamente in quel fotogramma, il puntatore C++ sottostante scompare. Poiché però `DelayedActionManager` ha pianificato l'esecuzione di questa lambda per la fase `LateUpdate` (o in un fotogramma successivo), quando la lambda viene effettivamente attivata tenta di accedere al membro `BreakAwayLowerBody()` di un puntatore C++ ormai morto[^19]. La conseguenza inevitabile è il lancio di una `NullReferenceException` o del messaggio di errore «L'oggetto è stato distrutto ma stai ancora cercando di accedervi»[^19].

Per mitigare questo rischio architetturale, gli esperti del software raccomandano due soluzioni progettuali:

1. Evitare l'abuso di annidamenti eccessivi di espressioni lambda (lambdas nesting) quando si gestiscono modifiche di stato di basso livello[^19].
2. Eseguire sempre una verifica sicura della nullità, facendo affidamento sul fatto che Unity ha ridefinito (overloaded) l'operatore `==` di C# per ispezionare direttamente lo stato del puntatore C++ sottostante[^19].

### Conflitto di PlayerLoop ed errore «Assertion failed on expression: ShouldRunBehaviour()»

Durante la gestione delle versioni (version control) dei pacchetti Addressables, un gran numero di sviluppatori ha segnalato che l'Editor di Unity viene inondato da un messaggio di errore a basso livello: `Assertion failed on expression: 'ShouldRunBehaviour()'` nel file `MonoBehaviour.cpp`[^3].

La traccia dello stack (stack trace) indica che questo processo origina direttamente dal `GameObject` `"DelayedActionManager"` situato nella scena `DontDestroyOnLoad`[^3]. L'analisi della causa principale (Root Cause Analysis) rivela una falla nella gestione del flusso di riproduzione (Play Mode) dell'Editor di Unity. Quando l'editor attraversa una ricompilazione del dominio (Domain Reload) oppure quando il processo di caricamento delle risorse non è ancora concluso nel momento in cui l'utente preme Stop, `DelayedActionManager` rimane intrappolato come oggetto orfano (orphaned object)[^3].

Poiché è designato come `DontDestroyOnLoad`, tenta di continuare a eseguire i cicli `LateUpdate` e i controlli sul comportamento (behaviour checks) nonostante l'ambiente di esecuzione nativo di Unity (`PlayerLoop`) abbia ordinato di arrestare tutte le attività[^3]. Questo errore è stato registrato nella sua forma più grave durante la transizione dal pacchetto Addressables `1.16.x` alla versione `1.18.x`, costringendo molti team di sviluppo a eseguire un downgrade manuale alla versione `1.17.17` per garantire la stabilità dell'API di elaborazione sincrona ed eliminare il blocco delle code[^3].

### L'evoluzione di DelayedActionManager nella storia delle versioni

Un dettaglio interessante emerso dallo studio della documentazione API e dei registri delle modifiche (changelogs) di Unity Addressables è l'esistenza ciclica di `DelayedActionManager`. Versioni come la `0.7.5` e la `1.11.2` annunciavano esplicitamente nei log di aggiornamento la ristrutturazione dell'interfaccia degli script di build (build script interface) con la nota: *"Removed DelayedActionManager. Removed ISceneProvider. Users can implement custom scene loading"*[^20]. Questa decisione mirava inizialmente a semplificare il livello API e a delegare il controllo alla classe personalizzabile `AsyncOperationBase`[^20].

Tuttavia, le segnalazioni di bug provenienti dalle versioni post-LTS (Long-Term Support) come `1.18.15`, `1.19.19` e `1.21.21` mostrano il ritorno costante di `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` nelle catene degli stack trace[^11]. Ciò riflette la filosofia di progettazione iterativa (iterative design) di Unity: dopo averlo rimosso per snellire il sistema, gli ingegneri si sono resi conto che la mancanza di un gestore centralizzato delle attività differite creava difficoltà insormontabili nella raccolta degli eventi diagnostici (`DiagnosticEventCollector`), nella gestione delle tabelle di precaricamento (preload tables) e nella garanzia di sicurezza della memoria alla chiusura dell'applicazione[^11]. `DelayedActionManager` è stato riprogettato e ripristinato come utilità di sistema interna, non più esposta tramite l'interfaccia utente pubblica, ma responsabile della gestione dei rischi di smaltimento (disposal) allo spegnimento dell'app[^20].

## Meccanismo di conteggio dei riferimenti e dinamica dei memory leak

L'esistenza di `DelayedActionManager` è strettamente legata a uno dei pilastri più complessi di Addressables: il sistema di gestione della memoria (Memory Management). A differenza dell'affidarsi interamente al Garbage Collector, Addressables controlla la permanenza dei dati in RAM tramite il meccanismo del conteggio dei riferimenti (Reference Counting)[^23].

### Dinamica dei riferimenti e gerarchia delle dipendenze

Ogni volta che il sistema riceve una richiesta di caricamento di una risorsa, il contatore dei riferimenti di tale risorsa viene incrementato di uno (increment). Al termine dell'utilizzo, la chiamata `Addressables.Release` ordina al sistema di decrementare questo contatore (decrement)[^23]. La regola d'oro è che il sistema consente il rilascio della memoria fisica che ospita la risorsa soltanto quando il contatore dei riferimenti torna al valore assoluto di 0[^23].

La complessità cresce esponenzialmente poiché Addressables gestisce le dipendenze attraverso l'architettura AssetBundle. Quando si carica una risorsa (ad esempio un Material), il sistema non carica solo il materiale in sé, ma carica automaticamente tutti gli AssetBundle contenenti i suoi componenti dipendenti (ad esempio le Texture)[^25]. Il grafo delle dipendenze (dependency graph) viene calcolato a livello di Bundle: ciò significa che se una risorsa nel Bundle A fa riferimento a una risorsa nel Bundle B, l'intero Bundle B deve essere caricato nella memoria host[^26].

Il limite tecnico più rigido di Unity in questa architettura è il seguente: **l'utente non può scaricare parzialmente (partially unload) il contenuto di un AssetBundle**[^23]. Per chiarire, supponiamo che un AssetBundle chiamato `"stuff"` contenga tre risorse indipendenti: `Albero`, `CarroArmato` e `Mucca`[^23].

1. Quando viene caricata la risorsa `Albero`, lo strumento di analisi della memoria (Profiler) mostra un riferimento per `Albero` e un riferimento corrispondente per il bundle `stuff`[^23].
2. Quando viene caricata successivamente la risorsa `CarroArmato`, il contatore di `CarroArmato` sale a 1 e quello di `stuff` sale a 2[^23].
3. Se il gioco esegue il comando `Release(Albero)`, il contatore di `Albero` scende a 0 e la barra blu nel Profiler scompare[^23].
4. Tuttavia, i dati fisici di `Albero` restano intatti nella memoria di sistema. Poiché `CarroArmato` mantiene ancora attivo il collegamento lasciando il contatore dell'AssetBundle `stuff` maggiore di 0, nessuna risorsa di questo bundle può essere distrutta finché l'intero bundle non viene completamente rilasciato[^23].

### Sindrome da «Asset Churn» e rigonfiamento della memoria (Memory Bloat)

Il fenomeno per cui le risorse vengono continuamente caricate e rilasciate, quindi immediatamente ricaricate in un breve arco di tempo, è definito «Asset Churn» (logoramento delle risorse)[^23]. Questa vulnerabilità emerge spesso durante il passaggio da un livello all'altro (levels). Se il Livello 1 utilizza la risorsa `Barca` e il Livello 2 utilizza la risorsa `Aereo` (entrambe condividono la texture `Mimetica`), all'uscita dal Livello 1 lo sviluppatore rilascia `Barca`, inducendo Addressables a rimuovere subito dalla memoria la texture `Mimetica`. Un millisecondo dopo, quando il Livello 2 istanzia `Aereo`, il sistema costringe il disco rigido a eseguire nuovamente il ciclo di I/O per ricaricare da zero quella stessa texture `Mimetica`[^23]. Questo processo genera picchi (spikes) improvvisi nel tempo di elaborazione dei fotogrammi e spinge la memoria verso soglie critiche, specialmente su hardware mobile[^27].

Inoltre, l'omissione di un comando `Release` porta all'accumulo di riferimenti spazzatura, facendo lievitare lo spazio RAM occupato da centinaia di megabyte fino a diversi gigabyte nell'arco di pochi cambi di scena[^28]. Poiché né `DelayedActionManager` né Addressables tracciano il numero di istanze create tramite il metodo `Instantiate` puro di `MonoBehaviour`, qualsiasi imprecisione nel tracciamento degli handle di memoria genera un memory leak permanente[^6].

### Architettura di compressione dei dati e pressione sull'allocazione della memoria

La dimensione degli AssetBundle e il metodo di compressione dei dati incidono direttamente sul modo in cui i dati risiedono nella RAM. La scelta del metodo di compressione stabilisce se l'AssetBundle occuperà permanentemente un ampio volume di memoria oppure se potrà ottimizzare la larghezza di banda.

Tabella riassuntiva delle caratteristiche degli algoritmi di compressione AssetBundle e dell'impatto sull'archiviazione[^29]:

| Algoritmo di compressione | Riconoscimento dei file locali | Richiede il caricamento dell'intero Bundle in RAM | Impatto su prestazioni e archiviazione |
| :--- | :--- | :--- | :--- |
| **LZMA** | No. Il Bundle è compresso come un unico blocco monolitico. | **Sì.** L'intero file deve essere decompresso in memoria. | Rapporto di compressione massimo e dimensione di download ridotta, ma causa un rigonfiamento acuto della memoria (Memory Bloat) e un uso intenso della CPU durante l'estrazione[^29]. |
| **LZ4** | Sì. Compressione a blocchi (chunk-based). | **No.** Carica solo la porzione di dati a cui si sta accedendo. | Consigliato come standard predefinito (default). Consente la memorizzazione nella cache (caching) diretta su disco locale senza caricare tutti i metadati in RAM[^29]. |
| **Uncompressed** | Sì. Riconoscimento indipendente per ogni risorsa. | **No.** Accesso diretto. | Nessun tempo speso nella decompressione, dimensione originale dei file massima. Ottimale per il caricamento istantaneo se la banda del disco lo consente[^29]. |

Quando si richiede una minuscola risorsa da un gigantesco pacchetto AssetBundle compresso con LZMA, l'intero file (inclusi intestazione, metadati e tabelle di buffer per lo streaming) deve essere trasferito dal disco rigido alla RAM[^27]. Questo errore di progettazione trasforma gli AssetBundle enormi in bombe a orologeria che provocano crash per esaurimento della memoria (OOM crashes) nell'applicazione[^27].

## Best practice nella governance delle risorse

Per domare la complessità del sistema di conteggio dei riferimenti e contenere il carico su `DelayedActionManager`, i progettisti di sistema devono applicare una struttura del ciclo di vita estremamente rigorosa, combinata con tecniche di ottimizzazione del ciclo di vita delle risorse.

### 1. Sincronizzazione del ciclo di inizializzazione e rilascio

Ogni oggetto `AsyncOperationHandle` restituito dall'API deve obbligatoriamente essere rilasciato al termine del proprio ciclo di utilizzo[^6]. La mancata esecuzione di questa operazione non solo genera memory leak, ma può anche provocare blocchi critici del sistema (crashes)[^6]. La tabella seguente illustra le coppie simmetriche obbligatorie nella programmazione con Addressables:

| Metodo di inizializzazione / caricamento | Metodo di rilascio corrispondente | Meccanismo di funzionamento interno |
| :--- | :--- | :--- |
| `Addressables.LoadAssetAsync` | `Addressables.Release(handle)` | Sottrae 1 al contatore dei riferimenti dell'AssetBundle che la contiene[^6]. |
| `Addressables.InstantiateAsync` | `Addressables.ReleaseInstance(gameObject)` | Distrugge l'oggetto visualizzato (Instance) e sottrae automaticamente 1 al contatore del Prefab originale[^4]. |
| Assegnazione tramite `AssetReference` | `reference.ReleaseAsset()` | Equivalente alla chiamata di `Release` tramite handle, ripulisce i riferimenti statici[^6]. |

In particolare, quando si utilizzano `ScriptableObject` per memorizzare le configurazioni di gioco, referenziare direttamente un oggetto (`public Object _worldAsset`) genera riferimenti forti (hard references), costringendo l'intero sistema a caricare subito tale risorsa in RAM[^27]. La soluzione ottimale è utilizzare `AssetReference` (`public AssetReference addressableAsset;`) per eseguire il caricamento asincrono su richiesta (on-demand loading)[^6].

### 2. Intervento a basso livello: Resources.UnloadUnusedAssets()

Nella situazione di stallo in cui gli AssetBundle condivisi restano bloccati in memoria a causa della proprietà di «impossibilità di rilascio parziale» (ad esempio: la risorsa `Albero` bloccata insieme a `CarroArmato`), l'unica via d'uscita è utilizzare un'API coercitiva dal livello base del motore: `Resources.UnloadUnusedAssets()`[^25].

Questa funzione esegue una scansione profonda dell'intera RAM di sistema per individuare ogni risorsa (comprese quelle nascoste negli AssetBundle) con un numero di riferimenti interni effettivi (actual engine references) rigorosamente pari a 0, forzandone la distruzione[^25]. Tuttavia, si tratta di un'operazione estremamente dispendiosa in termini di prestazioni computazionali, che genera gravi cali di frame rate (FPS drops) perché la CPU deve mettere in pausa il thread logico per eseguire la procedura di pulizia[^27]. Gli ingegneri dovrebbero attivarla soltanto nelle fasi di transizione tra schermate principali (loading screens) oppure affidarsi all'invocazione automatica del sistema durante il cambio scena con `SceneManager.LoadScene`[^29].

### 3. Pianificazione e frammentazione degli AssetBundle (Bundle Packing Modes)

L'organizzazione della struttura dei gruppi (Groups) nell'interfaccia di configurazione di Addressables determina direttamente le prestazioni di caricamento in memoria e la banda di download. Scegliere la modalità di impacchettamento (Bundle Mode) appropriata per ciascuna tipologia di risorsa è un passaggio progettuale di fondamentale importanza[^6]:

* **Pack Together (Impacchettamento congiunto)**: da utilizzare per risorse con un ciclo di vita strettamente interconnesso che compaiono sempre contemporaneamente. Ciò riduce i costi di analisi del grafo delle dipendenze e l'I/O di rete[^6].
* **Pack Separately (Impacchettamento separato)**: ottimale per risorse gigantesche e indipendenti, o per grandi mappe di cui non si può garantire il caricamento simultaneo. Elimina il rischio che una risorsa voluminosa impedisca il rilascio di un'altra risorsa più piccola[^6].
* **Pack Together By Label (Impacchettamento per etichetta)**: consente di combinare risorse sparse tramite metadati di etichetta (ad esempio assegnando l'etichetta `"Halloween 2023"` per raggruppare tutti i contenuti dell'evento in un unico bundle, facile da aggiornare via CDN)[^6].

Per ridurre ulteriormente l'ingombro della tabella dei tipi (`TypeTree`) nell'AssetBundle, gli sviluppatori possono attivare l'opzione `BuildAssetBundleOptions.DisableWriteTypeTree`. Questa funzionalità rimuove i metadati non necessari, ma richiede la ricostruzione dei gruppi locali (rebuild local groups) prima di esportare il file eseguibile[^26].

### 4. Governance della memoria audio e grafica (Graphics & Audio)

L'ottimizzazione dei livelli ausiliari è il metodo più efficace per ridurre la frequenza di intervento del Garbage Collector. La configurazione del formato di caricamento dei flussi audio incide direttamente sulla memoria[^27]:

* **Musica di sottofondo (BGM) lunga**: deve essere configurata in **Streaming** per caricare piccoli buffer di memoria dal disco[^27].
* **Effetti sonori lunghi**: scegliere **Compressed In Memory** per mantenerli compressi in RAM e decomprimerli in tempo reale durante la riproduzione[^27].
* **Effetti sonori brevi / ad alta frequenza**: usare **Decompress On Load** per avere direttamente disponibili i dati non compressi, eliminando il costo CPU[^27].

Inoltre, disabilitare l'opzione `"Read/Write enabled"` sulle Texture e impostare la rimozione del buffer di profondità (Depth Stencil Format su `None`) per la Camera grafica dell'interfaccia utente (UI) ridurrà di almeno il 50% la quantità di RAM di rendering non necessaria[^27].

## Conclusione sull'interazione globale

Lo studio di `DelayedActionManager` non soltanto decifra l'origine di un oggetto nascosto nella scena `DontDestroyOnLoad`, ma svela la filosofia di progettazione fondamentale del sistema Addressables in Unity. Questa classe `ComponentSingleton` funge da ponte temporale raffinato, preservando l'integrità dei dati reindirizzando i processi di rilascio, le chiamate asincrone e la gestione dei buffer verso il ciclo `LateUpdate`. Essa isola le modifiche strutturali della memoria dalle interferenze che potrebbero essere causate dal codice fisico o dalla logica di controllo appartenente al flusso `Update`, creando uno scudo contro le eccezioni di corruzione del sistema durante i cambi di scena.

Tuttavia, `DelayedActionManager` non è una bacchetta magica in grado di risolvere i punti deboli intrinseci di un'architettura di gestione della memoria carente. Impone requisiti rigorosi ai progettisti dell'architettura software nel mantenere un ciclo di caricamento/rilascio delle risorse completamente simmetrico, progettare espressioni anonime C# (lambdas) evitando cicli di cattura di oggetti C++ nativi e modularizzare la struttura degli AssetBundle per prevenire ostinati memory leak. Grazie a una padronanza approfondita dell'instradamento di caricamento asincrono, all'uso oculato di metodi di compressione come LZ4 e al ricorso mirato alla forza di `Resources.UnloadUnusedAssets`, i team di sviluppo possono progettare modelli architetturali solidi ed estremamente scalabili su ogni piattaforma senza temere l'esaurimento permanente delle risorse.

## **Riferimenti**

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

### Letture consigliate

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
