---
layout: post
title: "Hướng Dẫn Sao Lưu Dự Án Unity Sang Ổ Cứng Rời Bằng Git Bare Repository"
date: 2026-08-22
categories: [Git, Unity, Tutorial]
tags: [git, backup, unity, bare-repository, usb]
---

Tài liệu này tổng hợp toàn bộ quy trình, lệnh chuẩn xác, và các lỗi thường gặp trong quá trình thiết lập một **Bare Git Repository** trên ổ cứng di động (USB) để làm nơi sao lưu (backup) an toàn cho dự án Unity.

## 1. Giới thiệu về Bare Repository

- **Bare Repository** là một kho Git không có thư mục làm việc (working directory), tức là không có code trực tiếp để xem hay sửa. Nó chỉ chứa nội dung của thư mục ẩn `.git`.
- Mục đích chính của nó là để **nhận code push lên** từ các máy tính khác, hoạt động tương tự như máy chủ GitHub/GitLab cục bộ trên ổ cứng của bạn.

## 2. Quy trình thiết lập chuẩn xác (Từng bước)

### Bước 1: Kích hoạt Git LFS cho dự án Unity (Local)

Dự án Unity chứa rất nhiều file nhị phân lớn (ảnh, âm thanh, 3D model). Để Git xử lý tối ưu, bắt buộc cần có `Git LFS`.

1. Mở Terminal (Git Bash) tại thư mục dự án Unity của bạn (VD: `D:\Unity-Projects\GLW`).
2. Tải template `.gitattributes` chuẩn của GameCI cho Unity.
3. Chạy lệnh kích hoạt LFS:

   ```bash
   git lfs install
   ```

4. Đưa file cấu hình vào lịch sử Git:

   ```bash
   git add .gitattributes
   git commit -m "Thêm cấu hình gitattributes cho Unity và Git LFS"
   ```

### Bước 2: Tạo Bare Repo trên ổ cứng di động

1. Cắm ổ cứng rời vào máy (Giả sử máy nhận là ổ `E:`).
2. Mở **Git Bash**, di chuyển tới thư mục muốn đặt backup (VD: `E:\Git`):

   ```bash
   cd /e/Git
   ```

3. Tạo thư mục chứa Repo (Quy ước đuôi `.git`). 

   > [!IMPORTANT]
   > **Lưu ý cực kỳ quan trọng:** Trong Git Bash phải dùng dấu gạch chéo xuôi `/`, không dùng dấu gạch chéo ngược `\` của Windows.

   ```bash
   mkdir -p "GLW.git"
   ```

4. Di chuyển vào thư mục vừa tạo và khởi tạo Bare Repo:

   ```bash
   cd "GLW.git"
   git init --bare
   ```

### Bước 3: Liên kết dự án Unity với ổ cứng (Thêm Remote)

1. Quay lại Terminal (Git Bash) ở thư mục dự án Unity (`D:\Unity-Projects\GLW`).
2. Liên kết remote (đặt tên remote là `glw` hoặc `usb`):

   ```bash
   git remote add glw "E:/Git/GLW.git"
   ```

3. Kiểm tra lại xem remote đã nhận đúng chưa:

   ```bash
   git remote -v
   ```
   *(Kết quả in ra 2 dòng fetch và push trỏ về `E:/Git/GLW.git` là thành công)*.

### Bước 4: Xử lý lỗi bảo mật phân quyền (Dubious Ownership)

Khi đẩy code lên ổ cứng định dạng exFAT/FAT32, Git sẽ báo lỗi `"dubious ownership"` vì ổ cứng này không lưu trữ phân quyền user như NTFS, khiến Git nghĩ đây là kho vô chủ và chặn lại vì lý do bảo mật.

**Cách khắc phục:** "Bảo lãnh" thư mục đó đưa vào danh sách an toàn:

```bash
git config --global --add safe.directory "E:/Git/GLW.git"
```

### Bước 5: Push code sang ổ cứng

Khi mọi thứ đã thiết lập xong, gõ lệnh push tất cả các nhánh (branches) và thẻ (tags) để backup trọn vẹn 100% dự án:

```bash
git push glw --all
git push glw --tags
```
*(Chờ quá trình hoàn tất là dự án của bạn đã được backup an toàn vào ổ cứng).*

---

## 3. Các lỗi thường gặp (Troubleshooting)

### 3.1. Lỗi tạo sai tên thư mục (Bị dính liền tên)

- **Triệu chứng:** Khi chạy lệnh `mkdir -p E:\Git\GLW.git` bằng Git Bash, thư mục sinh ra lại tên là `GitGLW.git`.
- **Nguyên nhân:** Git Bash coi dấu `\` là ký tự thoát (escape). Nó bỏ qua dấu `\` và nối chữ `Git` với `GLW` thành `GitGLW`.
- **Cách khắc phục:** Luôn sử dụng dấu gạch chéo xuôi `/` hoặc dấu ngoặc kép khi thao tác đường dẫn trên Git Bash. (VD: `mkdir -p "E:/Git/GLW.git"`).

### 3.2. Lỗi "fatal: 'E:BackupGitGLW.git' does not appear to be a git repository"

- **Triệu chứng:** Báo lỗi không tìm thấy repo remote khi push.
- **Nguyên nhân:** Khi chạy lệnh `git remote add`, bạn đã dùng backslash (`\`) làm sai lệch đường dẫn.
- **Cách khắc phục:**
  1. Xóa cấu hình remote sai: 
     ```bash
     git remote remove glw
     ```
  2. Thêm lại remote chuẩn: 
     ```bash
     git remote add glw "E:/Git/GLW.git"
     ```
     *(Có thể dùng `git remote set-url glw "E:/Git/GLW.git"` để ghi đè).*

### 3.3. Lỗi quên khởi tạo Bare Repo

- **Triệu chứng:** Dù đường dẫn Remote đã đúng, nhưng khi push vẫn báo `Could not read from remote repository`.
- **Nguyên nhân:** Chưa chạy lệnh `git init --bare` ở bên trong thư mục trên ổ cứng.
- **Cách khắc phục:** Dùng File Explorer đi tới thư mục trên ổ cứng, chuột phải chọn **Open Git Bash here** và chạy lệnh `git init --bare`.
