---
title: "Ottimizzazione delle prestazioni in Unity: comprendere e risolvere gli errori di allocazione di memoria (GC Alloc) da Resources.FindObjectsOfTypeAll"
date: 2026-09-25 09:26:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, memory, gc-alloc, csharp, dotnet, beginner-guide]
description: Guida dettagliata per principianti sulle cause dei cali di frame (frame spike) dovuti all'uso eccessivo di Resources.FindObjectsOfTypeAll in Unity e sui 4 migliori metodi di ottimizzazione.
lang: it
translation_id: unity-gc-alloc-resources-findobjectsoftypeall
math: true
---

Durante lo sviluppo di un gioco con Unity, ti sarà sicuramente capitato di dover cercare un determinato `GameObject` o `Component`. Unity offre molte funzioni come `Find`, `FindObjectOfType` e, in particolare, `Resources.FindObjectsOfTypeAll`.

Sebbene `Resources.FindObjectsOfTypeAll` sia estremamente potente perché riesce a trovare **tutto** (inclusi gli oggetti disattivati — inactive, i prefab nelle cartelle del progetto o le risorse non ancora istanziate), è anche uno dei «killer» silenziosi che distruggono le prestazioni del tuo gioco se non viene utilizzata nel modo corretto.

Questo articolo ti aiuterà a capire chiaramente perché questa funzione è così pericolosa, come gli strumenti di analisi (Profiler / Project Auditor) la segnalano, e ti guiderà passo dopo passo nei metodi di ottimizzazione per eliminare completamente la spazzatura in memoria (Garbage Collection Allocation — GC Alloc).

---

## **1. Perché `Resources.FindObjectsOfTypeAll` danneggia le prestazioni?**

Quando esegui Unity Memory Profiler o Project Auditor, potresti imbatterti in un avviso giallo (Moderate):
> *"Resources.FindObjectsOfTypeAll() allocates managed memory."*

Per capire il motivo, dobbiamo osservare come questa funzione opera sotto il cofano del motore (core C++):

