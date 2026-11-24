-- ============================================================================
-- A cash retry is answered only for the inputs its order was placed with, and a
-- card retry waits for a payment that can still be made
-- (migration 20261024120000_cash_order_input_match_expired_session_lookup.sql,
-- audit findings F-D1-001 and F-D1-003).
--
-- Before that file:
--   * place_order returned the order holding (customer, idempotency_key) without
--     comparing anything the call asked for, so a retry that changed the order
--     type, branch, address, coupon, notes or points was told "done" for the old
--     order (F-D1-001);
--   * begin_checkout_session skipped an EXPIRED session whose payment attempt
--     was still open, so the same key and inputs opened a second session and a
--     second payable invoice (F-D1-003).
-- Every refusal case below fails against the pre-fix bodies.
--
-- Runs on a disposable clone with the full migration chain (.github/sql-ci).
-- Callers are impersonated as `authenticated` with request.jwt.claim.sub; the
-- attempt step runs as `service_role`, the way payment-initiate calls it. Each
-- case RAISES on failure; everything rolls back.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

update public.app_settings
   set online_payment_enabled = true, cash_payment_enabled = true,
       loyalty_enabled = true, loyalty_pickup_only = true,
       min_points_to_redeem = 100, discount_per_point = 0.10,
       order_limit_open = 100, order_limit_per_hour = 100
 where id = true;

insert into auth.users (id, email) values
  ('0f100000-0000-0000-0000-000000000001', 'cash-a@example.com'),
  ('0f100000-0000-0000-0000-000000000002', 'cash-b@example.com')
  on conflict (id) do nothing;
insert into public.profiles (id, role, full_name, loyalty_points, phone_verified) values
  ('0f100000-0000-0000-0000-000000000001', 'customer', 'CASH A', 1000, true),
  ('0f100000-0000-0000-0000-000000000002', 'customer', 'CASH B', 1000, true)
  on conflict (id) do update set role = excluded.role, loyalty_points = excluded.loyalty_points,
                                 phone_verified = excluded.phone_verified;

insert into public.branch_delivery_zones (branch_id, name, zone_geojson, zone_polygon, is_active)
values ('b0000000-0000-0000-0000-000000000001', 'cash sim box',
  '{"type":"MultiPolygon","coordinates":[[[[46.6,24.6],[46.8,24.6],[46.8,24.8],[46.6,24.8],[46.6,24.6]]]]}'::jsonb,
  extensions.ST_GeomFromText('MULTIPOLYGON(((46.6 24.6, 46.8 24.6, 46.8 24.8, 46.6 24.8, 46.6 24.6)))', 4326), true);
insert into public.addresses (id, customer_id, label, latitude, longitude, description) values
  ('0f100000-0000-0000-0000-0000000ad001', '0f100000-0000-0000-0000-000000000001', 'Home', 24.7136, 46.6753, 'Second floor, blue door'),
  ('0f100000-0000-0000-0000-0000000ad002', '0f100000-0000-0000-0000-000000000001', 'Work', 24.7000, 46.7000, 'Tower lobby, ask the guard');

create or replace function pg_temp.cart(p_qty int default 2) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('product_id', 'a0000000-0000-0000-0000-000000000001', 'quantity', p_qty));
$$;

-- place_customer_order as a customer, answering 'ok:<order id>' or '<sqlstate>:<message>'.
create or replace function pg_temp.pco(
  p_uid uuid, p_key uuid, p_branch uuid, p_type public.order_type, p_items jsonb,
  p_addr uuid default null, p_coupon text default null, p_notes text default null, p_points int default 0
) returns text language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
  v := public.place_customer_order(p_branch, p_type, p_items, p_addr, p_coupon, p_notes, p_points, p_key, 'cash');
  reset role;
  return 'ok:' || (v ->> 'id');
exception when others then
  reset role;
  return sqlstate || ':' || sqlerrm;
end $$;

create or replace function pg_temp.orders_for(p_uid uuid, p_key uuid) returns int language sql as $$
  select count(*)::int from public.orders where customer_id = p_uid and idempotency_key = p_key;
