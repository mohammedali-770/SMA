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

## 2. Dashboard questions — 2 of 4 answered

Nothing in the repository can answer the remaining two, and the readiness plan
cannot be sequenced honestly without them. Please answer and commit the values
into the files named. **2.2 and 2.3 are now closed** (struck through below);
**2.1 and 2.4 are still open**, and 2.1 is the most important line in this
document.

| # | Question | Where | Record in |
| --- | --- | --- | --- |
| 2.1 | Is **PITR** enabled on `wxfmmnihidsdyemasstf`? What is the retention window? | Supabase → Settings → Database → Backups | `docs/BACKUP_RECOVERY.md` §1 |
| ~~2.2~~ | ~~Is the **Vercel Production Branch** set?~~ **ANSWERED 2026-08-05** — set and promoted, verified against the deployed bundle (issue #102). | — | `docs/DEPLOY.md` |
| 2.3 | Is **`payment-refund-worker`** still `active = false`? | Supabase SQL: `select jobname, active from cron.job;` | `docs/MIGRATIONS.md` §21 |
| 2.4 | What **Node version** does Vercel build with? | Vercel → Settings → General | `docs/NODE_VERSION.md` |

**2.1 is the most important line in this document.** Until it is answered, the
honest statement is that we do not know we could recover this business's order,
payment and customer data. If the project is on the Free plan there is no PITR at
all, and enabling it is the highest-value spend in the whole plan.

**2.2 is answered and closed.** It was the cause of issue #102: with the
Production Branch unset, the default branch only ever deployed as a *Preview*, so
merging did not release and rolling back a commit did not un-deploy. It was set
and the newest deployment promoted on 2026-08-05, then verified by grepping the
deployed bundle. Kept here struck through rather than deleted, because the
failure mode — "the default branch is production" being quietly false — is worth
recognising if it ever recurs.

**2.3 is answered as of 2026-08-07** — `payment-refund-worker` is confirmed
`active = false` in `cron.job`, alongside the five active jobs. Re-check it after
any environment rebuild, because **2.3 guards a live financial landmine.** The refund stack is applied to
production and the cron row exists at `*/5`; it is held off by a manual
`cron.alter_job(active := false)` set **outside** the migration chain. Behind that
flag is a confirmed defect — the worker re-POSTs a brand-new refund on every
claim, because the gateway's normal asynchronous PENDING response releases the
lease with no backoff and no attempt cap. Any environment rebuilt from the chain
schedules it **active**.

---

## 3. Decisions with a cost

### 3.1 ✅ GitHub plan — DONE (2026-08-07), but one setting is still missing

**You upgraded to Pro, and a ruleset on the default branch is now active.** That
closes the original item: rulesets and branch protection are available.

> The `environment: production` gate in §1 is **not** automatically live as a
> result. The upgrade makes required reviewers *possible*; it does not create
> the environment. `deploy-functions.yml` still needs a GitHub Environment named
> `production` with you as a required reviewer, created at **Settings →
> Environments → New environment**. Until that exists the `environment:` line
> deploys without pausing — see the workflow's own comment at
> `.github/workflows/deploy-functions.yml:70-78`.

Observed enforcing merges during the 2026-08-07 session, each as a
`405 Repository rule violations found`: `pull_request` required,
`required_linear_history` (squash or rebase only — plain merge commits are
refused), `required_review_thread_resolution`, plus `deletion` and
`non_fast_forward` on the protected refs.

**What is still open, and it is the half that gates quality:**

> **No status check is required.** A pull request merged while its head commit
> carried *no completed CI runs at all*, and the only violation the API returned
> was thread resolution. CI can be red — or absent — and the merge still goes
> through.
>
> This is inferred from observed merge behaviour, not read from `/rulesets`
> (the agent tooling cannot read that endpoint). **Please confirm in Settings →
> Rules** before relying on either answer.

When you add `required_status_checks`, name the **check contexts**, not the
workflows — a required name that never reports is permanently pending and blocks
every merge:

| Require these five | Do NOT require |
| --- | --- |
| `design-system` | ~~`Design system`~~ — that is the workflow's display name |
| `Production build (Vite + Expo web export)` | ~~`Production gates`~~ — **no such check exists**; that workflow emits three separately-named jobs |
| `Edge Function typecheck (Deno)` | ~~`Migration chain + SQL suites`~~ — path-filtered, see below |
| `Dependency audit (high+)` | |
| `SQL suites gate` | |

**`SQL suites gate` is new, and it is what makes schema PRs gateable.** Until
2026-08-07 `sql-suites.yml` was filtered by path at the workflow level, so it did
not start at all on a docs-only PR — PRs #171, #173 and #174 all merged with no
SQL check. A required check is unconditional, so that shape could never be
required, and the riskiest changes in the repository were the ones CI could not
gate.

The filter now sits at the job level. `SQL suites gate` reports on every pull
request and fails closed: it passes when the suites passed, passes when no
SQL-relevant path changed, and fails on anything else — including a skip that
should not have happened. The expensive PostGIS replay still only runs when it
is needed, so the minutes saving is preserved.

Requiring all five is a settings change, not a code change, and it converts CI
from advisory to binding. It does **not** gate the *deployment* — that needs
§3.5.

### 3.2 External uptime monitoring

Nothing checks that the site is up, and the internal health monitor runs inside
the system it monitors. **Recommendation: any third-party prober alerting to a
phone.** ~30 minutes, independent of every freeze, and it closes the "total
outage produces no signal" gap that no amount of internal instrumentation can.

**Point it at the Supabase REST origin, not at `/` or `/app`:**

```
https://<project>.supabase.co/rest/v1/branches?select=id&limit=1
header: apikey: <anon key>
expect: HTTP 200 and a JSON array
```

`/` is a **false-green** target. `vercel.json` ends its rewrites with a
catch-all (`"source": "/(.*)", "destination": "/index.html"`), so any path that
is not a static asset returns `index.html` with HTTP 200 — including while the
database is unreachable, the anon key has been revoked, or the deployment is
days stale. `docs/DEPLOY.md` records a case where the `/` check passed while
production served a two-day-old build.

`/rest/v1/branches` is the cheapest request that exercises the parts that
actually break: PostgREST, anon-key auth, and a real table read (`branches` is
granted to `anon` with a public read policy, `20260707120200`). It hits the
**Supabase** origin rather than the Vercel domain, so if you want to tell "site
down" apart from "data down", run one probe against each.

#### Verified against Production, 2026-08-07

Both claims above were checked rather than reasoned about, because a probe
configured from a wrong spec is a monitor that reports green forever.

**Probe A — data.** `GET /rest/v1/branches?select=id&limit=1`

| Request | Result |
| --- | --- |
| with the legacy `anon` key | **200**, body `[{"id":"b0000000-…-0002"}]`, ~1.0 s |
| with the modern `sb_publishable_…` key | **200**, identical body |
| with **no** `apikey` header | **401** `No API key found in request` |

The 401 is the important row: it proves the probe exercises PostgREST and
auth, so a green result means something. Either key works — use the publishable
one.

**Probe B — site.** `/` is a false-green target, confirmed, and **worse than
§3.2 originally implied**:

| Path | Result |
| --- | --- |
| `/` | 200 `text/html` |
| `/app/` | 200 `text/html` |
| `/this-path-does-not-exist-20191` | 200 `text/html` |
| `/assets/index-C01JC8iy.js` (real) | 200 `application/javascript` |
| `/assets/definitely-not-real.js` (fake) | **200 `text/html`** |

The catch-all rewrite swallows even a missing file under `/assets/`, so **no
path on that origin returns a non-200 for a content problem.** Status-code
monitoring of the Vercel domain can therefore only ever catch a *total* outage —
DNS, edge, or Vercel itself. That is still worth having, but be clear about what
it does not cover: it cannot detect a stale deploy or a broken build, which is
precisely the failure `docs/DEPLOY.md` records having missed for two days.

**Probe C — staleness. This one is automatable, and it closes the real gap.**

An earlier revision of this section said catching a stale deploy "needs a
content assertion against a known-recent string, which changes every release" and
so "stays the manual check in `docs/DEPLOY.md`, not something a prober can do
unattended". **That was wrong**, and wrong in the direction that preserves the
very gap this section exists to close. Caught in review on PR #179.

Every Vite build embeds the deploy commit SHA: `vite.config.ts` aliases
`VERCEL_GIT_COMMIT_SHA` into `import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA` at
build time. It is therefore a literal string in the shipped bundle, and nothing
about it needs a human.

Verified against Production on 2026-08-07:

```
GET /                                  -> extract /assets/index-<hash>.js
GET /assets/index-C01JC8iy.js          -> exactly one /[0-9a-f]{40}/ match:
                                          1efab8dba099fba311763550f6eea1fb3496b90f
default-branch head at that moment:       1efab8dba099fba311763550f6eea1fb3496b90f
```

One match, and it resolved to a real commit — the merge of PR #178, minutes
earlier. So the check is: **deployed SHA == default-branch head**, and a
mismatch persisting beyond one deploy window means the alias is stuck on an old
build. That is exactly the failure `docs/DEPLOY.md` records having missed for two
days, and it is detectable unattended.

Two ways to run it, and the choice is yours because they cost differently:

- **An external prober that supports a content assertion** — two requests and a
  string compare. No CI minutes, but it needs the expected SHA from somewhere.
- **A scheduled GitHub Actions job** — has the expected SHA for free
  (`github.sha` on the default branch) and needs no external service, but it
  consumes Actions minutes on every run. Not built here: a recurring workflow is
  a standing cost, and that is your call rather than something to add unasked.

**Summary.** Probe A carries real signal about the data path. Probe B on `/` is
a liveness check only. **Probe C is the one that would have caught issue #102**,
and it needs no human.

### 3.3 Who gets woken at 02:00, and on what channel?

The alert-dispatcher work is pointless without an answer. **Recommendation:** name
one primary and one secondary in `docs/INCIDENT_RESPONSE.md` §2, use phone/SMS for
critical only, and start with email-for-critical so the plumbing ships before the
rota is perfect. Also decide **what a responder may do without you** — §5 currently
gates most real fixes behind your approval, so an unreachable owner means an
unfixable incident.

### 3.5 Disable Vercel auto-deploy so CI can actually gate a release

**Blocked on you; one dashboard toggle. Nothing in the repository can do this.**

Vercel currently builds and deploys **in parallel with** the CI gates, not after
them. The two never meet: a pull request whose tests fail still produces a
Preview, and a merge to the default branch deploys to customers regardless of
whether `Production gates`, `Design system` or `SQL suites` went red.

This is now independent of §3.1. Even once `required_status_checks` is added to
the ruleset, a required check gates the **merge**, not the **deploy** — Vercel
builds from its own webhook and does not consult them. So both changes are
needed, and this one is the only thing that stops a red build reaching
customers.

**The job now exists.** `production-gates.yml` carries a `deploy` job, and it is
**inert**: it runs only when a repository variable `DEPLOY_GATE_ENABLED` is
exactly `true`, which is unset. Merging it changed nothing about how the site
deploys today.

> **It gates on all five checks, not three.** A first version used only
> `needs: [build, edge-functions, audit]` — which is what this section used to
> specify — and that was wrong: `needs:` reaches only jobs in the *same*
> workflow, so `design-system` (the 1705 unit tests and the typecheck) and
> `SQL suites gate` (the migration chain) are invisible to it. The job would
> have deployed with those red while calling itself "gated on CI". Caught in
> review on PR #177.
>
> The cross-workflow half is now enforced by a step that polls the Checks API
> for this exact commit and requires every one of the five contexts in §3.1 to
> report success. It fails closed on a failure, a skip, a context that never
> reports, an API error, or a 25-minute timeout. `Migration chain + SQL suites`
> is deliberately not in that list — it is path-gated and legitimately skipped,
> which is precisely why `SQL suites gate` reports on its behalf.

> **Correction.** This section previously said "step 2 is written and ready but
> deliberately not merged". No such patch existed anywhere in the repository —
> only that sentence. Had you flipped the Vercel toggle and said "step 1 done",
> there would have been nothing to merge, at exactly the moment the site was
> unprotected. Writing it as a reviewed, version-controlled, switched-off job is
> the fix.

The order still matters, and doing it the other way round takes the site down:

1. **First**, Vercel → Settings → Git: turn **off** automatic deploys (or set the
   Ignored Build Step to exit 0 only for the gated path). Enabling the job while
   auto-deploy is on double-deploys every merge.
2. **Then** add the credentials — Settings → Secrets: `VERCEL_TOKEN`,
   `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
3. **Last**, Settings → Variables: `DEPLOY_GATE_ENABLED` = `true`.

The job's first step refuses to run if the variable is set but any secret is
missing, and says why — that combination means auto-deploy is off and CI cannot
deploy either, so nothing would reach customers at all.

> ⚠️ **The deploy path is UNVERIFIED.** It has never executed and cannot be,
> without the token and with auto-deploy still on. A green CI run on the file
> proves the YAML parses, nothing more. Before step 3, trial it once with
> `--prod` removed from the final command so it produces a Preview, confirm that
> deployment serves correctly, and only then switch to production.

**Do not add `Deploy to Vercel (gated on CI)` to the required status checks**
(§3.1). It is skipped on every pull request by design, and a required check has
no business gating on a job that intentionally does not run.

### 3.6 Should cancelling an order take its loyalty points back?

**Found 2026-08-07 by auditing the never-exercised post-`received` path.** Full
evidence in `PROJECT_STATUS.md`; the short version:

Loyalty points are credited when an order is **placed**, not when it is
delivered. Nothing takes them back when it is cancelled — there is no cancel
function, only `admin_set_order_status(id, 'cancelled')`, a bare `UPDATE` with
no validation and no state machine behind it. On Production today, **3 cancelled
orders carry 41 earned points, with zero reversal rows**, and those points are
in a live customer balance.

At current settings a point is SAR 0.10, so a cancelled order permanently grants
about **10% of its value as store credit**. Today that is SAR 4.10 of test data,
and only an admin can cancel — so this is an accounting inaccuracy rather than
something a customer can exploit.

**Why this needs you and not just a patch:** whether a cancellation claws points
back is a policy question with a customer-goodwill cost, and the answer differs
by *who* cancelled. *Options:* (a) reverse points on any cancellation — cleanest
ledger, but punishes the customer when **the branch** cancels; (b) reverse only
when the customer is at fault, which needs a cancellation-reason field that does
not exist yet; (c) leave as-is and accept the leak. **Recommendation: (a) now**,
because it is a contained migration and the current data is negligible, then (b)
later if refusal reasons are ever captured.

Whichever you pick, the underlying gap is worth closing separately: give
`admin_set_order_status` a real transition check server-side, mirroring the one
the admin console already enforces client-side. **This is a schema change and
therefore blocked on your approval** (CLAUDE.md §5) — nothing has been applied.

**One sequencing warning:** do not ship a customer-facing "cancel my order"
button before this is fixed. Today cancellation is admin-only, which is the only
reason the leak is bounded; a self-service cancel would turn it into a discount
generator.

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

**Audited against Production on 2026-08-07.** All **nine** rows in
`public.legal_documents` are untouched seed data: every one is `version 1.0`
with a **null `effective_date`**, a **null `updated_by`**, and an `updated_at`
of 2026-07-12. Not one has ever been edited. All are `is_active = true`, and the
RLS policy grants `anon` read on active rows — so everything below is live and
publicly readable right now.

#### Part A — needs no lawyer, only a correction

> **`account_data_deletion` is factually wrong about the product**, in both
> languages:
>
> - EN: *"In this version, deletion is handled by our support team; the app does
>   not delete accounts automatically."*
> - AR: *"...ولا يحذف التطبيق الحسابات تلقائياً"* — same claim.
>
> The app **does** delete accounts automatically: there is an in-app request
> flow, an `account_deletion_requests` queue and the `account-deletion-processor`
> cron running every minute. This is a product statement, not legal wording, and
> it is the single item here that needs no counsel — just an edit in the admin
> console.
>
> It also matters most: Apple reviewers specifically verify account-deletion
> claims, and a policy contradicting the shipped flow is exactly the
> contradiction a rejection opens with.

> **The word "placeholder" is shipped to customers.** The same document reads
> *"within a reasonable period (placeholder: e.g., 30 days)"* in English and
> *"(قيمة مبدئية: مثلاً ٣٠ يوماً)"* in Arabic. `contact_support` carries similar
> `e.g.,` stub markers. These are visible in the app today.

> **Every document has a null `effective_date`.** A policy with no effective date
> is defective on its face, and the column already exists — it just needs a value.

> **The rights channel is live but dead-ends.** `privacy_policy` enumerates the
> rights properly — access, correction, deletion, withdrawal of consent,
> complaint — and routes them: *"To exercise any right, please contact support
> (see Contact & Support)."* That document then gives, in both languages:
>
> - `support@example.com` **(edit in Admin)**
> - `+966 5X XXX XXXX` **(edit in Admin)**
> - Hours: **(edit in Admin)**
>
> So a customer exercising a data right today reaches nothing, and the
> instruction to the administrator is itself shipped to customers three times per
> language. An articulated rights process that dead-ends is worse than none — it
> creates the expectation and then fails it. Real contact details are a console
> edit; no counsel required.
>
> *(An earlier revision of this section listed the DSAR channel under "needs
> counsel — not stated anywhere". That was wrong: it is stated, and routed. It
> is the contact details behind it that are missing. Caught in review on PR
> #178.)*

#### Part B — needs counsel

Measured gaps, not opinions. Across all nine documents:

| Required element | State |
| --- | --- |
| Named data controller | **absent.** The policy says only `Spicy Meal ("we", "us")` — no legal entity, registration or address |
| Processor list | **present and substantive** — names Supabase, Tap Payments, Lazywait, Meta/WhatsApp and the SMTP provider |
| **Sentry as a processor** | **absent from that list**, yet Sentry is live on all three surfaces with an EU host — the one clear omission from an otherwise real list |
| Lawful basis | **absent as such.** Purposes *are* stated ("Why we collect it": account, orders, loyalty, legal/tax duties); the lawful-basis framing is not |
| Retention periods | qualitative only — "as long as needed… or as required by law", with **no periods** |
| Rights + DSAR routing | **present** — see Part A; it is the contact details that fail |

`privacy_policy` is much closer to complete than the phrase "placeholder text"
suggests: 1,871 EN / 1,668 AR characters, a real processor list, and correctly
enumerated rights. The counsel work is narrower than a rewrite — name the
controller, add Sentry, state the lawful basis, and put periods on retention.

Blocks store submission: both stores require a **publicly reachable** privacy
policy URL.

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
