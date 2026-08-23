#!/usr/bin/env bash
# ============================================================================
# Spicy Meal (SMA) — protected-branch change-control guard
#
# Claude Code PreToolUse hook. Registered in .claude/settings.json for the
# Bash, Edit, Write, MultiEdit and NotebookEdit tools.
#
# Purpose (see CLAUDE.md):
#   1. While a PROTECTED branch is checked out, deny every tool call that can
#      modify repository state (file writes, git state changes, package/skill
#      installs, output redirection, interpreters). Only read-only inspection
#      commands are allowed.
#   2. From ANY branch, deny git commands that push to, update, delete or
#      force-move a protected ref (explicit refspecs included).
#   3. Fail CLOSED: unparseable hook input, missing tool name, unverifiable
#      project root, or an undeterminable current branch => deny.
#   4. Stay RECOVERABLE while failing closed. A conflicted rebase detaches
#      HEAD, and denying everything in that state also denied `git rebase
#      --abort`, which permanently locked the session out of git. The branch
#      is now recovered from the rebase state when git recorded it, and when
#      it genuinely cannot be recovered a short allowlist of abort/reset
#      commands is permitted so the state can be ended — plus an escape to a
#      new, non-protected branch, which is the only thing that re-attaches a
#      PLAIN detached HEAD. See section 5b.
#
# Protected branches:
#   - claude/project-build-ie4b56   (default / production branch)
#   - main
#
# This guard is DEFENSE-IN-DEPTH for agent sessions only. The authoritative,
# non-bypassable control is a server-side GitHub Ruleset / branch protection
# managed by the repository owner. Do not weaken or remove this script
# without explicit owner approval.
#
# Denials use the structured PreToolUse decision (permissionDecision=deny)
# so the agent receives a clear, actionable reason. Allowed calls exit 0
# with no output and fall through to the normal permission flow.
#
# Tests: .claude/hooks/protect-default-branch.test.sh
# ============================================================================

set -u
set -f  # no pathname expansion anywhere in this script (safe tokenizing)

PROTECTED_BRANCHES='claude/project-build-ie4b56 main'
DEFAULT_BRANCH='claude/project-build-ie4b56'

WORKFLOW_HINT="Create a new feature branch from origin/${DEFAULT_BRANCH} (for example: git checkout -b <purpose-branch> origin/${DEFAULT_BRANCH}) and submit the change through a pull request that waits for explicit owner approval."

# NOTE: deny reasons are built ONLY from fixed strings in this file — never
# from tool input — so the emitted JSON cannot be broken or injected into.
deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

allow() { exit 0; }

is_protected() {
  local b
  for b in $PROTECTED_BRANCHES; do
    [ "$1" = "$b" ] && return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# 1. Read + parse the hook input (fail closed on any problem)
# ---------------------------------------------------------------------------

HOOK_INPUT="$(cat 2>/dev/null || true)"
[ -n "$HOOK_INPUT" ] || deny "change-control guard: empty PreToolUse input; failing closed. ${WORKFLOW_HINT}"

TOOL_NAME=''
TOOL_COMMAND=''

# Parser selection is CAPABILITY-PROBED, not presence-probed. `command -v` on
# its own is not enough: on Windows, python3 commonly resolves to a 0-byte
# Microsoft Store "App Execution Alias" that exists and is executable but
# exits 9009 without ever running Python. The old presence-only chain
# committed to that stub, so every hook invocation failed closed with a
# misleading "unparseable PreToolUse JSON" reason — on EVERY branch, denying
# all agent file work while protecting nothing.
#
# Each candidate must now parse a known-good fixture before it is trusted.
# That separates "this parser is broken/absent" (try the next one) from "the
# real payload is malformed" (deny). node is the last resort and is always
# present in this repo's toolchain.
#
# Fail-closed is preserved end to end: no working parser => deny; the chosen
# parser rejecting the real payload => deny; no tool_name => deny.
JSON_PROBE='{"probe":1}'

PY_VALIDATE='import json,sys; json.load(sys.stdin)'
PY_FIELD='
import json, sys
d = json.load(sys.stdin)
if sys.argv[1] == "tool_name":
    v = d.get("tool_name")
else:
    ti = d.get("tool_input")
    v = ti.get("command") if isinstance(ti, dict) else None
sys.stdout.write(v if isinstance(v, str) else "")
'
NODE_VALIDATE='let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{JSON.parse(s)})'
NODE_FIELD='let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);let v;if(process.argv[1]==="tool_name"){v=o.tool_name}else{const t=o.tool_input;v=(t&&typeof t==="object")?t.command:undefined}process.stdout.write(typeof v==="string"?v:"")})'

PARSER=''
if command -v jq >/dev/null 2>&1 \
  && printf '%s' "$JSON_PROBE" | jq -e . >/dev/null 2>&1; then
  PARSER='jq'
elif command -v python3 >/dev/null 2>&1 \
  && printf '%s' "$JSON_PROBE" | python3 -c "$PY_VALIDATE" >/dev/null 2>&1; then
  PARSER='python3'
elif command -v node >/dev/null 2>&1 \
  && printf '%s' "$JSON_PROBE" | node -e "$NODE_VALIDATE" >/dev/null 2>&1; then
  PARSER='node'
else
  deny "change-control guard: no working JSON parser (jq, python3 or node) available; failing closed."
fi

case "$PARSER" in
  jq)
    printf '%s' "$HOOK_INPUT" | jq -e . >/dev/null 2>&1 \
      || deny "change-control guard: unparseable PreToolUse JSON; failing closed."
    TOOL_NAME="$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)"
    TOOL_COMMAND="$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
    ;;
  python3)
    printf '%s' "$HOOK_INPUT" | python3 -c "$PY_VALIDATE" >/dev/null 2>&1 \
      || deny "change-control guard: unparseable PreToolUse JSON; failing closed."
    TOOL_NAME="$(printf '%s' "$HOOK_INPUT" | python3 -c "$PY_FIELD" tool_name 2>/dev/null || true)"
    TOOL_COMMAND="$(printf '%s' "$HOOK_INPUT" | python3 -c "$PY_FIELD" tool_command 2>/dev/null || true)"
    ;;
  node)
    printf '%s' "$HOOK_INPUT" | node -e "$NODE_VALIDATE" >/dev/null 2>&1 \
      || deny "change-control guard: unparseable PreToolUse JSON; failing closed."
    TOOL_NAME="$(printf '%s' "$HOOK_INPUT" | node -e "$NODE_FIELD" tool_name 2>/dev/null || true)"
    TOOL_COMMAND="$(printf '%s' "$HOOK_INPUT" | node -e "$NODE_FIELD" tool_command 2>/dev/null || true)"
    ;;
esac

[ -n "$TOOL_NAME" ] || deny "change-control guard: hook input has no tool_name; failing closed."

# Collapse Bash line continuations (a backslash immediately followed by a
# newline) the way the shell does before execution, so a token split across
# physical lines (git push origin HEAD:mai\<newline>n -> HEAD:main) cannot hide
# a protected ref or subcommand from the scanners below. Bare newlines (no
# preceding backslash) are left intact — they separate commands.
TOOL_COMMAND="${TOOL_COMMAND//\\$'\n'/}"

