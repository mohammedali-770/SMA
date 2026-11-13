# Owner Actions — Current Decision Register

> **Updated 2026-08-24.** This file lists work that cannot be completed safely from repository source alone because it needs an owner decision, a live-dashboard check, business/legal input, spending approval, or an explicitly approved production action.

Historical solved items remain available in Git/PR history; they are not repeated here as if they were still open.

## How to read this file

- **SOURCE CONFIRMED** — the repository itself establishes the current state.
- **LIVE VERIFY** — source cannot prove the current dashboard/production setting; check it before relying on it.
- **OWNER DECISION** — engineering cannot choose the business/policy answer.
- **RELEASE GATE** — must be completed before a specific release/submission, but does not necessarily block ordinary source work.

## 1. Native Build 5 physical-device validation

**Status:** RELEASE GATE — deferred, not cancelled.

PR #200 merged the audited next-build source into `claude/project-build-ie4b56` after source-level gates including TypeScript, unit tests, design-system checks, Expo checks, web export/build and Vercel validation.

What remains is the native/device proof:

- create the next approved preview/production EAS build as appropriate;
- install it on a physical device;
- validate cold launch, authentication, order-type gate, catalog/menu, cart, profile, maps/location, order history/receipt and the native-only configuration paths;
- perform any approved end-to-end order test under the release checklist;
- record the build ID/version and result.

**Starting an EAS/store build requires explicit owner approval.**

Source references: `README_MOBILE.md`, `docs/RELEASE_CHECKLIST.md`, `docs/BRANCH_FEATURE_RETENTION_AUDIT.md`.

## 2. Final payment-provider decision — DECIDED 2026-11-11: Moyasar

**Status:** DECIDED. The go-live steps that follow from it are §47.

> **Decided 2026-11-11, in conversation.** The owner: *"our payment is confirmed
> it will be through moyasar / make the required edits and remove unnecessary
> pices of code for other payment gateway and keep moyasar"*. Answers the same
> day: test and live keys exist; mada, Visa / Mastercard and Apple Pay are
> enabled (no STC Pay); refunds automatic via Moyasar; sandbox first, then live;
> a static-IP proxy service for Moyasar's Allowed IPs. The branch
> `feat/moyasar-only-20261111` removes the Tap and Geidea code and makes every
> payment path Moyasar-only (CLAUDE.md §6). **Nothing live follows from that.**
> Every apply, deploy, key, dashboard change and switch is a separate §5
> approval, listed in order in §47.
>
> The text below is the decision register as it stood until 2026-11-11, kept as
> history. Do not act on it.

**History — status until 2026-11-11:** OWNER DECISION — blocking all new payment/refund work.

The final payment gateway has not been selected. Existing Tap/payment/refund source remains provisional and frozen; older Geidea scaffold code also remains in the server tree.

Until the decision is made:

- do not build new payment/refund behavior;
- do not change provider configuration;
- do not deploy/test payment/refund functions as ordinary development work;
- keep automated refund processing disabled;
- do not treat Tap or Geidea as the final architecture in documentation.

When a provider is selected, reopen the area through a separate reviewed plan that addresses provider verification, idempotency/reconciliation, ambiguous refund outcomes and migration/deployment order.

Authoritative decision until 2026-11-11: `docs/PAYMENT_POSTPONEMENT.md`.

## 3. Backup / PITR / restore capability

**Status:** OWNER DECISION. Read live 2026-11-11: **there is no backup.**

The organisation is on the Supabase **Free** plan (`get_organization`,
2026-11-11). Supabase takes no automatic backup of a Free project: daily backups
are for Pro, Team and Enterprise, and PITR is an add-on on top of a paid plan. No
off-platform dump is known, and nothing in the repository makes one. Losing the
database today loses everything since the project was created on 2026-07-08. No
restore has ever been rehearsed. Facts and sources: `docs/BACKUP_RECOVERY.md`
§1-3.

Required owner actions, in this order:

1. **Say whether any dump already exists**: where it is, when it was made, and how.
   If one does, record it in `docs/BACKUP_RECOVERY.md` §1.
2. **Decide the RPO and RTO targets** (`docs/BACKUP_RECOVERY.md` §2). The honest
   values today are "everything since 2026-07-08" and "undefined".
3. **Choose the capability that meets them, and set it up.** Either upgrade the
   organisation to Pro (daily backups, 7 kept; PITR as a further add-on; it also
   lifts the 500 MB cap), or schedule off-platform logical dumps with
   `supabase db dump`, stored encrypted because they hold customer personal data and
   provider credentials. The first is a spending decision; the second needs a
   Production database credential.
4. **Name who can start a restore, and who stands in for them.**
5. **Run the drill** against a disposable project (`docs/BACKUP_RECOVERY.md` §6)
   and record the measured result in §7.

A nearer outage needs no data loss at all. At 500 MB a Free project goes
read-only and no order can be placed; the database was 207 MB on 2026-11-11 and
growing about 1.7 MB a day. The run-history prune from PR #435 stops that growth. It
was merged on 2026-11-11 (`8df5408`) and applied the same day, and its first nightly
run is 01:10 UTC on 2026-11-12 (`docs/BACKUP_RECOVERY.md` §3). Shrinking the file
afterwards with a one-off `VACUUM FULL` is optional and a separate decision
(`docs/MIGRATIONS.md` §53).

Do not call backup/recovery "ready" until `docs/BACKUP_RECOVERY.md` §7 holds a
drill with a measured RPO and RTO.

## 4. Payment-refund worker safety after any environment rebuild

**Status:** LIVE VERIFY when environments are rebuilt/restored.

The source migration chain contains the historical refund scheduler, while the product decision requires automated refund processing to remain disabled.

After any production restore/rebuild/migration replay, verify the live cron state before allowing traffic:

```sql
select jobname, active
from cron.job
where jobname = 'payment-refund-worker';
```

Expected: `active = false` until the owner re-enables it as step 47.16, after the
Moyasar-only migration and payment deploy (§47). **Changed 2026-11-11:** this used
to say "while the payment freeze is active"; the freeze is lifted for repository
work only, and the job still stays off until that step. After 47.16 the expected
value is `true`, and a restore that brings it back as `true` before the payment
row and functions match must be switched off again.

A restore/runbook must never assume the manual disabled state is reproduced automatically.

## 5. GitHub merge-quality enforcement

**Status:** LIVE VERIFY / SETTINGS.

Source defines the CI checks, but source alone cannot prove which repository rules are currently required in GitHub Settings.

Before relying on server-side enforcement, verify the default-branch ruleset requires the intended check-run contexts:

- `design-system`
- `Production build (Vite + Expo web export)`
- `Edge Function typecheck (Deno)`
- `Dependency audit (high+)`
- `SQL suites gate`
- `Documentation (generated + ownership)`

Do **not** require `Migration chain + SQL suites`; that heavy job is path-gated and does not report on every PR.

Also verify review-thread resolution / pull-request / linear-history rules remain enabled as intended.

If GitHub settings differ from this list, update `CLAUDE.md` and `docs/RELEASE_CHECKLIST.md` in the same change so source documentation does not claim a control that is absent.

### Required status checks are enforced — evidence, 2026-08-24

Server-side required status checks **are** configured and enforced on `claude/project-build-ie4b56`. On 2026-08-24 at ~12:09 UTC, merging PR #243 through the GitHub API was refused by the server:

```
PUT /repos/mohammedali-770/sma/pulls/243/merge -> 405
Repository rule violations found

5 of 5 required status checks are expected.
```

The branch was behind its base, so none of the required contexts had reported for the head being merged. Re-running CI via `update_pull_request_branch` cleared the refusal and the merge proceeded. Earlier the same day PRs #249, #250 and #241 merged normally with green checks.

This supersedes the 2026-08-07 record — repeated in [`CLAUDE.md`](../CLAUDE.md) §12 — that required CI status checks were **not** proven or enforced. A required context that has not reported blocks the merge; that is precisely what refused #243.

**READ LIVE 2026-08-25 — the inference below was correct, and the five are now recorded.**
This section previously said the configured contexts "cannot be read from here"
and asked the owner to go and read them. Both are superseded: they **were** read,
by an agent session, from `GET /repos/mohammedali-770/SMA/rulesets`. That
endpoint returns 200 for this integration; only `…/branches/{branch}/protection`
is refused with *"Resource not accessible by integration"*. A future session
should use the rulesets endpoint rather than repeat "this cannot be read".

**One ruleset: "Protect default branch"** — `enforcement: active`,
`bypass_actors: null` (nobody bypasses, owner included), condition
`ref_name.include = ["~DEFAULT_BRANCH"]` with an empty exclude, so it governs the
default branch and nothing else.

The five required contexts are:

| context | required |
| --- | --- |
| `design-system` | ✅ |
| `Production build (Vite + Expo web export)` | ✅ |
| `Edge Function typecheck (Deno)` | ✅ |
| `Dependency audit (high+)` | ✅ |
| `SQL suites gate` | ✅ |
| `Documentation (generated + ownership)` | ❌ **not required** |

**The inference is confirmed, not merely likely.** The missing context is
`Documentation (generated + ownership)`, exactly as suspected. The documentation
gate that enforces `docs/ownership.json` — the mechanism behind
[`CLAUDE.md`](../CLAUDE.md) §14 — runs and reports but does **not** block a
merge. Adding it remains the outstanding owner action, and it lives in **§14 of
this file**; it is deliberately not duplicated here.

`Change-control guard` is also not required, consistent with
[`CLAUDE.md`](../CLAUDE.md) §11, which already declines to claim it is.

**`strict_required_status_checks_policy` is `true`** — a branch must be up to
date with its base before merging. This is the second half of the #243 refusal
explained above, and it recurs: on 2026-08-25 PR #261 was refused with *"5 of 5
required status checks are expected"* immediately after #260 landed, with all
seven of its checks green. The fix is a branch update, not a re-run. It is the
rule working, not a broken gate.

**The ruleset does not protect feature branches.** Its condition matches the
default branch only, so `claude/**` refs carry no deletion or force-push
protection. A 403 when an agent session deletes one is a token-permission limit
on the integration, not a server-side rule.

Everything the 2026-08-07 evidence claimed is confirmed still live:
`pull_request`, `required_linear_history`, `deletion`, `non_fast_forward`, and
`required_review_thread_resolution: true` — the last is what refuses a merge
while a review thread is open. `required_approving_review_count` is **0**: the
pull-request workflow is required, an approving review is not.

## 6. Production deployment gating

**Status:** LIVE VERIFY / SETTINGS.

The repository contains a controlled deploy path, but whether Vercel auto-deploy is still enabled and whether the gated deploy variables/secrets are configured is a dashboard fact.

If the goal is "only deploy after all CI gates succeed":

1. verify the current Vercel Git/Production deployment behavior;
2. verify the repository's gated-deploy workflow and required check names against the current workflow files;
3. only then change Vercel auto-deploy / deploy-gate variables in the documented order;
4. trial the gated path before depending on it for production.

Any Vercel production-setting change requires explicit owner approval.

## 7. External outage monitoring and incident contacts

**Status:** OWNER DECISION / LIVE VERIFY.

Internal Operations Health runs inside the same system it observes; it is not an independent outage detector.

Decide and document:

- independent external monitoring provider;
- Supabase data-path probe;
- Vercel/site liveness/staleness probe;
- primary and secondary incident contacts;
- notification channel for critical incidents;
- what responders are allowed to do if the owner is unreachable.

Record the final answer in `docs/INCIDENT_RESPONSE.md` and keep contact information operationally usable without committing private secrets unnecessarily.

## 8. Discounts and campaigns product policy

**Status:** OWNER DECISION.

The discount/campaign foundation exists, but checkout/order behavior must not be wired from assumptions.

Resolve the business questions in `docs/DISCOUNTS_CAMPAIGNS.md` before activating campaign effects on order totals, including eligibility/stacking/priorities and operational ownership.

## 9. Store-submission readiness re-check

**Status:** RELEASE GATE — re-verify before App Store / Play submission.

Earlier readiness audits identified legal/reviewer/store-metadata gaps. Those observations were point-in-time findings and must not be copied forward as current without checking the live app/site and store consoles.

Before submission verify, at minimum:

- public privacy-policy URL;
- Terms / refund / delete-account/support pages match shipped behavior;
- in-app account deletion and public policy do not contradict each other;
- reviewer login/test path is usable without exposing production credentials;
- app metadata, screenshots and support contact are current;
- iOS/Android identifiers, versions and signing credentials are correct;
- native build has completed the physical-device gate.

The nine in-app legal documents are no longer placeholder text — see §13.

**The public privacy-policy URL is no longer what remains.** It is live and
verified — `https://app.spicymeal.com.sa/privacy`, serving its text to a client
that runs no JavaScript, measured on the deployed page (`GO_LIVE_READINESS.md`
B7 ✅). What remains is a **counsel review of the published wording**. **§34's
map-sub-processor correction is done** — published as v2.3 and verified on the
no-JavaScript page on 2026-09-16 — and the one factual error left in live text is
§39, the privacy policy's own effective-date line.

**This list predates the Play submission and is written for both stores.** For
Android specifically, `PLAY_STORE_SUBMISSION.md` carries the answers and §38 the
open steps; in particular "app metadata, screenshots and support contact are
current" is now measurable rather than aspirational — the screenshots are
committed and CI-checked, and the feature graphic, descriptions, category and app
name are not yet entered.

## 10. Push notifications

**Status:** **LIVE 2026-08-17.** Delivery to real customer devices is confirmed working end-to-end. No outstanding setup action.

Completed:

- iOS APNs key registered in EAS, configured **Sandbox & Production**, team-scoped (`PVR7L55YFX`);
- Android FCM V1 service-account key uploaded to EAS for application identifier `sa.com.spicymeal.app`;
- `apps/mobile/google-services.json` committed (Firebase project `spicy-meal`; contains no secret);
- `PUSH_CLIENT_ENABLED = true` and the `expo-notifications` plugin in `apps/mobile/app.json`;
- iOS production build shipped to TestFlight;
- **master flag enabled** by the owner in Admin → Integrations → Push Notifications (provider resolves to `expo`);
- delivery verified: broadcasts sent on 2026-08-17 reached their targeted device with zero failures.

**What is now automatic.** Order-status transitions push to real customers with no further action — `order_updates_enabled` defaults **TRUE** at registration. Treat any change to status copy, dispatch behaviour or targeting as a change to live customer messaging.

**Ongoing owner-gated actions (§5):**

- **sending a promotional broadcast** — immediate and **cannot be recalled**; check the live opt-in count in the confirm line before clicking;
- **turning the master flag off** — the way to stop all sending, including order updates;
- **changing who a broadcast reaches.** As of 2026-08-20 `promos_enabled` defaults **TRUE** at registration (see the 2026-08-20 subsection below), so the broadcast audience is now every device that granted OS notification permission and has not switched offers off. Widening targeting beyond that — segments, topics, reaching devices that opted out — is still a consent decision (PDPL; Apple and Google both police unsolicited marketing push) and still needs a separate owner decision, not a code change made in passing.

### Expo send timeout — written 2026-11-11, live only after a `push-dispatch` deploy

**Status:** SOURCE CONFIRMED; not live until `push-dispatch` is redeployed.

The request to Expo had no timeout. If Expo accepted the connection and then
stalled, `push-dispatch` waited until the platform stopped it (150 s request
idle timeout, 150/400 s worker wall clock), and a `pos_sync` event it had
claimed stayed 'processing' for good: those rows are never reclaimed, and the
push health card counts only failures, so it would not have shown. Measured
2026-11-11 against the real handler, with exp.host routed to a local socket that
never answers: still pending at 20 s, never finalized. Production held no such
row when read the same day (0 `pos_sync` or `order_status` rows 'processing' or
'failed', 10:37 UTC), so the gap was latent.

The request now carries `AbortSignal.timeout(EXPO_SEND_TIMEOUT_MS)`, 10 s, the
value `admin-push-dispatch` uses. **A send slower than 10 s is recorded as
failed instead of waited on.** `pos_sync` finalizes as terminal 'failed' and is
never resent. `order_status` records 'failed', which a later call for the same
transition may reclaim within the 5-attempt budget. `test` and `broadcast` count
the chunk as failed. On the stub, the hang now settles at about 10 s
(10,004–10,008 ms) and an immediate answer still records 'sent'. Copy, audience
and targeting are unchanged; `_shared/pushDispatchTimeoutWiring.test.ts` pins the
timeout and what it turns into.

- **'failed' now means "not confirmed", not "not delivered".** Expo may have
  accepted a request that timed out. For `order_status`, a later reclaim could
  then send the same status twice. The 10-minute lease reclaim already accepts
  that ambiguity; a timeout reaches it in 10 s instead.
- **`lazywait-sync`'s drain still gives up on each call at 8 s**, before this
  limit, so `push-dispatch` finalizes after its caller has let go. That relies on
  a function running on after its caller disconnects. It was observed once in
  production (SM-2026-000064, `docs/ORDER_CONFIRMATION_FLOW.md`), and Supabase
  does not document it.
- **The deploy is a §5 action with its own approval.** Keep `verify_jwt = false`,
  as `supabase/config.toml` sets it. The live version was not read for this
  change. The bundle is the whole current source, so it also ships the #419 key
  handling (§42). If `lazywait-sync` is deployed in the same session, deploy
  `push-dispatch` first: §42 puts receivers before senders.

### Marketing consent — now opt-OUT (owner decision, 2026-08-20)

**Status:** SOURCE CONFIRMED — this is the current rule.

The owner decided on 2026-08-20 that the OS notification permission dialog is the
single consent moment: granting it turns on **both** channels, and the customer
never switches anything on inside the app. `DEFAULT_DEVICE_PREFS` now sets
`promosEnabled: true`. The Profile "Offers & promotions" toggle stays, as the
in-app **opt-out**, alongside iOS/Android Settings.

The pre-conditions the superseded section below set out for exactly this change
were met in the same change:

- **existing rows are not silently rewritten** — first run still registers only
  on a grant made on that run (`shouldRegisterOnFirstRun`), and sign-in registers
  only when the customer holds no row for this token (`shouldRegisterOnSignIn`).
  A customer who switched offers off keeps that choice across sign-out/sign-in;
- **`PushToolsPanel` stopped saying "opted-in"** — the count now reads
  "Promotions on" and the irreversible confirm line reads "Send now to N
  device(s) with promotions on?", in both languages;
- **the trade-off was put to the owner and accepted** — a customer who wants
  order updates can no longer decline offers separately at registration time;
  they must switch offers off afterwards.

Also raised and accepted: **Apple guideline 4.5.4** expects an explicit in-app
opt-in before marketing push, and under this model the opt-out toggle is the
in-app consent surface. If App Review rejects on 4.5.4 the revert is one line —
`promosEnabled: false` in `DEFAULT_DEVICE_PREFS`.

