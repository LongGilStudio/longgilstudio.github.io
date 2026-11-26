---
title: "Unity 6 İşleme Mimarisi: Derinlemesine Materyal Optimizasyonu İçin MPB'yi Terk Etmek"
date: 2026-04-19 12:00:00 +0700
categories: [Game Development, Unity]
tags: [unity6, rendering, optimization, shaders, dots, longgilstudio]
description: "Unity 6'da AAA seviyesinde işleme performansı elde etmek için MaterialPropertyBlock'tan RSUV ve GPU Resident Drawer'a mimari geçişin kapsamlı teknik analizi."
lang: tr
translation_id: unity6-material-rsuv-grd
math: true
---

## **Yönetici Özeti (Executive Summary)**

Unity 6'ya geçiş, işleme hatlarının (render pipelines) yüksek hacimli örneklenmiş geometriyi (instanced geometry) işleme biçiminde köklü bir mimari değişime işaret etmektedir. Oyun geliştirme tarihinde, tek bir materyali paylaşan ancak nesneye özgü özellik varyasyonları (örneğin renk tonlamaları — color tints) gerektiren çok sayıda nesneyi optimize etmek, genellikle standart GPU Instancing sistemiyle birlikte `MaterialPropertyBlock` (MPB) uygulama programlama arayüzüne (API) dayanıyordu. Ancak Unity 6'daki Universal Render Pipeline (URP) ve High Definition Render Pipeline (HDRP) üzerine yapılan derinlemesine bir analiz, bu eski (legacy) yaklaşımın artık en uygun yol olmadığını ve pek çok senaryoda ciddi performans düşüşlerine yol açtığını ortaya koymaktadır.

Kullanıcı tarafından "Long Gil Studio DevLog" için sağlanan taslak belgenin incelenmesi, eski sürümlerde geçerli olan miras optimizasyon teorisi ile Unity 6'nın modern işleme özelliklerine dair kritik bir yanlış anlamanın bir arada bulunduğunu göstermektedir. Özellikle taslağın `MaterialPropertyBlock` kullanımını önermesi, Unity 6'nın yeni **GPU Resident Drawer (GRD)** teknolojisi ve bunun temelindeki **BatchRendererGroup (BRG)** API'si ile doğrudan çelişmektedir.[^1] Maksimum işleme verimine ulaşmak için geliştiricilerin mutlaka **Renderer Shader User Value (RSUV)** yöntemini benimsemesi veya tamamen **Data-Oriented Technology Stack (DOTS)** mimarisine geçmesi gerekmektedir.[^3]

Bu araştırma raporu; işleme darboğazlarının, Scriptable Render Pipeline (SRP) Batcher çalışma mekanizmasının, materyal çoğaltmanın sistemik sonuçlarının ve Unity 6'da AAA düzeyinde işleme performansı elde etmek için gereken modern kalıpların kapsamlı bir teknik analizini sunmaktadır. Ayrıca rapor, Long Gil Studio DevLog'da yayımlanmak üzere profesyonel düzeyde gözden geçirilmiş ve sentezlenmiş bir teknik makaleyi de içermektedir.

## **Bölüm I: Orijinal Long Gil Studio Taslağının Teknik Değerlendirmesi**

İlk taslak metin son derece spesifik bir işleme problemini ortaya koymaktadır: tek bir materyali paylaşan ancak ayrı renk değişiklikleri gerektiren sayısız özdeş nesne içeren bir Sahnenin (Scene) optimize edilmesi. Taslak, hatalı tasarım kalıplarını (anti-patterns) doğru biçimde tespit etmiş olsa da Unity 6 mimarisi bağlamında performansı düşüren bir çözüm reçetesi sunmaktadır.

### **Orijinal Taslağın Doğru Noktaları**

1. **Materyal Çoğaltma Cezası (Material Duplication):** Taslak, her nesne için ayrı materyal örnekleri oluşturmanın (örneğin `GetComponent<Renderer>().material.color` aracılığıyla) bellek şişmesine (memory bloat) yol açtığını ve çizim çağrısı toplu işlemesini (draw call batching) tamamen yok ettiğini doğru bir şekilde belirtmektedir.[^5] `.material` özelliğine erişmek, Unity motorunu o materyalin bir kopyasını (clone) sessizce oluşturmaya zorlayarak SRP Batcher veya GPU Instancing sisteminin bu nesneleri tek bir SetPass çağrısında gruplama yeteneğini kalıcı olarak ortadan kaldırır.[^5]
2. **MaterialPropertyBlock (MPB) Mekanizması:** Taslak, MPB'nin bir veri geçersiz kılma ara belleği (data override buffer) gibi çalıştığını, işleyicinin (renderer) yeni bir materyal kopyası oluşturmadan GPU'ya örnek başına (per-instance) özellikler aktarmasına olanak tanıdığını doğru şekilde tanımlamaktadır.[^7]
3. **Dize (String) Özellikler ve Tamsayı Kimlikleri (Integer IDs):** Taslak, gölgelendirici (shader) özelliklerini aramak için dize kullanmaktan kaynaklanan Merkezi İşlem Birimi (CPU) gecikmesini yerinde bir şekilde vurgulamakta ve döngüleri optimize etmek için `Shader.PropertyToID()` komutuyla tamsayı kimliklerinin önceden oluşturulmasını savunmaktadır.[^7]

### **Kritik Hatalar ve Modası Geçmiş Kalıplar**

1. **Unity 6'da "AAA Standardı" Olarak MPB:** Orijinal taslaktaki en önemli kusur, MPB'nin Unity 6 için en uygun "AAA" çözümü olduğunu iddia etmesidir. MPB, Built-In Render Pipeline'da (eski mimari) standart olmasına rağmen modern SRP mimarilerinde yıkıcı bir anti-pattern olarak işlev görür.[^8] Bir GameObject'e MPB uygulamak, o nesneyi anında SRP Batcher hattından çıkarır.[^10]
2. **Eski GPU Instancing'e Bağımlılık:** Taslak, MPB'nin SRP Batcher'ı bozduğunu kabul etmekte ve yedek çözüm olarak geleneksel GPU Instancing'e güvenmeyi önermektedir. Bu yöntem, SRP uyumluluğunu manuel olarak bozup Instancing'i etkinleştirerek teknik açıdan uygulanabilir olsa da motoru son derece optimize edilmiş SRP mimarisini atlamaya zorlar.[^12]
3. **GPU Resident Drawer (GRD) İhmali:** Unity 6, çizim çağrısı (draw call) üretimini hesaplama gölgelendiricilerine (compute shaders) devrederek CPU işleme maliyetini %50'ye kadar azaltan GPU Resident Drawer sistemini tanıtmaktadır.[^14] Bir `MaterialPropertyBlock` varlığı, bir GameObject'in GRD'ye katılmasını kesinlikle yasaklar.[^1] Unity 6'da MPB önermek, projelerin motorun en güçlü yeni optimizasyon özelliğinden yararlanmasını temelden engeller.
4. **Renderer Shader User Value (RSUV) Eksikliği:** Unity 6.3 LTS ile tanıtılan RSUV, nesne başına basit varyasyonları işlerken MPB'nin doğrudan mimari ikamesidir.[^15] RSUV, SRP Batcher'ı veya GPU Resident Drawer'ı bozmadan her işleyici için gölgelendiriciye 24 bitlik bir tamsayı aktarılmasına olanak tanır.[^3]