# ---------------------------------------------------------------------------
# 2. Verify the project root and the current branch (fail closed)
# ---------------------------------------------------------------------------

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
{ [ -n "$PROJECT_DIR" ] && [ -d "$PROJECT_DIR" ]; } \
  || deny "change-control guard: CLAUDE_PROJECT_DIR is unset or not a directory; cannot verify the project root; failing closed."
command -v git >/dev/null 2>&1 \
  || deny "change-control guard: git is unavailable; cannot verify the current branch; failing closed."
git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || deny "change-control guard: CLAUDE_PROJECT_DIR is not a git work tree; failing closed."

CURRENT_BRANCH="$(git -C "$PROJECT_DIR" branch --show-current 2>/dev/null || true)"

# A conflicted rebase leaves HEAD detached, so `branch --show-current` prints
# nothing. Denying every call at that point also denied `git rebase --abort` —
# the one command that clears the state being objected to — so an agent that
# hit a merge conflict was locked out of git for the rest of the session.
#
# Recover the branch the in-progress operation started FROM. git records it in
# the rebase state directory and it is authoritative: a rebase of a feature
# branch IS feature-branch work and must be treated as such, while a rebase of
# a protected branch stays protected and keeps every restriction below.
BRANCH_UNKNOWN=0
if [ -z "$CURRENT_BRANCH" ]; then
  GIT_DIR_PATH="$(git -C "$PROJECT_DIR" rev-parse --git-dir 2>/dev/null || true)"
  case "$GIT_DIR_PATH" in
    '') ;;                                       # unresolvable; handled below
    /*) ;;                                       # already absolute
    *)  GIT_DIR_PATH="$PROJECT_DIR/$GIT_DIR_PATH" ;;
  esac
  for REBASE_STATE_DIR in rebase-merge rebase-apply; do
    [ -n "$GIT_DIR_PATH" ] && [ -f "$GIT_DIR_PATH/$REBASE_STATE_DIR/head-name" ] || continue
    REBASE_HEAD_NAME="$(cat "$GIT_DIR_PATH/$REBASE_STATE_DIR/head-name" 2>/dev/null || true)"
    case "$REBASE_HEAD_NAME" in
      # git writes the literal string "detached HEAD" when the rebase itself
      # started from a detached HEAD; that tells us nothing, so stay unknown.
      refs/heads/?*) CURRENT_BRANCH="${REBASE_HEAD_NAME#refs/heads/}" ;;
      *) ;;
    esac
    break
  done
  [ -n "$CURRENT_BRANCH" ] || BRANCH_UNKNOWN=1
fi

# An unknown branch state is still FAIL CLOSED: treat it as protected, which
# turns on every restriction in sections 6 and 7. Section 5b then carves out
# the narrow set of commands whose only purpose is to END that state.
ON_PROTECTED=0
if [ "$BRANCH_UNKNOWN" -eq 1 ]; then
  ON_PROTECTED=1
else
  is_protected "$CURRENT_BRANCH" && ON_PROTECTED=1
fi

# ---------------------------------------------------------------------------
# 3. Regex building blocks
# ---------------------------------------------------------------------------

# Match against the raw command AND, when it differs, a quote/backslash-
# stripped rendering — the shell removes those characters before the real
# command runs, so a denied option/name must not be hideable by quoting it
# (e.g. find . "-delete", git log "--output=leak"). DQ_COMMAND is set in the
# protected-branch section before any cmd_matches call there.
cmd_matches() {
  printf '%s' "$TOOL_COMMAND" | grep -Eq "$1" && return 0
  [ -n "${DQ_COMMAND:-}" ] && [ "${DQ_COMMAND:-}" != "$TOOL_COMMAND" ] \
    && printf '%s' "$DQ_COMMAND" | grep -Eq "$1"
}

PROT_ALT='(claude/project-build-ie4b56|main)'
PROT_LEAD='(^|[^[:alnum:]_.-])'      # "/" IS a boundary => origin/main matches
PROT_TRAIL='([^[:alnum:]_./-]|$)'    # "-", ".", "/" break the match => main-fix, main.x, main/sub do NOT match
PROT_WORD="${PROT_LEAD}(refs/heads/)?${PROT_ALT}${PROT_TRAIL}"

GIT_WORD='(^|[^[:alnum:]._-])git([[:space:]]|$)'
WB='([^[:alnum:]._-]|$)'
LB='(^|[^[:alnum:]._-])'

# "git <global flags>* <subcommand>" adjacency. This keeps the any-branch
# rules from firing on words that merely appear inside quoted text (for
# example a commit message that mentions "push" or a protected branch name)
# while still catching git global-option forms that retarget the repo. The
# global-flag class is intentionally GENERAL so an unknown/new global option
# cannot slip a subcommand past the scanner:
#   * -c VALUE / -C VALUE                        (short, space-separated value)
#   * --long VALUE for the known value-taking globals (space-separated value)
#   * --anything or --anything=VALUE             (any long option, incl. new ones)
#   * -p / -P                                    (short boolean)
GIT_PRE='(^|[^[:alnum:]._-])git([[:space:]]+(-[cC][[:space:]]+[^[:space:]]+|--(git-dir|work-tree|namespace|exec-path|config-env|super-prefix|attr-source)[[:space:]]+[^[:space:]]+|--[a-zA-Z][a-zA-Z0-9-]*(=[^[:space:]]+)?|-[Pp]))*[[:space:]]+'

# ---------------------------------------------------------------------------
# 4. ANY-BRANCH rules: protected refs may never be pushed/updated/deleted/
#    force-moved, no matter which branch is checked out.
#
#    The rules run per pipeline/command segment (so unrelated segments of a
#    compound command cannot cause false denials), and each variant runs
#    twice: once against the raw text and once against a quote/backslash-
#    stripped rendering, so shell quoting cannot hide the real subcommand
#    or refspec from the regexes. Configured git aliases are enumerated at
#    runtime and their invocation is denied outright.
# ---------------------------------------------------------------------------

str_matches()  { printf '%s' "$1" | grep -Eq  "$2"; }
str_matchesi() { printf '%s' "$1" | grep -Eqi "$2"; }

# Resolve shell quoting/backslashes the way the shell does before it runs the
# command, producing the text the any-branch rules scan. The goal is that a
# quoted ARGUMENT that merely *mentions* a git command (a commit message, a
# PR body: git commit -m "run git push origin main") is not mistaken for a
# real command, while quoting used to OBFUSCATE a command token
# (git "push", gi"t" push, git pu\sh) is still seen through:
#   * a single-quoted or double-quoted span with NO whitespace is dequoted
#     (its content is kept, joined to the surrounding word) — this is how a
#     command/subcommand/refspec token gets fragmented, so we must see it;
#   * a quoted span that CONTAINS whitespace is a multi-word argument (a
#     message/body) and is replaced by a single space — its inner text is not
#     command syntax and must not be scanned as such;
#   * a backslash escapes the next character (kept literally).
# Unterminated quotes fall through to raw text (fail toward matching).
sanitize() {
  local s="$1"
  local out='' buf='' q='' ch i=0 n
  n=${#s}
  while [ "$i" -lt "$n" ]; do
    ch="${s:$i:1}"
    if [ -n "$q" ]; then
      if [ "$ch" = "$q" ]; then
        case "$buf" in
          *[[:space:]]*) out="$out " ;;   # multi-word quoted arg -> mask
          *) out="$out$buf" ;;            # single-word quoted -> dequote
        esac
        q=''; buf=''
      elif [ "$ch" = '\' ] && [ "$q" = '"' ]; then
        i=$((i+1)); buf="$buf${s:$i:1}"   # backslash escape inside dquotes
      else
        buf="$buf$ch"
      fi
    else
      case "$ch" in
        "'"|'"') q="$ch" ;;
        '\') i=$((i+1)); out="$out${s:$i:1}" ;;
        *) out="$out$ch" ;;
      esac
    fi
    i=$((i+1))
  done
  [ -n "$q" ] && out="$out$buf"
  printf '%s' "$out"
}

# Split a command into shell WORDS, honoring ' " and \ so a multi-word quoted
# string stays ONE word (quotes removed). Unlike sanitize(), quoted content is
# kept — this is used to find an interpreter code payload (bash -c '<payload>',
# python -c '<payload>') so the payload can be scanned AS A COMMAND rather than
# masked as data. A word standing alone as `bash` is a real interpreter; the
# string `bash -c "…"` sitting inside ONE quoted argument stays a single word
# whose first token is not `bash`, so a message that merely mentions it is not
# treated as code. One word per output line.
tokenize_words() {
  local s="$1"
  local buf='' q='' ch i=0 n inword=0
  n=${#s}
  while [ "$i" -lt "$n" ]; do
    ch="${s:$i:1}"
    if [ -n "$q" ]; then
      if [ "$ch" = "$q" ]; then q=''; inword=1
      elif [ "$ch" = '\' ] && [ "$q" = '"' ]; then i=$((i+1)); buf="$buf${s:$i:1}"; inword=1
      else buf="$buf$ch"; inword=1; fi
    else
      case "$ch" in
        "'"|'"') q="$ch"; inword=1 ;;
        '\') i=$((i+1)); buf="$buf${s:$i:1}"; inword=1 ;;
        ' '|'	') if [ "$inword" = 1 ]; then printf '%s\n' "$buf"; buf=''; inword=0; fi ;;
        *) buf="$buf$ch"; inword=1 ;;
      esac
    fi
    i=$((i+1))
  done
  [ "$inword" = 1 ] && printf '%s\n' "$buf"
}

# Scan interpreter code payloads (bash -c '<code>', python -c '<code>',
# eval <code>) as commands, so a protected operation wrapped in an interpreter
# string is not hidden by the quote-masking in sanitize().
scan_interpreter_payloads() {
  local -a W=()
  local line
  while IFS= read -r line; do W+=("$line"); done < <(tokenize_words "$1")
  local k j base
  for ((k=0; k<${#W[@]}; k++)); do
    base="${W[k]##*/}"
    case "$base" in
      sh|bash|zsh|dash|ksh|ash|python|python2|python3|perl|ruby|node|deno|php)
        j=$((k+1))
        while [ "$j" -lt "${#W[@]}" ]; do
          case "${W[j]}" in
            -c|-e)
              # code flag with a SEPARATE-word payload -> scan the next word
              [ $((j+1)) -lt "${#W[@]}" ] && { scan_variant_segments "${W[j+1]}"; scan_interpreter_payloads "${W[j+1]}"; }
              break ;;
            -c?*)
              # cuddled code payload: python3 -c'import os; ...' -> -cimport...
              scan_variant_segments "${W[j]#-c}"; scan_interpreter_payloads "${W[j]#-c}"; break ;;
            -e?*)
              # cuddled -eCODE (perl -e'...', ruby -e'...')
              scan_variant_segments "${W[j]#-e}"; scan_interpreter_payloads "${W[j]#-e}"; break ;;
            -[a-z]*[ce])
              # combined boolean flags ending in the code flag (bash -lc CODE):
              # payload is the next word
              [ $((j+1)) -lt "${#W[@]}" ] && { scan_variant_segments "${W[j+1]}"; scan_interpreter_payloads "${W[j+1]}"; }
              break ;;
            -o|-O|-W|--rcfile|--init-file)
              j=$((j+2)) ;;   # option takes a SEPARATE-word operand: skip both
            -*) j=$((j+1)) ;; # boolean/attached-value option: skip one
            *) break ;;       # first non-option positional = script file, stop
          esac
        done ;;
      eval|source|.)
        [ $((k+1)) -lt "${#W[@]}" ] && { scan_variant_segments "${W[*]:$((k+1))}"; scan_interpreter_payloads "${W[*]:$((k+1))}"; }
        break ;;
    esac
  done
}

