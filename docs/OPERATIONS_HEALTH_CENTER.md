# Spicy Meal — Operations Health Center v1

## Purpose

The Operations Health Center is a centralized, **read-only** admin view of the
operational health of the Spicy Meal platform. It combines existing authoritative
health summaries with safe database and scheduler aggregates so staff can see what
needs attention without accessing secrets, provider payloads, or customer data.

Migration:
`supabase/migrations/20260722100000_operations_health_center.sql`

SQL tests:
`supabase/tests/operations_health_center_test.sql`

Admin UI:
`src/components/admin/OperationsHealthPanel.tsx`

## Safety boundary

The Health Center may only read operational metadata and aggregate counts. It has
no action that can:

- create, cancel, resend, or change an order;
- initialize, confirm, retry, cancel, or refund a payment;
- change Lazywait/POS state;
- enable or disable an integration;
- rotate or expose a secret;
- send Push, Email, SMS, WhatsApp, or OTP messages;
- change a cron schedule;
- acknowledge, suppress, resolve, or auto-fix an incident.

The page contains only Refresh and navigation links to existing admin surfaces.
It never performs provider test calls in v1.

## Authoritative telemetry

### Critical monitored systems

The overall platform state is derived only from these critical systems:

1. **Lazywait Sync** — `public.lazywait_sync_health_summary()` remains the
   authoritative state source.
2. **Order Integrity** — `public.order_integrity_health_summary()` remains the
   authoritative state source.
3. **Account Deletion Processor** — allowlisted pg_cron execution evidence plus
   safe queue counts (`due`, `manual_review`, oldest due time).
4. **Database & Scheduled Jobs** — exactly three allowlisted application jobs:
   `account-deletion-processor`, `lazywait-sync`, and
   `order-integrity-watchdog`.

A missing or temporarily unavailable critical health source degrades the overall
platform state. A proven critical failure makes it failing. A verified
configuration error has the highest precedence.

### Optional/informational systems

- **Payment / Tap** — enabled/configured metadata, safe payment status counts,
  recent stale initiated attempts, latest paid time, and payment-related Order
  Integrity incident counts. No Tap API availability probe exists in v1.
- **Push Notifications** — master flag, safe device/opt-in counts, and aggregate
  send-ledger status. No push is sent.
- **Email / SMTP** — configuration completeness only. No email is sent.
- **WhatsApp / OTP** — configuration completeness only. No OTP or test message is
  sent.

Optional integrations do not make the platform healthy or failing merely because
they are enabled, disabled, or unconfigured. Without trustworthy provider
telemetry, an enabled/configured optional integration is shown as
`not_monitored`, never `healthy`.

## State model

Supported subsystem states:

- `healthy`
- `idle`
- `degraded`
- `failing`
- `configuration_error`
- `disabled`
- `not_configured`
- `not_monitored`
- `unavailable`

Overall state precedence for critical systems is deterministic:

1. `configuration_error`
2. `failing`
3. `degraded` (including an unavailable critical source)
4. `healthy`

`idle` is acceptable for a healthy scheduler with no due work.

## Safe output

`public.operations_health_summary()` is `SECURITY DEFINER`, `STABLE`, and has a
pinned `search_path=public`. It is executable by authenticated users but begins
with an `is_staff()` authorization gate. Customers receive `42501` and no health
data.

The RPC returns only:

- system states and safe explanations;
- scheduler names, cadence, active state, and safe execution timestamps/status;
- aggregate counts and timestamps;
- safe SQLSTATE-style error codes when a subsystem source is unavailable.

It does **not** return:

- `integration_settings.secret_config`;
- cron commands, usernames, databases, or return messages;
- customer names, phones, email addresses, or delivery addresses;
- push tokens;
- raw provider request/response payloads;
- full payment/provider references;
- API keys, access tokens, headers, or credentials.

Each subsystem is evaluated inside its own failure boundary. One missing or
broken optional source becomes `unavailable`; it does not crash or hide the rest
of the page.

## Admin UI behavior

The dashboard tab is capability-gated through an exact probe of
`operations_health_summary`:

- confirmed missing RPC (`PGRST202`) → tab hidden;
- network, authorization, 5xx, or dependent-object failure → tab remains visible
  and displays a safe unavailable/degraded state;
- after the migration is applied, a browser refresh reveals the tab
  automatically.

The page:

- supports Arabic RTL and English LTR;
- refreshes automatically every 60 seconds;
- has a manual Refresh button;
- shows status with text and icons, not color alone;
- is responsive for desktop, tablet, and mobile;
- provides read-only navigation to Order Integrity and Integrations;
- contains no Retry, Refund, Resend, Mark Paid, Acknowledge, Suppress, Test Send,
  or Auto-Fix controls.

Admin and accountant/staff users receive the same safe read-only Health Center
view. Existing admin-only controls remain in their original management panels.
Customers have no access.

## Change control

This migration was **merged and applied to Production on 2026-07-22** (PR #75,
squash `91c11b7`; live version `20260722113923`, class B — see `docs/MIGRATIONS.md`
§16). All change-control gates were satisfied before application:

1. tests and builds passed;
2. Codex review was clean;
3. the PR was merged into `claude/project-build-ie4b56` with explicit owner
   approval;
4. a separate explicit owner approval authorized the Production application;
5. application used the documented `apply_migration` workflow in
   `docs/MIGRATIONS.md`.

Never use `supabase db push`, migration repair, or untracked Production SQL for
this migration.
