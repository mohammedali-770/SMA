-- ============================================================================
-- Order-flow health card (migration 20260807150000).
--
-- WHAT THIS PINS. Every other card in the snapshot watches a SUBSYSTEM. This
-- one watches the business outcome — orders arriving — which is the outage the
-- console could not previously see: checkout breaks, orders go to zero, and
-- every subsystem stays green because none of them is broken.
--
-- A card like that is only useful if it is trusted, so the properties that
-- matter most here are the ones that stop it crying wolf:
--
--   * it reports `idle`, never `failing`, while its baseline is warming up;
--   * it reports `idle` when no branch is open, because zero orders is then
--     the CORRECT reading and not an incident;
--   * `idle` must not move `overall_state` off healthy;
--   * and when it DOES fire, it must be because branches are open, history
--     says orders were expected, and none arrived.
--
-- The baseline is the SAME rolling window shifted back whole weeks, so the
-- fixtures seed orders inside `(now - N weeks - 60min, now - N weeks]`. Whole
-- weeks preserve weekday and time of day for free.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

-- The snapshot is service_role-gated internally? No — it is SECURITY DEFINER
-- with EXECUTE granted to service_role only, and these suites run as superuser,
-- so it is directly callable here.

create or replace function pg_temp.order_flow_card()
returns jsonb language sql as $$
  select s
    from jsonb_array_elements(public.operations_health_snapshot_internal() -> 'systems') s
   where s ->> 'id' = 'order_flow';
$$;

create or replace function pg_temp.order_flow_state()
returns text language sql as $$
  select pg_temp.order_flow_card() ->> 'state';
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- supabase/seed.sql already seeds branches. Record the starting state so the
-- assertions below are about what THIS suite changes.
create temporary table t_of (
  branch_a uuid, cust uuid, started_open integer
) on commit drop;

do $$
declare
  v_branch uuid := gen_random_uuid();
  v_cust   uuid := gen_random_uuid();
  v_open   integer;
begin
  select count(*) filter (where is_active) into v_open from public.branches;

  insert into auth.users (id) values (v_cust) on conflict (id) do nothing;
  insert into public.profiles (id, full_name, phone_number, role)
    values (v_cust, 'Flow Cust', '+966500000051', 'customer')
  on conflict (id) do update set role = excluded.role;

  insert into public.branches (id, name_en, name_ar, is_active)
  values (v_branch, 'Flow Branch', 'فرع التدفق', true)
  on conflict (id) do nothing;

  insert into t_of values (v_branch, v_cust, v_open);
  raise notice 'FIXTURE ok: % branches were already open', v_open;
end $$;

-- Seeds N orders inside the comparable window N weeks back. Offset 30 minutes
-- into the window rather than sitting exactly on its `now() - N weeks` edge:
-- an assertion that depends on a boundary being inclusive is one refactor away
-- from a confusing failure.
create or replace function pg_temp.seed_week(p_weeks integer, p_count integer)
returns void language plpgsql as $$
declare c record; i integer;
begin
  select * into c from t_of;
  for i in 1..p_count loop
    insert into public.orders (customer_id, branch_id, order_type, status,
                               subtotal, total, payment_method, payment_status, created_at)
    values (c.cust, c.branch_a, 'pickup', 'delivered', 10, 10, 'cash', 'pending',
            now() - make_interval(weeks => p_weeks) - interval '30 minutes');
  end loop;
end $$;

-- ---- CASE 1: no baseline yet -> idle, NOT failing --------------------------
-- The single most important property. A brand-new deployment has no history,
-- and a card that screams `failing` on day one is a card nobody will believe on
-- day ninety.
do $$
declare v_state text; v_card jsonb;
begin
  v_state := pg_temp.order_flow_state();
  v_card  := pg_temp.order_flow_card();

  if v_state is null then
    raise exception 'FAIL(1): there is no order_flow card in the snapshot at all';
  end if;
  if v_state <> 'idle' then
    raise exception 'FAIL(1): with no baseline the card is %, expected idle (card=%)', v_state, v_card;
  end if;
  if (v_card -> 'details' ->> 'baseline_ready')::boolean is not false then
    raise exception 'FAIL(1): baseline_ready should be false before any history exists';
  end if;
  if (v_card ->> 'critical')::boolean is not true then
    raise exception 'FAIL(1): the card must be in the critical set';
  end if;
  raise notice 'CASE 1 ok: no baseline -> idle, and the card is critical';
