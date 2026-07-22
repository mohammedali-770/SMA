# Operations Health Center — Review Checklist

- [ ] Full repository TypeScript check passes.
- [ ] Mobile TypeScript check passes.
- [ ] Vitest passes, including capability and safe-fallback tests.
- [ ] Vite build passes.
- [ ] Full migration chain applies on throwaway PostgreSQL 16.
- [ ] Migration re-apply is idempotent.
- [ ] `operations_health_center_test.sql` passes.
- [ ] Codex review covers the final head and has no unresolved findings.
- [ ] Migration remains repository-only and unapplied to Production.
- [ ] No external provider call or test message is made.
- [ ] No order, payment, POS, Lazywait, refund, customer, integration, or cron
      operational state is changed.
- [ ] `docs/MIGRATIONS.md` is reconciled before final approval, including the
      already-applied Order Integrity Watchdog live version and this new
      repository-only migration.
