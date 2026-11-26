---
title: "Unity Engine'de Performans ve Zamansal Bütünlük Optimizasyonu: Sistem Mekanizmaları, DateTime.Now Darboğaz Analizi ve Frame Caching Çözümü"
date: 2026-09-17 03:00:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, datetime, csharp, dotnet, frame-caching, multithreading, anticheat]
description: ".NET çalışma zamanında DateTime.Now ve DateTime.UtcNow iç mekanizmalarının derinlemesine analizi, performans darboğazlarının nicel ölçümü, zamansal yırtılma (temporal tearing) olgusu ve Unity Engine'de iş parçacığı güvenli Frame Caching mimarisi."
lang: tr
translation_id: unity-datetime-now-frame-caching
math: true
---

Gerçek zamanlı saat verilerine erişim ve bu verilerin işlenmesi, Unity Engine tabanlı gerçek zamanlı uygulamalarda temel ancak mimari açıdan ciddi riskler barındıran bir görevdir[^1]. .NET Temel Sınıf Kütüphanesindeki (BCL) `System.DateTime` yapısı takvim ve zaman yönetimi için kapsamlı araçlar sunsa da sürekli çalışan güncelleme döngüleri (*hot paths*) içinde `System.DateTime.Now` özelliğini doğrudan çağırmak ciddi performans darboğazlarına yol açar ve durum bütünlüğünü bozar[^2].

Bu rapor, işletim sistemi ve çalışma zamanı (.NET/Mono/IL2CPP) katmanlarındaki iç mekanizmaları derinlemesine incelemekte, profilleme verileri üzerinden hesaplama maliyetini nicel olarak ortaya koymakta, zamansal yırtılma (*temporal tearing*) olgusunu analiz etmekte ve ilgili mimari standartlarla birlikte kare önbellekleme (*Frame Caching*) çözümünü kapsamlı biçimde değerlendirmektedir[^2].

---

## **1. .NET Çalışma Zamanında DateTime.Now ve DateTime.UtcNow İç Mekanizmaları**

`System.DateTime` yapısı tek bir 64-bit değer alanı (`UInt64 _dateData`) üzerinde saklanır[^6]. Bu bellek düzeni içinde:
- **Alt 62 bit**, Gregoryen takvimine göre 0001 yılı 1 Ocak 00:00:00 anından itibaren biriken Tick sayısını temsil eder; her bir tick $100\text{ ns}$ ($10^{-7}\text{ s}$ veya $0.1\ \mu\text{s}$) değerine karşılık gelir[^1].
- **En yüksek 2 bit**, üç bağlamsal durumdan birini (`Utc`, `Local` veya `Unspecified`) tanımlayan `DateTimeKind` bayraklarını tutmak için ayrılmıştır[^1].

### **DateTime.UtcNow'ın Düşük Seviyeli Yürütme Akışı**

`DateTime.UtcNow` özelliği Eşgüdümlü Evrensel Zamanı temsil eder ve işlemci döngüsü tüketimini en aza indirecek şekilde tasarlanmıştır[^2]. Bir süreç `DateTime.UtcNow` özelliğini çağırdığında, .NET çalışma zamanı doğrudan sistemin donanım zamanlayıcısından bir okuma işlemi gerçekleştirir[^2]:

- **Windows** işletim sisteminde çalışma zamanı, derleme optimizasyonu engellerini atlayacak şekilde işaretlenmiş (`TargetedPatchingOptOut`) dahili bir işlev işaretçisi aracılığıyla doğrudan Win32 API işlevi `GetSystemTimeAsFileTime`'ı çağırır[^2].
- **POSIX** ailesi işletim sistemlerinde (Android üzerindeki Linux çekirdeği ve iOS/macOS üzerindeki Darwin çekirdeği dahil) sistem, düşük seviyeli `clock_gettime(CLOCK_REALTIME, ...)` çağrısını yürütür[^5].

İşletim sisteminden dönen ham zaman damgasına Gregoryen takvim başlangıç noktasıyla hizalanması için yalnızca sabit bir sapma değeri eklenir; ardından `DateTimeKind.Utc` etiketiyle doğrudan `DateTime` yapısının içine paketlenir[^2]. Bu süreç herhangi bir arama tablosu çözümlemesi gerektirmez, bellek ayırmaz (zero allocation) ve birkaç nanosaniye içinde tamamlanır[^2].

