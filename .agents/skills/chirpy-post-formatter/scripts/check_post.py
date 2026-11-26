#!/usr/bin/env python3
"""Kiểm tra bài viết Jekyll Chirpy đa ngôn ngữ (15 ngôn ngữ) và đối chiếu cấu trúc 1-1 với bản gốc Tiếng Việt.

Cách dùng:
  python check_post.py _posts/2026-10-22-bai.md
  python check_post.py --all-langs <translation_id>
  python check_post.py --all

Exit code 1 nếu có ERROR. WARN là gợi ý cần rà lại.
"""
import argparse
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REQUIRED = ("title", "date", "categories", "tags", "description", "lang", "translation_id")
SUPPORTED_LANGS = (
    "vi", "en", "fr", "it", "de", "es", "pl",
    "pt-BR", "pt-PT", "ko", "ru", "ja", "tr", "zh-CN", "zh-TW"
)
NEW_LANG_SUFFIXES = {
    lang: f"-{lang.lower()}.md"
    for lang in SUPPORTED_LANGS
    if lang not in ("vi", "en")
}

INLINE_CODE = re.compile(r"`[^`]*`")
LINK_TARGET = re.compile(r"\]\([^)]*\)|<https?://[^>]*>|https?://\S+")
URL_RE = re.compile(r"https?://[^\s\)\]>\"']+")
# chữ cái hoặc ')' dính ngay 1-2 chữ số rồi tới dấu câu/khoảng trắng/cuối dòng
GLUED_CITE = re.compile(
    r"(?<=[^\W\d_)])(\d{1,2})(?=[.,;:]?(?:\s|$))|(?<=\))(\d{1,2})(?=[.,;:]?(?:\s|$))"
)
GDOCS_ESCAPE = re.compile(r"\\[#\-+<>_&\[\]`.]")
# Ký tự đặc thù Tiếng Việt (loại trừ â/ê/ô đơn thuần vì trùng dấu mũ tiếng Pháp & Bồ Đào Nha)
VI_CHAR_RE = re.compile(
    r"[ăđơưĂĐƠƯảấầẩẫậắằẳẵặẻếềểễệỉịỏốồổỗộớờởỡợủứừửữựỷỵỹ"
    r"ẢẤẦẨẪẬẮẰẲẴẶẺẾỀỂỄỆỈỊỎỐỒỔỖỘỚỜỞỠỢỦỨỪỬỮỰỶỴỸ]"
)


def find_root(path: Path) -> Path:
    for d in [path, *path.parents]:
        if (d / "_config.yml").exists():
            return d
    return path.parent


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
    m = re.match(
        r"^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?(?:\s*([+-]\d{2}:?\d{2}))?$",
        raw.strip("'\" "),
    )
    if not m:
        return None, False
    day, time, tz = m.groups()
    complete = bool(time and tz)
    time = (time or "00:00:00") + (":00" if time and len(time) == 5 else "")
    tz = (tz or "+0700").replace(":", "")
    return datetime.strptime(f"{day} {time} {tz}", "%Y-%m-%d %H:%M:%S %z"), complete


def extract_structure(lines, body_start):
    """Trích xuất chữ ký cấu trúc của thân bài để đối chiếu 1-1."""
    in_code = False
    in_table = False
    table_rows = 0
    headings = []
    code_blocks = []
    tables = []
    images = []
    refs = set()
    defs = {}

    for line in lines[body_start:]:
        s = line.strip()
        if s.startswith("```") or s.startswith("~~~"):
            if not in_code:
                code_blocks.append(s[3:].strip().lower())
            in_code = not in_code
            if in_table:
                tables.append(table_rows)
                in_table = False
                table_rows = 0
            continue
        if in_code:
            continue

        if s.startswith("|"):
            if not in_table:
                in_table = True
                table_rows = 0
            table_rows += 1
        elif in_table:
            tables.append(table_rows)
            in_table = False
            table_rows = 0

        hm = re.match(r"^(#{1,6})\s", line)
        if hm:
            headings.append(len(hm.group(1)))

        for im in re.finditer(r"!\[[^\]]*\]\(([^)\s]+)", line):
            images.append(im.group(1))

        is_def = re.match(r"^\[\^([^\]]+)\]:", line)
        if is_def:
            label = is_def.group(1)
            hrefs = re.findall(r"\]\((https?://[^)\s]+)\)", line)
            if not hrefs:
                hrefs = [u.replace("\\_", "_") for u in URL_RE.findall(line)]
            defs.setdefault(label, hrefs)
        for rf in re.findall(r"\[\^([^\]]+)\](?!:)", line if not is_def else line[is_def.end():]):
            refs.add(rf)

    if in_table:
        tables.append(table_rows)

    return {
        "headings": headings,
        "code_blocks": code_blocks,
        "tables": tables,
        "images": images,
        "refs": refs,
        "defs": defs,
    }


