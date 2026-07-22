# Spicy Meal — Smart Operations Alerts & Daily Digest v1

## Status

**Repository-only.** The migration
`supabase/migrations/20260723090000_smart_operations_alerts_digest.sql`
is committed to the repository but **has not been applied to Production**.
No cron job exists for it, no dispatcher exists, and all engine switches
default to **off**. Applying it to Production, scheduling it, or enabling
any switch each require separate explicit owner approval and follow the
owner-approved workflow in `docs/MIGRATIONS.md`.

Deliverables:

- Migration: `supabase/migrations/20260723090000_smart_operations_alerts_digest.sql`
- SQL tests: `supabase/tests/operations_alerts_digest_test.sql`
- Client API: `src/lib/operationsAlertsApi.ts`, `src/lib/operationsAlertsCapability.ts`
- Admin UI: `src/components/admin/OperationsAlertsPanel.tsx` (tab in `AdminDashboard`)
- Frontend tests: `src/lib/operationsAlertsCapability.test.ts`,
  `src/lib/operationsAlertsApi.test.ts`,
  `src/components/admin/OperationsAlertsPanel.test.tsx`

## Purpose

A deterministic (no-LLM) alerting and daily-digest layer on top of the
Operations Health Center. It:

- detects health-state **transitions** (open / escalate / downgrade / recover)
  instead of re-reporting steady state;
- deduplicates and correlates repeated findings into one alert per stable
  condition identity;
- tracks open and recovered conditions with a full per-alert event timeline;
- renders a bilingual (Arabic/English) daily digest for the previous full
  local day (Asia/Riyadh) plus a read-only "today so far" preview;
- records would-be notifications in a **dormant outbox** so future delivery
  channels can be activated later without rewriting the engine.

It is strictly observability: **no auto-remediation, no retries, no
acknowledge/suppress actions, no external messages** in v1.

## Architecture: one authoritative health path

The evaluator needs the same health data staff see, but `is_staff()` is false
in the service-role context, so a direct service-role call to
`operations_health_summary()` raises `42501` (verified live during the
Health Center rollout). v1 therefore restructures the call path **in a new
migration** — the applied migration `20260722100000` is never edited:

- `public.operations_health_snapshot_internal()` — new function containing
  the verbatim health-calculation body from the Health Center migration
  (minus the staff gate). `SECURITY DEFINER`, `STABLE`,
  `search_path = public`. Executable **only** by `service_role`; all other
  roles are revoked.
- `public.operations_health_summary()` — redefined (same name, signature,
  volatility, security, grants, comment) as a thin wrapper: staff gate
  (`42501` for non-staff) then `return operations_health_snapshot_internal()`.
  The public RPC contract is unchanged; the existing Health Center test suite
  passes against the wrapper unmodified.

There is exactly one health-calculation implementation. The alert engine
never re-implements health SQL, never weakens or bypasses the staff gate,
and never impersonates a staff user or fakes JWT claims.

## Data model (all tables new, definer-only)

| Table | Purpose |
| --- | --- |
| `operations_alert_settings` | Single-row switchboard (see defaults below). |
| `operations_alert_runs` | Durable ledger of every evaluator/digest run (`running/success/skipped/failed`, skip reason, safe error code, counters). |
| `operations_alert_state` | One row per condition generation; `open`/`recovered`; partial unique index on `(fingerprint) WHERE status='open'` guarantees at most one open alert per identity. |
| `operations_alert_events` | Append-only timeline: `baseline_observed`, `opened`, `escalated`, `downgraded`, `reminder`, `recovered` (with `notification_suppressed`). |
| `operations_digest_runs` | One stored digest per `(scope, digest_date, language)` with exact UTC period bounds and rendered subject/body. |
| `operations_alert_outbox` | Dormant notification intents (see below). |

All six tables have RLS enabled with **no policies and no role grants**:
they are readable/writable only through the `SECURITY DEFINER` RPCs. The
engine writes **only** to these six tables; every operational source
(orders, payments, cron, integrations, notification ledgers…) is read-only
to it, and the test suite proves it by row-count comparison.

## Fingerprinting and correlation

A fingerprint is the **stable identity** of a condition; the changeable
classification lives in `condition_code`/severity. Charset is enforced:
`^[a-z0-9_:-]{3,200}$`. Examples:

- `platform:health`, `lazywait:sync_health`, `payment:health`
- `order_integrity:incidents` — one alert grouping all unresolved incident
  fingerprints, with safe counts as evidence (not one alert per incident)
