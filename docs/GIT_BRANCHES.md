# Git branch state and hygiene

> **Current as of 2026-08-12.** The historical branch-cleanup work is complete.

This document is about **Git branches**, not Spicy Meal restaurant branches. Restaurant-branch operations are documented separately in [`BRANCH_DELETION.md`](BRANCH_DELETION.md) and [`BRANCH_ONBOARDING.md`](BRANCH_ONBOARDING.md).

## Current remote state

GitHub currently exposes **one remote branch**:

| Branch | Role | Status |
| --- | --- | --- |
| `claude/project-build-ie4b56` | Default / production | Active and protected by repository workflow/rules |

All historical feature/release/cleanup branches used during the July–August development cycle have been removed after the feature-retention audit and consolidation.

The old `main` remote branch is also gone. Its name remains reserved in `CLAUDE.md`/agent protection rules so an automated session cannot casually recreate or push a second production-looking branch.

## What happened to the old branch inventory

Earlier versions of this document described roughly sixty historical branches and contained a one-time deletion command. That was accurate during the cleanup period, but keeping that list as the front of an active branch document became misleading after the deletion was completed.

The important evidence was preserved before deletion:

- [`BRANCH_FEATURE_RETENTION_AUDIT.md`](BRANCH_FEATURE_RETENTION_AUDIT.md) records the feature-by-feature retention check rather than relying only on Git ancestry.
- PR #200 merged the audited `release/mobile-next-build` result into the production branch on 2026-08-12.
- The final forensic follow-up checked closed-but-unmerged PRs, no-PR orphan branches, and the large Pen.dev branch for behavior that could otherwise have been lost.

The repository's Git history and pull-request record remain the historical source for deleted branch names and commit SHAs.

## Branch policy going forward

1. **Start from the current production branch.** Fetch first and branch from `origin/claude/project-build-ie4b56`.
2. **Create one fresh purpose-specific branch per change.** Do not reuse deleted historical branch names.
3. **Open a PR against the production branch.** No direct production pushes.
4. **Keep PRs small enough to review.** Large cross-cutting branches were the main reason the old repository became difficult to audit.
5. **Do not stack PRs unless required.** If a stacked PR is unavoidable, document the dependency and retarget explicitly when the base merges.
6. **Delete merged head branches.** GitHub's automatic head-branch deletion is enabled; verify cleanup rather than allowing another branch backlog to accumulate.
7. **Do not equate `git branch --merged` with feature retention.** Squash/rebase merges and later regressions make ancestry alone insufficient. Validate the intended behavior when the consequence of deletion matters.

## Re-auditing

The repository contains `scripts/branch-audit.sh` for read-only branch classification. It is useful when branch count grows again, but with a single remote branch there is currently nothing to clean up.

```bash
scripts/branch-audit.sh
```

For a release/consolidation audit, use behavior-based verification like [`BRANCH_FEATURE_RETENTION_AUDIT.md`](BRANCH_FEATURE_RETENTION_AUDIT.md), not only branch pointers.

## Do not recreate the old cleanup workflow

The old 57-branch deletion list was a one-time migration from a badly accumulated repository state. It is not a recurring operating procedure.

If branch count becomes large again, first determine **why** automatic deletion failed or why long-lived branches were created, then fix that process problem before bulk deletion.