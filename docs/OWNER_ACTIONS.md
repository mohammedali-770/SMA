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

## 2. Final payment-provider decision

**Status:** OWNER DECISION — blocking all new payment/refund work.

The final payment gateway has not been selected. Existing Tap/payment/refund source remains provisional and frozen; older Geidea scaffold code also remains in the server tree.

Until the decision is made:

- do not build new payment/refund behavior;
- do not change provider configuration;
- do not deploy/test payment/refund functions as ordinary development work;
- keep automated refund processing disabled;
- do not treat Tap or Geidea as the final architecture in documentation.

When a provider is selected, reopen the area through a separate reviewed plan that addresses provider verification, idempotency/reconciliation, ambiguous refund outcomes and migration/deployment order.

Authoritative decision: `docs/PAYMENT_POSTPONEMENT.md`.

## 3. Backup / PITR / restore capability

**Status:** LIVE VERIFY + OWNER DECISION — still unverified in repository evidence.

The repository does not establish:

- whether Supabase PITR is enabled;
- the actual retention window;
- whether daily/off-platform backups exist;
- who can execute a restore;
- a measured RPO/RTO;
- whether a restore drill has ever succeeded.

Required owner action:

1. Open Supabase backup settings and record the actual current configuration in `docs/BACKUP_RECOVERY.md`.
2. Decide acceptable RPO/RTO.
3. Run the documented restore drill against a disposable project.
4. Record the measured result.

Do not call backup/recovery "ready" until that file contains live evidence.

## 4. Payment-refund worker safety after any environment rebuild

**Status:** LIVE VERIFY when environments are rebuilt/restored.

The source migration chain contains the historical refund scheduler, while the product decision requires automated refund processing to remain disabled.

After any production restore/rebuild/migration replay, verify the live cron state before allowing traffic:

```sql
select jobname, active
from cron.job
where jobname = 'payment-refund-worker';
```

Expected while the payment freeze is active: `active = false`.

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

**Five required, six intended.** The rule expects **five** contexts. The list above names **six**. Which five are configured cannot be read from here: the GitHub tool surface available to an agent session has no branch-protection or ruleset read tool. They are therefore **not recorded here and not guessed at** — §12 exists precisely because dashboard state must not be asserted from source.

**Inference, not established fact.** The likeliest missing context is `Documentation (generated + ownership)`. §14 of this file still records adding that context in **Settings → Rules** as an outstanding owner action, and six intended minus that one is five. **If that inference is correct**, the documentation gate that enforces `docs/ownership.json` — the mechanism behind [`CLAUDE.md`](../CLAUDE.md) §14 — currently runs and reports but does **not** block a merge. This is unconfirmed and cannot be confirmed from source.

**Action needed:** the owner opens **Settings → Rules**, reads the configured required check contexts, and records which five they are. That one reading either confirms or refutes the inference above and closes the five-versus-six discrepancy.

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

The nine in-app legal documents are no longer placeholder text — see §13. What remains for submission is
the **public** privacy-policy URL (the store listing cannot link to an in-app screen) and a counsel review
of the published wording.

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

**Note for CI:** the `payments` ownership rule covers only
`supabase/functions/payment-*`, `tap-*` and the shared payment helpers. A
freeze-touching change in the **mobile** app fires no rule at all, so CI will not
flag the next one. Worth widening the rule if these keep appearing.

**Known issue, cosmetic:** `test` and `broadcast` rows in `notification_log` stay at `send_status = 'processing'` after a successful send, because `push-dispatch` inserts them without a terminal status. Delivery counters on the row are correct and the operations health center already compensates by summing the `failed` device counter instead of trusting the lifecycle column, so nothing is mis-reported as failed. The dashboard's `send_status_counts_24h` will show completed broadcasts as `processing`. Fixing it touches an Edge Function and therefore needs a deployment.

