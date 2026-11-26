# Chirpy Markdown cheatsheet (dùng cho blog Long Gil Studio — 15 Ngôn Ngữ)

Nguồn chính thức: <https://chirpy.cotes.page/posts/write-a-new-post/>

## Bảng quy chuẩn 15 ngôn ngữ mục tiêu

| # | Ngôn ngữ | Mã `lang` | Hậu tố tên file | Nhãn hình ảnh | Tiêu đề mục Tài liệu Tham khảo | Tiêu đề mục Đọc thêm |
| :-: | :-- | :-- | :-- | :-- | :-- | :-- |
| 1 | Vietnamese (Gốc) | `vi` | `YYYY-MM-DD-<vi-slug>.md` | `_Hình N: ..._` | `## **Tài liệu Tham khảo**` | `### Tài liệu đọc thêm` |
| 2 | English | `en` | `YYYY-MM-DD-<en-slug>.md` | `_Figure N: ..._` | `## **References**` | `### Further Reading` |
| 3 | French | `fr` | `YYYY-MM-DD-<en-slug>-fr.md` | `_Figure N : ..._` | `## **Références**` | `### Lectures complémentaires` |
| 4 | Italian | `it` | `YYYY-MM-DD-<en-slug>-it.md` | `_Figura N: ..._` | `## **Riferimenti**` | `### Letture consigliate` |
| 5 | German | `de` | `YYYY-MM-DD-<en-slug>-de.md` | `_Abbildung N: ..._` | `## **Referenzen**` | `### Weiterführende Literatur` |
| 6 | Spanish - Spain | `es` | `YYYY-MM-DD-<en-slug>-es.md` | `_Figura N: ..._` | `## **Referencias**` | `### Lecturas recomendadas` |
| 7 | Polish | `pl` | `YYYY-MM-DD-<en-slug>-pl.md` | `_Rysunek N: ..._` | `## **Bibliografia**` | `### Dalsza lektura` |
| 8 | Portuguese - Brazil | `pt-BR` | `YYYY-MM-DD-<en-slug>-pt-br.md` | `_Figura N: ..._` | `## **Referências**` | `### Leitura adicional` |
| 9 | Portuguese - Portugal | `pt-PT` | `YYYY-MM-DD-<en-slug>-pt-pt.md` | `_Figura N: ..._` | `## **Referências**` | `### Leituras adicionais` |
| 10 | Korean | `ko` | `YYYY-MM-DD-<en-slug>-ko.md` | `_그림 N: ..._` | `## **참고문헌**` | `### 추가 읽을거리` |
| 11 | Russian | `ru` | `YYYY-MM-DD-<en-slug>-ru.md` | `_Рис. N: ..._` | `## **Список литературы**` | `### Дополнительная литература` |
| 12 | Japanese | `ja` | `YYYY-MM-DD-<en-slug>-ja.md` | `_図N：..._` | `## **参考文献**` | `### 関連資料` |
| 13 | Turkish | `tr` | `YYYY-MM-DD-<en-slug>-tr.md` | `_Şekil N: ..._` | `## **Kaynakça**` | `### İleri Okuma` |
| 14 | Simplified Chinese | `zh-CN` | `YYYY-MM-DD-<en-slug>-zh-cn.md` | `_图 N：..._` | `## **参考文献**` | `### 延伸阅读` |
| 15 | Traditional Chinese | `zh-TW` | `YYYY-MM-DD-<en-slug>-zh-tw.md` | `_圖 N：..._` | `## **參考文獻**` | `### 延伸閱讀` |

## Front matter mở rộng (Đa ngôn ngữ bắt buộc)

```yaml
---
title: "..."
date: 2026-10-22 03:00:00 +0700
categories: [Game Development, Unity]   # tối đa 2 cấp, viết bằng Tiếng Anh chuẩn
tags: [unity, urp]                       # chữ thường, kebab-case, không dấu
description: ...
lang: vi                                 # bắt buộc: thuộc 15 mã BCP-47 ở bảng trên
translation_id: unity6-render-graph      # bắt buộc: mã chung nối 15 bài cùng chủ đề
math: true            # bật MathJax ($...$ inline, $$...$$ khối)
mermaid: true         # bật Mermaid
pin: true             # ghim lên đầu trang chủ
toc: false            # tắt mục lục (mặc định đang bật trong _config.yml)
media_subpath: /assets/img/posts/2026-10-22   # cho phép viết ảnh bằng đường dẫn tương đối
image:                # ảnh preview / og:image, tỉ lệ 1.91:1 (1200x630)
  path: /assets/img/posts/2026-10-22/cover.png
  alt: Mô tả ảnh preview
---
```

Đã cấu hình sẵn trong `_config.yml` (không lặp lại trong bài): `layout: post`, `comments: true`, `toc: true`, `permalink: /posts/:title/`, `timezone: Asia/Ho_Chi_Minh`, `future: true`.

## Hình ảnh

```markdown
<!-- Bài Tiếng Việt -->
![Alt text tiếng Việt](/assets/img/posts/2026-10-22/name.png){: .shadow .rounded-10 }
_Hình 1: Caption tiếng Việt nằm ngay dòng tiếp theo, in nghiêng_

<!-- Bài Tiếng Anh (dùng chung file ảnh) -->
![English alt text](/assets/img/posts/2026-10-22/name.png){: .shadow .rounded-10 }
_Figure 1: English caption on the very next line in italics_
```

Thuộc tính trong `{: ... }`:

| Thuộc tính | Tác dụng |
| :-- | :-- |
| `w="1200" h="630"` | Khai báo kích thước, tránh giật layout khi tải trang |
| `.shadow` | Đổ bóng |
| `.rounded-10` | Bo góc 10px |
| `.normal` / `.left` / `.right` | Căn trái hoặc thả nổi (khi dùng thì không thêm caption) |
| `.light` / `.dark` | Chỉ hiển thị ảnh ở chế độ sáng hoặc tối |
| `lqip="..."` | Ảnh placeholder mờ khi đang tải |

## Prompt (hộp ghi chú)

```markdown
> Nội dung ghi chú.
{: .prompt-tip }
```

Các loại: `.prompt-tip`, `.prompt-info`, `.prompt-warning`, `.prompt-danger`.

## Code

````markdown
```csharp
var x = 1;
```
{: file="Assets/Scripts/Foo.cs" }
````

- `{: .nolineno }` để ẩn số dòng (blog đang bật `line_numbers: true` cho code block).
- Đường dẫn file inline: `` `Assets/Editor`{: .filepath} ``.

## Footnotes (kramdown)

```markdown
Câu có trích dẫn[^2].

[^2]: Tiêu đề nguồn - [https://example.com](https://example.com)
```

- kramdown gom footnote xuống cuối trang và **đánh lại số theo thứ tự xuất hiện**, nên số hiển thị có thể khác nhãn `[^n]`.
- Định nghĩa không được tham chiếu sẽ **không hiển thị** (đưa vào mục Tài liệu đọc thêm tương ứng).
- Nhãn trùng nhau sẽ bị bỏ qua, chỉ định nghĩa đầu tiên được dùng.

## Bảng

```markdown
| Cột A | Cột B |
| :---- | :---- |
| ô     | ô có dấu gạch đứng \| được escape |
```