## **Bölüm II: İşleme (Rendering) Darboğazlarının Temel Nedensel Analizi**

Belirli API çağrılarının neden kare hızını (frame rate) yerle bir ettiğini anlamak için Merkezi İşlem Birimi (CPU) ile Grafik İşlem Birimi (GPU) arasındaki iletişim modelini incelemek gerekir. Modern donanım mimarisi, bu iki işlemci arasında sıkı ancak gecikmeye duyarlı bir senkronizasyon gerektirir.

### **CPU-GPU İletişim Maliyeti (Overhead)**

Tek bir karenin işlenmesi, CPU'nun Kamera görüş alanı içindeki tüm görünür nesneler üzerinde yineleme yapmasını (frustum culling), materyal özelliklerini belirlemesini, gerekli dokuları (textures) ve gölgelendiricileri GPU belleğine bağlamasını (bind) ve bir çizim komutu (draw command) göndermesini gerektirir. Bu hattaki en maliyetli işlem GPU'nun çokgenleri (polygons) çizmesi değil, çizim çağrısından önce zorunlu olan durum değişiklikleridir — bunlar genellikle **SetPass çağrıları** olarak adlandırılır.[^5]

CPU yeni bir materyalle her karşılaştığında, yeni parametreleri GPU'ya yüklemek için işleme hattını duraklatmak zorundadır.[^18] Bir Sahne 10.000 düşman içeriyorsa ve her düşman farklı bir zırh rengini desteklemek için benzersiz bir materyal örneğine sahipse, CPU 10.000 kez durum değişikliği gerçekleştirmelidir. Bu durum devasa bir CPU yükü (CPU Overhead) oluşturarak GPU'nun CPU'dan talimat beklerken boşta kaldığı bir darboğaza yol açar.

### **`.material` Özelliğinin Bellek Parçalanması**

Bir betik (script) rengi değiştirmek için `Renderer.material` özelliğine eriştiğinde, motor paylaşılan özgün varlığın (asset) bütünlüğünü korumak zorundadır. Bu nedenle ilgili materyal üzerinde dahili bir `Instantiate()` komutu çalıştırır. Bu durum performans açısından iki ağır cezaya neden olur:

1. **Toplu İşlemenin (Batching) Yok Edilmesi:** Nesne artık emsalleriyle aynı materyal referansını paylaşmaz. Unity, bu nesne için her türlü Static Batching, Dynamic Batching veya SRP Batching biçimini derhal durdurur.[^5] Ekran kartı bu nesneyi tamamen bağımsız bir varlık olarak işlemek zorunda kalır.
2. **Çöp Toplama (Garbage Collection) ve Bellek Sızıntıları (Memory Leaks):** Yeni oluşturulan materyal kopyası, C# tarafından yönetilen yığın (managed heap) üzerinde yer alır. Nesne yok edildiğinde otomatik olarak çöp toplanmaz. Geliştirici açıkça `Destroy(renderer.material)` komutunu çağırmadığı sürece bellek tahsis edilmiş olarak kalır. Bu durum, Çöp Toplayıcının (Garbage Collector — GC) Mark-and-Sweep sürecini tetiklemesine neden olan bellek sızıntıları yaratarak ani FPS düşüşlerine yol açan ciddi takılmalar (spikes) üretir.[^5]

## **Bölüm III: SRP Batcher Mimarisi ve Geleneksel GPU Instancing'in Eskimesi**

Scriptable Render Pipeline (SRP), Unity'nin gölgelendirici verilerini yönetme biçimini kökten yeniden düzenlemiştir. Eski optimizasyon yöntemlerinin Unity 6'da neden tamamen başarısız olduğunu kavramak için SRP Batcher'ı anlamak kritik öneme sahiptir.

### **SRP Batcher'ın Çalışma Mekanizması**

Eski işleme hatlarında (Built-in), materyaller verileri GPU'ya ayrı tekdüze değişkenler (separate uniform variables) aracılığıyla yüklerdi. SRP Batcher bu yöntemi, **Sabit Ara Bellekler (Constant Buffers — CBUFFERs)** olarak adlandırılan büyük ve kalıcı GPU ara bellekleri kullanarak değiştirir.[^11]

SRP mimarisi, gölgelendiricilerin değişkenlerini iki ayrı ara bellek bloğuna ayırmasını zorunlu kılar[^11]:

* `UnityPerMaterial`: Aynı materyali kullanan tüm nesneler tarafından paylaşılan özellikleri (örneğin temel renk, metalik haritalar — metallic maps, pürüzlülük) içeren bir CBUFFER.
* `UnityPerDraw`: Belirli bir çizim çağrısına özgü özellikleri (örneğin nesnenin uzamsal dönüşüm matrisleri — transformation matrices) içeren bir CBUFFER.

`UnityPerMaterial` ara belleği GPU belleğinde kalıcı olarak durduğu için, ardışık nesneler aynı gölgelendirici varyantını (shader variant) paylaştığı sürece CPU'nun işleme döngüsü sırasında materyal özelliklerini yeniden yüklemesine gerek kalmaz.[^18] SRP Batcher yalnızca bu kalıcı ara belleği bağlar (bind) ve çok daha küçük olan `UnityPerDraw` ara belleğini günceller. Bu tasarım CPU maliyetini önemli ölçüde azaltır ve işleme hızını bazen 1,2x ila 4x katına kadar artırır.[^21]

### **`MaterialPropertyBlock` ile Temel Çatışma**

`MaterialPropertyBlock` API'si başlangıçta materyal özelliklerini işleyici (renderer) düzeyinde geçersiz kılmak için tasarlanmıştı. Ancak SRP Batcher, `UnityPerMaterial` CBUFFER'ının katı ayrımına ve sürekliliğine dayandığı için bir MPB enjekte etmek bu bellek düzenini doğrudan ihlal eder.[^8]

Bir MPB uygulandığında Unity artık kalıcı materyal ara belleğinin nesneye tekdüze biçimde uygulanacağını garanti edemez. Sonuç olarak motor, nesneyi zorla SRP Batcher hattından dışarı atmak zorunda kalır.[^9] Unity'nin resmi dokümantasyonu bunu açıkça doğrulamaktadır: *"Bu özelliğin SRP Batcher ile uyumlu olmadığını unutmayın. URP veya HDRP'de MPB kullanmak büyük olasılıkla performans düşüşüne yol açacaktır."*[^8]

### **Miras Yedek Çözüm: `Graphics.DrawMeshInstanced`**

Geçmişte bir geliştiricinin devasa varyasyonlara (örneğin farklı renklerde ağaçlardan oluşan bir orman) ihtiyacı olduğunda, SRP Batcher'ı kaybetmeyi göze alıp GPU Instancing'e geri dönülürdü.[^12] Bu işlem, `UnityPerMaterial` ara belleğinin dışında bir özellik bildirerek gölgelendiricinin SRP uyumluluğunu manuel olarak bozmayı ve materyal üzerinde "Enable GPU Instancing" seçeneğini işaretlemeyi gerektirirdi.[^13]

