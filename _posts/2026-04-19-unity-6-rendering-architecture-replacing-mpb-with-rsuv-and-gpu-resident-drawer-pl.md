---
title: "Architektura renderowania w Unity 6: Rezygnacja z MPB na rzecz RSUV i GPU Resident Drawer"
date: 2026-04-19 12:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, rendering, optimization, shaders, dots, longgilstudio]
description: "Kompleksowa analiza przejścia architektonicznego z MaterialPropertyBlock na RSUV i GPU Resident Drawer w celu osiągnięcia wydajności klasy AAA w Unity 6."
lang: pl
translation_id: unity6-material-rsuv-grd
math: true
---

## **Streszczenie wykonawcze (Executive Summary)**

Przejście na Unity 6 oznacza fundamentalną zmianę architektoniczną w sposobie, w jaki potoki renderowania (*render pipelines*) przetwarzają duże ilości instancjonowanej geometrii. W historii tworzenia gier optymalizacja wielu obiektów współdzielących jeden materiał, ale wymagających indywidualnych wariantów właściwości (takich jak zmiana barwy — *color tints*), zazwyczaj opierała się na interfejsie programowania aplikacji (API) `MaterialPropertyBlock` (MPB) w połączeniu ze standardowym systemem GPU Instancing. Jednak dogłębna analiza Universal Render Pipeline (URP) i High Definition Render Pipeline (HDRP) w Unity 6 pokazuje, że to starsze podejście (*legacy*) nie jest już optymalną ścieżką, a w wielu przypadkach powoduje poważny spadek wydajności.

Ocena dostarczonego szkicu dokumentu dla „Long Gil Studio DevLog” ujawnia mieszankę tradycyjnej teorii optymalizacji, która była trafna w starszych wersjach, oraz poważnego niezrozumienia nowoczesnych funkcji renderowania w Unity 6. W szczególności zalecenie w szkicu dotyczące stosowania `MaterialPropertyBlock` stoi w bezpośredniej sprzeczności z nową technologią **GPU Resident Drawer (GRD)** w Unity 6 oraz leżącym u jej podstaw API **BatchRendererGroup (BRG)**.[^1] Aby osiągnąć maksymalną wydajność renderowania, programiści muszą zastosować **Renderer Shader User Value (RSUV)** lub w pełni przejść na **Data-Oriented Technology Stack (DOTS)**.[^3]

Niniejszy raport badawczy przedstawia wyczerpującą analizę wąskich gardeł renderowania, mechanizmów działania Scriptable Render Pipeline (SRP) Batchera, systemowych konsekwencji duplikacji materiałów oraz nowoczesnych wzorców wymaganych do osiągnięcia wydajności renderowania klasy AAA w Unity 6. Ponadto raport zawiera poprawiony, profesjonalnie zredagowany artykuł techniczny do publikacji na Long Gil Studio DevLog.

## **Część I: Techniczna ocena oryginalnego szkicu Long Gil Studio**

Pierwotny szkic przedstawia bardzo konkretny problem renderowania: optymalizację sceny (*Scene*) zawierającej niezliczoną liczbę identycznych obiektów współdzielących pojedynczy materiał, lecz wymagających indywidualnych modyfikacji koloru. Szkic trafnie identyfikuje błędne wzorce projektowe (*anti-patterns*), ale wskazuje rozwiązanie, które obniża wydajność w kontekście architektury Unity 6.

### **Trafne punkty oryginalnego szkicu**

1. **Kara za duplikację materiałów (Material Duplication):** Szkic słusznie zauważa, że tworzenie oddzielnych instancji materiału dla każdego obiektu (np. poprzez `GetComponent<Renderer>().material.color`) prowadzi do rozrostu pamięci (*memory bloat*) i całkowicie niszczy grupowanie wywołań rysowania (*draw call batching*).[^5] Odwołanie się do właściwości `.material` zmusza silnik Unity do cichego sklonowania tego materiału, trwale odbierając systemom SRP Batcher lub GPU Instancing możliwość zgrupowania tych obiektów w ramach jednego wywołania SetPass.[^5]
2. **Mechanizm MaterialPropertyBlock (MPB):** Szkic poprawnie określa, że MPB działa jak bufor nadpisujący dane (*data override buffer*), pozwalając rendererowi przekazywać właściwości dla poszczególnych instancji (*per-instance*) do GPU bez tworzenia nowej kopii materiału.[^7]
3. **Właściwości tekstowe (String) a identyfikatory całkowite (Integer IDs):** Szkic trafnie podkreśla opóźnienia po stronie jednostki centralnej (CPU) wynikające z używania łańcuchów znaków do wyszukiwania właściwości shadera, opowiadając się za wcześniejszą inicjalizacją identyfikatorów całkowitych za pomocą `Shader.PropertyToID()` w celu optymalizacji pętli.[^7]

### **Poważne nieścisłości i przestarzałe paradygmaty**

1. **MPB jako „standard AAA” w Unity 6:** Najpoważniejszym błędem oryginalnego szkicu jest twierdzenie, że MPB stanowi optymalne rozwiązanie „AAA” dla Unity 6. Choć MPB był standardem w Built-In Render Pipeline (starszej architekturze), w nowoczesnych architekturach SRP działa jak czynnik destrukcyjny.[^8] Zastosowanie MPB na obiekcie GameObject natychmiast wyklucza ten obiekt z potoku SRP Batchera.[^10]
2. **Poleganie na starszym GPU Instancing:** Szkic przyznaje, że MPB łamie SRP Batcher i proponuje wykorzystanie tradycyjnego GPU Instancing jako rozwiązania awaryjnego. Choć technicznie jest to możliwe przez ręczne zerwanie zgodności z SRP i włączenie Instancingu, zmusza to silnik do ominięcia wysoce zoptymalizowanej architektury SRP.[^12]
3. **Pominięcie GPU Resident Drawer (GRD):** Unity 6 wprowadza GPU Resident Drawer — system przenoszący generowanie wywołań rysowania (*draw calls*) do *compute shaderów*, co redukuje narzut CPU nawet o 50%.[^14] Obecność `MaterialPropertyBlock` kategorycznie zabrania obiektowi GameObject udziału w GRD.[^1] Zalecanie MPB w Unity 6 w praktyce uniemożliwia projektom korzystanie z najpotężniejszej nowej funkcji optymalizacyjnej silnika.
4. **Brak wzmianki o Renderer Shader User Value (RSUV):** Wprowadzony w Unity 6.3 LTS mechanizm RSUV stanowi bezpośredni architektoniczny zamiennik MPB przy obsłudze prostych wariantów dla poszczególnych obiektów.[^15] RSUV pozwala przekazać do shadera 24-bitową liczbę całkowitą dla każdego renderera bez łamania SRP Batchera ani GPU Resident Drawera.[^3]

