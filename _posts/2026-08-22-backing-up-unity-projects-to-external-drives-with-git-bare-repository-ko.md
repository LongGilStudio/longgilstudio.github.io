---
title: "Git Bare Repository를 사용하여 Unity 프로젝트를 외장 드라이브에 백업하는 가이드"
date: 2026-08-22 10:00:00 +0700
categories: [Game Development, Unity]
tags: [git, backup, unity, bare-repository, usb]
description: 외장 하드 드라이브(USB)에 Git LFS를 포함한 Git Bare Repository를 설정하여 Unity 프로젝트를 안전하게 백업하고 자주 발생하는 오류를 해결하는 단계별 가이드.
lang: ko
translation_id: unity-git-bare-repository-usb-backup
---

이 문서는 Unity 프로젝트를 안전하게 백업할 수 있는 저장소로 외장 하드 드라이브(USB)에 **Bare Git Repository**를 설정하는 전체 절차, 정확한 명령어, 그리고 자주 발생하는 오류와 해결 방법을 정리한 가이드입니다.

## 1. Bare Repository 소개

- **Bare Repository**는 작업 디렉터리(working directory)가 없는 Git 저장소로, 직접 열람하거나 수정할 수 있는 소스 코드 파일이 들어 있지 않고 숨겨진 `.git` 폴더의 내용만 포함합니다.
- 주요 목적은 다른 컴퓨터에서 **push한 코드를 수신하는 것**이며, 외장 드라이브 위에서 로컬 GitHub/GitLab 서버와 유사하게 동작합니다.

## 2. 정확한 설정 절차 (단계별 가이드)

### 1단계: Unity 프로젝트에 Git LFS 활성화 (로컬)

Unity 프로젝트에는 용량이 큰 바이너리 파일(이미지, 오디오, 3D 모델)이 매우 많이 포함됩니다. Git이 이러한 파일을 최적화하여 처리하려면 `Git LFS`가 반드시 필요합니다.

1. Unity 프로젝트 폴더(예: `D:\Unity-Projects\GLW`)에서 터미널(Git Bash)을 엽니다.
2. Unity용 표준 GameCI `.gitattributes` 템플릿을 다운로드합니다.
3. LFS 활성화 명령어를 실행합니다:

   ```bash
   git lfs install
   ```

4. 설정 파일을 Git 기록에 커밋합니다:

   ```bash
   git add .gitattributes
   git commit -m "Unity 및 Git LFS용 gitattributes 설정 추가"
   ```

### 2단계: 외장 드라이브에 Bare Repo 생성

1. 외장 드라이브를 컴퓨터에 연결합니다(드라이브 문자가 `E:`로 인식되었다고 가정).
2. **Git Bash**를 열고 백업을 저장할 폴더로 이동합니다(예: `E:\Git`):

   ```bash
   cd /e/Git
   ```

3. 저장소를 담을 폴더를 생성합니다(관례상 `.git` 확장자 사용).

   > [!IMPORTANT]
   > **매우 중요한 주의사항:** Git Bash에서는 반드시 슬래시(`/`)를 사용해야 하며, Windows의 백슬래시(`\`)를 사용하면 안 됩니다.

   ```bash
   mkdir -p "GLW.git"
   ```

4. 방금 만든 폴더로 이동하여 Bare Repo를 초기화합니다:

   ```bash
   cd "GLW.git"
   git init --bare
   ```

### 3단계: Unity 프로젝트를 외장 드라이브와 연결 (Remote 추가)

1. Unity 프로젝트 폴더(`D:\Unity-Projects\GLW`)의 터미널(Git Bash)로 돌아옵니다.
2. 원격 저장소(remote)를 연결합니다(이름은 `glw` 또는 `usb` 등으로 지정):

   ```bash
   git remote add glw "E:/Git/GLW.git"
   ```

3. remote가 올바르게 등록되었는지 확인합니다:

   ```bash
   git remote -v
   ```
   *(출력 결과에 `E:/Git/GLW.git`을 가리키는 `fetch`와 `push` 두 줄이 표시되면 성공입니다).*

### 4단계: 권한 보안 오류 해결 (Dubious Ownership)

exFAT 또는 FAT32로 포맷된 외장 드라이브에 코드를 push할 때, 해당 파일 시스템은 NTFS처럼 사용자 권한(ownership) 정보를 저장하지 않기 때문에 Git이 소유자가 불분명한 저장소로 판단하여 보안상의 이유로 차단하고 `"dubious ownership"` 오류를 발생시킵니다.

**해결 방법:** 해당 디렉터리를 안전 목록(`safe.directory`)에 명시적으로 추가하여 신뢰하도록 설정합니다:

```bash
git config --global --add safe.directory "E:/Git/GLW.git"
```

### 5단계: 외장 드라이브로 코드 Push

모든 설정이 완료되면 프로젝트의 100% 전체를 백업하기 위해 모든 브랜치(branches)와 태그(tags)를 push하는 명령어를 실행합니다:

```bash
git push glw --all
git push glw --tags
```
*(전송 과정이 완료될 때까지 기다리면 프로젝트가 외장 드라이브에 안전하게 백업됩니다).*

---

## 3. 자주 발생하는 오류 (문제 해결)

### 3.1. 잘못된 폴더 이름 생성 오류 (폴더명이 붙어서 생성됨)

- **증상:** Git Bash에서 `mkdir -p E:\Git\GLW.git` 명령어를 실행했을 때 생성된 폴더 이름이 `GitGLW.git`이 됩니다.
- **원인:** Git Bash는 `\` 문자를 이스케이프(escape) 문자로 취급합니다. 따라서 `\`를 무시하고 `Git`과 `GLW`를 이어 붙여 `GitGLW`로 만들어 버립니다.
- **해결 방법:** Git Bash에서 경로를 다룰 때는 항상 슬래시(`/`) 또는 큰따옴표를 사용하세요(예: `mkdir -p "E:/Git/GLW.git"`).

### 3.2. `"fatal: 'E:BackupGitGLW.git' does not appear to be a git repository"` 오류

- **증상:** push할 때 원격(remote) 저장소를 찾을 수 없다는 오류가 발생합니다.
- **원인:** `git remote add` 명령어를 실행할 때 백슬래시(`\`)를 사용하여 경로가 손상되었습니다.
- **해결 방법:**
  1. 잘못된 remote 설정을 삭제합니다:
     ```bash
     git remote remove glw
     ```
  2. 올바른 경로로 remote를 다시 추가합니다:
     ```bash
     git remote add glw "E:/Git/GLW.git"
     ```
     *(또는 `git remote set-url glw "E:/Git/GLW.git"` 명령어로 덮어쓸 수도 있습니다).*

### 3.3. Bare Repo 초기화를 잊은 오류

- **증상:** Remote 경로가 올바른데도 push 시 `Could not read from remote repository` 오류가 계속 발생합니다.
- **원인:** 외장 드라이브의 해당 폴더 내부에서 `git init --bare` 명령어를 실행하지 않았습니다.
- **해결 방법:** 파일 탐색기(File Explorer)로 외장 드라이브의 해당 폴더로 이동한 뒤 마우스 오른쪽 버튼을 클릭하여 **Open Git Bash here**를 선택하고 `git init --bare` 명령어를 실행합니다.
