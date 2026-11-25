#!/usr/bin/env python3
"""Tách ảnh nhúng ra file.

Nguồn hỗ trợ:
  - .md   : các dòng định nghĩa `[imageN]: <data:image/png;base64,...>` (kiểu Google Docs).
            Tên file khớp 1-1 với placeholder `![][imageN]`.
  - .docx : các file trong `word/media/`. Thứ tự KHÔNG đảm bảo khớp với placeholder trong .md.

Ví dụ:
  python extract_images.py _posts/2026-10-22-bai.md --out assets/img/posts/2026-10-22
  python extract_images.py _posts/2026-10-22-bai.md --out assets/img/posts/2026-10-22 --strip
  python extract_images.py "Tai lieu.docx" --out assets/img/posts/2026-10-22
"""
import argparse
import base64
import re
import sys
import zipfile
from pathlib import Path

# Đảm bảo UTF-8 trên Windows console
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

DEF_RE = re.compile(r"^\[(image\d+)\]:\s*<data:image/([\w.+-]+);base64,([^>]+)>[ \t]*\r?$", re.M)
PLACEHOLDER_RE = re.compile(r"!\[[^\]]*\]\[(image\d+)\]")
HEADING_RE = re.compile(r"^#{1,6}\s+(.*)$")


def natural_key(name: str):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", name)]


def from_docx(src: Path, out: Path) -> None:
    with zipfile.ZipFile(src) as z:
        media = sorted((n for n in z.namelist() if n.startswith("word/media/")), key=natural_key)
        if not media:
            print("Không có ảnh trong word/media/")
            return
        for name in media:
            data = z.read(name)
            target = out / Path(name).name
            target.write_bytes(data)
            print(f"{Path(name).name}\t{len(data):>9,} bytes -> {target}")
    print("\nLƯU Ý: thứ tự ảnh trong docx có thể khác thứ tự placeholder. Mở từng ảnh để xác minh.")


def from_markdown(src: Path, out: Path, strip: bool) -> None:
    text = src.read_bytes().decode("utf-8")
    defs = DEF_RE.findall(text)
    if not defs:
        print("Không tìm thấy định nghĩa [imageN]: <data:image/...> trong file.")
        return

    # Vị trí placeholder + tiêu đề gần nhất, giúp đặt tên/caption.
    lines = text.splitlines()
    heading = "(đầu bài)"
    where = {}
    for i, line in enumerate(lines, start=1):
        h = HEADING_RE.match(line)
        if h:
            heading = h.group(1).replace("**", "").strip()
        for ref in PLACEHOLDER_RE.findall(line):
            where.setdefault(ref, []).append(f"L{i} trong mục '{heading}'")

    for name, ext, payload in defs:
        ext = {"jpeg": "jpg", "svg+xml": "svg"}.get(ext, ext)
        data = base64.b64decode(re.sub(r"\s+", "", payload))
        target = out / f"{name}.{ext}"
        target.write_bytes(data)
        loc = "; ".join(where.get(name, ["(không có placeholder nào dùng ảnh này)"]))
        print(f"{name}.{ext}\t{len(data):>9,} bytes -> {target}\t[{loc}]")

    if strip:
        new = DEF_RE.sub("", text)
        new = re.sub(r"(\r?\n)\s*$", r"\1", new.rstrip()) + ("\r\n" if "\r\n" in text else "\n")
        src.write_bytes(new.encode("utf-8"))
        print(f"\nĐã xóa {len(defs)} dòng base64 khỏi {src} ({len(text):,} -> {len(new):,} ký tự).")
    print("\nTiếp theo: mở từng ảnh để xem nội dung, đổi tên file theo nội dung, rồi thay placeholder.")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", type=Path, help="File .md hoặc .docx")
    ap.add_argument("--out", type=Path, required=True, help="Thư mục đích, ví dụ assets/img/posts/2026-10-22")
    ap.add_argument("--strip", action="store_true", help="(.md) Xóa các dòng base64 khỏi file sau khi tách")
    args = ap.parse_args()

    if not args.source.exists():
        print(f"Không tìm thấy {args.source}", file=sys.stderr)
        return 1
    args.out.mkdir(parents=True, exist_ok=True)
    suffix = args.source.suffix.lower()
    if suffix == ".docx":
        from_docx(args.source, args.out)
    elif suffix in (".md", ".markdown"):
        from_markdown(args.source, args.out, args.strip)
    else:
        print("Chỉ hỗ trợ .md hoặc .docx", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
