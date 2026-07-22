# Operations Health Center v1 — Scope Lock

Included:

- one read-only staff aggregate RPC;
- deterministic platform health state;
- Lazywait and Order Integrity authoritative health composition;
- account deletion and allowlisted pg_cron telemetry;
- safe payment, push, email, and OTP metadata/aggregates;
- Arabic/English responsive admin panel;
- manual and 60-second automatic refresh;
- capability gating and partial-failure states;
- tests and documentation.

Excluded:

- external provider health probes;
- alert dispatch;
- test messages;
- retry, refund, resend, mark-paid, acknowledge, suppress, or auto-fix actions;
- changes to existing health functions, cron jobs, integration settings, payment,
  order, POS, Lazywait, account-deletion, customer, or notification business
  logic.