def strip_allowed_vi_contexts(text: str) -> str:
    text = LINK_TARGET.sub("", text)
    text = URL_RE.sub("", text)
    text = INLINE_CODE.sub("", text)
    text = text.replace("Huỳnh Long Gil", "")
    return text


def compare_with_vi_source(post_fm, post_lines, post_body_start, vi_path: Path, errors, warns):
    vi_lines = vi_path.read_text(encoding="utf-8").splitlines()
    vi_fm, vi_body_start, _ = parse_front_matter(vi_lines)
    p_struct = extract_structure(post_lines, post_body_start)
    v_struct = extract_structure(vi_lines, vi_body_start)

    # 1. Front matter parity
    p_dt, _ = parse_date(post_fm.get("date", ""))
    v_dt, _ = parse_date(vi_fm.get("date", ""))
    if p_dt and v_dt and p_dt.date() != v_dt.date():
        errors.append(f"L1: Ngày date ({p_dt.date()}) khác bản gốc VI ({v_dt.date()})")
    if post_fm.get("categories") != vi_fm.get("categories"):
        warn_msg = f"L1: categories ({post_fm.get('categories')}) khác bản gốc VI ({vi_fm.get('categories')})"
        warns.append(warn_msg)
    if post_fm.get("math", "").lower() != vi_fm.get("math", "").lower():
        errors.append("L1: Cờ math trong front matter không khớp bản gốc VI")
    if post_fm.get("mermaid", "").lower() != vi_fm.get("mermaid", "").lower():
        errors.append("L1: Cờ mermaid trong front matter không khớp bản gốc VI")

    # 2. Headings parity
    if p_struct["headings"] != v_struct["headings"]:
        errors.append(
            f"L1: Cấu trúc Heading không khớp 1-1 với bản VI "
            f"(bản dịch={p_struct['headings']} vs VI={v_struct['headings']})"
        )

    # 3. Code blocks parity
    if p_struct["code_blocks"] != v_struct["code_blocks"]:
        errors.append(
            f"L1: Số lượng hoặc ngôn ngữ code block không khớp 1-1 với bản VI "
            f"(bản dịch={p_struct['code_blocks']} vs VI={v_struct['code_blocks']})"
        )

    # 4. Tables parity
    if p_struct["tables"] != v_struct["tables"]:
        errors.append(
            f"L1: Bảng Markdown không khớp 1-1 với bản VI "
            f"(bản dịch={p_struct['tables']} vs VI={v_struct['tables']})"
        )

    # 5. Images parity
    if p_struct["images"] != v_struct["images"]:
        errors.append(
            f"L1: Danh sách/thứ tự ảnh không khớp 1-1 với bản VI "
            f"(bản dịch={p_struct['images']} vs VI={v_struct['images']})"
        )

    # 6. Footnotes & URLs parity
    if p_struct["refs"] != v_struct["refs"]:
        missing_r = sorted(v_struct["refs"] - p_struct["refs"])
        extra_r = sorted(p_struct["refs"] - v_struct["refs"])
        errors.append(f"L1: Footnote trích dẫn không khớp bản VI (thiếu={missing_r}, thừa={extra_r})")
    if set(p_struct["defs"].keys()) != set(v_struct["defs"].keys()):
        missing_d = sorted(set(v_struct["defs"].keys()) - set(p_struct["defs"].keys()))
        extra_d = sorted(set(p_struct["defs"].keys()) - set(p_struct["defs"].keys()))
        errors.append(f"L1: Định nghĩa footnote không khớp bản VI (thiếu={missing_d}, thừa={extra_d})")
    else:
        for lbl, v_urls in v_struct["defs"].items():
            p_urls = p_struct["defs"].get(lbl, [])
            if p_urls != v_urls:
                errors.append(f"L1: URL trong footnote [^{lbl}] bị thay đổi so với bản VI")

    # 7. Completeness ratio check
    p_body_len = sum(len(l.strip()) for l in post_lines[post_body_start:])
    v_body_len = sum(len(l.strip()) for l in vi_lines[vi_body_start:])
    if v_body_len > 0:
        ratio = p_body_len / v_body_len
        lang = post_fm.get("lang", "")
        min_ratio = 0.28 if lang in ("ja", "zh-CN", "zh-TW", "ko") else 0.55
        if ratio < min_ratio:
            warns.append(
                f"L1: Độ dài văn bản bản dịch ({p_body_len} ký tự, tỷ lệ {ratio:.2f}) thấp bất thường so với bản VI ({v_body_len})"
            )


