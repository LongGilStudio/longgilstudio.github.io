---
title: "Git Bare Repository ile Unity Projelerini Harici Diske Yedekleme Rehberi"
date: 2026-08-22 10:00:00 +0700
categories: [Game Development, Unity]
tags: [git, backup, unity, bare-repository, usb]
description: Unity projelerini güvenli bir şekilde yedeklemek ve yaygın hataları çözmek için Git LFS destekli taşınabilir (USB) harici diskte Git Bare Repository kurulumuna yönelik adım adım rehber.
lang: tr
translation_id: unity-git-bare-repository-usb-backup
---

Bu belge, bir Unity projesini güvenli bir şekilde yedeklemek (backup) amacıyla taşınabilir (USB) bir harici diskte **Bare Git Repository** kurulumuna ilişkin tüm süreci, doğru komutları ve sık karşılaşılan hataları derlemektedir.

## 1. Bare Repository Nedir?

- **Bare Repository**, çalışma dizini (working directory) bulunmayan bir Git deposudur; yani içinde doğrudan görüntülenebilecek veya düzenlenebilecek kaynak kod dosyaları yer almaz. Yalnızca gizli `.git` klasörünün içeriğini barındırır.
- Temel amacı, diğer bilgisayarlardan **push edilen kodları almak** ve harici diskiniz üzerinde yerel bir GitHub/GitLab sunucusu gibi çalışmaktır.

## 2. Adım Adım Kurulum Süreci

### Adım 1: Unity Projesi İçin Git LFS'i Etkinleştirme (Yerel)

Unity projeleri çok sayıda büyük ikili dosya (görseller, ses dosyaları, 3D modeller) içerir. Git'in bunları verimli bir şekilde işleyebilmesi için `Git LFS` kullanılması zorunludur.

1. Unity proje klasörünüzün içinde Terminal'i (Git Bash) açın (ör. `D:\Unity-Projects\GLW`).
2. Unity için standart GameCI `.gitattributes` şablonunu indirin.
3. LFS'i etkinleştirmek için şu komutu çalıştırın:

   ```bash
   git lfs install
   ```

4. Yapılandırma dosyasını Git geçmişine ekleyin:

   ```bash
   git add .gitattributes
   git commit -m "Unity ve Git LFS için gitattributes yapılandırması eklendi"
   ```

### Adım 2: Harici Diskte Bare Repo Oluşturma

1. Harici diski bilgisayara bağlayın (sistemin sürücüyü `E:` olarak tanıdığını varsayalım).
2. **Git Bash**'i açın ve yedeği koymak istediğiniz klasöre gidin (ör. `E:\Git`):

   ```bash
   cd /e/Git
   ```

3. Depoyu içerecek klasörü oluşturun (`.git` uzantısı kuralına uyarak).

   > [!IMPORTANT]
   > **Çok önemli not:** Git Bash içinde Windows'un ters eğik çizgisi `\` yerine mutlaka ileri eğik çizgi `/` kullanılmalıdır.

   ```bash
   mkdir -p "GLW.git"
   ```

4. Yeni oluşturulan klasöre girin ve Bare Repo'yu başlatın:

   ```bash
   cd "GLW.git"
   git init --bare
   ```

### Adım 3: Unity Projesini Harici Diske Bağlama (Remote Ekleme)

1. Unity proje klasörünüzdeki (`D:\Unity-Projects\GLW`) Terminal'e (Git Bash) geri dönün.
2. Remote bağlantısını ekleyin (remote adını `glw` veya `usb` olarak belirleyin):

   ```bash
   git remote add glw "E:/Git/GLW.git"
   ```

3. Remote adresinin doğru tanımlanıp tanımlanmadığını kontrol edin:

   ```bash
   git remote -v
   ```
   *(Çıktıda `E:/Git/GLW.git` yolunu gösteren hem fetch hem push satırları yazdırılıyorsa işlem başarılıdır.)*

### Adım 4: İzin Güvenliği Hatasını Çözme (Dubious Ownership)

exFAT veya FAT32 dosya sistemine sahip bir harici diske kod gönderirken (push), bu dosya sistemleri NTFS gibi kullanıcı sahipliği (user ownership) bilgilerini saklamadığı için Git `"dubious ownership"` hatası verir; bu durum Git'in depoyu sahipsiz sanmasına ve güvenlik nedeniyle engellemesine yol açar.

**Çözüm:** İlgili klasörü Git'in güvenli dizin listesine ekleyin:

```bash
git config --global --add safe.directory "E:/Git/GLW.git"
```

### Adım 5: Kodu Harici Diske Push Etme

Tüm ayarlar tamamlandıktan sonra, projenin %100 eksiksiz yedeğini almak için tüm dalları (branches) ve etiketleri (tags) push eden şu komutları çalıştırın:

```bash
git push glw --all
git push glw --tags
```
*(İşlemin tamamlanmasını bekledikten sonra projeniz harici diske güvenli bir şekilde yedeklenmiş olur.)*

---

## 3. Sık Karşılaşılan Hatalar ve Çözümleri

### 3.1. Yanlış Klasör Adı Oluşması (İsimlerin Bitişmesi)

- **Belirti:** Git Bash üzerinde `mkdir -p E:\Git\GLW.git` komutu çalıştırıldığında oluşan klasörün adı `GitGLW.git` olur.
- **Neden:** Git Bash, `\` işaretini kaçış (escape) karakteri olarak algılar. `\` karakterini yok sayar ve `Git` ile `GLW` sözcüklerini birleştirerek `GitGLW` haline getirir.
- **Çözüm:** Git Bash üzerinde dosya yollarıyla çalışırken her zaman ileri eğik çizgi `/` veya tırnak işareti kullanın (ör. `mkdir -p "E:/Git/GLW.git"`).

### 3.2. `"fatal: 'E:BackupGitGLW.git' does not appear to be a git repository"` Hatası

- **Belirti:** Push işlemi sırasında uzak deponun (remote repo) bulunamadığı hatası alınır.
- **Neden:** `git remote add` komutunu çalıştırırken ters eğik çizgi (`\`) kullanıldığı için yol bozulmuştur.
- **Çözüm:**
  1. Hatalı remote yapılandırmasını silin:
     ```bash
     git remote remove glw
     ```
  2. Doğru yol ile remote'u yeniden ekleyin:
     ```bash
     git remote add glw "E:/Git/GLW.git"
     ```
     *(Üzerine yazmak için `git remote set-url glw "E:/Git/GLW.git"` komutu da kullanılabilir.)*

### 3.3. Bare Repo'yu Başlatmayı Unutma Hatası

- **Belirti:** Remote yolu doğru olmasına rağmen push yapılırken `Could not read from remote repository` hatası alınmaya devam eder.
- **Neden:** Harici diskteki klasörün içinde `git init --bare` komutu çalıştırılmamıştır.
- **Çözüm:** Dosya Gezgini (File Explorer) ile harici diskteki klasöre gidin, sağ tıklayıp **Open Git Bash here** seçeneğini seçin ve `git init --bare` komutunu çalıştırın.
