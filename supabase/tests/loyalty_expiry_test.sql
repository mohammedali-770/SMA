-- ============================================================================
-- Points expiry on a fixed calendar reset.
--
-- Covers 20260909120000_loyalty_expiry.sql.
--
-- WHAT THIS FILE IS REALLY FOR. Every other loyalty suite guards a number being
-- computed. This one guards customer value being DESTROYED, so most of it is
-- about the times expiry must NOT happen:
--
--   * not when it is switched off (section 2),
--   * not on the day it is switched ON, however far in the past the anchor is
--     (section 3 -- the retroactivity trap),
--   * not twice for the same reset (section 5 -- idempotence),
--   * not for a customer holding nothing (section 4),
--   * and never silently: one readable ledger row per customer, which the
--     customer themselves can see (sections 4 and 7).
--
-- The one case where it MUST happen is section 4.
--
-- Runs against a throwaway chain-applied Postgres. Every case raises on
-- failure; a clean run prints the final notice and commits nothing.
-- ============================================================================
begin;

\set alice '''0a000000-0000-0000-0000-00000000e001'''
\set bob   '''0a000000-0000-0000-0000-00000000e002'''
\set broke '''0a000000-0000-0000-0000-00000000e003'''

insert into auth.users (id, email) values
  (:alice, 'alice-exp@x'), (:bob, 'bob-exp@x'), (:broke, 'broke-exp@x');
insert into public.profiles (id, role, full_name, phone_number, loyalty_points) values
  (:alice, 'customer', 'Alice', '+966500000801', 400),
  (:bob,   'customer', 'Bob',   '+966500000802', 150),
  (:broke, 'customer', 'Broke', '+966500000803', 0)
on conflict (id) do update set loyalty_points = excluded.loyalty_points,
  role = excluded.role, full_name = excluded.full_name, phone_number = excluded.phone_number;

-- ============================================================================
-- 1. The ledger admits `expire`, and still refuses nonsense
-- ============================================================================
do $$
declare v_rejected boolean := false;
begin
  insert into public.loyalty_transactions (profile_id, type, points, balance_after, reason)
  values ('0a000000-0000-0000-0000-00000000e001', 'expire', -1, 0, 'probe');
  delete from public.loyalty_transactions
   where profile_id = '0a000000-0000-0000-0000-00000000e001' and reason = 'probe';

  begin
    insert into public.loyalty_transactions (profile_id, type, points, balance_after, reason)
    values ('0a000000-0000-0000-0000-00000000e001', 'evaporate', -1, 0, 'probe2');
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL 1: the widened constraint admits arbitrary types';
  end if;

  raise notice 'case 1 ok -- expire is a valid ledger type, and the constraint still bites';
end $$;

-- ============================================================================
-- 2. DISABLED: the driver touches nothing
-- ============================================================================
do $$
declare v_res jsonb; v_a int; v_rows int;
begin
  if (select loyalty_expiry_enabled from public.app_settings where id = true) then
    raise exception 'FAIL 2: expiry is enabled by default -- it must not be';
  end if;

  v_res := public.run_loyalty_expiry();
  if (v_res ->> 'ran')::boolean then
    raise exception 'FAIL 2: the driver ran while disabled: %', v_res;
  end if;
  if v_res ->> 'reason' <> 'disabled' then
    raise exception 'FAIL 2: unexpected reason %', v_res ->> 'reason';
  end if;

  select loyalty_points into v_a from public.profiles
   where id = '0a000000-0000-0000-0000-00000000e001';
  if v_a <> 400 then raise exception 'FAIL 2: a balance moved while disabled (%)', v_a; end if;
  select count(*) into v_rows from public.loyalty_transactions where type = 'expire';
  if v_rows <> 0 then raise exception 'FAIL 2: % expire rows written while disabled', v_rows; end if;

  raise notice 'case 2 ok -- disabled means nothing is read and nothing is written';
end $$;