### **DateTime.Now'ın Karmaşık Çözümleme Akışı**

`DateTime.UtcNow`'ın aksine yerel saatin (`DateTime.Now`) belirlenmesi karmaşık bir dönüştürme işlemleri zinciri gerektirir[^2]. `DateTime.Now` özelliği donanımdan bağımsız bir yerel saat değeri okumaz; bunun yerine tamamen `DateTime.UtcNow` sonucunun üzerine saat dilimi farkı hesaplamaları eklenerek oluşturulur[^2]:

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

Bu süreç geçerli UTC zamanının alınmasıyla başlar ve ardından cihazın saat dilimi yapılandırmasını belirlemek için `TimeZoneInfo.Local` nesnesini sorgular[^2]. Kaynak tüketiminin ana odağı `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc` işlevidir; çalışma zamanı burada geçerli anın bir saatlik ekleme döneminde olup olmadığını saptamak için mevcut zaman damgasını saat dilimi Ayarlama Kuralları (*Adjustment Rules*) ve Yaz Saati Uygulaması (*Daylight Saving Time - DST*) tablosuyla karşılaştırmak zorundadır[^2].

Tick cinsinden kesin fark belirlendikten sonra sistem `utcNow.Ticks` ile aritmetik toplama yapar, değer sınırı taşma koşullarını denetler ve `DateTimeKind.Local` etiketiyle yeni bir `DateTime` yapısı oluşturur[^2].

Resmi .NET Runtime kaynak kod deposundan alınan performans profilleme verileri, `DateTime.get_Now()` yönteminin ayrıntılı yürütme süresi dağılımını ortaya koymaktadır[^4]:

| `System.DateTime.get_Now()` İçindeki Yürütme Bileşeni | Kapsayıcı Yürütme Süresi Oranı (Inclusive %) | İşlemin Teknik Niteliği |
| :--- | :---: | :--- |
| `TimeZoneInfo.GetDateTimeNowUtcOffsetFromUtc` | **88.1%** | Saat dilimi kuralı araması, DST bayrağı denetimi, offset hesaplaması[^4] |
| `System.DateTime.get_UtcNow()` | **5.8%** | Donanım sayacını okuyan sistem çağrısı (Syscall)[^2] |
| Sınır denetimi ve struct paketleme işlemleri | **6.1%** | 64-bit tam sayı taşma doğrulaması ve `DateTimeKind.Local` etiketi atama[^4][^7] |

> [!IMPORTANT]
> Yukarıdaki veriler, donanım saatinden zamanın okunmasının toplam yürütme maliyetinin yalnızca **~%5.8**'ini oluşturduğunu, işlem süresinin **~%88.1**'inin ise saat dilimi çözümleme ve yaz saati uygulaması hesaplamalarına harcandığını kanıtlamaktadır[^4].

### **Mobil Ortamlarda (Mono & IL2CPP) Artan Karmaşıklık**

Unity'yi Mono veya IL2CPP üzerinden çalıştıran mobil platformlarda `DateTime.Now` karmaşıklığı katlanarak artar[^5]. Windows saat dilimi bilgileri için merkezi bir Kayıt Defteri (Registry) tutarken, Android gibi mobil işletim sistemleri bu verileri `/apex/com.android.tzdata/` veya `/system/usr/share/zoneinfo` gibi sistem dizinlerine dağılmış ikili `tzdata` veritabanında (`ZoneInfoDB`) saklar[^5].

`TimeZoneInfo.Local` ilk kez başlatıldığında veya yeniden doğrulanması gerektiğinde, Mono/IL2CPP çalışma zamanı dosya G/Ç (I/O) işlemleri yapmak, ikili verileri ayrıştırmak ve hatta saat dilimi tanımlayıcısını almak için Java Native Interface (JNI) üzerinden `java.util.TimeZone` sınıfına çalışma zamanları arası çağrılar göndermek zorunda kalır[^5].

