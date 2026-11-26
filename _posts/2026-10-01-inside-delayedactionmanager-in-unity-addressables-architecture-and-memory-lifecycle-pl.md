---
title: "Szczegółowy Raport Techniczny: Mechanizm Działania, Architektura Systemu i Wpływ DelayedActionManager w Środowisku Unity Addressables"
date: 2026-10-01 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, addressables, memory-management, async, delayedactionmanager, optimization]
description: Dogłębna analiza architektury ComponentSingleton klasy DelayedActionManager w Unity Addressables, mechanizmu wykonywania w LateUpdate, wyjątków proxy C#/C++ oraz strategii optymalizacji pamięci AssetBundle.
lang: pl
translation_id: unity-addressables-delayedactionmanager
---

System Addressable Asset System (w skrócie Addressables) stanowi przełomowy krok architektoniczny w Unity, oferując elastyczne, wydajne i zoptymalizowane rozwiązanie do zarządzania zasobami oparte na tradycyjnych AssetBundles[^1]. Podczas projektowania i utrzymywania dużych gier lub interaktywnych aplikacji zarządzanie asynchronicznym przepływem danych w celu automatycznego ładowania i zwalniania zasobów jest wymogiem kluczowym. Jednym z głównych komponentów realizujących to złożone zadanie — choć często budzącym konsternację u inżynierów oprogramowania analizujących hierarchię (Hierarchy) — jest automatycznie tworzony obiekt o nazwie DelayedActionManager, znajdujący się w scenie DontDestroyOnLoad[^2].

Niniejszy raport techniczny stanowi kompleksową analizę architektury DelayedActionManager, wyjaśniającą przyczynę jego istnienia w przestrzeni DontDestroyOnLoad, badającą mechanizm jego wykonywania wewnątrz pętli czasu rzeczywistego silnika Unity oraz omawiającą wyzwania związane z zarządzaniem pamięcią, wyciekami pamięci (memory leaks) i typowymi wyjątkami wątkowymi lub cyklu życia. Poprzez analizę założeń projektowych systemu oraz sprawdzonych praktyk dokument ten dostarcza wiedzy pomagającej architektom oprogramowania maksymalizować stabilność aplikacji.

## Ewolucja Systemu Ładowania Zasobów i Podstawy Asynchroniczności

Przed zagłębieniem się w mikroarchitekturę DelayedActionManager niezbędne jest zrozumienie kontekstu powstania systemu Addressables. W starszych wersjach Unity programiści polegali zazwyczaj na folderze Resources lub bezpośrednio korzystali z surowych skryptów AssetBundle[^4]. Mechanizm `Resources.Load()` działa podobnie do ręcznego wejścia do magazynu: wymaga dokładnej ścieżki katalogu i wymusza zamrożenie (zablokowanie) głównego wątku wykonawczego (main thread), dopóki zasób nie zostanie odnaleziony i wczytany do pamięci[^4]. Wadą tego podejścia jest blokowanie skalowalności aplikacji oraz wywoływanie poważnych spadków liczby klatek na sekundę (FPS drop) przy przetwarzaniu dużych zbiorów danych.

Aby rozwiązać ten problem, Addressables działa niczym nowoczesna usługa logistyczna. Programista musi jedynie podać identyfikator zasobu (address/key), a system automatycznie wyznacza trasę, aby pobrać zasób z pamięci lokalnej (Local) lub ściągnąć go z serwerów sieci dostarczania treści (CDN - Content Delivery Network)[^4]. Co najważniejsze, cały ten cykl odbywa się asynchronicznie (asynchronous). Wywołanie ładujące, jak choćby `Addressables.LoadAssetAsync`, nie zwraca obiektu natychmiast, lecz uchwyt sterujący o nazwie `AsyncOperationHandle`[^4]. Interfejs ten udostępnia mechanizm wywołania zwrotnego (callback), gdy zasób jest już gotowy, pozwalając głównemu wątkowi aplikacji nieprzerwanie przetwarzać logikę fizyki i grafiki[^4].

