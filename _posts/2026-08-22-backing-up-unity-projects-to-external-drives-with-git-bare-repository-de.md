---
title: "Anleitung zum Sichern von Unity-Projekten auf einer externen Festplatte mit einem Git Bare Repository"
date: 2026-08-22 10:00:00 +0700
categories: [Game Development, Unity]
tags: [git, backup, unity, bare-repository, usb]
description: Schritt-für-Schritt-Anleitung zur Einrichtung eines Git Bare Repository mit Git LFS auf einer externen Festplatte (USB) zur sicheren Sicherung von Unity-Projekten und zur Behebung häufiger Fehler.
lang: de
translation_id: unity-git-bare-repository-usb-backup
---

Dieses Dokument fasst den gesamten Ablauf, die exakten Befehle und häufige Fehler bei der Einrichtung eines **Bare Git Repository** auf einer externen Festplatte (USB) als sicheren Backup-Speicherort für ein Unity-Projekt zusammen.

## 1. Einführung in das Bare Repository

- Ein **Bare Repository** ist ein Git-Repository ohne Arbeitsverzeichnis (Working Directory) – das bedeutet, es enthält keinen direkt einsehbaren oder bearbeitbaren Quellcode. Es speichert ausschließlich den Inhalt des versteckten Ordners `.git`.
- Sein Hauptzweck besteht darin, **Code-Pushes** von anderen Computern entgegenzunehmen, und es funktioniert damit ähnlich wie ein lokaler GitHub- oder GitLab-Server auf Ihrer Festplatte.

## 2. Korrekter Einrichtungsprozess (Schritt für Schritt)

### Schritt 1: Git LFS für das Unity-Projekt aktivieren (Lokal)

Ein Unity-Projekt enthält viele große Binärdateien (Bilder, Audio, 3D-Modelle). Damit Git diese optimal verarbeiten kann, ist `Git LFS` zwingend erforderlich.

1. Öffnen Sie das Terminal (Git Bash) im Ordner Ihres Unity-Projekts (z. B. `D:\Unity-Projects\GLW`).
2. Laden Sie die Standard-`.gitattributes`-Vorlage von GameCI für Unity herunter.
3. Führen Sie den Befehl zur Aktivierung von LFS aus:

   ```bash
   git lfs install
   ```

4. Nehmen Sie die Konfigurationsdatei in die Git-Historie auf:

   ```bash
   git add .gitattributes
   git commit -m "gitattributes-Konfiguration für Unity und Git LFS hinzufügen"
   ```

### Schritt 2: Bare Repo auf der externen Festplatte erstellen

1. Schließen Sie die externe Festplatte an den Computer an (angenommen, das System weist ihr den Laufwerksbuchstaben `E:` zu).
2. Öffnen Sie **Git Bash** und wechseln Sie in das Verzeichnis, in dem das Backup gespeichert werden soll (z. B. `E:\Git`):

   ```bash
   cd /e/Git
   ```

3. Erstellen Sie den Ordner für das Repository (gemäß der Konvention mit der Endung `.git`).

   > [!IMPORTANT]
   > **Äußerst wichtiger Hinweis:** In Git Bash müssen Sie Schrägstriche `/` (Forward Slashes) verwenden, niemals die umgekehrten Schrägstriche `\` (Backslashes) von Windows.

   ```bash
   mkdir -p "GLW.git"
   ```

4. Wechseln Sie in den neu erstellten Ordner und initialisieren Sie das Bare Repo:

   ```bash
   cd "GLW.git"
   git init --bare
   ```

### Schritt 3: Unity-Projekt mit der externen Festplatte verknüpfen (Remote hinzufügen)

1. Kehren Sie im Terminal (Git Bash) zum Ordner des Unity-Projekts (`D:\Unity-Projects\GLW`) zurück.
2. Verknüpfen Sie das Remote-Repository (nennen Sie das Remote `glw` oder `usb`):

   ```bash
   git remote add glw "E:/Git/GLW.git"
   ```

3. Überprüfen Sie, ob das Remote richtig erkannt wurde:

   ```bash
   git remote -v
   ```
   *(Wenn zwei Zeilen für `fetch` und `push` ausgegeben werden, die auf `E:/Git/GLW.git` zeigen, war die Einrichtung erfolgreich.)*

### Schritt 4: Berechtigungs-Sicherheitsfehler beheben (Dubious Ownership)

Beim Pushen von Code auf eine mit exFAT/FAT32 formatierte Festplatte meldet Git den Fehler `"dubious ownership"`, da diese Dateisysteme keine Benutzerberechtigungen wie NTFS speichern. Git hält das Repository daher für herrenlos und blockiert es aus Sicherheitsgründen.

**Lösung:** Fügen Sie den Ordner explizit als vertrauenswürdiges Verzeichnis hinzu:

```bash
git config --global --add safe.directory "E:/Git/GLW.git"
```

### Schritt 5: Code auf die externe Festplatte pushen

Sobald alles eingerichtet ist, führen Sie die Befehle aus, um alle Branches und Tags zu pushen und das Projekt zu 100 % vollständig zu sichern:

```bash
git push glw --all
git push glw --tags
```
*(Warten Sie, bis der Vorgang abgeschlossen ist – Ihr Projekt ist danach sicher auf der externen Festplatte gesichert.)*

---

## 3. Häufige Fehler (Fehlerbehebung)

### 3.1. Fehlerhafte Ordnerbenennung (zusammengezogene Namen)

- **Symptom:** Beim Ausführen des Befehls `mkdir -p E:\Git\GLW.git` in Git Bash entsteht ein Ordner namens `GitGLW.git`.
- **Ursache:** Git Bash behandelt `\` als Escape-Zeichen. Es ignoriert den Backslash `\` und verbindet `Git` mit `GLW` zu `GitGLW`.
- **Lösung:** Verwenden Sie bei Pfadangaben in Git Bash immer Schrägstriche `/` oder Anführungszeichen (z. B. `mkdir -p "E:/Git/GLW.git"`).

### 3.2. Fehler `"fatal: 'E:BackupGitGLW.git' does not appear to be a git repository"`

- **Symptom:** Beim Pushen wird gemeldet, dass das Remote-Repository nicht gefunden werden kann.
- **Ursache:** Beim Ausführen von `git remote add` wurden Backslashes (`\`) verwendet, wodurch der Pfad verfälscht wurde.
- **Lösung:**
  1. Entfernen Sie die fehlerhafte Remote-Konfiguration:
     ```bash
     git remote remove glw
     ```
  2. Fügen Sie das Remote korrekt neu hinzu:
     ```bash
     git remote add glw "E:/Git/GLW.git"
     ```
     *(Alternativ können Sie `git remote set-url glw "E:/Git/GLW.git"` zum Überschreiben verwenden.)*

### 3.3. Initialisierung des Bare Repos vergessen

- **Symptom:** Obwohl der Remote-Pfad korrekt ist, schlägt der Push weiterhin mit `Could not read from remote repository` fehl.
- **Ursache:** Der Befehl `git init --bare` wurde innerhalb des Ordners auf der externen Festplatte nicht ausgeführt.
- **Lösung:** Öffnen Sie im Datei-Explorer den Ordner auf der externen Festplatte, klicken Sie mit der rechten Maustaste, wählen Sie **Open Git Bash here** und führen Sie den Befehl `git init --bare` aus.
