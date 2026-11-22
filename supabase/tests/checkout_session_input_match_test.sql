-- ============================================================================
-- begin_checkout_session reuses a session only for the inputs it was priced on
-- (migration 20261020120000_checkout_session_input_match.sql, audit F-X02-001).
--
-- Before that file, the retry lookup returned any live or settled session for
-- the same customer and idempotency key, whatever the call asked for: a
-- customer who changed order type, branch, address, coupon, points or notes
-- under the same key was invoiced the OLD total and got the OLD order. Every
-- case below fails against the pre-fix body.
--
-- Runs on a disposable clone with the full migration chain (.github/sql-ci).
-- Callers are impersonated as `authenticated` with request.jwt.claim.sub; the
-- attempt and finalize steps run as `service_role`, the way payment-initiate
-- and payment-verify call them. Each case RAISES on failure; everything rolls
-- back.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

update public.app_settings
   set online_payment_enabled = true, loyalty_enabled = true, loyalty_pickup_only = true,
       min_points_to_redeem = 100, discount_per_point = 0.10
 where id = true;

insert into auth.users (id, email) values
  ('0f000000-0000-0000-0000-000000000001', 'sim-a@example.com'),
  ('0f000000-0000-0000-0000-000000000002', 'sim-b@example.com')
  on conflict (id) do nothing;
insert into public.profiles (id, role, full_name, loyalty_points, phone_verified) values
  ('0f000000-0000-0000-0000-000000000001', 'customer', 'SIM A', 1000, true),
  ('0f000000-0000-0000-0000-000000000002', 'customer', 'SIM B', 1000, true)
  on conflict (id) do update set role = excluded.role, loyalty_points = excluded.loyalty_points,
                                 phone_verified = excluded.phone_verified;

insert into public.branch_delivery_zones (branch_id, name, zone_geojson, zone_polygon, is_active)
values ('b0000000-0000-0000-0000-000000000001', 'sim box',
  '{"type":"MultiPolygon","coordinates":[[[[46.6,24.6],[46.8,24.6],[46.8,24.8],[46.6,24.8],[46.6,24.6]]]]}'::jsonb,
  extensions.ST_GeomFromText('MULTIPOLYGON(((46.6 24.6, 46.8 24.6, 46.8 24.8, 46.6 24.8, 46.6 24.6)))', 4326), true);
insert into public.addresses (id, customer_id, label, latitude, longitude, description) values
  ('0f000000-0000-0000-0000-0000000ad001', '0f000000-0000-0000-0000-000000000001', 'Home', 24.7136, 46.6753, 'Second floor, blue door'),
  ('0f000000-0000-0000-0000-0000000ad002', '0f000000-0000-0000-0000-000000000001', 'Work', 24.7000, 46.7000, 'Tower lobby, ask the guard');

-- The cart: 2 x seed product 1 (32.00).
create or replace function pg_temp.cart(p_qty int default 2) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('product_id', 'a0000000-0000-0000-0000-000000000001', 'quantity', p_qty));
$$;

-- begin_checkout_session as a customer. Returns the row.
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

-- The same call, answering 'ok:<id>' or '<sqlstate>:<message>'.
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

-- Open an attempt the way payment-initiate does.
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

create or replace function pg_temp.status_of(p_session uuid) returns text language sql as $$
  select status from public.checkout_sessions where id = p_session;
$$;

create or replace function pg_temp.pending_for(p_uid uuid, p_key uuid) returns int language sql as $$
  select count(*)::int from public.checkout_sessions
   where customer_id = p_uid and idempotency_key = p_key and status = 'pending_payment';
$$;

-- ---------------------------------------------------------------------------
-- CASE 1: the same inputs under the same key still return the same session
--         (retry safety is kept), and the fingerprint is stored.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid();
  s1 public.checkout_sessions; s2 public.checkout_sessions;
