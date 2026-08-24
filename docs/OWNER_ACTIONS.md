# Owner Actions — Current Decision Register

> **Updated 2026-08-18.** This file lists work that cannot be completed safely from repository source alone because it needs an owner decision, a live-dashboard check, business/legal input, spending approval, or an explicitly approved production action.

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

  **The other four were checked against this same risk and are clean.** They were
  redeployed with fresh shared helpers on 2026-08-23, so the same question
  applies. `whatsapp-send-otp` — never redeployed, still on its 2026-07-09
  bundle — was read back: its `whatsapp.ts`, `whatsappSend.ts`, `cors.ts`,
  `supabaseClient.ts` and `secrets.ts` are comment-stripped but structurally
  identical to today's, same exports and same rate-limit constants. Those helpers
  had not diverged; the payment helpers are the exception.
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

## Owner-action closeout rule

When an item is completed:

1. update the owning operational document with the verified result;
2. remove or mark the item resolved here;
3. include the verification date and evidence source;
4. avoid leaving "currently" statements that depend on an old dashboard snapshot.

This file is a current decision register, not an incident diary.
