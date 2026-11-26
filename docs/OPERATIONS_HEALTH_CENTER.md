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

The overall platform state is derived only from these critical systems.
*(Corrected 2026-11-26: the list is the original four. `20260807150000` added a
fifth critical system, **Order Flow** (`order_flow`: orders failing to arrive),
which the snapshot marks critical and passes to the five-argument
`operations_health_overall_state`, so Order Flow can turn the platform
`failing`. `OPERATIONS_ALERTS_DIGEST.md` lists all five.)*

1. **Lazywait Sync** — `public.lazywait_sync_health_summary()` remains the
   authoritative state source.
2. **Order Integrity** — `public.order_integrity_health_summary()` remains the
   authoritative state source.
3. **Account Deletion Processor** — allowlisted pg_cron execution evidence plus
   safe queue counts (`due`, `manual_review`, oldest due time).
4. **Database & Scheduled Jobs** — three **critical** allowlisted application
   jobs whose health feeds the platform rollup: `account-deletion-processor`,
   `lazywait-sync`, and `order-integrity-watchdog`.

   The same card also observes three **non-critical** internal automation crons
   — `operations-alerts-evaluator`, `operations-digest-generator` and
   `branch-availability-sweep` — under a separate `automation_state` rollup.
   They surface as warning-level attention items and deliberately never affect
   `database_jobs.state` or the overall platform state. Each job carries its own
   staleness window sized to its cadence, so a healthy-but-idle sparse job is
   never mislabelled failing.

A missing or temporarily unavailable critical health source degrades the overall
platform state. A proven critical failure makes it failing. A verified
configuration error has the highest precedence.

### Optional/informational systems

- **Branch Availability** — whether timed item, **size**, option and delivery
  closures actually reopen. `degraded` once anything is more than 5 minutes past
  its restore time (five missed ticks of a one-minute sweep, so a single unlucky
  run is not a backlog) or when the most recent sweep run in
  `branch_availability_runs` failed; `failing` past 30 minutes; `idle` on a fresh
  database with nothing closed and no sweep recorded yet.

  **Sizes joined the card in `20260925120000`, and the gap before that is worth
  stating rather than quietly closing.** `20260923120000` added a fourth
  availability table, `branch_variant_availability`, and this card enumerates the
  tables it reads BY NAME in three places — the counters, the overdue-restore
  UNION and the `idle` warm-up. None of them knew about it, so a price tier whose
  restore timer ran out and was never honoured read **`idle`**: not `healthy`,
  but the fail-quiet warm-up, with no alert at all. The card now counts closed
  sizes under its own `closed_sizes` key, deliberately separate from
  `closed_options` — a size is a third level, not a kind of option, and on this
  menu 59 of 61 products carry sizes against one carrying an option group. The
  alert evidence carries `closed_sizes` too, so a responder is never told "0
  products, 0 options" while the whole backlog is sizes.

  `closed_products`, `closed_options` and `closed_sizes` count **timed** closures
  only. An untimed one — an administrator delisting something indefinitely — is
  reported under `untimed_closures` and never drives the state, because that is a
  decision rather than a backlog.

  **This is not the `branch-availability-sweep` cron entry on the Scheduled Jobs
  card, and the difference is the reason the card exists.**
  `branch_availability_sweep` catches its own exceptions: it records
  `status='failed'` in its ledger and then returns normally, so pg_cron reports
  the run as `succeeded`. The Scheduled Jobs card would show the sweeper healthy
  while every sweep failed. Only the ledger plus the availability state can see
  that.

  **The ledger is bounded.** Since `20260822090000` the sweeper prunes
  `branch_availability_runs` to 14 days on every productive tick, matching what
  `lazywait_sync_requests` has always done — a once-a-minute ledger otherwise
  grows by ~1,440 rows a day forever. The card is unaffected either way: it
  reads only the newest run and the newest success, both index-served. The
  prune is separately guarded so a housekeeping failure can never stop a sweep,
  and `rows_pruned` on each ledger row records what it removed. Nothing alerts
  on that column; a table growing while it sits at 0 is the signal. The audit
  table `branch_availability_events` is never pruned — that is a business
  record and its retention is an open question, not a housekeeping one.

  Non-critical: a stalled sweeper leaves things closed longer than intended,
  which over-blocks and never over-sells. It is absent from `critical_systems`
  and cannot move the overall platform state.

  Counts only — closed items, closed options, paused branches, disabled areas,
  overdue restores. **No branch is ever named here.** Operations Health is
  read-only; the call-centre console is where an operator sees which branch and
  acts on it.