> [!WARNING]
> Saat dilimi veritabanı dosyası bozuksa, özel ROM'larda yeri değiştirilmişse veya dosya erişim izinleri kısıtlanmışsa, `DateTime.Now` çağrısı kritik bir `System.TimeZoneNotFoundException` istisnası fırlatabilir ve istisna işleme bloklarıyla sarılmadığı takdirde uygulamanın aniden çökmesine yol açabilir[^10].

---

## **2. Performans Kıyaslama Analizi ve Kare Bütçesi Etkisi**

Zaman erişim yöntemlerinin yürütme maliyeti, alt katman mimarisine ve işletim sistemi önbellek durumuna bağlı olarak büyük farklılık gösterir[^5]. Aşağıdaki tablo, Unity ve .NET ortamındaki yaygın zamanlama mekanizmaları arasındaki standartlaştırılmış performans ölçüm sonuçlarını özetlemektedir[^4]:

| Zaman Alma Yöntemi | Tahmini Yürütme Süresi | Göreceli Hız Oranı | Temel Yürütme Mekanizması | Kare Sıçraması (Frame Spike) Riski |
| :--- | :---: | :---: | :--- | :--- |
| `UnityEngine.Time.time` | $\sim 1\text{ - }2\text{ ns}$ | En Optimize (Engine Yerleşik) | Kare başında önbelleğe alınan kayan noktalı sayı değişkenini doğrudan okuma | Kesinlikle yok |
| `System.DateTime.UtcNow` | $\sim 15\text{ - }20\text{ ns}$ | `Now`'dan $\sim 15\text{ - }20\times$ daha hızlı | Minimal sistem çağrısı ile donanım saatini doğrudan okuma[^2] | İhmal edilebilir |
| `System.DateTime.Now` (Warm Path) | $\sim 280\text{ - }350\text{ ns}$ | Temel Karşılaştırma Ölçütü ($1\times$) | UtcNow çağırma, saat dilimi önbelleğine erişme, DST farkını hesaplama[^2] | Tekrarlı çağrılırsa Orta - Yüksek |
| `System.DateTime.Now` (Cold Path / Mobil) | $\sim 1\text{ - }5\text{ ms}$ | Binlerce kat daha yavaş ($\gt 3.000\times$) | AndroidTzData tablosunu başlatma, disk G/Ç, ikili veri okuma[^5] | Çok Yüksek (Kare Donması) |

### **Oyun Döngüsünde Kare Bütçesi Sınırları**

Gerçek zamanlı etkileşimli uygulamalarda hareket mekaniği simülasyonu, fizik hesaplamaları, oyun mantığı işleme ve GPU'ya çizim komutları gönderme dahil tüm iş yükü, şu formülle tanımlanan sınırlı bir zaman aralığında tamamlanmalıdır:

$$
T_{\text{frame}} = \frac{1000\text{ ms}}{\text{Target FPS}}
$$

- Standart **$60\text{ Hz}$** ($60\text{ FPS}$) yenileme hızında kare başına bütçe **$16.67\text{ ms}$**'dir.
- Yüksek yenileme hızına sahip **$120\text{ Hz}$** ($120\text{ FPS}$) ekranlarda bu süre yalnızca **$8.33\text{ ms}$**'ye düşer.

Varlık güncelleme döngülerinin içine dağılmış çok sayıda `DateTime.Now` çağrısı içeren bir kod mimarisi — örneğin onlarca NPC'nin yetenek bekleme süresi sayaçları, güçlendirme durumu kontrolleri veya gerçek zamanlı etkinlik denetim mantığı — her karede yüzlerce ila binlerce sistem çağrısı biriktirir.

Kare başına **500 sıcak `DateTime.Now` çağrısı** ile sistem, yalnızca saat dilimi farkı hesaplamaları için yaklaşık **$\sim 0.15\text{ ms}$** ($150\,\mu\text{s}$) harcar; bu da **$120\text{ Hz}$** bir karenin toplam zaman bütçesinin **$\sim %1.8$**'ini tüketir. Bu tüketim doğrudan kare hızı düşüşlerine ve yerel takılmalara neden olur; bu durum, statik analiz aracı Unity Project Auditor'ın sürekli güncelleme yollarında `DateTime.Now` kullanımını yüksek önem dereceli kırmızı uyarı (*Major Issue*) olarak işaretlemesinin nedenini açıklamaktadır[^3].

