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
[ -n "$CURRENT_BRANCH" ] \
  || deny "change-control guard: cannot determine the current branch (detached HEAD or git error); failing closed."

ON_PROTECTED=0
is_protected "$CURRENT_BRANCH" && ON_PROTECTED=1

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

GIT_PUSH_SEEN=0

any_branch_rules() {
  local C="$1"
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
  # alias definitions can smuggle a push under another name (git -c
  # alias.p=push p ..., git config alias.x '...', GIT_CONFIG_KEY_0=alias.p);
  # config keys are case-insensitive, so match case-insensitively
  if str_matches "$C" "$GIT_WORD" && str_matchesi "$C" '(^|[^[:alnum:]_])alias\.'; then
    deny "defining or using git aliases (alias.* configuration in any form) is denied because it can disguise protected-ref operations. ${WORKFLOW_HINT}"
  fi
  # so can configuration that redirects where a push lands
  if str_matches "$C" "$GIT_WORD" \
    && str_matchesi "$C" '(push\.default|pushinsteadof|remote\.[^[:space:]=]*\.push|branch\.[^[:space:]=]*\.(merge|remote|pushremote))'; then
    deny "git configuration that redirects push destinations (push.default, remote.*.push, branch.*.merge/remote, pushInsteadOf) is denied. ${WORKFLOW_HINT}"
  fi
  # include.path / includeIf pull in an arbitrary config file that could set
  # any of the above (aliases, remote.*.push, ...) out of the scanner's view;
  # the one-shot -c form is also not reflected by the @{push} fallback below
  if str_matches "$C" "$GIT_WORD" && str_matchesi "$C" '(^|[^[:alnum:]_])include(if)?[.]'; then
    deny "git include.path / includeIf configuration can pull in unvettable settings (aliases, remote.*.push, ...) and is denied from every branch. ${WORKFLOW_HINT}"
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

  NORMALIZED="$(printf '%s' "$TOOL_COMMAND" | tr -d "\\\\\"'")"
  # a MORE aggressive rendering that reassembles a command/subcommand name
  # split with a variable or ANSI-C quote the way the shell does before
  # executing, so the git/push/branch detection cannot be dodged by
  # fragmenting the word:
  #   * whole ${...} expansions are removed  (gi${x}t -> git, empty-value case)
  #   * a leftover bare $ is removed          (gi$'t' -> gi$t -> git, ANSI-C case)
  # GIT_PRE still requires the subcommand to sit right after git, so a commit
  # MESSAGE that merely contains the word "push" is not falsely matched.
  NORM_AGGRESSIVE="$(printf '%s' "$NORMALIZED" | sed -E 's/\$\{[^}]*\}//g' | tr -d '${}')"
  scan_variant_segments "$TOOL_COMMAND"
  [ "$NORMALIZED" != "$TOOL_COMMAND" ] && scan_variant_segments "$NORMALIZED"
  { [ "$NORM_AGGRESSIVE" != "$NORMALIZED" ] && [ "$NORM_AGGRESSIVE" != "$TOOL_COMMAND" ]; } \
    && scan_variant_segments "$NORM_AGGRESSIVE"

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
    if str_matches "$TOOL_COMMAND" "${GIT_PRE}${AL}${WB}" \
      || str_matches "$NORMALIZED" "${GIT_PRE}${AL}${WB}"; then
      deny "invoking a configured git alias is denied from every branch because aliases cannot be vetted by the change-control guard. ${WORKFLOW_HINT}"
    fi
  done

  # even without an explicit protected ref in the command, a bare git push
  # can land on a protected branch through upstream/push.default config —
  # resolve the current branch's actual push destination and deny if it is
  # protected
  if [ "$GIT_PUSH_SEEN" -eq 1 ]; then
    PUSH_DEST="$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref '@{push}' 2>/dev/null || true)"
    if [ -n "$PUSH_DEST" ]; then
      case "$PUSH_DEST" in
        */*) PUSH_DEST="${PUSH_DEST#*/}" ;;
      esac
      is_protected "$PUSH_DEST" \
        && deny "the current branch's configured push destination resolves to a protected branch, so git push is denied. ${WORKFLOW_HINT}"
    fi
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
