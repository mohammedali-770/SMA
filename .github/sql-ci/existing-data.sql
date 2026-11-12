-- ============================================================================
-- Existing data for the existing-data stage (.github/sql-ci/existing-data.sh).
--
-- A small, synthetic production-shaped database, written the way production
-- writes it: identities through the auth trigger, then everything a customer or
-- an administrator owns through the same path the apps use — row inserts under
-- RLS as `authenticated`, and the real RPCs. Nothing here goes around a policy
-- or a function with a direct table write, so the rows look like rows the
-- product actually produced.
--
-- The stage loads it onto a database built from the migrations that PREDATE
-- the change under test, then applies the change on top. It is loaded from the
-- BASE revision when the base has it, because the data that exists before a
-- change was written by the code before that change.
--
-- No harness.sql here: authorization is the production predicate, with the
-- caller set through `request.jwt.claims` the way PostgREST sets it. The admin
-- carries `aal: aal2`, so `is_admin()` is the real check, not an override.
--
-- Every value is synthetic, and each phone number is an invented one listed in
-- scripts/test-phone-allowlist.json; no row describes a real person.
-- ============================================================================
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Identities. Phone-confirmed sign-ups, so handle_new_user() creates verified
-- profiles exactly as a WhatsApp sign-in does.
-- ---------------------------------------------------------------------------
begin;
insert into auth.users (id, phone, phone_confirmed_at, raw_user_meta_data) values
  ('0e000000-0000-0000-0000-00000000000a', '966500000301', now() - interval '30 days', '{"full_name":"Existing Customer A"}'),
  ('0e000000-0000-0000-0000-00000000000b', '966500000302', now() - interval '20 days', '{"full_name":"Existing Customer B"}'),
  ('0e000000-0000-0000-0000-00000000000c', '966500000303', now() - interval '10 days', '{"full_name":"Existing Customer C"}'),
  ('0e000000-0000-0000-0000-0000000000ad', '966500000304', now() - interval '40 days', '{"full_name":"Existing Admin"}');

-- Staff onboarding has no client path for the FIRST administrator; production
-- did this once, by hand, too.
update public.profiles set role = 'admin' where id = '0e000000-0000-0000-0000-0000000000ad';
commit;

-- ---------------------------------------------------------------------------
-- Customer A: two addresses (the second promoted to default), a push device,
-- and a large pickup order that will be delivered and earn points.
-- ---------------------------------------------------------------------------
begin;
select set_config('request.jwt.claims',
  '{"sub":"0e000000-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;

insert into public.addresses (customer_id, label, description, latitude, longitude, is_default) values
  ('0e000000-0000-0000-0000-00000000000a', 'Home', 'Olaya, building 4, flat 2', 24.7136, 46.6753, true);
insert into public.addresses (customer_id, label, description, latitude, longitude, is_default) values
  ('0e000000-0000-0000-0000-00000000000a', 'Work', 'King Fahd Rd, tower 2', 24.7200, 46.6800, true);

select public.register_push_device('ExponentPushToken[existing-data-a]', 'ios', 'en', true, true);

select public.place_customer_order(
  'b0000000-0000-0000-0000-000000000001', 'pickup',
  '[{"product_id":"a0000000-0000-0000-0000-000000000001","quantity":4,
     "modifier_ids":["80000000-0000-0000-0000-000000000002"]}]'::jsonb,
  null, null, null, 0, '0e100000-0000-0000-0000-0000000000a1', 'cash');
commit;