Secrets note: the FCM service-account JSON and the APNs `.p8` live in EAS only. Neither belongs in the repository (§9). `google-services.json` is client-visible config and is safe to commit.

## 11. Sentry production source maps

**Status:** SOURCE/RELEASE HISTORY updated.

The August 11 iOS release-readiness work added `SENTRY_AUTH_TOKEN` to the EAS production environment and aligned the Sentry React Native compatibility line. Do not reintroduce the old documentation claim that the token is simply missing.

For each production release, verify source-map upload through the current Sentry release gates rather than assuming a historical secret still exists/works.

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

**Still outstanding as of 2026-08-24, on inference.** The merge refusal recorded in §5 names
**five** required contexts where the intended list has six, which points at this action not having
been done. That is read off a count, not off the dashboard — see §5 for the evidence and for the
single check that would settle it.

Use the emitted job name exactly as written above. The equivalent mistake has been made before with
the design-system job, whose context is the job ID `design-system` rather than the workflow display
name `Design system`. The authoritative list of emitted contexts is generated at
[`reference/ci-and-scripts.md`](reference/ci-and-scripts.md).

---

## 15. `SUPABASE_ACCESS_TOKEN` — the secret that arms two workflows

**Status:** OWNER DECISION.

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
are frozen on top of that under §6.

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
`lazywait-sync` (v3), each on explicit owner approval; see the closeouts below
the table. What remains is bookkeeping and branch hygiene.

On 2026-08-25 the two variant migrations were applied and the Lazywait catalog
was imported, both on explicit owner approval. The menu is live for the first
time: **55 of 61 products active, 144 of 147 tiers**, prices 1.00–74.00 SAR.
Full record: [`MIGRATIONS.md`](MIGRATIONS.md) §32 and ledger rows 59–60.

| # | Action | Why it is still open |
| --- | --- | --- |
| 1 | Version-align rows 59 and 60 | Live history carries the apply-time stamps `20260825061046` / `20260825061502`, not the repository filenames. §9-D makes realignment a separate live history write with its own approval. Leaving it is legitimate; "repairing" it unasked is not. |
| 2 | Retire or reconcile the 15 remaining duplicate branches | The live branch is mapped (see the closeout below), so this no longer blocks ordering. Fifteen inactive importer-created rows remain, each holding a real `lazywait_branch_id`. They cannot take orders. Left in place deliberately: `branches` is FK-referenced by eleven tables, so deleting rows is destructive and needs its own decision. |

**Closed 2026-08-25 — `lazywait-catalog` redeployed (version 3).** This was the
item with a timer on it: `lazywait_catalog_items.prices` had been rebuilt from
`raw` by SQL rather than written by the parser, so a pull against the old
deployed function would have rewritten all 147 rows with `price_excl_vat: null`,
the importer would have read 0, and every product would have gone inactive at
price 0 — the exact failure that kept the menu empty for months. The deployed
parser now writes that field itself, so a pull converges instead of collapsing.

Verified rather than assumed: the deployed bundle was read back and compared by
SHA-256 against the default branch, and **all six files are byte-identical** —
`lazywait-catalog/index.ts` plus `_shared/cors.ts`, `_shared/supabaseClient.ts`,
`_shared/secrets.ts`, `_shared/lazywait.ts` and `_shared/lazywaitCatalog.ts`.
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

**Not changed, and still open from PR #256:** whether a multi-tier product should
open a picker before it can be added to the cart, and whether its card should
read "from 20.00" rather than a bare "20.00". The cart currently assumes the
**cheapest** tier, so the price charged can never exceed the price displayed —
but assuming a tier at all is a product decision, not an engineering one.

## Owner-action closeout rule

When an item is completed:

1. update the owning operational document with the verified result;
2. remove or mark the item resolved here;
3. include the verification date and evidence source;
4. avoid leaving "currently" statements that depend on an old dashboard snapshot.

This file is a current decision register, not an incident diary.