$$;
create or replace function pg_temp.fps_for(p_uid uuid, p_key uuid) returns int language sql as $$
  select count(*)::int from public.order_input_fingerprints f
    join public.orders o on o.id = f.order_id
   where o.customer_id = p_uid and o.idempotency_key = p_key;
$$;
create or replace function pg_temp.points(p_uid uuid) returns int language sql as $$
  select loyalty_points from public.profiles where id = p_uid;
$$;

-- ---------------------------------------------------------------------------
-- CASE 1: F-D1-001. A genuine retry - same key, same inputs - returns the SAME
--         order: one order, one fingerprint, one redemption of points.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f100000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid(); r1 text; r2 text; p0 int; p1 int; n_redeem int;
begin
  p0 := pg_temp.points(a);
  r1 := pg_temp.pco(a, k, b1, 'pickup', pg_temp.cart(), null, null, 'ring bell', 300);
  p1 := pg_temp.points(a);
  r2 := pg_temp.pco(a, k, b1, 'pickup', pg_temp.cart(), null, null, 'ring bell', 300);
  if r1 not like 'ok:%' then raise exception 'CASE 1 FAILED: first call: %', r1; end if;
  if r2 is distinct from r1 then raise exception 'CASE 1 FAILED: identical retry answered % instead of %', r2, r1; end if;
  if pg_temp.orders_for(a, k) is distinct from 1 then raise exception 'CASE 1 FAILED: % orders', pg_temp.orders_for(a, k); end if;
  if pg_temp.fps_for(a, k) is distinct from 1 then raise exception 'CASE 1 FAILED: % fingerprints', pg_temp.fps_for(a, k); end if;
  if p1 is distinct from p0 - 300 then raise exception 'CASE 1 FAILED: redemption took % points, expected 300', p0 - p1; end if;
  if pg_temp.points(a) is distinct from p1 then raise exception 'CASE 1 FAILED: the retry redeemed again'; end if;
  select count(*) into n_redeem from public.loyalty_transactions
   where order_id = substr(r1, 4)::uuid and type = 'redeem';
  if n_redeem is distinct from 1 then raise exception 'CASE 1 FAILED: % redeem rows', n_redeem; end if;
  raise notice 'CASE 1 ok: identical retry replays %, one redemption', substr(r1, 4);
end $$;

-- ---------------------------------------------------------------------------
-- CASE 2: F-D1-001. Each input on its own, changed under the same key, is
--         REFUSED with the card path's sentence. Nothing is written: still one
--         order, the points unmoved, and no new ledger row.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f100000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  b2 uuid := 'b0000000-0000-0000-0000-000000000002';
  ad1 uuid := '0f100000-0000-0000-0000-0000000ad001';
  ad2 uuid := '0f100000-0000-0000-0000-0000000ad002';
  k uuid := gen_random_uuid(); r1 text; res text; p_before int; l_before int; l_after int;
  r record;