Przejście z modelu synchronicznego na w pełni asynchroniczny pociąga za sobą poważne wyzwanie architektoniczne: gdy proces pobierania zasobu trwa kilka sekund z powodu wolnego łącza sieciowego, aplikacja może już zdążyć przejść do zupełnie innej sceny (scene)[^1]. Zarządzanie funkcjami zwrotnymi (callbacks), kolejkami zadań (command queues) i licznikami odwołań (reference counting) wymaga centralnej jednostki nadzorującej, odpornej na cykl tworzenia i niszczenia zwykłych scen. Właśnie dlatego twórcy Unity wbudowali model sceny DontDestroyOnLoad w sam rdzeń Addressables.

## Scena DontDestroyOnLoad (DDOL) i Architektura Globalnej Trwałości

W środowisku Unity operacja załadowania nowej sceny (poprzez `SceneManager.LoadScene` w domyślnym trybie Single) automatycznie uruchamia mechanizm czyszczenia pamięci. Silnik niszczy (destroy) wszystkie obiekty GameObject oraz Component należące do poprzedniej sceny, aby zapewnić zwolnienie nieużywanych zasobów[^7]. Mimo że ładowanie addytywne scen (Additive scenes) pozwala utrzymywać wiele aktywnych scen równolegle w celu zarządzania stanem globalnym (na przykład jedną scenę dedykowaną dla Game Managera i drugą dla poziomu), mechanizm DontDestroyOnLoad (DDOL) nadal odgrywa kluczową rolę systemową w ochronie obiektów niskiego poziomu[^7].

Pojawienie się sceny DontDestroyOnLoad w interfejsie Edytora Unity po naciśnięciu przycisku Play nie jest błędem, lecz domyślnym, ukrytym mechanizmem silnika grupującym obiekty oznaczone jako niepodlegające zniszczeniu przy ładowaniu sceny[^9]. Aby obiekt GameObject został przyjęty do tej bezpiecznej strefy, Unity narzuca bezwzględną regułę: obiekt musi znajdować się na poziomie głównym (root level) hierarchii sceny[^8]. Każda próba wywołania funkcji `DontDestroyOnLoad(gameObject)` na obiekcie podrzędnym (nested object) zakończy się niepowodzeniem i zapisaniem ostrzeżenia[^8].

W przypadku systemu Addressables operacje ładowania i zwalniania zasobów mają cykl życia rozciągający się na wiele różnych scen. Przykładowo śledzenie postępu pobierania AssetBundle ze zdalnego serwera nie może zostać przerwane w połowie tylko dlatego, że gracz przeszedł przez portal zmiany poziomu. Zastosowanie mechanizmu `RuntimeInitializeOnLoadMethod` w połączeniu z zaawansowanym wzorcem Singleton pozwala kodowi źródłowemu Addressables automatycznie utworzyć obiekt główny i umieścić go w scenie DDOL natychmiast po uruchomieniu aplikacji[^2]. Wyjaśnia to, dlaczego nawet wtedy, gdy programista nie napisze ani jednej linijki kodu związanej z DDOL, w lewym dolnym rogu listy scen nadal automatycznie pojawia się obiekt o nazwie „DelayedActionManager”[^2].

## Wewnętrzna Struktura i Rola Techniczna DelayedActionManager

Dogłębna analiza kodu źródłowego oraz dokumentacji API pakietu Addressables pokazuje, że DelayedActionManager jest konkretną klasą (concrete class) w przestrzeni nazw `UnityEngine.ResourceManagement.Util`[^11]. Jej konstrukcja nie jest zwykłą statyczną klasą narzędziową (static utility class), lecz komponentem przypinanym bezpośrednio do obiektu GameObject poprzez dziedziczenie po bazowej architekturze[^12].

### Wzorzec ComponentSingleton i Automatyzacja Inicjalizacji

Architektura DelayedActionManager opiera się na wzorcu projektowym ComponentSingleton — klasie bazowej zdefiniowanej w tej samej przestrzeni nazw[^13]. Zastosowanie wzorca Singleton na komponencie (Component) zamiast w czystej klasie C# zapewnia systemowi możliwość bezpośredniej interakcji z pętlą zdarzeń czasu rzeczywistego w Unity (PlayerLoop).

