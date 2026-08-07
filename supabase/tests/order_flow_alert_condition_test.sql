-- ============================================================================
-- Order-flow alert condition (migration 20260807170000).
--
-- WHAT THIS PINS. Migration 20260807150000 gave the console an `order_flow`
-- health card. It did NOT give the alert engine a fingerprint for it, so the
-- card could read `failing` while the alerts inbox stayed silent. This suite
-- pins the arm that closes that, and — more importantly — pins the two ways it
-- could be closed WRONGLY:
--
--   * alerting on `idle`, which would fire every night after closing time and
--     through the card's entire warm-up, teaching people to mute it;
--   * using a per-state fingerprint, which would recover one alert and open
--     another every time a shortfall worsened into a stop, destroying the
--     incident's timeline exactly when someone is reading it.
--
-- `operations_alerts_derive` is a pure function of (snapshot, settings), so
-- these cases hand it synthetic snapshots directly. That is deliberate: driving
-- the REAL snapshot to `failing` would need eight weeks of seeded order history
-- and would test the card, not the arm. Case 9 closes the loop against the real
-- snapshot.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

-- A minimal snapshot carrying exactly one order_flow card in the shape the real
-- snapshot emits. Anything derive reads must be present here, or these cases
-- would pass against a function that reads fields the snapshot never sends.
create or replace function pg_temp.ofa_snapshot(p_state text, p_overall text default 'healthy')
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'overall_state', p_overall,
    'systems', jsonb_build_array(
      jsonb_build_object(
        'id', 'order_flow',
        'critical', true,
        'state', p_state,
        'source', 'orders_vs_trailing_weekly_window_baseline',
        'details', jsonb_build_object(
          'window_minutes', 60,
          'orders_in_window', 0,
          'open_branches', 4,
          'total_branches', 23,
          'baseline_orders', 12.50,
          'baseline_samples', 6,
          'baseline_min_samples', 3,
          'baseline_ready', true,
          'safe_error_code', null))),
    'jobs', '[]'::jsonb);
$$;

