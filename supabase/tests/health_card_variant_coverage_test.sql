-- ============================================================================
-- Operations Health observes branch_variant_availability
-- (migration 20260925120000_health_card_variant_coverage).
--
-- WHAT THE DEFECT WAS. `operations_health_snapshot_internal` enumerates the
-- availability tables BY NAME in three places, and `20260923120000` added a
-- fourth that none of them knew about. A tier could be closed, its restore
-- timer could run out, the sweeper could be dead, and the card would go on
-- reporting `healthy` — because the only thing that detects an unhonoured
-- timer is the `overdue` UNION, and that UNION had three arms.
--
-- SO CASE B IS THE SUITE. It is the assertion that would have failed before
-- this migration and passes after it. Everything else is a boundary.
--
-- Deliberately a separate file from `branch_availability_health_card_test.sql`:
-- that suite's stated purpose is the card's states and its contrast with the
-- cron entry, and adding a fourth axis to it would blur what a failure there
-- means. Its CASE at line 264 pins `closed_products` and `closed_options`
-- exactly, and this migration must not move either — Case D asserts that from
-- this side too.
--
-- Transactional, deterministic, no external provider calls.
-- ============================================================================
begin;

select set_config('test.is_admin', 'true', true);
select set_config('test.auth_uid', '', true);

\set branch  '''b0000000-0000-0000-0000-000000000001'''
\set chicken '''a0000000-0000-0000-0000-000000000002'''
\set small   '''d0000000-0000-0000-0000-000000000011'''

insert into public.product_variants (id, product_id, name_en, name_ar, price, sort_order, is_active)
values ('d0000000-0000-0000-0000-000000000011','a0000000-0000-0000-0000-000000000002',
        'Small','صغير',27.00,1,true);

-- ---- helpers ---------------------------------------------------------------
create function pg_temp.hv_card() returns jsonb language sql as $$
  select x from jsonb_array_elements(public.operations_health_summary()->'systems') x
  where x->>'id' = 'branch_availability';
$$;
create function pg_temp.hv_state() returns text language sql as $$
  select pg_temp.hv_card()->>'state';
$$;
create function pg_temp.hv_detail(p_key text) returns text language sql as $$
  select pg_temp.hv_card()->'details'->>p_key;
$$;
create function pg_temp.hv_cond() returns jsonb language sql as $$
  select c from jsonb_array_elements(
    public.operations_alerts_derive(public.operations_health_summary(), '{}'::jsonb)) c
  where c->>'fingerprint' = 'branch_availability:health';
$$;
create function pg_temp.hv_reset() returns void language sql as $$
  delete from public.branch_product_availability;
  delete from public.branch_modifier_availability;
  delete from public.branch_variant_availability;
  delete from public.branch_delivery_areas;
  delete from public.branch_availability_runs;
  update public.branches
     set delivery_temporarily_closed = false, delivery_closed_until = null;
$$;
create function pg_temp.hv_close_size(p_due timestamptz) returns void language sql as $$
  insert into public.branch_variant_availability
    (branch_id, variant_id, is_available, snoozed_until)
  values ('b0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000011',
          false, p_due)
  on conflict (branch_id, variant_id) do update
    set is_available = false, snoozed_until = excluded.snoozed_until;
$$;

-- ---------------------------------------------------------------------------
-- A. The counter exists, is SEPARATE from closed_options, and counts a timed
--    closure. Folding sizes into `closed_options` would have passed a looser
--    version of this case, which is why both keys are asserted.
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.hv_reset();
  perform pg_temp.hv_close_size(now() + interval '30 minutes');

  if pg_temp.hv_detail('closed_sizes') is null then
    raise exception 'CASE A: the card has no closed_sizes key at all';
  end if;
  if pg_temp.hv_detail('closed_sizes')::int <> 1 then
    raise exception 'CASE A: closed_sizes is %, expected 1', pg_temp.hv_detail('closed_sizes');
  end if;
  if pg_temp.hv_detail('closed_options')::int <> 0 then
    raise exception 'CASE A: a closed SIZE was counted as an option (closed_options %)',
      pg_temp.hv_detail('closed_options');
  end if;
  if pg_temp.hv_detail('closed_products')::int <> 0 then
    raise exception 'CASE A: a closed SIZE was counted as a product';
  end if;
  -- A live timer is not a backlog.
  if pg_temp.hv_detail('overdue_restores')::int <> 0 then
    raise exception 'CASE A: an unexpired timer was reported overdue';
  end if;
  raise notice 'CASE A closed_sizes counts separately OK';