GIT_PUSH_SEEN=0
GIT_FETCH_SEEN=0
GIT_TARGETS=''

# Deny a bare push whose EFFECTIVE config in directory $1 would route it to a
# protected ref: upstream @{push}, a per-remote push refspec (protected source
# or destination / matching / wildcard), a mirror flag, or push.default=matching.
check_push_config() {
  local D="$1" pd pv
  pd="$(git -C "$D" rev-parse --abbrev-ref '@{push}' 2>/dev/null || true)"
  [ -n "$pd" ] && printf '%s' "$pd" | grep -Eq "(^|/)(claude/project-build-ie4b56|main)\$" \
    && deny "a configured push destination (@{push}) resolves to a protected branch, so git push is denied. ${WORKFLOW_HINT}"
  pv="$(git -C "$D" config --get-regexp '^remote\..+\.push$' 2>/dev/null | sed -E 's/^[^[:space:]]+[[:space:]]+//' || true)"
  if [ -n "$pv" ]; then
    printf '%s' "$pv" | grep -Eq "$PROT_WORD" \
      && deny "a configured push refspec (remote.*.push) names a protected branch as its source or destination, so git push is denied. ${WORKFLOW_HINT}"
    printf '%s' "$pv" | grep -Eq '(^|[[:space:]])\+?:([[:space:]]|$)' \
      && deny "a configured matching push refspec (remote.*.push = ':' / '+:') pushes all matching branches including protected ones, so git push is denied. ${WORKFLOW_HINT}"
    printf '%s' "$pv" | grep -Eq '[*]' \
      && deny "a configured push refspec (remote.*.push) uses a wildcard that could include a protected branch, so git push is denied. ${WORKFLOW_HINT}"
  fi
  git -C "$D" config --get-regexp '^remote\..+\.mirror$' 2>/dev/null | grep -Eqi '(^|[[:space:]])(true|yes|on|1)$' \
    && deny "remote.*.mirror=true makes git push mirror all refs including protected ones; git push is denied. ${WORKFLOW_HINT}"
  [ "$(git -C "$D" config --get push.default 2>/dev/null || true)" = "matching" ] \
    && deny "push.default=matching would push all matching branches including protected ones; git push is denied. Use an explicit refspec. ${WORKFLOW_HINT}"
  return 0
}

# Deny a plain fetch/pull whose EFFECTIVE config in $1 has a fetch refspec that
# writes a protected LOCAL head (or a wildcard into local heads). A normal
# refspec writing refs/remotes/... is unaffected.
check_fetch_config() {
  local D="$1" fv
  fv="$(git -C "$D" config --get-regexp '^remote\..+\.fetch$' 2>/dev/null | sed -E 's/^[^[:space:]]+[[:space:]]+//' || true)"
  if [ -n "$fv" ]; then
    printf '%s' "$fv" | grep -Eq ":(refs/heads/)?(claude/project-build-ie4b56|main)([^[:alnum:]_./-]|\$)" \
      && deny "a configured fetch refspec (remote.*.fetch) writes a protected local ref, so git fetch/pull is denied. ${WORKFLOW_HINT}"
    printf '%s' "$fv" | grep -Eq ':refs/heads/[*]' \
      && deny "a configured fetch refspec (remote.*.fetch) writes local branches via a wildcard that could include a protected ref, so git fetch/pull is denied. ${WORKFLOW_HINT}"
  fi
  return 0
}