begin
  -- The first order is a DELIVERY order with an address, a coupon-free cart,
  -- notes and points on a delivery order (which loyalty ignores, so the points
  -- input is varied on its own in case 3).
  r1 := pg_temp.pco(a, k, b1, 'delivery', pg_temp.cart(), ad1, null, 'ring bell', 0);
  if r1 not like 'ok:%' then raise exception 'CASE 2 FAILED: first call: %', r1; end if;
  p_before := pg_temp.points(a);
  select count(*) into l_before from public.loyalty_transactions where profile_id = a;

  for r in select * from (values
      ('order type',  'pickup'::public.order_type, b1, pg_temp.cart(),  ad1,          null::text, 'ring bell'),
      ('branch',      'delivery'::public.order_type, b2, pg_temp.cart(), ad1,         null,       'ring bell'),
      ('address',     'delivery'::public.order_type, b1, pg_temp.cart(), ad2,         null,       'ring bell'),
      ('coupon',      'delivery'::public.order_type, b1, pg_temp.cart(), ad1,         'SEEDFIX10','ring bell'),
      ('notes',       'delivery'::public.order_type, b1, pg_temp.cart(), ad1,         null,       'leave at door'),
      ('notes erased','delivery'::public.order_type, b1, pg_temp.cart(), ad1,         null,       null),
      ('items',       'delivery'::public.order_type, b1, pg_temp.cart(3), ad1,        null,       'ring bell')
    ) as t(label, ty, br, items, addr, coupon, notes)
  loop
    res := pg_temp.pco(a, k, r.br, r.ty, r.items, r.addr, r.coupon, r.notes, 0);
    if res is distinct from 'P0001:checkout_session_mismatch: order_placed' then
      raise exception 'CASE 2 FAILED (%): expected the order_placed refusal, got %', r.label, res;
    end if;
  end loop;

  if pg_temp.orders_for(a, k) is distinct from 1 then raise exception 'CASE 2 FAILED: % orders', pg_temp.orders_for(a, k); end if;
  if pg_temp.points(a) is distinct from p_before then raise exception 'CASE 2 FAILED: points moved'; end if;
  select count(*) into l_after from public.loyalty_transactions where profile_id = a;
  if l_after is distinct from l_before then raise exception 'CASE 2 FAILED: ledger moved (% -> %)', l_before, l_after; end if;
  -- The original inputs still replay the original order.
  res := pg_temp.pco(a, k, b1, 'delivery', pg_temp.cart(), ad1, null, 'ring bell', 0);
  if res is distinct from r1 then raise exception 'CASE 2 FAILED: the original inputs no longer replay (%)', res; end if;
  raise notice 'CASE 2 ok: seven changed inputs refused, original replayed';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 3: F-D1-001. Points on their own: an order placed with 300 points, the
--         retry asking for 0, 500 and none-at-all, is refused every time and
--         the balance stays where the first order left it.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f100000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid(); r1 text; res text; p1 int; p int;
begin
  r1 := pg_temp.pco(a, k, b1, 'pickup', pg_temp.cart(), null, null, null, 300);
  if r1 not like 'ok:%' then raise exception 'CASE 3 FAILED: first call: %', r1; end if;
  p1 := pg_temp.points(a);
  foreach p in array array[0, 500, 299, 301] loop
    res := pg_temp.pco(a, k, b1, 'pickup', pg_temp.cart(), null, null, null, p);
    if res is distinct from 'P0001:checkout_session_mismatch: order_placed' then
      raise exception 'CASE 3 FAILED (points %): got %', p, res;
    end if;
  end loop;
  -- Negative points are normalised to 0 exactly as place_order reads them, so a
  -- fingerprint of -5 equals a fingerprint of 0: a retry of a 0-point order that
  -- sends -5 is the SAME input and replays.
  declare k2 uuid := gen_random_uuid(); ra text;
  begin
    ra := pg_temp.pco(a, k2, b1, 'pickup', pg_temp.cart(), null, null, null, 0);
    res := pg_temp.pco(a, k2, b1, 'pickup', pg_temp.cart(), null, null, null, -5);
    if res is distinct from ra then raise exception 'CASE 3 FAILED: -5 points did not match 0 (%)', res; end if;
  end;
  raise notice 'CASE 3 ok: four different point choices refused, negative points normalised';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 4: an order with NO fingerprint (placed before the migration) is still
--         replayed, whatever the retry asks for, and is never stamped by the
--         replay: pinning it to inputs it was not placed with would be wrong.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f100000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid(); r1 text; res text;
begin
  r1 := pg_temp.pco(a, k, b1, 'pickup', pg_temp.cart(), null, null, null, 0);
  if r1 not like 'ok:%' then raise exception 'CASE 4 FAILED: first call: %', r1; end if;
  delete from public.order_input_fingerprints where order_id = substr(r1, 4)::uuid;
  res := pg_temp.pco(a, k, b1, 'pickup', pg_temp.cart(), null, null, 'a different note', 0);
  if res is distinct from r1 then raise exception 'CASE 4 FAILED: a legacy order was not replayed (%)', res; end if;
  if pg_temp.fps_for(a, k) is distinct from 0 then raise exception 'CASE 4 FAILED: the replay stamped a legacy order'; end if;
  if pg_temp.orders_for(a, k) is distinct from 1 then raise exception 'CASE 4 FAILED: a second order appeared'; end if;
  raise notice 'CASE 4 ok: legacy order replayed and left unstamped';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 5: no key, no fingerprint, no replay - two calls, two orders. Another
