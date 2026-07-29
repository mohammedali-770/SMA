#!/usr/bin/env bash
# Drives the pen.dev CLI over all eight design batches.
#
# Two hard lessons are baked in:
#   1. Batches run SEQUENTIALLY. Three concurrent pen agents (each spawning its
#      own Claude agent child) peaked around 2 GB and the container restarted,
#      losing the whole run. One at a time is slower and survives.
#   2. Every batch is COMMITTED AND PUSHED the moment it finishes. A restart can
#      now cost at most the single batch that was in flight.
#
# Re-running is safe: a batch whose .pen output already exists is skipped, so
# this doubles as the resume path.
set -uo pipefail
ROOT=/home/user/SMA
cd "$ROOT"

# Every path handed to `pen` MUST be absolute. With a relative -o/-e and an
# image attachment, the CLI completes the design and then dies at the save step
# with "IPCError: Both URIs must be absolute!" — losing the entire run's work
# after the expensive part is already done. Batch 02 was lost this way.
OUT=$ROOT/design
LOGS=$OUT/logs
BRANCH=claude/pen-dev-guidelines-review-6dz4sr
mkdir -p "$OUT/exports" "$LOGS"

PEN_TIMEOUT=2700   # 45 min per batch

publish() {  # $1=id $2=name
  git add -A "$OUT" >/dev/null 2>&1
  if git diff --cached --quiet 2>/dev/null; then
    echo "[driver] nothing to commit for $1"
    return
  fi
  git commit -q -m "design($1): pen.dev output for the $2 batch

Generated with the pen.dev CLI (@pen.dev/cli) against the prompts in
design/prompts/ and the redesign brief in docs/redesign/.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013aE4qAWLr9uZqQniV5Sm13" >/dev/null 2>&1
  local n=0
  until git push -u origin "$BRANCH" >/dev/null 2>&1; do
    n=$((n+1)); [ "$n" -ge 4 ] && { echo "[driver] push FAILED for $1 after 4 tries"; return; }
    sleep $((2**n))
  done
  echo "[driver] committed + pushed $1-$2"
}

run_batch() {  # $1=id $2=name  (remaining args -> pen)
  local id="$1" name="$2"; shift 2
  if [ -f "$OUT/$id-$name.pen" ]; then
    echo "[driver] $id-$name already exists — skipping"
    return 0
  fi
  local log="$LOGS/$id.log"
  {
    echo "=== $id ($name) started $(date -u +%H:%M:%S)"
    timeout "$PEN_TIMEOUT" pen \
      -o "$OUT/$id-$name.pen" \
      -C "$ROOT" \
      "$@" \
      -e "$OUT/exports/$id-$name.png" --export-scale 2 \
      -p "$(cat "$OUT/prompts/$id-$name.txt")"
    echo "=== $id exit=$? finished $(date -u +%H:%M:%S)"
  } >"$log" 2>&1
  publish "$id" "$name"
}

# ---- Batch 01 first: every other batch references its exported sheet --------
echo "[driver] === batch 01 (design-system) $(date -u +%H:%M:%S)"
run_batch 01 design-system -f "$ROOT/docs/redesign/DESIGN_SYSTEM.md"

SYSREF=()
if [ -f "$OUT/exports/01-design-system.png" ]; then
  SYSREF=(-f "$OUT/exports/01-design-system.png")
  echo "[driver] using the exported system sheet as a visual reference"
else
  echo "[driver] WARNING: no system export — falling back to the token doc alone"
fi
SYSREF+=(-f "$ROOT/docs/redesign/DESIGN_SYSTEM.md")

# ---- Batches 02-08, one at a time ------------------------------------------
while read -r id name; do
  [ -z "$id" ] && continue
  echo "[driver] === batch $id ($name) $(date -u +%H:%M:%S)"
  run_batch "$id" "$name" "${SYSREF[@]}"
done <<'BATCHES'
02 core
03 payment
04 states
05 account
06 admin-shell
07 admin-panels
08 admin-ops
BATCHES

echo "[driver] ALL BATCHES COMPLETE $(date -u +%H:%M:%S)"
echo "[driver] pen files: $(ls "$OUT"/0[1-8]*.pen 2>/dev/null | wc -l)/8  exports: $(ls "$OUT/exports"/0[1-8]*.png 2>/dev/null | wc -l)/8"
