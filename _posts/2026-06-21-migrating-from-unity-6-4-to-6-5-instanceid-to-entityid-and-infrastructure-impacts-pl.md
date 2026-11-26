---
title: "Pogłębiona Analiza Techniczna: Proces Migracji Platformy z Unity 6.4 do 6.5 oraz Wpływ na Infrastrukturę"
date: 2026-06-21 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, entityid, instanceid, ecs, coreclr, serialization, urp, rendering]
description: Szczegółowa analiza procesu aktualizacji z Unity 6.4 do 6.5, skupiająca się na przejściu z InstanceID na EntityId, usunięciu przestarzałych API, zarządzaniu cyklem życia Edytora i zmianach w potoku graficznym.
lang: pl
translation_id: unity-6-4-to-6-5-migration-entityid
math: true
---

Transformacja infrastruktury programistycznej z wersji Unity 6.4 (`6000.4`) do Unity 6.5 (`6000.5`) stanowi przełomowy kamień milowy w rozwoju platformy Unity Engine. W przeciwieństwie do rutynowych aktualizacji serwisowych, Unity 6.5 pełni rolę wydania o kluczowym znaczeniu architektonicznym, budując solidne fundamenty techniczne pod wdrożenie maszyny wirtualnej CoreCLR oraz realizację długofalowej wizji „ECS for All” (Entity Component System dla wszystkich obiektów)[^1]. Niniejszy raport w sposób systematyczny analizuje techniczne przyczyny źródłowe każdej zmiany — od przestrzeni identyfikatorów, zarządzania pamięcią i sieciowych protokołów transportowych po potoki renderowania dla wbudowanego sprzętu graficznego. Celem opracowania jest dostarczenie kompleksowej mapy drogowej refaktoryzacji kodu źródłowego oraz ograniczenie ryzyka operacyjnego w projektach na dużą skalę.

## **1. Przebudowa Systemu Identyfikacji: Wycofanie Dziedzictwa `InstanceID` i Era `EntityId`**

Najbardziej rewolucyjną zmianą naruszającą strukturę kodu źródłowego w tej aktualizacji jest całkowite wycofanie tradycyjnego systemu identyfikacji `InstanceID` na rzecz nowoczesnego typu danych `EntityId`[^1]. Przez całą historię silnika `InstanceID` miał postać 32-bitowej liczby całkowitej ze znakiem (`int`), działającej jako statyczny wskaźnik indeksu (index lookup) w natywnej tablicy mieszającej obiektów C++. Jednak wobec rygorystycznych wymagań stosu technologicznego zorientowanego na dane (Data-Oriented Technology Stack - DOTS) oraz wielowątkowego rozproszenia obiektów w przestrzeni pamięci, limit 32 bitów przestał gwarantować unikalność, otwierając drogę do wyjątkowo niebezpiecznych błędów odwołań krzyżowych.

### **Układ Fizyczny i Upadek Dotychczasowych Założeń Dotyczących Danych**

Począwszy od wersji 6.5, wywoływanie interfejsów API powiązanych z `InstanceID` (takich jak metoda `GetInstanceID()`) jest natychmiast oznaczane przez kompilator jako błąd kompilacji (compile error), kończąc okres ostrzeżeń o przestarzałości (obsolete warning) znany z wcześniejszych wydań[^2]. Nowy typ danych `EntityId` zaprojektowano jako monolityczną strukturę 8-bajtową (64-bitową), obejmującą 4-bajtową partycję indeksu (index) oraz 4-bajtowy znacznik wersji (version stamp). Taki podział jest architektonicznym majstersztykiem całkowicie eliminującym klasyczny problem ABA w teorii zarządzania pamięcią: gdy encja zostaje zniszczona, a nowa encja ponownie wykorzystuje dawny indeks w bloku pamięci (chunk memory), znacznik wersji ulega zmianie, przez co wszelkie wiszące referencje (dangling references) przechowujące stary identyfikator otrzymują natychmiastową odmowę dostępu[^3].

Ten rozrost struktury pamięciowej wymaga gruntownej refaktoryzacji wszystkich wzorców zarządzania danymi w projekcie. Każdy fragment kodu stosujący rzutowanie w dół (downcasting) z `EntityId` na `int` za pomocą operatora `(int)entityId` lub wywołania `EntityId.FromULong((ulong)myIntInstanceId)` bezpowrotnie niszczy 4-bajtowy znacznik wersji. Przy próbie odtworzenia takiej struktury silnik odrzuci dostęp i zgłosi wewnętrzny wyjątek `"Unexpected EntityId version value"`[^5].

Jeszcze poważniejszy problem stwarza nawyk używania identyfikatorów jako kluczy (key) w kolekcjach `Dictionary` lub `HashSet`. Wywołanie `GetHashCode()` na 64-bitowej strukturze w środowisku C# automatycznie kompresuje wartość do 32-bitowej liczby całkowitej. Ta stratna, jednokierunkowa kompresja łamie zasadę unikalności (uniqueness), narażając system na gwałtowny wzrost kolizji hashy (hash collisions). W dużych projektach gier może to prowadzić do błędnego rozpoznawania obiektów, skutkując przeniesieniem stanu na niewłaściwą postać lub zadaniem obrażeń błędnemu celowi[^5]. Analogicznie, w kodzie optymalizującym opóźnienia stosowanie atrybutu `[StructLayout(LayoutKind.Explicit)]` do nakładania obszarów pamięci bądź użycie niebezpiecznych wskaźników (`unsafe`) do konwersji między `int` a identyfikatorem obiektu natychmiast doprowadzi do globalnego uszkodzenia pamięci (memory corruption)[^8].

### **Strategia Naprawcza i Bezpieczna Serializacja Danych**