begin
  s1 := pg_temp.b(a, k, 'b0000000-0000-0000-0000-000000000001', 'pickup', pg_temp.cart(), null, null, 'ring bell', 0);
  s2 := pg_temp.b(a, k, 'b0000000-0000-0000-0000-000000000001', 'pickup', pg_temp.cart(), null, null, 'ring bell', 0);
  if s1.id is distinct from s2.id then raise exception 'CASE 1 FAILED: an identical retry made a second session'; end if;
  if s1.input_fingerprint is null or length(s1.input_fingerprint) <> 64 then
    raise exception 'CASE 1 FAILED: fingerprint not stored (%)', s1.input_fingerprint;
  end if;
  if pg_temp.pending_for(a, k) is distinct from 1 then raise exception 'CASE 1 FAILED: % pending sessions', pg_temp.pending_for(a, k); end if;
  raise notice 'CASE 1 ok: identical retry reuses %', s1.id;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 2: each input on its own, changed under the same key, with no payment
--         attempt: the old session is retired to 'expired' and a NEW session
--         priced from the new inputs is returned. Pre-fix, every one of these
--         returned the old session.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f000000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  b2 uuid := 'b0000000-0000-0000-0000-000000000002';
  ad1 uuid := '0f000000-0000-0000-0000-0000000ad001';
  ad2 uuid := '0f000000-0000-0000-0000-0000000ad002';
  k uuid; old public.checkout_sessions; new public.checkout_sessions;
  r record;
begin
  for r in select * from (values
      -- label,        base type,  base addr, new branch, new type,  new addr, coupon,      notes,       points, qty
      ('order type',   'pickup',   null::uuid, b1,        'delivery', ad1,      null::text,  null::text,  0,      2),
      ('branch',       'pickup',   null,       b2,        'pickup',   null,     null,        null,        0,      2),
      ('address',      'delivery', ad1,        b1,        'delivery', ad2,      null,        null,        0,      2),
      ('coupon',       'pickup',   null,       b1,        'pickup',   null,     'SEEDFIX10', null,        0,      2),
      ('points',       'pickup',   null,       b1,        'pickup',   null,     null,        null,        300,    2),
      ('notes',        'pickup',   null,       b1,        'pickup',   null,     null,        'no onions', 0,      2),
      ('items',        'pickup',   null,       b1,        'pickup',   null,     null,        null,        0,      3)
    ) as t(label, base_type, base_addr, nb, nt, na, nc, nn, np, nq)
  loop
    k := gen_random_uuid();
    old := pg_temp.b(a, k, b1, r.base_type::public.order_type, pg_temp.cart(2), r.base_addr);
    new := pg_temp.b(a, k, r.nb, r.nt::public.order_type, pg_temp.cart(r.nq), r.na, r.nc, r.nn, r.np);
    if new.id is not distinct from old.id then
      raise exception 'CASE 2 FAILED (%): the old session was returned for changed inputs', r.label;
    end if;
    if pg_temp.status_of(old.id) is distinct from 'expired' then
      raise exception 'CASE 2 FAILED (%): old session is %, expected expired', r.label, pg_temp.status_of(old.id);
    end if;
    if new.status is distinct from 'pending_payment' or new.idempotency_key is distinct from k then
      raise exception 'CASE 2 FAILED (%): new session % / key %', r.label, new.status, new.idempotency_key;
    end if;
    if new.branch_id is distinct from r.nb or new.order_type is distinct from r.nt::public.order_type
       or new.address_id is distinct from r.na or new.coupon_code is distinct from r.nc
       or new.notes is distinct from r.nn or new.loyalty_points is distinct from r.np
       or (new.snapshot->'items'->0->>'quantity')::int is distinct from r.nq then
      raise exception 'CASE 2 FAILED (%): the new session does not carry the new inputs', r.label;
    end if;
    if pg_temp.pending_for(a, k) is distinct from 1 then
      raise exception 'CASE 2 FAILED (%): % pending sessions for the key', r.label, pg_temp.pending_for(a, k);
    end if;
    raise notice 'CASE 2 ok (%): % -> % (total % -> %)', r.label, old.id, new.id, old.total, new.total;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 3: the verdict's end-to-end run. A pickup session gets an attempt, the
