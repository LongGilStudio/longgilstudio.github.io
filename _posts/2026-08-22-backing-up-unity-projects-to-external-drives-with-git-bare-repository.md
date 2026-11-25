---
title: "Backing Up Unity Projects to External Drives Using a Git Bare Repository"
date: 2026-08-22 10:00:00 +0700
categories: [Game Development, Unity]
tags: [git, backup, unity, bare-repository, usb]
description: Step-by-step guide to configuring a Git Bare Repository with Git LFS on an external USB drive to safely back up Unity projects and resolve common Windows/Git Bash errors.
lang: en
translation_id: unity-git-bare-repository-usb-backup
---

This guide compiles the complete workflow, exact commands, and common troubleshooting steps for setting up a **Bare Git Repository** on an external hard drive (USB) as a reliable backup destination for a Unity project.

## 1. Introduction to Bare Repositories

- A **Bare Repository** is a Git repository without a working directory—meaning there are no directly editable source files inside it. It stores only the contents of the hidden `.git` folder.
- Its primary purpose is to **receive pushed commits** from other machines, functioning much like a local GitHub or GitLab server on your external drive.

## 2. Step-by-Step Setup Workflow

### Step 1: Enable Git LFS for the Unity Project (Local)

Unity projects contain many large binary files (textures, audio, 3D models). To ensure Git handles them efficiently, `Git LFS` is mandatory.

1. Open Terminal (Git Bash) inside your Unity project root directory (e.g., `D:\Unity-Projects\GLW`).
2. Download the standard GameCI `.gitattributes` template for Unity.
3. Run the command to initialize LFS:

   ```bash
   git lfs install
   ```

4. Commit the configuration file to your Git history:

   ```bash
   git add .gitattributes
   git commit -m "Add gitattributes configuration for Unity and Git LFS"
   ```

### Step 2: Create the Bare Repo on the External Drive

1. Plug your external drive into the computer (assuming Windows assigns it drive letter `E:`).
2. Open **Git Bash** and navigate to the folder where you want to store the backup (e.g., `E:\Git`):

   ```bash
   cd /e/Git
   ```

3. Create the repository folder (following the `.git` suffix convention).

   > [!IMPORTANT]
   > **Critical Note:** In Git Bash, you must use forward slashes `/`, never Windows backslashes `\`.

   ```bash
   mkdir -p "GLW.git"
   ```

4. Navigate into the newly created folder and initialize the Bare Repo:

   ```bash
   cd "GLW.git"
   git init --bare
   ```

### Step 3: Link the Unity Project to the External Drive (Add Remote)

1. Return to Terminal (Git Bash) in your Unity project directory (`D:\Unity-Projects\GLW`).
2. Add the remote (named `glw` or `usb`):

   ```bash
   git remote add glw "E:/Git/GLW.git"
   ```

3. Verify that the remote was registered properly:

   ```bash
   git remote -v
   ```
   *(If the output prints both fetch and push lines pointing to `E:/Git/GLW.git`, the setup succeeded.)*

### Step 4: Resolve Permission Security Errors (Dubious Ownership)

When pushing code to an external drive formatted as exFAT or FAT32, Git may throw a `"dubious ownership"` error because those filesystems do not store NTFS user ownership metadata, causing Git to treat the repository as untrusted for security reasons.

**Solution:** Explicitly add the directory to Git's safe directory list:

```bash
git config --global --add safe.directory "E:/Git/GLW.git"
```

### Step 5: Push Code to the External Drive

Once everything is configured, run the following commands to push all branches and tags for a complete 100% project backup:

```bash
git push glw --all
git push glw --tags
```
*(Wait for the transfer to complete and your Unity project will be safely backed up on the external drive.)*

---

## 3. Common Errors & Troubleshooting

### 3.1. Wrong Folder Name Created (Concatenated Path)

- **Symptom:** Running `mkdir -p E:\Git\GLW.git` in Git Bash creates a folder named `GitGLW.git`.
- **Cause:** Git Bash treats `\` as an escape character, stripping the backslashes and concatenating `Git` and `GLW` into `GitGLW`.
- **Fix:** Always use forward slashes `/` or quotes when specifying paths in Git Bash (e.g., `mkdir -p "E:/Git/GLW.git"`).

### 3.2. Error `"fatal: 'E:BackupGitGLW.git' does not appear to be a git repository"`

- **Symptom:** Git reports that the remote repository cannot be found when pushing.
- **Cause:** Backslashes (`\`) were used when running `git remote add`, corrupting the stored path.
- **Fix:**
  1. Remove the malformed remote configuration:
     ```bash
     git remote remove glw
     ```
  2. Re-add the remote with forward slashes:
     ```bash
     git remote add glw "E:/Git/GLW.git"
     ```
     *(Alternatively, use `git remote set-url glw "E:/Git/GLW.git"` to overwrite it.)*

### 3.3. Forgot to Initialize the Bare Repo

- **Symptom:** Even when the remote path is correct, pushing still fails with `Could not read from remote repository`.
- **Cause:** `git init --bare` was never executed inside the folder on the external drive.
- **Fix:** Open File Explorer, navigate to the folder on the external drive, right-click and select **Open Git Bash here**, then run `git init --bare`.