## **Część II: Podstawowa analiza wąskich gardeł (Bottlenecks) w renderowaniu**

Aby zrozumieć, dlaczego konkretne wywołania API niszczą płynność klatek (*frame rate*), należy zbadać model komunikacji między jednostką centralną (CPU) a procesorem graficznym (GPU). Współczesna architektura sprzętowa wymaga ścisłej, lecz wrażliwej na opóźnienia synchronizacji między tymi dwoma procesorami.

### **Narzut komunikacji CPU-GPU (Overhead)**

Proces renderowania jednej klatki wymaga od CPU przeiterowania po wszystkich widocznych obiektach w zasięgu kamery (*frustum culling*), określenia właściwości ich materiałów, powiązania (*bind*) potrzebnych tekstur i shaderów w pamięci GPU oraz wydania polecenia rysowania (*draw command*). Najbardziej kosztowną operacją w tym potoku nie jest rysowanie wielokątów (*polygons*) przez GPU, lecz obowiązkowe zmiany stanu przed wywołaniem rysowania — określane powszechnie jako wywołania **SetPass**.[^5]

Za każdym razem, gdy CPU napotyka nowy materiał, musi wstrzymać potok renderowania, aby przesłać nowe parametry do GPU.[^18] Jeśli scena zawiera 10 000 przeciwników, a każdy z nich ma unikalną instancję materiału w celu uzyskania innego koloru pancerza, CPU musi wykonać 10 000 zmian stanu. Powoduje to ogromny narzut CPU (*CPU Overhead*), prowadząc do wąskiego gardła, w którym GPU czeka bezczynnie na instrukcje z CPU.

### **Fragmentacja pamięci wywołana właściwością `.material`**

Gdy skrypt odwołuje się do `Renderer.material` w celu zmiany koloru, silnik musi chronić integralność pierwotnie współdzielonego zasobu (*asset*). Wykonuje wtedy wewnętrznie operację `Instantiate()` na tym materiale. Wiąże się to z dwiema poważnymi karami wydajnościowymi:

1. **Zniszczenie batchingu:** Obiekt przestaje współdzielić referencję do materiału z innymi podobnymi obiektami. Unity natychmiast zatrzymuje wszelkie formy Static Batchingu, Dynamic Batchingu czy SRP Batchingu dla tego obiektu.[^5] Karta graficzna musi przetwarzać go jako całkowicie niezależny byt.
2. **Odśmiecanie pamięci (Garbage Collection) i wycieki pamięci (Memory Leaks):** Nowo utworzona kopia materiału trafia na zarządzaną stertę (*Heap*) języka C#. Nie zostaje ona automatycznie usunięta przez mechanizm zbierania śmieci po zniszczeniu obiektu. Dopóki programista jawnie nie wywoła `Destroy(renderer.material)`, pamięć pozostaje zaalokowana. Prowadzi to do wycieków pamięci, zmuszając Garbage Collector (GC) do uruchamiania fazy *Mark-and-Sweep*, co wywołuje dotkliwe przycięcia (*spikes*) i gwałtowne spadki FPS.[^5]

## **Część III: Architektura SRP Batchera i przestarzałość tradycyjnego GPU Instancing**

Scriptable Render Pipeline (SRP) fundamentalnie zreorganizował sposób, w jaki Unity zarządza danymi shaderów. Zrozumienie SRP Batchera jest kluczowe, aby pojąć, dlaczego stare techniki optymalizacji zawodzą całkowicie w Unity 6.

### **Mechanizm działania SRP Batchera**

W starszych potokach (*Built-in*) materiały przesyłały dane do GPU poprzez oddzielne zmienne jednorodne (*separate uniform variables*). SRP Batcher zastępuje tę metodę, wykorzystując duże, trwałe bufory GPU zwane Buforami Stałych (**Constant Buffers - CBUFFERs**).[^11]

Architektura SRP wymusza na shaderach rozdzielenie zmiennych na dwa osobne bloki buforów 11:

* `UnityPerMaterial`: CBUFFER przechowujący właściwości współdzielone przez wszystkie obiekty korzystające z tego samego materiału (np. kolor bazowy, mapy metaliczności — *metallic maps*, gładkość).
* `UnityPerDraw`: CBUFFER przechowujący właściwości unikalne dla konkretnego wywołania rysowania (np. macierze transformacji przestrzennej obiektu — *transformation matrices*).

Ponieważ bufor `UnityPerMaterial` utrzymuje się stale w pamięci GPU, CPU nie musi już przesyłać właściwości materiału w pętli renderowania, o ile kolejne obiekty korzystają z tego samego wariantu shadera (*shader variant*).[^18] SRP Batcher musi jedynie powiązać (*bind*) ten trwały bufor i zaktualizować znacznie mniejszy bufor `UnityPerDraw`. Taka konstrukcja znacząco obniża narzut CPU, przyspieszając niekiedy renderowanie od 1,2x do 4x.[^21]

### **Zasadnicza sprzeczność z `MaterialPropertyBlock`**

API `MaterialPropertyBlock` zostało pierwotnie zaprojektowane do nadpisywania właściwości materiału na poziomie renderera. Jednak ponieważ SRP Batcher opiera się na ścisłym rozdziale i trwałości CBUFFERa `UnityPerMaterial`, wstrzyknięcie MPB bezpośrednio narusza ten układ pamięci.[^8]

Po zastosowaniu MPB Unity nie może już zagwarantować, że trwały bufor materiału jest stosowany jednolicie do danego obiektu. W efekcie silnik jest zmuszony do gwałtownego usunięcia obiektu z potoku SRP Batchera.[^9] Oficjalna dokumentacja Unity potwierdza to jednoznacznie: „Należy pamiętać, że ta funkcja nie jest zgodna z SRP Batcherem. Użycie MPB w URP lub HDRP najprawdopodobniej doprowadzi do spadku wydajności”.[^8]