-- ============================================================================
-- 3. THE RETROACTIVITY TRAP
--    Enable expiry with an anchor that is MONTHS IN THE PAST. Nobody may lose a
--    point today: the schedule must jump forward to the next occurrence.
--    Without the reschedule trigger this is the case that wipes every balance
--    the moment an administrator flips the switch.
-- ============================================================================
do $$
declare v_next date; v_res jsonb; v_a int;
begin
  -- 1 January, annual. Unless today IS 1 January, that anchor is in the past.
  update public.app_settings
     set loyalty_expiry_enabled = true,
         loyalty_expiry_anchor_month = 1,
         loyalty_expiry_anchor_day = 1,
         loyalty_expiry_period_months = 12
   where id = true;

  select loyalty_expiry_next_run_on into v_next from public.app_settings where id = true;
  if v_next is null then
    raise exception 'FAIL 3: enabling expiry scheduled nothing';
  end if;
  if v_next <= current_date then
    raise exception 'FAIL 3: the schedule landed on %, which is not in the future', v_next;
  end if;

  v_res := public.run_loyalty_expiry();
  if (v_res ->> 'ran')::boolean then
    raise exception 'FAIL 3: enabling expiry expired somebody immediately: %', v_res;
  end if;
  select loyalty_points into v_a from public.profiles
   where id = '0a000000-0000-0000-0000-00000000e001';
  if v_a <> 400 then
    raise exception 'FAIL 3: a balance was destroyed on the day expiry was switched on (%)', v_a;
  end if;

  raise notice 'case 3 ok -- a past anchor schedules forward, it does not fire';
end $$;

-- ...and the same protection after a disable/re-enable cycle, which is how a
-- stale date would otherwise be left lying around.
do $$
declare v_next date; v_res jsonb;
begin
  update public.app_settings set loyalty_expiry_enabled = false where id = true;
  if (select loyalty_expiry_next_run_on from public.app_settings where id = true) is not null then
    raise exception 'FAIL 3b: disabling left a schedule behind';
  end if;
  update public.app_settings set loyalty_expiry_enabled = true where id = true;
  select loyalty_expiry_next_run_on into v_next from public.app_settings where id = true;
  if v_next is null or v_next <= current_date then
    raise exception 'FAIL 3b: re-enabling produced the stale/absent date %', v_next;
  end if;
  v_res := public.run_loyalty_expiry();
  if (v_res ->> 'ran')::boolean then
    raise exception 'FAIL 3b: re-enabling expired somebody: %', v_res;
  end if;

  raise notice 'case 3b ok -- disable/re-enable cannot resurrect a past due date';
end $$;

-- ...and the case that actually needs the "just switched on" clause, which the
-- two above do NOT reach: an administrator enabling expiry and setting the due
-- date in the SAME statement. `loyalty_expiry_next_run_on` is an ordinary
-- admin-writable column, so this is a plausible hand-edit; nothing else stops
-- the value surviving, and the next nightly tick would then wipe every balance.
--
-- Found by mutation testing: deleting the enable-transition clause left every
-- other case in this file passing, because they all reach the trigger through
-- its `next_run_on is null` fallback instead.
do $$
declare v_next date; v_res jsonb; v_a int;
begin
  update public.app_settings set loyalty_expiry_enabled = false where id = true;
  update public.profiles set loyalty_points = 400
   where id = '0a000000-0000-0000-0000-00000000e001';

  update public.app_settings
     set loyalty_expiry_enabled = true,
         loyalty_expiry_next_run_on = date '2020-01-01'   -- long past, set by hand
   where id = true;

  select loyalty_expiry_next_run_on into v_next from public.app_settings where id = true;
  if v_next <= current_date then
    raise exception 'FAIL 3c: a hand-written past due date (%) survived being enabled', v_next;
  end if;

  v_res := public.run_loyalty_expiry();
  if (v_res ->> 'ran')::boolean then
    raise exception 'FAIL 3c: the hand-written date fired: %', v_res;
  end if;
  select loyalty_points into v_a from public.profiles
   where id = '0a000000-0000-0000-0000-00000000e001';
  if v_a <> 400 then
    raise exception 'FAIL 3c: balances were destroyed by a hand-written due date (%)', v_a;
  end if;

  raise notice 'case 3c ok -- enabling overrides a due date written in the same statement';
end $$;

