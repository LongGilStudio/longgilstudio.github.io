---
title: "Jak wykonać kopię zapasową projektu Unity na dysku zewnętrznym za pomocą Git Bare Repository"
date: 2026-08-22 10:00:00 +0700
categories: [Game Development, Unity]
tags: [git, backup, unity, bare-repository, usb]
description: "Instrukcja krok po kroku dotycząca konfiguracji repozytorium Git Bare na dysku zewnętrznym (USB) wraz z Git LFS w celu bezpiecznego tworzenia kopii zapasowych projektów Unity oraz rozwiązywania typowych błędów."
lang: pl
translation_id: unity-git-bare-repository-usb-backup
---

Niniejszy przewodnik zbiera cały proces, dokładne polecenia oraz najczęstsze błędy pojawiające się podczas konfigurowania **Bare Git Repository** na zewnętrznym dysku twardym (USB), który ma służyć jako bezpieczne miejsce na kopię zapasową (backup) projektu Unity.

## 1. Wprowadzenie do Bare Repository

- **Bare Repository** to repozytorium Git bez katalogu roboczego (working directory), co oznacza, że nie zawiera ono bezpośrednio plików kodu do przeglądania ani edycji. Przechowuje wyłącznie zawartość ukrytego folderu `.git`.
- Jego głównym celem jest **odbieranie wypychanego kodu (push)** z innych komputerów — działa ono podobnie jak lokalny serwer GitHub lub GitLab umieszczony na Twoim dysku.

## 2. Prawidłowa procedura konfiguracji (Krok po kroku)

### Krok 1: Włączenie Git LFS dla projektu Unity (Lokalnie)

Projekty Unity zawierają bardzo dużo dużych plików binarnych (obrazy, dźwięki, modele 3D). Aby Git obsługiwał je optymalnie, niezbędne jest użycie `Git LFS`.

1. Otwórz terminal (Git Bash) w folderze swojego projektu Unity (np. `D:\Unity-Projects\GLW`).
2. Pobierz standardowy szablon `.gitattributes` z GameCI dla Unity.
3. Uruchom polecenie inicjalizujące LFS:

   ```bash
   git lfs install
   ```

4. Dodaj plik konfiguracyjny do historii Gita:

   ```bash
   git add .gitattributes
   git commit -m "Dodaj konfigurację gitattributes dla Unity i Git LFS"
   ```

### Krok 2: Utworzenie Bare Repo na dysku przenośnym

1. Podłącz dysk zewnętrzny do komputera (załóżmy, że system przydzielił mu literę `E:`).
2. Otwórz **Git Bash** i przejdź do folderu, w którym chcesz umieścić kopię zapasową (np. `E:\Git`):

   ```bash
   cd /e/Git
   ```

3. Utwórz folder na repozytorium (zgodnie z konwencją zakończony rozszerzeniem `.git`).

   > [!IMPORTANT]
   > **Niezwykle ważna uwaga:** W Git Bashu należy używać zwykłego ukośnika `/`, a nie ukośnika odwrotnego `\` znanego z systemu Windows.

   ```bash
   mkdir -p "GLW.git"
   ```

4. Przejdź do nowo utworzonego folderu i zainicjalizuj Bare Repo:

   ```bash
   cd "GLW.git"
   git init --bare
   ```

### Krok 3: Powiązanie projektu Unity z dyskiem zewnętrznym (Dodanie zdalnego repozytorium)

1. Wróć do terminala (Git Bash) w katalogu projektu Unity (`D:\Unity-Projects\GLW`).
2. Dodaj zdalne repozytorium remote (nadając mu nazwę `glw` lub `usb`):

   ```bash
   git remote add glw "E:/Git/GLW.git"
   ```

3. Sprawdź, czy zdalne repozytorium zostało poprawnie rozpoznane:

   ```bash
   git remote -v
   ```
   *(Jeśli w wyniku pojawią się dwie linie — fetch oraz push — wskazujące na `E:/Git/GLW.git`, oznacza to sukces).*

### Krok 4: Rozwiązanie błędu zabezpieczeń uprawnień (Dubious Ownership)

Podczas wypychania kodu na dysk sformatowany w systemie exFAT lub FAT32 Git zgłosi błąd `"dubious ownership"`, ponieważ te systemy plików nie przechowują uprawnień użytkowników tak jak NTFS. W efekcie Git uznaje takie repozytorium za pozbawione właściciela i blokuje operację ze względów bezpieczeństwa.

**Rozwiązanie:** Dodaj wskazany folder do listy bezpiecznych katalogów Gita:

```bash
git config --global --add safe.directory "E:/Git/GLW.git"
```

### Krok 5: Wypchnięcie kodu na dysk zewnętrzny

Gdy wszystko jest już skonfigurowane, wpisz poniższe polecenia, aby wypchnąć wszystkie gałęzie (branches) oraz tagi (tags) i wykonać w 100% kompletną kopię zapasową projektu:

```bash
git push glw --all
git push glw --tags
```
*(Poczekaj na zakończenie operacji — Twój projekt jest już bezpiecznie zarchiwizowany na dysku zewnętrznym).*

---

## 3. Najczęstsze błędy (Rozwiązywanie problemów)

### 3.1. Błąd utworzenia nieprawidłowej nazwy folderu (Sklejone nazwy)

- **Objaw:** Po uruchomieniu w Git Bashu polecenia `mkdir -p E:\Git\GLW.git` powstaje folder o nazwie `GitGLW.git`.
- **Przyczyna:** Git Bash traktuje znak `\` jako znak ucieczki (escape). Pomija on ukośnik `\` i łączy słowo `Git` ze słowem `GLW`, tworząc `GitGLW`.
- **Rozwiązanie:** Podczas podawania ścieżek w Git Bashu zawsze stosuj zwykłe ukośniki `/` lub cudzysłów (np. `mkdir -p "E:/Git/GLW.git"`).

### 3.2. Błąd `"fatal: 'E:BackupGitGLW.git' does not appear to be a git repository"`

- **Objaw:** Podczas wypychania (push) Git zgłasza, że nie może odnaleźć zdalnego repozytorium.
- **Przyczyna:** Podczas wykonywania polecenia `git remote add` użyto ukośników odwrotnych (`\`), co zniekształciło zapisaną ścieżkę.
- **Rozwiązanie:**
  1. Usuń błędną konfigurację zdalnego repozytorium:

     ```bash
     git remote remove glw
     ```

  2. Dodaj zdalne repozytorium ponownie z poprawną ścieżką:

     ```bash
     git remote add glw "E:/Git/GLW.git"
     ```
     *(Możesz też użyć `git remote set-url glw "E:/Git/GLW.git"`, aby je nadpisać).*

### 3.3. Pominięcie inicjalizacji Bare Repo

- **Objaw:** Mimo że ścieżka zdalnego repozytorium jest poprawna, próba wypchnięcia nadal kończy się komunikatem `Could not read from remote repository`.
- **Przyczyna:** Wewnątrz folderu na dysku zewnętrznym nie uruchomiono polecenia `git init --bare`.
- **Rozwiązanie:** Przejdź w Eksploratorze plików do folderu na dysku zewnętrznym, kliknij prawym przyciskiem myszy, wybierz **Open Git Bash here** i uruchom polecenie `git init --bare`.
