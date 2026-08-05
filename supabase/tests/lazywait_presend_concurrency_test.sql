
-- A branch to hang test orders on. `orders.branch_id` is a real FK to
-- public.branches, and every case below cares about sync / payment / integrity
-- state rather than about WHICH branch, so one fixed row serves all of them.
-- Self-contained on purpose: not the seed's branch, so the suite does not
-- depend on supabase/seed.sql having been loaded.
insert into public.branches (id, name_en, name_ar)
values ('b0000000-0000-0000-0000-0000000000ff', 'Suite Branch', 'فرع الاختبار')
on conflict (id) do nothing;

-- ============================================================================
-- TRUE cross-session concurrency test for the pre-send validation
-- (validate_pos_sync_notification_before_send) — proves it LOCKS the order row
-- and therefore SERIALIZES against a concurrent Lazywait worker updating the same
-- order. Uses dblink to drive real second/third backends.
--
-- PORTABILITY: needs dblink AND a self-connection string in the GUC
-- `test.dblink_conninfo`, e.g.:
--   psql -c "set test.dblink_conninfo='host=/tmp port=5433 dbname=t1 user=postgres'" -f this.sql
-- If dblink is unavailable or the GUC is empty, the test SKIPS with a NOTICE so
-- the standard single-session suite stays green everywhere.
--
-- IMPORTANT: fixture writes are TOP-LEVEL statements (psql autocommit), so the
-- main session never holds an order/notification lock while a dblink backend
-- needs it (an in-DO-block write would self-deadlock against the dblink call).
-- The DO blocks only orchestrate dblink + read/assert. Fixed sentinel id;
-- idempotent setup self-heals a prior failed run; committed cleanup at the end.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    begin execute 'create extension dblink'; exception when others then null; end;
  end if;
end $$;

-- ===== Test 1 fixture (committed): a genuinely-retrying order + claimed event ==
delete from public.notification_log where order_id = '00000000-0000-0000-0000-0000000000c1';
delete from public.orders            where id       = '00000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
  lazywait_sync_state, sync_next_attempt_at, pos_sync_started_at, pos_sync_deadline_at)
  values ('00000000-0000-0000-0000-0000000000c1', 'PC-1', 'b0000000-0000-0000-0000-0000000000ff', 'pickup', 10, 10,
          'failed', now() + interval '2 minutes', now() - interval '1 minute', now() + interval '9 minutes');
insert into public.notification_log (kind, order_id, status, send_status, claim_token)
  values ('pos_sync', '00000000-0000-0000-0000-0000000000c1', 'pos_retrying', 'processing', 'OWNER');

-- ===== Test 1: validator SERIALIZES on the order row; sees the post-commit state
do $$
declare
  v_conninfo text := coalesce(nullif(current_setting('test.dblink_conninfo', true), ''), '');
  v_oid uuid := '00000000-0000-0000-0000-0000000000c1';
  v_busy int; v_res text;
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    raise notice 'SKIP presend concurrency: dblink extension unavailable.'; return;
  end if;
  if v_conninfo = '' then
    raise notice 'SKIP presend concurrency: set test.dblink_conninfo to a self-connection string to run.'; return;
  end if;

  begin
    -- c_hold holds the order lock in an OPEN transaction (order still 'failed').
    perform dblink_connect('c_hold', v_conninfo);
    perform dblink_exec('c_hold', 'begin');
    perform t.x from dblink('c_hold', format('select 1 from public.orders where id = %L for update', v_oid)) as t(x int);

    -- c_val runs the validator ASYNC; it MUST block on c_hold's order lock.
    perform dblink_connect('c_val', v_conninfo);
    perform dblink_send_query('c_val', format(
      'select public.validate_pos_sync_notification_before_send(%L, ''pos_retrying'', ''OWNER'')', v_oid));
    perform pg_sleep(0.3);
    select dblink_is_busy('c_val') into v_busy;
    if v_busy <> 1 then
      raise exception 'CONCURRENCY 1 FAILED: validator did NOT serialize on the order lock (busy=%)', v_busy;
    end if;

    -- The concurrent worker commits failed -> synced, releasing the lock.
    perform dblink_exec('c_hold', format(
      'update public.orders set lazywait_sync_state = ''synced'', lazywait_ref = ''REFPC'' where id = %L', v_oid));
    perform dblink_exec('c_hold', 'commit');

    -- Validator unblocks and, seeing 'synced', must return 'superseded' (no send).
    select r into v_res from dblink_get_result('c_val') as t(r text);
    if v_res is distinct from 'superseded' then
      raise exception 'CONCURRENCY 1 FAILED: expected superseded after concurrent sync, got %', v_res;
    end if;
    perform t.r from dblink_get_result('c_val') as t(r text);  -- drain
    perform dblink_disconnect('c_val');
    perform dblink_disconnect('c_hold');

    if (select send_status from public.notification_log
          where order_id = v_oid and status = 'pos_retrying') <> 'superseded' then
      raise exception 'CONCURRENCY 1 FAILED: notification row not marked superseded';
    end if;
    raise notice 'CONCURRENCY 1 OK: validator serialized on the order row -> superseded, zero send.';
  exception when others then
    begin perform dblink_disconnect('c_val');  exception when others then null; end;
    begin perform dblink_disconnect('c_hold'); exception when others then null; end;
    raise;
  end;
