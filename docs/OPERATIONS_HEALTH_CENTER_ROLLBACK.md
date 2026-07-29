# Operations Health Center — Rollback

The feature is isolated and read-only.

Before Production application, rollback is simply to close/revert the PR; the
capability gate keeps the tab hidden while the RPC is absent.

**Important — this is no longer an isolated drop.** The later Smart Operations
Alerts & Daily Digest engine (`20260723090000_smart_operations_alerts_digest`,
applied 2026-07-22) redefined `operations_health_snapshot_internal()` to call
`operations_health_overall_state(text, text, text, text)`, and the two internal
automation crons `operations-alerts-evaluator` (`*/5`) and
`operations-digest-generator` (hourly) consume that snapshot. Dropping the Health
Center functions on their own would break the snapshot and make the five-minute
evaluator record failures. A safe rollback must therefore proceed **in dependency
order**, in a separate reviewed and owner-approved migration:

1. **Unschedule/disable** the two automation crons (`operations-alerts-evaluator`,
   `operations-digest-generator`) and any other alerts/digest consumers, so
   nothing reads the snapshot mid-change.
2. **Restore or replace** `operations_health_snapshot_internal()` and
   `operations_alerts_derive()` with definitions that no longer reference
   `operations_health_overall_state()` — **or** remove those dependents in the
   same step.
3. **Disable the UI** by removing or reverting the dashboard wiring.
4. **Only then drop** the two Health Center functions:

```sql
drop function if exists public.operations_health_summary();
drop function if exists public.operations_health_overall_state(text, text, text, text);
```

At its original 2026-07-22 apply time — before the alerts/digest engine existed —
the drop was dependency-free and could not affect cron. That is no longer true.
Dropping these functions still cannot modify orders, payments, customer data,
integrations, or provider state (the feature creates no tables, triggers, jobs, or
operational writes), but it **will** break the alerts/digest automation crons
unless steps 1–2 are done first. See `docs/MIGRATIONS.md` §16 for the same
procedure in the ledger.

Do not perform rollback through `db push`, migration repair, or untracked
Production SQL.
