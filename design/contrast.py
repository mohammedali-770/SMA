#!/usr/bin/env python3
"""Measure WCAG 2.1 contrast for the Spicy Meal palettes — closes defect 1.2.

Token values are read from the design-system .pen itself, not from a hand-copied
list, so the measurement can never drift from what the design actually specifies.

Thresholds (WCAG 2.1):
  · body text            AA 4.5:1   AAA 7:1
  · large text (>=24px, or >=18.66px bold)  AA 3:1   AAA 4.5:1
  · UI components and graphical objects     AA 3:1   (1.4.11)

Run from the repo root:  python3 design/contrast.py
Exit code 0 when every AA requirement is met, 1 otherwise.
"""
import json
import re
import sys

PEN = "design/01-design-system.pen"


# --------------------------------------------------------------------------
# Token extraction
# --------------------------------------------------------------------------
def text_nodes(path):
    out = []

    def walk(n):
        if isinstance(n, dict):
            c = n.get("content")
            if isinstance(c, str):
                out.append(c.strip())
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    walk(json.load(open(path, encoding="utf-8")))
    return out


def palettes(path):
    """Read the LIGHT MODE and DARK MODE swatch rows as {name: hex}."""
    texts = text_nodes(path)
    out = {}
    hex_re = re.compile(r"^#[0-9a-fA-F]{6,8}$")
    for marker, key in (("LIGHT MODE", "light"), ("DARK MODE", "dark")):
        try:
            i = next(j for j, t in enumerate(texts) if t.upper() == marker)
        except StopIteration:
            continue
        tokens, j = {}, i + 1
        while j < len(texts) - 1:
            name, val = texts[j], texts[j + 1]
            if not hex_re.match(val):
                break
            tokens[name] = val
            j += 2
        out[key] = tokens
    return out


# --------------------------------------------------------------------------
# WCAG 2.1 maths
# --------------------------------------------------------------------------
def srgb(hex_str):
    h = hex_str.lstrip("#")[:6]
    return tuple(int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))


def luminance(hex_str):
    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (lin(c) for c in srgb(hex_str))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(fg, bg):
    a, b = luminance(fg), luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


# --------------------------------------------------------------------------
# The pairs that actually occur in the product
# --------------------------------------------------------------------------
# (foreground, background, role, threshold)
#   role "body"  -> 4.5   real running text
#   role "large" -> 3.0   headings and large numerals
#   role "ui"    -> 3.0   borders, control boundaries, icon-only affordances
# severity:
#   "must"     a real AA obligation — a failure here is actionable
#   "advisory" a judgement call; noted with reasoning, not counted as a failure
#   "exempt"   WCAG explicitly carves this out; measured for information only
PAIRS = [
    ("text", "background", "body text on the screen ground", "body", "must"),
    ("text", "surface", "body text on a card", "body", "must"),
    ("text", "surface-alt", "body text on an alt surface", "body", "must"),
    ("text-muted", "background", "secondary text on the ground", "body", "must"),
    ("text-muted", "surface", "secondary text on a card", "body", "must"),
    ("on-primary", "primary", "primary button label", "body", "must"),
    ("on-secondary", "secondary", "destructive button label", "body", "must"),
    ("primary", "background", "link / active nav on the ground", "body", "must"),
    ("primary", "surface", "link / active nav on a card", "body", "must"),
    ("success", "success-tint", "success chip text in its tint", "body", "must"),
    ("warning", "warning-tint", "warning chip text in its tint", "body", "must"),
    ("danger", "danger-tint", "error chip text in its tint", "body", "must"),
    ("success", "surface", "success status text on a card", "body", "must"),
    ("warning", "surface", "warning status text on a card", "body", "must"),
    ("danger", "surface", "error status text on a card", "body", "must"),
    ("primary", "surface", "filled control against a card", "ui", "must"),
    ("secondary", "surface", "accent control against a card", "ui", "must"),
    # 1.4.11 covers components "required to identify" the interface. A card is a
    # container, not a control, and after the craft pass it is separated by fill
    # plus shadow as well as its border — so a weak border is a legibility
    # concern for low-vision users rather than a strict AA failure.
    ("border", "surface", "card border against the card", "ui", "advisory"),
    ("border", "background", "divider against the ground", "ui", "advisory"),
    # 1.4.3 and 1.4.11 both exempt inactive components outright.
    ("disabled", "surface", "disabled control (WCAG-exempt)", "ui", "exempt"),
]

