#!/usr/bin/env python3
"""Verify the refinement pass against the defect log.

Checks the .pen sources directly rather than eyeballing exports, so each result
is reproducible evidence rather than an impression. Run from the repo root:

    python3 design/verify.py

Exit code is 0 when every check passes, 1 otherwise.
"""
import glob
import json
import os
import re
import sys

DESIGN = "design"
ARABIC_INDIC = re.compile("[٠-٩]")

CUSTOMER = ["02-core", "03-payment", "04-states", "05-account"]
ADMIN = ["06-admin-shell", "07-admin-panels", "08-admin-ops"]

# The real admin navigation. Any other tab label is invented.
CANONICAL_TABS = [
    "Sales Overview", "Live Orders", "Menu Management", "Banners",
    "Branch Management", "Financial Reports", "Integrations",
    "Operations Health", "Operations Alerts", "Order Integrity",
    "Settings", "Legal Documents",
]
INVENTED_TABS = ["Customers", "Promotions", "Legal Docs", "Dashboard"]

# Instruction text that leaked from prompts into visible copy.
LEAKED = ["No payment language", "Awaiting branch assignment"]

# System constraints that must survive any refinement. Losing one of these means
# a real rule was replaced with generic dashboard content.
PROTECTED = {
    "04-states": ["Order confirmed", "please do not re-order", "nothing to refund"],
    "06-admin-shell": ["VAT incl", "awaiting POS", "Dormant"],
    "07-admin-panels": ["external delivery is disabled", "Required"],
    "08-admin-ops": [
        "no retry, refund, resend or mark-paid",
        "Disabling both payment methods stops checkout",
        "Dormant",
    ],
    # Arabic screens carry the Arabic VAT label, not the Latin "VAT".
    "03-payment": ["ضريبة القيمة المضافة", "خصم الولاء"],
}

results = []


def check(name, ok, detail=""):
    results.append((ok, name, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""))


def load(stem):
    path = os.path.join(DESIGN, f"{stem}.pen")
    return path, open(path, encoding="utf-8").read() if os.path.exists(path) else None


def strings_of(raw):
    """Every visible text value in the document."""
    out = []

    def walk(n):
        if isinstance(n, dict):
            for k, v in n.items():
                if k in ("content", "text", "characters") and isinstance(v, str):
                    out.append(v)
                else:
                    walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)

    try:
        walk(json.loads(raw))
    except Exception:
        pass
    return out


print("\n1. Western numerals everywhere")
for path in sorted(glob.glob(f"{DESIGN}/0[1-8]*.pen")):
    raw = open(path, encoding="utf-8").read()
    hits = ARABIC_INDIC.findall(raw)
    check(os.path.basename(path), not hits, f"{len(hits)} Arabic-Indic digits" if hits else "")

print("\n2. Admin sidebar identical across batches")
for stem in ADMIN:
    path, raw = load(stem)
    if raw is None:
        check(stem, False, "file missing")
        continue
    present = [t for t in CANONICAL_TABS if t in raw]
    invented = [t for t in INVENTED_TABS if re.search(rf'"{t}"', raw)]
    ok = len(present) == len(CANONICAL_TABS) and not invented
    detail = ""
    if len(present) != len(CANONICAL_TABS):
        detail = f"missing {sorted(set(CANONICAL_TABS) - set(present))}"
    if invented:
        detail += f" invented {invented}"
    check(f"{stem}: 12 canonical tabs, no invented", ok, detail.strip())

print("\n3. Customer tab bar — no invented Menu tab")
for stem in ["02-core", "05-account"]:
    path, raw = load(stem)
    if raw is None:
        continue
    has_menu_tab = '"القائمة"' in raw
    has_orders = "طلباتي" in raw
    check(f"{stem}: طلباتي present, القائمة absent", has_orders and not has_menu_tab,
          ("القائمة tab still present" if has_menu_tab else "") or
          ("طلباتي missing" if not has_orders else ""))

print("\n4. No leaked prompt/instruction text")
for path in sorted(glob.glob(f"{DESIGN}/0[1-8]*.pen")):
    raw = open(path, encoding="utf-8").read()
    found = [s for s in LEAKED if s in raw]
    check(os.path.basename(path), not found, ", ".join(found))

print("\n5. System constraints preserved")
for stem, needles in PROTECTED.items():
    path, raw = load(stem)
    if raw is None:
        continue
    low = raw.lower()
    missing = [n for n in needles if n.lower() not in low]
    check(f"{stem}: {len(needles)} constraint strings", not missing, f"missing {missing}" if missing else "")

print("\n6. Component libraries intact (definitions still referenced)")
for path in sorted(glob.glob(f"{DESIGN}/0[1-8]*.pen")):
    raw = open(path, encoding="utf-8").read()
    defs = raw.count('"reusable": true')
    refs = raw.count('"ref"')
    check(os.path.basename(path), defs == 0 or refs > 0,
          f"{defs} definitions, {refs} instance refs")

failed = [r for r in results if not r[0]]
print(f"\n{'=' * 60}\n{len(results) - len(failed)}/{len(results)} checks passed")
if failed:
    print("\nFailures:")
    for _, name, detail in failed:
        print(f"  · {name} {detail}")
sys.exit(1 if failed else 0)