--         attempt is closed as a cancelled invoice (what abandon writes), and
--         the same key comes back as delivery with an address and a coupon.
--         The customer must now be invoiced, and get, the DELIVERY order.
--         Pre-fix: same session, attempt at 64.00, a pickup order.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid();
  s1 public.checkout_sessions; s2 public.checkout_sessions;
  v_att uuid; v_amount numeric; o public.orders;
begin
  s1 := pg_temp.b(a, k, 'b0000000-0000-0000-0000-000000000001', 'pickup', pg_temp.cart());
  v_att := pg_temp.attempt(s1.id);
  update public.payment_records
     set status = 'failed', failure_code = 'invoice_canceled', provider_checkout_ref = 'inv_sim_1'
   where id = v_att;

  s2 := pg_temp.b(a, k, 'b0000000-0000-0000-0000-000000000001', 'delivery', pg_temp.cart(),
                  '0f000000-0000-0000-0000-0000000ad001', 'SEEDFIX10', 'ring bell', 0);
  if s2.id = s1.id then raise exception 'CASE 3 FAILED: the pickup session was returned'; end if;
  if s2.total = s1.total then raise exception 'CASE 3 FAILED: the new session kept the old total %', s1.total; end if;
  if s2.delivery_fee <= 0 or s2.discount_amount <= 0 then
    raise exception 'CASE 3 FAILED: fee % / discount % not applied', s2.delivery_fee, s2.discount_amount;
  end if;

  v_att := pg_temp.attempt(s2.id);
  select amount into v_amount from public.payment_records where id = v_att;
  if v_amount is distinct from s2.total then raise exception 'CASE 3 FAILED: invoiced % for a % session', v_amount, s2.total; end if;

  set local role service_role;
  o := public.finalize_checkout_session(s2.id, 'moyasar', 'pay_sim_3', s2.total, 'SAR');
  reset role;
  if o.order_type is distinct from 'delivery' or o.coupon_code is distinct from 'SEEDFIX10'
     or o.total is distinct from s2.total then
    raise exception 'CASE 3 FAILED: order % / % / %', o.order_type, o.coupon_code, o.total;
  end if;
  raise notice 'CASE 3 ok: % pickup retired; delivery order % at %', s1.total, o.id, o.total;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 4: an attempt that may still be paid blocks the replacement, and the
--         call raises the documented error instead of returning the old
--         session. The old session is untouched and an identical retry still
--         finds it.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f000000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k uuid; s public.checkout_sessions; s2 public.checkout_sessions; v_att uuid; v_res text;
  r record;
begin
  for r in select * from (values
      -- label,                     status,     failure_code,      checkout ref, provider ref
      ('initiated, no invoice yet', 'initiated', null::text,       null::text,   null::text),
      ('initiated, invoice open',   'initiated', null,             'inv_sim_4a', null),
      ('expired invoice',           'failed',    'invoice_expired','inv_sim_4b', null),
      ('expired attempt w/ invoice','failed',    'expired',        'inv_sim_4c', null),
      ('declined, charge ref',      'failed',    'declined',       null,         'pay_sim_4d'),
      ('refunded',                  'refunded',  null,             'inv_sim_4e', 'pay_sim_4e'),
      ('authorized',                'authorized',null,             'inv_sim_4f', 'pay_sim_4f')
    ) as t(label, st, fc, cref, pref)
  loop
    k := gen_random_uuid();
    s := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart());
    v_att := pg_temp.attempt(s.id);
    update public.payment_records
       set status = r.st, failure_code = r.fc, provider_checkout_ref = r.cref, provider_ref = r.pref
     where id = v_att;

    v_res := pg_temp.try_b(a, k, b1, 'delivery', pg_temp.cart(), '0f000000-0000-0000-0000-0000000ad001');
    if v_res is distinct from 'P0001:checkout_session_mismatch: payment_open' then
      raise exception 'CASE 4 FAILED (%): expected payment_open, got %', r.label, v_res;
    end if;
    if pg_temp.status_of(s.id) is distinct from 'pending_payment' then
      raise exception 'CASE 4 FAILED (%): old session became %', r.label, pg_temp.status_of(s.id);
    end if;
    s2 := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart());
    if s2.id is distinct from s.id then raise exception 'CASE 4 FAILED (%): identical retry lost the session', r.label; end if;
    raise notice 'CASE 4 ok (%): refused, session kept', r.label;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 5: attempts that can never be paid do not block: a cancelled invoice,
