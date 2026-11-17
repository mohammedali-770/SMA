-- Spicy Meal — a cancelled order is not started at the POS, not re-queued by
-- the admin Retry, and (with push-dispatch) told nothing about the POS.
-- The three follow-ups #471 (20261012120000_cancelled_orders_guard) listed and
-- left: docs/MIGRATIONS.md §64 and §67, docs/OWNER_ACTIONS.md §57.
--
-- WHAT WAS WRONG, read on the default branch at 708e5fd and live on 2026-11-17:
--
--   * An order cancelled AFTER the worker claimed it was still sent. The claim
--     (since 20261012120000 it never takes a cancelled order) moves the row to
--     'syncing'. The worker then loads items, builds the ticket and, on the cron
--     path, searches the CRM: seconds in which an administrator can cancel.
--     The last check before the POST, begin_lazywait_create_attempt, read the
--     ref, the sync state, the attempt marker and the deadline, never `status`,
--     so it answered 'ready_to_send' and the ticket printed.
--   * The admin Retry re-queued a cancelled order. requeue_lazywait_order asks
--     lazywait_requeue_eligibility, which takes no status. 20261012120000 made
--     the claims skip a cancelled order, so a re-queued one no longer reached the
--     kitchen, but it then sat 'pending' until the stale sweep dead-lettered it
--     at its deadline and enqueued 'pos_failed': "We could not send your order
--     to the restaurant" to a customer whose order had been cancelled.
--   * That push. push-dispatch's pos_sync action checks the event against the
--     sync state (pos_sync_status_matches), never `status`. That half is fixed
--     in supabase/functions/push-dispatch/index.ts, in the same change, and
--     needs its own deploy; see "DEPLOY" below.
--
-- WHAT CHANGES. Two function bodies. No signature, no table, no row:
--
--   1. begin_lazywait_create_attempt refuses a cancelled order with the new
--      status 'order_cancelled', and parks it in the same locked statement:
--      lazywait_sync_state 'blocked', sync_blocked_reason 'order_cancelled',
--      sync_last_error 'order_cancelled_before_send', sync_next_attempt_at null,
--      plus one 'skipped' integration_sync_logs row. No notification is queued.
--      The refusal sits exactly where an attempt would START: after the ref
--      check, the 'syncing' check and the attempt-marker check, and before the
--      deadline checks. So:
--        - a cancelled order with a POS ref still answers already_synced /
--          ref_present_unverified, which is the truth about the POS;
--        - a cancelled order whose send phase another attempt already owns
--          (marker set, other token) still answers invalid_state and is not
--          touched: parking it would take the row from under a request that may
--          be in flight, and hide it from the verification feed;
--        - a cancelled order past its deadline answers order_cancelled, not
--          deadline_expired, so it is parked without a 'pos_failed' event.
--      THE WORKER IS UNCHANGED. lazywait-sync acts on five gate answers and
--      treats any other as "not ready": it logs one JSON line with the order id,
--      counts the order skipped, sends nothing and writes nothing
--      (supabase/functions/_shared/lazywaitCancelledGate.test.ts drives the real
--      handler to prove it). The gate has already parked the row, so nothing is
--      left 'syncing' for the stale reaper, which never touches 'blocked'.
--   2. requeue_lazywait_order refuses a cancelled order, after the admin gate
--      and the lock and before the eligibility predicate, with P0001
--      "order_cancelled: This order was cancelled. A cancelled order is never
--      sent to the branch." The console (LazywaitPanel) shows a refused Retry's
--      message as it is, the same way it shows "deadline_expired: …".
--      lazywait_requeue_eligibility and its client mirror are unchanged.
--
-- WHAT THIS DOES NOT CHANGE, deliberately:
--
--   * lazywait-sync, the claims, the reaper, record_lazywait_sync,
--     pos_sync_status_matches and every notification RPC.
--   * The four delivery orders parked as delivery_schema_unconfirmed, and any
--     order already 'blocked', 'dead_letter' or 'failed': this file writes no row.
--   * A cancelled order whose attempt has already begun under the SAME token
--     still answers ready_to_send. The worker calls the gate once and does not
--     retry it, so that branch is an RPC-retry convenience, not a path a
--     cancellation can reach between claim and POST.
--   * MONEY PATH UNTOUCHED, and the file asserts it before and after:
--     place_order 12b6816d256c29b76edf947ae1a7ea77, compute_order_snapshot
--     22e2d42935459e7bf93abb2941b56325 (md5(pg_get_functiondef)).
--
-- PRE-IMAGES, md5(prosrc). The block below refuses to apply unless each
-- function is a definition this file was derived from or this file's own:
--
--   begin_lazywait_create_attempt  c67adf40dece53accd70637f07fd5ae3  live, 1 235 chars
--                                  b8b8e3b9583c42021750182dd54a6bf9  20260721120000 as the chain replays it
--   requeue_lazywait_order         45d8e8a0d08a1d4f75d4dba84c744452  live and 20260827120000, 1 869 chars
--
-- begin_lazywait_create_attempt has two because the live body is the
-- repository body with every whole-line comment removed: dropping the lines
-- whose first non-blank characters are `--` from 20260721120000's body gives
-- 1 235 chars and c67adf40… exactly (measured 2026-11-17; the same shape as
-- admin_set_order_status in ledger row 92). The new bodies below carry NO
-- comment line between their dollar quotes, so an apply that trims comments
-- for transport stores exactly the same text, and the post-apply hash is one
-- value either way. Their explanation is here, outside the bodies.
--
-- SELF-VERIFICATION, at the foot. Outcomes first: inside a sub-transaction that
-- is then aborted, it writes a probe branch and probe orders (explicit order
-- numbers, so no SM- number is drawn), drives begin_lazywait_create_attempt for
-- a cancelled order and for an order in each of the other five statuses, past
-- and inside the deadline, with and without another attempt's marker, and then
-- proves the rollback. requeue_lazywait_order cannot be driven past its admin
-- gate here: is_admin() needs an administrator's AAL2 session, and building one
-- would mean writing to auth.users in Production, which no migration in this
-- repository does. It is called as far as that gate, and its new statement is
-- checked in the comment-stripped body: present, after the gate and the lock,
-- before the eligibility predicate and the update. Its outcomes are proven by
-- supabase/tests/cancelled_order_followups_test.sql.
--
-- DEPLOY. This file implies none, and none is needed before or after it:
-- lazywait-sync is unchanged and already treats the new answer as "not ready".
-- push-dispatch's half reads orders.status, a column that has always existed,
-- so it can be deployed before or after this file, independently. Apply by
-- version, never as "the outstanding migrations": 20260824100000 (Moyasar,
-- frozen) still sorts ahead of everything (CLAUDE.md §8).

