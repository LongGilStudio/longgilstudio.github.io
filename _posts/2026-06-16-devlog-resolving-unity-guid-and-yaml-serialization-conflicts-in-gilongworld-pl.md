---
title: "Szczegółowy raport techniczny: rozwiązywanie konfliktów identyfikatorów GUID i serializacji YAML przy rozgałęzianiu funkcji w projekcie GilongWorld"
date: 2026-06-16 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, guid, serialization, assetdatabase, git]
description: "Dogłębna analiza systemu identyfikatorów GUID oraz serializacji YAML w Unity, a także rozwiązanie problemu zerwanych referencji przy rozdzielaniu gałęzi funkcjonalności."
lang: pl
translation_id: gilongworld-unity-guid-serialization
---

## **Kontekst systemowy i kryzys strukturalny w Long Gil Studio**

W cyklu życia dużego projektu rozrywkowego refaktoryzacja architektury systemu w celu spełnienia nowych wymagań projektowych jest nieuniknionym wyzwaniem. Projekt **GilongWorld**, rozwijany na platformie Unity przez zespół inżynierów w Long Gil Studio, napotkał poważną barierę techniczną podczas skalowania systemu. Główny problem wynikał z praktycznej potrzeby operacyjnej: zespół musiał rozdzielić istniejącą funkcjonalność na dwa całkowicie niezależne kierunki rozwoju, aby obsłużyć odrębne, dedykowane mechaniki rozgrywki. Wymaganie to oznaczało, że nowa gałąź funkcji musiała odziedziczyć cały fundament logiczny, struktury danych oraz zasoby wizualne pierwotnej funkcji, pozostając jednocześnie w całkowitej izolacji, tak aby żadna ingerencja w nowej gałęzi nie wywołała efektu domina (*ripple effect*) psującego oryginalną funkcjonalność.

Ponieważ obie funkcje miały wspólny punkt wyjścia, początkowa struktura katalogów zawierała szereg fizycznie zduplikowanych plików — od plików kodu źródłowego C# (Scripts), przez Prefaby, Materials i Textures, aż po pliki konfiguracyjne Animation. Nadrzędnym celem Long Gil Studio było całkowite odseparowanie tych dwóch bloków zasobów. Jednak po wykonaniu standardowej operacji duplikowania (*duplicate*) w środowisku Unity Editor natychmiast wystąpiło poważne zerwanie referencji: cała sieć wewnętrznych powiązań nowego bloku zasobów (Prefabów oraz `ScriptableObject`) automatycznie pozostała sztywno powiązana ze starymi plikami kodu źródłowego i zasobami z oryginalnej gałęzi. Incydent ten zapoczątkował długą serię wysiłków technicznych mających na celu przywrócenie integralności struktury danych. Poszukiwanie rozwiązania przez Long Gil Studio okazało się nie tylko zwykłym procesem debugowania, lecz także dogłębną lekcją na temat natury systemu serializacji (*serialization*) oraz bazy danych zasobów (`AssetDatabase`) w Unity.

## **Anatomia architektury serializacji i identyfikatorów w Unity**

Aby zrozumieć, dlaczego zwykłe kopiowanie folderów prowadzi do zerwania i nakładania się referencji, trzeba przeprowadzić dokładną analizę architektury zarządzania zasobami w Unity Engine. W przeciwieństwie do menedżerów plików systemów operacyjnych, które lokalizują dokumenty na podstawie fizycznej ścieżki (*file path*) lub nazwy pliku, Unity utrzymuje wewnętrzną bazę danych zaprojektowaną tak, aby była odporna na zmiany w fizycznej przestrzeni dyskowej[^1].

### **Język serializacji YAML i obiektywna struktura danych**

