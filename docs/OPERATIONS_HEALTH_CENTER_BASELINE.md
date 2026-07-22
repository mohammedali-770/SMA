# Operations Health Center — Read-only Baseline

Audit date: 2026-07-22

Production project: `wxfmmnihidsdyemasstf`

This baseline was captured with read-only aggregate queries. No customer rows,
secrets, provider payloads, tokens, or full payment references were returned.
No Production state was modified.

## Critical telemetry

- Lazywait authoritative health: `healthy`.
- Order Integrity authoritative health: `healthy`.
- `account-deletion-processor`: active, every minute, latest run succeeded.
- `lazywait-sync`: active, every minute, latest run succeeded.
- `order-integrity-watchdog`: active, every two minutes, latest run succeeded.
- Account deletion due queue: `0`.
- Account deletion manual-review queue: `0`.

Expected critical-system presentation at this baseline:

- Lazywait Sync: `healthy`.
- Order Integrity: `healthy`.
- Account Deletion: `idle` (scheduler healthy, no due work).
- Database & Scheduled Jobs: `healthy`.
- Overall platform state: `healthy`.

## Optional/informational telemetry

- Payment provider: Tap; enabled and configuration-complete; no successful or
  failed payment records created in the last 24 hours; one historical initiated
  record exists from 2026-07-12. Because v1 performs no live Tap availability
  probe, the truthful normal state is `not_monitored`, not `healthy`.
- Push provider: Expo; master integration disabled; active device count `0`;
  promotional opt-in count `0`; send failures in the last 24 hours `0`.
- Email provider: SMTP; enabled and configuration-complete; v1 sends no test
  message, so the truthful state is `not_monitored`.
- OTP channel: WhatsApp/Meta Cloud selected by the existing integration state;
  enabled and configuration-complete; v1 sends no OTP or test message, so the
  truthful state is `not_monitored`.

These optional states do not determine the overall platform state unless a
separate critical source (for example Order Integrity) proves an operational
failure.
