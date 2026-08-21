#!/usr/bin/env bash
# ============================================================================
# Tests for .claude/hooks/protect-default-branch.sh
#
#   bash .claude/hooks/protect-default-branch.test.sh
#
# Exits non-zero if any case fails. No arguments, no network, no writes
# outside a temporary directory that is removed on exit.
#
# WHY THIS EXISTS. The guard is the repository's defence-in-depth against an
# agent writing to a protected branch, and until now its behaviour was
# asserted only in comments. A change to it could not be verified except by
# reasoning, which is exactly the wrong footing for a security control. These
# cases pin the decisions that matter, including the detached-HEAD recovery
# paths added alongside this file.
#
# Requires: bash, git (>= 2.28 for `git init -b`), and one of jq / python3 /
# node for the hook's own JSON parsing.
# ============================================================================

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HOOK_DIR/protect-default-branch.sh"

[ -f "$HOOK" ] || { printf 'cannot find the hook at %s\n' "$HOOK"; exit 1; }

PROTECTED='claude/project-build-ie4b56'
PASS=0
FAIL=0

TMPROOT="$(mktemp -d)"
cleanup() { rm -rf "$TMPROOT"; }
trap cleanup EXIT

# --- harness ---------------------------------------------------------------

# Feed one PreToolUse payload to the hook and reduce its answer to allow/deny.
# Commands used below deliberately contain no quotes or backslashes, so plain
# interpolation into the JSON is safe.
run_hook() { # <repo> <tool> <command>
  local out
  out="$(printf '{"tool_name":"%s","tool_input":{"command":"%s"}}' "$2" "$3" \
    | CLAUDE_PROJECT_DIR="$1" bash "$HOOK" 2>/dev/null)"
  case "$out" in
    *'"permissionDecision":"deny"'*) printf 'deny' ;;
    *) printf 'allow' ;;
  esac
}

expect() { # <want> <repo> <tool> <command> <label>
  local got
  got="$(run_hook "$2" "$3" "$4")"
  if [ "$got" = "$1" ]; then
    PASS=$((PASS + 1))
    printf '  ok    %s\n' "$5"
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL  %s\n        wanted %s, got %s\n' "$5" "$1" "$got"
  fi
}

# --- fixtures --------------------------------------------------------------

# A repository whose default branch is the protected one, with one commit.
new_repo() { # <path>
  local d="$1"
  mkdir -p "$d"
  git -C "$d" init -q -b "$PROTECTED"
  git -C "$d" config user.email test@example.invalid
  git -C "$d" config user.name 'Guard Test'
  printf 'base\n' > "$d/f.txt"
  git -C "$d" add f.txt
  git -C "$d" commit -qm base
}

# Leave <path> mid-rebase with a conflict, having started from <branch>.
# git records the starting branch in .git/rebase-merge/head-name, which is
# what the guard reads to decide the branch is knowable after all.
new_conflicted_rebase() { # <path> <branch>
  local d="$1" br="$2"
  new_repo "$d"
  git -C "$d" checkout -q -b "$br"
  printf 'theirs\n' > "$d/f.txt"
  git -C "$d" commit -qam theirs
  git -C "$d" checkout -q "$PROTECTED"
  printf 'ours\n' > "$d/f.txt"
  git -C "$d" commit -qam ours
  git -C "$d" checkout -q "$br"
  git -C "$d" rebase "$PROTECTED" >/dev/null 2>&1 || true
}

# --- cases -----------------------------------------------------------------

printf '\nProtected branch checked out\n'
PROT_REPO="$TMPROOT/protected"
new_repo "$PROT_REPO"
expect deny  "$PROT_REPO" Write ''                       'Write is denied'
expect deny  "$PROT_REPO" Bash  'git commit -m x'        'git commit is denied'
expect deny  "$PROT_REPO" Bash  'npm install'            'package managers are denied'
expect deny  "$PROT_REPO" Bash  'rm -rf build'           'file mutators are denied'
expect allow "$PROT_REPO" Bash  'git status'             'git status is allowed'
expect allow "$PROT_REPO" Bash  'ls -la'                 'ls is allowed'
expect allow "$PROT_REPO" Bash  'git checkout -b feat/x' 'escaping to a feature branch is allowed'