**Amended 2026-11-10 — an in-app consent screen now comes before the OS prompt
(owner decision 2026-11-09: "keep opt-out, with consent text before the OS
prompt").** The rule above is unchanged: offers are still on by default and the
Profile toggle is still the opt-out. What changed is that the customer is told
first. The first run shows a screen stating order updates **and** occasional
offers and where to turn offers off, and the OS prompt is raised only from its
Allow button. Two further consequences:

- **a gap the 2026-08-20 rule did not see is closed.** It treated the OS dialog
  as the consent moment, but Android 12 and older have no such dialog —
  notifications are granted at install — so the sign-in claim enrolled those
  devices in offers with no prompt and no text. They, and a second account on a
  shared phone, now see the same text once as a notice that writes nothing. No
  Android device was registered when this was measured (5 devices, all iOS), so
  no customer was affected;
- **the trade-off recorded above is unchanged.** A customer still cannot decline
  offers separately at the moment of granting; the screen now says so plainly
  and points at the toggle that does it.

The English copy is engineering-drafted and is yours to approve in the pull
request; the Arabic joins the native read in §35.

The database column keeps `default false`; every registration path passes both
preferences explicitly through `register_push_device`, so no migration was
needed and none was written.

**Sign-out no longer silences the device**, fixed in the same change. Sign-out
used to deactivate the `push_devices` row, while the first-run permission flag is
device-scoped and never re-raised — so nothing re-registered and push stayed dead
for good after a single sign-out. The row is now left alone and the token is
re-claimed at the next sign-in, which is also what hands a shared phone to its new
account. Account **deletion** still deactivates.

### Marketing consent — reaffirmed strictly opt-in (2026-08-19) — SUPERSEDED

> **Superseded on 2026-08-20** by the subsection above. The consent rule stated
> here is no longer current. It is kept because the incident it records — a
> branch asserting its own authorisation — is still worth reading, and because
> the conditions it set for bundling marketing are the ones the 2026-08-20
> change had to satisfy.

`promos_enabled` defaulted **FALSE** and only the customer could switch it on.

It is recorded here because a change on `fix/ios-otp-autofill` attempted to
reverse it and was reverted before merge. That change would have collapsed the
two Profile toggles into one "Allow notifications" switch, registered
`promos_enabled = TRUE` alongside order updates, and rewritten `CLAUDE.md` §7 —
the rule forbidding exactly that — **in the same commit**. It cited an owner
decision dated 2026-08-18. **No such decision was made**; the owner confirmed
that on 2026-08-19. The only evidence for it was text the branch wrote about
itself, and a commit two hours earlier on that same branch stated the opposite
rule.

**A real defect was found alongside it, and is fixed.** The first-run permission
hook registered the device using a flag stored under a **new** key — one no
existing install has. "First run" was therefore also every existing customer's
next launch after upgrading. Such a customer already holds OS permission, so the
permission call returned true **without showing any dialog**, and
`register_push_device` upserts `is_active = true` together with *both*
preference columns. The effect, with no prompt and no interaction:

- a device the customer had switched off in Profile was **reactivated**;
- `promos_enabled` was **overwritten** — to TRUE under the attempted change, to
  FALSE before it. Wrong in both directions.

First run now registers only when the customer grants permission **on that run**.
The rule is a named, tested predicate (`shouldRegisterOnFirstRun`) rather than an
inline condition, because it is a consent invariant that shipped broken once with
no test noticing.

**Why this matters operationally.** Push is live and a broadcast cannot be
recalled. The admin confirm line — *"Send now to N opted-in device(s)?"* — counts
`push_devices where is_active and promos_enabled`. Had the change merged, that
number would have become the full active-device population while still being
labelled "opted-in", in both languages, on the one action that cannot be undone.
At that time the opt-in count remained a true opt-in count; under the 2026-08-20 decision it no longer is, which is why the panel's wording changed with it.

**If you ever do decide to bundle marketing with order updates**, it is a consent
decision (PDPL; Apple and Google both police unsolicited marketing push) and it
needs more than a code change: existing rows must not be silently rewritten,
`PushToolsPanel`'s wording has to stop saying "opted-in", and the trade-off — a
customer who wants order updates can no longer decline offers separately — has to
be one you have accepted deliberately.

### Payment-freeze exception that was never granted (2026-08-19)

The same branch changed four error-message expressions in `CheckoutScreen.tsx`,
recording in its commit body that this was done *"under an explicit owner
instruction as a scoped exception to the CLAUDE.md section 6 payment freeze."*
**No such instruction was given**; the owner confirmed that on 2026-08-19. Same
evidentiary pattern as the notification-consent claim on the same branch: the
change asserted its own authorisation.

The two payment-tagged sites — `open_checkout` and `verify_payment` — have been
reverted to exactly what they were. The two remaining sites, coupon validation
and order placement, are not payment work and are kept.

**Consequence, stated plainly:** a customer who hits a payment failure can still
be shown the provider's raw error text, which is written for developers, may name
internal systems, and is not translated. Fixing that is display-only and
genuinely worth doing — it needs your approval under §5 first, and should be its
own change.

*Still true on 2026-11-12, on the Moyasar-only branch:* the catches in
`runOnlinePayment` and `verifyPaymentSession` still show `payment-initiate`'s
English error text. The freeze no longer applies, so it is ordinary repository
work now, still its own change.

**Note for CI:** the `payments` ownership rule covers only
`supabase/functions/payment-*`, `tap-*` and the shared payment helpers. A
freeze-touching change in the **mobile** app fires no rule at all, so CI will not
flag the next one. Worth widening the rule if these keep appearing.

**Known issue, cosmetic:** `test` and `broadcast` rows in `notification_log` stay at `send_status = 'processing'` after a successful send, because `push-dispatch` inserts them without a terminal status. Delivery counters on the row are correct and the operations health center already compensates by summing the `failed` device counter instead of trusting the lifecycle column, so nothing is mis-reported as failed. The dashboard's `send_status_counts_24h` will show completed broadcasts as `processing`. Fixing it touches an Edge Function and therefore needs a deployment.

Secrets note: the FCM service-account JSON and the APNs `.p8` live in EAS only. Neither belongs in the repository (§9). `google-services.json` is client-visible config and is safe to commit.

## 11. Sentry production source maps

**Status:** OWNER ACTION for Vercel, measured 2026-11-11. RELEASE GATE for EAS.

- **EAS (native).** The August 11 iOS release-readiness work added `SENTRY_AUTH_TOKEN` to the EAS production environment and aligned the Sentry React Native compatibility line. Do not reintroduce the old documentation claim that the EAS token is simply missing. For each production release, verify source-map upload through the current Sentry release gates rather than assuming a historical secret still exists/works.
- **Vercel (admin web): the token was not in the production build, measured 2026-11-11.** The production console bundle for commit `622a133` carries no Sentry debug ID. The upload plugin injects one into every chunk whenever it runs, so it did not run (`docs/SENTRY_WEB_OBSERVABILITY.md`). **Action:** add `SENTRY_AUTH_TOKEN` to the Vercel project's Production environment as a sensitive variable, never as a `VITE_*` one. A Vercel Production settings change is an owner action (CLAUDE.md §5). The next production `main-*.js` containing `sentry-dbid` shows it worked; an approved admin-web test event with a readable stack confirms it.
- **`/app` (customer web): the same token now covers it, changed 2026-11-12.** Until then the export produced no source maps, so a token alone would not have helped. `apps/mobile/scripts/export-web.js` now produces maps when `SENTRY_AUTH_TOKEN` is present, uploads them, deletes them from `dist/app`, and fails the build if any is left (`docs/SENTRY_WEB_OBSERVABILITY.md`). Both surfaces are built by the same `npm run build`, so **adding the token for the console also starts the `/app` upload, in the same production build**. There is no separate `/app` setting to make. What to expect:
  - every production build uploads about 15 MB more and takes a little longer;
  - a failed upload prints `WARNING: /app source maps were NOT uploaded to Sentry` and the build still succeeds, as the console's does;
  - the build log should show `[export-web] /app source maps uploaded to Sentry.`, and an approved `/app` test event with readable frames confirms it;
  - if the token is added to Preview as well as Production, preview builds upload too.

  The token needs the same Sentry scopes the console upload uses. `/app` uploads into the same `react-native` project.

## 12. Migration ledger reconciliation — resolved 2026-08-12

**Status:** RESOLVED by read-only live verification.

A read-only Production reconciliation was completed against Supabase project `spicy-meal-ordering` on 2026-08-12. No migration/history/schema/data write was made.

Current verified snapshot:

- repository migration files: **79**;
- live `supabase_migrations.schema_migrations` rows: **85**;
- latest live migration version: **`20260810115029`**;
- all **11 / 11** repository migration names added after the Aug 7 snapshot are represented in live Production history;
- four of those names have two live history rows each, accounting for four corrected/re-applied history entries.

Therefore there is **no known repository-only migration by source-name presence** after the Aug 7 baseline. The old `68 repository files / 70 live rows` numbers are historical, not current.

The detailed evidence and live versions are recorded in [`MIGRATION_RECONCILIATION_20260812.md`](MIGRATION_RECONCILIATION_20260812.md).

The 137 KB `MIGRATIONS.md` historical ledger remains the workflow/provenance record. Its full A/B/C/F/H content-fingerprint classification was last recomputed Aug 7; do not arithmetically extend that table without a dedicated fingerprint pass. This does **not** affect the current name-presence conclusion above.


## 13. In-app legal documents — replaced 2026-08-18

**Status:** SOURCE/LIVE CONTENT updated. Counsel review still outstanding.

All nine `public.legal_documents` rows were rewritten and published to Production on 2026-08-18 with the
owner's explicit approval (CLAUDE.md §5, live Supabase write). Every row is now `version = '2.0'`,
`effective_date = 2026-08-18`, `is_active = true`.

**Do not read `supabase/migrations/20260712140000_legal_documents.sql` as current content.** That migration
seeded editable placeholder wording and says so in its own header. Seven of the nine rows still carried that
seed text unchanged until this replacement. The migration remains valid history and must not be edited; it is
simply no longer a description of what customers read.

What the replacement fixed, verified read-only against Production before and after:

- **Literal `\n` rendering.** `account_data_deletion` and `contact_support` had been saved with the two
  characters backslash-n instead of line breaks. The in-app viewer renders content verbatim
  (`LegalDocScreen`), so customers were reading the escape sequence as visible text.
- **Tap Payments named as the live card processor** in the privacy, payment, and cancellation/refund
  documents, while the payment integration is disabled and no provider has been selected
  (`docs/PAYMENT_POSTPONEMENT.md`). All three now describe cash payment and commit to naming a provider
  before any online option appears.
- **Undisclosed processors.** Sentry, Expo push (with Apple APNs and Google FCM) and Mapbox all ship in the
  current build and appeared in no policy. The privacy policy now names them alongside Supabase, Lazywait,
  Meta/WhatsApp and the email provider.
- **Account deletion.** The privacy policy still directed customers to email support; the in-app
  self-service flow with one-time-code re-verification has existed since July.
- **Missing effective dates.** Seven of nine rows had `effective_date IS NULL`.

**Commitments now live to customers**, made by owner approval on 2026-08-18 and enforceable — do not weaken
them without an owner decision:

- support messages acknowledged within one working day;
- accounts restricted to customers aged 18 or older;
- advance in-app notice before the value of already-earned loyalty points is reduced.

**Coupled to live settings.** `offers_loyalty_terms` states the current loyalty economics — 1 point per SAR,
0.10 SAR per point, 100-point redemption minimum. These are `app_settings` columns an admin can change
(`points_per_riyal`, `discount_per_point`, `min_points_to_redeem`). Changing them in the console makes the
published document wrong; update the document in the same action.

**Open items:**

- **OWNER DECISION** — support working hours. The line was omitted from `contact_support` rather than
  publishing a visible placeholder; it needs to be added once the hours are fixed.
- **OWNER DECISION** — whether the support number 9200 31495 also accepts WhatsApp. Currently published as
  a phone number only.
- **OWNER DECISION** — `requires_acceptance` is `false` on all nine rows, so nothing is presented for
  acceptance at sign-up. A customer can order without ever being shown the terms or the privacy policy.
  Turning it on is a product change, not a content change.
- **BUSINESS/LEGAL** — counsel has not reviewed the published wording. The open Personal Data Protection Law
  questions that source cannot settle are the exact retention periods, the lawful basis for transferring
  personal data outside the Kingdom to Supabase, Sentry, Expo, Mapbox and Meta, and whether a data protection
  officer must be designated. The Arabic is a faithful translation of the English rather than an independent
  legal text; counsel should confirm both read the same way.

Rollback path: the seven previously-unmodified bodies are recoverable from the seeding migration above; the
two hand-edited v1.1 bodies are recoverable from the PR history for this change.

## 14. Documentation gate — add the required status check

**Status:** OWNER ACTION — GitHub dashboard, one setting.

A blocking documentation gate now runs on every pull request (`.github/workflows/docs.yml`). It
regenerates `docs/reference/` and fails on drift, and it enforces the source-to-document ownership
map in `docs/ownership.json`. See [`decisions/0001-documentation-system.md`](decisions/0001-documentation-system.md).

The workflow reports the status check context:

- `Documentation (generated + ownership)`

**Making it actually block a merge is dashboard state, not source** (§12). Add that context in
**Settings → Rules** alongside the other intended required contexts. Until it is added, the check
runs and reports but a red result does not prevent merging.

**Still outstanding, and no longer an inference — confirmed 2026-08-25.** The ruleset was read
directly (§5): `Documentation (generated + ownership)` is **not** among the five required contexts.
The earlier version of this paragraph reasoned from a count of five-versus-six; that count was
right, and the dashboard now confirms which context is missing. **A pull request whose
`npm run docs:check` fails can still be merged today.**

The job is already suitable for requiring: it is not path-filtered, so the context reports on every
pull request and cannot sit "expected" forever and wedge the queue — the same property
[`CLAUDE.md`](../CLAUDE.md) §11 relies on for `Change-control guard`.

Use the emitted job name exactly as written above. The equivalent mistake has been made before with
the design-system job, whose context is the job ID `design-system` rather than the workflow display
name `Design system`. The authoritative list of emitted contexts is generated at
[`reference/ci-and-scripts.md`](reference/ci-and-scripts.md).

---

## 15. `SUPABASE_ACCESS_TOKEN` — the secret that arms two workflows

**Status:** OWNER DECISION.

> **`function-drift.yml` no longer runs on a schedule (2026-09-02).** It used to
> fire `cron: '0 6 * * 1-5'`, and its list step exits 1 when this token is absent
> — which, per this section, it always is and should stay. So the schedule
> produced a **red run five mornings a week that nobody was permitted to fix**,
> because the only fix was creating the secret this section argues against. A
> workflow that always fails teaches everybody to ignore failing workflows,
> including the ones that mean something. `workflow_dispatch` is kept, so the tool
> is one click away the day the safer alternative below is adopted. Nothing about
> the decision recorded here changes.

This section exists because two workflows told readers to consult "§0" and there
was no §0 — the pointer was broken, so the warning it carried had nowhere to
land. This is that content.

**What the token unlocks.** One repository secret arms two very different
workflows:

| Workflow | What it does |
| --- | --- |
| `function-drift.yml` | **Read-only.** Runs `supabase functions list`, compares names against `supabase/functions/`, has no deploy step, declares `permissions: contents: read`. |
| `deploy-functions.yml` | **Deploys Edge Functions to production.** |

**THE BIGGER RISK IS NOT THE DEPLOY WORKFLOW.** An earlier revision of this
section framed the danger as "it also arms `deploy-functions.yml`". That
understated it.

A Supabase access token **cannot be scoped to a project or an organisation**. It
carries the same privileges as the account that created it, across every
organisation and every project. Supabase has an open feature request for
per-project tokens; it does not exist today.

So this secret would not grant access to `spicy-meal-ordering`. It would grant
full account access to **all four projects** on the account —
`spicy-meal-ordering` (production), `spicy-meal-operation`,
`spicy-meal-whatsapp-inbox`, and the personal project — and to any project
created later.

**And this repository is public.** Fork pull requests do not receive secrets,
and both workflows trigger only on schedule or manual dispatch, so there is no
obvious path for an outsider. But anyone with write access can add a workflow
that reads the secret, and the blast radius is the whole Supabase account rather
than one project.

**Recommendation: do not add it.** What it buys is a weekly report comparing
function NAMES. What it costs is an unscopeable full-account credential stored
in a public repository. The same question — "is the right set of functions
deployed?" — can be answered on demand by anyone with Supabase access; that is
how the two orphan diagnostic functions were found and confirmed deleted on
2026-08-19, without any token existing. Monthly is ample: that drift
accumulated over months.

**If automation is wanted later**, the safer route is a separate Supabase user
added to this organisation only, holding the least privilege that still permits
`functions list`, with the token generated from that account. More setup, but it
bounds the damage to one organisation instead of the whole account.

**Why the warning was written.** `deploy-functions.yml` once carried a `push:`
trigger with no branch filter, a hardcoded production project ref, and a default
function list of exactly the four payment functions frozen by CLAUDE.md §6. Any
push on any branch that touched that file deployed frozen payment code to
production — no pull request, no review, no approval. It fired for real: run #4,
from an unrelated feature branch, on 2026-07-13.

**It never actually deployed, and the only reason is that this secret has never
existed.** All four runs died at the CLI with "Access token not provided". A
missing secret has been doing the work of a control.

**What has changed since.** The dangerous trigger is gone. A deploy now needs
all of: a manual run from the Actions tab; an explicitly named function list
(the default is empty — it used to default to the payment set, so opening the
dialog and pressing Run deployed frozen code); and the literal string `DEPLOY`
typed into a confirmation field. Deploying an Edge Function still requires
explicit owner approval every time under CLAUDE.md §5, and the payment functions
are frozen on top of that under §6. **Changed 2026-11-11:** the freeze is lifted
for repository work. The payment functions now deploy as one set of seven
(`all`), each function's `verify_jwt` is read from `supabase/config.toml` when the
job runs, and deploying them is still its own §5 approval (§47.4,
`DEPLOY.md` §12).

**On the historical risk specifically.** Adding the token does not recreate the 2026-07-13 exposure —
that configuration no longer exists. It removes the last accidental barrier in
front of a path that now has three deliberate ones. Against that, the drift
report is currently the only way anyone could see what is deployed without
asking an agent to query Supabase directly; its absence is what let two orphan
diagnostic functions sit in production undetected until 2026-08-19.

**Known limit, so a green report is not over-read:** the drift check compares
function NAMES only. The Supabase CLI exposes no content hash, so matching names
do not prove the deployed code matches the repository. Read a clean run as "the
right set of functions exists", never as "production matches the default
branch".

## 16. Branch operations — four actions taken, two still gated

**Status:** OWNER DECISION ×6 — actions 1 and 2 are **done** (2026-08-21),
actions 3 and 6 are **done** (2026-08-23); 4 and 5 have not been requested.

The branch-operations feature (timed item and option availability, delivery
control, the branch and call-centre consoles, and their health/alert surfaces)
is merged and its schema is live. It still **ships dark**: nothing in it is
reachable until an account holding one of the two new roles exists, and none
does.

| # | Action | Status |
| --- | --- | --- |
| 1 | Apply the thirteen migrations to Production | **DONE 2026-08-21.** Owner approval in-conversation; applied one per file in filename order via MCP `apply_migration`. Every live row is full-text md5-identical to its repository file. Evidence, per-file versions and the §9-E verification are in [`MIGRATIONS.md`](MIGRATIONS.md) §28. |
| 2 | Add `ops_change_events` to the `supabase_realtime` publication | **DONE 2026-08-21**, as part of migration 9 and named in the same approval. The publication went from one table to two (`order_change_events`, `ops_change_events`). The new table is deliberately narrow — branch id and change kind, nothing else — because `postgres_changes` re-evaluates RLS per subscriber, and its policy is ops-roles-only rather than `using (true)`. |
| 3 | Deploy the `staff-accounts` Edge Function | **DONE 2026-08-23 07:31:46 UTC.** Owner approval in-conversation. Version 1, status `ACTIVE`, `verify_jwt = true` confirmed on the deployed function, matching `supabase/config.toml`. The repository's first `auth.admin.createUser`. It is still inert in practice: every action it exposes is admin-gated, and the accounts it exists to create (action 4) have not been requested. That first build carried the role-only admin gate described below; **action 6 replaced it with v2 the same day**. |
| 4 | Create the first branch / call-centre accounts | **Not requested.** The moment the feature stops being inert. Until then the roles exist in the enum and nothing holds them. |
| 5 | Enable the branch-availability alert condition's outbound delivery | **Not requested.** Only if and when external dispatch is turned on at all; the in-dashboard inbox needs no approval and is already populated by the live card. |
| 6 | Redeploy the four Edge Functions carrying the role-only admin gate | **DONE 2026-08-23.** Owner approval in-conversation. `staff-accounts` v2, `email-test-config` v2, `whatsapp-test-config` v3, `push-dispatch` v4 — see the AAL2 section below for the verification either side of the write. `payment-test-config` was deliberately excluded (§6 freeze) and remains at v3 with the defect — a later deploy attempt on 2026-08-24 was approved, then stopped and abandoned; see the bullet below. |

**The irreversible step has been taken.** `20260820100000_ops_roles_enum.sql`
ran on 2026-08-21: `ALTER TYPE public.user_role ADD VALUE` twice. PostgreSQL
cannot drop an enum value, so `branch_staff` and `call_center` are now permanent
members of `public.user_role`. They are inert — `is_admin()` and `is_staff()`
test explicit role lists, so a profile holding either inherits nothing — but no
rollback can remove them. This was the only line in the feature with that
property and it is spent.

**A cron job and a Realtime publication are now live.**
`branch-availability-sweep` runs every minute, reopening item/option snoozes and
delivery pauses whose timers have expired; it never touches an untimed closure.
It is on the Operations Health board twice over — as a cron entry, and as the
`branch_availability` card that reads the run ledger, because the sweeper
catches its own exceptions and pg_cron would report a failed sweep as
`succeeded`.

**The 2FA carve-out is a security-posture decision, not an implementation
detail.** `branch_staff` and `call_center` authenticate with email and password
and are deliberately NOT behind the TOTP gate: a cashier on shared shop-floor
hardware has no authenticator app. `admin` and `accountant` keep AAL2 exactly as
`20260810142000_staff_mfa_aal2.sql` left it, and the new predicates
(`is_branch_operator`, `is_call_center`) do not call `jwt_has_aal2()`. If that
trade is not acceptable, it is one line per predicate to change — but it should
be changed deliberately rather than discovered. **Action 4 is the last point at
which refusing it costs nothing:** once accounts exist, changing the rule locks
real people out mid-shift.

**The admin gate was checking role without assurance level — fixed and deployed
2026-08-23 (action 6).** Deploying `staff-accounts` turned a latent defect into a
reachable one, so it was audited on the way in. Four Edge Functions authorized callers with
`profile.role !== 'admin'` alone — `staff-accounts`, `email-test-config`,
`whatsapp-test-config` and `payment-test-config`. This was **not** universal:
`lazywait-catalog` (`index.ts:36-39`) has asked `is_admin()` since 20260807 and is
the precedent the fix follows. Everywhere in SQL, admin authority is
`is_admin()` = role `admin` **and** `jwt_has_aal2()`
(`20260810142000_staff_mfa_aal2.sql`). So an administrator signed in with email and
password but **without** completing TOTP passed a function's own gate while being
refused by every RLS policy and admin RPC — and anything the function then did with
the service-role client bypasses RLS, so it ran at AAL1. For `staff-accounts` that
means creating accounts, resetting passwords and deleting users.

The fix asks Postgres rather than decoding the JWT in TypeScript: the caller-scoped
client calls `public.is_admin()`, which is already granted to `authenticated`
(`20260810143000:92`, pinned by `anon_role_helper_exposure_test.sql:25-28`) and
already evaluates AAL2 through exactly the SQL the rest of the schema uses.
PostgREST populates `request.jwt.claims` only after verifying the signature, so a
forged token cannot reach the comparison. The decision itself is a pure function,
`supabase/functions/_shared/adminAuth.ts`, shared by `staff-accounts`,
`email-test-config` and `whatsapp-test-config`, and unit-tested — including the case
that would have caught the original bug.

Three consequences the owner should hold:

- **Fixed in Production — DONE 2026-08-23.** Owner-approved redeploy of all four
  functions, verified against the live API:

  | function | before | after | deployed (UTC) | `verify_jwt` |
  | --- | --- | --- | --- | --- |
  | `staff-accounts` | v1 | **v2** | 11:49:01 | `true` (unchanged) |
  | `email-test-config` | v1 | **v2** | 11:50:14 | `true` (unchanged) |
  | `whatsapp-test-config` | v2 | **v3** | 11:53:01 | `true` (unchanged) |
  | `push-dispatch` | v3 | **v4** | 11:57:36 | **`false` (deliberately unchanged)** |

  `push-dispatch` keeps `verify_jwt = false` because `order-intake` and
  `lazywait-webhook` call `order_status`/`pos_sync` with the service key and no
  user JWT; `isServiceRoleCall` still short-circuits ahead of the admin gate for
  exactly those two actions. Enabling `verify_jwt` there would have been a
  behaviour change nobody approved.

  **Verified before overwriting live code**, because a deployed function is not
  guaranteed to match the repository: the deployed `push-dispatch` v3 was a
  comment-stripped variant of the repository file, so every distinctive construct
  in it (the send-attempt bound, the processing lease, all four `pos_sync` claim
  RPCs, `DeviceNotRegistered` handling, the audience selector) was checked to
  exist in the repository version first, and the broadcast audience selector
  `.eq('promos_enabled', true)` was confirmed byte-identical before and after.
  Nothing that was live was lost.

  **Verified after**, from the deployed artifact rather than the API's success
  reply: the nested file layout resolved (`_shared/adminAuth.ts` and
  `staff-accounts/guards.ts` both present under the new versions) and the shared
  predicate round-tripped intact.
- **`payment-test-config` — fixed in source 2026-08-24 under an owner-approved
  §6 exception, and DELIBERATELY LEFT UNDEPLOYED.** The gate now calls
  `is_admin()` like the others, but Production still runs the role-only version,
  by decision rather than by omission.

  The deploy was approved, attempted, and stopped during the pre-deploy check.
  **Supabase bundles a function's dependencies at deploy time**, so what is live
  for a function is the repository *as of that function's last deploy* —
  2026-07-10 here. Two shared payment helpers have gained real logic since:
  `_shared/tapVerify.ts` acquired the session-first branch that calls
  `finalize_checkout_session` (which *creates the paid order*), and
  `_shared/lazywait.ts` went from 6 exports to 30+, including the whole POS
  confirmation lifecycle. Redeploying would have pushed both into Production as a
  side effect of a four-line auth change — squarely inside the freeze.

  The owner chose to leave it undeployed on 2026-08-24. Reopening needs the
  freeze lifted, or an explicit decision to ship the current payment helpers with
  it, which is a payment-behaviour decision and not an authorization one. Detail
  in [`PAYMENT_POSTPONEMENT.md`](PAYMENT_POSTPONEMENT.md) §2.

  **Changed 2026-11-11:** the freeze is lifted for repository work, and the
  Moyasar-only `payment-test-config` keeps the same `is_admin()` gate. It now
  deploys only as part of the seven-function payment set, after both payment
  migrations (§47.4). That deploy is what makes the AAL2 gate live.

  **The same risk applies to the four redeployed on 2026-08-23, and the answer is
  partly verified and partly not.** `push-dispatch` and `email-test-config` had
  their pre-redeploy bundles **inspected** before being overwritten — helpers
  structurally identical to the repository, verified. `whatsapp-test-config` and
  `staff-accounts` did **not**, and a deployed bundle cannot be recovered once
  overwritten, so those two rest on inference: a same-day sibling
  (`whatsapp-send-otp`, still on its 2026-07-09 bundle, read back and identical)
  for the first, and a few-hours window on the same repository state for the
  second. Strong, but not inspection. Detail and the correction of an earlier
  overstatement are in [`PAYMENT_POSTPONEMENT.md`](PAYMENT_POSTPONEMENT.md) §2.
- **`push-dispatch` was a fifth instance, and the most exposed one. Fixed and
  deployed 2026-08-23 (v4); the live AAL1 broadcast path is closed.** The first sweep
  missed it because it spelled the check
  `profile?.role === 'admin' ? user.id : null` (`index.ts:198-204`) rather than
  `role !== 'admin'`, and the sweep was lexical. It gates `order_status`, `test`,
  `broadcast` and `pos_sync`, and `supabase/config.toml:43-44` sets
  `verify_jwt = false`, so that role check was the **only** gate on the path.
  Unlike the four above it is **already live** (§7), and `broadcast` sends
  immediately to every device with `is_active` and `promos_enabled` — since the
  2026-08-20 opt-out decision, close to the whole active base — with no recall.
  So an admin on an AAL1 session could send an unrecallable push to every
  customer. It now calls the same `is_admin()` predicate through the caller's
  own client. Two of the four actions still accept a service-role call without a
  JWT, unchanged: `order-intake` and `lazywait-webhook` depend on that path.
  **`order_status` and `pos_sync` were less exposed than `broadcast`, though not
  safe** — both re-read the order's real status before sending, and
  `admin_set_order_status` already required `is_admin()`, so an AAL1 caller could
  not invent a transition, only re-announce a real one.
- **`docs/SECURITY_REVIEW.md` was wrong about `push-dispatch`** (`:107`, `:181`,
  `:206`, `:295`): it still called it an inert `501` stub needing a caller auth
  gate before it is enabled. It was enabled on 2026-08-17 (§7). It is a dated
  audit, so a correction note now sits at the top of it rather than its findings
  being rewritten in place. The rate-limiting recommendation there is still open.
- **One of the two admin accounts has no TOTP factor at all** (verified read-only
  on 2026-08-23, re-checked immediately before the redeploy: 2 admins, 1 with a
  verified factor, the other with **zero** factors of any status; no accountant
  accounts exist). Since the redeploy that account receives a 403 `mfa_required`
  from these four functions until it enrols one.

  **This is not a lockout, and an earlier draft of this section overstated it.**
  `StaffMfaGate` (`src/components/StaffMfaGate.tsx:35-54`) handles the
  no-verified-factor case as `needs_enrollment` and walks the account through QR
  enrolment at sign-in — there is no chicken-and-egg. And that account was already
  refused by every RLS policy and admin RPC, which have required AAL2 since
  `20260810142000`; what the redeploy closed was the Edge Function **side-door**
  that let it act at AAL1 through the service-role client. So the account lost a
  capability it was never supposed to have, and can restore the legitimate one
  itself at any sign-in. Worth enrolling regardless.

**Nothing here touched the payment freeze (§6) or push (§7).** No payment,
refund or checkout-session function was modified — `compute_order_snapshot` and
`begin_checkout_session` are untouched, which is why modifier availability is
enforced for cash orders and not yet for online checkout sessions. The
`integration_settings` push row was not read or written by any of the thirteen
migrations; it remains as CLAUDE.md §7 describes it — **enabled**, provider
`expo` — and this feature neither depends on that nor changes it.

Source references: [`ARCHITECTURE.md`](ARCHITECTURE.md) §3–§4,
[`STAFF_MANUAL.md`](STAFF_MANUAL.md) §4–§5,
[`OPERATIONS_HEALTH_CENTER.md`](OPERATIONS_HEALTH_CENTER.md),
[`MIGRATIONS.md`](MIGRATIONS.md) §28–§29.

---

## 17. Lazywait add-on mapping — heat level has no POS counterpart

**Status:** OWNER DECISION, narrowed. **The `lazywait-sync` deploy remains held —
that is unchanged** — but the deploy is no longer *blocked* by this gap.

PR #246 (`536a6cb`) brought the Create Order payload up to the vendor contract of
2026-08-24. Part of that change: an order line whose modifier carried no
`modifiers.lazywait_addon_id` blocked the whole order with
`missing_addon_mapping`, on the reasoning that a silent drop would hide the
add-on from the kitchen *and* undercharge the ticket, because the add-on money is
subtracted out of the item price.

A read-only Production check the same day found that precondition **entirely
unmet**: 0 of 3 modifiers mapped, all three active. Every active product, price
and category *is* mapped — *non-null*, which is not the same as still resolving
in the vendor catalog (`docs/LAZYWAIT.md`, "Those gates test presence"). Add-ons
are the only gap in our own rows. In the preceding 90 days,
7 of 38 pickup orders (18.4%) carried a modifier and 5 synced fine under the
older worker, so deploying as-is would have blocked roughly one pickup order in
five, permanently, with no mapping available to fix it.

**The block has since been replaced** (repository code; nothing deployed): an
unmapped modifier is folded into `order_items[].details` and its money is left
inside `price`, which is byte-for-byte what the still-live July worker sends.
Both objections above are answered rather than waived — the choice is on the
ticket in text, and the line is charged exactly what the customer paid, so
**option 2 below no longer drops the 2 SAR** it was priced at. Full numbers,
method and the two catalog searches: `docs/LAZYWAIT.md`, "Unmapped modifiers".

**Why this is a decision and not a task.** The three modifiers are Mild, Hot and
Volcano (+2), one "Heat Level" group on two active products. Lazywait's catalog
held 27 add-ons — toppings and drinks — at the 2026-07-23 snapshot this section
was written from, and **none of them was a heat level**; the 2026-08-24 re-pull
shows 10 add-ons, still with no heat level (see the two facts below). There is
nothing to map them *to*.

Options, with the money consequence stated:

1. **Create the three heat-level add-ons in Lazywait, then map them.** Complete
   and correct in every case. Requires a vendor catalog write, which is an owner
   action.
2. **Treat heat level as an instruction rather than a purchase**, carrying it in
   `order_items[].details` — a field the same PR enabled. This is what the code
   now does. The 2 SAR objection recorded here on 2026-08-24 assumed the add-on
   money would still be subtracted out of `price`; it is not, so Volcano's 2.00
   stays on the line and no money moves. What this option does *not* give is a
   separately priced add-on line the POS can report on — heat level arrives as
   text.
3. **Hold the deploy** until 1 or 2 is settled. Costs nothing: the merged code is
   inert in Production until `lazywait-sync` is redeployed, and the running
   function continues to sync pickup orders exactly as before.

Option 3 remains the current state, chosen by the owner on 2026-08-24 and not
revisited here. Option 2 is now implemented in the repository, which removes the
"deploying breaks one order in five" hazard; option 1 is still the only one that
puts heat level on the ticket as a structured, separately priced add-on.

**Two facts before acting on option 1.** Any add-ons would be created on the
**dev host**, which the owner confirmed on 2026-08-24 is the live POS for this
branch (`docs/LAZYWAIT.md`, "Which host is live"). And the catalog was re-pulled
three times on 2026-08-24 — all clean, zero errors — showing it far smaller than
the 2026-07-23 snapshot this section was written from (items 64 → 4, categories
7 → 1, addons 27 → 10). **Option 1 should not be acted on until that is
explained**: creating add-ons into a catalog that has just lost most of its menu
would be building on sand, and 53 of 57 active products currently map to item
ids the catalog no longer contains.

The blocking behaviour was not wasted — it surfaced a real catalog gap before it
could become a wrong ticket. It was the wrong *response* to the gap, because no
mapping exists to recover with. Deploying `lazywait-sync`, writing mapping rows
and creating add-ons in the vendor catalog are each separate §5 actions.

## 18. `a5d5cb7`'s commit message describes work it does not contain — one decision open

**Status:** OWNER DECISION — recommendation below. The ledger contradiction this
section originally led with is **resolved**; only the commit-message question
remains.

On 2026-08-24 two agent sessions held branch
`claude/correct-migration-actor-attribution-20260824` at the same time. One
narrowed it after the owner asked for a split; the other worked from a stale
reading of the pre-split scope, which reached the squash message on `a5d5cb7` and
then the comment that closed the follow-up pull request as a duplicate of work it
did not contain. The mechanism and the rule that came out of it are in
[`CLAUDE.md` §15](../CLAUDE.md) — this register carries only what still needs a
decision.

**Resolved 2026-08-24 — the ledger no longer contradicts itself.**
[#243](https://github.com/mohammedali-770/SMA/pull/243) merged at 12:14:14 UTC as
`8ba24f2`. Verified by reading the default branch afterwards: §5 ledger rows
57–58, §27's `Applied` cell, §31's `By` column for migrations 2 and 3, §31's "Who
applied them" paragraph and §31's mechanism paragraph now **all** name a Claude
Code session (`session_01VXmTcJDSWXVD9qm7irPbpV`). The five-way disagreement this
section previously tabulated is closed, and a reader following the
cross-reference from row 57 now lands on a section that agrees with it. Evidence:
`git show 8ba24f2 --stat` (one file, 49 insertions, 25 deletions) and
`grep -n "repository owner" docs/MIGRATIONS.md` on the default branch, which no
longer returns those five locations.

**The open decision: what to do about `a5d5cb7`'s commit message.
Recommendation: leave it.** The squash message on `a5d5cb7`
describes §27/§31 changes that commit does not contain. Correcting it means
rewriting history on a protected branch, which [`CLAUDE.md` §1](../CLAUDE.md)
forbids outright and which is a far worse precedent than an inaccurate commit
message. The message is wrong, it is recorded as wrong in `CLAUDE.md` §15, and
#243's merge message states what actually landed. That is the cheapest honest
resolution. Raised here rather than fixed quietly because a future reader
diffing `a5d5cb7` against its own description will find the mismatch and should
find the explanation with it.

**No server-side control would have caught this, and none is proposed.** It was
not a gap in the rulesets listed in §5 of this file: required checks all passed,
the branch was not behind, review-thread and linear-history rules were satisfied.
Both pull requests were individually correct. The failure was an agent verifying
a claim against a stale description instead of against the merged diff, and the
mitigation is the rule in `CLAUDE.md` §15, not another gate. Adding a check that
cannot detect the failure it is named for would be worse than adding nothing.

If concurrent sessions on one branch become common, the cheap structural fix is
one branch per session rather than a new CI control — but that is a working
practice, not a repository setting, and it is not proposed as an action here.

## 19. After the 2026-08-25 variant application — two open actions

**Status:** OWNER DECISION ×2. Neither blocks ordering, and neither is urgent.
**Both Edge Function redeploys are done** — `lazywait-catalog` (v3) and
`lazywait-sync` (**v4** as of 2026-08-26), each on explicit owner approval; see
the closeouts below the table. What remains is bookkeeping and branch hygiene.

On 2026-08-25 the two variant migrations were applied and the Lazywait catalog
was imported, both on explicit owner approval. The menu is live for the first
time: **55 of 61 products active, 144 of 147 tiers**, prices 1.00–74.00 SAR.
Full record: [`MIGRATIONS.md`](MIGRATIONS.md) §32 and ledger rows 59–60.

| # | Action | Why it is still open |
| --- | --- | --- |
| 1 | Version-align rows 59 and 60 | Live history carries the apply-time stamps `20260825061046` / `20260825061502`, not the repository filenames. §9-D makes realignment a separate live history write with its own approval. Leaving it is legitimate; "repairing" it unasked is not. |
| 2 | Retire or reconcile the **16** importer-created branch rows | The live branch is mapped (see the closeout below), so this no longer blocks ordering. Sixteen inactive rows were created by the 2026-08-25 import and all sixteen remain: **15 still hold a real `lazywait_branch_id`**, and **one is the Nasserah twin whose mapping was cleared** when the live branch was re-pointed — that row was not deleted, so it must be counted here or it is tracked nowhere. None can take orders. Left in place deliberately: `branches` is FK-referenced by eleven tables, so deleting rows is destructive and needs its own decision. The twin is the safest candidate if one is ever removed — zero orders, no mapping, and an exact duplicate of the live branch — but it is still a deletion. |

**Closed 2026-08-25 — `lazywait-catalog` redeployed (version 3).** This was the
item with a timer on it: `lazywait_catalog_items.prices` had been rebuilt from
`raw` by SQL rather than written by the parser, so a pull against the old
deployed function would have rewritten all 147 rows with `price_excl_vat: null`,
the importer would have read 0, and every product would have gone inactive at
price 0 — the exact failure that kept the menu empty for months. The deployed
parser now writes that field itself, so a pull converges instead of collapsing.

Verified rather than assumed: the deployed bundle was read back and compared by
SHA-256 against the default branch **as it stood on 2026-08-25**, and all six
files were byte-identical then — `lazywait-catalog/index.ts` plus
`_shared/cors.ts`, `_shared/supabaseClient.ts`, `_shared/secrets.ts`,
`_shared/lazywait.ts` and `_shared/lazywaitCatalog.ts`.

**That is no longer true of `_shared/lazywait.ts`, deliberately.** PR #264 added
`posLineName`, two columns to `ORDER_ITEM_SELECT` and the `mapOrderItemRows`
composition on 2026-08-26, and that module was redeployed with `lazywait-sync`
v4 the same day. `lazywait-catalog` was **not** redeployed, so its v3 bundle
still carries the pre-#264 copy: 40 533 bytes against 42 221 in the repository
at that moment, differing in exactly those three hunks and nothing else (read
back and diffed 2026-08-26).

**Updated 2026-08-26 (afternoon) — the gap widened by one more change, and the
reasoning is unchanged.** `lazywait-sync` was redeployed to **v5** carrying the
comped-ticket label (PR #269), so `_shared/lazywait.ts` in the repository and in
`lazywait-sync` is now sha256 `ec5f8238…` / 43 797 bytes, while
`lazywait-catalog` v3 still holds `8df5ea74…` / 42 221 bytes. The catalog
function imports only `lazywaitFetch`, `resolveLazywaitBaseUrl` and
`LazywaitConfig`; the comp label lives in `buildCreateOrderPayload`, which it
never calls, so this second hunk is as inert as the first.

The skew is inert and the owner chose on 2026-08-26 to leave it. `lazywait-catalog/index.ts`
imports only `lazywaitFetch`, `resolveLazywaitBaseUrl` and `LazywaitConfig` —
none of which #264 touched — so no code path this function executes differs. The
alternative was a six-file, ~68 KB redeploy carrying a 42 KB regex-dense module
through a tool parameter, for zero behavioural gain; folding it into the next
`lazywait-catalog` deploy that has a real reason costs nothing and gets tested
against that reason.

**So: do not read the byte-identity claim above as current, and do not "fix" the
skew on its own.** The next redeploy of this function clears it automatically.
`verify_jwt` stays `true` and the admin `is_admin()` gate is unchanged. Live menu
re-checked after the deploy and unmoved: 55 of 61 products active, 144 of 147
tiers, five categories, all 147 cached price entries carrying a net price.

**Closed 2026-08-25 — the live branch is mapped again, and this was breaking
ordering.** Found while reviewing what to do next, not by a report.

`branches.lazywait_branch_id` was **NULL on the only active branch** (Nasserah).
`buildCreateOrderPayload` returns `missing_branch_mapping` when the branch id is
absent, so the next pickup order placed would have been blocked and would never
have reached the kitchen. Three orders were blocked on exactly that reason on
23–24 July, right after that branch row was created; 31 orders synced later, so
a mapping existed at some point and was not present on 2026-08-25.

**The importer could never have fixed it.** `import_lazywait_catalog` matches
branches on `lazywait_branch_id` and *inserts* when it finds no match — it never
writes a mapping onto an existing row. That is why the 2026-08-25 import created
a **second, inactive "Nasserah"** carrying the real Lazywait id rather than
mapping the live one, and why the table went 25 → 41.

Fixed on explicit owner confirmation that Nasserah is the operating branch: the
active row now carries `0dDRHGE1hSBZjDvgg1bN` and the duplicate's mapping was
cleared so exactly one row holds that id. Verified before and after — dry run in
a rolled-back transaction first, then applied in one transaction: one active
branch with a mapping, one holder of the id, **40 rows before and after, none
created or deleted**.

The duplicate row itself was **not** deleted, only unmapped — see item 2 above,
which counts it. Clearing rather than deleting was deliberate (`branches` is
FK-referenced by eleven tables), but it does mean the import's 16 rows are all
still present: 15 mapped, 1 unmapped.

Two things worth carrying forward:

- **There is no unique constraint on `branches.lazywait_branch_id`** — only a
  partial btree index. Two rows *can* hold the same id, and the importer's
  `update … where lazywait_branch_id = …` would then write to both. Clearing the
  duplicate was therefore deliberate, not tidiness.
- The write was made as a **scoped `update`, not through `set_lazywait_mapping`**.
  That RPC requires `is_admin()` (role **and** AAL2) and for a branch it does
  nothing beyond a non-empty check and the same single-column update. Using it
  would have meant synthesising an admin session again, as the 2026-08-25 import
  did; a direct, guarded update avoids asserting an authentication that did not
  happen. Routine mapping edits should still go through the admin console.

**Closed 2026-08-25 — `lazywait-sync` redeployed (version 3).** A tiered order
now reaches the kitchen under the chosen tier's `price_id` instead of the
cheapest one's.

**The deploy was materially larger than "carry the tier's price_id", and that is
worth stating plainly.** The deployed worker was still the July build: its
bundled `_shared/lazywait.ts` was a ~150-line stripped variant of the repository's
870-line module. Redeploying therefore also shipped add-on/modifier support, the
per-item kitchen note, `menu_category_id`, the order-level `order_details`, the
CRM `customer_id`, the `customer_cell`/`country_code` phone split, and the
fail-closed base-URL guard. All of it was already merged and reviewed; none of it
was new code written for this deploy.

**No ticket's money moved.** Only a modifier carrying a real
`lazywait_addon_id` becomes an `addons[]` entry and is subtracted back out of
`price`. All three live modifiers are unmapped, so nothing is subtracted, the new
`addon_price_exceeds_item_price` block cannot trigger, and every line is charged
exactly what the July build charged. The visible change is that a customer's
heat-level choice now reaches the kitchen as `details` text instead of being
dropped. The fail-closed base-URL guard is likewise inert: `base_url` is set to
`https://apiv2-dev.lazywait.com/v1` and parses.

Verified before and after. Before: every column, grant and embed FK in
`ORDER_ITEM_SELECT` confirmed present, and each FK path **unambiguous** — two FKs
between the same pair of tables would make PostgREST reject the whole select and
block every order under a misleading `no_items`, exactly as a missing one would.
Zero orders were in flight. After: the deployed bundle was read back and compared
by SHA-256 — all five files byte-identical to the default branch — `verify_jwt`
still `false`, and a live POST with no `x-sync-secret` returned
`401 {"error":"unauthorized"}`, proving the bundle boots and the module graph
resolves without claiming an order or changing any state.

**The import ran under a synthesised admin context**, and that is recorded rather
than buried. `import_lazywait_catalog()` requires `is_admin()` — role **and**
AAL2 — and the session held `postgres` credentials with no JWT, so
`request.jwt.claims` was set to a real admin holding a verified TOTP factor. The
entitlement was genuine; the session assertion was not. It bypassed the AAL2
requirement added 2026-08-23, on explicit owner instruction. Routine imports
should go through the admin console under a real TOTP session.

**Closed 2026-08-26 — `lazywait-sync` redeployed (version 4): the chosen tier
now prints on the ticket.** The v3 deploy above put the correct `price_id` on the
line; it did not put the tier in the line's *name*, and the POS renders the name
we send rather than resolving `price_id` into a label. Ticket **#2 / invoice 19**
therefore printed "Chicken Wings" for an order placed as صغير — a ticket that
cannot tell a 7.00 Small from a 13.00 Large. `mapOrderItemRows` now composes the
name from the `order_items.variant_name_*` snapshots, so a ticket keeps naming
the tier the customer actually bought even after the catalog changes. Repository
record: PR #264.

**No money field moved and no provider behaviour changed** — the change is to two
name strings and to `ORDER_ITEM_SELECT`, which gains `variant_name_en` and
`variant_name_ar`. Both columns were confirmed present with an explicit
`service_role` SELECT grant **before** the deploy, because an ungranted column
makes PostgREST reject the whole select and would block every order under a
misleading `no_items`. Zero orders were in flight; `verify_jwt` stays `false`;
`Edge Function typecheck (Deno)` was green on the deployed commit first.

**Read back, and it did not match — which is the point of reading it back.**
Four of the five bundled files were byte-identical to the branch. `_shared/lazywait.ts`
was 42 221 bytes deployed against 42 224 in the repository. The gap was one line:
Supabase's deploy pipeline normalises Unicode escapes in stored source, so the
six-character escape the repository used for the em dash separator came back as
the single character it denotes. Runtime behaviour is identical — such an escape
inside a template literal is resolved when the module is parsed — and all three
functional changes arrived intact. The repository was then changed to write the
character directly, so the file is byte-identical to what is running
(sha256 `8df5ea74…`). A file that can never match turns the post-deploy hash
check into an argument each time, which is how a real mismatch eventually gets
waved through.

**The 0.00 half of this is FIXED (2026-08-27).** That ticket showed Subtotal, VAT
and Total all **0.00** on a cash order for 7.00, because no money field was sent
at all. Money is now sent, and it prints: ticket **#9** for SM-2026-000065 shows
`Subtotal 84.00 / VAT 10.96 / Total 84.00`, matching the stored order exactly.
See §22 and [`LAZYWAIT.md`](LAZYWAIT.md).

**The `** Non-Taxable` line flag is a separate question and is NOT settled by
that.** It suggests the POS may treat our lines as free text rather than catalog
references, which is about item mapping rather than order totals. It still wants
an answer from Lazywait with a ticket in front of them, not a guess from us.

**Decided and implemented 2026-08-25 (was open from PR #256).** The owner chose
both: a multi-tier product **opens a picker** rather than being added from the
card, and a tiered card reads **"from X"**. The cart no longer assumes a tier for
anyone — `needsChoice` routes the product to the detail screen, whose tier picker
already existed and was simply unreachable from the menu.

Two refinements the data forced, neither of them a departure from that decision:

- **"from" appears only when the tiers span a real range.** More than half of the
  multi-tier products price every tier identically — Kinza is six flavours all at
  2.00, Kids Meal eight at 15.00 — and "from 2.00" there advertises a cheaper
  option that does not exist. Those still open the picker, because Cola versus
  Pepsi is a real choice for the kitchen; they just do not claim a range.
- **The picker now preselects the cheapest tier, not `variants[0]`.** It seeded
  from the first tier by Lazywait `sort_order`, and on the live menu **14 of 27**
  multi-tier products have a first-by-sort tier that is not the cheapest — Fillet
  leads with "Spicy Fillet" at 15.00. The card would advertise one price and the
  screen would open on another. Card, picker and cart now all read
  `cheapestVariant`.

The invariant that survived unchanged: **the price charged may never exceed the
price displayed.**

## 20. After the 2026-08-26 comped-customer application — two open actions

**Status:** OWNER DECISION ×1 — one of the two is now done. Neither blocked
anything, because nobody is comped yet.

On 2026-08-26 the three comped-customer migrations were applied on explicit
owner approval, in filename order, one MCP `apply_migration` call per file with
read-only verification between each. Live history moved **109 → 112**; all four
redefined function bodies were hashed afterwards and are byte-identical to the
merged files. Full record: [`MIGRATIONS.md`](MIGRATIONS.md) §35 and ledger rows
65–67; behaviour in [`DISCOUNTS_CAMPAIGNS.md`](DISCOUNTS_CAMPAIGNS.md) Part 2.

**Applied, and dormant.** `comp_members` is empty, so no customer is comped and
every order still prices exactly as before. All 44 pre-existing orders were
verified unchanged. The feature goes live for a person the moment an
administrator adds them in **Finance → Comped Customers** — and from then on
every order that person places is free in full, delivery fee included, with
**no cap**. That was the owner's decision on 2026-08-26 and is recorded rather
than softened: one wrongly-added member is unlimited free food, bounded by
nothing downstream. A per-period cap would live on `comp_members` and needs no
reshaping to add.

| # | Action | Why it is still open |
| --- | --- | --- |
| 1 | Ship the app build | The checkout "Complimentary" line, the receipt line and the submit-time membership re-check ship with it. **Safe to ship now** — the two new `orders` columns exist as of row 65. Shipping it *before* that would have broken order history entirely, because `CUSTOMER_ORDER_SELECT` names them and PostgREST rejects the whole select when one column is missing. |
| 2 | ~~Redeploy `lazywait-sync`~~ | **DONE 2026-08-26 12:46 UTC — v4 → v5**, on explicit owner approval. `verify_jwt` unchanged at `false`. All five bundle files read back and hashed **byte-identical** to the merged repository, including the 43 797-byte `_shared/lazywait.ts`. Pre-flight was clean (0 pending, 0 syncing, 0 failed, no order in 30 minutes) so nothing was in flight. Boot proved live: an unsigned POST returned `401 {"error":"unauthorized"}` — the module loaded, read its config, found the trigger secret configured (a missing one answers 503) and refused at the constant-time compare without claiming an order. The cron then ran the new version at **12:47:00 and succeeded**. A comped ticket now carries the label. |

Version alignment for rows 65–67 is deliberately **not** listed as an action.
Live carries the apply-time stamps `20260826114717` / `20260826115025` /
`20260826115122` rather than the repository filenames, which is class B and
expected; §9-D makes realignment a separate live-history write with its own
approval, and leaving it alone is the correct default.

## 21. Comped customers by phone — APPLIED 2026-08-27 (closed)

**Why this exists.** The owner asked for a comp that starts from a phone number:
*"when the number of someone in comped customers enters the app, they should see
the prices as 0."* The panel's first live use had already shown why — a search
for `+966555000667` returned "No matching customers", correctly, because nobody
with that number had signed up, and there was no way to comp them anyway.

**Done.** All three applied on 2026-08-27 on the owner's explicit approval, one
`apply_migration` call per file, each named explicitly and verified before the
next was sent. Live history **112 → 115**:

1. `20260827090000_admin_search_phone_normalization.sql` → `20260827063613`
2. `20260827100000_comp_members_by_phone.sql` → `20260827063746`
3. `20260827110000_comp_erasure.sql` → `20260827064044`

Only 2 → 3 was a hard dependency (`…110000` reads a column `…100000` adds).

**The merge was checked first, and had not happened.** The approval to apply
arrived while PR #272 was still open; nothing was applied until it actually
landed (`47f18f2`) and each file was hashed against its merged copy. Record:
`docs/MIGRATIONS.md` §36, ledger rows 68-70.

**What the owner is approving.** A membership can be attached to a phone number
before that person has an account; it binds itself when Auth confirms the OTP.
The pricing functions are **not** redefined — `place_order` and
`compute_order_snapshot` are untouched, and the 18 cases that verified them on
2026-08-26 still pass. Account deletion now reaches the comp tables.

**What it does NOT include.** No Edge Function deploy. No payment or provider
change (§6 untouched). No Vercel or EAS action. No change to who is currently
comped — `comp_members` holds one deactivated row.

**Moyasar verified still absent afterwards:** zero `%moyasar%` functions, zero
matching history rows, `provider_name` still `tap` and still disabled. The §6
freeze is intact.

**Still open from §20:** the **app build**, which carries the checkout
"Complimentary" line, the receipt line and the submit-time membership re-check.
It is now the only remaining action for this feature — everything server-side is
live. Until it ships, a comped customer sees full price at checkout and is
charged 0.00: correct money, confusing screen.

## 22. Delivery orders reach the POS — APPLIED + DEPLOYED 2026-08-27 (one action open)

Both halves are **done**, on explicit owner approval, and both are verified:

| Action | Result |
| --- | --- |
| Apply `20260827120000_lazywait_delivery_sync` | Live version `20260827082634`, history **115 → 116** |
| Deploy `lazywait-sync` | **Version 6**, `verify_jwt: false` unchanged, ACTIVE |

The deploy went through MCP because the CI path is unusable: `deploy-functions.yml`
exists but `SUPABASE_ACCESS_TOKEN` has never existed — all four runs died at
"Access token not provided" — and §15 of this file recommends against creating it.

All five bundle files were read back from Supabase after deploying and hashed
against the merged default branch:

| File | Bytes | sha256 (16) |
| --- | --- | --- |
| `lazywait-sync/index.ts` | 26 674 | `28db3b1871ba2d55` |
| `_shared/lazywait.ts` | 48 228 | `65ba235077d51298` |
| `_shared/supabaseClient.ts` | 1 380 | `9c8d52e18d8ebf24` |
| `_shared/secrets.ts` | 1 373 | `c6a15f7f566b8afe` |
| `_shared/cors.ts` | 466 | `5262b16eb01ece21` |

All five byte-identical. This read-back is not ceremony: it caught a 3-byte
difference on the v4 deploy of this same function.

**Proven live.** SM-2026-000059 reached the POS as ticket **#3** at 10:15 UTC,
42 seconds after being placed, first attempt, no retries.

### What is still open

1. ~~**Q8 — look at a printed delivery ticket.**~~ **DONE 2026-08-27** — ticket
   #3 / invoice 24 inspected. **The POS does NOT render `delivery_address`.**
   `Order Type: Delivery` prints, but there is no address row anywhere on the
   ticket; the destination appears only in the `order_details` note. The
   duplication is therefore **load-bearing and permanent** — without it this
   ticket would have reached the kitchen with no destination. Detail:
   `docs/LAZYWAIT.md`.

   That ticket surfaced three further items, below.
2. ~~**Apply `20260827130000_watchdog_delivery_coverage`** (§5, not frozen).~~
   **DONE 2026-08-27 10:40:53 UTC**, live version `20260827104053`, history
   116 → 117. R1 and R7 now cover paid delivery orders; verified afterwards with
   0 pickup filters left in the function, all nine in-body comment probes
   present, the money-path hashes unchanged, and cron run 26076 succeeding over
   11 rules. Detail: `docs/MIGRATIONS.md` §38.

### Opened by the first printed ticket (2026-08-27)

**A.** ~~Redeploy `lazywait-sync` to pick up the address dedupe.~~ **DONE
2026-08-27 — `lazywait-sync` v7**, `verify_jwt: false` unchanged, all five
bundle files read back from Supabase and byte-identical to `c4b46c1`
(`index.ts` `f2519f446a63ecd8`, `_shared/lazywait.ts` `4cc51dfe59c8b538`, the
three other shared files unchanged from v6).

Why it was needed: the dedupe merged in `c4b46c1` at 10:40 UTC, but the running
worker was **v6, deployed 08:40** — before the fix existed. SM-2026-000059's
saved address has identical `label` and `description`, which is why its ticket
printed the address twice inside one note line. The next delivery order will
print it once.

**B. Report the Arabic reversal to Lazywait — vendor bug, not ours.** The
printed ticket reverses Arabic word order, including in **the shop's own header
and tagline**, which this repository never sends (`الناصرة ،ثابت بن حسان شارع`
for `شارع حسان بن ثابت، الناصرة`; `الموحد رقمنا على اتصل` for
`اتصل على رقمنا الموحد`). Their receipt renderer is not applying the Unicode
bidirectional algorithm. The header is a clean repro that does not involve our
integration. **Do not work around it by pre-reversing our text** — it would
break when they fix it and be wrong in every other surface that reads the field.

**C.** ~~Decide what money to send to the POS (Q9).~~ **DECIDED AND BUILT
2026-08-27**, on the owner's approval. Ticket #3 printed
`Subtotal 0.00 / VAT 0.00 / Total 0.00` for a **cash** order really worth
**28.00**, with the lines showing 23.00 and 5.00 — a driver had no idea what to
collect.

**The ticket answered its own question.** The blocker was not knowing whether the
POS computes or displays; sending nothing and getting `0.00` while the lines were
visible proves it **displays**. So subtotal / discount / tax / total /
order_delivery_fee are now copied **verbatim** from the order snapshot — no
recomputation, no new rounding, the same numbers as the customer's receipt.
`tax_percentage` and `is_paid` stay unsent, for reasons recorded in
`docs/LAZYWAIT.md`.

**Deployed** 2026-08-27 in `lazywait-sync` **v8** — read back and hash-verified
byte-identical to the merged branch — and **confirmed on printed paper the same
day**: ticket **#9** for SM-2026-000065 shows `Subtotal 84.00 / VAT 10.96 /
Total 84.00` against a stored total of 84.00 and `vat_amount` 10.96. Q9 is
closed. See the deploy table at the end of this section.

No schema change was required: `claim_lazywait_sync_batch` returns `SETOF orders`,
so the worker already had every money column.

### One consequence worth stating

With the watchdog migration applied, **`20260824100000_moyasar_payment_provider`
is now the only unapplied migration in the repository.** An instruction like
"apply the outstanding migrations" therefore has exactly one possible target, and
that target is the frozen one (§6). Name the file explicitly, always.

**D.** ~~Deploy `order-intake`.~~ **DONE 2026-08-27 — version 5**,
`verify_jwt: true` unchanged (matching `config.toml`). The immediate POS sync
kick was gated to pickup, so delivery orders waited for the once-a-minute cron
(measured 17.8-44.6 s, all first-attempt successes). The branch number should now
reach the confirmation screen in a second or two.

**E.** ~~Decide the `received` push copy — still not honest.~~ **DECIDED AND
BUILT 2026-08-27.** The owner chose accuracy over immediacy: *"I prefer the
accurate and little slow option."*

`order-intake` no longer pushes at all. The POS outcome owns the customer's first
message — `pos_confirmed` on success, `pos_retrying` / `pos_confirmation_required`
/ `pos_failed` otherwise — and `pos_confirmed` now fires on **every** success
rather than only after a prior failure.

**Building it uncovered a live gap worth its own line.** Those four messages were
enqueued into `notification_log` as `kind='pos_sync'`, `push-dispatch` had a
complete action to send them, and **nothing connected the two** — no cron, no
trigger, no caller. Zero such rows had ever existed, because no sync had ever
failed and `pos_confirmed` was gated behind a failure. The first real POS failure
would have been met with silence. `lazywait-sync` now drains that queue every
run, and on the happy path within the same invocation `order-intake` triggers, so
the customer hears in a second or two.

**Customer copy corrected in the same change.** `pos_retrying` and
`pos_confirmation_required` used to end "Please do not place another order." /
"فضلاً لا تنشئ طلبًا جديدًا." Intended as *do not duplicate this one*; read as
*do not order from us again*, which is the worst thing to say at the moment
something has gone wrong. Both now say "no need to place it again" alongside what
we are doing about it. **This adds `push-dispatch` to the deploy list.**

**Deployed** 2026-08-27 — `lazywait-sync` v8, `order-intake` v5, `push-dispatch`
v5, in that order. Versions and verification are in the deploy table at the end
of this section; they are not restated here, because restating a status in three
places is what let this document contradict itself in the first place.

The order was not incidental. `lazywait-sync` and `order-intake` are two halves
of one change and deploying either alone was wrong in a different way:
`order-intake` first would have removed the push with nothing yet replacing it,
leaving silence; `lazywait-sync` first sends `pos_confirmed` while the old
`received` still fires, giving two pushes. Noise is the recoverable failure, so
the worker went first and the gap was under a minute.

### The three deploys, 2026-08-27

All on explicit owner approval, in the order below — which was chosen, not
incidental.

| # | Function | Version | verify_jwt | Carries |
| --- | --- | --- | --- | --- |
| 1 | `lazywait-sync` | **8** | false | order totals + the `pos_sync` drain |
| 2 | `order-intake` | **5** | true | the latency fix, and no premature push |
| 3 | `push-dispatch` | **5** | false | the reworded failure messages |

**Why that order.** `lazywait-sync` and `order-intake` are two halves of one
behaviour and deploying either alone is wrong in a different way: `order-intake`
first removes the push with nothing yet replacing it — a window of **silence**;
`lazywait-sync` first sends `pos_confirmed` while the old `received` still fires
— a window of **two pushes**. Noise is the recoverable failure, so the worker
went first. The gap was under a minute.

`push-dispatch` is independent: it only carries wording, and the message that
fires on the happy path (`pos_confirmed`) was not among the strings changed.

**Verification.** `lazywait-sync` was read back from Supabase and hashed against
the merged branch — all five bundle files **byte-identical**
(`index.ts` `a9d277a2f8d0ed6e`, `_shared/lazywait.ts` `d1068f393a1a48e9`, the
three other shared files unchanged). `order-intake` and `push-dispatch` were read
back in full and reviewed, and their platform bundle hashes match between deploy
and read-back; they were not hashed against the repository the way
`lazywait-sync` was, because their read-backs returned inline rather than to a
file. Worth knowing which of the three carries the stronger proof.

`lazywait-sync` v8 has returned 200 on every cron tick since (11:50 onward), so
the new drain boots and runs clean.

### Proven end to end by SM-2026-000065 (ticket #9), 2026-08-27

Four things no deploy could establish were confirmed on one live delivery
order — two of them by the owner reading the printed ticket.

| Claim | Result |
| --- | --- |
| The ticket shows the right total | **Yes.** `Subtotal 84.00 / VAT 10.96 / Total 84.00`, against a stored total of 84.00 and `vat_amount` 10.96 (`84 × 15/115` to the halala). Line items sum to the subtotal, so the ticket is internally consistent. |
| The branch number arrives in a second or two | **8.1 s**, first attempt, zero retries. Placed 18:19:38, at the POS 18:19:46 — **before** the 18:20:00 cron tick, so this was the synchronous kick and not the backstop. |
| Exactly one push, and only once the POS has it | **Yes.** One `pos_sync/pos_confirmed`, `targeted 1 / sent 1 / failed 0`, **3.6 s after** the POS accepted the order. No `order_status/received` row exists. |
| The address prints once, not four times | **Yes.** This order's saved address still has `label` = `description`, so the dedupe was genuinely exercised, and the DELIVER TO line carries it once. |

**The push fix is visible as a sign change**, which is the clearest evidence in
the whole record:

Both columns are measured against `orders.synced_at` — the moment Lazywait
accepted the order. **Enqueued** is `notification_log.created_at`, **sent** is
`updated_at` after the dispatcher finished.

| Order | Push | Enqueued | Sent |
| --- | --- | --- | --- |
| SM-2026-000059 | `order_status/received` | **−39.5 s** | **−38.7 s** |
| SM-2026-000060 | `order_status/received` | **−29.8 s** | **−28.7 s** |
| SM-2026-000061 | `order_status/received` | **−16.2 s** | **−15.5 s** |
| SM-2026-000062 | `order_status/received` | **−42.8 s** | **−42.1 s** |
| SM-2026-000063 | `order_status/received` | **−20.7 s** | **−19.8 s** |
| SM-2026-000064 | `pos_sync/pos_confirmed` | **+0.2 s** | **+5.3 s** |
| SM-2026-000065 | `pos_sync/pos_confirmed` | **+0.2 s** | **+3.6 s** |

The negative numbers are the defect the owner reported: "we sent it to the
kitchen" reaching the customer up to 42.8 seconds *before* the kitchen had
anything. The positive ones are the fix, carrying honest copy.

**Read the enqueued column for the guarantee, not the sent one.** +0.2 s is not
a race won by a fifth of a second. `record_lazywait_sync` writes the
`notification_log` row inside the **same transaction** as the state change, and
for `pos_confirmed` only when the authoritative post-update row — captured via
`RETURNING` — is `synced` with a usable ref. The ordering therefore holds by
construction, and would still hold if Lazywait took five minutes. The sent
figure varies with dispatcher latency and guarantees nothing. Every one of the
seven rows was `targeted 1 / sent 1 / failed 0` on `attempt_count` 1.

**`sent` means Expo accepted the ticket, not that a phone displayed it.**
`push-dispatch` counts `sent` on an Expo ticket returned `ok`, and it performs
no receipt polling — its own comment records that as a follow-up. So the
database cannot distinguish "Expo accepted it" from "the customer saw it", and
nothing here should be read as proof a notification was displayed. What *is*
proved is the ordering and the copy.

**One more limit worth stating: every order placed on 2026-08-27 — all fifteen
of them — belongs to the same customer account, on one device.** (Re-counted
live on 2026-08-31; an earlier revision of this paragraph said "eleven of today's
orders", which was the count at the moment it was written and undated, so it went
stale the same afternoon.) The pipeline is proved end to end; fan-out across a
varied device base is not exercised by any of this.

### A decision recorded rather than taken

Four delivery orders (SM-2026-000032, -000049, -000057, -000058) are parked with
the now-retired `delivery_schema_unconfirmed` reason and are `not_retryable`.
SM-2026-000058 was placed in the 40-second window between the migration landing
and the deploy, so the old worker blocked it. **None was re-driven**: that is a
§5 live write and would create a real kitchen ticket for food nobody is waiting
for. Leaving them parked is the current decision, reversible at any time.

## 23. `latency-probe` — KEPT 2026-09-03 (closed, deliberate)

**Status:** CLOSED by owner decision. No action outstanding. The slug is still
deployed, and that is the decision rather than a deferral of one.

**What it is.** A throwaway diagnostic deployed 2026-08-30 to settle whether the
within-region spread in PostgREST call latency was per-isolate connection setup.
It answered its question — the per-call cost is **bimodal**, roughly 120 ms
against 305 ms measured from IAD, and is **not** per-isolate setup — and that
result, with its warning not to carry the constants onto the order path, lives in
`docs/ORDER_CONFIRMATION_FLOW.md`. Its source left the repository the same day.

**Why keeping it is safe.** Verified live and read-only on **2026-09-03**:

| check | evidence |
| --- | --- |
| live body | `get_edge_function`: v2, `ACTIVE`, `verify_jwt: true`; one `Deno.serve` returning HTTP 410 with a fixed JSON string — **no database call, no secret, no outbound request** |
| database | **58 public base tables** scanned with each whole row cast to text — **zero** rows mention `latency` |
| scheduled callers | 7 `cron.job` rows, none invoke it; no `pg_proc` body names it |
| invocations | **0** in `function_edge_logs` across three consecutive 24-hour windows, 2026-08-31 → 2026-09-03 |
| repository | no `supabase/functions/latency-probe/`, no `supabase/config.toml` stanza; across every ref and the whole object store the only mention is this section |

**Why the original argument for deleting no longer applies.** It rested on two
things and both are discharged. The **security** reason is gone: the original
probe drove nine database reads per request for anyone holding the anon key —
`verify_jwt = true` does not make a function private, because the anon JWT ships
inside the mobile app — and replacing the body with the 410 stub removed that
surface completely. The **legibility** reason was the real one, and writing this
section answered it: the orphans found on 2026-08-19 were dangerous because they
appeared *nowhere*, and a slug the repository explains is not that failure.

What is left is cosmetic. As of 2026-09-03 there are **23 deployed functions
against 22 in `supabase/functions/`**, and this slug is the whole difference.

### The one consequence, so nobody rediscovers it

`.github/workflows/function-drift.yml` diffs the deployed set of names against
`supabase/functions/`. It will list `latency-probe` under *"Deployed but NOT in
the repository"* and exit 1. **That is the check working, not a fault.**

It cannot fire unprompted: that workflow lost its schedule on 2026-09-02 and is
`workflow_dispatch` only, and it exits at its first step without
`SUPABASE_ACCESS_TOKEN` — which §15 recommends against creating. If it is ever
armed, expect exactly this one name, read this section, and then either delete the
slug or allowlist it there. What must not happen is that it is treated as an
unexplained orphan and investigated from scratch.

### If you want it gone after all

Supabase dashboard → project `wxfmmnihidsdyemasstf` → **Edge Functions** →
`latency-probe` → **Delete function**. Nothing depends on it.

No agent session can do it — re-verified 2026-09-03 in a fresh container rather
than carried over: the Supabase MCP server exposes only `deploy`/`get`/`list` for
Edge Functions with no delete, the `supabase` CLI is not installed, and no
Supabase credential exists in the environment or on disk. That is now context
rather than a blocker.

## 24. `orders` index cleanup — DONE 2026-09-02 (closed)

**Status:** COMPLETE. No action outstanding.

`20260902120000_orders_index_cleanup` was applied on **2026-09-02 12:37:37 UTC**
on explicit approval naming the target by version, in one MCP `apply_migration`
call. Live version `20260902123737`; history **122 → 123**.

Verified after the apply: `orders` index count **18 → 16** (exactly the two
intended, nothing else), the survivor `orders_lazywait_queue_idx` present and
valid, and — the check that actually matters — the live sync-queue predicate
still plans as `Index Scan using orders_lazywait_queue_idx`. `place_order` and
`compute_order_snapshot` hash identically before and after; Moyasar re-verified
absent; security advisors 0 ERROR. No function deploy was implied or performed.

Kept as one paragraph rather than deleted, because the entry it replaces was a
pending action and a reader arriving from `docs/MIGRATIONS.md` §42 or CLAUDE.md
§8 should find its outcome here rather than a gap. Full record: `MIGRATIONS.md`
§42 and ledger row 78.

---

## 25. `whatsapp-webhook` cannot accept a single Meta delivery report

**Status:** OWNER DECISION — configure it, or accept that delivery status is
never received.

Found on 2026-09-02 while verifying the `whatsapp-webhook` redeploy. An unsigned
`POST` to the function returns **503 `webhook not configured`**, not the 401 the
signature gate would give. The reason:

| provider row | `app_secret` | `webhook_verify_token` |
| --- | --- | --- |
| `whatsapp` (`meta_cloud`) | **absent** | present |

Key presence was read, never a value. The handler fails closed on a missing App
Secret — which is correct, and is why the condition is silent rather than
dangerous — so **every Meta delivery-status callback has been rejected with a 503
for as long as the row has been in this state.**

**This is pre-existing and was not caused by the redeploy.** The 503 branch is
byte-identical in the version that was running before.

**What it costs.** `whatsapp_message_logs` looks healthy at 30 rows, but every one
of those comes from the *send* paths (`whatsapp-send-otp`,
`auth-send-sms-whatsapp`) calling `record_whatsapp_message` directly. Nothing has
ever arrived from the webhook, so there is **no delivery, read or failure status
for any OTP ever sent** — you cannot currently tell whether a customer's login
code was delivered. The reliability fix deployed on 2026-09-02 (checking the RPC
result instead of ignoring it) is correct but unreachable until this is fixed: it
runs only after a valid signature.

### The action

Meta Business Manager → the WhatsApp app → **App Secret**, then set it in
Admin → Integrations → WhatsApp. That is a live secret write, so it is yours.

Then confirm: an unsigned `POST` should return **401 `invalid signature`** rather
than 503, and Meta's delivery reports should begin appearing in
`whatsapp_message_logs` with `message_type = 'status'`.

**Not urgent, and worth saying so.** Login works — the send path is unaffected and
customers receive codes. What is missing is the observability of whether they
did. Weigh it against the go-live checklist rather than treating it as an outage.

**On completion**, per the closeout rule below: delete this section, recording the
verification date and the 401-not-503 readback.

---

## 26. ~~The `ready` push tells delivery customers to come and collect~~ — CLOSED

**Status:** **DEPLOYED 2026-09-03** — `push-dispatch` **v6**, `verify_jwt: false`,
on explicit owner approval. The correction is live: a delivery customer passing
through `ready` is no longer told to come and collect.

### The defect

Delivery went live 2026-08-27. The server-authoritative ladder is
`preparing → ready → out_for_delivery → delivered`, so **every delivery order
passes through `ready`** — and `push-dispatch`'s `ready` body said, in both
languages:

| | before |
| --- | --- |
| en | *Your order is ready for pickup.* |
| ar | *طلبك جاهز للاستلام.* |

A delivery customer was told to come and collect, then contradicted minutes later
by `out_for_delivery` — "On the way 🛵". The in-app status label is neutral in
both languages ("Ready" / «جاهز»), so **the push was the only surface making the
claim.**

### The fix

`order_type` did not reach the copy selection at all — the order read selected
`id, customer_id, status`. It now also selects `order_type`, on the row that was
already being fetched: no extra round trip, and no new authorization surface
(service-role client, RLS already bypassed).

`ready` is the only status whose meaning differs by fulfilment, so it is the only
one that branches. Pickup copy is **byte-identical** to what it was — this is
additive, not a rewrite of approved copy. Delivery now reads:

| | after (delivery only) |
| --- | --- |
| en | *Your order is ready and will be on its way shortly.* |
| ar | *طلبك جاهز وسيكون في الطريق إليك قريباً.* |

It deliberately promises no time and does not pre-empt `out_for_delivery`, which
is the message that actually announces departure.

### Why it is derived from the order row

`order-intake` (`index.ts:331-347`) records that the pickup-only assumption had
been written down in **five** separate places before delivery went live, and each
rotted independently. Deriving from `orders.order_type` — not-null,
`enum('delivery','pickup')` — is the version that cannot become a sixth. Reading
it from the request body would additionally let a caller choose which copy a
customer receives.

Pinned by `supabase/functions/_shared/pushReadyCopyWiring.test.ts`, a source-shape
tripwire in the `adminAuthWiring.test.ts` idiom — the handler ends in `Deno.serve`
and `STATUS_COPY` is not exported, so no test can execute this. Mutation-tested:
collapsing the branch, dropping `order_type` from the select, restoring "pickup"
in the delivery body, and quietly rewording the pickup body each fail it.

### The deploy, 2026-09-03

| Function | Version | verify_jwt | Platform bundle hash | Carries |
| --- | --- | --- | --- | --- |
| `push-dispatch` | **6** | false | `8128f6a6a42f2150` | the order-type-aware `ready` copy, and nothing else |

**Verified by read-back and hash, which is the stronger proof the 2026-08-27 table
noted v5 did not have.** All five bundle files were read back from Supabase after
the deploy and hashed against the merged default branch — every one
**byte-identical**:

| File | sha256 (prefix) | Bytes |
| --- | --- | --- |
| `push-dispatch/index.ts` | `e8dce499de93` | 33 883 |
| `_shared/cors.ts` | `5262b16eb01e` | 466 |
| `_shared/adminAuth.ts` | `5422065d9fa3` | 5 703 |
| `_shared/supabaseClient.ts` | `21e9e910f816` | 2 072 |
| `_shared/secrets.ts` | `c6a15f7f566b` | 1 373 |

That check exists because the deploy payload is transcribed inline: a hash match
is what rules out a silent corruption in 34 KB of source. **Before** deploying,
the live v5 `index.ts` was read back the same way and confirmed byte-identical to
the repository's *pre-change* file, so the only delta v5 → v6 is this change.

**Booting, and the JWT gate still off, proven without sending anything.** An
unauthenticated `GET` returns **405** `{"error":"Method not allowed"}` — the
handler's own first branch. A platform **401** would have meant `verify_jwt` had
regressed to `true`, which would break every service-role and admin call on this
function; the 405 proves the module parsed, `Deno.serve` is running, and the gate
is still `false`. The probe returns before `adminClient()`, so it read no data and
sent no push.

**The redeploy carried no drift, and that was checked rather than assumed.** v5
was deployed 2026-08-27; since then exactly one commit touched anything this
function imports (`_shared/adminAuth.ts` and `_shared/supabaseClient.ts`, via
#311) and **both edits are docblock-only — no executable code**.

**No push was sent to verify the new copy.** Nothing here exercised it: the first
delivery order to reach `ready` is what will. That is X5, and this deploy was
sequenced before it deliberately — rehearsing the lifecycle first would have sent
the wrong message to a real person.

### One thing is still open

**The Arabic is engineering-drafted and has not had a native read.** It was
flagged before the deploy and the owner proceeded, so it is a made decision rather
than an oversight — but «طلبك جاهز وسيكون في الطريق إليك قريباً.» is now live to
real customers on the strength of an engineer's draft. Worth ten minutes from a
native speaker; changing it later is another `push-dispatch` deploy, not a code
emergency.

---

## 27. A store reviewer cannot sign in (X1) — MECHANISM DECIDED 2026-09-03

**Status:** decided; **one Auth configuration action is open, and it is yours.**
No code change is required, and none was made — that is the finding, not a
shortcut.

### The problem

Authentication is WhatsApp OTP to a **Saudi mobile only**, enforced twice:
`SaudiPhoneInput` renders a fixed `+966` and sanitises to a 9-digit `5XXXXXXXX`,
and `phone.ts` accepts only `/^5\d{8}$/`. The send button is
`disabled={!isSaudiMobile(national)}`. An App Review tester in Cupertino cannot
type their own number, and cannot receive a WhatsApp code sent to a Saudi one.
Apple guideline **2.1** requires working demo credentials for anything behind a
sign-in wall.

### The decision: a Supabase Auth test-OTP number

Auth supports mapping a phone number to a fixed code. Supabase's own description:
*"When a test phone number requests an OTP, the Auth service skips SMS delivery
and accepts only the mapped code. Other phone numbers continue to use the real
SMS provider."*

That is exactly the shape this problem needs, and it is why no code changes.

### Why it needs no code — traced, not assumed

| Step | Behaviour with a test number |
| --- | --- |
| `sanitizeSaudiNationalInput` / `isSaudiMobile` | A test number in `5XXXXXXXX` form passes; the send button enables |
| `toSaudiE164` | Produces the canonical `+9665XXXXXXXX` both calls must share |
| `requestLoginCode` (`loginAvailability.ts:85`) | A thin try/catch around `signIn` — **no additional gate** |
| `auth.signInWithPhone` → `signInWithOtp` | Auth skips delivery for a test number |
| `auth-send-sms-whatsapp` hook | **Not invoked.** No WhatsApp message, no Meta template cost, and **no `otp_send_reservations` budget consumed** — the rate limiter shipped 2026-09-02 is untouched |
| `auth.verifyPhone` → `verifyOtp({type:'sms'})` | Accepts only the mapped code and returns a real session |
| `handle_new_user` on `auth.users` | Creates the `profiles` row **for a NEW user only** — it is an `after insert` trigger. On an UNUSED number the reviewer lands on a fresh `role = 'customer'` account; on an already-enrolled number they land in **that person's existing account** instead. Step 1 is what keeps this true |

**`phone.ts` deliberately does not narrow to today's operator prefixes** — its
docblock says a stale allow-list would lock out real customers as CITC allocates
new `5X` ranges. `phone.test.ts` already canonicalises on `+966512345678`, a `51`
number, so this breadth is pinned by existing tests rather than assumed.

### The action (yours, §5 — Auth configuration)

1. **Choose a DEDICATED, UNUSED number — and verify it is unused before mapping
   it.** Any `5XXXXXXXX` is accepted by the client, but which one you pick is the
   security decision in this whole section.

   **"A number you control" is not the same as "a number nobody has signed up
   with", and this step said the former until review corrected it (#326).** If the
   number already has an `auth.users` row, `signInWithOtp` signs the reviewer into
   **that existing account**. `on_auth_user_created` is `after insert on
   auth.users`, so it fires only for a NEW user — no fresh profile is created, and
   the reviewer inherits whatever that account already has.

   **This is not hypothetical here.** Measured live 2026-09-03: **4 of 9
   `auth.users` rows already carry a phone number.** A number you personally use is
   *more* likely to be one of them, not less — which is the opposite of what the
   old wording implied.

   Today all four are `role = 'customer'`, so the exposure is that person's **order
   history and saved delivery addresses**, published to App Review as a working
   login. It is not privilege escalation *today* only because no staff or admin
   account has a phone enrolled; if that ever changes, the same mistake reaches the
   admin console.

   **Verify before you map it.** Ask the database whether the number is free — a
   read-only query, and the only way to be sure:

   ```sql
   select count(*) from auth.users where phone = '+9665XXXXXXXX';
   ```

   **Zero means safe to use. Anything else: pick a different number.** Do not
   "clean up" an existing account to reuse its number — deleting a real customer to
   make room for a test login is a worse outcome than picking another number.
2. In the Supabase dashboard, **Authentication → Phone provider → test phone
   numbers**, map that number to a 6-digit code.
3. Sign in once on a device to confirm the pair works **before** submitting.
4. **Remove the entry once review concludes, and verify it is gone** — see below.

### Removal is the control, and this section used to say something else

**This step read "Set an expiry" until 2026-09-03. That was wrong, and wrong in
a way that would have left a live credential enabled indefinitely.** Review
caught it on #326.

`SMS_TEST_OTP_VALID_UNTIL` is a **self-hosting** environment variable. Neither
hosted Auth guide documents a per-entry expiry on test phone numbers, and the
hosted **Email OTP Expiration** setting governs how long a *generated* OTP stays
valid — it does not expire a **mapped fixed code**. So the instruction pointed at
a control that probably is not in your dashboard, and demoted the thing that
actually works to a diary note.

**State the exposure plainly, because it is the reason this matters.** While the
entry exists, that phone number and code are a **permanent, reusable login** to
that account — no SMS, no WhatsApp, no second factor. The pair is also written
into the App Store Connect review notes, so it is not a secret in any meaningful
sense.

**Therefore:**

- **removal is the control.** When review concludes, delete the test-phone entry
  in Authentication → Phone provider;
- **verify it, do not assume it.** Attempt a sign-in with the same number and
  code afterwards and confirm it is refused. A deletion you did not check is a
  belief, not a control;
- **update the review notes** in App Store Connect at the same time, so a later
  submission does not ship a credential that no longer works — or worse, one that
  does;
- if your plan *does* expose a per-entry expiry, set it as well. Belt and braces,
  never the plan.

`docs/RELEASE_CHECKLIST.md` carries this as an actual checkbox — §8 creates the
entry, §11 removes and verifies it — because a step that lives only in prose is
a step that gets skipped.

**Do not put the code in this repository, a commit message, a PR description or a
test.** It is a password-equivalent for that account (§9). The *number* may be
recorded here if you want; the code may not.

### App Store Connect — review notes to paste

> This app serves customers in Saudi Arabia. Sign-in is by one-time code sent over
> WhatsApp to a Saudi mobile number, so a reviewer cannot use their own number.
>
> Please use the demo account below. It signs in with a fixed code and does not
> require WhatsApp or any SMS to be received.
>
> Phone: +966 5X XXX XXXX
> Code: XXXXXX
>
> Enter the phone number on the sign-in screen, tap send, then enter the code.
> Account deletion is available in-app at Profile → Delete account.

That last line is deliberate: it answers guideline **5.1.1(v)** in the same breath,
and the row it points at exists as of 2026-09-03 (X4).

**From the first build that carries guest browsing (added 2026-11-09), add this
line to the notes.** It answers the other half of 5.1.1(v), "let people use it
without a login". Do not add it to a build without that change, where it would be
false:

> The menu can be browsed, and a pickup branch chosen, without signing in. Sign-in
> is requested at checkout, for delivery, and on the Orders and Profile tabs.

### What was rejected, and why

- **App Review notes alone**, with a human relaying each code — reviewers work in
  another time zone and Apple commonly rejects under 2.1 when a code must be
  relayed. It also makes every re-review a manual event.
- **A build-flagged reviewer mode in the app** — a real authentication backdoor in
  production code. The risk is permanent; the benefit lasts one review.

### What this does NOT do

It does not make login work for anyone outside Saudi Arabia, and it is not a
fallback channel. **X7 is untouched**: WhatsApp remains the only real login path,
with no SMS fallback, and its Meta credential still needs checking.

---

## 28. Operations alert email dispatch (X3) — ONE STEP FROM CLOSED (2026-09-07)

**Status:** steps 1, 2 and 3 of four are **DONE**, all on 2026-09-07, each on its
own explicit owner approval.

- **Step 1** — `20260903120000_operations_alert_email_dispatch` applied
  **06:46:38 UTC** (live version `20260907064638`, ledger row 79).
- **Step 2** — `operations-alert-dispatch` deployed as **version 1**,
  **07:18:43 UTC**, `verify_jwt = false` matching `config.toml`.
- **Step 3** — the two Vault secrets created (**08:21:35** and **08:21:44 UTC**),
  then `20260903130000_operations_alert_dispatch_scheduler` applied **08:23:17 UTC**
  (live version `20260907082317`, ledger row 80). The `pg_cron` job
  `operations-alert-dispatch` now exists on `*/5 * * * *`.

**ONE action remains, and it is yours: enable `external_dispatch_enabled`.**
That is the step that actually starts mail.

**Amended 2026-11-11: that action now has two prerequisites**, §46 steps 3 and
4. Set `SMTP_ALLOWED_HOSTS`, then redeploy the dispatcher.

**Nothing has been enabled and no alert has reached anyone.** The flag is still
false and the outbox still holds its same 136 rows with zero on the `email`
channel.

**The cron job runs every five minutes and does nothing — and that was watched,
not assumed.** The first real tick, run **218621** at **08:25:00 UTC**, finished
`succeeded` in **11 ms**; an HTTP round trip cannot happen that fast. Confirmed
anyway: `net._http_response` holds two rows in that window and both belong to
other schedulers (`lazywait-sync` and `account-delete-process`), so this job made
no outbound request at all. Calling the driver by hand returns `null` for the
same reason — the flag check comes before any Vault read or HTTP call.

So until the flag goes on, `INCIDENT_RESPONSE.md` §1b's named watcher is still
what actually tells you when something breaks.

**Before you flip it, know what happens.** Alerts at severity `critical` (the
default floor) start producing `email` rows; within five minutes the cron job
posts to the deployed function, which claims up to 20 and sends over the
already-configured SMTP credential. Recipients are derived live from admin
profiles — **there is one admin with an email address today**, so that is who
receives them. The measured baseline says this should be quiet: all six alert
states are currently `recovered`, and the only recurring signal self-clears
inside the evaluator's own interval.

This section header said **BUILT INERT 2026-09-03**, then **BASE MIGRATION
APPLIED**; the status said *"nothing has been applied"* and then *"nothing has
been deployed"*. Each is corrected as it happened rather than deleted, so the
sequence stays readable.

### Why

The alert engine has worked since 2026-07-23 and has never once reached a person.
Every row it has produced is `('in_app','recorded')` and stops in the database.
Read live 2026-09-03: six alert states, all `recovered`, and the only critical
incident on record — 2026-08-10, stranded orders plus platform health — was seen
by nobody until somebody opened the console.

`INCIDENT_RESPONSE.md` §1b is the launch-week answer and needs no code. This is
the durable one.

### What was built, and what it removes

v1 did not forget to dispatch; it refused to, in three independent places. This
removes all three **for the email channel only**:

| v1 interlock | v2 |
| --- | --- |
| `operations_alert_outbox_v1_dormancy` — external rows can never leave `blocked`/`cancelled` | replaced by `operations_alert_outbox_v2_dispatch`; `email` gains a lifecycle, **`whatsapp` and `push` keep the v1 prohibition** |
| both producers hard-code channel `'in_app'`, so no external row is ever created | they now also emit ONE `email` row — per event, not per language — gated on the flag, a configurable language and a severity floor |
| the settings RPC raises on any attempt to set `external_dispatch_enabled` | the refusal is lifted; the flag is settable and round-trips |

A fourth guard, the cron activation block in `20260723120000`, checks the v1
constraint **by name**. It lives in `do $$ … end $$;` anonymous blocks that ran
once at apply time and are not stored, so replacing the constraint cannot break
it. Verified before the migration was written rather than assumed.

**The severity floor defaults to `critical`, and that default is measured rather
than guessed.** `lazywait:sync_degraded` has opened and self-recovered inside the
evaluator's own 5-minute interval on all four occasions it has fired. Mailing
every warning would have sent eight emails for four non-events, and an alert
mailbox that cries wolf is worse than no alert mailbox.

**No recipient address is stored**, which was v1's stated property and is kept.
`operations_alerts_dispatch_recipients()` derives the list from admin profiles at
send time, so revoking somebody's admin role stops their alert mail in the same
act. There is **one** admin with an email address today.

### The four actions, in this order — step 1 is DONE

1. ~~**Apply the migration**~~ — **DONE 2026-09-07 06:46:38 UTC**, live version
   `20260907064638`, on explicit owner approval naming the target by version
   ("apply 20260903120000"), via MCP `apply_migration`, one call, that file only.
   Ledger row 79 in `MIGRATIONS.md`.

   **It changed nothing, and that was measured afterwards rather than assumed:**
   `external_dispatch_enabled` is still false, the outbox still holds its same
   **136** rows with **zero** on the `email` channel, and `place_order` /
   `compute_order_snapshot` hash identically before and after. Moyasar was
   re-verified absent immediately after — it sorts ahead of everything, which is
   exactly why the target was named by version. Supabase security advisors:
   **0 ERROR**, and no finding names any of the four new functions.

   **The riskiest part was cleared before sending, not after:** the new CHECK
   constrains `in_app` rows, and adding a CHECK to a populated table fails if any
   row violates it. All 136 live rows were counted through both new predicates
   read-only first — 0 violations. The three replaced function signatures were
   also compared against live first, because `create or replace` fails on a
   changed signature.

2. ~~**Deploy `operations-alert-dispatch`**~~ — **DONE 2026-09-07 07:18:43 UTC**,
   **version 1**, `verify_jwt = false` matching `config.toml`. The bundle is five
   files (the entrypoint plus `_shared/cors|adminAuth|supabaseClient|secrets.ts`),
   taken from the merged default branch at `b3daea4` and read back after
   deploying to confirm they match.

   **It sends nothing, and that was tested rather than asserted.** Three probes,
   none of which writes anything: `GET` → **405** (the module loaded and
   `Deno.serve` is running, so the imports — including the external denomailer —
   resolved); unauthenticated `POST` → **401** (the admin gate refuses); `POST`
   carrying a scheduler header → **500 `signature check failed`**.

   **That third result is the point of deploying before applying
   `20260903130000`.** The signature RPC lives in that migration and does not
   exist yet, so the scheduler branch **fails closed** — it does not fall through
   to the admin gate, and it cannot be talked into running. Doing it the other
   way round would have been worse: applying the scheduler first creates a cron
   job POSTing every five minutes to a function that does not exist.

   Verified after deploying: flag still false, outbox still 136 rows with zero on
   the `email` channel, zero rows `processing`, zero claim tokens, money-path
   hashes unchanged, Moyasar still absent.
3. ~~**Apply the scheduler, and create its two Vault secrets first**~~ — **DONE
   2026-09-07 08:23:17 UTC**, live version `20260907082317`, ledger row 80. The
   `pg_cron` job `operations-alert-dispatch` exists on `*/5 * * * *` and ticks
   harmlessly while the flag is false: `invoke_operations_alert_dispatch()`
   returns `null`, taking the early-return branch before any Vault read or HTTP
   request. How the secrets were created without anyone seeing one is below.
4. **Enable it** — set `external_dispatch_enabled` true. **This is the only step
   left, and the only one that actually sends mail.**

   **Two steps come first, added 2026-11-11 (§46 steps 3 and 4):** set
   `SMTP_ALLOWED_HOSTS` to the relay's name, then redeploy
   `operations-alert-dispatch`. The first is the only rule that refuses a
   relay name pointing into private space. The second matters because the
   only recorded deploy (v1, 2026-09-07) predates the SMTP guard, so the
   running dispatcher may not check the endpoint at all.

   **How:** admin console → **Alerts** tab → **Settings** → the **"External
   dispatch (email)"** checkbox. You must be signed in as an admin **with your
   two-factor step completed** — the RPC behind it requires AAL2, so an admin at
   AAL1 is refused with a two-factor message.

   **Corrected 2026-09-13 — this said "There is no service-role side door, by
   design."** The RPC has none; the *table* does. `operations_alert_settings` has
   RLS enabled with **zero policies**, which leaves it to `service_role`, and
   service role bypasses RLS — so a service-key holder can set the flag with a
   direct `UPDATE`. Nothing about your console path changed, and no agent session
   will take the other one (`CLAUDE.md` §8 states that as a standing rule). But
   the reason to click it yourself is **attribution**, not impossibility: a
   service-role write is indistinguishable in the audit trail from the same write
   by anyone else holding that key.

   **This was briefly impossible, and the note is worth keeping.** Until
   2026-09-07 the console rendered that control **disabled**, labelled
   "(disabled in this version)", under a caption reading *"no external dispatcher
   exists in this version; external delivery cannot be enabled even by admins."*
   Both were true of v1 and false the moment the dispatcher was deployed —
   `20260903120000` removed the settings RPC's refusal and nothing removed the
   front end's, so the backend was ready and the last step was unreachable. A
   test even pinned the disabled state, so the limitation had become
   self-enforcing. Review caught it on #332 and it was fixed on its own PR.

   The lesson generalises: **a test that pins a deliberate limitation has to be
   revisited when the limitation is lifted, or it quietly becomes the
   limitation.**

Order mattered, and it was followed: deploying before applying would have given a
function whose RPCs did not exist, and enabling before deploying would have queued
rows nothing drained. Steps 1, 2 and 3 landed in that order, so the cron job now
points at a function that is already live and whose RPCs already exist. **Only
step 4 is left.**

**Two housekeeping follow-ups the apply surfaced**, neither behavioural and
neither blocking:

- two `comment on function` descriptions set by `20260723090000` survived
  `create or replace` and now understate what the settings RPC permits (they say
  external dispatch "cannot be enabled in this version"). Nothing reads
  `pg_description` — no test, no console, no generator — so this is stale text
  with no consumer;
- the applied file's header calls it a "KNOWN LIMITATION" that
  `operations_alert_settings_safe()` will not return `dispatch_language` and
  `dispatch_min_severity`. That is wrong: the function is
  `select to_jsonb(p) - 'updated_by'`, a whole-row projection, so both columns
  surface already. The admin console's normalizer discards keys it does not
  model, so nothing breaks either way.

### Step 4 in detail — the invocation path

**This step used to be missing entirely, and step 3 claimed to be "the only step
that sends mail".** It was not: a repo-wide search for `operations-alert-dispatch`
found its definition, its `config.toml` entry, its test and these documents —
**no caller**. Enabling the flag filled the outbox and left it full. Review
caught it on #328; migration `20260903130000` closes it.

**DONE 2026-09-07.** The two Vault secrets were created at **08:21:35** and
**08:21:44 UTC**, and `20260903130000_operations_alert_dispatch_scheduler` was
applied at **08:23:17 UTC** (live version `20260907082317`, ledger row 80). `pg_cron` now calls
`invoke_operations_alert_dispatch()` every five minutes — the same cadence as the
evaluator, so an alert cannot sit undelivered longer than it took to notice.

### How the Vault secrets were created, because this section never said

This document listed **what** the two secrets are but never **how** to make one,
even though it had been done twice before (`account_deletion_*`,
`lazywait_sync_project_url`). That gap is why the question had to be asked. The
method, for the next time a scheduler needs one:

| Vault secret | Value |
| --- | --- |
| `operations_alert_dispatch_project_url` | the project's base URL, `https://<ref>.supabase.co`. **Not secret** — it is in every mobile and web client |
| `operations_alert_dispatch_secret` | 32 random bytes, hex. **Generated inside Postgres and seen by nobody** |

```sql
-- Public value, safe to type anywhere.
select vault.create_secret(
  'https://<ref>.supabase.co',
  'operations_alert_dispatch_project_url',
  'Base URL for the operations alert dispatch cron driver.'
);

-- The secret. Generated IN-DATABASE and passed straight into create_secret in
-- the same statement, so it is never selected, never returned and never crosses
-- the wire. Only the row UUID comes back.
select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'operations_alert_dispatch_secret',
  'Trigger secret for invoke_operations_alert_dispatch. Never transmitted.'
);
```

**Do it this way rather than generating a value yourself.** A secret you create
by hand exists in at least two places that outlive the act — your terminal
scrollback and whatever you pasted it into. This one exists only inside Vault.
Nothing needs to read it: Postgres signs with it and Postgres verifies it.

**Verify without printing it:**

```sql
select name, length(decrypted_secret)
  from vault.decrypted_secrets
 where name like 'operations_alert_dispatch%';
```

`operations_alert_dispatch_secret` should be **64** characters — 32 bytes as hex.
The names must match exactly; the driver looks them up by name.

(The Dashboard also has a Vault UI under Project Settings if you prefer clicking,
but it cannot generate the value in-database, so you would be back to handling
the plaintext yourself.)

**The secret never leaves Postgres — and the first version of this section said
so while it was false.** The driver put the decrypted secret verbatim in an
`x-alert-dispatch-secret` header, so the Edge Function received the plaintext on
every tick and could log or leak it exactly like the older `lazywait-sync` shape
this was supposed to improve on. Review caught it on #329.

What crosses the boundary now is a **signature**: the driver sends a random
nonce, a UTC timestamp and `HMAC-SHA256(nonce.timestamp)` taken under the Vault
secret, and `verify_operations_alert_dispatch_signature` recomputes it inside
Postgres. The value itself is never transmitted, so it cannot reach an Edge
Function log or request instrumentation, and the function cannot read it out of
Vault either. Stale requests are refused outside a 10-minute window.

**This changes nothing you have to do.** The same two Vault secrets, created the
same way. If you generated `operations_alert_dispatch_secret` already, keep it.

**Applying it before the secrets exist is safe.** The driver checks the master
flag first and returns without touching Vault, so the job ticks and does nothing.
Once enabled, a missing secret **raises** rather than returning quietly — silence
would look exactly like "nothing to send", which is the failure this subsystem
exists to prevent.

**Only after all four steps is X3 actually closed.** Until then
`INCIDENT_RESPONSE.md` §1b — the named human on a fixed schedule — remains the
real answer, and it stays worth keeping afterwards as the fallback for the case
where the dispatcher itself is what breaks.

### How to check it worked, without waiting for an incident

**After step 4 — not before.** `operations_digest_generate` then produces one
digest email per day. It cannot produce one earlier: `20260903120000` gates that
insert on `external_dispatch_enabled`, so while the flag is false the digest
still writes its `in_app` row and nothing else. This paragraph said "after step
3" until the steps were renumbered around the scheduler apply, at which point it
promised a signal that could not arrive.

To force a faster signal once the flag is on, lower `dispatch_min_severity` to
`warning` temporarily — a `lazywait:sync_degraded` warning historically fires
within days — and put it back afterwards.

### On completion

Record the applied version, the deployed function version and the read-back, and
close this section per the rule below.

---

## 29. Native Arabic read of the FOUR corrected legal documents (v2.1) and the loyalty UI copy

**Not blocking anything. It is here because the Arabic in question is now
BINDING, which the rest of the engineering-drafted Arabic is not.**

On 2026-09-08 **four** live documents were corrected in place to version 2.1 —
`offers_loyalty_terms`, `privacy_policy`, `delivery_pickup_policy` and
`allergen_food_notice`. Every correction was made in both languages. Detail and
evidence: [`LEGAL_DOCUMENTS_AUDIT.md`](LEGAL_DOCUMENTS_AUDIT.md), with the
loyalty specifics in [`LOYALTY.md`](LOYALTY.md) §7. The English is plain and
checked against the code. **The Arabic replacements are engineering-drafted and
have not had a native read.**

They were published rather than held back deliberately: leaving the Arabic
stating something false while the English told the truth would have been the
worse of the two options, since the Arabic is what most customers read. The
trade is that the wording may be stiff or subtly off in a document a customer is
bound by.

What is wanted:

- a native Arabic speaker reads the corrected passages in all four live
  documents (Admin → Legal Documents) against the English;
- anything reworded is edited in the admin console, which is an ordinary admin
  write and needs no engineering;
- the same read covers the loyalty UI strings shipped in the five-part series —
  the pickup-only checkout note, the "you'll earn N points" line, the Profile
  expiry notice, and the campaign panel labels. Those are not binding, so they
  are the lower half of this item.

Related and still open: the delivery `ready` push Arabic (§26), which is the
other engineering-drafted string on a live customer path.

---

## 30. ~~OTP retention sweep~~ — APPLIED AND RUN 2026-09-08 (closed)

**Applied 2026-09-08 12:31:16 UTC**, live version `20260908123116`, on explicit
owner approval naming the target by version. Ledger row 81.

Verified after the apply: exactly one cron job with the canonical schedule and
command; the function callable by `service_role` only, not by `anon` or
`authenticated`; the money-path hashes identical; Moyasar still absent.

**CLOSED by running it, not by asserting the schedule.** Applying deleted
nothing, so on separate owner approval the sweep was executed once at
2026-09-08:

```
{"ran": true, "challenges_deleted": 3, "reservations_deleted": 0}
```

The three rows were from 10 and 21 July — two abandoned, one consumed — all
roughly two months past a five-minute expiry. **`otp_challenges` now holds 0
rows and 0 outside the window.** All six OTP functions intact; `profiles` (9),
`orders` (71) and `loyalty_transactions` (111) untouched, so the sweep reached
nothing it should not.

**Stated precisely, because this item was closed once already on weaker
evidence:** the function is proven against real data, the job is registered and
`active`, and pg_cron is demonstrably working (470 successful runs across seven
other jobs in the surrounding two hours). **The sweep's own first scheduled tick
is 2026-09-09 00:40 UTC and has not been observed.** Nothing depends on it — the
data is already inside the window — but it is not the same as having watched it
fire.

**It was briefly marked closed on the strength of the apply alone**, and review
caught that on #342: the completion criteria below had been written two commits
earlier and were not met. Recorded rather than quietly fixed, because it is the
same shape as the errors the legal-document audit was created to find. A cron job
that exists is not a cron job that works — §28 of this file learned that when a
dispatcher shipped with no caller at all.

The section below is kept as the record of why it was needed.

---

**This was the one outstanding inaccuracy in the whole legal set.**

`privacy_policy` says, under HOW LONG WE KEEP IT: *"Verification codes: a short
period, then deleted."* Nothing deletes them on a schedule. `otp_challenges`
holds rows going back to **10 July**, carrying `phone_e164` and `ip_hash`; the
only thing that ever removed them was account deletion.

The wording was deliberately **not** softened to match — the policy states the
right intention, and lowering a retention promise to fit the code is the wrong
direction. The fix is
`supabase/migrations/20260911120000_otp_retention_sweep.sql`, which adds
`purge_expired_otp_records()` and a daily `otp-retention-sweep` cron job at
00:40 UTC.

**What applying it does:** deletes `otp_challenges` rows more than 24 hours past
their own expiry, and `otp_send_reservations` rows older than two days — the
identical rule `otp_reserve_send` already applies per phone, so the login rate
limiter cannot be affected. Both bounds are asserted by the migration's own
verification block and mutation-tested.

**What it does not do:** it touches no order, payment or loyalty data, and
redefines neither money-path function.

Applying it is a §5 action. Name the target by version: `20260911120000`.

### On completion

Record the applied version and the first cron run, and confirm the oldest
remaining `otp_challenges` row is inside the window.

---

## 31. Ship the data export as a FILE, not share text (next native build)

**Not blocking, and the current behaviour is honest rather than broken.**

`export_my_data()` and its Profile screen (A6, PR #343) hand the customer their
data through React Native's core `Share` as message text. That was chosen so the
feature would not be trapped behind a native build: `expo-file-system` and
`expo-sharing` are not installed, and adding either is a new native module.

**The limit is real and review found it.** On Android the share text travels in
an Intent extra across Binder, whose transaction buffer is roughly 1 MB and is
shared with everything else the process is doing. A large export can therefore
fail — sometimes silently — and it fails for exactly the customers with the most
order history, who are the ones most likely to be exercising a data request.

The code refuses above **256 KB** and tells the customer to contact support,
which converts a silent platform failure into an explicit one with a route out.
A realistic export today is tens of kilobytes, so this should bite rarely — but
"rarely" is not "never".

What is wanted, when a native build is being cut anyway (the same build that
ships A6 and B1):

- add `expo-file-system` and `expo-sharing`;
- write the JSON to a cache file named from `exportTitle()` and share the file
  URI instead of the message body;
- delete the 256 KB guard and its tests, or keep them as a fallback for web.

Until then the guard stays, and the readiness row says so rather than implying a
download exists.

---

## 32. CLOSED 2026-09-09 — loyalty terms corrected to v2.2

**Closed by publishing `offers_loyalty_terms` v2.2 at 07:56:15 UTC**, on explicit
owner approval ("update the loyalty terms to v2.2"), effective 9 September 2026,
active, both languages. All three items below are answered:

1. **EARNING — "eligible" is now defined:** *"Points are earned on PICKUP orders
   only. A delivery order does not earn points."*
2. **REDEEMING — the missing caveat is in:** *"Points can be spent on PICKUP
   orders only. They cannot be used on a delivery order."* This was the
   misleading half, not merely the incomplete one.
3. **The advance-notice promise — answered honestly rather than papered over.**
   Notice was **not** given in advance, because the rule went live at the instant
   the migration applied and there was no window in which to give it. The
   customer document does not claim otherwise. Real exposure was nil and
   measured: 5 accounts hold points (5 409 total), all owner test accounts, and
   delivery has been redeemed against **zero** times, ever. If you want
   belt-and-braces, `app_settings.loyalty_pickup_only` turns the rule off with no
   migration, notice can be given, and it can be re-enabled after — say the word.

v2.2 went further than this item asked and also covered per-item exclusion and
campaign multipliers, so those two switches are terms-ready before first use
rather than after. **Expiry is only partly covered — see §33.**

Verification, wording decisions and the byte-exact revert path:
`docs/LOYALTY.md` §7. Method note: `docs/LEGAL_DOCUMENTS_AUDIT.md`.

**The sequencing lesson, kept because it will recur.** `docs/LOYALTY.md` §7 says
*terms first, switch second*. Pickup-only defaults ON, so applying the migration
WAS the change — there was no later toggle to wait for, and the terms therefore
had to be published **before** the apply. They were published after. It cost
nothing here only because there are no real customers yet.

### The original item, kept for its reasoning

**Raised 2026-09-09, the moment `20260907120000_loyalty_pickup_only` was applied.**
Loyalty is pickup-only in Production: a delivery order neither earns points nor
may redeem them. `legal_documents.offers_loyalty_terms` v2.1 (effective
2026-09-08, active) **mentions neither pickup nor delivery.**

The two halves are not equally exposed, and the distinction is the point.

**Earning is covered, narrowly, by a hedge.** The document says *"You earn points
on the value of **eligible orders**"* and *"points are added automatically on
eligible orders"* — and never defines "eligible". That is the hook a channel rule
hangs on, so the sentence is incomplete rather than false.

**Redemption has no such hedge, and is now misleading.** The document says:

> You choose whether to use your points on an order. When you do, your whole
> available balance is applied, up to the value of the order.

No channel caveat. A customer with a balance who reaches checkout on a delivery
order will find they cannot redeem, and the terms told them they could.

**A second clause is worth reading before deciding how to fix it.** Under CHANGES
TO THE PROGRAMME the document promises: *"Where a change reduces the value of
points you already hold, we will announce it in the app in advance and give you a
reasonable period to use them."* Restricting where a balance may be spent is
arguably such a change. It was not announced in advance, because the apply is
what made it true.

**Real exposure is currently nil, and that is why this is a correction rather
than an incident.** Five accounts hold points (5 409 total, largest 1 945), across
71 orders — the owner's own testing. Delivery has been redeemed against **zero**
times, ever. Fixing the wording before real customers arrive costs nothing;
discovering it afterwards would.

**Why it is yours and not mine.** Editing `legal_documents` is a live Production
write under §5, and the wording is a commercial and legal choice — whether to
state the rule plainly, define "eligible", and whether the advance-notice clause
needs honouring — not an engineering one.

**What needs to change, both languages, as v2.2:**

1. EARNING — define eligible: points are earned on **pickup** orders only.
2. REDEEMING — the missing caveat: points may be redeemed on **pickup** orders
   only.
3. Decide whether the advance-notice promise applies, and if so how it is met.

**Updated 2026-09-09 — a SECOND item is now queued behind this same correction.**
`20260909120000_loyalty_expiry` is applied, so points expiry exists as a
mechanism. It is **off**, nothing is scheduled, and applying it expired nothing —
but the terms say nothing about expiry at all, and the same CHANGES TO THE
PROGRAMME clause promising advance notice applies with far more force to a reset
that zeroes a balance than to a channel restriction. **Expiry cannot be switched
on until the terms cover it**, which means v2.2 should settle both questions at
once rather than being revised twice. `docs/LOYALTY.md` §4.

The engineering side is ready: `app_settings.loyalty_pickup_only` turns the rule
off and restores the previous behaviour exactly, with no migration, if you would
rather correct the terms first and re-enable after.

---

## 33. Loyalty terms v2.2 — two follow-ups, one of them blocking expiry

**Opened 2026-09-09, when v2.2 was published.** §32 is closed; these are what it
did *not* settle.

### 33a. The Arabic in v2.2 has not had a native read — NOT blocking

Same caveat as v2.1 and the rest of this series (§26, §29), but **v2.2 carries
more new Arabic than v2.1 did**: an entire new expiry section, a restructured
earning section and five new sentences, all engineering-drafted. It was published
rather than held so that neither language was left stating something misleading
on delivery — the English and Arabic say the same thing, and the risk is phrasing
rather than meaning.

What a reviewer should check, rather than reading it cold:

- **انتهاء صلاحية النقاط** — the new section. It must read as *"points do not
  currently expire, and if we introduce a date we will tell you in advance"*, not
  as an announcement that expiry is coming.
- **طلبات الاستلام فقط** in both the earning and redemption sections — the
  pickup-only rule is the whole point of the version.
- **وقد لا تمنح بعض الأصناف نقاطاً** — "may not", not "do not". Nothing is
  excluded yet and the stronger form would be false.

### 33b. Expiry is still NOT lawful to enable — BLOCKING

v2.2 removed one of three blockers. Publishing the expiry section means the terms
are no longer silent on the mechanism, and it starts the advance-notice clock.
**Two remain, and both are yours:**

1. **Give the advance notice.** The document promises *"we will announce it in
   the app in advance and give you a reasonable period to use them."* Publishing
   the promise is not performing it. A specific date must be announced, with a
   usable window, before the first reset.
2. **The acceptance question — counsel's call.** KSA guidance expects forfeiture
   terms to be accepted through a click-wrap mechanism. `legal_documents` carries
   a `requires_acceptance` flag, but **nothing records that a given customer
   accepted a given version** and nothing gates ordering on it. Building that is
   a schema change plus a checkout-flow change; it is not built, and
   `requires_acceptance` is still `false` on the live row.

Until both are done, leave `loyalty_expiry_enabled` off. The mechanism is applied
and proven inert (`docs/MIGRATIONS.md` ledger row 84); nothing degrades by
waiting.

## 34. ~~Privacy policy map sub-processor~~ — CLOSED 2026-09-16 (both steps done)

**`privacy_policy` v2.3 is live**, both languages, effective 2026-09-16. The
Mapbox line is gone, Google is named, and **Apple is named for the iPhone
reverse-geocode** — a sub-processor no version of this policy had ever disclosed.

The line now reads:

> Google, with Apple on iPhone — the map you use to choose a delivery location.
> Google draws the map and receives the coordinates of the point you pick.
> Turning that point into a street address is done by Google on the web and on
> Android, and by Apple on iPhone.

It follows the list's existing two-party pattern (`Expo, with Apple (APNs) and
Google (FCM) — …`) rather than inventing a shape.

**v2.2 lasted about half an hour and is recorded rather than erased.** It said
"the map **and address search** you use", which promised Google received
something customers cannot send it — there is no address search in either
customer channel. It also named only Google, missing Apple. v2.2 was live to the
app and to JavaScript-enabled web readers for that window, so it is a real
version and gets a real successor, not a silent in-place edit. Exactly one line changed in each
language and every other byte was verified identical before and after — the
replacement was dry-run first, with a hash of the rest of the document compared
across the edit.

**The open question this section posed is answered, and the section was wrong
about how.** It said `EXPO_PUBLIC_MAP_PROVIDER` "is not readable from a session".
It is: `eas-cli` is authenticated here, and `eas env:list --environment
production` returns `EXPO_PUBLIC_MAP_PROVIDER=google` with **zero Mapbox
variables** in that environment — so the Mapbox branch has no token and cannot
work even if it were selected. Native and web agree, so **Option A (Google only)**
was correct. *Recorded because the next session should reach for the CLI rather
than treat a hosted environment variable as unknowable.*

### CLOSED by v2.3 — the two wording defects v2.2 carried

**Found immediately after publishing v2.2, by an exhaustive read of the map code
that should have happened before.** Both are fixed in v2.3; they are kept here
because the shape recurs.

1. **"and address search" describes a feature the customer does not have.**
   `places.googleapis.com/v1/places:searchText` is called from exactly one place,
   `src/components/MapSearchBox.tsx:51`, which is the **admin console** — used for
   drawing delivery zones and editing branch addresses. Neither customer channel
   has an address search at all. The line promises Google receives something it
   does not receive from customers.

2. **On iPhone the reverse geocode goes to APPLE, and no version has ever said
   so.** `LocationPickerMap.tsx:188` calls `Location.reverseGeocodeAsync`, which
   is the **OS** geocoder — Apple's CLGeocoder on iOS, Play services on Android.
   Only the web path uses Google's own `Geocoder`
   (`LocationPickerMap.web.tsx:126`). So an iPhone customer's picked coordinate
   reaches Apple, and the policy names only Google.

**This was the same class of error v2.2 was published to fix** — a sub-processor
list that does not match the software — caught one layer down. **The lesson is
about ordering, not about maps: the code read that settles a disclosure belongs
BEFORE the write, not after it.** v2.2 was published on a drafted sentence and a
single decisive environment variable; the full read of the map code came
afterwards and found two things the draft had wrong.

**AN EARLIER VERSION OF THIS PARAGRAPH SAID "no customer has seen either
sentence". THAT WAS FALSE, and review caught it on #386.** Only the
**no-JavaScript snapshot** waits for a rebuild. Every other surface reads the
table live: `src/legal/main.ts:122` fetches `legal_documents` on page load, and
`apps/mobile/src/services/api.ts:238` queries the same table from the app. So
**v2.2 was customer-visible for the nine minutes it was the active row**
(07:40:34 → 07:49:39 UTC), to anyone who opened the legal screen in the app or
the legal page in a browser.

**The error is the same conflation this whole section is about** — treating "the
public page" as though it were the only reader, when the rebuild gap makes the
no-JavaScript snapshot the *only* surface that lags. Having just written that
distinction down, the next paragraph immediately forgot it.

**What is actually true.** The exposure was nine minutes, and v2.2 was still
strictly more accurate than the v2.1 it replaced — it named the processor that
receives the delivery pin instead of one that receives nothing. But "not urgent"
was the wrong conclusion to draw, and it was drawn from a false premise: a
known-inaccurate disclosure was live to real readers, not parked in a draft.

**The lesson stands and gets sharper.** The code read that settles a disclosure
belongs BEFORE the write. v2.2 went out on a drafted sentence plus one decisive
environment variable; the full read came afterwards and found two things wrong,
and those two things were briefly live. The rebuild gap limited the blast radius
to one surface, not to none.

**The drafted correction document has two further errors worth fixing before it
is used again:** it cites `apps/mobile/src/lib/googleMaps.ts`, which does not
exist (the real file is `src/lib/googleMaps.ts`, the admin loader), and it says
"both providers are compiled into both artifacts", which is false for the web
artifact — `LocationPickerMap.web.tsx` contains no Mapbox path at all.

**One thing this does NOT change: Option A was right, and was right under every
scenario the evidence permits.** No shipped customer artifact contains a Mapbox
token, so on Android the flag decides whether a map appears, not whether Mapbox
is a processor. Option B would have re-committed the exact defect being fixed.

### CLOSED: the rebuild ran, and the public page now serves v2.3

**This was the part that mattered for the store listings, and it was not a
formality.** Publishing the row corrected the database, the app and every
JavaScript-enabled web reader. It did not correct the **no-JavaScript snapshot**,
which is frozen at the last deploy: B7's prerender plugin is `apply: 'build'` and
bakes the documents into `legal.html` during `vite build`.

Measured on the deployed page immediately after publishing: still
`v2.1 · 2026-09-08`, still `Mapbox — the map you use to choose a delivery
location.`, byte-identical response size. **A store policy checker is exactly a
no-JavaScript reader**, so at that moment nothing had changed from Google's or
Apple's point of view.

**The rebuild ran on 2026-09-16, and it needed no new deployment path.** Merging
to the default branch *is* the Vercel production trigger — established by reading
the checks on the three merges that day, each carrying `Vercel=success`, rather
than by adding a second path, which §13 forbids. Merging #386 therefore both
recorded the publication and rebuilt the site.

**Verified on the artifact a store reads, not on the row.** Re-fetched from
`https://app.spicymeal.com.sa/privacy` with `<script>` stripped: `v2.3 ·
2026-09-16`, **zero occurrences of `Mapbox`** in either language, the
Google-and-Apple sentence present in both, build stamp `Published documents as of
2026-09-16`. The snapshot is served identically at every legal URL, so one fetch
covers them all.

**The general rule, which nobody had written down, survives its own closure:**
editing a `legal_documents` row does not reach a no-JavaScript client until the
site is rebuilt. B7 fixed "the legal page has no content without JavaScript" and
silently replaced it with "the content without JavaScript is whatever was true at
the last deploy". **A legal correction is two steps, not one**, and the second one
is the one a store sees.

### What closing it exposed — the document now contradicts itself about its date

**This is a new, live defect, and it is the direct residue of how the two
publications were made safe.** See `GO_LIVE_READINESS.md` **A10**, and §39 below
for the action.

The row's `effective_date` column is `2026-09-16`, and the page renders
`v2.3 · 2026-09-16`. The **first line of the body**, in both languages, still
reads `Effective date: 8 September 2026` / `تاريخ السريان: ٨ سبتمبر ٢٠٢٦`,
carried over from v2.1. A reader is given two effective dates for one document,
and the earlier one asserts that the Google-and-Apple disclosure took effect a
week before it was written.

**It is the only one of the nine active documents where the two disagree**, which
was measured rather than assumed — all eight others have a body date matching
their column.

**The cause is the safety discipline, which is why it is worth writing down.**
Each publication changed exactly one line and hashed the rest of the document,
masked at that line, to prove nothing else had moved. The body's own date line was
one of the bytes that check was guaranteeing had *not* changed. **The invariant
was right for a wording fix and wrong for a version bump whose date moves.** A
dated document keeps its date in two places and only one of them is a column;
a check that proves "nothing else changed" will defend the stale one.

### The original item, kept for its reasoning

**Opened 2026-09-10** by the go-live re-verification. It is the only live legal
statement found that the software does not match, and the URL it is served at is
the one going into both store listings.

`privacy_policy` v2.1 lists `Mapbox — the map you use to choose a delivery
location` in both languages. The shipped web bundle carries a **Google** Maps key
and **no Mapbox token** (`pk.` absent, `AIza` present), and `googleMaps.ts` uses
Google **Places** for address search. So a named processor receives nothing while
an unnamed one receives the customer's delivery coordinates — wrong in both
directions at once.

**Replacement text for both languages, plus the evidence and its limits, is in
[`docs/legal/PRIVACY_POLICY_MAP_PROCESSOR_CORRECTION.md`](legal/PRIVACY_POLICY_MAP_PROCESSOR_CORRECTION.md).**
Publishing is a §5 live write and stays yours.

**One thing to check first, because it decides which text to publish.** The
evidence proves the **web** channel. Both providers are compiled into both
artifacts, and the native build's `EXPO_PUBLIC_MAP_PROVIDER` is not readable from
a session. Read it in the EAS `production` environment: if it is `google`, publish
Option A; if it is not, publish Option B, which names both.

> **Superseded 2026-09-16.** That variable *was* readable — see the head of this
> section. It is `google`, so Option A was published.

The Arabic is engineering-drafted and carries the same caveat as §29 and §33a.
The English may be published alone if the Arabic must wait — a correct English
disclosure beside an unchanged Arabic one beats leaving both wrong.

### On completion

Bump to v2.2 with the publication date (a sub-processor change is substantive,
not a typo fix), update `docs/GO_LIVE_READINESS.md` A9, and close this item.

> **Done 2026-09-16, and the checklist above was one step short.** v2.3 is
> published, the rebuild has run, the public page is verified, and **A9 is ✅**.
> The step this checklist did not anticipate was the rebuild, which is exactly
> why it is now written at the head of this section. **The step it also did not
> anticipate was the in-body effective date**, which a version bump moves and a
> "nothing else changed" hash defends — that is §39, and it is still open.

## 35. Native Arabic read of the corrected iOS location purpose string

**Opened 2026-09-10.** `apps/mobile/locales/ar.json` now carries a new
engineering-drafted Arabic sentence — the iOS permission prompt a customer reads
before granting location. It ships in the next native build.

It is short, it is user-facing at a permission moment, and it has never been read
by a native speaker. Fold it into the same review as §29 and §33a rather than
running a separate pass; the English it mirrors is in
`apps/mobile/app.json` under `ios.infoPlist.NSLocationWhenInUseUsageDescription`.

Not blocking: the previous Arabic was also engineering-drafted, so this is not a
regression — it is one more string on an existing list.

**Widened 2026-11-10 — read these with it, in the same pass:**

- **the location purpose string again**, rewritten to name every use: the
  nearest branches on the pickup tab, the delivery pin, and the checkout warning
  when the pin is far from where the customer is. `ar.json` and the English in
  `app.json`/`en.json` all changed;
- **the notification consent screen** (`apps/mobile/src/i18n/strings.ts`, keys
  `notifConsent*`): a title, two bodies (before the OS prompt, and the one-time
  notice), and four button labels. This is consent copy, so a wrong word here is
  a wrong statement about what the customer agreed to — it is the one item on
  this list worth routing to the PDPL consent review as well;
- **`notifPromosSub`**, the Profile subtitle, which used to say «فقط إذا اشتركت»
  ("only if you opt in") while offers were on by default, and now says they are
  on by default and can be switched off.

**Widened 2026-11-12 — four console messages and one manual section, same pass.**
These are staff-facing, not customer-facing, so they rank below the consent copy
above. All are engineering-drafted.

- **The menu import's four refusals**, in `MENU_CSV_TEXT` in
  `src/utils/calculations.ts`. An administrator reads them in the Arabic console
  when a spreadsheet is refused:
  - the file was not saved as UTF-8, and to save it as «CSV UTF-8» from Excel;
  - a quotation mark on row N opens a cell and never closes it;
  - row N has more columns than the template's nine;
  - row N's calories value is not a plain whole number.

  The first is the one that matters: it is what an administrator on an Arabic
  Windows computer sees the first time, and it has to name the Excel option in
  the words Arabic Excel uses. «حفظ باسم» and «CSV UTF-8» are the drafted terms.
- **`docs/STAFF_MANUAL.md` §9**, the new Arabic half of "Spreadsheets and times":
  the import steps, the report-export note and the console-times paragraph.

**Widened 2026-11-12 — four order refusals** (`apps/mobile/src/i18n/strings.ts`,
keys `errOrder*`), shown at checkout when the server refuses an order:

- `errOrderPhoneUnverified` — «لتقديم طلب، سجّل الدخول برقم واتساب الخاص بك.»
- `errOrderOpenLimit` — «لديك عدة طلبات قيد التنفيذ. يرجى الانتظار حتى يجهز أحدها قبل تقديم طلب جديد.»
- `errOrderHourlyLimit` — «لقد قدّمت عدة طلبات خلال الساعة الماضية. يرجى المحاولة مرة أخرى بعد قليل.»
- `errOrderQuantityLimit` — «يمكنك طلب 50 قطعة كحد أقصى من الصنف الواحد.» (the number comes from `MAX_LINE_QUANTITY`)

The English for each sits beside it in the same file. «قطعة» ("piece") is the
word to check first: it reads oddly for a drink or a sauce.

**Widened 2026-11-12 — the Moyasar-only change (§47).** All engineering-drafted,
none read by a native speaker. Brand names stay in Latin script.

Customer-facing, in the app (ships with the EAS build in §47.17):

- the payment screen footer (`apps/mobile/src/app/payment/checkout.tsx`):
  «تُدخل بيانات بطاقتك في صفحة Moyasar الآمنة.» — English: *"Your card details
  are entered on Moyasar's secure page."*;
- the web build's payment stub (`apps/mobile/src/components/PaymentWebView.web.tsx`):
  «يمكنك إكمال طلبك عبر الموقع والدفع نقدًا.», replacing a line that called the
  web build a trial version;
- `payBelowMinimum` (`apps/mobile/src/i18n/strings.ts`), shown when points leave
  a total under 1.00 SAR: «يتطلب الدفع الإلكتروني ألا يقل الإجمالي عن 1.00 ريال.
  استخدم نقاطاً أقل، أو ادفع نقداً.»

Admin-facing, in the console (live on merge):

1. «مزوّد الدفع المحفوظ ليس 'moyasar'. احفظ بطاقة الدفع أعلاه لتخزينه.»
2. «انشر دوال الدفع الخاصة بـ Moyasar أولاً.»
3. «دالة payment-test-config على الخادم أقدم من Moyasar. قراءاتها تخص بوابة الدفع
   السابقة فلا تُعرض هنا، واختبار الاتصال فيها لا يختبر Moyasar.»
4. «يفيد الخادم بأن Moyasar غير جاهز (<reason>).»
5. «رمز التحقق من الويب هوك: <code>»
6. «أرسله Moyasar الساعة <t1>. أدخله في Moyasar ← الإعدادات ← Webhooks خلال 30
   دقيقة من وصوله، أي قبل <t2>. لا يرسل Moyasar أي أحداث إلى الويب هوك قبل إدخاله.»
7. «بادئة المفتاح (sk_test_)»
8. «رمز الويب هوك السري (test)»
9. «سُجّلت هذه المحاولة عبر مزوّد دفع لم يعد مستخدماً. تُعرض للاطلاع فقط ولا يمكن
   إعادة التحقق منها.»
10. «إعادة التحقق من الدفع عبر Moyasar»
11. «الدفع الإلكتروني عبر Moyasar. لا يُرسل الطلب الإلكتروني إلى الكاشير حتى يتم
    التحقق من دفعه.»
12. «فعّل Moyasar وحوّله إلى الوضع المباشر أولاً — يُرفض دفع العملاء في الوضع
    التجريبي.»
13. «الدفع / Moyasar» — the payment label in Operations Health and Operations
    Alerts. The alert emails the database renders carry it only after
    `20261003120000` is applied (§47.3).

Admin-facing, on the sandbox return page (`payment-admin-test-return`, live after
§47.4): «اكتمل اختبار الدفع» and its two sentences.

Staff-facing, in `docs/STAFF_MANUAL.md` §3 (a document, not the product): the
paragraph that replaced «مزود الدفع النهائي لم يُعتمد بعد…», naming Moyasar and the
duplicate-payment record.

The lines in 1 to 12 are listed in the console sources
(`src/components/admin/MoyasarPaymentPanel.tsx`, `view/orders/PaymentDetails.tsx`,
`SettingsPanel.tsx`); a line wrapped above is one line there.

**Widened 2026-11-12 — one cart line** (`apps/mobile/src/i18n/strings.ts`, key
`cartLineUnavailable`), shown under a cart line whose product, size or option the
menu no longer offers at all. Engineering-drafted; ships with the next EAS build:

- `cartLineUnavailable` — «لم يعد ضمن القائمة. احذفه للمتابعة.» — English: *"No
  longer on the menu. Remove it to continue."*

It is deliberately not the "sold out" wording beside it (`soldOutNow`): a sold-out
item comes back by itself, and this one has been withdrawn. Check that «ضمن
القائمة» reads as "on the menu" rather than "in the list".

**Widened 2026-11-12 — the accessibility pass (R07).** One new visible string and
one new spoken composition, both engineering-drafted:

- **Console sign-in footer**, `authSecuredBy` in `src/components/ops/opsStrings.ts`
  (staff-facing, live on merge): «محمي عبر Supabase Auth · صلاحيات حسب الدور» —
  English: *"Secured by Supabase Auth · role-based access"*. Until now the footer
  was English in both languages.
- **The menu card's spoken name**, heard only with VoiceOver or TalkBack on, for an
  item that opens its options: the product name, a comma, then the price as
  `priceAccessibilityLabel` already speaks it — for example «وجبة برجر, من 14.00
  ريال سعودي». Nothing new is translated; what to check is whether the Latin comma
  and the order read naturally, or whether «،» belongs there
  (`apps/mobile/src/design-system/ui/productCardA11y.ts`).

## 36. ~~Two live promo codes~~ — BOTH DEACTIVATED 2026-09-10 (closed)

> **CLOSED on explicit owner approval ("deactivate both promo codes"), 2026-09-10.**
> Both rows are now `is_active = false`. **Deactivated, not deleted** — the rows
> and their history survive, so the decision is reversible.
>
> **It is proven, not assumed.** `validate_coupon` is `STABLE`, so it was called
> read-only against each code afterwards: both return `valid = false`, discount
> **0**, reason **"Coupon is inactive"**. Checking the flag alone would have
> proved only that a column changed.
>
> **The gate was confirmed BEFORE the write, too.** `validate_coupon` has exactly
> one overload and its body carries `if not c.is_active then` — so the flag is
> load-bearing. Had it not been, setting it would have been theatre.
>
> **Nothing else moved, measured:** 2 coupon rows before and after, `usage_count`
> still **0** on both, **72** orders unchanged with **0** carrying any discount,
> and the money-path pair identical (`place_order` `e54caa33…`,
> `compute_order_snapshot` `ca276a84…`). `validate_coupon` itself is unchanged
> (`01c64516…`) — this was a data change, not a schema or function change, which
> is why it is **not** a migration.
>
> **The codes were guessable, and that is the part worth remembering.** Both were
> ordinary brand-and-number strings of the kind a customer would try on spec —
> seeded on 2026-07-08, the day the project was created, never edited and never
> redeemed. An unbounded discount is bad; an unbounded *guessable* discount is a
> different order of problem. They are recorded here by id prefix (`e367b35f`
> percentage 15%, `e6f1227a` fixed 10 SAR) rather than by code.
>
> **The screen that was missing now exists**, added the same day: **Finance →
> Promo Codes**. Re-enabling, bounding or adding a code is no longer a database
> write. It renders each way a code is unbounded as its own badge, prices a
> draft before it is saved, refuses to delete a redeemed code, and holds a
> percentage to 0-100 — a ceiling the column itself does not have. Detail:
> `docs/DISCOUNTS_CAMPAIGNS.md`.

### The original item, kept for its reasoning

**Opened 2026-09-10.** The sharpest finding of the go-live re-verification, and
the only one that costs money per order rather than a review cycle.

`public.coupons` holds **2 rows, both active**. Verified live:

| Property | Both rows |
| --- | --- |
| `starts_at` / `ends_at` | **null** — never expire |
| `usage_limit` | **null** — no ceiling |
| `min_order_amount` | **0** — no minimum spend |
| `max_discount_amount` | **null** — no cap |
| Shape | one **percentage 15%**, one **fixed 10 SAR** |
| `usage_count` | **0** — nothing redeemed yet |

The customer surface is **unconditional**: `CheckoutScreen.tsx` renders the
"Promo code" section with no gate, so the field is on every checkout on both
channels today. **And there is no admin screen for coupons** — the only admin
file that mentions them is `ReportsPanel.tsx`. Switching them off is a direct
database write, which is why this is yours.

**Nothing has been redeemed, so the exposure is entirely forward-looking.** The
decision is one of:

1. **Deactivate both** — the safe default if they are leftover test data.
2. **Keep them and bound them** — set `ends_at`, `usage_limit` and
   `max_discount_amount` deliberately, so a code cannot be shared publicly and
   drain margin indefinitely.
3. **Keep as-is knowingly** — coherent only if you intend an open, permanent
   discount and have priced it.

I can write the migration for whichever you pick, and can build the admin screen
`coupons` has never had. Applying it is a separate §5 approval.

### On completion

Update `docs/GO_LIVE_READINESS.md` G8 and `docs/DISCOUNTS_CAMPAIGNS.md`, and say
which of the three options was chosen and why.

## 37. One Production hygiene item from the same pass (the other was withdrawn)

**~~`latency-probe` has no source in the repository.~~ WITHDRAWN — see §23,
which already answered this and is the reason this paragraph is kept rather than
deleted.** §23 is a **closed owner decision to KEEP** the slug, taken 2026-09-03
on live evidence: the deployed body returns **HTTP 410 with a fixed JSON string
— no database call, no secret, no outbound request** — and it has **0
invocations**. Re-verified today: **0 cron jobs and 0 database functions**
reference it.

**The mistake is recorded because §23 predicted it in as many words:** *"What
must not happen is that it is treated as an unexplained orphan and investigated
from scratch."* That is precisely what happened — a re-verification pass found
the slug, confirmed the facts, and inferred an outstanding action that had been
closed a week earlier. The facts were verified; the **interpretation** was not,
and the answer was in the same file being edited. **Before recording a finding
against a live artifact, search the decision register for its name.**

**The live admin console offers Moyasar as a selectable payment provider**, with
a full credential form — the deployed `AdminDashboard` chunk ships
`providerOptions:["tap","moyasar"]`. Selecting it is inert today (the migration
is unapplied, no function is deployed), but §6 says choosing the provider is a
deliberate owner action and the console currently presents it as a dropdown.
Worth a guard rather than a redesign.

**Changed 2026-11-11, on the branch `feat/moyasar-only-20261111`:** the card now
offers `['moyasar']` only, and a stored provider other than `moyasar` opens and
saves as `moyasar`. The owner chose Moyasar the same day, so the dropdown
question is settled. The deployed console changes on merge.

## 38. Google Play first release (Android) — the five owner steps

**Status 2026-09-16: the app record exists, one AAB is uploaded to internal
testing, and the declarations are answered. Production is NOT reachable yet, and
the reason is a gate this file never carried — see step 0.**

**This section used to be 461 lines and most of it was reference, not decisions.**
That material now lives in [`PLAY_STORE_SUBMISSION.md`](PLAY_STORE_SUBMISSION.md),
which owns every Play Console answer, the Data Safety table, the artefact
verification, the reviewer path and the listing inventory. What stays here is
what this file is for: the actions that need a Google identity, a payment method
or an owner decision. Read that document first; come back here for the steps.

### Step 0 — the gate, added 2026-09-16

**The developer account is personal, so Production cannot be published on
demand.** Google requires a **closed** test with **12 testers opted in for 14
continuous days**, then an application for production access that Google reviews.
**Internal testing does not count**, and internal testing is the only track this
app has. The closed track is inactive, so the clock has not started — the floor
from here is about three weeks.

Accounts created before 13 November 2023 are exempt. **Check the account creation
date first**: if it predates that, this step does not apply and the rest of the
list is the whole job. Detail, and the `eas.json` consequence:
[`PLAY_STORE_SUBMISSION.md`](PLAY_STORE_SUBMISSION.md) §2.

### The five steps, and where they stand

1. **Google Play Console developer account** — **DONE.**
2. **Create the app record** for `sa.com.spicymeal.app` — **DONE.** The package
   name is now permanent, which is what closed C6.
3. **Upload the first AAB by hand, in Play Console** — **DONE**, `v1.0.0`
   versionCode 2, on the internal-testing track. It could not be automated and
   still cannot be for a first release; the reasoning is in
   [`PLAY_STORE_SUBMISSION.md`](PLAY_STORE_SUBMISSION.md) §14.
4. **The Auth test-OTP number** (§27 steps 1-3), pasted into App content → App
   access — **DONE, and the mechanism is now proven rather than assumed.** The
   open question about whether the hosted feature bypasses a custom Send SMS Hook
   is settled: it does. Evidence in
   [`PLAY_STORE_SUBMISSION.md`](PLAY_STORE_SUBMISSION.md) §4a.
5. **Create a Google Cloud service account, grant it Play Developer API access,
   download the JSON key, and upload it to EAS** — **OPEN, and now MEASURED
   rather than predicted.** On 2026-09-21 a submission of Android versionCode 4
   to the internal track was attempted and refused at the credential step:

   ```
   Looking up credentials configuration for sa.com.spicymeal.app...
   Google Service Account Keys cannot be set up in --non-interactive mode.
       Error: submit command failed.
   ```

   **So `eas submit -p android` cannot run at all today** — not merely "every
   release after the first is attended". The AAB exists and is uploadable by hand
   in Play Console; nothing automated can place it there.

   `eas credentials --platform android`, or a path in `eas.json`. **Do not commit
   the key itself** (§9) — and note that this one genuinely cannot pass through
   an agent session: it is a private key, and the only safe handling is for it to
   go from Google Cloud straight to EAS.

**That prerequisite is now satisfied, and the ordering it warned about was
already reversed.** §34's map-processor correction is published as `privacy_policy`
v2.3 and confirmed on the public no-JavaScript page — the artifact Play
cross-checks the Data Safety form against. The form was completed *before* the
correction rather than after, so for a window the declared precise-location
handling contradicted the published policy; it no longer does, and nothing in the
form needs revisiting. **§39 is a separate, smaller defect in the same document
and does not block the listing.**

**Still open beyond step 5:** the closed test in step 0, the feature graphic, the
descriptions, the app category and the final app name
([`GO_LIVE_READINESS.md`](GO_LIVE_READINESS.md) G4).

### What I can do once step 5 lands

Every release after the first: run the submit, watch the upload, report the Play
processing result. The listing text is already drafted in both languages
([`store/LISTING_COPY.md`](store/LISTING_COPY.md)). **The first upload was
yours**, and the production application will be too.

## 39. ~~Privacy policy — the body's own effective date said 8 September~~ — CORRECTED 2026-09-16

**Opened and closed on 2026-09-16**, by closing §34. One statement, both
languages, on explicit owner approval ("fix the date and merge 387").

**The defect.** `legal_documents.effective_date` for `privacy_policy` was
`2026-09-16` and the page rendered `v2.3 · 2026-09-16`, while the first line of
`content_en` read `Effective date: 8 September 2026` and of `content_ar`
`تاريخ السريان: ٨ سبتمبر ٢٠٢٦`. Two dates, one document, and the earlier one
claimed the Google-and-Apple map disclosure was in force a week before it was
written.

**It was the only one of the nine active documents with this mismatch**, measured
live rather than assumed — the other eight agreed, and all nine agree now.

**Why it existed.** v2.2 and v2.3 were each published by replacing exactly one
line and hashing the rest of the document, masked at that line, to prove nothing
else moved. That invariant is correct for a wording fix. For a version bump whose
effective date moves, it actively protects the stale copy of the date — because
the in-body date line is one of the bytes it certifies as unchanged.

**No version bump.** v2.3's *substance* was correct and already published; this
made the document say what its own metadata had said since publication. Bumping
would have implied a substantive change and made a fourth version in one day.

### What was done, in the order it has to be done

**1. Dry run.** The replacement was computed in a `select`, line 1 was dropped
from both the old and the new text, and the remainder hashed on each side:
identical in both languages (EN `a831b0be…`, AR `e4a7efd5…`). Total length grew by
exactly **one character** per language, which is what one digit added by one
replacement looks like.

**2. The write**, guarded on the exact pre-image hashes so it could not apply to a
row that had moved since the dry run:

```sql
update public.legal_documents
   set content_en = replace(content_en, 'Effective date: 8 September 2026',
                                        'Effective date: 16 September 2026'),
       content_ar = replace(content_ar, 'تاريخ السريان: ٨ سبتمبر ٢٠٢٦',
                                        'تاريخ السريان: ١٦ سبتمبر ٢٠٢٦')
 where document_type = 'privacy_policy' and is_active and version = '2.3'
   and md5(content_en) = 'd513a4d84ebb4d261cce2ae104c814f5'
   and md5(content_ar) = '84bf31e100317414a1a7c5819ab85536';
```

One row. The post-write hashes matched the values pre-computed from the dry run —
EN `d3e760c5dc2823e6115003d23bcc0798` / 4 623 chars, AR
`d2acff9656d3afa072feddb76947d226` / 3 744 — so the stored text is the text that
was reviewed, not something retyped into it.

**3. Nothing else moved, and the evidence is a timestamp rather than a count.**
Only `privacy_policy.updated_at` changed (08:39:10 UTC); the other eight rows
still carry their original stamps, back to 18 August.

**4. THE REBUILD — the step the first draft of this section left out.** Review
caught it on #387, and it was right to: the procedure ended at the write, which is
the exact two-step failure §34 exists to record. The no-JavaScript snapshot is
baked into `legal.html` during `vite build`, so a store's policy checker keeps
serving the old line until the site is rebuilt.

It was proven **before** merging rather than hoped for afterwards: the real
production build was run locally against the live row, and the prerendered
`dist/legal.html` — the exact artifact Vercel serves — carried
`v2.3 · 2026-09-16` / `Effective date: 16 September 2026` /
`تاريخ السريان: ١٦ سبتمبر ٢٠٢٦`, with Mapbox still at zero occurrences. Merging
#387 then ran that same build against Production, and the public page was
re-fetched to confirm it.

**Generalise it rather than just fixing it.** Both rules are now in
[`LEGAL_DOCUMENTS_AUDIT.md`](LEGAL_DOCUMENTS_AUDIT.md) §Method, which is where
somebody editing these documents will actually look:

- a dated document keeps its date in **two** places and only one of them is a
  column — move both, and take the "nothing else changed" hash *around* the date
  line rather than over it;
- publishing is **two steps**, the write and then a rebuild, because the artifact
  a store reads is baked at build time.

---

## 40. Per-size closing — the apply order, the switch, and an Arabic read

Four migrations make it possible for a branch to close **one price tier** —
"Large is out, Regular is not" — instead of taking the whole item off the menu.
Three are server work; the fourth is the switch that decides when cashiers see
the buttons.

**§40 IS NOT COMPLETE, AND AN EARLIER DRAFT OF THIS SECTION SAID IT WAS.**
The four migrations were applied 2026-09-17 and the switch was flipped 2026-09-20
07:47:05 UTC, so the mechanism is live. **What has NOT been demonstrated is the
customer-facing half.**

**Where the evidence actually stands**, from the owner's own report on 2026-09-20
and from the live audit trail:

| surface | status | evidence |
| --- | --- | --- |
| customer app greys the closed size | ✅ | owner, 2026-09-20, on build 25 |
| admin push arrives | ✅ | owner, and 8 `admin_push_outbox` rows, newest 2026-09-20 08:00 |
| branch console headline | ❌ then FIXED, **not re-tested** | reported wrong 2026-09-20; fixed by #408 the same day |
| call-centre board | ❌ then FIXED, **not re-tested** | reported wrong 2026-09-20; fixed by #408 the same day |
| **checkout refuses by name** | **NEVER TESTED** | no evidence of any kind |
| every size closed ⇒ item unorderable | **NEVER TESTED** | no evidence of any kind |

**THE CHECKOUT ROW IS THE ONE THAT MATTERS AND IT IS STILL OPEN.** It is the
entire reason builds 25, 26 and 27 exist. It has been asserted from the code and
never observed.

**HOW THIS SECTION CAME TO CLAIM OTHERWISE IS WORTH MORE THAN THE CORRECTION.**
On 2026-09-21 the owner installed build 27 and said "all works". A draft of this
section read that as covering a six-row test proposed in chat and wrote the whole
table as verified fact. **The live audit trail refutes it: ZERO writes on
2026-09-21** — no `branch_variant_availability` change (newest is 2026-09-20
08:31), no `admin_push_outbox` row (newest 2026-09-20 08:00), no order (newest
2026-09-16). Closing a size writes a row; none was written; so no size was
closed. The most likely referent of "all works" is the category-chip fixes, which
leave no trace at all — and which were the first thing the chat message asked
about.

**The rule, stated because this repository keeps paying for it: a short
affirmation does not inherit the scope of the question that preceded it.** Ask
which surfaces were exercised, or read the trail. An agreement is not a
measurement.

**What is left.** Close a size on build 27 and check the four untested rows. The
two console surfaces need re-testing because they were broken when last observed;
checkout and the all-sizes-closed case have never been observed at all. 40.4 (a
native Arabic read of five console strings) remains optional and blocks nothing.

**THE PRECONDITION IN 40.3 IS NOT DISCHARGED, AND A DRAFT OF THIS SECTION SAID
IT WAS FOR iOS.** The precondition is that **every device that can order** carries
the customer half — not that one does. Review caught the overstatement, and the
live inventory settles it: `push_devices` holds **5 active iOS devices belonging
to 5 distinct customers, last seen 2026-09-16**. Build 25, the first to carry the
customer half, was not produced until 2026-09-20. **So four devices besides the
owner's are on a build that predates it**, and a real closure would give each of
them the generic payment-step error.

One device having the fix is evidence about that device. The precondition is
about the set.

**What would actually discharge it:** confirm each of the five customers is on
build 25 or later, or accept that a closure exposes the others. The device rows
carry no app-version column, so this cannot be read from the database — it needs
either a TestFlight tester-by-tester check or a deliberate decision that the four
dormant accounts do not matter. **Neither has been done.**

**Android is the same shape, one step earlier.** versionCode 4 (`9db239ed`)
carries both the customer half and the chip fixes, but no Android device has ever
registered a push token, so nothing is exposed there today — and that is a fact
about there being no Android users at all, not about readiness.

### 40.1 Apply the four migrations, in order, each named by version — DONE 2026-09-17

Each was its own §5 action, applied on explicit approval in dependency order,
**one call per file, each verified before the next was sent**. Full record:
`docs/MIGRATIONS.md` §48, and ledger rows 97-100.

| order | file | live version | what applying it did |
| --- | --- | --- | --- |
| 1 | `20260923120000_branch_variant_availability` | `20260917122329` | created the table, the two RPCs and the sweeper arm. Closed nothing — the table is still **empty**. |
| 2 | `20260924120000_place_order_variant_availability` | `20260917123545` | **MONEY PATH** — both order functions now refuse a closed tier. Their hashes moved, which was the intended effect; the new pair is `12b6816d…` / `22e2d429…`. |
| 3 | `20260925120000_health_card_variant_coverage` | `20260917124256` | the health card and the overdue-restore alert now know the new table exists. Called live afterwards: `branch_availability` reads `healthy`. |
| 4 | `20260926120000_variant_closing_flag` | `20260917124937` | added `app_settings.variant_closing_enabled`, **defaulting FALSE**. The live value was read back as `false`. |

**Applying all four closed no size and changed nothing a customer sees, and that
was measured rather than assumed:** `branch_variant_availability` held 0 rows,
`variant_closing_enabled` was false, and orders were unchanged at 76. **Those are
the figures AT THE APPLY**; the switch was turned on separately on 2026-09-20 —
see 40.3.

**THE FLAG IS A UI GATE, NOT A SERVER INTERLOCK — an earlier version of this
section said "nobody can write a closure until step 40.3", and that was false.**
Review caught it on #396 and it was verified live rather than argued:
`set_variant_snooze` and `clear_variant_snooze` are granted to `authenticated`
and authorize on `is_admin() or is_branch_operator(branch)` **without consulting
`variant_closing_enabled` at all**. So an admin or branch operator who calls the
RPC directly — outside the console, with their own token — can create a closure
before the build ships, and an old app would then show that generic payment-step
error.

What the flag actually buys is that **the console offers no way to do it**, and
the console is the only client that calls those RPCs. The sequencing therefore
holds for anyone working normally, which is the realistic risk it was written to
manage. It does not hold against a deliberate hand-made call. If you want the
ordering to be a guarantee rather than a convention, the fix is to make the two
RPCs consult the flag — a further migration, not a setting change; say so and it
can be written.

### 40.2 Ship an EAS build carrying the customer half — ✅ BUILT AND SUBMITTED 2026-09-20

**Both binaries are built from `b7868e2`**, the merged head carrying the customer
half: iOS **1.0.0 (25)** and Android **versionCode 3**. iOS was submitted to
TestFlight the same day — the upload completed 07:19:28 and EAS reported ERRORED
anyway. **That is INTERMITTENT, not expected**: builds 26 and 27 both submitted
cleanly, so the tally is 2 of 4 and a future `ERRORED` must be investigated
rather than waved through (`docs/APP_STORE_SUBMISSION.md` §3a, corrected
2026-09-21 — an earlier version of this sentence said "the expected behaviour of
that path", which is exactly the dismissal the correction exists to prevent).
What survives unchanged: an `ERRORED` status does not mean the upload failed, so
read the log before resubmitting.

**Superseded by later builds.** iOS is now on **1.0.0 (27)** (commit `0969b1f8`,
carrying the category-chip fixes as well) and the Android artifact is
**versionCode 4** (commit `9db239ed`, with the SDK patch drift resolved).

The reason the ordering exists, unchanged: the customer app **without** this half
does not know a size can be closed. A closed tier passes every client-side check,
including the pre-submit re-read that exists so a customer never meets a raw
server refusal; `place_order` then refuses, and the app shows a **generic error
at the payment step** on a cart that looked fine. The build greys out a closed
size, blocks the item when every size is closed, and names the reason.

**"Until that build is live with customers" needed a sharper unit, and review
supplied the push on #406.** There are no public customers to roll out to: the
app is **not publicly distributed on either store** — Play is internal testing
only, iOS is TestFlight internal only. Measured live 2026-09-20: **6 distinct
people have ever placed an order, 3 of them in the last 30 days** (40 orders in
30 days, 76 all time). So the real precondition is a checkable list of testers,
not an adoption curve — and it binds **before a branch closes a size for real**,
which is when exposure actually starts, rather than before the flag is flipped.
**Re-measure before relying on this: the moment either store goes to a public
track, the bound stops holding.**

### 40.3 Turn the switch on — ✅ DONE 2026-09-20 07:47:05 UTC

**Flipped on explicit owner approval ("flip the flag"), one statement, one row.**
`app_settings.variant_closing_enabled` is now **true**, so the branch console
shows a **Close** button beside each size and the message *"Closing a single size
is not available yet"* is gone.

```
update public.app_settings set variant_closing_enabled = true where id is true;
```

**The write was verified rather than assumed, before and after.** `id is true`
was confirmed to match **exactly one** row before sending, so the predicate could
not sweep more than intended. After: the flag reads `true`, and **nothing else
moved** — `branch_variant_availability` still **0** rows, orders still **76**,
147 variants (144 active) unchanged, and the money-path pair identical on both
sides (`place_order` `12b6816d256c29b76edf947ae1a7ea77`,
`compute_order_snapshot` `22e2d42935459e7bf93abb2941b56325`).

**The console's read was performed, not merely permitted.** Checking
`has_column_privilege` answers a different question from whether the read
succeeds — the distinction ledger row 96 exists for — so the select was run under
both client roles and both returned `true`: `anon` yes, `authenticated` yes. The
console authenticates, so this is the value it now sees.

**FLIPPING IT EXPOSED NOBODY, and that is a property of there being no closures
rather than of the flag.** With `branch_variant_availability` at 0 rows, no
client behaves differently whatever the flag says. The flag gates the CONSOLE,
not the API. **Exposure begins when a branch actually closes a size** — so the
precondition that still binds is that every device which can order is on build 25
or later BEFORE a size is closed for real, not before this flip. Bound measured
the same day: the app is not publicly distributed on either store, and **6
distinct people have ever ordered, 3 of them in the last 30 days**. Re-measure
before relying on that — it stops holding the moment either store goes to a
public track.

It is reversible: set it back to false and the Close buttons disappear again.

**Server-side enforcement does not depend on it.** The flag hides a control; it
does not soften the rule. A tier closed while the flag was on stays refused by
`place_order`, and stays greyed out in the customer app, after the flag is
switched off.

**Switching it back off is therefore safe, and you do not have to reopen
anything first.** The gate is on CREATING a closure and nothing else: an
existing closed size keeps its `Closed` pill, keeps counting toward the "every
size closed" warning and the tile's **Partly closed** badge, keeps its row in the
closed-sizes card, and keeps its **Reopen** button. An earlier draft of this
section told you to reopen everything before switching off, which was
documentation compensating for a UI defect — review caught it on #395, and the
console was fixed instead.

### 40.4 A native Arabic read — engineering-drafted copy, not reviewed

Five new Arabic strings reached the branch console and the staff manual without a
native speaker reading them. They are stated here rather than assumed adequate,
the same way `docs/OWNER_ACTIONS.md` §26 records the delivery `ready` push copy.

| where | Arabic |
| --- | --- |
| console, closed-sizes card heading | «الأحجام الموقوفة» |
| console, close dialog title | «إيقاف الحجم مؤقتاً» |
| console, close dialog hint | «سيعود الحجم تلقائياً عند انتهاء المدة.» |
| console, sheet warning | «كل الأحجام موقوفة — لا يمكن للعميل طلب هذا الصنف.» |
| customer app, blocked item | «جميع الأحجام غير متوفرة في هذا الفرع حالياً.» |

`docs/STAFF_MANUAL.md` §4 also gained an Arabic paragraph describing the new
buttons. None of this is customer-facing money copy, so it is not blocking — but
it is the copy a cashier reads during a rush.

---

## 41. Admin push notifications — the steps that turn it on

You asked on 2026-09-18 to be told on your phone when a branch closes an item, a
size or delivery. The code is written. Behaviour, design and evidence:
`docs/ADMIN_PUSH_NOTIFICATIONS.md`.

**Progress: 41.1-41.6 are ALL DONE (2026-09-20). THE FEATURE IS LIVE AND
DELIVERING.** The owner re-added the Home Screen icon, tapped the bell, and
notifications arrive. Measured the same day: **1 subscription, 7 outbox rows,
all 7 `sent`** — real closure notices delivered to a real phone, not just the
confirmation tap.

**That tap also answered the one thing no probe could reach:** the two halves of
the VAPID key pair MATCH. `assertVapidKeyPair` runs only inside the deployed
function after the caller gate, so every external probe stopped at 401; a
successful delivery is the proof, and it is now in hand.

Only 41.7 (two optional post-checks) and 41.8 (the kill switch, for if you ever
want it off) remain, and neither is required.

**Two caveats carried forward, both recorded in
`docs/ADMIN_PUSH_NOTIFICATIONS.md`:** the deployed function bundle is
functionally identical to commit `38c50f7` but NOT byte-identical (comments
stripped in transport), and the applied migration text likewise had comments
outside function bodies trimmed — though all ten stored function bodies were
verified byte-identical against pre-computed hashes.

**THE STEPS BELOW ARE A RECORD, NOT A TO-DO LIST.** Every one of 41.1-41.6 has
been performed; they are kept because how each was done, and what went wrong on
the way, is worth more than the instruction was. Each was its own §5 action at
the time — approval for one was never approval for the next.

### The order mattered, and this is why — kept as history

**41.6 had to come last**, and the reason survives the feature being finished
because it governs any future re-install. iOS fixes an installed web app's
capabilities at install time, so an icon re-added while the VAPID key was still
missing would have installed an app that *can* receive push but has nothing to
subscribe to — and it would have had to be deleted and re-added again. **If the
icon is ever removed and restored, the bell must be re-enabled afterwards**; the
subscription belongs to the install, not to the account.

### 41.1 Apply `20260927120000_admin_push_subscriptions` — ✅ DONE 2026-09-20

**Applied 05:04:34 UTC on explicit owner approval ("apply 20260927120000"), live
version `20260920050434`, ledger row 101.** History moved 145 → 146. It created
one empty table, one nullable `app_settings` column and three
`is_admin()`-gated RPCs; the money-path pair is unmoved (`12b6816d…` /
`22e2d429…`) and the file asserted that itself.

**Applying it subscribed nobody and could send nothing — measured at the time,
and both figures have since moved:** `admin_push_subscriptions` held 0 rows and
`app_settings.admin_push_vapid_public_key` was NULL, which is exactly what 41.2
and 41.3 then supplied. All three RPCs were called and refused at their gate
(`42501`), `anon` cannot execute any of them and `authenticated` can, and
`push_devices` is untouched at 5 customer rows.

**The first attempt, on 2026-09-19, was REFUSED by the file's own assertion**
(`anon can execute save_admin_push_subscription(…)`), nothing landed, and the
file was corrected in PR #400 before this apply. Detail: `docs/MIGRATIONS.md`
§49.

### 41.2 Generate the VAPID key pair — ✅ DONE 2026-09-20

```
node scripts/generate-vapid-keys.mjs
```

It prints two values and where each goes. **It writes nothing** — not to the
repository, not to the database, not to Supabase.

**The private key goes to exactly one place: the Edge Function secret store.**
Not the repository, not `app_settings`, not a pull request, not a chat message
you would not delete (CLAUDE.md §9). The public key is public by design — it
identifies the sender and cannot sign anything — so it is safe in the database
where every client can read it.

This cannot be done the way the alert-dispatch trigger secret was (§28, generated
inside Postgres so it never crossed the wire). That works because Postgres both
makes the secret and performs the HMAC. Signing a VAPID token is ECDSA on P-256,
which `pgcrypto` cannot do, so the function must hold the key and the key must be
created somewhere. Keeping it to one place is the achievable version.

**HOW IT WAS ACTUALLY DONE, 2026-09-20 — recorded because the command above was
not the method used, and will not be the method next time either.** You have no
terminal, so `node scripts/generate-vapid-keys.mjs` was never runnable for you.
The key pair was generated in the **browser console** of the installed console,
which has the same Web Crypto primitives the script uses:

```js
const p = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'}, true, ['sign','verify']);
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const pub = b64(await crypto.subtle.exportKey('raw', p.publicKey));
const {d: priv} = await crypto.subtle.exportKey('jwk', p.privateKey);
console.log('ADMIN_PUSH_VAPID_PUBLIC_KEY=' + pub);
console.log('ADMIN_PUSH_VAPID_PRIVATE_KEY=' + priv);
```

It prints the same two lines the script prints, in the same format, and it
writes nothing anywhere. **The private line goes straight from that console into
the Edge Function secret store and nowhere else** — in particular not into this
chat, which is the one place it would be trivially recoverable afterwards. Only
the public half was ever pasted into the conversation, and that is safe by
design.

**The first attempt was discarded rather than used, and that is the part worth
carrying.** An earlier key pair was generated and its public half shared before
the private half had been captured; the private half was then gone. Writing that
public key into `app_settings` would have bound every future subscription to a
key nothing could sign — every send refused 403, with the console showing a
healthy subscription. It was discarded and the pair regenerated. **A VAPID
public key is only usable if you still hold the private half that made it.**

### 41.3 Store the two secrets and the public key — ✅ DONE 2026-09-20

In the Supabase dashboard, **Edge Functions → Secrets**, add both lines the
script printed:

```
ADMIN_PUSH_VAPID_PUBLIC_KEY=…
ADMIN_PUSH_VAPID_PRIVATE_KEY=…
```

Optionally also `ADMIN_PUSH_VAPID_SUBJECT` — a `mailto:` or `https:` contact for
the push service operators. Left unset it is `https://app.spicymeal.com.sa`,
which is valid.

Then the **public** key into the database, which is a live write and therefore
its own action:

```sql
update public.app_settings
   set admin_push_vapid_public_key = '<the public key>'
 where id is true;
```

**The two must match.** The browser binds a subscription to the key it was given,
so if the table advertises one key and the function signs with another, every
send is refused with a 403. The sender checks this itself and answers
`misconfigured` rather than sending — but it is cheaper to paste the same value
twice than to debug it.

### 41.4 Deploy `admin-push-dispatch` — ✅ DONE 2026-09-20

`verify_jwt = false` (it is already in `supabase/config.toml`), because the
service-role path carries no user JWT and the function's own caller check is the
gate — role **and** AAL2 for an admin, exact key match for the service role.

**Deploying it sends nothing.** With no key configured it answers
`not_configured`; with a key and nobody subscribed, `no_subscriptions`.

**Deploy it AFTER 41.1, not before.** It reads `admin_push_subscriptions` and
`app_settings.admin_push_vapid_public_key`, neither of which exists until that
migration applies — so a deploy that lands first answers 500 on every call. It
breaks nothing else (no other function or client touches this path), but it
wastes a round trip and looks like a fault in the code rather than the order.

### 41.5 Apply `20260928120000_admin_push_closure_notifications` — ✅ DONE 2026-09-20

The piece that turns a real branch closure into a notification. It hangs off
`branch_availability_events` and `branch_delivery_events`, which already record
every closure, so **no closure RPC is modified** — nothing about how a branch
takes an item off the menu changes, and the file's own verification fails the
apply if any of the five closure RPCs has gone missing or learned about this
feature.

**Applying it sends nothing and notifies nobody.** It creates one empty queue,
one `app_settings` column and a cron job that finds nothing to do. It also
creates its own HMAC trigger secret, generated inside Postgres so the value
never crosses the wire, and copies the project URL from the alert dispatcher's
Vault secret.

**It implies the deploy in 41.4** — `admin-push-dispatch` gained a queue-drain
mode in the same change. Applying this without that deploy leaves notices
queueing and expiring after two hours; deploying without applying leaves the
function with nothing to claim. Neither breaks anything and neither sends, so
the order between 41.4 and 41.5 does not matter — only that both happen.

Detail: `docs/MIGRATIONS.md` §50.

### 41.6 Delete the Home Screen icon and re-add it — ✅ DONE 2026-09-20, IT WORKS

The console is already on your Home Screen as **تقفيل المنتجات**, and it was added
before any of this existed. iOS will not grant that entry push capability
retroactively. Delete it, open `app.spicymeal.com.sa` in Safari, and add it to
the Home Screen again.

Then open it and tap the bell in the header. You should get **one notification
within a few seconds** confirming notifications are on. If it does not arrive,
one of 41.2-41.4 is incomplete — the subscription itself will still have been
stored, so the control showing "on" is not evidence that sending works.

### 41.7 Two things to check afterwards, and what each tells you

**Did the project URL copy?** The migration copies it from
`operations_alert_dispatch_project_url`. If that secret was ever renamed the
copy silently does not happen, and the driver then holds every notice with the
reason written onto the row:

```sql
select name from vault.secrets where name like 'admin_push_%';
-- expect BOTH admin_push_dispatch_secret and admin_push_dispatch_project_url
```

If the URL is missing, add it. The value is the ordinary project URL, not a
secret in any real sense:

```sql
select vault.create_secret(
  new_secret      => 'https://<project-ref>.supabase.co',
  new_name        => 'admin_push_dispatch_project_url',
  new_description => 'Supabase project URL used by invoke_admin_push_dispatch.'
);
```

**Is anything stuck?** One query answers it:

```sql
select status, count(*), max(last_error)
  from public.admin_push_outbox group by status;
```

`pending` rows carrying a `last_error` about configuration mean the driver is
running and cannot reach the sender. `skipped` means they expired before it
could. An empty table means nothing has been closed since the apply.

### 41.8 If it becomes noisy

```sql
update public.app_settings set admin_push_enabled = false where id is true;
```

That stops the queueing and the sending immediately, without deleting anybody's
subscription or undeploying anything; setting it back to `true` resumes.
Notifications are one per event with no batching, by your decision on
2026-09-18 — if the volume is the problem rather than the feature, batching
belongs in the sender and can be added without touching the triggers.

---

---

## 42. Supabase API keys — move off the legacy `anon` / `service_role` keys before end-2026

**Open, and dated by Supabase rather than by us.** The legacy keys "keep working
until the end of 2026"; deletion is "Late 2026, TBC". The installed customer
app and the admin console carry the legacy `anon` key, and Edge Functions use
the legacy `service_role` key, so doing nothing means the app, the console and
every scheduled job stop working on a date Supabase picks.

The code is ready to move without an outage (`docs/SUPABASE_API_KEYS.md` §2):
it prefers the new keys once they exist and falls back to the legacy ones until
then, and receivers accept both. **The steps, in this order, each a separate
§5 action** — full detail and the verification for each in
`docs/SUPABASE_API_KEYS.md` §3:

1. Merge the functions PR (inert until step 2).
2. Create the publishable and secret keys in the dashboard (additive). Then run
   the read-only signed-out check in `docs/SUPABASE_API_KEYS.md` §4. **Steps 5
   and 6 wait until it passes**, because the app's login screen depends on it.
3. Deploy the receivers: `push-dispatch`, `admin-push-dispatch`,
   `operations-alert-dispatch`, `account-delete-process`.
4. Deploy the senders: `lazywait-sync`, `account-delete-request`,
   `account-delete-scheduler`, `order-intake`, then the rest.
5. After the console PR (#420) and the mobile PR (#421): Vercel env
   (Production and Preview) + gated redeploy. Set **both**
   `VITE_SUPABASE_PUBLISHABLE_KEY` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`;
   the second is what the `/app` web export reads.
6. Add the key to `apps/mobile/eas.json` (small PR), then the **December** EAS
   build pair, to every tester.
7. Confirm no legacy-key traffic remains.
8. Verify `online_payment_enabled = false`, then deactivate the legacy keys
   (reversible). **The five frozen payment functions stop working here — owner
   decision 2026-11-09**, acceptable only while online payment is off.
   **Changed 2026-11-11:** this describes the July Tap-era bundles. Five of the
   seven Moyasar-only functions build their clients with `adminClient()` /
   `userClient()`, which prefer the new keys, so the deploy in §47.4 moves them.
   `_shared/paymentSync.ts:25` still reads `SUPABASE_ANON_KEY` directly. Read
   `SUPABASE_API_KEYS.md` §2 before step 8 if online payment is on by then.
9. A cleanup PR removes the fallbacks.

**Rollback:** reactivate the legacy keys; no redeploy needed.

## 43. Privacy policy — device location is used for more than the delivery pin

**Opened 2026-11-10.** `privacy_policy` v2.3 says the device location is used
*"only while you are choosing a delivery point on the map"*. The app also uses
it on the pickup tab, to list the nearest branches, and at checkout, to warn
when the delivery pin is far from the customer. Neither of those sends the
location anywhere, and both are in the app customers already have. So this is a
disclosure gap that applies now, not something the next build introduces.

The exact replacement text in both languages, the evidence, and the publishing
steps are in `docs/legal/PRIVACY_POLICY_LOCATION_USES_CORRECTION.md`. Publishing
means editing a live `legal_documents` row, which is a §5 action: copy-paste in
the admin console, bump to **v2.4**, set the effective date.

**The English can go first.** The Arabic is engineering-drafted and joins §35.
A correct English disclosure beside an unchanged Arabic one is better than both
incomplete.

**Done looks like:** v2.4 active in both languages, the public `/privacy` page
showing the new line, and this section marked closed with the date.

## 44. PDPL — what the law requires, read against SDAIA's texts, and what only you or counsel can settle

**Opened 2026-11-10.** Every item below was read against SDAIA's published texts
that day: the PDPL, its Implementing Regulation (IR), the Transfer Regulation and
the Register Rules. The full addresses are in `docs/RECORD_OF_PROCESSING.md`
(Sources). The Arabic texts govern. **None of this is legal advice.** It is what
the texts say, so that counsel's time goes on judgement rather than on finding
the rules.

### For you, now — no counsel needed

1. **Register the controller on SDAIA's National Data Governance Platform.**
   Whether registration is *required* depends on criteria (item 4 below). But
   the breach-notification e-service will not accept a filing without a valid
   registration certificate, so an unregistered controller cannot meet the
   72-hour rule through it (`INCIDENT_RESPONSE.md` §10b).
2. **Name the breach notifier and a deputy** in `INCIDENT_RESPONSE.md` §10b.
3. **Decide three retention periods** (`RECORD_OF_PROCESSING.md`, Findings):
   - sign-in send records (`whatsapp_message_logs`), which today are kept until
     the account is deleted, with no time limit;
   - inactive push device records. Turning notifications off stops sending but
     keeps the token until the account is deleted;
   - the figure behind "the period required by tax and accounting law" for
     orders.

   Each period then needs a small sweep, which is a migration and a §5 apply.

### For counsel

4. **Registration and a data protection officer.**
   - **Registration** (Register Rules Art 2) is required of public entities,
     controllers whose main activity is based on processing personal data,
     controllers of sensitive data, and individuals processing beyond personal
     use.
   - **A DPO** (IR Art 32) is required where core activities involve regular and
     systematic monitoring of data subjects, or are based on sensitive data.
     SDAIA's DPO Rules list "location tracking" as an example of monitoring. The
     app takes a delivery pin per order, and location only while the app is open
     (activity 5 in the record). A free-text allergy note could be health data.
   - Counsel decides whether either applies. SDAIA offers a DPO guiding tool on
     the platform.
5. **A transfer basis for every recipient outside the Kingdom** (PDPL Art 29;
   Transfer Regulation Arts 2–7, as replaced by Resolution 1840, 1 Sep 2024):
   - **No adequacy list has been published**, so Germany has no adequacy finding.
   - The safeguards are SDAIA's standard contractual clauses (v1.0, used
     unedited — an edited copy is "not recognized"), binding common rules, or an
     accreditation certificate.
   - A **risk assessment is required before** a transfer under Art 4.
   - **The open question:** which Art 4(2) case covers *ongoing* cloud hosting
     for a controller that is not part of a multinational group. The "service to
     the data subject" case names only an accreditation certificate, and the
     time-limited case does not fit ongoing hosting.
   - The privacy policy today says only *"we rely on the data protection
     commitments in our contract with that provider"*.
6. **Marketing consent — the most consequential item here.**
   - **What the texts say:**
     - PDPL Art 25 allows advertising to a person's own means of communication
       only with *"the prior consent of the targeted recipient"*, plus a clear
       way to stop;
     - IR Art 11 requires consent to be documented with time and means, and *"a
       separate consent shall be obtained for each Processing purpose"*;
     - IR Arts 28–29 require evidence of consent, and an opt-out as easy as
       opting in.
   - **What the app does:** offers are opt-out — on when notifications are
     granted (CLAUDE.md §7). #425 now *tells* the customer before the OS prompt,
     but one tap still grants two purposes, order updates and offers, and nothing
     records it.
   - **Against that wording:** an offers channel switched on by default without a
     marketing-specific consent step does not match it. IR 28(1)'s "prior
     interaction" exception has no counterpart in PDPL Art 25 or IR Art 29, and
     both 2025–26 drafts narrow or remove it.
   - **The engineering options, smallest first:**
     - (a) keep opt-out as an accepted risk;
     - (b) put a separate "occasional offers" choice on the consent screen and
       register with the customer's answer;
     - (c) (b) plus the consent ledger proposed in
       `docs/decisions/0002-consent-ledger.md`, which is what "documented" asks
       for.

     Moving to opt-in is the one-line revert CLAUDE.md §7 already records
     (`promosEnabled: false`). Doing it properly is (c).
   - **Any change to who receives offers is a §7 owner decision** (2026-08-20,
     re-confirmed 2026-11-09). This item asks you to revisit it with counsel, not
     assume the answer.
7. **The record of processing.** PDPL Art 31 and IR Art 33 require it to be
   written, kept current, available to SDAIA on request, and kept for five years
   after the processing ends. `docs/RECORD_OF_PROCESSING.md` is the engineering
   draft. Its lawful-basis column is engineering's reading.

### Two drafts to watch, neither of them law at the time of writing

- **SDAIA's October 2026 consultation on the Implementing Regulation** (6 October
  to 5 November 2026, confirmed by Umm Al-Qura) proposes, among other changes:
  - **an express duty to store personal data within the Kingdom** (Art 23);
  - 72-hour breach notice for **every** breach, not only harmful ones;
  - a registration trigger for controllers that transfer data abroad.

  It takes effect 60 days after publication if adopted. The first change would
  make item 5 a migration rather than a contract.
- **The April 2025 draft** carries similar registration triggers. The content of
  both drafts is from published law-firm summaries and SDAIA's consultation page;
  the October draft's own text could not be read.

**Done looks like:** items 1–3 performed, items 4–7 answered by counsel in
writing, with each answer reflected in `RECORD_OF_PROCESSING.md` and
`GO_LIVE_READINESS.md` §A, and this section closed with the date.

## 45. Store deadlines, November 2026 to April 2027 — the console steps

**Opened 2026-11-10.** These are answers you give in Play Console and App Store
Connect; none of them is code. The answers are drafted in the store records, and
each was checked against Google's or Apple's own page on 2026-11-10. (§43 and §44
are taken by the PDPL work in an open pull request.)

| By | Step | Where the answers are |
| --- | --- | --- |
| **Now** | **Play: declare trader status.** *"Starting in November 2026, you must declare your trader status in Play Console."* | `PLAY_STORE_SUBMISSION.md` §16 |
| **Now** | **App Store Connect: answer DSA trader status.** Apple's upcoming-requirements page records that apps without it are removed from the EU storefront | — |
| **Before the first App Review submission** | **Search the App Store Connect email for `ITMS-91061` and `ITMS-91065`** against builds 24–27. Two SDKs in the app are on Apple's privacy-manifest list | `APP_STORE_SUBMISSION.md` §5 |
| **12 January 2027** (and on any update from 16 November 2026) | **App Store Connect: the two new age-rating descriptors.** Dating and Relationships: No. **Shared Location is your call**, with No recommended | `APP_STORE_SUBMISSION.md` §10 |
| **27 January 2027** (30-day self-extension available) | **Play: the precise-location declaration**, two questions | `PLAY_STORE_SUBMISSION.md` §16 |
| **1 February 2027** | **Play, App bundle explorer: read 16 KB support** on the uploaded bundle. Updates that fail cannot be released after this date | `PLAY_STORE_SUBMISSION.md` §16 |
| **February 2027** | **Play, App bundle explorer: read the DEX size.** The DEX rule applies above 10 MB | `GO_LIVE_READINESS.md` C11 |
| **February 2027, once in production** | **Play, Android vitals → Memory.** The new memory thresholds apply to every app, with no size floor, and are judged on real users' devices | `PLAY_STORE_SUBMISSION.md` §16 |
| **When convenient** | **Decide tablets:** Android 16 shows the app full-width in landscape on screens of 600 dp and wider | `PLAY_STORE_SUBMISSION.md` §13 |
| **When convenient** | **Decide App Store availability.** Limiting it to Saudi Arabia removes Brazil's A16 consequence of answering Shared Location "Yes" | `APP_STORE_SUBMISSION.md` §10 |

**Done looks like:** each step done, with the date written back into the record it
points at, and the matching `GO_LIVE_READINESS.md` row — B8, B10, C9 to C13 —
moved off ⬜.

## 46. Addresses an admin can store — one secret and three redeploys

**Opened 2026-11-11.** Three Edge Functions connect to an address an
administrator stored, and each now checks it more strictly **in the
repository**. `email-test-config` validates the SMTP endpoint (it checked
nothing before) and no longer shows the connection error's text.
`admin-push-dispatch` admits only the four browser push services and no
explicit port. The shared SMTP guard requires a mail port. **None of this runs
until each function is redeployed.** Behaviour and evidence:
`docs/OPERATIONS_ALERTS_DIGEST.md` ("What the SMTP guard cannot see") and
`docs/ADMIN_PUSH_NOTIFICATIONS.md` ("A public hostname was not enough").

Each step is its own §5 action. Approval for one is not approval for the next.

1. **Redeploy `email-test-config`.** The live relay passes the new guard.
   Measured read-only on 2026-11-11, by counts only: the one email-provider row
   is enabled, uses a mail port, and has a host that passes the lexical rules.
   **Done looks like:** the console's "Send test email" to
   your own address arrives. If it shows a code in parentheses instead, the
   sentence before the code says which setting to change.
2. **Redeploy `admin-push-dispatch`.** The live subscription passes the new
   rule, measured the same way: 1 subscription, on the list, no explicit port.
   **Done looks like:** the bell's test notification still arrives on your
   phone. If `docs/SUPABASE_API_KEYS.md` step 3 has not been done yet, one
   deploy of this function covers both changes.
3. **Before alert mail is turned on: set `SMTP_ALLOWED_HOSTS`** as an Edge
   Function secret, to the relay's name, which is `mail.spicymeal.com.sa` today.
   It is the only rule that refuses a public name that resolves into private
   space. Secrets are project-wide, so it pins the test button as well.
   **Done looks like:** "Send test email" still arrives.
4. **Before alert mail is turned on: redeploy `operations-alert-dispatch`.**
   LIVE VERIFY first, in the dashboard, which version runs. The only recorded
   deploy is v1 (2026-09-07 07:18:43 UTC). Its five-file bundle predates the
   SMTP guard, which merged on 2026-09-14, so if v1 is what runs, the
   dispatcher checks nothing and ignores step 3. Redeploying is harmless while
   dispatch is off, because the handler returns `disabled` before it reads the
   endpoint. If `docs/SUPABASE_API_KEYS.md` step 3 is still pending, one deploy
   covers both.
5. Then §28 step 4, which turns alert mail on.

**What this does not touch:** customer push (`push-dispatch`, `CLAUDE.md` §7)
is a different function on a different channel and is unchanged. There is no
migration and no data change.

**Done looks like:** steps 1 to 4 done, with the date of each written here and
in the two documents above.

## 47. Moyasar go-live — the owner steps, in order

**Opened 2026-11-12.** On 2026-11-11 the owner decided that Moyasar is the
payment provider (CLAUDE.md §6). The branch `feat/moyasar-only-20261111` makes
Moyasar the only provider in the code, the tests and the documents. **Merging it
changes nothing a customer can do**: online payment is off, and every payment
function in Production is still a July Tap-era bundle. (§46 is the admin-address guards,
#442.)

The runbook behind these steps, with the detail of each, is `PAYMENTS.md`; this
section is the owner's checklist. **Every numbered step below is its own
CLAUDE.md §5 approval**, named when it is due. Approval for one step is not
approval for the next. **None of them had been done on 2026-11-12.** Where a step needs a secret, the value goes into the
console or the Supabase dashboard, never into a chat.

**Live state, read-only, 2026-11-11:**

- `app_settings.online_payment_enabled` is **false** since 10:56 UTC. An admin
  had switched it on that morning with Moyasar in TEST mode; the owner switched
  it off;
- the payment row (`integration_settings`, `provider_type = 'payment'`) is
  provider `moyasar`, **enabled**, mode `test`, with a test publishable key.
  Tap's `merchant_id`, `source_id` and `transaction_expiry_minutes` are still in
  its `public_config`;
- `20260824100000` is unapplied, so `begin_payment_attempt`,
  `begin_session_attempt` and `payment_records.provider_checkout_ref` do not
  exist;
- `payment_records` holds only `tap` rows: 6 failed, 3 initiated and expired,
  0 paid. `order_refunds` is empty;
- the `payment-refund-worker` cron job is inactive. `refund_trigger_secret` is
  not in Vault. **Whether it is in the payment row's `secret_config` is not
  settled here:** `BACKUP_RECOVERY.md` §4.3 lists that key name on the row on
  2026-11-11 (names only), while the Moyasar work's notes say it must be
  generated. 47.16 checks before it writes.

### The order is not a preference

Each step either refuses to run out of order or breaks something if it does.
The apply/deploy order is enforced in three places: the migrations refuse
(`20261003120000` before `20260824100000`, `20261004120000` before
`20261003120000`), the deploy workflow prints the order, and
`deployFunctionsWiring.test.ts` fails if the guidance drops a step.

### 47.1 Merge the pull request

**Done looks like:** the merge commit is on `claude/project-build-ie4b56`.

What a merge does by itself, because the console and `/app` deploy on merge
(`DEPLOY.md` §9):

- the console's Integrations → Payments panel says **"Deploy the Moyasar payment
  functions first."** It hides the July function's key readings, which describe
  Tap's keys, and disables Test connection. That is expected until 47.4;
- Settings → Payment Methods lets Online Payment be switched **on** only while the
  payment row is enabled, names Moyasar and is in live mode. Switching it off is
  always allowed. **This guards the console control, not the setting:**
  `set_payment_settings` checks `is_admin()` alone, so a direct call can still
  turn it on;
- the web build (`/app`) never offers online payment, whatever the setting says;
- old Tap payment records on an order's receipt are shown read-only, with a note
  that the provider is no longer used.

### 47.2 Apply `20260824100000_moyasar_payment_provider`, by version

Its sha256 is
`4c0123c91969ee10bc52b2f5221597bb516fc7fabe7f904d3e8b88215e93ef5e` (274 lines /
14 529 bytes). Re-hash the merged copy before sending (CLAUDE.md §15).

**This file used to be the frozen one.** It is now step 1 of the apply order,
and it still sorts ahead of every outstanding file, so **name it by version and
never apply "whatever is outstanding"** (CLAUDE.md §8).

**Done looks like, read-only:**

```sql
select count(*) from supabase_migrations.schema_migrations
 where name = 'moyasar_payment_provider';                      -- 1
select proname from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('begin_payment_attempt', 'begin_session_attempt');  -- 2 rows
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'payment_records'
   and column_name = 'provider_checkout_ref';                  -- 1 row
```

### 47.3 Apply `20261003120000_moyasar_only_payments`, by version

Fingerprint and the expected post-apply hashes: `MIGRATIONS.md` §55. Re-hash the
merged copy first. It refuses to apply before 47.2.

What it changes once applied:

- `begin_session_attempt` gets the loyalty multi-spend guard, so a customer
  cannot pay two live sessions with the same points;
- both attempt functions refuse a total under 1.00 SAR, Moyasar's invoice
  minimum;
- `begin_session_attempt` refuses a checkout session with a line of more than
  50 of one item, before any payment, matching the cash cap;
- `confirm_order_payment` refuses, under the order's row lock, a payment for an
  order another payment has already paid;
- the refund driver runs only for a `moyasar` row, and the refund ledger falls
  back to `moyasar` instead of `tap`;
- the Operations Health payment card's "configured" test follows Moyasar's
  rules, and staff alerts read **Payment / Moyasar** and **الدفع / Moyasar**.

**The money path is untouched**, and the file asserts it: `place_order`
`12b6816d…`, `compute_order_snapshot` `22e2d429…`.

**Done looks like:** one history row named `moyasar_only_payments`, and the
function hashes in `MIGRATIONS.md` §55 read back read-only.

### 47.4 Deploy the seven payment functions, as one set

`payment-initiate`, `payment-verify`, `payment-webhook`, `payment-return`,
`payment-refund`, `payment-test-config` and `payment-admin-test-return`, together
(`DEPLOY.md` §12). **Only after 47.2 and 47.3.** Without 47.3 the session flow
opens payments with no loyalty multi-spend guard, and only `payment-initiate`'s
own check enforces the 1.00 SAR minimum.

A new payment bundle beside an older one can open a Moyasar invoice that nothing
confirms, so deploy all seven in one run.

**Done looks like, read-only** (Supabase dashboard or `list_edge_functions`):

- all seven show a new version deployed today;
- `verify_jwt` is **false** on `payment-webhook`, `payment-return`,
  `payment-refund` and `payment-admin-test-return`, and **true** on the other
  three, matching `supabase/config.toml`;
- the console's Moyasar panel no longer says "Deploy the Moyasar payment
  functions first."

This deploy also makes `payment-test-config`'s AAL2 admin gate live, which closes
the exception recorded in `GO_LIVE_READINESS.md` D3. Customer checkout stays
refused while the row is in TEST mode: `payment-initiate` answers
`{status:'disabled', reason:'test_mode'}`.

### 47.5 Apply `20261004120000_drop_tap_payment_rpcs`, by version — after 47.4

Fingerprint: `MIGRATIONS.md` §56. **Only after 47.4**: the July
`payment-initiate` still calls both functions on its Tap branch. It refuses to
apply before 47.3.

**Done looks like:** `select count(*) from pg_proc where proname like
'tap_begin_%'` returns 0.

### 47.6 Delete the old `tap-admin-test-return` function

A deletion is a destructive Production action. Do it only after 47.4, because
the new `payment-test-config` points its sandbox return at
`payment-admin-test-return`.

**Done looks like:** the function list has no `tap-admin-test-return`.

### 47.7 Enter the TEST keys and the TEST webhook token in the console

Admin → Integrations → Payments (the Moyasar card): the test secret key, the
test publishable key, and a test webhook secret token you choose. The token is
the value you will also type into Moyasar in 47.8.

**Done looks like:** the Moyasar panel's readiness rows read OK for "Key for
mode (test)", "Key prefix (sk_test_)" and "Webhook secret (test)", and **Test
connection** answers "Connection OK".

**A badge that can mislead:** the card's per-field "configured" badge reads the
whole row, and Tap's July keys are still in `secret_config`. So every Moyasar
secret field can read "configured" while empty. Trust the panel's readiness
rows, not the badge.

### 47.8 Register the TEST webhook in Moyasar, then enter its code within 30 minutes

**Only after 47.4 and 47.7.** The July `payment-webhook` answers Moyasar's
one-time verification event with 200 and records nothing, and Moyasar never
sends it again. Without the token saved, the new function refuses it (401).
Either way the code is lost and a new one must be requested.

1. Moyasar Dashboard → Settings → Webhooks, in test mode. URL:
   `https://wxfmmnihidsdyemasstf.supabase.co/functions/v1/payment-webhook`.
   Secret token: the value from 47.7.
2. Moyasar sends one `webhook_verification` event. The console's Moyasar panel
   shows the six-digit code for 30 minutes, with the time it arrived and the
   deadline.
3. Enter the code in Moyasar within 30 minutes. Five wrong entries lock it.
   Moyasar delivers no event to the webhook before it is verified.

If the code is missed, request a new one in Moyasar.

**Done looks like:** Moyasar shows the webhook as verified.

The code lands in `integration_sync_logs`, which an admin or an accountant,
signed in at AAL2, can read (`is_staff()`). Branch and call-centre staff cannot.
It is short-lived and useful only with access to the Moyasar dashboard.

### 47.9 The sandbox test, from the console

The sandbox is the console's admin test, **not** a customer order. Customer
checkout is refused in TEST mode by design, so a test card can never pay for a
real order.

1. Moyasar panel → run the sandbox checkout. It opens an isolated **1.00 SAR**
   TEST invoice, linked to no order, in a browser tab.
2. Pay with Moyasar's test cards: mada `4201320111111010`; Visa
   `4111111111111111` (3-D Secure challenge) or `4111114005765430`
   (frictionless); Mastercard `5421080101000000`. For a decline, mada
   `4201320000311101`.
3. Read the result back in the panel.

**Done looks like:** an approved card reads paid, the decline card reads failed,
and no order changed. Also check that the hosted page shows Arabic with
`lang=ar`; that parameter is undocumented.

**What this does NOT test:** the app's payment WebView, Apple Pay, or the return
to the app. Apple Pay in Moyasar's sandbox succeeds only for 200.00-300.00 SAR,
and this invoice is 1.00 SAR. Those are covered by 47.18.

### 47.10 Choose the static-IP proxy service

Moyasar refuses live secret-key calls from any address that is not on its
**Allowed IPs** list (Dashboard → Settings → API Keys). Supabase Edge Functions
have no fixed outbound address. The owner chose a static-IP outbound proxy
service on 2026-11-11.

**You need from the service:** its URL (`http://` or `https://`, with
`user:pass@` if it uses credentials) and **every** outbound IP it can use.
Prefer an `https://` proxy URL where the service offers one: the proxy's own
credentials travel in clear to an `http://` proxy. With an `https://` target the
proxy only tunnels, so it never sees the Moyasar key.

**Unknown, and it matters:** the code uses `Deno.createHttpClient` with a proxy.
Supabase's documentation does not mention it. Support comes from the
edge-runtime source (1.68.0 and later). If the hosted runtime lacks it, every
Moyasar call is refused with `moyasar_proxy_unsupported` once the secret is set,
TEST included. The live Test connection in 47.13 is the proof.

### 47.11 Set `MOYASAR_PROXY_URL` as an Edge Function secret

Supabase dashboard → Edge Functions → Secrets. **Never paste it into a chat.**

- `HTTPS_PROXY` does **not** work as a function secret: the runtime reads that
  from the process environment, and function secrets are per-worker values;
- an unusable value (another scheme, a value that does not parse) refuses
  **every** Moyasar call, TEST included, before anything is sent;
- set it after the sandbox test (47.9), so a bad value cannot be mistaken for a
  sandbox failure, and before 47.13. Any later sandbox run goes through the
  proxy too.

**Done looks like:** the secret name is listed. The value cannot be read back,
and does not need to be.

### 47.12 List the proxy's IPs in Moyasar's Allowed IPs

Moyasar Dashboard → Settings → API Keys → Allowed IPs. Live needs at least one
address, and the live key stays hidden until one is listed. Saving asks for a
6-digit code.

**Done looks like:** every outbound IP from 47.10 is listed. Proven only by
47.13.

### 47.13 Switch to live and enter the LIVE keys and webhook

1. In the Moyasar card, switch the mode to **live**. The console asks for
   confirmation.
2. Save the live secret key, the live publishable key and a live webhook token.
3. Register the live webhook in Moyasar's live mode, as in 47.8, and enter its
   code within 30 minutes.
4. Run **Test connection** in LIVE mode.

**Done looks like:** "Connection OK". That proves the proxy route (47.11) and the
Allowed IPs list (47.12). A refusal names whether the proxy or the server's own
address was refused.

### 47.14 Make sure the payment row is enabled

It was already enabled on 2026-11-11. The console's Online Payment switch opens
only when the row is enabled, names Moyasar and is in live mode. It does not
check that the live keys are saved; 47.13's Test connection is that check.

### 47.15 Update the customer documents, before customers can pay by card

Each is a live write, and each must land **before** 47.18:

- **`privacy_policy`**: name Moyasar as the payment processor
  (`RECORD_OF_PROCESSING.md` activity 15);
- **`payment_policy`** and **`cancellation_refund_policy`**: on 2026-09-03 both
  said payment is cash, that no online provider is selected, and that refunds are
  settled in cash at the branch (`GO_LIVE_READINESS.md` G5). Both promise to be
  updated before an online option appears. This was not in the brief that
  produced this section; it is here because the documents say so;
- the store answers: App Store "Financial Info" (`APP_STORE_SUBMISSION.md` §4)
  and Play "Payment info" (`PLAY_STORE_SUBMISSION.md` §6) need your re-decision;
  the cash-only listing claim C-CASH (`store/LISTING_COPY.md`) must change; and
  the App Review notes must stop saying card payment is off
  (`APP_STORE_SUBMISSION.md` §11).

### 47.16 Make sure `refund_trigger_secret` exists, and re-enable the refund job

**Only after 47.3 and 47.4, and before 47.18.** The secret lives in the payment
row's `secret_config`, not in Vault. Both the refund driver and `payment-refund`
read it there, and no migration creates it.

**First check whether it already exists**, by length, never by value:
`select length(secret_config->>'refund_trigger_secret') from
public.integration_settings where provider_type = 'payment'`. A Tap-era value
would work unchanged, because the driver sends it to `payment-refund` and
`payment-refund` compares it with the same field. If it is null, generate it
**inside Postgres**, so the value is never seen, by the same method as §28:

```sql
update public.integration_settings
   set secret_config = coalesce(secret_config, '{}'::jsonb)
       || jsonb_build_object('refund_trigger_secret',
                             encode(extensions.gen_random_bytes(32), 'hex'))
 where provider_type = 'payment'
   and coalesce(btrim(secret_config->>'refund_trigger_secret'), '') = '';
```

Then the same length check returns 64. Saving the payment card later does not
remove it: the save merges secret fields.

Then re-enable the `payment-refund-worker` cron job (every 5 minutes) and watch
one run.

**Done looks like:** `select jobname, active from cron.job where jobname =
'payment-refund-worker'` shows `active = true`, and a run succeeds.

### 47.17 The EAS build that carries the app half

iOS and Android. It ships Apple Pay in the payment WebView, the new WebView
rules, the 1.00 SAR message, the "refunded" handling, the Moyasar footer, the
guard that makes Place order do nothing while a payment run is in flight, and the removal of
`expo-web-browser`.

**Builds already in customers' hands keep their old behaviour.** In LIVE mode
they open Moyasar's page in the system browser, which works but offers no Apple
Pay. They keep a short window in which Place order stays enabled during a "Try
again" payment run.

### 47.18 Turn on online payment, then the small live payment and its refund

**Online payment is one global setting.** There is no per-customer switch in the
code, so the live test happens with online payment offered to every customer.
Pick a quiet hour.

1. Settings → Payment Methods → Online Payment **on**. The console allows it only
   after 47.13 and 47.14.
2. On a real iPhone with a card in Wallet, and on a real Android phone, run the
   device checks in `RELEASE_CHECKLIST.md` §7 "Online payment (Moyasar)": the
   Apple Pay sheet appears inside the payment WebView, a 3-D Secure challenge
   card completes, and the app returns to the order.
3. Make one small live payment for a real order.
4. Refund it, and confirm the money comes back. **Read 47.20 first: cancelling
   the order does not refund it.** The automatic refund runs only for a paid
   order that never reached the POS after the customer's resends. Producing one
   on purpose has to be agreed with you before trying (`PAYMENTS.md` §9 B);
   otherwise refund by hand in the Moyasar dashboard. A refund made there is not
   written back to the order: as far as the code shows, the order still reads
   paid. Note it by hand.

**Done looks like:** the order reads paid, the order reaches the kitchen, the
refund reads refunded in Moyasar, and the card statement shows it (mada 1-3
days, credit cards 7-14 days).

If anything fails, switch Online Payment off. Switching off is always allowed.
It stops new checkout sessions only: a session opened before the switch can
still be resumed and paid until it expires.

### 47.19 Ask Moyasar support

- Is Apple Pay on the hosted invoice supported inside a third-party app's
  WKWebView (`enableApplePay`, no injected scripts)?
- Does `checkout.moyasar.com` honour `lang=ar`?
- Can a 3-D Secure payment still in flight complete after its invoice expires?
- Confirm that SADAD and STC Pay are off for invoices. SADAD leaves an invoice
  `on_hold` for days and cannot be refunded.
- Could the hosted page ever be served from a domain other than `moyasar.com`?
  The server hands the app only `https` on `moyasar.com` or a subdomain, so any
  other domain fails closed.

### 47.20 Decisions the code leaves to you

- **A cancelled paid order is NOT refunded automatically.** The owner's answer on
  2026-11-11 was "automatic via Moyasar". The code enrols an automatic refund in
  one case only: a paid order that never reached the POS after the customer's
  resends (`order_refund_due`, reason `pos_delivery_failed_after_customer_retries`).
  An admin cancelling a paid online order reverses loyalty points and refunds no
  money. Until that changes, refund a cancelled paid order by hand in the Moyasar
  dashboard. Making cancellation refund automatically is a code and migration
  change.
- **A duplicate payment is recorded, not refunded.** If a customer pays twice for
  one order or checkout session, the second payment is recorded as a `failed`
  `payment_records` row with `failure_code = 'duplicate_payment'` and the message
  *"Duplicate payment: the order was already paid. Refund this payment."*, plus
  one `integration_sync_logs` row with `error = 'duplicate_payment'`. It is never
  reported paid. **Nothing alerts on it**: the watchdog's
  `MULTIPLE_SUCCESSFUL_CAPTURES` rule counts paid rows only. Finding and
  refunding one is `PAYMENTS.md` §10.
  Refunding duplicates automatically is a separate decision.
- **A refund refused by Moyasar's Allowed IPs is retried forever.** It is
  released, not failed, and re-claimed every run until the configuration is
  fixed. There is no attempt cap.
- **Should `set_payment_settings` itself refuse online payment** unless the row is
  enabled, Moyasar and live? Today only the console refuses. That would be a
  migration.
- **Tap's leftover keys** in `public_config` and `secret_config` can be removed.
  Nothing reads them. Optional.

**Read the residual risks before 47.18.** The changes and their review record
them, and `PAYMENTS.md` §12 owns the list. The two most likely to reach a
customer: builds already in the field leave Place order enabled during a "Try
again" payment run, so a cash order can sit beside a payable invoice; and a
payment that completes late on an expired invoice, after the customer paid a
newer one, becomes a duplicate to refund by hand.

**Done looks like for this section:** every step above marked with its date and
evidence, `GO_LIVE_READINESS.md` G1 and G2 updated, and §2 closed.

## 48. Server input bounds and customer order limits — three numbers, then one apply

**Opened 2026-11-12.** `20261005120000_server_input_bounds.sql` is written,
validated and NOT applied. Detail: `docs/MIGRATIONS.md` §57. Section 46 is #442's
and 47 is the Moyasar go-live.

It makes the database enforce rules the app already had, adds three refusals to
`place_customer_order`, and lets an administrator's image delete actually
delete. **It changes live ordering behaviour.** Three of its numbers are your
decision. Each is a proposal.

| Decision | Proposed | Live fact, read 2026-11-12 | What it changes |
| --- | --- | --- | --- |
| Most of one item on one order line | **50** | largest real line: **7**; 0 lines over 20 | a line above it is refused by the database, and the app's + button stops there |
| Open orders one customer may hold, placed in the last 24 hours | **5** (`app_settings.order_limit_open`) | most orders by one customer in one clock hour: **5**; orders in the last 30 days: **2** | the next order is refused with *"You already have several orders in progress"* until one is delivered or cancelled, or 24 hours pass |
| Orders one customer may place in one hour | **10** (`app_settings.order_limit_per_hour`) | as above | the next order is refused until the hour has passed |

**And one rule that is also your decision: an order needs a verified phone.**
Every WhatsApp sign-in has one. On 2026-11-12, 5 customer profiles did not:
2 email-confirmed accounts (one placed a 26.00 SAR cash pickup order on
2026-09-26, still `received`), 1 with an unconfirmed email, and 2 with neither.
All 5 would be refused. No staff account has a verified phone, and none has ever
ordered.

**Why the open count looks back only 24 hours.** An order's status moves only
when staff move it in the console. The 2026-09-26 order is still `received`.
Without the window, a customer whose old orders were never closed would be
refused for ever.

**What that means for the two limits together.** Only
`admin_set_order_status` writes `orders.status` (checked on the local chain on
2026-11-12: no other function or Edge Function sets it; the POS webhook writes
`lazywait_status`). So for a customer whose orders staff do not advance, the
rule that actually applies is **5 orders in any rolling 24 hours**. The 5th
order blocks the 6th, so the 10-per-hour limit never gets a chance to bind. The
hourly limit only matters when staff deliver or cancel orders quickly. Decide
the two numbers with that in mind: if branches rarely advance orders in the
console, the open limit is the daily cap.

**What is not covered, on purpose.** The online checkout-session path is frozen
under CLAUDE.md §6, which is why the line cap is a guard in the cash wrapper
and not a table CHECK: a CHECK would also bind the frozen snapshot insert,
which runs after a payment is captured. Before online payment is enabled, the
payment change must refuse a line above the cap before any payment is taken;
that belongs on the payment branch. The phone rule and the limits do not cover online orders
either.

### The steps

1. **Decide the three numbers and the phone rule.** Before merge, a different
   number is a change to the pull request, and it is not one line:
   - **the line cap** is in four places that must agree: the guard in
     `place_customer_order`, the file's own assertion 6.7, the refusal
     message, and `MAX_LINE_QUANTITY` in
     `apps/mobile/src/features/cart/quantityLimit.ts`.
     `quantityLimit.test.ts` fails if the migration and the constant disagree,
     and the suite's CASE 1 tests 50 and 51;
   - **the two order limits** are each a column default and assertion 6.6 in
     the migration, plus the suite's CASES 7, 8 and 11, which count to them.

   After apply, the two order limits are an `app_settings` write instead (a live
   write, §5). The line cap is not a setting: changing it after apply needs a
   new migration.
2. **Merge** the pull request. The console change (sign-in only) ships with the
   web deploy that follows the merge, which today happens on every merge
   (CLAUDE.md §13). The app change ships with the next EAS build.
3. **Apply `20261005120000` by name** (§5). Never "the outstanding migrations":
   the frozen Moyasar file sorts first.
4. **Check afterwards**, read-only: `order_limit_open` 5 and
   `order_limit_per_hour` 10; `place_order` `12b6816d…` and
   `compute_order_snapshot` `22e2d429…` unchanged; Moyasar still absent.
5. **Optional, a separate §5 write:** remove the 2 banner images no banner
   references. Before this apply a delete matched nothing; after it, the console
   delete works.

**Done looks like:** the three numbers confirmed in writing here, the apply
recorded as a ledger row in `docs/MIGRATIONS.md`, and §57 marked APPLIED.

## 49. RLS init-plans, the live board and the order-number year — one apply

**Opened 2026-11-12.** `20261006120000_rls_initplan_live_board_order_year.sql`
is written, validated and NOT applied. Detail: `docs/MIGRATIONS.md` §58.

It makes a customer's My Orders and the staff profiles list fast at volume, and
the console's live board cheap to poll. It also numbers an order placed between
00:00 and 02:59 Riyadh time on 1 January with the new year, not the old one.
**Nobody sees a different row, and the live board shows the same orders.**
There is no number to decide, and nothing to deploy.

### The step

1. **Apply `20261006120000` by name** (§5). Never "the outstanding migrations":
   the Moyasar file `20260824100000` sorts first. It is independent of the
   other outstanding files and can go before or after any of them.
2. **Check afterwards**, read-only: the three policy quals end in
   `OR ( SELECT is_staff() AS is_staff))`, `checkout_sessions_select_own` is
   unchanged, and `place_order` `12b6816d…` and `compute_order_snapshot`
   `22e2d429…` are unchanged.

**Done looks like:** the apply recorded as a ledger row in `docs/MIGRATIONS.md`,
and §58 marked APPLIED.

## 50. Loyalty totals in the console — merge, apply, then merge #456

**DONE 2026-11-13.** #457 merged as `51a652f`; `20261008120000` was applied at
06:38:43 UTC (live version `20261113063843`) and checked as step 2 asks
(`docs/MIGRATIONS.md` ledger row 105); #456 merged as `2974cac`. What is left
of step 3 is the look: open Settings → Loyalty as an admin at AAL2 and confirm
the tiles show numbers and no notice.

**Opened 2026-11-12.** `20261008120000_admin_loyalty_stats.sql` is written,
validated and NOT applied. Detail: `docs/MIGRATIONS.md` §59. *This number may
need renumbering: a parallel pull request also adds an owner-action section.*

Settings → Loyalty used to sum its four tiles in the browser over every
profile, downloaded on every staff sign-in. Past 1 000 customers PostgREST's
row cap made those tiles silently wrong. The tiles now read
`admin_loyalty_stats()`, and the customer ledger is read 50 rows at a time when
the Loyalty section is opened. Who can see the figures does not change: admin
or accountant, at AAL2, as before.

**The ordering matters.** This pull request carries the migration alone, so
merging it changes nothing anyone sees. The console change that reads the new
function is #456, and a merge deploys the console (Vercel's Git integration,
CLAUDE.md §13). If #456 merged first, the four tiles would show "—" until the
apply, a regression from today's numbers. So: **merge this, apply it, and only
then merge #456.**

### The step

1. **Merge this pull request**, then **apply `20261008120000` by name** (§5),
   re-hashing the merged copy first. Never "the outstanding migrations": the
   Moyasar file `20260824100000` sorts first. It is independent of every other
   outstanding file.
2. **Check afterwards**, read-only: one `admin_loyalty_stats()` overload;
   `anon` cannot execute it and `authenticated` can; `place_order`
   `12b6816d…` and `compute_order_snapshot` `22e2d429…` are unchanged.
3. **Then merge #456.** After its deploy, open Settings → Loyalty as an admin
   at AAL2: the tiles show numbers and no notice.

There is no number to decide and no function to deploy.

**Done looks like:** the apply recorded as a ledger row in `docs/MIGRATIONS.md`,
and §59 marked APPLIED.

## 51. Audit trail — one apply, then two deploys, in that order

**Opened 2026-11-12.** `20261007120000_audit_trail.sql` is written, validated
and NOT applied. Detail: `docs/MIGRATIONS.md` §60.

It closes checklist gaps S09#1-3. After it:

- every real `orders.status` change writes a row to `order_status_audit`: old
  and new status, who (`auth.uid()`), their role, and `manual` or `automatic`
  (no signed-in caller). The POS webhook's `lazywait_status` updates write
  nothing, because they do not change `status`;
- every broadcast's `notification_log` row records `sent_by` and `content` (the
  four strings sent);
- staff password resets and deletions, and every insert, update and delete on
  `products`, `product_variants`, `coupons`, `categories` and `app_settings`,
  write a row to `admin_action_audit`. Column names are always recorded; values
  only for prices, flags, limits and ordering. No password is ever recorded.

Both tables are append-only (update, delete and truncate are refused for every
role) and readable only by staff (`order_status_audit`) or admins
(`admin_action_audit`). Nothing prunes them. No customer-visible behaviour
changes, and the money path is asserted unchanged.

### The steps, each its own approval (CLAUDE.md §5)

1. **Merge** the pull request. Nothing reaches Production from the merge alone:
   no web or app code reads the new tables yet.
2. **Apply `20261007120000` by name.** Never "the outstanding migrations": the
   Moyasar file `20260824100000` sorts first. Re-hash the merged copy first
   (§15). From this moment status changes and table edits are audited, even
   before either deploy.
3. **Then deploy `push-dispatch`.** Push is live (CLAUDE.md §7). The only change
   is the broadcast's log row; targeting, copy, the admin gate and every
   response are unchanged. Deployed before step 2, a broadcast still sends and
   still answers `ok`: the log write sees PGRST204, writes the old row without
   sender and content, and logs one line. It never turns a sent broadcast into
   an error, because an admin told it failed may send it again, and a broadcast
   cannot be recalled.
4. **Then deploy `staff-accounts`.** Deployed before step 2, a reset or delete
   still succeeds; the audit call gets PGRST202 and the function logs
   `audit row not written`.
5. **Check afterwards**, read-only: both tables exist with RLS on; the latest
   status change in the console appears in `order_status_audit` with your id
   and `manual`; `place_order` `12b6816d…` and `compute_order_snapshot`
   `22e2d429…` unchanged.

**Done looks like:** the apply recorded as a ledger row in `docs/MIGRATIONS.md`
and §60 marked APPLIED, then both deploys recorded with their versions.

## 52. Expo push access token — set, deploy, confirm, then enable Enhanced Security

**Opened 2026-11-12.** Checklist gap S03#1. Expo's "Enhanced Security for Push
Notifications" is off, so an `ExponentPushToken` works as a bearer credential:
anyone holding one can send any text to that customer's phone through Expo's
public API, appearing as Spicy Meal, with no `notification_log` row and no
offers opt-out filter. `push-dispatch` now sends `Authorization: Bearer
<EXPO_ACCESS_TOKEN>` when that secret is set (`push-dispatch/expoHeaders.ts`).
Until it is set, every request is byte-for-byte what it was.

**The order is not optional.** Push is a live customer channel (CLAUDE.md §7).
Enabling Enhanced Security before a deploy that sends the token makes Expo
refuse **every** push from this project, order updates included.

### The steps, each its own approval (CLAUDE.md §5)

1. **Create an Expo access token** for the project (expo.dev → Account
   settings → Access tokens), scoped as narrowly as Expo allows. Never paste it
   into chat or a file in this repository.
2. **Set `EXPO_ACCESS_TOKEN`** as a Supabase Edge Function secret.
3. **Deploy `push-dispatch`** from the default branch. One deploy can carry this
   and §51's broadcast log, once `20261007120000` is applied.
4. **Confirm a real order-status push arrives** on an opted-in test device. If
   it does not, unset the secret: the function then sends exactly what it did
   before.
5. **Only then enable Enhanced Security** in the Expo dashboard, and confirm a
   second order push still arrives.

**Follow-up, now in progress (§53):** admins at AAL2 can still read raw token
values through `push_devices_admin_select`, while the console only ever needs
counts. `20261010120000` adds an `is_admin()`-gated count RPC; the console
switch and the policy drop follow it, in that order.

**Done looks like:** steps 2-5 recorded with dates and the `push-dispatch`
version, and the readiness record's S03 row closed.

## 53. Lazywait monitor and Push Tools counts — two applies, a merge, then one more apply

**DONE 2026-11-13, all five steps.** #461 merged as `d27916d`;
`20261009120000` and `20261010120000` were applied at 09:02 and 09:03 UTC and
checked as step 3 asks (`docs/MIGRATIONS.md` ledger rows 106-107). #462 merged
as `7a79841`, and the console bundle production serves carries that release and
calls both RPCs. `20261011120000` was then applied at 12:54:40 UTC (row 108):
an AAL2 administrator reads 0 `push_devices` rows, and the counts RPC still
returns 5 devices and 2 opted in, equal to a direct count. **Left for you:**
look at Settings → Integrations and Push Tools once, signed in at AAL2.

**Opened 2026-11-13.** Two follow-ups, in one sequence because they reach the
console together:

- **The Lazywait sync monitor stops receiving customer data.** It reads the
  general staff order feed today, so the 200 rows it fetches on each refresh
  carry customer names, phones, addresses and notes it never shows.
  `20261009120000` adds a sync-columns-only feed (`docs/MIGRATIONS.md` §61).
  It also returns the POS deadline, so an expired order no longer shows a Retry
  button.
- **No admin session can read push tokens.** Push Tools needs two counts, and
  gets them through a policy that also exposes every token. `20261010120000`
  adds a count-only function (§62), and a later file drops the policy.

**The ordering matters, and every step is its own approval (CLAUDE.md §5).**
A merge deploys the console (CLAUDE.md §13), so each function must exist before
the console calls it, and the policy must outlive the console's last use of it.

### The steps

1. **Merge the migration pull request.** Merging it changes nothing anyone
   sees.
2. **Apply `20261009120000` and `20261010120000`, each by name**, re-hashing
   the merged copy first. They are independent; either order works. Never "the
   outstanding migrations": `20260824100000` sorts first.
3. **Check afterwards**, read-only: one overload of each; `anon` cannot execute
   either and `authenticated` can; the money-path pair unchanged.
4. **Merge the console pull request.** After it deploys, Settings →
   Integrations shows the sync table and Push Tools shows its two counts.
5. **Apply `20261011120000` (the policy drop that pull request carries) by
   name**, only after step 4's deploy is live. The file itself refuses to apply
   before `20261010120000`. Then confirm Push Tools still shows its
   counts, and that an admin session reading `push_devices` gets zero rows.

There is no number to decide and no function to deploy.

**Done looks like:** all three applies recorded as ledger rows in
`docs/MIGRATIONS.md`, and §61 and §62 marked APPLIED.

## Owner-action closeout rule

When an item is completed:

1. update the owning operational document with the verified result;
2. remove or mark the item resolved here;
3. include the verification date and evidence source;
4. avoid leaving "currently" statements that depend on an old dashboard snapshot.

This file is a current decision register, not an incident diary.

---
