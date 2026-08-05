# Git branch inventory & hygiene

> **Scope note.** This document is about **git branches**. In this project the
> word "branch" usually means a *restaurant branch* (see
> `docs/BRANCH_DELETION.md`, Branch Management in the admin console). Nothing
> here relates to restaurant branches.

> Originally audited **2026-08-05** at default-branch head `9032dfa`, when 60
> remote branches existed and 13 pull requests were open. **Refreshed the same
> day at head `6ca180f`, after the entire queue was merged.** §§1–5 record the
> state as audited (they are the reasoning, and the merge order is worth
> keeping); §2 and §9 carry the current numbers.

---

## 1. Why this document exists

The repository had accumulated **60 remote branches**. Only **13** of them were
live work; the other 47 were finished, superseded or dead. That ratio made it
impossible to see what was actually in flight, and it was hiding the real
problem: a **13-deep queue of unmerged pull requests**, several of which were
production-readiness gates.

Branch count was a symptom. The queue was the thing blocking production.

**That queue is now empty** — all 12 remaining PRs merged on 2026-08-05 in the
order recorded in §5, and #111 was closed. The lesson stands: read §7 before the
next batch of work, because nothing stops this recurring except deleting a head
branch when its PR merges.

## 2. Summary — current, at head `6ca180f`

| Class | Count | Action |
| --- | --- | --- |
| Finished — merged, squash-merged, or dead orphans | 57 | **Safe to delete** (§9) |
| `claude/pen-dev-guidelines-review-6dz4sr` — PR #111 closed, branch kept | 1 | Keep for re-extraction (§5c) |
| `claude/organize-project-branches-m7uun2` — merged, kept only as the live working branch | 1 | Safe to delete; see §9 |
| `main` — stale, unrelated history | 1 | Leave in place (§6) |
| `claude/project-build-ie4b56` — default/production | 1 | Protected |
| **Total** | **61** | |

Open pull requests: **0**.

Deleting the 57 takes the repository from 61 to 4.

**Status: the owner approved the deletion, but it could not be performed from
the agent session.** `git push --delete` is refused with `HTTP 403` by that
session's policy while ordinary pushes from the same session succeed — re-probed
after the queue was merged, still refused — and the GitHub MCP server exposes no
ref-deletion tool. **Nothing has been deleted.** §9 has the ready-to-run command
and every restore SHA.

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

## 5. The pull-request queue — ALL MERGED 2026-08-05

> **Historical record.** All 12 open PRs were merged on 2026-08-05, in exactly
> the order below, and #111 was closed. Every predicted collision resolved as
> described: no conflicts, no rework. Kept because the ordering method — merge
> the collision hub before its dependents — is the reusable part.

### 5a. Merged in this order, near-zero collision (10)

These ten were small (1–10 files each) and touched almost entirely disjoint
files. The order resolves the only two overlaps, so each PR merged into a tree
that already contained what it depended on.

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

#146 targeted #145's branch, so **#145 had to merge first**. Because branch
deletion is blocked, GitHub did not auto-retarget #146 when #145 merged — it
still pointed at `ci/sql-suite-postgres`, and merging it as-is would have merged
into that branch rather than into production. **#146 was explicitly retargeted
to the default branch before merging.** Watch for this on any stacked pair while
deletion stays blocked.

### 5c. Superseded — CLOSED 2026-08-05 (1)

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

**#111 was closed without merging on 2026-08-05 with owner approval**, and the
closing comment on the PR records why.

**The branch `claude/pen-dev-guidelines-review-6dz4sr` was deliberately kept**
— it is not in the §9 delete list, so nothing from this work is lost. The
strongest candidate for re-extraction is the WCAG AA work (status-colour
corrections, the danger/brand-red split, the unreadable dark-panel fix), which
should return as a small PR against the current design system rather than as a
wholesale redesign. Do not carry over the 71 screenshot PNGs or the
`design/__pycache__` directory.

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
squash-merges (§3b); without `gh` it falls back to ancestry only and says so.

A branch name on its own is never treated as evidence of a merge — names get
reused, and a reused name would otherwise inherit an old PR's verdict and be
reported as safe to delete while holding live work. The script therefore calls
a branch merged only when its **current tip equals the head SHA the merged PR
recorded**, and never while the branch has an **open PR**. A branch that has
moved on since its merge falls through to ACTIVE.

Every mode under-reports merged branches rather than over-reporting them,
because the cost of a false "safe to delete" is losing live work.

---

## 9. Appendix — deleting the 57 finished branches

> **Refreshed 2026-08-05 against default-branch head `6ca180f`**, after the
> whole pull-request queue was merged. This supersedes the earlier 45-branch
> list: everything on it is still here, plus the branches merged since.

The owner approved this deletion. **It still could not be performed from the
agent session**: `git push --delete` is refused with `HTTP 403` by that
session's egress/credential policy, while ordinary pushes from the same session
succeed. Re-probed on 2026-08-05 after the queue was merged — still refused. The
GitHub MCP server exposes no ref-deletion tool either (it can create a branch,
not delete one). This is a policy denial and is reported rather than routed
around.

