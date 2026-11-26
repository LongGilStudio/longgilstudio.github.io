---
title: "Optymalizacja Wydajności i Integralności Danych Czasowych w Unity Engine: Mechanizmy Systemowe, Analiza Wąskiego Gardła DateTime.Now oraz Rozwiązanie Frame Caching"
date: 2026-09-17 03:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, datetime, csharp, dotnet, frame-caching, multithreading, anticheat]
description: Dogłębna analiza wewnętrznych mechanizmów DateTime.Now i DateTime.UtcNow w środowisku uruchomieniowym .NET, kwantyfikacja wąskiego gardła wydajności, zjawisko rozrywania czasu (temporal tearing) oraz wielowątkowo bezpieczna architektura Frame Caching w Unity Engine.
lang: pl
translation_id: unity-datetime-now-frame-caching
math: true
---

Pobieranie i przetwarzanie danych czasu rzeczywistego jest jednym z fundamentalnych, a zarazem obarczonych licznymi zagrożeniami architektonicznymi zadań w aplikacjach czasu rzeczywistego tworzonych na silniku Unity Engine[^1]. Choć struktura `System.DateTime` z biblioteki bazowej .NET (BCL) dostarcza kompletny zestaw narzędzi do obsługi kalendarza, bezpośrednie wywoływanie właściwości `System.DateTime.Now` w ciągłych pętlach aktualizacji (*hot paths*) tworzy poważne wąskie gardła wydajnościowe i narusza integralność stanu[^2].

Niniejszy raport zagłębia się w analizę wewnętrznych mechanizmów na poziomie systemu operacyjnego oraz środowiska uruchomieniowego (.NET/Mono/IL2CPP), kwantyfikuje narzut obliczeniowy na podstawie danych z profilowania, omawia zjawisko rozrywania czasu (*temporal tearing*) oraz kompleksowo ocenia rozwiązanie buforowania w obrębie klatki (*Frame Caching*) wraz z powiązanymi standardami architektonicznymi[^2].

---

## **1. Wewnętrzne Mechanizmy DateTime.Now i DateTime.UtcNow w Środowisku .NET Runtime**

Struktura `System.DateTime` jest przechowywana jako pojedyncze 64-bitowe pole wartościowe (`UInt64 _dateData`)[^6]. W tym układzie:
- **62 młodsze bity** reprezentują skumulowaną liczbę *ticków* od godziny 00:00:00 dnia 1 stycznia roku 0001 w kalendarzu gregoriańskim, przy czym każdy *tick* odpowiada $100\text{ ns}$ ($10^{-7}\text{ s}$ lub $0.1\ \mu\text{s}$)[^1].
- **2 najstarsze bity** są zarezerwowane do przechowywania flag `DateTimeKind`, pozwalających rozpoznać jeden z trzech stanów kontekstowych: `Utc`, `Local` lub `Unspecified`[^1].

### **Niskopoziomowy Przepływ Wykonania DateTime.UtcNow**

Właściwość `DateTime.UtcNow` reprezentuje uniwersalny czas koordynowany i została zaprojektowana z myślą o maksymalnej optymalizacji cykli procesora[^2]. Gdy proces odwołuje się do `DateTime.UtcNow`, środowisko uruchomieniowe .NET wykonuje bezpośredni odczyt ze sprzętowego zegara systemu[^2]:

- W systemie **Windows** kod bezpośrednio wywołuje funkcję Win32 API `GetSystemTimeAsFileTime` przez wskaźnik funkcji wewnętrznej opatrzony atrybutem pomijającym bariery optymalizacji kompilacji (`TargetedPatchingOptOut`)[^2].
- W systemach operacyjnych z rodziny **POSIX** (w tym jądro Linux na Androidzie oraz jądro Darwin na iOS/macOS) system wykonuje niskopoziomowe wywołanie `clock_gettime(CLOCK_REALTIME, ...)`[^5].