### **Starsze rozwiązanie awaryjne: `Graphics.DrawMeshInstanced`**

W przeszłości, jeśli programista potrzebował ogromnej liczby wariantów (np. lasu złożonego z drzew o różnych kolorach), akceptował utratę SRP Batchera i wracał do GPU Instancing.[^12] Wymagało to ręcznego złamania zgodności shadera z SRP poprzez zadeklarowanie właściwości poza buforem `UnityPerMaterial` oraz włączenie opcji „Enable GPU Instancing” w materiale.[^13]

Choć GPU Instancing zmniejsza liczbę wywołań rysowania przez przesyłanie tablic macierzy transformacji i danych o kolorach, wiąże się z poważnymi ograniczeniami.[^12] Słabo radzi sobie z dużym nadrysowaniem (*overdraw*), wymaga identycznych siatek (*meshes*) i nakłada na CPU ciężkie zadanie zbierania oraz przesyłania tablic instancji (*instance arrays*) w każdej klatce. W Unity 6 podejście to zostało całkowicie zastąpione przez architekturę GPU Resident Drawer.[^23]

## **Część IV: Niezgodność `MaterialPropertyBlock` (MPB) z ekosystemem Unity 6**

Głębsza analiza MPB pokazuje, że nie tylko łamie ono SRP Batcher, ale powoduje również ryzyko strukturalne dla narzędzi debugowania (*debugging tools*) oraz systemów oświetlenia (*lighting systems*) w Unity 6.

### **Wpływ na dane Lightmap i Global Illumination**

Jedną z najrzadziej wspominanych konsekwencji niewłaściwego użycia MPB jest skasowanie danych Lightmap. Gdy tworzysz `new MaterialPropertyBlock()` i przypisujesz go przez `Renderer.SetPropertyBlock()`, przekazany blok właściwości całkowicie nadpisuje lokalny stan renderera.[^24]

Jeśli obiekt korzysta z wypalonego (*baked*) systemu Global Illumination (GI), informacje o współrzędnych UV mapy oświetlenia (*Lightmap*) oraz współczynnikach *Light Probe* są przechowywane niejawnie właśnie w bloku właściwości renderera.[^24] Jeśli przed ustawieniem koloru nie wywołasz `Renderer.GetPropertyBlock(block)`, przypadkowo wymażesz dane oświetlenia obiektu. Choć oryginalny szkic Long Gil Studio poprawnie obsłużył `GetPropertyBlock`, samo wielokrotne wywoływanie tego API dla tysięcy obiektów wprowadza niemałe dodatkowe opóźnienie CPU.

| Technika optymalizacji | Powoduje wyciek RAM | Zgodność z SRP Batcher | Zgodność z GRD | Zgodność z DOTS | Zalecane zastosowanie |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`Material.color`** | Tak | Nie | Nie | Nie | Unikać za wszelką cenę |
| **`MaterialPropertyBlock`** | Nie | Nie | Nie | Nie | Starsze projekty Built-in |
| **GPU Instancing** | Nie | Nie (Konflikt) | Nie | Nie | Unity 2020-2022 |
| **Renderer Shader User Value** | Nie | Tak | Tak | Tak | Standard Unity 6.3+ |

Jak pokazuje powyższa tabela, MPB jest obecnie techniką minionej generacji. Rozwiązuje problem pamięci RAM, ale psuje cały nowoczesny potok renderowania Unity 6.

## **Część V: Przełom architektoniczny: GPU Resident Drawer (GRD) i `BatchRendererGroup` (BRG)**

Unity 6 wprowadza rewolucyjną ścieżkę renderowania: **GPU Resident Drawer**. System ten zmienia paradygmat z generowania wywołań rysowania sterowanego przez CPU na wysoce autonomiczną pętlę renderowania sterowaną przez GPU.[^1]

### **Architektura GPU Resident Drawer**

GPU Resident Drawer działa w oparciu o niskopoziomowe API `BatchRendererGroup` (BRG).[^1] Zamiast tego, by CPU oceniało widoczność obiektów (*frustum culling*) i wysyłało pojedyncze lub instancjonowane wywołania rysowania, CPU przesyła wszystkie dane przestrzenne i materiałowe sceny do GPU.[^25] Następnie *compute shadery* wykonują odrzucanie obiektów poza kamerą, odrzucanie obiektów zasłoniętych (*occlusion culling*) oraz generowanie wywołań rysowania w całości na GPU.[^14]

Wzrost wydajności jest imponujący. Dzięki zastosowaniu renderowania pośredniego (`DrawInstancedIndirect`) obciążenie CPU wymagane do renderowania może spaść nawet o 50% w złożonych scenach.[^14] Co więcej, w połączeniu z GPU Occlusion Culling przetwarzanie trójkątów może zostać zredukowane o niemal 90%, podczas gdy czas klatki GPU (*frame buffer time*) spada o ponad połowę.[^28]

### **API `BatchRendererGroup` (BRG) i Culling**

Za działaniem GRD stoi `BatchRendererGroup`. BRG wymaga inicjalizacji z funkcją zwrotną (*callback*) `OnPerformCulling`.[^30] W tym miejscu CPU konfiguruje jedynie widoczność (*visibility*) i generuje wywołania rysowania w postaci tablic. Dane obiektu (transformacje, kolory, flagi) są ładowane do bufora `GraphicsBuffer`.[^25] Pozwala to wysłać miliony trójkątów do GPU przy użyciu zaledwie kilku wywołań SetPass.

### **Krytyczna niezgodność MPB z GRD**

Najważniejszą informacją dotyczącą optymalizacji w Unity 6 jest rygorystyczność wymagań kwalifikacyjnych dla GPU Resident Drawer. Aby obiekt mógł być przetwarzany przez GRD, musi przestrzegać ścisłych reguł układu danych.[^2]

Oficjalna dokumentacja Unity 6.1+ jasno stwierdza, że obiekty GameObject korzystające z API `MaterialPropertyBlock` są natychmiast wykluczane z GPU Resident Drawera.[^1] Ponadto obiekt nie może posiadać skryptów używających wywołań *per-instance*, takich jak `OnRenderObject`.[^2]

