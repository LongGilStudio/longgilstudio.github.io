#!/usr/bin/env python3
"""Kiểm tra một bài Jekyll Chirpy sau khi định dạng (hỗ trợ song ngữ EN/VI).

  python check_post.py _posts/2026-10-22-bai.md

Exit code 1 nếu có ERROR. WARN là gợi ý cần người rà lại (có thể báo nhầm).
"""
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Đảm bảo UTF-8 trên Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REQUIRED = ("title", "date", "categories", "tags", "description", "lang", "translation_id")
SUPPORTED_LANGS = ("vi", "en")
INLINE_CODE = re.compile(r"`[^`]*`")
LINK_TARGET = re.compile(r"\]\([^)]*\)|<https?://[^>]*>|https?://\S+")
# chữ cái hoặc ')' dính ngay 1-2 chữ số rồi tới dấu câu/khoảng trắng/cuối dòng: "chính2." "World)1."
GLUED_CITE = re.compile(r"(?<=[^\W\d_)])(\d{1,2})(?=[.,;:]?(?:\s|$))|(?<=\))(\d{1,2})(?=[.,;:]?(?:\s|$))")
GDOCS_ESCAPE = re.compile(r"\\[#\-+<>_&\[\]`.]")


def find_root(post: Path) -> Path:
    for d in post.parents:
        if (d / "_config.yml").exists():
            return d
    return post.parent


def parse_front_matter(lines):
    fm, body_start = {}, 0
    closed = False
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                body_start = i + 1
                closed = True
                break
            m = re.match(r"^([A-Za-z_]+):\s*(.*)$", lines[i])
            if m:
                fm[m.group(1)] = m.group(2).strip().strip("\"'")
    return fm, body_start, closed


def parse_date(raw: str):
    m = re.match(r"^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?(?:\s*([+-]\d{2}:?\d{2}))?$", raw.strip("'\" "))
    if not m:
        return None, False
    day, time, tz = m.groups()
    complete = bool(time and tz)
    time = (time or "00:00:00") + (":00" if time and len(time) == 5 else "")
    tz = (tz or "+0700").replace(":", "")
    return datetime.strptime(f"{day} {time} {tz}", "%Y-%m-%d %H:%M:%S %z"), complete


