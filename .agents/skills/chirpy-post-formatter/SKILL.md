---
name: chirpy-post-formatter
description: >-
  Định dạng lại một bài viết Markdown (thường xuất từ Google Docs / .docx, có ảnh base64
  `![][image1]`, trích dẫn dính số `...chính2.`, blockquote nguồn `> 1. ...`) thành bộ 15 bài viết
  đa ngôn ngữ chuẩn Jekyll Chirpy trong `_posts/` của blog Long Gil Studio. Dùng khi người dùng
  yêu cầu "định dạng lại", "chuẩn hóa", "format" một bài trong `_posts/`, hoặc thêm bài mới từ tài
  liệu tiếng Việt.
---

# Chirpy Post Formatter (15-Language Multilingual Workflow)

Quy trình chuẩn hóa một bài viết mới trong `_posts/` theo theme `jekyll-theme-chirpy` từ **bài gốc Tiếng Việt (`lang: vi`)** và **tự động biên dịch, kiểm định 1-1 sang 14 ngôn ngữ mục tiêu còn lại** để phục vụ cộng đồng game dev quốc tế và quảng bá dự án **GilongWorld**.
Cú pháp chi tiết & bảng quy chuẩn 15 ngôn ngữ: [references/chirpy-syntax.md](./references/chirpy-syntax.md).

## Mặc định đã chốt — KHÔNG hỏi lại người dùng

| Hạng mục | Quyết định mặc định |
| :-- | :-- |
| Xuất bản đa ngôn ngữ (15 ngôn ngữ) | **Luôn tạo đủ 15 bài** liên kết qua cùng `translation_id` (kebab-case tiếng Anh): `vi`, `en`, `fr`, `it`, `de`, `es`, `pl`, `pt-BR`, `pt-PT`, `ko`, `ru`, `ja`, `tr`, `zh-CN`, `zh-TW` |
| Nguồn gốc chuẩn (Single Source of Truth) | Mọi bản dịch đều dịch trực tiếp từ **bài Tiếng Việt (`lang: vi`)**, bám sát 100% nội dung và cấu trúc |
| Slug & Tên file | Bài Việt: `YYYY-MM-DD-<slug-tieng-viet>.md`; Bài Anh: `YYYY-MM-DD-<english-seo-slug>.md`; 13 ngôn ngữ còn lại: `YYYY-MM-DD-<english-seo-slug>-<lang_lower>.md` (VD: `-pt-br.md`, `-zh-cn.md`) |
| Ảnh base64 / placeholder | Tách thành file trong `assets/img/posts/<YYYY-MM-DD>/`, tên kebab-case theo nội dung ảnh; tất cả 15 phiên bản **dùng chung file ảnh** |
| Cú pháp ảnh | Dịch đầy đủ alt text và caption `_<Nhãn Hình N>: ..._` sang từng ngôn ngữ (xem bảng trong `chirpy-syntax.md`) |
| Trích dẫn | Footnote kramdown `[^n]`, giữ nguyên số gốc và URL nguồn ở cả 15 bản |
| Danh sách nguồn | Có trích → `[^n]: Tiêu đề - [url](url)`; không trích → danh sách thường dưới mục `### Tài liệu đọc thêm` / `### Further Reading` (dịch tiêu đề mục theo bảng 15 ngôn ngữ) |
| H1 | Bỏ H1 trong thân bài (Chirpy tự render `title`) |
| Marketing GilongWorld | Hệ thống tự động gắn Devlog Badge, Language Switcher & Steam Wishlist Card 15 ngôn ngữ qua `metadata-hook.html` và `bilingual-gilongworld.js` |

Chỉ hỏi người dùng khi: không tìm được nguồn ảnh, hoặc không xác định được nội dung một ảnh để viết alt/caption.

## Quy trình

### Bước 0 — Khảo sát

1. Đọc toàn bộ bài gốc Tiếng Việt (file dài: đọc theo đoạn bằng `StartLine`/`EndLine`, phần base64 có thể bỏ qua).
2. Xác định nguồn ảnh, **ưu tiên theo thứ tự**:
   - Định nghĩa `[imageN]: <data:image/png;base64,...>` ở cuối file `.md` → tên khớp 1-1 với placeholder `![][imageN]`.
   - File `.docx` gốc (thường nằm ở gốc repo). **Cảnh báo:** `word/media/imageN.png` KHÔNG đảm bảo khớp thứ tự với `![][imageN]` trong Markdown.