-- ============================================================================
-- 4. THE DAY ITSELF: balances go to zero, once, with an audit row each
-- ============================================================================
do $$
declare v_res jsonb; v_a int; v_b int; v_c int; v_row public.loyalty_transactions;
begin
  -- Force the schedule to today. Written directly rather than by waiting a year;
  -- the trigger only recomputes when the ANCHOR changes, so this survives.
  update public.app_settings set loyalty_expiry_next_run_on = current_date where id = true;

  v_res := public.run_loyalty_expiry();
  if not (v_res ->> 'ran')::boolean then
    raise exception 'FAIL 4: the driver did not run on the due date: %', v_res;
  end if;
  if (v_res ->> 'customers_expired')::int <> 2 then
    raise exception 'FAIL 4: expired % customers, expected 2 (the zero-balance one is skipped)',
      v_res ->> 'customers_expired';
  end if;
  if (v_res ->> 'points_expired')::bigint <> 550 then
    raise exception 'FAIL 4: expired % points, expected 550', v_res ->> 'points_expired';
  end if;

  select loyalty_points into v_a from public.profiles where id = '0a000000-0000-0000-0000-00000000e001';
  select loyalty_points into v_b from public.profiles where id = '0a000000-0000-0000-0000-00000000e002';
  select loyalty_points into v_c from public.profiles where id = '0a000000-0000-0000-0000-00000000e003';
  if v_a <> 0 or v_b <> 0 or v_c <> 0 then
    raise exception 'FAIL 4: balances after expiry are %/%/%, expected 0/0/0', v_a, v_b, v_c;
  end if;

  -- One row each, and the arithmetic in the row must reconstruct the loss.
  if (select count(*) from public.loyalty_transactions where type = 'expire') <> 2 then
    raise exception 'FAIL 4: expected exactly 2 expire rows, found %',
      (select count(*) from public.loyalty_transactions where type = 'expire');
  end if;
  select * into v_row from public.loyalty_transactions
   where type = 'expire' and profile_id = '0a000000-0000-0000-0000-00000000e001';
  if v_row.points <> -400 then
    raise exception 'FAIL 4: Alice''s expire row records % points, expected -400', v_row.points;
  end if;
  if v_row.balance_after <> 0 then
    raise exception 'FAIL 4: balance_after is %, expected 0', v_row.balance_after;
  end if;
  if v_row.order_id is not null then
    raise exception 'FAIL 4: an expiry row must not be attached to an order';
  end if;
  -- The customer at zero gets NO row: "0 points expired" is noise.
  if exists (select 1 from public.loyalty_transactions
              where type = 'expire' and profile_id = '0a000000-0000-0000-0000-00000000e003') then
    raise exception 'FAIL 4: a zero-balance customer got an expiry row';
  end if;

  raise notice 'case 4 ok -- balances zeroed, one auditable row each, nobody at zero touched';
end $$;

-- ============================================================================
-- 5. IDEMPOTENCE: a second tick on the same day does nothing
--    A cron job that fires twice, or a manual re-run, must not double-write.
-- ============================================================================
do $$
declare v_res jsonb; v_next date;
begin
  select loyalty_expiry_next_run_on into v_next from public.app_settings where id = true;
  if v_next <= current_date then
    raise exception 'FAIL 5: the schedule was not advanced past today (%)', v_next;
  end if;

  update public.profiles set loyalty_points = 99
   where id = '0a000000-0000-0000-0000-00000000e001';

  v_res := public.run_loyalty_expiry();
  if (v_res ->> 'ran')::boolean then
    raise exception 'FAIL 5: a second run on the same day expired again: %', v_res;
  end if;
  if (select loyalty_points from public.profiles where id = '0a000000-0000-0000-0000-00000000e001') <> 99 then
    raise exception 'FAIL 5: the second run took points it should not have seen';
  end if;
  if (select count(*) from public.loyalty_transactions where type = 'expire') <> 2 then
    raise exception 'FAIL 5: the second run wrote more ledger rows';
  end if;

  raise notice 'case 5 ok -- the reset happens once, whatever calls the driver';
end $$;

-- ============================================================================
-- 6. A MISSED DAY CATCHES UP rather than skipping a whole cycle
-- ============================================================================
do $$
declare v_res jsonb;
begin
  -- Pretend the job did not fire: the due date is yesterday, and points remain.
  update public.app_settings set loyalty_expiry_next_run_on = current_date - 1 where id = true;
  v_res := public.run_loyalty_expiry();
  if not (v_res ->> 'ran')::boolean then
    raise exception 'FAIL 6: an overdue reset was skipped instead of caught up: %', v_res;
  end if;
  if (select loyalty_points from public.profiles where id = '0a000000-0000-0000-0000-00000000e001') <> 0 then
    raise exception 'FAIL 6: the caught-up run did not zero the balance';
  end if;

  raise notice 'case 6 ok -- a missed day is caught up the next day';
end $$;

