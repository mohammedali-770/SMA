# Backup and Recovery

> **STATUS: UNVERIFIED as of 2026-08-12.** Repository source does not prove that Production has PITR, what the retention window is, or that a restore has ever succeeded.

Do not treat this document as evidence of a working backup. Until the live values and a completed drill are recorded below, the honest statement is: **recovery capability has not been verified.**

## 1. Live facts the owner must record

These are dashboard/production facts and cannot be inferred from Git source.

| Question | Where to verify | Answer | Verified on |
| --- | --- | --- | --- |
| Is PITR enabled for the Production Supabase project? | Supabase backup/database settings | ☐ | |
| Retention window / available restore points | same | ☐ | |
| Are scheduled/daily backups enabled? | same | ☐ | |
| Current Supabase plan | Billing/project settings | ☐ | |
| Is any database backup copied off-platform? | owner/operations | ☐ | |
| Are Storage buckets/assets covered separately? | Supabase Storage / backup plan | ☐ | |
| Who can initiate a restore? | owner/operations | ☐ | |
| Who is secondary if the primary is unavailable? | owner/operations | ☐ | |

Do not hard-code plan-dependent backup capabilities from memory here. Record what the current Supabase dashboard actually provides for this project.

## 2. Recovery objectives to decide

A backup setting is not a recovery plan until the business accepts targets.

- **RPO:** maximum acceptable data loss → ☐
- **RTO:** maximum acceptable time to return to usable service → ☐

Record the final values and owner approval here.

## 3. What Git can and cannot recover

Git contains:

- application/admin source;
- Edge Function source;
- database migration files;
- SQL regression tests;
- deployment/workflow definitions.

Git does **not** contain:

- customer/order/payment/loyalty production data;
- live Auth users/sessions;
- Storage bucket contents unless separately versioned elsewhere;
- current dashboard secrets;
- a full proof of which Edge Function bytes are deployed;
- current cron/manual configuration that lives outside the migration chain.

As of the 2026-08-12 reconciliation, the repository contains **79 migration files** and Production contains **85 migration-history rows**, latest `20260810115029`. All 11 repository migration names added after the Aug 7 snapshot are represented live. See `docs/MIGRATION_RECONCILIATION_20260812.md`.

**Schema source is not a data backup.** Replaying migrations onto an empty project does not restore business data.

## 4. Critical restore safety: payment refund worker

The payment/refund area remains frozen and automated refund processing is intended to stay disabled.

A restore/rebuild must **not** assume that the manually disabled Production cron state is reproduced by the migration chain.

Immediately after creating/restoring a replacement environment, before live traffic or provider access:

```sql
select jobname, schedule, active
from cron.job
where jobname = 'payment-refund-worker';
```

Expected while the payment freeze is active: `active = false`.

If it is active, do not allow the restored environment to process refunds. Correcting live cron state is a Production write and requires the normal explicit approval path.

## 5. Restore drill — not yet recorded

Run the drill against a **disposable project/environment**, never by experimenting on Production.

Suggested sequence:

1. Confirm the backup/restore source you intend to test.
2. Create a disposable Supabase project/environment with no live provider credentials.
3. Restore the selected production backup/restore point.
4. Immediately inspect/disable any cron or integration that could call a real external provider.
5. Verify critical row counts and latest timestamps against a read-only Production snapshot.
6. Verify RLS and privileged function boundaries are still present.
7. Verify Auth/customer access assumptions needed by the app.
8. Verify Storage/assets separately if they are not part of the database restore.
9. Point a local build at the disposable environment and exercise customer/admin read paths.
10. Record the actual elapsed time from restore decision to verified usable environment.
11. Delete the disposable environment when complete.

Do not use real online payment/refund operations as part of this drill while the payment area is frozen.

## 6. Drill record

| Drill date | Backup/restore point | Performed by | Data loss observed (RPO) | Time to usable (RTO) | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| _none recorded_ | | | | | **UNVERIFIED** | |

## 7. Minimum validation after a real disaster restore

Before reopening customer traffic:

- [ ] Production database endpoint/project identity is the intended restored environment.
- [ ] `payment-refund-worker` is disabled while the freeze remains active.
- [ ] No test/scratch provider credentials can reach live providers.
- [ ] Auth/login works for an approved test account.
- [ ] Branch/catalog/product data is present.
- [ ] Order history/latest order timestamp matches the accepted recovery point.
- [ ] Profiles/addresses/loyalty records are present within the accepted RPO.
- [ ] RLS is enabled and staff/customer boundaries behave correctly.
- [ ] Required Edge Functions are deployed from a known reviewed commit.
- [ ] Lazywait/WhatsApp provider configuration is deliberately restored/verified before enabling live traffic.
- [ ] Sentry/monitoring points at the correct environment.
- [ ] Vercel/EAS client env points at the restored Production project only after verification.

## 8. Edge Function recovery

Function source is in Git, but a name-level drift check cannot prove byte-for-byte deployed content.

Recovery should therefore deploy required functions from a **known reviewed production commit**, using the controlled owner-approved deployment workflow. Do not restore by copying an unknown deployed function back into Git.

Payment functions remain frozen and require a separate exception/decision even during recovery unless restoring the last known running state is explicitly approved.

## 9. Documentation ownership

After any backup-setting change or restore drill:

- update this file with the live values/date;
- update `docs/OWNER_ACTIONS.md` so resolved items disappear;
- update `docs/INCIDENT_RESPONSE.md` if roles/channels change;
- update migration-status evidence after any approved migration action.

A backup feature shown in a dashboard is not "ready" until the team has demonstrated that it can restore usable data inside the agreed RPO/RTO.