printf '\nFeature branch checked out\n'
FEAT_REPO="$TMPROOT/feature"
new_repo "$FEAT_REPO"
git -C "$FEAT_REPO" checkout -q -b feat/normal
expect allow "$FEAT_REPO" Write ''                        'Write is allowed'
expect allow "$FEAT_REPO" Bash  'git commit -m x'         'git commit is allowed'
expect allow "$FEAT_REPO" Bash  'git push -u origin HEAD' 'pushing the feature branch is allowed'

printf '\nProtected refs are untouchable from every branch\n'
expect deny "$FEAT_REPO" Bash 'git push origin main'                       'push to main is denied'
expect deny "$FEAT_REPO" Bash "git push origin HEAD:$PROTECTED"            'refspec onto the default branch is denied'
expect deny "$FEAT_REPO" Bash 'git branch -D main'                         'deleting main is denied'
expect deny "$FEAT_REPO" Bash 'git push --all origin'                      'push --all is denied'

printf '\nDetached HEAD, mid-rebase, started from a FEATURE branch\n'
REBASE_FEAT="$TMPROOT/rebase-feature"
new_conflicted_rebase "$REBASE_FEAT" feat/rebasing
expect allow "$REBASE_FEAT" Bash  'git rebase --abort' 'the way out is allowed'
expect allow "$REBASE_FEAT" Bash  'git status'         'inspection is allowed'
expect allow "$REBASE_FEAT" Write ''                   'resolving conflicts by editing is allowed'
expect allow "$REBASE_FEAT" Bash  'git add f.txt'      'staging a resolution is allowed'
expect deny  "$REBASE_FEAT" Bash  'git push origin main' 'protected refs are still denied'

printf '\nDetached HEAD, mid-rebase, started from a PROTECTED branch\n'
REBASE_PROT="$TMPROOT/rebase-protected"
new_conflicted_rebase "$REBASE_PROT" main
expect deny  "$REBASE_PROT" Write ''             'writes stay denied'
expect deny  "$REBASE_PROT" Bash  'git commit -m x' 'commits stay denied'
expect allow "$REBASE_PROT" Bash  'git status'   'inspection is still allowed'

printf '\nDetached HEAD with no rebase state at all\n'
DETACHED="$TMPROOT/detached"
new_repo "$DETACHED"
git -C "$DETACHED" checkout -q --detach HEAD
expect allow "$DETACHED" Bash  'git rebase --abort'          'rebase --abort is allowed'
expect allow "$DETACHED" Bash  'git merge --abort'           'merge --abort is allowed'
expect allow "$DETACHED" Bash  'git bisect reset'            'bisect reset is allowed'
expect allow "$DETACHED" Bash  'git status'                  'git status is allowed'
expect allow "$DETACHED" Bash  'git branch --show-current'   'branch --show-current is allowed'
expect deny  "$DETACHED" Bash  'git commit -m x'             'commits are denied'
expect deny  "$DETACHED" Bash  'rm -rf build'                'file mutators are denied'
expect deny  "$DETACHED" Bash  'ls -la'                      'unrelated commands are denied'
expect deny  "$DETACHED" Write ''                            'writes are denied'
expect deny  "$DETACHED" Bash  'git rebase --abort && rm -rf build' 'chaining onto a recovery command is denied'
expect deny  "$DETACHED" Bash  'git push origin main'        'protected refs are still denied'

printf '\nFail-closed basics\n'
expect deny "$TMPROOT" Bash 'git status' 'a non-repository project root is denied'

# --- result ----------------------------------------------------------------

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
