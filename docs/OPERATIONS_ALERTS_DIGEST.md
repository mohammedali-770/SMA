# Spicy Meal — Smart Operations Alerts & Daily Digest v1

## Status

**Deployed and internally active (pre-launch).** The engine migration
`supabase/migrations/20260723090000_smart_operations_alerts_digest.sql`
is applied to Production (live version `20260722143014`), the one-time
owner-approved baseline completed on 2026-07-22 (all-clear, platform
healthy), and the activation migration
`supabase/migrations/20260723120000_activate_operations_alerts_digest_cron.sql`
enables the two **internal** automations and schedules them (see
"Internal automation" below). **External delivery remains disabled and
structurally impossible**: no dispatcher exists, the outbox dormancy
constraint is in force, and the settings RPC hard-rejects enabling
external dispatch. Ledger reconciliation of `docs/MIGRATIONS.md` is owned
by Issue #76.

Deliverables:

- Engine migration: `supabase/migrations/20260723090000_smart_operations_alerts_digest.sql`
- Activation migration: `supabase/migrations/20260723120000_activate_operations_alerts_digest_cron.sql`
- SQL tests: `supabase/tests/operations_alerts_digest_test.sql`,
  `supabase/tests/operations_alerts_activation_test.sql`
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
  instead of storming a burst of "new" alerts. Baseline completion is
  persisted in `operations_alert_settings.baseline_completed_at` on the
  first successful enabled run — **even an all-clear run** — so a system
  that is healthy at activation and degrades later gets a real, notified
  alert (never a silently suppressed "baseline" observation).
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
- `operations_digest_generate()` honors `digest_local_time`: a run earlier
  in the local day than the configured time records a `skipped`
  (`before_digest_time`) ledger row and stores nothing, so the documented
  hourly activation cron cannot generate (or, once delivery exists, send)
  the day's digest early.
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

## Internal automation (active) — operations runbook

Delivered by `20260723120000_activate_operations_alerts_digest_cron.sql`:

| Job | Schedule | Command |
| --- | --- | --- |
| `operations-alerts-evaluator` | `*/5 * * * *` (every 5 minutes) | `select public.operations_alerts_evaluate();` |
| `operations-digest-generator` | `0 * * * *` (hourly) | `select public.operations_digest_generate();` |

**Why the digest cron is hourly, not daily:** the function — not the
scheduler — is the source of truth for digest timing. Every hourly tick
before 08:00 Asia/Riyadh records a safe `skipped` run
(`before_digest_time`); the first tick at/after 08:00 generates the
previous full local day once per language; later ticks that day are
idempotently skipped (`generated: []`). If the database or job runner is
down at 08:00, the next hourly tick recovers the digest instead of losing
the day. Overlap is prevented by advisory locks in both engines.

**Internal-only guarantees (unchanged by activation):** external dispatch
disabled (settings hard-reject + `operations_alert_outbox_v1_dormancy`
constraint), no dispatcher exists, no provider credentials, no Push /
Email / WhatsApp / SMS / OTP messages, no automatic remediation. The
system only observes, evaluates, records, and renders internally.

**Verifying job health**

```sql
select jobname, schedule, active from cron.job
 where jobname in ('operations-alerts-evaluator','operations-digest-generator');
select kind, status, skip_reason, safe_error_code, started_at, counts
  from public.operations_alert_runs order by id desc limit 20;
```

Or in the Admin Dashboard: Operations Alerts → header "Last evaluation" and
Settings → last run details; the Operations Health tab's Scheduled Jobs
card covers the three pre-existing crons.

**Expected skipped runs (safe, routine)**
- `before_digest_time` — hourly digest tick before 08:00 local. Normal.
- digest `generated: []` after the day's digest exists. Normal.
- `overlap_skipped` — a tick fired while the previous one still ran. Safe
  by design; frequent occurrences suggest load worth investigating.

**A run needs attention when** `status = 'failed'` (carries a fixed
`safe_error_code`, never a raw message). Repeated failures → use the safe
disable below and investigate; a single transient failure self-heals on
the next tick.

**Known limitation (tracked follow-up):** the Operations Health
scheduled-jobs card allowlists only the three pre-existing crons; the two
automation jobs above are not yet part of that health source. Extending it
needs per-cadence staleness windows (the current 6-minute stale-success
rule fits 1–2-minute jobs and would falsely mark the hourly digest job
failing between ticks), so it ships as its own reviewed change. Until
then, monitor the automation itself through the `operations_alert_runs`
ledger queries above and the Admin panel's last-run data — and note that
an evaluator that is itself down can never self-report internally; that
gap is inherent to v1's internal-only design and is what a future
external-delivery version addresses.

**Safe disable / rollback (non-destructive, reviewed)**

```sql
select cron.unschedule('operations-alerts-evaluator');
select cron.unschedule('operations-digest-generator');
update public.operations_alert_settings
   set alert_evaluation_enabled = false,
       digest_generation_enabled = false
 where id;
```

Keeps baseline, alert history, digest history, the three unrelated crons,
and disabled external dispatch untouched. Never reset
`baseline_completed_at`, never delete history rows, never edit
migration-history tables.

**Launch-day verification checklist**
1. `cron.job` shows exactly 5 jobs (3 pre-existing + the 2 above), active.
2. Latest evaluator runs are `success` (or safe skips), cadence ≈ 5 min.
3. Yesterday's digest exists in both languages after 08:00 Riyadh.
4. Operations Alerts inbox shows a truthful state (empty when healthy).
5. `operations_alert_outbox` contains no external-channel rows outside
   `blocked`/`cancelled` (constraint makes anything else impossible).
6. `external_dispatch_enabled` is still `false`.
7. Operations Health tab unchanged and healthy.

## External delivery (still a future version)

A reviewed dispatcher (Edge Function or job) plus a migration that
drops/replaces the `operations_alert_outbox_v1_dormancy` constraint and
lifts the settings-RPC hard-reject. Until all three ship together —
each requiring separate explicit owner approval — external delivery
remains structurally impossible.

## Rollback plan

The feature is additive, so rollback is a follow-up migration (never an
edit of an applied one). **In an activated environment the automation must
be stopped FIRST** — otherwise the two cron jobs keep firing every 5
minutes/hourly against dropped functions, producing recurring pg_cron
failures:

1. unschedule the automation and disable the engine flags (the "Safe
   disable / rollback" block in the runbook above:
   `cron.unschedule('operations-alerts-evaluator')`,
   `cron.unschedule('operations-digest-generator')`, then set
   `alert_evaluation_enabled = false` and
   `digest_generation_enabled = false`);
2. drops the six `operations_alert*`/`operations_digest*` tables and the
   alert/digest functions;
3. restores `operations_health_summary()` to its original self-contained
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