3. Xem front matter của 1–2 bài gần nhất trong `_posts/` để dùng lại `categories` (tiếng Anh chuẩn như `[Game Development, Unity]`) và `tags` sẵn có.
4. Chốt một `translation_id` duy nhất cho bộ 15 bài (ví dụ: `unity6-render-graph-optimization`).

### Bước 1 — YAML Front Matter (Cho Cả 15 Bản)

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

**14 Bản Dịch (`lang` thuộc `en`, `fr`, `it`, `de`, `es`, `pl`, `pt-BR`, `pt-PT`, `ko`, `ru`, `ja`, `tr`, `zh-CN`, `zh-TW`):**
- Dịch đầy đủ `title` và `description` chuẩn SEO bản địa (bọc ngoặc kép `"..."` nếu có dấu `:`).
- Giữ nguyên y hệt `date`, `categories`, `tags`, `translation_id`, `math`, `mermaid` từ bản `vi`.
- Lấy `title` từ H1 cũ (bỏ `**`), rồi **xóa H1 đó khỏi thân bài**.
- Không thêm `layout: post` (đã có trong `defaults` của `_config.yml`).

### Bước 2 — Cấu trúc tiêu đề

- Thân bài bắt đầu từ `##`. Không nhảy cấp (`##` → `####` là sai). TOC của Chirpy dựa trên `##`/`###`.
- Bảo toàn 1-1 số lượng và cấp độ heading (`H2`, `H3`, `H4`) trên tất cả 15 ngôn ngữ.
- Mục nguồn ở cuối bài dùng `## **...**` đặt sau một dòng `---`, dịch tiêu đề mục theo bảng chuẩn 15 ngôn ngữ trong [references/chirpy-syntax.md](./references/chirpy-syntax.md).

### Bước 3 — Trích dẫn (Footnotes)

Bản xuất từ Google Docs dán số trích dẫn thẳng vào chữ. Chuyển **từng chỗ một bằng tay**, không dùng regex thay hàng loạt:

| Dạng gốc | Kết quả |
| :-- | :-- |
| `...luồng chính2.` | `...luồng chính[^2].` |
| `...hiện đại10.` | `...hiện đại[^10].` |
| `**16 GB RAM** \[cite: 2\]` | `**16 GB RAM**[^2]` |
| `Open World)1.` | `Open World)[^1].` |

Quy tắc:
- Footnote đứng **trước** dấu chấm/phẩy, sát chữ, không có khoảng trắng: `chữ[^2].`
- Không bao giờ để `[^n]` ở đầu dòng hoặc ngay sau code block. Gắn vào cuối câu dẫn vào code block: `...qua dòng lệnh[^20]:`.
- Danh sách nguồn `> 1. Tiêu đề, [https\://...](https://...)` → `[^1]: Tiêu đề - [https://...](https://...)`. Bỏ `>`, bỏ escape `\:`, `\.`, `\_`, `\-`, `\&`.
- **Chép URL nguyên văn** ở cả 15 bản: không gõ lại, không sửa domain.
- Nguồn không được trích đưa vào mục `### Tài liệu đọc thêm` (VI) / mục tương ứng của từng ngôn ngữ dưới dạng danh sách gạch đầu dòng `- Tiêu đề - [url](url)`.

### Bước 4 — Bảng và mã lệnh

- Bảng: giữ nguyên 1-1 số bảng, số hàng và số cột trên cả 15 ngôn ngữ. Bọc backtick cho API/hàm/package/flag.
- Lệnh dài hoặc nhiều dòng → code block có cùng ngôn ngữ (`bash`, `csharp`, `yaml`, `json`, `hlsl`...), có dòng trống trước và sau. Trong các bản dịch ngoại ngữ, dịch luôn các comment giải thích (`// ...`, `# ...`) sang ngôn ngữ mục tiêu nhưng giữ nguyên tuyệt đối mã API và định danh code.

### Bước 5 — Hình ảnh