def main(arg: str) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    post = Path(arg).resolve()
    if not post.exists():
        print(f"Không tìm thấy {post}")
        return 1
    root = find_root(post)
    lines = post.read_text(encoding="utf-8").splitlines()
    errors, warns = [], []

    def err(n, msg):
        errors.append(f"L{n}: {msg}")

    def warn(n, msg):
        warns.append(f"L{n}: {msg}")

    # ---------- Front matter ----------
    fm, body_start, closed = parse_front_matter(lines)
    if not (lines and lines[0].strip() == "---"):
        err(1, "Thiếu YAML front matter")
    elif not closed:
        err(1, "Front matter thiếu dấu --- đóng")

    # Giữ raw title và description để kiểm tra dấu ':' chưa bọc ngoặc kép
    raw_fields = {}
    for i in range(1, body_start):
        m = re.match(r"^(title|description):\s*(.*)$", lines[i])
        if m:
            raw_fields[m.group(1)] = m.group(2).strip()

    for key in REQUIRED:
        if not fm.get(key):
            err(1, f'Front matter thiếu "{key}"')
    if fm.get("lang") and fm["lang"] not in SUPPORTED_LANGS:
        err(1, f'lang phải là một trong {SUPPORTED_LANGS}, nhận được: {fm["lang"]}')
    if fm.get("translation_id") and not re.match(r"^[a-z0-9][a-z0-9-]*$", fm["translation_id"]):
        warn(1, "translation_id nên viết kebab-case chữ thường không dấu")

    if fm.get("title", "").startswith("**") or "**" in fm.get("title", ""):
        warn(1, "title còn dấu ** của markdown")
    for key in ("title", "description"):
        raw_val = raw_fields.get(key, "")
        if ": " in raw_val and not raw_val[:1] in "\"'":
            err(1, f"{key} có dấu ': ' phải đặt trong ngoặc kép")
        elif key == "title" and ":" in raw_val and not raw_val[:1] in "\"'":
            err(1, "title có dấu ':' phải đặt trong ngoặc kép")
    for key in ("categories", "tags"):
        v = fm.get(key, "")
        if v and not (v.startswith("[") and v.endswith("]")):
            warn(1, f"{key} nên viết dạng [a, b]")
    if fm.get("tags") and re.search(r"[A-ZÀ-Ỹ]", fm["tags"]):
        warn(1, "tags nên viết chữ thường")
    if fm.get("date"):
        dt, complete = parse_date(fm["date"])
        if dt is None:
            err(1, f'date sai định dạng (cần "YYYY-MM-DD HH:MM:SS +0700"): {fm["date"]}')
        else:
            if not complete:
                warn(1, "date nên có giờ và múi giờ, ví dụ 2026-10-22 03:00:00 +0700")
            if dt > datetime.now(timezone.utc):
                warn(1, f"date ở tương lai ({dt.isoformat()}); đảm bảo _config.yml bật future: true")
            fn = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})-", post.name)
            if not fn:
                err(1, "Tên file phải có dạng YYYY-MM-DD-ten-bai.md")
            elif (int(fn[1]), int(fn[2]), int(fn[3])) != (dt.year, dt.month, dt.day):
                warn(1, "Ngày trong tên file khác ngày trong front matter")
    uses_math = bool(fm.get("math", "").lower() == "true")

    # ---------- Bilingual counterpart check ----------
    tid = fm.get("translation_id")
    lang = fm.get("lang")
    if tid and lang in SUPPORTED_LANGS:
        counterparts = []
        for sibling in sorted(post.parent.glob("*.md")):
            if sibling.resolve() == post:
                continue
            s_fm, _, _ = parse_front_matter(sibling.read_text(encoding="utf-8").splitlines()[:30])
            if s_fm.get("translation_id") == tid:
                s_lang = s_fm.get("lang")
                if s_lang == lang:
                    err(1, f'Trùng translation_id="{tid}" và cùng lang="{lang}" với {sibling.name}')
                else:
                    counterparts.append((sibling.name, s_lang))
        if not counterparts:
            warn(1, f'Chưa có bài dịch đối ứng cho translation_id="{tid}" (cần tạo bản {"en" if lang == "vi" else "vi"})')

    # ---------- Body ----------
    in_code, prev_level = False, 1
    refs, defs = {}, {}
    figure_no = 0
    for idx in range(body_start, len(lines)):
        n, line = idx + 1, lines[idx]
        s = line.strip()
        if s.startswith("```") or s.startswith("~~~"):
            if not in_code and idx + 1 < len(lines) and lines[idx - 1].strip() and not lines[idx - 1].lstrip().startswith(("-", "*", "1", ">")):
                warn(n, "Nên có dòng trống trước code block")
            in_code = not in_code
            continue
        if in_code:
            continue

        h = re.match(r"^(#{1,6})\s", line)
        if h:
            lvl = len(h.group(1))
            if lvl == 1:
                err(n, "Không dùng H1 (#) trong thân bài, Chirpy đã render title thành H1")
            elif lvl > prev_level + 1:
                warn(n, f"Nhảy cấp tiêu đề H{prev_level} -> H{lvl}")
            prev_level = lvl

        is_def = re.match(r"^\[\^([^\]]+)\]:", line)
        if is_def:
            label = is_def.group(1)
            if label in defs:
                err(n, f"Footnote [^{label}] được định nghĩa 2 lần (lần đầu ở L{defs[label]})")
            defs.setdefault(label, n)
        elif re.match(r"^\s*\[\^[^\]]+\]", line):
            err(n, "Footnote bị treo ở đầu dòng, gắn nó vào cuối câu phía trước")
        for label in re.findall(r"\[\^([^\]]+)\](?!:)", line if not is_def else line[is_def.end():]):
            refs.setdefault(label, n)
        if re.search(r"\s\[\^[^\]]+\]", line) and not is_def:
            warn(n, "Có khoảng trắng trước footnote, nên viết sát chữ: chữ[^2]")

        if re.match(r"^>\s*\d+\.\s", line) and "http" in line:
            err(n, "Nguồn trích dẫn còn dạng blockquote '> 1. ...', chuyển sang [^n]: ...")
        if "![][" in line or re.match(r"^\[image\d+\]:", line):
            err(n, "Còn placeholder ảnh hoặc định nghĩa base64 kiểu Google Docs")
        if "data:image/" in line:
            err(n, "Còn ảnh base64 nhúng trong Markdown")
        if re.search(r"\\?\[cite:", line):
            err(n, "Còn trích dẫn dạng [cite: n]")
        if re.search(r"https?\\:", line) or "www\\." in line:
            err(n, "URL còn ký tự escape (https\\: hoặc www\\.)")

        plain = INLINE_CODE.sub("", line)
        if GDOCS_ESCAPE.search(plain):
            warn(n, "Còn ký tự escape kiểu Google Docs (\\#, \\-, \\>, \\_, ...)")
        if not is_def and not h:
            prose = LINK_TARGET.sub("", plain)
            prose = re.sub(r"\$[^$]*\$", "", prose) if uses_math else prose
            hits = [m.group(0) for m in GLUED_CITE.finditer(prose)]
            if hits:
                warn(n, f"Nghi còn số trích dẫn dính vào chữ: {', '.join(sorted(set(hits)))}")

        for m in re.finditer(r"!\[([^\]]*)\]\(([^)\s]+)[^)]*\)(\{:[^}]*\})?", line):
            alt, src = m.group(1), m.group(2)
            figure_no += 1
            if not alt.strip():
                err(n, "Ảnh thiếu alt text")
            if src.startswith("/"):
                if not (root / src.lstrip("/")).exists():
                    err(n, f"Không tìm thấy file ảnh {src}")
            elif not src.startswith(("http://", "https://")):
                base = fm.get("media_subpath") or fm.get("img_path")
                if not base:
                    err(n, f"Đường dẫn ảnh tương đối '{src}' nhưng front matter không có media_subpath")
                elif not (root / base.strip("'\"").lstrip("/") / src).exists():
                    err(n, f"Không tìm thấy file ảnh {base}/{src}")
            nxt = lines[idx + 1].strip() if idx + 1 < len(lines) else ""
            if not (nxt.startswith("_") and nxt.endswith("_")):
                warn(n, "Ảnh nên có caption _..._ ở ngay dòng tiếp theo")

    if in_code:
        err(len(lines), "Code block chưa được đóng ```")
    for label, n in refs.items():
        if label not in defs:
            err(n, f"Footnote [^{label}] được trích nhưng không có định nghĩa")
    unused = [k for k in defs if k not in refs]
    if unused:
        warns.append(
            f"{len(unused)} footnote không được trích nên kramdown sẽ KHÔNG hiển thị: "
            + ", ".join(f"[^{k}]" for k in sorted(unused, key=lambda x: (len(x), x)))
            + ". Chuyển chúng sang danh sách 'Tài liệu đọc thêm' / 'Further Reading' nếu muốn giữ."
        )
    size_kb = post.stat().st_size / 1024
    if size_kb > 200:
        warns.append(f"File nặng {size_kb:.0f} KB, kiểm tra xem còn ảnh nhúng không")

    print(f"== {post.name} ==")
    print(f"lang: {lang} | translation_id: {tid} | footnote: {len(refs)}/{len(defs)} | ảnh: {figure_no} | {size_kb:.0f} KB")
    for e in errors:
        print(f"ERROR {e}")
    for w in warns:
        print(f"WARN  {w}")
    print("OK, không có ERROR." if not errors else f"{len(errors)} ERROR cần sửa.")
    return 1 if errors else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