Gdy system ResourceManager po raz pierwszy otrzymuje żądanie ładowania lub aktualizacji stanu (np. `Addressables.LoadAssetAsync` lub operacje diagnostyki sieciowej), odwołuje się do instancji DelayedActionManager. W tym momencie wzorzec ComponentSingleton automatycznie realizuje ukrytą procedurę obejmującą: utworzenie pustego obiektu GameObject, nadanie mu nazwy „DelayedActionManager”, dołączenie odpowiedniego skryptu oraz natychmiastowe wywołanie `DontDestroyOnLoad` w celu przeniesienia go do globalnej przestrzeni ochronnej[^2]. Ta leniwa inicjalizacja (lazy initialization) gwarantuje, że zasoby systemowe są zużywane wyłącznie wtedy, gdy zarządzanie zadaniami opóźnionymi jest faktycznie wymagane, co wyjaśnia częste pytania programistów o „magiczne” pojawianie się tego obiektu w interfejsie[^3].

### Analiza Mechanizmu Harmonogramowania i Fazy LateUpdate

Kluczowym zadaniem DelayedActionManager jest pełnienie roli centralnego planisty (central scheduler) dla opóźnionych działań, funkcji zwrotnych (callbacks), korutyn (coroutines) oraz zarządzania pamięcią na poziomie mikro[^11]. Subtelnym, lecz niezwykle ważnym elementem jego architektury jest fakt, że cała logika przetwarzania kolejek jest kierowana do wykonania wewnątrz funkcji `LateUpdate()` cyklu życia Unity[^11].

Wybór projektowy ukierunkowany na `LateUpdate` zamiast tradycyjnego `Update` rozwiązuje głęboki problem architektoniczny związany ze spójnością danych. Poniższa tabela przedstawia kolejność wykonywania w Unity oraz rolę fazy `LateUpdate` w ochronie danych Addressables.

| Faza Wykonania (PlayerLoop) | Typowe Funkcje | Rola względem Addressables i DelayedActionManager |
| :--- | :--- | :--- |
| **FixedUpdate** | Przetwarzanie symulacji fizyki, kolizji statycznych i dynamicznych. | Logika gry może wyzwalać żądania zniszczenia obiektów po kolizji. |
| **Update** | Wejście gracza (Input), ruch, logika AI, aktualizacja stanu gry. | Funkcje `Addressables.LoadAssetAsync` lub `Release` są wywoływane ręcznie. Obiekty GameObject mogą zostać tu zniszczone przez `Destroy()`. |
| **LateUpdate** | Aktualizacja pozycji kamery, korekcje post-processingu. | DelayedActionManager czyści pamięć, aktualizuje liczniki odwołań i wywołuje asynchroniczne callbacki, aby uniknąć kolizji z poleceniami niszczenia z fazy `Update`[^11]. |

Gdyby system ResourceManager wykonywał callbacki zakończenia zadania natychmiast w trakcie fazy `Update`, istniałoby wysokie ryzyko wejścia w interakcję z podsystemem (np. graficznym lub interfejsu użytkownika) znajdującym się w stanie pośrednim, przed zakończeniem obliczeń bieżącej klatki. Poprzez opóźnienie (delaying) wywołań funkcji OnComplete oraz operacji zmniejszania liczników odwołań (ref-count decrements) aż do `LateUpdate()`, DelayedActionManager gwarantuje, że cały stan logiczny bieżącej klatki został ustabilizowany[^11]. Dane z licznych raportów śledzenia stosu wywołań (stack traces) pokazują, że `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` jest ostatnim etapem pośrednim przed przekazaniem sterowania z powrotem do kodu użytkownika[^15].

## Analiza Wyjątków Systemowych (System Exceptions) i Śladów Stosu (Stack Traces)

Mimo wysokiego poziomu bezpieczeństwa w projekcie, złożoność mechanizmów asynchronicznych w połączeniu z nieprawidłowym zarządzaniem cyklem życia po stronie programisty często stawia DelayedActionManager w centrum poważnych wyjątków. Raporty błędów dostarczają istotnych wskazówek dotyczących tego, jak system współpracuje z pamięcią zarządzaną (managed memory) oraz pamięcią natywną (native memory).

### Błąd NullReferenceException i Konflikt Cyklu Życia Proxy C# - C++