---

## **3. Zamansal Yırtılma (Temporal Tearing) Olgusu ve Veri Bütünlüğü Hataları**

CPU performansındaki düşüşün yanı sıra, tek bir zaman damgasının ayrı bileşenlerini çıkarmak için `DateTime.Now` çağrılarını dağıtmak, veri atomikliği (*Data Atomicity*) açısından ciddi bir hataya yol açar. Özgün kod, bağımsız karşılaştırmalar yaparken bu açığa yakalanır:

```csharp
if (requirement.CheckYear)   results.Add(DateTime.Now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(DateTime.Now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(DateTime.Now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(DateTime.Now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(DateTime.Now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(DateTime.Now.Second == requirement.Second);
```

### **Anormal Melez Durumların Oluşum Mekanizması**

`DateTime.Now` özelliğinin doğası, statik bir veri alanı değil, çağrıldığı andaki nesnel zamana bağlı bir durum üreten bir yöntem çağrısı olmasıdır[^20]. Kod `.Year`, `.Month` veya `.Day` gibi bir alt özelliğe her eriştiğinde, sistem tamamen yeni bir işletim sistemi sorgu döngüsü yürütür[^2].

Ardışık kod satırları arasındaki süre yalnızca birkaç mikrosaniye sürse de yürütme süreci işletim sisteminin zaman dilimli çoklu görev zamanlama mekanizması tarafından kesintiye uğratılabilir veya yürütme anı sistem saatinin doğal geçiş sınırına denk gelebilir[^8].

> [!CAUTION]
> **Sınır Geçiş Hatası Senaryosu (Boundary Edge-Case):**  
> İşlemin ay kontrolü satırını tam olarak 31 Ağustos 2024 saat `23:59:59.999` anında yürüttüğünü varsayalım. `DateTime.Now.Month` özelliği bu zaman damgasına göre hesaplanır ve **Ağustos (8)** değerini döndürür.  
>  
> Bu komut tamamlandıktan hemen sonra ve gün kontrolü komutu yürütülmeden önce sistem saati 1 Eylül 2024 saat `00:00:00.000` anına geçer. `DateTime.Now.Day` satırı tetiklendiğinde işletim sistemi yeni zaman damgasını sağlar ve özellik **1. gün** değerini döndürür.  
>  
> Sonuç olarak mantık sistemi melez bir durum yakalar: **1 Ağustos** — fiziksel zaman akışında o anda kesinlikle var olmamış bir zaman damgası!

Bu zaman damgası süreli etkinlikleri tetiklemek, periyodik giriş ödüllerini doğrulamak veya oyun içi işlem kayıtlarını tutmak için kullanılıyorsa, bu sapma koşul denetim mantığını bozabilir, istenmeyen özellik kilitlenmelerine yol açabilir veya oyuncuların mükerrer ödül almasına olanak tanıyabilir.

---

## **4. Frame Caching Çözümünün Teknik Değerlendirmesi**

Gereksiz hesaplama maliyetini tamamen ortadan kaldırmak ve zamansal yırtılma olgusunu kökünden engellemek için uygulanan en uygun çözüm, veri geçerliliğini ayırt etme anahtarı olarak Unity Engine'in kare sayacını (`UnityEngine.Time.frameCount`) kullanan kare önbellekleme (*Frame Caching / Per-frame Memoization*) modelidir[^22].

### **Kare Önbelleğinin Çalışma Akışı Analizi**

Önbellekleme mekanizmasını uygulayan kaynak kodu şu şekilde yapılandırılmıştır:

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

Zaman denetim mantığının sorgulama yapması gerektiğinde, zaman damgası tek bir kez yerel bir değişkene alınır ve tüm kontroller boyunca bu değişken kullanılır:

```csharp
DateTime now = GetCurrentSystemTime();  
if (requirement.CheckYear)   results.Add(now.Year == requirement.Year);  
if (requirement.CheckMonth)  results.Add(now.Month == requirement.Month);  
if (requirement.CheckDay)    results.Add(now.Day == requirement.Day);  
if (requirement.CheckHour)   results.Add(now.Hour == requirement.Hour);  
if (requirement.CheckMinute) results.Add(now.Minute == requirement.Minute);  
if (requirement.CheckSecond) results.Add(now.Second == requirement.Second);
```