def check_file(post: Path, all_posts_index=None, check_source_parity=True):
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

    raw_fields = {}
    for i in range(1, body_start):
        m = re.match(r"^(title|description):\s*(.*)$", lines[i])
        if m:
            raw_fields[m.group(1)] = m.group(2).strip()

    for key in REQUIRED:
        if not fm.get(key):
            err(1, f'Front matter thiếu "{key}"')
    lang = fm.get("lang", "")
    if lang and lang not in SUPPORTED_LANGS:
        err(1, f'lang phải là một trong {SUPPORTED_LANGS}, nhận được: {lang}')
    if lang in NEW_LANG_SUFFIXES and not post.name.endswith(NEW_LANG_SUFFIXES[lang]):
        warn(1, f'Tên file ngôn ngữ "{lang}" nên kết thúc bằng "{NEW_LANG_SUFFIXES[lang]}"')
    tid = fm.get("translation_id", "")
    if tid and not re.match(r"^[a-z0-9][a-z0-9-]*$", tid):
        warn(1, "translation_id nên viết kebab-case chữ thường không dấu")

    if "**" in fm.get("title", ""):
        warn(1, "title còn dấu ** của markdown")
    for key in ("title", "description"):
        raw_val = raw_fields.get(key, "")
        if ": " in raw_val and raw_val[:1] not in "\"'":
            err(1, f"{key} có dấu ': ' phải đặt trong ngoặc kép")
        elif key == "title" and ":" in raw_val and raw_val[:1] not in "\"'":
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

    # ---------- Untranslated Vietnamese leak check ----------
    if lang and lang != "vi":
        for fm_key in ("title", "description"):
            if VI_CHAR_RE.search(strip_allowed_vi_contexts(fm.get(fm_key, ""))):
                err(1, f'Front matter "{fm_key}" còn sót ký tự Tiếng Việt chưa dịch')

    # ---------- Body ----------
    in_code, prev_level = False, 1
    refs, defs = {}, {}
    figure_no = 0
    for idx in range(body_start, len(lines)):
        n, line = idx + 1, lines[idx]
        s = line.strip()
        if s.startswith("```") or s.startswith("~~~"):
            if not in_code and idx > body_start and lines[idx - 1].strip() and not lines[idx - 1].lstrip().startswith(("-", "*", "1", ">")):
                warn(n, "Nên có dòng trống trước code block")
            in_code = not in_code
            continue

        if in_code:
            if lang and lang != "vi":
                cleaned = strip_allowed_vi_contexts(line)
                if VI_CHAR_RE.search(cleaned):
                    err(n, "Comment/chuỗi trong code block còn sót ký tự Tiếng Việt chưa dịch")
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

        # Vietnamese leak check in prose (skip reference links / footnote defs which keep source article titles)
        if lang and lang != "vi" and not is_def and not (s.startswith("- ") and "http" in line):
            cleaned = strip_allowed_vi_contexts(line)
            if VI_CHAR_RE.search(cleaned):
                err(n, "Nội dung bản dịch còn sót ký tự Tiếng Việt chưa dịch")

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

    # ---------- Sibling & 1-to-1 Vietnamese Source Parity ----------
    if tid and lang in SUPPORTED_LANGS:
        if all_posts_index is None:
            all_posts_index = index_posts(post.parent)
        siblings = all_posts_index.get(tid, {})
        for s_lang, s_paths in siblings.items():
            if s_lang == lang and any(sp.resolve() != post.resolve() for sp in s_paths):
                others = [sp.name for sp in s_paths if sp.resolve() != post.resolve()]
                err(1, f'Trùng translation_id="{tid}" và cùng lang="{lang}" với {others}')
        if check_source_parity and lang != "vi":
            vi_paths = siblings.get("vi", [])
            if not vi_paths:
                err(1, f'Không tìm thấy bài gốc lang="vi" cho translation_id="{tid}" để đối chiếu 1-1')
            else:
                compare_with_vi_source(fm, lines, body_start, vi_paths[0], errors, warns)

    return {
        "file": post.name,
        "lang": lang,
        "tid": tid,
        "refs": len(refs),
        "defs": len(defs),
        "images": figure_no,
        "size_kb": size_kb,
        "errors": errors,
        "warns": warns,
    }


