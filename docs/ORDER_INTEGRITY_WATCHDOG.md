# Spicy Meal — Order Integrity Watchdog (v1, observe-only)

A server-side, **observe-only** monitoring system that scans operational
order / payment / Lazywait-sync state every two minutes, records deduplicated
**incidents** when an integrity rule fires, and populates a **safe alert
outbox** — without ever dispatching an alert or changing a single operational
row. It is the reconciliation "smoke detector": it watches, it records, it
never acts.

Migration: `supabase/migrations/20260721170000_order_integrity_watchdog.sql`
Tests: `supabase/tests/order_integrity_watchdog_test.sql`
Admin UI: **Admin → Order Integrity** (`src/components/admin/OrderIntegrityPanel.tsx`)

---

## 1. Scope — what it MAY and MUST NOT do

**MAY (the only side effects that exist):**
- READ operational state: `orders`, `payment_records`, `checkout_sessions`,
  `cron.job` (own job only).
- WRITE only to its own four isolated tables: `order_integrity_config`,
  `order_integrity_runs`, `order_integrity_incidents`,
  `order_integrity_alert_outbox`.
- Expose service-role / staff-gated health + incident read RPCs and two
  admin-only incident-triage RPCs (acknowledge, suppress).

**MUST NOT (verified by the test suite + review):**
- create or cancel an order; resend an order to Lazywait; retry, initialize,
  confirm or change a payment; issue or retry a refund; change any
  `lazywait_sync_state`; modify payment provider references; modify customer
  data; enable any integration (Push / SMTP / WhatsApp / …); **dispatch any
  notification**; or alter any existing scheduler frequency or business logic.
- The alert outbox is **POPULATED but NEVER SENT** in v1 — no dispatcher
  exists. Turning alerts on is a separate, owner-approved deliverable.

**No PII / secrets** ever land in watchdog tables or RPC output: no customer
names, phones, addresses, emails, payment secrets, raw/full provider
references, raw provider payloads, headers, tokens or credentials. Provider
references appear only as `md5` fingerprints. `order_number` and `branch_id`
are considered safe operational identifiers and are shown.

---

## 2. Definitions (verified against the live schema)

- **"successful / captured payment"** == `public.payment_records.status = 'paid'`
  — the exact marker set atomically by `confirm_order_payment` /
  `finalize_checkout_session`, which also mark the order paid and enforce
  `amount == order total` at capture time. (`payment_records.confirmed_at` is
  vestigial — always null — so the scanner uses `coalesce(confirmed_at,
  updated_at)` for capture age.)
- **usable POS reference** == `public.lazywait_pos_ref_is_usable(ref)` — the
  canonical JS-`.trim()`-equivalent helper (a whitespace-only marker is NOT a
  usable reference).
- `lazywait_sync_state` (text) values: `pending, syncing, synced, failed,
  blocked, dead_letter, skipped, awaiting_payment, confirmation_required`.
- `payment_status` enum: `pending, paid` (only). `order_type`: `delivery,
  pickup`.

---

## 3. Rules (11 supported)

Severity `critical` = a paid customer or a money/POS-consistency problem;
`warning` = an operational backlog worth watching. Each incident is
fingerprinted `RULE_CODE:ENTITY_ID` (one **active** incident per fingerprint).

