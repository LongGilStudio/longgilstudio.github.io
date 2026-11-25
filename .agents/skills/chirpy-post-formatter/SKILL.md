---
name: chirpy-post-formatter
description: >-
  Định dạng lại một bài viết Markdown (thường xuất từ Google Docs / .docx, có ảnh base64
  `![][image1]`, trích dẫn dính số `...chính2.`, blockquote nguồn `> 1. ...`) thành cặp bài
  song ngữ Anh – Việt chuẩn Jekyll Chirpy trong `_posts/` của blog Long Gil Studio. Dùng khi người
  dùng yêu cầu "định dạng lại", "chuẩn hóa", "format" một bài trong `_posts/`, hoặc thêm bài mới
  từ tài liệu tiếng Việt.
---

# Chirpy Post Formatter (Bilingual EN/VI Workflow)

Quy trình chuẩn hóa một bài viết mới trong `_posts/` theo theme `jekyll-theme-chirpy` **và tự động xuất bản phiên bản tiếng Anh chuẩn SEO song hành** để tăng lưu lượng quốc tế và quảng bá dự án **GilongWorld**.
Cú pháp chi tiết của Chirpy: [references/chirpy-syntax.md](./references/chirpy-syntax.md).

## Mặc định đã chốt — KHÔNG hỏi lại người dùng

| Hạng mục | Quyết định mặc định |
| :-- | :-- |
| Xuất bản song ngữ | **Luôn tạo đủ 2 bài (`lang: vi` và `lang: en`)** liên kết với nhau qua cùng `translation_id` (kebab-case tiếng Anh) |
| Slug & Tên file | Bài Việt: `YYYY-MM-DD-<slug-tieng-viet>.md`; Bài Anh: `YYYY-MM-DD-<english-seo-slug>.md` (không sửa URL của bài cũ đã có) |
| Ảnh base64 / placeholder | Tách thành file trong `assets/img/posts/<YYYY-MM-DD>/`, tên kebab-case theo nội dung ảnh; bài Anh và bài Việt **dùng chung file ảnh** |
| Cú pháp ảnh | Bài Việt: `![alt VI](/assets/img/posts/<date>/<name>.png){: .shadow .rounded-10 }` + `_Hình N: ..._`; Bài Anh: dịch đầy đủ alt text + `_Figure N: ..._` |
| Trích dẫn | Footnote kramdown `[^n]`, giữ nguyên số gốc và URL nguồn ở cả 2 bản |
| Danh sách nguồn | Có trích → `[^n]: Tiêu đề - [url](url)`; không trích → danh sách thường dưới mục `### Tài liệu đọc thêm` (VI) / `### Further Reading` (EN) |
| H1 | Bỏ H1 trong thân bài (Chirpy tự render `title`) |
| Ngôn ngữ | Bản Việt: giữ nguyên nội dung câu chữ, chỉ sửa định dạng; Bản Anh: dịch đầy đủ 100%, chuẩn thuật ngữ kỹ thuật Unity / Game Dev |
| Marketing GilongWorld | Hệ thống tự động gắn Devlog Badge & Steam Wishlist Card qua `metadata-hook.html`; nhắc tên **GilongWorld** tự nhiên nếu bài gốc có đề cập |

Chỉ hỏi người dùng khi: không tìm được nguồn ảnh, hoặc không xác định được nội dung một ảnh để viết alt/caption.

## Quy trình

### Bước 0 — Khảo sát

1. Đọc toàn bộ bài gốc (file dài: đọc theo đoạn bằng `StartLine`/`EndLine`, phần base64 có thể bỏ qua).
2. Xác định nguồn ảnh, **ưu tiên theo thứ tự**:
   - Định nghĩa `[imageN]: <data:image/png;base64,...>` ở cuối file `.md` → tên khớp 1-1 với placeholder `![][imageN]`.
   - File `.docx` gốc (thường nằm ở gốc repo). **Cảnh báo:** `word/media/imageN.png` KHÔNG đảm bảo khớp thứ tự với `![][imageN]` trong Markdown.
3. Xem front matter của 1–2 bài gần nhất trong `_posts/` để dùng lại `categories` (tiếng Anh chuẩn như `[Game Development, Unity]`) và `tags` sẵn có.
4. Chốt một `translation_id` duy nhất cho cặp bài (ví dụ: `unity6-render-graph-optimization`).