Run this once from a normal local clone with push rights. Every name is listed
literally so nothing can be expanded wrongly:

```bash
git push origin --delete \
  agent/delete-branches-dashboard \
  agent/delete-branches-dashboard-copy \
  chore/eas-status-7725c5de \
  chore/eas-status-map-preview-build \
  chore/mobile-store-readiness \
  chore/release-discipline \
  chore/standardize-node-22 \
  ci/production-readiness-gates \
  ci/sql-suite-postgres \
  claude/fix-sentry-gate-verification-commands \
  claude/mobile-sentry-conditional-plugin \
  claude/mobile-sentry-upload-graceful-degradation \
  claude/pendev-redesign-prompt-r2cnl1 \
  claude/record-sentry-gate-verification \
  claude/spicy-meal-apk-build-nioaew \
  docs/address-delete-migration-runbook \
  docs/incident-readiness \
  docs/reconcile-ops-health-migration-ledger \
  docs/staff-operations \
  feat/admin-dashboard-navigation \
  feat/admin-ux-resilience \
  feat/button-field-migration \
  feat/checkout-address-ux \
  feat/delivery-map-link \
  feat/design-system-ember-on-cream \
  feat/discounts-campaigns \
  feat/ds-admin-catalog \
  feat/ds-admin-final \
  feat/ds-admin-operations \
  feat/ds-admin-primitives \
  feat/ds-admin-shell-ops \
  feat/ds-auth-surface \
  feat/ds-checkout-payment-surface \
  feat/ds-checkout-payment-ui \
  feat/ds-home-menu-surface \
  feat/ds-modal-focus \
  feat/ds-order-type-legacy-removal \
  feat/ds-orders-profile \
  feat/ds-product-cart-surface \
  feat/lazywait-api-v2 \
  feat/mobile-profile-management \
  feat/order-confirmation-state-machine \
  feat/order-read-contracts \
  feat/otp-autofill \
  feat/price-component-migration \
  feat/whatsapp-only-saudi-login \
  fix/address-description-whitespace \
  fix/checkout-money-display \
  fix/customer-app-guards-and-locale \
  fix/ds-muted-text-contrast \
  fix/eas-status-poller-project-dir \
  fix/hook-node-json-parser \
  fix/lazywait-lifecycle-test-case7 \
  fix/mobile-map-google-config \
  fix/order-integrity-and-false-claims \
  fix/refund-worker-scheduler \
  perf/admin-order-feed
```

Then prune stale remote-tracking refs in every other clone:

```bash
git fetch origin --prune
```

### What is deliberately NOT in that list

| Branch | Why it stays |
| --- | --- |
| `claude/project-build-ie4b56` | The default / production branch. |
| `main` | Protected, and a dead unrelated-history snapshot (§6). |
| `claude/pen-dev-guidelines-review-6dz4sr` | PR #111 was closed, not merged. The branch is kept so the WCAG AA work can be re-extracted (§5c). |
| `claude/organize-project-branches-m7uun2` | This session's working branch. It IS fully merged and is safe to delete — excluded only to avoid deleting a branch mid-session. Add it to the list if you want a clean sweep; its tip is `(see git)`. |

### Restore points

Branch tips as of 2026-08-05, before deletion. Restore any with
`git push origin <sha>:refs/heads/<branch>`. GitHub also keeps a deleted ref
restorable from its pull request page for a period afterwards.