--         and an attempt closed before any invoice or charge existed.
--         Several such attempts on one session, too.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f000000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid(); s public.checkout_sessions; s2 public.checkout_sessions; v_att uuid;
begin
  s := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart());
  v_att := pg_temp.attempt(s.id);
  update public.payment_records set status = 'failed', failure_code = 'attempt_expiring' where id = v_att;
  v_att := pg_temp.attempt(s.id);
  update public.payment_records
     set status = 'failed', failure_code = 'invoice_canceled', provider_checkout_ref = 'inv_sim_5'
   where id = v_att;
  s2 := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart(), null, 'SEEDFIX10');
  if s2.id = s.id or pg_temp.status_of(s.id) is distinct from 'expired' then
    raise exception 'CASE 5 FAILED: dead attempts blocked the replacement (old %)', pg_temp.status_of(s.id);
  end if;
  raise notice 'CASE 5 ok: two dead attempts, replaced by %', s2.id;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 6: a retired session can no longer be paid, but a payment that did
--         settle on it is still honoured: 'expired', not 'cancelled'.
--         Its redeemed points stop being reserved.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f000000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid(); s public.checkout_sessions; s2 public.checkout_sessions;
  v_res text; o public.orders; v_att uuid;
begin
  -- 600 of 1000 points. While the old session is pending, a second 600-point
  -- session cannot open an attempt; once it is retired, it can.
  s := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart(), null, null, null, 600);
  s2 := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart(), null, null, 'extra napkins', 600);
  if s2.id = s.id then raise exception 'CASE 6 FAILED: not replaced'; end if;

  begin
    perform pg_temp.attempt(s.id);
    v_res := 'opened';
  exception when others then v_res := sqlerrm;
  end;
  if v_res is distinct from 'Checkout session is not payable' then
    raise exception 'CASE 6 FAILED: retired session answered % to a new attempt', v_res;
  end if;

  v_att := pg_temp.attempt(s2.id);
  if v_att is null then raise exception 'CASE 6 FAILED: the replacement could not open an attempt'; end if;

  set local role service_role;
  o := public.finalize_checkout_session(s.id, 'moyasar', 'pay_sim_6', s.total, 'SAR');
  reset role;
  if o.id is null then raise exception 'CASE 6 FAILED: a payment settled on the retired session was refused'; end if;
  raise notice 'CASE 6 ok: retired session not payable, late capture still becomes order %', o.id;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 7: a settled session is returned for the same inputs and refused for
--         different ones (an order already exists for the key).
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f000000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid(); s public.checkout_sessions; s2 public.checkout_sessions;
  o public.orders; v_res text; v_orders int;
begin
  s := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart());
  perform pg_temp.attempt(s.id);
  set local role service_role;
  o := public.finalize_checkout_session(s.id, 'moyasar', 'pay_sim_7', s.total, 'SAR');
  reset role;

  s2 := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart());
  if s2.id is distinct from s.id or s2.order_id is distinct from o.id then
    raise exception 'CASE 7 FAILED: identical retry of a settled session did not return it';
  end if;
  select count(*) into v_orders from public.orders where customer_id = a;
  v_res := pg_temp.try_b(a, k, b1, 'pickup', pg_temp.cart(), null, 'SEEDFIX10');
  if v_res is distinct from 'P0001:checkout_session_mismatch: order_placed' then
    raise exception 'CASE 7 FAILED: expected order_placed, got %', v_res;
  end if;
  if (select count(*) from public.orders where customer_id = a) is distinct from v_orders then
    raise exception 'CASE 7 FAILED: an extra order appeared';
  end if;
  raise notice 'CASE 7 ok: settled session returned for the same inputs, refused otherwise';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 8: an unknown or NULL branch is refused even when a session exists for