Gdy programista przypisuje MPB w celu zmiany koloru obiektu, nieświadomie zmusza silnik do powrotu do przestarzałego trybu renderowania opartego na CPU dla tego konkretnego obiektu. Jeśli zostanie to zrobione na 10 000 jednostek w grze strategicznej czasu rzeczywistego, narzut CPU gwałtownie wzrośnie, całkowicie niwecząc korzyści płynące z aktualizacji silnika do Unity 6.

## **Część VI: Nowoczesny standard: Renderer Shader User Value (RSUV) w Unity 6.3**

Dostrzegając impas architektoniczny wywołany niezgodnością MPB z nowoczesnymi potokami, Unity wprowadziło funkcję **Renderer Shader User Value (RSUV)** w wersji Unity 6.3 LTS.[^15] RSUV pełni rolę definitywnego zamiennika dla `MaterialPropertyBlock`, gdy programiści muszą zastosować proste modyfikacje *per-instance* na wielu rendererach współdzielących ten sam materiał.[^3]

### **Mechanizm działania RSUV**

RSUV omija złożone modyfikacje buforów, które stanowiły wadę MPB. Zamiast tego wykorzystuje niezwykle wydajny 24-bitowy kanał liczb całkowitych przesyłany bezpośrednio wraz ze standardowymi danymi rysowania renderera.[^3] Ponieważ liczba ta jest osadzona w istniejącej strukturze danych, zamiast wymagać osobnego nadpisania bufora (*buffer override*), zachowuje pełną zgodność zarówno z SRP Batcherem, jak i z GPU Resident Drawerem.[^3]

### **Implementacja i kodowanie bitowe (Bitwise Encoding)**

Aby użyć RSUV do zróżnicowania kolorów, CPU musi zakodować pożądane wartości RGB w pojedynczej 24-bitowej liczbie całkowitej bez znaku (`uint`). Każdy kanał koloru (Czerwony — *Red*, Zielony — *Green*, Niebieski — *Blue*) zajmuje 8 bitów (zapewniając wartości od 0 do 255).[^3]

Operacja kodowania wykorzystuje operatory przesunięcia bitowego w lewo (`<<`) oraz bitowej alternatywy OR (`|`). Równanie matematyczne wygląda następująco:

$$
Color_{uint} = (Blue_{byte} \ll 16) | (Green_{byte} \ll 8) | (Red_{byte})
$$

W praktycznej implementacji C# iterowanie po tablicy komponentów `MeshRenderer` w celu nałożenia losowych odcieni koloru zapewnia bardzo wysoką wydajność oraz brak jakichkolwiek alokacji pamięci śmieciowej (*zero garbage allocation*)[^3]:

```csharp
MeshRenderer allMeshRenderers = FindObjectsByType<MeshRenderer>(FindObjectsSortMode.InstanceID);  
foreach (MeshRenderer meshRenderer in allMeshRenderers)  
{  
    // Oblicz losowy kolor (używając przestrzeni HSV dla żywszych barw)  
    Color32 targetColor = Color.HSVToRGB(UnityEngine.Random.Range(0f, 1f), 1f, 1f);  

    // Zakoduj RGB w 24-bitowej liczbie całkowitej (Niebieski, Zielony, Czerwony)  
    uint encodedColor = ((uint)targetColor.b << 16) |   
                        ((uint)targetColor.g << 8) |   
                        ((uint)targetColor.r << 0);  

    // Zastosuj wartość bezpośrednio do renderera przez nowe API Unity 6.3
    meshRenderer.SetShaderUserValue(encodedColor);  
}
```

### **Dekodowanie w Shaderze (Shader Decoding)**

Po stronie GPU shader musi rozpakować (*unpack*) tę 24-bitową liczbę całkowitą z powrotem do znormalizowanego koloru `float4`. Unity udostępnia wbudowaną zmienną `unity_RendererUserValue`, umożliwiającą dostęp do tego bloku danych.[^3]

Proces dekodowania wykorzystuje operator przesunięcia bitowego w prawo (`>>`) oraz operator bitowego iloczynu AND (`&`) z maską bitową `255` w celu wyizolowania każdego 8-bitowego segmentu. Następnie wynik mnoży się przez odwrotność 255 (`1.0 / 255.0`), aby znormalizować wartość do przedziału od `0.0` do `1.0`.[^3]

$$
Channel_{normalized} = ((unity\_RendererUserValue \gg Shift) \ \& \ 255) \times 0.0039215
$$

W języku High-Level Shader Language (HLSL) lub za pomocą węzła Custom Function w Shader Graph logika rozpakowywania przedstawia się następująco 3:

```hlsl
uint c = unity_RendererUserValue;  
float4 instanceColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  // Kanał Czerwony (Red)  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  // Kanał Zielony (Green)  
    (float)((c >> 16) & 255) * (1.0 / 255.0), // Kanał Niebieski (Blue)  
    1.0 // Stała wartość Alpha  
);
```

Ta zmiana paradygmatu dowodzi głębokiej strategii optymalizacyjnej: zamiany złożoności struktur danych (takich jak MPB) na czyste obliczenia matematyczne (RSUV). Procesory GPU znakomicie radzą sobie z operacjami bitowymi, co oznacza, że koszt dekodowania jest niemal zerowy (minimalny narzut w cyklach zegara — *clock cycles*). Tymczasem zachowanie potoków SRP Batcher i GPU Resident Drawer przynosi ogromne skrócenie czasu klatki (*frame-time*).[^16]

## **Część VII: Rozwiązanie dla ekstremalnej skali: DOTS, ECS i `URPMaterialPropertyOverride`**

Dla projektów działających w skali przekraczającej możliwości przetwarzania standardowych obiektów GameObject (np. symulacje tłumów z setkami tysięcy niezależnych jednostek — *boids*, potężne armie w grach RTS), technologia Data-Oriented Technology Stack (DOTS) w Unity oferuje ostateczną architekturę renderowania.[^4]

### **Zarządzanie pamięcią zorientowane na dane (Data-Oriented Memory)**

W przeciwieństwie do ograniczeń podejścia obiektowego, w którym obiekty GameObject są rozproszone na stercie (*Heap*), encje (*entities*) w Entity Component System (ECS) istnieją wyłącznie jako ciągłe tablice danych (*contiguous arrays of data*) w pamięci.[^4] Ten układ pamięci idealnie odpowiada strukturze wymaganej przez API `BatchRendererGroup` (BRG) do osiągnięcia szczytowej wydajności.