any_branch_rules() {
  local C="$1"
  str_matches "$C" "${GIT_PRE}(fetch|pull)${WB}" && GIT_FETCH_SEEN=1
  # low-level push plumbing (send-pack, http-push) exists only to update
  # remote refs and can target a protected branch (git send-pack ../r.git
  # HEAD:refs/heads/main); deny outright from every branch.
  if str_matches "$C" "${GIT_PRE}(send-pack|http-push)${WB}"; then
    deny "git send-pack / http-push are low-level commands that push objects and can update protected remote refs; denied from every branch. ${WORKFLOW_HINT}"
  fi
  if str_matches "$C" "${GIT_PRE}push${WB}"; then
    GIT_PUSH_SEEN=1
    str_matches "$C" "$PROT_WORD" \
      && deny "git push referencing a protected branch (claude/project-build-ie4b56 or main) is denied from every branch. ${WORKFLOW_HINT}"
    # --all/--branches/--mirror push every matching local branch (incl. a
    # local main) to the remote; --branches is a documented alias of --all
    str_matches "$C" '(^|[[:space:]])--(mirror|all|branches)([^[:alnum:]-]|$)' \
      && deny "git push --all/--branches/--mirror would update protected remote refs and is denied. ${WORKFLOW_HINT}"
    # the matching refspec (a bare ':' or '+:') pushes every branch that
    # exists on both ends — including a protected one — without naming it
    str_matches "$C" '(^|[[:space:]])\+?:([[:space:]]|$)' \
      && deny "git push with a matching refspec (bare ':' or '+:') updates all matching branches including protected ones and is denied. ${WORKFLOW_HINT}"
  fi
  if str_matches "$C" "${GIT_PRE}update-ref${WB}" && str_matches "$C" "$PROT_WORD"; then
    deny "git update-ref targeting a protected ref is denied from every branch. ${WORKFLOW_HINT}"
  fi
  # symbolic-ref <name> <ref> rewrites <name> (refs/heads/main -> …); its
  # write/delete forms targeting a protected ref are denied like update-ref
  if str_matches "$C" "${GIT_PRE}symbolic-ref${WB}" && str_matches "$C" "$PROT_WORD"; then
    deny "git symbolic-ref writing or deleting a protected ref is denied from every branch. ${WORKFLOW_HINT}"
  fi
  if str_matches "$C" "${GIT_PRE}(push|fetch|pull)${WB}" \
    && str_matches "$C" ":(refs/heads/)?${PROT_ALT}${PROT_TRAIL}"; then
    deny "a refspec targeting a protected branch (…:claude/project-build-ie4b56 or …:main) is denied from every branch. ${WORKFLOW_HINT}"
  fi
  # --stdin feeds refspecs (fetch/push) or ref-update commands (update-ref)
  # from standard input — often a preceding pipeline segment the per-segment
  # scan cannot see — so the destination ref cannot be vetted. Deny it.
  if str_matches "$C" "${GIT_PRE}(push|fetch|pull|update-ref)${WB}" \
    && str_matches "$C" '(^|[[:space:]])--stdin([=[:space:]]|$)'; then
    deny "git push/fetch/pull/update-ref with --stdin reads refspecs or ref-update commands from standard input that cannot be vetted; denied from every branch. Use explicit literal refspecs. ${WORKFLOW_HINT}"
  fi
  if str_matches "$C" "${GIT_PRE}branch${WB}" \
    && str_matches "$C" '(^|[[:space:]])(-[dDmMfcCu]+|--delete|--force|--move|--copy|--set-upstream-to[^[:space:]]*|--track[^[:space:]]*)([^[:alnum:]-]|$)' \
    && str_matches "$C" "$PROT_WORD"; then
    deny "git branch delete/move/force/upstream changes targeting a protected branch are denied from every branch. ${WORKFLOW_HINT}"
  fi
  # cuddled upstream value: git branch -uorigin/main feature glues the
  # upstream ref to -u, so the boundary in the rule above would miss it
  if str_matches "$C" "${GIT_PRE}branch${WB}" \
    && str_matches "$C" '(^|[[:space:]])-[dDmMfcC]*u[^[:space:]]' \
    && str_matches "$C" "$PROT_WORD"; then
    deny "git branch -u<upstream> (cuddled) targeting a protected branch is denied from every branch. ${WORKFLOW_HINT}"
  fi
  # cuddled short-option form: git branch -Dmain / -Mmain glues the protected
  # name to the option letter, so PROT_WORD's word boundary would miss it
  if str_matches "$C" "${GIT_PRE}branch${WB}" \
    && str_matches "$C" "(^|[[:space:]])-[dDmMfcCu]*[dDmM][[:space:]]*(refs/heads/)?${PROT_ALT}${PROT_TRAIL}"; then
    deny "git branch delete/move targeting a protected branch (including the cuddled -Dmain form) is denied from every branch. ${WORKFLOW_HINT}"
  fi
  # -B/-C accept a cuddled name (git checkout -Bmain, git switch -Cmain), so
  # allow zero-or-more spaces between the option and the protected name
  if str_matches "$C" "${GIT_PRE}(checkout|switch)${WB}" \
    && str_matches "$C" "(^|[[:space:]])-[BC][[:space:]]*(refs/heads/)?${PROT_ALT}${PROT_TRAIL}"; then
    deny "git checkout -B / git switch -C onto a protected branch name (including the cuddled -Bmain form) is denied from every branch. ${WORKFLOW_HINT}"
  fi
  # git worktree add -b/-B <name> also creates/resets a branch (-B force-
  # resets), so it can force-move a protected local ref from any checkout
  if str_matches "$C" "${GIT_PRE}worktree${WB}" \
    && str_matches "$C" "(^|[[:space:]])-[bB][[:space:]]*(refs/heads/)?${PROT_ALT}${PROT_TRAIL}"; then
    deny "git worktree add -b/-B onto a protected branch name is denied from every branch. ${WORKFLOW_HINT}"
  fi
  # git worktree add <path> <protected> checks the protected branch out into a
  # new working tree, from which later mutations would land on it — deny any
  # worktree add that names a protected branch (the -b/-B cuddled form above
  # covers the glued case that this word-boundary rule would miss)
  if str_matches "$C" "${GIT_PRE}worktree${WB}" && str_matches "$C" "${LB}add${WB}" \
    && str_matches "$C" "$PROT_WORD"; then
    deny "git worktree add checking out a protected branch is denied from every branch (mutations in that worktree would modify the protected branch). ${WORKFLOW_HINT}"
  fi
  # alias definitions can smuggle a push under another name (git -c
  # alias.p=push p ..., git config alias.x '...', GIT_CONFIG_KEY_0=alias.p);
  # config keys are case-insensitive, so match case-insensitively
  if str_matches "$C" "$GIT_WORD" && str_matchesi "$C" '(^|[^[:alnum:]_])alias\.'; then
    deny "defining or using git aliases (alias.* configuration in any form) is denied because it can disguise protected-ref operations. ${WORKFLOW_HINT}"
  fi
  # so can configuration that redirects where a push lands, or a fetch refspec
  # that writes a local protected ref
  if str_matches "$C" "$GIT_WORD" \
    && str_matchesi "$C" '(push\.default|pushinsteadof|remote\.[^[:space:]=]*\.(push|mirror|fetch)|branch\.[^[:space:]=]*\.(merge|remote|pushremote))'; then
    deny "git configuration that redirects push/fetch destinations (push.default, remote.*.push/mirror/fetch, branch.*.merge/remote, pushInsteadOf) is denied. ${WORKFLOW_HINT}"
  fi
  # include.path / includeIf pull in an arbitrary config file that could set
  # any of the above (aliases, remote.*.push, ...) out of the scanner's view;
  # the one-shot -c form is also not reflected by the @{push} fallback below
  if str_matches "$C" "$GIT_WORD" && str_matchesi "$C" '(^|[^[:alnum:]_])include(if)?[.]'; then
    deny "git include.path / includeIf configuration can pull in unvettable settings (aliases, remote.*.push, ...) and is denied from every branch. ${WORKFLOW_HINT}"
  fi
  # GIT_CONFIG* environment overrides point git at an arbitrary config file or
  # inject config keys the runtime config read cannot see (GIT_CONFIG_GLOBAL,
  # GIT_CONFIG_SYSTEM, GIT_CONFIG, GIT_CONFIG_COUNT/KEY_n/VALUE_n) — deny them
  # on any git command (env-var names are case-sensitive/uppercase)
  if str_matches "$C" "$GIT_WORD" \
    && str_matches "$C" '(^|[^[:alnum:]_])GIT_CONFIG(_GLOBAL|_SYSTEM|_COUNT|_KEY_[0-9]+|_VALUE_[0-9]+)?='; then
    deny "GIT_CONFIG* environment overrides point git at unvettable configuration and are denied from every branch. ${WORKFLOW_HINT}"
  fi
  # a variable or ANSI-C-quoted fragment ANYWHERE in the subcommand word
  # cannot be vetted: the shell concatenates the fragments before git runs
  # (git dollar-X, git pu-dollar-quoted-sh, ...). The bracket class matches
  # a dollar or a leftover backslash — both are obfuscation in this spot.
  if str_matches "$C" "${GIT_PRE}[^[:space:]]*[\$]"; then
    deny "a git subcommand containing a shell variable or ANSI-C-quoted fragment cannot be vetted and is denied. ${WORKFLOW_HINT}"
  fi
  # ref-writing subcommands whose arguments contain shell-EXPANSION
  # metacharacters cannot be vetted: variable ($x), brace ({a,b} expands to
  # HEAD:main among others), glob (*?[), tilde (~) or command substitution
  # (backtick) could all name a protected ref after the shell rewrites the
  # word. Require literal ref names for these subcommands.
  EXPANDY='[$`{}*?~[]'
  if str_matches "$C" "${GIT_PRE}(push|fetch|pull|update-ref)${WB}" && str_matches "$C" "$EXPANDY"; then
    deny "git push/fetch/pull/update-ref with shell-expansion metacharacters in its arguments is denied; use literal ref names (no \$, {}, *, ?, ~, backtick). ${WORKFLOW_HINT}"
  fi
  if str_matches "$C" "${GIT_PRE}(branch|checkout|switch)${WB}" \
    && str_matches "$C" '(^|[[:space:]])(-[bBcCdDfmMu]|--delete|--force|--move|--copy|--set-upstream-to|--track)' \
    && str_matches "$C" "$EXPANDY"; then
    deny "git branch/checkout/switch mutation flags combined with shell-expansion metacharacters are denied; use literal branch names. ${WORKFLOW_HINT}"
  fi
  return 0
}