end $$;

-- ---------------------------------------------------------------------------
-- B. THE BLIND SPOT. A size whose restore timer ran out and was never honoured
--    must reach `overdue_restores` and move the card off `healthy`. This is the
--    assertion that fails against the pre-migration function.
-- ---------------------------------------------------------------------------
do $$
declare v_cond jsonb;
begin
  perform pg_temp.hv_reset();
  -- Well past the five-minute grace, well inside the thirty-minute stall
  -- threshold, so this is `degraded` and not `failing`.
  perform pg_temp.hv_close_size(now() - interval '11 minutes');

  if pg_temp.hv_detail('overdue_restores')::int <> 1 then
    raise exception 'CASE B: a stuck SIZE snooze is invisible to overdue_restores (%)',
      pg_temp.hv_detail('overdue_restores');
  end if;
  if pg_temp.hv_detail('worst_overdue_minutes')::int < 10 then
    raise exception 'CASE B: worst_overdue_minutes is %, expected >= 10',
      pg_temp.hv_detail('worst_overdue_minutes');
  end if;
  if pg_temp.hv_state() <> 'degraded' then
    raise exception 'CASE B: the card is % with a stuck size, expected degraded',
      pg_temp.hv_state();
  end if;

  -- And it raises the SAME alert a stuck product raises — no new identity.
  v_cond := pg_temp.hv_cond();
  if v_cond is null then
    raise exception 'CASE B: no branch_availability:health condition was emitted';
  end if;
  if v_cond->>'condition_code' <> 'restores_overdue' then
    raise exception 'CASE B: condition_code is %, expected restores_overdue',
      v_cond->>'condition_code';
  end if;
  if v_cond->>'severity' <> 'warning' then
    raise exception 'CASE B: severity is %, expected warning', v_cond->>'severity';
  end if;
  -- The responder must not be told "0 products, 0 options" while the entire
  -- backlog is sizes. `operations_alerts_sanitize_evidence` drops objects and
  -- arrays but keeps integers, so this survives it.
  if (v_cond->'safe_evidence'->>'closed_sizes') is null then
    raise exception 'CASE B: the alert evidence omits closed_sizes entirely';
  end if;
  if (v_cond->'safe_evidence'->>'closed_sizes')::int <> 1 then
    raise exception 'CASE B: evidence closed_sizes is %, expected 1',
      v_cond->'safe_evidence'->>'closed_sizes';
  end if;
  raise notice 'CASE B a stuck size raises degraded and carries its evidence OK';
end $$;

-- ---------------------------------------------------------------------------
-- C. It escalates on the SAME fingerprint rather than opening a second alert,
--    and an untimed closure is reported but never drives state.
-- ---------------------------------------------------------------------------
do $$
declare v_cond jsonb;
begin
  perform pg_temp.hv_reset();
  perform pg_temp.hv_close_size(now() - interval '45 minutes');
  v_cond := pg_temp.hv_cond();
  if pg_temp.hv_state() <> 'failing' then
    raise exception 'CASE C: a size stuck 45 minutes is %, expected failing', pg_temp.hv_state();
  end if;
  if v_cond->>'condition_code' <> 'restores_stalled' or v_cond->>'severity' <> 'critical' then
    raise exception 'CASE C: expected restores_stalled/critical, got %/%',
      v_cond->>'condition_code', v_cond->>'severity';
  end if;
  if v_cond->>'fingerprint' <> 'branch_availability:health' then
    raise exception 'CASE C: a SECOND fingerprint appeared: %', v_cond->>'fingerprint';
  end if;

  -- Untimed: an administrator delisting a size is a decision, not a backlog.
  perform pg_temp.hv_reset();
  perform pg_temp.hv_close_size(null);
  if pg_temp.hv_detail('untimed_closures')::int <> 1 then
    raise exception 'CASE C: an untimed SIZE closure is not counted (%)',
      pg_temp.hv_detail('untimed_closures');
  end if;
  if pg_temp.hv_detail('overdue_restores')::int <> 0 then
    raise exception 'CASE C: an untimed closure was reported as a backlog';
  end if;
  if pg_temp.hv_state() = 'degraded' or pg_temp.hv_state() = 'failing' then
    raise exception 'CASE C: an untimed closure moved the state to %', pg_temp.hv_state();
  end if;
  raise notice 'CASE C escalation on one fingerprint, untimed never drives state OK';
end $$;

