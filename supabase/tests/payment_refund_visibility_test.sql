-- ============================================================================
-- Refund and payment visibility (migration 20261013120000_payment_refund_visibility).
--
-- WHAT THIS PINS, gap by gap (docs/readiness/20261113-card-payments-gaps.md):
--
--   PG-01 fairness   claim_order_refund takes the least recently touched pending
--                    refund, so a refund just released goes to the back of the
--                    queue; ids the worker passes are never claimed, so one
--                    stuck refund is tried once per run, not five times; a NULL
--                    in that list hides nothing. The call today's worker makes
--                    (one named argument) still resolves.
--   PG-01 visibility R14 REFUND_FAILED fires on a failed refund nobody replaced,
--                    and ends when a retry succeeds; the console feed lists it,
--                    and lists pending refunds already tried, with their
--                    attempts and last error.
--   PG-02            R15/R16 fire on duplicate and mismatch records, R17 on a
--                    logged confirmation failure, each silent on its nearest
--                    healthy row and ended by the change that settles it; the
--                    feed lists all three.
--   inbox            the new incidents open the critical
--                    'order_integrity:incidents' alert and turn the payment card
--                    'failing', through the real evaluator.
--   PG-25            an abandoned checkout no longer reads "payment degraded"; a
--                    settled payment whose confirmation stalled still does; and
--                    the unverified open attempts the stale count no longer
--                    covers are still reported, in open_unverified_24h.
--   the feed         admin at AAL2 only; exactly its columns; no raw payload,
--                    no customer field; limits and totals.
--
-- THE HONEST FLOW must keep working, and is driven end to end: a paid order the
-- POS provably never accepted enrols through the real triggers, is claimed with
-- the new signature, is refunded, and then appears on no list and in no alert.
--
-- Each numbered block is self-contained after the prelude, so a block can be
-- run on its own against an older chain to show what it catches.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

-- ---- Prelude ------------------------------------------------------------------
-- The harness replaces jwt_has_aal2() with true. Restore the production body for
-- this transaction so AAL1 and AAL2 differ for the feed's callers.
create or replace function public.jwt_has_aal2()
returns boolean language sql stable set search_path = public as $$
  select public.aal_claim_satisfies_staff_mfa(auth.jwt() ->> 'aal');
$$;

insert into public.branches (id, name_en, name_ar)
values ('b0000000-0000-0000-0000-00000000f0f0', 'Refund Visibility Branch', 'فرع الاسترداد')
on conflict (id) do nothing;

-- Clear every refund, payment, log and incident so each block reads only its own
-- rows. Rolled back with everything else.
create function pg_temp.prv_reset() returns void language plpgsql as $$
begin
  delete from public.order_integrity_alert_outbox;
  delete from public.order_integrity_incidents;
  delete from public.order_integrity_runs;
  delete from public.order_refunds;
  delete from public.integration_sync_logs;
  delete from public.payment_records;
end $$;

-- An order with only the columns these cases care about. Explicit number, so
-- no sequence is touched; the orders' own triggers run as in production.
create function pg_temp.prv_order(
  p_num text, p_total numeric default 50, p_refund_state text default 'none',
  p_method text default 'cash', p_pay text default 'pending', p_paid_at timestamptz default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
                             payment_method, payment_status, paid_at, refund_state)
  values (v_id, p_num, 'b0000000-0000-0000-0000-00000000f0f0', 'pickup', p_total, p_total,
          p_method, p_pay::public.payment_status, p_paid_at, p_refund_state);
  return v_id;
end $$;

-- A refund row written directly, with chosen timestamps.
create function pg_temp.prv_refund(
  p_order uuid, p_key text, p_status text default 'pending', p_attempts integer default 0,
  p_created timestamptz default now(), p_updated timestamptz default now(),
  p_failure text default null, p_error text default null, p_charge text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.order_refunds (id, order_id, provider, charge_ref, idempotency_key, amount, currency,
                                    status, attempt_count, failure_code, last_error_safe, created_at, updated_at)
  values (v_id, p_order, 'moyasar', coalesce(p_charge, 'pay_' || p_key), 'prv_' || p_key, 50, 'SAR',
          p_status, p_attempts, p_failure, p_error, p_created, p_updated);
  return v_id;
end $$;

-- Release a claimed refund as 'pending' the way a separate worker call does.
-- In production every RPC is its own transaction, so finalize's now() is the
-- moment of the release. Inside this one test transaction now() never moves,
-- so the release time is restamped from clock_timestamp() (replica mode skips
-- set_updated_at, which would put now() back).
--
-- Since 20261016120000 a release also backs the refund off (next_attempt_at).
-- These cases are about the ORDER of the queue and the per-run exclusion, not
-- about the wait, so prv_due() treats the wait as over; the wait itself is
-- pinned by refund_retry_backoff_test.sql. The column is written only where it
-- exists, so each block still runs against an older chain, and in replica mode,
-- so set_updated_at does not move the refund in the queue.
create function pg_temp.prv_due(p_refund uuid) returns void language plpgsql as $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'order_refunds'
                and column_name = 'next_attempt_at') then
    set local session_replication_role = replica;
    execute 'update public.order_refunds set next_attempt_at = null where id = $1' using p_refund;
    set local session_replication_role = origin;
  end if;
end $$;

create function pg_temp.prv_release(p_refund uuid, p_token text) returns void language plpgsql as $$
begin
  if not public.finalize_order_refund(p_refund, p_token, 'pending', null, null, null) then
    raise exception 'prv_release: finalize refused %', p_refund;
  end if;
  set local session_replication_role = replica;
  update public.order_refunds set updated_at = clock_timestamp() where id = p_refund;
  set local session_replication_role = origin;
  perform pg_temp.prv_due(p_refund);
end $$;

-- Run the watchdog n times; return the last run's status.
create function pg_temp.prv_scan(p_times integer default 1) returns text language plpgsql as $$
declare v_run bigint; i integer;
begin
  for i in 1 .. p_times loop
    v_run := public.order_integrity_watchdog();
  end loop;
  return (select status from public.order_integrity_runs where id = v_run);
end $$;