Unity Engine wykorzystuje wysokowydajną bibliotekę serializacji implementującą podzbiór specyfikacji YAML (*YAML Ain't Markup Language*) do przechowywania stanu danych większości zasobów projektowych, takich jak Scenes, Prefabs, Materials oraz `ScriptableObject`[^2]. Ta decyzja architektoniczna zapewnia przejrzysty, czytelny dla człowieka format tekstowy, pozwalający programistom wygodnie śledzić zmiany za pośrednictwem systemu kontroli wersji (*Version Control System*), takiego jak Git, a także skutecznie rozwiązywać konflikty danych[^3].

Podczas analizy kodu źródłowego dowolnego pliku Prefab lub Scene w zwykłym edytorze tekstu struktura YAML odsłania złożoną sieć deklaracji obiektów oraz hiperłączy referencyjnych. Każdy obiekt w pliku YAML definiowany jest za pomocą specjalnego identyfikatora w postaci `!u!{CLASS ID} &{FILE ID}`[^2]. Te dwa składniki stanowią fundament każdego grafu zależności w Unity.

**Class ID** to wartość całkowita (*integer*) określająca niskopoziomową klasę, do której należy dany obiekt, zakodowana na stałe w kodzie źródłowym C++ silnika Unity Engine[^2]. Przykładowo liczba `1` oznacza `GameObject`, `4` oznacza komponent `Transform`, a `114` oznacza `MonoBehaviour` (czyli niestandardowe skrypty C# zdefiniowane przez użytkownika)[^2]. Z kolei **File ID** (lokalny identyfikator pliku) to wartość numeryczna reprezentująca identyfikator tego konkretnego obiektu w granicach pojedynczego pliku[^2]. File ID służy do rozwiązywania wewnętrznych referencji krzyżowych między obiektami znajdującymi się w tym samym pliku — na przykład gdy komponent `Transform` odwołuje się do nadrzędnego obiektu `GameObject`[^2]. W przypadku plików modeli 3D (*Model files*) lub wewnętrznych zasobów zarządzanych przez Unity wartości File ID są zwykle ogromnymi, nieprzewidywalnymi liczbami losowymi, generowanymi i przypisywanymi podczas pierwszego wykrycia oraz analizy pliku przez Unity[^4]. W przypadku plików kodu źródłowego C# (`.cs`) skompilowanych w bibliotekach binarnych (DLL) Unity stosuje bardziej deterministyczne podejście: system wylicza lokalny File ID za pomocą kryptograficznej funkcji skrótu MD4. Algorytm wyodrębnia pierwsze cztery bajty skrótu MD4 z ciągu tekstowego według wzoru `"s\0\0\0" + t.Namespace + t.Name`, aby uzyskać 32-bitową liczbę całkowitą w formacie *little-endian*[^4].

Poniższa tabela przedstawia szczegółowe zestawienie trzech poziomów identyfikacji budujących sieć zasobów w Unity:

| Typ identyfikatora | Zakres działania technicznego | Źródło inicjalizacji i zastosowany algorytm | Kluczowa rola w architekturze systemu |
| :--- | :--- | :--- | :--- |
| **Class ID** | Globalny (głęboko osadzony w silniku) | Zdefiniowany statycznie z góry w kodzie źródłowym C++ Unity. | Określa typ natywnego komponentu (`GameObject`, `Transform`, `Camera`, `Collider` itd.)[^2]. |
| **File ID** | Lokalny (ograniczony do wnętrza jednego pliku YAML) | Liczba losowa dla zasobów graficznych; skrót MD4 dla skryptów C#/DLL[^4]. | Identyfikuje podelementy wewnątrz Prefaba/Scene. Rozwiązuje referencje wewnętrznego grafu obiektów[^5]. |
| **GUID** | Globalny (obejmujący cały projekt) | Uniwersalny unikalny identyfikator UUID v4 (system szesnastkowy, 32 znaki bez łączników)[^7]. | Identyfikuje fizyczny zasób (plik). Jedyny klucz do rozwiązywania referencji krzyżowych między różnymi plikami w projekcie[^1]. |

### **Znaczenie metadanych (`.meta`) i globalnego identyfikatora GUID**

Prawdziwa złożoność pojawia się wtedy, gdy system musi obsługiwać referencje łączące niezależne pliki. Podczas odwoływania się do obiektów znajdujących się poza zakresem pojedynczego pliku YAML lokalny identyfikator File ID staje się całkowicie bezużyteczny, ponieważ może naturalnie powtarzać się w tysiącach różnych plików projektu[^2]. Aby utrzymać spójną bazę danych, Unity wymaga osobnego identyfikatora pomocniczego zdolnego jednoznacznie wskazać docelowy plik w skali całego systemu. Jest to obszar działania **Global Unique Identifier (GUID)**.

Za każdym razem, gdy Unity Editor wykryje nowy plik zasobu wprowadzony do projektu po raz pierwszy — poprzez import, utworzenie lub skopiowanie — system automatycznie tworzy towarzyszący mu plik metadanych. Plik ten nosi tę samą nazwę co plik źródłowy z dodanym rozszerzeniem `.meta`[^1]. Plik `.meta` pełni rolę „dowodu osobistego” zasobu, przechowując ustawienia importu (*Import Settings*) oraz, co najważniejsze, właściwość `guid`. Właściwość ta jest unikalnym ciągiem skrótu składającym się z 32 znaków szesnastkowych, na przykład `8c9c1e4a88e724a60a9ac0b0bb6a52c31`.

Gdy obiekt w grze musi odwołać się do innego zasobu, składnia serializacji YAML łączy oba identyfikatory za pomocą specjalnej tablicy asocjacyjnej w linii: `{fileID: X, guid: Y, type: Z}`[^2]. W tej strukturze parametr `fileID` służy do wskazania pozycji konkretnego obiektu ukrytego wewnątrz pliku docelowego, parametr `guid` dostarcza 32-znakowy ciąg wskazujący bezpośrednio plik `.meta` zasobu docelowego, a parametr `type` określa strategię wyszukiwania zasobu dla systemu `AssetDatabase`[^4]. Zazwyczaj `type: 2` jest używane dla zewnętrznych zasobów niebędących kodem źródłowym, natomiast `type: 3` reprezentuje wewnętrzne zasoby będące skryptami źródłowymi[^4].

To właśnie dzięki takiemu rozdzielnemu mechanizmowi przechowywania inżynierowie mogą swobodnie zmieniać nazwy plików i przenosić je między różnymi folderami w systemie operacyjnym bez naruszania logicznej struktury projektu. System `AssetDatabase` w Unity w tle nieustannie skanuje pliki `.meta`, utrzymując tabelę wyszukiwania GUID zamiast polegać na podatnych na uszkodzenia ścieżkach względnych[^1]. Jednak to bezwzględne uzależnienie od GUID stało się zarazem bezpośrednim źródłem trudnego problemu Long Gil Studio.

## **Kronika rozwiązywania problemu: droga Long Gil Studio do rozwiązania**

Rozdzielenie bloku funkcjonalności na dwa niezależne byty wydawało się początkowo prostą operacją na plikach. Gdy jednak zespół programistów w Long Gil Studio przystąpił do prac, szybko wpadł w sieć skomplikowanych problemów dotyczących integralności grafu danych w Unity. Droga ta zapisała się jako ciąg prób i błędów — od najbardziej intuicyjnych metod po zaawansowane programowanie systemowe.

### **Etap 1: Bezsilność zmiany nazw plików i bezpośredniego duplikowania**

Pierwszym naturalnym odruchem zespołu inżynierów było bezpośrednie zduplikowanie (*duplicate*) folderu `Feature_A` do folderu `Feature_B` z poziomu interfejsu Unity Editor, aby utworzyć odrębną fizyczną kopię danych. Natychmiast pojawiło się jednak zjawisko „referencji krzyżowych wskazujących z powrotem na stare źródło”[^10].

Podczas duplikowania w Edytorze Unity rozumie, że dwa zasoby nie mogą dzielić tego samego identyfikatora GUID w ramach jednego projektu. System automatycznie interweniuje, generując zupełnie nowe pliki `.meta` zawierające świeże, losowe identyfikatory GUID dla każdego pliku w folderze `Feature_B`[^1]. Choć zapewnia to poprawność samej bazy danych, prowadzi do katastrofy logicznej: tekstowa zawartość (YAML) wewnątrz nowo skopiowanych plików Prefab lub `ScriptableObject` nie jest przez Unity w żaden sposób przepisywana ani modyfikowana. Oznacza to, że w pliku `Feature_B/UI_Window.prefab` fragment YAML przechowujący odniesienie do skryptu sterującego pozostaje statycznie przypięty do `{fileID: 11500000, guid: [GUID_STAREGO_PLIKU_W_FEATURE_A]}`[^10].

W rezultacie, mimo utworzenia nowego folderu, wszystkie komponenty interfejsu, Prefaby i pola w nowej gałęzi pozostały fizycznie połączone z plikami kodu źródłowego (`.cs`) oryginalnej gałęzi. Każda zmiana parametrów wprowadzona w nowym Prefabie przez Inspektor niosła ryzyko nadpisania lub kolizji z logiką starej klasy kontrolera, stwarzając poważne zagrożenie regresją (*regression risk*). Zespół Long Gil Studio próbował rozwiązać problem, zmieniając nazwy skryptów i plików zasobów w nowym folderze. Jednak zmiana nazwy modyfikuje wyłącznie ciąg znaków wyświetlany w interfejsie użytkownika i fizyczną nazwę pliku na dysku — w żaden sposób nie wpływa na skrót GUID w pliku `.meta` ani na ciągi referencyjne w plikach konfiguracyjnych YAML[^5]. Baza danych Unity jest obojętna na nazwy plików, dlatego metoda zmiany nazw została natychmiast odrzucona jako całkowicie nieskuteczna w separowaniu powiązań.

### **Etap 2: Kryzys tworzenia od nowa i ręcznego ponownego podpinania referencji**

Po niepowodzeniu zmiany nazw zespół przeszedł do podejścia ręcznego i znacznie kosztowniejszego: tworzenia zupełnie nowych plików oraz ręcznego odbudowania całego grafu powiązań. Programiści musieli otwierać każdy nowo utworzony Prefab lub `ScriptableObject`, usuwać komponenty z uszkodzonymi lub wskazującymi na starą gałąź powiązaniami, dodawać nowe komponenty, a następnie ręcznie przeciągać metodą *drag and drop* każdy zasób graficzny i dźwiękowy w odpowiednie pole referencji w Inspektorze.

W przypadku małego prototypu takie podejście mogłoby być akceptowalne. Jednak w rozbudowanej funkcjonalności projektu GilongWorld — obejmującej dziesiątki lub setki plików zagnieżdżonych w sobie za pomocą architektury Nested Prefabs — graf zależności rozrósł się do rozmiarów niemożliwych do opanowania ręcznie. Ręczne przepinanie tysięcy referencji krzyżowych między widokami UI, obiektami konfiguracyjnymi `ScriptableObject` oraz kontrolerami animacji (`Animation Controller`) pochłaniało całe tygodnie pracy.

Najpoważniejszą konsekwencją tej metody był czynnik błędu ludzkiego (*human error*)[^1]. Inżynierowie nieustannie mierzyli się z nakładającymi się powiązaniami, pominiętymi referencjami lub omyłkowym podpięciem skryptów o identycznych nazwach, lecz pochodzących z innej przestrzeni roboczej. Pojedyncza przeoczona referencja pośród tysięcy serializowanych właściwości potrafiła przejść statyczną kompilację bez błędu, by następnie wywołać krytyczną awarię typu `NullReferenceException` podczas uruchomienia projektu w trybie Runtime. Wyczerpanie czasowe i spadek jakości produktu zmusiły Long Gil Studio do poszukiwania automatyzacji na głębszym poziomie architektury.

### **Etap 3: Incydent kolizji przy klonowaniu przez system operacyjny**

Inna propozycja zakładała skopiowanie folderu za pomocą menedżera plików systemu operacyjnego (Eksplorator Windows lub Finder w macOS) zamiast kopiowania w Unity Editor, aby „oszukać” Unity poprzez utworzenie fizycznych kopii. Podczas kopiowania na zewnątrz zarówno plik z treścią, jak i plik `.meta` z identyfikatorem GUID zostają powielone identycznie[^3].

Jednak po powrocie do Unity Editor pojawił się nowy problem określany jako **kolizja identyfikatorów (GUID Collision)**. System `AssetDatabase` wykrywał jednoczesne istnienie dwóch plików dzielących ten sam GUID. Wewnętrzna obsługa konfliktów w Unity prowadzi zwykle do jednego z dwóch skutków: albo silnik odmawia załadowania jednego z plików, albo automatycznie i po cichu nadpisuje GUID jednego z nich nowym losowym ciągiem bez informowania użytkownika — i co kluczowe, bez aktualizowania jakichkolwiek referencji YAML[^9]. Raporty z praktyki pokazują, że w obliczu wielu struktur opartych na tym samym współdzielonym szkielecie Unity nie potrafi odróżnić zasobów o tym samym GUID mimo różnych nazw plików, przez co bezładnie podpina referencje do niewłaściwego zasobu[^1]. Metoda ta okazała się jeszcze bardziej niebezpieczna niż ręczne przypisywanie powiązań.

## **Przełom techniczny: bezstratna regeneracja identyfikatorów GUID**

Dotarłszy do ślepego zaułka zwykłych operacji, zespół Long Gil Studio zrozumiał, że sedno problemu nie polega na powielaniu fizycznych plików, lecz na spójnym przeliczeniu danych. Potrzebna była metoda pozwalająca masowo i konsekwentnie zaktualizować wszystkie ciągi GUID w całej sieci plików YAML nowego folderu. Analizując otwartoźródłowe narzędzia społeczności inżynierów Unity, zespół odkrył i z powodzeniem wdrożył technikę lokalnej **regeneracji identyfikatorów GUID (GUID Regeneration)**[^1].

Technika ta stanowi bezpośrednią ingerencję w tekstową warstwę źródłową projektu. Zamiast pozwalać Unity Editor na bierną obsługę duplikacji według domyślnego algorytmu, system jest skanowany i przetwarzany przez dedykowane narzędzie typu *Editor Script* w języku C#. Narzędzie to odczytuje każdy plik `.meta` w folderze nowej gałęzi funkcji, generuje zupełnie nowy zestaw identyfikatorów GUID, buduje w pamięci operacyjnej tabelę mapowania (*mapping table*) między starymi a nowymi GUID-ami, a następnie przechodzi przez całą tekstową zawartość plików konfiguracyjnych, precyzyjnie podmieniając odpowiednie ciągi znaków.

### **Szczegółowa analiza algorytmu regeneracji GUID w Long Gil Studio**

Bazując na sprawdzonych otwartoźródłowych algorytmach (takich jak skrypty autorstwa jeffjadulco, ZimM-LostPolygon i rrazgriz[^1]), zespół techniczny zbudował rygorystyczny potok wykonawczy złożony z kilku etapów przetwarzania danych.

#### **Krok 1: Inicjalizacja stanu edycji zasobów**

Modyfikowanie tysięcy plików tekstowych w ułamku sekundy wywołałoby mechanizm automatycznego odświeżania i rekompilacji (*auto-refresh*) w Unity, zawieszając Edytor lub doprowadzając do przepełnienia pamięci. Dlatego algorytm rozpoczyna pracę od tymczasowego wstrzymania monitorowania systemu plików przez Unity poprzez wywołanie metody API `AssetDatabase.StartAssetEditing()`[^7]. Operacja ta wprowadza `AssetDatabase` w stan tymczasowego wstrzymania, umożliwiając bezproblemowe wykonywanie masowych operacji wejścia/wyjścia (I/O) na dysku. Jednocześnie inicjalizowany jest filtr obsługiwanych rozszerzeń (`kDefaultFileExtensions`), określający formaty poddawane analizie: `*.meta`, `*.mat`, `*.anim`, `*.prefab`, `*.unity`, `*.asset`, `*.guiskin`, `*.fontsettings` oraz `*.controller`[^7].

#### **Krok 2: Rekurencyjne skanowanie i ekstrakcja docelowego zbioru GUID**

System określa zasięg działania, pobierając listę identyfikatorów GUID zaznaczonych przez użytkownika w oknie Project (`Selection.assetGUIDs`). Algorytm przeszukuje rekurencyjnie wszystkie podfoldery, odwzorowując każdą ścieżkę pliku na jego fizyczny GUID za pomocą `AssetDatabase.AssetPathToGUID(file)`. Istotnym niuansem tego kroku jest celowe wykluczenie plików `.meta` z bezpośredniego filtrowania zaznaczenia (`Path.GetExtension(...) != ".meta"`), aby lista `guidsToRegenerate` zawierała wyłącznie oryginalne zasoby treści[^8].

#### **Krok 3: Analiza składniowa i identyfikacja grafu powiązań**

Etapem wymagającym największej mocy obliczeniowej jest liniowe skanowanie całej struktury tekstowej. Dla każdego pliku na liście system otwiera i odczytuje cały ciąg znaków za pomocą `File.ReadAllText(filePath)`[^7]. Technika parsowania (*parsing*) celowo rezygnuje z wyrażeń regularnych (*Regex*) ze względu na narzut wydajnościowy przy dużych blokach tekstu. Zamiast tego algorytm sekwencyjnie wyszukuje stały ciąg `"guid: "` (o długości 6 znaków)[^7].

Po napotkaniu wzorca referencji algorytm wyodrębnia dokładnie 32 kolejne znaki. Natychmiast potem uruchamiana jest warstwa weryfikacji bezpieczeństwa `IsGuid(string text)`, która w pętli potwierdza, czy ten 32-znakowy ciąg spełnia reguły systemu szesnastkowego (zakres od `'0'` do `'9'` oraz od `'a'` do `'f'`)[^7]. Ta rygorystyczna kontrola eliminuje ryzyko przypadkowego nadpisania losowych ciągów w kodzie C# lub kryptograficznych skrótów danych graficznych o takiej samej długości 32 znaków.

#### **Krok 4: Budowa słowników podwójnego mapowania**

Aby mieć pewność, że nadpisywanie nie uszkodzi rdzennych zasobów Unity ani zewnętrznych zależności, system tworzy w pamięci RAM trzy kluczowe struktury danych[^7]:

1. **Zbiór `ownGuids` (zasoby wewnętrzne):** Algorytm rozpoznaje pierwszy kod GUID występujący w dowolnym pliku `.meta` i zapisuje go w strukturze `HashSet`. Podstawową zasadą Unity jest to, że pierwszy GUID w pliku `.meta` zawsze reprezentuje sam dany zasób. Zbiór ten pełni rolę zapory ogniowej, pozwalającej odróżnić zasoby należące do przetwarzanego folderu od zasobów zewnętrznych (takich jak wbudowany materiał `Standard.mat` silnika Unity Engine)[^7].
2. **Słownik `guidOldToNewMap` (tabela podmiany):** Dla każdego unikalnego wykrytego starego GUID system generuje zupełnie nowy UUID za pomocą standardowej metody bibliotecznej `Guid.NewGuid().ToString("N")`[^7]. Algorytm generowania UUID w wersji 4 (v4) zapewnia ciąg pozbawiony łączników o prawdopodobieństwie kolizji dążącym do zera, gwarantując pełne bezpieczeństwo danych.
3. **Słownik `guidsInFileMap` (indeks przypisania do plików):** Słownik mapujący ścieżkę pliku na zbiór starych identyfikatorów GUID wywoływanych wewnątrz tego pliku. Struktura ta optymalizuje etap zapisu, wskazując systemowi dokładnie, które pliki należy otworzyć i jakie ciągi zamienić.

#### **Krok 5: Zsynchronizowane nadpisanie i przywrócenie stanu**

W ostatniej pętli system otwiera każdy plik zapisany w `guidsInFileMap`. Stosowany jest podwójny warunek weryfikacji krzyżowej: sprawdzany stary GUID musi znajdować się w zbiorze zasobów wewnętrznych (`ownGuids`) **ORAZ** musi należeć do listy zasobów wskazanych przez użytkownika do regeneracji (`guidsToRegenerate`)[^8]. Ta reguła bezpieczeństwa jest kręgosłupem całego rozwiązania, całkowicie zapobiegając przypadkowej modyfikacji identyfikatorów Engine Assets lub niepożądanych bibliotek współdzielonych.

Po przejściu weryfikacji wykonywana jest instrukcja podmiany ciągu `contents = contents.Replace("guid: " + oldGuid, "guid: " + newGuid)`[^7], a nowy tekst zapisywany jest na dysku za pomocą `File.WriteAllText`. Po przetworzeniu wszystkich plików wywoływane jest `AssetDatabase.StopAssetEditing()` w celu wybudzenia mechanizmu śledzenia Unity, a następnie `AssetDatabase.Refresh()`, aby ponownie skompilować cały projekt z całkowicie nową strukturą GUID[^7].

Dzięki temu algorytmowi studio Long Gil Studio zyskało możliwość pełnego klonowania całego systemu funkcjonalności przy zachowaniu absolutnej niezależności na poziomie plików. Inżynierowie mogą modyfikować Prefaby, zmieniać kod źródłowy i rekonfigurować parametry w „Gałęzi B”, nie wywołując najmniejszych zaburzeń w „Gałęzi A”. Sieć wzajemnych powiązań Gałęzi B utrzymuje teraz komunikację wewnętrzną poprzez całkowicie nowy, odizolowany zestaw identyfikatorów, w pełni rozwiązując pierwotny problem rozdzielenia bez pozostawienia jakichkolwiek błędów technicznych.

## **Kompleksowa ocena rozwiązań alternatywnych w ekosystemie Unity**

Chociaż regeneracja identyfikatorów GUID za pomocą własnego skryptu całkowicie rozwiązała potrzebę głębokiej personalizacji w Long Gil Studio, ekosystem Unity oferuje szereg architektur projektowych ukierunkowanych na zarządzanie duplikacją i rozgałęzianiem funkcji. Aby uzyskać pełny obraz architektury systemu, przeanalizowano poniższe alternatywy pod kątem ich przydatności i ograniczeń przy rozgałęzieniach na dużą skalę.

### **5.1 Rozwiązanie oparte na dziedziczeniu: Prefab Variants**

Funkcja **Prefab Variants**, wprowadzona w wersji Unity 2018.3, stanowiła duży krok naprzód w zarządzaniu wariantami obiektów względem tradycyjnego systemu Prefabów[^17]. Zasadniczym mechanizmem Prefab Variant jest to, że nie tworzy on całkowicie nowej kopii, lecz działa jako warstwa nadpisań (*override layer*) połączona bezpośrednio z Prefabem bazowym (*Base Prefab*)[^17].

Korzystając z Variants, programiści mogą zmieniać właściwości, konfigurować materiały lub dodawać i usuwać komponenty, a zmiany te zapisywane są wyłącznie w pliku Variant w postaci metadanych nadpisań (*override metadata*)[^20]. Jednocześnie, jeśli podstawowe właściwości Base Prefab zostaną zaktualizowane, zmiany te automatycznie propagują się do wszystkich potomnych Variants, które nie nadpisały danej właściwości[^22].

Poniższa tabela porównawcza uwypukla różnice między obiema filozofiami architektonicznymi w kontekście problemu rozgałęziania funkcji:

| Kryterium oceny | Metoda regeneracji GUID (Głębokie rozgałęzienie / *Deep Fork*) | Prefab Variants (Dziedziczenie względne) |
| :--- | :--- | :--- |
| **Charakter przechowywania** | Całkowicie niezależna kopia danych YAML na poziomie plików. | Przechowuje dane różnicowe (*delta overrides*) oparte na oryginale[^17]. |
| **Stopień zależności** | Poziom 0 (brak jakichkolwiek powiązań strukturalnych ze źródłem). | Wysoki (zależny od struktury węzłów Base Prefab)[^18]. |
| **Separacja kodu (Scripts)** | Pozwala rozdzielić i przepisać dwa niezależne zestawy kodu źródłowego. | Nieobsługiwane; Variant musi działać na tym samym zestawie skryptów co Base. |
| **Możliwość zmian struktury** | Pełna swoboda usuwania, dodawania i przebudowy całej hierarchii (*Hierarchy*). | Ograniczona; nie można usuwać głównych obiektów GameObject zdefiniowanych w Base Prefab[^22]. |
| **Ryzyko regresji systemu** | Praktycznie zerowe dzięki absolutnej izolacji. | Wysokie; poprawki lub zmiany w oryginale mogą nieoczekiwanie zepsuć działanie gałęzi Variant[^18]. |

**Wnioski dla projektu GilongWorld:** Choć Prefab Variants świetnie sprawdzają się przy tworzeniu wariantów rozgrywki (np. stworzenie niebieskiego przeciwnika dziedziczącego po czerwonym przeciwniku, lecz o innej liczbie punktów zdrowia)[^20], okazują się całkowicie bezużyteczne wobec wymogu rozgałęzienia w celu niezależnej personalizacji. Projekt Long Gil Studio wymagał rozdzielenia również samych skryptów kodu źródłowego (C#), czego architektura Variant nie obsługuje, ponieważ nadpisuje jedynie zmienne publiczne, a nie pozwala wskazać nowej logiki przetwarzania[^18]. Ścisłe powiązanie między węzłami grafu sprawia, że Prefab Variants stoją w sprzeczności z filozofią niezależnych modułów, jakiej wymagał analizowany problem.

### **5.2 Architektura niezależnych pakietów: Unity Package Manager (UPM) i Local Packages**

Podejściem na bardziej makroskopowym poziomie służącym ograniczaniu konfliktów referencji jest wykorzystanie **Unity Package Manager (UPM)** do budowy architektury wielopakietowej[^25]. Model ten przekształca komponenty lub funkcje w osobne pakiety deweloperskie (*development packages*), konfigurowane za pomocą pliku `package.json` i zarządzane na etapie kompilacji poprzez pliki definicji zestawów (`.asmdef`)[^26].

W scenariuszu rozgałęzienia wspólna warstwa może zostać ustrukturyzowana jako Core Package, podczas gdy Funkcja A i Funkcja B działają jako niezależne pakiety korzystające ze współdzielonego API. Unity umożliwia osadzanie pakietów lokalnych (*Local Package*) za pomocą dowiązań symbolicznych systemu plików (*symlink*), dzięki czemu katalogi kodu źródłowego mogą istnieć na dysku jako odrębne repozytoria Git całkowicie oddzielone od folderu `Assets` głównego projektu[^27]. Przy konfiguracji przez UPM zjawisko duplikowania GUID lub konflikty środowiska lokalnego są zarządzane przez menedżer pakietów Unity zamiast opierać się wyłącznie na tradycyjnym `AssetDatabase`[^28].

Wdrożenie tej architektury wymaga jednak ogromnego nakładu czasu na analizę i refaktoryzację (*refactoring*). Znakomicie sprawdza się w izolowaniu kodu źródłowego C# oraz bibliotek statycznych, ale wykazuje znacznie mniejszą elastyczność przy powielaniu dużych grup Prefabów i interfejsów UI silnie uzależnionych od plików YAML. W przypadku pilnej potrzeby operacyjnej takiej jak w Long Gil Studio rozwiązanie to generowało koszt operacyjny (*overhead*) nieproporcjonalny do natychmiastowego rezultatu.

### **5.3 Zagrożenie rozdęciem pamięci: system Addressables i pliki współdzielone**

Każda głęboka ingerencja w system GUID wymaga od inżynierów systemowych oceny wpływu na dynamiczne zarządzanie pamięcią oraz dystrybucję zasobów, szczególnie gdy projekt korzysta z **Addressable Asset System**. Addressables pełni rolę platformy zarządzania zasobami nowej generacji, eliminując twarde referencje na rzecz asynchronicznego ładowania poprzez dynamiczne ścieżki[^30].

Zidentyfikowanym ryzykiem architektonicznym przy stosowaniu techniki regeneracji GUID jest następujące zjawisko: jeśli proces rozdzieli duży blok funkcjonalności na dwa odrębne bloki, każdy powiązany zasób w tym katalogu (na przykład Texture wysokiej rozdzielczości lub plik dźwiękowy) również otrzyma nowy kod GUID[^30]. Choć dla systemu operacyjnego dwa pliki Texture zawierają ten sam obraz, system pakowania (*packing system*) w Addressables traktuje je jako dwa całkowicie niezależne byty danych o dwóch różnych identyfikatorach[^13].

Po uruchomieniu procesu budowania zawartości (*Content Build*) Unity skompresuje pierwszą kopię do paczki AssetBundle Funkcji A, a drugą kopię do AssetBundle Funkcji B. Takie powielenie prowadzi do rozdęcia pamięci (**memory bloat**), zwiększając rozmiar pobierania gry oraz marnując znaczne ilości pamięci RAM w trakcie działania aplikacji (*runtime*)[^13]. Aby wyeliminować to ryzyko, architekci muszą wydzielić obszar zasobów współdzielonych (**Shared Resources**). Przed uruchomieniem polecenia regeneracji GUID wszystkie zasoby graficzne i dźwiękowe nieposiadające logiki programistycznej powinny zostać przeniesione poza obszar przetwarzania. Pliki `.meta` tych zasobów muszą pozostać nienaruszone, aby po sklonowaniu zarówno stara, jak i nowa gałąź konfiguracyjna wskazywały na ten sam, unikalny wspólny identyfikator GUID, co gwarantuje oszczędność zasobów systemowych.

## **Rekomendacje i wnioski wyciągnięte z projektu GilongWorld**

Rozwiązanie problemu zerwanych referencji w Long Gil Studio nie sprowadzało się wyłącznie do znalezienia optymalnego skryptu, lecz stało się dowodem na to, jak kluczowe jest rozumienie protokołów działających pod powierzchnią interfejsu graficznego Unity Engine. Sieć powiązań danych w formacie YAML stanowi fundament wszelkiej interakcji obiektów, a metadane GUID są jedynym językiem pozwalającym tę sieć utrzymać[^1].

Bezpośrednia ingerencja polegająca na wygenerowaniu nowej struktury identyfikatorów (**GUID Regeneration**) obaliła błędne przekonanie o możliwości przenoszenia operacji systemu plików na zorientowaną obiektowo bazę danych, jaką jest `AssetDatabase`[^1]. Pięcioetapowy proces algorytmiczny — od analizy tekstu, przez ekstrakcję identyfikatorów, kontrolę zakresu własności i podwójne mapowanie, aż po zsynchronizowane nadpisanie — zapewnił 100% dokładności, eliminując awarie rozpadu grafu logicznego, które tak często utrudniają pracę programistom.

Na podstawie analizy tego incydentu projektanci architektury dużych gier powinni zawsze przestrzegać ustandaryzowanej procedury podczas złożonych operacji klonowania i rozgałęziania. Utworzenie czystej kopii zapasowej w systemie kontroli wersji (*version control backup*) przed masowymi operacjami zapisu na dysku jest żelazną zasadą pozwalającą uniknąć nieodwracalnej utraty danych[^7]. Jednocześnie programiści powinni uważać, aby przypadkowo nie zmienić wartości File ID plików kodu źródłowego (`.cs`) wskutek zmiany nazw przestrzeni nazw (*namespace refactoring*), ponieważ bezpośrednio niszczy to niskopoziomowe powiązanie między serializowaną konfiguracją a wykonywalnym skryptem[^4].

Sukces Long Gil Studio w znalezieniu i zastosowaniu metody regeneracji GUID nie tylko uwolnił zasoby projektu GilongWorld od tysięcy godzin ręcznej rekonfiguracji, lecz także zbudował solidny fundament techniczny umożliwiający elastyczne dostosowywanie systemu w przyszłości i sprawne odpowiadanie na potrzeby rozgałęziania projektów bez poświęcania stabilności rdzenia architektury.

---

## **Bibliografia**

[^1]: GUID Regenerator (com.jeffjadulco.guidregenerator) | OpenUPM Unity Package, [https://openupm.com/packages/com.jeffjadulco.guidregenerator/](https://openupm.com/packages/com.jeffjadulco.guidregenerator/)  
[^2]: Understanding Unity's serialization language, YAML, [https://unity.com/blog/engine-platform/understanding-unitys-serialization-language-yaml](https://unity.com/blog/engine-platform/understanding-unitys-serialization-language-yaml)  
[^3]: How to move or copy a Unity project (without breaking it) - Game Dev Beginner, [https://gamedevbeginner.com/how-to-move-or-copy-a-unity-project-without-breaking-it/](https://gamedevbeginner.com/how-to-move-or-copy-a-unity-project-without-breaking-it/)  
[^4]: Unity fileID and GUID - Unity Discussions, [https://discussions.unity.com/t/unity-fileid-and-guid/837621](https://discussions.unity.com/t/unity-fileid-and-guid/837621)  
[^5]: Question about m_Script in YAML Unity prefab format, [https://discussions.unity.com/t/question-about-m_script-in-yaml-unity-prefab-format/469197](https://discussions.unity.com/t/question-about-m_script-in-yaml-unity-prefab-format/469197)  
[^6]: YAML fileID hash function for DLL scripts - Unity Discussions, [https://discussions.unity.com/t/yaml-fileid-hash-function-for-dll-scripts/541112](https://discussions.unity.com/t/yaml-fileid-hash-function-for-dll-scripts/541112)  
[^7]: Unity asset GUIDs regenerator - GitHub Gist, [https://gist.github.com/ZimM-LostPolygon/7e2f8a3e5a1be183ac19](https://gist.github.com/ZimM-LostPolygon/7e2f8a3e5a1be183ac19)  
[^8]: Generate new GUIDs for Unity editor assets in-place. Tested working on 2019.4.31f1. Use at your peril - GitHub Gist, [https://gist.github.com/rrazgriz/1a5ab38f47a473c3272e1207bab6073f](https://gist.github.com/rrazgriz/1a5ab38f47a473c3272e1207bab6073f)  
[^9]: What is Unity GUID — How to Get & Change GUID — 2026 - Makaka Games, [https://makaka.org/unity-tutorials/guid](https://makaka.org/unity-tutorials/guid)  
[^10]: How can you duplicat folders and not share old dependencies? : r/Unity3D - Reddit, [https://www.reddit.com/r/Unity3D/comments/2jn4wk/how_can_you_duplicat_folders_and_not_share_old/](https://www.reddit.com/r/Unity3D/comments/2jn4wk/how_can_you_duplicat_folders_and_not_share_old/)  
[^11]: How can you duplicat folders and not share old dependencies? - Unity Discussions, [https://discussions.unity.com/t/how-can-you-duplicat-folders-and-not-share-old-dependencies/119815](https://discussions.unity.com/t/how-can-you-duplicat-folders-and-not-share-old-dependencies/119815)  
[^12]: jeffjadulco/unity-guid-regenerator: :id - GitHub, [https://github.com/jeffjadulco/unity-guid-regenerator](https://github.com/jeffjadulco/unity-guid-regenerator)  
[^13]: Resources folder and asset loading etiquette - Unity Discussions, [https://discussions.unity.com/t/resources-folder-and-asset-loading-etiquette/593210](https://discussions.unity.com/t/resources-folder-and-asset-loading-etiquette/593210)  
[^14]: How to make references point to the imported asset with new GUID? - Unity Discussions, [https://discussions.unity.com/t/how-to-make-references-point-to-the-imported-asset-with-new-guid/840444](https://discussions.unity.com/t/how-to-make-references-point-to-the-imported-asset-with-new-guid/840444)  
[^15]: I made a tool to regenerate GUID for Unity assets : r/Unity3D, [https://www.reddit.com/r/Unity3D/comments/gex8q5/i_made_a_tool_to_regenerate_guid_for_unity_assets/](https://www.reddit.com/r/Unity3D/comments/gex8q5/i_made_a_tool_to_regenerate_guid_for_unity_assets/)  
[^16]: Sudden "Assembly has duplicate references" on ALL imported assets - Unity Discussions, [https://discussions.unity.com/t/sudden-assembly-has-duplicate-references-on-all-imported-assets/1710510](https://discussions.unity.com/t/sudden-assembly-has-duplicate-references-on-all-imported-assets/1710510)  
[^17]: Create variations of prefabs - Unity - Manual, [https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabVariants.html](https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabVariants.html)  
[^18]: What is the difference between prefab(original) and variant prefab? - Stack Overflow, [https://stackoverflow.com/questions/58299669/what-is-the-difference-between-prefaboriginal-and-variant-prefab](https://stackoverflow.com/questions/58299669/what-is-the-difference-between-prefaboriginal-and-variant-prefab)  
[^19]: Ultimate Guide on Nested Prefab Workflows in Unity | Visual Design Cafe, [https://visualdesigncafe.com/learn/nested-prefabs](https://visualdesigncafe.com/learn/nested-prefabs)  
[^20]: Can someone explain the use case for Prefab variants - Unity Engine, [https://discussions.unity.com/t/can-someone-explain-the-use-case-for-prefab-variants/715072](https://discussions.unity.com/t/can-someone-explain-the-use-case-for-prefab-variants/715072)  
[^21]: Override prefab instances - Unity - Manual, [https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabInstanceOverrides.html](https://docs.unity3d.com/6000.4/Documentation/Manual/PrefabInstanceOverrides.html)  
[^22]: Unity Tips | Part 6 - Prefabs - Daniel Ilett, [https://danielilett.com/2020-05-16-unity-tips-6-prefabs/](https://danielilett.com/2020-05-16-unity-tips-6-prefabs/)  
[^23]: What's the incentive on using prefab variants compared to just duplicating the original prefab? : r/Unity3D - Reddit, [https://www.reddit.com/r/Unity3D/comments/p2g10m/whats_the_incentive_on_using_prefab_variants/](https://www.reddit.com/r/Unity3D/comments/p2g10m/whats_the_incentive_on_using_prefab_variants/)  
[^24]: Is it better to make multiple prefabs or a single configurable prefab? : r/unity - Reddit, [https://www.reddit.com/r/unity/comments/1iu88js/is_it_better_to_make_multiple_prefabs_or_a_single/](https://www.reddit.com/r/unity/comments/1iu88js/is_it_better_to_make_multiple_prefabs_or_a_single/)  
[^25]: Package Development | 0.5.3-exp.1 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.upm.develop@0.5/manual/index.html](https://docs.unity3d.com/Packages/com.unity.upm.develop@0.5/manual/index.html)  
[^26]: Package development workflow - Unity - Manual, [https://docs.unity3d.com/6000.4/Documentation/Manual/CustomPackages.html](https://docs.unity3d.com/6000.4/Documentation/Manual/CustomPackages.html)  
[^27]: Switching between Local and Remote packages in Unity - Jakub Slaby, [https://www.jakubslaby.com/switching-between-local-and-remote-packages-in-unity/](https://www.jakubslaby.com/switching-between-local-and-remote-packages-in-unity/)  
[^28]: Confusion About How to Create a Custom Package - Unity Discussions, [https://discussions.unity.com/t/confusion-about-how-to-create-a-custom-package/739817](https://discussions.unity.com/t/confusion-about-how-to-create-a-custom-package/739817)  
[^29]: Best practices for parallel application + package development workflow - Unity Discussions, [https://discussions.unity.com/t/best-practices-for-parallel-application-package-development-workflow/900302](https://discussions.unity.com/t/best-practices-for-parallel-application-package-development-workflow/900302)  
[^30]: Asset dependencies overview | Addressables | 2.2.2 - Unity - Manual, [https://docs.unity3d.com/Packages/com.unity.addressables@2.2//manual/AssetDependencies.html](https://docs.unity3d.com/Packages/com.unity.addressables@2.2//manual/AssetDependencies.html)  
[^31]: How to handle Addressable duplication for hybrid Scene Objects/Asset reference patterns, [https://discussions.unity.com/t/how-to-handle-addressable-duplication-for-hybrid-scene-objects-asset-reference-patterns/1704264](https://discussions.unity.com/t/how-to-handle-addressable-duplication-for-hybrid-scene-objects-asset-reference-patterns/1704264)
