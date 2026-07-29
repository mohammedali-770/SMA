#!/usr/bin/env python3
"""Apply the five WCAG AA corrections to the design sources — tokens only.

Measured by design/contrast.py: five light-mode pairs fall below AA 4.5:1.
Each replacement below is the smallest darkening that clears 4.5:1 against
BOTH grounds the colour is used on (its own tint, and a white card).

    success  #1f9d55 -> #197f45   3.13 -> 4.52 on tint, 3.49 -> 5.04 on white
    warning  #c47f17 -> #9b6412   2.99 -> 4.52 on tint, 3.28 -> 4.97 on white
    danger   #e02d3d -> #ce2938   3.94 -> 4.54 on tint, 4.55 -> 5.25 on white

CRITICAL: `danger` and brand `secondary` currently share the value #e02d3d.
The brand red is fixed by owner decision, so only the SEMANTIC token moves.
This script edits variables by NAME, never by blanket hex replacement, so
`secondary` and `primary` are untouched.

Design sources only. apps/mobile/src/theme.ts is deliberately NOT modified —
changing it alters production and is the owner's call.
"""
import glob
import json
import os
import sys

NEW = {"success": "#197f45", "warning": "#9b6412", "danger": "#ce2938"}

# variable name -> which corrected colour it takes
RENAMES = {
    "success": NEW["success"],
    "chip-green-fg": NEW["success"],
    "green-icon-fg": NEW["success"],
    "warning": NEW["warning"],
    "amber-icon-fg": NEW["warning"],
    "danger": NEW["danger"],
    "chip-red-fg": NEW["danger"],
    "red-icon-fg": NEW["danger"],
}

# Never touch these, whatever their value.
PROTECTED = {"primary", "secondary", "on-primary", "on-secondary"}


def patch(path, dry_run=False):
    doc = json.load(open(path, encoding="utf-8"))
    changed = []

    def walk(n):
        if isinstance(n, dict):
            vars_ = n.get("variables")
            if isinstance(vars_, dict):
                for name, spec in vars_.items():
                    if name in PROTECTED or not isinstance(spec, dict):
                        continue
                    want = RENAMES.get(name)
                    old = spec.get("value")
                    if want and isinstance(old, str) and old.lower() != want:
                        changed.append((name, old, want))
                        if not dry_run:
                            spec["value"] = want
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    walk(doc)
    if changed and not dry_run:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=2)
    return changed


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    total = 0
    for path in sorted(glob.glob("design/0[1-8]*.pen")):
        changed = patch(path, dry_run=dry)
        if changed:
            print(f"\n{os.path.basename(path)}")
            for name, old, new in changed:
                print(f"    {name:16s} {old} -> {new}")
            total += len(changed)
        else:
            print(f"\n{os.path.basename(path)}  (no variable tokens to change)")
    print(f"\n{'would change' if dry else 'changed'} {total} variable(s)")
    print("brand tokens left untouched:", ", ".join(sorted(PROTECTED)))