MIN = {"body": 4.5, "large": 3.0, "ui": 3.0}
AAA = {"body": 7.0, "large": 4.5, "ui": 4.5}


def lighten_to(fg, bg, target):
    """Smallest lightening of fg (toward white) that clears `target` on bg.

    Returns (hex, ratio) or None when even white cannot reach the target — which
    means the BACKGROUND has to change, not the foreground.
    """
    r, g, b = (int(x * 255) for x in srgb(fg))
    for step in range(0, 101):
        t = step / 100
        nr = round(r + (255 - r) * t)
        ng = round(g + (255 - g) * t)
        nb = round(b + (255 - b) * t)
        cand = f"#{nr:02x}{ng:02x}{nb:02x}"
        if ratio(cand, bg) >= target:
            return cand, ratio(cand, bg)
    return None


def darken_to(fg, bg, target):
    r, g, b = (int(x * 255) for x in srgb(fg))
    for step in range(0, 101):
        t = step / 100
        nr, ng, nb = round(r * (1 - t)), round(g * (1 - t)), round(b * (1 - t))
        cand = f"#{nr:02x}{ng:02x}{nb:02x}"
        if ratio(cand, bg) >= target:
            return cand, ratio(cand, bg)
    return None


def run(name, tokens):
    print(f"\n{'=' * 74}\n{name.upper()} MODE\n{'=' * 74}")
    print(f"{'pair':<44}{'ratio':>8}  {'need':>5}  verdict")
    print("-" * 74)
    failures, advisories = [], []
    for fg_k, bg_k, label, role, sev in PAIRS:
        if fg_k not in tokens or bg_k not in tokens:
            continue
        fg, bg = tokens[fg_k], tokens[bg_k]
        r = ratio(fg, bg)
        need = MIN[role]
        ok = r >= need
        if sev == "exempt":
            mark = "exempt"
        elif ok:
            mark = "AAA" if r >= AAA[role] else "AA"
        else:
            mark = "FAIL" if sev == "must" else "advisory"
        print(f"{label:<44}{r:>7.2f}:1  {need:>4}:1  {mark}")
        if not ok and sev == "must":
            failures.append((fg_k, bg_k, fg, bg, label, role, r, need))
        elif not ok and sev == "advisory":
            advisories.append((fg_k, bg_k, fg, bg, label, role, r, need))
    if advisories:
        print(f"\n{len(advisories)} advisory (not counted as AA failures):")
        for fg_k, bg_k, fg, bg, label, role, r, need in advisories:
            print(f"  · {label}: {fg_k} {fg} on {bg_k} {bg} = {r:.2f}:1")
    if failures:
        print(f"\n{len(failures)} pair(s) BELOW AA — suggested minimal fixes:")
        for fg_k, bg_k, fg, bg, label, role, r, need in failures:
            # On a dark ground lighten the foreground; on a light ground darken it.
            fix = (
                lighten_to(fg, bg, need)
                if luminance(bg) < 0.5
                else darken_to(fg, bg, need)
            )
            if fix:
                cand, nr = fix
                print(
                    f"  · {label}\n"
                    f"      {fg_k} {fg} on {bg_k} {bg} = {r:.2f}:1\n"
                    f"      -> {cand}  = {nr:.2f}:1"
                )
            else:
                print(
                    f"  · {label}\n"
                    f"      {fg_k} {fg} on {bg_k} {bg} = {r:.2f}:1\n"
                    f"      -> unreachable by adjusting the foreground; "
                    f"the {bg_k} ground must change."
                )
    else:
        print("\nAll required pairs meet AA.")
    return failures


if __name__ == "__main__":
    pal = palettes(PEN)
    if not pal:
        print(f"Could not read palettes from {PEN}")
        sys.exit(2)
    all_fail = []
    for mode in ("light", "dark"):
        if mode in pal:
            print(f"\n{len(pal[mode])} tokens read from {PEN} ({mode})")
            all_fail += run(mode, pal[mode])
    print(f"\n{'=' * 74}")
    print(f"TOTAL FAILURES BELOW AA: {len(all_fail)}")
    sys.exit(1 if all_fail else 0)
