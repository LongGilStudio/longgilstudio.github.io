---
title: "Derinlemesine Teknik Araştırma Raporu: Unity Addressables Ortamında DelayedActionManager'ın Çalışma Mekanizması, Sistem Mimarisi ve Etkileri"
date: 2026-10-01 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, addressables, memory-management, async, delayedactionmanager, optimization]
description: Unity Addressables içerisindeki DelayedActionManager'ın ComponentSingleton mimarisinin, LateUpdate yürütme mekanizmasının, C#/C++ proxy istisna yönetiminin ve AssetBundle bellek optimizasyon stratejilerinin derinlemesine analizi.
lang: tr
translation_id: unity-addressables-delayedactionmanager
---

Addressable Asset System (kısaca Addressables), geleneksel AssetBundles altyapısı üzerine inşa edilmiş esnek, güçlü ve optimize edilmiş bir içerik yönetimi çözümü sunarak Unity'de mimari açıdan devrim niteliğinde bir adım atılmasını sağlamıştır[^1]. Büyük ölçekli oyunların veya etkileşimli uygulamaların tasarlanması ve işletilmesi sürecinde, varlıkları (assets) otomatik olarak yüklemek ve serbest bırakmak için asenkron veri akışlarını yönetmek temel bir gereksinimdir. Bu karmaşık görevi üstlenen temel bileşenlerden biri olan, ancak yazılım mühendisleri Hierarchy (Hiyerarşi) penceresini incelerken sıklıkla kafa karışıklığına yol açan yapı; `DontDestroyOnLoad` sahnesinin içinde yer alan ve otomatik olarak oluşturulan `DelayedActionManager` adlı nesnedir[^2].

Bu teknik rapor; `DelayedActionManager`'ın mimari doğasını kapsamlı biçimde çözümlemeyi, `DontDestroyOnLoad` alanında neden bulunduğunu açıklamayı, Unity'nin gerçek zamanlı döngüsü içindeki yürütme mekanizmasını analiz etmeyi ve bellek yönetimi, bellek sızıntıları (memory leaks) ile sık karşılaşılan iş parçacığı/yaşam döngüsü istisnalarına (exceptions) dair zorlukları irdelemeyi amaçlamaktadır. Sistem tasarımı verilerini ve en iyi uygulamaları inceleyerek, yazılım mimarlarına uygulama kararlılığını en üst düzeye çıkarma konusunda derinlemesine bir bakış açısı sunmaktadır.

## Varlık Yükleme Sisteminin Evrimi ve Asenkron Temeller

`DelayedActionManager`'ın mikro mimarisine inmeden önce, Addressables sisteminin ortaya çıkış bağlamını anlamak ön koşuldur. Unity'nin eski sürümlerinde geliştiriciler genellikle `Resources` klasörüne veya doğrudan ham AssetBundle betiklerine bağımlıydı[^4]. `Resources.Load()` mekanizması, kullanıcının bizzat bir depoya girmesine benzer; tam klasör yolunu gerektirir ve varlık bulunup belleğe yüklenene kadar ana yürütme iş parçacığının (main thread) donmasına (block) neden olur[^4]. Bu yöntemin dezavantajı, uygulamanın ölçeklenebilirliğini engellemesi ve büyük veriler işlenirken ciddi FPS düşüşlerine (FPS drop) yol açmasıdır.

Bu sorunu çözmek için Addressables modern bir lojistik hizmeti gibi çalışır. Geliştiricilerin yalnızca varlığın tanımlayıcısını (address/key) sağlaması yeterlidir; sistem, varlığı yerel depolamadan (Local) mı bulacağını yoksa bir İçerik Dağıtım Ağı (CDN - Content Delivery Network) sunucusundan mı indireceğini otomatik olarak yönlendirir[^4]. En önemlisi, bu döngünün tamamı asenkron (asynchronous) olarak gerçekleşir. Başta `Addressables.LoadAssetAsync` olmak üzere yükleme komutları nesneyi hemen döndürmez; bunun yerine `AsyncOperationHandle` adlı bir yönlendirici tutamaç (handle) döndürür[^4]. Bu arayüz, varlık hazır olduğunda tetiklenen bir geri çağırım (callback) mekanizması sunarak uygulamanın ana iş parçacığının fizik ve grafik mantığını kesintisiz şekilde işlemeye devam etmesine olanak tanır[^4].