1. Tách ảnh bằng script `extract_images.py` vào `assets/img/posts/<YYYY-MM-DD>`.
2. **Mở từng ảnh bằng `read_file` để xem nội dung trước khi đặt tên, viết alt và caption.**
3. Đổi tên file theo nội dung (kebab-case, không dấu).
4. Mọi bản dịch dùng chung đúng đường dẫn `/assets/img/posts/<YYYY-MM-DD>/<name>.png` và dịch đầy đủ `alt` + dòng caption `_<Nhãn N>: ..._` ngay bên dưới.
5. Xóa toàn bộ `[imageN]: <data:image/...>` và thay công thức toán dạng ảnh bằng LaTeX `$...$` + `math: true`.
6. Chạy kiểm tra bản gốc Tiếng Việt trước khi dịch:
   ```bash
   python .agents/skills/chirpy-post-formatter/scripts/check_post.py _posts/<file-vi>.md
   ```

### Bước 6 — Biên Dịch Chính Xác 1-1 Sang 14 Ngôn Ngữ Mục Tiêu

Từ bài Tiếng Việt chuẩn đã pass Bước 5, biên dịch sang đủ 14 ngôn ngữ (`en`, `fr`, `it`, `de`, `es`, `pl`, `pt-BR`, `pt-PT`, `ko`, `ru`, `ja`, `tr`, `zh-CN`, `zh-TW`):
- **Bám sát 100% bài gốc Tiếng Việt**: Không tóm tắt, không gộp đoạn, không lược bỏ bất kỳ câu, ý, hàng bảng, code block, ảnh hay footnote nào.
- **Chuẩn thuật ngữ & vùng miền**:
  - Giữ nguyên tên API Unity / C# / HLSL, đường dẫn file, biểu thức LaTeX (`$...$`), embed YouTube (`{% include embed/youtube.html ... %}`), và hộp callout Chirpy (`> [!NOTE]` hoặc `{: .prompt-tip }`).
  - Phân biệt chính xác chuẩn ngôn ngữ và thuật ngữ kỹ thuật giữa **Portuguese (Brazil)** (`pt-BR`) và **Portuguese (Portugal)** (`pt-PT`), giữa **Simplified Chinese** (`zh-CN`) và **Traditional Chinese** (`zh-TW`), và chuẩn **Spanish (Spain)** (`es`).

### Bước 7 — Kiểm Tra Bản Dịch 2 Tầng Bắt Buộc (Dual-Layer Translation QA)

1. **Tầng 1 — Kiểm định cấu trúc 1-1 tự động bằng `check_post.py`**:
   ```bash
   python .agents/skills/chirpy-post-formatter/scripts/check_post.py --all-langs <translation_id>
   ```
   Bắt buộc đạt:
   - Đủ **15/15 ngôn ngữ**, 0 `ERROR`.
   - Khớp 1-1 với bản gốc `vi`: chuỗi cấp độ heading, số code block & ngôn ngữ code, số bảng & số hàng mỗi bảng, danh sách/thứ tự ảnh, tập hợp footnote & URL.
   - Không còn sót bất kỳ ký tự/comment Tiếng Việt nào trong `title`, `description`, thân bài và code comment của 14 bản dịch ngoại ngữ.
2. **Tầng 2 — Bước Agent QA Review độc lập**:
   - Đọc kiểm tra từng bản dịch (hoặc phân công subagent QA đọc đối chiếu từng đoạn với bản gốc `vi`) để rà soát lỗi dịch nghĩa, lỗi ngữ pháp bản địa, lỗi sót từ hoặc thuật ngữ Unity chưa tự nhiên, và sửa ngay nếu phát hiện bất kỳ sai sót nào trước khi chạy lại `check_post.py --all-langs <translation_id>`.

### Bước 8 — Cập Nhật `llms.txt` & Báo Cáo Cuối

1. Cập nhật danh sách bài viết mới (ưu tiên link EN, VI và ghi chú hỗ trợ 15 ngôn ngữ) vào `llms.txt`.
2. Liệt kê ngắn gọn cho người dùng: `translation_id`, đường dẫn cả 15 file bài viết, các ảnh đã tách, số footnote đã chuyển, kết quả `check_post.py --all-langs` và tóm tắt kết quả rà soát QA.
