#!/usr/bin/env bash
#
# branch-audit.sh — classify every remote branch as merged / stale / active.
#
# Written for docs/GIT_BRANCHES.md. Read-only: it never deletes, pushes or
# modifies anything. Branch deletion is a destructive GitHub operation and
# requires explicit owner approval (CLAUDE.md §5); this script only reports.
#
# Usage:
#   scripts/branch-audit.sh              # audit against the default branch
#   scripts/branch-audit.sh --no-fetch   # skip the fetch (use local refs)
#
# With the GitHub CLI (gh) authenticated the audit reads the pull-request
# record, which is the only way to detect squash- and rebase-merged branches
# (git reports those as unmerged). Without gh it falls back to ancestry alone
# and says so — that mode under-reports merged branches, never over-reports.

set -euo pipefail

DEFAULT_BRANCH="claude/project-build-ie4b56"
PROTECTED=("$DEFAULT_BRANCH" "main")
REMOTE="origin"
DO_FETCH=1

for arg in "$@"; do
  case "$arg" in
    --no-fetch) DO_FETCH=0 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"

if [ "$DO_FETCH" -eq 1 ]; then
  echo "Fetching $REMOTE (pruning deleted branches)..." >&2
  git fetch "$REMOTE" --prune >/dev/null 2>&1 || {
    echo "warning: fetch failed; auditing against possibly stale local refs" >&2
  }
fi

DEF="$REMOTE/$DEFAULT_BRANCH"
git rev-parse --verify --quiet "$DEF" >/dev/null || {
  echo "error: $DEF not found. Is DEFAULT_BRANCH still correct?" >&2
  exit 1
}

# ---------------------------------------------------------------- PR record --
# merged_prs: newline-separated "<branch>" that has at least one merged PR.
merged_prs=""
HAVE_GH=0
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  HAVE_GH=1
  merged_prs=$(gh pr list --state merged --limit 500 \
                 --json headRefName --jq '.[].headRefName' 2>/dev/null || true)
fi

is_protected() {
  local b=$1
  for p in "${PROTECTED[@]}"; do [ "$b" = "$p" ] && return 0; done
  return 1
}

merged=(); squashed=(); active=(); protected_list=()

while read -r ref; do
  branch=${ref#"$REMOTE"/}
  [ "$branch" = "HEAD" ] && continue

  if is_protected "$branch"; then
    protected_list+=("$branch")
    continue
  fi

  # Definitive: the branch tip is an ancestor of the default branch.
  if git merge-base --is-ancestor "$ref" "$DEF" 2>/dev/null; then
    merged+=("$branch")
    continue
  fi

  # Squash/rebase merges rewrite commits, so ancestry misses them. Only the
  # PR record can tell us; without gh we must not guess.
  if [ "$HAVE_GH" -eq 1 ] && grep -qxF "$branch" <<<"$merged_prs"; then
    squashed+=("$branch")
    continue
  fi

  active+=("$branch")
done < <(git for-each-ref --format='%(refname:short)' "refs/remotes/$REMOTE")

# ------------------------------------------------------------------ report --
section() {
  local title=$1; shift
  printf '\n%s (%d)\n' "$title" "$#"
  printf '%s\n' "${*:+$(printf '  %s\n' "$@")}"
}

printf 'Branch audit — default branch: %s\n' "$DEFAULT_BRANCH"
printf 'Remote branches: %d\n' \
  "$(git for-each-ref --format='%(refname:short)' "refs/remotes/$REMOTE" | grep -cv '/HEAD$' || true)"

if [ "$HAVE_GH" -eq 0 ]; then
  cat >&2 <<'EOF'

NOTE: the GitHub CLI (gh) is unavailable or not authenticated.
      Squash- and rebase-merged branches CANNOT be detected in this mode and
      will be reported as ACTIVE. Treat the ACTIVE list as an upper bound and
      confirm against docs/GIT_BRANCHES.md before acting on it.
EOF
fi

section "PROTECTED — never delete" "${protected_list[@]}"
section "MERGED — ancestor of the default branch, safe to delete" "${merged[@]}"
[ "$HAVE_GH" -eq 1 ] &&
  section "MERGED via squash/rebase — safe to delete" "${squashed[@]}"
section "ACTIVE — has unmerged commits, review before deleting" "${active[@]}"

cat <<EOF

Next steps
  - Cross-check the ACTIVE list against the open pull requests. A branch with
    no open PR and no unique work is a candidate for deletion.
  - Branch deletion requires explicit owner approval (CLAUDE.md §5). This
    script deliberately does not delete anything.
  - Full classification and the pull-request merge order: docs/GIT_BRANCHES.md
EOF
