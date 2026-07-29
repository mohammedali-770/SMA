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
# Slice a sheet whose width exceeds this multiple of its height. A row of seven
# phone screens comes out around 8192x2012 (aspect 4.1); fit to width and every
# screen is thumbnail-sized, so cut it into legible columns instead.
WIDE_RATIO = 2.0
# Aim each wide slice at roughly this aspect so screens stay readable.
TARGET_SLICE_ASPECT = 1.5


def equal_bands(img: Image.Image, aspect: float):
    """Fallback: cut a wide sheet into equal columns with a small overlap."""
    n = max(2, round(aspect / TARGET_SLICE_ASPECT))
    step = img.width / n
    over = int(step * 0.03)
    return [
        (
            max(0, int(i * step) - (over if i else 0)),
            min(img.width, int((i + 1) * step) + (over if i < n - 1 else 0)),
        )
        for i in range(n)
    ]


def artboard_bands(img: Image.Image, pad: int = 24):
    """Split a wide sheet on the dark gutters between artboards.

    pen.dev lays a batch out as artboards on a dark canvas. Cutting into equal
    columns slices screens mid-content; cutting on the gutters keeps each screen
    whole. Returns None when the sheet has no usable gutters (e.g. one solid
    artboard), so the caller can fall back to equal columns.
    """
    small = img.convert("L").resize((img.width // 8, 64), Image.BILINEAR)
    w = small.width
    px = small.load()
    # A column is "gutter" when every sampled pixel is near-black.
    gutter = [max(px[x, y] for y in range(small.height)) < 40 for x in range(w)]
    if not any(gutter) or all(gutter):
        return None

    bands, run = [], None
    for x in range(w):
        if not gutter[x] and run is None:
            run = x
        elif gutter[x] and run is not None:
            bands.append((run, x))
            run = None
    if run is not None:
        bands.append((run, w))

    scale = img.width / w
    out = []
    for a, b in bands:
        left = max(0, int(a * scale) - pad)
        right = min(img.width, int(b * scale) + pad)
        # Ignore slivers — label text and stray scratch geometry.
        if right - left > img.height * 0.25:
            out.append((left, right))
    return out or None


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

    aspect = img.width / img.height

    if img.height / img.width > TALL_RATIO:
        # Overlap the halves slightly so nothing is lost at the seam.
        top = img.crop((0, 0, img.width, int(img.height * 0.52)))
        bottom = img.crop((0, int(img.height * 0.50), img.width, img.height))
        emit(top, os.path.join(OUT_DIR, f"{stem}-a.jpg"), SLICE_WIDTH, 84)
        emit(bottom, os.path.join(OUT_DIR, f"{stem}-b.jpg"), SLICE_WIDTH, 84)

    elif aspect > WIDE_RATIO:
        bands = artboard_bands(img) or equal_bands(img, aspect)
        for i, (left, right) in enumerate(bands):
            part = img.crop((left, 0, right, img.height))
            label = chr(ord("a") + i)
            emit(part, os.path.join(OUT_DIR, f"{stem}-{label}.jpg"), SLICE_WIDTH, 84)


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