create function pg_temp.prv_open(p_fingerprint text) returns boolean language sql as $$
  select exists (select 1 from public.order_integrity_incidents
                  where fingerprint = p_fingerprint and status <> 'resolved');
$$;

create function pg_temp.prv_payment_card() returns jsonb language sql as $$
  select x from jsonb_array_elements(public.operations_health_snapshot_internal() -> 'systems') x
   where x ->> 'id' = 'payment';
$$;

-- PostgREST-style callers, the admin_lazywait_sync_monitor_test idiom.
create temporary table t_actor (k text primary key, uid uuid);
create function pg_temp.become(p_uid uuid, p_aal text) returns void language plpgsql as $$
begin
  perform set_config('test.auth_uid', '', true);
  perform set_config('test.is_staff', '', true);
  perform set_config('test.is_admin', '', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  discard plans;
  set local role authenticated;
end $$;
create function pg_temp.unbecome() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
-- The feed as a caller: its jsonb, or the SQLSTATE.
create function pg_temp.feed_as(p_uid uuid, p_aal text, p_limit integer default null) returns text
language plpgsql as $$
declare v jsonb; s text;
begin
  perform pg_temp.become(p_uid, p_aal);
  begin
    v := case when p_limit is null then public.list_payments_needing_attention()
              else public.list_payments_needing_attention(p_limit) end;
    s := v::text;
  exception when others then
    s := sqlstate;
  end;
  perform pg_temp.unbecome();
  return s;
end $$;

do $$
begin
  insert into t_actor (k, uid) values
    ('admin', gen_random_uuid()), ('accountant', gen_random_uuid()), ('customer', gen_random_uuid());
  insert into auth.users (id, email, email_confirmed_at)
    select uid, k || '-refundvis@example.test', now() from t_actor;
  update public.profiles set role = 'admin' where id = (select uid from t_actor where k = 'admin');
  update public.profiles set role = 'accountant' where id = (select uid from t_actor where k = 'accountant');
end $$;

-- ---- 1. PG-01: a refund just released goes to the back of the queue ------------
-- Called the way the deployed payment-refund calls it: ONE named argument. On
-- the old ordering (created_at) the released refund A is the oldest, so the next
-- claim of the same run took it again; that is how one stuck refund used every
-- claim of every run.
do $$
declare
  v_a uuid; v_b uuid; v_claim uuid; v_seen uuid[] := '{}';
  i integer;
begin
  perform pg_temp.prv_reset();
  v_a := pg_temp.prv_refund(pg_temp.prv_order('PRV-1A'), '1a', 'pending', 0,
                            now() - interval '20 minutes', now() - interval '20 minutes');
  v_b := pg_temp.prv_refund(pg_temp.prv_order('PRV-1B'), '1b', 'pending', 0,
                            now() - interval '10 minutes', now() - interval '10 minutes');

  select refund_id into v_claim from public.claim_order_refund(p_claim_token => 'prv-1-1');
  if v_claim is distinct from v_a then
    raise exception 'CASE 1 FAILED: the first claim took % instead of the refund waiting longest', v_claim;
  end if;
  -- The worker could not finish it: released as pending, as for a proxy error.
  perform pg_temp.prv_release(v_a, 'prv-1-1');

  select refund_id into v_claim from public.claim_order_refund(p_claim_token => 'prv-1-2');
  if v_claim is distinct from v_b then
    raise exception 'CASE 1 FAILED: the refund just released was claimed again (got %), so B waits behind it', v_claim;
  end if;
  perform pg_temp.prv_release(v_b, 'prv-1-2');

  -- A run of six claims by an OLD worker (no exclusions), both refunds stuck,
  -- each release stamped when it happens: they alternate, so neither starves.
  for i in 3 .. 8 loop
    select refund_id into v_claim from public.claim_order_refund(p_claim_token => 'prv-1-' || i);
    v_seen := v_seen || v_claim;
    perform pg_temp.prv_release(v_claim, 'prv-1-' || i);
  end loop;
  if v_seen is distinct from array[v_a, v_b, v_a, v_b, v_a, v_b] then
    raise exception 'CASE 1 FAILED: the two stuck refunds were not served in turn: %', v_seen;
  end if;
  raise notice 'CASE 1 ok: a released refund goes behind one that waited';
end $$;

-- ---- 2. PG-01: once per run ------------------------------------------------------
-- The new worker passes the ids it has claimed this run. One stuck refund alone
-- in the queue is then claimed ONCE per run instead of five times.
do $$
declare
  v_s uuid; v_claim uuid; v_seen uuid[] := '{}'; v_hits integer := 0; i integer;
  v_status text; v_attempts integer; v_token text;
begin
  perform pg_temp.prv_reset();
  v_s := pg_temp.prv_refund(pg_temp.prv_order('PRV-2S'), '2s', 'pending', 4,
                            now() - interval '1 hour', now() - interval '5 minutes', 'moyasar_ip_not_allowed', 'probe');

  for i in 1 .. 5 loop
    select refund_id into v_claim from public.claim_order_refund('prv-2-' || i, v_seen);
    exit when v_claim is null;
    v_hits := v_hits + 1;
    v_seen := v_seen || v_claim;
    perform public.finalize_order_refund(v_claim, 'prv-2-' || i, 'pending', null, 'moyasar_ip_not_allowed', 'probe');
    -- Due again at once, so it is the exclusion list that keeps it out.
    perform pg_temp.prv_due(v_claim);
  end loop;
  if v_hits <> 1 then
    raise exception 'CASE 2 FAILED: one stuck refund was claimed % times in one run, expected 1', v_hits;
  end if;

  -- An excluded refund is left exactly as it was: not leased, not counted.
  select status, attempt_count, claim_token into v_status, v_attempts, v_token
    from public.order_refunds where id = v_s;
  if v_status <> 'pending' or v_attempts <> 5 or v_token is not null then
    raise exception 'CASE 2 FAILED: excluded refund changed (status % attempts % token %)', v_status, v_attempts, v_token;
  end if;

  -- A NULL element must not hide the queue: `id <> all (array[null])` is NULL.
  select refund_id into v_claim from public.claim_order_refund('prv-2-null', array[null::uuid]);
  if v_claim is distinct from v_s then
    raise exception 'CASE 2 FAILED: a NULL in the exclusion list hid the queue (got %)', v_claim;
  end if;
  perform public.finalize_order_refund(v_s, 'prv-2-null', 'pending', null, null, null);
  perform pg_temp.prv_due(v_s);
  -- And an explicit NULL list is an empty one.
  select refund_id into v_claim from public.claim_order_refund('prv-2-nulllist', null);
  if v_claim is distinct from v_s then
    raise exception 'CASE 2 FAILED: a NULL exclusion list hid the queue (got %)', v_claim;
  end if;
  raise notice 'CASE 2 ok: once per run, and a NULL hides nothing';
end $$;

-- ---- 3. The honest flow: enrol, claim, refund, and nothing left to show ----------
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_o uuid := gen_random_uuid();
  v_claim record;
  v_feed jsonb;
begin
  perform pg_temp.prv_reset();
  insert into auth.users (id) values (v_owner);
  set local session_replication_role = replica;
  insert into public.orders (id, customer_id, order_number, branch_id, order_type, subtotal, total,
                             payment_method, payment_status, payment_provider, paid_at,
                             lazywait_sync_state, pos_customer_retry_count)
  values (v_o, v_owner, 'PRV-3', 'b0000000-0000-0000-0000-00000000f0f0', 'pickup', 64, 64,
          'online', 'paid', 'moyasar', now() - interval '1 hour', 'failed', 3);
  insert into public.payment_records (order_id, provider, provider_ref, status, amount, currency, mode)
  values (v_o, 'moyasar', 'pay_prv_3', 'paid', 64, 'SAR', 'live');
  set local session_replication_role = origin;
  -- A normal update, so the enrollment triggers run as in production.
  update public.orders set lazywait_sync_state = 'dead_letter' where id = v_o;
  if (select refund_state from public.orders where id = v_o) <> 'pending' then
    raise exception 'CASE 3 FAILED: the paid order that never reached the POS did not enrol';
  end if;

  select * into v_claim from public.claim_order_refund('prv-3', '{}');
  if v_claim.order_id is distinct from v_o or v_claim.charge_ref is distinct from 'pay_prv_3'
     or v_claim.attempt_count <> 1 or v_claim.provider <> 'moyasar' then
    raise exception 'CASE 3 FAILED: the claim returned %', row_to_json(v_claim);
  end if;
  if not public.finalize_order_refund(v_claim.refund_id, 'prv-3', 'succeeded', 'rf_prv_3', null, null) then
    raise exception 'CASE 3 FAILED: the refund could not be confirmed';
  end if;
  if (select refund_state from public.orders where id = v_o) <> 'refunded' then
    raise exception 'CASE 3 FAILED: the order was not marked refunded';
  end if;

  if pg_temp.prv_scan(1) <> 'success' then raise exception 'CASE 3 FAILED: watchdog run failed'; end if;
  if exists (select 1 from public.order_integrity_incidents
              where order_id = v_o
                and rule_code in ('REFUND_FAILED', 'DUPLICATE_PAYMENT_RECORDED',
                                  'PAYMENT_VERIFICATION_MISMATCH', 'PAYMENT_CONFIRMATION_FAILED')) then
    raise exception 'CASE 3 FAILED: a refunded order raised a refund or payment incident';
  end if;
  v_feed := public.payments_needing_attention_internal(50);
  if (v_feed -> 'failed_refunds' ->> 'total')::integer <> 0 or (v_feed -> 'retrying_refunds' ->> 'total')::integer <> 0
     or (v_feed -> 'payments_to_refund' ->> 'total')::integer <> 0 or (v_feed -> 'unconfirmed_payments' ->> 'total')::integer <> 0 then
    raise exception 'CASE 3 FAILED: a settled refund is still listed: %', v_feed;
  end if;
  raise notice 'CASE 3 ok: the honest flow refunds and leaves nothing to show';
end $$;

-- ---- 4. PG-01: R14 REFUND_FAILED, and the feed's two refund lists -----------------
do $$
declare
  v_of uuid; v_os uuid; v_or uuid; v_ot uuid; v_od uuid; v_ou uuid;
  v_rf uuid; v_rt uuid; v_rd1 uuid; v_rd2 uuid; v_ru uuid; v_feed jsonb; v_inc record;
begin
  perform pg_temp.prv_reset();
  v_of := pg_temp.prv_order('PRV-4F', 30, 'failed');
  v_rf := pg_temp.prv_refund(v_of, '4f', 'failed', 3, now() - interval '3 hours', now() - interval '2 hours',
                             'http_400', 'Moyasar refused the refund', 'pay_prv_4f');
  -- Nearest healthy rows: a failed attempt that a later one SUCCEEDED, and a
  -- failed attempt on an order recorded refunded (what PG-14 would write).
  v_os := pg_temp.prv_order('PRV-4S', 20, 'refunded');
  perform pg_temp.prv_refund(v_os, '4s1', 'failed', 1, now() - interval '3 hours', now() - interval '3 hours', 'http_400');
  perform pg_temp.prv_refund(v_os, '4s2', 'succeeded', 1);
  v_or := pg_temp.prv_order('PRV-4R', 10, 'refunded');
  perform pg_temp.prv_refund(v_or, '4r', 'failed', 1, now() - interval '3 hours', now() - interval '3 hours', 'http_400');
  -- A pending refund already tried twice: listed, never alerted.
  v_ot := pg_temp.prv_order('PRV-4T', 40);
  v_rt := pg_temp.prv_refund(v_ot, '4t', 'pending', 2, now() - interval '50 minutes', now() - interval '4 minutes',
                             'provider_no_answer', 'No answer from Moyasar.', 'pay_prv_4t');
  -- The worst case: a refund that failed, was re-enrolled and failed again. Two
  -- failed rows and nothing active, so the other failed row must not count as a
  -- replacement: one incident, and the newest row on the card.
  v_od := pg_temp.prv_order('PRV-4D', 35, 'failed');
  v_rd1 := pg_temp.prv_refund(v_od, '4d1', 'failed', 3, now() - interval '5 hours', now() - interval '4 hours',
                              'http_400', null, 'pay_prv_4d');
  v_rd2 := pg_temp.prv_refund(v_od, '4d2', 'failed', 3, now() - interval '2 hours', now() - interval '90 minutes',
                              'http_400', null, 'pay_prv_4d');
  -- Enrolled and never tried: not "still being retried", so not listed.
  v_ou := pg_temp.prv_order('PRV-4U', 15);
  v_ru := pg_temp.prv_refund(v_ou, '4u', 'pending', 0);

  if pg_temp.prv_scan(1) <> 'success' then raise exception 'CASE 4 FAILED: watchdog run failed'; end if;
  select * into v_inc from public.order_integrity_incidents where fingerprint = 'REFUND_FAILED:' || v_of;
  if v_inc.id is null or v_inc.severity <> 'critical' or v_inc.entity_type <> 'order' or v_inc.order_id <> v_of then
    raise exception 'CASE 4 FAILED: the failed refund raised no critical order incident';
  end if;
  if (v_inc.safe_details ->> 'failure_code') <> 'http_400' or (v_inc.safe_details ->> 'attempt_count')::int <> 3
     or (v_inc.safe_details ->> 'has_last_error')::boolean is not true
     or v_inc.safe_details::text like '%refused the refund%' or v_inc.safe_details::text like '%pay_prv%' then
    raise exception 'CASE 4 FAILED: safe_details are wrong or carry text: %', v_inc.safe_details;
  end if;
  if pg_temp.prv_open('REFUND_FAILED:' || v_os) or pg_temp.prv_open('REFUND_FAILED:' || v_or)
     or pg_temp.prv_open('REFUND_FAILED:' || v_ot) then
    raise exception 'CASE 4 FAILED: R14 fired on a replaced, refunded or still-retrying refund';
  end if;
  if exists (select 1 from public.order_integrity_incidents where order_id = v_ot) then
    raise exception 'CASE 4 FAILED: a retrying refund raised an incident (the "stuck after" age is the owner''s)';
  end if;
  if not pg_temp.prv_open('REFUND_FAILED:' || v_od)
     or (select count(*) from public.order_integrity_incidents
          where order_id = v_od and rule_code = 'REFUND_FAILED') <> 1 then
    raise exception 'CASE 4 FAILED: a refund that failed twice did not raise exactly one open incident';
  end if;

  v_feed := public.payments_needing_attention_internal(50);
  if (v_feed -> 'failed_refunds' ->> 'total')::integer <> 2
     or not exists (select 1 from jsonb_array_elements(v_feed -> 'failed_refunds' -> 'items') e
                     where (e ->> 'id')::uuid = v_rf and e ->> 'payment_ref' = 'pay_prv_4f'
                       and e ->> 'order_number' = 'PRV-4F')
     or not exists (select 1 from jsonb_array_elements(v_feed -> 'failed_refunds' -> 'items') e
                     where (e ->> 'id')::uuid = v_rd2 and e ->> 'order_number' = 'PRV-4D')
     or exists (select 1 from jsonb_array_elements(v_feed -> 'failed_refunds' -> 'items') e
                 where (e ->> 'id')::uuid = v_rd1) then
    raise exception 'CASE 4 FAILED: failed_refunds is %', v_feed -> 'failed_refunds';
  end if;
  if exists (select 1 from jsonb_array_elements(v_feed -> 'retrying_refunds' -> 'items') e
              where (e ->> 'id')::uuid = v_ru) then
    raise exception 'CASE 4 FAILED: a refund never tried is listed as still being retried';
  end if;
  if (v_feed -> 'retrying_refunds' ->> 'total')::integer <> 1
     or (v_feed -> 'retrying_refunds' -> 'items' -> 0 ->> 'id')::uuid <> v_rt
     or (v_feed -> 'retrying_refunds' -> 'items' -> 0 ->> 'attempt_count')::integer <> 2
     or (v_feed -> 'retrying_refunds' -> 'items' -> 0 ->> 'failure_code') <> 'provider_no_answer'
     or (v_feed -> 'retrying_refunds' -> 'items' -> 0 ->> 'last_error_safe') <> 'No answer from Moyasar.' then
    raise exception 'CASE 4 FAILED: retrying_refunds is %', v_feed -> 'retrying_refunds';
  end if;

  -- A deliberate retry that succeeds ends it: two clean scans resolve it.
  perform pg_temp.prv_refund(v_of, '4f_retry', 'succeeded', 1);
  if pg_temp.prv_scan(2) <> 'success' then raise exception 'CASE 4 FAILED: watchdog run failed'; end if;
  if pg_temp.prv_open('REFUND_FAILED:' || v_of) then
    raise exception 'CASE 4 FAILED: a refund that a retry settled is still an open incident';
  end if;
  v_feed := public.payments_needing_attention_internal(50);
  if (v_feed -> 'failed_refunds' ->> 'total')::integer <> 1
     or exists (select 1 from jsonb_array_elements(v_feed -> 'failed_refunds' -> 'items') e
                 where (e ->> 'id')::uuid = v_rf) then
    raise exception 'CASE 4 FAILED: a refund that a retry settled is still on the card';
  end if;
  if not pg_temp.prv_open('REFUND_FAILED:' || v_od) then
    raise exception 'CASE 4 FAILED: settling one order''s refund closed another order''s incident';
  end if;
  raise notice 'CASE 4 ok: R14 fires on a failed refund, ends on a successful retry, and the feed lists both refund kinds';
end $$;

-- ---- 5. PG-02: R15 duplicate, R16 mismatch, R17 confirmation failure ------------
do $$
declare
  v_o uuid; v_op uuid; v_dup uuid; v_dupr uuid; v_mm uuid; v_exp uuid;
  v_feed jsonb; v_inc record; v_fp text;
begin
  perform pg_temp.prv_reset();
  v_o := pg_temp.prv_order('PRV-5', 50, 'none', 'online', 'paid', now());
  v_op := pg_temp.prv_order('PRV-5P', 25, 'none', 'online', 'paid', now());
  insert into public.payment_records (order_id, provider, provider_ref, status, amount, currency, mode)
  values (v_o, 'moyasar', 'pay_prv_5_paid', 'paid', 50, 'SAR', 'live'),
         (v_op, 'moyasar', 'pay_prv_5_conf', 'paid', 25, 'SAR', 'live');
  insert into public.payment_records (order_id, provider, provider_ref, status, amount, currency, mode,
                                      failure_code, failure_message_safe, raw)
  values (v_o, 'moyasar', 'pay_prv_5_dup', 'failed', 50, 'SAR', 'live', 'duplicate_payment',
          'Duplicate payment: the order was already paid. Refund this payment.', null),
         (v_o, 'moyasar', 'pay_prv_5_dupr', 'refunded', 50, 'SAR', 'live', 'duplicate_payment', 'refunded by hand', null),
         (v_o, 'moyasar', null, 'failed', 50, 'SAR', 'live', 'verification_mismatch', 'Payment could not be verified.',
          jsonb_build_object('id', 'pay_prv_5_mm', 'status', 'paid',
                             'source', jsonb_build_object('last_four', '9876', 'message', 'PRVRAWMARKER'))),
         (v_o, 'moyasar', null, 'failed', 50, 'SAR', 'live', 'expired', 'Payment session expired', null);
  select id into v_dup from public.payment_records where provider_ref = 'pay_prv_5_dup';
  select id into v_dupr from public.payment_records where provider_ref = 'pay_prv_5_dupr';
  select id into v_mm from public.payment_records where failure_code = 'verification_mismatch';
  select id into v_exp from public.payment_records where failure_code = 'expired';
  insert into public.integration_sync_logs (provider, order_id, direction, status, request, error, created_at)
  values ('moyasar', null, 'webhook', 'failed', jsonb_build_object('payment_id', 'pay_prv_5_unconf', 'session', 'sess'), 'finalize_failed', now() - interval '20 minutes'),
         ('moyasar', null, 'webhook', 'failed', jsonb_build_object('payment_id', 'pay_prv_5_unconf'), 'finalize_failed', now() - interval '10 minutes'),
         ('moyasar', v_o, 'webhook', 'failed', jsonb_build_object('payment_id', 'pay_prv_5_order'), 'confirm_failed', now() - interval '5 minutes'),
         -- healthy: a logged failure whose payment later confirmed, one that became
         -- a duplicate record, and a Lazywait row that merely shares the word.
         ('moyasar', null, 'webhook', 'failed', jsonb_build_object('payment_id', 'pay_prv_5_conf'), 'finalize_failed', now() - interval '30 minutes'),
         ('moyasar', v_o, 'webhook', 'failed', jsonb_build_object('payment_id', 'pay_prv_5_dup'), 'confirm_failed', now() - interval '30 minutes'),
         ('lazywait', v_o, 'push', 'failed', jsonb_build_object('payment_id', 'pay_prv_5_lw'), 'finalize_failed', now() - interval '30 minutes');

  if pg_temp.prv_scan(1) <> 'success' then raise exception 'CASE 5 FAILED: watchdog run failed'; end if;

  select * into v_inc from public.order_integrity_incidents where fingerprint = 'DUPLICATE_PAYMENT_RECORDED:' || v_dup;
  if v_inc.id is null or v_inc.severity <> 'critical' or v_inc.entity_type <> 'payment'
     or v_inc.payment_record_id <> v_dup or v_inc.order_id <> v_o then
    raise exception 'CASE 5 FAILED: R15 did not raise a critical payment incident for the duplicate';
  end if;
  if not pg_temp.prv_open('PAYMENT_VERIFICATION_MISMATCH:' || v_mm) then
    raise exception 'CASE 5 FAILED: R16 did not fire on the mismatch';
  end if;
  v_fp := 'PAYMENT_CONFIRMATION_FAILED:' || md5('moyasar:pay_prv_5_unconf');
  select * into v_inc from public.order_integrity_incidents where fingerprint = v_fp;
  if v_inc.id is null or (v_inc.safe_details ->> 'log_count')::integer <> 2
     or v_inc.safe_details ->> 'error' <> 'finalize_failed' or v_inc.order_id is not null then
    raise exception 'CASE 5 FAILED: R17 did not raise one incident for the payment logged twice: %', row_to_json(v_inc);
  end if;
  if not pg_temp.prv_open('PAYMENT_CONFIRMATION_FAILED:' || md5('moyasar:pay_prv_5_order')) then
    raise exception 'CASE 5 FAILED: R17 did not fire on the order-path confirm_failed';
  end if;
  if (select order_id from public.order_integrity_incidents
       where fingerprint = 'PAYMENT_CONFIRMATION_FAILED:' || md5('moyasar:pay_prv_5_order')) is distinct from v_o then
    raise exception 'CASE 5 FAILED: the order-path incident lost its order';
  end if;
  -- Silent on every healthy neighbour.
  if pg_temp.prv_open('DUPLICATE_PAYMENT_RECORDED:' || v_dupr) or pg_temp.prv_open('DUPLICATE_PAYMENT_RECORDED:' || v_exp)
     or pg_temp.prv_open('PAYMENT_VERIFICATION_MISMATCH:' || v_exp)
     or pg_temp.prv_open('PAYMENT_CONFIRMATION_FAILED:' || md5('moyasar:pay_prv_5_conf'))
     or pg_temp.prv_open('PAYMENT_CONFIRMATION_FAILED:' || md5('moyasar:pay_prv_5_dup'))
     or pg_temp.prv_open('PAYMENT_CONFIRMATION_FAILED:' || md5('moyasar:pay_prv_5_lw'))
     or exists (select 1 from public.order_integrity_incidents where rule_code in ('MULTIPLE_SUCCESSFUL_CAPTURES', 'CAPTURED_PAYMENT_WITHOUT_ORDER')) then
    raise exception 'CASE 5 FAILED: a rule fired on a healthy row';
  end if;
  -- No payment id in the watchdog's tables.
  if exists (select 1 from public.order_integrity_incidents
              where fingerprint like '%pay_prv%' or safe_details::text like '%pay_prv%') then
    raise exception 'CASE 5 FAILED: a raw payment id reached order_integrity_incidents';
  end if;
  -- The payment card counts every one of them. It names its rule codes, so a
  -- code missing from its list would leave that incident uncounted.
  if (select count(*) from public.order_integrity_incidents
       where status <> 'resolved' and severity = 'critical'
         and rule_code in ('DUPLICATE_PAYMENT_RECORDED', 'PAYMENT_VERIFICATION_MISMATCH',
                           'PAYMENT_CONFIRMATION_FAILED')) <> 4
     or (pg_temp.prv_payment_card() -> 'details' ->> 'integrity_critical_count')::integer is distinct from
        (select count(*)::integer from public.order_integrity_incidents
          where status <> 'resolved' and severity = 'critical'
            and rule_code in ('PAID_ORDER_AWAITING_PAYMENT', 'CAPTURED_PAYMENT_WITHOUT_ORDER',
                              'PAYMENT_AMOUNT_MISMATCH', 'DUPLICATE_PROVIDER_REFERENCE',
                              'MULTIPLE_SUCCESSFUL_CAPTURES', 'REFUND_FAILED', 'DUPLICATE_PAYMENT_RECORDED',
                              'PAYMENT_VERIFICATION_MISMATCH', 'PAYMENT_CONFIRMATION_FAILED')) then
    raise exception 'CASE 5 FAILED: the payment card does not count every R15-R17 incident: %',
      pg_temp.prv_payment_card() -> 'details';
  end if;

  v_feed := public.payments_needing_attention_internal(50);
  if (v_feed -> 'payments_to_refund' ->> 'total')::integer <> 2
     or not exists (select 1 from jsonb_array_elements(v_feed -> 'payments_to_refund' -> 'items') e
                     where (e ->> 'id')::uuid = v_dup and e ->> 'kind' = 'duplicate_payment' and e ->> 'payment_ref' = 'pay_prv_5_dup')
     or not exists (select 1 from jsonb_array_elements(v_feed -> 'payments_to_refund' -> 'items') e
                     where (e ->> 'id')::uuid = v_mm and e ->> 'kind' = 'verification_mismatch' and e ->> 'payment_ref' = 'pay_prv_5_mm') then
    raise exception 'CASE 5 FAILED: payments_to_refund is %', v_feed -> 'payments_to_refund';
  end if;
  if (v_feed -> 'unconfirmed_payments' ->> 'total')::integer <> 2
     or (v_feed -> 'unconfirmed_payments' -> 'items' -> 0 ->> 'payment_ref') <> 'pay_prv_5_unconf'
     or (v_feed -> 'unconfirmed_payments' -> 'items' -> 0 ->> 'log_count')::integer <> 2
     or (v_feed -> 'unconfirmed_payments' -> 'items' -> 1 ->> 'order_number') <> 'PRV-5' then
    raise exception 'CASE 5 FAILED: unconfirmed_payments is %', v_feed -> 'unconfirmed_payments';
  end if;
  if v_feed::text like '%PRVRAWMARKER%' or v_feed::text like '%"raw"%' or v_feed::text like '%"source"%' then
    raise exception 'CASE 5 FAILED: a raw payload field reached the feed';
  end if;

  -- What ends each one: a duplicate refunded, a mismatch refunded, and the
  -- unconfirmed payment confirmed by a later verify. Two clean scans resolve.
  update public.payment_records set status = 'refunded' where id in (v_dup, v_mm);
  insert into public.payment_records (order_id, provider, provider_ref, status, amount, currency, mode)
  values (v_op, 'moyasar', 'pay_prv_5_unconf', 'refunded', 25, 'SAR', 'live');
  insert into public.payment_records (order_id, provider, provider_ref, status, amount, currency, mode)
  values (v_o, 'moyasar', 'pay_prv_5_order', 'refunded', 50, 'SAR', 'live');
  if pg_temp.prv_scan(2) <> 'success' then raise exception 'CASE 5 FAILED: watchdog run failed'; end if;
  if exists (select 1 from public.order_integrity_incidents
              where status <> 'resolved'
                and rule_code in ('DUPLICATE_PAYMENT_RECORDED', 'PAYMENT_VERIFICATION_MISMATCH', 'PAYMENT_CONFIRMATION_FAILED')) then
    raise exception 'CASE 5 FAILED: an incident outlived the change that settled it';
  end if;
  v_feed := public.payments_needing_attention_internal(50);
  if (v_feed -> 'payments_to_refund' ->> 'total')::integer <> 0 or (v_feed -> 'unconfirmed_payments' ->> 'total')::integer <> 0 then
    raise exception 'CASE 5 FAILED: a settled payment is still on the card: %', v_feed;
  end if;
  raise notice 'CASE 5 ok: R15-R17 fire on their events, stay silent beside them, and end when settled';
end $$;

-- ---- 6. The alert inbox, through the real evaluator ---------------------------------
-- Configured Moyasar (test keys) so the payment card can read 'failing'.
do $$
declare
  v_o uuid; v_res jsonb; v_card jsonb;
begin
  perform pg_temp.prv_reset();
  delete from public.operations_alert_outbox;
  delete from public.operations_alert_events;
  delete from public.operations_alert_state;
  update public.integration_settings
     set enabled = true, provider_name = 'moyasar',
         public_config = '{"mode":"test","currency":"SAR"}',
         secret_config = '{"moyasar_test_secret_key":"sk_test_ok","moyasar_test_webhook_secret_token":"tok_test"}'
   where provider_type = 'payment';
  v_o := pg_temp.prv_order('PRV-6', 30, 'failed');
  perform pg_temp.prv_refund(v_o, '6', 'failed', 1, now() - interval '1 hour', now() - interval '1 hour', 'lease_expired');
  if pg_temp.prv_scan(1) <> 'success' then raise exception 'CASE 6 FAILED: watchdog run failed'; end if;

  v_card := pg_temp.prv_payment_card();
  if v_card ->> 'state' <> 'failing' or (v_card -> 'details' ->> 'integrity_critical_count')::integer <> 1 then
    raise exception 'CASE 6 FAILED: the payment card did not count the failed refund: %', v_card;
  end if;

  update public.operations_alert_settings
     set alert_evaluation_enabled = true, baseline_completed_at = now() where id;
  v_res := public.operations_alerts_evaluate();
  if v_res ->> 'status' <> 'ok' then
    raise exception 'CASE 6 FAILED: the evaluator did not run: %', v_res;
  end if;
  if not exists (select 1 from public.operations_alert_state
                  where fingerprint = 'order_integrity:incidents' and status = 'open' and severity = 'critical') then
    raise exception 'CASE 6 FAILED: the failed refund did not open the critical order_integrity:incidents alert';
  end if;
  if not exists (select 1 from public.operations_alert_state
                  where fingerprint = 'payment:health' and status = 'open' and severity = 'critical'
                    and condition_code = 'integrity_incidents') then
    raise exception 'CASE 6 FAILED: the failed refund did not open the critical payment:health alert';
  end if;
  if not exists (select 1 from public.operations_alert_events e
                   join public.operations_alert_state s on s.id = e.alert_id
                  where s.fingerprint = 'order_integrity:incidents' and e.event_type = 'opened') then
    raise exception 'CASE 6 FAILED: no opened event reached the inbox history';
  end if;
  raise notice 'CASE 6 ok: the new incidents reach the alert inbox';
end $$;

-- ---- 7. PG-25: an abandoned checkout is not "payment degraded" -----------------------
do $$
declare
  v_a uuid; v_b uuid; v_card jsonb;
begin
  perform pg_temp.prv_reset();
  update public.integration_settings
     set enabled = true, provider_name = 'moyasar',
         public_config = '{"mode":"test","currency":"SAR"}',
         secret_config = '{"moyasar_test_secret_key":"sk_test_ok","moyasar_test_webhook_secret_token":"tok_test"}'
   where provider_type = 'payment';
  if pg_temp.prv_scan(1) <> 'success' then raise exception 'CASE 7 FAILED: watchdog run failed'; end if;
  v_a := pg_temp.prv_order('PRV-7A', 50, 'none', 'online');
  -- The customer opened the card page 40 minutes ago and closed it.
  insert into public.payment_records (order_id, provider, provider_ref, provider_checkout_ref, status, amount,
                                      currency, mode, created_at, initiated_at, expires_at)
  values (v_a, 'moyasar', null, 'inv_prv_7a', 'initiated', 50, 'SAR', 'live',
          now() - interval '40 minutes', now() - interval '40 minutes', now() - interval '10 minutes');
  v_card := pg_temp.prv_payment_card();
  if v_card ->> 'state' <> 'not_monitored' or (v_card -> 'details' ->> 'stale_initiated_24h')::integer <> 0 then
    raise exception 'CASE 7 FAILED: an abandoned checkout reads %, stale %, expected not_monitored and 0',
      v_card ->> 'state', v_card -> 'details' ->> 'stale_initiated_24h';
  end if;
  if exists (select 1 from jsonb_array_elements(public.operations_health_snapshot_internal() -> 'attention') x
              where x ->> 'code' = 'STALE_PAYMENT_INITIATIONS') then
    raise exception 'CASE 7 FAILED: an abandoned checkout raised STALE_PAYMENT_INITIATIONS';
  end if;
  -- What the stale count gives up stays readable. An unverified open attempt
  -- is usually an abandoned checkout, but a payment Moyasar captured whose
  -- webhook never arrived and whose customer never came back looks the same,
  -- so it is reported, without moving the state.
  if (v_card -> 'details' ->> 'open_unverified_24h') is distinct from '1' then
    raise exception 'CASE 7 FAILED: the unverified open attempt is not reported: open_unverified_24h %',
      coalesce(v_card -> 'details' ->> 'open_unverified_24h', 'NULL');
  end if;

  -- Moyasar took the money on another attempt and the confirmation never
  -- finished (the payment id was stamped, the attempt is still open). Its
  -- invoice has expired too, like every attempt open past 30 minutes, so a
  -- count that ignored expired attempts would miss it.
  v_b := pg_temp.prv_order('PRV-7B', 40, 'none', 'online');
  insert into public.payment_records (order_id, provider, provider_ref, provider_checkout_ref, status, amount,
                                      currency, mode, created_at, initiated_at, expires_at)
  values (v_b, 'moyasar', 'pay_prv_7b', 'inv_prv_7b', 'initiated', 40, 'SAR', 'live',
          now() - interval '40 minutes', now() - interval '40 minutes', now() - interval '10 minutes');
  v_card := pg_temp.prv_payment_card();
  if v_card ->> 'state' <> 'degraded' or (v_card -> 'details' ->> 'stale_initiated_24h')::integer <> 1 then
    raise exception 'CASE 7 FAILED: a settled payment whose confirmation stalled reads %, stale %, expected degraded and 1',
      v_card ->> 'state', v_card -> 'details' ->> 'stale_initiated_24h';
  end if;
  -- The settled attempt is in the stale count only, never in both.
  if (v_card -> 'details' ->> 'open_unverified_24h') is distinct from '1' then
    raise exception 'CASE 7 FAILED: the settled attempt was also counted as unverified: %',
      v_card -> 'details' ->> 'open_unverified_24h';
  end if;
  -- Within the 30 minutes it is still in flight, and not counted.
  update public.payment_records set created_at = now() - interval '10 minutes', initiated_at = now() - interval '10 minutes'
   where provider_ref = 'pay_prv_7b';
  if (pg_temp.prv_payment_card() -> 'details' ->> 'stale_initiated_24h')::integer <> 0 then
    raise exception 'CASE 7 FAILED: an attempt inside its 30 minutes was counted';
  end if;
  -- The same window applies to the unverified count: older than 24 hours, or
  -- younger than 30 minutes, it is not reported.
  update public.payment_records set created_at = now() - interval '25 hours', initiated_at = now() - interval '25 hours'
   where provider_checkout_ref = 'inv_prv_7a';
  if (pg_temp.prv_payment_card() -> 'details' ->> 'open_unverified_24h') is distinct from '0' then
    raise exception 'CASE 7 FAILED: an unverified attempt outside the 24-hour window was reported';
  end if;
  update public.payment_records set created_at = now() - interval '10 minutes', initiated_at = now() - interval '10 minutes'
   where provider_checkout_ref = 'inv_prv_7a';
  if (pg_temp.prv_payment_card() -> 'details' ->> 'open_unverified_24h') is distinct from '0' then
    raise exception 'CASE 7 FAILED: an unverified attempt inside its 30 minutes was reported';
  end if;
  raise notice 'CASE 7 ok: an abandoned checkout is not degraded but stays readable; a stalled settled payment is degraded';
end $$;

-- ---- 8. The feed: who may read it, its limits, its columns --------------------------
do $$
declare
  v text; v_feed jsonb; v_keys text; i integer; v_o uuid;
begin
  perform pg_temp.prv_reset();
  for i in 1 .. 3 loop
    v_o := pg_temp.prv_order('PRV-8-' || i, 10 + i, 'failed');
    perform pg_temp.prv_refund(v_o, '8_' || i, 'failed', 1, now() - make_interval(hours => 10 - i),
                               now() - make_interval(hours => 10 - i), 'http_404');
  end loop;

  v := pg_temp.feed_as((select uid from t_actor where k = 'admin'), 'aal2');
  if v !~ '^\{' then raise exception 'CASE 8 FAILED: an admin at AAL2 got %', v; end if;
  v_feed := v::jsonb;
  if (v_feed -> 'failed_refunds' ->> 'total')::integer <> 3
     or jsonb_array_length(v_feed -> 'failed_refunds' -> 'items') <> 3
     or (v_feed -> 'failed_refunds' -> 'items' -> 0 ->> 'order_number') <> 'PRV-8-1' then
    raise exception 'CASE 8 FAILED: oldest-first or totals wrong: %', v_feed -> 'failed_refunds';
  end if;
  -- The limit caps the items, never the total; it is clamped to 1..100.
  v_feed := pg_temp.feed_as((select uid from t_actor where k = 'admin'), 'aal2', 2)::jsonb;
  if (v_feed -> 'failed_refunds' ->> 'total')::integer <> 3 or jsonb_array_length(v_feed -> 'failed_refunds' -> 'items') <> 2 then
    raise exception 'CASE 8 FAILED: p_limit 2 gave %', v_feed -> 'failed_refunds';
  end if;
  v_feed := pg_temp.feed_as((select uid from t_actor where k = 'admin'), 'aal2', 0)::jsonb;
  if jsonb_array_length(v_feed -> 'failed_refunds' -> 'items') <> 1 then
    raise exception 'CASE 8 FAILED: p_limit 0 was not clamped to 1';
  end if;
  select string_agg(k, ',' order by k) into v_keys from jsonb_object_keys(v_feed) k;
  if v_keys <> 'failed_refunds,payments_to_refund,retrying_refunds,unconfirmed_payments' then
    raise exception 'CASE 8 FAILED: top-level keys are %', v_keys;
  end if;
  select string_agg(distinct k, ',' order by k) into v_keys
    from jsonb_array_elements(v_feed -> 'failed_refunds' -> 'items') e, jsonb_object_keys(e) k;
  if v_keys <> 'amount,attempt_count,created_at,currency,failure_code,id,last_error_safe,order_id,order_number,payment_ref,updated_at' then
    raise exception 'CASE 8 FAILED: refund columns are %', v_keys;
  end if;

  -- Refused: an admin at AAL1, an accountant, a customer, and anon.
  v := pg_temp.feed_as((select uid from t_actor where k = 'admin'), 'aal1');
  if v is distinct from '42501' then raise exception 'CASE 8 FAILED: an admin at AAL1 got %', left(v, 80); end if;
  v := pg_temp.feed_as((select uid from t_actor where k = 'accountant'), 'aal2');
  if v is distinct from '42501' then raise exception 'CASE 8 FAILED: an accountant got %', left(v, 80); end if;
  v := pg_temp.feed_as((select uid from t_actor where k = 'customer'), 'aal1');
  if v is distinct from '42501' then raise exception 'CASE 8 FAILED: a customer got %', left(v, 80); end if;
  begin
    set local role anon;
    perform public.list_payments_needing_attention(5);
    reset role;
    raise exception 'CASE 8 FAILED: anon could call the feed';
  exception when insufficient_privilege then
    reset role;
  end;
  -- The ungated core is closed to both client roles.
  if has_function_privilege('authenticated', 'public.payments_needing_attention_internal(integer)', 'execute')
     or has_function_privilege('anon', 'public.payments_needing_attention_internal(integer)', 'execute') then
    raise exception 'CASE 8 FAILED: a client role can call the ungated core';
  end if;
  raise notice 'CASE 8 ok: admin at AAL2 only, oldest first, limits clamp the items and never the totals';
end $$;

-- ---- 9. Grants and the money path ---------------------------------------------------
do $$
declare v text;
begin
  if has_function_privilege('anon', 'public.claim_order_refund(text, uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.claim_order_refund(text, uuid[])', 'execute')
     or not has_function_privilege('service_role', 'public.claim_order_refund(text, uuid[])', 'execute') then
    raise exception 'CASE 9 FAILED: claim_order_refund grants changed';
  end if;
  if to_regprocedure('public.claim_order_refund(text)') is not null then
    raise exception 'CASE 9 FAILED: the one-argument claim_order_refund still exists beside the new one';
  end if;
  select md5(pg_get_functiondef('public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text)'::regprocedure)) into v;
  if v <> '12b6816d256c29b76edf947ae1a7ea77' then raise exception 'CASE 9 FAILED: place_order moved to %', v; end if;
  select md5(pg_get_functiondef('public.compute_order_snapshot(uuid, uuid, public.order_type, jsonb, uuid, text, integer)'::regprocedure)) into v;
  if v <> '22e2d42935459e7bf93abb2941b56325' then raise exception 'CASE 9 FAILED: compute_order_snapshot moved to %', v; end if;
  raise notice 'CASE 9 ok: grants unchanged, money path unchanged';
end $$;

rollback;
