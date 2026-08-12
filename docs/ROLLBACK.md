# Rollback and Mitigation

> **Updated 2026-08-12.** Rollback differs by surface. Use the smallest safe mechanism, preserve auditability, and do not bypass owner/production controls because the word “rollback” sounds safer than “deploy.”

## 1. First identify the failing surface

| Surface | Primary mitigation |
| --- | --- |
| Admin + customer web (`/` and `/app`) | point Vercel Production back to a known reviewed artifact, then revert through a PR |
| Edge Function | redeploy a known reviewed prior source through the controlled owner-approved workflow |
| Native iOS/Android | halt rollout / submit a fixed build; there is no instant JS OTA path in the current architecture |
| Database schema | forward corrective migration or approved data restore; no `down` migration path |
| Live provider/config | use the supported control or separately approved dashboard/provider action |

Before rollback, verify the problem is not a provider outage or dashboard/env change unrelated to the code release.

## 2. Web/admin fast mitigation

Both browser surfaces are one Vercel project/build.

If a newly deployed artifact is clearly responsible:

1. Vercel → Deployments.
2. Select the last **known reviewed good** Production artifact.
3. Use the current Vercel rollback/promote mechanism to repoint Production.
4. Verify the Production alias now serves that artifact/commit.
5. Open a normal revert/fix PR so the production branch returns to the intended source state.

Do not leave Production permanently serving an artifact that differs from the production branch without documenting that emergency state.

### Source revert

Create a fresh branch from the current production branch and revert/fix there. Open a PR; do not push the revert directly to production.

A source revert can be unsafe if the database or provider configuration has already moved forward. Check schema/config compatibility before reverting client code.

## 3. Edge Function rollback

Edge Function rollback is itself a **Production deployment**.

Do not use the old direct CLI pattern from historical docs as the normal response path.

Safe approach:

1. Identify the last reviewed commit whose function behavior is known good.
2. Prepare the intended function source on a fresh branch/PR or, during an explicitly approved emergency, identify the exact prior source to redeploy.
3. Verify `supabase/config.toml` invocation/auth settings for that function.
4. Obtain the required explicit owner approval.
5. Use the controlled deployment workflow with the exact function name(s).
6. Verify behavior and logs/health after deployment.
7. Record the deployed source commit/version as incident evidence.

### Payment functions

Payment/refund functions remain frozen. An incident does **not** automatically authorize changing or redeploying them. Any payment/refund rollback needs a separate explicit exception/decision.

## 4. Native mobile rollback

The current mobile architecture does not provide a general-purpose EAS Update/OTA rollback channel.

For a bad store/native build:

- pause a staged/phased rollout where the store supports it;
- submit an approved fixed build;
- use server-side supported controls only when they are safe for both old and new clients;
- never make a breaking backend change solely to rescue the newest client while older installed versions still exist.

A native dependency/framework crash requires a new compatible native build; a Vercel rollback cannot change an installed iOS/Android binary.

Starting a new EAS/store build requires explicit owner approval.

## 5. Database rollback model

There is no automatic schema rollback/down path.

Production database changes are forward-only:

- never edit an applied migration;
- never run `supabase db push` against production;
- never run `supabase migration repair` to force history alignment;
- create a new corrective migration and apply it only through the approved process.

If the problem is **data loss/corruption**, a corrective DDL migration may not recover data. Follow `BACKUP_RECOVERY.md` and verify actual backup/PITR availability before promising recovery.

`docs/MIGRATIONS.md` contains the migration workflow/history, but its Aug 7 live-count snapshot needs the reconciliation recorded in `OWNER_ACTIONS.md` §12 before those counts are treated as current.

## 6. Configuration rollback

Many incidents are configuration rather than source:

- Vercel env variables;
- integration settings;
- branch/catalog controls;
- provider dashboards;
- scheduled jobs;
- staff roles/MFA;
- EAS secrets/credentials.

Rollback/change only the specific setting you understand and are authorized to change. Record old/new value **without copying secret material**.

Do not use a direct SQL mutation as a generic “fast rollback” when a supported audited path exists.

## 7. Payment/refund safety

While payment work is frozen:

- do not use a payment/refund transaction as a rollback smoke test;
- keep `payment-refund-worker` disabled;
- after any environment restore/rebuild, re-verify its cron state before traffic;
- financial/provider correction is an explicit owner action.

## 8. Verify the rollback/mitigation

Verification must prove the actual affected path, not only that a dashboard became green.

### Web

- Production alias serves the intended artifact/commit.
- `/` and `/app` load the expected distinct applications.
- security headers remain present.
- customer/staff auth reaches the expected role/MFA flow.

### Backend

- affected RPC/function returns expected result;
- RLS/authorization boundary still holds;
- Operations Health / relevant integrity signals do not show a new failure;
- no unexpected provider side effect was triggered.

### Native

- fixed build installs/cold-launches on a physical device;
- native-only path that failed is explicitly re-tested.

### Database

- intended object/data state is verified read-only;
- migration ledger/status docs are updated after any approved live migration action;
- no hidden cron/provider action was activated by a rebuild.

## 9. After the immediate incident

Once customer impact is stopped:

1. bring production source/config back to a documented state;
2. open/finalize the corrective PR if the first action was an artifact-level emergency rollback;
3. document any manual dashboard/provider change;
4. add a regression test/guard when possible;
5. update `INCIDENT_RESPONSE.md` / relevant runbook if the actual recovery path differed from documentation.

## 10. Related docs

- `docs/INCIDENT_RESPONSE.md`
- `docs/DEPLOY.md`
- `docs/BACKUP_RECOVERY.md`
- `docs/MIGRATIONS.md`
- `docs/OWNER_ACTIONS.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/PAYMENT_POSTPONEMENT.md`