#!/usr/bin/env bash
# ============================================================================
# Tests for protect-default-branch.sh
#
# The guard is run against THROWAWAY repositories in a temp directory, so the
# real repository is never touched and no test can move a real ref.
#
# Parser availability is controlled by building a scenario-specific PATH.
# That is how the jq / python3 / node branches, the broken-interpreter
# fallback and the no-parser branch are each exercised independently.
#
# Usage:  bash .claude/hooks/test-protect-default-branch.sh
# Exit 0 = every assertion passed.
# ============================================================================

set -u

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HOOK_DIR/protect-default-branch.sh"
[ -f "$HOOK" ] || { echo "cannot find $HOOK"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

# --- payloads ---------------------------------------------------------------
P_WRITE='{"tool_name":"Write","tool_input":{"file_path":"x","content":"y"}}'
P_BASH_SAFE='{"tool_name":"Bash","tool_input":{"command":"git status"}}'
P_BASH_PROT='{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}'
P_MALFORMED='{"tool_name":"Write","tool_input":'
P_NOTOOL='{"tool_input":{"file_path":"x"}}'

# --- throwaway repositories -------------------------------------------------
mkrepo() {
  local d="$1" br="$2"
  mkdir -p "$d"
  git -C "$d" init -q
  git -C "$d" config user.email guard-test@example.invalid
  git -C "$d" config user.name guard-test
  git -C "$d" config commit.gpgsign false
  printf 'seed\n' > "$d/seed"
  git -C "$d" add seed
  git -C "$d" commit -qm seed
  git -C "$d" checkout -q -B "$br"
}

REPO_PROT="$TMP/protected"
REPO_FEAT="$TMP/feature"
mkrepo "$REPO_PROT" main
mkrepo "$REPO_FEAT" feature/guard-test

# --- parser isolation -------------------------------------------------------
# The base PATH must contain ONLY the external commands the guard genuinely
# invokes. An earlier version used "/usr/bin:/bin:<git dir>", which is not
# isolation at all: on most Linux/macOS systems /usr/bin ships python3 (and
# often jq), so
#   * the no-parser scenarios could still reach a real parser, meaning they
#     were not testing "no working parser"; and
#   * worse, the node-only scenario would silently be served by /usr/bin's
#     python3 — the guard consults python3 before node — so the node branch
#     was never actually exercised and the suite passed for the wrong reason.
#
# Every entry below is an explicit shim that execs one absolute path, so the
# ambient environment cannot leak a parser into any scenario.
NODE_ABS="$(command -v node || true)"
PY_ABS="$(command -v python3 || true)"
BASH_ABS="$(command -v bash || true)"
[ -n "$BASH_ABS" ] || { echo "cannot locate bash"; exit 1; }

link_real() {
  cat > "$1/$2" <<EOF
#!/bin/sh
exec "$3" "\$@"
EOF
  chmod +x "$1/$2"
}

# Commands the guard actually runs. Names such as awk/sort/find/uniq appear in
# the guard only as literal strings inside its allowlist and deny regexes;
# they are never invoked, so they are deliberately absent here.
REQUIRED_TOOLS='git grep sed tr cat'

BASE_BIN="$TMP/base-bin"
mkdir -p "$BASE_BIN"
MISSING=''
for t in $REQUIRED_TOOLS; do
  abs="$(command -v "$t" || true)"
  if [ -z "$abs" ]; then
    MISSING="$MISSING $t"
  else
    link_real "$BASE_BIN" "$t" "$abs"
  fi
done
if [ -n "$MISSING" ]; then
  printf 'cannot build an isolated PATH; missing required command(s):%s\n' "$MISSING"
  exit 1
fi
BASE_PATH="$BASE_BIN"

# Isolation is a hard precondition, not a warning: if a parser is reachable
# from the base PATH then the no-parser and single-parser scenarios below are
# meaningless, so refuse to report misleading passes.
for t in jq python3 node; do
  if PATH="$BASE_PATH" command -v "$t" >/dev/null 2>&1; then
    printf 'ISOLATION FAILURE: %s is reachable from the isolated base PATH\n' "$t"
    exit 1
  fi
done

# A jq test double covering exactly the three invocations the guard makes.
# It delegates to node via an ABSOLUTE path so it still works in the jq-only
# scenario, where node is deliberately off the guard's PATH.
make_fake_jq() {
  local dir="$1"
  cat > "$dir/jq" <<EOF
#!/bin/sh
NODE="$NODE_ABS"
EOF
  cat >> "$dir/jq" <<'EOF'
if [ "$1" = "-e" ]; then
  "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);if(v===null||v===false)process.exit(1)})'
  exit $?
fi
if [ "$1" = "-r" ]; then
  case "$2" in
    ".tool_name // empty") K=tool_name ;;
    ".tool_input.command // empty") K=tool_command ;;
    *) exit 1 ;;
  esac
  "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);let v;if(process.argv[1]==="tool_name"){v=o.tool_name}else{const t=o.tool_input;v=(t&&typeof t==="object")?t.command:undefined}process.stdout.write(typeof v==="string"?v:"")})' "$K"
  exit $?