# run the rules on each pipeline/command segment separately so a safe
# operation in one segment is not denied because ANOTHER segment mentions a
# protected name (example: git push origin feature && gh pr create --base
# main must stay allowed — the push segment itself is clean)
scan_variant_segments() {
  local V="$1" SEG SEGS
  SEGS="$(printf '%s' "$V" | tr '|;&' '\n')"
  while IFS= read -r SEG; do
    [ -n "$SEG" ] && any_branch_rules "$SEG"
  done <<EOSEG
$SEGS
EOSEG
}

if [ "$TOOL_NAME" = "Bash" ]; then
  [ -n "$TOOL_COMMAND" ] || deny "change-control guard: Bash call with no command string; failing closed."

  # SANITIZED resolves quoting the shell's way: multi-word quoted arguments
  # (messages/bodies) are masked so a git command mentioned inside them is not
  # denied, while quote/backslash obfuscation of a real command token is seen
  # through. This is the primary rendering the any-branch rules scan.
  SANITIZED="$(sanitize "$TOOL_COMMAND")"
  # a MORE aggressive rendering that also reassembles a command/subcommand name
  # split with a variable or ANSI-C quote (gi${x}t -> git, gi$'t' -> git):
  #   * whole ${...} expansions are removed  (empty-value case)
  #   * a leftover bare $ is removed          (ANSI-C case)
  # GIT_PRE still requires the subcommand to sit right after git, so a commit
  # MESSAGE that merely contains the word "push" is not falsely matched.
  NORM_AGGRESSIVE="$(printf '%s' "$SANITIZED" | sed -E 's/\$\{[^}]*\}//g' | tr -d '${}')"
  scan_variant_segments "$SANITIZED"
  [ "$NORM_AGGRESSIVE" != "$SANITIZED" ] && scan_variant_segments "$NORM_AGGRESSIVE"
  # an interpreter code payload (bash -c '…', python -c '…', eval …) is CODE,
  # not data, so scan it as a command rather than let sanitize() mask it
  scan_interpreter_payloads "$TOOL_COMMAND"
  # NORMALIZED (all quote/backslash chars removed, content kept) is still used
  # by the configured-alias-invocation check below.
  NORMALIZED="$SANITIZED"

  # GIT_CONFIG* env overrides can be EXPORTED in an earlier command segment and
  # take effect on a later git call, so check the WHOLE command (not just a git
  # segment). These variables only affect git, so any assignment is denied.
  if str_matches "$SANITIZED" '(^|[^[:alnum:]_])GIT_CONFIG(_GLOBAL|_SYSTEM|_COUNT|_KEY_[0-9]+|_VALUE_[0-9]+)?='; then
    deny "GIT_CONFIG* environment overrides (including exported assignments) point git at unvettable configuration and are denied from every branch. ${WORKFLOW_HINT}"
  fi

  # A command can retarget git at ANOTHER working tree/repo, escaping the
  # ON_PROTECTED check (which reflects only CLAUDE_PROJECT_DIR):
  #   * git -C <path> / --git-dir <path> / --work-tree <path>
  #   * a preceding `cd <path>` that changes the working directory before git
  # Resolve every such target's checked-out branch and deny operating there
  # when it is a protected branch (git -C /wt commit, cd /wt && git commit).
  # The setup step git worktree add <path> main is already denied above.
  GIT_TARGETS="$(printf '%s' "$SANITIZED" | grep -oE '(-C[[:space:]]+[^[:space:]]+|--git-dir[=[:space:]][^[:space:]]+|--work-tree[=[:space:]][^[:space:]]+)' | sed -E 's/^(-C|--git-dir|--work-tree)[=[:space:]]+//' || true)"
  CD_TARGETS="$(printf '%s' "$SANITIZED" | tr ';|&' '\n' | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^[:space:]]+).*/\1/p' || true)"
  RETARGETS="$GIT_TARGETS