1. **Scansione dell'intera memoria (Costo CPU elevato)**: A differenza di `FindObjectOfType`, che scansiona solo gli oggetti attivi nella Scene, `Resources.FindObjectsOfTypeAll` scansiona **tutta** la memoria del motore. Esamina tutti gli oggetti della Scene, gli oggetti dell'Editor (se ti trovi nell'Editor) e tutte le risorse (Assets) già caricate nella RAM. Più grande è il progetto, più lentamente viene eseguita questa funzione.
2. **Creazione di spazzatura in memoria (GC Allocation)**: Ogni volta che questa funzione termina l'esecuzione, crea **sempre** un nuovo array (`Array`) sul Managed Heap di C# per contenere i risultati restituiti.

**Conseguenza:** Se chiami continuamente questa funzione (ad esempio in `Update()`, o ogni volta che si preme un pulsante della UI), stai gettando continuamente spazzatura (vecchi array) in memoria. Quando la spazzatura si accumula, il Garbage Collector (GC) di Unity è costretto ad attivarsi. Questo processo di pulizia blocca il gioco per un istante, causando un fastidioso fenomeno di **scatti e rallentamenti (stuttering)** per il giocatore.

---

## **2. 4 Metodi di ottimizzazione (Best Practice)**

Per risolvere definitivamente questo problema, a seconda del contesto, puoi applicare 1 dei seguenti 4 metodi collaudati, raccolti dall'esperienza degli ingegneri di ottimizzazione Unity.

### **Metodo 1: Riferimento diretto tramite Inspector (Altamente consigliato)**
Il modo più rapido e a costo 0 di CPU/RAM è **non cercare proprio nulla**. Invece di usare il codice per cercare un oggetto, dichiara una variabile `public` o `[SerializeField]` e trascina direttamente quell'oggetto dall'interfaccia Inspector di Unity.

```csharp
// ❌ DA EVITARE: Ricerca costosa
void Start() {
    // Questa funzione genera GC Alloc
    myManager = (GameManager)Resources.FindObjectsOfTypeAll(typeof(GameManager))[0]; 
}

// ✅ SOLUZIONE MIGLIORE: Riferimento diretto
[SerializeField] private GameManager myManager; 
// (Trascina e rilascia GameManager in questo campo nell'Editor di Unity)
```

### **Metodo 2: Caching e Singleton**
Se sei proprio costretto a usare il codice per la ricerca, **cerca una sola volta** (ad esempio in `Awake()` o `Start()`), poi salva il riferimento (cache) in una variabile per riutilizzarlo nelle chiamate successive.

Per i sistemi condivisi come `UIManager` o `AudioManager`, utilizza il pattern Singleton o una proprietà statica (`static`) per accedere globalmente senza costi di ricerca.

```csharp
// ❌ DA EVITARE: Chiamare continuamente la ricerca ogni volta che serve del testo
public string GetLocalizedText(string key) {
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetText(key);
}

// ✅ MEGLIO: Salvare in cache in una variabile static (cerca solo 1 volta)
public static UIManager SharedUIManager;

void Awake() {
    if (SharedUIManager == null) 
        SharedUIManager = FindAnyObjectByType<UIManager>(); // Cerca 1 sola volta
}

public string GetLocalizedText(string key) {
    return SharedUIManager.GetText(key); // Riutilizzo immediato, costo 0
}
```

### **Metodo 3: Aggiornamento alle API moderne di Unity 6**
In precedenza, nelle prime versioni di Unity 2023, per sostituire `FindObjectsOfType`, Unity utilizzava l'enum `FindObjectsSortMode`:

```csharp
// ⚠️ Vecchio (Unity 2023.1 - 2023.2):
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
```
Tuttavia, **da Unity 6 in poi, l'enum `FindObjectsSortMode` è stato ufficialmente contrassegnato come obsoleto (Deprecated / Obsolete)** perché il motore è passato dagli `InstanceID` a 32 bit a un nuovo meccanismo di identificazione degli oggetti e ha eliminato l'ordinamento per massimizzare le prestazioni.

Secondo la documentazione ufficiale di Unity 6, dovresti utilizzare i seguenti overload standardizzati:

```csharp
// ❌ Vecchio (Unity 2022 e precedenti - Lento, forza l'ordinamento dell'array)
var managers = FindObjectsOfType<GameManager>();

// ✅ Standard Unity 6: Ottieni un singolo oggetto qualsiasi (Più veloce, Zero-Alloc)
// Non alloca alcun array sull'Heap, restituisce subito il primo oggetto trovato
var manager = FindAnyObjectByType<GameManager>(); 

// ✅ Standard Unity 6: Ottieni una lista di più oggetti (Non serve più il parametro SortMode ormai Obsolete)
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude);
```

> 💡 **Suggerimento:** `FindAnyObjectByType<T>()` è molto più ottimizzato rispetto a `FindFirstObjectByType<T>()` se hai una sola istanza (come Manager/Controller), perché non si preoccupa dell'ordine nella gerarchia e restituisce immediatamente il primo oggetto trovato.

#### ⚠️ **Equivoco comune: esiste `Resources.FindObjectsOfTypeNonAlloc`?**
Molti sviluppatori hanno familiarità con le funzioni di riutilizzo degli array di Unity (come `Physics.RaycastNonAlloc` o `GetComponentsNonAlloc`) e presumono che anche `Resources` abbia una funzione `NonAlloc` simile.
In realtà, secondo la documentazione ufficiale di Unity: **NON esiste affatto una funzione `Resources.FindObjectsOfTypeNonAlloc`**. `Resources.FindObjectsOfTypeAll` creerà **sempre** un nuovo array sul Managed Heap a ogni chiamata.

Se hai bisogno di tenere traccia dell'elenco di tutti gli oggetti nella Scene e vuoi ottenere **0 GC Alloc assoluto**, utilizza la tecnica di **Auto-registrazione (Static Registration Pattern)**:

```csharp
// ✅ Soluzione Zero GC Alloc: Auto-registrazione nella lista all'attivazione
public class Enemy : MonoBehaviour 
{
    // Lista statica condivisa, riutilizza la memoria senza nuove allocazioni
    public static readonly List<Enemy> ActiveEnemies = new();

    void OnEnable()  => ActiveEnemies.Add(this);
    void OnDisable() => ActiveEnemies.Remove(this);
}

// Ovunque nel gioco sia necessario accedere:
// Usa direttamente Enemy.ActiveEnemies — Decine di volte più veloce di Find e completamente a 0 GC Alloc!
```

### **Metodo 4: Racchiudere il codice Editor con `#if UNITY_EDITOR`**
A volte scarichi un plugin dall'Asset Store (ad esempio: un sistema di animazione, uno strumento UI) che contiene la funzione `Resources.FindObjectsOfTypeAll`. Di solito queste funzioni servono solo per i pulsanti di utilità nell'ambiente di sviluppo (Editor).

Per impedire a queste funzioni di «filtrare» nella versione finale del gioco (Build Player) generando avvisi, puoi racchiuderle con la direttiva di preprocessore `#if UNITY_EDITOR`. Il codice all'interno verrà rimosso completamente quando esporti il gioco.

```csharp
#if UNITY_EDITOR 
// Questo blocco di codice viene eseguito solo quando lavori su Unity Editor
// Verrà rimosso completamente durante la Build in file .exe, .apk
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    if (reOfType != null) return reOfType.ToList();
    return null;
}
#endif 
```

---

## **3. Esempi pratici: risoluzione definitiva in un progetto di gioco**

Per capire chiaramente come applicarlo nella pratica, esaminiamo i 2 casi più frequenti in cui il progetto riceve avvisi di spazzatura in memoria da Unity Project Auditor o dal Profiler provenienti da pacchetti di asset di terze parti:

### **Scenario 1: Il sistema di localizzazione UI esegue la scansione della RAM a ogni cambio di lingua**
* **Problema**: Ogni volta che un testo della UI deve essere mostrato o viene riprodotto un suono dell'interfaccia, la funzione di utilità chiama `Resources.FindObjectsOfTypeAll(typeof(UIManager))[0]`. Ciò fa sì che ogni apertura di menu scansioni tutta la RAM e generi un array spazzatura sull'Heap.
* **Soluzione**:
  1. Usare `FindAnyObjectByType<UIManager>()` per cercare una sola e unica volta all'inizializzazione (`Awake`).
  2. Creare una proprietà statica `SharedUIManager` per memorizzare la cache, trasformando l'operazione di ricerca in un accesso istantaneo $O(1)$ con **0 byte di spazzatura**.

```csharp
// ❌ PRIMA DELL'OTTIMIZZAZIONE: Scansiona tutta la memoria e crea spazzatura a ogni chiamata
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetLocalizedText(tableID, tableKey);
}

// ✅ DOPO L'OTTIMIZZAZIONE: Sfrutta la Cache statica (Zero GC Alloc)
public class LocalizationManager : MonoBehaviour 
{
    public static LocalizationManager instance;
    public UIManager UIManagerAsset;

    // Cache di accesso rapido per tutto il gioco
    public static UIManager SharedUIManager => instance != null ? instance.UIManagerAsset : null;

    void Awake() 
    {
        instance = this;
        // Usa l'API di Unity 6 per cercare una sola volta, senza allocare array
        if (UIManagerAsset == null) 
            UIManagerAsset = FindAnyObjectByType<UIManager>(); 
    }
}

// Ovunque serva ottenere il testo basta passare dalla Cache:
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = LocalizationManager.SharedUIManager;
    return tempUIM != null ? tempUIM.GetLocalizedText(tableID, tableKey) : null;
}
```

---

### **Scenario 2: Utilità Editor di terze parti finiscono nella Build finale del gioco**
* **Problema**: Molti pacchetti di strumenti (come sistemi di Animation o Level Design) includono già funzioni di ricerca delle risorse `Resources.FindObjectsOfTypeAll` a supporto dei pulsanti Reset o Setup nell'Editor. Anche se il gameplay non le chiama mai, il fatto che questo codice sia esposto nel sorgente runtime fa comunque contrassegnare la Build del gioco (Player) con avvisi GC Alloc da parte di Unity.
* **Soluzione**: Racchiudere l'intero blocco di codice di ricerca con la direttiva di preprocessore `#if UNITY_EDITOR`. Quando compili il gioco nel file di installazione (`.exe`, `.apk`), Unity rimuove automaticamente e completamente queste righe di codice dal runtime.

```csharp
// ❌ PRIMA DELL'OTTIMIZZAZIONE: Codice di ricerca risorse Editor esposto nel Runtime
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}

// ✅ DOPO L'OTTIMIZZAZIONE: Racchiuso dalla direttiva di preprocessore #if UNITY_EDITOR
#if UNITY_EDITOR
// Questo blocco esiste solo su Unity Editor, rimosso al 100% durante la Build del gioco
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}
#endif
```

---

## **Conclusione**

Per chi si avvicina da poco a Unity, la «spazzatura in memoria» (GC Allocation) è un concetto piuttosto astratto perché C# esegue la pulizia in modo automatico. Tuttavia, nella programmazione di videogiochi, generare continuamente spazzatura porta a scatti e rallentamenti ben visibili sullo schermo.

La regola d'oro: **Stai lontano dalla famiglia di funzioni `Find` (in particolare `Resources.FindObjectsOfTypeAll`) all'interno di cicli come `Update()` o di eventi chiamati frequentemente.** Dai priorità ai riferimenti tramite Inspector, sfrutta la cache (Cache / Singleton), passa all'API standard di Unity 6 (`FindAnyObjectByType`) e racchiudi gli strumenti di utilità Editor con `#if UNITY_EDITOR`. Ottimizzare partendo da questi piccoli dettagli aiuterà il tuo gioco a mantenere 60 FPS stabili su ogni dispositivo!
