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


def artboard_bands(img: Image.Image, axis: str = "x", pad: int = 24):
    """Split a sheet on the dark gutters between artboards.

    pen.dev lays a batch out as artboards on a dark canvas, either in a row or a
    column. Cutting into equal parts slices screens mid-content; cutting on the
    gutters keeps each screen whole. `axis` is "x" for a wide sheet (vertical
    gutters) or "y" for a tall one (horizontal gutters). Returns None when there
    are no usable gutters, so the caller can fall back to equal parts.
    """
    horizontal = axis == "x"
    span = img.width if horizontal else img.height
    cross = img.height if horizontal else img.width
    rgb = img.convert("RGB")
    px = rgb.load()

    # The canvas colour is whatever dominates the sheet's outer border. Matching
    # it exactly is the only reliable test: a DARK-MODE artboard averages out to
    # the same luminance as empty canvas, so any brightness threshold merges the
    # two and silently drops the dark screen from the output.
    border = []
    for i in range(0, span, max(1, span // 200)):
        border.append(px[i, 0] if horizontal else px[0, i])
        border.append(px[i, cross - 1] if horizontal else px[cross - 1, i])
    canvas = max(set(border), key=border.count)

    def is_canvas(c):
        return all(abs(a - b) <= 10 for a, b in zip(c, canvas))

    step_cross = max(1, cross // 120)
    step_span = max(1, span // 1200)
    gutter_at = {}
    for i in range(0, span, step_span):
        gutter_at[i] = all(
            is_canvas(px[i, j] if horizontal else px[j, i])
            for j in range(0, cross, step_cross)
        )
    keys = sorted(gutter_at)
    n = len(keys)
    gutter = [gutter_at[k] for k in keys]
    if not any(gutter) or all(gutter):
        return None

    bands, run = [], None
    for i in range(n):
        if not gutter[i] and run is None:
            run = i
        elif gutter[i] and run is not None:
            bands.append((run, i))
            run = None
    if run is not None:
        bands.append((run, n))

    out = []
    for a, b in bands:
        lo = max(0, keys[a] - pad)
        hi = min(span, (keys[b] if b < n else span) + pad)
        # Ignore slivers — label text and stray scratch geometry.
        if hi - lo > cross * 0.25:
            out.append((lo, hi))
    return out or None


MAX_HEIGHT = 2200


def emit(img: Image.Image, path: str, width: int, quality: int) -> None:
    height = int(img.height * width / img.width)
    # A single phone artboard scaled to the full slice width comes out absurdly
    # tall; cap the long edge so tall bands stay viewable.
    if height > MAX_HEIGHT:
        width = int(width * MAX_HEIGHT / height)
        height = MAX_HEIGHT
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

    if aspect > WIDE_RATIO:
        bands = artboard_bands(img, "x") or equal_bands(img, aspect)
        for i, (lo, hi) in enumerate(bands):
            part = img.crop((lo, 0, hi, img.height))
            emit(part, os.path.join(OUT_DIR, f"{stem}-{chr(ord('a') + i)}.jpg"), SLICE_WIDTH, 84)

    elif 1 / aspect > TALL_RATIO or (bands := artboard_bands(img, "y")):
        # A tall sheet is either stacked artboards (split on their gutters) or
        # one long sheet (split into overlapping halves).
        if not bands:
            bands = [(0, int(img.height * 0.52)), (int(img.height * 0.50), img.height)]
        for i, (lo, hi) in enumerate(bands):
            part = img.crop((0, lo, img.width, hi))
            emit(part, os.path.join(OUT_DIR, f"{stem}-{chr(ord('a') + i)}.jpg"), SLICE_WIDTH, 84)


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
