#!/usr/bin/env bash
# Finish the WCAG AA correction pass.
#
#  1. The design-system sheet (01) has no colour variables — its swatches are
#     literal fills with the hex printed beneath them, so both must move
#     together. That needs a real edit, not a token rewrite.
#  2. Batches 02-08 were corrected at the variable level by
#     design/apply-contrast-fix.py, so they only need re-exporting for the PNGs
#     to match their sources.
set -uo pipefail
ROOT=/home/user/SMA
cd "$ROOT"
OUT=$ROOT/design
LOGS=$OUT/logs/contrast
mkdir -p "$LOGS"

NOCHANGE='Do not modify this document in any way. Make no edits, no additions, no
deletions, no restyling and no re-layout. Export the document exactly as it is.
The colour tokens in this file were corrected outside the editor and are already
correct — leave every value exactly as you find it.'

echo "[fix] === 01 design-system (real edit) $(date -u +%H:%M:%S)"
{
  timeout 1800 pen \
    -i "$OUT/01-design-system.pen" -o "$OUT/01-design-system.pen" \
    -C "$ROOT" \
    -e "$OUT/exports/01-design-system.png" --export-scale 2 \
    -p "$(cat "$OUT/refine/01-contrast.txt")"
  echo "=== 01 exit=$?"
} >"$LOGS/01.log" 2>&1
echo "[fix] 01 done: $(grep -a 'exit=' "$LOGS/01.log" | tail -1)"

for entry in "02 core" "03 payment" "04 states" "05 account" \
             "06 admin-shell" "07 admin-panels" "08 admin-ops"; do
  set -- $entry
  id="$1"; name="$2"
  echo "[fix] === $id $name (re-export) $(date -u +%H:%M:%S)"
  {
    timeout 900 pen \
      -i "$OUT/$id-$name.pen" -o "$OUT/$id-$name.pen" \
      -C "$ROOT" \
      -e "$OUT/exports/$id-$name.png" --export-scale 2 \
      -p "$NOCHANGE"
    echo "=== $id exit=$?"
  } >"$LOGS/$id.log" 2>&1
  echo "[fix] $id done: $(grep -a 'exit=' "$LOGS/$id.log" | tail -1)"
done

echo "[fix] CONTRAST FIX COMPLETE $(date -u +%H:%M:%S)"
