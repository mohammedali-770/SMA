-- ============================================================================
-- Refund retry back-off, attempt cap and stuck alert
-- (migration 20261016120000_refund_retry_backoff; gap PG-01 in
-- docs/readiness/20261113-card-payments-gaps.md, the owner's numbers of
-- 2026-11-17).
--
-- WHAT THIS PINS
--   schedule   after attempts 1..9 a released refund waits 5, 10, 20, 40, 80,
--              160, 320, 360, 360 minutes: 5 minutes doubling, capped at 6 h.
--   due        a refund whose next_attempt_at is in the future is not claimed,
--              in the scan or under the lock; one due now is; a refund that is
--              not due does not hold back one that is.
--   cap        the tenth release writes 'failed' with the last reason, the
--              order reads refund_state 'failed', and R14 REFUND_FAILED then
--              reports it; the earlier nine stay 'pending'.
--   R18        REFUND_STUCK: nothing at or under 1 hour, nothing with 0
--              attempts, nothing for a refund being processed or already
--              failed; a warning over 1 hour, a critical over 24 hours; the
--              same incident turns critical in place and writes one
--              'escalated' outbox row; the payment card counts it only at
--              critical.
--   unchanged  succeeded and definite-failure outcomes, the grants and the
--              money path.
--
-- Every RPC is called the way payment-refund calls it. Inside one transaction
-- now() does not move, so "due now" is next_attempt_at = now().
-- ============================================================================
\set ON_ERROR_STOP on
begin;

insert into public.branches (id, name_en, name_ar)
values ('b0000000-0000-0000-0000-00000000f0f1', 'Refund Backoff Branch', 'فرع إعادة الاسترداد')
on conflict (id) do nothing;

create function pg_temp.rbo_reset() returns void language plpgsql as $$
begin
  delete from public.order_integrity_alert_outbox;
  delete from public.order_integrity_incidents;
  delete from public.order_integrity_runs;
  delete from public.order_refunds;
  delete from public.payment_records;
end $$;

-- An order whose refund is owed: refund_state 'pending', as enrolment leaves it.
create function pg_temp.rbo_order(p_num text) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
                             payment_method, payment_status, refund_state)
  values (v_id, p_num, 'b0000000-0000-0000-0000-00000000f0f1', 'pickup', 50, 50, 'cash', 'pending', 'pending');
  return v_id;
end $$;