Bu mekanizma iki belirleyici iyileştirme sağlar:

1. **Hesaplama Karmaşıklığının Düşürülmesi:** Varlık sayısına bağlı doğrusal $\mathcal{O}(N)$ düzeyinden görüntülenen her kare için sabit $\mathcal{O}(1)$ düzeyine iner. Aynı kare içindeki ilk çağrıdan sonra oluşan tüm sorgular yalnızca statik bellekte saklanan 64-bit `DateTime` struct değerini doğrudan okur; işletim sistemine yapılan çağrıları ve saat dilimi hesaplama maliyetini tamamen ortadan kaldırır[^2].
2. **Zaman Anlık Görüntüsü Atomikliğinin Korunması (*Snapshot Atomicity*):** `now` değişkeni tüm kare için değişmez bir zaman dilimi işlevi görerek yıldan aya ve saniyeye kadar tüm alt bileşenlerin tutarlı olmasını ve sistem kesintileriyle bölünmemesini garanti eder.

### **Gerçek Dünya Dağıtımında Sınır Koşulları ve Risk Analizi**

Kare önbellekleme çözümü Unity'nin ana iş parçacığı üzerindeki sorunu tamamen çözse de büyük ölçekli yazılım mimarilerinde uygulanması üç önemli teknik sınırın dikkatle incelenmesini gerektirir:

1. **Ana İş Parçacığı Bağımlılığı (Main Thread Affinity):** `UnityEngine.Time.frameCount` özelliği motorun dahili C++ katmanına ait bir API'dir ve sıkı sıkıya ana iş parçacığına bağlıdır[^24]. Arka planda çalışan bir süreç — örneğin bir arka plan görev iş parçacığı (`Task.Run`), asenkron ağ işlemi veya C# Job System içindeki bir görev — `GetCurrentSystemTime()` yöntemini çağırırsa, Unity derhal `UnityException: get_frameCount can only be called from the main thread` istisnası fırlatır ve yürütme akışını keser[^24].
2. **Update ile FixedUpdate Arasındaki Tempo Uyuşmazlığı:** Unity'nin yürütme yaşam döngüsü iki bağımsız güncelleme döngüsü içerir: grafik işleme döngüsü (`Update`) ve sabit adımlı fizik simülasyonu döngüsü (`FixedUpdate`)[^25]. `Time.frameCount` değeri motor tarafından yalnızca yeni bir görüntüleme karesine geçildiğinde bir birim artırılır[^22]. İstemci cihazda kare hızı düşüşü yaşandığında motor, fizik simülasyonuna yetişebilmek için tek bir görüntüleme karesi içinde art arda birden fazla `FixedUpdate` döngüsü tetiklemek zorunda kalabilir[^23]. Bu durumda, aynı görüntüleme döngüsü içinde gerçekleşen her `FixedUpdate` adımı aynı önbelleğe alınmış `_cachedSystemTime` değerini okuyacaktır; bu da ardışık fizik simülasyon adımları arasındaki zaman kaymasını yansıtmayabilir[^26].
3. **Veri Yarışı Riski (Data Race):** Küresel statik `_cachedSystemTime` ve `_lastSystemTimeFrame` değişkenlerine bellek bariyerleri (*Memory Barriers*) veya erişim yetkisi kilitleri olmadan erişmek, çok çekirdekli işlemci mimarilerinde sırasız yürütme (*out-of-order execution*) mekanizması altında yardımcı iş parçacıklarının eşzamanlı okuma veya yazma yapması durumunda veri çakışması riskine yol açar.

### **İş Parçacığı Güvenli (Thread-Safe) Zaman Sağlayıcı Sisteminin Uygulanması**

Yukarıda belirtilen tüm teknik kısıtlamaları aşmak için zaman sisteminin, iş parçacığının yürütme bağlamını algılayabilen, güvenli erişimi garanti eden ve sınır istisnalarını otomatik olarak yöneten özel bir hizmet biçiminde standartlaştırılması gerekir:

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

