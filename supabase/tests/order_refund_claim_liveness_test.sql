-- ============================================================================
-- claim_order_refund() LIVENESS + single-claim safety under real concurrency
-- (migration 20260724120000_order_confirmation_state_machine).
--
-- PROPERTY UNDER TEST: an unavailable FIRST candidate must not prevent a later
-- eligible refund from being claimed. `claim_order_refund` scans candidates
-- oldest-first and then locks and RE-VALIDATES each one individually; the
-- earlier `… for update skip locked limit 1` form could yield ZERO rows when its
-- single candidate became unavailable, idling the worker while refunds waited.
--
-- This suite uses dblink for a genuine second session, so fixtures must be
-- COMMITTED (they are created and dropped through the remote connection using
-- fixed ids, and this file therefore does NOT wrap itself in a rollback).
--
-- HONEST LIMIT: the exact variant that broke the old form — a concurrent claim
-- COMMITTING between our snapshot and our row lock, so the locked row fails the
-- post-lock re-check — is a true race and cannot be forced deterministically
-- from SQL. The fix removes it structurally (each candidate is validated under
-- its own lock, and the scan advances instead of stopping). What is asserted
-- here is the observable property plus single-claim safety.
--
-- No provider, payment, Lazywait, email, push, SMS or OTP call is made.
-- ============================================================================

select set_config('test.is_admin', 'true', true);

do $$
declare
  v_conn text := coalesce(nullif(current_setting('test.dblink_conninfo', true), ''), '');
  v_o1 uuid := '00000000-0000-0000-0000-0000000000f1';
  v_o2 uuid := '00000000-0000-0000-0000-0000000000f2';
  v_r1 uuid := '00000000-0000-0000-0000-0000000000e1';
  v_r2 uuid := '00000000-0000-0000-0000-0000000000e2';
  v_claim1 uuid; v_claim2 uuid;
  v_tok1 text; v_status1 text;
begin
  if v_conn = '' then
    raise notice 'SKIP claim liveness (no test.dblink_conninfo)';
    return;
  end if;
  if not exists (select 1 from pg_extension where extname = 'dblink') then
    begin execute 'create extension dblink';
    exception when others then
      raise notice 'SKIP claim liveness (dblink unavailable)'; return;
    end;
  end if;

  -- ---- committed fixtures (idempotent; cleaned up at the end) ---------------
  -- session_replication_role=replica on the REMOTE side so synthetic branch and
  -- customer ids do not trip foreign keys, and so the orders' own lifecycle
  -- triggers do not rewrite the state we are pinning.
  perform dblink_exec(v_conn, format($f$
    set session_replication_role = replica;
    delete from public.order_refunds where id in (%L, %L);
    delete from public.orders        where id in (%L, %L);
    insert into public.orders (id, customer_id, order_number, branch_id, order_type,
      subtotal, total, payment_method, payment_status, lazywait_sync_state,
      pos_customer_retry_count, refund_state)
    values (%L, gen_random_uuid(), 'CLV-1', gen_random_uuid(), 'pickup', 50, 50,
            'online', 'paid', 'dead_letter', 3, 'pending'),
           (%L, gen_random_uuid(), 'CLV-2', gen_random_uuid(), 'pickup', 60, 60,
            'online', 'paid', 'dead_letter', 3, 'pending');
    insert into public.order_refunds (id, order_id, provider, idempotency_key,
      amount, currency, status, created_at)
    values (%L, %L, 'tap', 'refund_clv_1', 50, 'SAR', 'pending', now() - interval '2 minutes'),
           (%L, %L, 'tap', 'refund_clv_2', 60, 'SAR', 'pending', now() - interval '1 minute');
    set session_replication_role = origin;
  $f$, v_r1, v_r2, v_o1, v_o2, v_o1, v_o2, v_r1, v_o1, v_r2, v_o2));

  -- ---- a concurrent session holds a lock on the OLDEST candidate ------------
  perform dblink_connect('clv_locker', v_conn);
  perform dblink_exec('clv_locker', 'begin');
  -- dblink_exec() rejects row-returning statements, so the lock is taken through
  -- dblink() with a column definition list and the row discarded.
  perform * from dblink('clv_locker',
    format('select 1 from public.order_refunds where id = %L for update', v_r1)) as t(x integer);

  -- ---- the claim must skip the locked candidate and take the next ----------
  select refund_id into v_claim1 from public.claim_order_refund('CLV-TOKEN-A');
  if v_claim1 is null then
    perform dblink_exec('clv_locker', 'rollback');
    perform dblink_disconnect('clv_locker');
    raise exception 'LIVENESS FAILED: claim returned nothing while an eligible refund existed';
  end if;
  if v_claim1 <> v_r2 then
    perform dblink_exec('clv_locker', 'rollback');
    perform dblink_disconnect('clv_locker');
    raise exception 'LIVENESS FAILED: expected the second refund (%), got %', v_r2, v_claim1;
  end if;

  -- The blocked candidate must be untouched by our claim (no stolen lease).
  select status, claim_token into v_status1, v_tok1
    from public.order_refunds where id = v_r1;
  if v_status1 <> 'pending' or v_tok1 is not null then
    perform dblink_exec('clv_locker', 'rollback');
    perform dblink_disconnect('clv_locker');
    raise exception 'LIVENESS FAILED: locked candidate was mutated (status=% token=%)',
      v_status1, v_tok1;
  end if;

  -- ---- release the lock; the first candidate becomes claimable -------------
  perform dblink_exec('clv_locker', 'rollback');
  perform dblink_disconnect('clv_locker');

  select refund_id into v_claim2 from public.claim_order_refund('CLV-TOKEN-B');
  if v_claim2 is distinct from v_r1 then
    raise exception 'LIVENESS FAILED: released candidate not claimable (got %)', v_claim2;
  end if;

  -- ---- single-claim safety: nothing is left claimable ----------------------
  if (select refund_id from public.claim_order_refund('CLV-TOKEN-C')) is not null then
    raise exception 'SAFETY FAILED: a third claim succeeded on two refunds';
  end if;

  -- Two distinct refunds, two distinct tokens — never the same lease twice.
  if (select count(distinct claim_token) from public.order_refunds
       where id in (v_r1, v_r2) and claim_token is not null) <> 2 then
    raise exception 'SAFETY FAILED: claims did not receive distinct lease tokens';
  end if;

  raise notice 'CLAIM LIVENESS OK';

  -- ---- cleanup (committed fixtures must not survive the suite) -------------
  -- Deliberately LOCAL, not over dblink: the claims above hold row locks in THIS
  -- still-open transaction, so a remote DELETE would wait on us while we wait on
  -- it — a self-deadlock. A local delete commits with this DO block.
  set local session_replication_role = replica;
  delete from public.order_refunds where id in (v_r1, v_r2);
  delete from public.orders        where id in (v_o1, v_o2);
  set local session_replication_role = origin;

exception when others then
  -- Never leave a stray connection or committed fixture behind on failure.
  begin perform dblink_disconnect('clv_locker'); exception when others then null; end;
  begin
    set local session_replication_role = replica;
    delete from public.order_refunds where id in (v_r1, v_r2);
    delete from public.orders        where id in (v_o1, v_o2);
    set local session_replication_role = origin;
  exception when others then null; end;
  raise;
end $$;
