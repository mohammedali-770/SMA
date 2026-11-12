-- 20261004120000_drop_tap_payment_rpcs.sql
--
-- DROP THE TWO TAP-ONLY PAYMENT RPCs.
--
-- tap_begin_payment_attempt(uuid, text, integer) and
-- tap_begin_session_attempt(uuid, text, integer) open a payment attempt with
-- the provider hard-coded to 'tap'. Moyasar is the only provider (owner
-- decision 2026-11-11, CLAUDE.md §6). 20260824100000 creates the
-- provider-generic replacements, begin_payment_attempt and
-- begin_session_attempt, and 20261003120000 ports to the second the one thing
-- only the Tap session RPC had: the loyalty multi-spend guard.
--
-- NOT APPLIED by this change. Applying it is a §5 action, named by version.
--
-- APPLY IT ONLY AFTER THE MOYASAR-ONLY payment-initiate IS DEPLOYED. The live
-- payment-initiate (v8, deployed 2026-07-13) still calls both functions on its
-- 'tap' branch. That branch cannot be reached while the payment row's provider
-- is 'moyasar', but it is the only way back to Tap while v8 is live. Once the
-- Moyasar-only function is deployed, nothing calls them.
--
-- Read live 2026-11-11, read-only: both functions exist, SECURITY DEFINER,
-- executable by service_role only. No other function body in any schema names
-- them, and pg_depend lists no dependents. Their only callers are in
-- supabase/functions/payment-initiate.
--
-- WHAT STAYS. payment_records and its 9 Tap history rows are untouched. So are
-- the provider-scoped one-active indexes, which guard Moyasar against a double
-- charge too, and every provider-generic RPC: begin_payment_attempt,
-- begin_session_attempt, finalize_checkout_session, confirm_order_payment and
-- the refund stack.
--
-- SELF-VERIFYING. It refuses to apply:
--   * unless 20261003120000 is applied, so the loyalty guard is never dropped
--     with its last copy;
--   * if any other function body, or any cron command, names a tap_begin_
--     function.
-- Afterwards it asserts that no function of either name remains, that the
-- replacements are still service-role only, and that the money path is
-- unchanged. `drop function` runs without CASCADE, so a dependent object makes
-- the apply fail instead of disappearing with it.
--
-- NO DEPLOY IMPLIED by this file. The deploy above has to come FIRST.
--
-- ROLLBACK, as a new migration (never an edit of an applied file): re-create
-- tap_begin_payment_attempt from 20260724180000 and tap_begin_session_attempt
-- from 20260712170000, each with its revoke/grant pair.

-- ---- 0. Preconditions -------------------------------------------------------
do $pre$
declare
  v_n   integer;
  v_src text;
  v_txt text;
begin
  -- The replacements exist, and the session one carries the guard. Cardinality
  -- first, so the body read below is THE definition.
  if to_regprocedure('public.begin_payment_attempt(uuid,text,text,integer)') is null then
    raise exception 'begin_payment_attempt(uuid,text,text,integer) does not exist: apply 20260824100000 and 20261003120000 first';
  end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'begin_session_attempt';
  if v_n <> 1 then
    raise exception 'expected exactly one begin_session_attempt, found %: apply 20260824100000 and 20261003120000 first', v_n;
  end if;
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'begin_session_attempt';
  if position('if v_balance < v_redeem + v_other then' in v_src) = 0 then
    raise exception 'begin_session_attempt does not carry the loyalty multi-spend guard: apply 20261003120000 first';
  end if;

  -- Nothing else names them. plpgsql bodies are not tracked in pg_depend, so
  -- the drop below could not see such a caller; this scan can.
  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.prosrc like '%tap\_begin\_%'
     and not (n.nspname = 'public'
              and p.proname in ('tap_begin_payment_attempt', 'tap_begin_session_attempt'));
  if v_txt is not null then
    raise exception 'a function body still names a Tap payment RPC: %', v_txt;
  end if;
  select string_agg(jobname, ', ' order by jobname) into v_txt
    from cron.job where command like '%tap\_begin\_%';
  if v_txt is not null then
    raise exception 'a cron job still calls a Tap payment RPC: %', v_txt;
  end if;
end
$pre$;

-- ---- 1. The drop ------------------------------------------------------------
drop function if exists public.tap_begin_payment_attempt(uuid, text, integer);
drop function if exists public.tap_begin_session_attempt(uuid, text, integer);

-- ---- 2. Self-verification ---------------------------------------------------
do $verify$
declare
  v_n    integer;
  v_fn   text;
  v_hash text;
begin
  -- 2.1 GONE, under any signature.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('tap_begin_payment_attempt', 'tap_begin_session_attempt');
  if v_n <> 0 then
    raise exception '% Tap payment RPC definition(s) remain', v_n;
  end if;

  -- 2.2 THE REPLACEMENTS ARE UNTOUCHED: present, service_role only, and the
  --     session one still carries the loyalty guard, now its only copy.
  foreach v_fn in array array['public.begin_payment_attempt(uuid,text,text,integer)',
                              'public.begin_session_attempt(uuid,text,text,integer)'] loop
    if to_regprocedure(v_fn) is null then
      raise exception '% is missing', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception '% is executable by a client role', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception '% is not executable by service_role', v_fn;
    end if;
  end loop;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'begin_session_attempt'
       and position('if v_balance < v_redeem + v_other then'
                    in regexp_replace(p.prosrc, '--[^\n]*', '', 'g')) > 0
  ) then
    raise exception 'begin_session_attempt no longer carries the loyalty multi-spend guard';
  end if;

  -- 2.3 MONEY PATH UNCHANGED. Cardinality first, by name, `is distinct from`.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_n <> 1 then
    raise exception 'expected exactly one place_order, found %', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_hash
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_hash is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'place_order moved to %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_hash, 'NULL');
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_n <> 1 then
    raise exception 'expected exactly one compute_order_snapshot, found %', v_n;
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_hash
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_hash is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_hash, 'NULL');
  end if;
end
$verify$;