Aby przejść bramki kompilacji w Unity 6.5, należy oczyścić cały projekt z 32-bitowych założeń liczbowych dotyczących identyfikatorów. Wszystkie wywołania `GetInstanceID()` trzeba jednolicie zastąpić metodą `GetEntityId()`. W przypadku kolekcji `Dictionary` sam typ `EntityId` został zaprojektowany przez zespół Unity tak, aby natywnie służył jako wysokowydajny klucz wyszukiwania bez jakiegokolwiek pośredniego haszowania. Ponadto sprawdzanie pustego identyfikatora za pomocą porównania `== 0` przestaje być prawidłowe; programiści muszą porównywać go z `EntityId.None` lub odpytywać właściwość `IsValid`[^5].

Serializacja (serialization) identyfikatorów na potrzeby zapisu i odczytu plików (Save/Load) czy sieciowych baz danych wymaga szczególnej staranności. Poleganie na `EntityId.ToString()` do zapisu tekstowego i późniejszym parsowaniu przez `int.Parse()` — jak praktykowano w wersji 6.4 — całkowicie uszkodzi dane. Zamiast tego wewnętrzne API udostępnia dwie niskopoziomowe metody: `EntityId.ToULong()` oraz `EntityId.FromULong()`, pozwalające zakodować natywny identyfikator jako 64-bitową wartość binarną bez znaku. Programiści utrzymujący zaplecze sieciowe lub bazy danych NoSQL muszą zmigrować odpowiednie kolumny i pola z typu `INT` na `BIGINT` lub równoważny typ 64-bitowy, aby zachować integralność encji[^8].

## **2. Gruntowne Oczyszczenie z Przestarzałych API i Zamknięcie Luk Pamięci**

Przeprowadzono szeroką reformę wymierzoną bezpośrednio w podstawowe kontrolery klas bazowych `GameObject` i `Component`. Jest to zdecydowany krok Unity mający na celu wykształcenie nawyków programowania zorientowanego na wydajność poprzez całkowite usunięcie wygodnych, lecz zasobożernych akcesorów.

### **Usunięcie Właściwości Szybkiego Dostępu (Auto-Getters)**

Przez ostatnie dwie dekady społeczność programistów przyzwyczaiła się do korzystania ze skrótowych właściwości takich jak `.rigidbody`, `.camera` czy `.collider`, odwołujących się bezpośrednio do komponentów fizyki lub grafiki obiektu. Choć od dawna oznaczano je jako przestarzałe (obsolete) miękkimi ostrzeżeniami, kompilator wciąż pobłażliwie pozwalał na kompilację. Od wersji Unity `6000.5` ta pobłażliwość dobiega końca. Właściwości te całkowicie usunięto z powierzchni języka C# silnika, co oznacza, że nieaktualny kod własny lub pakiety zewnętrzne (Asset Store) natychmiast przerwą budowanie projektu[^8].

Automatyczny aktualizujący kod narzędzia API Updater celowo pomija tę zmianę ze względu na zasadniczy wzrost złożoności czasowej. Wywołanie `.rigidbody` w przeszłości było niemal natychmiastowym odczytem na poziomie C++, podczas gdy zastępująca je metoda `GetComponent<Rigidbody>()` zmusza silnik do przeszukania tablicy komponentów obiektu w czasie $O(n)$. Unity wymusza w ten sposób na programistach ręczne buforowanie referencji (cache references) w metodzie `Awake` zamiast wielokrotnego odpytywania ich w pętli `Update`, które marnuje przepustowość procesora.

Poniższa tabela mapowania przedstawia obowiązkowe zmiany kluczowych interfejsów API, które należy wdrożyć ręcznie[^8]:

| Usunięty Całkowicie Interfejs API | Obowiązkowy Zastępczy Interfejs API | Wpływ na Logikę Podstawową |
| :--- | :--- | :--- |
| `Component.rigidbody` / `GameObject.rigidbody` | `GetComponent<Rigidbody>()` | Nie podlega automatycznej aktualizacji przez API Updater; wymaga ręcznego buforowania referencji. |
| `Component.collider2D` / `Component.collider` | `GetComponent<Collider2D>()` / `GetComponent<Collider>()` | Zapytania przestrzenne fizyki wymagają aktualizacji logiki wyszukiwania komponentów. |
| `Component.audio` / `Component.light` | `GetComponent<AudioSource>()` / `GetComponent<Light>()` | Systemy odtwarzania dźwięku i oświetlenia wymagają ponownego powiązania z bazowym komponentem. |
| `Component.hingeJoint` / `Component.constantForce` | `GetComponent<HingeJoint>()` / `GetComponent<ConstantForce>()` | Ciągłe symulacje sił zawiodą bez ponownego przypisania referencji. |
| `GameObject.active` | `SetActive()` lub `activeInHierarchy` | Wycofano bezpośrednią modyfikację flagi; należy stosować bezpieczne metody dostępu i ustawiania. |
| `GameObject.PlayAnimation(Object)` | `GetComponent<Animation>().Play()` | Odtwarzanie animacji wymaga odwołania się do komponentu maszyny stanów `Animation`. |
| `GameObject.AddComponent(string)` | `GameObject.AddComponent<T>()` | Zakończenie niebezpiecznego ładowania komponentów z napisów na rzecz bezpieczeństwa typów (type safety). |

### **Zablokowanie Niebezpiecznego Klonowania Pamięci przez `MemberwiseClone`**

Obok porządków w API aktualizacja wprowadza niezwykle istotną blokadę bezpieczeństwa pamięci: bezwzględny zakaz wywoływania metody `System.Object.MemberwiseClone()` dla jakiegokolwiek typu dziedziczącego po `UnityEngine.Object`[^12].

