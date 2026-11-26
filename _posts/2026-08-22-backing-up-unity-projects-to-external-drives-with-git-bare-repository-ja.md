---
title: "Git Bare Repositoryを使ってUnityプロジェクトを外付けドライブにバックアップする方法"
date: 2026-08-22 10:00:00 +0700
categories: [Game Development, Unity]
tags: [git, backup, unity, bare-repository, usb]
description: 外付けドライブ（USB）上にGit LFSを伴うGit Bare Repositoryを構築し、Unityプロジェクトを安全にバックアップしてよくあるエラーを解決するためのステップバイステップガイド。
lang: ja
translation_id: unity-git-bare-repository-usb-backup
---

本ドキュメントでは、Unityプロジェクトの安全なバックアップ先として外付けハードドライブ（USB）上に **Bare Git Repository** を構築するための全手順、正確なコマンド、およびよくあるエラーと対処法をまとめています。

## 1. Bare Repositoryとは

- **Bare Repository** とは、作業ディレクトリ（working directory）を持たないGitリポジトリであり、直接閲覧・編集できるソースコードは置かれず、隠しフォルダ `.git` の中身だけを保持します。
- 主な目的は、他のPCから **pushされたコードを受け取ること** であり、外付けドライブ上でローカルのGitHub/GitLabサーバーのように機能します。

## 2. 正確なセットアップ手順（ステップバイステップ）

### ステップ1：UnityプロジェクトでGit LFSを有効化する（ローカル）

Unityプロジェクトには大容量のバイナリファイル（画像、音声、3Dモデル）が大量に含まれます。Gitでこれらを最適に扱うため、`Git LFS` の導入が必須です。

1. Unityプロジェクトのフォルダ（例：`D:\Unity-Projects\GLW`）でターミナル（Git Bash）を開きます。
2. GameCIのUnity向け標準 `.gitattributes` テンプレートをダウンロードします。
3. LFSを有効化するコマンドを実行します：

   ```bash
   git lfs install
   ```

4. 設定ファイルをGitの履歴にコミットします：

   ```bash
   git add .gitattributes
   git commit -m "UnityおよびGit LFS用のgitattributes設定を追加"
   ```

### ステップ2：外付けドライブにBare Repoを作成する

1. 外付けドライブをPCに接続します（ドライブ文字が `E:` として認識されたと仮定します）。
2. **Git Bash** を開き、バックアップを配置したいフォルダへ移動します（例：`E:\Git`）：

   ```bash
   cd /e/Git
   ```

3. リポジトリを格納するフォルダを作成します（慣例として末尾に `.git` を付けます）。

   > [!IMPORTANT]
   > **極めて重要な注意点：** Git Bashでは必ずスラッシュ `/` を使用し、Windowsのバックスラッシュ `\` は使用しないでください。

   ```bash
   mkdir -p "GLW.git"
   ```

4. 作成したフォルダへ移動し、Bare Repoを初期化します：

   ```bash
   cd "GLW.git"
   git init --bare
   ```

### ステップ3：Unityプロジェクトと外付けドライブを紐付ける（Remoteの追加）

1. Unityプロジェクトのフォルダ（`D:\Unity-Projects\GLW`）で開いているターミナル（Git Bash）に戻ります。
2. リモート（remote）を登録します（名前は `glw` や `usb` などに設定）：

   ```bash
   git remote add glw "E:/Git/GLW.git"
   ```

3. remoteが正しく認識されているか確認します：

   ```bash
   git remote -v
   ```
   *（`E:/Git/GLW.git` を指す `fetch` と `push` の2行が表示されれば成功です）。*

### ステップ4：権限のセキュリティエラーを解消する（Dubious Ownership）

exFATやFAT32でフォーマットされた外付けドライブへコードをpushすると、これらのファイルシステムはNTFSのようなユーザー所有権情報を保持しないため、Gitが所有者不明のリポジトリと判断し、セキュリティ上の理由でブロックして `"dubious ownership"` エラーを出します。

**対処法：** 対象フォルダを安全リスト（`safe.directory`）に登録して信頼させます：

```bash
git config --global --add safe.directory "E:/Git/GLW.git"
```

### ステップ5：外付けドライブへコードをPushする

すべての準備が整ったら、プロジェクトを100%完全にバックアップするため、すべてのブランチ（branches）とタグ（tags）をpushするコマンドを実行します：

```bash
git push glw --all
git push glw --tags
```
*（処理の完了を待てば、プロジェクトは外付けドライブに安全にバックアップされます）。*

---

## 3. よくあるエラー（トラブルシューティング）

### 3.1. フォルダ名が誤って作成されるエラー（名前が連結される）

- **症状：** Git Bashで `mkdir -p E:\Git\GLW.git` を実行すると、作成されたフォルダ名が `GitGLW.git` になってしまう。
- **原因：** Git Bashは `\` をエスケープ文字として扱うため、`\` が無視されて `Git` と `GLW` が連結し、`GitGLW` となってしまいます。
- **対処法：** Git Bashでパスを扱う際は、必ずスラッシュ `/` またはダブルクォーテーションを使用してください（例：`mkdir -p "E:/Git/GLW.git"`）。

### 3.2. `"fatal: 'E:BackupGitGLW.git' does not appear to be a git repository"` エラー

- **症状：** push時にリモートリポジトリが見つからないというエラーが表示される。
- **原因：** `git remote add` を実行した際にバックスラッシュ（`\`）を使用したため、パスが壊れてしまいました。
- **対処法：**
  1. 誤ったremote設定を削除します：
     ```bash
     git remote remove glw
     ```
  2. 正しい形式でremoteを再追加します：
     ```bash
     git remote add glw "E:/Git/GLW.git"
     ```
     *（`git remote set-url glw "E:/Git/GLW.git"` を使って上書きすることも可能です）。*

### 3.3. Bare Repoの初期化忘れによるエラー

- **症状：** Remoteのパスが正しいにもかかわらず、push時に `Could not read from remote repository` が表示される。
- **原因：** 外付けドライブ側のフォルダ内で `git init --bare` を実行していません。
- **対処法：** エクスプローラー（File Explorer）で外付けドライブ上の該当フォルダを開き、右クリックして **Open Git Bash here** を選択したうえで、`git init --bare` を実行します。