| # | Rule code | Sev | Fires when |
|---|-----------|-----|------------|
| 1 | `PAID_ORDER_NOT_SYNCED` | critical | paid order of **either** type, not cancelled, `paid_at` > 5 min ago, `lazywait_sync_state ∈ {pending,failed,syncing,blocked}`, and NOT intentionally held (`sync_blocked_reason <> 'delivery_schema_unconfirmed'`). |
| 2 | `PAID_ORDER_AWAITING_PAYMENT` | critical | order is paid but still `lazywait_sync_state='awaiting_payment'` (the paid→pending flip was missed). |
| 3 | `CAPTURED_PAYMENT_WITHOUT_ORDER` | critical | `payment_records.status='paid'` for > 3 min but no corresponding **paid** order (DB-invariant variant — see §4). |
| 4 | `PAYMENT_AMOUNT_MISMATCH` | critical | a paid payment record's `round(amount,2)` differs from its order's `round(total,2)`. |
| 5 | `DUPLICATE_PROVIDER_REFERENCE` | critical | one paid provider reference (`reference_transaction`/`provider_ref`) maps to **> 1 distinct order**. |
| 6 | `MULTIPLE_SUCCESSFUL_CAPTURES` | critical | **> 1** paid `payment_records` row for a single order. |
| 7 | `PAID_ORDER_DEAD_LETTER` | critical | paid order of **either** type, not cancelled, `lazywait_sync_state='dead_letter'`. |
| 8 | `SYNCED_WITHOUT_USABLE_REFERENCE` | critical | `lazywait_sync_state='synced'` but the stored `lazywait_ref` is not usable (missing / whitespace-only). |
| 9 | `REFERENCE_WITH_NON_SYNCED_STATE` | critical | a usable `lazywait_ref` exists but state is not `synced` (and not cancelled). |
| 10 | `OVERDUE_SYNC_RETRY` | warning | `pending`/`failed`, not cancelled, retry is due (`sync_next_attempt_at <= now()` or null) AND overdue by > 10 min. Never fires before the scheduled retry time. |
| 11 | `ABANDONED_AWAITING_PAYMENT` | warning | unpaid `awaiting_payment` order older than 24 h (legacy checkouts excluded by the config cutoff — see §4). |

**Not implemented — `R12 REFUND_STUCK`:** there is no refunds table or refund
lifecycle anywhere in the schema, so the rule is intentionally omitted (a
provider-side stuck refund is not determinable from our database). Documented
here so the omission is explicit, not an oversight.

**Out of scope for v1 — provider-side capture reconciliation:** R3 detects the
*database* invariant (a captured payment row with no paid order). Detecting "the
provider captured money but nothing was ever recorded in our DB" requires a
provider-API reconciliation job, which is a separate future deliverable.

**Deliberately not a rule — `confirmation_required`:** a paid pickup order can rest
in `lazywait_sync_state='confirmation_required'`, the *designed* human-verification
state for ambiguous POS create outcomes (auto-retry intentionally disabled). Unlike
`dead_letter` (a "gave up" state with no other surface, covered by the safety-net R7),
`confirmation_required` already has a purpose-built operational surface —
`list_pos_confirmation_required()` and the admin **Orders Requiring Verification**
feed (migration `20260721120000`). It is therefore intentionally **not** duplicated
as a watchdog rule in v1 (kept to the approved 11-rule scope). A warning-level rule
for paid orders stuck in it past the POS deadline is a **documented v2 candidate**
pending owner approval.

---

## 4. Configuration (`order_integrity_config`) — no hard-coded IDs

All tunables live in this table as auditable data (`updated_by` / `updated_at`);
**no Production order IDs are hard-coded in the scanner logic.**

- `rule_enabled` — per-rule on/off map (all 11 supported rules default `true`).
  Setting a rule to `false` freezes it: its active incidents stop being updated
  **and stop being resolved** (they neither advance clean-counts nor close).
- `abandoned_awaiting_payment_since` — seeded to `now()` at apply time, so all
  pre-existing legacy abandoned checkouts are excluded from R11 by construction
  (no IDs, one-shot, auditable). R11 only alerts on rows created on/after it.
- `excluded_order_ids` — time-bounded per-order exclusions for documented,
  authorized test orders. Shape:
  `[{"order_id":"<uuid>","until":"<ts>","reason":"<text>"}]`; honoured only
  while `until > now()`.

---

## 5. Incident lifecycle & alerting