Do surowej wartości czasu zwróconej przez system operacyjny wystarczy dodać stałą wartość przesunięcia, aby zsynchronizować ją z punktem odniesienia kalendarza gregoriańskiego, a następnie zapakować bezpośrednio w strukturę `DateTime` wraz z etykietą `DateTimeKind.Utc`[^2]. Proces ten nie wymaga żadnego przeszukiwania tabel, nie alokuje pamięci na stercie i kończy się w ciągu kilku nanosekund[^2].

### **Złożony Przepływ Rozwiązywania DateTime.Now**

W przeciwieństwie do `DateTime.UtcNow`, wyznaczenie czasu lokalnego (`DateTime.Now`) wymaga całego łańcucha złożonych operacji konwersji[^2]. Właściwość `DateTime.Now` nie odczytuje ze sprzętu niezależnego zegara lokalnego; zamiast tego jest budowana całkowicie w oparciu o wynik `DateTime.UtcNow` połączony z sekwencją obliczeń przesunięcia strefy czasowej[^2]:

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

Proces ten rozpoczyna się od pobrania bieżącego czasu UTC, a następnie odpytania obiektu `TimeZoneInfo.Local` w celu ustalenia konfiguracji strefy czasowej urządzenia[^2]. Główne obciążenie zasobów spoczywa na funkcji `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc`, w której środowisko uruchomieniowe musi porównać bieżący punkt czasowy z tabelą reguł dostosowań stref czasowych (*Adjustment Rules*) oraz regułami czasu letniego (*Daylight Saving Time - DST*), aby ustalić, czy dany moment wypada w okresie przesunięcia o jedną godzinę[^2].

Po dokładnym wyznaczeniu przesunięcia w *tickach* system wykonuje dodawanie arytmetyczne do `utcNow.Ticks`, weryfikuje warunki przepełnienia zakresu i tworzy nową instancję struktury `DateTime` oznaczoną jako `DateTimeKind.Local`[^2].

Dane z profilowania wydajności pochodzące z oficjalnego repozytorium kodu źródłowego .NET Runtime przedstawiają szczegółowy rozkład czasu wykonania metody `DateTime.get_Now()`[^4]:

| Składnik Wykonania w `System.DateTime.get_Now()` | Skumulowany Udział Czasu (Inclusive %) | Techniczny Charakter Operacji |
| :--- | :---: | :--- |
| `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc` | **88.1%** | Wyszukiwanie reguł konwersji strefy czasowej, sprawdzanie flagi DST, obliczanie przesunięcia (*offset*)[^4] |
| `System.DateTime.get_UtcNow()` | **5.8%** | Wywołanie systemowe (*syscall*) odczytujące licznik sprzętowy[^2] |
| Kontrola granic i pakowanie struktury | **6.1%** | Weryfikacja przepełnienia 64-bitowej liczby całkowitej oraz nadanie etykiety `DateTimeKind.Local`[^4][^7] |

> [!IMPORTANT]
> Powyższe dane dowodzą, że sam odczyt czasu z zegara sprzętowego pochłania zaledwie **~5.8%** całkowitego kosztu wykonania, podczas gdy aż **~88.1%** czasu procesora jest zużywane na rozwiązywanie strefy czasowej oraz wyliczanie reguł czasu letniego[^4].

### **Zwiększona Złożoność w Środowiskach Mobilnych (Mono & IL2CPP)**

Na platformach mobilnych uruchamiających Unity poprzez Mono lub IL2CPP złożoność `DateTime.Now` wzrasta wielokrotnie[^5]. Podczas gdy system Windows utrzymuje scentralizowany Rejestr dla informacji o strefach czasowych, mobilne systemy operacyjne — takie jak Android — przechowują te dane w binarnej bazie danych `tzdata` (`ZoneInfoDB`), rozproszonej w katalogach systemowych takich jak `/apex/com.android.tzdata/` czy `/system/usr/share/zoneinfo`[^5].

Gdy `TimeZoneInfo.Local` jest inicjalizowane po raz pierwszy lub wymaga ponownej walidacji, środowisko Mono/IL2CPP musi wykonywać operacje wejścia/wyjścia na plikach, parsować dane binarne, a nawet realizować wywołania międzyśrodowiskowe poprzez Java Native Interface (JNI) do klasy `java.util.TimeZone` w celu pobrania identyfikatora strefy czasowej[^5].

