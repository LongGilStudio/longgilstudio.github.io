---
title: "使用 Git Bare Repository 將 Unity 專案備份至外接硬碟指南"
date: 2026-08-22 10:00:00 +0700
categories: [Game Development, Unity]
tags: [git, backup, unity, bare-repository, usb]
description: "分步指南：在外接硬碟（USB）上設定搭配 Git LFS 的 Git Bare Repository，以安全備份 Unity 專案並排除常見錯誤。"
lang: zh-TW
translation_id: unity-git-bare-repository-usb-backup
---

本文件彙整了在外接硬碟（USB）上建立 **Bare Git Repository**（裸儲存庫）以安全備份 Unity 專案的完整流程、精確指令與常見錯誤排除方式。

## 1. Bare Repository 簡介

- **Bare Repository**（裸儲存庫）是沒有工作目錄（working directory）的 Git 儲存庫，也就是說裡面沒有可直接檢視或修改的程式碼檔案，僅包含隱藏 `.git` 資料夾中的內容。
- 其主要用途是**接收來自其他電腦推送（push）的程式碼**，運作方式如同架設在你外接硬碟上的本機 GitHub/GitLab 伺服器。

## 2. 標準設定流程（逐步教學）

### 步驟 1：為 Unity 專案啟用 Git LFS（本機）

Unity 專案包含大量大型二進位檔案（圖片、音訊、3D 模型）。為了讓 Git 有效率地處理這些檔案，必須使用 `Git LFS`。

1. 在你的 Unity 專案資料夾中開啟終端機（Git Bash），例如 `D:\Unity-Projects\GLW`。
2. 下載適用於 Unity 的標準 GameCI `.gitattributes` 範本。
3. 執行啟用 LFS 的指令：

   ```bash
   git lfs install
   ```

4. 將設定檔納入 Git 歷史紀錄：

   ```bash
   git add .gitattributes
   git commit -m "新增適用於 Unity 與 Git LFS 的 gitattributes 設定"
   ```

### 步驟 2：在外接硬碟上建立 Bare Repo

1. 將外接硬碟插入電腦（假設系統偵測為 `E:` 磁碟機）。
2. 開啟 **Git Bash**，切換至欲存放備份的資料夾（例如 `E:\Git`）：

   ```bash
   cd /e/Git
   ```

3. 建立用來存放儲存庫的資料夾（依慣例以 `.git` 結尾）。

   > [!IMPORTANT]
   > **極為重要的注意事項：** 在 Git Bash 中必須使用正斜線 `/`，切勿使用 Windows 的反斜線 `\`。

   ```bash
   mkdir -p "GLW.git"
   ```

4. 進入剛建立的資料夾並初始化 Bare Repo：

   ```bash
   cd "GLW.git"
   git init --bare
   ```

### 步驟 3：將 Unity 專案連結至外接硬碟（新增 Remote）

1. 回到 Unity 專案資料夾（`D:\Unity-Projects\GLW`）的終端機（Git Bash）。
2. 新增遠端連線（將 remote 命名為 `glw` 或 `usb`）：

   ```bash
   git remote add glw "E:/Git/GLW.git"
   ```

3. 檢查 remote 是否已正確綁定：

   ```bash
   git remote -v
   ```
   *（若輸出結果印出指向 `E:/Git/GLW.git` 的 fetch 與 push 兩行，即表示成功。）*

### 步驟 4：排除權限安全性錯誤（Dubious Ownership）

當把程式碼推送至 exFAT/FAT32 格式的外接硬碟時，Git 會回報 `"dubious ownership"` 錯誤。這是因為這類檔案系統不像 NTFS 那樣儲存使用者權限，導致 Git 認為該儲存庫所有權不明並基於安全性考量加以阻擋。

**解決方法：** 將該資料夾加入安全目錄清單予以信任：

```bash
git config --global --add safe.directory "E:/Git/GLW.git"
```

### 步驟 5：將程式碼推送至外接硬碟

所有項目都設定完成後，輸入指令推送所有分支（branches）與標籤（tags），以完整 100% 備份專案：

```bash
git push glw --all
git push glw --tags
```
*（等待傳輸過程結束，你的 Unity 專案便已安全備份至外接硬碟中。）*

---

## 3. 常見錯誤排除（Troubleshooting）

### 3.1. 建立出錯誤的資料夾名稱（名稱黏在一起）

- **症狀：** 在 Git Bash 中執行 `mkdir -p E:\Git\GLW.git` 時，產生的資料夾名稱卻變成 `GitGLW.git`。
- **原因：** Git Bash 會將 `\` 視為跳脫（escape）字元，它會忽略 `\` 並將 `Git` 與 `GLW` 串接成 `GitGLW`。
- **解決方法：** 在 Git Bash 中操作路徑時，務必使用正斜線 `/` 或加上雙引號（例如 `mkdir -p "E:/Git/GLW.git"`）。

### 3.2. 錯誤 `"fatal: 'E:BackupGitGLW.git' does not appear to be a git repository"`

- **症狀：** 推送時顯示找不到遠端儲存庫（remote repo）的錯誤。
- **原因：** 執行 `git remote add` 時使用了反斜線（`\`），導致路徑錯亂。
- **解決方法：**
  1. 移除錯誤的 remote 設定：
     ```bash
     git remote remove glw
     ```
  2. 使用正確格式重新新增 remote：
     ```bash
     git remote add glw "E:/Git/GLW.git"
     ```
     *（亦可使用 `git remote set-url glw "E:/Git/GLW.git"` 來覆寫。）*

### 3.3. 忘記初始化 Bare Repo 的錯誤

- **症狀：** 即使 Remote 路徑已經正確，推送時仍回報 `Could not read from remote repository`。
- **原因：** 尚未在外接硬碟的資料夾內執行 `git init --bare` 指令。
- **解決方法：** 使用檔案總管（File Explorer）前往外接硬碟中的該資料夾，點擊滑鼠右鍵選擇 **Open Git Bash here**，接著執行 `git init --bare`。