--         customer holding the same key is unaffected. The table is closed.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f100000-0000-0000-0000-000000000001';
  bb uuid := '0f100000-0000-0000-0000-000000000002';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid(); r1 text; r2 text; n0 int; n1 int; v_state text;
begin
  select count(*) into n0 from public.order_input_fingerprints;
  r1 := pg_temp.pco(a, null, b1, 'pickup', pg_temp.cart(), null, null, null, 0);
  r2 := pg_temp.pco(a, null, b1, 'pickup', pg_temp.cart(), null, null, null, 0);
  if r1 not like 'ok:%' or r2 not like 'ok:%' or r1 = r2 then raise exception 'CASE 5 FAILED: keyless calls % / %', r1, r2; end if;
  select count(*) into n1 from public.order_input_fingerprints;
  if n1 is distinct from n0 then raise exception 'CASE 5 FAILED: a keyless order was stamped'; end if;

  r1 := pg_temp.pco(a, k, b1, 'pickup', pg_temp.cart(), null, null, null, 0);
  r2 := pg_temp.pco(bb, k, b1, 'pickup', pg_temp.cart(3), null, null, null, 0);
  if r1 not like 'ok:%' or r2 not like 'ok:%' or r1 = r2 then
    raise exception 'CASE 5 FAILED: the same key for two customers: % / %', r1, r2;
  end if;

  -- Deleting an order takes its fingerprint with it.
  perform set_config('request.jwt.claim.sub', '', true);
  delete from public.orders where id = substr(r1, 4)::uuid;
  if exists (select 1 from public.order_input_fingerprints where order_id = substr(r1, 4)::uuid) then
    raise exception 'CASE 5 FAILED: a deleted order left its fingerprint behind';
  end if;

  -- Closed to every client role, read AND write.
  foreach v_state in array array['anon', 'authenticated'] loop
    execute format('set local role %I', v_state);
    begin
      perform 1 from public.order_input_fingerprints limit 1;
      reset role;
      raise exception 'CASE 5 FAILED: % can read order_input_fingerprints', v_state;
    exception when insufficient_privilege then
      reset role;
    end;
  end loop;
  if has_function_privilege('authenticated', 'public.checkout_input_fingerprint(uuid, public.order_type, jsonb, uuid, text, text, integer)', 'execute') then
    raise exception 'CASE 5 FAILED: authenticated can execute checkout_input_fingerprint';
  end if;
  raise notice 'CASE 5 ok: keyless calls unstamped, keys per customer, table closed';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 6: the shared fingerprint. A card session and a cash order built from the
--         same inputs carry the SAME fingerprint, so the two paths cannot drift.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f100000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); r1 text; s public.checkout_sessions; v_fp text;
begin
  r1 := pg_temp.pco(a, k1, b1, 'pickup', pg_temp.cart(), null, null, 'same inputs', 0);
  select f.fingerprint into v_fp from public.order_input_fingerprints f where f.order_id = substr(r1, 4)::uuid;
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  s := public.begin_checkout_session(b1, 'pickup', pg_temp.cart(), null, null, 'same inputs', 0, k2);
  reset role;
  if v_fp is null or s.input_fingerprint is distinct from v_fp then
    raise exception 'CASE 6 FAILED: cash % vs card %', v_fp, s.input_fingerprint;
  end if;
  raise notice 'CASE 6 ok: cash and card share one fingerprint';
end $$;