> [!WARNING]
> Jeśli plik bazy danych stref czasowych ulegnie uszkodzeniu formatu, zostanie przeniesiony w niestandardowych wersjach ROM lub dostęp do niego zostanie ograniczony przez uprawnienia plików, wywołanie `DateTime.Now` może rzucić krytyczny wyjątek `System.TimeZoneNotFoundException`, prowadząc do nagłego zamknięcia aplikacji, jeżeli nie zostanie zabezpieczone blokami obsługi wyjątków[^10].

---

## **2. Analiza Testów Wydajności i Wpływu na Budżet Klatki**

Koszt wykonania metod pobierających czas różni się diametralnie w zależności od architektury warstwy bazowej oraz stanu pamięci podręcznej systemu operacyjnego[^5]. Poniższa tabela podsumowuje znormalizowane wyniki pomiarów wydajności pomiędzy popularnymi mechanizmami czasu w środowisku Unity oraz .NET[^4]:

| Metoda Pobierania Czasu | Szacowany Czas Wykonania | Względny Współczynnik Szybkości | Główny Mechanizm Wykonania | Ryzyko Skoku Czasu Klatki (*Frame Spike*) |
| :--- | :---: | :---: | :--- | :--- |
| `UnityEngine.Time.time` | $\sim 1\text{ - }2\text{ ns}$ | Najbardziej optymalna (natywna dla silnika) | Bezpośredni odczyt zmiennej zmiennoprzecinkowej buforowanej na początku klatki | Całkowicie brak |
| `System.DateTime.UtcNow` | $\sim 15\text{ - }20\text{ ns}$ | $\sim 15\text{ - }20\times$ szybsza niż `Now` | Bezpośredni odczyt zegara sprzętowego przez minimalne wywołanie systemowe[^2] | Pomijalne |
| `System.DateTime.Now` (Ścieżka Gorąca / *Warm Path*) | $\sim 280\text{ - }350\text{ ns}$ | Poziom bazowy odniesienia ($1\times$) | Wywołuje `UtcNow`, odpytuje pamięć podręczną strefy czasowej, wylicza przesunięcie DST[^2] | Od średniego do wysokiego przy wielokrotnym wywoływaniu |
| `System.DateTime.Now` (Ścieżka Zimna / Urządzenia Mobilne) | $\sim 1\text{ - }5\text{ ms}$ | Tysiące razy wolniejsza ($\gt 3.000\times$) | Inicjalizuje tabele `AndroidTzData`, operacje I/O dysku, parsowanie danych binarnych[^5] | Bardzo wysokie (zamrożenie klatki) |

### **Ograniczenia Budżetu Klatki w Pętli Gry**

W interaktywnych aplikacjach czasu rzeczywistego całość obciążenia — obejmująca symulację ruchu, obliczenia fizyki, przetwarzanie logiki gry oraz wysyłanie poleceń renderowania do GPU — musi zostać ukończona w skończonym przedziale czasu wyznaczonym wzorem:

$$
T_{\text{frame}} = \frac{1000\text{ ms}}{\text{Target FPS}}
$$

- Przy standardowej częstotliwości odświeżania **$60\text{ Hz}$** ($60\text{ FPS}$) budżet na każdą klatkę wynosi **$16.67\text{ ms}$**.
- Wartość ta kurczy się do zaledwie **$8.33\text{ ms}$** na ekranach o wysokiej częstotliwości odświeżania **$120\text{ Hz}$** ($120\text{ FPS}$).

Architektura kodu zawierająca liczne wywołania `DateTime.Now` rozproszone wewnątrz pętli aktualizacji bytów — takich jak liczniki czasu odnowienia umiejętności dla dziesiątek postaci niezależnych (NPC), systemy sprawdzania statusu wzmocnień czy logika weryfikacji wydarzeń w czasie rzeczywistym — kumuluje od setek do tysięcy wywołań systemowych w każdej klatce.