Architektura Unity opiera się na modelu podwójnego połączenia: jedna połowa funkcjonuje w zarządzanej przez Garbage Collector przestrzeni C# (Managed), druga zaś spoczywa głęboko w natywnym kodzie C++ (Native). Gdy na obiekcie C# wywołane zostanie płytkie kopiowanie (shallow copy) `MemberwiseClone`, pamięć wiernie duplikuje blok danych otoczki, tworząc dwa niezależne obiekty C# wskazujące ten sam wskaźnik na pojedynczą strukturę danych C++. Gdy jeden z obiektów C# wyjdzie poza zasięg (scope) i zostanie usunięty przez odśmiecacz pamięci, wewnętrzny mechanizm zniszczy natywny obiekt C++. Drugi obiekt C# staje się wtedy „wiszącym wskaźnikiem” (dangling pointer) skierowanym na zwolniony obszar pamięci[^12]. Jeśli pętla gry spróbuje wywołać na nim metodę, cały silnik ulegnie błędowi segmentacji (segmentation fault) i natychmiastowej awarii. Przechwycenie tej metody na poziomie kompilacji gwarantuje spójność danych i wymusza klonowanie obiektów wyłącznie przez `UnityEngine.Object.Instantiate()`.

## **3. Architektura Transportu Sieciowego, Dane w Czasie Rzeczywistym i Protokoły Wieloosobowe**

Warstwa transportowa Unity (`com.unity.transport`), zaprojektowana z myślą o wymagających realiach sieciowych współczesnych gier mobilnych, przechodzi gruntowną standaryzację protokołów w celu podniesienia niezawodności ramek pakietów UDP[^14]. Każdy projekt wieloosobowy oparty na Transport API musi dostosować bazowe parametry konfiguracyjne.

### **Zarządzanie Rozmiarem Pakietów i Kolejkami (Queue Handling)**

Jednym z najtrudniejszych wyzwań przy wdrażaniu trybu wieloosobowego w sieciach komórkowych lub sieciach VPN jest fragmentacja pakietów (packet fragmentation). Gdy wychodzący pakiet UDP przekracza Maksymalną Jednostkę Transmisji (MTU) pośredniczących routerów, zostaje porzucony lub ulega uszkodzeniu strukturalnemu. W Unity 6.5 zestaw `NetworkSettings.WithNetworkConfigParameters` wprowadza nowy parametr `maxMessageSize`, domyślnie ustawiony na bezpieczną wartość **1400 bajtów** (bez nagłówków IP oraz UDP)[^14]. Ujednolicenie tego limitu po stronie serwera i klienta zapewnia bezstratny przepływ danych w trudnych warunkach sieci komórkowych.

Wewnętrzne kolejki pakietów zostały powiększone wykładniczo: domyślny rozmiar kolejki wysyłania (send) oraz odbioru (receive) rośnie z 64 do **512 pakietów**, co pozwala buforom płynnie amortyzować lokalne skoki opóźnień sieciowych (network lag spikes) bez rozłączania graczy[^14]. W przypadku niezawodnego dostarczania sekwencyjnego maksymalny rozmiar okna w `ReliableSequencedPipelineStage` rozszerzono do 64. Włączenie maksymalnego progu zwiększa jednak narzut nagłówka każdego pakietu o 4 bajty, dlatego programiści muszą samodzielnie wyważyć kompromis między niezawodnością a zużyciem przepustowości łącza za pomocą `NetworkSettings.WithReliableStageParameters`[^14].

### **Standaryzacja Struktur Adresowych i Raportowania Błędów**

Obsługa punktów końcowych (Endpoints) została udoskonalona pod kątem bezpieczeństwa i elastyczności. Metoda analizująca `NetworkEndpoint.TryParse` nie rzuca już wyjątków przerywających działanie aplikacji przy próbie parsowania adresów IPv6 na sprzęcie pozbawionym obsługi tego protokołu; zamiast tego dyskretnie zwraca `false` i rejestruje niekrytyczny błąd w logu, zapobiegając trudnym w diagnozie awariom gniazd na fizycznych urządzeniach mobilnych[^14].

Model rodzin protokołów wzbogacono także o wariant `NetworkFamily.Custom`, przydzielający 60 bajtów surowych danych dla niestandardowych punktów końcowych opartych na interfejsie `INetworkInterface` (np. przy symulowanych połączeniach peer-to-peer przez Bluetooth zamiast tradycyjnej sieci IP)[^14]. W przypadku niepowodzenia uzgadniania bezpiecznego połączenia (DTLS/TLS handshake) lub odebrania nieprawidłowego strumienia WebSocket, dwa nowe kody błędów — `AuthenticationFailure` oraz `ProtocolError` — trafiają do systemu raportowania `Error.DisconnectReason`, dostarczając znacznie dokładniejszych danych telemetrycznych dla systemów monitoringu gier na żywo (LiveOps)[^14].

Tabela podsumowująca zmiany wewnętrznych struktur API warstwy transportu:

| Przestarzała Konstrukcja (Przeniesiona do `internal` / Usunięta) | Zastępstwo lub Sposób Naprawy |
| :--- | :--- |
| `SimulatorUtility.Context` | Zmieniono na `internal`; ukrywa mylące szczegóły implementacyjne. |
| `RelayMessageType` | Zmieniono na `internal`; system automatycznie obsługuje protokół warstwy Relay. |
| `ReliableUtility.SharedContext.errorCode` | Kody błędów zintegrowano bezpośrednio z wysokopoziomową metodą `NetworkDriver.EndSend`. |
| `QueuedSendMessage` (Struct) | Całkowicie usunięta z uwagi na brak potrzeby ręcznego zarządzania kolejką UDP. |
| Metody w `SequenceHelpers`, `RandomHelpers` | Zmieniono na `internal`; nie są już udostępniane jako publiczne API. |

## **4. Przygotowanie do Integracji z CoreCLR: Rewolucja Cyklu Życia Edytora**