-- ---------------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_n    integer;
  v_hash text;
  v_src  text;
  r      record;
begin
  -- The money-path pair, cardinality first: with two overloads the hash below
  -- would read an arbitrary one.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_n <> 1 then raise exception 'PRECONDITION: expected 1 place_order overload, found %', v_n; end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_n <> 1 then raise exception 'PRECONDITION: expected 1 compute_order_snapshot overload, found %', v_n; end if;

  select md5(pg_get_functiondef(p.oid)) into v_hash from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_hash is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'PRECONDITION: place_order hashes %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_hash, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_hash from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_hash is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'PRECONDITION: compute_order_snapshot hashes %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_hash, 'NULL');
  end if;

  -- Each replaced function: exactly one overload, and either a pre-image this
  -- file was derived from or this file's own version (marked by a statement
  -- only this file writes).
  for r in
    select * from (values
      ('begin_lazywait_create_attempt',
       array['c67adf40dece53accd70637f07fd5ae3', 'b8b8e3b9583c42021750182dd54a6bf9'],
       'order_cancelled_before_send'),
      ('requeue_lazywait_order',
       array['45d8e8a0d08a1d4f75d4dba84c744452'],
       'order_cancelled: This order was cancelled.')
    ) as t(fn, pre, marker)
  loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if v_n <> 1 then raise exception 'PRECONDITION: expected 1 % overload, found %', r.fn, v_n; end if;
    select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if not (md5(coalesce(v_src, '')) = any (r.pre)) and position(r.marker in coalesce(v_src, '')) = 0 then
      raise exception 'PRECONDITION: % hashes % (md5(prosrc)); this file was derived from %. Re-derive it from the live body.',
        r.fn, md5(coalesce(v_src, '')), array_to_string(r.pre, ' or ');
    end if;
  end loop;
