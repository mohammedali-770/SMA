# Owner actions — everything blocked on you

> Derived from the production-readiness audit, 2026-08-03. Every item here is
> blocked because CLAUDE.md §5/§6 requires explicit owner approval, or because it
> needs a dashboard, a spend decision, or a legal answer that no engineer can
> supply.
>
> Ordered by risk carried, not by effort. Items 1–4 are the ones that change what
> happens when something goes wrong at 02:00.

---

## ✅ 0. `SUPABASE_ACCESS_TOKEN` — the trap is DISARMED (2026-08-05)

**This section used to say that adding that secret was the single most dangerous
action available in this repository. That is no longer true.** The workflow was
hardened on 2026-08-05, with owner approval, before the secret was added — which
is the order this section demanded.

What the danger was: `.github/workflows/deploy-functions.yml` carried a `push:`
trigger with **no `branches:` filter**, hardcoded to
`PROJECT_REF: wxfmmnihidsdyemasstf` (production), defaulting to exactly the four
payment functions that CLAUDE.md §6 **freezes**. On a `push` event
`inputs.functions` is empty, so the script fell through to that payment set.
So **any push, on any branch, touching that file deployed frozen payment
functions to production** — no PR, no approval, no environment gate.

It was not hypothetical: run **#4 fired from an unrelated feature branch**
(`claude/debug-tap-test-checkout-x3izo0`) on 2026-07-13. It never actually
deployed only because `SUPABASE_ACCESS_TOKEN` has never existed — all four of
its runs died at the CLI with *"Access token not provided"*.

**Verified absent immediately before the fix was pushed** (2026-08-05 06:31 UTC):
a read-only `workflow_dispatch` of `function-drift.yml` reported
`SUPABASE_ACCESS_TOKEN:` empty and failed with *"SUPABASE_ACCESS_TOKEN is not
set"*. That is what made pushing the fix safe — the disarm window this section
described was still open.

**You may now add the secret when you want to.** Doing so no longer arms a
deploy: the only route into this workflow is a manual `workflow_dispatch`, on the
production branch, with a typed confirmation (§1). Adding it also makes
`function-drift.yml` start reporting instead of failing every weekday.

Still true, and unchanged by the fix: **deploying an Edge Function requires your
explicit approval every time** (CLAUDE.md §5), and the payment functions remain
**frozen** (§6). The guards make an accidental deploy hard; they do not grant
approval.

---

## 1. Harden the deploy workflow — DONE (2026-08-05)

**Status: applied.** Editing that file *was* its own trigger, which is why this
was written out as a patch rather than pushed. It was safe to push once the
secret was confirmed absent (§0), and safe twice over because the pushed commit
removes the `push:` trigger — GitHub evaluates the workflow file *as it exists in
the pushed commit*, so no run is created.

What shipped, beyond the patch below:

| Guard | Effect |
| --- | --- |
| `push:` trigger removed | The only route in is a manual `workflow_dispatch`. |
| `if: github.ref == 'refs/heads/claude/project-build-ie4b56'` | A dispatch against a feature branch is skipped, never shipping unreviewed code. |
| `environment: production` | Pauses for a required reviewer — **inert until GitHub Pro/Team** (§3.1). |
| `permissions: contents: read` | Least privilege, instead of inheriting a possibly read-write default. |
| `confirm` input must equal `DEPLOY` | A deliberate typed step, not a click-through. |
| `functions` default now **empty** | It used to default to the frozen payment set, so opening the dialog and pressing Run deployed frozen payment code. The run now fails unless functions are named. |
| Token scoped to the deploy step | No other step can read `SUPABASE_ACCESS_TOKEN`. |
| Function names validated against the checkout | A typo cannot reach the Supabase CLI. |
| `actions/checkout` pinned to a commit SHA | A floating tag can be repointed; this job deploys to production. |

The last four are additions beyond the patch as originally written. Drop any of
them if you disagree — the load-bearing ones are the first two.

The original patch, kept for the record:

