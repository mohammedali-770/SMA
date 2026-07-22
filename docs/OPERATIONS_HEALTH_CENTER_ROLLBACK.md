# Operations Health Center — Rollback

The feature is isolated and read-only.

Before Production application, rollback is simply to close/revert the PR; the
capability gate keeps the tab hidden while the RPC is absent.

After an owner-approved Production application, disable the UI first by removing
or reverting the dashboard wiring. The backend can then be removed in a separate,
reviewed and owner-approved migration:

```sql
drop function if exists public.operations_health_summary();
drop function if exists public.operations_health_overall_state(text, text, text, text);
```

Dropping these functions cannot modify orders, payments, customer data,
integrations, provider state, or cron jobs because the feature creates no tables,
triggers, jobs, or operational writes.

Do not perform rollback through `db push`, migration repair, or untracked
Production SQL.