GPU Instancing, dönüşüm matrisi dizileri ve renk verileri aktararak çizim çağrılarını azaltsa da ciddi kısıtlamalarla birlikte gelir.[^12] Ağır aşırı çizim (overdraw) sorunlarıyla mücadele etmekte zorlanır, ağların (meshes) özdeş olmasını şart koşar ve her karede örnek dizilerini (instance arrays) toplayıp yüklemesi için CPU'ya büyük bir yük bindirir. Unity 6'da bu yöntem tamamen GPU Resident Drawer mimarisiyle değiştirilmiştir.[^23]

## **Bölüm IV: `MaterialPropertyBlock` (MPB) ile Unity 6 Ekosistemi Arasındaki Uyumsuzluk**

MPB üzerine yapılan daha derin bir analiz, bu API'nin yalnızca SRP Batcher'ı bozmakla kalmayıp Unity 6'daki hata ayıklama araçları (debugging tools) ve aydınlatma sistemleri (lighting systems) için de yapısal riskler oluşturduğunu göstermektedir.

### **Lightmap Verileri ve Global Illumination Üzerindeki Etkisi**

MPB'nin yanlış kullanımının en az konuşulan sonuçlarından biri Lightmap verilerinin silinmesidir. Bir `new MaterialPropertyBlock()` oluşturup bunu `Renderer.SetPropertyBlock()` aracılığıyla atadığınızda, aktardığınız özellik bloğu işleyicinin yerel durumunun üzerine tamamen yazar.[^24]

Nesneniz önceden hesaplanmış (baked) Küresel Aydınlatma (Global Illumination — GI) sistemini kullanıyorsa, Lightmap UV koordinatları ve Light Probe katsayılarına ilişkin bilgiler örtük olarak doğrudan işleyicinin kendi özellik bloğunda saklanır.[^24] Rengi ayarlamadan önce `Renderer.GetPropertyBlock(block)` çağrısı yapmazsanız, nesnenin aydınlatma verilerini yanlışlıkla tamamen silersiniz. Orijinal Long Gil Studio taslağı `GetPropertyBlock` kısmını iyi ele almış olsa da bu API'yi binlerce nesne üzerinde sürekli çağırmak başlı başına azımsanmayacak bir CPU gecikmesi yaratır.

| Optimizasyon Tekniği | RAM Sızıntısına Yol Açar mı? | SRP Batcher Uyumlu | GRD Uyumlu | DOTS Uyumlu | Kullanım Önerisi |
| :----------------------------- | :------------ | :---------------------- | :-------------- | :--------------- | :-------------------- |
| **`Material.color`** | Evet | Hayır | Hayır | Hayır | Kesinlikle kaçının |
| **`MaterialPropertyBlock`** | Hayır | Hayır | Hayır | Hayır | Eski Built-in projeler için |
| **GPU Instancing** | Hayır | Hayır (Çakışır) | Hayır | Hayır | Unity 2020–2022 |
| **Renderer Shader User Value** | Hayır | Evet | Evet | Evet | Unity 6.3+ standardı |

Yukarıdaki tablonun da gösterdiği gibi, MPB artık eski nesle ait bir tekniktir. RAM sorununu çözer ancak modern Unity 6 işleme hattının tamamını bozar.

## **Bölüm V: Mimari Dönüm Noktası: GPU Resident Drawer (GRD) ve `BatchRendererGroup` (BRG)**

Unity 6 devrim niteliğinde bir işleme yolu sunmaktadır: **GPU Resident Drawer**. Bu sistem, çizim komutu üretimini CPU'nun yönettiği modelden, yüksek derecede otonom ve GPU tarafından yönetilen bir işleme döngüsüne dönüştürür.[^1]

### **GPU Resident Drawer Mimarisi**

GPU Resident Drawer, düşük seviyeli `BatchRendererGroup` (BRG) API'si temelinde çalışır.[^1] CPU'nun hangi nesnelerin görünür olduğunu değerlendirmesi (frustum culling) ve tekil ya da örneklenmiş çizim çağrıları göndermesi yerine, CPU tüm sahnenin uzamsal ve materyal verilerini GPU'ya yükler.[^25] Ardından hesaplama gölgelendiricileri (compute shaders) kamera dışı nesneleri ayıklama, gizli nesneleri ayıklama (occlusion culling) ve çizim komutu üretme işlemlerini tamamen GPU üzerinde gerçekleştirir.[^14]

Performans artışı çarpıcıdır. Dolaylı işleme (`DrawInstancedIndirect`) kullanılarak karmaşık sahnelerde işleme için gereken CPU iş yükü %50'ye kadar azaltılabilir.[^14] Dahası, GPU Occlusion Culling ile birleştirildiğinde üçgen işleme (triangle processing) neredeyse %90 oranında azaltılabilirken GPU kare süresi (frame time) yarıdan fazla düşer.[^28]

### **`BatchRendererGroup` (BRG) API ve Ayıklama (Culling)**

GRD'nin arkasında `BatchRendererGroup` yer alır. BRG, kullanıcının `OnPerformCulling` geri çağırma fonksiyonuyla başlatılmasını gerektirir.[^30] Burada CPU'nun yalnızca görünürlüğü (visibility) yapılandırması ve dizi biçiminde çizim çağrıları çıkarması yeterlidir. Nesne verileri (dönüşüm, renk, bayraklar) `GraphicsBuffer` içine yüklenir.[^25] Bu sayede milyonlarca üçgen yalnızca birkaç SetPass çağrısıyla GPU'ya gönderilebilir.

### **MPB'nin GRD ile Ölümcül Uyumsuzluğu**

Unity 6 optimizasyonuyla ilgili en kritik bilgi, GPU Resident Drawer için uygunluk gereksinimlerinin kırılganlığıdır. Bir nesnenin GRD tarafından işlenebilmesi için katı veri düzeni kurallarına uyması gerekir.[^2]

Resmi Unity 6.1+ dokümantasyonu, `MaterialPropertyBlock` API'sini kullanan GameObject'lerin derhal GPU Resident Drawer'dan dışlandığını açıkça belirtmektedir.[^1] Ayrıca nesnenin `OnRenderObject` gibi örnek başına geri çağırma (per-instance callback) kullanan betiklere sahip olmaması gerekir.[^2]

Bir geliştirici bir nesnenin rengini değiştirmek için MPB eklediğinde, motoru o belirli nesne için farkında olmadan eski CPU tabanlı işleme moduna geri döndürmeye zorlamış olur. Gerçek zamanlı strateji oyununda bu işlem 10.000 asker birimi üzerinde yapılırsa CPU yükü baş döndürücü biçimde fırlar ve Unity 6'ya yükseltmenin tüm faydalarını ortadan kaldırır.

## **Bölüm VI: Modern Standart: Unity 6.3'te Renderer Shader User Value (RSUV)**

MPB'nin modern hatlarla uyumsuzluğunun yarattığı mimari çıkmazın farkına varan Unity, Unity 6.3 LTS sürümünde **Renderer Shader User Value (RSUV)** özelliğini tanıtmıştır.[^15] RSUV, geliştiricilerin tek bir materyali paylaşan çok sayıda işleyici üzerinde basit örnek başına özelleştirmeler uygulaması gerektiğinde `MaterialPropertyBlock`'un kesin yerini alır.[^3]