-- ===========================================================================
-- F-D1-003: begin_checkout_session and an expired session with an open attempt
-- ===========================================================================
create or replace function pg_temp.b(
  p_uid uuid, p_key uuid, p_branch uuid, p_type public.order_type, p_items jsonb,
  p_addr uuid default null, p_coupon text default null, p_notes text default null, p_points int default 0
) returns public.checkout_sessions language plpgsql as $$
declare v public.checkout_sessions;
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
  v := public.begin_checkout_session(p_branch, p_type, p_items, p_addr, p_coupon, p_notes, p_points, p_key);
  reset role;
  return v;
exception when others then
  reset role;
  raise;
end $$;

create or replace function pg_temp.try_b(
  p_uid uuid, p_key uuid, p_branch uuid, p_type public.order_type, p_items jsonb,
  p_addr uuid default null, p_coupon text default null, p_notes text default null, p_points int default 0
) returns text language plpgsql as $$
declare v public.checkout_sessions;
begin
  v := pg_temp.b(p_uid, p_key, p_branch, p_type, p_items, p_addr, p_coupon, p_notes, p_points);
  return 'ok:' || v.id;
exception when others then
  return sqlstate || ':' || sqlerrm;
end $$;

create or replace function pg_temp.attempt(p_session uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  set local role service_role;
  select attempt_id into v from public.begin_session_attempt(p_session, 'moyasar', 'live', 30);
  reset role;
  return v;
exception when others then
  reset role;
  raise;
end $$;

create or replace function pg_temp.sessions_for(p_uid uuid, p_key uuid) returns int language sql as $$
  select count(*)::int from public.checkout_sessions where customer_id = p_uid and idempotency_key = p_key;
$$;
create or replace function pg_temp.status_of(p_session uuid) returns text language sql as $$
  select status from public.checkout_sessions where id = p_session;
$$;
-- The session window ran out; the attempt's own window did not.
create or replace function pg_temp.lapse_session(p_session uuid) returns void language sql as $$
  update public.checkout_sessions set expires_at = now() - interval '1 minute' where id = p_session;
$$;

-- ---------------------------------------------------------------------------
-- CASE 7: F-D1-003. The session window has lapsed, its attempt has not: the
--         SAME inputs under the SAME key are refused (payment_open) instead of
--         opening a second session and a second invoice. One session, still
--         the first, never cancelled, and the refusal is repeatable.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f100000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid(); s public.checkout_sessions; v_att uuid; v_res text;
begin
  s := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart());
  v_att := pg_temp.attempt(s.id);
  update public.payment_records set provider_checkout_ref = 'inv_sim_7' where id = v_att;
  perform pg_temp.lapse_session(s.id);

  v_res := pg_temp.try_b(a, k, b1, 'pickup', pg_temp.cart());
  if v_res is distinct from 'P0001:checkout_session_mismatch: payment_open' then
    raise exception 'CASE 7 FAILED: same inputs on an expired session with a live attempt gave %', v_res;
  end if;
  if pg_temp.sessions_for(a, k) is distinct from 1 then
    raise exception 'CASE 7 FAILED: a second session was opened (% for the key)', pg_temp.sessions_for(a, k);
  end if;
  -- The refusal rolls the call back, sweep included, so the row may still read
  -- pending_payment with a lapsed window; what matters is that it is untouched
  -- and never cancelled (finalize_checkout_session refuses a cancelled session).
  if pg_temp.status_of(s.id) not in ('pending_payment', 'expired') then
    raise exception 'CASE 7 FAILED: the session is %', pg_temp.status_of(s.id);
  end if;
  v_res := pg_temp.try_b(a, k, b1, 'pickup', pg_temp.cart());
  if v_res is distinct from 'P0001:checkout_session_mismatch: payment_open' or pg_temp.sessions_for(a, k) is distinct from 1 then
    raise exception 'CASE 7 FAILED: the second retry gave % / % sessions', v_res, pg_temp.sessions_for(a, k);
  end if;
  raise notice 'CASE 7 ok: same inputs on an expired session with an open invoice wait, one session';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 8: F-D1-003. DIFFERENT inputs hit the existing payment_open refusal too -
