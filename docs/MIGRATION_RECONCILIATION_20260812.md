# Production Migration Reconciliation — 2026-08-12

> **Read-only reconciliation.** No migration, history row, schema object, data row, cron job or Edge Function was changed while producing this record.

This note updates the **current counts/status** that were last fully recorded in `docs/MIGRATIONS.md` on 2026-08-07. The long historical ledger remains useful for provenance and the approved workflow, but its Aug 7 headline counts are no longer the latest snapshot.

## Current snapshot

Read-only query against Production Supabase project `spicy-meal-ordering` (`wxfmmnihidsdyemasstf`) on 2026-08-12:

| Measure | Current value |
| --- | ---: |
| Repository migration files | **79** |
| Live `supabase_migrations.schema_migrations` rows | **85** |
| Latest live migration version | **`20260810115029`** |
| Repository migrations added after the Aug 7 ledger snapshot | **11** |
| Aug 10 repository migration names represented in live history | **11 / 11** |
| Additional duplicate live history rows among those 11 names | **4** |

The source count is the Aug 7 reconciled repository count (**68**) plus the **11** migration files added by the merged Aug 10 production-readiness sequence.

The live count is the Aug 7 live-history count (**70**) plus **15** Aug 10 history rows. Those 15 rows represent 11 distinct migration names; four names were recorded twice during corrected/re-applied executions.

## Aug 10 source → live name reconciliation

| Repository migration | Live migration name | Live row count | Live version(s) | Presence |
| --- | --- | ---: | --- | --- |
| `20260810100000_order_status_cancellation_integrity.sql` | `order_status_cancellation_integrity` | 2 | `20260810081954`, `20260810082115` | present |
| `20260810100500_coupon_code_identity_guard.sql` | `coupon_code_identity_guard` | 2 | `20260810082008`, `20260810082128` | present |
| `20260810113000_order_integrity_stranded_orders_health.sql` | `order_integrity_stranded_orders_health` | 2 | `20260810082040`, `20260810082154` | present |
| `20260810113500_stranded_order_alert_and_index.sql` | `stranded_order_alert_and_index` | 2 | `20260810082057`, `20260810082213` | present |
| `20260810120000_account_deletion_manual_review_resolution.sql` | `account_deletion_manual_review_resolution` | 1 | `20260810082234` | present |
| `20260810130000_security_performance_hardening.sql` | `security_performance_hardening` | 1 | `20260810083042` | present |
| `20260810132000_order_modifier_contract.sql` | `order_modifier_contract` | 1 | `20260810102446` | present |
| `20260810140000_staff_role_administration.sql` | `staff_role_administration` | 1 | `20260810104831` | present |
| `20260810141000_staff_access_directory.sql` | `staff_access_directory` | 1 | `20260810110230` | present |
| `20260810142000_staff_mfa_aal2.sql` | `staff_mfa_aal2` | 1 | `20260810111953` | present |
| `20260810143000_remove_anon_role_helper_rpcs.sql` | `remove_anon_role_helper_rpcs` | 1 | `20260810115029` | present |

## What this proves

**Confirmed by read-only Production history:**

- the live migration-history table has 85 rows;
- the latest live version is `20260810115029`;
- all 11 migration names introduced by the Aug 10 source sequence are represented in Production history;
- four of those names have two live history rows instead of one.

Combined with the Aug 7 reconciliation—which already accounted for the earlier 68 repository files / 70 live rows—there is **no repository migration introduced after Aug 7 whose migration name is absent from live Production history**.

Therefore the old Aug 7 statement `Unapplied repository files: 0` is no longer stale in its conclusion: **there is still no known repository-only migration based on name-presence reconciliation.** The counts, however, must now be read as **79 repository files / 85 live rows**, not 68 / 70.

## What this does *not* prove

This pass intentionally did **not** rewrite the 137 KB historical ledger's full A/B/C/F/H fingerprint classification.

Specifically, it did not recompute a byte/skeleton fingerprint for every one of the 79 source files against every live statements array. The four duplicate Aug 10 history rows make a simple one-file/one-row classification misleading unless the exact content relation is re-fingerprinted.

So the safe current claims are:

- **source-name presence:** confirmed for all post-Aug-7 migrations;
- **current source count:** 79;
- **current live history count:** 85;
- **current latest live version:** `20260810115029`;
- **full historical content-classification table:** last comprehensively fingerprinted on Aug 7 and should not be arithmetically extended without a dedicated fingerprint pass.

## Why the live count is six larger than the repository count

Do **not** infer six unapplied/extra schema changes from `85 - 79`.

The repository/live histories already had deliberate structural divergence before Aug 10:

- repository-side superseded migrations;
- live-only historical rows/connectivity probes;
- apply-time versions that differ from filename timestamps.

Aug 10 also introduced four additional same-name live history rows through corrected/re-applied executions.

The count difference is therefore **history structure**, not evidence by itself of schema drift.

## Safety rules unchanged

This reconciliation does not change the production migration policy:

1. Never run `supabase db push` against Production.
2. Never run `supabase migration repair` merely to align history.
3. Never edit/rename an applied historical migration.
4. Never infer application status from filename/version alone.
5. New schema changes are forward-only new migrations.
6. Merge approval is not live-apply approval.
7. Every live migration application requires separate explicit owner approval.
8. Production history writes require explicit owner approval.

Use `docs/MIGRATIONS.md` for the historical workflow/evidence and this file for the latest dated count/name reconciliation until the large ledger receives its next full fingerprint refresh.

## Read-only queries used

Only SELECT statements were used against Production:

```sql
select count(*)::int as migration_rows, max(version) as latest_version
from supabase_migrations.schema_migrations;
```

```sql
select name,
       count(*)::int as live_rows,
       min(version) as first_version,
       max(version) as latest_version
from supabase_migrations.schema_migrations
where version >= '20260810000000'
group by name
order by min(version), name;
```

No write followed either query.