```diff
--- a/.github/workflows/deploy-functions.yml
+++ b/.github/workflows/deploy-functions.yml
@@
 on:
   workflow_dispatch:
     inputs:
       functions:
         description: "Space-separated function names, or 'all' for the payment set"
         type: string
         default: "payment-initiate payment-verify payment-webhook payment-return"
-  # Also runs when this workflow file itself changes, so the payment functions can
-  # be (re)deployed by touching it — used because workflow_dispatch via the API
-  # requires the workflow to live on the default branch. Requires SUPABASE_ACCESS_TOKEN.
-  push:
-    paths:
-      - '.github/workflows/deploy-functions.yml'
+  # The `push:` trigger that used to live here deployed the FROZEN payment
+  # functions to production from ANY branch, with no PR and no approval, because
+  # it had no `branches:` filter. Deploys are now deliberate only: run this
+  # workflow from the Actions tab.

 env:
   SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
   PROJECT_REF: wxfmmnihidsdyemasstf

 jobs:
   deploy:
     runs-on: ubuntu-latest
+    # Only ever deploy code that is on the production branch.
+    if: github.ref == 'refs/heads/claude/project-build-ie4b56'
+    # Requires a GitHub Environment named "production" with yourself as a
+    # required reviewer: the job then PAUSES for approval before it can deploy.
+    # Create it at Settings -> Environments -> New environment.
+    environment: production
     steps:
```

Two caveats, so this is not a surprise later:

- **The `environment:` gate needs GitHub Pro/Team** (see §3). On the current free
  private plan, required reviewers on environments are unavailable, so that line
  is declared but **inert** — the `if:` branch guard, the removed `push:` trigger
  and the typed confirmation are what actually protect you today.
- Removing `push:` means the only way to deploy is the Actions tab
  (`workflow_dispatch`). That is the intent. Note the workflow can no longer be
  triggered by touching the file, which was the old workaround for dispatching
  via the API against a non-default branch.

**Also worth knowing:** the workflow covers 4 of the 21 functions. The other 17
reach production by hand, and nothing records which commit any deployed function
was built from. See `docs/ROLLBACK.md` §2.

---

## 2. Four questions only the dashboards can answer

Nothing in the repository can answer these, and the readiness plan cannot be
sequenced honestly without them. Please answer and commit the values into the
files named.

| # | Question | Where | Record in |
| --- | --- | --- | --- |
| 2.1 | Is **PITR** enabled on `wxfmmnihidsdyemasstf`? What is the retention window? | Supabase → Settings → Database → Backups | `docs/BACKUP_RECOVERY.md` §1 |
| 2.2 | Is the **Vercel Production Branch** set to `claude/project-build-ie4b56`? | Vercel → Settings → Git | `docs/DEPLOY.md` |
| 2.3 | Is **`payment-refund-worker`** still `active = false`? | Supabase SQL: `select jobname, active from cron.job;` | `docs/MIGRATIONS.md` §21 |
| 2.4 | What **Node version** does Vercel build with? | Vercel → Settings → General | `docs/NODE_VERSION.md` |

**2.1 is the most important line in this document.** Until it is answered, the
honest statement is that we do not know we could recover this business's order,
payment and customer data. If the project is on the Free plan there is no PITR at
all, and enabling it is the highest-value spend in the whole plan.

**2.2 explains issue #102.** If the Production Branch is unset, merging does not
release and rolling back a commit does not un-deploy — "the default branch is
production" is simply false, and every deployment assumption downstream is wrong.

**2.3 guards a live financial landmine.** The refund stack is applied to
production and the cron row exists at `*/5`; it is held off by a manual
`cron.alter_job(active := false)` set **outside** the migration chain. Behind that
flag is a confirmed defect — the worker re-POSTs a brand-new refund on every
claim, because the gateway's normal asynchronous PENDING response releases the
lease with no backoff and no attempt cap. Any environment rebuilt from the chain
schedules it **active**.

---

## 3. Decisions with a cost

### 3.1 GitHub plan — CLAUDE.md documents a control that does not exist

Verified: `GET /rulesets` and `GET /branches/.../protection` both return **HTTP
403 — "Upgrade to GitHub Pro or make this repository public."** So no status check
can ever be *required*, and nothing server-side stops a direct push to a protected
branch. The agent hook is the only enforcement, and it binds agent sessions in
this repo only.