end
$pre$;

-- ---------------------------------------------------------------------------
-- 1. begin_lazywait_create_attempt: a cancelled order is parked, not started
-- ---------------------------------------------------------------------------
-- The live body (20260721120000 without its comment lines) with one statement
-- added after the attempt-marker check and before the deadline checks. See the
-- header for why it sits exactly there. Unchanged answers, for the record:
--   ready_to_send | already_synced | ref_present_unverified | deadline_expired
--   | invalid_state | not_found
-- and now order_cancelled, which the worker treats as "not ready".
create or replace function public.begin_lazywait_create_attempt(
  p_order_id      uuid,
  p_attempt_token text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.orders;
begin
  if p_attempt_token is null or p_attempt_token = '' then
    raise exception 'attempt token required' using errcode = '22004';
  end if;

  select * into v_row from public.orders where id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;

  if v_row.lazywait_ref is not null or v_row.lazywait_sync_state = 'synced' then
    if public.lazywait_pos_ref_is_usable(v_row.lazywait_ref) then
      return 'already_synced';
    end if;
    return 'ref_present_unverified';
  end if;

  if v_row.lazywait_sync_state <> 'syncing' then
    return 'invalid_state';
  end if;

  if v_row.pos_create_attempted_at is not null then
    if v_row.pos_create_attempt_token is not distinct from p_attempt_token then
      return 'ready_to_send';
    end if;
    return 'invalid_state';
  end if;

  if v_row.status = 'cancelled' then
    update public.orders
       set lazywait_sync_state  = 'blocked',
           sync_blocked_reason  = 'order_cancelled',
           sync_last_error      = 'order_cancelled_before_send',
           sync_next_attempt_at = null,
           sync_status          = 'failed'::public.sync_status,
           updated_at           = now()
     where id = p_order_id;
    insert into public.integration_sync_logs (provider, order_id, direction, status, error)
      values ('lazywait', p_order_id, 'push', 'skipped', 'order_cancelled_before_send');
    return 'order_cancelled';
  end if;

  if v_row.pos_sync_deadline_at is null then
    return 'invalid_state';
  end if;
  if now() >= v_row.pos_sync_deadline_at then
    return 'deadline_expired';
  end if;

  update public.orders
     set pos_create_attempted_at  = now(),
         pos_create_attempt_token = p_attempt_token,
         updated_at               = now()
   where id = p_order_id;

  return 'ready_to_send';
end $$;
-- create or replace keeps the ACL; restated so it does not depend on history.
revoke all on function public.begin_lazywait_create_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.begin_lazywait_create_attempt(uuid, text) to service_role;
comment on function public.begin_lazywait_create_attempt(uuid, text) is
  'Fenced pre-send gate for the Lazywait Create Order POST: under the row lock, refuses a ref-bearing, non-syncing, already-attempted or past-deadline order, else durably stamps the attempt marker and token and answers ready_to_send (20260721120000). A cancelled order is answered order_cancelled and parked blocked/order_cancelled in the same statement, with no notification (since 20261015120000). Service role only.';

-- ---------------------------------------------------------------------------
-- 2. requeue_lazywait_order: the admin Retry refuses a cancelled order
-- ---------------------------------------------------------------------------
-- Body of 20260827120000 with one statement after the admin gate and the lock
-- and before the eligibility predicate. An administrator is the only caller, so
-- no ownership question arises; the gate still comes first, so a caller who is
-- not an administrator still learns nothing about the order.
create or replace function public.requeue_lazywait_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_elig  text;
begin
  if not public.is_admin() then
    raise exception 'Only admins may requeue Lazywait sync' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'not_found: Order not found' using errcode = 'P0002';
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'order_cancelled: This order was cancelled. A cancelled order is never sent to the branch.'
      using errcode = 'P0001';
  end if;

  v_elig := public.lazywait_requeue_eligibility(
    v_order.lazywait_sync_state, v_order.lazywait_ref, v_order.pos_sync_deadline_at,
    v_order.sync_attempt_count, v_order.pos_create_attempted_at, v_order.order_type::text,
    v_order.sync_blocked_reason);

  if v_elig <> 'requeued' then
    raise exception '%', v_elig || ': ' || case v_elig
      when 'deadline_expired'      then 'Automatic POS retry window has expired. Verify the order manually.'
      when 'confirmation_required' then 'Order needs manual verification; automatic retry is disabled.'
      when 'already_synced'        then 'Order already has a usable POS reference / is synced; never resend.'
      when 'ref_present_unverified' then 'An existing POS reference marker requires manual verification; automatic resend is disabled.'
      when 'may_have_sent'         then 'A Create Order request may already have been sent; verify manually before any resend.'
      when 'attempt_limit_reached' then 'Maximum POS retry attempts reached. Verify the order manually.'
      else                              'Order is not in a safe, retryable state.'
    end
    using errcode = 'P0001';
  end if;

  update public.orders set
    lazywait_sync_state  = 'pending',
    sync_next_attempt_at = now(),
    sync_last_error      = null,
    sync_blocked_reason  = null,
    sync_status          = 'not_synced'::public.sync_status,
    updated_at           = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end $$;
revoke all on function public.requeue_lazywait_order(uuid) from public, anon;
grant execute on function public.requeue_lazywait_order(uuid) to authenticated;
comment on function public.requeue_lazywait_order(uuid) is
  'Admin Retry for a Lazywait POS sync. is_admin() only. Refuses a cancelled order with P0001 order_cancelled (since 20261015120000), and every order lazywait_requeue_eligibility does not answer requeued (20260721120000, 20260827120000); otherwise re-queues it as pending.';

-- ---------------------------------------------------------------------------
-- 3. Self-verification: outcomes first, then the stored text, grants and the
--    money path. Every outcome is read back as a value, never a notice.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_tag     constant text := 'VERIFY-20261015120000-';
  v_branch  uuid := gen_random_uuid();
  v_c1      uuid := gen_random_uuid();   -- cancelled, inside the deadline
  v_c2      uuid := gen_random_uuid();   -- cancelled, past the deadline
  v_c3      uuid := gen_random_uuid();   -- cancelled, another attempt owns the send phase
  v_c4      uuid := gen_random_uuid();   -- cancelled, POS ref present
  v_l1      uuid := gen_random_uuid();   -- received, past the deadline
  v_ids     uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
                            gen_random_uuid(), gen_random_uuid()];
  v_stat    text[] := array['received', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
  v_n       integer;
  v_ans     text;
  v_code    text;
  v_msg     text;
  v_hash    text;
  v_src     text;
  v_at      integer;
  o         public.orders;
  r         record;
  i         integer;
begin
  -- ---- Behaviour, in a sub-transaction that the final raise aborts --------
  begin
    insert into public.branches (id, name_en, name_ar) values (v_branch, v_tag || 'branch', v_tag || 'branch');

    -- Explicit order numbers, so set_order_number draws nothing from the SM-
    -- sequence. Each is then put in the shape a live claim leaves: 'syncing',
    -- no ref, no attempt marker, the deadline ahead (or behind, for c2 and l1).
    insert into public.orders (id, order_number, branch_id, order_type, status, subtotal, total,
                               payment_method, payment_status)
    values
      (v_c1, v_tag || 'c1', v_branch, 'pickup',   'cancelled', 10, 10, 'cash', 'pending'),
      (v_c2, v_tag || 'c2', v_branch, 'pickup',   'cancelled', 10, 10, 'cash', 'pending'),
      (v_c3, v_tag || 'c3', v_branch, 'pickup',   'cancelled', 10, 10, 'cash', 'pending'),
      (v_c4, v_tag || 'c4', v_branch, 'delivery', 'cancelled', 10, 10, 'cash', 'pending'),
      (v_l1, v_tag || 'l1', v_branch, 'pickup',   'received',  10, 10, 'cash', 'pending');
    for i in 1 .. 5 loop
      insert into public.orders (id, order_number, branch_id, order_type, status, subtotal, total,
                                 payment_method, payment_status)
      values (v_ids[i], v_tag || 's' || i, v_branch, case when i = 4 then 'delivery' else 'pickup' end::public.order_type,
              v_stat[i]::public.order_status, 10, 10, 'cash', 'pending');
    end loop;
    update public.orders
       set lazywait_sync_state = 'syncing', lazywait_ref = null,
           pos_create_attempted_at = null, pos_create_attempt_token = null,
           pos_sync_deadline_at = now() + interval '5 minutes'
     where id = any (v_ids || array[v_c1, v_c2, v_c3, v_c4, v_l1]);
    update public.orders set pos_sync_deadline_at = now() - interval '1 minute' where id in (v_c2, v_l1);
    update public.orders set pos_create_attempted_at = now(), pos_create_attempt_token = 'other-attempt' where id = v_c3;
    update public.orders set lazywait_ref = 'LW-REF-1' where id = v_c4;
    if (select count(*) from public.orders
         where id = any (v_ids || array[v_c1, v_c2, v_c3, v_c4, v_l1]) and lazywait_sync_state = 'syncing') <> 10 then
      raise exception 'VERIFY: the gate probes did not start in the shape a claim leaves';
    end if;

    -- (a) A cancelled order inside its deadline: refused and parked, nothing else.
    v_ans := public.begin_lazywait_create_attempt(v_c1, 'verify-token');
    if v_ans is distinct from 'order_cancelled' then
      raise exception 'VERIFY: begin_lazywait_create_attempt answered a cancelled order with %', coalesce(v_ans, '<null>');
    end if;
    select * into o from public.orders where id = v_c1;
    if o.lazywait_sync_state is distinct from 'blocked' or o.sync_blocked_reason is distinct from 'order_cancelled'
       or o.pos_create_attempted_at is not null or o.pos_create_attempt_token is not null
       or o.sync_next_attempt_at is not null then
      raise exception 'VERIFY: the cancelled order was not parked as blocked/order_cancelled with no marker (% / % / % / %)',
        o.lazywait_sync_state, coalesce(o.sync_blocked_reason, '<null>'), o.pos_create_attempted_at, o.pos_create_attempt_token;
    end if;
    if (select count(*) from public.integration_sync_logs
         where order_id = v_c1 and status = 'skipped' and error = 'order_cancelled_before_send') <> 1 then
      raise exception 'VERIFY: the refusal did not write exactly one skipped sync-log row';
    end if;
    if exists (select 1 from public.notification_log where order_id = v_c1) then
      raise exception 'VERIFY: the refusal queued a notification';
    end if;

    -- (b) Past the deadline the cancelled order is still order_cancelled, so no
    -- pos_failed is ever queued for it; a received one is deadline_expired as before.
    v_ans := public.begin_lazywait_create_attempt(v_c2, 'verify-token');
    if v_ans is distinct from 'order_cancelled' then
      raise exception 'VERIFY: a cancelled order past its deadline answered % (expected order_cancelled)', coalesce(v_ans, '<null>');
    end if;
    v_ans := public.begin_lazywait_create_attempt(v_l1, 'verify-token');
    if v_ans is distinct from 'deadline_expired' then
      raise exception 'VERIFY: a received order past its deadline answered % (expected deadline_expired)', coalesce(v_ans, '<null>');
    end if;

    -- (c) Another attempt owns the send phase: not taken over, not touched.
    v_ans := public.begin_lazywait_create_attempt(v_c3, 'verify-token');
    select * into o from public.orders where id = v_c3;
    if v_ans is distinct from 'invalid_state' or o.lazywait_sync_state is distinct from 'syncing'
       or o.pos_create_attempt_token is distinct from 'other-attempt' then
      raise exception 'VERIFY: a cancelled order whose send phase another attempt owns was answered % and left %',
        coalesce(v_ans, '<null>'), o.lazywait_sync_state;
    end if;

    -- (d) A POS ref still answers the truth about the POS.
    v_ans := public.begin_lazywait_create_attempt(v_c4, 'verify-token');
    if v_ans is distinct from 'already_synced' then
      raise exception 'VERIFY: a cancelled order with a usable POS ref answered % (expected already_synced)', coalesce(v_ans, '<null>');
    end if;

    -- (e) Every other status is still sent, and stamped.
    for i in 1 .. 5 loop
      v_ans := public.begin_lazywait_create_attempt(v_ids[i], 'verify-token');
      select * into o from public.orders where id = v_ids[i];
      if v_ans is distinct from 'ready_to_send' or o.pos_create_attempted_at is null
         or o.pos_create_attempt_token is distinct from 'verify-token' then
        raise exception 'VERIFY: a % order was answered % (expected ready_to_send with the marker stamped)',
          v_stat[i], coalesce(v_ans, '<null>');
      end if;
    end loop;

    -- (f) requeue_lazywait_order, as far as its admin gate. Its outcomes are
    -- proven by the paired suite; see the header.
    v_code := 'none';
    begin
      perform public.requeue_lazywait_order(v_c1);
    exception when others then
      v_code := sqlstate;
    end;
    if v_code is distinct from '42501' then
      raise exception 'VERIFY: requeue_lazywait_order without an administrator answered % instead of 42501', v_code;
    end if;

    raise exception 'ROLLBACK_PROBE_20261015120000';
  exception when others then
    if sqlerrm is distinct from 'ROLLBACK_PROBE_20261015120000' then raise; end if;
  end;

  -- The probe is evidence only if the rollback is proven, not assumed.
  if exists (select 1 from public.orders where order_number like v_tag || '%')
     or exists (select 1 from public.branches where id = v_branch)
     or exists (select 1 from public.integration_sync_logs
                 where order_id = any (v_ids || array[v_c1, v_c2, v_c3, v_c4, v_l1]))
     or exists (select 1 from public.notification_log
                 where order_id = any (v_ids || array[v_c1, v_c2, v_c3, v_c4, v_l1])) then
    raise exception 'VERIFY: a probe row survived the sub-transaction';
  end if;

  -- ---- The stored text, comment-stripped so a comment cannot satisfy it ----
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'begin_lazywait_create_attempt';
  v_at := position('if v_row.status = ''cancelled'' then' in v_src);
  if v_at = 0 then
    raise exception 'VERIFY: begin_lazywait_create_attempt does not refuse a cancelled order';
  end if;
  if v_at < position('if v_row.pos_create_attempted_at is not null then' in v_src)
     or v_at < position('if v_row.lazywait_sync_state <> ''syncing'' then' in v_src)
     or v_at > position('if now() >= v_row.pos_sync_deadline_at then' in v_src)
     or v_at > position('set pos_create_attempted_at  = now()' in v_src) then
    raise exception 'VERIFY: the cancelled refusal is not between the attempt-marker check and the deadline checks';
  end if;

  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'requeue_lazywait_order';
  v_at := position('if v_order.status = ''cancelled'' then' in v_src);
  if v_at = 0 or position('order_cancelled: This order was cancelled.' in v_src) = 0 then
    raise exception 'VERIFY: requeue_lazywait_order does not refuse a cancelled order';
  end if;
  if v_at < position('if not public.is_admin() then' in v_src)
     or v_at < position('for update;' in v_src)
     or v_at > position('lazywait_requeue_eligibility(' in v_src)
     or v_at > position('update public.orders set' in v_src) then
    raise exception 'VERIFY: the cancelled refusal is not between the admin gate and the eligibility check';
  end if;

  -- ---- Grants: anon executes neither; only the admin Retry is a client RPC --
  for r in
    select * from (values
      ('public.begin_lazywait_create_attempt(uuid, text)', false, true),
      ('public.requeue_lazywait_order(uuid)',              true,  false)
    ) as t(sig, authed, service)
  loop
    if has_function_privilege('anon', r.sig, 'execute') then
      raise exception 'VERIFY: anon can execute %', r.sig;
    end if;
    if has_function_privilege('authenticated', r.sig, 'execute') is distinct from r.authed then
      raise exception 'VERIFY: authenticated EXECUTE on % is %, expected %', r.sig, not r.authed, r.authed;
    end if;
    if r.service and not has_function_privilege('service_role', r.sig, 'execute') then
      raise exception 'VERIFY: service_role lost EXECUTE on %', r.sig;
    end if;
  end loop;

  -- ---- The money path, one overload each first ----------------------------
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('place_order', 'compute_order_snapshot');
  if v_n <> 2 then raise exception 'VERIFY: expected one place_order and one compute_order_snapshot, found % functions', v_n; end if;
  select md5(pg_get_functiondef(p.oid)) into v_hash from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_hash is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'VERIFY: place_order moved to %', coalesce(v_hash, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_hash from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_hash is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'VERIFY: compute_order_snapshot moved to %', coalesce(v_hash, 'NULL');
  end if;
end
$verify$;