fi
exit 1
EOF
  chmod +x "$dir/jq"
}

# Reproduces the Windows failure that motivated this change: a python3 that
# EXISTS and is executable (so `command -v` succeeds) but never runs Python.
make_broken_python3() {
  cat > "$1/python3" <<'EOF'
#!/bin/sh
echo "Python was not found; run without arguments to install from the Microsoft Store" >&2
exit 9009
EOF
  chmod +x "$1/python3"
}

# --- assertions -------------------------------------------------------------
# The guard is launched through an ABSOLUTE bash path. The scenario PATH is
# what the guard itself sees, and it must not have to contain the interpreter
# used to start it — otherwise an isolated PATH makes `bash "$HOOK"` fail with
# 127, the guard never runs, and its empty output is indistinguishable from an
# ALLOW. That is a silent false pass, so the exit status is checked too.
HOOK_OUT=''
HOOK_RC=0
HOOK_ERR_FILE="$TMP/hook-stderr"

run_hook() {
  HOOK_OUT="$(printf '%s' "$1" | CLAUDE_PROJECT_DIR="$2" PATH="$3" "$BASH_ABS" "$HOOK" 2>"$HOOK_ERR_FILE")"
  HOOK_RC=$?
}

launch_failed() {
  [ "$HOOK_RC" -ne 0 ] && {
    FAIL=$((FAIL + 1))
    printf '  FAIL %s -> guard exited %d (did it run?): %s\n' \
      "$1" "$HOOK_RC" "$(tr '\n' ' ' < "$HOOK_ERR_FILE")"
    return 0
  }
  return 1
}

assert_allow() {
  run_hook "$2" "$3" "$4"
  launch_failed "$1" && return
  if [ -z "$HOOK_OUT" ]; then
    PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"
  else
    FAIL=$((FAIL + 1)); printf '  FAIL %s -> expected ALLOW, got: %s\n' "$1" "$HOOK_OUT"
  fi
}

assert_deny() {
  run_hook "$2" "$3" "$4"
  launch_failed "$1" && return
  if printf '%s' "$HOOK_OUT" | grep -q '"permissionDecision":"deny"' \
    && printf '%s' "$HOOK_OUT" | grep -Eq "$5"; then
    PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"
  else
    FAIL=$((FAIL + 1)); printf '  FAIL %s -> expected DENY matching /%s/, got: %s\n' "$1" "$5" "$HOOK_OUT"
  fi
}

# Asserts a scenario's PATH really lacks the named commands. Without this the
# no-parser assertions could pass for the wrong reason (or silently test a
# different parser than the one they name).
assert_unreachable() {
  local label="$1" p="$2"
  shift 2
  local t bad=''
  for t in "$@"; do
    PATH="$p" command -v "$t" >/dev/null 2>&1 && bad="$bad $t"
  done
  if [ -z "$bad" ]; then
    PASS=$((PASS + 1)); printf '  ok   %s\n' "$label"
  else
    FAIL=$((FAIL + 1)); printf '  FAIL %s -> unexpectedly reachable:%s\n' "$label" "$bad"
  fi
}