def index_posts(posts_dir: Path):
    index = defaultdict(lambda: defaultdict(list))
    for p in sorted(posts_dir.glob("*.md")):
        lines = p.read_text(encoding="utf-8").splitlines()[:35]
        fm, _, _ = parse_front_matter(lines)
        tid = fm.get("translation_id")
        lang = fm.get("lang")
        if tid and lang:
            index[tid][lang].append(p)
    return index


def print_result(res, quiet_ok=False):
    if quiet_ok and not res["errors"] and not res["warns"]:
        return
    print(f"== {res['file']} ==")
    print(
        f"lang: {res['lang']} | translation_id: {res['tid']} | "
        f"footnote: {res['refs']}/{res['defs']} | ảnh: {res['images']} | {res['size_kb']:.0f} KB"
    )
    for e in res["errors"]:
        print(f"ERROR {e}")
    for w in res["warns"]:
        print(f"WARN  {w}")
    print("OK, không có ERROR." if not res["errors"] else f"{len(res['errors'])} ERROR cần sửa.")


def check_translation_group(posts_dir: Path, tid: str, index, allow_incomplete=False) -> int:
    lang_map = index.get(tid, {})
    missing = [l for l in SUPPORTED_LANGS if l not in lang_map]
    total_errors = 0

    print(f"\n=== Group: {tid} ({len(SUPPORTED_LANGS) - len(missing)}/{len(SUPPORTED_LANGS)} languages) ===")
    if missing:
        msg = f"Thiếu {len(missing)} ngôn ngữ cho {tid}: {missing}"
        if allow_incomplete:
            print(f"WARN  {msg}")
        else:
            print(f"ERROR {msg}")
            total_errors += 1

    for lang in SUPPORTED_LANGS:
        for p in lang_map.get(lang, []):
            res = check_file(p, index, check_source_parity=True)
            total_errors += len(res["errors"])
            if res["errors"] or res["warns"]:
                print_result(res)
            else:
                print(f"  [OK] {lang:<6} -> {p.name} (footnotes {res['refs']}/{res['defs']}, ảnh {res['images']})")

    return 1 if total_errors else 0


def main():
    parser = argparse.ArgumentParser(description="Kiểm tra bài viết Chirpy đa ngôn ngữ (15 ngôn ngữ)")
    parser.add_argument("post", nargs="?", help="Đường dẫn file bài viết .md trong _posts/")
    parser.add_argument("--all-langs", metavar="TID", help="Kiểm tra đủ 15 ngôn ngữ & đối chiếu 1-1 cho translation_id")
    parser.add_argument("--all", action="store_true", help="Kiểm tra toàn bộ bài viết trong _posts/")
    parser.add_argument("--allow-incomplete", action="store_true", help="Chỉ WARN thay vì ERROR nếu một group chưa đủ 15 ngôn ngữ")
    args = parser.parse_args()

    if args.all_langs or args.all:
        posts_dir = Path("_posts").resolve()
        if not posts_dir.exists():
            print(f"Không tìm thấy thư mục {posts_dir}")
            return 1
        index = index_posts(posts_dir)
        tids = [args.all_langs] if args.all_langs else sorted(index.keys())
        exit_code = 0
        for tid in tids:
            if tid not in index:
                print(f"ERROR Không tìm thấy translation_id='{tid}' trong _posts/")
                exit_code = 1
                continue
            rc = check_translation_group(posts_dir, tid, index, allow_incomplete=args.allow_incomplete)
            if rc != 0:
                exit_code = 1
        return exit_code

    if not args.post:
        parser.print_help()
        return 2

    post = Path(args.post).resolve()
    if not post.exists():
        print(f"Không tìm thấy {post}")
        return 1
    res = check_file(post)
    print_result(res)
    return 1 if res["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