Bu mimari, ana iş parçacığının tekrarlanan hesaplama maliyetinden endişe etmeden kare bazlı önbellekten her zaman yararlanmasını sağlarken, arka plan iş parçacıklarının veya Editor düzenleme modunun doğrudan geri dönüş (fallback) mekanizması aracılığıyla kararlı çalışmasını sürdürür ve motorun iş parçacığı erişim ihlali istisnası fırlatma riskini tamamen ortadan kaldırır[^24].

---

## **5. Oyun Motoru Mimarisinde Zaman Etki Alanı Ayrımı Standartları**

Oyun geliştirmede yaygın yapılan bir hata, farklı zaman kullanım amaçlarını aynı sistem API'si altında karıştırmaktır[^2]. En yüksek performansı ve oyun durumu tutarlılığını korumak için sistem mimarisinin bağımsız zaman etki alanları arasında net sınırlar çizmesi gerekir:

| Zaman Etki Alanı (Time Domain) | Önerilen Standart API | Başlıca Kullanım Senaryoları | Yanlış API Kullanımının Riski |
| :--- | :--- | :--- | :--- |
| **Dahili Oynanış Simülasyonu** | `UnityEngine.Time.time`, `Time.deltaTime` | Fizik koordinat hesaplaması, karakter hareketi, yetenek bekleme süreleri | Oyun duraklatıldığında (`timeScale = 0`) donar; gerçek saat gerekiyorsa doğruluğunu yitirir[^26] |
| **Gerçek Zamanlı Arayüz Gösterimi** | `UnityEngine.Time.unscaledTime`, `Time.realtimeSinceStartup` | Oyun duraklatılmışken menü arayüzü (UI) animasyonları, sahne geçiş efektleri | İstemci sürecinin oturumuna sıkıca bağlıdır, gerçek dünya takvimine eşlenemez |
| **Algoritma Performans Ölçümü** | `System.Diagnostics.Stopwatch` | Algoritma çalışma süresi ölçümü, kod bloğu profilleme, performans sızıntısı tespiti[^7] | `DateTime.Now` çözünürlüğü yalnızca $\sim 15.6\text{ ms}$'dir, kıyaslama için yeterince hassas değildir[^7] |
| **Hile Karşıtı Doğrulama Mantığı** | Sunucudan senkronize edilen Unix Epoch (UTC)[^28] | Enerji sistemi, sandık açma süresi, çevrimiçi etkinlik sınırları[^28] | İstemci saatine güvenilirse oyuncular eşya hilesi yapmak için işletim sistemi saatini değiştirebilir[^28] |
| **Yerel Takvim Gösterimi** | `SystemTimeProvider.CurrentLocalTime` | Kullanıcının gerçek saatini UI durum çubuğunda gösterme[^2] | Önbelleksiz özgün `DateTime.Now` sürekli çağrılırsa kare takılmasına ve lag'a yol açar[^2] |

### **Sunucu Zamanı Senkronizasyonu ve Hile Önleme Mekanizmaları (Anti-Cheat)**

Çevrimiçi özelliklere sahip oyunlarda, istemcinin eylem zaman damgalarını yerel `DateTime.Now` veya `DateTime.UtcNow` üzerinden kendi başına doğrulamasına izin vermek ciddi bir güvenlik açığı oluşturur[^28]. Kullanıcılar yapı inşa geri sayımlarını hızlandırmak veya etkinlik haklarını yenilemek için işletim sistemi saat ayarlarını kolayca değiştirebilir[^28].

Bu hile yöntemini etkisiz hale getirecek standartlaştırılmış mimari, istemcinin monotonik saate (*monotonic clock*) dayalı sanal bir zaman damgası kurmasını gerektirir[^5]:

1. **Senkronizasyon sorgusu gönderme:** İstemci ağ bağlantısını başlattığında, UTC standardında yetkili Unix Epoch zaman damgasını almak üzere hizmet sunucusuna bir zaman senkronizasyonu sorgusu gönderir[^28].
2. **Gidiş-Dönüş gecikmesini ölçme:** İstemci paketin gidiş-dönüş süresini ($RTT$) kaydeder ve yanıtın ulaştığı andaki sunucu standart zamanını şu formülle tahmin eder:
   $$T_{\text{server}} = T_{\text{server\_reply}} + \frac{RTT}{2}$$