# Every parser must produce identical decisions: the parser is an
# implementation detail, never a difference in what the guard permits.
parser_suite() {
  local label="$1" p="$2"
  printf -- '-- parser: %s\n' "$label"
  assert_allow "$label: feature branch, Write allowed"          "$P_WRITE"     "$REPO_FEAT" "$p"
  assert_allow "$label: feature branch, read-only Bash allowed" "$P_BASH_SAFE" "$REPO_FEAT" "$p"
  assert_deny  "$label: push to protected ref denied"           "$P_BASH_PROT" "$REPO_FEAT" "$p" 'protected branch'
  assert_deny  "$label: malformed JSON fails closed"            "$P_MALFORMED" "$REPO_FEAT" "$p" 'unparseable'
  assert_deny  "$label: missing tool_name fails closed"         "$P_NOTOOL"    "$REPO_FEAT" "$p" 'no tool_name'
  assert_deny  "$label: protected branch, Write denied"         "$P_WRITE"     "$REPO_PROT" "$p" 'protected branch'
}

# --- scenarios --------------------------------------------------------------
BIN_JQ="$TMP/bin-jq";     mkdir -p "$BIN_JQ"
BIN_PY="$TMP/bin-py";     mkdir -p "$BIN_PY"
BIN_NODE="$TMP/bin-node"; mkdir -p "$BIN_NODE"
BIN_STUB="$TMP/bin-stub"; mkdir -p "$BIN_STUB"
BIN_NONE="$TMP/bin-none"; mkdir -p "$BIN_NONE"

if [ -n "$NODE_ABS" ]; then
  make_fake_jq "$BIN_JQ"
  parser_suite "jq" "$BIN_JQ:$BASE_PATH"
else
  printf '  skip jq suite (needs node to back the jq test double)\n'
fi

if [ -n "$PY_ABS" ]; then
  link_real "$BIN_PY" python3 "$PY_ABS"
  parser_suite "python3" "$BIN_PY:$BASE_PATH"
else
  printf '  skip python3 suite (python3 unavailable)\n'
fi

if [ -n "$NODE_ABS" ]; then
  link_real "$BIN_NODE" node "$NODE_ABS"
  parser_suite "node" "$BIN_NODE:$BASE_PATH"
else
  printf '  skip node suite (node unavailable)\n'
fi

printf -- '-- fallback and failure modes\n'

if [ -n "$NODE_ABS" ]; then
  # The regression this change exists for.
  make_broken_python3 "$BIN_STUB"
  link_real "$BIN_STUB" node "$NODE_ABS"
  assert_allow "broken python3 stub falls through to node"      "$P_WRITE" "$REPO_FEAT" "$BIN_STUB:$BASE_PATH"
  assert_deny  "broken stub + node still denies on protected"   "$P_WRITE" "$REPO_PROT" "$BIN_STUB:$BASE_PATH" 'protected branch'
  assert_deny  "broken stub + node still fails closed on junk"  "$P_MALFORMED" "$REPO_FEAT" "$BIN_STUB:$BASE_PATH" 'unparseable'
  assert_deny  "empty input fails closed"                       ""         "$REPO_FEAT" "$BIN_NODE:$BASE_PATH" 'empty PreToolUse input'
fi

# No parser at all must fail closed rather than fall through to allow. Each
# scenario proves its own precondition first, so a leaked ambient parser shows
# up as an explicit isolation failure instead of a misleading pass.
assert_unreachable "no-parser scenario really exposes no parser" "$BIN_NONE:$BASE_PATH" jq python3 node
assert_deny "no working parser fails closed" "$P_WRITE" "$REPO_FEAT" "$BIN_NONE:$BASE_PATH" 'no working JSON parser'

# A broken python3 with NO jq and NO node behind it is still "no working
# parser": the guard must not fall through to allow merely because a parser
# NAME resolved. Kept in its own directory so the scenario above stays clean.
BIN_STUBONLY="$TMP/bin-stub-only"; mkdir -p "$BIN_STUBONLY"
make_broken_python3 "$BIN_STUBONLY"
assert_unreachable "broken-stub scenario exposes no jq and no node" "$BIN_STUBONLY:$BASE_PATH" jq node
assert_deny "broken python3 alone fails closed" "$P_WRITE" "$REPO_FEAT" "$BIN_STUBONLY:$BASE_PATH" 'no working JSON parser'

# --- summary ----------------------------------------------------------------
printf -- '----\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
