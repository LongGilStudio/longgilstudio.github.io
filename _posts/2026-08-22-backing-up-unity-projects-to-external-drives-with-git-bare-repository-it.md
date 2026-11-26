---
title: "Guida al backup di un progetto Unity su disco esterno con un repository Git bare"
date: 2026-08-22 10:00:00 +0700
categories: [Game Development, Unity]
tags: [git, backup, unity, bare-repository, usb]
description: Guida passo passo per configurare un repository Git bare con Git LFS su un disco esterno (USB) per eseguire il backup sicuro di un progetto Unity e risolvere gli errori comuni.
lang: it
translation_id: unity-git-bare-repository-usb-backup
---

Questo documento raccoglie l'intera procedura, i comandi esatti e gli errori più comuni durante la configurazione di un **Bare Git Repository** su un disco rigido portatile (USB) come destinazione di backup sicura per un progetto Unity.

## 1. Introduzione al Bare Repository

- Un **Bare Repository** è un repository Git privo di cartella di lavoro (working directory), ovvero non contiene codice direttamente visibile o modificabile. Conserva soltanto il contenuto della cartella nascosta `.git`.
- Il suo scopo principale è **ricevere i push di codice** da altri computer, funzionando in modo simile a un server GitHub/GitLab locale sul tuo disco rigido.

## 2. Procedura di configurazione corretta (passo passo)

### Passo 1: Abilitare Git LFS per il progetto Unity (Locale)

Un progetto Unity contiene moltissimi file binari di grandi dimensioni (immagini, audio, modelli 3D). Affinché Git li gestisca in modo ottimale, è indispensabile utilizzare `Git LFS`.

1. Apri il Terminale (Git Bash) nella cartella del tuo progetto Unity (es.: `D:\Unity-Projects\GLW`).
2. Scarica il template `.gitattributes` standard di GameCI per Unity.
3. Esegui il comando per abilitare LFS:

   ```bash
   git lfs install
   ```

4. Aggiungi il file di configurazione alla cronologia di Git:

   ```bash
   git add .gitattributes
   git commit -m "Aggiunta configurazione gitattributes per Unity e Git LFS"
   ```

### Passo 2: Creare il Bare Repo sul disco esterno

1. Collega il disco esterno al computer (supponiamo che il sistema lo riconosca come unità `E:`).
2. Apri **Git Bash** e spostati nella cartella in cui desideri salvare il backup (es.: `E:\Git`):

   ```bash
   cd /e/Git
   ```

3. Crea la cartella del repository (seguendo la convenzione del suffisso `.git`).

   > [!IMPORTANT]
   > **Nota estremamente importante:** in Git Bash è necessario usare la barra obliqua `/`, non la barra rovesciata `\` di Windows.

   ```bash
   mkdir -p "GLW.git"
   ```

4. Entra nella cartella appena creata e inizializza il Bare Repo:

   ```bash
   cd "GLW.git"
   git init --bare
   ```

### Passo 3: Collegare il progetto Unity al disco esterno (Aggiungere il Remote)

1. Torna al Terminale (Git Bash) nella cartella del progetto Unity (`D:\Unity-Projects\GLW`).
2. Collega il repository remoto (assegnando al remote il nome `glw` o `usb`):

   ```bash
   git remote add glw "E:/Git/GLW.git"
   ```

3. Verifica che il remote sia stato registrato correttamente:

   ```bash
   git remote -v
   ```
   *(Se l'output stampa due righe per `fetch` e `push` che puntano a `E:/Git/GLW.git`, l'operazione è riuscita.)*

### Passo 4: Risolvere l'errore di sicurezza sui permessi (Dubious Ownership)

Quando si esegue il push del codice su un disco formattato in exFAT/FAT32, Git segnala l'errore `"dubious ownership"` perché questi file system non memorizzano i permessi utente come NTFS, portando Git a ritenere che il repository sia privo di proprietario e a bloccarlo per motivi di sicurezza.

**Soluzione:** aggiungere esplicitamente la cartella all'elenco dei percorsi sicuri di Git:

```bash
git config --global --add safe.directory "E:/Git/GLW.git"
```

### Passo 5: Eseguire il push del codice sul disco esterno

Quando tutto è configurato, esegui i comandi per effettuare il push di tutti i branch e dei tag, così da eseguire il backup completo al 100% del progetto:

```bash
git push glw --all
git push glw --tags
```
*(Attendi il completamento dell'operazione: il tuo progetto sarà così salvato in sicurezza sul disco esterno.)*

---

## 3. Errori comuni (Risoluzione dei problemi)

### 3.1. Errore nella creazione del nome della cartella (nomi concatenati)

- **Sintomo:** eseguendo `mkdir -p E:\Git\GLW.git` in Git Bash, la cartella creata si chiama `GitGLW.git`.
- **Causa:** Git Bash interpreta il carattere `\` come carattere di escape. Ignora quindi `\` e unisce `Git` con `GLW` formando `GitGLW`.
- **Soluzione:** usa sempre la barra obliqua `/` o le virgolette quando lavori con i percorsi in Git Bash (es.: `mkdir -p "E:/Git/GLW.git"`).

### 3.2. Errore `"fatal: 'E:BackupGitGLW.git' does not appear to be a git repository"`

- **Sintomo:** viene segnalato l'errore di repository remoto non trovato durante il push.
- **Causa:** durante l'esecuzione di `git remote add`, hai usato la barra rovesciata (`\`), alterando il percorso.
- **Soluzione:**
  1. Rimuovi la configurazione errata del remote:
     ```bash
     git remote remove glw
     ```
  2. Aggiungi nuovamente il remote con la sintassi corretta:
     ```bash
     git remote add glw "E:/Git/GLW.git"
     ```
     *(Puoi anche usare `git remote set-url glw "E:/Git/GLW.git"` per sovrascriverlo.)*

### 3.3. Aver dimenticato di inizializzare il Bare Repo

- **Sintomo:** anche con il percorso del remote corretto, il push restituisce ancora `Could not read from remote repository`.
- **Causa:** il comando `git init --bare` non è stato eseguito all'interno della cartella sul disco esterno.
- **Soluzione:** usa Esplora file per raggiungere la cartella sul disco esterno, fai clic con il tasto destro, seleziona **Open Git Bash here** ed esegui il comando `git init --bare`.