3. **Monotonik sapmayı belirleme:** İstemci, donanımın monotonik sayacına göre sabit farkı hesaplar ve saklar:
   $$\Delta t = T_{\text{server}} - \text{Time.realtimeSinceStartupAsDouble}$$
4. **Hileye dayanıklı zamana erişme:** Uygulamanın tüm yaşam döngüsü boyunca gerçek zamanı denetlemesi gereken her oynanış mantığının yalnızca şu değeri alması yeterlidir:
   $$\text{CurrentRealTime} = \text{Time.realtimeSinceStartupAsDouble} + \Delta t$$
   Motorun başlangıç zaman sayacı donanımdan gelen monotonik sayma mekanizmasını (`clock_gettime(CLOCK_MONOTONIC)` veya `QueryPerformanceCounter`) kullandığından, bu değer doğrusal olarak sürekli artar ve işletim sistemi takvim saati üzerinde yapılan her türlü değişiklikten tamamen etkilenmez[^5].

### **TimeProvider (.NET 8+) ile Modern Mimariye Geçiş**

.NET 8 sürümünden itibaren Microsoft, `DateTime.Now` veya `DateTime.UtcNow` gibi doğrudan statik çağrıların yerini tamamen almak üzere `System.TimeProvider` soyut sınıfını tanıtarak tüm zaman yönetimi modelini resmen yeniden yapılandırdı[^20]. Modern Unity projelerinde geliştiriciler, kaynak kodunun modülerliğini artırmak amacıyla `Microsoft.Bcl.TimeProvider` uyumluluk paketi üzerinden bu mimariyi benimseyebilir[^32]:

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

Bu soyutlama modeline geçiş iki büyük teknik avantaj sağlar:

> [!TIP]
> 1. **Bağımsız Birim Testi (Unit Testing):** Birim testi modelinin eksiksiz uygulanmasına olanak tanır[^20]. Mühendisler, gerçek zamanın geçmesini beklemeden veya sisteme müdahale etmeden karmaşık zaman geçiş sınırlarını (örneğin DST saat dilimi geçişi veya yılbaşı anı testleri) atlayarak kesin biçimde simüle etmek için iş mantığına sahte `FakeTimeProvider` nesnesi enjekte edebilir[^20].  
> 2. **Güvenli DateTimeOffset veri tipi:** `GetLocalNow()` yöntemi `DateTime` yerine `DateTimeOffset` yapısını döndürür[^20]. `DateTimeOffset` yapısı zaman damgasını açık bir saat dilimi farkıyla (*offset*) birlikte sabit olarak saklar; `DateTimeKind.Unspecified` bayrağının tüm belirsizliklerini ortadan kaldırır ve ağ üzerinden veri serileştirme (serialization) sırasında bütünlüğü korur[^1].

---

## **5. Pratik Uygulama: RequirementsManager Sisteminin Optimizasyonu (Vaka Çalışması)**

RPG Builder framework'ü kullanan gerçek bir üretim projesinde (GLW Projesi), `RequirementsManager.cs` sınıfında ciddi bir performans sorunu tespit edildi. Özellikle oyunun zaman koşulu denetim sistemi (örneğin bir etkinliğin belirli bir ay, gün ve saatte gerçekleşmesi gereksinimi), `DateTime.Now` çağrısını parçalı biçimde defalarca tekrarlıyordu:

```csharp
if(requirement.CheckYear) results.Add(DateTime.Now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(DateTime.Now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(DateTime.Now.Day == requirement.Day);
// ... Hour, Minute, Second için tekrarlanır
```

**Eski kodda ortaya çıkan sorunlar:**
1. **Çok yüksek CPU ek yükü (Overhead):** Tek bir gereksinimi (requirement) denetlemek için sistem 7-10 adede kadar `DateTime.Now` çağrısını tetikleyebiliyordu (`GetWeekNumber()` gibi yardımcı işlevler dahil). Aynı anda 100 varlık denetim yaparsa, her karede işletim sistemine binlerce Syscall gönderilerek ciddi bir darboğaza (bottleneck) yol açıyordu.
2. **Temporal Tearing (Zaman anı kayması):** Saniyeler (veya dakikalar, günler) arasındaki geçiş anı tam yukarıdaki komut okuma sürecinin ortasına denk gelirse (örneğin 999. milisaniyede), `Month` değişkeni eski aydan alınırken `Day` değişkeni yeni günden alınabiliyordu. Sonuç olarak oyun gerçekte hiç var olmayan bir zaman damgası üretiyordu.

