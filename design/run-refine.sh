#!/usr/bin/env bash
# Refinement pass: targeted corrections applied IN PLACE to the existing .pen
# files. Nothing is regenerated — each run takes the batch's own file as input
# and writes it back, so approved screens survive and only the listed defects
# change.
#
# Same hard-won constraints as the generation driver: absolute paths everywhere
# (a relative path plus an attachment crashes the save), one batch at a time
# (three concurrent agents exhausted container memory), and a commit + push per
# file so a restart costs at most one batch.
set -uo pipefail
ROOT=/home/user/SMA
cd "$ROOT"

OUT=$ROOT/design
LOGS=$OUT/logs/refine
BRANCH=claude/pen-dev-guidelines-review-6dz4sr
mkdir -p "$LOGS"

PEN_TIMEOUT=2700

publish() {  # $1=id $2=name
  git add -A "$OUT" >/dev/null 2>&1
  git diff --cached --quiet 2>/dev/null && { echo "[refine] nothing to commit for $1"; return; }
  git commit -q -m "design($1): refinement pass on $2

Targeted corrections applied in place with the pen.dev CLI — see
design/refine/$1.txt for the exact instruction set and
docs/redesign/PENDEV_DEFECTS.md for the defects being closed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013aE4qAWLr9uZqQniV5Sm13" >/dev/null 2>&1
  local n=0
  until git push -u origin "$BRANCH" >/dev/null 2>&1; do
    n=$((n+1)); [ "$n" -ge 4 ] && { echo "[refine] push FAILED for $1"; return; }
    sleep $((2**n))
  done
  echo "[refine] committed + pushed $1-$2"
}

refine() {  # $1=id $2=name
  local id="$1" name="$2"
  local pen="$OUT/$id-$name.pen"
  [ -f "$pen" ] || { echo "[refine] $pen missing — skipping"; return; }
  local log="$LOGS/$id.log"
  {
    echo "=== $id ($name) refine started $(date -u +%H:%M:%S)"
    timeout "$PEN_TIMEOUT" pen \
      -i "$pen" -o "$pen" \
      -C "$ROOT" \
      -e "$OUT/exports/$id-$name.png" --export-scale 2 \
      -p "$(cat "$OUT/refine/$id.txt")"
    echo "=== $id exit=$? finished $(date -u +%H:%M:%S)"
  } >"$log" 2>&1
  publish "$id" "$name"
}

# Shared components first: the sidebar and tab-bar defects are the ones that
# make two batches depict two different products, so they land before the
# per-screen copy and craft work.
while read -r id name; do
  [ -z "$id" ] && continue
  echo "[refine] === $id ($name) $(date -u +%H:%M:%S)"
  refine "$id" "$name"
done <<'BATCHES'
07 admin-panels
08 admin-ops
06 admin-shell
05 account
02 core
04 states
03 payment
01 design-system
BATCHES

echo "[refine] ALL REFINEMENTS COMPLETE $(date -u +%H:%M:%S)"
grep -h "exit=" "$LOGS"/*.log 2>/dev/null