-- ============================================================================
-- 7. The customer can SEE it, and cannot call the driver
-- ============================================================================
do $$
begin
  if has_function_privilege('authenticated', 'public.run_loyalty_expiry()', 'execute')
     or has_function_privilege('anon', 'public.run_loyalty_expiry()', 'execute') then
    raise exception 'FAIL 7: a client can invoke the expiry driver';
  end if;
  raise notice 'case 7 ok -- only the scheduler reaches the driver';
end $$;

select set_config('test.auth_uid', :alice, true);
select set_config('test.is_admin', 'false', true);
set local role authenticated;
do $$
declare v_mine int; v_theirs int;
begin
  select count(*) into v_mine from public.loyalty_transactions
   where type = 'expire' and profile_id = '0a000000-0000-0000-0000-00000000e001';
  select count(*) into v_theirs from public.loyalty_transactions
   where type = 'expire' and profile_id = '0a000000-0000-0000-0000-00000000e002';
  if v_mine < 1 then
    raise exception 'FAIL 7b: a customer cannot see their OWN expiry -- the balance just vanishes';
  end if;
  if v_theirs <> 0 then
    raise exception 'FAIL 7b: a customer can read somebody else''s expiry row';
  end if;
  raise notice 'case 7b ok -- the customer sees their own expiry and only their own';
end $$;
reset role;

-- ============================================================================
-- 8. The date maths, including the boundaries the column constraints exist for
-- ============================================================================
do $$
declare v_rejected boolean;
begin
  if public.loyalty_next_expiry_on(date '2026-06-15', 1, 1, 12) <> date '2027-01-01' then
    raise exception 'FAIL 8: annual anchor';
  end if;
  -- The day BEFORE the anchor resolves to the anchor; the anchor itself rolls on,
  -- which is what keeps "strictly in the future" true.
  if public.loyalty_next_expiry_on(date '2026-12-31', 1, 1, 12) <> date '2027-01-01' then
    raise exception 'FAIL 8: the eve of the anchor must resolve to the anchor';
  end if;
  if public.loyalty_next_expiry_on(date '2027-01-01', 1, 1, 12) <> date '2028-01-01' then
    raise exception 'FAIL 8: the anchor day itself must roll to the next cycle';
  end if;
  if public.loyalty_next_expiry_on(date '2026-06-15', 1, 1, 6) <> date '2026-07-01' then
    raise exception 'FAIL 8: six-month cycle';
  end if;
  if public.loyalty_next_expiry_on(date '2026-06-15', 3, 15, 3) <> date '2026-09-15' then
    raise exception 'FAIL 8: quarterly cycle from a mid-month anchor, got %',
      public.loyalty_next_expiry_on(date '2026-06-15', 3, 15, 3);
  end if;

  -- A period that does not divide 12 has no fixed calendar meaning and is refused
  -- at both levels: the function raises, and the column constraint rejects.
  begin
    v_rejected := false;
    perform public.loyalty_next_expiry_on(current_date, 1, 1, 5);
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'FAIL 8: a 5-month period was accepted'; end if;

  -- REJECTED BY TWO DIFFERENT PATHS, depending on whether expiry is on, and it
  -- is worth knowing which. While ENABLED the BEFORE trigger reschedules first
  -- and `loyalty_next_expiry_on` raises its own explicit message; the CHECK
  -- never gets a turn. While DISABLED the trigger returns early, so the CHECK is
  -- what refuses. Both are tested, because a guard that is only ever reached in
  -- one configuration is half a guard.
  begin
    v_rejected := false;
    update public.app_settings set loyalty_expiry_period_months = 5 where id = true;
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'FAIL 8: a 5-month period was accepted while enabled'; end if;

  update public.app_settings set loyalty_expiry_enabled = false where id = true;
  begin
    v_rejected := false;
    update public.app_settings set loyalty_expiry_period_months = 5 where id = true;
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL 8: the CHECK accepted a 5-month period while expiry was disabled';
  end if;

  begin
    v_rejected := false;
    update public.app_settings set loyalty_expiry_anchor_day = 31 where id = true;
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'FAIL 8: the column accepted day 31 -- there is no 31st of February';
  end if;

  raise notice 'case 8 ok -- the schedule maths, and the inputs it refuses';
end $$;

do $$ begin
  raise notice 'LOYALTY EXPIRY OK (off by default, never retroactive, once per reset, auditable)';
end $$;

rollback;