end $$;

-- ---- CASE 2: idle must NOT move overall_state ------------------------------
do $$
declare v_overall text;
begin
  v_overall := public.operations_health_snapshot_internal() ->> 'overall_state';
  -- Whatever the other subsystems say, an idle order_flow must not be the
  -- reason overall_state is anything other than what they make it.
  if public.operations_health_overall_state('healthy','healthy','healthy','healthy','idle')
     <> 'healthy' then
    raise exception 'FAIL(2): an idle order_flow moved overall_state off healthy';
  end if;
  if public.operations_health_overall_state('healthy','healthy','healthy','healthy','failing')
     <> 'failing' then
    raise exception 'FAIL(2): a failing order_flow did NOT reach overall_state';
  end if;
  if public.operations_health_overall_state('healthy','healthy','healthy','healthy','degraded')
     <> 'degraded' then
    raise exception 'FAIL(2): a degraded order_flow did NOT reach overall_state';
  end if;
  -- The 4-arg overload must still exist and behave exactly as before.
  if public.operations_health_overall_state('healthy','healthy','healthy','failing')
     <> 'failing' then
    raise exception 'FAIL(2): the 4-arg overload changed behaviour';
  end if;
  raise notice 'CASE 2 ok: idle is inert, failing/degraded propagate, 4-arg overload intact (overall=%)', v_overall;
end $$;

-- ---- CASE 3: baseline present + branches open + NO orders -> failing -------
do $$
declare v_state text; v_card jsonb;
begin
  -- Three comparable weeks, 5 orders each, inside the same rolling window.
  perform pg_temp.seed_week(1, 5);
  perform pg_temp.seed_week(2, 5);
  perform pg_temp.seed_week(3, 5);

  v_card  := pg_temp.order_flow_card();
  v_state := v_card ->> 'state';

  if (v_card -> 'details' ->> 'baseline_ready')::boolean is not true then
    raise exception 'FAIL(3): 3 seeded weeks did not produce a ready baseline (details=%)',
      v_card -> 'details';
  end if;
  if (v_card -> 'details' ->> 'baseline_samples')::int < 3 then
    raise exception 'FAIL(3): baseline_samples is %, expected >= 3',
      v_card -> 'details' ->> 'baseline_samples';
  end if;
  if v_state <> 'failing' then
    raise exception 'FAIL(3): branches open, baseline says 5/hour, 0 orders arrived — expected failing, got % (details=%)',
      v_state, v_card -> 'details';
  end if;
  raise notice 'CASE 3 ok: open branches + baseline + zero orders -> failing';
end $$;

-- ---- CASE 4: recent orders clear it -----------------------------------------
do $$
declare c record; v_state text; i integer;
begin
  select * into c from t_of;
  for i in 1..5 loop
    insert into public.orders (customer_id, branch_id, order_type, status,
                               subtotal, total, payment_method, payment_status, created_at)
    values (c.cust, c.branch_a, 'pickup', 'received', 10, 10, 'cash', 'pending', now());
  end loop;

  v_state := pg_temp.order_flow_state();
  if v_state <> 'healthy' then
    raise exception 'FAIL(4): 5 orders against a baseline of 5 should be healthy, got % (details=%)',
      v_state, pg_temp.order_flow_card() -> 'details';
  end if;
  raise notice 'CASE 4 ok: orders arriving at baseline -> healthy';
end $$;

-- ---- CASE 5: well below baseline -> degraded, not failing ------------------
do $$
declare c record; v_state text;
begin
  select * into c from t_of;
  -- Drop back to 1 order in the window against a baseline of 5 (1 < 5*0.4).
  delete from public.orders where created_at >= now() - interval '60 minutes';
  insert into public.orders (customer_id, branch_id, order_type, status,
                             subtotal, total, payment_method, payment_status, created_at)
  values (c.cust, c.branch_a, 'pickup', 'received', 10, 10, 'cash', 'pending', now());

  v_state := pg_temp.order_flow_state();
  if v_state <> 'degraded' then
    raise exception 'FAIL(5): 1 order against a baseline of 5 should be degraded, got % (details=%)',
      v_state, pg_temp.order_flow_card() -> 'details';
  end if;
  raise notice 'CASE 5 ok: far below baseline -> degraded (not failing)';