### **RSUV'nin Çalışma Mekanizması**

RSUV, MPB'nin dezavantajı olan karmaşık ara bellek değişikliklerini tamamen atlar. Bunun yerine, doğrudan işleyicinin standart çizim verileriyle birlikte aktarılan son derece verimli 24 bitlik bir tamsayı kanalından yararlanır.[^3] Bu tamsayı ayrı bir ara bellek geçersiz kılması (buffer override) gerektirmek yerine mevcut veri yapısına entegre edildiği için hem SRP Batcher hem de GPU Resident Drawer ile mutlak uyumluluğu korur.[^3]

### **Uygulama ve Bit Düzeyinde Kodlama (Bitwise Encoding)**

Renk çeşitliliği için RSUV kullanmak üzere CPU, istenen RGB değerlerini tek bir 24 bitlik işaretsiz tamsayıya (`uint`) kodlamalıdır. Her renk kanalı (Kırmızı — Red, Yeşil — Green, Mavi — Blue) 8 bit kaplar (0 ile 255 arasında değerler sağlar).[^3]

Kodlama işlemi bit düzeyinde sola kaydırma (`<<`) ve bit düzeyinde VEYA (`|`) operatörlerini kullanır. Matematiksel ifade şu şekildedir:

$$
Color_{uint} = (Blue_{byte} \ll 16) | (Green_{byte} \ll 8) | (Red_{byte})
$$

Pratik C# uygulamasında, rastgele renk tonu (tint) uygulamak için `MeshRenderer` bileşenlerinden oluşan bir dizi üzerinde yineleme yapmak çok yüksek performans sağlar ve sıfır çöp bellek tahsisi (zero garbage allocation) üretir[^3]:

```csharp
MeshRenderer allMeshRenderers = FindObjectsByType<MeshRenderer>(FindObjectsSortMode.InstanceID);  
foreach (MeshRenderer meshRenderer in allMeshRenderers)  
{  
    // Daha canlı renkler için HSV renk uzayını kullanarak rastgele bir renk hesapla  
    Color32 targetColor = Color.HSVToRGB(UnityEngine.Random.Range(0f, 1f), 1f, 1f);  

    // RGB'yi 24 bitlik bir tamsayıya kodla (Mavi, Yeşil, Kırmızı)  
    uint encodedColor = ((uint)targetColor.b << 16) |   
                        ((uint)targetColor.g << 8) |   
                        ((uint)targetColor.r << 0);  

    // Yeni Unity 6.3 API'si aracılığıyla değeri doğrudan işleyiciye uygula
    meshRenderer.SetShaderUserValue(encodedColor);  
}
```

### **Gölgelendirici Tarafında Çözme (Shader Decoding)**

GPU tarafında gölgelendirici, bu 24 bitlik tamsayıyı normalleştirilmiş bir `float4` renk değerine geri açmalıdır (unpack). Unity, bu veri bloğuna erişmek için yerleşik `unity_RendererUserValue` değişkenini sağlar.[^3]

Çözme işlemi, her 8 bitlik bölümü izole etmek için `255` bit maskesiyle bit düzeyinde sağa kaydırma (`>>`) ve bit düzeyinde VE (`&`) operatörlerini kullanır. Ardından değeri `0.0` ile `1.0` aralığına normalleştirmek için 255'in çarpmaya göre tersiyle (`1.0 / 255.0`) çarpılır.[^3]

$$
Channel_{normalized} = ((unity\_RendererUserValue \gg Shift) \ \& \ 255) \times 0.0039215
$$

High-Level Shader Language (HLSL) dilinde veya Shader Graph içinde bir Custom Function düğümü aracılığıyla açma mantığı şu şekilde ifade edilir[^3]:

```hlsl
uint c = unity_RendererUserValue;  
float4 instanceColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  // Kırmızı Kanal (Red)  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  // Yeşil Kanal (Green)  
    (float)((c >> 16) & 255) * (1.0 / 255.0), // Mavi Kanal (Blue)  
    1.0 // Sabit Alpha  
);
```

Bu paradigma değişimi derin bir optimizasyon stratejisini kanıtlamaktadır: veri yapısı karmaşıklığını (MPB gibi) matematiksel hesaplama (RSUV) ile takas etmek. GPU işlemcileri bit düzeyinde işlemlerde son derece üstündür; bu da çözme maliyetinin neredeyse görünmez olduğu (çok küçük saat döngüsü — clock cycles maliyeti) anlamına gelir. Bu sırada SRP Batcher ve GPU Resident Drawer hatlarının korunması, kare süresinde (frame-time) devasa bir azalma sağlar.[^16]

## **Bölüm VII: Aşırı Ölçekli Çözüm: DOTS, ECS ve `URPMaterialPropertyOverride`**

Standart GameObject'lerin işleme kapasitesini aşan bir ölçekte çalışan projeler için (örneğin yüz binlerce bağımsız birim içeren kalabalık simülasyonları — boids, devasa RTS orduları), Unity'nin Data-Oriented Technology Stack (DOTS) teknolojisi nihai işleme mimarisini sunar.[^4]

### **Veri Odaklı Bellek Yönetimi (Data-Oriented Memory)**

GameObject'lerin Heap içinde dağınık durduğu nesne yönelimli (object-oriented) sistemin kısıtlamalarının aksine, Entity Component System (ECS) içindeki varlıklar (entities) bellekte tamamen bitişik veri dizileri (contiguous arrays of data) biçiminde yer alır.[^4] Bu bellek düzeni, `BatchRendererGroup` (BRG) API'sinin en yüksek performansa ulaşmak için ihtiyaç duyduğu yapıyla mükemmel şekilde örtüşür.

Entities Graphics paketinde geliştiriciler `URPMaterialPropertyOverride` bileşenini kullanabilirler.[^4] Bu sistem, zararlı `MaterialPropertyBlock` API'sini hiç kullanmadan varlık başına materyal özelliklerini geçersiz kılmaya (per-entity material overrides) olanak tanır.

### **DOTS Instancing'in Çalışma Mekanizması**

Bir varlık DOTS içinde işlendiğinde, DOTS Instancing için yapılandırılmış bir gölgelendirici (Shader Graph'te *Override Property Declaration* işaretlenip *Hybrid Per Instance* seçilerek) benzersiz bir 32 bitlik tamsayı (bir üst veri değeri — metadata value) alır.[^34] Bu tamsayı, GPU üzerindeki kararlı bir `GraphicsBuffer` içinde yer alan bir göreli konumu (offset) temsil eder.[^34]

Gölgelendirici, o anda işlediği örnek (instance) için özel özellik verilerini yüklemek amacıyla bu offset değerini kullanır.[^34] DOTS Instancing'i farklı kılan nokta şudur: Birden fazla varlık aynı özellik değerini paylaşıyorsa, DOTS Instancing bu veriyi bellekteki aynı konumdan (aynı offset'ten) okumalarına olanak tanıyarak GPU döngülerini kurtarır ve bellek tekrarını en aza indirir.[^34] Özellikler geleneksel sabit ara belleklere sığdırılmak yerine offset üzerinden yüklendiği için, bir çizim çağrısının boyutu artık katı biçimde sınırlandırılmaz ve son derece büyük örnek sayılarına olanak tanır.