W pakiecie Entities Graphics programiści mogą korzystać z komponentu `URPMaterialPropertyOverride`.[^4] System ten umożliwia nadpisywanie właściwości materiału na poziomie pojedynczej encji (*per-entity material overrides*) bez jakiegokolwiek użycia szkodliwego API `MaterialPropertyBlock`.

### **Mechanizm działania DOTS Instancing**

Kiedy encja jest przetwarzana w DOTS, shader skonfigurowany pod DOTS Instancing (poprzez zaznaczenie *Override Property Declaration* i wybranie *Hybrid Per Instance* w Shader Graph) otrzymuje unikalną 32-bitową liczbę całkowitą (wartość metadanych — *metadata value*).[^34] Liczba ta reprezentuje przesunięcie (*offset*) w obrębie trwałego bufora `GraphicsBuffer` w pamięci GPU.[^34]

Shader używa tego offsetu, aby pobrać dane właściwości dla aktualnie renderowanej instancji.[^34] Tym, co wyróżnia DOTS Instancing, jest fakt, że jeśli wiele encji współdzieli tę samą wartość właściwości, DOTS Instancing pozwala im odczytywać tę wartość z dokładnie tego samego miejsca w pamięci (ten sam offset), oszczędzając cykle GPU (*GPU cycles*) i minimalizując duplikację pamięci.[^34] Ponieważ właściwości są pobierane przez offset zamiast mieścić się w tradycyjnych buforach stałych, rozmiar pojedynczego wywołania rysowania nie jest już sztywno ograniczony, co pozwala na obsługę gigantycznej liczby instancji.

```csharp
// Przykład przypisania wartości RSUV poprzez system DOTS / Burst Compile 

public partial struct MaterialMeshInfoSystem : ISystem   
{  
    public void OnUpdate(ref SystemState state)   
    {  
        var entityManager = state.EntityManager;  
        // Równoległe przetwarzanie poprzez bezpośredni zapis wartości do NativeArray  
        // Zapewnia szybkość wykonania, której MonoBehaviour nigdy nie osiągnie.  
    }  
}
```

Modyfikowanie wartości komponentów encji za pomocą zadań działających w tle skompilowanych przez Burst (*Bursted Background Jobs*) może odbywać się z oszałamiającą prędkością.[^4] Można sprawić, by ogrodzenia zmieniały kolor w zależności od nachylenia terenu albo trawa zmieniała barwę na podstawie wysokości — a wszystko to rysowane w jednym strumieniu wywołań bez wąskich gardeł.[^4]

## **Część VIII: Analiza rozwiązań alternatywnych (Alternative Solutions)**

Oryginalny szkic Long Gil Studio krótko wspominał o alternatywnych technikach optymalizacji. Poniższa analiza potwierdza ich przydatność, umieszczając je jednak w ramach fizycznych ograniczeń silnika Unity 6.

1. **Vertex Colors (Kolory wierzchołków siatki):**
   * *Mechanizm:* Kodowanie danych koloru bezpośrednio w wierzchołkach (*vertices*) siatki 3D. Shader odczytuje z siatki atrybut `TEXCOORD` lub `COLOR`.
   * *Skuteczność:* Niezwykle lekkie rozwiązanie, w pełni zachowujące wszystkie mechanizmy *batchingu* oraz zgodność z GRD.[^36]
   * *Słabość:* Zmiana kolorów wierzchołków w czasie działania gry (*runtime*) wymaga manipulowania tablicą danych siatki (`mesh.colors`). Czynność ta tworzy kopię siatki w pamięci RAM, powodując przestoje CPU (*CPU stalls*) i alokacje pamięci śmieciowej. Kolorowanie wierzchołków pozostaje optymalne wyłącznie dla statycznych wariantów wypalonych (*baked*) wcześniej w programach takich jak Blender czy Maya.
2. **Texture Atlasing i UV Offsets:**
   * *Mechanizm:* Połączenie wielu wariantów kolorystycznych w jednym atlasie tekstur (*texture atlas*) i przesuwanie współrzędnych UV poszczególnych obiektów w celu próbkowania konkretnych pikseli.[^36]
   * *Skuteczność:* Technika ta utrzymuje pojedynczy materiał i jedną teksturę, gwarantując pełną zgodność z SRP Batcherem.[^36]
   * *Słabość:* Podobnie jak w przypadku kolorów wierzchołków, dynamiczne zmienianie współrzędnych UV na różnych obiektach w czasie rzeczywistym (*runtime*) zwykle wymaga tworzenia unikalnych instancji siatki (*mesh instances*), co prowadzi do rozrostu pamięci (*memory bloat*). Jednak w projektowaniu statycznych środowisk lub w grach wokselowych (jak Minecraft) technika ta jest bezkonkurencyjna.
3. **Low-Level `Graphics.DrawMeshInstanced` (Niskopoziomowe GPU):**
   * *Mechanizm:* Całkowite pominięcie hierarchii obiektów GameObject w celu bezpośredniego przesyłania macierzy transformacji i tablic kolorów do GPU za pomocą kodu C#.[^37]
   * *Skuteczność:* Zapewnia ogromną wydajność w systemach takich jak algorytmy stadne (*flocking*) czy proceduralna roślinność (*procedural foliage*).[^38]
   * *Słabość w Unity 6:* Wprowadzenie API `BatchRendererGroup` oraz GPU Resident Drawer „zdemokratyzowało” tę wydajność, eliminując konieczność ręcznego pisania złożonego kodu *cullingu* i zlecania rysowania w większości typowych scenariuszy.[^19] Utrzymywanie własnego potoku `DrawMeshInstanced` pochłania obecnie więcej zasobów inżynieryjnych niż zautomatyzowanie tego przez GPU Resident Drawer.

## **Część IX: Proponowana struktura treści dla Long Gil Studio DevLog**

Na podstawie kompleksowej oceny technicznej poniższy tekst stanowi proponowany, całkowicie przeredagowany artykuł DevLog prezentujący wysoki poziom profesjonalizmu inżynieryjnego. Odrzuca on wadliwą metodę MPB i kieruje czytelników ku prawdziwym standardom architektonicznym Unity 6: RSUV oraz GPU Resident Drawer.