Bardzo częstym scenariuszem awarii w środowisku Addressables jest wystąpienie wyjątku `ArgumentNullException: Value cannot be null. Parameter name: obj` generowanego z poziomu metody `StartCoroutine_Auto` klasy DelayedActionManager[^19]. Błąd ten nie jest wewnętrzną usterką Unity, lecz wynika z rozbieżności między mechanizmem odśmiecania pamięci w C# (Garbage Collector) a zarządzaniem natywnymi wskaźnikami kodu C++ pod spodem[^19].

W Unity obiekty takie jak GameObject czy MonoBehaviour są w rzeczywistości klasami pośredniczącymi (proxy classes) napisanymi w C#, przechowującymi wewnętrzne odwołanie wskazujące na natywny obiekt zaalokowany w C++ wewnątrz silnika[^19]. Gdy programista wywołuje polecenie `Destroy(gameObject)`, obiekt C++ zostaje natychmiast zniszczony, a jego obszar pamięci zwolniony, co sprawia, że wewnętrzne odwołanie staje się wartością null[^19]. Jednakże obiekt proxy w C# może nadal istnieć w pamięci zarządzanej (managed memory) przez pewien czas, dopóki nie przeskanuje jej Garbage Collector[^19].

Katastrofa następuje wtedy, gdy programiści używają wyrażeń anonimowych (lambdas/closures) w połączeniu z asynchronicznymi procesami Addressables. Wyrażenie lambda ma właściwość „przechwytywania” (capture) otaczających je zmiennych kontekstowych. Rozważmy poniższy wzorzec kodu:

```csharp
// Akcja dodana do kolejki DelayedActionManager
DelayedAction(null, () => {
    _crawlerRobot.BreakAwayLowerBody();
    if (isLevelLoad) {
        PhysicsUtil.ManualSimulation(2);
    }
});
```