```csharp
// DOTS / Burst Compile sistemi üzerinden RSUV değeri atama örneği 

public partial struct MaterialMeshInfoSystem : ISystem   
{  
    public void OnUpdate(ref SystemState state)   
    {  
        var entityManager = state.EntityManager;  
        // Değerleri doğrudan NativeArray içine atayarak paralel işleme yapın  
        // MonoBehaviour'un asla ulaşamayacağı bir yürütme hızı sunar.  
    }  
}
```

Varlık bileşen değerlerini Bursted Background Jobs (Burst Compiler ile derlenen arka plan işleri) aracılığıyla değiştirmek akılalmaz bir hızla gerçekleştirilebilir.[^4] Oyuncular, arazinin eğim açısına göre renk değiştiren çitlere veya yüksekliğe bağlı olarak renk değiştiren çimenlere sahip olabilir; tümü darboğaza girmeden tek bir çizim akışında (draw stream) işlenir.[^4]

## **Bölüm VIII: Alternatif Çözümlerin Analizi (Alternative Solutions)**

Orijinal Long Gil Studio taslağı alternatif optimizasyon tekniklerine kısaca değinmişti. Aşağıdaki analiz bu tekniklerin uygulanabilirliğini doğrulamakta, ancak bunları Unity 6 motorunun fiziksel kısıtlamaları bağlamına oturtmaktadır.

1. **Vertex Colors (Mesh Köşelerini Boyama):**
   * *Mekanizma:* Renk verilerini doğrudan 3B ağın köşelerine (vertices) kodlar. Gölgelendirici, ağdan `TEXCOORD` veya `COLOR` niteliğini okur.
   * *Etkinlik:* Son derece hafiftir ve tüm batching işlevlerinin yanı sıra GRD uyumluluğunu da kusursuzca korur.[^36]
   * *Zayıf Yönü:* Çalışma zamanında (runtime) köşe renklerini değiştirmek, ağ veri dizisi (`mesh.colors`) üzerinde işlem yapılmasını gerektirir. Bu eylem RAM'de ağın bir kopyasını oluşturarak CPU takılmalarına (stalls) ve çöp bellek tahsisine neden olur. Köşe boyama, yalnızca Blender veya Maya gibi yazılımlarda önceden "pişirilmiş" (baked) statik varyasyonlar için en uygun yöntem olmaya devam etmektedir.
2. **Texture Atlasing ve UV Kaydırmaları (UV Offsets):**
   * *Mekanizma:* Birden fazla renk varyasyonunu tek bir doku atlasında (texture atlas) birleştirir ve belirli pikselleri örneklemek için farklı nesnelerin UV koordinatlarını kaydırır.[^36]
   * *Etkinlik:* Bu teknik tek bir materyal ve tek bir doku kullanmaya devam ederek SRP Batcher ile mutlak uyumluluk sağlar.[^36]
   * *Zayıf Yönü:* Köşe renklerine benzer şekilde, çalışma zamanında farklı nesneler üzerinde UV koordinatlarını dinamik olarak değiştirmek genellikle benzersiz ağ örnekleri (mesh instances) oluşturmayı gerektirir ve bu da bellek şişmesine (memory bloat) yol açar. Ancak statik çevre tasarımı veya Voxel oyunları (Minecraft gibi) için bu teknik rakipsizdir.
3. **Düşük Seviyeli `Graphics.DrawMeshInstanced`:**
   * *Mekanizma:* Koordinat matrislerini ve renk dizilerini C# kodu aracılığıyla doğrudan GPU'ya göndermek için GameObject hiyerarşisini tamamen atlar.[^37]
   * *Etkinlik:* Sürü algoritmaları (flocking) veya prosedürel bitki örtüsü (procedural foliage) gibi sistemler için muazzam bir performans sunar.[^38]
   * *Unity 6'daki Zayıf Yönü:* `BatchRendererGroup` API'sinin ve GPU Resident Drawer'ın gelişi bu performansı "demokratikleştirerek" çoğu yaygın geliştirme senaryosunda karmaşık ayıklama (culling) ve çizim gönderme kodu yazma gereksinimini ortadan kaldırmıştır.[^19] Özel bir `DrawMeshInstanced` hattını sürdürmek, artık bunu GPU Resident Drawer'ın otomatikleştirmesine bırakmaktan daha fazla mühendislik kaynağı tüketmektedir.

## **Bölüm IX: Long Gil Studio DevLog İçin Önerilen İçerik Yapısı**

Kapsamlı teknik değerlendirme sürecine dayanarak aşağıdaki metin bölümü, tamamen gözden geçirilmiş ve üst düzey teknik profesyonelliği yansıtan önerilen DevLog makalesini sunmaktadır. Hatalı MPB yöntemini terk ederek okuyucuları Unity 6'nın gerçek mimari standartlarına yönlendirmektedir: RSUV ve GPU Resident Drawer.

---

**Unity 6: Aynı Materyali Paylaşan Binlerce Nesneyi Optimize Etme – Modern Mimari İçin MPB'yi Terk Etmek**

**Long Gil Studio Tarafından**

**🇻🇳 VİETNAMCA SÜRÜM (Türkçeye Çevrilmiştir)**

**1. İşleme Darboğazı: Materyal Çoğaltma Sorunu**

Büyük ölçekli oyunlar geliştirilirken son derece yaygın bir mimari soru ortaya çıkar: "Tek bir materyali paylaşan binlerce nesnenin rengini FPS düşüşüne yol açmadan nasıl değiştiririz?"

Birçok geliştirici sıklıkla `GetComponent<Renderer>().material.color` komutunu kullanır. Bu ölümcül bir hatadır (anti-pattern). `.material` çağrısı yapmak, Unity'yi o materyalin RAM üzerinde sessizce bir kopyasını (clone) oluşturmaya zorlar. Sonuç; ciddi bellek sızıntısı, sürekli Çöp Toplama (Garbage Collection) tetiklemeleri ve Batching sisteminin tamamen bozulmasıdır. CPU binlerce ayrı Draw Call işlemekten aşırı yüklenirken GPU aç bırakılır.

**2. Legacy Tuzağı: `MaterialPropertyBlock` Neden Unity 6'da "Öldü"?**

Eskiden "Pro" çözüm, materyali kopyalamadan her nesneye veri aktarmak için `MaterialPropertyBlock` (MPB) kullanmaktı. **Ancak Unity 6 (URP/HDRP) kullanıyorsanız bu yöntemi derhal bırakmalısınız.**

Unity 6 büyük ölçüde **SRP Batcher** hattına ve devrim niteliğindeki **GPU Resident Drawer (GRD)** teknolojisine dayanır. GRD tüm işleme akışını (Draw Call üretimi, Ayıklama/Culling) GPU üzerindeki Hesaplama Gölgelendiricilerine (Compute Shaders) aktararak CPU hesaplama süresini %50'ye kadar azaltmaya yardımcı olur. Ancak motorun temel dokümantasyonuna göre bir nesneye `MaterialPropertyBlock` eklediğinizde o nesne derhal SRP Batcher'dan çıkarılır ve GPU Resident Drawer ile uyumluluğunu tamamen kaybeder. MPB kullanmak, tüm ordunuz için Unity'yi yavaş ve CPU tüketen eski işleme hattına geri dönmeye zorlamanız anlamına gelir.

