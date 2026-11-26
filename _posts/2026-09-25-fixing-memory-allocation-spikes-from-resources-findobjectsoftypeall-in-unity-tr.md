---
title: "Unity Performans Optimizasyonu: Resources.FindObjectsOfTypeAll Kaynaklı Bellek Ayırma (GC Alloc) Sıçramalarını Anlama ve Çözme"
date: 2026-09-25 09:26:00 +0700
categories: [Game Development, Unity]
tags: [unity, performance, optimization, memory, gc-alloc, csharp, dotnet, beginner-guide]
description: "Unity'de Resources.FindObjectsOfTypeAll yönteminin aşırı kullanımının neden kare hızı sıçramalarına (frame spike) ve takılmalara yol açtığını anlatan yeni başlayanlar için ayrıntılı rehber ve en doğru 4 optimizasyon yöntemi."
lang: tr
translation_id: unity-gc-alloc-resources-findobjectsoftypeall
math: true
---

Unity ile oyun geliştirirken mutlaka belirli bir `GameObject` veya `Component` bulmanız gereken durumlarla karşılaşmışsınızdır. Unity bunun için `Find`, `FindObjectOfType` ve özellikle `Resources.FindObjectsOfTypeAll` gibi pek çok fonksiyon sunar.

`Resources.FindObjectsOfTypeAll`, **her şeyi** (devre dışı bırakılmış — inactive — nesneleri, klasörlerdeki prefab'ları veya henüz spawn edilmemiş varlıkları bile) bulabildiği için son derece güçlü olsa da, doğru kullanılmadığında oyununuzun performansını sessizce öldüren en büyük etkenlerden biridir.

Bu makale; bu fonksiyonun neden bu kadar tehlikeli olduğunu, analiz araçlarının (Profiler / Project Auditor) nasıl uyarı verdiğini anlamanıza yardımcı olacak ve yönetilen bellek çöpünü (Garbage Collection Allocation — GC Alloc) tamamen ortadan kaldırmak için en doğru optimizasyon yöntemlerini adım adım gösterecektir.

---

## **1. `Resources.FindObjectsOfTypeAll` Neden Performansa Zarar Verir?**

Unity Memory Profiler veya Project Auditor çalıştırdığınızda sarı (Moderate) bir uyarı ile karşılaşabilirsiniz:
> *"Resources.FindObjectsOfTypeAll() allocates managed memory."*

Bunun nedenini anlamak için bu fonksiyonun motorun alt katmanında (C++ çekirdeğinde) nasıl çalıştığına bakmamız gerekir:

1. **Tüm Belleği Tarama (Yüksek CPU Maliyeti)**: Yalnızca sahnede (Scene) aktif olan nesneleri tarayan `FindObjectOfType` fonksiyonunun aksine, `Resources.FindObjectsOfTypeAll` motorun **tüm** belleğini tarar. Tüm Scene nesnelerini, (Editor içindeyseniz) Editor nesnelerini ve RAM'e yüklenmiş tüm varlıkları (Assets) tek tek dolaşır. Projeniz büyüdükçe bu fonksiyonun çalışması da o kadar yavaşlar.
2. **Bellek Çöpü Oluşturma (GC Allocation)**: Bu fonksiyon her çalışmasını tamamladığında, dönen sonuçları tutmak için C#'ın Managed Heap alanında **her zaman** yeni bir dizi (`Array`) oluşturur.

**Sonuç:** Bu fonksiyonu sürekli olarak çağırırsanız (örneğin `Update()` içinde veya bir UI düğmesine her tıklandığında), belleğe sürekli çöp (eski diziler) bırakırsınız. Çöp biriktiğinde Unity'nin Çöp Toplayıcısı (Garbage Collector — GC) çalışmaya zorlanır. Bu temizlik süreci oyunu bir anlığına duraklatır ve oyuncular için oldukça rahatsız edici bir **takılma (stuttering)** sorununa yol açar.

---

## **2. 4 Optimizasyon Yöntemi (En İyi Uygulamalar)**

Bu sorunu kökten çözmek için, durumunuza bağlı olarak Unity optimizasyon mühendislerinin deneyimlerinden süzülmüş aşağıdaki 4 kanıtlanmış yöntemden birini uygulayabilirsiniz.

### **Yöntem 1: Inspector Üzerinden Doğrudan Referans Verme (En Çok Tavsiye Edilen)**
En hızlı ve 0 CPU/RAM maliyeti olan yöntem, **hiçbir arama yapmamaktır**. Bir nesneyi bulmak için kod yazmak yerine, `public` veya `[SerializeField]` bir değişken tanımlayın ve Unity Inspector arayüzünden o nesneyi sürükleyip bırakın.

```csharp
// ❌ KAÇININ: Maliyetli arama
void Start() {
    // Bu fonksiyon GC Alloc oluşturur
    myManager = (GameManager)Resources.FindObjectsOfTypeAll(typeof(GameManager))[0]; 
}

// ✅ EN İYİSİ: Doğrudan referans
[SerializeField] private GameManager myManager; 
// (Unity Editor'da GameManager'ı bu alana sürükleyip bırakın)
```

### **Yöntem 2: Önbellekleme (Caching) ve Singleton**
Kod üzerinden arama yapmak zorundaysanız, **yalnızca 1 kez arayın** (örneğin `Awake()` veya `Start()` içinde) ve sonraki kullanımlar için sonucu bir değişkende saklayın (cache).

`UIManager` veya `AudioManager` gibi ortak kullanılan sistemlerde, arama maliyeti olmadan genel erişim sağlamak için Singleton desenini veya Static Property yapısını kullanın.

```csharp
// ❌ KAÇININ: Her metin gerektiğinde arama fonksiyonunu tekrar tekrar çağırmak
public string GetLocalizedText(string key) {
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetText(key);
}

// ✅ DAHA İYİ: Statik değişkende önbelleğe alın (yalnızca 1 kez arayın)
public static UIManager SharedUIManager;

void Awake() {
    if (SharedUIManager == null) 
        SharedUIManager = FindAnyObjectByType<UIManager>(); // 1 kez ara
}

public string GetLocalizedText(string key) {
    return SharedUIManager.GetText(key); // Anında yeniden kullan, 0 maliyet
}
```

### **Yöntem 3: Modern Unity 6 API'lerine Yükseltme**
Daha önce, Unity 2023'ün ilk sürümlerinde `FindObjectsOfType` yerine geçerken Unity `FindObjectsSortMode` enum'ını kullanıyordu:

```csharp
// ⚠️ Eski (Unity 2023.1 - 2023.2):
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
```

Ancak **Unity 6'dan itibaren, motorun 32-bit `InstanceID` yapısından yeni nesne tanımlama mekanizmasına geçmesi ve performansı en üst düzeye çıkarmak için sıralamayı kaldırması nedeniyle `FindObjectsSortMode` enum'ı resmi olarak kullanımdan kaldırılmış (Deprecated / Obsolete) olarak işaretlenmiştir**.

Unity 6 resmi dokümantasyonuna göre aşağıdaki standart aşırı yüklemeleri (overload) kullanmalısınız:

```csharp
// ❌ Eski (Unity 2022 ve öncesi - Yavaş, diziyi sıralamaya zorlar)
var managers = FindObjectsOfType<GameManager>();

// ✅ Unity 6 Standardı: Herhangi bir 1 nesne al (En hızlı, Zero-Alloc)
// Heap üzerinde dizi ayırmaz, bulunan ilk nesneyi hemen döndürür
var manager = FindAnyObjectByType<GameManager>(); 

// ✅ Unity 6 Standardı: Birden fazla nesne listesi al (Obsolete olan SortMode parametresi gerekmez)
var managers = FindObjectsByType<GameManager>(FindObjectsInactive.Exclude);
```

> 💡 **İpucu:** Yalnızca tek bir örneğiniz varsa (Manager/Controller gibi), `FindAnyObjectByType<T>()` fonksiyonu `FindFirstObjectByType<T>()` fonksiyonuna göre çok daha verimlidir; çünkü Hierarchy sırasını umursamaz ve bulduğu ilk nesneyi anında döndürür.

#### ⚠️ **Yaygın Yanılgı: `Resources.FindObjectsOfTypeNonAlloc` Diye Bir Fonksiyon Var mı?**
Birçok geliştirici Unity'nin dizileri yeniden kullanan fonksiyonlarına (`Physics.RaycastNonAlloc` veya `GetComponentsNonAlloc` gibi) aşinadır ve `Resources` sınıfının da benzer bir `NonAlloc` fonksiyonuna sahip olduğunu düşünür.
Gerçekte Unity'nin resmi dokümantasyonuna göre: **`Resources.FindObjectsOfTypeNonAlloc` diye bir fonksiyon KESİNLİKLE yoktur**. `Resources.FindObjectsOfTypeAll` her çağrıldığında Managed Heap üzerinde **daima** yeni bir dizi oluşturur.

Sahnede yer alan tüm nesnelerin listesini takip etmeniz gerekiyorsa ve **kesinlikle 0 GC Alloc** elde etmek istiyorsanız, **Statik Kayıt Desenini (Static Registration Pattern)** kullanın:

```csharp
// ✅ Zero GC Alloc çözümü: Etkinleştiğinde listeye otomatik kayıt
public class Enemy : MonoBehaviour 
{
    // Paylaşılan statik liste; yeni bellek ayırmadan belleği yeniden kullanır
    public static readonly List<Enemy> ActiveEnemies = new();

    void OnEnable()  => ActiveEnemies.Add(this);
    void OnDisable() => ActiveEnemies.Remove(this);
}

// Oyun içinde erişim gereken her yerde:
// Doğrudan Enemy.ActiveEnemies kullanın — Find'dan onlarca kat hızlı ve tamamen 0 GC Alloc!
```

### **Yöntem 4: Editor Araçları İçin Kodu `#if UNITY_EDITOR` İle Sarmalama (Wrap)**
Bazen Asset Store'dan bir eklenti (örneğin bir animasyon sistemi veya UI aracı) indirirsiniz ve içinde `Resources.FindObjectsOfTypeAll` çağrısı bulunur. Genellikle bu çağrılar yalnızca geliştirme ortamındaki (Editor) yardımcı düğmelere hizmet eder.

Bu fonksiyonların son oyun derlemesine (Build Player) sızmasını ve uyarı üretmesini önlemek için onları `#if UNITY_EDITOR` ön işlemci yönergesi ile sarmalayabilirsiniz. Oyunu dışa aktardığınızda içindeki kod tamamen derleme dışı bırakılır.

```csharp
#if UNITY_EDITOR 
// Bu kod yalnızca Unity Editor üzerinde çalışırken yürütülür
// .exe, .apk dosyası Build edildiğinde tamamen silinir
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    if (reOfType != null) return reOfType.ToList();
    return null;
}
#endif 
```

---

## **3. Gerçek Hayat Örnekleri: Oyun Projesinde Sorunu Kökten Çözme**

Pratikte nasıl uygulanacağını netleştirmek için, bir projenin üçüncü taraf varlık paketlerinden kaynaklanan bellek çöpü nedeniyle Unity Project Auditor veya Profiler tarafından en sık uyarı aldığı 2 senaryoyu inceleyelim:

### **Senaryo 1: UI Yerelleştirme (Localization) Sisteminin Her Dil Değişiminde RAM'i Taraması**
* **Sorun**: Bir UI metninin görüntülenmesi veya bir arayüz sesinin çalınması gerektiğinde, yardımcı fonksiyon `Resources.FindObjectsOfTypeAll(typeof(UIManager))[0]` çağrısı yapıyor. Bu durum, menü açılan her işlemde tüm RAM'in taranmasına ve Heap üzerinde çöp dizi oluşturulmasına neden oluyor.
* **Çözüm**:
  1. Başlatma sırasında (`Awake`) yalnızca bir kez arama yapmak için `FindAnyObjectByType<UIManager>()` kullanın.
  2. Önbellek (cache) tutmak için statik bir `SharedUIManager` özelliği oluşturun; böylece arama işlemini **0 bayt çöp** üreten anlık $O(1)$ erişime dönüştürün.

```csharp
// ❌ OPTİMİZASYON ÖNCESİ: Her fonksiyon çağrısında tüm belleği tarar ve çöp oluşturur
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = (UIManager)Resources.FindObjectsOfTypeAll(typeof(UIManager))[0];
    return tempUIM.GetLocalizedText(tableID, tableKey);
}

// ✅ OPTİMİZASYON SONRASI: Statik Cache kullanımı (Zero GC Alloc)
public class LocalizationManager : MonoBehaviour 
{
    public static LocalizationManager instance;
    public UIManager UIManagerAsset;

    // Tüm oyun için hızlı erişim önbelleği
    public static UIManager SharedUIManager => instance != null ? instance.UIManagerAsset : null;

    void Awake() 
    {
        instance = this;
        // Dizi ayırmadan tek seferlik arama için Unity 6 API'sini kullanın
        if (UIManagerAsset == null) 
            UIManagerAsset = FindAnyObjectByType<UIManager>(); 
    }
}

// Metin gereken her yerde doğrudan Cache üzerinden çağırın:
public static string GetKeyOutput(string tableID, string tableKey) 
{
    UIManager tempUIM = LocalizationManager.SharedUIManager;
    return tempUIM != null ? tempUIM.GetLocalizedText(tableID, tableKey) : null;
}
```

---

### **Senaryo 2: Üçüncü Taraf Editor Yardımcı Kodlarının Oyun Build'ine Sızması**
* **Sorun**: Birçok araç paketi (Animation veya Level Design sistemleri gibi), Editor içinde Reset veya Setup düğmelerini çalıştırmak için hazır `Resources.FindObjectsOfTypeAll` varlık arama fonksiyonları içerir. Oynanış kodu bunları hiç çağırmasa bile, bu kodun runtime kaynak kodunda açıkta kalması Unity'nin oyun derlemesini (Player Build) GC Alloc uyarısıyla işaretlemesine neden olur.
* **Çözüm**: Tüm bu arama kod bloğunu `#if UNITY_EDITOR` ön işlemci yönergesi ile sarmalayın. Oyunu kurulum dosyası (`.exe`, `.apk`) olarak derlediğinizde, Unity bu kod satırlarını runtime'dan otomatik olarak tamamen çıkaracaktır.

```csharp
// ❌ OPTİMİZASYON ÖNCESİ: Editor varlık arama kodu Runtime içinde açıkta duruyor
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}

// ✅ OPTİMİZASYON SONRASI: #if UNITY_EDITOR ön işlemci yönergesi ile sarılı
#if UNITY_EDITOR
// Bu kod bloğu yalnızca Unity Editor'da bulunur, oyun Build edildiğinde %100 kaldırılır
public static List<T> GetAllResources<T>() where T : Object
{
    var reOfType = Resources.FindObjectsOfTypeAll<T>();
    return reOfType != null ? reOfType.ToList() : null;
}
#endif
```

---

## **Sonuç**

Unity'ye yeni başlayanlar için "Bellek Çöpü" (GC Allocation) biraz soyut bir kavramdır çünkü C# temizliği otomatik olarak yapar. Ancak oyun programlamada sürekli çöp üretmek, doğrudan ekranda açıkça görülen takılma ve donmalara yol açar.

Altın kural: **`Update()` gibi döngülerde veya sık tetiklenen olaylarda `Find` ailesi fonksiyonlarından (özellikle `Resources.FindObjectsOfTypeAll` fonksiyonundan) uzak durun.** Inspector üzerinden referans vermeyi önceliklendirin, önbellekten (Cache/Singleton) yararlanın, Unity 6 standart API'sine (`FindAnyObjectByType`) yükseltin ve Editor yardımcı araçlarını `#if UNITY_EDITOR` ile koruma altına alın. Bu küçük ayrıntılardan başlayarak yapılan optimizasyon, oyununuzun tüm cihazlarda kararlı 60 FPS korumasını sağlayacaktır!
