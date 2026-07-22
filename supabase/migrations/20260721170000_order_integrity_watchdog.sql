-- ============================================================================
-- Order Integrity Watchdog v1 — OBSERVE-ONLY SHADOW MODE.
--
-- Additive, isolated monitoring. This migration adds ONLY new watchdog objects.
-- It reads operational order/payment/sync state and records incidents; it does
-- NOT create/cancel orders, resend Lazywait, retry/confirm/refund payments,
-- change any lazywait_sync_state, touch payment provider references, modify
-- customer data, enable any integration, or dispatch any notification. The
-- alert outbox is POPULATED but NEVER SENT in v1. No existing table, function,
-- trigger, scheduler frequency, or business logic is changed.
--
-- Objects added (all public, all new):
--   * order_integrity_config       — auditable, time-bounded exclusion/enablement
--   * order_integrity_runs         — durable per-run ledger
--   * order_integrity_incidents    — deduplicated incident store (1 active/fingerprint)
--   * order_integrity_alert_outbox — safe alert outbox (unsent in v1)
--   * order_integrity_watchdog()   — SECURITY DEFINER scanner (service-role only)
--   * order_integrity_health_summary() — service-role aggregate health
--   * admin RPCs: acknowledge / suppress / list / timeline / admin_summary
--   * cron job 'order-integrity-watchdog' every 2 minutes
--
-- SAFETY: no customer names/phones/addresses, no payment secrets, no full
-- provider references, no raw provider payloads, no headers/tokens/credentials
-- are ever stored in watchdog tables. Payment references are fingerprinted
-- (md5) or reduced to the internal payment_records.id / card last-four only.
--
-- RULES (evaluated against the VERIFIED current schema):
--   CRITICAL
--     1 PAID_ORDER_NOT_SYNCED        paid pickup, not synced, >5m, not cancelled/intentionally-blocked
--     2 PAID_ORDER_AWAITING_PAYMENT  paid order still lazywait_sync_state='awaiting_payment'
--     3 CAPTURED_PAYMENT_WITHOUT_ORDER  payment_records.status='paid' >3m with no corresponding PAID order
--         (DB-invariant variant; a provider-side capture never recorded in our DB
--          is NOT determinable without provider-API reconciliation, which is OUT
--          OF SCOPE for v1 — see docs. A REFUND_STUCK rule is NOT implemented: no
--          refund table/lifecycle exists in the schema.)
--     4 PAYMENT_AMOUNT_MISMATCH      paid payment_records.amount <> orders.total (round(_,2))
--     5 DUPLICATE_PROVIDER_REFERENCE one paid provider reference on >1 order
--     6 MULTIPLE_SUCCESSFUL_CAPTURES >1 paid payment_records for one order
--     7 PAID_ORDER_DEAD_LETTER       paid pickup, lazywait_sync_state='dead_letter'
--     8 SYNCED_WITHOUT_USABLE_REFERENCE  state='synced' AND NOT lazywait_pos_ref_is_usable(ref)
--     9 REFERENCE_WITH_NON_SYNCED_STATE  usable ref AND state <> 'synced'
--   WARNING
--     10 OVERDUE_SYNC_RETRY          pending/failed, due, overdue >10m (never before sync_next_attempt_at)
--     11 ABANDONED_AWAITING_PAYMENT  unpaid awaiting_payment >24h (legacy excluded via config baseline)
--   NOT a rule (deliberate): lazywait_sync_state='confirmation_required' is the designed
--     human-verification state with its own admin feed (list_pos_confirmation_required);
--     a paid-stuck-in-confirmation warning is a documented v2 candidate, not v1 scope.
--
-- "successful/captured payment" == public.payment_records.status = 'paid' (the
-- exact marker set by confirm_order_payment / finalize_checkout_session, which
-- also mark the order paid and enforce amount == order total at capture time).
--
-- ROLLBACK / DISABLE (safe, non-destructive):
--   Disable scanning:  select cron.unschedule('order-integrity-watchdog');
--   Full removal:      drop the cron job (above), then
--                      drop function public.order_integrity_watchdog(),
--                        public.order_integrity_health_summary(),
--                        public.order_integrity_admin_summary(),
--                        public.order_integrity_list_incidents(text,text,text,uuid,integer),
--                        public.order_integrity_incident_timeline(uuid),
--                        public.order_integrity_acknowledge_incident(uuid,text),
--                        public.order_integrity_suppress_incident(uuid,timestamptz,text);
--                      drop table public.order_integrity_alert_outbox,
--                        public.order_integrity_incidents,
--                        public.order_integrity_runs,
--                        public.order_integrity_config;
--   (Watchdog objects are self-contained; dropping them cannot affect orders,
--    payments, POS sync, or any business logic.)
--
-- Idempotent: create-or-replace, IF NOT EXISTS, ON CONFLICT DO NOTHING seeds.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;  -- gen_random_uuid (already present)
create extension if not exists pg_cron;                          -- already present in production

-- ---- 0. No-FOREIGN-scanner guard (idempotent) ------------------------------
-- Raise only if a job named 'order-integrity-watchdog' exists that is NOT ours
-- (a foreign/colliding job). Re-applying this migration is safe: our own job's
-- command references order_integrity_watchdog and cron.schedule(name,...) below
-- upserts the job by name, so a re-apply updates in place rather than colliding.
do $$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobname = 'order-integrity-watchdog' limit 1;
  if v_cmd is not null and v_cmd not ilike '%order_integrity_watchdog%' then
    raise exception
      'a foreign cron job named "order-integrity-watchdog" already exists; verify/remove it before enabling this watchdog';
  end if;
end $$;