**Üretimde uygulanan çözüm (Per-Frame Caching):**
`Time.frameCount` değerini önbellek geçersiz kılma (cache invalidation) bayrağı olarak kullanan Frame Caching mimarisi doğrudan entegre edildi. Bu yaklaşım Update döngüsü yerine statik yaşam döngüsünden yararlanır:

```csharp
private static DateTime _cachedSystemTime;
private static int _lastSystemTimeFrame = -1;

private static DateTime GetCurrentSystemTime()
{
    if (Application.isPlaying) 
    {
        int currentFrame = Time.frameCount;
        
        // Gerçek saati işletim sisteminden kare başına yalnızca 1 kez al
        if (_lastSystemTimeFrame != currentFrame)
        {
            _lastSystemTimeFrame = currentFrame;
            _cachedSystemTime = DateTime.Now; 
        }
        
        return _cachedSystemTime;
    }
    return DateTime.Now; // Editor modu
}
```

Mantığın işlenmesi gereken yerde, tüm kontroller tek bir zaman **anlık görüntüsüne (snapshot)** referans verir:

```csharp
DateTime now = GetCurrentSystemTime();
if(requirement.CheckYear) results.Add(now.Year == requirement.Year);
if(requirement.CheckMonth) results.Add(now.Month == requirement.Month);
if(requirement.CheckDay) results.Add(now.Day == requirement.Day);
```

**Optimizasyon sonrası sonuçlar (`MOD-RPGB-008` yaması):** 
- **Gereksiz Syscall çağrılarının tamamen ortadan kaldırılması:** Binlerce çağrı yerine `DateTime.Now`, her karedeki tüm hesaplamalar için tam olarak 1 kez olmak üzere $\mathcal{O}(1)$ düzeyine indirildi.
- **Mutlak atomik tutarlılık (Atomic consistency):** `Year`, `Month` ve `Day` alanlarının kesinlikle aynı tekil zaman anına ait olması sağlandı.
- **Unity Project Auditor'ın temizlenmesi:** `System.DateTime` ile ilgili sistem performansına dair "Major" uyarısı tamamen giderildi.

---

## **6. Sonuç**

Unity Engine'in yüksek frekanslı güncelleme döngülerinde `System.DateTime.Now` özelliğinin doğrudan kullanılması, hem donanım performansı hem de mantıksal veri bütünlüğü açısından ciddi bir mühendislik sorunu oluşturmaktadır[^3].

- Saat dilimi çözümleme ve yaz saati uygulaması (DST) denetim sistem çağrılarının karmaşık doğası, bu özelliğin yürütme süresinin **%88**'inden fazlasını tüketerek oyun motorunun kare bütçesi üzerinde doğrudan baskı yaratmaktadır[^4].
- Aynı zamanda, ayrı `DateTime.Now` çağrılarından birden fazla alt özelliğe erişilmesi zamansal yırtılma (*temporal tearing*) açığını doğurarak melez zaman damgalarının oluşmasına ve oyun mantığının bozulmasına yol açmaktadır[^21].

Kare önbellekleme (**Frame Caching**) çözümünün `Time.frameCount` özelliği ile birleştirilmesi, zaman anlık görüntüleri için değişmez atomikliği garanti ederken CPU tüketimini kare başına minimum sabit **$\mathcal{O}(1)$** düzeyine indirerek bu iki sorunu da kökten çözmektedir[^22].

Ticari proje ölçeğinde devreye alınırken bu mimarinin iş parçacığı yürütme koruma katmanı (`SystemTimeProvider`) ile desteklenmesi, hile önleme amacıyla sunucudan alınan yetkili zaman doğrulama mekanizması (*Server-Authoritative Time*) ile sıkı biçimde birleştirilmesi ve modern yazılım endüstrisinin tüm teknik standartlarını karşılamak için `TimeProvider` soyut sınıfıyla standartlaştırılmaya yönlendirilmesi gerekmektedir[^20].

---

## **Kaynakça**

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
