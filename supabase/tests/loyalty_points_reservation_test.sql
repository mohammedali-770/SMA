-- ============================================================================
-- Loyalty points promised to an open card checkout are reserved; a card order
-- records only what it debited; cancelling refunds only what the ledger took.
-- Pins 20261019120000_loyalty_points_reservation.sql.
--
-- Runs against a THROWAWAY Postgres with the whole migration chain applied
-- (`.github/sql-ci/run.sh`). Every case RAISES EXCEPTION on failure; a clean run
-- prints one NOTICE per case and commits nothing.
--
-- The four audit findings it closes, each reproduced on the chain before the
-- migration was written (docs/readiness/20261119-full-audit-plan):
--   F-DBM-04-002 / F-DBM-18-001  cash order during a card checkout: one balance,
--                                two discounts                    -> CASE 2
--   F-DBM-32-001                 second card attempt after the first session's
--                                window ended, its attempt still live -> CASE 3
--   F-DBM-27-001                 a clamp to 0 left the snapshot figure on the
--                                order and cancelling minted it      -> CASE 8
--
-- HOW THE PATH IS DRIVEN. The customer calls begin_checkout_session and
-- place_customer_order as `authenticated` would (test.auth_uid). The service-role
-- steps -- begin_session_attempt (payment-initiate) and
-- finalize_checkout_session (the Moyasar confirm path) -- are called directly.
-- No provider is contacted. Time is moved by writing expires_at.
-- ============================================================================
begin;

update public.app_settings
   set loyalty_enabled = true, min_points_to_redeem = 0, discount_per_point = 0.10,
       points_per_riyal = 1, cash_payment_enabled = true, online_payment_enabled = true,
       loyalty_pickup_only = true
 where id = true;

insert into auth.users (id, email) values ('0f190000-0000-0000-0000-0000000ad001', 'lpr-admin@x');
insert into public.profiles (id, role, full_name, phone_number)
values ('0f190000-0000-0000-0000-0000000ad001', 'admin', 'LPR Admin', null)
on conflict (id) do update set role = 'admin';