--         the key. Pre-fix: the old session came back.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid(); v_res text;
begin
  perform pg_temp.b(a, k, 'b0000000-0000-0000-0000-000000000001', 'pickup', pg_temp.cart());
  v_res := pg_temp.try_b(a, k, gen_random_uuid(), 'pickup', pg_temp.cart());
  if v_res is distinct from 'P0001:The selected branch is not available' then
    raise exception 'CASE 8 FAILED: unknown branch answered %', v_res;
  end if;
  v_res := pg_temp.try_b(a, k, null, 'pickup', pg_temp.cart());
  if v_res is distinct from 'P0001:The selected branch is not available' then
    raise exception 'CASE 8 FAILED: NULL branch answered %', v_res;
  end if;
  v_res := pg_temp.try_b(a, gen_random_uuid(), gen_random_uuid(), 'pickup', pg_temp.cart());
  if v_res is distinct from 'P0001:The selected branch is not available' then
    raise exception 'CASE 8 FAILED: unknown branch with a fresh key answered %', v_res;
  end if;
  -- The check comes before the lookup: with a live attempt on the key's session
  -- the answer is still about the branch, not about that session.
  perform pg_temp.attempt((select id from public.checkout_sessions
                            where customer_id = a and idempotency_key = k and status = 'pending_payment'));
  v_res := pg_temp.try_b(a, k, gen_random_uuid(), 'pickup', pg_temp.cart());
  if v_res is distinct from 'P0001:The selected branch is not available' then
    raise exception 'CASE 8 FAILED: unknown branch over an open attempt answered %', v_res;
  end if;
  -- And with online payment switched off, too.
  update public.app_settings set online_payment_enabled = false where id = true;
  v_res := pg_temp.try_b(a, gen_random_uuid(), gen_random_uuid(), 'pickup', pg_temp.cart());
  update public.app_settings set online_payment_enabled = true where id = true;
  if v_res is distinct from 'P0001:The selected branch is not available' then
    raise exception 'CASE 8 FAILED: unknown branch with payment off answered %', v_res;
  end if;
  raise notice 'CASE 8 ok: unknown and NULL branches refused';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 9: a row written before the migration (NULL fingerprint) matches
--         nothing: replaced when dead, never returned.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f000000-0000-0000-0000-000000000001';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid(); s public.checkout_sessions; s2 public.checkout_sessions;
begin
  s := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart());
  update public.checkout_sessions set input_fingerprint = null where id = s.id;
  s2 := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart());
  if s2.id = s.id then raise exception 'CASE 9 FAILED: a NULL-fingerprint session was returned'; end if;
  if pg_temp.status_of(s.id) is distinct from 'expired' then raise exception 'CASE 9 FAILED: legacy row not retired'; end if;
  raise notice 'CASE 9 ok: legacy row retired';
end $$;

-- ---------------------------------------------------------------------------
-- CASE 10: keys stay per customer, and client grants are unchanged.
-- ---------------------------------------------------------------------------
do $$
declare
  a uuid := '0f000000-0000-0000-0000-000000000001';
  bb uuid := '0f000000-0000-0000-0000-000000000002';
  b1 uuid := 'b0000000-0000-0000-0000-000000000001';
  k uuid := gen_random_uuid(); sa public.checkout_sessions; sb public.checkout_sessions;
begin
  sa := pg_temp.b(a, k, b1, 'pickup', pg_temp.cart());
  sb := pg_temp.b(bb, k, b1, 'pickup', pg_temp.cart(3));
  if sa.id = sb.id or pg_temp.status_of(sa.id) is distinct from 'pending_payment' then
    raise exception 'CASE 10 FAILED: another customer''s call touched this session';
  end if;
  if has_function_privilege('anon', 'public.begin_checkout_session(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid)', 'execute') then
    raise exception 'CASE 10 FAILED: anon can execute begin_checkout_session';
  end if;
  if not has_function_privilege('authenticated', 'public.begin_checkout_session(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid)', 'execute') then
    raise exception 'CASE 10 FAILED: authenticated cannot execute begin_checkout_session';
  end if;
  raise notice 'CASE 10 ok: per-customer keys, grants unchanged';
end $$;

rollback;
