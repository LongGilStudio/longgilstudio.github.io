---
title: "Derinlemesine Teknik Rapor: GilongWorld Projesinde Özellik Dallanması Sırasında Ortaya Çıkan Unity GUID ve YAML Serileştirme Hatalarının Çözümü"
date: 2026-06-16 10:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, guid, serialization, assetdatabase, git]
description: "Unity'deki GUID tanımlayıcı sistemi ve YAML serileştirme mimarisi üzerine derinlemesine bir analiz ile özellik dallanması sırasında kırılan referansların çözüm yöntemi."
lang: tr
translation_id: gilongworld-unity-guid-serialization
---

## **Sistem Bağlamı ve Long Gil Studio'daki Yapısal Kriz**

Büyük ölçekli bir eğlence yazılımının geliştirme yaşam döngüsü boyunca, yeni tasarım gereksinimlerini karşılamak amacıyla sistem mimarisini yeniden yapılandırmak kaçınılmaz bir zorluktur. Long Gil Studio bünyesindeki mühendislik ekibi tarafından Unity platformu üzerinde geliştirilen **GilongWorld** projesi, sistem ölçeklendirme sürecinde ciddi bir teknik engelle karşı karşıya kaldı. Temel sorun pratik bir operasyonel ihtiyaçtan doğdu: geliştirme ekibi, oyundaki birbirinden ayrı özel mekaniklere (custom) hizmet etmesi amacıyla mevcut bir özelliği tamamen bağımsız iki geliştirme dalına ayırmak zorundaydı. Bu gereksinim, yeni özellik dalının orijinal özelliğin tüm mantık altyapısını, veri yapılarını ve görsel varlıklarını devralmasını; ancak yeni dalda yapılacak hiçbir müdahalenin orijinal özelliği bozacak bir dalga etkisi (ripple effect) yaratmamasını garanti altına almak için mutlak şekilde izole edilmesini şart koşuyordu.

Bu iki özellik ortak bir başlangıç noktasına sahip olduğundan, ilk dizin yapısı C# kaynak kod dosyalarından (Script) Prefab, Material ve Texture dosyalarına, hatta Animation yapılandırma dosyalarına kadar fiziksel olarak tamamen yinelenmiş bir dizi dosya içeriyordu. Long Gil Studio'nun nihai hedefi, bu iki varlık bloğunu birbirinden eksiksiz biçimde ayırmaktı. Ancak Unity Editor ortamında standart çoğaltma (duplicate) işlemi gerçekleştirildiğinde ciddi bir referans kopması meydana geldi: yeni varlık bloğunun (Prefab, `ScriptableObject`) tüm iç bağlantı sistemi, otomatik olarak orijinal dalın eski kaynak kod ve varlık dosyalarına yapışık kalmaya devam etti. Bu olay, veri yapısının bütünlüğünü geri kazandırmaya yönelik uzun soluklu bir teknik mücadele zincirini başlattı. Long Gil Studio'nun çözüm arayışı yalnızca sıradan bir hata ayıklama süreci değil, aynı zamanda Unity'deki serileştirme (serialization) sisteminin ve varlık veritabanının (`AssetDatabase`) doğasına dair derinlemesine bir öğrenme deneyimi oldu.

## **Unity'deki Serileştirme (Serialization) Mimarisi ve Tanımlayıcıların Anatomisi**

Standart klasör çoğaltma işleminin neden referans kopmalarına ve çakışmalarına yol açtığını kavramak için Unity Engine'in varlık yönetimi mimarisini temelden incelemek gerekir. Belgeleri konumlandırmak için genellikle fiziksel dosya yoluna (file path) veya dosya adına dayanan işletim sistemi dosya yöneticilerinin aksine Unity, fiziksel depolama alanındaki değişikliklere karşı bağışık olacak şekilde tasarlanmış dahili bir veritabanı sistemi işletir[^1].

### **YAML Serileştirme Dili ve Nesnel Veri Yapısı**