Przy **500 gorących wywołaniach `DateTime.Now`** na klatkę procesor zużywa około **$\sim 0.15\text{ ms}$** ($150\,\mu\text{s}$) wyłącznie na same obliczenia przesunięcia strefy czasowej, pochłaniając do **$\sim 1.8\%$** całego budżetu klatki **$120\text{ Hz}$**. To obciążenie bezpośrednio powoduje spadki liczby klatek i lokalne zacięcia obrazu, co tłumaczy, dlaczego narzędzie analizy statycznej Unity Project Auditor oznacza użycie `DateTime.Now` w ścieżkach ciągłej aktualizacji czerwonym ostrzeżeniem wysokiego priorytetu (*Major Issue*)[^3].

---

## **3. Zjawisko Rozrywania Czasu (*Temporal Tearing*) i Błędy Integralności Danych**

Poza degradacją wydajności CPU rozpraszanie wywołań `DateTime.Now` w celu wydobycia poszczególnych składników znacznika czasu prowadzi do poważnego błędu atomowości danych (*Data Atomicity*). Pierwotny kod wpada w tę pułapkę podczas wykonywania niezależnych porównań:

```csharp
if (requirement.CheckYear)   results.Add(DateTime.Now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(DateTime.Now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(DateTime.Now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(DateTime.Now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(DateTime.Now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(DateTime.Now.Second == requirement.Second);
```

### **Mechanizm Powstawania Anomalnych Stanów Hybrydowych**

Z natury właściwość `DateTime.Now` jest wywołaniem metody generującym stan zależny od czasu obiektywnego w momencie wywołania, a nie statycznym polem danych[^20]. Za każdym razem, gdy kod odwołuje się do podrzędnej właściwości takiej jak `.Year`, `.Month` czy `.Day`, system przeprowadza zupełnie nowy cykl odpytania systemu operacyjnego[^2].

Choć odstęp pomiędzy kolejnymi liniami instrukcji trwa zaledwie kilka mikrosekund, wątek wykonania może zostać wywłaszczony przez mechanizm wielozadaniowego podziału czasu planisty systemu operacyjnego albo moment wykonania może przypadkowo trafić dokładnie na naturalną granicę przeskoku zegara systemowego[^8].

> [!CAUTION]
> **Scenariusz Błędu na Granicy Czasowej (Boundary Edge-Case):**  
> Załóżmy, że wątek wykonuje instrukcję sprawdzającą miesiąc dokładnie o godzinie `23:59:59.999` dnia 31 sierpnia 2024 roku. Właściwość `DateTime.Now.Month` zostaje obliczona dla tego momentu i zwraca wartość **sierpień (8)**.  
>  
> Natychmiast po zakończeniu tej instrukcji, a tuż przed wykonaniem kolejnego sprawdzenia dnia, zegar systemowy przechodzi na `00:00:00.000` dnia 1 września 2024 roku. Gdy uruchamia się linia `DateTime.Now.Day`, system operacyjny dostarcza nowy znacznik czasu i właściwość zwraca wartość **dzień 1**.  
>  
> W rezultacie logika systemu rejestruje hybrydowy, błędny stan: **1 sierpnia** — moment, który nigdy nie istniał w fizycznym biegu czasu!

Jeżeli taki przekłamany znacznik czasu jest wykorzystywany do uruchamiania wydarzeń ograniczonych czasowo, weryfikacji nagród za codzienne logowanie czy rejestrowania transakcji w grze, rozbieżność ta może złamać logikę warunków, nieumyślnie zablokować funkcje lub pozwolić graczom na wielokrotne odebranie tej samej nagrody.

---

## **4. Ocena Techniczna Rozwiązania Frame Caching**

Aby całkowicie wyeliminować zbędny koszt obliczeniowy oraz trwale zapobiec rozrywaniu czasu, optymalnym rozwiązaniem jest zastosowanie wzorca buforowania w obrębie klatki (*Frame Caching / Per-frame Memoization*), wykorzystującego licznik klatek silnika Unity Engine (`UnityEngine.Time.frameCount`) jako klucz unieważniania danych[^22].

### **Analiza Przepływu Działania Pamięci Podręcznej Klatki**

Implementacja mechanizmu buforowania ma następującą strukturę:

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