$CD_TARGETS"
  while IFS= read -r T; do
    [ -n "$T" ] || continue
    case "$T" in -|-*|'~'*) continue ;; esac   # cd -, options, home-relative: skip
    TB="$(git -C "$T" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    { [ -n "$TB" ] && is_protected "$TB"; } \
      && deny "a redirected git context (-C / --git-dir / --work-tree / cd target) is on a protected branch (${TB}); operating there is denied. ${WORKFLOW_HINT}"
  done <<EORT
$RETARGETS
EORT

  # invoking an ALREADY-CONFIGURED git alias can hide any operation behind an
  # arbitrary name (git p behaves as git push when the p alias is configured),
  # so any invocation of a configured alias is denied from every branch.
  # Names shadowing real builtins are skipped (git ignores such aliases);
  # a name the guard cannot safely match fails closed.
  GIT_ALIASES="$(git -C "$PROJECT_DIR" config --get-regexp '^alias\.' 2>/dev/null | sed -E 's/^alias\.([^[:space:]]+).*/\1/' || true)"
  for AL in $GIT_ALIASES; do
    printf '%s' "$AL" | grep -Eq '^[A-Za-z0-9-]+$' \
      || deny "a git alias with an unvettable name is configured; failing closed. ${WORKFLOW_HINT}"
    case "$AL" in
      status|log|show|diff|push|pull|commit|add|fetch|branch|checkout|switch|tag|config|remote|grep|blame|stash|merge|rebase|reset|revert|rm|mv|clean|describe|shortlog|worktree|init|clone)
        continue ;;
    esac
    if str_matches "$SANITIZED" "${GIT_PRE}${AL}${WB}"; then
      deny "invoking a configured git alias is denied from every branch because aliases cannot be vetted by the change-control guard. ${WORKFLOW_HINT}"
    fi
  done

  # even without an explicit protected ref in the command, a bare git push /
  # fetch can land on a protected branch through configuration the command
  # text does not spell out. Check the EFFECTIVE config — and, because a
  # command can retarget git with -C / --git-dir / --work-tree, check each of
  # those target contexts too (the CLAUDE_PROJECT_DIR default plus every
  # redirect target). GIT_TARGETS is filled by the -C resolver above.
  CONFIG_CONTEXTS="$PROJECT_DIR
$RETARGETS"
  while IFS= read -r D; do
    [ -n "$D" ] || continue
    case "$D" in -|-*|'~'*) continue ;; esac
    if [ "$GIT_PUSH_SEEN" -eq 1 ]; then check_push_config "$D"; fi
    if [ "$GIT_FETCH_SEEN" -eq 1 ]; then check_fetch_config "$D"; fi
  done <<EOCTX
$CONFIG_CONTEXTS
EOCTX
fi

# ---------------------------------------------------------------------------
# 5. Not on a protected branch: everything else is allowed (normal feature-
#    branch work: edits, commits, pushes of the feature branch itself).
# ---------------------------------------------------------------------------

[ "$ON_PROTECTED" -eq 1 ] || allow

# ---------------------------------------------------------------------------
# 5b. UNKNOWN branch state: a detached HEAD that no rebase state explains.
#
#     Section 2 already treated this as protected, so sections 6 and 7 would
#     deny everything. That is right for ordinary work and wrong for RECOVERY:
#     it denies the very commands that end the unknown state, which is how a
#     session ends up unable to touch git at all.
#
#     Allow exactly those commands, plus read-only inspection of the state.
#     None of them can advance a ref — abort/quit/reset only restore what the
#     interrupted operation saved — and the any-branch protected-ref rules in
#     section 4 have already run against this command. Anything carrying a
#     shell operator, quote or substitution is rejected before the allowlist,
#     so nothing can be chained onto a permitted command.
#
#     THE ABORT LIST IS NOT ENOUGH ON ITS OWN, and that gap was a real
#     lockout. Every command in it ends an operation that RECORDED state;
#     none re-attaches HEAD. `git bisect reset` outside a bisect merely prints
#     "We are not bisecting." So a PLAIN detached HEAD — `git checkout
#     --detach`, or a checkout of a remote-tracking ref — left the session
#     with every file write denied, Bash restricted to commands that could not
#     help, and no way to edit this script to fix it. That happened on
#     2026-08-22.
#
#     So one more thing is allowed: creating and switching to a NEW,
#     NON-PROTECTED branch — the same escape hatch section 7 already sanctions
#     from a protected checkout. It cannot advance, delete or force-move any
#     ref; it starts at the current commit and attaches HEAD to a fresh name.
#     The form is deliberately rigid (exactly four tokens: git, subcommand,
#     create flag, name) so there is no start-point, no extra flag and no
#     pathspec to vet, and a protected name is refused outright.
#
#     WHY NO START POINT, when WORKFLOW_HINT suggests the five-token form.
#     That hint describes section 7's escape from a PROTECTED checkout, where
#     check_git_checkout_args vets a start point against $REFISH. It is not
#     mirrored here, for three reasons. From a detached HEAD the current commit
#     already IS the right start point — re-attaching HEAD is the entire
#     purpose, and a start point would instead repoint the working tree while
#     the guard is failed closed. Vetting one would mean inlining a second copy
#     of the $REFISH pattern in a path that cannot see section 7's, and two
#     copies of a security check drift. And nothing is lost: once HEAD is
#     attached to a feature branch, section 5 allows ordinary work, so the
#     five-token form is one command away. An agent that follows the hint
#     verbatim from this state is denied once and told the accepted form by the
#     deny reason below, which names it explicitly. Pinned by the
#     "Detached HEAD, escaping to a new feature branch" cases in the test suite.
# ---------------------------------------------------------------------------

if [ "$BRANCH_UNKNOWN" -eq 1 ]; then
  [ "$TOOL_NAME" = "Bash" ] \
    || deny "change-control guard: the current branch cannot be determined (detached HEAD with no recoverable rebase state); file-writing tool calls are denied. Re-attach HEAD first with git checkout -b <new-feature-branch> (or git switch -c <new-feature-branch>), or end the in-progress git operation with git rebase --abort, git merge --abort, git cherry-pick --abort, or git bisect reset."

  case "$TOOL_COMMAND" in
    *';'*|*'&'*|*'|'*|*'>'*|*'<'*|*'`'*|*'$'*|*'('*|*')'*|*"'"*|*'"'*|*'\'*)
      deny "change-control guard: the current branch cannot be determined; only a single plain recovery command is allowed here — no operators, quoting or substitution. Allowed: git checkout -b <new-branch>, git switch -c <new-branch>, git rebase/cherry-pick/revert/am --abort or --quit, git merge --abort, git bisect reset, git status, git branch --show-current, git rev-parse --git-dir, git log --oneline -N, git diff --name-only." ;;
  esac

  RECOVERY_CMD='^[[:space:]]*git[[:space:]]+((rebase|cherry-pick|revert|am)[[:space:]]+--(abort|quit)|merge[[:space:]]+--abort|bisect[[:space:]]+reset|status|branch[[:space:]]+--show-current|rev-parse[[:space:]]+--git-dir|log[[:space:]]+--oneline[[:space:]]+-[0-9][0-9]*|diff[[:space:]]+--name-only)[[:space:]]*$'
  printf '%s' "$TOOL_COMMAND" | grep -Eq "$RECOVERY_CMD" && allow

  # The escape to a new, non-protected branch. Tokenized with `set --` (set -f
  # is active, so no globbing) and required to be EXACTLY four words, which
  # rules out a start-point argument, extra flags and pathspecs. The branch
  # name pattern is spelled out here rather than reusing $REFISH: REFISH is
  # assigned in section 7, which has not run yet at this point, and under
  # `set -u` referencing it would abort the hook without emitting a decision.
  # shellcheck disable=SC2086
  set -- $TOOL_COMMAND
  if [ "${1:-}" = "git" ] && [ "$#" -eq 4 ]; then
    case "$2 $3" in
      'checkout -b'|'switch -c')
        printf '%s' "$4" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._/-]*$' \
          || deny "change-control guard: the detached-HEAD escape needs a plain branch name (letters, digits, dot, underscore, slash, dash). ${WORKFLOW_HINT}"
        is_protected "$4" \
          && deny "change-control guard: the detached-HEAD escape may not create a protected branch name (claude/project-build-ie4b56 or main). Choose a purpose-specific feature branch. ${WORKFLOW_HINT}"
        allow ;;
    esac
  fi

  deny "change-control guard: the current branch cannot be determined (detached HEAD with no recoverable rebase state); failing closed. Allowed here: git checkout -b <new-branch>, git switch -c <new-branch>, git rebase/cherry-pick/revert/am --abort or --quit, git merge --abort, git bisect reset, git status, git branch --show-current, git rev-parse --git-dir, git log --oneline -N, git diff --name-only."
