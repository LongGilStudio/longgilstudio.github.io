---
title: "使用 Git Bare Repository 将 Unity 项目备份至移动硬盘指南"
date: 2026-08-22 10:00:00 +0700
categories: [Game Development, Unity]
tags: [git, backup, unity, bare-repository, usb]
description: 分步指南：在移动硬盘（USB）上配置带 Git LFS 的 Git Bare Repository，以安全备份 Unity 项目并解决常见错误。
lang: zh-CN
translation_id: unity-git-bare-repository-usb-backup
---

本文档汇总了在移动硬盘（USB）上搭建 **Bare Git Repository**（裸仓库）以安全备份 Unity 项目的完整流程、精确命令以及常见错误排查方法。

## 1. Bare Repository 简介

- **Bare Repository**（裸仓库）是没有工作目录（working directory）的 Git 仓库，也就是说里面没有可以直接查看或修改的源代码文件，它仅包含隐藏 `.git` 目录中的内容。
- 它的主要作用是**接收来自其他电脑推送（push）的代码**，就像在你移动硬盘上运行的本地 GitHub/GitLab 服务器一样。

## 2. 标准配置流程（分步操作）

### 第 1 步：为 Unity 项目启用 Git LFS（本地）

Unity 项目包含大量大型二进制文件（图片、音频、3D 模型）。为了使 Git 高效处理这些文件，必须启用 `Git LFS`。

1. 在你的 Unity 项目目录中打开终端（Git Bash），例如 `D:\Unity-Projects\GLW`。
2. 下载适用于 Unity 的标准 GameCI `.gitattributes` 模板。
3. 运行以下命令启用 LFS：

   ```bash
   git lfs install
   ```

4. 将配置文件提交到 Git 历史记录中：

   ```bash
   git add .gitattributes
   git commit -m "为 Unity 和 Git LFS 添加 gitattributes 配置"
   ```

### 第 2 步：在移动硬盘上创建 Bare Repo

1. 将移动硬盘插入电脑（假设系统识别为 `E:` 盘）。
2. 打开 **Git Bash**，切换到希望存放备份的目录（例如 `E:\Git`）：

   ```bash
   cd /e/Git
   ```

3. 创建用于存放仓库的文件夹（按惯例以 `.git` 结尾）。

   > [!IMPORTANT]
   > **极其重要的注意事项：** 在 Git Bash 中必须使用正斜杠 `/`，切勿使用 Windows 的反斜杠 `\`。

   ```bash
   mkdir -p "GLW.git"
   ```

4. 进入刚创建的目录并初始化 Bare Repo：

   ```bash
   cd "GLW.git"
   git init --bare
   ```

### 第 3 步：将 Unity 项目关联至移动硬盘（添加 Remote）

1. 回到 Unity 项目目录（`D:\Unity-Projects\GLW`）下的终端（Git Bash）。
2. 添加远程仓库关联（将 remote 命名为 `glw` 或 `usb`）：

   ```bash
   git remote add glw "E:/Git/GLW.git"
   ```

3. 检查 remote 是否配置成功：

   ```bash
   git remote -v
   ```
   *（输出结果中若显示指向 `E:/Git/GLW.git` 的 fetch 和 push 两行，即表示成功。）*

### 第 4 步：解决权限安全报错（Dubious Ownership）

向 exFAT/FAT32 格式的移动硬盘推送代码时，Git 会报 `"dubious ownership"` 错误。这是因为这类文件系统不像 NTFS 那样保存用户权限信息，导致 Git 认为该仓库归属不明并出于安全原因将其拦截。

**解决方法：** 将该目录加入 Git 安全目录信任列表：

```bash
git config --global --add safe.directory "E:/Git/GLW.git"
```

### 第 5 步：将代码推送至移动硬盘

全部配置完成后，运行以下命令推送所有分支（branches）和标签（tags），以完成项目的 100% 完整备份：

```bash
git push glw --all
git push glw --tags
```
*（等待传输完成，你的 Unity 项目就已经安全备份到移动硬盘中了。）*

---

## 3. 常见错误排查（Troubleshooting）

### 3.1. 创建了错误的文件夹名称（名称粘连在一起）

- **症状：** 在 Git Bash 中运行 `mkdir -p E:\Git\GLW.git` 时，生成的文件夹名称变成了 `GitGLW.git`。
- **原因：** Git Bash 将 `\` 视为转义（escape）字符，它会忽略 `\` 并把 `Git` 和 `GLW` 拼接成 `GitGLW`。
- **解决方法：** 在 Git Bash 中操作路径时，始终使用正斜杠 `/` 或加上双引号（例如 `mkdir -p "E:/Git/GLW.git"`）。

### 3.2. 报错 `"fatal: 'E:BackupGitGLW.git' does not appear to be a git repository"`

- **症状：** 推送时提示找不到远程仓库（remote repo）。
- **原因：** 运行 `git remote add` 时使用了反斜杠（`\`），导致路径解析出错。
- **解决方法：**
  1. 删除错误的 remote 配置：
     ```bash
     git remote remove glw
     ```
  2. 使用正确格式重新添加 remote：
     ```bash
     git remote add glw "E:/Git/GLW.git"
     ```
     *（也可以使用 `git remote set-url glw "E:/Git/GLW.git"` 直接覆盖。）*

### 3.3. 忘记初始化 Bare Repo 导致的错误

- **症状：** 即使 Remote 路径已经正确，推送时依然报错 `Could not read from remote repository`。
- **原因：** 未在移动硬盘的目标文件夹内运行 `git init --bare` 命令。
- **解决方法：** 通过文件资源管理器（File Explorer）打开移动硬盘中的该文件夹，右键选择 **Open Git Bash here**，然后运行 `git init --bare`。