- `database_jobs:job_health:<jobname>` — identity is the job; codes such as
  `terminal_failure`, `stale_success`, `job_missing` (critical) or
  `no_success_yet`, `schedule_mismatch`, `job_degraded` (warning) classify it
- `push:failed_deliveries`, `push:failed_send_events`
- `<system>:configuration` — optional systems, **opt-in only**

Because identity is stable, a warning that worsens **escalates the same
alert** (event `escalated`) and a critical that improves **downgrades** it
(no false recovery + reopen churn). Evidence is passed through a sanitizer:
scalars only, ≤ 20 keys, strings truncated — no PII, no secrets, no raw
provider errors.

Optional systems that are merely disabled / not configured / not monitored
do **not** alert by default; an admin must opt in
(`optional_system_alerts_enabled`), and per-system overrides
(`system_rule_overrides`, e.g. `{"push":{"muted":true}}`) can mute noisy
identities.

## Lifecycle rules

- **Baseline no-storm** — the very first evaluation of a live system records
  existing problems as `baseline_observed` (suppressed, no outbox rows)
  instead of storming a burst of "new" alerts.
- **Open** — a new condition inserts an `open` row (generation 1 for a new
  fingerprint), an `opened` event, and dormant outbox intents (EN + AR).
- **Dedup** — a persisting condition bumps `occurrence_count` and
  `last_seen_at` on the same open row; no new alert, no new notification.
- **Escalate / downgrade** — severity changes mutate the open row and emit
  one event (escalations produce outbox intents; downgrades are suppressed).
- **Reminders** — idempotent, per-severity cooldowns
  (`critical_reminder_minutes` = 240, `warning_reminder_minutes` = 1440 by
  default), anchored to the last notification/reminder, and only for
  conditions that were actually notified and are still active.
- **Recovery** — exactly once per generation: the open row flips to
  `recovered`, one `recovered` event is emitted (suppressed if the alert was
  never notified or recovery notifications are off).
- **Reopen** — a recurrence after recovery starts a **new generation**
  (fresh row, generation + 1), preserving the full history of the previous
  generation.
- **Concurrency** — the evaluator and digest generator each take a
  transaction-scoped advisory lock; an overlapping run records a `skipped`
  ledger row (`overlap_skipped`) and touches nothing.
- **Fail-safe** — any evaluation error rolls back state changes and records
  a `failed` run with a fixed safe error code only (no raw message leak).

## Daily digest

- Timezone: `Asia/Riyadh` (settings-driven). A stored digest covers the
  **previous full local day**, converted to exact UTC period bounds.
- One digest per `(scope='daily', digest_date, language)`; generation is
  idempotent (`ON CONFLICT DO NOTHING`).
- Content: overall state, opened/recovered/unresolved counts by severity,
  top recurring conditions, and explicit no-incident lines
  ("No incidents in this period." / "لا توجد حوادث خلال هذه الفترة.") —
  a quiet day still yields a truthful digest.
- Every rendered digest ends with "External delivery is disabled in this
  version." (AR equivalent) so a stored digest can never be mistaken for a
  sent message.
- `operations_digest_preview(p_language)` is a staff-gated, **read-only**
  "today so far" render (`preview: true`); it stores nothing.

## Authorization matrix

| Function | anon | customer (authenticated) | staff | admin | service_role |
| --- | --- | --- | --- | --- | --- |
| `operations_health_snapshot_internal()` | — | — | — | — | ✔ |
| `operations_health_summary()` | — | 42501 | ✔ | ✔ | 42501 (not staff) |
| `operations_alerts_evaluate()` | — | — | — | — | ✔ |
| `operations_digest_generate()` | — | — | — | — | ✔ |
| `operations_alerts_admin_summary()` | — | 42501 | ✔ | ✔ | — |
| `operations_alerts_list()` / `operations_alert_timeline()` | — | 42501 | ✔ | ✔ | — |
| `operations_digest_list()` / `operations_digest_preview()` | — | 42501 | ✔ | ✔ | — |
| `operations_alert_settings_get()` | — | 42501 | ✔ | ✔ | — |
| `operations_alert_settings_update()` | — | 42501 | 42501 | ✔ | — |

`operations_alert_settings_update` accepts a strict whitelist patch and
**hard-rejects** `external_dispatch_enabled = true` (`P0001`,
"external dispatch cannot be enabled in this version") — even for admins.

## Dormant delivery (outbox)

The outbox records notification *intents*, never deliveries:

- In-app rows (`channel='in_app'`, EN + AR) are the only "active" channel and
  are merely `recorded` — the admin inbox reads state/events directly.
- External channels (`email`, `whatsapp`, `push`) may exist only as
  `blocked` (`blocked_reason='external_dispatch_disabled'`) or `cancelled`.