Gdy logika sprawdzania czasu musi pobrać bieżącą chwilę, znacznik czasu zapisywany jest jednorazowo w zmiennej lokalnej i używany we wszystkich kolejnych sprawdzeniach:

```csharp
DateTime now = GetCurrentSystemTime();  
if (requirement.CheckYear)   results.Add(now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(now.Second == requirement.Second);
```

Mechanizm ten przynosi dwie kluczowe korzyści:

1. **Obniżenie złożoności obliczeniowej:** Redukcja ze złożoności liniowej $\mathcal{O}(N)$ zależnej od liczby obiektów do stałego poziomu $\mathcal{O}(1)$ na każdą renderowaną klatkę. Każde zapytanie występujące po pierwszym wywołaniu w obrębie tej samej klatki odczytuje bezpośrednio wartość 64-bitowej struktury `DateTime` zapisaną w pamięci statycznej, całkowicie eliminując koszt wywołań systemu operacyjnego i obliczeń strefy czasowej[^2].
2. **Zachowanie atomowości migawki czasu (*Snapshot Atomicity*):** Zmienna `now` pełni rolę niezmiennego wycinka czasu dla całej klatki, gwarantując, że wszystkie składowe — od roku aż po sekundę — są wzajemnie spójne i odporne na przerwania planisty systemowego.

### **Analiza Ograniczeń Brzegowych i Ryzyka przy Wdrożeniu Produkcyjnym**

Choć buforowanie w obrębie klatki całkowicie rozwiązuje problem w głównym wątku Unity, zastosowanie go w rozbudowanych architekturach oprogramowania wymaga uważnego rozważenia trzech istotnych ograniczeń technicznych:

1. **Powiązanie z wątkiem głównym (Main Thread Affinity):** Właściwość `UnityEngine.Time.frameCount` jest wewnętrznym API warstwy C++ silnika, ściśle powiązanym z wątkiem głównym[^24]. Jeśli proces działający w tle — taki jak wątek zadania `Task.Run`, asynchroniczne wywołanie sieciowe czy zadanie w systemie C# Job System — wywoła metodę `GetCurrentSystemTime()`, Unity natychmiast rzuci wyjątek `UnityException: get_frameCount can only be called from the main thread` i przerwie wykonanie[^24].
2. **Rozbieżność rytmu między Update a FixedUpdate:** Cykl życia wykonania w Unity zawiera dwie niezależne pętle aktualizacji: pętlę renderowania grafiki (`Update`) oraz pętlę symulacji fizyki o stałym kroku czasowym (`FixedUpdate`)[^25]. Wartość `Time.frameCount` jest zwiększana o jeden przez silnik wyłącznie przy przejściu do nowej klatki renderującej[^22]. W sytuacji spadku płynności na urządzeniu klienta silnik może zostać zmuszony do wywołania wielu kolejnych cykli `FixedUpdate` w ramach jednej klatki renderującej, aby nadrobić postęp symulacji fizycznej[^23]. Wówczas wszystkie kroki `FixedUpdate` zachodzące w tej samej klatce odczytają tę samą zbuforowaną wartość `_cachedSystemTime`, co może nie odzwierciedlać upływu czasu pomiędzy następującymi po sobie krokami symulacji fizyki[^26].
3. **Ryzyko wyścigu danych (*Data Race*):** Dostęp do statycznych pól globalnych `_cachedSystemTime` i `_lastSystemTimeFrame` bez barier pamięciowych (*Memory Barriers*) lub blokad synchronizujących naraża kod na konflikty danych, jeśli wątki poboczne odczytują lub zapisują równocześnie na wielordzeniowych procesorach stosujących wykonywanie poza kolejnością (*out-of-order execution*).

### **Implementacja Wielowątkowo Bezpiecznego Dostawcy Czasu (Thread-Safe)**

Aby wyeliminować wszystkie wymienione ograniczenia techniczne, system dostarczania czasu należy ustandaryzować w formie wyspecjalizowanej usługi potrafiącej rozpoznawać kontekst wątku wykonania, zapewniać bezpieczeństwo dostępu i automatycznie obsługiwać przypadki brzegowe:

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