**3. Unity 6'nın Yeni Standardı: Renderer Shader User Value (RSUV)**

Bu çıkmazı kökten çözmek için Unity 6.3 LTS güncellemesi **Renderer Shader User Value (RSUV)** özelliğini tanıttı. Bu API, doğrudan işleyiciye (renderer) 24 bitlik bir tamsayı aktarmanıza olanak tanır. RSUV yeni ara bellekler (buffers) tahsis edilmesini gerektirmediğinden hem SRP Batcher hem de GPU Resident Drawer ile %100 uyumluluğu korur.

**Adım 1: C# Kodlaması (Zero Garbage Allocation)**

MPB gibi dize (string) kullanmak yerine, bit kaydırma (bitwise) işlemleriyle RGB rengini 24 bitlik bir tamsayıya kodlayacağız:

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Mavi, Yeşil ve Kırmızı kanallarını tek bir 24 bitlik tamsayıya kodla  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Değeri uygula (SRP ve GRD mimarisi için kesinlikle güvenli!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Adım 2: Shader Graph Üzerinde Çözme**

Shader Graph içinde, çıkışı `Vector4` olan bir **Custom Function** düğümü (Type: String, Name: DecodeColor) oluşturun. Tamsayıyı standart renge geri açmak için aşağıdaki HLSL kod parçasını yapıştırın:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Bu çıkışı Fragment Shader'ın Base Color girişine bağlayın. Artık sıfır CPU gecikmesiyle ve GPU Resident Drawer sisteminin gücünden tam olarak yararlanarak sınırsız renk varyasyonuna sahipsiniz.

**Örnek: Shader betiği üzerinde gerçek dünya uygulaması (Shader Graph kullanmadan)**

Kod (HLSL) ile özel gölgelendirici (custom shader) yazıyorsanız, `unity_RendererUserValue` değerini çözmek ve aşağıdaki fark (diff) örneğinde olduğu gibi `BaseColor` ile çarpmak için `BuildSurfaceData` fonksiyonuna müdahale edebilirsiniz:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // RSUV'yi çöz
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // rsuvColor rengini uygula
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ... 
}
```

*Ayrıntılı bilgi için:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. 100.000 Nesne Sınırını Aşmak: DOTS / ECS Çözümü**

Oyununuz yüz binlerce bağımsız birimin (devasa ordular gibi) işlenmesini gerektiriyorsa, işlemeyi ne kadar iyi optimize ederseniz edin geleneksel GameObject sistemi mutlaka CPU darboğazına girecektir. Bu ölçek için Unity DOTS yapısına geçin. `URPMaterialPropertyOverride` bileşenini kullanmak, düşük seviyede `BatchRendererGroup` API sistemiyle doğrudan iletişim kuran Veri Odaklı (Data-Oriented) bellek düzeni kurmaya olanak tanıyarak gerçek AAA standardında rakipsiz performans sağlar.

---

**🇺🇸 İNGİLİZCE SÜRÜM (Türkçeye Çevrilmiştir)**

**1. İşleme Darboğazı: Materyal Çoğaltma**

Yüksek yoğunluklu oyunlar geliştirilirken yaygın bir mimari zorluk ortaya çıkar: "Aynı materyali paylaşan binlerce nesnenin rengini performansı mahvetmeden nasıl değiştiririm?"

Geliştiriciler genellikle varsayılan olarak `GetComponent<Renderer>().material.color` kullanır. Bu ölümcül bir anti-pattern'dir. `.material` özelliğine erişmek, Unity'yi yönetilen yığın (managed heap) üzerinde materyali sessizce kopyalamaya zorlar. Bu durum ciddi bellek şişmesi yaratır, çöp toplama (garbage collection) sıçramalarını tetikler ve çizim çağrısı toplu işlemesini (draw call batching) yok ederek GPU'yu aç bırakırken CPU yükünü yönetilemez seviyelere çıkarır.

**2. Legacy Tuzağı: MaterialPropertyBlock Neden Unity 6'da Öldü?**

Tarihsel olarak "Pro" çözüm, materyalleri kopyalamadan örnek başına veri aktarmak için bir MaterialPropertyBlock (MPB) kullanmaktı. **Unity 6 (URP/HDRP) kullanıyorsanız bu yöntemi kullanmayı derhal bırakmalısınız.**

Unity 6 büyük ölçüde **SRP Batcher** ve devrim niteliğindeki yeni **GPU Resident Drawer (GRD)** üzerine kuruludur. GRD, görüş alanı ayıklama (frustum culling) ve çizim çağrısı üretimini GPU hesaplama gölgelendiricilerine devrederek CPU işleme süresini %50'ye kadar azaltır. Ancak çekirdek motor dokümantasyonuna göre bir nesneye MaterialPropertyBlock uygulamak, onu anında SRP Batcher'dan diskalifiye eder ve GPU Resident Drawer ile uyumluluğunu tamamen bozar. MPB kullanarak Unity'yi devasa ordularınız için yavaş, eski bir CPU bağımlı işleme yoluna geri dönmeye zorluyorsunuz.

**3. Unity 6 Standardı: Renderer Shader User Value (RSUV)**

Bu mimari çıkmazı çözmek için Unity 6.3 LTS, **Renderer Shader User Value (RSUV)** özelliğini tanıtmaktadır. Bu API, işleyicinin temel veri yüküne doğrudan 24 bitlik bir tamsayı aktarmanıza olanak tanır. Kalıcı sabit ara bellekleri değiştirmekten kaçındığı için RSUV hem SRP Batcher hem de GPU Resident Drawer ile %100 uyumluluğu korur.

**Adım 1: C# Kodlaması (Sıfır Bellek Tahsisi)**

Dizeler aktarmak ve bloklar oluşturmak yerine, bit düzeyinde işlemler kullanarak bir RGB rengini matematiksel olarak 24 bitlik işaretsiz bir tamsayıya paketliyoruz:

```csharp
using UnityEngine;

public class RSUVColorOverride : MonoBehaviour  
{  
    public Color32 targetColor = Color.red;