-- ---------------------------------------------------------------------------
-- Customer B: one default address, a coupon order left in `received`, and a
-- second order that will be cancelled.
-- ---------------------------------------------------------------------------
begin;
select set_config('request.jwt.claims',
  '{"sub":"0e000000-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;

insert into public.addresses (customer_id, label, description, latitude, longitude, is_default) values
  ('0e000000-0000-0000-0000-00000000000b', 'Home', 'Corniche, villa 9', 21.4901, 39.1862, true);

select public.register_push_device('ExponentPushToken[existing-data-b]', 'android', 'ar', true, false);

select public.place_customer_order(
  'b0000000-0000-0000-0000-000000000001', 'pickup',
  '[{"product_id":"a0000000-0000-0000-0000-000000000003","quantity":2},
    {"product_id":"a0000000-0000-0000-0000-000000000004","quantity":2}]'::jsonb,
  null, 'SEEDPCT15', 'Extra napkins', 0, '0e100000-0000-0000-0000-0000000000b1', 'cash');

select public.place_customer_order(
  'b0000000-0000-0000-0000-000000000002', 'pickup',
  '[{"product_id":"a0000000-0000-0000-0000-000000000002","quantity":1,
     "modifier_ids":["80000000-0000-0000-0000-000000000003"]}]'::jsonb,
  null, null, null, 0, '0e100000-0000-0000-0000-0000000000b2', 'cash');
commit;

-- ---------------------------------------------------------------------------
-- The administrator works the queue: A's order to delivered (which settles its
-- loyalty earn), B's second order cancelled. The ids are looked up first, as
-- the console has them on screen: `authenticated` cannot filter orders by
-- idempotency key, and that column grant is not what this file is testing.
-- ---------------------------------------------------------------------------
select id as order_a1 from public.orders where idempotency_key = '0e100000-0000-0000-0000-0000000000a1' \gset
select id as order_b2 from public.orders where idempotency_key = '0e100000-0000-0000-0000-0000000000b2' \gset

begin;
select set_config('request.jwt.claims',
  '{"sub":"0e000000-0000-0000-0000-0000000000ad","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.admin_set_order_status(:'order_a1', 'preparing');
select public.admin_set_order_status(:'order_a1', 'ready');
select public.admin_set_order_status(:'order_a1', 'delivered');
select public.admin_set_order_status(:'order_b2', 'cancelled');
commit;

-- ---------------------------------------------------------------------------
-- Customer A spends points on a second order, which is then cancelled (so the
-- redemption is given back), and places a third that waits in `preparing`.
-- ---------------------------------------------------------------------------
begin;
select set_config('request.jwt.claims',
  '{"sub":"0e000000-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;

select public.place_customer_order(
  'b0000000-0000-0000-0000-000000000001', 'pickup',
  '[{"product_id":"a0000000-0000-0000-0000-000000000003","quantity":3}]'::jsonb,
  null, null, null, 100, '0e100000-0000-0000-0000-0000000000a2', 'cash');

select public.place_customer_order(
  'b0000000-0000-0000-0000-000000000002', 'pickup',
  '[{"product_id":"a0000000-0000-0000-0000-000000000004","quantity":1}]'::jsonb,
  null, null, null, 0, '0e100000-0000-0000-0000-0000000000a3', 'cash');
commit;

select id as order_a2 from public.orders where idempotency_key = '0e100000-0000-0000-0000-0000000000a2' \gset
select id as order_a3 from public.orders where idempotency_key = '0e100000-0000-0000-0000-0000000000a3' \gset

begin;
select set_config('request.jwt.claims',
  '{"sub":"0e000000-0000-0000-0000-0000000000ad","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.admin_set_order_status(:'order_a2', 'cancelled');
select public.admin_set_order_status(:'order_a3', 'preparing');
commit;

-- ---------------------------------------------------------------------------
-- Customer C: signed up, never ordered. Rows a backfill must also leave alone.
-- ---------------------------------------------------------------------------
begin;
select set_config('request.jwt.claims',
  '{"sub":"0e000000-0000-0000-0000-00000000000c","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
insert into public.addresses (customer_id, label, description, latitude, longitude, is_default) values
  ('0e000000-0000-0000-0000-00000000000c', 'Home', 'Malqa, street 12, house 7', 24.8000, 46.6200, false);
commit;