Środowisko uruchomieniowe Unity znajduje się na zdecydowanym kursie migracji z przestarzałej maszyny wirtualnej Mono na **CoreCLR**, której finalizację zaplanowano na wersję 6.8[^3]. Wprowadzenie CoreCLR to nie tylko aktualizacja języka C# do wersji 14, lecz zmiana całej filozofii kompilacji kodu binarnego oraz ujednolicenie reguł matematycznych. Unity 6.5 odpowiada za zbudowanie bezpiecznych barier ochronnych przed tą fundamentalną zmianą[^3].

### **Pożegnanie z Przeładowaniem Domeny (Domain Reload) i Zagrożenia Zmiennych Statycznych**

Szybkie uruchamianie trybu gry Fast Enter Play Mode (FEPM) staje się fundamentem codziennego środowiska pracy[^3]. Klasyczny mechanizm przeładowania domeny — podczas którego silnik zamraża całą aplikację, czyści lokalną pamięć RAM i zeruje stan wszystkich zmiennych statycznych przy każdym rozpoczęciu testów — będzie stopniowo wygaszany. Wdrożenie modelu Kontekstów Ładowania Zestawów (Assembly Load Contexts - ALC) z CoreCLR radykalnie skraca czas pętli iteracji (iteration time), ale niesie ze sobą ogromny efekt uboczny: **stan wszystkich zmiennych statycznych, obiektów Singleton i wewnętrznych struktur pamięci podręcznej pozostaje nienaruszony między kolejnymi przeładowaniami kodu.**

Jeśli projekt śledzi aktywnie wygenerowane obiekty na ekranie w `static List<Enemy>`, to po wyjściu z trybu Play Mode i ponownym uruchomieniu dawne dane nadal będą tam obecne, prowadząc do dziwacznych błędów logicznych, takich jak zawyżone liczniki postaci, wycieki pamięci i wiszące referencje. Ponadto niskopoziomowe pule buforów takie jak `System.Buffers.MemoryPool<T>` nie czyszczą automatycznie swojej zawartości po zwrocie do puli, co wymusza na programistach ręczne zerowanie całego bloku pamięci przed ponownym użyciem[^4].

### **Zarządzanie Stanem przez Nowe Interfejsy API Cyklu Życia Edytora**

Aby opanować kryzys stanu statycznego, Unity 6.5 wprowadza w pełni symetryczne, oparte na atrybutach **API Cyklu Życia Edytora (Editor Lifecycle APIs)**, gdzie każdemu zdarzeniu inicjalizacji odpowiada analogiczne zdarzenie czyszczące[^3]. Rozwiązanie opiera się na dwóch głównych mechanizmach:

1. **Automatyczne Czyszczenie:** Opatrzenie klasy zawierającej pola lub właściwości statyczne atrybutem `[AutoStaticsCleanup]`. Wewnętrzne generatory kodu źródłowego Unity (Source Generators) natychmiast ingerują w kompilację, wstrzykując instrukcje maszynowe resetujące zmienne statyczne do wartości `null` lub wartości domyślnych w punktach przejścia cyklu[^4].
2. **Elastyczna Inicjalizacja Zdarzeniowa:** Eliminując zależność od przestarzałego `[InitializeOnLoad]`, nowy system udostępnia precyzyjne punkty kontroli, takie jak `[OnCodeInitializing]` (uruchamiany jeszcze przed załadowaniem bibliotek graficznych, wspierający wczesną alokację zasobów), a także `[BeforeCodeUnloading]` oraz `[AfterCodeReloadSerialization]`, umożliwiające pisanie deterministycznych statycznych procedur czyszczenia pamięci[^3].

Co więcej, maszyna wirtualna CoreCLR rygorystycznie egzekwuje natywny standard **IEEE 754** dla wszystkich operacji zmiennoprzecinkowych (floating-point operations). Drobne różnice w zaokrągleniach między przestarzałym kompilatorem JIT z Mono a CoreCLR mogą przesunąć trajektorie pocisków lub interpolacje fizyczne o tysięczne części jednostki. W wieloosobowych grach sieciowych opartych na modelu „Deterministic Lockstep” ten minimalny, narastający dryf może wywołać całkowitą desynchronizację między urządzeniami o różnych architekturach sprzętowych[^4]. Audyt precyzji obliczeń fizycznych należy podjąć natychmiast.

Ponadto metoda refleksji `AppDomain.CurrentDomain.GetAssemblies()` została objęta mocnym ostrzeżeniem o wycofaniu. Ponieważ mechanizm ALC rozdziela ładowanie i wyładowywanie zestawów, stara metoda mogła przypadkowo pobrać biblioteki DLL znajdujące się w trakcie niszczenia. Wszelkie operacje refleksji należy natychmiast przekierować na bezpieczne API `UnityEngine.Assemblies.CurrentAssemblies`[^4].

## **5. Dyscyplina Linii Pamięci Podręcznej i Eliminacja Wąskich Gardeł Generatorów Kodu ECS**

Architektura Systemu Encji i Komponentów (ECS) kontynuuje proces dojrzewania poprzez wykorzenienie abstrakcji, które nie zapewniały zakładanej wydajności bez narzutu w czasie wykonywania. Unity 6.5 jest wydaniem usuwającym lekkie mechanizmy przejściowe, które miały ułatwić programistom przyzwyczajonym do tradycyjnego `GameObject` wejście w świat ECS.

### **Koniec Ery `Entities.ForEach` oraz Struktury `IAspect`**

W początkach istnienia ECS konstrukcje `Entities.ForEach` oraz interfejs `IAspect` stanowiły główne narzędzia pozwalające odczytywać i modyfikować dane encji bez zagłębiania się w wielowątkowy układ bloków pamięci. Wygoda ta miała jednak wysoką cenę: zmuszała kompilator do generowania olbrzymiej ilości kodu automatycznego (source-generated code). Proces ten nie tylko wydłużał czas kompilacji kodu źródłowego, lecz także generował kod maszynowy niezapewniający ciągłości linii pamięci podręcznej (cache lines) procesora CPU[^7].