    void Start()  
    {  
        MeshRenderer rnd = GetComponent<MeshRenderer>();  

        // Mavi, Yeşil ve Kırmızı kanallarını tek bir 24 bitlik tamsayıya kodla  
        uint encodedColor = ((uint)targetColor.b << 16) |   
                            ((uint)targetColor.g << 8) |   
                            ((uint)targetColor.r);  

        // Değeri yerel olarak uygula (%100 SRP ve GRD Güvenli!)  
        rnd.SetShaderUserValue(encodedColor);  
    }  
}
```

**Adım 2: Gölgelendirici Çözme (Shader Decoding)**

Shader Graph içinde, `Vector4` çıkışlı bir **Custom Function** düğümü (Type: String, Name: DecodeColor) oluşturun. Tamsayıyı normalleştirilmiş bir float renge geri açmak için bu HLSL kodunu yapıştırın:

```hlsl
uint c = unity_RendererUserValue;  
OutColor = float4(  
    (float)((c >> 0) & 255) * (1.0 / 255.0),  
    (float)((c >> 8) & 255) * (1.0 / 255.0),  
    (float)((c >> 16) & 255) * (1.0 / 255.0),  
    1.0  
);
```

Bu çıkışı Base Color fragment girişinize bağlayın. Artık GPU Resident Drawer'dan tam olarak yararlanırken sıfır çizim çağrısı cezasıyla sonsuz renk varyasyonuna sahipsiniz.

**Örnek: Özel Bir Gölgelendiricide Gerçek Dünya Uygulaması (Shader Graph olmadan)**

Kod (HLSL) ile özel bir gölgelendirici yazıyorsanız, aşağıdaki fark (diff) örneğinde gösterildiği gibi `unity_RendererUserValue` değerini çözmek ve `BaseColor` ile çarpmak için `BuildSurfaceData` fonksiyonunu düzenleyebilirsiniz:

```hlsl
void BuildSurfaceData(FragInputs fragInputs, inout GlobalSurfaceDescription surfaceDescription, float3 V, PositionInputs posInput, out SurfaceData surfaceData)
{
    ZERO_INITIALIZE(SurfaceData, surfaceData);

    surfaceData.specularOcclusion = 1.0;
    surfaceData.thickness = 0.0;

    // RSUV'yi çöz
    uint rsuvValue = unity_RendererUserValue;
    float3 rsuvColor = float3(1.0, 1.0, 1.0);
    if (rsuvValue != 0) {
        rsuvColor.r = (float)((rsuvValue >> 0) & 255) / 255.0;
        rsuvColor.g = (float)((rsuvValue >> 8) & 255) / 255.0;
        rsuvColor.b = (float)((rsuvValue >> 16) & 255) / 255.0;
    }

    // rsuvColor uygula
    surfaceData.baseColor =             surfaceDescription.BaseColor * rsuvColor;
    surfaceData.perceptualSmoothness =  surfaceDescription.Smoothness;
    surfaceData.ambientOcclusion =      surfaceDescription.Occlusion;
    surfaceData.metallic =              surfaceDescription.Metallic;
    surfaceData.coatMask =              surfaceDescription.CoatMask;
    // ...
}
```

*Ayrıca bakınız:*

{% include embed/youtube.html id='U5UXG3D9GXE' %}

**4. 100.000 Nesnenin Ötesine Geçmek: DOTS / ECS**

Oyununuz yüz binlerce dinamik birimin işlenmesini gerektiriyorsa, grafik optimizasyonlarından bağımsız olarak standart GameObject'ler eninde sonunda CPU'nun ana iş parçacığını darboğaza sokacaktır. Devasa ölçek için Unity DOTS'a geçin. `URPMaterialPropertyOverride` bileşenini kullanmak, katı Veri Odaklı (Data-Oriented) bellek düzenlerine olanak tanır. Bu, doğrudan düşük seviyeli `BatchRendererGroup` API'si ile arayüz kurarak eşsiz, saf AAA düzeyinde işleme performansı elde eder.

---

## **Bölüm X: Geliştirme Ekipleri İçin Stratejik Öneriler**

Modern işleme modellerinin analizi, eski (legacy) optimizasyon bilgisi ile çağdaş motor mimarisi arasında önemli bir fark olduğunu göstermektedir. Grafik mühendisleri için temel çıkarım şudur: Nesne başına veri ara belleklerini (data buffers) değiştirmek, doğası gereği paralel yürütme ve GPU tarafından yönetilen işleme döngüleriyle düşmandır. Unity 5.x veya Unity 2019 optimizasyon alışkanlıkları Unity 6 için kullanılamaz.

Unity 6'da maksimum performansa ulaşmak için geliştirme ekipleri aşağıdaki protokolleri sıkı bir şekilde uygulamalıdır:

1. **MPB Kullanımını Denetleyin (Audit for MPB Usage):** Kitlesel olarak örneklenen geometriye (mass-instanced geometry) `MaterialPropertyBlock` uygulanan durumları tespit edip kökünden ortadan kaldırmak için Profilleme araçları (örneğin Unity Profiler) ve Frame Debugger sürekli olarak çalıştırılmalıdır. MPB'nin kısa vadeli kolaylığı, GPU Resident Drawer özelliğinin sistematik kaybı karşısında tamamen gölgede kalmaktadır. Ekipler, gereksiz MPB başlatmalarını tespit etmek için kaynak kodunda uyarılar veya CI/CD betikleri oluşturmalıdır.
2. **Bit Düzeyinde Kodlama Stratejilerini Benimseyin (Bitwise Encoding Strategies):** Renderer Shader User Value (RSUV) kullanımı, programlama metodolojisinde bir değişiklik gerektirir. Teknik Sanatçılar (Technical Artists) ve oynanış programcıları, RSUV'nin 24 bitlik sınırı için katı bit düzeyinde paketleme şemaları tanımlamak üzere iş birliği yapmalıdır. Çeşitli veri durumlarının (renk, hasar, takım kimliği — team ID) işleyiciye ulaşmadan önce verimli bir şekilde serileştirildiğinden emin olunmalıdır. Örneğin: "Grup Kimliği (Faction ID)" için 4 bit (16 grup sağlar), "Hasar Durumu" için 8 bit (256 seviye sağlar) ve "Özel Tonlama (Custom Tint)" için 12 bit ayrılabilir — tümü gölgelendirici içinde bit maskeleri (bitmasks) aracılığıyla eş zamanlı olarak çözülür.
3. **ECS Geçiş Eşiklerini Değerlendirin (Evaluate Thresholds for ECS Transition):** RSUV, GameObject'ler için materyal varyasyonu darboğazını çözse de fizik hesaplamaları, dönüşüm (transform) hesaplamaları ve GameObject ayıklaması (culling) ile ilgili CPU sınırları hâlâ mevcuttur. Etkin dinamik varlık sayısının 10.000 dinamik ajanı (dynamic agents) aşacağını öngören projeler, DOTS (Entity Component System) uygulamaları için cesur ve proaktif biçimde prototipler tasarlamalıdır. `BatchRendererGroup` API'si ile doğrudan iletişim kurmak için `URPMaterialPropertyOverride`[^34] bileşenini kullanmak, yeni nesil PC ve oyun konsolu donanımlarının tüm güç potansiyelini açığa çıkarmanın tek yoludur.

## **Kaynakça**

[^1]: Enable the GPU Resident Drawer in URP - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html](https://docs.unity3d.com/Manual//urp/gpu-resident-drawer.html)
[^2]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.3/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)
[^3]: Set and use the RSUV - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-set-and-use.html)
[^4]: Migrated my game to ECS/DOTS and material overrides are awesome! : r/Unity3D - Reddit, erişim tarihi: 19 Nisan 2026, [https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated\_my\_game\_to\_ecsdots\_and\_material/](https://www.reddit.com/r/Unity3D/comments/1cuky8n/migrated_my_game_to_ecsdots_and_material/)
[^5]: Why You Should Stop Swapping Materials in Unity (And What to Do Instead) - Medium, erişim tarihi: 19 Nisan 2026, [https://medium.com/@MTCrypto\_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e](https://medium.com/@MTCrypto_bros/why-you-should-stop-swapping-materials-in-unity-and-what-to-do-instead-acd3c3a89a1e)
[^6]: Material Property Blocks - using them to store the original color of a material upon instantiation : r/Unity3D - Reddit, erişim tarihi: 19 Nisan 2026, [https://www.reddit.com/r/Unity3D/comments/10jyr9b/material\_property\_blocks\_using\_them\_to\_store\_the/](https://www.reddit.com/r/Unity3D/comments/10jyr9b/material_property_blocks_using_them_to_store_the/)
[^7]: Instancing and Material Property Blocks | Ronja's tutorials, erişim tarihi: 19 Nisan 2026, [https://www.ronja-tutorials.com/post/048-material-property-blocks/](https://www.ronja-tutorials.com/post/048-material-property-blocks/)
[^8]: Scripting API: MaterialPropertyBlock - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html](https://docs.unity3d.com/ScriptReference/MaterialPropertyBlock.html)
[^9]: Unity 6 and custom material bug - Spine Forum, erişim tarihi: 19 Nisan 2026, [https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug](https://esotericsoftware.com/forum/d/28167-unity-6-and-custom-material-bug)
[^10]: Scriptable Render Pipeline (SRP) Batcher - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.1/Documentation/Manual/SRPBatcher.html)
[^11]: Scriptable Render Pipeline Batcher - Unity 6.3 User Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2020.3/Documentation/Manual/SRPBatcher.html)
[^12]: GPU instancing - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html](https://docs.unity3d.com/2020.3/Documentation/Manual/GPUInstancing.html)
[^13]: Remove SRP Batcher compatibility for GameObjects | High Definition Render Pipeline | 17.0.4 - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/SRPBatcher-Incompatible.html)
[^14]: Beginning Game Development: GPU Resident Drawer | by Lem Apperson - Medium, erişim tarihi: 19 Nisan 2026, [https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3](https://medium.com/@lemapp09/beginning-game-development-gpu-resident-drawer-e3f0ca6516f3)
[^15]: Introduction to RSUV - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html](https://docs.unity3d.com/6000.3/Documentation/Manual/renderer-shader-user-value-intro.html)
[^16]: Renderer Shader User Value sample - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html](https://docs.unity3d.com/6000.4/Documentation/Manual/renderer-shader-user-value-sample.html)
[^17]: Speed Up Your Game Rendering in Unity3D: The Secret to Changing Material Colors, erişim tarihi: 19 Nisan 2026, [https://www.youtube.com/watch?v=CjfMAhU7cY8](https://www.youtube.com/watch?v=CjfMAhU7cY8)
[^18]: Scriptable Render Pipeline Batcher - Unity User Manual 2021.3 (LTS), erişim tarihi: 19 Nisan 2026, [https://docs.unity.cn/Manual/SRPBatcher.html](https://docs.unity.cn/Manual/SRPBatcher.html)
[^19]: Unity Draw Call Batching: The Ultimate Guide (2026 Update), erişim tarihi: 19 Nisan 2026, [https://thegamedev.guru/unity-performance/draw-call-optimization/](https://thegamedev.guru/unity-performance/draw-call-optimization/)
[^20]: Scriptable Render Pipeline Batcher - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html](https://docs.unity3d.com/2022.3/Documentation/Manual/SRPBatcher.html)
[^21]: SRP Batcher: Speed up your rendering - Unity, erişim tarihi: 19 Nisan 2026, [https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering](https://unity.com/blog/engine-platform/srp-batcher-speed-up-your-rendering)
[^22]: Remove SRP Batcher compatibility for GameObjects in URP - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html](https://docs.unity3d.com/6000.3/Documentation/Manual/SRPBatcher-Incompatible.html)
[^23]: GPU Instancing not working? Why amount of batches doesn't change? : r/Unity3D - Reddit, erişim tarihi: 19 Nisan 2026, [https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu\_instancing\_not\_working\_why\_amount\_of\_batches/](https://www.reddit.com/r/Unity3D/comments/1i501pn/gpu_instancing_not_working_why_amount_of_batches/)
[^24]: Scripting API: Renderer.GetPropertyBlock - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html](https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Renderer.GetPropertyBlock.html)
[^25]: Create batches with the BatchRendererGroup API in URP - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-creating-batches.html)
[^26]: Use the GPU Resident Drawer | High Definition Render Pipeline | 17.0.4 - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html](https://docs.unity3d.com/Packages/com.unity.render-pipelines.high-definition@17.0/manual/gpu-resident-drawer.html)
[^27]: Create draw commands with the BatchRendererGroup API | High Definition Render Pipeline, erişim tarihi: 19 Nisan 2026, [https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html](https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition@17.1/manual/batch-renderer-group-creating-draw-commands.html)
[^28]: Unity Tip Tuesday: GPU Resident Drawer & GPU occlusion culling - YouTube, erişim tarihi: 19 Nisan 2026, [https://www.youtube.com/shorts/0PenzdQFlv0](https://www.youtube.com/shorts/0PenzdQFlv0)
[^29]: Graphics Features and Tools in Unity 6 Feel Like MAGIC! STP, Resident Drawer, and Occlusion Culling! - YouTube, erişim tarihi: 19 Nisan 2026, [https://www.youtube.com/watch?v=trdeAq3WPkQ](https://www.youtube.com/watch?v=trdeAq3WPkQ)
[^30]: Initialize a BatchRendererGroup object in URP - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html](https://docs.unity3d.com/6000.3/Documentation/Manual/batch-renderer-group-initializing.html)
[^31]: Boost performance of your game in Unity 6 with GPU Resident Drawer - The Knights of U, erişim tarihi: 19 Nisan 2026, [https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/](https://theknightsofu.com/boost-performance-of-your-game-in-unity-6-with-gpu-resident-drawer/)
[^32]: Make a GameObject compatible with the GPU Resident Drawer in URP - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html](https://docs.unity3d.com/6000.1/Documentation/Manual/urp/make-object-compatible-gpu-rendering.html)
[^33]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@1.4/manual/material-overrides-asset.html)
[^34]: DOTS Instancing shaders in URP - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/Manual/dots-instancing-shaders.html](https://docs.unity3d.com/Manual/dots-instancing-shaders.html)
[^35]: Material overrides using the Material Override Asset | Entities Graphics - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html](https://docs.unity3d.com/Packages/com.unity.entities.graphics@6.5/manual/material-overrides-asset.html)
[^36]: One Material multiple colors possible? : r/Unity3D - Reddit, erişim tarihi: 19 Nisan 2026, [https://www.reddit.com/r/Unity3D/comments/9oi8kz/one\_material\_multiple\_colors\_possible/](https://www.reddit.com/r/Unity3D/comments/9oi8kz/one_material_multiple_colors_possible/)
[^37]: Single-pass instanced rendering and custom shaders - Unity - Manual, erişim tarihi: 19 Nisan 2026, [https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html](https://docs.unity3d.com/2021.3/Documentation/Manual/SinglePassInstancing.html)
[^38]: Use Graphics.DrawMeshInstanced or similar but vary the color on a per object basis?, erişim tarihi: 19 Nisan 2026, [https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use\_graphicsdrawmeshinstanced\_or\_similar\_but\_vary/](https://www.reddit.com/r/Unity3D/comments/1bqnyb5/use_graphicsdrawmeshinstanced_or_similar_but_vary/)