create function pg_temp.rbo_refund(
  p_order uuid, p_key text, p_status text default 'pending', p_attempts integer default 0,
  p_created timestamptz default now(), p_next timestamptz default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  -- Enrolment (open_order_refund_record) has already opened the order's refund;
  -- it is replaced by this one, with the chosen counts and times.
  delete from public.order_refunds where order_id = p_order;
  insert into public.order_refunds (id, order_id, provider, charge_ref, idempotency_key, amount, currency,
                                    status, attempt_count, created_at, updated_at, next_attempt_at)
  values (v_id, p_order, 'moyasar', 'pay_rbo_' || p_key, 'rbo_' || p_key, 50, 'SAR',
          p_status, p_attempts, p_created, p_created, p_next);
  return v_id;
end $$;

create function pg_temp.rbo_claim(p_token text) returns uuid language sql as $$
  select refund_id from public.claim_order_refund(p_claim_token => p_token, p_exclude_refund_ids => '{}'::uuid[]);
$$;

create function pg_temp.rbo_scan(p_times integer default 1) returns text language plpgsql as $$
declare v_run bigint; i integer;
begin
  for i in 1 .. p_times loop
    v_run := public.order_integrity_watchdog();
  end loop;
  return (select status from public.order_integrity_runs where id = v_run);
end $$;

-- The open incident for a fingerprint, as 'severity' or NULL.
create function pg_temp.rbo_sev(p_fingerprint text) returns text language sql as $$
  select severity from public.order_integrity_incidents
   where fingerprint = p_fingerprint and status <> 'resolved';
$$;

-- ---- 1. The schedule ----------------------------------------------------------
do $$
declare v text;
begin
  select string_agg((extract(epoch from public.refund_retry_delay(k)) / 60)::integer::text, ',' order by k)
    into v from generate_series(1, 11) k;
  if v is distinct from '5,10,20,40,80,160,320,360,360,360,360' then
    raise exception 'CASE 1 FAILED: the waits in minutes are %', coalesce(v, 'NULL');
  end if;
  if public.refund_retry_delay(0) is distinct from interval '5 minutes'
     or public.refund_retry_delay(null) is distinct from interval '5 minutes'
     or public.refund_retry_delay(2147483647) is distinct from interval '6 hours' then
    raise exception 'CASE 1 FAILED: refund_retry_delay is not clamped at both ends';
  end if;
  raise notice 'CASE 1 ok: 5 minutes doubling, capped at 6 hours';
end $$;

-- ---- 2. Each release backs off, and a refund not yet due is not claimed -------------
do $$
declare
  v_r uuid; v_claim uuid; v_row public.order_refunds; i integer;
  v_seen text := '';
begin
  perform pg_temp.rbo_reset();
  v_r := pg_temp.rbo_refund(pg_temp.rbo_order('RBO-2'), '2');
  for i in 1 .. 9 loop
    v_claim := pg_temp.rbo_claim('rbo-2-' || i);
    if v_claim is distinct from v_r then
      raise exception 'CASE 2 FAILED: attempt % did not claim the due refund (got %)', i, v_claim;
    end if;
    if not public.finalize_order_refund(v_r, 'rbo-2-' || i, 'pending', null, 'http_503', 'try ' || i) then
      raise exception 'CASE 2 FAILED: release % refused', i;
    end if;
    select * into v_row from public.order_refunds where id = v_r;
    if v_row.status is distinct from 'pending' or v_row.attempt_count is distinct from i
       or v_row.failure_code is distinct from 'http_503' or v_row.last_error_safe is distinct from 'try ' || i then
      raise exception 'CASE 2 FAILED: release % left %/%/%/%', i, v_row.status, v_row.attempt_count,
        v_row.failure_code, v_row.last_error_safe;
    end if;
    v_seen := v_seen || case when i > 1 then ',' else '' end
              || (extract(epoch from (v_row.next_attempt_at - now())) / 60)::integer::text;
    -- One second short of due: not claimed.
    update public.order_refunds set next_attempt_at = now() + interval '1 second' where id = v_r;
    if pg_temp.rbo_claim('rbo-2-early-' || i) is not null then
      raise exception 'CASE 2 FAILED: a refund due in one second was claimed after release %', i;
    end if;
    -- Due exactly now: the next iteration claims it.
    update public.order_refunds set next_attempt_at = now() where id = v_r;
  end loop;
  if v_seen is distinct from '5,10,20,40,80,160,320,360,360' then
    raise exception 'CASE 2 FAILED: the waits the worker''s releases wrote were %', v_seen;
  end if;
  raise notice 'CASE 2 ok: releases wrote 5,10,20,40,80,160,320,360,360 minutes, and nothing early was claimed';
end $$;

-- ---- 3. A refund that is not due does not hold back one that is -------------------
-- The filter under the lock cannot be told apart from the scan's in one session;
-- the migration's self-verification asserts both are present. Here: the least
-- recently touched refund, not yet due, is passed over, due refunds keep their
-- order, and a NULL next_attempt_at is due.
do $$
declare v_late uuid; v_due1 uuid; v_due2 uuid; v_claim uuid; i integer;
begin
  perform pg_temp.rbo_reset();
  -- The least recently touched, and not due.
  v_late := pg_temp.rbo_refund(pg_temp.rbo_order('RBO-3L'), '3l', 'pending', 1,
                               now() - interval '50 minutes', now() + interval '3 minutes');
  v_due1 := pg_temp.rbo_refund(pg_temp.rbo_order('RBO-3A'), '3a', 'pending', 2,
                               now() - interval '40 minutes', now() - interval '1 minute');
  v_due2 := pg_temp.rbo_refund(pg_temp.rbo_order('RBO-3B'), '3b', 'pending', 0,
                               now() - interval '30 minutes', null);
  v_claim := pg_temp.rbo_claim('rbo-3-1');
  if v_claim is distinct from v_due1 then
    raise exception 'CASE 3 FAILED: expected the oldest DUE refund, got % (late %)', v_claim, v_late;
  end if;
  v_claim := pg_temp.rbo_claim('rbo-3-2');
  if v_claim is distinct from v_due2 then
    raise exception 'CASE 3 FAILED: a refund with no next_attempt_at was not treated as due (got %)', v_claim;
  end if;
  if pg_temp.rbo_claim('rbo-3-3') is not null then
    raise exception 'CASE 3 FAILED: the refund that is not due was claimed';
  end if;

  -- The scan reads at most 50 candidates. If it did not filter on due, 50 refunds
  -- backing off ahead of a due one would fill it, every one would fail the
  -- re-check, and the due refund would never be claimed.
  perform pg_temp.rbo_reset();
  for i in 1 .. 50 loop
    perform pg_temp.rbo_refund(pg_temp.rbo_order('RBO-3W-' || i), '3w-' || i, 'pending', 1,
                               now() - interval '3 hours' + make_interval(secs => i), now() + interval '1 hour');
  end loop;
  v_due1 := pg_temp.rbo_refund(pg_temp.rbo_order('RBO-3D'), '3d', 'pending', 1,
                               now() - interval '1 hour', now() - interval '1 second');
  v_claim := pg_temp.rbo_claim('rbo-3-4');
  if v_claim is distinct from v_due1 then
    raise exception 'CASE 3 FAILED: 50 refunds backing off hid the one that is due (got %)', v_claim;
  end if;
  raise notice 'CASE 3 ok: only due refunds are claimed, oldest touched first, NULL is due, and a backlog backing off hides nothing';
end $$;

-- ---- 4. The cap: the tenth release is 'failed' with the last reason -----------------
do $$
declare v_o uuid; v_r uuid; v_row public.order_refunds; v_state text;
begin
  perform pg_temp.rbo_reset();
  v_o := pg_temp.rbo_order('RBO-4');
  -- Nine attempts made; the tenth claim makes it ten.
  v_r := pg_temp.rbo_refund(v_o, '4', 'pending', 9, now() - interval '20 hours', null);
  if pg_temp.rbo_claim('rbo-4') is distinct from v_r then
    raise exception 'CASE 4 FAILED: the tenth attempt was not claimed';
  end if;
  if not public.finalize_order_refund(v_r, 'rbo-4', 'pending', null, 'provider_no_answer',
         'No answer from Moyasar: a network, proxy or timeout error.') then
    raise exception 'CASE 4 FAILED: the tenth release was refused';
  end if;
  select * into v_row from public.order_refunds where id = v_r;
  if v_row.status is distinct from 'failed' or v_row.attempt_count is distinct from 10
     or v_row.failure_code is distinct from 'provider_no_answer'
     or v_row.last_error_safe is distinct from
          'Automatic refund stopped after 10 attempts. Last reason: No answer from Moyasar: a network, proxy or timeout error.'
     or v_row.next_attempt_at is not null or v_row.claim_token is not null or v_row.completed_at is not null then
    raise exception 'CASE 4 FAILED: the capped refund reads %/%/%/%/next %', v_row.status, v_row.attempt_count,
      v_row.failure_code, v_row.last_error_safe, v_row.next_attempt_at;
  end if;
  select refund_state || '/' || coalesce(refund_failure_code, 'NULL') into v_state from public.orders where id = v_o;
  if v_state is distinct from 'failed/provider_no_answer' then
    raise exception 'CASE 4 FAILED: the order reads %, expected failed/provider_no_answer', v_state;
  end if;
  if pg_temp.rbo_claim('rbo-4-after') is not null then
    raise exception 'CASE 4 FAILED: a capped refund was claimed again';
  end if;

  -- R14 reports it.
  if pg_temp.rbo_scan(1) is distinct from 'success' then
    raise exception 'CASE 4 FAILED: the watchdog run failed';
  end if;
  if pg_temp.rbo_sev('REFUND_FAILED:' || v_o) is distinct from 'critical' then
    raise exception 'CASE 4 FAILED: R14 did not report the capped refund (got %)', pg_temp.rbo_sev('REFUND_FAILED:' || v_o);
  end if;
  if (select safe_details ->> 'failure_code' from public.order_integrity_incidents
       where fingerprint = 'REFUND_FAILED:' || v_o) is distinct from 'provider_no_answer' then
    raise exception 'CASE 4 FAILED: R14 does not carry the last reason';
  end if;
  if pg_temp.rbo_sev('REFUND_STUCK:' || v_o) is not null then
    raise exception 'CASE 4 FAILED: a failed refund was reported as stuck';
  end if;

  -- A release with no reason at the cap still says why.
  perform pg_temp.rbo_reset();
  v_o := pg_temp.rbo_order('RBO-4N');
  v_r := pg_temp.rbo_refund(v_o, '4n', 'pending', 9);
  perform pg_temp.rbo_claim('rbo-4n');
  perform public.finalize_order_refund(v_r, 'rbo-4n', 'pending', null, null, null);
  select * into v_row from public.order_refunds where id = v_r;
  if v_row.status is distinct from 'failed' or v_row.failure_code is distinct from 'retry_limit_reached'
     or v_row.last_error_safe is distinct from 'Automatic refund stopped after 10 attempts. Last reason: retry_limit_reached' then
    raise exception 'CASE 4 FAILED: a reasonless capped release reads %/%/%', v_row.status, v_row.failure_code, v_row.last_error_safe;
  end if;

  -- The ninth release is still a retry.
  perform pg_temp.rbo_reset();
  v_r := pg_temp.rbo_refund(pg_temp.rbo_order('RBO-4P'), '4p', 'pending', 8);
  perform pg_temp.rbo_claim('rbo-4p');
  perform public.finalize_order_refund(v_r, 'rbo-4p', 'pending', null, 'http_503', 'x');
  select * into v_row from public.order_refunds where id = v_r;
  if v_row.status is distinct from 'pending' or v_row.next_attempt_at is distinct from now() + interval '6 hours' then
    raise exception 'CASE 4 FAILED: the ninth release reads % next %', v_row.status, v_row.next_attempt_at;
  end if;
  raise notice 'CASE 4 ok: ten attempts, then failed with the last reason, and R14 reports it';
end $$;

-- ---- 5. Other outcomes are unchanged ------------------------------------------------
do $$
declare v_o uuid; v_r uuid; v_row public.order_refunds;
begin
  perform pg_temp.rbo_reset();
  v_o := pg_temp.rbo_order('RBO-5S');
  v_r := pg_temp.rbo_refund(v_o, '5s', 'pending', 3, now(), now());
  perform pg_temp.rbo_claim('rbo-5s');
  perform public.finalize_order_refund(v_r, 'rbo-5s', 'succeeded', 'rfnd_1', null, null);
  select * into v_row from public.order_refunds where id = v_r;
  if v_row.status is distinct from 'succeeded' or v_row.next_attempt_at is not null
     or v_row.provider_ref is distinct from 'rfnd_1' or v_row.completed_at is null
     or (select refund_state from public.orders where id = v_o) is distinct from 'refunded' then
    raise exception 'CASE 5 FAILED: a success reads %/%/%', v_row.status, v_row.next_attempt_at, v_row.provider_ref;
  end if;

  v_o := pg_temp.rbo_order('RBO-5F');
  v_r := pg_temp.rbo_refund(v_o, '5f', 'pending', 1);
  perform pg_temp.rbo_claim('rbo-5f');
  perform public.finalize_order_refund(v_r, 'rbo-5f', 'failed', null, 'http_400', 'rejected');
  select * into v_row from public.order_refunds where id = v_r;
  if v_row.status is distinct from 'failed' or v_row.failure_code is distinct from 'http_400'
     or v_row.last_error_safe is distinct from 'rejected' or v_row.attempt_count is distinct from 2 then
    raise exception 'CASE 5 FAILED: a definite failure reads %/%/%', v_row.status, v_row.failure_code, v_row.last_error_safe;
  end if;

  -- A foreign token still writes nothing.
  v_r := pg_temp.rbo_refund(pg_temp.rbo_order('RBO-5T'), '5t', 'pending', 9);
  perform pg_temp.rbo_claim('rbo-5t');
  if public.finalize_order_refund(v_r, 'not-the-token', 'pending', null, 'http_503', 'x') then
    raise exception 'CASE 5 FAILED: a foreign token finalized a refund';
  end if;
  if (select status from public.order_refunds where id = v_r) is distinct from 'processing' then
    raise exception 'CASE 5 FAILED: a refused finalize changed the row';
  end if;
  raise notice 'CASE 5 ok: success, definite failure and the token fence unchanged';
end $$;

-- ---- 6. R18 thresholds ----------------------------------------------------------------
do $$
declare
  o_59 uuid := pg_temp.rbo_order('RBO-6-59');
  o_60 uuid := pg_temp.rbo_order('RBO-6-60');
  o_61 uuid := pg_temp.rbo_order('RBO-6-61');
  o_0  uuid := pg_temp.rbo_order('RBO-6-0');
  o_23 uuid := pg_temp.rbo_order('RBO-6-23');
  o_24 uuid := pg_temp.rbo_order('RBO-6-24');
  o_25 uuid := pg_temp.rbo_order('RBO-6-25');
  o_pr uuid := pg_temp.rbo_order('RBO-6-PR');
  v_card jsonb;
begin
  perform pg_temp.rbo_reset();
  perform pg_temp.rbo_refund(o_59, '6-59', 'pending', 1, now() - interval '59 minutes');
  perform pg_temp.rbo_refund(o_60, '6-60', 'pending', 1, now() - interval '1 hour');
  perform pg_temp.rbo_refund(o_61, '6-61', 'pending', 1, now() - interval '61 minutes');
  perform pg_temp.rbo_refund(o_0,  '6-0',  'pending', 0, now() - interval '30 hours');
  perform pg_temp.rbo_refund(o_23, '6-23', 'pending', 4, now() - interval '23 hours 59 minutes');
  perform pg_temp.rbo_refund(o_24, '6-24', 'pending', 9, now() - interval '24 hours');
  perform pg_temp.rbo_refund(o_25, '6-25', 'pending', 9, now() - interval '24 hours 1 minute');
  perform pg_temp.rbo_refund(o_pr, '6-pr', 'processing', 3, now() - interval '30 hours');

  if pg_temp.rbo_scan(1) is distinct from 'success' then
    raise exception 'CASE 6 FAILED: the watchdog run failed';
  end if;
  if pg_temp.rbo_sev('REFUND_STUCK:' || o_59) is not null then
    raise exception 'CASE 6 FAILED: a refund 59 minutes old raised %', pg_temp.rbo_sev('REFUND_STUCK:' || o_59);
  end if;
  if pg_temp.rbo_sev('REFUND_STUCK:' || o_60) is not null then
    raise exception 'CASE 6 FAILED: a refund exactly 1 hour old raised % (the threshold is OVER 1 hour)',
      pg_temp.rbo_sev('REFUND_STUCK:' || o_60);
  end if;
  if pg_temp.rbo_sev('REFUND_STUCK:' || o_61) is distinct from 'warning' then
    raise exception 'CASE 6 FAILED: a refund 61 minutes old after 1 attempt raised %, expected warning',
      coalesce(pg_temp.rbo_sev('REFUND_STUCK:' || o_61), 'nothing');
  end if;
  if pg_temp.rbo_sev('REFUND_STUCK:' || o_0) is not null then
    raise exception 'CASE 6 FAILED: a refund never tried raised %', pg_temp.rbo_sev('REFUND_STUCK:' || o_0);
  end if;
  if pg_temp.rbo_sev('REFUND_STUCK:' || o_23) is distinct from 'warning' then
    raise exception 'CASE 6 FAILED: a refund 23 h 59 old raised %, expected warning',
      coalesce(pg_temp.rbo_sev('REFUND_STUCK:' || o_23), 'nothing');
  end if;
  if pg_temp.rbo_sev('REFUND_STUCK:' || o_24) is distinct from 'warning' then
    raise exception 'CASE 6 FAILED: a refund exactly 24 h old raised %, expected warning (critical is OVER 24 hours)',
      coalesce(pg_temp.rbo_sev('REFUND_STUCK:' || o_24), 'nothing');
  end if;
  if pg_temp.rbo_sev('REFUND_STUCK:' || o_25) is distinct from 'critical' then
    raise exception 'CASE 6 FAILED: a refund 24 h 01 old raised %, expected critical',
      coalesce(pg_temp.rbo_sev('REFUND_STUCK:' || o_25), 'nothing');
  end if;
  if pg_temp.rbo_sev('REFUND_STUCK:' || o_pr) is not null then
    raise exception 'CASE 6 FAILED: a refund being processed raised %', pg_temp.rbo_sev('REFUND_STUCK:' || o_pr);
  end if;
  if (select safe_details ->> 'attempt_count' from public.order_integrity_incidents
       where fingerprint = 'REFUND_STUCK:' || o_25)::integer is distinct from 9
     or (select entity_type from public.order_integrity_incidents where fingerprint = 'REFUND_STUCK:' || o_25)
        is distinct from 'order' then
    raise exception 'CASE 6 FAILED: the incident does not carry its attempts or is not an order incident';
  end if;

  -- The payment card counts R18 only at critical: the one critical, not the three warnings.
  select x into v_card from jsonb_array_elements(public.operations_health_snapshot_internal() -> 'systems') x
   where x ->> 'id' = 'payment';
  if (v_card -> 'details' ->> 'integrity_critical_count')::integer is distinct from 1 then
    raise exception 'CASE 6 FAILED: the payment card counts % payment incidents, expected the 1 critical R18',
      coalesce(v_card -> 'details' ->> 'integrity_critical_count', 'NULL');
  end if;
  raise notice 'CASE 6 ok: silent to 1 h and with 0 attempts, warning over 1 h, critical over 24 h';
end $$;

-- ---- 7. The same incident turns critical, with one escalated alert ------------------
do $$
declare v_o uuid; v_r uuid; v_inc uuid; v_n integer;
begin
  perform pg_temp.rbo_reset();
  v_o := pg_temp.rbo_order('RBO-7');
  v_r := pg_temp.rbo_refund(v_o, '7', 'pending', 5, now() - interval '3 hours');
  perform pg_temp.rbo_scan(1);
  select id into v_inc from public.order_integrity_incidents
   where fingerprint = 'REFUND_STUCK:' || v_o and status = 'open' and severity = 'warning';
  if v_inc is null then
    raise exception 'CASE 7 FAILED: no warning incident';
  end if;
  -- A warning is alert-eligible after 15 minutes.
  update public.order_integrity_incidents set first_detected_at = now() - interval '20 minutes' where id = v_inc;
  perform pg_temp.rbo_scan(1);
  if not exists (select 1 from public.order_integrity_alert_outbox
                  where incident_id = v_inc and alert_type = 'opened' and severity = 'warning') then
    raise exception 'CASE 7 FAILED: the warning wrote no opened alert';
  end if;

  update public.order_refunds set created_at = now() - interval '25 hours' where id = v_r;
  perform pg_temp.rbo_scan(2);
  if (select count(*) from public.order_integrity_incidents where fingerprint = 'REFUND_STUCK:' || v_o) <> 1 then
    raise exception 'CASE 7 FAILED: escalation opened a second incident';
  end if;
  if (select severity from public.order_integrity_incidents where id = v_inc) is distinct from 'critical' then
    raise exception 'CASE 7 FAILED: the incident did not turn critical in place';
  end if;
  select count(*) into v_n from public.order_integrity_alert_outbox where incident_id = v_inc and alert_type = 'escalated';
  if v_n <> 1 or not exists (select 1 from public.order_integrity_alert_outbox
                              where incident_id = v_inc and alert_type = 'escalated' and severity = 'critical') then
    raise exception 'CASE 7 FAILED: % escalated alert(s), expected one at critical', v_n;
  end if;
  if (select count(*) from public.order_integrity_alert_outbox where incident_id = v_inc and alert_type = 'opened') <> 1 then
    raise exception 'CASE 7 FAILED: escalation wrote a second opened alert';
  end if;

  -- A rule born critical writes no escalation.
  perform pg_temp.rbo_reset();
  v_o := pg_temp.rbo_order('RBO-7C');
  perform pg_temp.rbo_refund(v_o, '7c', 'pending', 9, now() - interval '30 hours');
  perform pg_temp.rbo_scan(3);
  if exists (select 1 from public.order_integrity_alert_outbox where alert_type = 'escalated') then
    raise exception 'CASE 7 FAILED: an incident opened at critical wrote an escalated alert';
  end if;
  if not exists (select 1 from public.order_integrity_alert_outbox where alert_type = 'opened' and severity = 'critical') then
    raise exception 'CASE 7 FAILED: the critical incident wrote no opened alert';
  end if;
  raise notice 'CASE 7 ok: warning, then critical in place, one escalated alert';
end $$;

-- ---- 8. When the refund reaches the cap, R18 gives way to R14 -----------------------
do $$
declare v_o uuid; v_r uuid;
begin
  perform pg_temp.rbo_reset();
  v_o := pg_temp.rbo_order('RBO-8');
  v_r := pg_temp.rbo_refund(v_o, '8', 'pending', 9, now() - interval '23 hours');
  perform pg_temp.rbo_scan(1);
  if pg_temp.rbo_sev('REFUND_STUCK:' || v_o) is distinct from 'warning' then
    raise exception 'CASE 8 FAILED: no R18 before the cap';
  end if;
  perform pg_temp.rbo_claim('rbo-8');
  perform public.finalize_order_refund(v_r, 'rbo-8', 'pending', null, 'http_502', 'bad gateway');
  perform pg_temp.rbo_scan(2);
  if pg_temp.rbo_sev('REFUND_STUCK:' || v_o) is not null then
    raise exception 'CASE 8 FAILED: R18 stayed open after two clean scans';
  end if;
  if pg_temp.rbo_sev('REFUND_FAILED:' || v_o) is distinct from 'critical' then
    raise exception 'CASE 8 FAILED: R14 did not open for the capped refund';
  end if;
  raise notice 'CASE 8 ok: the capped refund moves from R18 to R14';
end $$;

-- ---- 9. Grants and the money path ---------------------------------------------------
do $$
declare v text; f text;
begin
  foreach f in array array['public.refund_retry_delay(integer)', 'public.claim_order_refund(text, uuid[])',
                           'public.finalize_order_refund(uuid, text, text, text, text, text)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
       or not has_function_privilege('service_role', f, 'execute') then
      raise exception 'CASE 9 FAILED: % is not service_role only', f;
    end if;
  end loop;
  if to_regprocedure('public.claim_order_refund(text)') is not null then
    raise exception 'CASE 9 FAILED: the one-argument claim_order_refund exists';
  end if;
  select md5(pg_get_functiondef('public.place_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text)'::regprocedure)) into v;
  if v is distinct from '7078c7ddc36eb5eb0f7b0fc86b26dc8d' then raise exception 'CASE 9 FAILED: place_order moved to %', v; end if;
  select md5(pg_get_functiondef('public.compute_order_snapshot(uuid, uuid, public.order_type, jsonb, uuid, text, integer)'::regprocedure)) into v;
  if v is distinct from '22e2d42935459e7bf93abb2941b56325' then raise exception 'CASE 9 FAILED: compute_order_snapshot moved to %', v; end if;
  raise notice 'CASE 9 ok: service_role only, money path unchanged';
end $$;

rollback;