-- A customer per case, so no case meets another's open-order limit.
create or replace function pg_temp.mk(p_n int, p_pts int) returns uuid language plpgsql as $$
declare v uuid := ('0f190000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid;
begin
  insert into auth.users (id, email) values (v, 'lpr-' || p_n || '@x');
  insert into public.profiles (id, role, full_name, phone_number, loyalty_points, phone_verified)
  values (v, 'customer', 'LPR ' || p_n, '+9665000191' || lpad(p_n::text, 2, '0'), p_pts, true)
  on conflict (id) do update set loyalty_points = excluded.loyalty_points, phone_verified = true;
  return v;
end $$;

create or replace function pg_temp.as_c(p uuid) returns void language sql as $$
  select set_config('test.auth_uid', p::text, true), set_config('test.is_admin', 'false', true),
         set_config('test.is_staff', 'false', true);
$$;

create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('test.auth_uid', '0f190000-0000-0000-0000-0000000ad001', true),
         set_config('test.is_admin', 'true', true), set_config('test.is_staff', 'true', true);
$$;

-- 5 x 12.00 (a product with no required modifiers), pickup. 100 points = 10.00.
create or replace function pg_temp.sess(p uuid, p_pts int)
returns public.checkout_sessions language plpgsql as $$
declare v public.checkout_sessions;
begin
  perform pg_temp.as_c(p);
  select * into v from public.begin_checkout_session('b0000000-0000-0000-0000-000000000001', 'pickup',
    '[{"product_id":"a0000000-0000-0000-0000-000000000003","quantity":5}]'::jsonb,
    null, null, null, p_pts, gen_random_uuid());
  return v;
end $$;

create or replace function pg_temp.cash(p uuid, p_pts int)
returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_c(p);
  return public.place_customer_order('b0000000-0000-0000-0000-000000000001', 'pickup',
    '[{"product_id":"a0000000-0000-0000-0000-000000000003","quantity":5}]'::jsonb,
    null, null, null, p_pts, gen_random_uuid(), 'cash');
end $$;

-- The outcome of a call as a VALUE, never a notice: 'ok' or the SQLSTATE and
-- hint, so an unexpected error cannot pass for the expected refusal.
create or replace function pg_temp.try_cash(p uuid, p_pts int)
returns text language plpgsql as $$
begin
  perform pg_temp.cash(p, p_pts);
  return 'ok';
exception when others then
  declare v_hint text;
  begin
    get stacked diagnostics v_hint = pg_exception_hint;
    return sqlstate || ':' || coalesce(v_hint, '') || ':' || sqlerrm;
  end;
end $$;

create or replace function pg_temp.try_attempt(s uuid) returns text language plpgsql as $$
begin
  perform public.begin_session_attempt(s, 'moyasar', 'test', 60);
  return 'ok';
exception when others then return sqlstate || ':' || sqlerrm;
end $$;

create or replace function pg_temp.finalize(s uuid, ref text) returns public.orders language sql as $$
  select * from public.finalize_checkout_session(s, 'moyasar', ref,
    (select total from public.checkout_sessions where id = s), 'SAR');
$$;

create or replace function pg_temp.bal(p uuid) returns int language sql as $$
  select loyalty_points from public.profiles where id = p;
$$;

create or replace function pg_temp.redeemed_in_ledger(o uuid) returns int language sql as $$
  select coalesce(-sum(points), 0)::int from public.loyalty_transactions where order_id = o and type = 'redeem';
$$;

create or replace function pg_temp.cancel(o uuid) returns void language plpgsql as $$
begin
  perform pg_temp.as_admin();
  perform public.admin_set_order_status(o, 'cancelled');
end $$;

-- ============================================================================
-- CASE 1 -- positive control. A session's OWN reservation never blocks its own
-- attempt or its own finalize; the points are debited in full and released.
-- ============================================================================
do $$
declare c uuid := pg_temp.mk(1, 100); s public.checkout_sessions; o public.orders;
begin
  s := pg_temp.sess(c, 100);
  if (s.snapshot->>'loyalty_points_redeemed')::int is distinct from 100 then
    raise exception 'CASE 1: fixture session redeems %, expected 100', s.snapshot->>'loyalty_points_redeemed'; end if;
  if public.loyalty_points_reserved(c) is distinct from 100 then
    raise exception 'CASE 1: a live session reserves %, expected 100', public.loyalty_points_reserved(c); end if;
  if public.loyalty_points_reserved(c, s.id) is distinct from 0 then
    raise exception 'CASE 1: the excluded session still counted'; end if;
  if pg_temp.try_attempt(s.id) is distinct from 'ok' then
    raise exception 'CASE 1: own attempt refused: %', pg_temp.try_attempt(s.id); end if;
  -- A repeated initiate reuses the attempt and is not refused by its own hold.
  if pg_temp.try_attempt(s.id) is distinct from 'ok' then
    raise exception 'CASE 1: reusing the own attempt was refused'; end if;
  o := pg_temp.finalize(s.id, 'pay_lpr_1');
  if o.loyalty_points_redeemed is distinct from 100 or pg_temp.redeemed_in_ledger(o.id) is distinct from 100
     or pg_temp.bal(c) is distinct from 0 then
    raise exception 'CASE 1: finalize debited % (ledger %), balance %', o.loyalty_points_redeemed,
      pg_temp.redeemed_in_ledger(o.id), pg_temp.bal(c); end if;
  if o.loyalty_discount_amount is distinct from s.loyalty_discount_amount or o.total is distinct from s.total then
    raise exception 'CASE 1: order money differs from the session'; end if;
  if public.loyalty_points_reserved(c) is distinct from 0 then
    raise exception 'CASE 1: a consumed session still reserves points'; end if;
  if exists (select 1 from public.loyalty_redemption_shortfalls where order_id = o.id) then
    raise exception 'CASE 1: a shortfall was recorded for a fully covered order'; end if;
  raise notice 'CASE 1 ok -- a session''s own hold never blocks it; full debit, then released';
end $$;

-- ============================================================================
-- CASE 2 -- F-DBM-04-002 / F-DBM-18-001. A cash order cannot spend points an
-- open card checkout holds -- with or without an attempt -- and is refused with
-- the hinted P0001. Points beyond the hold remain spendable.
-- ============================================================================
do $$
declare c uuid := pg_temp.mk(2, 150); s public.checkout_sessions; r text; o public.orders; v jsonb;
begin
  s := pg_temp.sess(c, 100);
  -- No attempt yet: the session is inside its window, so it can still be paid.
  r := pg_temp.try_cash(c, 100);
  if r not like 'P0001:loyalty_points_reserved:Some of your loyalty points are held by a card payment that is still open.%' then
    raise exception 'CASE 2: cash order during an open session was not refused as reserved: %', r; end if;
  if pg_temp.try_attempt(s.id) is distinct from 'ok' then raise exception 'CASE 2: fixture attempt refused'; end if;
  r := pg_temp.try_cash(c, 100);
  if r not like 'P0001:loyalty_points_reserved:%' then
    raise exception 'CASE 2: cash order during an open attempt was not refused: %', r; end if;
  if pg_temp.bal(c) is distinct from 150 or exists (select 1 from public.orders where customer_id = c) then
    raise exception 'CASE 2: a refused cash order moved the balance or wrote a row'; end if;
  -- 150 held, 100 reserved: 50 is spendable.
  v := pg_temp.cash(c, 50);
  if (v->>'loyalty_discount_amount')::numeric is distinct from 5.00 or pg_temp.bal(c) is distinct from 100 then
    raise exception 'CASE 2: the unreserved 50 points were not spendable (% / %)', v->>'loyalty_discount_amount', pg_temp.bal(c); end if;
  o := pg_temp.finalize(s.id, 'pay_lpr_2');
  if o.loyalty_points_redeemed is distinct from 100 or pg_temp.bal(c) is distinct from 0 then
    raise exception 'CASE 2: card order debited %, balance %', o.loyalty_points_redeemed, pg_temp.bal(c); end if;
  raise notice 'CASE 2 ok -- a cash order is refused the points an open card checkout holds';
end $$;

-- ============================================================================
-- CASE 3 -- F-DBM-32-001. A session whose 30-minute window has ended but whose
-- attempt is still live keeps its hold: a second card attempt and a cash order
-- are both refused.
-- ============================================================================
do $$
declare c uuid := pg_temp.mk(3, 100); s1 public.checkout_sessions; s2 public.checkout_sessions; r text;
begin
  s1 := pg_temp.sess(c, 100);
  if pg_temp.try_attempt(s1.id) is distinct from 'ok' then raise exception 'CASE 3: fixture attempt refused'; end if;
  -- What 30 minutes and begin_checkout_session's sweep do.
  update public.checkout_sessions set expires_at = now() - interval '1 second', status = 'expired' where id = s1.id;
  if public.loyalty_points_reserved(c) is distinct from 100 then
    raise exception 'CASE 3: an expired session with a live attempt reserves %', public.loyalty_points_reserved(c); end if;
  s2 := pg_temp.sess(c, 100);
  r := pg_temp.try_attempt(s2.id);
  if r is distinct from 'P0001:Your loyalty points balance changed. Please rebuild your order.' then
    raise exception 'CASE 3: the second card attempt was not refused: %', r; end if;
  if exists (select 1 from public.payment_records where checkout_session_id = s2.id) then
    raise exception 'CASE 3: a refused attempt left a payment record'; end if;
  r := pg_temp.try_cash(c, 100);
  if r not like 'P0001:loyalty_points_reserved:%' then
    raise exception 'CASE 3: cash order was not refused: %', r; end if;
  raise notice 'CASE 3 ok -- the hold outlives the session window for as long as the attempt lives';
end $$;

-- ============================================================================
-- CASE 4 -- the hold ends when nothing can capture any more, and only then.
-- ============================================================================
do $$
declare c uuid := pg_temp.mk(4, 100); s public.checkout_sessions; v_att uuid; v jsonb;
begin
  s := pg_temp.sess(c, 100);
  perform public.begin_session_attempt(s.id, 'moyasar', 'test', 60);
  select id into v_att from public.payment_records where checkout_session_id = s.id;
  update public.checkout_sessions set expires_at = now() - interval '1 second', status = 'expired' where id = s.id;

  -- A stamped provider_ref is a captured payment whose finalize has not landed:
  -- still held after the attempt's own expiry.
  update public.payment_records set expires_at = now() - interval '1 second', provider_ref = 'pay_lpr_4' where id = v_att;
  if public.loyalty_points_reserved(c) is distinct from 100 then
    raise exception 'CASE 4: a stamped, expired attempt does not hold'; end if;
  -- Authorized at the provider: held.
  update public.payment_records set provider_ref = null, status = 'authorized' where id = v_att;
  if public.loyalty_points_reserved(c) is distinct from 100 then
    raise exception 'CASE 4: an authorized attempt does not hold'; end if;
  -- Initiated, unstamped and expired: released.
  update public.payment_records set status = 'initiated' where id = v_att;
  if public.loyalty_points_reserved(c) is distinct from 0 then
    raise exception 'CASE 4: an expired, unstamped attempt still holds'; end if;
  -- Failed: released, even inside the attempt window.
  update public.payment_records set status = 'failed', expires_at = now() + interval '30 minutes' where id = v_att;
  if public.loyalty_points_reserved(c) is distinct from 0 then
    raise exception 'CASE 4: a failed attempt holds'; end if;
  -- A live attempt on a CANCELLED session: finalize refuses it, so no hold.
  update public.payment_records set status = 'initiated' where id = v_att;
  update public.checkout_sessions set status = 'cancelled' where id = s.id;
  if public.loyalty_points_reserved(c) is distinct from 0 then
    raise exception 'CASE 4: a cancelled session holds'; end if;

  v := pg_temp.cash(c, 100);
  if (v->>'loyalty_discount_amount')::numeric is distinct from 10.00 or pg_temp.bal(c) is distinct from 0 then
    raise exception 'CASE 4: released points were not spendable'; end if;
  raise notice 'CASE 4 ok -- held while stamped or authorized; released when expired, failed or cancelled';
end $$;

-- ============================================================================
-- CASE 5 -- the points-covered (zero-total) checkout honours the hold, and is
-- unchanged when nothing is held.
-- ============================================================================
do $$
declare c uuid := pg_temp.mk(5, 800); d uuid := pg_temp.mk(6, 600);
        s public.checkout_sessions; z public.checkout_sessions; r text;
begin
  s := pg_temp.sess(c, 300);
  begin
    z := pg_temp.sess(c, 600);
    raise exception 'CASE 5: zero-total session spent held points (status %, balance %)', z.status, pg_temp.bal(c);
  exception when sqlstate 'P0001' then
    get stacked diagnostics r = pg_exception_hint;
    if r is distinct from 'loyalty_points_reserved' then
      raise exception 'CASE 5: refused for the wrong reason (hint %): %', r, sqlerrm; end if;
  end;
  if pg_temp.bal(c) is distinct from 800 then raise exception 'CASE 5: refused session moved the balance'; end if;

  z := pg_temp.sess(d, 600);
  if z.status is distinct from 'consumed' or z.total is distinct from 0.00 or pg_temp.bal(d) is distinct from 0
     or pg_temp.redeemed_in_ledger(z.order_id) is distinct from 600
     or (select loyalty_points_redeemed from public.orders where id = z.order_id) is distinct from 600 then
    raise exception 'CASE 5: an unheld zero-total checkout changed (status %, balance %)', z.status, pg_temp.bal(d); end if;
  raise notice 'CASE 5 ok -- a points-covered checkout cannot spend held points; unheld, unchanged';
end $$;

-- ============================================================================
-- CASE 6 -- residual race, PARTIAL. The live balance fell after the attempt
-- opened (an admin adjustment). The capture is not refused; the order records
-- the 30 points debited, the ledger agrees, the 70 missing are recorded, and the
-- discount and total stay as charged.
-- ============================================================================
do $$
declare c uuid := pg_temp.mk(7, 100); s public.checkout_sessions; o public.orders; f record;
begin
  s := pg_temp.sess(c, 100);
  perform public.begin_session_attempt(s.id, 'moyasar', 'test', 60);
  update public.profiles set loyalty_points = 30 where id = c;
  o := pg_temp.finalize(s.id, 'pay_lpr_6');
  if o.payment_status is distinct from 'paid' then raise exception 'CASE 6: the captured payment was refused'; end if;
  if o.loyalty_points_redeemed is distinct from 30 or pg_temp.redeemed_in_ledger(o.id) is distinct from 30
     or pg_temp.bal(c) is distinct from 0 then
    raise exception 'CASE 6: order % / ledger % / balance %', o.loyalty_points_redeemed, pg_temp.redeemed_in_ledger(o.id), pg_temp.bal(c); end if;
  if o.loyalty_discount_amount is distinct from s.loyalty_discount_amount or o.total is distinct from s.total then
    raise exception 'CASE 6: the charged money was rewritten'; end if;
  select * into f from public.loyalty_redemption_shortfalls where order_id = o.id;
  if not found or f.snapshot_points <> 100 or f.debited_points <> 30 or f.shortfall_points <> 70
     or f.balance_at_settlement is distinct from 30 or f.loyalty_discount_amount <> s.loyalty_discount_amount then
    raise exception 'CASE 6: shortfall row wrong: %', row_to_json(f); end if;
  perform pg_temp.cancel(o.id);
  if pg_temp.bal(c) is distinct from 30 then
    raise exception 'CASE 6: cancel restored to %, expected the 30 debited', pg_temp.bal(c); end if;
  raise notice 'CASE 6 ok -- a partial shortfall records what was debited and cancels back exactly that';
end $$;

-- ============================================================================
-- CASE 7 -- the shortfall record is admin-only and append-only.
-- ============================================================================
do $$
declare v_id uuid; v_state text;
begin
  select id into v_id from public.loyalty_redemption_shortfalls limit 1;
  begin
    update public.loyalty_redemption_shortfalls set shortfall_points = shortfall_points where id = v_id;
    raise exception 'CASE 7: a shortfall row was updated';
  exception when sqlstate '42501' then null;
  end;
  begin
    delete from public.loyalty_redemption_shortfalls where id = v_id;
    raise exception 'CASE 7: a shortfall row was deleted';
  exception when sqlstate '42501' then null;
  end;
  if has_table_privilege('anon', 'public.loyalty_redemption_shortfalls', 'select')
     or has_table_privilege('authenticated', 'public.loyalty_redemption_shortfalls', 'insert') then
    raise exception 'CASE 7: client privileges too wide'; end if;
  raise notice 'CASE 7 ok -- the shortfall record is append-only and closed to client writes';
end $$;

-- An admin reads it through the policy; a customer does not.
set local role authenticated;
select set_config('test.auth_uid', '0f190000-0000-0000-0000-000000000007', true),
       set_config('test.is_admin', 'false', true), set_config('test.is_staff', 'false', true);
do $$ begin
  if (select count(*) from public.loyalty_redemption_shortfalls) <> 0 then
    raise exception 'CASE 7: a customer can read shortfall rows'; end if;
end $$;
select set_config('test.auth_uid', '0f190000-0000-0000-0000-0000000ad001', true),
       set_config('test.is_admin', 'true', true);
do $$ begin
  if (select count(*) from public.loyalty_redemption_shortfalls) < 1 then
    raise exception 'CASE 7: an admin cannot read shortfall rows'; end if;
end $$;
reset role;

-- ============================================================================
-- CASE 8 -- F-DBM-27-001. A FULL shortfall: no point was debited, the order
-- records 0, no redeem row exists, and cancelling credits nothing.
-- ============================================================================
do $$
declare c uuid := pg_temp.mk(8, 100); s public.checkout_sessions; o public.orders;
begin
  s := pg_temp.sess(c, 100);
  perform public.begin_session_attempt(s.id, 'moyasar', 'test', 60);
  update public.profiles set loyalty_points = 0 where id = c;
  o := pg_temp.finalize(s.id, 'pay_lpr_8');
  if o.loyalty_points_redeemed is distinct from 0 then
    raise exception 'CASE 8: order still records % redeemed with nothing debited', o.loyalty_points_redeemed; end if;
  if exists (select 1 from public.loyalty_transactions where order_id = o.id and type = 'redeem') then
    raise exception 'CASE 8: a redeem row was written for nothing'; end if;
  if (select shortfall_points from public.loyalty_redemption_shortfalls where order_id = o.id) is distinct from 100 then
    raise exception 'CASE 8: full shortfall not recorded'; end if;
  perform pg_temp.cancel(o.id);
  if pg_temp.bal(c) is distinct from 0 then
    raise exception 'CASE 8: cancelling MINTED % points', pg_temp.bal(c); end if;
  if exists (select 1 from public.loyalty_transactions where order_id = o.id and type = 'adjustment' and points > 0) then
    raise exception 'CASE 8: a positive adjustment was written on cancel'; end if;
  raise notice 'CASE 8 ok -- a card order whose points were never taken refunds none on cancel';
end $$;

-- ============================================================================
-- CASE 9 -- cancellation refunds what the LEDGER took, net of an earlier
-- refund, and never the order column.
-- ============================================================================
do $$
declare c uuid := pg_temp.mk(9, 300); o1 uuid; o2 uuid;
begin
  o1 := (pg_temp.cash(c, 100)->>'id')::uuid;
  o2 := (pg_temp.cash(c, 100)->>'id')::uuid;
  if pg_temp.bal(c) is distinct from 100 then raise exception 'CASE 9: fixture balance %', pg_temp.bal(c); end if;
  -- A row whose column disagrees with its ledger (the shape F-DBM-27-001 left
  -- behind). The ledger decides.
  update public.orders set loyalty_points_redeemed = 500 where id = o1;
  perform pg_temp.cancel(o1);
  if pg_temp.bal(c) is distinct from 200 then
    raise exception 'CASE 9: refunded from the column (balance %, expected 200)', pg_temp.bal(c); end if;
  -- An earlier redemption refund for o2 is netted off.
  insert into public.loyalty_transactions (profile_id, order_id, type, points, balance_after, reason, created_by)
  values (c, o2, 'adjustment', 40, 240, 'Cancelled order redemption refund: restored=40', null);
  update public.profiles set loyalty_points = 240 where id = c;
  perform pg_temp.cancel(o2);
  if pg_temp.bal(c) is distinct from 300 then
    raise exception 'CASE 9: netting wrong (balance %, expected 300)', pg_temp.bal(c); end if;
  if (select points from public.loyalty_transactions where order_id = o2 and type = 'adjustment'
        and reason = 'Cancelled order redemption refund: restored=60') is distinct from 60 then
    raise exception 'CASE 9: the netted refund row is not 60'; end if;
  -- A repeated cancel is a no-op.
  perform pg_temp.cancel(o2);
  if pg_temp.bal(c) is distinct from 300 then raise exception 'CASE 9: a repeated cancel moved points'; end if;
  raise notice 'CASE 9 ok -- the redemption refund comes from the ledger, netted, idempotent';
end $$;

-- ============================================================================
-- CASE 10 -- unchanged without a hold: cash redemption clamps to the balance,
-- and the minimum still zeroes a small redemption -- which is then not refused
-- even while points are held, because nothing is redeemed. (Pickup-only,
-- exclusion, multipliers and comp members are pinned by their own suites, run
-- unchanged against this migration.)
-- ============================================================================
do $$
declare c uuid := pg_temp.mk(10, 50); d uuid := pg_temp.mk(11, 100); v jsonb; s public.checkout_sessions;
begin
  -- Ask for more than held, nothing reserved: clamped, as before.
  v := pg_temp.cash(c, 500);
  if (v->>'loyalty_discount_amount')::numeric is distinct from 5.00 or pg_temp.bal(c) is distinct from 0 then
    raise exception 'CASE 10: the plain clamp changed (% / %)', v->>'loyalty_discount_amount', pg_temp.bal(c); end if;

  s := pg_temp.sess(d, 100);
  update public.app_settings set min_points_to_redeem = 200 where id = true;
  v := pg_temp.cash(d, 100);
  if (v->>'loyalty_discount_amount')::numeric is distinct from 0.00 then
    raise exception 'CASE 10: below-minimum redemption was not zeroed'; end if;
  update public.app_settings set min_points_to_redeem = 0 where id = true;
  if pg_temp.bal(d) is distinct from 100 then raise exception 'CASE 10: balance moved to %', pg_temp.bal(d); end if;
  raise notice 'CASE 10 ok -- clamp and minimum behave as before';
end $$;

rollback;
