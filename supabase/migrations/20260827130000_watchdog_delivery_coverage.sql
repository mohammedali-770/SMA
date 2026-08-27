-- 20260827130000_watchdog_delivery_coverage
--
-- Make the order-integrity watchdog see FAILED DELIVERY ORDERS.
--
-- Why now. Until 2026-08-27 delivery never entered the POS sync queue at all:
-- `set_lazywait_initial_sync` parked every delivery order at
-- `blocked`/`delivery_schema_unconfirmed` before the worker could claim it. With
-- that gate removed (20260827120000) and `lazywait-sync` v6 deployed, a paid
-- online delivery order now flows through exactly the same queue as pickup —
-- and can fail in exactly the same ways.
--
-- Two critical rules still filtered `o.order_type = 'pickup'`, which was
-- correct while delivery was gated and is now a blind spot:
--
--   R1 PAID_ORDER_NOT_SYNCED   — a paid delivery order stuck unsynced for
--                                >5 minutes raised NO critical incident.
--   R7 PAID_ORDER_DEAD_LETTER  — a paid delivery order that exhausted its
--                                retry budget raised NO critical incident.
--
-- This migration removes those two filters and changes NOTHING else. Every
-- other rule, threshold, the advisory lock, the run bookkeeping and the
-- PII-safe `safe_details` shape are byte-identical to 20260721170000 — the
-- function body below was extracted from that file mechanically, not retyped.
--
-- What is deliberately NOT changed: R1 still carries
-- `sync_blocked_reason <> 'delivery_schema_unconfirmed'`, and the stranded-
-- orders health card (20260810113000) still excludes the same reason. That
-- reason is now RETIRED — neither the insert trigger nor worker v6 can emit it
-- — so the exclusion no longer hides any reachable failure. It hides exactly
-- four legacy rows (SM-2026-000032, -000049, -000057, -000058) that are
-- deliberately parked and un-retryable by design. Surfacing those as a
-- permanent failing condition would be pure false alarm, so they stay excluded.
--
-- No data is read or written by this migration; it redefines one function.

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
      where o.payment_status = 'paid' and o.status <> 'cancelled'
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
        -- honor per-order exclusions (keeps genuinely order-less captures)
        and (pr.order_id is null or pr.order_id <> all (v_excluded))
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
          -- Honor per-order exclusions BEFORE grouping: an excluded (authorized
          -- test) order must not contribute to the distinct-order count, or it
          -- could push a clean production order's shared reference over the
          -- threshold and open a false DUPLICATE_PROVIDER_REFERENCE incident.
          and (pr.order_id is null or pr.order_id <> all (v_excluded))
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
      where o.payment_status = 'paid'
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
             -- strip admin-entered free text (ack_note): it is potential PII and is
             -- already redacted from non-admin staff, so it must never enter the
             -- (future-dispatchable) alert outbox.
             'occurrence_count', i.occurrence_count, 'safe_details', (i.safe_details - 'ack_note'))
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

