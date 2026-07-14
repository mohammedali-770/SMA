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
if command -v jq >/dev/null 2>&1; then
  printf '%s' "$HOOK_INPUT" | jq -e . >/dev/null 2>&1 \
    || deny "change-control guard: unparseable PreToolUse JSON; failing closed."
  TOOL_NAME="$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_name // empty' 2>/dev/null || true)"
  TOOL_COMMAND="$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
elif command -v python3 >/dev/null 2>&1; then
  printf '%s' "$HOOK_INPUT" | python3 -c 'import json,sys; json.load(sys.stdin)' >/dev/null 2>&1 \
    || deny "change-control guard: unparseable PreToolUse JSON; failing closed."
  TOOL_NAME="$(printf '%s' "$HOOK_INPUT" | python3 -c '
import json, sys
d = json.load(sys.stdin)
v = d.get("tool_name")
sys.stdout.write(v if isinstance(v, str) else "")
' 2>/dev/null || true)"
  TOOL_COMMAND="$(printf '%s' "$HOOK_INPUT" | python3 -c '
import json, sys
d = json.load(sys.stdin)
ti = d.get("tool_input")
v = ti.get("command") if isinstance(ti, dict) else None
sys.stdout.write(v if isinstance(v, str) else "")
' 2>/dev/null || true)"
else
  deny "change-control guard: no JSON parser (jq or python3) available; failing closed."
fi

[ -n "$TOOL_NAME" ] || deny "change-control guard: hook input has no tool_name; failing closed."

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
[ -n "$CURRENT_BRANCH" ] \
  || deny "change-control guard: cannot determine the current branch (detached HEAD or git error); failing closed."

ON_PROTECTED=0
is_protected "$CURRENT_BRANCH" && ON_PROTECTED=1

# ---------------------------------------------------------------------------
# 3. Regex building blocks
# ---------------------------------------------------------------------------

cmd_matches() { printf '%s' "$TOOL_COMMAND" | grep -Eq "$1"; }

PROT_ALT='(claude/project-build-ie4b56|main)'
PROT_LEAD='(^|[^[:alnum:]_.-])'      # "/" IS a boundary => origin/main matches
PROT_TRAIL='([^[:alnum:]_./-]|$)'    # "-", ".", "/" break the match => main-fix, main.x, main/sub do NOT match
PROT_WORD="${PROT_LEAD}(refs/heads/)?${PROT_ALT}${PROT_TRAIL}"

GIT_WORD='(^|[^[:alnum:]._-])git([[:space:]]|$)'
WB='([^[:alnum:]._-]|$)'
LB='(^|[^[:alnum:]._-])'

# "git <real global flags>* <subcommand>" adjacency. This keeps the any-branch
# rules from firing on words that merely appear inside quoted text (for
# example a commit message that mentions "push" or a protected branch name)
# while still catching git global-option forms that retarget the repo —
# including the space-separated value forms (--git-dir .git) and the
# no-value globals (--literal-pathspecs, --no-pager, --bare, ...).
GIT_PRE='(^|[^[:alnum:]._-])git([[:space:]]+(-[cC][[:space:]]+[^[:space:]]+|--(git-dir|work-tree|namespace|exec-path|config-env|super-prefix)(=[^[:space:]]+|[[:space:]]+[^[:space:]]+)|--no-pager|--paginate|--no-replace-objects|--no-optional-locks|--no-lazy-fetch|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--bare|-[Pp]))*[[:space:]]+'

# ---------------------------------------------------------------------------
# 4. ANY-BRANCH rules: protected refs may never be pushed/updated/deleted/
#    force-moved, no matter which branch is checked out.
# ---------------------------------------------------------------------------

if [ "$TOOL_NAME" = "Bash" ]; then
  [ -n "$TOOL_COMMAND" ] || deny "change-control guard: Bash call with no command string; failing closed."

  if cmd_matches "${GIT_PRE}push${WB}"; then
    cmd_matches "$PROT_WORD" \
      && deny "git push referencing a protected branch (claude/project-build-ie4b56 or main) is denied from every branch. ${WORKFLOW_HINT}"
    cmd_matches '(^|[[:space:]])--(mirror|all)([^[:alnum:]-]|$)' \
      && deny "git push --all/--mirror would update protected remote refs and is denied. ${WORKFLOW_HINT}"
  fi
  if cmd_matches "${GIT_PRE}update-ref${WB}" && cmd_matches "$PROT_WORD"; then
    deny "git update-ref targeting a protected ref is denied from every branch. ${WORKFLOW_HINT}"
  fi
  if cmd_matches "${GIT_PRE}(push|fetch|pull)${WB}" \
    && cmd_matches ":(refs/heads/)?${PROT_ALT}${PROT_TRAIL}"; then
    deny "a refspec targeting a protected branch (…:claude/project-build-ie4b56 or …:main) is denied from every branch. ${WORKFLOW_HINT}"
  fi
  if cmd_matches "${GIT_PRE}branch${WB}" \
    && cmd_matches '(^|[[:space:]])(-[dDmMfcC]+|--delete|--force|--move|--copy)([^[:alnum:]-]|$)' \
    && cmd_matches "$PROT_WORD"; then
    deny "git branch delete/move/force targeting a protected branch is denied from every branch. ${WORKFLOW_HINT}"
  fi
  if cmd_matches "${GIT_PRE}(checkout|switch)${WB}" \
    && cmd_matches "(^|[[:space:]])-[BC][[:space:]]+(refs/heads/)?${PROT_ALT}${PROT_TRAIL}"; then
    deny "git checkout -B / git switch -C onto a protected branch name is denied from every branch. ${WORKFLOW_HINT}"
  fi
fi

# ---------------------------------------------------------------------------
# 5. Not on a protected branch: everything else is allowed (normal feature-
#    branch work: edits, commits, pushes of the feature branch itself).
# ---------------------------------------------------------------------------

[ "$ON_PROTECTED" -eq 1 ] || allow

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
# ---------------------------------------------------------------------------

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
SAFE_SIMPLE='ls cat head tail wc grep egrep fgrep diff cmp file stat du df pwd printf echo true false jq cut tr comm column nl md5sum sha1sum sha256sum shasum cksum basename dirname readlink realpath which command type date whoami id uname hostname printenv shellcheck find'

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
    sort)
      for a in "$@"; do
        case "$a" in
          -o|--output|--output=*)
            deny "protected branch: sort with an output file (-o/--output) is denied. ${WORKFLOW_HINT}" ;;
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
SEGS="$(printf '%s' "$STRIPPED" | tr '|;&' '\n')"
while IFS= read -r SEG; do
  check_segment "$SEG"
done <<EOF
$SEGS
EOF

allow
