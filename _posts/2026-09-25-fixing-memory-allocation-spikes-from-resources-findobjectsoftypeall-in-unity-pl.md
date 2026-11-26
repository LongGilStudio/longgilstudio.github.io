---
title: "Optymalizacja Wydajności Unity: Zrozumienie i Naprawa Skoków Alokacji Pamięci (GC Alloc) z Resources.FindObjectsOfTypeAll"
date: 2026-09-25 09:26:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, memory, gc-alloc, csharp, dotnet, beginner-guide]
description: Szczegółowy poradnik dla początkujących wyjaśniający, dlaczego nadużywanie Resources.FindObjectsOfTypeAll powoduje przycięcia (frame spikes) w Unity oraz 4 najdokładniejsze metody optymalizacji.
lang: pl
translation_id: unity-gc-alloc-resources-findobjectsoftypeall
math: true
---

Podczas tworzenia gier w Unity z pewnością zdarzyła Ci się sytuacja, w której trzeba było odszukać konkretny obiekt `GameObject` lub `Component`. Unity udostępnia do tego wiele metod, takich jak `Find`, `FindObjectOfType`, a w szczególności `Resources.FindObjectsOfTypeAll`.

Mimo że `Resources.FindObjectsOfTypeAll` jest niezwykle potężne, ponieważ potrafi znaleźć **wszystko** (włącznie z wyłączonymi obiektami — inactive, prefabami w folderach projektu czy zasobami, które nie zostały jeszcze zespawnowane), jest ono również jednym z cichych „zabójców” wydajności Twojej gry, jeśli nie jest używane właściwie.

Ten artykuł pomoże Ci dokładnie zrozumieć, dlaczego ta funkcja jest tak niebezpieczna, w jaki sposób ostrzegają przed nią narzędzia diagnostyczne (Profiler / Project Auditor), oraz przeprowadzi Cię krok po kroku przez metody optymalizacji pozwalające całkowicie wyeliminować śmieci pamięciowe (Garbage Collection Allocation – GC Alloc).

---

## **1. Dlaczego `Resources.FindObjectsOfTypeAll` Szkodzi Wydajności?**

Podczas uruchamiania Unity Memory Profilera lub Project Auditora możesz natknąć się na żółte ostrzeżenie (Moderate):
> *"Resources.FindObjectsOfTypeAll() allocates managed memory."*

Aby zrozumieć dlaczego, musimy przyjrzeć się temu, jak ta funkcja działa pod spodem silnika (C++ core):

1. **Skanowanie Całej Pamięci (Wysoki Koszt CPU)**: W przeciwieństwie do `FindObjectOfType`, które skanuje jedynie aktywne obiekty na scenie (Scene), `Resources.FindObjectsOfTypeAll` przeszukuje **całą** pamięć silnika. Przechodzi przez wszystkie obiekty sceny, obiekty Edytora (jeśli działa w Edytorze) oraz zasoby (Assets) wczytane do pamięci RAM. Im większy projekt, tym wolniej działa ta funkcja.
2. **Tworzenie Śmieci w Pamięci (GC Allocation)**: Po każdym zakończeniu działania funkcja ta **zawsze** tworzy na stercie zarządzanej C# (Managed Heap) nową tablicę (`Array`), aby umieścić w niej zwracane wyniki.

**Konsekwencja:** Jeśli wywołujesz tę funkcję wielokrotnie (na przykład w metodzie `Update()` lub przy każdym kliknięciu przycisku UI), nieustannie wrzucasz do pamięci śmieci (zużyte tablice). Gdy pamięć się zapełni, odśmiecacz (Garbage Collector – GC) w Unity zostaje zmuszony do uruchomienia. Proces czyszczenia na chwilę zamraża grę, wywołując bardzo irytujące dla gracza **przycięcia (stuttering)**.

---

## **2. 4 Metody Optymalizacji (Dobre Praktyki)**