---

**Unity 6: Optymalizacja tysięcy obiektów współdzielących materiał – Pożegnanie z MPB na rzecz nowoczesnej architektury**

**Autor: Long Gil Studio**

**🇻🇳 WERSJA WIETNAMSKA (Przetłumaczona na język polski)**

**1. Wąskie gardło renderowania: problem duplikacji materiałów**

Podczas tworzenia gier o dużej skali pojawia się bardzo częste wyzwanie architektoniczne: „Jak zmienić kolor tysięcy obiektów współdzielących jeden materiał bez spadku FPS?”.

Wielu programistów sięga po polecenie `GetComponent<Renderer>().material.color`. Jest to krytyczny błąd (*anti-pattern*). Odwołanie do `.material` zmusza Unity do cichego utworzenia kopii (*clone*) tego materiału w pamięci RAM. Skutkuje to poważnymi wyciekami pamięci, ciągłym wywoływaniem odśmiecania pamięci (*Garbage Collection*) i całkowitym rozpadem systemu Batching. GPU głoduje, podczas gdy CPU jest przeciążone obsługą tysięcy osobnych Draw Calls.

**2. Pułapka starszej generacji: dlaczego MaterialPropertyBlock „umarł” w Unity 6**

Dawniej „profesjonalnym” rozwiązaniem było stosowanie `MaterialPropertyBlock` (MPB) do przekazywania danych dla każdego obiektu bez klonowania materiału. **Jeśli jednak korzystasz z Unity 6 (URP/HDRP), musisz natychmiast porzucić tę metodę.**

Unity 6 w ogromnym stopniu opiera się na potoku **SRP Batcher** oraz rewolucyjnej technologii: **GPU Resident Drawer (GRD)**. GRD przenosi cały proces przetwarzania renderowania (generowanie Draw Calls, Culling) do *Compute Shaderów* na GPU, zmniejszając czas obliczeń CPU nawet o 50%. Jednak według podstawowej dokumentacji silnika, w chwili gdy podepniesz `MaterialPropertyBlock` do obiektu, obiekt ten zostaje natychmiast usunięty z SRP Batchera i całkowicie traci zgodność z GPU Resident Drawerem. Używanie MPB oznacza zmuszanie Unity do powrotu na wolną, obciążającą CPU starszą ścieżkę renderowania dla całych oddziałów jednostek.

**3. Nowy standard Unity 6: Renderer Shader User Value (RSUV)**

Aby definitywnie rozwiązać ten impas, aktualizacja Unity 6.3 LTS wprowadziła **Renderer Shader User Value (RSUV)**. To API pozwala przekazać 24-bitową liczbę całkowitą bezpośrednio do renderera. Ponieważ RSUV nie wymaga alokacji nowych buforów (*buffers*), zachowuje 100% zgodności zarówno z SRP Batcherem, jak i GPU Resident Drawerem.

**Krok 1: Kodowanie w C# (Zero Garbage Allocation)**

Zamiast używać łańcuchów tekstowych (*string*) jak w MPB, zakodujemy kolor RGB w 24-bitowej liczbie całkowitej za pomocą operacji przesunięcia bitowego (*bitwise*):

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Zakoduj 3 kanały Niebieski, Zielony i Czerwony w 24-bitowej liczbie całkowitej  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Zastosuj wartość (W pełni bezpieczne dla architektury SRP i GRD!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Krok 2: Dekodowanie w Shader Graph**

Wewnątrz Shader Graph utwórz węzeł **Custom Function** (Type: String, Name: DecodeColor) z wyjściem Vector4. Wklej poniższy kod HLSL, aby rozpakować liczbę całkowitą z powrotem do standardowego koloru:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Podłącz to wyjście do portu Base Color w Fragment Shaderze. Masz teraz nieskończoną liczbę wariantów kolorystycznych przy zerowym narzucie CPU, w pełni wykorzystując potencjał systemu GPU Resident Drawer.

**Przykład: Praktyczna implementacja w skrypcie Shadera (bez Shader Graph)**

Jeśli piszesz własny shader w kodzie (HLSL), możesz zmodyfikować funkcję `BuildSurfaceData`, aby zdekodować `unity_RendererUserValue` i pomnożyć wynik przez `BaseColor`, jak pokazuje poniższy kod:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // Dekodowanie RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // Zastosowanie koloru rsuvColor
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ... 
}
```

*Dowiedz się więcej tutaj:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Przekroczenie progu 100 000 obiektów: rozwiązanie DOTS / ECS**

Jeśli Twoja gra wymaga renderowania setek tysięcy niezależnych jednostek (np. ogromnych armii), tradycyjny system obiektów GameObject nieuchronnie stanie się wąskim gardłem dla CPU, niezależnie od tego, jak dobrze zoptymalizujesz renderowanie. Przy takiej skali przejdź na architekturę Unity DOTS. Użycie komponentu `URPMaterialPropertyOverride` pozwala na zastosowanie układu pamięci Data-Oriented, komunikującego się bezpośrednio z niskopoziomowym API `BatchRendererGroup`, co zapewnia bezkonkurencyjną wydajność prawdziwej klasy AAA.

---

**🇺🇸 WERSJA ANGIELSKA (Przetłumaczona na język polski)**

**1. Wąskie gardło renderowania: duplikacja materiałów**

Podczas tworzenia gier o dużym zagęszczeniu obiektów pojawia się częste wyzwanie architektoniczne: „Jak zmienić kolor tysięcy obiektów współdzielących ten sam materiał bez niszczenia wydajności?”.

Programiści często domyślnie sięgają po `GetComponent<Renderer>().material.color`. To fatalny antywzorzec. Odwołanie do `.material` zmusza Unity do cichego sklonowania materiału na stercie zarządzanej. Powoduje to poważny rozrost pamięci, wywołuje skoki odśmiecania pamięci i niszczy *batching* wywołań rysowania, podnosząc narzut CPU do trudnego do opanowania poziomu przy jednoczesnym głodzeniu GPU.

**2. Pułapka starszego podejścia: dlaczego MaterialPropertyBlock jest martwy w Unity 6**

Historycznie rozwiązaniem „Pro” było używanie `MaterialPropertyBlock` (MPB) do przekazywania danych dla instancji bez klonowania materiałów. **Jeśli używasz Unity 6 (URP/HDRP), musisz natychmiast przestać korzystać z tej metody.**

Unity 6 silnie polega na **SRP Batcherze** oraz rewolucyjnym nowym systemie **GPU Resident Drawer (GRD)**. GRD przenosi *frustum culling* i generowanie *draw calls* do *compute shaderów* na GPU, zmniejszając czas renderowania po stronie CPU nawet o 50%. Jednak zgodnie z główną dokumentacją silnika, zastosowanie `MaterialPropertyBlock` na obiekcie natychmiast dyskwalifikuje go z SRP Batchera i całkowicie zrywa zgodność z GPU Resident Drawerem. Używając MPB, zmuszasz Unity do powrotu na powolną, starszą ścieżkę renderowania zależną od CPU dla całych Twoich armii.

**3. Standard Unity 6: Renderer Shader User Value (RSUV)**

Aby rozwiązać ten impas architektoniczny, Unity 6.3 LTS wprowadza **Renderer Shader User Value (RSUV)**. To API pozwala przekazać 24-bitową liczbę całkowitą bezpośrednio do bazowego pakietu danych renderera. Ponieważ unika modyfikacji trwałych buforów stałych, RSUV zachowuje 100% zgodności zarówno z SRP Batcherem, jak i GPU Resident Drawerem.

**Krok 1: Kodowanie w C# (Zero Memory Allocation)**

Zamiast przekazywać łańcuchy tekstowe i tworzyć bloki, matematycznie pakujemy kolor RGB w 24-bitową liczbę całkowitą bez znaku za pomocą operacji bitowych:

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Zakoduj kanały Niebieski, Zielony i Czerwony w pojedynczej 24-bitowej liczbie całkowitej  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Zastosuj wartość natywnie (100% bezpieczne dla SRP i GRD!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Krok 2: Dekodowanie w Shaderze**

Wewnątrz swojego Shader Graph utwórz węzeł **Custom Function** (Type: String, Name: DecodeColor) z wyjściem Vector4. Wklej ten kod HLSL, aby rozpakować liczbę całkowitą z powrotem do znormalizowanego koloru zmiennoprzecinkowego:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Podłącz to wyjście do wejścia Base Color fragmentu. Masz teraz nieskończoną liczbę wariantów kolorystycznych bez kar w liczbie *draw calls*, w pełni wykorzystując GPU Resident Drawer.

**Przykład: Praktyczna implementacja we własnym Shaderze (bez Shader Graph)**

Jeśli piszesz własny shader bezpośrednio w kodzie (HLSL), możesz zmodyfikować funkcję `BuildSurfaceData`, aby dekodowała `unity_RendererUserValue` i mnożyła wartość przez `BaseColor`, jak pokazano poniżej:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // Dekodowanie RSUV
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // Zastosowanie rsuvColor
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ...
}
```