W środowisku 6.5 mechanizmy takie jak `Entities.ForEach`, `IAspect` oraz planowanie wątków pomocniczych `Job.WithCode` zostały całkowicie usunięte z rdzenia silnika. Projekty nadal korzystające z tych pętli nie skompilują się[^7]. Obowiązkowa ścieżka migracji obejmuje trzy kroki:

* Całą logikę z `Entities.ForEach` należy zamknąć w jawnych strukturach `struct` implementujących interfejs `IJobEntity`. Wymuszenie na programiście ręcznego zaplanowania układu pamięci pozwala kompilatorowi Burst przycinać instrukcje i głęboko zrównoleglać pętle na pełnej szerokości rejestrów SIMD.
* W przypadku natychmiastowych obliczeń w wątku głównym (main thread) optymalnym, czystym zamiennikiem o wysokiej wydajności jest składnia `SystemAPI.Query<T>()` w połączeniu ze standardową pętlą `foreach` języka C#.
* Po usunięciu `IAspect` wszystkie zapytania muszą być deklarowane jawnie za pomocą `EntityQuery` wewnątrz systemów. Potwierdzono także wycofanie okna diagnostycznego `EntitiesJournaling` — narzędzie to oferowało co prawda znakomitą obserwowalność, ale po cichu wstrzykiwało kod pomiaru opóźnień do zadań wykonywanych w czasie rzeczywistym, niszcząc ogólną wydajność aplikacji[^3].

## **6. Rewolucja w Architekturze Graficznej i Optymalizacja Przepustowości GPU**

Największy proces konsolidacji graficznej w historii Unity Engine doczekał się ostatecznego rozstrzygnięcia: starszy potok renderowania (**Built-In Render Pipeline**) został oficjalnie oznaczony jako **Wycofywany (Deprecated)**[^8]. Decyzja ta pozwala skupić zasoby inżynieryjne na kluczowej technologii przyszłości: **Universal Render Pipeline (URP)**. Choć Built-In Pipeline będzie jeszcze otrzymywać poprawki bezpieczeństwa do końca cyklu życia wydania LTS 6.7, jego wygaszanie oznacza, że projekty produkcyjne i pakiety w Asset Store muszą oprzeć swoje fundamenty wizualne na URP[^16].

### **Przekalibrowanie Fizyki Świateł Punktowych**

Usunięto jeden z najdziwniejszych błędów fizycznych narzędzia wypalającego światło (`LightBaker`), ciągnący się przez dziesiątki wersji silnika: źródła światła punktowego (Point Lights) oraz światła reflektorowego i kierunkowego (Spot/Directional Lights) emitowały dotąd natężenie wyższe od fizycznie poprawnego o współczynnik równy w przybliżeniu liczbie $\pi$ (~3.14159) w porównaniu ze światłami powierzchniowymi (Area Lights)[^8].

Wewnętrzna poprawka w Unity 6.5 płynnie koryguje ten problem w całym domyślnym systemie oświetlenia. Jeśli jednak projekt nadpisuje cieniowanie lub oświetlenie za pomocą delegata `RequestLightsDelegate`, poprawka zaburzy spójność niestandardowych obliczeń, powodując wyraźne niedoświetlenie lub prześwietlenie sceny. Programiści utrzymujący własne delegaty muszą domnożyć struktury danych światła przez kompensujący czynnik $\pi$, aby zachować spójność wizualną[^8].

Ponadto z narzędzia Shader Graph usunięto węzeł `Reflection Probe Node` z powodu braku kompatybilności z nowoczesnymi ścieżkami `Forward+` oraz `Deferred+`. Inżynierowie grafiki muszą zastąpić go węzłem Custom Function Node z surowym kodem HLSL: `Out = SHADERGRAPH_REFLECTION_PROBE(ViewDir, Normal, LOD);`, aby kontynuować próbkowanie map środowiskowych[^8].

### **Przetwarzanie Końcowe w Kafelkach (On-Tile Post Processing) Pokonuje Wąskie Gardło Urządzeń Mobilnych**

Największym problemem sprzętowym w bezprzewodowych goglach rzeczywistości rozszerzonej (Untethered XR, takich jak Meta Quest) oraz na smartfonach jest **dławienie termiczne (Thermal Throttling)** wywołane nadmiernym zużyciem przepustowości pamięci (Memory Bandwidth). W dawnym modelu renderowania (np. 2K × 2K na każde oko) dzielenie przebiegów i tworzenie pośrednich buforów post-processingu zmuszało GPU do kopiowania tekstury głębi (Depth Texture) oraz bufora koloru z ultraszybkiej pamięci wewnątrzukładowej (**Tile Memory**) z powrotem do głównej pamięci **RAM** wyłącznie po to, by wykonać `Blit Final To Back Buffer`[^17]. Przesyłanie miliardów bajtów na sekundę przez magistralę błyskawicznie rozładowywało baterię.

Technologia **On-Tile Post Processing** w URP 6.5 jest prawdziwym przełomem architektonicznym. Umożliwia ona układom GPU Apple Metal oraz Android Vulkan bezpośrednie obliczanie mapowania tonów HDR (Tonemapping), ziarna filmu (Film Grain), ditheringu oraz korekcji barw (Color Grading) bezpośrednio w szybkiej pamięci kafelkowej (Tile Memory) bez wypychania zbędnych danych do pamięci zewnętrznej[^1]. Aby wymusić pracę potoku wyłącznie w tym maksymalnie wydajnym trybie (**Tile-Only Mode**), projekt musi całkowicie zrezygnować z wygładzania krawędzi FXAA w post-processingu oraz unikać filtrów skalowania rozdzielczości wymagających dowolnego próbkowania (takich jak niezależny przebieg wyostrzania RCAS w algorytmach TAA lub FSR), ponieważ uniemożliwiają one scalenie operacji w jednym cyklu kafelka GPU[^17].