Tamamen senkron modelden asenkron modele geçiş, büyük bir mimari zorluğu da beraberinde getirir: Yavaş ağ bant genişliği nedeniyle bir varlık yükleme işleminin tamamlanması birkaç saniye sürdüğünde, uygulama çoktan tamamen farklı bir sahneye (scene) geçmiş olabilir[^1]. Geri çağırımları (callbacks), görev kuyruklarını (command queues) ve referans sayacını (reference counting) yönetmek; normal sahnelerin oluşturulma ve yok edilme yaşam döngüsünden etkilenmeyen merkezi bir yönetim varlığı gerektirir. İşte bu nedenle Unity geliştiricileri `DontDestroyOnLoad` sahne modelini Addressables'ın çekirdeğine entegre etmiştir.

## DontDestroyOnLoad (DDOL) Sahnesi ve Küresel Kalıcılık Mimarisi

Unity ortamında yeni bir sahne yükleme işlemi (varsayılan Single modunda `SceneManager.LoadScene` aracılığıyla), otomatik olarak bellek temizleme mekanizmasını tetikler. Motor, artık kullanılmayan kaynakların serbest bırakılmasını sağlamak amacıyla bir önceki sahneye ait tüm GameObject ve Component örneklerini yok eder (destroy)[^7]. Eklemeli sahne yükleme (Additive scenes) özelliği küresel durumu yönetmek için birden fazla sahnenin paralel olarak aktif kalmasına izin verse de (örneğin biri Game Manager'a, diğeri Level'a ayrılmış sahneler), `DontDestroyOnLoad` (DDOL) mekanizması düşük seviyeli nesneleri korumak için kritik bir sistem tekniği olmayı sürdürür[^7].

Unity Editor arayüzünde Play düğmesine basıldığında `DontDestroyOnLoad` sahnesinin görünmesi bir hata değildir; aksine, sahne geçişlerinde yok edilmemek üzere işaretlenen nesneleri gruplamak için motorun varsayılan olarak kullandığı gizli bir mekanizmadır[^9]. Bir GameObject'in bu güvenli alana kabul edilmesi için Unity katı bir kural uygular: Söz konusu nesnenin sahnenin kök seviyesinde (root level) yer alması gerekir[^8]. Bir alt nesne (nested object) üzerinde `DontDestroyOnLoad(gameObject)` işlevini çağırmaya yönelik her girişim başarısız olur ve bir uyarı kaydedilir[^8].

Addressables sistemi açısından varlık yükleme ve serbest bırakma süreçleri, farklı sahneler boyunca uzanan yaşam döngülerine sahip işlemlerdir. Örneğin, uzak bir sunucudan indirilen bir AssetBundle'ın durumunu izleme işlemi, yalnızca oyuncu bir bölüm geçiş kapısından geçti diye yarıda iptal edilemez. `RuntimeInitializeOnLoadMethod` mekanizmasının gelişmiş Singleton tasarım deseniyle birleştirilmesi, Addressables kaynak kodunun uygulama başlar başlamaz otomatik olarak bir kök nesne oluşturup onu DDOL sahnesine yerleştirmesini sağlar[^2]. Bu durum, geliştirici DDOL ile ilgili tek bir satır kod yazmasa dahi sahne listesinin sol alt köşesinde `DelayedActionManager` adlı bir nesnenin neden otomatik olarak belirdiğini açıklar[^2].

## DelayedActionManager'ın İç Yapısı ve Teknik Rolü

Addressables paketinin kaynak kodu ve API dokümantasyonu derinlemesine incelendiğinde, `DelayedActionManager`'ın `UnityEngine.ResourceManagement.Util` ad alanı (namespace) içinde yer alan somut bir sınıf (concrete class) olduğu görülür[^11]. Yapısı basit bir statik yardımcı sınıf (static utility class) değildir; aksine temel bir mimariden kalıtım alarak doğrudan bir GameObject'e eklenen bir bileşendir (Component)[^12].

### ComponentSingleton Deseni ve Başlatma Otomasyonu

`DelayedActionManager`'ın mimarisi, aynı ad alanında tanımlanmış temel bir sınıf olan `ComponentSingleton` tasarım deseni üzerine inşa edilmiştir[^13]. Singleton deseninin saf bir C# sınıfı yerine bir Bileşen (Component) üzerinde kullanılması, sisteme Unity'nin gerçek zamanlı olay döngüsüyle (`PlayerLoop`) doğrudan etkileşime girme yeteneği kazandırır.