### Bước 1 — YAML Front Matter (Cho Cả 2 Bản)

**Bản Tiếng Việt (`lang: vi`):**
```yaml
---
title: "Tiêu đề đầy đủ tiếng Việt, đặt trong ngoặc kép nếu có dấu hai chấm"
date: YYYY-MM-DD HH:MM:SS +0700
categories: [Game Development, Unity]
tags: [unity, performance, chu-de-chinh]
description: Một đến hai câu tóm tắt (~150–200 ký tự), dùng cho SEO và thẻ preview.
lang: vi
translation_id: <kebab-case-topic-id>
---
```

**Bản Tiếng Anh (`lang: en`):**
```yaml
---
title: "Full SEO-Optimized English Title (Quoted If Contains Colon)"
date: YYYY-MM-DD HH:MM:SS +0700
categories: [Game Development, Unity]
tags: [unity, performance, main-topic]
description: One to two concise SEO sentences (~150–200 chars) summarizing the engineering deep dive.
lang: en
translation_id: <kebab-case-topic-id>
---
```

- Lấy `title` từ H1 cũ (bỏ `**`), rồi **xóa H1 đó khỏi thân bài**.
- `date` phải trùng ngày trong tên file; nên trùng ngày/giờ giữa 2 bản.
- `categories`: viết bằng tiếng Anh chuẩn (tối đa 2 cấp, VD `[Game Development, Unity]`) để gộp chung cây thư mục cho cả 2 ngôn ngữ. `tags`: chữ thường, kebab-case, không dấu.
- Thêm `math: true` chỉ khi bài có công thức `$...$`, thêm `mermaid: true` chỉ khi có khối mermaid.
- Không thêm `layout: post` (đã có trong `defaults` của `_config.yml`).

### Bước 2 — Cấu trúc tiêu đề

- Thân bài bắt đầu từ `##`. Không nhảy cấp (`##` → `####` là sai). TOC của Chirpy dựa trên `##`/`###`.
- Giữ kiểu `## **Tiêu đề**` nếu bài gốc đã dùng.
- Mục nguồn ở cuối bài, đặt sau một dòng `---`:
  - Bản Việt: `## **Tài liệu Tham khảo**` (và `### Tài liệu đọc thêm` nếu có nguồn không được trích).
  - Bản Anh: `## **References**` (và `### Further Reading` nếu có nguồn không được trích).

### Bước 3 — Trích dẫn (Footnotes)

Bản xuất từ Google Docs dán số trích dẫn thẳng vào chữ. Chuyển **từng chỗ một bằng tay**, không dùng regex thay hàng loạt:

| Dạng gốc | Kết quả |
| :-- | :-- |
| `...luồng chính2.` | `...luồng chính[^2].` |
| `...hiện đại10.` | `...hiện đại[^10].` |
| `**16 GB RAM** \[cite: 2\]` | `**16 GB RAM**[^2]` |
| `Open World)1.` | `Open World)[^1].` |

**Bẫy số dính vào thông số kỹ thuật** — đối chiếu với giá trị thật trước khi tách:
`DirectX 122` → `DirectX 12[^2]`, `Core i5-85002` → `i5-8500[^2]`, `Ryzen 5 56002` → `5600[^2]`, `RX 6500 XT2` → `XT[^2]`, `Burst7,` → `Burst[^7],`.

Quy tắc:
- Footnote đứng **trước** dấu chấm/phẩy, sát chữ, không có khoảng trắng: `chữ[^2].` / `word[^2].`
- Không bao giờ để `[^n]` ở đầu dòng hoặc ngay sau code block. Gắn vào cuối câu dẫn vào code block: `...qua dòng lệnh[^20]:`.
- Danh sách nguồn `> 1. Tiêu đề, [https\://...](https://...)` → `[^1]: Tiêu đề - [https://...](https://...)`. Bỏ `>`, bỏ escape `\:`, `\.`, `\_`, `\-`, `\&`.
- **Chép URL nguyên văn**: không gõ lại, không "sửa" domain.
- Nguồn không được trích đưa vào mục `### Tài liệu đọc thêm` (VI) / `### Further Reading` (EN) dưới dạng danh sách gạch đầu dòng `- Tiêu đề - [url](url)`.

### Bước 4 — Bảng và mã lệnh