--         the old "dead attempt" rule is now applied to the expired session.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f100000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid(); s public.checkout_sessions; v_att uuid; v_res text;
begin
  s := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart());
  v_att := pg_temp.attempt(s.id);
  perform pg_temp.lapse_session(s.id);
  v_res := pg_temp.try_b(a, k, b1, 'pickup', pg_temp.cart(), null, null, 'a different note');
  if v_res is distinct from 'P0001:checkout_session_mismatch: payment_open' then
    raise exception 'CASE 8 FAILED: different inputs gave %', v_res;
  end if;
  if pg_temp.sessions_for(a, k) is distinct from 1 then raise exception 'CASE 8 FAILED: a second session was opened'; end if;
  raise notice 'CASE 8 ok: different inputs refused as well';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 9: F-D1-003. An 'authorized' attempt holds the key whatever its window.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f100000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid(); s public.checkout_sessions; v_att uuid; v_res text;
begin
  s := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart());
  v_att := pg_temp.attempt(s.id);
  update public.payment_records
     set status = 'authorized', provider_checkout_ref = 'inv_sim_9', provider_ref = 'pay_sim_9',
         expires_at = now() - interval '5 minutes'
   where id = v_att;
  perform pg_temp.lapse_session(s.id);
  v_res := pg_temp.try_b(a, k, b1, 'pickup', pg_temp.cart());
  if v_res is distinct from 'P0001:checkout_session_mismatch: payment_open' or pg_temp.sessions_for(a, k) is distinct from 1 then
    raise exception 'CASE 9 FAILED: an authorized attempt did not hold the key (%)', v_res;
  end if;
  raise notice 'CASE 9 ok: authorized attempt holds the key';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 10: what must NOT change. Nothing that can still be paid, nothing held:
--          (a) the attempt's own window has lapsed, (b) the invoice was
--          cancelled, (c) no attempt at all, (d) a failed attempt with a charge
--          reference (late settlement is outside this lookup, by design).
--          Each lets the same inputs open a fresh session, exactly as before.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f100000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k uuid; s public.checkout_sessions; s2 public.checkout_sessions; v_att uuid; r record;
begin
  for r in select * from (values
      ('attempt window lapsed', 'initiated', null::text,        'inv_sim_10a', null::text, true),
      ('invoice cancelled',     'failed',    'invoice_canceled', 'inv_sim_10b', null,       false),
      ('no attempt',            null,        null,               null,          null,       false),
      ('failed with charge ref','failed',    'declined',         null,          'pay_sim_10d', false)
    ) as t(label, st, fc, cref, pref, lapse_attempt)
  loop
    k := gen_random_uuid();
    s := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart());
    if r.st is not null then
      v_att := pg_temp.attempt(s.id);
      update public.payment_records
         set status = r.st, failure_code = r.fc, provider_checkout_ref = r.cref, provider_ref = r.pref,
             expires_at = case when r.lapse_attempt then now() - interval '1 minute' else expires_at end
       where id = v_att;
    end if;
    perform pg_temp.lapse_session(s.id);
    s2 := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart());
    if s2.id = s.id or pg_temp.status_of(s2.id) is distinct from 'pending_payment'
       or pg_temp.sessions_for(a, k) is distinct from 2 then
      raise exception 'CASE 10 FAILED (%): the retry did not open a fresh session', r.label;
    end if;
  end loop;
  raise notice 'CASE 10 ok: lapsed, cancelled, absent and failed attempts hold nothing';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 11: a LIVE pending session is still reused for the same inputs (the
--          ordinary double-tap), attempt open or not: the behaviour
--          20261020120000 established is intact.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f100000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid(); s public.checkout_sessions; s2 public.checkout_sessions; v_att uuid;
begin
  s := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart());
  v_att := pg_temp.attempt(s.id);
  s2 := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart());
  if s2.id is distinct from s.id or pg_temp.status_of(s.id) is distinct from 'pending_payment' then
    raise exception 'CASE 11 FAILED: a live session was not reused';
  end if;
  raise notice 'CASE 11 ok: live session reused';
end $$;

rollback;