`ResourceManager` sistemi ilk kez bir yükleme veya durum güncelleme isteği aldığında (örneğin `Addressables.LoadAssetAsync` veya ağ tanılama işlemleri), `DelayedActionManager` örneğini çağırır. Bu anda `ComponentSingleton` deseni otomatik olarak gizli bir süreç yürütür: Boş bir GameObject oluşturur, adını `"DelayedActionManager"` koyar, ilgili betiği ona ekler ve küresel koruma alanına almak için hemen `DontDestroyOnLoad` işlevini çağırır[^2]. Bu tembel başlatma (lazy initialization) tasarımı, sistem kaynaklarının yalnızca ertelenmiş görev yönetimi gerçekten gerektiğinde tüketilmesini sağlayarak, bu nesnenin arayüzde "sihirli" bir şekilde belirmesine dair geliştiricilerin sıkça sorduğu soruları yanıtlar[^3].

### Zamanlama Mekanizması ve LateUpdate Aşaması Analizi

`DelayedActionManager`'ın temel görevi; ertelenmiş eylemler, geri çağırımlar (callbacks), coroutine'ler ve mikro düzeyde bellek yönetimi için merkezi bir zamanlayıcı (central scheduler) işlevi görmektir[^11]. Mimarisindeki ince ancak son derece kritik bir fark, tüm kuyruk işleme mantığının Unity yaşam döngüsündeki `LateUpdate()` işlevi içinde çalışacak şekilde yönlendirilmesidir[^11].

Geleneksel `Update` yerine `LateUpdate`'in tercih edilmesi, veri tutarlılığıyla ilgili derin bir mimari sorunu çözer. Aşağıdaki tablo, Unity'nin yürütme sırasını ve `LateUpdate` aşamasının Addressables verilerini korumadaki rolünü göstermektedir:

| Yürütme Aşaması (PlayerLoop) | Tipik İşlevler | Addressables ve DelayedActionManager Açısından Rolü |
| :--- | :--- | :--- |
| **FixedUpdate** | Fizik simülasyonu, statik/dinamik çarpışma hesaplamaları. | Oyun mantığı çarpışma sonrasında nesne yok etme isteklerini tetikleyebilir. |
| **Update** | Oyuncu girdileri (Input), hareket, yapay zeka mantığı, oyun durumu güncellemeleri. | `Addressables.LoadAssetAsync` veya `Release` işlevleri manuel olarak çağrılır. GameObject'ler burada `Destroy()` edilebilir. |
| **LateUpdate** | Kamera konumu güncellemeleri, son işleme (post-processing) ayarlamaları. | `DelayedActionManager`, `Update` aşamasındaki yok etme komutlarıyla çakışmamak için belleği temizler, referans sayaçlarını günceller ve asenkron geri çağırımları tetikler[^11]. |

Eğer `ResourceManager` görev tamamlama geri çağırımlarını `Update` aşamasının ortasında hemen yürütseydi, henüz kare hesaplamasını tamamlamamış ara bir durumda olan bir sistemle (örneğin grafik veya kullanıcı arayüzü sistemi) etkileşime girme riski çok yüksek olurdu. `DelayedActionManager`, `OnComplete` işlevlerinin çağrılmasını veya referans sayacının azaltılmasını (ref-count decrements) `LateUpdate()` aşamasına erteleyerek (delaying), mevcut karenin tüm mantıksal durumunun kararlı hale gelmesini garanti altına alır[^11]. Çok sayıda yığın izi (stack trace) hata raporundan elde edilen veriler, kontrolün kullanıcı koduna geri verilmesinden önceki son köprünün `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` işlevi olduğunu göstermektedir[^15].

## Sistem İstisnalarının (System Exceptions) ve Yığın İzlerinin (Stack Traces) İncelenmesi

Yüksek güvenlik göz önünde bulundurularak tasarlanmış olmasına rağmen, asenkron mekanizmanın karmaşıklığı ve geliştiricilerin hatalı yaşam döngüsü yönetimi işlemleri bir araya geldiğinde `DelayedActionManager` sıklıkla ciddi istisnaların odak noktası haline gelir. Hata raporları, sistemin yönetilen bellek (managed memory) ve yerel bellek (native memory) ile nasıl etkileşime girdiğine dair kritik ipuçları sunar.

### NullReferenceException Hatası ve C# – C++ Proxy Yaşam Döngüsü Çakışması

Addressables ortamında çok yaygın görülen bir hata senaryosu, `DelayedActionManager`'ın `StartCoroutine_Auto` işlevinden kaynaklanan `ArgumentNullException: Value cannot be null. Parameter name: obj` istisnasıdır[^19]. Bu hata Unity'nin kendi içindeki bir arıza değildir; C# Çöp Toplayıcı (Garbage Collector) mekanizması ile alttaki C++ kaynak kodunun yerel işaretçi (pointer) yönetimi arasındaki uyumsuzluktan doğar[^19].