*Zobacz również:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. Wyjście poza 100 000 obiektów: DOTS / ECS**

Jeśli Twoja gra wymaga renderowania setek tysięcy dynamicznych jednostek, standardowe GameObjecty ostatecznie zdławią główny wątek CPU niezależnie od optymalizacji graficznych. Dla masowej skali przejdź na Unity DOTS. Korzystanie z komponentu `URPMaterialPropertyOverride` umożliwia ścisłe układy pamięci zorientowane na dane (*Data-Oriented*). Komunikuje się to bezpośrednio z niskopoziomowym API `BatchRendererGroup`, osiągając bezkonkurencyjną wydajność czystej klasy AAA.

---

## **Część X: Strategiczne zalecenia dla zespołów programistycznych**

Analiza nowoczesnych modeli renderowania ukazuje wyraźną różnicę między starą wiedzą o optymalizacji (*legacy*) a współczesną architekturą silnika. Najważniejszy wniosek dla inżynierów grafiki brzmi: modyfikowanie buforów danych (*data buffers*) na poziomie pojedynczego obiektu jest z natury wrogie wobec przetwarzania równoległego i pętli renderowania sterowanych przez GPU. Nie można przenosić nawyków optymalizacyjnych z Unity 5.x lub Unity 2019 do Unity 6.

Aby osiągnąć maksymalną wydajność w Unity 6, zespoły programistyczne muszą ściśle egzekwować następujące protokoły:

1. **Audyt użycia MPB (Audit for MPB Usage):** Narzędzia profilujące (np. Unity Profiler) oraz Frame Debuggers powinny być stale używane do wykrywania i całkowitego eliminowania przypadków stosowania `MaterialPropertyBlock` na masowo instancjonowanej geometrii (*mass-instanced geometry*). Krótkoterminowa wygoda MPB jest całkowicie przyćmiona przez systematyczną utratę funkcji GPU Resident Drawer. Zespoły powinny wprowadzić ostrzeżenia w kodzie źródłowym lub kontrole CI/CD wykrywające niepotrzebne alokacje MPB.
2. **Wdrożenie strategii kodowania bitowego (Bitwise Encoding Strategies):** Zastosowanie Renderer Shader User Value (RSUV) wymaga zmiany metodologii programowania. Artyści techniczni (*Technical Artists*) oraz programiści rozgrywki muszą współpracować przy definiowaniu rygorystycznych schematów pakowania bitowego w ramach 24-bitowego limitu RSUV. Należy zadbać o to, by różnorodne stany danych (kolor, obrażenia, ID drużyny — *team ID*) były wydajnie serializowane przed dotarciem do renderera. Przykład: można przeznaczyć 4 bity na „ID frakcji” (co daje 16 frakcji), 8 bitów na „Stan obrażeń” (256 poziomów) oraz 12 bitów na „Custom Tint” (własny odcień) — wszystko dekodowane równocześnie za pomocą masek bitowych (*bitmasks*) w shaderze.
3. **Ocena progów przejścia na ECS (Evaluate Thresholds for ECS Transition):** Choć RSUV rozwiązuje wąskie gardło wariantów materiałów dla obiektów GameObject, nadal istnieją granice możliwości CPU związane z obliczeniami fizyki, przeliczaniem macierzy transformacji (*transform calculations*) i *cullingiem* obiektów GameObject. Projekty przewidujące liczbę aktywnych bytów przekraczającą 10 000 dynamicznych agentów (*dynamic agents*) powinny odważnie i aktywnie projektować prototypy oparte na DOTS (Entity Component System). Wykorzystanie komponentu `URPMaterialPropertyOverride`[^34] do bezpośredniej komunikacji z API `BatchRendererGroup` to jedyna droga do pełnego uwolnienia potencjału współczesnych komputerów PC i konsol nowej generacji.