- The named CHECK constraint `operations_alert_outbox_v1_dormancy` makes an
  external `pending`/`sent`/`failed` row **structurally impossible** in v1;
  idempotency keys make intent recording replay-safe.

No dispatcher process exists anywhere in the codebase. Nothing polls the
outbox. No provider credentials are read.

## Admin UI

`OperationsAlertsPanel` (tab "Operations Alerts" / "التنبيهات والملخص") is
capability-gated like the Health tab: it hides only when the probe confirms
the RPC is missing (pre-migration deploys), and stays visible with a
truthful error banner for auth/network failures. Sections:

- **Alerts inbox** — summary cards, status/severity/subsystem filters,
  expandable rows with lazy-loaded event timelines. Read-only; there are no
  acknowledge/suppress/retry/resolve/send buttons.
- **Daily digest** — EN/AR live preview (today so far) and stored digest
  history; Arabic renders RTL.
- **Settings** — staff see a read-only view; admins can toggle the
  whitelisted switches through the settings RPC. The external-dispatch
  toggle is rendered permanently disabled with an explanatory note.

The header always shows "External delivery disabled" and, while the
evaluator switch is off, a dormant-mode notice. Backend values are
authoritative; the client normalizes defensively and never invents an
enabled flag or a healthy state.

## Defaults (dormant)

| Setting | Default |
| --- | --- |
| `alert_evaluation_enabled` | `false` |
| `digest_generation_enabled` | `false` |
| `external_dispatch_enabled` | `false` (cannot be enabled in v1) |
| `timezone` | `Asia/Riyadh` |
| `digest_local_time` | `08:00` |
| `warning_reminder_minutes` | `1440` |
| `critical_reminder_minutes` | `240` |
| `recovery_notifications_enabled` | `true` |
| `optional_system_alerts_enabled` | `false` |

Applying the migration therefore changes **no runtime behavior**: nothing
runs, nothing alerts, nothing is sent.

## Future activation plan (each step needs separate owner approval)

1. **Apply the migration to Production** via the owner-approved
   `apply_migration` workflow in `docs/MIGRATIONS.md`.
2. **Schedule the evaluator**: pg_cron job `operations-alerts-evaluator`
   calling `select public.operations_alerts_evaluate();` every 5–10 minutes,
   and `operations-digest-generator` calling
   `select public.operations_digest_generate();` hourly (the function itself
   no-ops until the configured local digest time has passed and generates at
   most one digest per day/language). Both jobs are delivered by a future
   migration — none is created in v1.
3. **Enable switches**: `alert_evaluation_enabled`, then
   `digest_generation_enabled`, via the admin settings RPC. The first enabled
   run performs the baseline (no storm).
4. **External delivery (future version)**: a reviewed dispatcher (Edge
   Function or job) plus a migration that drops/replaces the
   `operations_alert_outbox_v1_dormancy` constraint and lifts the
   settings-RPC hard-reject. Until all three ship together, external
   delivery remains structurally impossible.

## Rollback plan

The feature is additive and dormant, so rollback is a follow-up migration
(never an edit of an applied one) that:

1. drops the six `operations_alert*`/`operations_digest*` tables and the
   alert/digest functions;
2. restores `operations_health_summary()` to its original self-contained
   body from `20260722100000_operations_health_center.sql` and drops
   `operations_health_snapshot_internal()`.

Because the wrapper preserves the public contract, the Health Center UI and
tests are unaffected in either direction. The admin tab hides itself
automatically once the probe RPC is gone.

## Testing

`supabase/tests/operations_alerts_digest_test.sql` (runs in the local
PG16 harness alongside the existing suites; single transaction, rolled
back): object/security contract matrix, authorization matrix (7 customer
denials, staff/admin split, wrapper ≡ snapshot output), dblink concurrency
skip, dormant no-op, settings whitelist + external-dispatch hard-reject,
baseline no-storm, open/dedup, escalation, downgrade, exactly-once
recovery, reopen generations, reminder cooldowns, incident grouping, safe
evidence & fingerprint charset, optional-system opt-in/mute, Riyadh
digest-boundary math (20:59:59Z vs 21:00:01Z), digest idempotency +
no-incident rendering + preview read-only, outbox dormancy CHECK, engine
read-only sweep over operational tables, and fail-safe error handling.

Frontend: 35 vitest cases across the capability classifier, the defensive
normalizers, and the panel (inbox, filters, timelines, digest EN/AR + RTL,
settings role split, disabled external toggle, fail-visible errors,
no-action-buttons guarantee).