end $$;

-- ===== Test 2 fixture (committed): a valid claimed pos_confirmed ==============
update public.orders set lazywait_sync_state = 'synced', lazywait_ref = 'REFPC2'
  where id = '00000000-0000-0000-0000-0000000000c1';
insert into public.notification_log (kind, order_id, status, send_status, claim_token)
  values ('pos_sync', '00000000-0000-0000-0000-0000000000c1', 'pos_confirmed', 'processing', 'OWNER2');

-- ===== Test 2: validator holds the order lock; a concurrent worker UPDATE WAITS
do $$
declare
  v_conninfo text := coalesce(nullif(current_setting('test.dblink_conninfo', true), ''), '');
  v_oid uuid := '00000000-0000-0000-0000-0000000000c1';
  v_busy int; v_res text;
begin
  if not exists (select 1 from pg_extension where extname = 'dblink') then return; end if;
  if v_conninfo = '' then return; end if;

  begin
    -- c_val2 validates inside an OPEN txn -> ready_to_send and HOLDS the lock.
    perform dblink_connect('c_val2', v_conninfo);
    perform dblink_exec('c_val2', 'begin');
    select r into v_res from dblink('c_val2', format(
      'select public.validate_pos_sync_notification_before_send(%L, ''pos_confirmed'', ''OWNER2'')', v_oid)) as t(r text);
    if v_res is distinct from 'ready_to_send' then
      raise exception 'CONCURRENCY 2 FAILED: expected ready_to_send, got %', v_res;
    end if;

    -- A concurrent worker UPDATE on the same order MUST block on the validator lock.
    perform dblink_connect('c_work', v_conninfo);
    perform dblink_send_query('c_work', format(
      'update public.orders set lazywait_status = ''z'' where id = %L', v_oid));
    perform pg_sleep(0.3);
    select dblink_is_busy('c_work') into v_busy;
    if v_busy <> 1 then
      raise exception 'CONCURRENCY 2 FAILED: worker was NOT blocked by the validator lock (busy=%)', v_busy;
    end if;

    -- Validator commits -> releases the lock -> the worker proceeds.
    perform dblink_exec('c_val2', 'commit');
    perform t.r from dblink_get_result('c_work') as t(r text);
    perform t.r from dblink_get_result('c_work') as t(r text);
    perform dblink_disconnect('c_work');
    perform dblink_disconnect('c_val2');
    raise notice 'CONCURRENCY 2 OK: validator lock forced the worker to wait; ready_to_send.';
    raise notice 'ALL PRESEND CONCURRENCY CASES PASSED';
  exception when others then
    begin perform dblink_disconnect('c_work'); exception when others then null; end;
    begin perform dblink_disconnect('c_val2'); exception when others then null; end;
    raise;
  end;
end $$;

-- Cleanup (committed).
delete from public.notification_log where order_id = '00000000-0000-0000-0000-0000000000c1';
delete from public.orders            where id       = '00000000-0000-0000-0000-0000000000c1';