1. **Detect** → each scan builds the current set of firing fingerprints.
2. **Update** re-detected active incidents (occurrence + consecutive-detection
   counts up, clean-count reset; an expired suppression reverts to `open`).
3. **Open** a new incident for any detection without an active incident.
4. **Clean / resolve** active incidents NOT detected this run (enabled rules
   only): a resolve happens **only after two consecutive clean scans** (a single
   clean scan never closes an incident — avoids flapping).
5. **Alerts → outbox (never sent):**
   - `opened` — once per incident lifetime, for non-suppressed active incidents:
     `critical` after **≥ 2 consecutive detections**; `warning` after the
     incident has persisted **≥ 15 minutes**.
   - `recovery` — when an incident that had previously produced an `opened`/
     `escalated` alert resolves this run.

A resolved fingerprint that fires again opens a **new** incident, preserving the
full history of the prior one. Triage: **acknowledge** (open → acknowledged,
admin-only) or **suppress** (time-bounded, reason required, admin-only).
Suppressed incidents keep being detected (occurrence still counts) but are not
alert-eligible until the suppression expires.

---

## 6. Execution, overlap & fail-closed behaviour

- Scheduled via `pg_cron` job **`order-integrity-watchdog`**, `*/2 * * * *`
  (chosen to avoid collision with the existing `account-deletion-processor`
  and `lazywait-sync` every-minute jobs).
- **Overlap-safe:** a transaction-scoped advisory lock
  (`pg_try_advisory_xact_lock(748291035)`). If a run cannot take the lock it
  records a benign `failed / overlap_skipped` run and returns — no double scan.
- **Durable & fail-closed:** a `running` row is written to
  `order_integrity_runs` **before any validation**; the rule evaluation runs in
  an inner savepoint block; on **any** error the run is marked `failed` with a
  **SQLSTATE-only** safe code and the inner changes roll back — so a failed scan
  **never resolves an incident** and is always visible, never a silent success.
- **Required config validated fail-closed.** Before scanning, all three seeded
  keys are strictly checked: `rule_enabled` must be a JSON object,
  `abandoned_awaiting_payment_since` a non-null valid timestamp, and
  `excluded_order_ids` a JSON array (each key is a PRIMARY KEY, so exactly one
  row can exist). Any missing, null or malformed required key raises into the
  handler → a durable `failed` run tagged `watchdog configuration invalid`
  (→ `configuration_error` health), with **no** incident resolution and **no**
  silent fallback to scanning without the cutoff/exclusions.
- The scanner is `SECURITY DEFINER`, `search_path=public`, **service-role
  execute only** (revoked from `anon`/`authenticated`).

---

## 7. Health summary & admin surface

`order_integrity_health_summary()` (service-role) returns a 15-key safe object.
`overall_state` cascade (first match wins; watchdog runs every 2 min):

- `configuration_error` — the latest **decisive** run failed for a non-benign
  reason. A *decisive* run is a `success` or a `failed` run whose
  `safe_error_code <> 'overlap_skipped'`; `running` and `overlap_skipped` runs
  are **ignored** for state selection, so a benign newer run can never mask a
  real config failure. A later successful decisive run clears it.
- `failing` — cron missing/inactive; OR no successful run in 6 min (or none
  ever); OR ≥ 1 **unresolved** critical incident.
- `degraded` — ≥ 1 **unresolved** warning incident; OR the latest successful run
  is older than 4 min.
- `healthy` — cron active, a success within 4 min, zero unresolved critical and
  zero unresolved warning incidents.

**Unresolved-active counting (Acknowledge ≠ Fixed).** `open_critical_count` /
`open_warning_count` count every **non-resolved** incident of that severity —
`open` + `acknowledged` + `suppressed`. Acknowledging means "seen", and suppress
controls only alert noise; **neither removes an unresolved integrity defect from
health** (a critical stays `failing`, a warning stays `degraded`). Only
`status='resolved'` drops an incident from the active counts and from
`oldest_open_critical_at`. `acknowledged_count` / `suppressed_count` remain
separate informational fields.