| Tip SHA | Branch |
| --- | --- |
| `dcf87a551db1185897cf25da7174da34e4c6eeb3` | `agent/delete-branches-dashboard` |
| `5e311aaa1fab743a8f263bd8ca1550d4c0fd5e0f` | `agent/delete-branches-dashboard-copy` |
| `bf2b19e26b1f460e2a2214b241fcee563fe2c321` | `chore/eas-status-7725c5de` |
| `7f0e4be920622fa9c4df0c1f8d9f1500faca84d9` | `chore/eas-status-map-preview-build` |
| `d4bfdec8b8f660ac69d5e6f230eadc0ab7896314` | `chore/mobile-store-readiness` |
| `9364f3b87e6bec51bb55128209e7e662cb4220fe` | `chore/release-discipline` |
| `bc8106f71904d91beccbea6d495385b95feaf5d3` | `chore/standardize-node-22` |
| `586ca6bdae5a50719a5bb419895572606d29e652` | `ci/production-readiness-gates` |
| `8bd8caea462509ec38e2d2c0959320c9e68d3fdc` | `ci/sql-suite-postgres` |
| `110250970d0ed96283994cfc27127b0fc70679ae` | `claude/fix-sentry-gate-verification-commands` |
| `2e82287a6c698f6458aaa545015c0685a3ab1428` | `claude/mobile-sentry-conditional-plugin` |
| `98ba167649cb1e172b2b832654e4df9b4853592f` | `claude/mobile-sentry-upload-graceful-degradation` |
| `6453806f53bd4555980e65e5618cfefdffba2da7` | `claude/pendev-redesign-prompt-r2cnl1` |
| `4469f218c562c4a48ed10d386db2a3e906b1c5aa` | `claude/record-sentry-gate-verification` |
| `3777a10223d6e23d41e707a7c7f1a9229b61f13c` | `claude/spicy-meal-apk-build-nioaew` |
| `875b64fac564b067f77d5013157b5103949eb02c` | `docs/address-delete-migration-runbook` |
| `9eab7509598d51a9ab363ebe33950d877cce55b0` | `docs/incident-readiness` |
| `6468734fca287de88e3e872b7a3ba7faaca5fe66` | `docs/reconcile-ops-health-migration-ledger` |
| `bab00ff439257fde66f7a030cc0a759745119a7b` | `docs/staff-operations` |
| `9b0dcd8496d761d74f1d4b5cbf5d626340a07c76` | `feat/admin-dashboard-navigation` |
| `f85d38407ef40f0f512b51967cc2019ab45e1b34` | `feat/admin-ux-resilience` |
| `e9c437ef0cef91d4e828a2ef5920292addbcba95` | `feat/button-field-migration` |
| `aea28b0ba6899f8e5c0232d2f1555ebac8d22210` | `feat/checkout-address-ux` |
| `9bedf981c133a76e41e46898d8dec8280780e4fd` | `feat/delivery-map-link` |
| `2d01c0b49011bbb8059ae5cb9476608b44e51aa9` | `feat/design-system-ember-on-cream` |
| `39f926b1751a8746a042eff937e0c8e7221afd5e` | `feat/discounts-campaigns` |
| `c522e51d43a418c3c9aac6f9f408137b30f5cee2` | `feat/ds-admin-catalog` |
| `f95951711c28f494d48129eadf3577d9ded0be5b` | `feat/ds-admin-final` |
| `961b1ddd36de98e1581c0e7f249572709c5184bd` | `feat/ds-admin-operations` |
| `2fb149883fd73811f75d23e7e7b007c02f9bec17` | `feat/ds-admin-primitives` |
| `642743830a3b8fa53439d27e97e8469c79e7f1e6` | `feat/ds-admin-shell-ops` |
| `4b0f59a6606e687d1afb36e326afb3cde2811695` | `feat/ds-auth-surface` |
| `4371e1f828afc295c1752030716ae6cc124fff19` | `feat/ds-checkout-payment-surface` |
| `b7469fed17f740e4d7e47670925ded6e682cf96a` | `feat/ds-checkout-payment-ui` |
| `1e2b81bf3aa18377045f13050bd3be0d6d4efe15` | `feat/ds-home-menu-surface` |
| `8c4ec1f810b4a2dd4cb0d9fce80f47faab80894d` | `feat/ds-modal-focus` |
| `b62ffcfb6d286145e86f44cf0cb9d0539e1c0c03` | `feat/ds-order-type-legacy-removal` |
| `192843fb35a975160314fb39c67a4cb3e20c8530` | `feat/ds-orders-profile` |
| `b91dc06c29163dda127757ccef29fde9fae2e3dc` | `feat/ds-product-cart-surface` |
| `e0ecf47553b5406289ff6546a3f49df54040f331` | `feat/lazywait-api-v2` |
| `e80b71a35ab016fa943837c1a37cfa66da31df5d` | `feat/mobile-profile-management` |
| `f9191827a17b9a1e6fc466733183bbefd30bcdc3` | `feat/order-confirmation-state-machine` |
| `194628c99125fd30ce6ef62adc9e3b5a2ee0cf88` | `feat/order-read-contracts` |
| `adf2d85fe64461e2bda4ce874aa4a0bcb67c3807` | `feat/otp-autofill` |
| `21f180e5cbfd2334d6024193590f031178365eb2` | `feat/price-component-migration` |
| `537213b6fca31bbaeb66e105a127c7c07fcb92bc` | `feat/whatsapp-only-saudi-login` |
| `e595642ebe097b261bcce27564cc7add595d06fb` | `fix/address-description-whitespace` |
| `1ddd21750d7fc06b14e58c3541ef4cd773bbaafe` | `fix/checkout-money-display` |
| `594937ca1e1f718c310549a4583b8f124efa6381` | `fix/customer-app-guards-and-locale` |
| `d1b762b2d8f45e13d1d113b0eacd0e938d74b790` | `fix/ds-muted-text-contrast` |
| `61c32381941e75546e7042e9a6a0aa310c785d83` | `fix/eas-status-poller-project-dir` |
| `ac2f3f8a5b9e11e8c286706e40778e35d2238e3a` | `fix/hook-node-json-parser` |
| `a6511403f8e9019e12f920720aa08a62ef4c92b7` | `fix/lazywait-lifecycle-test-case7` |
| `33838b3eb60a5c26dd4768df22c97656cb47c043` | `fix/mobile-map-google-config` |
| `b5e08cb98d6a4d17009263d77d311b3b0602ac27` | `fix/order-integrity-and-false-claims` |
| `a497c432a0150d576759a5de385f06c41d60051a` | `fix/refund-worker-scheduler` |
| `94b25ad9a74f17095b2611657f55a5ae70ea6b4d` | `perf/admin-order-feed` |