Aby raz na zawsze rozwiązać ten problem, w zależności od sytuacji możesz zastosować jedną z 4 sprawdzonych metod opracowanych przez inżynierów optymalizacji Unity.

### **Metoda 1: Bezpośrednie referencje przez Inspektor (Najbardziej zalecana)**
Najszybszym sposobem, kosztującym 0 CPU i 0 RAM-u, jest **całkowite unikanie wyszukiwania**. Zamiast używać kodu do szukania obiektu, zadeklaruj zmienną `public` lub z atrybutem `[SerializeField]` i przeciągnij oraz upuść dany obiekt bezpośrednio z poziomu Inspektora Unity.

```csharp
// ❌ UNIKAJ: Kosztowne wyszukiwanie
void Start() {
    // Ta funkcja wygeneruje GC Alloc
    myManager = (GameManager)Resources.FindObjectsOfTypeAll(typeof(GameManager))[0]; 
}

// ✅ NAJLEPIEJ: Bezpośrednia referencja
[SerializeField] private GameManager myManager; 
// (Przeciągnij i upuść GameManager w to pole w Edytorze Unity)
```

### **Metoda 2: Caching (Buforowanie) i Singleton**
Jeśli musisz wyszukać obiekt za pomocą kodu, **zrób to tylko jeden raz** (na przykład w `Awake()` lub `Start()`), a następnie zapisz referencję w pamięci podręcznej (cache) w zmiennej do późniejszego użycia.

W przypadku współdzielonych systemów, takich jak `UIManager` czy `AudioManager`, użyj wzorca Singleton lub właściwości statycznej, aby uzyskać globalny dostęp bez żadnego kosztu wyszukiwania.

```csharp
// ❌ UNIKAJ: Ciągłe wywoływanie wyszukiwania za każdym razem, gdy potrzebny jest tekst
public string GetLocalizedText(string key) {
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetText(key);
}

// ✅ LEPIEJ: Zapisz w pamięci podręcznej w zmiennej statycznej (szukaj tylko raz)
public static UIManager SharedUIManager;

void Awake() {
    if (SharedUIManager == null) 
        SharedUIManager = FindAnyObjectByType<UIManager>(); // Wyszukaj tylko raz
}

public string GetLocalizedText(string key) {
    return SharedUIManager.GetText(key); // Natychmiastowe ponowne użycie, koszt 0
}
```

### **Metoda 3: Przejście na nowoczesne API Unity 6**
Wcześniej, w początkowych wersjach Unity 2023 przy zastępowaniu `FindObjectsOfType`, Unity stosowało typ wyliczeniowy `FindObjectsSortMode`:

```csharp
// ⚠️ Stare (Unity 2023.1 - 2023.2):
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
```
Jednak **od wersji Unity 6 typ wyliczeniowy `FindObjectsSortMode` został oficjalnie oznaczony jako przestarzały (Deprecated / Obsolete)**, ponieważ silnik przeszedł z 32-bitowego `InstanceID` na nowy mechanizm identyfikacji obiektów i zrezygnował z sortowania w celu maksymalizacji wydajności.

Zgodnie z oficjalną dokumentacją Unity 6 powinieneś korzystać z następujących ustandaryzowanych przeciążeń:

```csharp
// ❌ Stare (Unity 2022 i starsze - Wolne, wymusza sortowanie tablicy)
var managers = FindObjectsOfType<GameManager>();

// ✅ Standard Unity 6: Pobierz dowolny pojedynczy obiekt (Najszybsze, Zero-Alloc)
// Nie alokuje tablicy na stercie; od razu zwraca pierwszy znaleziony obiekt
var manager = FindAnyObjectByType<GameManager>(); 

// ✅ Standard Unity 6: Pobierz listę wielu obiektów (Bez przestarzałego parametru SortMode)
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude);
```