Unity'de `GameObject` veya `MonoBehaviour` gibi nesneler aslında C# ile yazılmış vekil sınıflardır (proxy classes) ve motor içinde C++ ile ayrılmış yerel nesneye işaret eden dahili bir referans taşırlar[^19]. Geliştirici `Destroy(gameObject)` komutunu çağırdığında, C++ nesnesi anında yok edilir, bellek alanı iade edilir ve dahili referans null olur[^19]. Ancak C# proxy sınıfı, çöp toplayıcı tarama yapana kadar yönetilen bellekte (managed memory) bir süre daha varlığını sürdürebilir[^19].

Geliştiriciler anonim ifadeleri (lambdas/closures) Addressables'ın asenkron süreçleriyle birlikte kullandığında felaket yaşanır. Bir lambda ifadesi, etrafındaki bağlam değişkenlerini "yakalama" (capture) özelliğine sahiptir. Aşağıdaki kod örneğini inceleyin:

```csharp
// DelayedActionManager kuyruğuna eklenen bir eylem
DelayedAction(null, () => {
    _crawlerRobot.BreakAwayLowerBody();
    if (isLevelLoad) {
        PhysicsUtil.ManualSimulation(2);
    }
});
```

Bu kod çalıştırıldığında `_crawlerRobot` değişkeni (bir C# proxy'si) closure tarafından tutulur[^19]. Eğer oyun mantığı `_crawlerRobot`'u tam da o kare içinde yok ederse, alttaki C++ işaretçisi ortadan kalkar. Ancak `DelayedActionManager` bu lambda'yı `LateUpdate` aşamasında (veya sonraki bir karede) çalıştırmak üzere zamanladığı için, lambda gerçekten tetiklendiğinde ölmüş bir C++ işaretçisinin `BreakAwayLowerBody()` bileşenine erişmeye çalışır[^19]. Kaçınılmaz sonuç olarak sistem `NullReferenceException` fırlatır veya "Nesne yok edildi ancak ona hâlâ erişmeye çalışıyorsunuz" hata mesajını verir[^19].

Bu mimari riski ortadan kaldırmak için yazılım uzmanları iki tasarım çözümü önermektedir:

1. Düşük seviyeli durum değişikliklerini işlerken lambda ifadelerini aşırı derecede iç içe geçirmekten (lambdas nesting) kaçının[^19].
2. Unity'nin alttaki C++ işaretçisinin durumunu doğrudan denetlemek için C#'ın `==` operatörünü aşırı yüklemiş (overloaded) olmasından yararlanarak her zaman güvenli null kontrolü yapın[^19].

### PlayerLoop Çakışması ve `"Assertion failed on expression: ShouldRunBehaviour()"` Hatası

Addressables paketlerinin sürüm yönetimi sürecinde çok sayıda geliştirici, Unity Editor'ın `MonoBehaviour.cpp` dosyasında düşük seviyeli bir hata mesajıyla dolup taştığını bildirmiştir: `Assertion failed on expression: 'ShouldRunBehaviour()'`[^3].

Yığın izi (stack trace), bu sürecin doğrudan `DontDestroyOnLoad` sahnesinde bulunan `"DelayedActionManager"` GameObject'inden kaynaklandığını göstermektedir[^3]. Kök Neden Analizi (Root Cause Analysis), Unity Editor'ın oynatma modu (Play Mode) işleme akışındaki bir açığı ortaya koymaktadır. Editör bir Etki Alanı Yeniden Yüklemesi (Domain Reload) geçirdiğinde veya varlık yükleme işlemi henüz tamamlanmadan kullanıcı oyunu Durdur (Stop) düğmesine bastığında, `DelayedActionManager` sahipsiz bir nesne (orphaned object) olarak sıkışıp kalır[^3].

`DontDestroyOnLoad` olarak işaretlendiği için, Unity'nin yerel yürütme ortamı (`PlayerLoop`) tüm görevlerin durdurulması emrini vermiş olmasına rağmen `LateUpdate` döngülerini ve davranış denetimlerini (behaviour checks) çalıştırmaya devam etmeye çalışır[^3]. Bu hata en şiddetli biçimde Addressables 1.16.x sürümünden 1.18.x sürümüne geçiş sırasında kaydedilmiş ve birçok geliştirme ekibini senkron işleme API'sinin kararlılığını sağlamak ve kuyruk kilitlenmesini gidermek için manuel olarak 1.17.17 sürümüne düşürmeye (downgrade) zorlamıştır[^3].

### Sürüm Geçmişi Boyunca DelayedActionManager'daki Değişimler

Unity Addressables'ın API dokümantasyonu ve değişiklik günlükleri (changelogs) incelendiğinde ortaya çıkan ilginç bir nokta, `DelayedActionManager`'ın döngüsel varlığıdır. 0.7.5 ve 1.11.2 gibi sürümler, güncelleme günlüklerinde derleme betiği arayüzünün (build script interface) yeniden yapılandırıldığını şu ifadeyle açıkça duyurmuştur: *"Removed DelayedActionManager. Removed ISceneProvider. Users can implement custom scene loading"*[^20]. Bu karar başlangıçta API katmanını basitleştirmeyi ve kontrolü özelleştirilebilir `AsyncOperationBase` sınıfına devretmeyi amaçlamaktaydı[^20].

Bununla birlikte, 1.18.15, 1.19.19 ve 1.21.21 gibi LTS (Long-Term Support) sonrası sürümlerden gelen hata kayıtları, yığın izlerinde `UnityEngine.ResourceManagement.Util.DelayedActionManager:LateUpdate()` çağrısının sürekli olarak geri döndüğünü ortaya koymaktadır[^11]. Bu durum Unity'nin yinelemeli (iterative) tasarım felsefesini yansıtmaktadır: Sadeleştirme amacıyla kaldırdıktan sonra sistem mühendisleri, merkezi bir ertelenmiş görev yöneticisinin eksikliğinin tanılama olaylarını (`DiagnosticEventCollector`) toplama, ön yükleme tablolarını (preload tables) işleme ve uygulama kapanırken bellek güvenliğini sağlama konularında aşılamaz zorluklar yarattığını fark etmişlerdir[^11]. `DelayedActionManager` yeniden tasarlanarak gizli bir sistem yardımcı programı olarak geri getirilmiştir; artık halka açık kullanıcı arayüzünde görünmemekte, ancak uygulama kapatılırken oluşan temizlik (disposal) risklerini yönetmekten sorumlu olmaktadır[^20].

## Referans Sayımı ve Bellek Sızıntısı Dinamikleri

`DelayedActionManager`'ın varlığı, Addressables'ın en karmaşık temel taşlarından biriyle sıkı sıkıya bağlıdır: Bellek Yönetimi (Memory Management). Addressables, RAM üzerindeki verilerin varlığını tamamen Çöp Toplayıcıya (Garbage Collector) bırakmak yerine, Referans Sayımı (Reference Counting) mekanizması aracılığıyla kontrol eder[^23].

### Referans Dinamikleri ve Bağımlılık Hiyerarşisi

Sistem her varlık yükleme isteği aldığında, ilgili varlığın referans sayacı bir artırılır (increment). Kullanım tamamlandığında `Addressables.Release` komutu sisteme bu sayacı azaltma (decrement) talimatı verir[^23]. Altın kural şudur: Sistem, varlığı barındıran fiziksel belleğin serbest bırakılmasına yalnızca referans sayacı kesin olarak 0 değerine döndüğünde izin verir[^23].

Addressables bağımlılıkları AssetBundle mimarisi üzerinden yönettiği için karmaşıklık katlanarak artar. Bir varlık (örneğin bir `Material`) yüklendiğinde, sistem yalnızca o materyalin kendisini yüklemekle kalmaz, aynı zamanda onun bağımlı bileşenlerini (örneğin `Texture`) içeren tüm AssetBundle'ları otomatik olarak yükler[^25]. Bağımlılık grafiği (dependency graph) Bundle düzeyinde hesaplanır; yani Bundle A içindeki bir varlık Bundle B içindeki bir varlığa referans veriyorsa, Bundle B'nin tamamı sistem belleğine yüklenmek zorundadır[^26].

Unity'nin bu mimarideki en katı teknik kısıtlaması şudur: **Kullanıcı bir AssetBundle içeriğinin yalnızca bir kısmını (partially unload) bellekten boşaltamaz**[^23]. Bunu netleştirmek için içinde üç bağımsız varlık bulunan `"stuff"` adlı bir AssetBundle düşünelim: `Ağaç`, `Tank` ve `İnek`[^23].

1. `Ağaç` varlığı yüklendiğinde, bellek analiz aracı (Profiler) `Ağaç` için bir referans ve buna karşılık `stuff` paketi için bir referans gösterir[^23].
2. Ardından `Tank` varlığı yüklendiğinde, `Tank`'ın sayacı 1'e çıkar ve `stuff`'ın sayacı 2'ye yükselir[^23].
3. Oyun `Release(Ağaç)` komutunu çalıştırırsa, `Ağaç`'ın sayacı 0'a düşer ve Profiler üzerindeki mavi çubuk kaybolur[^23].
4. Ancak `Ağaç`'ın fiziksel verileri sistem belleğinde kalmaya devam eder. `Tank` hâlâ bağlantıyı sürdürdüğü ve `stuff` AssetBundle'ının sayacını 0'ın üzerinde tuttuğu için, tüm paket tamamen serbest bırakılana kadar bu paket içindeki hiçbir varlığın yok edilmesine izin verilmez[^23].

### "Asset Churn" Sendromu ve Bellek Şişmesi (Memory Bloat)

Varlıkların kısa bir süre içinde sürekli olarak yüklenip serbest bırakılması ve ardından hemen yeniden yüklenmesi olgusu "Asset Churn" (varlık çalkantısı / çekişmesi) olarak tanımlanır[^23]. Bu açık genellikle bölümler (levels) arasında geçiş yapılırken ortaya çıkar. Örneğin 1. Bölüm `Tekne` varlığını, 2. Bölüm ise `Uçak` varlığını kullanıyor olsun (ikisi de ortak bir `Kamuflaj` dokusunu paylaşsın). 1. Bölümden çıkılırken geliştirici `Tekne`'yi serbest bırakır; bu da Addressables'ın `Kamuflaj` dokusunu bellekten derhal kaldırmasına yol açar. Bir milisaniye sonra 2. Bölüm `Uçak`'ı oluşturduğunda, sistem sabit diski o `Kamuflaj` dokusunu en baştan yeniden yüklemek için G/Ç (I/O) döngüsünü çalıştırmaya zorlar[^23]. Bu süreç, özellikle mobil donanımlarda kare süresinde ani sıçramalar (spikes) yaratır ve bellek kullanımını tehlikeli eşiklere taşır[^27].

Bunun yanı sıra, tek bir `Release` komutunun unutulması çöp referansların birikmesine neden olarak birkaç sahne geçişi sonrasında RAM kullanımının yüzlerce megabayttan gigabayt seviyelerine tırmanmasına yol açar[^28]. Ne `DelayedActionManager` ne de Addressables'ın kendisi MonoBehaviour'un saf `Instantiate` yöntemiyle oluşturulan örneklerin (instances) sayısını takip etmediğinden, bellek tutamacının (handle) takibindeki en ufak bir hata kalıcı bellek sızıntılarına yol açar[^6].

### Veri Sıkıştırma Mimarisi ve Bellek Ayırma Baskısı

AssetBundle'ların boyutu ve veri sıkıştırma yöntemi, verilerin RAM üzerinde nasıl yer tuttuğunu doğrudan etkiler. Sıkıştırma yönteminin seçimi, AssetBundle'ın kalıcı olarak büyük bir bellek bloğu mu işgal edeceğini yoksa bant genişliğini optimize mi edebileceğini belirler.

AssetBundle sıkıştırma algoritmalarının özellikleri ve depolama etkilerine dair özet tablo[^29]:

| Sıkıştırma Algoritması | Yerel Dosya Tanıma Yeteneği | Tüm Bundle'ın RAM'e Yüklenmesini Gerektirir mi? | Performans ve Depolama Etkisi |
| :--- | :--- | :--- | :--- |
| **LZMA** | Hayır. Bundle tek parça halinde sıkıştırılmıştır. | **Evet.** Tüm dosya belleğe açılmalıdır. | En yüksek sıkıştırma oranı ve en küçük indirme boyutu sağlar; ancak çıkarım sırasında akut bellek şişmesine (Memory Bloat) ve yoğun CPU tüketimine neden olur[^29]. |
| **LZ4** | Evet. Parça tabanlı (chunk-based) sıkıştırma. | **Hayır.** Yalnızca o an erişilen veri kısmını yükler. | Varsayılan (default) standart olarak önerilir. Tüm üst veriyi (metadata) RAM'e yüklemeden doğrudan yerel diske önbelleğe almaya (caching) olanak tanır[^29]. |
| **Uncompressed** | Evet. Her varlığa bağımsız erişim. | **Hayır.** Doğrudan erişim sağlar. | Açma süresi harcamaz, ancak en büyük ham dosya boyutuna sahiptir. Disk bant genişliği elverdiğinde anlık yüklemeler için en uygunudur[^29]. |

Devasa bir LZMA sıkıştırmalı AssetBundle paketinden küçücük bir varlık istendiğinde, dosyanın tamamı (başlık, üst veriler, akış önbellek tabloları dahil) sabit diskten RAM'e aktarılmak zorundadır[^27]. Bu tasarım hatası, devasa AssetBundle'ları uygulama için bellek taşması (OOM crashes) yaratan saatli bombalara dönüştürür[^27].

## Varlık Yönetiminde En İyi Uygulamalar (Best Practices)

Referans sayımı sisteminin karmaşıklığını dizginlemek ve `DelayedActionManager` üzerindeki yükü azaltmak için sistem tasarımcıları, varlık yaşam döngüsü optimizasyon teknikleriyle birleştirilmiş son derece katı bir yaşam döngüsü yapısı uygulamak zorundadır.

### 1. Başlatma ve Serbest Bırakma Döngüsünü Senkronize Etme

API tarafından döndürülen her `AsyncOperationHandle` nesnesi, kullanım ömrü sona erdiğinde mutlaka serbest bırakılmalıdır[^6]. Bunu yapmamak yalnızca bellek sızıntılarına yol açmakla kalmaz, sistem çökmelerine (crashes) de neden olabilir[^6]. Aşağıdaki tablo, Addressables programlamasındaki zorunlu simetrik eşleştirmeleri göstermektedir:

| Başlatma / Yükleme Yöntemi | Karşılık Gelen Serbest Bırakma Yöntemi | Dahili Çalışma Mekanizması |
| :--- | :--- | :--- |
| `Addressables.LoadAssetAsync` | `Addressables.Release(handle)` | İçerdiği AssetBundle'ın referans sayacından 1 düşer[^6]. |
| `Addressables.InstantiateAsync` | `Addressables.ReleaseInstance(gameObject)` | Oluşturulan örneği (Instance) yok eder ve kaynak Prefab'ın sayacından otomatik olarak 1 düşer[^4]. |
| `AssetReference` üzerinden atama | `reference.ReleaseAsset()` | Tutamaç üzerinden Release çağırmaya benzer şekilde statik referansları temizler[^6]. |

Özellikle oyun ayarlarını saklamak için `ScriptableObject` kullanırken, bir nesneye doğrudan referans vermek (`public Object _worldAsset`) sert referanslar (hard references) oluşturarak tüm sistemin o varlığı anında RAM'e yüklemesini zorunlu kılar[^27]. En uygun çözüm, isteğe bağlı (on-demand loading) asenkron yükleme yapmak için `AssetReference` (`public AssetReference addressableAsset;`) kullanmaktır[^6].

### 2. Düşük Seviyeli Müdahale: `Resources.UnloadUnusedAssets()`

Paylaşılan AssetBundle'ların "kısmen boşaltılamama" özelliği nedeniyle bellek durumunda kilitlendiği çıkmaz senaryolarda (örneğin `Ağaç` varlığının `Tank` ile birlikte sıkışıp kalması), tek çıkış yolu motorun temel katmanından gelen zorlayıcı bir API'yi kullanmaktır: `Resources.UnloadUnusedAssets()`[^25].

Bu işlev, gerçek dahili referans sayısı (actual engine references) tamamen 0 olan her varlığı (AssetBundle içindeki gizli varlıklar dahil) tespit etmek için tüm sistem RAM'inde derinlemesine bir tarama yapar ve bunları zorla yok eder[^25]. Buna rağmen, CPU'nun temizleme taramasını gerçekleştirmek için mantık iş parçacığını duraklatması gerektiğinden, bu işlem son derece yüksek hesaplama maliyeti doğurur ve ciddi FPS düşüşlerine (FPS drops) neden olur[^27]. Mühendisler bu komutu yalnızca büyük ekran geçişlerinde (loading screens) tetiklemeli veya sahne değiştirirken `SceneManager.LoadScene` kullanıldığında sistem tarafından otomatik olarak çağrılmasına güvenmelidir[^29].

### 3. AssetBundle Planlama ve Bölümleme (Bundle Packing Modes)

Addressables yapılandırma arayüzündeki Grupların (Groups) yapısını düzenlemek, bellek yükleme performansını ve indirme bant genişliğini doğrudan belirler. Varlık türüne uygun paketleme modunu (Bundle Mode) seçmek kritik bir tasarım adımıdır[^6]:

* **Pack Together (Birlikte Paketle)**: Yaşam döngüleri birbirine sıkı sıkıya bağlı olan ve her zaman aynı anda görünen varlıklar için kullanılır. Bu yöntem, bağımlılık grafiği analizi ve ağ G/Ç (I/O) maliyetini en aza indirir[^6].
* **Pack Separately (Ayrı Paketle)**: Devasa boyutlu, bağımsız varlıklar veya her zaman birlikte yükleneceği garanti edilemeyen büyük haritalar için en uygunudur. Büyük bir varlığın başka küçük bir varlığın serbest bırakılmasını engelleme riskini ortadan kaldırır[^6].
* **Pack Together By Label (Etikete Göre Paketle)**: Dağınık halde bulunan varlıkların etiket üst verileri aracılığıyla birleştirilmesine olanak tanır (örneğin tüm etkinlik içeriğini tek bir bundle içinde toplamak ve CDN üzerinden kolayca güncellemek için `"Halloween 2023"` etiketini atamak)[^6].

AssetBundle içindeki içindekiler tablosu (`TypeTree`) yükünü daha da azaltmak için geliştiriciler `BuildAssetBundleOptions.DisableWriteTypeTree` seçeneğini etkinleştirebilir. Bu özellik gereksiz üst verileri temizler; ancak çalıştırılabilir dosyayı dışa aktarmadan önce yerel grupların yeniden derlenmesini (rebuild local groups) gerektirir[^26].

### 4. Ses ve Görüntü Belleği Yönetimi (Graphics & Audio)

Yardımcı katmanların optimize edilmesi, çöp toplayıcının çalışma sıklığını azaltmanın en etkili yoludur. Ses akışının yükleme formatı yapılandırması belleği doğrudan etkiler[^27]:

* **Uzun Arka Plan Müziği (BGM)**: Diskten küçük arabellek parçaları halinde yüklemek için **Streaming** olarak yapılandırılmalıdır[^27].
* **Uzun Ses Efektleri**: RAM üzerinde sıkıştırılmış halde tutmak ve oynatma sırasında gerçek zamanlı olarak açmak için **Compressed In Memory** seçilmelidir[^27].
* **Kısa / Yüksek Sıklıktaki Ses Efektleri**: CPU maliyetini ortadan kaldırarak sıkıştırılmamış veriyi doğrudan hazır bulundurmak için **Decompress On Load** kullanılmalıdır[^27].

Ayrıca, Texture'lar üzerindeki `"Read/Write enabled"` seçeneğini devre dışı bırakmak ve arayüz (UI) grafikleri için kullanılan Kamera'da derinlik arabelleğini (Depth Stencil Format to None) kaldırmak, gereksiz işleme RAM'i kullanımını en az %50 oranında azaltacaktır[^27].

## Küresel Etkileşimin Sonucu

`DelayedActionManager` üzerine yapılan bu inceleme, yalnızca `DontDestroyOnLoad` sahnesindeki gizli bir nesnenin kökenini çözmekle kalmaz, aynı zamanda Unity'deki Addressables sisteminin temel tasarım felsefesini de gözler önüne serer. Bu `ComponentSingleton` sınıfı; serbest bırakma süreçlerini, asenkron çağrıları ve önbellek işlemlerini `LateUpdate` döngüsüne yönlendirerek veri bütünlüğünü koruyan zarif bir zaman köprüsü görevi görür. Bellek yapısındaki değişiklikleri `Update` akışına ait fizik veya kontrol mantığının neden olabileceği kesintilerden yalıtarak, sahne geçişlerinde sistem bozulmasına yol açan istisnalara karşı bir kalkan oluşturur.

Bununla birlikte `DelayedActionManager`, bellek yönetimi mimarisinin içsel zayıflıklarını çözebilecek sihirli bir değnek değildir. Yazılım mimarlarına; tamamen simetrik bir varlık yükleme/serbest bırakma döngüsünü sürdürme, yerel C++ nesnelerini yakalayan döngülerden kaçınacak şekilde anonim C# ifadeleri (lambdas) tasarlama ve inatçı bellek sızıntılarını önlemek için AssetBundle yapısını modüler hale getirme (modularize) konusunda katı gereksinimler yükler. Geliştirme ekipleri; asenkron yükleme yönlendirmesini derinlemesine anlayarak, LZ4 gibi uygun sıkıştırma yöntemlerini kullanarak ve `Resources.UnloadUnusedAssets`'in zorlayıcı gücünden yararlanarak, kalıcı kaynak tükenmesi endişesi yaşamadan her platformda güçlü biçimde ölçeklenebilen sağlam mimari modeller tasarlayabilirler.

## **Kaynakça**

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

### İleri Okuma

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