Podczas wykonania tego kodu zmienna `_crawlerRobot` (będąca proxy C#) zostaje przechwycona przez domknięcie (closure)[^19]. Jeśli logika gry zniszczy `_crawlerRobot` jeszcze w tej samej klatce, natywny wskaźnik C++ znika. Ponieważ jednak DelayedActionManager zaplanował uruchomienie tej lambdy w fazie `LateUpdate` (lub w kolejnej klatce), w chwili jej faktycznego wywołania próbuje ona uzyskać dostęp do metody `BreakAwayLowerBody()` martwego wskaźnika C++[^19]. Nieuniknioną konsekwencją jest rzucenie przez system wyjątku `NullReferenceException` lub komunikatu błędu „Obiekt został zniszczony, ale nadal próbujesz uzyskać do niego dostęp”[^19].

Aby wyeliminować to ryzyko architektoniczne, eksperci zalecają dwa rozwiązania projektowe:

1. Unikanie nadużywania zagnieżdżonych wyrażeń lambda (lambdas nesting) podczas obsługi niskopoziomowych zmian stanu[^19].
2. Zawsze wykonywanie bezpiecznego sprawdzania wartości null, wykorzystując fakt, że Unity przeciążyło (overloaded) operator `==` w C# w celu bezpośredniej weryfikacji stanu natywnego wskaźnika C++ pod spodem[^19].

### Konflikty PlayerLoop i Błąd „Assertion failed on expression: ShouldRunBehaviour()”

W trakcie zarządzania wersjami pakietów Addressables wielu programistów zgłaszało zalewanie konsoli Edytora Unity niskopoziomowym komunikatem błędu: `Assertion failed on expression: 'ShouldRunBehaviour()'` w pliku `MonoBehaviour.cpp`[^3].

Ślad stosu (stack trace) wskazuje bezpośrednio, że proces ten pochodzi z obiektu GameObject „DelayedActionManager” znajdującego się w scenie DontDestroyOnLoad[^3]. Analiza przyczyn źródłowych (Root Cause Analysis) ujawnia lukę w obsłudze trybu odtwarzania (Play Mode) w Edytorze Unity. Gdy edytor przechodzi ponowną kompilację domeny (Domain Reload) lub gdy użytkownik zatrzymuje grę (Stop) przed zakończeniem oczekującego procesu ładowania zasobów, DelayedActionManager zostaje uwięziony jako osierocony obiekt (orphaned object)[^3].

Ponieważ oznaczono go jako DontDestroyOnLoad, próbuje nadal wykonywać cykle `LateUpdate` oraz kontrole zachowania (behaviour checks), mimo że natywne środowisko wykonawcze Unity (PlayerLoop) wydało już polecenie zatrzymania wszystkich zadań[^3]. Błąd ten występował najdotkliwiej przy przejściu z pakietu Addressables 1.16.x na 1.18.x, zmuszając wiele zespołów deweloperskich do ręcznego powrotu do wersji 1.17.17 w celu zapewnienia stabilności synchronicznego API i usunięcia blokad kolejki[^3].

### Zmiany Statusu DelayedActionManager w Historii Wersji

Interesującą obserwacją podczas analizy dokumentacji API oraz dzienników zmian (changelogs) Unity Addressables jest cykliczna obecność DelayedActionManager. Wydania takie jak 0.7.5 oraz 1.11.2 wyraźnie ogłaszały w dziennikach aktualizacji refaktoryzację interfejsu skryptów budujących (build script interface) komunikatem: „Removed DelayedActionManager. Removed ISceneProvider. Users can implement custom scene loading”[^20]. Decyzja ta miała początkowo na celu uproszczenie warstwy API i przekazanie kontroli niestandardowej klasie `AsyncOperationBase`[^20].

Jednakże zgłoszenia błędów z wersji po wydaniach LTS (Long-Term Support), takich jak 1.18.15, 1.19.19 oraz 1.21.21, ujawniły ciągły powrót `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` w śladach stosu[^11]. Odzwierciedla to iteracyjną filozofię projektową Unity: po usunięciu w celu uproszczenia inżynierowie systemu dostrzegli, że brak centralnego menedżera zadań opóźnionych tworzy nieprzezwyciężalne trudności w gromadzeniu zdarzeń diagnostycznych (`DiagnosticEventCollector`), obsłudze tabel wstępnego ładowania (preload tables) oraz zapewnieniu bezpieczeństwa pamięci podczas zamykania aplikacji[^11]. DelayedActionManager został przeprojektowany i przywrócony jako wewnętrzne narzędzie systemowe — niewidoczne już w publicznym interfejsie użytkownika, lecz odpowiedzialne za obsługę ryzyka zwalniania zasobów (disposal) przy wyłączaniu aplikacji[^20].

## Mechanizm Zliczania Odwołań i Dynamika Wycieków Pamięci

Istnienie DelayedActionManager jest nierozerwalnie związane z jednym z najbardziej złożonych filarów Addressables: Systemem Zarządzania Pamięcią (Memory Management). W przeciwieństwie do polegania wyłącznie na Garbage Collectorze, Addressables kontroluje obecność danych w pamięci RAM poprzez mechanizm Zliczania Odwołań (Reference Counting)[^23].

### Dynamika Odwołań i Hierarchia Zależności

Ilekroć system otrzyma żądanie załadowania zasobu, licznik odwołań tego zasobu zostaje zwiększony o jeden (increment). Po zakończeniu korzystania polecenie `Addressables.Release` nakazuje systemowi zmniejszenie tego licznika (decrement)[^23]. Złota zasada głosi, że pamięć fizyczna przechowująca zasób może zostać zwolniona wyłącznie wtedy, gdy licznik odwołań powróci do bezwzględnej wartości 0[^23].

Złożoność rośnie wykładniczo, ponieważ Addressables zarządza zależnościami poprzez architekturę AssetBundle. Podczas ładowania zasobu (np. materiału — Material) system ładuje nie tylko sam materiał, lecz automatycznie wczytuje wszystkie AssetBundles zawierające jego składniki zależne (np. tekstury — Texture)[^25]. Graf zależności (dependency graph) obliczany jest na poziomie Bundle, co oznacza, że jeśli zasób w Bundle A odwołuje się do zasobu w Bundle B, cały Bundle B musi zostać wczytany do pamięci hosta[^26].

Najbardziej rygorystycznym ograniczeniem technicznym Unity w tej architekturze jest zasada: **Użytkownik nie może częściowo zwolnić (partially unload) zawartości jednego AssetBundle**[^23]. Dla jasności rozważmy AssetBundle o nazwie „stuff” zawierający trzy niezależne zasoby: Drzewo, Czołg i Krowa[^23].

1. Gdy zasób Drzewo zostanie załadowany, narzędzie do analizy pamięci (Profiler) pokazuje jedno odwołanie dla Drzewa oraz jedno odpowiadające mu odwołanie dla paczki `stuff`[^23].
2. Gdy następnie załadowany zostanie zasób Czołg, licznik Czołgu wzrasta, a licznik paczki `stuff` rośnie do 2[^23].
3. Jeśli gra wykona polecenie `Release(Drzewo)`, licznik Drzewa spada do 0, a niebieski pasek w Profilerze znika[^23].
4. Mimo to fizyczne dane Drzewa pozostają nienaruszone w pamięci systemu. Ponieważ Czołg nadal utrzymuje połączenie sprawiające, że licznik AssetBundle `stuff` jest większy od 0, żaden zasób z tej paczki nie może zostać usunięty, dopóki cała paczka nie zostanie całkowicie zwolniona[^23].

### Syndrom „Asset Churn” i Rozrost Pamięci (Memory Bloat)

Zjawisko polegające na ciągłym ładowaniu zasobów, ich zwalnianiu, a następnie natychmiastowym ponownym wczytywaniu w krótkim odstępie czasu definiuje się jako „Asset Churn” (agresywna rotacja zasobów)[^23]. Luka ta często pojawia się podczas przechodzenia między poziomami (levels). Jeśli Poziom 1 używa zasobu Łódź, a Poziom 2 używa zasobu Samolot (oba współdzielą teksturę Kamuflaż). Przy wyjściu z Poziomu 1 programista zwalnia Łódź, co powoduje, że system Addressables natychmiast usuwa teksturę Kamuflaż z pamięci. Milisekundę później, gdy Poziom 2 inicjuje Samolot, system zmusza dysk twardy do ponownego wykonania cyklu I/O w celu wczytania tej samej tekstury Kamuflaż od początku[^23]. Proces ten generuje gwałtowne skoki (spikes) czasu trwania klatki i wypycha zużycie pamięci ku niebezpiecznym progom, szczególnie na urządzeniach mobilnych[^27].

Ponadto pominięcie wywołania `Release` prowadzi do gromadzenia się zbędnych odwołań, powodując, że zajętość RAM rośnie z setek megabajtów do gigabajtów w ciągu zaledwie kilku zmian scen[^28]. Ponieważ ani DelayedActionManager, ani samo Addressables nie śledzi liczby instancji utworzonych czystą metodą `Instantiate` klasy MonoBehaviour, każdy błąd w śledzeniu uchwytów pamięci doprowadzi do trwałego wycieku pamięci[^6].

### Architektura Kompresji Danych i Presja Alokacji Pamięci

Rozmiar AssetBundles oraz metoda kompresji danych wpływają bezpośrednio na sposób, w jaki dane rezydują w pamięci RAM. Wybór metody kompresji decyduje o tym, czy AssetBundle zajmie ogromną ilość pamięci na stałe, czy też umożliwi optymalizację przepustowości.

Tabela zestawiająca właściwości algorytmów kompresji AssetBundle i ich wpływ na pamięć[^29]:

| Algorytm Kompresji | Zdolność Rozpoznawania Plików Lokalnych | Wymóg Załadowania Całego Bundle do RAM | Wpływ na Wydajność i Przechowywanie |
| :--- | :--- | :--- | :--- |
| **LZMA** | Nie. Paczka skompresowana jako jedna całość. | **Tak.** Konieczna dekompresja całego pliku w pamięci. | Najwyższy współczynnik kompresji i mały rozmiar pobierania, ale wywołuje gwałtowny rozrost pamięci (Memory Bloat) oraz intensywne zużycie CPU podczas rozpakowywania[^29]. |
| **LZ4** | Tak. Kompresja blokowa (chunk-based). | **Nie.** Ładuje wyłącznie fragmenty aktualnie odczytywane. | Zalecany jako domyślny standard. Umożliwia buforowanie (caching) bezpośrednio na dysku lokalnym bez ładowania całych metadanych do RAM[^29]. |
| **Uncompressed** | Tak. Niezależny dostęp do każdego zasobu. | **Nie.** Odczyt bezpośredni. | Brak narzutu czasowego na dekompresję, największy rozmiar pliku źródłowego. Optymalny do natychmiastowego ładowania, jeśli pozwala na to przepustowość dysku[^29]. |

Gdy zażądany zostanie drobny zasób z gigantycznego AssetBundle skompresowanego za pomocą LZMA, cały plik (łącznie z nagłówkiem, metadanymi i tabelami strumieniowania) musi zostać przeniesiony z dysku twardego do pamięci RAM[^27]. Ten błąd projektowy zamienia ogromne AssetBundles w tykające bomby zegarowe powodujące awarie z powodu przepełnienia pamięci (OOM crashes) aplikacji[^27].

## Najlepsze Praktyki (Best Practices) w Zarządzaniu Zasobami

Aby opanować złożoność systemu zliczania odwołań i ograniczyć obciążenie nakładane na DelayedActionManager, architekci systemów muszą stosować wyjątkowo rygorystyczną strukturę cyklu życia w połączeniu z technikami optymalizacji zasobów.

### 1. Synchronizacja Cyklu Inicjalizacji i Zwalniania

Każdy obiekt `AsyncOperationHandle` zwracany przez API musi zostać obowiązkowo zwolniony po zakończeniu okresu użycia[^6]. Zaniedbanie tego nie tylko wywołuje wycieki pamięci, ale może również doprowadzić do awarii całego systemu (crashes)[^6]. Poniższa tabela przedstawia obowiązkowe operacje symetryczne w programowaniu z użyciem Addressables:

| Metoda Inicjalizacji / Ładowania | Odpowiadająca Metoda Zwalniania | Wewnętrzny Mechanizm Działania |
| :--- | :--- | :--- |
| `Addressables.LoadAssetAsync` | `Addressables.Release(handle)` | Odejmuje 1 od licznika odwołań zawierającego go AssetBundle[^6]. |
| `Addressables.InstantiateAsync` | `Addressables.ReleaseInstance(gameObject)` | Niszczy wyświetlany obiekt (Instance) i automatycznie odejmuje 1 od licznika oryginalnego Prefabu[^4]. |
| Przypisanie przez `AssetReference` | `reference.ReleaseAsset()` | Analogiczne do wywołania Release przez uchwyt; czyści odwołania statyczne[^6]. |

W szczególności podczas wykorzystywania obiektów ScriptableObject do przechowywania ustawień gry bezpośrednie odwołanie do obiektu (`public Object _worldAsset`) tworzy twarde odwołania (hard references), zmuszając system do natychmiastowego wczytania tego zasobu do pamięci RAM[^27]. Optymalnym rozwiązaniem jest zastosowanie AssetReference (`public AssetReference addressableAsset;`) w celu asynchronicznego ładowania na żądanie (on-demand loading)[^6].

### 2. Interwencja Niskopoziomowa: Resources.UnloadUnusedAssets()

W sytuacji bez wyjścia, gdy współdzielone AssetBundles pozostają zablokowane w pamięci przez zasadę „braku częściowego zwalniania” (np. zasób Drzewo uwięziony razem z Czołgiem), jedyną drogą ratunku jest użycie wymuszającego API z warstwy bazowej silnika: `Resources.UnloadUnusedAssets()`[^25].

Funkcja ta wykonuje głębokie skanowanie całej pamięci RAM systemu w celu wykrycia wszelkich zasobów (w tym ukrytych wewnątrz AssetBundles), których rzeczywista liczba wewnętrznych odwołań silnika (actual engine references) wynosi dokładnie 0, i wymusza ich zniszczenie[^25]. Jest to jednak operacja niezwykle kosztowna obliczeniowo, wywołująca poważne spadki liczby klatek (FPS drops), ponieważ CPU musi wstrzymać wątek logiczny na czas przeprowadzania procesu czyszczenia[^27]. Inżynierowie powinni uruchamiać ją wyłącznie podczas dużych ekranów ładowania (loading screens) albo pozwolić systemowi na automatyczne wywołanie jej przy zmianie sceny za pomocą `SceneManager.LoadScene`[^29].

### 3. Planowanie i Segmentacja AssetBundles (Bundle Packing Modes)

Organizacja struktury grup (Groups) w panelu konfiguracji Addressables bezpośrednio decyduje o wydajności ładowania pamięci oraz przepustowości pobierania. Dobór trybu pakowania (Bundle Mode) odpowiedniego do rodzaju zasobu to kluczowy krok projektowy[^6]:

* **Pack Together (Pakowanie Łączne)**: Stosowane dla zasobów o ściśle powiązanym cyklu życia, które zawsze pojawiają się jednocześnie. Minimalizuje to koszt analizy grafu zależności oraz sieciowych operacji I/O[^6].
* **Pack Separately (Pakowanie Osobne)**: Optymalne dla ogromnych, niezależnych zasobów lub dużych map, w przypadku których nie można zagwarantować wspólnego ładowania. Eliminuje ryzyko, że duży zasób zablokuje zwolnienie mniejszych zasobów[^6].
* **Pack Together By Label (Pakowanie Według Etykiet)**: Pozwala łączyć rozproszone zasoby za pomocą metadanych etykiet (np. przypisanie etykiety „Halloween 2023” w celu zgrupowania całej zawartości wydarzenia w jednym bundle i łatwej aktualizacji przez CDN)[^6].

Aby jeszcze mocniej zredukować ciężar spisu zawartości (TypeTree) w AssetBundle, programiści mogą włączyć opcję `BuildAssetBundleOptions.DisableWriteTypeTree`. Funkcja ta usuwa nadmiarowe metadane, jednak wymaga ponownego zbudowania lokalnych grup (rebuild local groups) przed wyeksportowaniem pliku wykonywalnego[^26].

### 4. Zarządzanie Pamięcią Dźwięku i Grafiki (Graphics & Audio)

Optymalizacja warstw pomocniczych to najskuteczniejszy sposób na zmniejszenie częstotliwości pracy odśmiecacza pamięci. Konfiguracja sposobu ładowania strumieni audio bezpośrednio wpływa na pamięć[^27]:

* **Długa muzyka w tle (BGM)**: Należy skonfigurować tryb Streaming, aby ładować z dysku kolejne niewielkie bufory[^27].
* **Długie efekty dźwiękowe**: Wybrać Compressed In Memory, aby przechowywać je w stanie skompresowanym w RAM i dekompresować w czasie rzeczywistym podczas odtwarzania[^27].
* **Krótkie lub częste efekty dźwiękowe**: Zastosować Decompress On Load, aby mieć bezpośrednio gotowe nieskompresowane dane i wyeliminować narzut CPU[^27].

Ponadto wyłączenie opcji „Read/Write enabled” na teksturach oraz ustawienie pominięcia bufora głębi (Depth Stencil Format na None) dla kamer interfejsu użytkownika (UI) pozwoli ograniczyć zbędne zużycie pamięci RAM renderowania o co najmniej 50%[^27].

## Podsumowanie Globalnej Interakcji

Analiza działania DelayedActionManager nie tylko wyjaśnia pochodzenie ukrytego obiektu w scenie DontDestroyOnLoad, lecz także odsłania podstawową filozofię projektową systemu Addressables w Unity. Ta klasa ComponentSingleton pełni rolę subtelnego pomostu czasowego, chroniąc integralność danych poprzez kierowanie procesów zwalniania, wywołań asynchronicznych oraz obsługi buforów do cyklu LateUpdate. Izoluje zmiany w strukturze pamięci od zakłóceń mogących wynikać z kodu fizyki lub logiki sterowania w pętli Update, tworząc tarczę przed wyjątkami uszkadzającymi system przy przejściach między scenami.

DelayedActionManager nie jest jednak magiczną różdżką zdolną rozwiązać wrodzone słabości architektury zarządzania pamięcią. Stawia przed architektami oprogramowania surowe wymagania w zakresie utrzymywania całkowicie symetrycznego cyklu ładowania i zwalniania zasobów, projektowania wyrażeń anonimowych w C# (lambdas) unikających pętli przechwytujących natywne obiekty C++ oraz modularyzacji struktury AssetBundle w celu zapobiegania uporczywym wyciekom pamięci. Dzięki dogłębnemu zrozumieniu trasowania ładowania asynchronicznego, rozsądnemu stosowaniu metod kompresji takich jak LZ4 oraz wykorzystaniu wymuszającej siły `Resources.UnloadUnusedAssets`, zespoły programistyczne mogą budować solidne architektury o wysokiej skalowalności na każdej platformie bez obawy o trwałe wyczerpanie zasobów.

## **Bibliografia**

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

### Dalsza lektura

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