> 💡 **Wskazówka:** `FindAnyObjectByType<T>()` jest znacznie wydajniejsze niż `FindFirstObjectByType<T>()`, jeśli masz tylko 1 instancję (np. Manager/Controller), ponieważ nie przejmuje się kolejnością w hierarchii i od razu zwraca pierwszy napotkany obiekt.

#### ⚠️ **Częsty błąd myślowy: Czy istnieje `Resources.FindObjectsOfTypeNonAlloc`?**
Wielu programistów zna funkcje Unity pozwalające ponownie wykorzystywać tablice (takie jak `Physics.RaycastNonAlloc` czy `GetComponentsNonAlloc`) i zakłada, że `Resources` ma podobną funkcję `NonAlloc`.
W rzeczywistości według oficjalnej dokumentacji Unity: **Funkcja `Resources.FindObjectsOfTypeNonAlloc` w ogóle NIE istnieje**. `Resources.FindObjectsOfTypeAll` **zawsze** utworzy nową tablicę na stercie zarządzanej przy każdym wywołaniu.

Jeśli musisz śledzić listę wszystkich obiektów na scenie, osiągając przy tym **absolutne 0 GC Alloc**, użyj techniki **samorejestracji (Static Registration Pattern)**:

```csharp
// ✅ Rozwiązanie Zero GC Alloc: Samorejestracja na liście podczas aktywacji
public class Enemy : MonoBehaviour 
{
    // Współdzielona lista statyczna, ponownie wykorzystuje pamięć bez nowych alokacji
    public static readonly List<Enemy> ActiveEnemies = new();

    void OnEnable()  => ActiveEnemies.Add(this);
    void OnDisable() => ActiveEnemies.Remove(this);
}

// W dowolnym miejscu gry wymagającym dostępu:
// Użyj bezpośrednio Enemy.ActiveEnemies — dziesiątki razy szybsze niż Find i całkowicie 0 GC Alloc!
```

### **Metoda 4: Opakowanie kodu dyrektywą `#if UNITY_EDITOR` dla narzędzi Edytora**
Czasami pobierasz wtyczkę z Asset Store (na przykład system animacji lub narzędzie UI), która zawiera `Resources.FindObjectsOfTypeAll`. Zazwyczaj te wywołania służą wyłącznie do obsługi pomocniczych przycisków w środowisku programistycznym (Edytorze).

Aby zapobiec „przedostaniu się” tych funkcji do finalnej wersji gry (Build Player) i wywoływaniu ostrzeżeń, możesz opakować je dyrektywą preprocesora `#if UNITY_EDITOR`. Kod wewnątrz zostanie całkowicie usunięty podczas eksportowania gry.

```csharp
#if UNITY_EDITOR 
// Ten fragment kodu działa tylko podczas pracy w Edytorze Unity
// Zostanie całkowicie usunięty przy budowaniu do pliku .exe, .apk
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    if (reOfType != null) return reOfType.ToList();
    return null;
}
#endif 
```

---

## **3. Praktyczne Przykłady: Kompleksowe Rozwiązanie w Projekcie Gry**

Aby dobrze zrozumieć zastosowanie w praktyce, przeanalizujmy 2 najczęstsze scenariusze, w których Unity Project Auditor lub Profiler zgłasza ostrzeżenia o śmieciach w pamięci pochodzących z zewnętrznych pakietów assetów:

### **Scenariusz 1: System lokalizacji UI nieustannie skanuje RAM przy każdej zmianie języka**
* **Problem**: Za każdym razem, gdy trzeba wyświetlić tekst w UI lub odtworzyć dźwięk interfejsu, funkcja pomocnicza wywołuje `Resources.FindObjectsOfTypeAll(typeof(UIManager))[0]`. Powoduje to, że każda interakcja otwierająca menu skanuje cały RAM i tworzy śmieciową tablicę na stercie.
* **Rozwiązanie**:
  1. Użyć `FindAnyObjectByType<UIManager>()`, aby wyszukać obiekt tylko raz podczas inicjalizacji (`Awake`).
  2. Utworzyć statyczną właściwość `SharedUIManager` do buforowania referencji (cache), zamieniając operację wyszukiwania w natychmiastowy dostęp $O(1)$ przy **0 bajtach śmieci**.

