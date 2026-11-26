# PR #185 — stranded-order health verification

Production-readiness verification for the stranded-order observability fix.

- Unexpected non-cancelled `blocked` / `dead_letter` orders fail order-integrity health.
- The deliberate `delivery_schema_unconfirmed` safety gate remains excluded. *(Dated note, 2026-11-26: that reason can no longer be produced. The trigger and the sync worker that wrote it were retired on 2026-08-27 (`CLAUDE.md` §8, delivery sync); four historical orders stay parked with it on purpose, and the later watchdog migration `20261016120000_refund_retry_backoff.sql` still carries the same exclusion for them. The exclusion is harmless and still needed, but it is no longer a live gate.)*
- A partial index bounds the recurring health scan to the terminal/non-retrying order set.
- Smart Operations Alerts derives `order_integrity:stranded_orders` independently, so a warning incident cannot mask the critical stranded-order condition.
- Regression coverage proves the Health Center fails, the critical condition survives alongside warning incidents, cancelled orders are excluded, and the deliberate delivery safety block stays excluded.
- No order, payment, retry, refund, provider state, or customer PII is mutated by these migrations.

This note exists so the PR head is revalidated against the post-#187 production baseline and documents the exact release invariant being gated.