Unity Engine; Scene, Prefab, Material ve `ScriptableObject` gibi neredeyse tüm tasarım varlıklarının veri durumunu depolamak için YAML (YAML Ain't Markup Language) belirtiminin bir alt kümesini uygulayan yüksek performanslı bir serileştirme kütüphanesi kullanır[^2]. Bu mimari karar, şeffaf ve insan tarafından okunabilir bir metin biçimi sunarak geliştiricilerin Git gibi Sürüm Kontrol Sistemleri (Version Control System) üzerinden değişiklikleri kolayca izlemesine ve veri çakışmalarını etkin biçimde çözmesine olanak tanır[^3].

Herhangi bir Prefab veya Scene dosyasının kaynak kodu düz metin düzenleyicide incelendiğinde, YAML yapısı nesne bildirimleri ile referans bağlantılarından oluşan karmaşık bir ağı açığa çıkarır. Bir YAML dosyasındaki her nesne, `!u!{CLASS ID} &{FILE ID}` biçiminde özel bir tanımlayıcı dizesiyle tanımlanır[^2]. Bu iki bileşen, Unity'deki her bağımlılık grafiğinin temel taşını oluşturur.

**Class ID**, nesnenin ait olduğu düşük seviyeli sınıfı (class) belirten ve Unity Engine'in C++ kaynak kodunda sabit olarak tanımlanmış bir tam sayı (integer) değeridir[^2]. Örneğin `1` değeri `GameObject`'i, `4` değeri `Transform` bileşenini ve `114` değeri `MonoBehaviour`'ı (yani kullanıcı tarafından tanımlanan özel C# betiklerini) temsil eder[^2]. Öte yandan **File ID** (Yerel Dosya Tanımlayıcısı), ilgili nesnenin yalnızca tek bir dosyanın sınırları içindeki kimliğini temsil eden sayısal bir değerdir[^2]. File ID, aynı dosya içinde bulunan nesneler arasındaki dahili çapraz referansları çözmek için kullanılır; örneğin bir `Transform` bileşeninin üst `GameObject`'ine referans vermesi gibi[^2]. 3B model dosyaları (Model files) veya Unity tarafından yönetilen dahili varlıklar için File ID'ler genellikle Unity dosyayı ilk kez keşfedip ayrıştırdığında üretilen ve atanan büyük, öngörülemez rastgele sayılardır[^4]. Kütüphane ikili dosyaları (DLL) içinde yer alan C# kaynak kod dosyaları (`.cs`) içinse Unity daha deterministik (belirlenimci) bir yaklaşım uygular. Sistem, MD4 kriptografik özet (hash) fonksiyonunu kullanarak yerel File ID'yi hesaplar. Algoritma, 32-bit little-endian biçiminde bir tam sayı üretmek üzere `"s\0\0\0" + t.Namespace + t.Name` formülündeki metin dizesinden elde edilen MD4 özetinin ilk dört baytını çıkarır[^4].

Aşağıdaki tablo, Unity varlık ağını yapılandıran üç tanımlayıcı düzeyinin ayrıntılı karşılaştırmasını sunmaktadır:

| Tanımlayıcı Türü | Teknik Kapsam | Oluşturulma Kökeni ve Uygulanan Algoritma | Sistem Mimarisindeki Temel Rolü |
| :--- | :--- | :--- | :--- |
| **Class ID** | Küresel (Motor içine derinlemesine entegre) | Unity'nin C++ kaynak kodunda statik olarak önceden tanımlanmıştır. | Yerel bileşen türlerini (`GameObject`, `Transform`, `Camera`, `Collider` vb.) tanımlar[^2]. |
| **File ID** | Yerel (Tek bir YAML dosyası ile sınırlı) | Grafik varlıklar için rastgele sayı; C# Script/DLL için MD4 özeti[^4]. | Bir Prefab/Scene içindeki alt öğeleri tanımlar. Dahili nesne grafiği referanslarını çözer[^5]. |
| **GUID** | Küresel (Tüm Proje genelinde geçerli) | Evrensel Benzersiz Tanımlayıcı UUID v4 (16'lık taban, tiresiz 32 karakter)[^7]. | Fiziksel varlık dosyasını tanımlar. Proje içindeki farklı dosyalar arası çapraz referansları çözen tek anahtardır[^1]. |

### **Üstveri (`.meta`) Dosyalarının ve Küresel Tanımlayıcı GUID'nin Önemi**

Sistemin bağımsız dosyalar arasındaki bağlantı referanslarını işlemesi gerektiğinde gerçek karmaşıklık ortaya çıkar. Tek bir YAML dosyasının kapsamı dışındaki nesnelere referans verilirken yerel File ID tamamen anlamsız hale gelir; çünkü projedeki binlerce farklı dosya arasında doğal olarak çakışabilir[^2]. Bütünlüklü bir veritabanı oluşturmak için Unity, hedef dosyanın tamamını sistem genelinde kesin olarak belirleyebilen özel bir yardımcı tanımlayıcıya ihtiyaç duyar. İşte burası **Global Unique Identifier (GUID)** alanının devreye girdiği yerdir.

Unity Editor, içe aktarma (import), yeni oluşturma veya çoğaltma yoluyla projeye ilk kez dahil edilen bir varlık dosyasını her algıladığında, beraberinde otomatik olarak bir üstveri dosyası oluşturur. Bu üstveri dosyası, orijinal dosyayla aynı adı taşır ve sonuna `.meta` uzantısını alır[^1]. `.meta` dosyası varlığın "kimlik kartı" işlevini görür; yapılandırma bilgilerini (Import Settings) ve en önemlisi `guid` özelliğini barındırır. Bu özellik, örneğin `8c9c1e4a88e724a60a9ac0b0bb6a52c31` gibi 32 adet onaltılık (hexadecimal) karakterden oluşan benzersiz bir özet dizisidir.

Oyundaki bir nesne başka bir varlığa referans vermek istediğinde, YAML serileştirme sözdizimi bu iki tanımlayıcıyı özel bir ilişkisel dizi sözdizimiyle birleştirir: `{fileID: X, guid: Y, type: Z}`[^2]. Bu yapıda `fileID` parametresi hedef dosyanın içinde gizli olan belirli alt nesnenin konumunu belirlemek için kullanılır; `guid` parametresi doğrudan hedef varlığın `.meta` dosyasına işaret eden 32 karakterlik diziyi sağlar ve `type` parametresi ise `AssetDatabase` sistemine varlığı arama yöntemini bildirir[^4]. Genellikle `type: 2` kaynak kodda yer almayan harici referans varlıkları için kullanılırken, `type: 3` ise çoğunlukla dahili kaynak betik (script) varlıklarını temsil eder[^4].

Bu ayrıştırılmış depolama mekanizması sayesinde geliştirme mühendisleri, projenin mantıksal yapısını bozmadan işletim sistemi üzerinde dosyaları özgürce yeniden adlandırabilir ve farklı dizinlere taşıyabilir. Unity `AssetDatabase` sistemi, kolayca bozulabilen göreceli dosya yollarına bağımlı kalmak yerine GUID arama tablosunu korumak için `.meta` dosyalarını sessizce tarar[^1]. Ancak GUID'ye olan bu mutlak bağımlılık, aynı zamanda Long Gil Studio'nun çözümsüz görünen sorununun da çıkış noktası oldu.

## **Sorun Çözme Kronolojisi: Long Gil Studio'nun Çözüm Arayışı**

Bir özellik bloğunu iki bağımsız varlığa ayırma süreci başlangıçta basit bir dosya yönetimi işlemi gibi görünüyordu. Ne var ki Long Gil Studio'daki geliştirme ekibi uygulamaya koyulduğunda, kendilerini hızla Unity'deki grafik verilerinin bütünlüğüyle ilgili karmaşık bir sorunlar ağının içinde buldu. Bu yolculuk, en sezgisel yöntemlerden derinlemesine sistem programlama çözümüne uzanan bir deneme-yanılma girişimleri dizisi olarak kayıtlara geçti.

### **Aşama 1: Dosya Yeniden Adlandırma (Renaming) ve Doğrudan Çoğaltma Yönteminin Çaresizliği**

Mühendislik ekibinin ilk doğal refleksi, Unity Editor arayüzü üzerinden `Feature_A` klasörünü doğrudan `Feature_B` olarak çoğaltmak (duplicate) oldu. Amaç ayrı bir fiziksel veri bloğu oluşturmaktı. Ancak anında "eski kaynağa çapraz referans verme" olgusu ortaya çıktı[^10].

Editor içinde çoğaltma yapıldığında Unity, aynı projede iki varlığın aynı GUID kodunu paylaşamayacağını bilir. Sistem otomatik olarak müdahale ederek `Feature_B` klasöründeki her dosya için yeni rastgele GUID kodları içeren yepyeni `.meta` dosyaları oluşturur[^1]. Bu durum veritabanının geçerliliğini garanti altına alsa da mantıksal bir felakete yol açar: yeni çoğaltılan Prefab veya `ScriptableObject` dosyalarının içindeki metin içeriği (YAML), Unity tarafından hiçbir şekilde yeniden derlenmez ya da düzenlenmez. Yani `Feature_B/UI_Window.prefab` dosyası içinde kaynak kod betiğine referans veren YAML bloğu statik olarak `{fileID: 11500000, guid: [GUID_OF_OLD_FILE_IN_FEATURE_A]}` durumunda sabit kalır[^10].

Sonuç olarak yeni klasör oluşturulmuş olsa bile, yeni geliştirme dalındaki tüm arayüz bileşenleri, Prefab'lar ve değişkenler fiziksel olarak orijinal dalın `.cs` kaynak kod dosyalarına bağlı kalır. Inspector arayüzü üzerinden yeni Prefab üzerinde yapılan herhangi bir parametre değişikliği eski denetleyici sınıfının mantığını tersine ezme riski taşır ve ciddi bir gerileme riski (regression risk) yaratır. Long Gil Studio ekibi, yeni klasördeki kaynak kod ve varlık dosyalarını yeniden adlandırarak sorunu çözmeyi denedi. Ancak yeniden adlandırma işlemi yalnızca kullanıcı arayüzünde görünen metni ve diskteki fiziksel dosya adını değiştirir; `.meta` dosyasının içindeki GUID özetini ya da YAML yapılandırma dosyasındaki referans dizelerini kesinlikle etkilemez[^5]. Unity'nin veritabanı dosya adlarına karşı bağışık olduğu için yeniden adlandırma yöntemi hiçbir bağlantı ayrıştırma etkisi sağlamadığından derhal terk edildi.

### **Aşama 2: Sıfırdan Oluşturma ve Bağlantıları Elle Yeniden Atama (Manual Re-linking) Krizi**

Yeniden adlandırmanın başarısız olmasının ardından ekip daha zahmetli ve maliyetli bir manuel yönteme yöneldi: tamamen yeni dosyalar oluşturmak ve tüm bağlantı grafiğini elle yeniden atamak. Programcılar yeni oluşturulan her Prefab veya `ScriptableObject` dosyasını tek tek açmak, bağlantısı bozuk olan ya da eski dala işaret eden bileşenleri (Component) silmek, yeni bileşenleri eklemek ve ardından her bir görsel ile ses varlığını sürükle-bırak yöntemiyle Inspector panelindeki doğru referans alanına yerleştirmek zorundaydı.

Küçük bir prototip proje için bu yaklaşım kabul edilebilir olabilir. Ancak GilongWorld projesinde **Nested Prefabs** mimarisiyle iç içe geçmiş onlarca veya yüzlerce dosyadan oluşan karmaşık bir özellik söz konusu olduğunda, bağımlılık grafiği (dependency graph) insan gücüyle yönetilemeyecek kadar devasa bir boyuta ulaştı. UI arayüzleri, `ScriptableObject` yapılandırma nesneleri ve animasyon varyantları (Animation Controller) arasındaki binlerce çapraz referansı yeniden atamak haftalarca çalışma gerektiriyordu.

Bu yöntemin en büyük sakıncası insan hatası (human error) faktörüydü[^1]. Mühendisler sürekli olarak çakışan bağlantılarla, atlanan referanslarla veya adları birebir aynı olup çalışma alanları farklı olan betiklerin yanlış atanmasıyla karşı karşıya kalıyordu. Binlerce özellik satırı arasına gizlenmiş tek bir eksik referans bile statik derleme testlerinden geçebilir; ancak proje derlenip çalışma zamanında (Runtime) çalıştırıldığında `NullReferenceException` biçiminde kritik bir sistem hatasına yol açardı. Zaman açısından yaşanan tükeniş ve düşen ürün kalitesi, Long Gil Studio'yu daha derin bir katmanda otomasyon yöntemi aramaya zorladı.

### **Aşama 3: İşletim Sistemi Üzerinden Kopyalama Girişimi (OS-Level Cloning)**

Bir diğer görüş ise Unity Editor içinde çoğaltmak yerine işletim sisteminin dosya yöneticisi (Windows Explorer veya macOS Finder) üzerinden klasör kopyalamayı önerdi. Amaç, fiziksel kopyalar oluşturarak Unity'yi "kandırmaktı". Dışarıdan kopyalama yapıldığında hem içerik dosyası hem de GUID barındıran `.meta` dosyası birebir aynı şekilde kopyalanır[^3].

Ancak Unity Editor'a geri dönüldüğünde **Tanımlayıcı Çakışması (GUID collision)** adı verilen yeni bir sorun ortaya çıktı. `AssetDatabase` sistemi, aynı GUID kodunu paylaşan iki dosyanın paralel varlığını tespit etti. Unity'nin dahili çakışma işleme süreci genellikle iki sonuçtan birine yol açar: sistem ya iki dosyadan birini yüklemeyi reddeder ya da Unity kullanıcıya hiçbir bildirimde bulunmadan bir dosyanın GUID'sini sessizce yeni ve rastgele bir dizeyle üzerine yazar — ve özellikle hiçbir YAML referansını güncellemez[^9]. Saha raporları, aynı paylaşılan yapıya dayalı birden fazla projeyle karşılaşıldığında Unity'nin dosya adları farklı olsa bile aynı GUID'ye sahip varlıklar arasındaki farkı ayırt edemediğini ve bu durumun Unity'nin referansları rastgele yanlış varlıklara bağlamasına yol açtığını göstermektedir[^1]. Bu yöntem, bağlantıları elle yeniden atamaktan bile çok daha büyük bir tehlike barındırıyordu.

## **Teknik Atılım: Referans Kaybı Olmadan GUID Yeniden Üretimi Çözümü**

Standart işlemlerle çıkmaza giren Long Gil Studio, temel sorunun fiziksel dosya çoğaltmada değil, senkronize veri hesaplamasında yattığını fark etti. Ekibin, yeni klasörün tüm YAML dosya ağındaki GUID tanımlayıcı dizilerini tutarlı bir biçimde toplu olarak güncelleyebilecek bir yönteme ihtiyacı vardı. Unity mühendis topluluğunun açık kaynak araçlarını araştırıp inceleme sürecinin ardından ekip, yerel **GUID Yeniden Üretimi (GUID Regeneration)** tekniğini keşfetti ve başarıyla uyguladı[^1].

Bu teknik, projenin kaynak metin yapısına doğrudan bir müdahaledir. Unity Editor'ın varsayılan algoritmayla pasif biçimde çoğaltma yapmasına izin vermek yerine sistem, özel bir Editor Script (C#) aracı aracılığıyla taranır ve işlenir. Bu araç, yeni özellik dalı klasöründeki her `.meta` dosyasını okur, tamamen yeni bir GUID kümesi oluşturur, eski GUID'ler ile yeni GUID'ler arasında bir bellek eşleme tablosu (mapping table) kurar ve ardından bu karakter dizilerini hatasız şekilde değiştirmek için yapılandırma dosyalarının tüm metin içeriğini tarar.

### **Long Gil Studio'nun GUID Yeniden Üretim Algoritmasının Derinlemesine Analizi**

Kanıtlanmış açık kaynak algoritma temellerine dayanarak (jeffjadulco, ZimM-LostPolygon ve rrazgriz betikleri gibi[^1]), mühendislik ekibi karmaşık veri işleme aşamalarından oluşan katı bir yürütme akışı inşa etti.

#### **Adım 1: Varlık Düzenleme Durumunu Başlatma (Asset Editing State)**

Binlerce metin dosyasını anlık olarak değiştirmek Unity'nin otomatik yeniden derleme (auto-refresh) mekanizmasını tetikleyerek sistemi dondurur veya bellek taşmasına yol açar. Bu nedenle algoritma, `AssetDatabase.StartAssetEditing()` API metodunu çağırarak Unity'nin dosya sistemi izleme sürecini geçici olarak askıya almakla başlar[^7]. Bu işlem `AssetDatabase`'i geçici bir uyku durumuna sokarak sabit disk üzerinde toplu I/O komutlarının engelsiz çalıştırılmasına olanak tanır. Aynı anda, analiz edilecek biçimleri belirleyen geçerli bir dosya uzantısı filtresi (`kDefaultFileExtensions`) tanımlanır: `*.meta`, `*.mat`, `*.anim`, `*.prefab`, `*.unity`, `*.asset`, `*.guiskin`, `*.fontsettings` ve `*.controller`[^7].

#### **Adım 2: Özyinelemeli Tarama ve Hedef GUID Kümesini Çıkarma**

Sistem, Project penceresinde kullanıcının seçtiği alana ait GUID listesini (`Selection.assetGUIDs`) toplayarak etki alanını belirler. Algoritma tüm alt dizinler boyunca özyinelemeli (recursive) olarak çalışır ve `AssetDatabase.AssetPathToGUID(file)` fonksiyonu aracılığıyla dosya yolunu fiziksel GUID'ye geri eşler. Bu adımın inceliği, algoritmanın `guidsToRegenerate` listesinin yalnızca özgün içerik varlıklarını barındırmasını sağlamak amacıyla başlangıçtaki `.meta` dosyalarını doğrudan seçim listesinden bilinçli olarak hariç tutmasıdır (`Path.GetExtension(...) != ".meta"`)[^8].

#### **Adım 3: Sözdizimi Ayrıştırma ve Bağlantı Grafiğini Tanımlama**

En fazla hesaplama gücü tüketen aşama, tüm metin yapısının doğrusal (linear) olarak taranmasıdır. Listedeki her dosya için sistem, `File.ReadAllText(filePath)` metoduyla tüm karakter dizesini açıp okur[^7]. Büyük metin bloklarındaki performans kısıtlamaları nedeniyle sözdizimi ayrıştırma (parsing) tekniğinde Düzenli İfadeler (Regex) kullanılmaz. Bunun yerine algoritma, 6 karakter uzunluğundaki `"guid: "` sabit dizesini sıralı olarak arar[^7].

Bir referans biçimi bulunduğunda, algoritma hemen ardından gelen tam 32 karakteri çıkarır. Hemen sonrasında bir güvenlik doğrulama katmanı olan `IsGuid(string text)` devreye girer. Bu katman, söz konusu 32 karakterlik dizenin onaltılık sistem kurallarına (`'0'` ile `'9'` ve `'a'` ile `'f'` aralığı) uyup uymadığını doğrulayan bir döngü çalıştırır[^7]. Bu sıkı denetim, algoritmanın C# kaynak kodundaki rastgele dizelerin veya grafik sisteminin aynı 32 karakter uzunluğuna tesadüfen sahip şifreli Hash verilerinin üzerine yanlışlıkla yazmasını engeller.

#### **Adım 4: Çift Eşleme Sözlüğü Oluşturma (Dual Mapping Dictionary)**

Üzerine yazma işleminin Unity'nin çekirdek varlıklarını bozmamasını sağlamak için sistem RAM bellekte üç kritik veri yapısı oluşturur[^7]:

1. **`ownGuids` Kümesi (Dahili Varlıklar):** Algoritma herhangi bir `.meta` dosyasında yer alan ilk GUID kodunu tanımlar ve bunu bir `HashSet` yapısında saklar. Unity'nin temel ilkesine göre bir `.meta` dosyasındaki ilk GUID her zaman o varlığın kendisini temsil eder. Bu küme bir güvenlik duvarı işlevi görerek sistemin işlenen klasör içindeki varlıklar ile harici varlıkları (örneğin Unity Engine'in varsayılan `Standard.mat` materyali) birbirinden ayırmasına yardımcı olur[^7].
2. **`guidOldToNewMap` Sözlüğü (Değiştirme Dizesi Eşlemesi):** Tespit edilen her benzersiz eski GUID için sistem, standart kütüphane metodu olan `Guid.NewGuid().ToString("N")` aracılığıyla tamamen yeni bir UUID dizesi üretir[^7]. UUID sürüm 4 (v4) oluşturma algoritması, tire işareti içermeyen bir karakter dizesi üretir ve sıfıra yakınsayan çakışma olasılığıyla (collision probability) veri açısından mutlak güvenlik sağlar.
3. **`guidsInFileMap` Sözlüğü (Dağılım Haritası):** Dosya yolundan (File Path) o dosya içinde çağrılan eski GUID'lerin bir dizisine eşleme yapan bir sözlüktür. Bu yapı, sisteme tam olarak hangi dosyayı açacağını ve hangi dizeyi değiştireceğini doğrudan bildirerek üzerine yazma aşamasını optimize eder.

#### **Adım 5: Senkronize Üzerine Yazma ve Durumu Geri Yükleme**

Son döngüde sistem `guidsInFileMap` içinde belirtilen her dosyayı açar. Çift çapraz denetim koşulu uygulanır: incelenen eski GUID kodunun dahili varlıklar kümesinde (`ownGuids`) bulunması **VE** kullanıcı tarafından yeniden üretilmesi istenen varlıklar listesinde (`guidsToRegenerate`) yer alması zorunludur[^8]. Bu güvenlik kuralı çözümün omurgasını oluşturur; Engine Assets veya paylaşılan kütüphanelerin tanımlayıcılarının istenmeden değiştirilmesi olgusunu tamamen önler.

Denetimden geçtikten sonra `contents = contents.Replace("guid: " + oldGuid, "guid: " + newGuid)` dize değiştirme komutu yürütülür[^7]. Sistem yeni metin dizesini `File.WriteAllText` ile diske geri yazar. Tüm dosyalar işlendiğinde Unity'nin izleme sistemini uyandırmak için `AssetDatabase.StopAssetEditing()` bayrağı çağrılır; ardından projenin tamamını yepyeni GUID yapısıyla yeniden derlemek üzere `AssetDatabase.Refresh()` fonksiyonu çağrılır[^7].

Long Gil Studio'nun bu algoritma sayesinde elde ettiği başarı, bir özellik sistemini dosya düzeyinde mutlak bağımsızlıkla tamamen klonlayabilme yeteneğidir. Mühendisler "Dal B" üzerinde Prefab'ları düzenleyebilir, kaynak kodları değiştirebilir ve parametreleri yeniden yapılandırabilir; üstelik "Dal A" üzerinde en ufak bir dalgalanma dahi yaratmadan. Dal B'nin çapraz bağlantı ağı artık tamamen yeni ve yalıtılmış bir tanımlayıcı kümesi üzerinden dahili iletişimini sürdürmekte, başlangıçtaki dallanma problemini hiçbir teknik hata bırakmadan eksiksiz karşılamaktadır.

## **Unity Ekosistemindeki Alternatif Çözümlerin Kapsamlı Değerlendirmesi**

Özel kodla GUID yeniden üretimi çözümü Long Gil Studio'nun derin özelleştirme ihtiyacını kökten çözmüş olsa da, Unity ekosistemi yinelenme ve özellik dallanması yönetimini hedefleyen bir dizi tasarım mimarisi sunmaya devam etmektedir. Sistem mimarisine bütünsel bir bakış açısı kazandırmak amacıyla araştırma sürecinde, büyük ölçekli dallanma gereksinimleriyle uyumluluklarını ve sınırlarını değerlendirmek üzere aşağıdaki alternatif yöntemler analiz edilmiştir.

### **5.1 Kalıtım Çözümü: Prefab Variants Yapısı**

Unity 2018.3 sürümünde tanıtılan **Prefab Variants** özelliği, geleneksel Prefab sisteminin yerine nesne yapılarını yönetmede büyük bir ilerleme kaydetmiştir[^17]. Prefab Variant'ın temel mekanizması tamamen yeni bir kopya oluşturmak değil, doğrudan orijinal Prefab'a (Base Prefab) bağlı bir geçersiz kılma katmanı (override layer) işlevi görmektir[^17].

Variant kullanıldığında programcılar özellikleri, materyal yapılandırmalarını değiştirebilir veya bileşen (component) ekleyip çıkarabilir; bu değişiklikler yalnızca Variant dosyasında "geçersiz kılma" üstverisi (override metadata) biçiminde depolanır[^20]. Aynı zamanda Base Prefab üzerinde temel özellikler güncellenirse, bu değişiklikler söz konusu özelliği henüz geçersiz kılmamış tüm alt Variant'lara otomatik olarak yayılır (propagate)[^22].

Aşağıdaki karşılaştırma tablosu, özellik dallanması problemine yönelik bu iki mimari felsefe arasındaki farkları netleştirmektedir:

| Değerlendirme Ölçütü | GUID Yeniden Üretimi (Derin Dallanma - Deep Fork) | Prefab Variants Yöntemi (Göreceli Kalıtım) |
| :--- | :--- | :--- |
| **Depolama Doğası** | YAML dosya düzeyinde tamamen bağımsız veri kopyası. | Orijinal şablona dayalı fark verilerini (delta overrides) depolar[^17]. |
| **Bağımlılık Düzeyi** | Seviye 0 (Kaynakla hiçbir yapısal bağlantı kalmaz). | Yüksek (Base Prefab'ın düğüm yapısına bağımlıdır)[^18]. |
| **Kaynak Kod (Script) Ayrımı** | İki bağımsız kaynak kod kümesinin ayrılmasına ve yeniden yazılmasına izin verir. | Desteklenmez; Variant aynı Base Script kümesi üzerinde çalışmak zorundadır. |
| **Yapısal Değişiklik Yeteneği** | Tüm hiyerarşi yapısını (Hierarchy) silme, ekleme veya yeniden şekillendirme özgürlüğü. | Kısıtlıdır. Base Prefab tarafından tanımlanan temel GameObject'ler silinemez[^22]. |
| **Sistem Gerileme Riski** | Mutlak izolasyon sayesinde neredeyse sıfırdır. | Yüksektir. Orijinalde yapılan hata düzeltmeleri veya ayarlar Variant dalının işlevini istenmeden bozabilir[^18]. |

**GilongWorld projesi için sonuç:** Prefab Variant oynanış varyasyonları üretmede (örneğin kırmızı düşmandan türetilmiş ancak farklı can değerine sahip mavi bir düşman oluşturmada) mükemmel olsa da[^20], "özel uyarlama" (customization) amacıyla dallanma gereksinimi karşısında tamamen yetersiz kalmaktadır. Long Gil Studio'nun projesi C# kaynak kod betiklerinin dahi ayrılmasını gerektiriyordu; Variant mimarisi bunu destekleyemez çünkü yalnızca açık (public) değişkenleri geçersiz kılar, yeni bir mantık işleyicisine yönlendirmeye izin vermez[^18]. Grafik düğümleri arasındaki sıkı bağımlılık, Prefab Variant'ı problemin ortaya koyduğu bağımsız modüler tasarım felsefesiyle taban tabana zıt bir yöntem haline getirmektedir.

### **5.2 Bağımsız Paket Mimarisi: Unity Package Manager (UPM) ve Local Packages**

Referans çakışmalarını en aza indirmeye yönelik daha makro düzeydeki bir yaklaşım, çoklu paket mimarisi oluşturmak için **Unity Package Manager (UPM)** kullanmaktır[^25]. Bu mimari model, bileşenleri veya özellikleri `package.json` dosyası üzerinden yapılandırılan ve Derleme Tanım Dosyası (`.asmdef`) aracılığıyla derlemesi yönetilen ayrı geliştirme paketlerine (development packages) dönüştürür[^26].

Dallanma bağlamında paylaşılan bir sistem Core Package olarak yapılandırılabilirken, Özellik A ve Özellik B ortak API fonksiyonlarını tüketen bağımsız paketler olarak çalışır. Unity, sistem bağlantısı (symlink) yoluyla yerel veri paketlerinin (**Local Package**) gömülmesine izin vererek kaynak kod klasörlerinin diskte ana projenin `Assets` klasöründen tamamen ayrı bir Git deposu olarak var olmasını sağlar[^27]. UPM üzerinden yapılandırıldığında GUID yineleme olgusu veya yerel ortam çakışmaları, yalnızca geleneksel `AssetDatabase`'e dayanmak yerine Unity'nin paket yöneticisi tarafından yönetilir[^28].

Ancak bu mimariyi benimsemek muazzam bir analiz ve yeniden yapılandırma (refactoring) süresi gerektirir. C# kaynak kodunu ve statik kütüphaneleri izole etmek için kusursuz çalışır; fakat yoğun olarak YAML dosyalarına bağımlı büyük hacimli Prefab ve UI arayüzlerini çoğaltma sorununu çözmede verimsiz kalır. Dolayısıyla Long Gil Studio'daki gibi acil ayrıştırma gerektiren pratik bir ihtiyaç için bu çözüm, anlık sonuçla orantısız bir operasyonel maliyet (overhead) doğurmaktadır.

### **5.3 Bellek Şişmesi Tehlikesi: Addressables Sistemi ve Paylaşılan Dosyalar**

GUID sistemine yönelik her türlü derin müdahale, özellikle projede **Addressable Asset System** entegre edilmişse, sistem mühendislerinin dinamik bellek yönetimi ve varlık dağıtım mekanizması üzerindeki etkiyi değerlendirmesini gerektirir. Addressables, dinamik yollar üzerinden eşzamansız yükleme (asynchronous load) mekanizmasını kullanmak amacıyla sert referansları ortadan kaldıran yeni nesil bir kaynak yönetim çerçevesi görevi görür[^30].

GUID yeniden üretim tekniği kullanılırken belgelenmiş mimari bir risk mevcuttur: Yeniden üretim süreci büyük bir özellik bloğunu iki ayrı bloğa ayırırsa, o klasör yapısındaki bağlantılı her kaynak (örneğin yüksek çözünürlüklü bir Texture veya ses dosyası) da yeni bir GUID kodu alacaktır[^30]. İşletim sistemi açısından bu iki Texture dosyası aynı görüntüyü taşısa da, Addressables paketleme sistemi (packing system) farklı tanımlayıcılara sahip oldukları için onları tamamen bağımsız iki veri varlığı olarak değerlendirir[^13].

Content Build derleme süreci tetiklendiğinde Unity, ilk kopyayı Özellik A'nın AssetBundle'ına, ikinci kopyayı ise Özellik B'nin AssetBundle'ına sıkıştırır. Bu çoğaltma **bellek şişmesine (memory bloat)** yol açarak oyunun indirme dosya boyutunu büyütür ve uygulama çalışırken (runtime) büyük miktarda RAM belleğin boşa harcanmasına neden olur[^13]. Bu riski çözmek için mimar ekibinin bir "Paylaşılan" depolama alanı (**Shared Resources**) kurması gerekir. GUID yeniden üretim komutunu çalıştırmadan önce, programlama mantığı niteliği taşımayan tüm görsel varlıklar işlem alanının dışına taşınmalıdır. Bu görsel varlıkların `.meta` dosyaları eksiksiz korunmalıdır ki çoğaltma sürecinin ardından hem yeni hem eski yapılandırma dalları aynı tekil paylaşılan materyal GUID'sine referans versin ve sistem kaynak yönetiminde tasarruf sağlansın.

## **GilongWorld Projesinden Çıkarılan Öneriler ve Dersler**

Long Gil Studio'daki referans kopması sorununu çözmek yalnızca optimize edilmiş bir betik bulmaktan ibaret değildi; aynı zamanda Unity Engine'in kullanıcı arayüzünün altındaki gizli protokol katmanlarını kavramanın önemini kanıtlayan bir süreçti. YAML biçimindeki veri bağlantı ağı tüm nesne etkileşim sistemlerinin temelidir ve GUID üstverisi bu ağı ayakta tutan tek dildir[^1].

Yeni bir tanımlayıcı yapısı oluşturarak doğrudan müdahale etme yöntemi (**GUID Regeneration**), `AssetDatabase` gibi nesne yönelimli bir veritabanı üzerinde işletim sisteminin dosya yönetim yapısını kullanmaya dair yanılgıları ortadan kaldırmıştır[^1]. Metin ayrıştırma, tanımlayıcı çıkarma, bellek alanı kontrolü ve dahili üzerine yazmadan oluşan beş adımlı algoritmik süreç mutlak bir doğruluk oranı sağlamış ve programcıların başını ağrıtan mantıksal grafik kopma kazalarının önüne geçmiştir.

Bu olay analizine dayanarak, büyük ölçekli oyun yazılımı mimarları karmaşık çoğaltma ve dallanma işlemlerini gerçekleştirirken her zaman standartlaştırılmış bir iş akışı sürdürmelidir. Sabit disk üzerinde geniş çaplı işlem komutlarından önce bir yedekleme sisteminin (version control backup) kurulması, geri döndürülemez veri kaybını önlemek adına en üst kuraldır[^7]. Aynı zamanda geliştiriciler, çalışma alanı yeniden adlandırma (namespace renaming) süreci nedeniyle C# kaynak kod dosyalarının (`.cs`) içindeki File ID'nin istenmeden değiştirilmesine karşı tetikte olmalıdır; çünkü bu durum görünüm yapılandırması ile yürütülen betik arasındaki düşük seviyeli bağlantıyı doğrudan bozacaktır[^4].

Long Gil Studio'nun GUID yeniden üretim yöntemini bulma ve uygulamada elde ettiği başarı, yalnızca GilongWorld projesinin kaynaklarını binlerce saatlik manuel yapılandırma işleminden kurtarmakla kalmamış; aynı zamanda gelecekte sistemin esnek biçimde özelleştirilebilmesi ve çekirdek yapının kararlılığından ödün vermeden tasarım dallanma taleplerine hızla yanıt verebilmesi için sağlam bir teknik temel oluşturmuştur.

## **Kaynakça**

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
