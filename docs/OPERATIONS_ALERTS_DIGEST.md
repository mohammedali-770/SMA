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

## v2 — email dispatch (built 2026-09-03, INERT)

**Everything below this heading describes v1 and remains accurate about the
engine.** What changed is the end of the pipe: v1 deliberately had no dispatcher,
and now there is one for a single channel. It sends nothing until three separate
owner actions land (`OWNER_ACTIONS.md` §28).

### What v1 was, stated fairly

v1 did not omit dispatch. It refused, in three independent places — the outbox
dormancy CHECK, both producers hard-coding channel `'in_app'`, and the settings
RPC raising on `external_dispatch_enabled`. The constraint's own comment
anticipated the migration that would lift it. That is what
`20260903120000_operations_alert_email_dispatch` is.

### What v2 changes

| | |
| --- | --- |
| Channel | **`email` only.** `whatsapp` and `push` keep the v1 prohibition under the replacement constraint |
| Volume | ONE email row per event, not one per language — the `in_app` pair stays bilingual, but a responder reads one mailbox |
| Severity floor | `dispatch_min_severity`, default **`critical`** |
| Language | `dispatch_language`, default `en` |
| Recipients | derived from admin profiles at send time by `operations_alerts_dispatch_recipients()`. **No address is stored**, which was v1's stated property |
| Delivery | at most once — a per-invocation fencing token on claim, and every completion write guarded by it |
| Transport | `operations-alert-dispatch`, over the SMTP credential already configured for the email provider |
| Invocation | `pg_cron` every 5 minutes via `invoke_operations_alert_dispatch()` (`20260903130000`), with a Vault-held URL and trigger secret. The driver **signs** (nonce + timestamp + HMAC-SHA256, 10-minute freshness window) rather than sending the secret, so the Edge Function never receives it — the first scheduler did, while claiming otherwise (#329). Before that there was **no caller at all** (#328). An admin can still invoke it by hand |

### Platform rollup suppression (`20260914120000`) — APPLIED

> **LIVE IN PRODUCTION since 2026-09-09 12:17:02 UTC** (live version
> `20260909121702`, `docs/MIGRATIONS.md` ledger row 88), applied on explicit
> owner approval naming the target by version.
>
> **Nothing moved on apply** — outbox still 156 rows with 0 on `email`, dispatch
> still false, and `_pre_stranded` byte-identical.
>
> **All four behaviours were verified LIVE, read-only**, because the wrapper is
> pure over its arguments: the ordinary duplicate is suppressed; the muted
> `configuration_error` driver keeps its rollup and is named in
> `driver_subsystems`; the wrapper-added stranded critical suppresses correctly;
> and two failing drivers with one muted keep the rollup, naming both.

**The rollup no longer duplicates the subsystem that caused it.**
`platform:health` fires on `overall_state`, which is DERIVED from five
subsystems (lazywait, order_integrity, account_deletion, database_jobs,
order_flow — `operations_health_overall_state`, the 5-arg overload). So one
failing subsystem opened **two** critical alerts on the same tick.

**Measured live 2026-09-09 over the previous seven days:** two incidents, four
critical opens, and in both cases `platform:health` and `order_flow:health`
opened *and* recovered at exactly the same second. The rollup was the less useful
of the pair — its entire evidence was `{"overall_state": "failing"}`, while the
subsystem alert beside it carried `orders_in_window`, `baseline_orders`,
`open_branches` and the window. It did not even name which subsystem was at
fault.

| | |
| --- | --- |
| Suppressed when | **every** subsystem *driving* `overall_state` already reports it at **critical** |
| Drivers are | rollup members whose state **equals** `overall_state` — not any rollup member |
| Not suppressed by | a `warning`; by `branch_availability` / `payment` (neither feeds `overall_state`); or by a critical about a **different** state |
| Never suppressed when | any driver is **muted**, or no system row matches `overall_state` |
| When it does fire | it carries `driver_subsystems`, naming the drivers |
| Applied in | `operations_alerts_derive` — the **wrapper**, after every condition exists |

**Two review findings on #354 shaped the final design, and both were real.**

**P1 — correlate with the DRIVER, not any rollup member.** `overall_state` ranks
`configuration_error` above `failing`. So a **muted** `lazywait=configuration_error`
alongside an unmuted `order_flow=failing` reports the platform as
*configuration_error* — driven by lazywait — while order_flow's critical is about
a different state entirely. The first version suppressed on "any rollup critical",
so the lazywait configuration error was reported by **nothing**: not its own
condition (muted), not the safety net (suppressed). The predicate is now stated in
terms of drivers, and requires **every** driver explained — two drivers with one
muted must still raise the rollup.

**P2 — judge after the wrapper's append, not before.** `operations_alerts_derive`
appends `order_integrity:stranded_orders` at **critical** *after*
`_pre_stranded` returns. And the `order_integrity` arm is an if/**elsif**: with
`open_warning_count > 0` it emits only a **warning** and never reaches its
critical branch. Deciding inside `_pre_stranded` therefore saw a warning, emitted
the rollup, and had the critical appended immediately after — restoring the exact
duplication. The correlation now runs in the wrapper, on **all five** return
paths, and `_pre_stranded` is left untouched.

**THE MUTE CASE IS WHY THE PREDICATE READS EMITTED CONDITIONS, NOT RAW STATES.**
A muted subsystem emits no condition while still feeding `overall_state`.
Suppressing on raw state would mean muting one card *also* silences the platform
alert for it — two alerts lost to one mute, and a failing subsystem reported
nowhere. Reading the emitted conditions keeps the rollup as the safety net a mute
is supposed to leave standing. Case 2a pins it, and the raw-state mutant dies
there.

**A sanitizer contract worth knowing before adding evidence anywhere.**
`operations_alerts_sanitize_evidence` keeps only strings, numbers and booleans —
objects and arrays are dropped **by design**, so nothing structured can carry
unreviewed content into an alert body. The first version of this migration
attached `driver_subsystems` as a jsonb array and it vanished silently; its own
verification block caught that. `driver_subsystems` is therefore a
comma-separated string. Conform to the sanitizer rather than widening it.

**An existing test had to be revisited, and that is recorded rather than quietly
edited.** `order_flow_alert_condition_test.sql` CASE 10 expected
`platform:health` alongside the subsystem conditions. Its stated purpose is that
the order_flow arm "did not disturb the branches around it" — the rollup was in
its expected list only **incidentally**. It now asserts the rollup's *absence*
explicitly, turning an incidental expectation into a deliberate one. This is
#332's lesson in reverse: a test that incidentally pins behaviour must be
revisited when that behaviour is deliberately changed, or it becomes an argument
against the change.

Coverage: `platform_rollup_suppression_test.sql`, **14 cases**, calling
`operations_alerts_derive` (the public entry point) rather than the internal
builder — testing the builder would have passed while the function the evaluator
calls still emitted the duplicate. Mutation-tested five ways, **all killed**,
including both #354 regressions reintroduced deliberately: any-critical instead
of drivers (case 10a), any-driver instead of every-driver (10d), correlating
before the wrapper's append (11b), dropping the non-empty-drivers guard (3), and
any-severity (11c).

**Applied.** It changes what is ALERTED, not what is measured — the
Operations Health Center still shows the platform red.

### Recovery email pairing (`20260913120000`) — APPLIED

> **LIVE IN PRODUCTION since 2026-09-09 10:29:49 UTC** (live version
> `20260909102949`, `docs/MIGRATIONS.md` ledger row 87), applied on explicit
> owner approval naming the target by version.
>
> **Applying it sent nothing and changed nothing** — the outbox still holds its
> same 156 rows with zero on the `email` channel, and `external_dispatch_enabled`
> is still false, which the migration's own final assertion requires.
>
> **The rule is now in force for the moment dispatch is switched on.** Before it,
> enabling dispatch would have mailed roughly 12 messages a week of which four
> were recoveries with no mailed opening; with it, those four are suppressed.

**A recovery is mailed only if the same episode already mailed.** Without this a
responder receives the END of an incident whose START this channel never
mentioned — the severity floor suppresses a `warning` opening, and the `recovered`
event is admitted by `recovery_notifications_enabled` through its own switch,
bypassing the floor entirely.

**Measured before it was written, on live data (2026-09-09).** Of the 12 emails
the previous seven days would have produced had dispatch been on, **four were
`lazywait:sync_degraded` recoveries with no mailed opening** — a third of the
volume, and the least actionable third.

**It is the missing half of a guard that already existed**, not a new rule. The
evaluator's recovery pass already refuses to notify about a recovery that was
never announced; it just measures `last_notified_at`, which the in-app inbox
sets. Email now asks the question about itself.

| | |
| --- | --- |
| Scope | `alert_id` — **episode**, not fingerprint. The open pass inserts a NEW state row per episode (`generation + 1`), so every event of one episode shares an id and the next episode has a different one. A fingerprint match would let a later episode inherit an earlier one's email |
| Admits | any earlier email for the episode, not specifically the opening — an episode that mailed an **escalation** has been announced, so its recovery is mailed |
| Untouched | `in_app` (a history needs its closings), the severity floor, the language rule, and `recovery_notifications_enabled` — which still suppresses recoveries independently |
| Deliverable, not delivered | The opening must be **capable of arriving**, not already sent. `cancelled`, `blocked` and `failed` **at the retry cap** do not pair — no claim path exists for them. `sent`, `pending`, `processing` and `failed` **inside** the budget all do |

**Why not simply require `status = 'sent'`?** Because the evaluator and the
dispatcher share a 5-minute cadence, and `lazywait:sync_degraded` has opened and
self-recovered *inside one interval* on every occasion it fired. A recovery
produced while its opening is still `pending` is therefore the **ordinary** case,
and pairing on `sent` would drop it permanently. The two errors are not equal: an
orphaned recovery is confusing, a **missing** recovery leaves a responder
believing an outage is still open. Review proposed the stricter rule on #352; the
suite's case 2b kills it, and cases 10c/10d pin the reason.

**The retry cap is a mirrored constant, and it is asserted rather than trusted.**
`attempt_count >= 5` is only correct while `claim_operations_alert_emails`
defaults `p_max_attempts` to 5 — which the dispatcher relies on by not passing the
argument. The migration's self-verification reads that default out of
`pg_get_function_arguments` and refuses to apply if it has moved.

**Mutation-tested, and one survivor is recorded rather than hidden.** Killed: the
guard computed-but-unapplied, the guard inverted, fingerprint scoping instead of
`alert_id`, and dropping the recovery switch. **Survived:** removing the
`alert_event_id <> p_event_id` self-exclusion — every current caller inserts the
event before calling the producer, so the current event cannot already own an
email row and the exclusion never changes an answer. It is kept as insurance
against a caller that pre-inserts, and documented as untested rather than covered
by a test that manufactures an unreachable state.

**The suite's own ordering was the bug mutation testing found.** The
episode-leak case originally ran before any email existed on that fingerprint, so
fingerprint scoping and `alert_id` scoping returned the same answer and the
assertion could not fail. It now runs after the escalation case and asserts its
own precondition. An assertion that cannot fail is not a test.

### Why the floor defaults to critical

Measured, not assumed. `lazywait:sync_degraded` has opened and self-recovered
inside the evaluator's own 5-minute interval on **all four** occasions it has
fired. At a `warning` floor those four non-events would have produced eight
emails. An alert mailbox that cries wolf is worse than no alert mailbox, so the
floor starts high and is a settings change away from lower.

### Why it stays inert on apply

`external_dispatch_enabled` is false, the migration does not change it, every
producer gate is `and external_dispatch_enabled`, and the handler re-checks the
flag itself — so turning it off later stops delivery of rows already queued, not
just the writing of new ones. The migration ends in a self-verification block
that raises if the flag moved or if a single `email` row exists.

Covered by `supabase/tests/operations_alert_email_dispatch_test.sql` (constraint
shape, the fence, the attempt budget, stale-lease recovery, producer gates,
recipient derivation) and by the source-shape tripwire
`supabase/functions/_shared/alertDispatchWiring.test.ts`.

---

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
- `branch_availability:health` — identity is the card; one fingerprint across
  every alertable state so an ageing restore backlog **escalates** rather than
  recovering and reopening. `restores_overdue` / `sweep_failing` /
  `unavailable` are warnings; `restores_stalled` (anything more than 30 minutes
  past its restore time) is critical. `idle` and `healthy` emit nothing. Muted
  with `system_rule_overrides.branch_availability.muted`.
- `<system>:configuration` — optional systems, **opt-in only**

`branch_availability` is a **non-critical card that can raise a critical
alert**, and that is deliberate rather than an inconsistency: the card's
`critical` flag decides whether it may move the *platform* rollup, while alert
severity says how loudly to shout. `payment` has worked the same way since
20260807. `branch_availability:health` is also **not** gated behind
`optional_system_alerts_enabled` — that flag exists for the *configuration*
states of optional integrations, not for a real failure of an always-on
internal mechanism.

**Where the per-card arms live.** Since `20260810113500` the arms are in
`operations_alerts_derive_pre_stranded`; `operations_alerts_derive` is a thin
wrapper that calls it and appends the independent
`order_integrity:stranded_orders` critical condition. Re-emitting the arms under
the wrapper's name silently deletes that stranded-order alert — whose entire
purpose is that a warning cannot mask it. Add new arms to the renamed function.

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
  never notified or recovery notifications are off). **That suppression is
  measured on `last_notified_at`, which is channel-agnostic** — it is set on open
  and on escalation regardless of severity, so a `warning` that only ever
  appeared in the in-app inbox satisfies it. Email answers the same question for
  itself; see *Recovery email pairing* below.
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

Applying the **engine migration** (`20260723090000`) alone therefore
changes **no runtime behavior**: nothing runs, nothing alerts, nothing is
sent. It is the separate **activation migration** (`20260723120000`, next
section) that enables the two internal engines and schedules the recurring
jobs — external dispatch stays disabled either way.

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
card now covers all five crons — the three critical application crons plus
these two automation crons, the latter with per-cadence staleness windows
(see the delivered follow-up below).

**Expected skipped runs (safe, routine)**
- `before_digest_time` — hourly digest tick before 08:00 local. Normal.
- digest `generated: []` after the day's digest exists. Normal.
- `overlap_skipped` — a tick fired while the previous one still ran. Safe
  by design; frequent occurrences suggest load worth investigating.

**A run needs attention when** `status = 'failed'` (carries a fixed
`safe_error_code`, never a raw message). Repeated failures → use the safe
disable below and investigate; a single transient failure self-heals on
the next tick.

**Automation job health monitoring (DELIVERED — migration
`20260723140000_operations_automation_cron_health`, Issue #79).** The
Operations Health scheduled-jobs card now also observes these two
automation crons, each with a **per-cadence staleness window** (evaluator
`*/5` → 15 min; hourly digest → 130 min) so a healthy-but-idle job between
ticks is never mislabelled failing — the flaw a single flat 6-minute rule
would have caused. They are monitored as **non-critical** jobs: the
platform-critical `database_jobs` rollup (which feeds the overall
Operations Health state via `operations_health_overall_state`) is computed
from the three critical application crons ONLY, so a stuck internal
automation cron surfaces as a **warning** attention item
(`OPERATIONS_AUTOMATION_JOBS_*`) plus a truthful `automation_state` and job
row, without ever flipping the platform to failing. The alert evaluator
likewise now derives a per-job condition
(`database_jobs:job_health:<jobname>`) for them at **warning** severity
(per-job alert severity follows the job's `critical` flag; the three
critical crons stay critical). The `operations_alert_runs` ledger queries
above remain the way to see the evaluator/digest INTERNAL outcomes (skips,
safe error codes). Note that an evaluator that is itself down can never
self-report internally — that gap is inherent to v1's internal-only design
and is what a future external-delivery version addresses; the digest cron's
health, however, IS observed by the (separate) evaluator and by this card.

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