-- ---- 1. Config: auditable, time-bounded exclusions / enablement -------------
-- The ONLY exclusion mechanism. No Production order IDs are hard-coded in the
-- watchdog logic; legacy/test exclusions live here as data (with a reason and,
-- for entity exclusions, an expiry).
create table if not exists public.order_integrity_config (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table public.order_integrity_config enable row level security;
revoke all on public.order_integrity_config from public, anon, authenticated;

-- rule_enabled: per-rule on/off (default all supported rules on).
insert into public.order_integrity_config (key, value, description) values
  ('rule_enabled',
   jsonb_build_object(
     'PAID_ORDER_NOT_SYNCED', true, 'PAID_ORDER_AWAITING_PAYMENT', true,
     'CAPTURED_PAYMENT_WITHOUT_ORDER', true, 'PAYMENT_AMOUNT_MISMATCH', true,
     'DUPLICATE_PROVIDER_REFERENCE', true, 'MULTIPLE_SUCCESSFUL_CAPTURES', true,
     'PAID_ORDER_DEAD_LETTER', true, 'SYNCED_WITHOUT_USABLE_REFERENCE', true,
     'REFERENCE_WITH_NON_SYNCED_STATE', true, 'OVERDUE_SYNC_RETRY', true,
     'ABANDONED_AWAITING_PAYMENT', true),
   'Per-rule enable flags. Set a rule to false to freeze it (its active incidents stop updating/resolving).')
on conflict (key) do nothing;

-- abandoned_awaiting_payment_since: rule 11 only alerts on awaiting_payment rows
-- created on/after this cutoff. Seeded at apply time so all pre-existing legacy
-- abandoned checkouts are excluded by construction (no IDs, auditable, one-shot).
insert into public.order_integrity_config (key, value, description) values
  ('abandoned_awaiting_payment_since', to_jsonb(now()),
   'ABANDONED_AWAITING_PAYMENT ignores awaiting_payment orders created before this timestamp (legacy abandoned checkouts).')
on conflict (key) do nothing;

-- excluded_order_ids: time-bounded, auditable per-order exclusions for
-- documented authorized test orders. Shape: [{"order_id":"<uuid>","until":"<ts>","reason":"<text>"}].
insert into public.order_integrity_config (key, value, description) values
  ('excluded_order_ids', '[]'::jsonb,
   'Time-bounded per-order exclusions (authorized test orders). Each entry {order_id, until, reason}; honoured only while until > now().')
on conflict (key) do nothing;

comment on table public.order_integrity_config is
  'Order Integrity Watchdog configuration: per-rule enablement, the abandoned-awaiting-payment legacy cutoff, and time-bounded per-order test exclusions. Auditable (updated_by/updated_at); no Production IDs hard-coded in logic.';

-- ---- 2. Durable run ledger --------------------------------------------------
create table if not exists public.order_integrity_runs (
  id                   bigint generated always as identity primary key,
  started_at           timestamptz not null default now(),
  completed_at         timestamptz,
  status               text not null default 'running' check (status in ('running','success','failed')),
  rules_evaluated      integer not null default 0,
  incidents_detected   integer not null default 0,
  incidents_opened     integer not null default 0,
  incidents_updated    integer not null default 0,
  incidents_resolved   integer not null default 0,
  safe_error_code      text,
  safe_error_message   text,
  duration_ms          integer
);
create index if not exists order_integrity_runs_started_idx on public.order_integrity_runs (started_at desc);
create index if not exists order_integrity_runs_status_idx  on public.order_integrity_runs (status, started_at desc);
alter table public.order_integrity_runs enable row level security;
revoke all on public.order_integrity_runs from public, anon, authenticated;

comment on table public.order_integrity_runs is
  'Durable per-run ledger for the order integrity watchdog. Safe operational fields only (counts, status, SQLSTATE-only error code, duration). No PII, no order/payment payloads.';

-- ---- 3. Incident store (1 active incident per fingerprint) ------------------
create table if not exists public.order_integrity_incidents (
  id                          uuid primary key default gen_random_uuid(),
  fingerprint                 text not null,               -- RULE_CODE:ENTITY_ID
  rule_code                   text not null,
  severity                    text not null check (severity in ('warning','critical')),
  entity_type                 text not null check (entity_type in ('order','payment','session')),
  order_id                    uuid references public.orders(id) on delete set null,
  payment_record_id           uuid references public.payment_records(id) on delete set null,
  session_id                  uuid references public.checkout_sessions(id) on delete set null,
  branch_id                   uuid,                         -- safe, no FK needed
  status                      text not null default 'open'
                                check (status in ('open','acknowledged','resolved','suppressed')),
  first_detected_at           timestamptz not null default now(),
  last_detected_at            timestamptz not null default now(),
  occurrence_count            integer not null default 1,
  consecutive_detection_count integer not null default 1,
  consecutive_clean_count     integer not null default 0,
  safe_details                jsonb not null default '{}'::jsonb,
  acknowledged_at             timestamptz,
  acknowledged_by             uuid references public.profiles(id) on delete set null,
  suppression_until           timestamptz,
  suppression_reason          text,
  resolved_at                 timestamptz,
  resolution_reason           text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
-- INVARIANT: at most one ACTIVE (non-resolved) incident per fingerprint. A new
-- occurrence after resolution opens a NEW incident, preserving full history.
create unique index if not exists order_integrity_incidents_active_fp
  on public.order_integrity_incidents (fingerprint) where status <> 'resolved';
create index if not exists order_integrity_incidents_status_idx
  on public.order_integrity_incidents (status, severity, last_detected_at desc);
create index if not exists order_integrity_incidents_rule_idx
  on public.order_integrity_incidents (rule_code, status);
create index if not exists order_integrity_incidents_order_idx
  on public.order_integrity_incidents (order_id) where order_id is not null;
alter table public.order_integrity_incidents enable row level security;
revoke all on public.order_integrity_incidents from public, anon, authenticated;

comment on table public.order_integrity_incidents is
  'Deduplicated order-integrity incidents (one active incident per RULE_CODE:ENTITY_ID fingerprint). safe_details holds only non-PII fields (order_number, states, amounts, ages, branch, masked ref). Full audit history preserved via first/last detected, occurrence/consecutive counts, ack/suppression/resolution fields.';

-- ---- 4. Safe alert outbox (POPULATED but UNSENT in v1) ----------------------
create table if not exists public.order_integrity_alert_outbox (
  id            uuid primary key default gen_random_uuid(),
  incident_id   uuid not null references public.order_integrity_incidents(id) on delete cascade,
  alert_type    text not null check (alert_type in ('opened','escalated','recovery')),
  severity      text not null check (severity in ('warning','critical')),
  payload_safe  jsonb not null default '{}'::jsonb,
  status        text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),
  available_at  timestamptz not null default now(),
  attempt_count integer not null default 0,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);
-- Dedup: at most one PENDING alert of a given type per incident.
create unique index if not exists order_integrity_alert_outbox_pending_uq
  on public.order_integrity_alert_outbox (incident_id, alert_type) where status = 'pending';
create index if not exists order_integrity_alert_outbox_status_idx
  on public.order_integrity_alert_outbox (status, available_at);
alter table public.order_integrity_alert_outbox enable row level security;
revoke all on public.order_integrity_alert_outbox from public, anon, authenticated;

comment on table public.order_integrity_alert_outbox is
  'Safe alert outbox for the order integrity watchdog. v1 populates it (opened/escalated/recovery) but NEVER dispatches — no sender exists. payload_safe carries only non-PII summary fields.';

-- ---- 5. The watchdog scanner ------------------------------------------------
-- SECURITY DEFINER, pinned search_path, service-role-only. Overlap-safe via a
-- transaction-scoped advisory lock. Fail-closed: a durable 'running' row is
-- written BEFORE any evaluation; any error updates that row to 'failed' with a
-- SQLSTATE-only safe code (never resolving incidents), so missing prerequisites
-- or internal errors surface as a VISIBLE failed run, never silent success.
create or replace function public.order_integrity_watchdog()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  c_lock_key   constant bigint := 748291035;   -- fixed advisory key for this watchdog
  v_run_id     bigint;
  v_start      timestamptz := clock_timestamp();
  v_stage      text := 'init';                  -- which phase failed (for a safe error message)
  v_rules      jsonb;
  v_since      timestamptz;
  v_since_raw  jsonb;
  v_excl_raw   jsonb;
  v_excluded   uuid[];
  v_evaluated  integer := 0;
  v_detected   integer := 0;
  v_opened     integer := 0;
  v_updated    integer := 0;
  v_resolved   integer := 0;
begin
  -- Durable run row FIRST (before any validation) so failures are always visible.
  insert into public.order_integrity_runs (status) values ('running') returning id into v_run_id;

  -- Overlap prevention: skip if another run holds the lock. Recorded as failed
  -- with a benign code so it is visible but does not count as success.
  if not pg_try_advisory_xact_lock(c_lock_key) then
    update public.order_integrity_runs
       set status='failed', completed_at=now(),
           safe_error_code='overlap_skipped',
           safe_error_message='another watchdog run holds the advisory lock',
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;
    return v_run_id;
  end if;

  begin
    -- Load + STRICTLY validate ALL required config keys (fail-CLOSED). Each key
    -- is PRIMARY KEY so at most one row can exist; a missing, null or wrong-typed
    -- value raises into the handler, marking the run failed with a safe config
    -- error — the scanner NEVER silently proceeds without the cutoff/exclusions.
    v_stage := 'config';

    -- rule_enabled: present + JSON object.
    select value into v_rules from public.order_integrity_config where key = 'rule_enabled';
    if v_rules is null then
      raise exception 'config key rule_enabled is missing' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_rules) <> 'object' then
      raise exception 'config key rule_enabled must be a JSON object' using errcode = 'P0001';
    end if;

    -- abandoned_awaiting_payment_since: present + non-null valid timestamp.
    select value into v_since_raw from public.order_integrity_config
      where key = 'abandoned_awaiting_payment_since';
    if v_since_raw is null then
      raise exception 'config key abandoned_awaiting_payment_since is missing' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_since_raw) = 'null' then
      raise exception 'config key abandoned_awaiting_payment_since is null' using errcode = 'P0001';
    end if;
    begin
      v_since := (v_since_raw #>> '{}')::timestamptz;
    exception when others then
      raise exception 'config key abandoned_awaiting_payment_since is not a valid timestamp' using errcode = 'P0001';
    end;
    if v_since is null then
      raise exception 'config key abandoned_awaiting_payment_since is null' using errcode = 'P0001';
    end if;

    -- excluded_order_ids: present + JSON array.
    select value into v_excl_raw from public.order_integrity_config where key = 'excluded_order_ids';
    if v_excl_raw is null then
      raise exception 'config key excluded_order_ids is missing' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_excl_raw) <> 'array' then
      raise exception 'config key excluded_order_ids must be a JSON array' using errcode = 'P0001';
    end if;
    -- FAIL-CLOSED, never fail-OPEN: a malformed entry (missing/blank order_id)
    -- must NOT inject a NULL into v_excluded — `o.id <> all('{null}')` evaluates
    -- to NULL, which would silently suppress EVERY detection for EVERY rule. Skip
    -- entries without a usable order_id and strip any NULL defensively.
    select coalesce(array_remove(array_agg((e->>'order_id')::uuid), null), '{}')
      into v_excluded
      from jsonb_array_elements(v_excl_raw) e
     where nullif(e->>'order_id', '') is not null
       and (e->>'until') is not null
       and (e->>'until')::timestamptz > now();
    v_excluded := coalesce(v_excluded, '{}');

    v_stage := 'scan';

    -- Detections for this run. `if not exists` + truncate so repeated calls in a
    -- single session/transaction (e.g. tests) are safe; `on commit drop` clears
    -- it between real (committed) cron invocations.
    if to_regclass('pg_temp._det') is null then
      create temporary table _det (
        fingerprint       text primary key,
        rule_code         text not null,
        severity          text not null,
        entity_type       text not null,
        order_id          uuid,
        payment_record_id uuid,
        session_id        uuid,
        branch_id         uuid,
        safe_details      jsonb not null
      ) on commit drop;
    end if;
    truncate table _det;
    if to_regclass('pg_temp._resolved') is null then
      create temporary table _resolved (id uuid primary key) on commit drop;
    end if;
    truncate table _resolved;

    -- helper macro (inline): a rule is enabled unless explicitly false.
    -- R1 PAID_ORDER_NOT_SYNCED (critical)
    if coalesce((v_rules->>'PAID_ORDER_NOT_SYNCED'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'PAID_ORDER_NOT_SYNCED:'||o.id, 'PAID_ORDER_NOT_SYNCED', 'critical', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'order_type', o.order_type,
          'lazywait_sync_state', o.lazywait_sync_state, 'sync_attempt_count', o.sync_attempt_count,
          'paid_age_seconds', floor(extract(epoch from (now() - o.paid_at)))::bigint,
          'sync_blocked_reason', o.sync_blocked_reason)
      from public.orders o
      where o.payment_status = 'paid' and o.order_type = 'pickup' and o.status <> 'cancelled'
        and o.paid_at is not null and o.paid_at < now() - interval '5 minutes'
        and o.lazywait_sync_state in ('pending','failed','syncing','blocked')
        and coalesce(o.sync_blocked_reason,'') <> 'delivery_schema_unconfirmed'
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R2 PAID_ORDER_AWAITING_PAYMENT (critical)
    if coalesce((v_rules->>'PAID_ORDER_AWAITING_PAYMENT'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'PAID_ORDER_AWAITING_PAYMENT:'||o.id, 'PAID_ORDER_AWAITING_PAYMENT', 'critical', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'order_type', o.order_type,
          'lazywait_sync_state', o.lazywait_sync_state,
          'paid_age_seconds', floor(extract(epoch from (now() - o.paid_at)))::bigint)
      from public.orders o
      where o.payment_status = 'paid' and o.lazywait_sync_state = 'awaiting_payment'
        and o.status <> 'cancelled' and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R3 CAPTURED_PAYMENT_WITHOUT_ORDER (critical) — DB-invariant variant.
    if coalesce((v_rules->>'CAPTURED_PAYMENT_WITHOUT_ORDER'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'CAPTURED_PAYMENT_WITHOUT_ORDER:'||pr.id, 'CAPTURED_PAYMENT_WITHOUT_ORDER', 'critical', 'payment',
        pr.order_id, pr.id, pr.checkout_session_id, null,
        jsonb_build_object('provider', pr.provider,
          'capture_age_seconds', floor(extract(epoch from (now() - coalesce(pr.confirmed_at, pr.updated_at))))::bigint,
          'has_order_id', (pr.order_id is not null),
          'ref_fingerprint', md5(pr.provider||':'||coalesce(pr.provider_ref, pr.reference_transaction, '')))
      from public.payment_records pr
      where pr.status = 'paid'
        and coalesce(pr.confirmed_at, pr.updated_at) < now() - interval '3 minutes'
        and not exists (select 1 from public.orders o
                         where o.id = pr.order_id and o.payment_status = 'paid')
      on conflict do nothing;
    end if;

    -- R4 PAYMENT_AMOUNT_MISMATCH (critical) — currency-safe numeric compare.
    if coalesce((v_rules->>'PAYMENT_AMOUNT_MISMATCH'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'PAYMENT_AMOUNT_MISMATCH:'||pr.id, 'PAYMENT_AMOUNT_MISMATCH', 'critical', 'payment',
        o.id, pr.id, pr.checkout_session_id, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'provider', pr.provider,
          'captured_amount', round(pr.amount, 2), 'order_total', round(o.total, 2),
          'currency', pr.currency)
      from public.payment_records pr
      join public.orders o on o.id = pr.order_id
      where pr.status = 'paid' and round(pr.amount, 2) is distinct from round(o.total, 2)
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R5 DUPLICATE_PROVIDER_REFERENCE (critical) — one paid ref on >1 order.
    if coalesce((v_rules->>'DUPLICATE_PROVIDER_REFERENCE'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det
      select
        'DUPLICATE_PROVIDER_REFERENCE:'||g.ref_fp, 'DUPLICATE_PROVIDER_REFERENCE', 'critical', 'payment',
        null, null, null, null,
        jsonb_build_object('provider', g.provider, 'ref_fingerprint', g.ref_fp,
          'distinct_orders', g.n_orders)
      from (
        select pr.provider,
               md5(pr.provider||':'||coalesce(pr.reference_transaction, pr.provider_ref)) as ref_fp,
               count(distinct pr.order_id) as n_orders
        from public.payment_records pr
        where pr.status = 'paid' and coalesce(pr.reference_transaction, pr.provider_ref) is not null
        group by pr.provider, md5(pr.provider||':'||coalesce(pr.reference_transaction, pr.provider_ref))
        having count(distinct pr.order_id) > 1
      ) g
      on conflict do nothing;
    end if;

    -- R6 MULTIPLE_SUCCESSFUL_CAPTURES (critical) — >1 paid record per order.
    if coalesce((v_rules->>'MULTIPLE_SUCCESSFUL_CAPTURES'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det
      select
        'MULTIPLE_SUCCESSFUL_CAPTURES:'||g.order_id, 'MULTIPLE_SUCCESSFUL_CAPTURES', 'critical', 'order',
        g.order_id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'paid_capture_count', g.n)
      from (
        select pr.order_id, count(*) as n
        from public.payment_records pr
        where pr.status = 'paid' and pr.order_id is not null
        group by pr.order_id having count(*) > 1
      ) g
      join public.orders o on o.id = g.order_id
      where g.order_id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R7 PAID_ORDER_DEAD_LETTER (critical)
    if coalesce((v_rules->>'PAID_ORDER_DEAD_LETTER'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'PAID_ORDER_DEAD_LETTER:'||o.id, 'PAID_ORDER_DEAD_LETTER', 'critical', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'sync_attempt_count', o.sync_attempt_count,
          -- sync_last_error is set from safeErr(provider error), which only redacts
          -- Bearer tokens; a provider error body can echo our request (customer_name).
          -- Store only a boolean signal, never the raw text, to keep safe_details PII-free.
          'has_last_error', (o.sync_last_error is not null))
      from public.orders o
      where o.payment_status = 'paid' and o.order_type = 'pickup'
        and o.lazywait_sync_state = 'dead_letter' and o.status <> 'cancelled'
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R8 SYNCED_WITHOUT_USABLE_REFERENCE (critical)
    if coalesce((v_rules->>'SYNCED_WITHOUT_USABLE_REFERENCE'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'SYNCED_WITHOUT_USABLE_REFERENCE:'||o.id, 'SYNCED_WITHOUT_USABLE_REFERENCE', 'critical', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'lazywait_sync_state', o.lazywait_sync_state,
          'has_ref_marker', (o.lazywait_ref is not null))
      from public.orders o
      where o.lazywait_sync_state = 'synced'
        and not public.lazywait_pos_ref_is_usable(o.lazywait_ref)
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R9 REFERENCE_WITH_NON_SYNCED_STATE (critical)
    if coalesce((v_rules->>'REFERENCE_WITH_NON_SYNCED_STATE'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'REFERENCE_WITH_NON_SYNCED_STATE:'||o.id, 'REFERENCE_WITH_NON_SYNCED_STATE', 'critical', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'lazywait_sync_state', o.lazywait_sync_state)
      from public.orders o
      where public.lazywait_pos_ref_is_usable(o.lazywait_ref)
        and o.lazywait_sync_state is distinct from 'synced'
        and o.status <> 'cancelled'
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R10 OVERDUE_SYNC_RETRY (warning) — due AND overdue >10m; never before due.
    if coalesce((v_rules->>'OVERDUE_SYNC_RETRY'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'OVERDUE_SYNC_RETRY:'||o.id, 'OVERDUE_SYNC_RETRY', 'warning', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number, 'lazywait_sync_state', o.lazywait_sync_state,
          'overdue_seconds', floor(extract(epoch from (now() - coalesce(o.sync_next_attempt_at, o.updated_at))))::bigint,
          'sync_attempt_count', o.sync_attempt_count)
      from public.orders o
      where o.lazywait_sync_state in ('pending','failed') and o.status <> 'cancelled'
        and (o.sync_next_attempt_at is null or o.sync_next_attempt_at <= now())
        and coalesce(o.sync_next_attempt_at, o.updated_at) < now() - interval '10 minutes'
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- R11 ABANDONED_AWAITING_PAYMENT (warning) — unpaid >24h, legacy excluded.
    if coalesce((v_rules->>'ABANDONED_AWAITING_PAYMENT'), 'true') <> 'false' then
      v_evaluated := v_evaluated + 1;
      insert into _det select
        'ABANDONED_AWAITING_PAYMENT:'||o.id, 'ABANDONED_AWAITING_PAYMENT', 'warning', 'order',
        o.id, null, null, o.branch_id,
        jsonb_build_object('order_number', o.order_number,
          'age_hours', floor(extract(epoch from (now() - o.created_at))/3600)::bigint)
      from public.orders o
      where o.lazywait_sync_state = 'awaiting_payment'
        and o.payment_status is distinct from 'paid'
        and o.status <> 'cancelled'
        and o.created_at < now() - interval '24 hours'
        and (v_since is null or o.created_at >= v_since)
        and o.id <> all (v_excluded)
      on conflict do nothing;
    end if;

    -- DELIBERATE SCOPE NOTE — lazywait_sync_state='confirmation_required' is NOT a
    -- watchdog rule. It is the DESIGNED human-verification resting place for
    -- ambiguous POS create outcomes (auto-retry intentionally disabled), and it
    -- already has a purpose-built operational surface: list_pos_confirmation_required()
    -- and the admin "Orders Requiring Verification" feed (migration 20260721120000).
    -- Unlike dead_letter (a "gave up" state with no other surface → safety-net R7),
    -- confirmation_required is actively surfaced elsewhere, so it is intentionally
    -- not duplicated here. A warning-level rule for paid orders stuck in it past the
    -- POS deadline is a documented v2 candidate (see docs/ORDER_INTEGRITY_WATCHDOG.md),
    -- pending owner approval — this v1 stays at the approved 11-rule scope.

    select count(*) into v_detected from _det;

    -- (a) Update existing ACTIVE incidents that re-detected this run.
    with upd as (
      update public.order_integrity_incidents i
         set last_detected_at = now(),
             occurrence_count = i.occurrence_count + 1,
             consecutive_detection_count = i.consecutive_detection_count + 1,
             consecutive_clean_count = 0,
             status = case when i.status = 'suppressed'
                            and (i.suppression_until is null or i.suppression_until <= now())
                           then 'open' else i.status end,
             safe_details = d.safe_details,
             updated_at = now()
        from _det d
       where i.fingerprint = d.fingerprint and i.status <> 'resolved'
      returning i.id )
    select count(*) into v_updated from upd;

    -- (b) Open NEW incidents for detections without an active incident.
    with ins as (
      insert into public.order_integrity_incidents
        (fingerprint, rule_code, severity, entity_type, order_id, payment_record_id, session_id, branch_id, status, safe_details)
      select d.fingerprint, d.rule_code, d.severity, d.entity_type, d.order_id, d.payment_record_id, d.session_id, d.branch_id, 'open', d.safe_details
        from _det d
       where not exists (select 1 from public.order_integrity_incidents i
                          where i.fingerprint = d.fingerprint and i.status <> 'resolved')
      returning id )
    select count(*) into v_opened from ins;

    -- (c) Clean/resolve ACTIVE incidents NOT detected this run (enabled rules
    --     only). Resolve ONLY after two consecutive clean scans.
    with cleaned as (
      update public.order_integrity_incidents i
         set consecutive_clean_count = i.consecutive_clean_count + 1,
             consecutive_detection_count = 0,
             status = case when i.consecutive_clean_count + 1 >= 2 then 'resolved' else i.status end,
             resolved_at = case when i.consecutive_clean_count + 1 >= 2 then now() else i.resolved_at end,
             resolution_reason = case when i.consecutive_clean_count + 1 >= 2
                                      then 'auto_two_consecutive_clean_scans' else i.resolution_reason end,
             updated_at = now()
       where i.status <> 'resolved'
         and not exists (select 1 from _det d where d.fingerprint = i.fingerprint)
         and coalesce((v_rules->>i.rule_code), 'true') <> 'false'
      returning i.id, (i.status = 'resolved') as just_resolved ),
    r as ( insert into _resolved (id) select id from cleaned where just_resolved returning id )
    select count(*) into v_resolved from r;

    -- (d) Alert eligibility -> outbox (POPULATED ONLY; never dispatched in v1).
    --     'opened' once per incident (until it resolves), for non-suppressed
    --     active incidents: critical after >=2 consecutive detections; warning
    --     after persisting >=15 minutes. Dedup: not exists any opened row for
    --     the incident (cooldown for the incident's lifetime).
    insert into public.order_integrity_alert_outbox (incident_id, alert_type, severity, payload_safe)
    select i.id, 'opened', i.severity,
           jsonb_build_object('rule_code', i.rule_code, 'fingerprint', i.fingerprint,
             'severity', i.severity, 'first_detected_at', i.first_detected_at,
             'occurrence_count', i.occurrence_count, 'safe_details', i.safe_details)
      from public.order_integrity_incidents i
     where i.status in ('open','acknowledged')
       and (i.suppression_until is null or i.suppression_until <= now())
       and (
         (i.severity = 'critical' and i.consecutive_detection_count >= 2)
         or (i.severity = 'warning' and now() - i.first_detected_at >= interval '15 minutes')
       )
       and not exists (select 1 from public.order_integrity_alert_outbox a
                        where a.incident_id = i.id and a.alert_type = 'opened')
    on conflict do nothing;

    --     'recovery' when a previously alert-eligible incident resolves THIS run
    --     (identified by id via _resolved, not a timestamp compare).
    insert into public.order_integrity_alert_outbox (incident_id, alert_type, severity, payload_safe)
    select i.id, 'recovery', i.severity,
           jsonb_build_object('rule_code', i.rule_code, 'fingerprint', i.fingerprint,
             'resolved_at', i.resolved_at, 'resolution_reason', i.resolution_reason)
      from public.order_integrity_incidents i
      join _resolved rr on rr.id = i.id
     where exists (select 1 from public.order_integrity_alert_outbox a
                    where a.incident_id = i.id and a.alert_type in ('opened','escalated'))
       and not exists (select 1 from public.order_integrity_alert_outbox a
                    where a.incident_id = i.id and a.alert_type = 'recovery')
    on conflict do nothing;

    -- Success.
    update public.order_integrity_runs
       set status='success', completed_at=now(),
           rules_evaluated=v_evaluated, incidents_detected=v_detected,
           incidents_opened=v_opened, incidents_updated=v_updated, incidents_resolved=v_resolved,
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;
    return v_run_id;

  exception when others then
    -- Fail-closed: mark the run failed with a SQLSTATE-only safe code and a
    -- stage-scoped (never PII-bearing) message. The inner block's changes
    -- (incident upserts/resolutions) roll back to the implicit savepoint, so NO
    -- incident is resolved on a failed run. A config-stage failure surfaces as a
    -- configuration error (safe_error_code = SQLSTATE, never 'overlap_skipped'),
    -- which the health summary classifies as configuration_error.
    update public.order_integrity_runs
       set status='failed', completed_at=now(),
           safe_error_code = sqlstate,
           safe_error_message = left(
             case when v_stage = 'config' then 'watchdog configuration invalid'
                  else 'watchdog rule evaluation failed' end, 200),
           duration_ms = floor(extract(epoch from (clock_timestamp() - v_start)) * 1000)::int
     where id = v_run_id;
    return v_run_id;
  end;
end $$;

revoke all on function public.order_integrity_watchdog() from public, anon, authenticated;
grant execute on function public.order_integrity_watchdog() to service_role;

comment on function public.order_integrity_watchdog() is
  'Order Integrity Watchdog v1 scanner (observe-only). Overlap-safe (advisory lock), fail-closed (durable failed run on any error; never resolves incidents on failure). Detects the 11 supported rules, deduplicates incidents by RULE_CODE:ENTITY_ID (one active per fingerprint), resolves only after two consecutive clean scans, and POPULATES (never sends) the alert outbox. Service-role only. Changes no order/payment/POS/business state.';

-- ---- 6. Health summary (service-role-only aggregate) ------------------------
-- Deterministic thresholds (watchdog runs every 2 minutes):
--   SUCCESS_STALE_DEGRADE = 4 minutes   SUCCESS_STALE_FAIL = 6 minutes
-- Cascade (first match wins): configuration_error > failing > degraded > healthy.
--   configuration_error : the latest DECISIVE run failed for a non-benign reason.
--                         A "decisive" run is a success OR a failure whose
--                         safe_error_code <> 'overlap_skipped'. `running` and
--                         `overlap_skipped` runs are IGNORED for state selection,
--                         so a benign newer run can NEVER hide a real config
--                         failure; a later successful decisive run clears it.
--   failing             : cron missing/inactive; OR no successful run in 6 min
--                         (or none ever); OR one or more UNRESOLVED CRITICAL
--                         incidents.
--   degraded            : one or more UNRESOLVED WARNING incidents; OR the latest
--                         successful run is older than 4 minutes.
--   healthy             : cron active, a success within 4 min, zero unresolved
--                         critical and zero unresolved warning incidents.
-- IMPORTANT — incident counting semantics: open_critical_count / open_warning_count
-- count every UNRESOLVED (status <> 'resolved') incident of that severity, i.e.
-- open + acknowledged + suppressed. Acknowledge means "seen", not "fixed"; suppress
-- controls alert noise only. Neither can make an unresolved integrity defect
-- disappear from health — ONLY status='resolved' removes an incident from the
-- active counts and from oldest_open_critical_at. acknowledged_count and
-- suppressed_count remain separate informational fields.
create or replace function public.order_integrity_health_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cron_active   boolean := false;
  v_latest_at     timestamptz;
  v_latest_status text;
  v_dec_status    text;
  v_dec_code      text;
  v_success_at    timestamptz;
  v_open_crit     integer := 0;
  v_open_warn     integer := 0;
  v_ack           integer := 0;
  v_supp          integer := 0;
  v_oldest_crit   timestamptz;
  v_latest_inc    jsonb;
  v_opened_24h    integer := 0;
  v_resolved_24h  integer := 0;
  v_success_recent boolean;
  v_state         text;
begin
  begin
    select coalesce(bool_and(active), false) into v_cron_active
      from cron.job where jobname = 'order-integrity-watchdog' having count(*) > 0;
    v_cron_active := coalesce(v_cron_active, false);
  exception when undefined_table or insufficient_privilege then
    v_cron_active := false;
  end;

  -- Literal latest run (for the visible latest_run_at / age fields).
  select started_at, status into v_latest_at, v_latest_status
    from public.order_integrity_runs order by started_at desc, id desc limit 1;
  -- Latest DECISIVE run (for state selection): success OR non-benign failure.
  -- running / overlap_skipped are skipped so they cannot mask a config failure.
  select status, safe_error_code into v_dec_status, v_dec_code
    from public.order_integrity_runs
   where status = 'success'
      or (status = 'failed' and coalesce(safe_error_code, '') <> 'overlap_skipped')
   order by started_at desc, id desc limit 1;
  select completed_at into v_success_at
    from public.order_integrity_runs where status='success'
    order by completed_at desc nulls last, id desc limit 1;

  -- UNRESOLVED (open + acknowledged + suppressed) active incidents by severity.
  select count(*) filter (where severity='critical'),
         count(*) filter (where severity='warning')
    into v_open_crit, v_open_warn
    from public.order_integrity_incidents where status <> 'resolved';
  select count(*) into v_ack  from public.order_integrity_incidents where status='acknowledged';
  select count(*) into v_supp from public.order_integrity_incidents
    where status='suppressed' and (suppression_until is null or suppression_until > now());
  select min(first_detected_at) into v_oldest_crit
    from public.order_integrity_incidents where status <> 'resolved' and severity='critical';
  select count(*) into v_opened_24h from public.order_integrity_incidents
    where created_at >= now() - interval '24 hours';
  select count(*) into v_resolved_24h from public.order_integrity_incidents
    where resolved_at is not null and resolved_at >= now() - interval '24 hours';

  select jsonb_build_object('id', id, 'rule_code', rule_code, 'severity', severity,
           'status', status, 'entity_type', entity_type, 'order_id', order_id,
           'branch_id', branch_id, 'last_detected_at', last_detected_at,
           'occurrence_count', occurrence_count)
    into v_latest_inc
    from public.order_integrity_incidents order by last_detected_at desc, created_at desc limit 1;

  v_success_recent := v_success_at is not null and now() - v_success_at <= interval '4 minutes';

  v_state := case
    when v_dec_status = 'failed'      -- latest decisive run is a non-benign failure
      then 'configuration_error'
    when (not v_cron_active)
      or v_success_at is null
      or now() - v_success_at > interval '6 minutes'
      or v_open_crit > 0
      then 'failing'
    when v_open_warn > 0 or not v_success_recent
      then 'degraded'
    else 'healthy'
  end;

  return jsonb_build_object(
    'generated_at',              now(),
    'overall_state',             v_state,
    'watchdog_cron_active',      v_cron_active,
    'latest_run_at',             v_latest_at,
    'latest_successful_run_at',  v_success_at,
    'latest_run_age_seconds',    case when v_latest_at is null then null
                                      else floor(extract(epoch from (now() - v_latest_at)))::bigint end,
    'open_critical_count',       v_open_crit,
    'open_warning_count',        v_open_warn,
    'acknowledged_count',        v_ack,
    'suppressed_count',          v_supp,
    'oldest_open_critical_at',   v_oldest_crit,
    'latest_incident',           v_latest_inc,
    'incidents_opened_last_24h', v_opened_24h,
    'incidents_resolved_last_24h', v_resolved_24h
  );
end $$;

revoke all on function public.order_integrity_health_summary() from public, anon, authenticated;
grant execute on function public.order_integrity_health_summary() to service_role;

comment on function public.order_integrity_health_summary() is
  'Service-role-only aggregate health for the order integrity watchdog. overall_state (healthy/degraded/failing/configuration_error) is driven by the latest DECISIVE run (success or non-overlap failure; running/overlap_skipped cannot mask a config failure) and by UNRESOLVED incidents: open_critical_count/open_warning_count count every non-resolved (open+acknowledged+suppressed) incident of that severity, so acknowledging or suppressing an incident never removes it from health — only resolution does. acknowledged_count/suppressed_count are informational. Also returns cron active, latest/last-successful run + age, oldest unresolved critical, latest incident (safe), and 24h opened/resolved counts. No PII, no secrets.';

-- ---- 7. Admin RPCs (is_admin/is_staff gated; safe projections) --------------
-- Admin overview (mirror of the health summary for the dashboard). is_staff read.
create or replace function public.order_integrity_admin_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Only staff may view order integrity health' using errcode = '42501';
  end if;
  return public.order_integrity_health_summary();
end $$;
revoke all on function public.order_integrity_admin_summary() from public, anon;
grant execute on function public.order_integrity_admin_summary() to authenticated;

-- List incidents (safe fields only, with the safe order_number for a link).
create or replace function public.order_integrity_list_incidents(
  p_status text default null, p_severity text default null,
  p_rule_code text default null, p_branch_id uuid default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_admin boolean;
begin
  if not public.is_staff() then
    raise exception 'Only staff may view order integrity incidents' using errcode = '42501';
  end if;
  -- Admin-entered free text (suppression_reason, safe_details.ack_note) is triage
  -- metadata an admin could inadvertently type PII into; hide it from non-admin
  -- staff (e.g. accountants) so it never crosses a privilege tier.
  v_admin := public.is_admin();
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v from (
    select i.id, i.fingerprint, i.rule_code, i.severity, i.entity_type, i.status,
           i.order_id, o.order_number, i.branch_id,
           i.first_detected_at, i.last_detected_at, i.occurrence_count,
           i.consecutive_detection_count, i.consecutive_clean_count,
           i.acknowledged_at, i.suppression_until,
           case when v_admin then i.suppression_reason else null end as suppression_reason,
           i.resolved_at,
           case when v_admin then i.safe_details else i.safe_details - 'ack_note' end as safe_details
      from public.order_integrity_incidents i
      left join public.orders o on o.id = i.order_id
     where (p_status    is null or i.status    = p_status)
       and (p_severity  is null or i.severity  = p_severity)
       and (p_rule_code is null or i.rule_code = p_rule_code)
       and (p_branch_id is null or i.branch_id = p_branch_id)
     order by (i.status='open') desc, (i.severity='critical') desc, i.last_detected_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) t;
  return v;
end $$;
revoke all on function public.order_integrity_list_incidents(text, text, text, uuid, integer) from public, anon;
grant execute on function public.order_integrity_list_incidents(text, text, text, uuid, integer) to authenticated;

-- Incident timeline (the incident's own safe audit history).
create or replace function public.order_integrity_incident_timeline(p_incident_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_admin boolean;
begin
  if not public.is_staff() then
    raise exception 'Only staff may view order integrity incidents' using errcode = '42501';
  end if;
  v_admin := public.is_admin();  -- redact admin-entered free text from non-admin staff
  select row_to_json(t) into v from (
    select i.id, i.fingerprint, i.rule_code, i.severity, i.entity_type, i.status,
           i.order_id, o.order_number, i.branch_id, i.first_detected_at, i.last_detected_at,
           i.occurrence_count, i.consecutive_detection_count, i.consecutive_clean_count,
           i.acknowledged_at, i.acknowledged_by, i.suppression_until,
           case when v_admin then i.suppression_reason else null end as suppression_reason,
           i.resolved_at, i.resolution_reason, i.created_at, i.updated_at,
           case when v_admin then i.safe_details else i.safe_details - 'ack_note' end as safe_details,
           (select coalesce(jsonb_agg(jsonb_build_object('alert_type', a.alert_type,
                     'status', a.status, 'created_at', a.created_at) order by a.created_at), '[]'::jsonb)
              from public.order_integrity_alert_outbox a where a.incident_id = i.id) as alerts
      from public.order_integrity_incidents i
      left join public.orders o on o.id = i.order_id
     where i.id = p_incident_id
  ) t;
  if v is null then raise exception 'incident not found' using errcode = 'P0002'; end if;
  return v;
end $$;
revoke all on function public.order_integrity_incident_timeline(uuid) from public, anon;
grant execute on function public.order_integrity_incident_timeline(uuid) to authenticated;

-- Acknowledge (admin-only, audited). open -> acknowledged.
create or replace function public.order_integrity_acknowledge_incident(
  p_incident_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.order_integrity_incidents;
begin
  if not public.is_admin() then
    raise exception 'Only admins may acknowledge incidents' using errcode = '42501';
  end if;
  update public.order_integrity_incidents
     set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = auth.uid(),
         safe_details = case when p_note is null then safe_details
                             else safe_details || jsonb_build_object('ack_note', left(p_note, 500)) end,
         updated_at = now()
   where id = p_incident_id and status = 'open'
   returning * into v_row;
  if not found then
    raise exception 'incident not found or not in an acknowledgeable (open) state' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'acknowledged_at', v_row.acknowledged_at);
end $$;
revoke all on function public.order_integrity_acknowledge_incident(uuid, text) from public, anon;
grant execute on function public.order_integrity_acknowledge_incident(uuid, text) to authenticated;

-- Suppress (admin-only, audited, time-bounded). Never deletes/falsifies history.
create or replace function public.order_integrity_suppress_incident(
  p_incident_id uuid, p_until timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.order_integrity_incidents;
begin
  if not public.is_admin() then
    raise exception 'Only admins may suppress incidents' using errcode = '42501';
  end if;
  if p_until is null or p_until <= now() then
    raise exception 'suppression_until must be in the future' using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a suppression reason is required' using errcode = 'P0001';
  end if;
  update public.order_integrity_incidents
     set status = 'suppressed', suppression_until = p_until,
         suppression_reason = left(p_reason, 500),
         acknowledged_by = coalesce(acknowledged_by, auth.uid()),
         updated_at = now()
   where id = p_incident_id and status in ('open','acknowledged')
   returning * into v_row;
  if not found then
    raise exception 'incident not found or not in a suppressible state' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status,
    'suppression_until', v_row.suppression_until, 'suppression_reason', v_row.suppression_reason);
end $$;
revoke all on function public.order_integrity_suppress_incident(uuid, timestamptz, text) from public, anon;
grant execute on function public.order_integrity_suppress_incident(uuid, timestamptz, text) to authenticated;

-- ---- 8. Schedule: every 2 minutes; cron.job stores only the bare call -------
select cron.schedule(
  'order-integrity-watchdog',
  '*/2 * * * *',
  'select public.order_integrity_watchdog();'
);