Z myślą o twórcach niestandardowych shaderów i przebiegów SRP zdemontowano również przestarzały kompilator Render Graph[^7]. Dalsze korzystanie ze starych statycznych ścieżek kompilacji zatrzyma generowanie obrazu, wymuszając pełną migrację na nowe API **Native Render Pass**.

## **7. Ratunek dla Wydajności 2D na CPU oraz Niezależne API Renderowania `RenderSprite`**

Z myślą o projektach 2D symulujących gigantyczne roje cząsteczek lub tysiące animowanych przeciwników, Unity 6.5 przebudowuje i odciąża renderowanie siatek 2D oraz fizykę od ciężkiego narzutu klasy `GameObject`.

### **Nowe Jądro Fizyki `PhysicsCore2D`**

Moduł odpowiadający za dwuwymiarowe obliczenia przestrzenne, znany dotąd jako `LowLevelPhysics2D`, przekształcił się w standardową architekturę o nazwie `PhysicsCore2D` w nowej przestrzeni nazw `Unity.U2D.Physics`[^8]. Odpowiadający mu zasób konfiguracyjny przemianowano na `Physics Core Settings 2D`. Chociaż aktualizacja plików serializacji przebiega automatycznie w tle, skrypty C# wywołujące niskopoziomowe śledzenie promieni (Raycasts) stracą referencje i zwrócą błąd braku biblioteki. Kluczowym rozwiązaniem dla projektów współdzielących kod pomiędzy wieloma wersjami silnika jest użycie dyrektywy preprocesora `#if UNITY_6000_5_OR_NEWER`, chroniącej ciągłość testów[^8]. System przyspiesza także czyszczenie warstw kolizji poprzez dodanie API `PhysicsComposer.ClearLayers()`, usuwającego warstwy czysto i bez kosztu wyszukiwania każdej warstwy z osobna[^9].

### **Maksymalna Przepustowość dzięki `RenderSprite` i Mapom Kafelków `EntityId`**

Umieszczenie w scenie dziesiątek tysięcy komponentów `SpriteRenderer` nadmiernie rozbudowuje drzewo hierarchii (Hierarchy) i generuje olbrzymi koszt aktualizacji macierzy `Transform` dla procesora CPU w każdej klatce. Pojawienie się niskopoziomowego API `RenderSprite` pozwala programistom wysyłać bezpośrednio do karty graficznej geometrię `SpriteMesh`, surowe dane tekstur (`Texture`) oraz parametry `BlendShape` bez tworzenia ciężkich otoczek `GameObject`[^6].

Połączenie `RenderSprite` oraz systemu kolizji `PhysicsCore2D` pozwala budować niezwykle wydajne symulacje w czasie rzeczywistym — np. dynamikę cieczy czy ruch dziesiątek tysięcy mikroorganizmów[^6]. Koncepcje ECS przeniknęły również do tworzenia światów 2D: **Tilemaps** obsługują teraz kafelki oparte na **Entity ID tiles**, umożliwiając budowę olbrzymich światów (**Megamap**) z dynamicznym nadpisywaniem terenu w czasie rzeczywistym przy użyciu statycznych buforów wielowątkowych i bez budzenia odśmiecacza pamięci (Garbage Collector)[^6].

W celu zwiększenia przejrzystości moduł **2D Profiler** rozbija teraz opóźnienia renderowania na szczegółowe etapy oraz zlicza aktywne atlasowe paczki tekstur (`Sprite Atlases`) wywoływane w każdej klatce, co stanowi kluczową wskazówkę przy podejmowaniu decyzji o pakowaniu grafik[^6].

## **8. Współczesne Standardy Publikacji Mobilnej i Aktualizacja Potoku Budowania**

Ten gruntowny przegląd techniczny zamyka dostosowanie struktury aplikacji do najnowszych wymagań bezpieczeństwa i specyfikacji sprzętowych firm Apple oraz Google.

### **Przebudowa Pakowania dla Platformy Android**

Zmiany standardów szyfrowania i wymagań ze strony Google wywołują istotne przetasowania w procesie budowania (Build Process) dla systemu Android:

* **Minimalny Poziom API Bezpieczeństwa:** Aplikacje na Androida nie mogą już celować w przestarzałe systemy takie jak Android 7.1. Parametr **Minimum API Level** został oficjalnie podniesiony do poziomu **26 (Android 8.0 Oreo)**[^7]. Jeśli zewnętrzne pakiety SDK (Ads, Analytics, Firebase) zachowają przestarzałą konfigurację zgodności zabezpieczeń, projekt natychmiast zawiedzie podczas budowania plików APK/AAB z powodu konfliktów bibliotek.
* **Narzędzie Budowania Gradle:** Łańcuch narzędzi Androida przechodzi na wersję **Gradle 9.1.0** oraz **Android Gradle Plugin (AGP) 9.0.0**[^7]. Stanowi to wyzwanie dla projektów korzystających z własnego pliku `mainTemplate.gradle` lub niestandardowych skryptów budowania. W AGP 9.0 wymagana jest jawna deklaracja głównej przestrzeni nazw: zarówno w pliku manifestu `AndroidManifest.xml`, jak i w pliku `Build.gradle` należy na sztywno przypisać unikalny identyfikator pakietu (np. `namespace "com.studio.game.unique"`). Brak tej dyrektywy zatrzyma kompilator z powodu kolizji znaczników manifestu[^7].
* **Koniec Architektury `x86_64` na Androidzie:** Kompilator IL2CPP całkowicie rezygnuje z generowania natywnych bibliotek C++ dla architektury `x86_64` na Androida. W projektach mających zablokowaną tę flagę opcja zostanie usunięta automatycznie, standaryzując kompilacje pod kątem powszechnej globalnie architektury ARM[^7].