## **Bibliografia**

[^1]: Enable the GPU Resident Drawer in URP - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html](https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html)  
[^2]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^3]: Set and use the RSUV - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html)  
[^4]: Migrated my game to ECS/DOTS and material overrides are awesome! : r/Unity3D - Reddit, dostęp 19 kwietnia 2026, [https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated\_my\_game\_to\_ecsdots\_and\_material/](https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated_my_game_to_ecsdots_and_material/)  
[^5]: Why You Should Stop Swapping Materials in Unity (And What to Do Instead) - Medium, dostęp 19 kwietnia 2026, [https://medium.com/@MTCrypto\_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e](https://medium.com/@MTCrypto_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e)  
[^6]: Material Property Blocks - using them to store the original color of a material upon instantiation : r/Unity3D - Reddit, dostęp 19 kwietnia 2026, [https://www.reddit.com/r/Unity3D/comments/10jyr9b/material\_property\_blocks\_using\_them\_to\_store\_the/](https://www.reddit.com/r/Unity3D/comments/10jyr9b/material_property_blocks_using_them_to_store_the/)  
[^7]: Instancing and Material Property Blocks | Ronja's tutorials, dostęp 19 kwietnia 2026, [https://www.ronja-tutorials.com/post/048-material-property-blocks/](https://www.ronja-tutorials.com/post/048-material-property-blocks/)  
[^8]: Scripting API: MaterialPropertyBlock - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html](https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html)  
[^9]: Unity 6 and custom material bug - Spine Forum, dostęp 19 kwietnia 2026, [https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug](https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug)  
[^10]: Scriptable Render Pipeline (SRP) Batcher - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html)  
[^11]: Scriptable Render Pipeline Batcher - Unity 6.3 User Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html)  
[^12]: GPU instancing - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html](https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html)  
[^13]: Remove SRP Batcher compatibility for GameObjects | High Definition Render Pipeline | 17.0.4 - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html)  
[^14]: Beginning Game Development: GPU Resident Drawer | by Lem Apperson - Medium, dostęp 19 kwietnia 2026, [https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3](https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3)  
[^15]: Introduction to RSUV - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html)  
[^16]: Renderer Shader User Value sample - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html](https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html)  
[^17]: Speed Up Your Game Rendering in Unity3D: The Secret to Changing Material Colors, dostęp 19 kwietnia 2026, [https://www.youtube.com/watch?v=CjfMAhU7cY8](https://www.youtube.com/watch?v=CjfMAhU7cY8)  
[^18]: Scriptable Render Pipeline Batcher - Unity User Manual 2021.3 (LTS), dostęp 19 kwietnia 2026, [https://docs.unity.cn/Manual/SRPBatcher.html](https://docs.unity.cn/Manual/SRPBatcher.html)  
[^19]: Unity Draw Call Batching: The Ultimate Guide (2026 Update), dostęp 19 kwietnia 2026, [https://thegamedev.guru/unity-performance/draw-call-optimization/](https://thegamedev.guru/unity-performance/draw-call-optimization/)  
[^20]: Scriptable Render Pipeline Batcher - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html)  
[^21]: SRP Batcher: Speed up your rendering - Unity, dostęp 19 kwietnia 2026, [https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering](https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering)  
[^22]: Remove SRP Batcher compatibility for GameObjects in URP - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html)  
[^23]: GPU Instancing not working? Why amount of batches doesn't change? : r/Unity3D - Reddit, dostęp 19 kwietnia 2026, [https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu\_instancing\_not\_working\_why\_amount\_of\_batches/](https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu_instancing_not_working_why_amount_of_batches/)  
[^24]: Scripting API: Renderer.GetPropertyBlock - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html)  
[^25]: Create batches with the BatchRendererGroup API in URP - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html)  
[^26]: Use the GPU Resident Drawer | High Definition Render Pipeline | 17.0.4 - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html)  
[^27]: Create draw commands with the BatchRendererGroup API | High Definition Render Pipeline, dostęp 19 kwietnia 2026, [https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html](https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html)  
[^28]: Unity Tip Tuesday: GPU Resident Drawer & GPU occlusion culling - YouTube, dostęp 19 kwietnia 2026, [https://www.youtube.com/shorts/0PenzdQFlv0](https://www.youtube.com/shorts/0PenzdQFlv0)  
[^29]: Graphics Features and Tools in Unity 6 Feel Like MAGIC! STP, Resident Drawer, and Occlusion Culling! - YouTube, dostęp 19 kwietnia 2026, [https://www.youtube.com/watch?v=trdeAq3WPkQ](https://www.youtube.com/watch?v=trdeAq3WPkQ)  
[^30]: Initialize a BatchRendererGroup object in URP - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html)  
[^31]: Boost performance of your game in Unity 6 with GPU Resident Drawer - The Knights of U, dostęp 19 kwietnia 2026, [https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/](https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/)  
[^32]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)  
[^33]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html)  
[^34]: DOTS Instancing shaders in URP - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/Manual/dots-instancing-shaders.html](https://docs.unity3d.com/Manual/dots-instancing-shaders.html)  
[^35]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html)  
[^36]: One Material multiple colors possible? : r/Unity3D - Reddit, dostęp 19 kwietnia 2026, [https://www.reddit.com/r/Unity3D/comments/9oi8kz/one\_material\_multiple\_colors\_possible/](https://www.reddit.com/r/Unity3D/comments/9oi8kz/one_material_multiple_colors_possible/)  
[^37]: Single-pass instanced rendering and custom shaders - Unity - Manual, dostęp 19 kwietnia 2026, [https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html](https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html)  
[^38]: Use Graphics.DrawMeshInstanced or similar but vary the color on a per object basis?, dostęp 19 kwietnia 2026, [https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use\_graphicsdrawmeshinstanced\_or\_similar\_but\_vary/](https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use_graphicsdrawmeshinstanced_or_similar_but_vary/)
