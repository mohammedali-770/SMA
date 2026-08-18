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

If legal text is still placeholder/incomplete, separate factual product corrections from wording that requires counsel.

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

## Owner-action closeout rule

When an item is completed:

1. update the owning operational document with the verified result;
2. remove or mark the item resolved here;
3. include the verification date and evidence source;
4. avoid leaving "currently" statements that depend on an old dashboard snapshot.

This file is a current decision register, not an incident diary.