*Options:* upgrade to Pro/Team · make the repo public · accept manual review.
**Recommendation: upgrade.** It is the cheapest line item here and it also unlocks
the `environment:` approval gate in §1. If you decline, that is a legitimate
choice — CLAUDE.md has been corrected to describe reality either way.

### 3.2 External uptime monitoring

Nothing checks that the site is up, and the internal health monitor runs inside
the system it monitors. **Recommendation: any third-party prober on `/` and
`/app`, alerting to a phone.** ~30 minutes, independent of every freeze, and it
closes the "total outage produces no signal" gap that no amount of internal
instrumentation can.

### 3.3 Who gets woken at 02:00, and on what channel?

The alert-dispatcher work is pointless without an answer. **Recommendation:** name
one primary and one secondary in `docs/INCIDENT_RESPONSE.md` §2, use phone/SMS for
critical only, and start with email-for-critical so the plumbing ships before the
rota is perfect. Also decide **what a responder may do without you** — §5 currently
gates most real fixes behind your approval, so an unreachable owner means an
unfixable incident.

### 3.4 Staging environment

Every migration's first execution against a production-shaped database is
currently the production apply. **Recommendation: yes, but not before Phase 2** —
and note that building it from the chain activates the refund worker (§2.3).

---

## 4. Legal and compliance — needs counsel or the accountant, not an engineer

### 4.1 Who issues the tax invoice?

There is no ZATCA/Fatoora implementation anywhere: no invoice sequence, no seller
VAT registration number, no e-invoice XML, no QR.

The **false compliance claims have already been removed** from the console (PR
#148) — that was not contingent on this answer. What remains is the substantive
question. *Options:* (a) Lazywait POS is the fiscal system of record and this app
never implies it invoices — cheapest, **but delivery orders never reach Lazywait,
so delivery revenue would have no issuer**; (b) integrate a certified provider at
capture time; (c) stay as-is. **Recommendation: ask the accountant (a) first.**

### 4.2 Legal documents are still seeded placeholder text

Including one that tells a reviewer the app does **not** delete accounts — which
contradicts the shipped in-app deletion flow, and is the kind of contradiction an
App Store reviewer opens with. Needs counsel-reviewed AR/EN text naming the
controller, lawful basis, processors (including Sentry's EU host), retention
periods and the DSAR channel.

Blocks store submission: both stores require a **publicly reachable** privacy
policy URL, which also depends on §2.2.

### 4.3 Reviewer login

An App Store or Play reviewer physically cannot sign in: WhatsApp OTP to a `+966`
number is the only path, and there is no demo account or test-OTP configuration.
Needs Supabase Auth test phone numbers with a fixed OTP (**Auth config = §5
approval**), documented in the review notes.

---

## 5. Standing freeze items

Not requests — just the register of what stays blocked until you say otherwise.

| Area | State |
| --- | --- |
| Payment / Tap | **Frozen** (§6). Gateway not yet selected per `docs/PAYMENT_POSTPONEMENT.md`; refunds, reconciliation and part of the ZATCA path all block on that choice. |
| Push notifications | **Dormant** (§7). The app no longer declares the capability or prompts for permission (PR #149). Enabling needs the constant, the server row, the plugin, **and** your approval — all four. |
| Migrations | Only the approved `apply_migration` workflow. `supabase db push` / `migration repair` permanently forbidden. |
| Edge Function deploys | Owner approval, every time. |
| EAS / store builds | Owner approval. ⚠️ The native changes in PR #149 are **unverified** — please run one `preview` build before submission to confirm the push entitlement is gone. |

---

## 6. What has already been done without you

For contrast — these needed no approval and are open as PRs:

| PR | What |
| --- | --- |
| #147 | CI now gates the production build, Edge Function typechecking (found a real error in the auth path), and dependency advisories |
| #148 | Customer notes now reach staff; CSV import stops reporting success before writing; false ZATCA claims removed |
| #149 | Push undeclared; iOS export-compliance and tablet flags; AR/EN permission strings; deleted a shadow config declaring an unused camera permission |
| #150 | Incident, rollback and backup runbooks; `SECURITY.md`; corrected the CLAUDE.md enforcement claim |
| #151 | Eight unguarded root routes now require a session |