fi

# ---------------------------------------------------------------------------
# 6. On a protected branch: deny all file-writing tools outright.
# ---------------------------------------------------------------------------

if [ "$TOOL_NAME" != "Bash" ]; then
  deny "protected branch ${CURRENT_BRANCH} is checked out: file-writing tool calls (Edit/Write/MultiEdit/NotebookEdit) are denied. ${WORKFLOW_HINT}"
fi

# ---------------------------------------------------------------------------
# 7. On a protected branch: Bash is restricted to read-only inspection.
#    Specific high-signal denials first (clear reasons), then a fail-closed
#    read-only allowlist applied to every pipeline/command segment.
#
#    DQ_COMMAND is the command with quote/backslash characters removed — the
#    shell strips those before executing, so option/command-name screens must
#    see through them (find . "-delete", git log "--output=leak"). It feeds
#    cmd_matches (above) and the per-segment allowlist below. Redirection (7b)
#    and command-substitution (7a) are NOT dequoted: quoting a > or $( turns
#    it into a harmless literal, so the raw form is the correct thing to test.
# ---------------------------------------------------------------------------

DQ_COMMAND="$(printf '%s' "$TOOL_COMMAND" | tr -d "\\\\\"'")"

# 7a. command/process substitution cannot be safely vetted => deny
case "$TOOL_COMMAND" in
  *'$('*|*'`'*|*'<('*|*'>('*)
    deny "protected branch: command/process substitution cannot be vetted and is denied. Run plain commands, or move to a feature branch. ${WORKFLOW_HINT}" ;;
esac

# 7b. output redirection (except to /dev/null) => deny
STRIPPED="$(printf '%s' "$TOOL_COMMAND" | sed -E 's|[0-9]?>>?[[:space:]]*/dev/null||g; s|[0-9]>&[0-9]||g; s|&>[[:space:]]*/dev/null||g')"
case "$STRIPPED" in
  *'>'*)
    deny "protected branch: output redirection is denied (repository files must not be written). Only redirection to /dev/null is allowed. ${WORKFLOW_HINT}" ;;
esac

# 7c. git state-changing subcommands => deny
GIT_MUT="${LB}(add|commit|push|pull|merge|rebase|cherry-pick|reset|revert|am|apply|update-ref|symbolic-ref|clean|gc|prune|mv|rm|restore|replace|filter-branch|commit-tree|stash|notes|bisect)${WB}"
if cmd_matches "$GIT_WORD" && cmd_matches "$GIT_MUT"; then
  deny "protected branch: git state-changing commands (add, commit, push, pull, merge, rebase, cherry-pick, reset, revert, am, apply, update-ref, stash, ...) are denied. ${WORKFLOW_HINT}"
fi

# 7d. package managers / skills CLI => deny (they write into the repository)
if cmd_matches '(^|[;&|([:space:]])(npm|npx|yarn|pnpm|bun|pip|pip3|corepack|gem|cargo|apt|apt-get|brew|snap)([[:space:]]|$)'; then
  deny "protected branch: package manager and skills CLI commands (npm, npx, yarn, pnpm, pip, ...) are denied because they install files into the repository. ${WORKFLOW_HINT}"
fi

# 7e. find write/exec actions => deny (-fprint matched with any suffix so
#     -fprint0/-fprintf cannot slip through)
if cmd_matches "${LB}find${WB}" && cmd_matches '(^|[[:space:]])(-delete|-exec|-execdir|-ok|-okdir|-f(print|ls)[^[:space:]]*)([[:space:]]|$)'; then
  deny "protected branch: find with -delete/-exec/-ok/-fprint is denied. ${WORKFLOW_HINT}"
fi

# 7f. common file mutators / interpreters at a command position => deny.
#     sed and awk are NOT read-only: sed can write files (w/W commands, -i)
#     and GNU sed can execute commands (e); awk has system() and print>file.
if cmd_matches '(^|[;&|([:space:]])(tee|touch|cp|mv|rm|rmdir|mkdir|ln|chmod|chown|truncate|dd|install|rsync|patch|shred|tar|unzip|zip|gzip|gunzip|xargs|env|eval|exec|source|sh|bash|zsh|dash|ksh|perl|python|python3|node|deno|ruby|php|sed|awk|gawk|mawk)([[:space:]]|$)'; then
  deny "protected branch: file-modifying commands and interpreters (tee, touch, cp, mv, rm, chmod, sed, awk, python, node, sh, ...) are denied. ${WORKFLOW_HINT}"
fi

# 7g. fail-closed read-only allowlist, checked per pipeline/command segment.
#     sed/awk/tree are deliberately absent (write/exec-capable); sort, uniq
#     and rg get dedicated argument screens in check_segment below.
# NOTE: `command`/`builtin` are NOT here — they are wrappers that could run
# a write-capable command (command sort -o FILE), so they get a dedicated
# recursive screen in check_segment below.
SAFE_SIMPLE='ls cat head tail wc grep egrep fgrep diff cmp file stat du df pwd printf echo true false jq cut tr comm column nl md5sum sha1sum sha256sum shasum cksum basename dirname readlink realpath which type date whoami id uname hostname printenv shellcheck find'

check_git_branch_args() {
  local prev='' a
  for a in "$@"; do
    case "$a" in
      -a|-r|-v|-vv|--all|--list|--show-current|--contains|--merged|--no-merged|--points-at|--format=*|--sort=*|--color|--no-color)
        prev="$a" ;;
      -*)
        deny "protected branch: this git branch option is not allowed (read-only listing only). ${WORKFLOW_HINT}" ;;
      *)
        case "$prev" in
          --contains|--merged|--no-merged|--points-at) prev='' ;;
          *) deny "protected branch: git branch may not create, delete or move branches here. ${WORKFLOW_HINT}" ;;
        esac ;;
    esac
  done
  return 0
}

REFISH='^[A-Za-z0-9][A-Za-z0-9._/-]*$'