end $$;

-- ---- CASE 6: nothing open -> idle, however bad the numbers look ------------
-- Zero orders while every branch is closed is the CORRECT reading.
--
-- CORRECTION (2026-08-07): this comment used to claim this is "the arm that
-- stops the card firing every night after closing time". It is not, and the
-- distinction matters if you are reasoning about false alarms.
-- `open_branches` counts `branches.is_active`, a configuration flag — the schema
-- carries NO opening-hours data at all — so this arm fires only when every
-- branch is deactivated, which is an admin action, not a nightly event.
--
-- What actually keeps the card quiet overnight is the MINIMUM-SAMPLE arm,
-- `baseline_samples < 3`. At 04:00 the historical 04:00 windows are equally
-- empty, every `c` is 0, the `where c > 0` filter drops them all, and the
-- sample count is 0 — so that arm returns `idle` before anything else is
-- considered.
--
-- It is NOT the `baseline < 1` arm, which is unreachable: the same `where c > 0`
-- filter means every counted sample is at least 1, so a non-empty baseline
-- always averages >= 1, and an empty one has already been caught by the
-- sample-count arm above. Verified by exhaustive search over the 8 weekly
-- window counts — no combination reaches it. Harmless dead code, but it should
-- not be described as a guard that does something.
--
-- This case still pins real and useful behaviour; it just is not the
-- night-time guard.
do $$
declare v_state text; v_card jsonb;
begin
  delete from public.orders where created_at >= now() - interval '60 minutes';
  update public.branches set is_active = false;

  v_card  := pg_temp.order_flow_card();
  v_state := v_card ->> 'state';

  if (v_card -> 'details' ->> 'open_branches')::int <> 0 then
    raise exception 'FAIL(6): fixture did not close every branch';
  end if;
  if v_state <> 'idle' then
    raise exception 'FAIL(6): every branch closed and 0 orders should be idle, got %', v_state;
  end if;
  raise notice 'CASE 6 ok: all branches closed -> idle, not an incident';
end $$;

-- ---- CASE 7: the card carries no PII and no raw customer data --------------
-- The snapshot contract is that it returns no PII. The new card reads
-- public.orders, which is the most PII-dense table in the schema, so this is
-- worth asserting rather than assuming.
do $$
declare
  v_details jsonb;
  v_allowed text[] := array['window_minutes','orders_in_window','open_branches',
                            'total_branches','baseline_orders','baseline_samples',
                            'baseline_min_samples','baseline_ready','safe_error_code'];
  k text;
begin
  update public.branches set is_active = true;   -- restore for later suites
  v_details := pg_temp.order_flow_card() -> 'details';

  for k in select jsonb_object_keys(v_details) loop
    if k <> all(v_allowed) then
      raise exception 'FAIL(7): the order_flow card exposes an unexpected key %', k;
    end if;
  end loop;

  -- Every value is a scalar count/flag — no nested objects or arrays that could
  -- smuggle a row through.
  if exists (
    select 1 from jsonb_each(v_details) e
     where jsonb_typeof(e.value) in ('object','array')
  ) then
    raise exception 'FAIL(7): the order_flow card carries a nested object/array';
  end if;
  raise notice 'CASE 7 ok: counts and flags only, no PII, no nested rows';
end $$;

-- ---- CASE 8: order_flow is named in the critical set -----------------------
do $$
declare v_critical jsonb;
begin
  v_critical := public.operations_health_snapshot_internal() -> 'critical_systems';
  if not (v_critical ? 'order_flow') then
    raise exception 'FAIL(8): order_flow is missing from critical_systems (%)', v_critical;
  end if;
  -- The four pre-existing members must still be there.
  foreach v_critical in array array['"lazywait"'::jsonb, '"order_integrity"'::jsonb,
                                    '"account_deletion"'::jsonb, '"database_jobs"'::jsonb] loop
    if not (public.operations_health_snapshot_internal() -> 'critical_systems' @> jsonb_build_array(v_critical)) then
      raise exception 'FAIL(8): a pre-existing critical system was dropped: %', v_critical;
    end if;
  end loop;
  raise notice 'CASE 8 ok: critical_systems gained order_flow and lost nothing';
end $$;

do $$ begin
  raise notice 'order_flow_health_card_test: ALL CASES PASSED';
end $$;

rollback;
