#!/usr/bin/env bash
# Drives the pen.dev CLI over all eight design batches.
# Batch 01 (the design system) runs first; 02-08 then run in parallel,
# each attaching the exported system sheet as a visual reference.
set -uo pipefail
cd /home/user/SMA

OUT=design
LOGS=$OUT/logs
mkdir -p "$OUT/exports" "$LOGS"

PEN_TIMEOUT=2700   # 45 min per batch
CONCURRENCY=3

run_batch() {
  local id="$1" name="$2"; shift 2
  local log="$LOGS/$id.log"
  {
    echo "=== $id ($name) started $(date -u +%H:%M:%S)"
    timeout "$PEN_TIMEOUT" pen \
      -o "$OUT/$id-$name.pen" \
      -C . \
      "$@" \
      -e "$OUT/exports/$id-$name.png" --export-scale 2 \
      -p "$(cat "$OUT/prompts/$id-$name.txt")"
    echo "=== $id exit=$? finished $(date -u +%H:%M:%S)"
  } >"$log" 2>&1
}

# ---- Batch 01: the design system (everything else references it) ----------
echo "[driver] batch 01 starting $(date -u +%H:%M:%S)"
run_batch 01 design-system -f docs/redesign/DESIGN_SYSTEM.md
echo "[driver] batch 01 done $(date -u +%H:%M:%S)"

SYSREF=()
if [ -f "$OUT/exports/01-design-system.png" ]; then
  SYSREF=(-f "$OUT/exports/01-design-system.png")
  echo "[driver] using exported system sheet as visual reference"
else
  echo "[driver] WARNING: no system export; falling back to the token doc only"
fi
SYSREF+=(-f docs/redesign/DESIGN_SYSTEM.md)

# ---- Batches 02-08: fan out ----------------------------------------------
declare -a BATCHES=(
  "02 core"
  "03 payment"
  "04 states"
  "05 account"
  "06 admin-shell"
  "07 admin-panels"
  "08 admin-ops"
)

for entry in "${BATCHES[@]}"; do
  set -- $entry
  id="$1"; name="$2"
  while [ "$(jobs -rp | wc -l)" -ge "$CONCURRENCY" ]; do wait -n; done
  echo "[driver] batch $id ($name) launched $(date -u +%H:%M:%S)"
  run_batch "$id" "$name" "${SYSREF[@]}" &
done
wait

echo "[driver] ALL BATCHES COMPLETE $(date -u +%H:%M:%S)"
ls -la "$OUT"/*.pen "$OUT/exports/"*.png 2>/dev/null