check_git_checkout_args() {
  local create_flag="$1"; shift
  [ $# -ge 1 ] || deny "protected branch: bare git checkout/switch is denied. ${WORKFLOW_HINT}"
  if [ "$1" = "$create_flag" ]; then
    # creating and moving to a NEW (non-protected) feature branch is the
    # sanctioned escape hatch from a protected checkout
    [ $# -ge 2 ] || deny "protected branch: checkout -b / switch -c needs a branch name. ${WORKFLOW_HINT}"
    printf '%s' "$2" | grep -Eq "$REFISH" \
      || deny "protected branch: invalid branch name for checkout -b / switch -c. ${WORKFLOW_HINT}"
    is_protected "$2" \
      && deny "protected branch: may not create a branch with a protected branch name. ${WORKFLOW_HINT}"
    if [ $# -ge 3 ]; then
      [ $# -eq 3 ] || deny "protected branch: too many arguments to checkout -b / switch -c. ${WORKFLOW_HINT}"
      printf '%s' "$3" | grep -Eq "$REFISH" \
        || deny "protected branch: invalid start point for checkout -b / switch -c. ${WORKFLOW_HINT}"
    fi
    return 0
  fi
  # plain switch to an existing ref: exactly one branch-name argument
  [ $# -eq 1 ] || deny "protected branch: git checkout/switch with pathspecs or extra arguments is denied (it can overwrite files). ${WORKFLOW_HINT}"
  printf '%s' "$1" | grep -Eq "$REFISH" \
    || deny "protected branch: git checkout/switch argument must be a plain branch name. ${WORKFLOW_HINT}"
  return 0
}

check_git_segment() {
  [ $# -ge 1 ] || return 0   # bare "git" prints help
  local sub="$1"; shift
  local a
  case "$sub" in
    -*)
      deny "protected branch: git global options (-C, --git-dir, --work-tree, ...) are denied; run plain git subcommands. ${WORKFLOW_HINT}" ;;
    status|log|show|diff|rev-parse|rev-list|ls-files|ls-remote|ls-tree|cat-file|grep|blame|shortlog|describe|name-rev|merge-base|fetch|var|count-objects|fsck|version|help|check-ignore|show-ref|for-each-ref)
      # even read-only subcommands have options that write files or execute
      # external commands (log/diff --output, grep -O/--open-files-in-pager,
      # fetch/ls-remote --upload-pack) — deny those
      for a in "$@"; do
        case "$a" in
          --output|--output=*|-O*|--open-files-in-pager*|--upload-pack*|--receive-pack*|--ext-diff|--textconv*)
            deny "protected branch: a git option that writes files or executes external commands (--output, -O, --upload-pack, ...) is denied. ${WORKFLOW_HINT}" ;;
        esac
      done
      return 0 ;;
    remote)
      [ $# -eq 0 ] && return 0
      case "$1" in -v|--verbose|show|get-url) return 0 ;; esac
      deny "protected branch: only read-only git remote forms (-v, show, get-url) are allowed. ${WORKFLOW_HINT}" ;;
    config)
      case "${1:-}" in --get|--get-all|--get-regexp|--list|-l) return 0 ;; esac
      deny "protected branch: only read-only git config forms (--get, --get-all, --get-regexp, --list) are allowed. ${WORKFLOW_HINT}" ;;
    reflog)
      [ $# -eq 0 ] && return 0
      [ "$1" = "show" ] && return 0
      deny "protected branch: only git reflog show is allowed. ${WORKFLOW_HINT}" ;;
    branch)
      check_git_branch_args "$@" ;;
    tag)
      [ $# -eq 0 ] && return 0
      case "$1" in -l|--list|-n*) return 0 ;; esac
      deny "protected branch: git tag creation/deletion is denied (only git tag -l / --list). ${WORKFLOW_HINT}" ;;
    checkout)
      check_git_checkout_args '-b' "$@" ;;
    switch)
      check_git_checkout_args '-c' "$@" ;;
    worktree)
      [ "${1:-}" = "list" ] && return 0
      deny "protected branch: only git worktree list is allowed. ${WORKFLOW_HINT}" ;;
    *)
      deny "protected branch: this git subcommand is not in the read-only allowlist. ${WORKFLOW_HINT}" ;;
  esac
}

check_segment() {
  local seg="$1"
  # trim leading whitespace
  seg="${seg#"${seg%%[![:space:]]*}"}"
  [ -n "$seg" ] || return 0
  # tokenize on whitespace (set -f is active: no glob expansion)
  # shellcheck disable=SC2086
  set -- $seg
  [ $# -ge 1 ] || return 0
  local first="$1" a pos
  first="${first##*/}"
  shift
  case "$first" in
    git)
      check_git_segment "$@"
      return 0 ;;
    command|builtin)
      # `command NAME …` / `builtin NAME …` run the wrapped command, so the
      # wrapped command must itself pass the screen. The read-only lookup
      # forms `command -v/-V NAME` are allowed; `-p` is skipped.
      while [ $# -ge 1 ]; do
        case "$1" in
          -p) shift ;;
          -v|-V) return 0 ;;
          --) shift; break ;;
          -*) deny "protected branch: this ${first} option is not allowed. ${WORKFLOW_HINT}" ;;
          *) break ;;
        esac
      done
      [ $# -ge 1 ] || return 0
      check_segment "$*"
      return 0 ;;
    sort)
      for a in "$@"; do
        case "$a" in
          -o*|--output|--output=*)
            deny "protected branch: sort with an output file (-o/--output, including the cuddled -oFILE form) is denied. ${WORKFLOW_HINT}" ;;
        esac
      done
      return 0 ;;
    uniq)
      # "uniq INPUT OUTPUT" writes OUTPUT — allow at most one positional arg
      pos=0
      for a in "$@"; do
        case "$a" in
          -*) ;;
          *) pos=$((pos+1)) ;;
        esac
      done
      [ "$pos" -ge 2 ] \
        && deny "protected branch: uniq with an output file argument is denied. ${WORKFLOW_HINT}"
      return 0 ;;
    rg)
      for a in "$@"; do
        case "$a" in
          --pre|--pre=*|--hostname-bin*)
            deny "protected branch: rg --pre (preprocessor command execution) is denied. ${WORKFLOW_HINT}" ;;
        esac
      done
      return 0 ;;
  esac
  local w
  for w in $SAFE_SIMPLE; do
    [ "$first" = "$w" ] && return 0
  done
  deny "protected branch: command is not in the read-only inspection allowlist; failing closed. ${WORKFLOW_HINT}"
}

# split on pipes, semicolons, ampersands and newlines; every segment must be
# read-only. Quoted operators split too — that only over-denies (fail closed).
# Scan both the raw (redirection-stripped) command and a dequoted rendering of
# it, so a denied option cannot be smuggled past a per-command arg screen by
# quoting it (sort "-o" FILE, git log "--output=FILE").
scan_readonly_segments() {
  local SEGS SEG
  SEGS="$(printf '%s' "$1" | tr '|;&' '\n')"
  while IFS= read -r SEG; do
    check_segment "$SEG"
  done <<EOF
$SEGS
EOF
}

DQ_STRIPPED="$(printf '%s' "$STRIPPED" | tr -d "\\\\\"'")"
scan_readonly_segments "$STRIPPED"
[ "$DQ_STRIPPED" != "$STRIPPED" ] && scan_readonly_segments "$DQ_STRIPPED"

allow