- Bảng: bỏ escape thừa trong ô (`12\)2` → `12)[^2]`, `1\.` → `1.`, `\+` → `+`, `\>` → `>`). Giữ dòng căn lề `| :---- |`. Ký tự `|` trong ô thì giữ escape `\|`.
- Bọc backtick cho: tên API/hàm (`Physics.Raycast`, `RecordRenderGraph`), tên package (`com.unity.memoryprofiler`), cờ CLI (`-batchmode`), truy vấn (`avg>1ms`), đường dẫn file, khóa cấu hình (`m_CompressAssetsOnImport: 0`), chuỗi log. Trong backtick thì bỏ escape.
- Lệnh dài hoặc nhiều dòng → code block có ngôn ngữ (`bash`, `csharp`, `yaml`, `json`, `hlsl`...), có dòng trống trước và sau.
- **Không** bọc backtick cho đường dẫn menu (Window > Analysis). Chỉ bỏ escape `\>` → `>`.

### Bước 5 — Hình ảnh

1. Tách ảnh bằng script (tự tạo thư mục):
   ```bash
   python .agents/skills/chirpy-post-formatter/scripts/extract_images.py _posts/<file>.md --out assets/img/posts/<YYYY-MM-DD>
   # hoặc từ docx:
   python .agents/skills/chirpy-post-formatter/scripts/extract_images.py "<tài liệu>.docx" --out assets/img/posts/<YYYY-MM-DD>
   ```
2. **Mở từng ảnh bằng `read_file` để xem nội dung trước khi đặt tên, viết alt và caption.**
3. Đổi tên file theo nội dung (kebab-case, không dấu), ví dụ `render-graph-pass-merging.png`.
4. Thay placeholder:
   - Bản Việt:
     ```markdown
     ![Mô tả ngắn, đúng nội dung ảnh](/assets/img/posts/2026-10-22/render-graph-pass-merging.png){: .shadow .rounded-10 }
     _Hình 2: Caption mô tả điều người đọc cần thấy trong ảnh_
     ```
   - Bản Anh (dùng chung đường dẫn ảnh):
     ```markdown
     ![Concise English alt text matching image content](/assets/img/posts/2026-10-22/render-graph-pass-merging.png){: .shadow .rounded-10 }
     _Figure 2: English caption describing what the reader should observe_
     ```
5. Xóa toàn bộ dòng định nghĩa `[imageN]: <data:image/...>` (hoặc chạy lại script với `--strip`).
6. Ảnh là công thức toán: thay bằng LaTeX `$O(n)$` và thêm `math: true`.

### Bước 6 — Biên Dịch Sang Bản Tiếng Anh (`lang: en`)

Sau khi hoàn thành bài Tiếng Việt:
1. Tạo file `_posts/YYYY-MM-DD-<english-seo-slug>.md` với `lang: en` và cùng `translation_id`.
2. Dịch **toàn vẹn 100%** nội dung bài viết:
   - Không tóm tắt, không lược bỏ đoạn văn hay hàng bảng nào.
   - Sử dụng văn phong kỹ thuật tiếng Anh tự nhiên, chuẩn xác theo tài liệu chính thức của Unity Engine / Microsoft .NET.
   - Giữ nguyên toàn bộ code blocks, tên API C#/HLSL, biểu thức LaTeX (`$...$`), embed YouTube, và toàn bộ hệ thống footnote `[^n]` + URL tham chiếu.
   - Dịch toàn bộ tiêu đề bảng, nội dung bảng, alt text và `_Figure N: ..._`.

### Bước 7 — Cập Nhật `llms.txt` & Kiểm Tra Bắt Buộc

1. Cập nhật danh sách bài viết mới (cả link bản EN và bản VI) vào `llms.txt`.
2. Chạy `check_post.py` cho **cả hai bài viết** (bắt buộc 0 `ERROR` và không thiếu cặp song ngữ):
   ```bash
   python .agents/skills/chirpy-post-formatter/scripts/check_post.py _posts/<file-vi>.md
   python .agents/skills/chirpy-post-formatter/scripts/check_post.py _posts/<file-en>.md
   ```

## Báo cáo cuối cho người dùng

Liệt kê ngắn gọn: đường dẫn cả 2 file bài viết (`vi` và `en`), `translation_id`, các ảnh đã tách, số footnote đã chuyển, và kết quả `check_post.py` của cả hai bài.
