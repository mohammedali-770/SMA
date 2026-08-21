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
- **changing who a broadcast reaches.** `promos_enabled` defaults FALSE and only the customer can switch it on. Broadcast audience therefore starts at zero and grows only by explicit opt-in. Making marketing opt-out, or widening targeting, is a consent decision (PDPL; Apple and Google both police unsolicited marketing push) and needs a separate owner decision — not a code change made in passing.

### Marketing consent — reaffirmed strictly opt-in (2026-08-19)

`promos_enabled` defaults **FALSE** and only the customer can switch it on. That
is unchanged, and the paragraph above stands.

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
The opt-in count remains a true opt-in count.

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

## Owner-action closeout rule

When an item is completed:

1. update the owning operational document with the verified result;
2. remove or mark the item resolved here;
3. include the verification date and evidence source;
4. avoid leaving "currently" statements that depend on an old dashboard snapshot.

This file is a current decision register, not an incident diary.