-- The order_flow conditions derive produces for a given card state.
create or replace function pg_temp.ofa_conds(p_state text, p_settings jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select coalesce(jsonb_agg(c), '[]'::jsonb)
    from jsonb_array_elements(
           public.operations_alerts_derive(pg_temp.ofa_snapshot(p_state), p_settings)) c
   where c ->> 'subsystem' = 'order_flow';
$$;

create or replace function pg_temp.ofa_one(p_state text)
returns jsonb language sql as $$
  select pg_temp.ofa_conds(p_state) -> 0;
$$;

-- ---- CASE 1: idle raises NOTHING -------------------------------------------
-- The single most important property in this file. `idle` means no branch is
-- open, or the baseline has too few comparable weeks. Both are correct readings
-- of a quiet hour, not incidents. On Production today the card is idle with
-- baseline_samples 0, so getting this wrong would page someone immediately.
do $$
declare v jsonb;
begin
  v := pg_temp.ofa_conds('idle');
  if jsonb_array_length(v) <> 0 then
    raise exception 'FAIL(1): idle produced a condition: %', v;
  end if;
  raise notice 'CASE 1 ok: idle raises nothing';
end $$;

-- ---- CASE 2: healthy raises NOTHING ----------------------------------------
do $$
declare v jsonb;
begin
  v := pg_temp.ofa_conds('healthy');
  if jsonb_array_length(v) <> 0 then
    raise exception 'FAIL(2): healthy produced a condition: %', v;
  end if;
  raise notice 'CASE 2 ok: healthy raises nothing';
end $$;

-- ---- CASE 3: failing -> exactly one CRITICAL flow_stopped ------------------
do $$
declare v jsonb; c jsonb;
begin
  v := pg_temp.ofa_conds('failing');
  if jsonb_array_length(v) <> 1 then
    raise exception 'FAIL(3): expected exactly 1 condition, got % (%)',
      jsonb_array_length(v), v;
  end if;
  c := v -> 0;
  if c ->> 'fingerprint' <> 'order_flow:health' then
    raise exception 'FAIL(3): fingerprint is %, expected order_flow:health', c ->> 'fingerprint';
  end if;
  if c ->> 'severity' <> 'critical' then
    raise exception 'FAIL(3): a stopped order flow must be critical, got %', c ->> 'severity';
  end if;
  if c ->> 'condition_code' <> 'flow_stopped' then
    raise exception 'FAIL(3): condition_code is %, expected flow_stopped', c ->> 'condition_code';
  end if;
  raise notice 'CASE 3 ok: failing -> critical order_flow:health / flow_stopped';
end $$;

-- ---- CASE 4: degraded -> one WARNING, not critical --------------------------
-- A shortfall is not an outage. Promoting it would make the critical count
-- untrustworthy, which is the same failure the health badge severity split
-- exists to avoid.
do $$
declare c jsonb;
begin
  c := pg_temp.ofa_one('degraded');
  if c is null then
    raise exception 'FAIL(4): degraded produced no condition';
  end if;
  if c ->> 'severity' <> 'warning' then
    raise exception 'FAIL(4): degraded must be warning, got %', c ->> 'severity';
  end if;
  if c ->> 'condition_code' <> 'flow_below_baseline' then
    raise exception 'FAIL(4): condition_code is %, expected flow_below_baseline',
      c ->> 'condition_code';
  end if;
  raise notice 'CASE 4 ok: degraded -> warning / flow_below_baseline';
end $$;

-- ---- CASE 5: unavailable -> one WARNING ------------------------------------
-- The card's own exception arm sets `unavailable`. A broken card is worth
-- surfacing but is not evidence that orders stopped, so it must not read
-- critical — matching how lazywait and account_deletion treat unavailable.
do $$
declare c jsonb;
begin
  c := pg_temp.ofa_one('unavailable');
  if c is null then
    raise exception 'FAIL(5): unavailable produced no condition';
  end if;
  if c ->> 'severity' <> 'warning' then
    raise exception 'FAIL(5): unavailable must be warning, got %', c ->> 'severity';
  end if;
  if c ->> 'condition_code' <> 'unavailable' then
    raise exception 'FAIL(5): condition_code is %, expected unavailable', c ->> 'condition_code';
  end if;
  raise notice 'CASE 5 ok: unavailable -> warning';
end $$;

-- ---- CASE 6: ONE identity across every alertable state ----------------------
-- The escalation property. Per-state fingerprints would recover and reopen the
-- alert on every transition, so the inbox would show a churn of short-lived
-- rows instead of one incident that got worse.
do $$
declare v_deg text; v_fail text; v_unav text;
begin
  v_deg  := pg_temp.ofa_one('degraded')    ->> 'fingerprint';
  v_fail := pg_temp.ofa_one('failing')     ->> 'fingerprint';
  v_unav := pg_temp.ofa_one('unavailable') ->> 'fingerprint';
  if v_deg is distinct from v_fail or v_fail is distinct from v_unav then
    raise exception 'FAIL(6): fingerprints differ across states (% / % / %)',
      v_deg, v_fail, v_unav;
  end if;
  raise notice 'CASE 6 ok: degraded/failing/unavailable share one identity (%)', v_fail;
end $$;

-- ---- CASE 7: the mute override suppresses it -------------------------------
-- Handled by the generic per-card guard, so this asserts the arm sits INSIDE
-- that guard rather than before it.
do $$
declare v jsonb;
begin
  v := pg_temp.ofa_conds('failing',
         jsonb_build_object('system_rule_overrides',
           jsonb_build_object('order_flow', jsonb_build_object('muted', true))));
  if jsonb_array_length(v) <> 0 then
    raise exception 'FAIL(7): a muted order_flow still produced a condition: %', v;
  end if;
  -- ...and muting something else must NOT suppress it.
  v := pg_temp.ofa_conds('failing',
         jsonb_build_object('system_rule_overrides',
           jsonb_build_object('payment', jsonb_build_object('muted', true))));
  if jsonb_array_length(v) <> 1 then
    raise exception 'FAIL(7): muting payment suppressed order_flow';
  end if;
  raise notice 'CASE 7 ok: order_flow honours its own mute and only its own';
end $$;

-- ---- CASE 8: evidence is safe scalars only ---------------------------------
-- derive feeds operations_alert_state, which is read by staff in the inbox and
-- copied into digests. public.orders is the most PII-dense table in the schema,
-- so the card's details must arrive as counts and nothing else.
do $$
declare
  v_ev jsonb;
  v_allowed text[] := array['state','orders_in_window','baseline_orders',
                            'baseline_samples','open_branches','window_minutes',
                            'safe_error_code'];
  k text;
begin
  v_ev := pg_temp.ofa_one('failing') -> 'safe_evidence';

  for k in select jsonb_object_keys(v_ev) loop
    if k <> all(v_allowed) then
      raise exception 'FAIL(8): unexpected evidence key %', k;
    end if;
  end loop;

  -- The numbers must actually arrive, not be silently zeroed.
  if (v_ev ->> 'open_branches')::int <> 4
     or (v_ev ->> 'baseline_samples')::int <> 6
     or (v_ev ->> 'baseline_orders')::numeric <> 12.50 then
    raise exception 'FAIL(8): evidence lost the card figures: %', v_ev;
  end if;

  -- Nothing nested could smuggle a row through.
  if exists (select 1 from jsonb_each(v_ev) e
              where jsonb_typeof(e.value) in ('object','array')) then
    raise exception 'FAIL(8): nested value in evidence: %', v_ev;
  end if;

  -- A null safe_error_code is dropped by the sanitizer rather than stored.
  if v_ev ? 'safe_error_code' then
    raise exception 'FAIL(8): a null safe_error_code was stored: %', v_ev;
  end if;

  -- The fingerprint must satisfy the charset operations_alerts_evaluate enforces
  -- on insert; a violation there would silently drop the condition instead of
  -- failing loudly.
  if (pg_temp.ofa_one('failing') ->> 'fingerprint') !~ '^[a-z0-9_:-]{3,200}$' then
    raise exception 'FAIL(8): fingerprint fails the evaluate insert charset';
  end if;
  raise notice 'CASE 8 ok: counts and flags only, and the fingerprint is insertable';
end $$;

-- ---- CASE 9: against the REAL snapshot -------------------------------------
-- Cases 1-8 use synthetic input. This one runs derive over the actual snapshot
-- so a drift between the card's emitted shape and what the arm reads cannot
-- pass unnoticed: the card's real state must agree with whether a condition
-- appears.
do $$
declare
  v_snap jsonb;
  v_state text;
  v_conds jsonb;
  v_n integer;
begin
  v_snap  := public.operations_health_snapshot_internal();
  v_state := (select e ->> 'state' from jsonb_array_elements(v_snap -> 'systems') e
               where e ->> 'id' = 'order_flow');
  if v_state is null then
    raise exception 'FAIL(9): the snapshot carries no order_flow card at all';
  end if;

  select count(*) into v_n
    from jsonb_array_elements(public.operations_alerts_derive(v_snap, '{}'::jsonb)) c
   where c ->> 'subsystem' = 'order_flow';

  if v_state in ('failing','degraded','unavailable') and v_n <> 1 then
    raise exception 'FAIL(9): card is % but derive produced % order_flow conditions',
      v_state, v_n;
  end if;
  if v_state in ('idle','healthy') and v_n <> 0 then
    select coalesce(jsonb_agg(c), '[]'::jsonb) into v_conds
      from jsonb_array_elements(public.operations_alerts_derive(v_snap, '{}'::jsonb)) c
     where c ->> 'subsystem' = 'order_flow';
    raise exception 'FAIL(9): card is % but derive produced %', v_state, v_conds;
  end if;
  raise notice 'CASE 9 ok: real snapshot card is % and derive agrees (% conditions)',
    v_state, v_n;
end $$;

-- ---- CASE 10: no other subsystem's conditions changed ----------------------
-- The arm was inserted into a 280-line function. This asserts the insertion did
-- not disturb the branches around it.
do $$
declare
  v_snap jsonb;
  v_fps  text[];
begin
  -- A snapshot with a failing lazywait AND a failing order_flow: both must
  -- appear, with their own identities.
  v_snap := jsonb_build_object(
    'overall_state', 'failing',
    'systems', jsonb_build_array(
      jsonb_build_object('id','lazywait','critical',true,'state','failing',
                         'details', jsonb_build_object('safe_error_code', null)),
      jsonb_build_object('id','order_flow','critical',true,'state','failing',
                         'details', jsonb_build_object('open_branches', 2))),
    'jobs', '[]'::jsonb);

  select array_agg(c ->> 'fingerprint' order by c ->> 'fingerprint') into v_fps
    from jsonb_array_elements(public.operations_alerts_derive(v_snap, '{}'::jsonb)) c;

  if not (v_fps @> array['lazywait:sync_health','order_flow:health','platform:health']) then
    raise exception 'FAIL(10): expected lazywait, order_flow and platform conditions, got %', v_fps;
  end if;
  raise notice 'CASE 10 ok: neighbouring branches still derive (%)', v_fps;
end $$;

-- ---- CASE 11: the subsystem has a HUMAN NAME in both languages -------------
-- `operations_alerts_evaluate` calls `operations_alerts_outbox_for_event` on
-- every open / escalate / downgrade / reminder / recover, unconditionally, and
-- that enqueues a rendered AR and EN row. The renderer maps the subsystem id to
-- a name with a `case` that falls back to the RAW ID.
--
-- Without an order_flow arm the first real incident persists an Arabic row
-- reading `[حرج] order_flow — تنبيه جديد` — a bare English identifier dropped
-- into Arabic text, in an Arabic-first product. Adding the label to the
-- frontend map does not help: this rendering happens in the database, before
-- any client sees it. Missed on the first pass here and caught in review.
do $$
declare
  v_ar jsonb;
  v_en jsonb;
begin
  v_ar := public.operations_alerts_render_event('opened', 'ar', 'order_flow', 'flow_stopped', 'critical');
  v_en := public.operations_alerts_render_event('opened', 'en', 'order_flow', 'flow_stopped', 'critical');

  if (v_ar ->> 'subject') not like '%تدفق الطلبات%' then
    raise exception 'FAIL(11): the Arabic subject does not name the subsystem: %', v_ar ->> 'subject';
  end if;
  if (v_ar ->> 'body') not like '%تدفق الطلبات%' then
    raise exception 'FAIL(11): the Arabic body does not name the subsystem: %', v_ar ->> 'body';
  end if;
  -- The raw id must not survive into either Arabic field.
  if (v_ar ->> 'subject') like '%order_flow%' or (v_ar ->> 'body') like '%order_flow%' then
    raise exception 'FAIL(11): the raw id leaked into Arabic text: % / %',
      v_ar ->> 'subject', v_ar ->> 'body';
  end if;

  if (v_en ->> 'subject') not like '%Order Flow%' then
    raise exception 'FAIL(11): the English subject does not name the subsystem: %', v_en ->> 'subject';
  end if;
  if (v_en ->> 'subject') like '%order_flow%' then
    raise exception 'FAIL(11): the raw id leaked into English text: %', v_en ->> 'subject';
  end if;

  -- A subsystem the renderer genuinely does not know must still fall back
  -- rather than vanish — that behaviour is deliberate and must not regress.
  if public.operations_alerts_render_event('opened', 'en', 'brand_new_thing', 'x', 'warning') ->> 'subject'
     not like '%brand_new_thing%' then
    raise exception 'FAIL(11): the unknown-subsystem fallback was lost';
  end if;
  raise notice 'CASE 11 ok: order_flow renders as تدفق الطلبات / Order Flow, fallback intact';
end $$;

-- ---- CASE 12: end to end through the outbox --------------------------------
-- Case 11 tests the renderer directly. This one drives the path the evaluator
-- actually uses, so a change to how the outbox calls the renderer cannot slip
-- past.
do $$
declare
  v_event_id uuid;
  v_alert_id uuid;
  v_n integer;
  v_bad integer;
begin
  insert into public.operations_alert_state
    (fingerprint, subsystem, condition_code, severity, status, generation, baseline, safe_evidence)
  values ('order_flow:health', 'order_flow', 'flow_stopped', 'critical', 'open', 1, false, '{}'::jsonb)
  returning id into v_alert_id;

  insert into public.operations_alert_events
    (alert_id, fingerprint, event_type, severity, notification_suppressed, safe_evidence)
  values (v_alert_id, 'order_flow:health', 'opened', 'critical', false, '{}'::jsonb)
  returning id into v_event_id;

  v_n := public.operations_alerts_outbox_for_event(
           v_event_id, 'opened', 'order_flow', 'flow_stopped', 'critical');
  if v_n < 1 then
    raise exception 'FAIL(12): the outbox enqueued nothing (%)', v_n;
  end if;

  if v_n <> 2 then
    raise exception 'FAIL(12): expected one row per language, got %', v_n;
  end if;

  -- Only the HUMAN-FACING fields are checked. `template_data` deliberately
  -- carries the raw subsystem id as machine data, and must keep doing so — a
  -- blanket check over the whole row would flag that as a leak and be wrong.
  select count(*) into v_bad
    from public.operations_alert_outbox
   where alert_event_id = v_event_id
     and (subject_safe like '%order_flow%' or body_safe like '%order_flow%');
  if v_bad > 0 then
    raise exception 'FAIL(12): % outbox row(s) carry the raw id instead of a label', v_bad;
  end if;

  -- Both languages present, each naming the subsystem in its own script.
  if not exists (select 1 from public.operations_alert_outbox
                  where alert_event_id = v_event_id and language = 'ar'
                    and subject_safe like '%تدفق الطلبات%') then
    raise exception 'FAIL(12): no Arabic outbox row naming the subsystem';
  end if;
  if not exists (select 1 from public.operations_alert_outbox
                  where alert_event_id = v_event_id and language = 'en'
                    and subject_safe like '%Order Flow%') then
    raise exception 'FAIL(12): no English outbox row naming the subsystem';
  end if;

  -- The machine payload SHOULD still carry the raw id; assert it rather than
  -- leaving it to chance, since a future "sanitise everything" change could
  -- silently strip the field the dispatcher will need.
  if not exists (select 1 from public.operations_alert_outbox
                  where alert_event_id = v_event_id
                    and template_data ->> 'subsystem' = 'order_flow') then
    raise exception 'FAIL(12): template_data lost the machine-readable subsystem';
  end if;
  raise notice 'CASE 12 ok: % outbox rows, labels in both scripts, raw id only in template_data', v_n;
end $$;

do $$ begin
  raise notice 'order_flow_alert_condition_test: ALL CASES PASSED';
end $$;

rollback;