```csharp
// ❌ PRZED OPTYMALIZACJĄ: Skanuje całą pamięć i tworzy śmieci przy każdym wywołaniu
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetLocalizedText(tableID, tableKey);
}

// ✅ PO OPTYMALIZACJI: Wykorzystanie statycznego cache (Zero GC Alloc)
public class LocalizationManager : MonoBehaviour 
{
    public static LocalizationManager instance;
    public UIManager UIManagerAsset;

    // Szybki dostęp z pamięci podręcznej dla całej gry
    public static UIManager SharedUIManager => instance != null ? instance.UIManagerAsset : null;

    void Awake() 
    {
        instance = this;
        // Użyj API Unity 6, aby wyszukać tylko raz, bez alokacji tablicy
        if (UIManagerAsset == null) 
            UIManagerAsset = FindAnyObjectByType<UIManager>(); 
    }
}

// Wszędzie tam, gdzie potrzebny jest tekst, wystarczy odwołać się przez Cache:
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = LocalizationManager.SharedUIManager;
    return tempUIM != null ? tempUIM.GetLocalizedText(tableID, tableKey) : null;
}
```

---

### **Scenariusz 2: Narzędzia Edytora firm trzecich przedostają się do kompilacji gry**
* **Problem**: Wiele pakietów narzędziowych (takich jak systemy animacji czy projektowania poziomów) ma wbudowane funkcje wyszukiwania zasobów `Resources.FindObjectsOfTypeAll` wspierające przyciski Reset lub Setup w Edytorze. Nawet jeśli rozgrywka w ogóle ich nie wywołuje, pozostawienie tego kodu jawnie w kodzie źródłowym runtime sprawia, że Unity oznacza kompilację gry (Player Build) ostrzeżeniami GC Alloc.
* **Rozwiązanie**: Opakować cały blok kodu wyszukującego dyrektywą preprocesora `#if UNITY_EDITOR`. Gdy zbudujesz grę do pliku instalacyjnego (`.exe`, `.apk`), Unity automatycznie wytnie te linie kodu ze środowiska uruchomieniowego.

```csharp
// ❌ PRZED OPTYMALIZACJĄ: Kod wyszukiwania zasobów Edytora pozostaje widoczny w Runtime
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}

// ✅ PO OPTYMALIZACJI: Opakowano dyrektywą preprocesora #if UNITY_EDITOR
#if UNITY_EDITOR
// Ten blok kodu istnieje tylko w Edytorze Unity, zostaje w 100% usunięty przy budowaniu gry
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}
#endif
```

---

## **Podsumowanie**

Dla osób rozpoczynających pracę z Unity „śmieci pamięciowe” (GC Allocation) są pojęciem dość abstrakcyjnym, ponieważ C# wykonuje czyszczenie automatycznie. Jednak w programowaniu gier ciągłe generowanie śmieci prowadzi do przycięć wyraźnie widocznych na ekranie.

Złota zasada: **Trzymaj się z dala od rodziny funkcji `Find` (zwłaszcza `Resources.FindObjectsOfTypeAll`) w pętlach takich jak `Update()` czy często wywoływanych zdarzeniach.** Dawaj pierwszeństwo referencjom przez Inspektor, wykorzystuj buforowanie (Cache / Singleton), przejdź na standardowe API Unity 6 (`FindAnyObjectByType`) i zabezpieczaj narzędzia pomocnicze Edytora dyrektywą `#if UNITY_EDITOR`. Dbanie o te drobne detale pomoże Twojej grze utrzymać stabilne 60 FPS na każdym urządzeniu!
