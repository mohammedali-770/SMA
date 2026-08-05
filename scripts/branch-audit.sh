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
# (git reports those as unmerged). A branch is only called merged when its
# current tip equals the head SHA the merged PR recorded, and never while it
# has an open PR. Without gh it falls back to ancestry alone and says so.
# Every mode under-reports merged branches rather than over-reporting them,
# because the cost of a false "safe to delete" is losing live work.

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
# A branch name alone is NOT sufficient evidence that a branch is merged: names
# get reused, and a reused name would otherwise inherit an old PR's "merged"
# verdict and be reported as safe to delete while holding live work. So we match
# the branch's current tip against the merged PR's recorded head SHA, and treat
# any branch with an OPEN PR as active regardless of older merged PRs.
#
# merged_pairs: newline-separated "<branch> <head-sha>" for every merged PR.
# open_heads:   newline-separated "<branch>" for every open PR.
merged_pairs=""
open_heads=""
HAVE_GH=0
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  HAVE_GH=1
  merged_pairs=$(gh pr list --state merged --limit 500 \
                   --json headRefName,headRefOid \
                   --jq '.[] | .headRefName + " " + .headRefOid' 2>/dev/null || true)
  open_heads=$(gh pr list --state open --limit 200 \
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
  if [ "$HAVE_GH" -eq 1 ]; then
    # An open PR means live work, whatever an older merged PR did with the name.
    if grep -qxF "$branch" <<<"$open_heads"; then
      active+=("$branch")
      continue
    fi
    # Require the tip to be exactly what was merged. If the branch has moved on
    # since — reused name, or new commits pushed after the merge — it falls
    # through to ACTIVE, which is the safe direction to be wrong in.
    tip=$(git rev-parse "$ref")
    if grep -qxF "$branch $tip" <<<"$merged_pairs"; then
      squashed+=("$branch")
      continue
    fi
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