Zmieniło się także zarządzanie obszarami bezpiecznymi i paskami systemowymi na urządzeniach mobilnych. Przestarzała właściwość `PlayerSettings.Android.startInFullscreen` została trwale usunięta. Inżynierowie kontrolujący zachowanie obrazu wokół wcięcia ekranu (Notch) lub wyświetlanie paska nawigacji (Navigation Bar) muszą obecnie programować obsługę marginesów (Insets) za pomocą nowoczesnych API `PlayerSettings.Android.requestedVisibleInsets` oraz `AndroidApplication.currentWindowInsets`[^7].

Tabela migracji dla integracji platform mobilnych:

| Funkcja Usunięta lub Oznaczona jako Przestarzała | Wymagane Nowe API Zastępcze |
| :--- | :--- |
| Wbudowany iOS ReplayKit | Całkowicie usunięty z powodu problemów z optymalizacją ARM64; należy zastąpić natywnymi wtyczkami Objective-C[^8]. |
| Przestarzałe kontrolery VR (Legacy) | Całkowicie usunięte; wymagana migracja do pakietu XR Management oraz Native XR Templates[^8]. |
| Pakiet OculusXR dla urządzeń Meta | Wycofane wsparcie na goglach Meta Quest; zastąpić standardowym pakietem **OpenXR: Meta**[^18]. |
| `AndroidAssetPacks.RequestToUseMobileDataAsync` | Przestarzałe; należy użyć bezpieczniejszej metody asynchronicznej `AndroidAssetPacks.ShowConfirmationDialogAsync`[^8]. |

### **Konsolidacja w UI Toolkit i Przekierowanie Plików Dziennika (Log)**

Epoka uGUI zbliża się ku końcowi w miarę jak **UI Toolkit** przejmuje rolę głównej warstwy interfejsu. W narzędziu **Rendering Debugger** przestrzeń uGUI została zastąpiona wysokowydajnym potokiem `PanelRenderer`[^10]. Wszelkie niestandardowe rozszerzenia paneli debugowania przechowujące stan analizy (`DebugState`) muszą zostać przepisane na nowy interfejs `ISerializedDebugDisplaySettings`, aby uniknąć utraty danych po każdym przeładowaniu maszyny wirtualnej[^8]. Należy uważać na ukryte zagrożenie w tym wydaniu: dziedziczenie motywu `default-modified.asset` może ulec uszkodzeniu serializacji i doprowadzić do awarii paneli UI systemu. Jedynym bezpiecznym rozwiązaniem zapobiegawczym jest utworzenie nowego zasobu Theme w UI Builder i odziedziczenie motywu bazowego poprzez czysty kod USS: `import url("unity-theme://default");`[^21].

W potoku zasobów `ModelImporter` usuwa przestarzałe flagi optymalizacji siatek 3D: niejednoznaczne ustawienia takie jak `optimizeMesh` muszą być teraz jawnie określane jako `optimizeMeshPolygons` lub `optimizeMeshVertices`, zapewniając czysty podział współrzędnych UV[^7]. W zautomatyzowanych potokach DevOps CI/CD (GitHub Actions, Jenkins), zamiast zapisywać wszystkie dane do współdzielonego na dysku systemowym pliku `Editor.log`, Unity kieruje teraz logi bezpośrednio do wnętrza projektu w ścieżce `ProjectName/Logs/Editor.log`. Ścieżki zapisane na sztywno (hard-coded paths) należy zastąpić dynamicznym odwołaniem do `Application.consoleLogPath` lub jawną flagą wiersza poleceń `-logFile`, aby zapobiec przerwaniu zbierania logów błędów na serwerach budowania[^8]. Równocześnie usunięto na stałe cały stary system wejścia (Old Input System), w tym `InputManager.devices`[^15], a pakiet **Behavior Graph** wzbogacono o dwie metody cyklu życia węzłów — `Node.OnSetup()` oraz `Node.OnTeardown()` — zapobiegające marnowaniu pamięci RAM[^22].

## **Podsumowanie Strategiczne i Zalecenia Dotyczące Aktualizacji**

Migracja infrastruktury z Unity 6.4 do 6.5 (`6000.5`) wymaga starannej, zdecydowanej i gruntownej refaktoryzacji architektury. Fundamentalne przejście z 32-bitowych liczb `InstanceID` na 64-bitowe struktury `EntityId` ze znacznikiem wersji jest najbardziej inwazyjną zmianą w pamięci, wymuszającą usunięcie niebezpiecznych rzutowań oraz przeprojektowanie kluczy słowników i schematów baz danych.

Przegląd i zastąpienie przestarzałych wywołań w rodzaju `Component.rigidbody` zbuforowanymi wywołaniami `GetComponent<T>()` — a także usunięcie wycofanych wzorców ECS takich jak `Entities.ForEach` — nie tylko eliminuje błędy kompilacji, lecz również odzyskuje cenne zasoby obliczeniowe CPU. Równie istotne jest oznaczanie stanu statycznego nowymi interfejsami **API Cyklu Życia Edytora**, co zapewni bezpieczeństwo pamięci w nadchodzącym świecie CoreCLR pozbawionym przeładowań domeny. Wreszcie ujednolicenie potoku graficznego wokół **Universal Render Pipeline** wraz z **On-Tile Post Processing** pozwoli uzyskać bezprecedensową poprawę kultury termicznej oraz oszczędność przepustowości na autonomicznych goglach XR i sprzęcie mobilnym.

## **Bibliografia**