-- ---------------------------------------------------------------------------
-- D. THE OTHER THREE AXES DID NOT MOVE. This file re-emits a 1 000-line
--    function; the risk is never the twenty-three lines it meant to add.
--
--    NOTE THE EXISTING SEMANTICS, which the first draft of this case got
--    wrong: `closed_products` / `closed_options` / `closed_sizes` count only
--    TIMED closures. An untimed one is deliberately reported under
--    `untimed_closures` instead — "an admin delisting is a decision", as the
--    payload's own comment puts it. Both halves are asserted here, because the
--    new arm has to match that split rather than invent its own.
-- ---------------------------------------------------------------------------
do $$
begin
  -- Timed: each axis counted once, under its own key, nothing untimed.
  perform pg_temp.hv_reset();
  insert into public.branch_product_availability
    (branch_id, product_id, is_available, snoozed_until)
  values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001',
          false, now() + interval '30 minutes');
  insert into public.branch_modifier_availability
    (branch_id, modifier_id, is_available, snoozed_until)
  values ('b0000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',
          false, now() + interval '30 minutes');
  perform pg_temp.hv_close_size(now() + interval '30 minutes');

  if pg_temp.hv_detail('closed_products')::int <> 1 then
    raise exception 'CASE D: closed_products is %, expected 1', pg_temp.hv_detail('closed_products');
  end if;
  if pg_temp.hv_detail('closed_options')::int <> 1 then
    raise exception 'CASE D: closed_options is %, expected 1', pg_temp.hv_detail('closed_options');
  end if;
  if pg_temp.hv_detail('closed_sizes')::int <> 1 then
    raise exception 'CASE D: closed_sizes is %, expected 1', pg_temp.hv_detail('closed_sizes');
  end if;
  if pg_temp.hv_detail('untimed_closures')::int <> 0 then
    raise exception 'CASE D: untimed_closures is %, expected 0', pg_temp.hv_detail('untimed_closures');
  end if;

  -- Untimed: THE ACCUMULATION. `into v_ba_closed_sizes, v_ba_untimed` with a
  -- bare `count(*)` on the right would report 1 here and silently discard the
  -- product and option totals the two arms above it had already added.
  perform pg_temp.hv_reset();
  insert into public.branch_product_availability
    (branch_id, product_id, is_available, snoozed_until)
  values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001', false, null);
  insert into public.branch_modifier_availability
    (branch_id, modifier_id, is_available, snoozed_until)
  values ('b0000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001', false, null);
  perform pg_temp.hv_close_size(null);

  if pg_temp.hv_detail('untimed_closures')::int <> 3 then
    raise exception 'CASE D: untimed_closures is %, expected 3 — the new arm overwrote the total',
      pg_temp.hv_detail('untimed_closures');
  end if;
  if pg_temp.hv_detail('closed_sizes')::int <> 0 then
    raise exception 'CASE D: an UNTIMED size closure was counted under closed_sizes';
  end if;
  raise notice 'CASE D three axes counted independently and untimed accumulates OK';
end $$;

-- ---------------------------------------------------------------------------
-- E. The `idle` fail-quiet warm-up notices sizes. A fresh database with a size
--    closed and no sweep recorded is NOT idle — it has something to report.
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.hv_reset();
  if pg_temp.hv_state() <> 'idle' then
    raise exception 'CASE E: nothing closed and no run gives %, expected idle', pg_temp.hv_state();
  end if;
  -- A TIMED closure, because the idle condition reads the timed counters --
  -- which is the existing contract for products and options, and this arm has
  -- to match it rather than be stricter on its own.
  perform pg_temp.hv_close_size(now() + interval '30 minutes');
  if pg_temp.hv_state() = 'idle' then
    raise exception 'CASE E: a closed SIZE was still reported as an idle warm-up';
  end if;
  raise notice 'CASE E the idle warm-up observes closed sizes OK';
end $$;

-- ---------------------------------------------------------------------------
-- F. CONTAINMENT. The snapshot is SECURITY DEFINER and reads every operational
--    table there is; the staff-gated wrapper is the only route a client role
--    has to any of it.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.operations_health_snapshot_internal()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.operations_health_snapshot_internal()', 'EXECUTE') then
    raise exception 'CASE F: operations_health_snapshot_internal is reachable by a client role';
  end if;
  if has_function_privilege('anon', 'public.operations_alerts_derive_pre_stranded(jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.operations_alerts_derive_pre_stranded(jsonb,jsonb)', 'EXECUTE') then
    raise exception 'CASE F: operations_alerts_derive_pre_stranded is reachable by a client role';
  end if;
  raise notice 'CASE F containment unchanged OK';
end $$;

rollback;