Architektura ta gwarantuje, że wątek główny zawsze korzysta z buforowania klatkowego bez zbędnego narzutu obliczeniowego, podczas gdy wątki poboczne oraz tryb edycji w Edytorze zachowują pełną stabilność działania dzięki mechanizmowi bezpośredniego odczytu awaryjnego, całkowicie eliminując ryzyko rzucenia wyjątku naruszenia dostępu do wątku silnika[^24].

---

## **5. Standardy Rozgraniczania Domen Czasowych w Architekturze Silników Gier**

Powszechnym błędem przy tworzeniu gier jest łączenie różnych celów pomiaru czasu w jednym API systemowym[^2]. Aby utrzymać maksymalną wydajność oraz spójność stanu gry, architektura systemu powinna wyznaczyć wyraźne granice między niezależnymi domenami czasowymi:

| Domena Czasowa (*Time Domain*) | Zalecane Standardowe API | Główne Przypadki Użycia | Ryzyko Przy Użyciu Niewłaściwego API |
| :--- | :--- | :--- | :--- |
| **Wewnętrzna Symulacja Rozgrywki** | `UnityEngine.Time.time`, `Time.deltaTime` | Obliczanie współrzędnych fizycznych, ruch postaci, czas odnowienia umiejętności | Zatrzymuje się podczas pauzy gry (`timeScale = 0`); traci dokładność, gdy potrzebny jest czas rzeczywisty[^26] |
| **Prezentacja Interfejsu w Czasie Rzeczywistym** | `UnityEngine.Time.unscaledTime`, `Time.realtimeSinceStartup` | Animacje menu interfejsu (UI), efekty przejść podczas wstrzymania rozgrywki | Ściśle powiązana z sesją procesu klienta; nie da się jej odwzorować na kalendarz świata rzeczywistego |
| **Pomiar Wydajności Algorytmów** | `System.Diagnostics.Stopwatch` | Pomiar czasu wykonania algorytmów, profilowanie bloków kodu, wykrywanie regresji wydajności[^7] | Rozdzielczość `DateTime.Now` wynosi jedynie $\sim 15.6\text{ ms}$, co jest wartością zbyt niską do benchmarków[^7] |
| **Weryfikacja Logiki Anty-Oszustwowej** | Znacznik Unix Epoch (UTC) zsynchronizowany z serwerem[^28] | Systemy energii, czas otwierania skrzyń, okna czasowe wydarzeń sieciowych[^28] | Zaufanie zegarowi klienta pozwala graczom manipulować czasem systemu operacyjnego w celu zdobycia korzyści[^28] |
| **Wyświetlanie Kalendarza Lokalnego** | `SystemTimeProvider.CurrentLocalTime` | Prezentacja rzeczywistego czasu lokalnego użytkownika na pasku stanu UI[^2] | Powoduje przycięcia obrazu przy ciągłym wywoływaniu niebuforowanego `DateTime.Now`[^2] |

### **Mechanizm Synchronizacji Czasu Serwera i Zapobiegania Oszustwom (Anti-Cheat)**

W grach posiadających funkcje sieciowe umożliwienie klientowi samodzielnej weryfikacji czasu wykonania akcji na podstawie lokalnego `DateTime.Now` lub `DateTime.UtcNow` tworzy poważną lukę bezpieczeństwa[^28]. Użytkownik może łatwo zmienić ustawienia zegara w systemie operacyjnym, aby przyspieszyć odliczanie budowy lub odnowić dzienne limity aktywności[^28].

Standardowa architektura neutralizująca tego typu nadużycia wymaga utworzenia przez klienta wirtualnego zegara opartego na zegarze monotonicznym (*monotonic clock*)[^5]:

1. **Wysłanie zapytania synchronizującego:** Gdy klient nawiązuje połączenie sieciowe, wysyła zapytanie synchronizacji czasu do serwera usługowego, otrzymując wzorcowy znacznik czasu Unix Epoch w standardzie UTC[^28].
2. **Pomiar opóźnienia w obie strony:** Klient rejestruje czas podróży pakietu w obie strony ($RTT$) i szacuje wzorcowy czas serwera w momencie dotarcia odpowiedzi według wzoru:
   $$T_{\text{server}} = T_{\text{server\_reply}} + \frac{RTT}{2}$$
