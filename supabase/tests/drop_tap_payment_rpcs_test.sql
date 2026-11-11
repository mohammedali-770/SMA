-- ============================================================================
-- The Tap payment RPCs are gone (migration
-- 20261004120000_drop_tap_payment_rpcs.sql), and what replaced them is intact.
--
-- Runs against a throwaway Postgres with the FULL migration chain applied.
-- Each case RAISES EXCEPTION on failure; everything is rolled back.
--
-- The migration asserts the same at apply time. This suite keeps asserting it
-- on every later chain, so a future file that re-creates a Tap RPC, or drops
-- a replacement, fails CI instead of shipping.
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- CASE 1: neither Tap RPC exists under any signature, and nothing that runs in
-- the database still names one: no function body, no cron command.
-- ---------------------------------------------------------------------------
do $$
declare
  v_txt text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_txt
    from pg_proc p
   where p.proname in ('tap_begin_payment_attempt', 'tap_begin_session_attempt');
  if v_txt is not null then
    raise exception 'CASE 1 FAILED: still defined: %', v_txt;
  end if;

  select string_agg(n.nspname || '.' || p.proname, ', ') into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and p.prosrc like '%tap\_begin\_%';
  if v_txt is not null then
    raise exception 'CASE 1 FAILED: a function body still names a Tap payment RPC: %', v_txt;
  end if;

  if exists (select 1 from cron.job where command like '%tap\_begin\_%') then
    raise exception 'CASE 1 FAILED: a cron job still names a Tap payment RPC';
  end if;

  raise notice 'CASE 1 ok: the Tap payment RPCs are gone and nothing names them';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 2: the replacements are intact: both exist, both are service-role
-- only, and the session one carries the loyalty guard 20261003120000 ported,
-- so the guard did not leave with its last Tap copy.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array['public.begin_payment_attempt(uuid,text,text,integer)',
                              'public.begin_session_attempt(uuid,text,text,integer)'] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'CASE 2 FAILED: % is missing', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'CASE 2 FAILED: % is executable by a client role', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'CASE 2 FAILED: % is not executable by service_role', v_fn;
    end if;
  end loop;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'begin_session_attempt'
       and p.prosrc like '%if v\_balance < v\_redeem + v\_other then%'
  ) then
    raise exception 'CASE 2 FAILED: begin_session_attempt lost the loyalty guard';
  end if;

  raise notice 'CASE 2 ok: begin_payment_attempt and begin_session_attempt are intact';
end $$;

rollback;
