# Git branch inventory & hygiene

> **Scope note.** This document is about **git branches**. In this project the
> word "branch" usually means a *restaurant branch* (see
> `docs/BRANCH_DELETION.md`, Branch Management in the admin console). Nothing
> here relates to restaurant branches.

> Audited **2026-08-05** against the default branch
> `claude/project-build-ie4b56` @ `9032dfa` and the GitHub pull-request record.
> Every one of the 60 remote branches that existed at audit time is classified
> below exactly once — the classification was verified to be complete and
> non-overlapping.

---

## 1. Why this document exists

The repository had accumulated **60 remote branches**. Only **13** of them were
live work; the other 47 were finished, superseded or dead. That ratio makes it
impossible to see what is actually in flight, and it was hiding the real
problem: a **13-deep queue of unmerged pull requests**, several of which are
production-readiness gates.

Branch count is a symptom. The queue is the thing that blocks production.

## 2. Summary

| Class | Count | Action |
| --- | --- | --- |
| Merged — work is in the default branch | 41 | Safe to delete |
| Dead orphans — no PR, superseded or one-shot | 4 | Safe to delete |
| Open pull requests — live work | 13 | Keep; work the queue (§5) |
| `main` — stale, unrelated history | 1 | Leave in place (§6) |
| `claude/project-build-ie4b56` — default/production | 1 | Protected |
| **Total** | **60** | |

Deleting the 45 finished branches takes the repository from 60 to 15, of which
13 are real work.

**Branch deletion is a destructive GitHub operation and requires explicit owner
approval under `CLAUDE.md` §5. Nothing in this document has been deleted.**

---

## 3. Merged — safe to delete (41)

Each branch's work is already in the default branch. Branches in the first
group are direct ancestors of the default branch; those in the second group
were squash- or rebase-merged, so their commits differ but their content
landed. The PR number is the authoritative record in both cases.

### 3a. Direct ancestors of the default branch (22)

| Branch | PR |
| --- | --- |
| `chore/standardize-node-22` | #120 |
| `docs/address-delete-migration-runbook` | #144 |
| `feat/admin-dashboard-navigation` | #143 |
| `feat/button-field-migration` | #122 (closed; content landed via #123) |
| `feat/design-system-ember-on-cream` | #118 |
| `feat/ds-admin-catalog` | #135 |
| `feat/ds-admin-final` | #136 |
| `feat/ds-admin-operations` | #134 |
| `feat/ds-admin-primitives` | #132 |
| `feat/ds-admin-shell-ops` | #133 |
| `feat/ds-auth-surface` | #123 |
| `feat/ds-checkout-payment-surface` | #126 |
| `feat/ds-checkout-payment-ui` | #127 |
| `feat/ds-home-menu-surface` | #124 |
| `feat/ds-modal-focus` | #140 |
| `feat/ds-order-type-legacy-removal` | #131 |
| `feat/ds-orders-profile` | #130 |
| `feat/ds-product-cart-surface` | #125 |
| `feat/mobile-profile-management` | #142 |
| `feat/price-component-migration` | #121 |
| `fix/checkout-money-display` | #141 |
| `fix/ds-muted-text-contrast` | #139 |

### 3b. Squash/rebase-merged (19)

`git branch --merged` does **not** list these — their commits were rewritten on
merge. Confirmed merged via the pull-request record.

| Branch | PR |
| --- | --- |
| `agent/delete-branches-dashboard` | #96 |
| `claude/fix-sentry-gate-verification-commands` | #116 |
| `claude/mobile-sentry-conditional-plugin` | #115 |
| `claude/mobile-sentry-upload-graceful-degradation` | #114 |
| `claude/record-sentry-gate-verification` | #117 |
| `claude/spicy-meal-apk-build-nioaew` | #113 |
| `docs/reconcile-ops-health-migration-ledger` | #105 |
| `feat/checkout-address-ux` | #103 |
| `feat/discounts-campaigns` | #109 |
| `feat/lazywait-api-v2` | #106 |
| `feat/order-confirmation-state-machine` | #101 |
| `feat/order-read-contracts` | #110 |
| `feat/otp-autofill` | #108 |
| `feat/whatsapp-only-saudi-login` | #93 |
| `fix/eas-status-poller-project-dir` | #92 |
| `fix/hook-node-json-parser` | #91 |
| `fix/lazywait-lifecycle-test-case7` | #107 |
| `fix/mobile-map-google-config` | #99 |
| `fix/refund-worker-scheduler` | #112 |

> **Do not** try to re-derive this group with `git branch --merged` — it will
> report all 19 as unmerged and tempt someone into "recovering" work that is
> already live. Use `scripts/branch-audit.sh`, which reads the PR record.

## 4. Dead orphans — safe to delete (4)

No pull request was ever opened for these, and none carries work worth keeping.

| Branch | What it is |
| --- | --- |
| `agent/delete-branches-dashboard-copy` | A duplicate of the branch merged as #96, left behind after the real PR landed |
| `chore/eas-status-7725c5de` | One-shot CI edit pointing the read-only EAS status poller at a single build from 2026-07-23 |
| `chore/eas-status-map-preview-build` | Same, for a build from 2026-07-24 |
| `claude/pendev-redesign-prompt-r2cnl1` | A one-file redesign brief, superseded by PR #111 — which is itself superseded (§5c) |

