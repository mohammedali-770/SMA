#!/usr/bin/env python3
"""Downscale pen.dev's 2x PNG exports into shareable JPEGs.

The raw exports are large (the design-system sheet is 4667x8192, 1.25 MB) and
get rejected by chat/upload size limits. This produces a `web/` sibling
directory with a full-sheet JPEG plus, for very tall sheets, readable slices.

Usage:
    python3 design/make-web-exports.py [export.png ...]

With no arguments it processes every 0N-*.png in design/exports/.
"""
import os
import sys
from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # these sheets are legitimately huge

SRC_DIR = "design/exports"
OUT_DIR = os.path.join(SRC_DIR, "web")
FULL_WIDTH = 1600
SLICE_WIDTH = 1800
# Slice a sheet whose height exceeds this multiple of its width.
TALL_RATIO = 2.2


def emit(img: Image.Image, path: str, width: int, quality: int) -> None:
    height = int(img.height * width / img.width)
    img.resize((width, height), Image.LANCZOS).save(
        path, "JPEG", quality=quality, optimize=True
    )
    print(f"  {os.path.basename(path):32s} {width}x{height}  {os.path.getsize(path)/1e6:.2f} MB")


def process(src: str) -> None:
    stem = os.path.splitext(os.path.basename(src))[0]
    img = Image.open(src).convert("RGB")
    print(f"{stem}: {img.width}x{img.height}  {os.path.getsize(src)/1e6:.2f} MB")

    emit(img, os.path.join(OUT_DIR, f"{stem}.jpg"), FULL_WIDTH, 82)

    if img.height / img.width > TALL_RATIO:
        # Overlap the halves slightly so nothing is lost at the seam.
        top = img.crop((0, 0, img.width, int(img.height * 0.52)))
        bottom = img.crop((0, int(img.height * 0.50), img.width, img.height))
        emit(top, os.path.join(OUT_DIR, f"{stem}-a.jpg"), SLICE_WIDTH, 84)
        emit(bottom, os.path.join(OUT_DIR, f"{stem}-b.jpg"), SLICE_WIDTH, 84)


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    args = sys.argv[1:]
    if not args:
        args = sorted(
            os.path.join(SRC_DIR, f)
            for f in os.listdir(SRC_DIR)
            if f.endswith(".png") and f[:2].isdigit() and f[:2] != "00"
        )
    if not args:
        print("no exports found", file=sys.stderr)
        return 1
    for src in args:
        process(src)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