3. **Wyznaczenie stałego przesunięcia monotonicznego:** Klient wylicza i zapisuje stałą różnicę względem sprzętowego licznika monotonicznego:
   $$\Delta t = T_{\text{server}} - \text{Time.realtimeSinceStartupAsDouble}$$
4. **Odczyt czasu odpornego na oszustwa:** Przez cały cykl życia aplikacji wszelka logika rozgrywki wymagająca weryfikacji czasu rzeczywistego pobiera po prostu wartość:
   $$\text{CurrentRealTime} = \text{Time.realtimeSinceStartupAsDouble} + \Delta t$$
   Ponieważ licznik czasu od uruchomienia silnika korzysta ze sprzętowego zegara monotonicznego (`clock_gettime(CLOCK_MONOTONIC)` lub `QueryPerformanceCounter`), wartość ta rośnie ściśle liniowo i jest całkowicie odporna na wszelkie próby zmiany zegara kalendarzowego systemu operacyjnego[^5].

### **Przejście Architektoniczne na Nowoczesny Standard z TimeProvider (.NET 8+)**

Począwszy od wersji .NET 8, firma Microsoft formalnie przeprojektowała model zarządzania czasem, wprowadzając klasę abstrakcyjną `System.TimeProvider`, mającą w pełni zastąpić bezpośrednie wywołania statyczne takie jak `DateTime.Now` czy `DateTime.UtcNow`[^20]. W nowoczesnych projektach Unity, korzystając z pakietu zgodności `Microsoft.Bcl.TimeProvider`, programiści mogą wdrożyć tę architekturę, aby zwiększyć modularność kodu źródłowego[^32]:

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

Przejście na ten model abstrakcji przynosi dwie istotne korzyści inżynieryjne:

> [!TIP]
> 1. **Izolowane Testy Jednostkowe (Unit Testing):** Umożliwia pełne stosowanie testów jednostkowych[^20]. Inżynierowie mogą wstrzyknąć do logiki biznesowej obiekt pozorowany `FakeTimeProvider`, aby precyzyjnie zasymulować przeskoki przez złożone granice czasowe (np. zmianę czasu na letni DST czy noc sylwestrową) bez czekania na upływ czasu rzeczywistego i bez ingerencji w zegar systemu[^20].  
> 2. **Bezpieczny typ danych `DateTimeOffset`:** Metoda `GetLocalNow()` zwraca strukturę `DateTimeOffset` zamiast `DateTime`[^20]. Struktura `DateTimeOffset` trwale zapisuje moment w czasie wraz z jawnym przesunięciem strefowym (*offset*), całkowicie eliminując niejednoznaczność flagi `DateTimeKind.Unspecified` i gwarantując integralność danych podczas serializacji sieciowej[^1].

---

## **5. Praktyka Wdrożeniowa: Optymalizacja Systemu RequirementsManager (Studium Przypadku)**

W ramach rzeczywistego projektu wykorzystującego framework RPG Builder (Projekt GLW) wykryto poważny problem wydajnościowy w klasie `RequirementsManager.cs`. Konkretnie system sprawdzający warunki czasowe gry (np. wymóg wystąpienia wydarzenia w określonym miesiącu, dniu i o danej godzinie) wielokrotnie i niezależnie wywoływał `DateTime.Now`:

```csharp
if(requirement.CheckYear) results.Add(DateTime.Now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(DateTime.Now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(DateTime.Now.Day == requirement.Day);
// ... Powtórzenie dla Hour, Minute, Second
```