## 5. Open pull requests — the real queue (13)

### 5a. Ready to merge, near-zero collision (10)

These ten are small (1–10 files each) and touch almost entirely disjoint files.
The suggested order resolves the only three overlaps, so each PR merges into a
tree that already contains what it depends on.

| Order | PR | Branch | Files | What it does |
| --- | --- | --- | --- | --- |
| 1 | #147 | `ci/production-readiness-gates` | 6 | Gates the production build, Edge Function types, dependency advisories |
| 2 | #152 | `chore/release-discipline` | 3 | Stops unsymbolicated production builds, detects function drift, release checklist |
| 3 | #149 | `chore/mobile-store-readiness` | 8 | Stops declaring push, fixes store-blocking config, deletes the shadow app config |
| 4 | #151 | `fix/customer-app-guards-and-locale` | 9 | Guards the eight unguarded mobile root routes |
| 5 | #148 | `fix/order-integrity-and-false-claims` | 10 | Customer notes, CSV import correctness, drops false ZATCA claims |
| 6 | #153 | `perf/admin-order-feed` | 1 | Stops re-downloading every order on every status change |
| 7 | #155 | `feat/delivery-map-link` | 3 | Opens a delivery address in maps from the receipt |
| 8 | #156 | `feat/admin-ux-resilience` | 6 | Remembers the open tab, warns when offline, printable ticket |
| 9 | #150 | `docs/incident-readiness` | 7 | Incident, rollback and backup runbooks |
| 10 | #154 | `docs/staff-operations` | 2 | Staff manual (AR/EN) and branch onboarding checklist |

**The only file collisions among these ten:**

| File | PRs | Handled by |
| --- | --- | --- |
| `src/context/AppContext.tsx` | #148, #153 | #148 merges before #153 |
| `src/components/admin/view/orders/OrderReceiptModal.tsx` | #148, #155, #156 | #148 → #155 → #156 |

Merging in the order above means at most a trivial rebase, and only for #153,
#155 and #156.

### 5b. Stacked pair — merge together, in order (2)

| PR | Branch | Base |
| --- | --- | --- |
| #145 | `ci/sql-suite-postgres` | default branch |
| #146 | `fix/address-description-whitespace` | **`ci/sql-suite-postgres`**, not the default branch |

#146 targets #145's branch, so **#145 must merge first**. If #145 is closed
without merging, #146 must be re-based onto the default branch or it will
silently carry #145's changes into a merge.

### 5c. Superseded — recommend closing (1)

| PR | Branch | Size |
| --- | --- | --- |
| #111 | `claude/pen-dev-guidelines-review-6dz4sr` | **274 files**, 58 commits |

PR #111 is a complete, alternative "Pen.dev" redesign of both the admin console
and the customer app, last updated **2026-07-29**. In the days *after* it was
opened, the repository designed, reviewed and shipped a **different** design
system — "Ember on Cream" (#118, #121–#136, #139, #140) — which is what is in
production today.

The two are mutually exclusive redesigns of the same surfaces. #111 is also the
only PR that collides broadly with the live queue: it touches
`PROJECT_STATUS.md`, `src/index.css`, `AdminDashboard.tsx`, three admin panels
and `NotificationSettings.tsx`, all of which other open PRs also change. It
additionally commits 71 screenshot PNGs and a `design/__pycache__` directory,
which do not belong in the repository.

**Recommendation: close #111 without merging** and delete the branch. Anything
still wanted from it (the WCAG AA corrections are the strongest candidate)
should be re-extracted as a small PR against the current design system. Reopen
this decision only with the owner.

## 6. `main` — leave it alone

`main` is a **stale snapshot from 2026-07-12 with no merge base** against the
default branch: the two share no common ancestor. Comparing them shows ~98,500
deletions — `main` is missing essentially the entire project as it exists now,
including every SQL test suite.

It is not a parallel line of development and there is nothing on it to recover.
It is also named as a protected branch in `CLAUDE.md`. Leave it in place; do not
merge it anywhere, and do not base work on it. Retiring it is a separate owner
decision, not part of routine cleanup.

## 7. Hygiene rules going forward

The 60-branch pile-up was caused by nothing deleting branches after merge.
These four rules keep it from recurring:

1. **Delete the branch when the PR merges.** Enable *Settings → General →
   Automatically delete head branches*. This single setting prevents the entire
   §3 category (41 of the 47 stale branches) from ever accumulating again.
2. **One PR per branch, and keep it small.** The ten PRs in §5a average six
   files and barely collide. #111 is 274 files and collides with everything.
   Size is what determines whether a queue can be worked at all.
3. **Do not stack PRs unless you must.** #146-on-#145 is manageable because it
   is documented here; an undocumented stack merges silently and wrongly.
4. **Re-audit before starting a new batch of work** with
   `scripts/branch-audit.sh`.

## 8. Re-running the audit

```bash
scripts/branch-audit.sh
```

The script classifies every remote branch as merged / stale / active. With the
GitHub CLI (`gh`) authenticated it reads the pull-request record and detects
squash-merges (§3b); without `gh` it falls back to ancestry only and says so —
in that mode it will under-report merged branches, never over-report them.