- **Payment / Moyasar** — enabled/configured metadata, safe payment status counts,
  recent stale initiated attempts, latest paid time, and payment-related Order
  Integrity incident counts. No provider availability probe exists in v1.

  *Changed 2026-11-14, live since 2026-11-17, when `20261013120000` was
  applied* (`MIGRATIONS.md` §65, gap PG-25). **A stale attempt now means money
  taken without a confirmed order.** Until the apply, the card read `degraded`
  for any attempt created in the last 24 hours and still `initiated` 30 minutes
  after it opened, and every customer who closes the card page leaves exactly
  that. Since the apply, an attempt counts only if a payment settled on it
  (`provider_ref` set). `provider_ref` is written in one place,
  `stampPaymentRef` in `supabase/functions/_shared/moyasarVerify.ts`, for a
  paid payment that binds to the attempt, just before the order is confirmed,
  and a confirmation moves the row on. So an attempt still `initiated` with it
  is a payment Moyasar took whose confirmation did not finish. The card's line
  for it reads "A payment went through at Moyasar, but its order was not
  confirmed within 30 minutes." The console chooses that wording only when the
  payment card carries `open_unverified_24h`, the key only the new body emits,
  so a console deployed before the apply keeps the old wording ("Payment
  attempts remained initiated for more than 30 minutes.") for the old count.

  **What this gives up, stated rather than buried.** `provider_ref` is stamped
  only when a verify runs: the webhook, or the customer's return to the app.
  If the customer pays and closes the tab, and the webhook also never arrives
  (for example a wrong webhook token), nothing verifies the payment, nothing
  stamps it, and the attempt looks exactly like an abandoned checkout. Before
  this change it was counted, inside the noise. After it, the stale count no
  longer sees it, and no watchdog rule does either: R2-R6 read paid rows, and
  R17 needs a verify to have run. So the card keeps the old count as a
  separate figure, **"Open unverified 24h"** (`open_unverified_24h`): the same
  window, on attempts no payment was verified on. It does **not** move the
  state, because nearly every row it counts is an abandoned checkout, but the
  number stays on the card. A figure well above the day's usual abandoned
  checkouts is worth a look in Moyasar's dashboard. Telling the real payments
  apart needs a sweep that asks Moyasar about each open invoice; that is not
  built (`PAYMENTS.md` §12).

  The other option, ignoring attempts past their invoice expiry, was not
  taken. The invoice expiry is 30 minutes (read live 2026-11-13), so an attempt
  open past 30 minutes is almost always past its expiry, and so is the
  money-taken case. That option would have hidden the one case worth a warning.

  The same file adds the four refund and payment rules R14-R17
  (`ORDER_INTEGRITY_WATCHDOG.md` §3) to the payment-related incident count, so
  the card reads `failing` for them as it does for R2-R6, while the payment
  row is enabled and configured.

  *Changed 2026-11-12.* The card was **Payment / Tap**. On the branch
  `feat/moyasar-only-20261111` the console labels it **Payment / Moyasar**
  (**الدفع / Moyasar**), and that reaches the console on merge. The database half
  was waiting for `20261003120000` (`OWNER_ACTIONS.md` §47.3), which was **applied
  2026-11-13 17:26:09 UTC** (`MIGRATIONS.md` row 115; corrected 2026-11-26 from
  "waits for ... to be applied"). The two bullets are the state **before** the apply
  and are history; rows already rendered keep "Payment / Tap". Before it:
  - the card's **configured** test was Tap's, so against the Moyasar row it
    read `not_configured`;
  - alert emails rendered by the database said **Payment / Tap**.

  After the apply, "configured" follows Moyasar's own rule: provider `moyasar`,
  the selected mode's secret key with the matching `sk_test_` / `sk_live_` prefix,
  and a webhook token for that mode. No merchant id is needed.
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

## Duplicate Moyasar payments — shown since `20261013120000` (2026-11-17)

**Added 2026-11-12.** If a customer pays twice for one order or checkout session,
the Moyasar-only payment code records the second payment as a `failed`
`payment_records` row with `failure_code = 'duplicate_payment'`, plus one
`integration_sync_logs` row with `error = 'duplicate_payment'`. It is never
reported paid.

**Until 2026-11-17, nothing on this page, and no alert, showed it.** The watchdog's
`MULTIPLE_SUCCESSFUL_CAPTURES` rule counts paid rows only, and a duplicate is
`failed`. An order's receipt shows only its newest payment record, so it may show
the duplicate or hide it. Nothing refunds a duplicate automatically; making that
automatic needs an owner decision (`OWNER_ACTIONS.md` §47.20).

**Changed 2026-11-14, live since 2026-11-17, when `20261013120000` was applied** (gap PG-02).
Each duplicate raises the critical watchdog rule R15, which turns the Order
Integrity card here to failing (and the payment card, while the payment row is
enabled and configured) and opens the critical `order_integrity:incidents`
alert. A payment that matched nothing (R16) and a
payment whose order was not confirmed (R17) do the same. Live Orders lists all
three in the admin-only card "Refunds and payments needing attention".

**How to find and refund one** — the read-only queries and the refund in the
Moyasar dashboard, which is a live money action and an owner approval — is owned
by [`PAYMENTS.md`](PAYMENTS.md) §10.

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