Staff-gated RPCs power the admin panel: `order_integrity_admin_summary` (health),
`order_integrity_list_incidents` (safe list + `order_number`),
`order_integrity_incident_timeline` (one incident's safe audit history + its
alert rows). Admin-only triage RPCs: `order_integrity_acknowledge_incident`,
`order_integrity_suppress_incident`. The **Order Integrity** admin tab renders
these with **no** Retry / Refund / Resend / Mark-Paid / Auto-Fix action — read +
acknowledge + suppress only.

**Capability-gated tab (safe before Production migration).** The web app can be
deployed before the migration is applied. The dashboard probes
`order_integrity_admin_summary` on mount and shows the tab only when the RPCs
exist; a **confirmed** missing function (PostgREST `PGRST202`) is the *only*
signal that hides it (`src/lib/orderIntegrityCapability.ts`). Network / auth /
transient errors are treated as `unknown` and keep the tab visible so the error
surfaces in the panel rather than being mistaken for "migration absent". There is
no permanent hard-coded flag — once the migration is applied, the next refresh
reveals the tab automatically, and `OrderIntegrityPanel` is never mounted while
the capability is absent.

**Admin-only triage controls in the UI.** Accountants may read the panel (the
read RPCs are `is_staff()` gated) but the Acknowledge/Suppress controls render
**only for `role = 'admin'`** (`src/lib/orderIntegrityTriage.ts`), so the UI never
offers an action that would return 42501 — defense-in-depth in front of the
unchanged admin-only RPC authorization.

**Note-field redaction:** the two admin-entered free-text fields (`ack_note` inside
`safe_details`, and `suppression_reason`) are triage metadata an admin could
inadvertently type PII into. Both are written only by `is_admin()` callers and are
**redacted for non-admin staff** (e.g. accountants) in the list/timeline
projections, so they never cross a privilege tier. All automatically-derived
`safe_details` fields remain visible to all staff.

---

## 8. Phase A baseline (read-only, no PII — at build time)

Production inspection used to size the rules and seed the legacy cutoff (counts
only, no customer data read):

- Orders: 17 total, all `pickup`; sync states `synced`=13,
  `awaiting_payment`=3, `skipped`=1; **0 paid**.
- `payment_records`: 9 (6 `failed`, 3 `initiated`, 0 `paid`).
- Rule baselines all **0** except `ABANDONED_AWAITING_PAYMENT` = 3 legacy
  abandoned checkouts (> 24 h old), which the `abandoned_awaiting_payment_since`
  cutoff excludes by construction on day one.

So on first activation the watchdog is expected to report **healthy** with zero
incidents.

---

## 9. Enable / disable / rollback (all non-destructive)

```sql
-- Pause scanning (keeps all history):
select cron.unschedule('order-integrity-watchdog');

-- Freeze a single rule (its active incidents stop updating/resolving):
update public.order_integrity_config
   set value = jsonb_set(value, '{OVERDUE_SYNC_RETRY}', 'false')
 where key = 'rule_enabled';

-- Full removal: unschedule (above), then drop the functions and the four
-- tables (see the migration header for the exact DROP list). Dropping the
-- watchdog cannot affect orders, payments, POS sync, or any business logic —
-- the objects are self-contained.
```

The migration is **additive and idempotent** (create-or-replace, `IF NOT
EXISTS`, `ON CONFLICT DO NOTHING` seeds, and a cron guard that only rejects a
*foreign* job of the same name). It edits no existing object.

---

## 10. Change control

Repository-only until an owner-approved application. Apply **only** through the
`apply_migration` workflow in `docs/MIGRATIONS.md`; never `supabase db push` or
`migration repair`. Enabling alert dispatch, adding provider-side capture
reconciliation, or any automatic remediation are **separate** future
deliverables that each need their own explicit owner approval.
