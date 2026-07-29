#!/usr/bin/env bash
# Resume only the batches whose refinement failed.
#
# Both runs aborted at 11:16 UTC on a session rate limit ("You've hit your
# session limit"), before the agent reached its save step — so those .pen files
# are byte-identical to their pre-refinement state and simply need re-running.
# Everything else in the refinement pass completed and is already pushed.
set -uo pipefail
ROOT=/home/user/SMA
cd "$ROOT"
OUT=$ROOT/design
LOGS=$OUT/logs/refine
mkdir -p "$LOGS"

publish() {  # $1=id $2=name
  git add -A "$OUT" >/dev/null 2>&1
  if git diff --cached --quiet 2>/dev/null; then
    echo "[resume] nothing to commit for $1"
    return
  fi
  git commit -q -m "design($1): refinement pass on $2 (resumed after rate limit)

The first attempt aborted on a session rate limit before saving, leaving
the file unchanged. Same instruction set as the rest of the pass — see
design/refine/$1.txt.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013aE4qAWLr9uZqQniV5Sm13" >/dev/null 2>&1
  local n=0
  until git push -u origin claude/pen-dev-guidelines-review-6dz4sr >/dev/null 2>&1; do
    n=$((n + 1))
    if [ "$n" -ge 4 ]; then
      echo "[resume] push FAILED for $1"
      return
    fi
    sleep $((2 ** n))
  done
  echo "[resume] committed + pushed $1-$2"
}

run_one() {  # $1=id $2=name
  local id="$1" name="$2"
  echo "[resume] === $id ($name) $(date -u +%H:%M:%S)"
  {
    echo "=== $id ($name) resume started $(date -u +%H:%M:%S)"
    timeout 2700 pen \
      -i "$OUT/$id-$name.pen" -o "$OUT/$id-$name.pen" \
      -C "$ROOT" \
      -e "$OUT/exports/$id-$name.png" --export-scale 2 \
      -p "$(cat "$OUT/refine/$id.txt")"
    echo "=== $id exit=$? finished $(date -u +%H:%M:%S)"
  } >"$LOGS/$id.log" 2>&1
  publish "$id" "$name"
}

run_one 03 payment
run_one 01 design-system

echo "[resume] RESUME COMPLETE $(date -u +%H:%M:%S)"
grep -h "exit=" "$LOGS"/0[13].log 2>/dev/null
