# Operations Health Center — Rollback

The feature is isolated and read-only.

Before Production application, rollback is simply to close/revert the PR; the
capability gate keeps the tab hidden while the RPC is absent.

> **Corrected 2026-11-26 — read this before using the steps below.** They were
> written against the 2026-07-23 snapshot and no longer describe the database.
> Since `20260807150000` the snapshot calls the **five-argument** overload
> `operations_health_overall_state(text, text, text, text, text)` (both overloads
> exist; the snapshot passes five states, including `order_flow`, and has been
> redefined several times since, the latest in `20261016120000`). Step 4's
> `drop function ... (text, text, text, text)` therefore drops a function nothing
> calls and leaves the live one in place; `operations_alerts_derive()` does not
> reference `operations_health_overall_state` at all; and step 2's "restore the
> original body" would silently remove the order-flow, branch-availability,
> payment-refund and variant cards and stop the platform rollup seeing order-flow
> failures. A safe rollback today is a **new reviewed migration derived from the
> current snapshot**, not a restore of the 2026-07-22 body, and it must also
> account for the job `operational-history-prune` (`20261001120000`), whose
> function deletes from `operations_alert_runs`: dropping that table leaves it
> failing every night. Dropping the dispatcher's Vault secrets also breaks the
> staff-console web-push sender, which reads `operations_alert_dispatch_project_url`.
> Never run any of it through `db push`.

**Important — this is no longer an isolated drop.** The later Smart Operations
Alerts & Daily Digest engine (`20260723090000_smart_operations_alerts_digest`,
applied 2026-07-22) redefined `operations_health_snapshot_internal()` to call
`operations_health_overall_state(text, text, text, text)` (*the four-argument
form, as of that migration; see the correction above*), and the two internal
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
