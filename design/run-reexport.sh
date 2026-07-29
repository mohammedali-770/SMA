#!/usr/bin/env bash
# Re-export batches 02-08 so the PNGs match their corrected colour tokens.
#
# The previous attempt told the agent "change nothing, just export" and it timed
# out at 15 minutes — with no task to perform it invented one, writing Bash to
# decode and copy images around. The CLI has no pure-export mode; -e only fires
# at the end of an agent run.
#
# So this gives a small, definite, verifiable task instead: confirm the three
# corrected colour variables hold the expected values. That finishes quickly,
# exports on the way out, and doubles as an independent check of the token edit
# applied by design/apply-contrast-fix.py.
set -uo pipefail
ROOT=/home/user/SMA
cd "$ROOT"
OUT=$ROOT/design
LOGS=$OUT/logs/reexport
mkdir -p "$LOGS"

read -r -d '' TASK <<'EOF'
Verification task — quick, and then you are done.

Check the document's colour variables and report their current values:
  · success  should be #197f45
  · warning  should be #9b6412
  · danger   should be #ce2938
  · secondary should still be #e02d3d   (the fixed brand red — must NOT have changed)

If all four already hold those values, make NO edits and simply say so. If any
differs, set it to the value listed above and say which you changed. Do not
alter anything else in the document — no layout, no copy, no other colour, no
component. Do not write files, run scripts or read anything outside this
document. Answer in two or three lines and stop.
EOF

for entry in "02 core" "03 payment" "04 states" "05 account" \
             "06 admin-shell" "07 admin-panels" "08 admin-ops"; do
  set -- $entry
  id="$1"; name="$2"
  echo "[re] === $id $name $(date -u +%H:%M:%S)"
  {
    timeout 1200 pen \
      -i "$OUT/$id-$name.pen" -o "$OUT/$id-$name.pen" \
      -C "$ROOT" \
      -e "$OUT/exports/$id-$name.png" --export-scale 2 \
      -p "$TASK"
    echo "=== $id exit=$?"
  } >"$LOGS/$id.log" 2>&1
  echo "[re] $id: $(grep -a 'exit=' "$LOGS/$id.log" | tail -1)"
done

echo "[re] REEXPORT COMPLETE $(date -u +%H:%M:%S)"