[^1]: Unity 6.5 is now available : r/Unity3D - Reddit, [https://www.reddit.com/r/Unity3D/comments/1u7gor6/unity_65_is_now_available/](https://www.reddit.com/r/Unity3D/comments/1u7gor6/unity_65_is_now_available/)
[^2]: GetInstanceId() deprecation - Unity Engine - Unity Discussions, [https://discussions.unity.com/t/getinstanceid-deprecation/1705258](https://discussions.unity.com/t/getinstanceid-deprecation/1705258)
[^3]: CoreCLR, Scripting, and ECS Status Update - March 2026 - Unity Engine, [https://discussions.unity.com/t/coreclr-scripting-and-ecs-status-update-march-2026/1711852](https://discussions.unity.com/t/coreclr-scripting-and-ecs-status-update-march-2026/1711852)
[^4]: Path to CoreCLR, 2026: Upgrade Guide - Technical Articles - Unity Discussions, [https://discussions.unity.com/t/path-to-coreclr-2026-upgrade-guide/1714279](https://discussions.unity.com/t/path-to-coreclr-2026-upgrade-guide/1714279)
[^5]: Is `GetEntityID().GetHashCode()` a direct replacement for `GetInstanceID()`? (if only for the time being) - Unity Discussions, [https://discussions.unity.com/t/is-getentityid-gethashcode-a-direct-replacement-for-getinstanceid-if-only-for-the-time-being/1721711](https://discussions.unity.com/t/is-getentityid-gethashcode-a-direct-replacement-for-getinstanceid-if-only-for-the-time-being/1721711)
[^6]: Unity 6.5 is now available - Unity Discussions, [https://discussions.unity.com/t/unity-6-5-is-now-available/1723176](https://discussions.unity.com/t/unity-6-5-is-now-available/1723176)
[^7]: Planned breaking changes in Unity 6.5 [updated 2026-03-27], [https://discussions.unity.com/t/planned-breaking-changes-in-unity-6-5-updated-2026-03-27/1694205](https://discussions.unity.com/t/planned-breaking-changes-in-unity-6-5-updated-2026-03-27/1694205)
[^8]: Upgrade to Unity 6.5 - Manual, [https://docs.unity3d.com/6000.5/Documentation/Manual/UpgradeGuideUnity65.html](https://docs.unity3d.com/6000.5/Documentation/Manual/UpgradeGuideUnity65.html)
[^9]: Unity 6000.5.0a7, [https://unity.com/releases/editor/alpha/6000.5.0a7](https://unity.com/releases/editor/alpha/6000.5.0a7)
[^10]: Unity 6000.5, [https://unity.com/releases/editor/alpha/6000.5](https://unity.com/releases/editor/alpha/6000.5)
[^11]: Upgrade to Unity 6.5 - Manual, [https://docs.unity3d.com/Manual/UpgradeGuideUnity65.html](https://docs.unity3d.com/Manual/UpgradeGuideUnity65.html)
[^12]: Unity 6000.5.0f1, [https://unity.com/releases/editor/whats-new/6000.5.0f1](https://unity.com/releases/editor/whats-new/6000.5.0f1)
[^13]: Class ArPlaybackStatusExtensions | Google ARCore XR Plugin | 6.5.0 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.xr.arcore@6.5/api/UnityEngine.XR.ARCore.ArPlaybackStatusExtensions.html](https://docs.unity3d.com/Packages/com.unity.xr.arcore@6.5/api/UnityEngine.XR.ARCore.ArPlaybackStatusExtensions.html)
[^14]: Change log | Unity Transport | 6.5.0, [https://docs.unity3d.com/Packages/com.unity.transport@6.5/changelog/CHANGELOG.html](https://docs.unity3d.com/Packages/com.unity.transport@6.5/changelog/CHANGELOG.html)
[^15]: Unity updates for card and party games - Scouts by Yutori, [https://scouts.yutori.com/4632ade4-1238-4ee7-acb7-79a062ff086d](https://scouts.yutori.com/4632ade4-1238-4ee7-acb7-79a062ff086d)
[^16]: Render Pipelines strategy for 2026 - Unity, [https://unity.com/topics/render-pipelines-strategy-for-2026](https://unity.com/topics/render-pipelines-strategy-for-2026)
[^17]: Performant and Energy-Efficient Rendering with Render Graph and On-Tile Post Processing for Untethered XR in Unity 6.3 - Unity Discussions, [https://discussions.unity.com/t/performant-and-energy-efficient-rendering-with-render-graph-and-on-tile-post-processing-for-untethered-xr-in-unity-6-3/1703007](https://discussions.unity.com/t/performant-and-energy-efficient-rendering-with-render-graph-and-on-tile-post-processing-for-untethered-xr-in-unity-6-3/1703007)
[^18]: Topics tagged Official - Unity Discussions, [https://discussions.unity.com/tag/official/160110](https://discussions.unity.com/tag/official/160110)
[^19]: Manual: New in Unity 6.5, [https://docs.unity3d.com/Manual/WhatsNewUnity65.html](https://docs.unity3d.com/Manual/WhatsNewUnity65.html)
[^20]: Unity 6000.5.0a9, [https://unity.com/releases/editor/alpha/6000.5.0a9](https://unity.com/releases/editor/alpha/6000.5.0a9)
[^21]: Unity 6.5 is now available - Page 2 - Unity Engine - Unity Discussions, [https://discussions.unity.com/t/unity-6-5-is-now-available/1723176?page=2](https://discussions.unity.com/t/unity-6-5-is-now-available/1723176?page=2)
[^22]: Behavior Package 1.0.16 Released! - Unity Discussions, [https://discussions.unity.com/t/behavior-package-1-0-16-released/1721488](https://discussions.unity.com/t/behavior-package-1-0-16-released/1721488)