**Problemy zidentyfikowane w starszym kodzie:**
1. **Ogromny narzut na CPU:** Aby zweryfikować pojedynczy warunek (*requirement*), system potrafił wywołać `DateTime.Now` od 7 do 10 razy (wliczając metody pomocnicze takie jak `GetWeekNumber()`). Przy 100 obiektach sprawdzanych jednocześnie skutkowało to tysiącami wywołań systemowych w każdej klatce, tworząc dotkliwe wąskie gardło.
2. **Rozrywanie Czasu (*Temporal Tearing*):** Jeśli przejście pomiędzy sekundami (albo minutami czy dniami) wypadło dokładnie w trakcie powyższych odczytów (np. w 999. milisekundzie), zmienna `Month` mogła zostać pobrana ze starego miesiąca, natomiast `Day` już z nowego dnia. W rezultacie gra składała datę całkowicie nieistniejącą w rzeczywistości.

**Rozwiązanie wdrożone w produkcji (Per-Frame Caching):**
Architekturę Frame Caching zintegrowano bezpośrednio, wykorzystując `Time.frameCount` jako flagę unieważniania pamięci podręcznej (*cache invalidation*). Podejście to opiera się na statycznym cyklu życia zamiast pętli `Update`:

```csharp
private static DateTime _cachedSystemTime;
private static int _lastSystemTimeFrame = -1;

private static DateTime GetCurrentSystemTime()
{
    if (Application.isPlaying) 
    {
        int currentFrame = Time.frameCount;
        
        // Pobierz rzeczywisty czas z systemu OS tylko raz na klatkę
        if (_lastSystemTimeFrame != currentFrame)
        {
            _lastSystemTimeFrame = currentFrame;
            _cachedSystemTime = DateTime.Now; 
        }
        
        return _cachedSystemTime;
    }
    return DateTime.Now; // Tryb Edytora
}
```

W miejscu przetwarzania logiki wszystkie warunki odwołują się do jednej **migawki (*snapshot*)** czasu:

```csharp
DateTime now = GetCurrentSystemTime();
if(requirement.CheckYear) results.Add(now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(now.Day == requirement.Day);
```

**Rezultaty po optymalizacji (Poprawka `MOD-RPGB-008`):**
- **Całkowita eliminacja zbędnych wywołań systemowych:** Zamiast tysięcy wywołań `DateTime.Now` zostało ograniczone do poziomu $\mathcal{O}(1)$ — dokładnie jednego razu dla wszystkich obliczeń w danej klatce.
- **Absolutna spójność atomowa:** Pola `Year`, `Month` oraz `Day` z całą pewnością pochodzą z tego samego ułamka sekundy.
- **Czysty raport Unity Project Auditor:** Całkowicie usunięto ostrzeżenie „Major” dotyczące wydajności systemu powiązane z `System.DateTime`.

---

## **6. Podsumowanie**

Bezpośrednie stosowanie `System.DateTime.Now` w pętlach aktualizacji o wysokiej częstotliwości w silniku Unity Engine stanowi poważny problem inżynieryjny zarówno pod względem wydajności sprzętowej, jak i integralności logiki danych[^3].

- Złożona natura wywołań systemowych rozwiązujących strefy czasowe oraz weryfikujących reguły czasu letniego (DST) pochłania ponad **88%** czasu wykonania tej właściwości, wywierając bezpośrednią presję na budżet klatki silnika gry[^4].
- Jednocześnie odpytywanie wielu właściwości składowych przez oddzielne wywołania `DateTime.Now` otwiera podatność na rozrywanie czasu (*temporal tearing*), prowadząc do powstawania hybrydowych znaczników czasu i psucia logiki gry[^21].

Rozwiązanie oparte na buforowaniu w obrębie klatki (**Frame Caching**) w połączeniu z właściwością `Time.frameCount` definitywnie rozwiązuje oba te problemy, redukując narzut CPU do stałego minimum **$\mathcal{O}(1)$** na klatkę oraz gwarantując niezmienną atomowość migawek czasowych[^22].

Przy wdrażaniu w projektach komercyjnych architekturę tę należy uzupełnić o warstwę ochrony wątku głównego (`SystemTimeProvider`), połączyć ją ściśle z autorytatywną weryfikacją czasu po stronie serwera (*Server-Authoritative Time*) w celu przeciwdziałania oszustwom oraz dążyć do standaryzacji przy użyciu abstrakcji `TimeProvider`, aby w pełni spełniać współczesne standardy inżynierii oprogramowania[^20].

---

## **Bibliografia**

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