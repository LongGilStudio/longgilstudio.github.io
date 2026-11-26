---
title: "Guide de sauvegarde d'un projet Unity sur disque dur externe avec un dépôt Git bare"
date: 2026-08-22 10:00:00 +0700
categories: [Game Development, Unity]
tags: [git, backup, unity, bare-repository, usb]
description: Guide étape par étape pour configurer un dépôt Git bare avec Git LFS sur un disque dur externe (USB) afin de sauvegarder en toute sécurité un projet Unity et de résoudre les erreurs courantes.
lang: fr
translation_id: unity-git-bare-repository-usb-backup
---

Ce document rassemble l'ensemble de la procédure, les commandes exactes et les erreurs courantes lors de la configuration d'un **dépôt Git bare** (Bare Git Repository) sur un disque dur externe (USB) pour disposer d'une destination de sauvegarde fiable pour un projet Unity.

## 1. Présentation du dépôt Bare

- Un **Bare Repository** (dépôt nu) est un dépôt Git sans répertoire de travail (working directory), c'est-à-dire qu'il ne contient pas directement de fichiers source à consulter ou à modifier. Il renferme uniquement le contenu du dossier caché `.git`.
- Son rôle principal est de **recevoir les push de code** depuis d'autres ordinateurs, en fonctionnant comme un serveur GitHub ou GitLab local sur votre disque dur.

## 2. Procédure de configuration exacte (étape par étape)

### Étape 1 : Activer Git LFS pour le projet Unity (local)

Un projet Unity contient de nombreux fichiers binaires volumineux (images, audio, modèles 3D). Pour que Git les gère de manière optimale, `Git LFS` est indispensable.

1. Ouvrez le Terminal (Git Bash) dans le dossier de votre projet Unity (ex. : `D:\Unity-Projects\GLW`).
2. Téléchargez le modèle `.gitattributes` standard de GameCI pour Unity.
3. Exécutez la commande pour activer LFS :

   ```bash
   git lfs install
   ```

4. Ajoutez le fichier de configuration à l'historique Git :

   ```bash
   git add .gitattributes
   git commit -m "Ajouter la configuration gitattributes pour Unity et Git LFS"
   ```

### Étape 2 : Créer le dépôt Bare sur le disque dur externe

1. Branchez le disque dur externe sur l'ordinateur (supposons que le système lui attribue la lettre `E:`).
2. Ouvrez **Git Bash** et accédez au dossier où vous souhaitez placer la sauvegarde (ex. : `E:\Git`) :

   ```bash
   cd /e/Git
   ```

3. Créez le dossier du dépôt (convention du suffixe `.git`).

   > [!IMPORTANT]
   > **Remarque très importante :** dans Git Bash, vous devez utiliser des barres obliques `/` (forward slashes) et non les barres obliques inverses `\` de Windows.

   ```bash
   mkdir -p "GLW.git"
   ```

4. Entrez dans le dossier nouvellement créé et initialisez le dépôt Bare :

   ```bash
   cd "GLW.git"
   git init --bare
   ```

### Étape 3 : Relier le projet Unity au disque dur (ajouter un remote)

1. Retournez dans le Terminal (Git Bash) au niveau du dossier du projet Unity (`D:\Unity-Projects\GLW`).
2. Ajoutez le dépôt distant (en nommant le remote `glw` ou `usb`) :

   ```bash
   git remote add glw "E:/Git/GLW.git"
   ```

3. Vérifiez que le remote a bien été pris en compte :

   ```bash
   git remote -v
   ```
   *(Si le résultat affiche deux lignes `fetch` et `push` pointant vers `E:/Git/GLW.git`, l'opération a réussi.)*

### Étape 4 : Résoudre l'erreur de sécurité des permissions (Dubious Ownership)

Lors d'un push vers un disque dur formaté en exFAT/FAT32, Git affiche l'erreur `"dubious ownership"`, car ces systèmes de fichiers ne stockent pas les permissions utilisateur comme NTFS, ce qui amène Git à considérer le dépôt comme sans propriétaire et à le bloquer pour des raisons de sécurité.

**Solution :** ajouter explicitement ce dossier à la liste des répertoires de confiance de Git :

```bash
git config --global --add safe.directory "E:/Git/GLW.git"
```

### Étape 5 : Pousser le code vers le disque dur

Une fois tout configuré, exécutez les commandes suivantes pour pousser toutes les branches et tous les tags afin de sauvegarder 100 % du projet :

```bash
git push glw --all
git push glw --tags
```
*(Attendez la fin de l'opération : votre projet est désormais sauvegardé en toute sécurité sur le disque dur.)*

---

## 3. Erreurs courantes (Dépannage)

### 3.1. Erreur de création du nom de dossier (noms concaténés)

- **Symptôme :** en exécutant `mkdir -p E:\Git\GLW.git` dans Git Bash, le dossier créé s'appelle `GitGLW.git`.
- **Cause :** Git Bash interprète le caractère `\` comme un caractère d'échappement (escape). Il ignore le `\` et colle `Git` et `GLW` pour former `GitGLW`.
- **Solution :** utilisez toujours des barres obliques `/` ou des guillemets lorsque vous manipulez des chemins dans Git Bash (ex. : `mkdir -p "E:/Git/GLW.git"`).

### 3.2. Erreur `"fatal: 'E:BackupGitGLW.git' does not appear to be a git repository"`

- **Symptôme :** Git indique que le dépôt distant est introuvable lors du push.
- **Cause :** lors de l'exécution de `git remote add`, vous avez utilisé des barres obliques inverses (`\`), ce qui a corrompu le chemin.
- **Solution :**
  1. Supprimez la configuration du remote erronée :
     ```bash
     git remote remove glw
     ```
  2. Ajoutez de nouveau le remote avec la bonne syntaxe :
     ```bash
     git remote add glw "E:/Git/GLW.git"
     ```
     *(Vous pouvez aussi utiliser `git remote set-url glw "E:/Git/GLW.git"` pour l'écraser.)*

### 3.3. Oubli d'initialiser le dépôt Bare

- **Symptôme :** même si le chemin du remote est correct, le push échoue avec `Could not read from remote repository`.
- **Cause :** la commande `git init --bare` n'a pas encore été exécutée à l'intérieur du dossier sur le disque dur.
- **Solution :** ouvrez l'Explorateur de fichiers jusqu'au dossier sur le disque dur, faites un clic droit, sélectionnez **Open Git Bash here** et exécutez la commande `git init --bare`.
