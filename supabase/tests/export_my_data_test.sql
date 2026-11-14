-- ============================================================================
-- export_my_data() — PDPL access / portability
-- (migration 20260912120000_export_my_data).
--
-- THE PROPERTY THAT MATTERS MOST IS ISOLATION. A portability endpoint is, by
-- construction, a function that returns somebody's name, phone, addresses and
-- order history. If it can be pointed at another customer it is an enumeration
-- oracle for the entire customer base. The design defence is that it takes NO
-- argument — so the tests attack that from both directions: a second customer's
-- data must never appear, and there must be no overload that accepts an id.
--
-- PROPERTIES ASSERTED
--   1. it returns the CALLER's account, addresses, orders and loyalty history;
--   2. it returns NOTHING belonging to a second customer, from the same rows;
--   3. an anonymous caller is refused rather than silently given an empty shell;
--   4. the push TOKEN is withheld while the preferences are included;
--   5. internal operational state is not exported;
--   6. empty collections come back as [] rather than null, so a client can
--      iterate without a null check;
--   7. there is exactly one overload and it takes zero arguments.
--
-- ADDED WITH 20261014120000 (gap PG-26): payment records, checkouts, refunds
--   8. the caller gets exactly their own payment records, checkouts and
--      refunds, counted against the rows and matched by id, and nothing of a
--      second customer's, checked by content and from both sides;
--   9. a payment record that touches another customer through either of its
--      links is returned to neither;
--  10. what is left out on purpose is absent, as keys and as values (the
--      payment-page link, our lookup and idempotency keys, the raw provider
--      payload, the snapshot's internals, the refund worker's bookkeeping);
--  11. the card facts are exported: the card that paid, and every try the
--      stored response holds, in Moyasar's two shapes and Tap's;
--  12. a checkout that never became an order carries its lines, and they
--      reconcile with its subtotal;
--  13. the honest flows keep working: no payments gives three empty lists,
--      and every key that existed before keeps its shape;
--  14. an order whose customer DELETED their account (customer_id NULL, as
--      ON DELETE SET NULL leaves it) gives its payment record and its refund
--      to nobody, not even to every other customer;
--  15. a checkout that became one of the caller's orders gives only its
--      references, because the order lists the rest; one linked to somebody
--      else's order gives no order number; the coupon is the priced code, not
--      the raw text typed; the address has no row id or customer id;
--  16. a refund's reason is words in both languages, never our machine code.
-- ============================================================================

begin;

\set alice '''0e100000-0000-0000-0000-0000000000a1'''
\set bob   '''0e100000-0000-0000-0000-0000000000b2'''

-- Two customers, so isolation is tested against real neighbouring rows rather
-- than against an empty table.
insert into auth.users (id, phone) values
  (:alice, '+966500000901'), (:bob, '+966500000902');
-- The auth.users insert seeds a profile by trigger, so these are updates.
update public.profiles
   set full_name = 'Alice Test', phone_number = '+966500000901',
       email = 'alice@example.test', role = 'customer', loyalty_points = 250
 where id = :alice;
update public.profiles
   set full_name = 'Bob Test', phone_number = '+966500000902',
       email = 'bob@example.test', role = 'customer', loyalty_points = 999
 where id = :bob;

insert into public.addresses (customer_id, label, description, latitude, longitude, is_default)
values
  (:alice, 'Home',   'Alice building, floor 3', 24.71, 46.67, true),
  (:bob,   'Office', 'Bob tower, floor 9',      24.72, 46.68, true);

insert into public.push_devices
  (customer_id, expo_push_token, platform, lang, is_active, order_updates_enabled, promos_enabled)
values
  (:alice, 'ExponentPushToken[ALICE-SECRET-TOKEN]', 'ios', 'en', true, true, false);

insert into public.loyalty_transactions
  (profile_id, order_id, type, points, balance_after, reason)
values
  (:alice, null, 'adjustment',  250, 250, 'Alice goodwill'),
  (:bob,   null, 'adjustment',  999, 999, 'Bob goodwill');

-- An order with a PRICED add-on. The add-on's price is already inside
-- `line_total`, which is what makes its absence from the export a figure the
-- customer cannot reconcile rather than a missing nicety.
do $$
declare v_order uuid; v_item uuid;
begin
  insert into public.orders
    (customer_id, order_number, customer_name, customer_phone, branch_id,
     branch_name_en, branch_name_ar, status, order_type,
     subtotal, delivery_fee, vat_amount, total, payment_method, payment_status)
  select '0e100000-0000-0000-0000-0000000000a1', 'SM-TEST-EXPORT-1', 'Alice Test',
         '+966500000901', b.id, b.name_en, b.name_ar, 'delivered', 'pickup',
         30.00, 0, 4.50, 30.00, 'cash', 'paid'
    from public.branches b limit 1
  returning id into v_order;

  insert into public.order_items
    (order_id, product_id, name_en, name_ar, unit_price, quantity, line_total)
  select v_order, p.id, 'Test Burger', 'برجر', 22.00, 1, 30.00
    from public.products p limit 1
  returning id into v_item;

  insert into public.order_item_modifiers (order_item_id, modifier_id, name_en, name_ar, price)
  values (v_item, null, 'Extra cheese', 'جبن إضافي', 8.00);
end $$;

-- ============================================================================
-- 1-2, 4-6. The caller gets their own data, and only their own
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '0e100000-0000-0000-0000-0000000000a1';
do $$
declare v jsonb; v_txt text; v_key text;
begin
  v := public.export_my_data();
  v_txt := v::text;

  -- 1. the caller's own records are present
  if v #>> '{account,name}' <> 'Alice Test' then
    raise exception 'FAIL 1: account name is %, expected Alice Test', v #>> '{account,name}';
  end if;
  if (v #>> '{account,loyalty_points_balance}')::int <> 250 then
    raise exception 'FAIL 1: balance is %, expected 250', v #>> '{account,loyalty_points_balance}';
  end if;
  if jsonb_array_length(v -> 'saved_addresses') <> 1 then
    raise exception 'FAIL 1: expected 1 saved address, got %', jsonb_array_length(v -> 'saved_addresses');
  end if;
  if jsonb_array_length(v -> 'loyalty_history') <> 1 then
    raise exception 'FAIL 1: expected 1 loyalty row, got %', jsonb_array_length(v -> 'loyalty_history');
  end if;

  -- 1b. ADD-ONS. `line_total` (30.00) is the item (22.00) plus the add-on
  -- (8.00), so an export without the add-on states a number the customer
  -- cannot account for. Assert the amount reconciles, not merely that a key
  -- exists.
  declare
    v_item jsonb;
    v_addons jsonb;
  begin
    v_item := v #> '{orders,0,items,0}';
    v_addons := v_item -> 'add_ons';
    if v_addons is null or jsonb_array_length(v_addons) <> 1 then
      raise exception 'FAIL 1b: expected 1 add-on in the exported line item, got %',
        coalesce(jsonb_array_length(v_addons)::text, 'null');
    end if;
    if (v_addons #>> '{0,name}') <> 'Extra cheese' then
      raise exception 'FAIL 1b: add-on name is %', v_addons #>> '{0,name}';
    end if;
    if (v_item ->> 'unit_price')::numeric + (v_addons #>> '{0,price}')::numeric
       <> (v_item ->> 'line_total')::numeric then
      raise exception 'FAIL 1b: % + % does not reconcile to line_total %',
        v_item ->> 'unit_price', v_addons #>> '{0,price}', v_item ->> 'line_total';
    end if;
  end;

  -- 2. NOTHING of Bob's, checked by content rather than by count
  if v_txt ilike '%Bob%' or v_txt like '%966500000902%' or v_txt ilike '%bob@example.test%' then
    raise exception 'FAIL 2: another customer''s data appears in the export';
  end if;
  -- Bob's balance and his ledger row are both 999. Matched as a standalone
  -- number, not a substring: the export's own timestamps carry microseconds, and
  -- '%999%' failed whenever one of them read .999… or …999 (about one run in a
  -- hundred, 2026-11-12). A leaked balance is serialised as a JSON number, so it
  -- is bounded by non-digits on both sides; a timestamp fragment never is.
  if v_txt ~ '(^|[^0-9.])999($|[^0-9])' then
    raise exception 'FAIL 2: another customer''s balance appears in the export';
  end if;

  -- 4. preferences yes, token never
  if v_txt like '%ALICE-SECRET-TOKEN%' then
    raise exception 'FAIL 4: the push token was exported';
  end if;
  if (v #> '{notification_devices,0}') ->> 'order_updates_enabled' <> 'true' then
    raise exception 'FAIL 4: notification preferences are missing from the export';
  end if;

  -- 5. internal operational state stays internal.
  --
  -- NOTE THE ESCAPES. `_` is a single-character WILDCARD in LIKE, not a literal
  -- underscore, so the first version of this assertion used '%sync_%' and matched
  -- the phrase "sync state" in the export's own explanatory prose — failing the
  -- suite over the description rather than over any leaked field. An assertion
  -- that greps for internal column names has to escape them or it tests
  -- something other than what it claims.
  if v_txt ilike '%lazywait%'
     or v_txt ilike '%idempotency\_key%'
     or v_txt ilike '%sync\_status%'
     or v_txt ilike '%pos\_sync%'
     or v_txt ilike '%refund\_state%' then
    raise exception 'FAIL 5: internal operational state leaked into the export';
  end if;

  -- 6. every collection is an array, so a client can iterate blind. Alice now
  -- has an order, so the empty-case check moves to a collection she has none
  -- of — a null here would crash a `.map()` on the client.
  for v_key in select unnest(array['orders','saved_addresses','loyalty_history','notification_devices'])
  loop
    if jsonb_typeof(v -> v_key) <> 'array' then
      raise exception 'FAIL 6: % is %, expected an array', v_key, jsonb_typeof(v -> v_key);
    end if;
  end loop;

  raise notice 'cases 1,2,4,5,6 ok -- own data returned, neighbour excluded, token withheld';
end $$;
reset role;

-- ============================================================================
-- 3. Refused without a session — BOTH guards, separately
--
-- Split deliberately. `set local` persists for the whole transaction, so a
-- single anon case would still carry Alice's jwt claim from above and would be
-- refused by the missing GRANT before the function body ever ran — passing while
-- proving nothing about the null-uid check inside it. Each guard is therefore
-- exercised on its own.
-- ============================================================================

-- 3a. anon has no EXECUTE at all.
set local role anon;
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.export_my_data();
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL 3a: anon holds execute on export_my_data';
  end if;
  raise notice 'case 3a ok -- anon cannot execute it';
end $$;
reset role;

-- 3b. authenticated, but no subject: the function's OWN guard must fire, rather
-- than the body running as owner with a null filter and returning a plausible
-- empty shell.
set local request.jwt.claim.sub = '';
set local role authenticated;
do $$
declare v_raised boolean := false; v jsonb;
begin
  begin
    v := public.export_my_data();
  exception when others then
    if sqlerrm like '%requires an authenticated session%' then v_raised := true;
    else raise; end if;
  end;
  if not v_raised then
    raise exception 'FAIL 3b: a session with no subject got a result (%) instead of an error', coalesce(v::text, 'null');
  end if;
  raise notice 'case 3b ok -- a null subject raises rather than returning an empty export';
end $$;
reset role;

-- ============================================================================
-- 7. The zero-argument shape IS the security model
-- ============================================================================
do $$
declare v_n int; v_args int;
begin
  select count(*), coalesce(max(pronargs), -1) into v_n, v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'export_my_data';
  if v_n <> 1 then
    raise exception 'FAIL 7: % overloads of export_my_data — one of them may take a customer id', v_n;
  end if;
  if v_args <> 0 then
    raise exception 'FAIL 7: export_my_data takes % argument(s); it must take none', v_args;
  end if;
  raise notice 'case 7 ok -- exactly one overload, zero arguments';
end $$;

-- ============================================================================
-- 8-14. PAYMENT RECORDS, CHECKOUTS AND REFUNDS
-- (migration 20261014120000_export_my_data_payments, gap PG-26)
--
-- Every case above runs against the NEW body too, so 3a and 3b are the
-- anonymous refusals of the function this section extends.
--
-- The fixtures are written here, after cases 1-7, so those cases see exactly
-- the data they were written for. Every row carries an explicit time, so the
-- order of each list is fixed rather than a tie on now().
--
-- Each column the export must leave out is filled with a value that can be
-- searched for, and the search is the assertion: a key renamed on its way out
-- would still be caught by its value.
-- ============================================================================
do $$
declare
  c_alice constant uuid := '0e100000-0000-0000-0000-0000000000a1';
  c_bob   constant uuid := '0e100000-0000-0000-0000-0000000000b2';
  v_branch uuid;
  c_dave  constant uuid := '0e100000-0000-0000-0000-0000000000d4';
  v_ord_a2 uuid; v_ord_a3 uuid; v_ord_b2 uuid; v_ord_d1 uuid;
  v_pay_a1 uuid; v_pay_b1 uuid; v_pay_d1 uuid;
begin
  -- Carol has an account and nothing else: the honest empty case.
  insert into auth.users (id) values ('0e100000-0000-0000-0000-0000000000c3');

  select b.id into v_branch from public.branches b order by b.created_at, b.id limit 1;

  -- Orders. A2: Alice's card order, paid. A3: Alice's order-first order with a
  -- Tap attempt (history). B2: Bob's card order, paid.
  insert into public.orders
    (customer_id, order_number, customer_name, customer_phone, branch_id,
     branch_name_en, branch_name_ar, status, order_type,
     subtotal, delivery_fee, vat_amount, total, payment_method, payment_status,
     paid_at, created_at)
  select c_alice, 'SM-TEST-EXPORT-2', 'Alice Test', '+966500000901', b.id, b.name_en,
         b.name_ar, 'received', 'pickup', 25.00, 0, 3.26, 25.00, 'online', 'paid',
         now() + interval '1 minute', now() + interval '1 minute'
    from public.branches b where b.id = v_branch
  returning id into v_ord_a2;
  insert into public.orders
    (customer_id, order_number, customer_name, customer_phone, branch_id,
     branch_name_en, branch_name_ar, status, order_type,
     subtotal, delivery_fee, vat_amount, total, payment_method, payment_status,
     created_at)
  select c_alice, 'SM-TEST-EXPORT-3', 'Alice Test', '+966500000901', b.id, b.name_en,
         b.name_ar, 'cancelled', 'pickup', 12.00, 0, 1.57, 12.00, 'online', 'pending',
         now() + interval '3 minutes'
    from public.branches b where b.id = v_branch
  returning id into v_ord_a3;
  insert into public.orders
    (customer_id, order_number, customer_name, customer_phone, branch_id,
     branch_name_en, branch_name_ar, status, order_type,
     subtotal, delivery_fee, vat_amount, total, payment_method, payment_status,
     paid_at, created_at)
  select c_bob, 'SM-TEST-EXPORT-B2', 'Bob Test', '+966500000902', b.id, b.name_en,
         b.name_ar, 'received', 'pickup', 31.00, 0, 4.04, 31.00, 'online', 'paid',
         now() + interval '1 minute', now() + interval '1 minute'
    from public.branches b where b.id = v_branch
  returning id into v_ord_b2;

  -- Checkouts. A1 became order A2; A2 was abandoned and is the only record of
  -- what Alice tried to buy. B1 became order B2; B2 was abandoned.
  insert into public.checkout_sessions
    (id, customer_id, status, order_type, payment_method, branch_id, snapshot,
     subtotal, delivery_fee, discount_amount, loyalty_discount_amount, vat_amount,
     total, currency, idempotency_key, order_id, notes, created_at, expires_at,
     consumed_at, coupon_code)
  values
    ('a1000000-0000-4000-8000-0000000000a1', c_alice, 'consumed', 'pickup', 'online',
     v_branch,
     jsonb_build_object('branch_name_en', 'Export branch', 'items', jsonb_build_array(
       jsonb_build_object('product_id', 'f1000000-0000-4000-8000-0000000000f1',
         'name_en', 'Spicy wrap', 'unit_price', 25.00, 'quantity', 1, 'line_total', 25.00,
         'modifiers', '[]'::jsonb)),
       'loyalty_points_redeemed', 0, 'is_comped', false, 'comp_discount_amount', 0),
     25.00, 0, 0, 0, 3.26, 25.00, 'SAR', null, v_ord_a2, 'Alice consumed note',
     now() + interval '1 minute', now() + interval '31 minutes', now() + interval '2 minutes',
     null),
    ('a1000000-0000-4000-8000-0000000000a2', c_alice, 'expired', 'delivery', 'online',
     v_branch,
     jsonb_build_object(
       'branch_name_en', 'Export branch',
       -- As compute_order_snapshot writes them: the priced code upper-cased and
       -- trimmed, the typed text beside it, and the whole address row.
       'coupon_code', 'ALICE15',
       'coupon_code_raw', 'ALICE-RAW-COUPON',
       'address_snapshot', jsonb_build_object(
         'id', 'ad100000-0000-4000-8000-0000000000a9', 'customer_id', c_alice,
         'label', 'Alice home', 'description', 'Building 7, Olaya',
         'national_short_address', 'RAAA1234', 'latitude', 24.7, 'longitude', 46.6,
         'is_default', true),
       'loyalty_points_redeemed', 0, 'is_comped', false, 'comp_discount_amount', 0,
       'items', jsonb_build_array(
         jsonb_build_object('product_id', 'f1000000-0000-4000-8000-0000000000f2',
           'name_en', 'Zinger meal', 'variant_name_en', 'Large',
           'unit_price', 20.00, 'quantity', 2, 'line_total', 40.00, 'note', 'No onions',
           'modifiers', jsonb_build_array(jsonb_build_object(
             'modifier_id', 'f1000000-0000-4000-8000-0000000000f3',
             'name_en', 'Extra sauce', 'price', 2.00))),
         jsonb_build_object('product_id', 'f1000000-0000-4000-8000-0000000000f4',
           'name_en', 'Lemon mint', 'unit_price', 9.50, 'quantity', 1, 'line_total', 9.50,
           'modifiers', '[]'::jsonb))),
     49.50, 0, 0, 0, 6.46, 49.50, 'SAR', 'd1000000-0000-4000-8000-00000000d1d1', null,
     'Alice checkout note', now() + interval '4 minutes', now() + interval '34 minutes', null,
     -- The raw text as typed, which begin_checkout_session stores unchanged.
     ' alice-typed-coupon '),
    -- A3: Alice's checkout pointing at BOB's order. The code never writes one;
    -- it is here so the order number's owner check has something to refuse.
    ('a1000000-0000-4000-8000-0000000000a3', c_alice, 'consumed', 'pickup', 'online',
     v_branch, jsonb_build_object('items', '[]'::jsonb),
     7.00, 0, 0, 0, 0.91, 7.00, 'SAR', null, v_ord_b2, null,
     now() + interval '8 minutes', now() + interval '38 minutes', now() + interval '9 minutes',
     null),
    ('b1000000-0000-4000-8000-0000000000b1', c_bob, 'consumed', 'pickup', 'online',
     v_branch, jsonb_build_object('items', '[]'::jsonb),
     31.00, 0, 0, 0, 4.04, 31.00, 'SAR', null, v_ord_b2, 'Bob checkout note',
     now() + interval '1 minute', now() + interval '31 minutes', now() + interval '2 minutes',
     null),
    ('b1000000-0000-4000-8000-0000000000b2', c_bob, 'expired', 'pickup', 'online',
     v_branch, jsonb_build_object('items', '[]'::jsonb),
     18.00, 0, 0, 0, 2.35, 18.00, 'SAR', null, null, null,
     now() + interval '4 minutes', now() + interval '34 minutes', null,
     ' bob-typed-coupon ');

  -- Payment records.
  -- A1: Alice's paid card payment, linked to her checkout AND her order, its
  -- stored response one Moyasar payment.
  insert into public.payment_records
    (order_id, checkout_session_id, provider, status, amount, currency, mode,
     provider_ref, provider_checkout_ref, checkout_url, reference_transaction,
     reference_order, card_scheme, card_last_four, confirmed_at, expires_at,
     last_verified_at, created_at, raw)
  values
    (v_ord_a2, 'a1000000-0000-4000-8000-0000000000a1', 'moyasar', 'paid', 25.00, 'SAR', 'live',
     'pay_alice_paid', 'inv_alice_paid', 'https://checkout.moyasar.com/invoices/ALICE-URL-PLANT',
     'sm_ALICEREFTXN', 'CS-ALICEREFORD', 'mada', '4242',
     now() + interval '2 minutes', now() + interval '31 minutes',
     now() + interval '2 minutes', now() + interval '1 minute',
     jsonb_build_object(
       'id', 'pay_alice_paid', 'status', 'paid', 'amount', 2500, 'currency', 'SAR',
       'fee', 'ALICE-FEE-PLANT', 'refunded', 0, 'captured', 2500,
       'invoice_id', 'inv_alice_paid', 'created_at', '2026-11-14T10:01:00.000Z',
       'metadata', jsonb_build_object('reference_transaction', 'ALICE-META-PLANT'),
       'source', jsonb_build_object(
         'type', 'creditcard', 'company', 'mada', 'last_four', '4242',
         'message', 'APPROVED', 'reference_number', 'RRN-ALICE',
         'authorization_code', 'AUTH-ALICE', 'response_code', '00',
         'issuer_name', 'Alice Paid Bank', 'issuer_country', 'SA',
         'number', 'ALICE-BIN-PLANT', 'token', 'ALICE-TOKEN-PLANT')))
  returning id into v_pay_a1;

  -- A2: Alice's abandoned checkout. Two declined tries, then the invoice
  -- expired, so the stored response is the INVOICE listing both tries. No
  -- column carries a card: the response is the only place the cards are kept.
  insert into public.payment_records
    (checkout_session_id, provider, status, amount, currency, mode,
     provider_checkout_ref, checkout_url, reference_transaction, reference_order,
     failure_code, failure_message_safe, expires_at, created_at, raw)
  values
    ('a1000000-0000-4000-8000-0000000000a2', 'moyasar', 'failed', 49.50, 'SAR', 'live',
     'inv_alice_abandoned', 'https://checkout.moyasar.com/invoices/ALICE-URL-PLANT-2',
     'sm_ALICEREFTXN2', 'CS-ALICEREFORD2', 'invoice_expired', 'Payment session expired',
     now() + interval '34 minutes', now() + interval '4 minutes',
     jsonb_build_object(
       'id', 'inv_alice_abandoned', 'status', 'expired', 'amount', 4950,
       'description', 'Spicy Meal order',
       'payments', jsonb_build_array(
         jsonb_build_object('id', 'pay_alice_try1', 'status', 'failed',
           'created_at', '2026-11-14T10:05:00.000Z', 'fee', 'ALICE-FEE-PLANT-2',
           'source', jsonb_build_object('type', 'creditcard', 'company', 'visa',
             'last_four', '1111', 'message', 'Insufficient Funds', 'response_code', '51',
             'issuer_name', 'Alice Visa Bank', 'issuer_country', 'SA')),
         jsonb_build_object('id', 'pay_alice_try2', 'status', 'failed',
           'created_at', '2026-11-14T10:06:00.000Z',
           'source', jsonb_build_object('type', 'creditcard', 'company', 'mada',
             'last_four', '5555', 'message', 'Declined',
             'issuer_name', 'Alice Mada Bank', 'issuer_country', 'SA')))));

  -- A3: an order-first attempt from the retired provider, in Tap's shape.
  -- It has a payment-page link and no invoice id, so a link cannot pass for an
  -- invoice id; and its card brand differs from its scheme, so the scheme is
  -- what is read.
  insert into public.payment_records
    (order_id, provider, status, amount, currency, mode, provider_ref,
     checkout_url, failure_code, created_at, raw)
  values
    (v_ord_a3, 'tap', 'failed', 12.00, 'SAR', 'test', 'chg_alice_tap',
     'https://tap.example/pay/ALICE-URL-PLANT-3', 'DECLINED',
     now() + interval '3 minutes',
     jsonb_build_object(
       'id', 'chg_alice_tap', 'status', 'DECLINED', 'amount', 12, 'currency', 'SAR',
       'live_mode', false, 'payment_method', 'VISA',
       'reference', jsonb_build_object('transaction', 'ALICE-TAP-REF-PLANT',
                                       'order', 'ALICE-TAP-ORDER-PLANT'),
       'response', jsonb_build_object('code', '05', 'message', 'Do not honor'),
       'card', jsonb_build_object('scheme', 'VISA', 'brand', 'TAP-BRAND-PLANT', 'last_four', '0007'),
       'merchant', jsonb_build_object('id', 'ALICE-MERCHANT-PLANT')));

  -- Bob's: a paid card payment on his order, and an abandoned attempt.
  insert into public.payment_records
    (order_id, checkout_session_id, provider, status, amount, currency, mode,
     provider_ref, provider_checkout_ref, card_scheme, card_last_four,
     confirmed_at, created_at, raw)
  values
    (v_ord_b2, 'b1000000-0000-4000-8000-0000000000b1', 'moyasar', 'paid', 31.00, 'SAR', 'live',
     'pay_bob_paid', 'inv_bob_paid', 'visa', '9876',
     now() + interval '2 minutes', now() + interval '1 minute',
     jsonb_build_object('id', 'pay_bob_paid', 'status', 'paid',
       'source', jsonb_build_object('company', 'visa', 'last_four', '9876',
         'issuer_name', 'Bob Card Bank')))
  returning id into v_pay_b1;
  insert into public.payment_records
    (checkout_session_id, provider, status, amount, currency, mode,
     provider_checkout_ref, created_at)
  values
    ('b1000000-0000-4000-8000-0000000000b2', 'moyasar', 'initiated', 18.00, 'SAR', 'live',
     'inv_bob_abandoned', now() + interval '4 minutes');

  -- A record that touches BOTH customers: Alice's checkout and Bob's order. The
  -- code never writes one; it is here because the rule is "every link must
  -- point at the caller", and only a record like this can tell that rule from
  -- "any link may".
  insert into public.payment_records
    (order_id, checkout_session_id, provider, status, amount, currency, mode,
     provider_ref, created_at)
  values
    (v_ord_b2, 'a1000000-0000-4000-8000-0000000000a2', 'moyasar', 'failed', 1.00, 'SAR', 'live',
     'pay_crosslinked', now() + interval '6 minutes');

  -- Refunds. Alice's failed, with every internal column filled; Bob's done.
  insert into public.order_refunds
    (order_id, payment_record_id, provider, charge_ref, provider_ref, idempotency_key,
     amount, currency, status, attempt_count, claim_token, reason, failure_code,
     last_error_safe, created_at)
  values
    (v_ord_a2, v_pay_a1, 'moyasar', 'pay_alice_paid', 'pay_alice_paid', 'refund_ALICEIDEMPLANT',
     25.00, 'SAR', 'failed', 3, 'ALICE-CLAIM-PLANT', 'pos_delivery_failed_after_customer_retries',
     'ALICE-FAILCODE-PLANT', 'ALICE-LASTERROR-PLANT', now() + interval '5 minutes');
  insert into public.order_refunds
    (order_id, payment_record_id, provider, charge_ref, provider_ref, idempotency_key,
     amount, currency, status, attempt_count, claim_token, reason, created_at, completed_at)
  values
    (v_ord_b2, v_pay_b1, 'moyasar', 'pay_bob_paid', 'pay_bob_paid', 'refund_BOBIDEMPLANT',
     31.00, 'SAR', 'succeeded', 1, 'BOB-CLAIM-PLANT', 'bob_other_reason_plant',
     now() + interval '5 minutes', now() + interval '7 minutes');

  -- 14. Dave's card order, then Dave deletes his account. Deleting the
  -- auth.users row removes his profile (ON DELETE CASCADE), which removes his
  -- checkouts and every payment record tied to one (both cascade), and sets
  -- his order's customer_id to NULL (ON DELETE SET NULL). What survives is
  -- exactly what account deletion leaves behind: an order with no owner, its
  -- order-first payment record and its refund.
  insert into auth.users (id) values (c_dave);
  insert into public.orders
    (customer_id, order_number, customer_name, customer_phone, branch_id,
     branch_name_en, branch_name_ar, status, order_type,
     subtotal, delivery_fee, vat_amount, total, payment_method, payment_status,
     paid_at, created_at)
  select c_dave, 'SM-TEST-EXPORT-ORPHAN', 'Dave Test', '+966500000000', b.id, b.name_en,
         b.name_ar, 'received', 'pickup', 44.00, 0, 5.74, 44.00, 'online', 'paid',
         now() + interval '1 minute', now() + interval '1 minute'
    from public.branches b where b.id = v_branch
  returning id into v_ord_d1;
  insert into public.payment_records
    (order_id, provider, status, amount, currency, mode, provider_ref,
     card_scheme, card_last_four, confirmed_at, created_at, raw)
  values
    (v_ord_d1, 'moyasar', 'paid', 44.00, 'SAR', 'live', 'pay_orphan', 'visa', '9999',
     now() + interval '2 minutes', now() + interval '1 minute',
     jsonb_build_object('id', 'pay_orphan', 'status', 'paid',
       'source', jsonb_build_object('company', 'visa', 'last_four', '9999',
         'issuer_name', 'Orphan Bank')))
  returning id into v_pay_d1;
  insert into public.order_refunds
    (order_id, payment_record_id, provider, charge_ref, provider_ref, idempotency_key,
     amount, currency, status, attempt_count, claim_token, reason, created_at)
  values
    (v_ord_d1, v_pay_d1, 'moyasar', 'pay_orphan', 'pay_orphan', 'refund_ORPHANIDEMPLANT',
     44.00, 'SAR', 'pending', 0, 'ORPHAN-CLAIM-PLANT', 'pos_delivery_failed_after_customer_retries',
     now() + interval '5 minutes');
  delete from auth.users where id = c_dave;
  -- The test proves nothing unless the leftovers are really there, owner-less.
  if (select count(*) from public.orders where id = v_ord_d1 and customer_id is null) <> 1
     or (select count(*) from public.payment_records where id = v_pay_d1) <> 1
     or (select count(*) from public.order_refunds where order_id = v_ord_d1) <> 1
     or exists (select 1 from public.profiles where id = c_dave) then
    raise exception 'FAIL 14: the fixture is not what account deletion leaves behind';
  end if;

  -- What the export should return, counted from the rows by the rule itself:
  -- a record is a customer's when every link it has points at them.
  perform set_config('test.alice_payments', (
    select count(*)::text from public.payment_records r
     where (r.order_id is not null or r.checkout_session_id is not null)
       and (r.order_id is null or exists (
             select 1 from public.orders o where o.id = r.order_id and o.customer_id = c_alice))
       and (r.checkout_session_id is null or exists (
             select 1 from public.checkout_sessions s
              where s.id = r.checkout_session_id and s.customer_id = c_alice))), true);
  perform set_config('test.alice_checkouts', (
    select count(*)::text from public.checkout_sessions where customer_id = c_alice), true);
  perform set_config('test.alice_refunds', (
    select count(*)::text from public.order_refunds f join public.orders o on o.id = f.order_id
     where o.customer_id = c_alice), true);
end $$;

-- ============================================================================
-- 8-12. As Alice
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '0e100000-0000-0000-0000-0000000000a1';
do $$
declare
  v jsonb; v_txt text; v_keys text[]; v_p jsonb; v_c jsonb; v_r jsonb; v_t jsonb;
  v_plant text; v_sum numeric;
begin
  v := public.export_my_data();
  v_txt := v::text;

  -- 8. Exactly her own rows: counted against the rows, then matched by id.
  if current_setting('test.alice_payments')::int is distinct from 3 then
    raise exception 'FAIL 8: the fixture count is %, expected 3 — the fixtures changed', current_setting('test.alice_payments');
  end if;
  if jsonb_array_length(v -> 'payments') is distinct from current_setting('test.alice_payments')::int then
    raise exception 'FAIL 8: % payment records exported, % are hers', jsonb_array_length(v -> 'payments'), current_setting('test.alice_payments');
  end if;
  if jsonb_array_length(v -> 'checkouts') is distinct from current_setting('test.alice_checkouts')::int then
    raise exception 'FAIL 8: % checkouts exported, % are hers', jsonb_array_length(v -> 'checkouts'), current_setting('test.alice_checkouts');
  end if;
  if jsonb_array_length(v -> 'refunds') is distinct from current_setting('test.alice_refunds')::int then
    raise exception 'FAIL 8: % refunds exported, % are hers', jsonb_array_length(v -> 'refunds'), current_setting('test.alice_refunds');
  end if;
  if (select array_agg(coalesce(e ->> 'payment_id', e ->> 'invoice_id') order by e ->> 'started_at')
        from jsonb_array_elements(v -> 'payments') e)
     is distinct from array['pay_alice_paid', 'chg_alice_tap', 'inv_alice_abandoned'] then
    raise exception 'FAIL 8: the payment records are not exactly hers: %', v -> 'payments';
  end if;
  if (select array_agg(e ->> 'checkout_id' order by e ->> 'started_at')
        from jsonb_array_elements(v -> 'checkouts') e)
     is distinct from array['a1000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-0000000000a2',
                            'a1000000-0000-4000-8000-0000000000a3'] then
    raise exception 'FAIL 8: the checkouts are not exactly hers: %', v -> 'checkouts';
  end if;
  v_r := v #> '{refunds,0}';
  if v_r ->> 'order_number' is distinct from 'SM-TEST-EXPORT-2'
     or v_r ->> 'payment_id' is distinct from 'pay_alice_paid'
     or (v_r ->> 'amount')::numeric is distinct from 25.00
     or v_r ->> 'status' is distinct from 'failed' then
    raise exception 'FAIL 8: her refund reads %', v_r;
  end if;
  -- 16. The reason in words, both languages; the code itself nowhere.
  if v_r ->> 'reason' is distinct from 'Your order could not be sent to the branch, so we are returning your payment.'
     or v_r ->> 'reason_ar' is distinct from 'تعذّر إرسال طلبك إلى الفرع، لذلك نعيد إليك المبلغ الذي دفعته.' then
    raise exception 'FAIL 16: her refund''s reason reads % / %', v_r ->> 'reason', v_r ->> 'reason_ar';
  end if;

  -- 8, by content. Nothing of Bob's, from any of the three tables. 'Bob' alone
  -- also catches his bank's name and his checkout note.
  if v_txt ilike '%bob%' or position('pay_bob_paid' in v_txt) > 0
     or position('inv_bob' in v_txt) > 0
     -- Quoted, because a last four is a JSON string: bare digits could match the
     -- microseconds of a timestamp, the trap case 2 records.
     or position('"9876"' in v_txt) > 0
     or position('b1000000-0000-4000-8000' in v_txt) > 0
     or position('SM-TEST-EXPORT-B2' in v_txt) > 0 then
    raise exception 'FAIL 8: another customer''s payment data appears in the export';
  end if;

  -- 9. The record that touches both customers is in neither export.
  if position('pay_crosslinked' in v_txt) > 0 then
    raise exception 'FAIL 9: a payment record linked to another customer''s order was exported';
  end if;

  -- 14. Nothing of the deleted customer's.
  if position('pay_orphan' in v_txt) > 0 or position('SM-TEST-EXPORT-ORPHAN' in v_txt) > 0
     or position('Orphan Bank' in v_txt) > 0 or position('"9999"' in v_txt) > 0 then
    raise exception 'FAIL 14: a deleted customer''s payment or refund reached another customer''s export';
  end if;

  -- 10. What is left out, as keys...
  select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v) k;
  if v_keys is distinct from array['about', 'account', 'checkouts', 'generated_at',
       'loyalty_history', 'notification_devices', 'orders', 'payments', 'refunds',
       'saved_addresses'] then
    raise exception 'FAIL 10: top-level keys are %', v_keys;
  end if;
  for v_p in select e from jsonb_array_elements(v -> 'payments') e loop
    select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_p) k;
    if v_keys is distinct from array['amount', 'card_last_four', 'card_scheme',
         'checkout_id', 'confirmed_at', 'currency', 'expires_at', 'failed_at',
         'invoice_id', 'mode', 'note', 'order_number', 'payment_id', 'provider',
         'started_at', 'status', 'tries'] then
      raise exception 'FAIL 10: a payment record exports %', v_keys;
    end if;
    for v_t in select e from jsonb_array_elements(v_p -> 'tries') e loop
      select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_t) k;
      if v_keys is distinct from array['at', 'authorization_code', 'bank_message',
           'card_issuer', 'card_issuer_country', 'card_last_four', 'card_scheme',
           'method', 'payment_id', 'reference_number', 'response_code', 'status'] then
        raise exception 'FAIL 10: a try exports %', v_keys;
      end if;
    end loop;
  end loop;
  -- 10 and 15. A checkout that became her order gives its references only;
  -- every other checkout gives the full set.
  for v_c in select e from jsonb_array_elements(v -> 'checkouts') e loop
    select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_c) k;
    if v_c ->> 'order_number' is not null then
      if v_keys is distinct from array['checkout_id', 'completed_at', 'expires_at',
           'order_number', 'order_type', 'payment_method', 'started_at', 'status'] then
        raise exception 'FAIL 15: a checkout that became her order exports %', v_keys;
      end if;
    elsif v_keys is distinct from array['branch', 'checkout_id', 'comp_discount', 'comped',
         'completed_at', 'coupon_code', 'coupon_discount', 'currency', 'deliver_to',
         'delivery_fee', 'expires_at', 'items', 'loyalty_discount', 'order_number',
         'order_type', 'payment_method', 'points_redeemed', 'started_at', 'status',
         'subtotal', 'total', 'vat', 'your_note'] then
      raise exception 'FAIL 10: a checkout exports %', v_keys;
    end if;
  end loop;
  select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v #> '{refunds,0}') k;
  if v_keys is distinct from array['amount', 'completed_at', 'currency', 'order_number',
       'payment_id', 'provider', 'reason', 'reason_ar', 'requested_at', 'status'] then
    raise exception 'FAIL 10: a refund exports %', v_keys;
  end if;

  -- ...and as values: every planted value of every column left out.
  foreach v_plant in array array[
      'ALICE-URL-PLANT',                       -- checkout_url
      'sm_ALICEREFTXN', 'CS-ALICEREFORD',      -- reference_transaction, reference_order
      'invoice_expired',                       -- failure_code
      'ALICE-FEE-PLANT', 'ALICE-META-PLANT',   -- raw: Moyasar's fee, our metadata
      'ALICE-BIN-PLANT', 'ALICE-TOKEN-PLANT',  -- raw: anything unlisted in source
      'ALICE-TAP-REF-PLANT', 'ALICE-TAP-ORDER-PLANT', 'ALICE-MERCHANT-PLANT',  -- raw: Tap's internals
      'ALICE-RAW-COUPON', 'f1000000-0000-4000-8000',                           -- snapshot internals
      'alice-typed-coupon',                    -- the session's raw coupon column
      'ad100000-0000-4000-8000-0000000000a9',  -- the address row id inside the snapshot
      'TAP-BRAND-PLANT',                       -- Tap's brand, where its scheme is read
      'pos_delivery_failed_after_customer_retries',                            -- refund reason code
      'Alice consumed note',                   -- a completed checkout's copy of its order's note
      'd1000000-0000-4000-8000-00000000d1d1',  -- the checkout's idempotency key
      'refund_ALICEIDEMPLANT', 'ALICE-CLAIM-PLANT',                            -- refund idempotency key, lease token
      'ALICE-FAILCODE-PLANT', 'ALICE-LASTERROR-PLANT']                         -- refund error code and text
  loop
    if position(v_plant in v_txt) > 0 then
      raise exception 'FAIL 10: a value the export must leave out appears in it: %', v_plant;
    end if;
  end loop;

  -- 11. The card facts. The card that paid, from its columns, and every try
  -- the stored response holds, from the response, field by field.
  select e into v_p from jsonb_array_elements(v -> 'payments') e where e ->> 'payment_id' = 'pay_alice_paid';
  if v_p ->> 'card_scheme' is distinct from 'mada' or v_p ->> 'card_last_four' is distinct from '4242'
     or v_p ->> 'invoice_id' is distinct from 'inv_alice_paid'
     or v_p ->> 'order_number' is distinct from 'SM-TEST-EXPORT-2'
     or v_p ->> 'checkout_id' is distinct from 'a1000000-0000-4000-8000-0000000000a1'
     or v_p ->> 'status' is distinct from 'paid' or v_p ->> 'mode' is distinct from 'live'
     or (v_p ->> 'amount')::numeric is distinct from 25.00 or v_p ->> 'currency' is distinct from 'SAR'
     or v_p ->> 'confirmed_at' is null then
    raise exception 'FAIL 11: the paid record reads %', v_p;
  end if;
  if jsonb_array_length(v_p -> 'tries') is distinct from 1 then
    raise exception 'FAIL 11: the paid record has % tries, expected 1', jsonb_array_length(v_p -> 'tries');
  end if;
  v_t := v_p #> '{tries,0}';
  if v_t ->> 'payment_id' is distinct from 'pay_alice_paid' or v_t ->> 'status' is distinct from 'paid'
     or v_t ->> 'method' is distinct from 'creditcard'
     or v_t ->> 'card_scheme' is distinct from 'mada' or v_t ->> 'card_last_four' is distinct from '4242'
     or v_t ->> 'card_issuer' is distinct from 'Alice Paid Bank'
     or v_t ->> 'card_issuer_country' is distinct from 'SA'
     or v_t ->> 'bank_message' is distinct from 'APPROVED'
     or v_t ->> 'response_code' is distinct from '00'
     or v_t ->> 'authorization_code' is distinct from 'AUTH-ALICE'
     or v_t ->> 'reference_number' is distinct from 'RRN-ALICE'
     or v_t ->> 'at' is distinct from '2026-11-14T10:01:00.000Z' then
    raise exception 'FAIL 11: the paying try reads %', v_t;
  end if;

  select e into v_p from jsonb_array_elements(v -> 'payments') e where e ->> 'invoice_id' = 'inv_alice_abandoned';
  if v_p ->> 'payment_id' is not null or v_p ->> 'card_scheme' is not null
     or v_p ->> 'order_number' is not null
     or v_p ->> 'checkout_id' is distinct from 'a1000000-0000-4000-8000-0000000000a2'
     or v_p ->> 'note' is distinct from 'Payment session expired'
     or v_p ->> 'status' is distinct from 'failed' or v_p ->> 'failed_at' is null then
    raise exception 'FAIL 11: the abandoned record reads %', v_p;
  end if;
  if (select array_agg((x.e ->> 'payment_id') || ':' || (x.e ->> 'card_scheme') || ':' || (x.e ->> 'card_last_four')
                        || ':' || (x.e ->> 'card_issuer') || ':' || (x.e ->> 'bank_message') order by x.n)
        from jsonb_array_elements(v_p -> 'tries') with ordinality as x(e, n))
     is distinct from array['pay_alice_try1:visa:1111:Alice Visa Bank:Insufficient Funds',
                            'pay_alice_try2:mada:5555:Alice Mada Bank:Declined'] then
    raise exception 'FAIL 11: the declined tries read %', v_p -> 'tries';
  end if;

  select e into v_p from jsonb_array_elements(v -> 'payments') e where e ->> 'payment_id' = 'chg_alice_tap';
  if v_p ->> 'provider' is distinct from 'tap' or v_p ->> 'mode' is distinct from 'test'
     or v_p ->> 'order_number' is distinct from 'SM-TEST-EXPORT-3' or v_p ->> 'checkout_id' is not null
     or jsonb_array_length(v_p -> 'tries') is distinct from 1
     or v_p #>> '{tries,0,card_scheme}' is distinct from 'VISA'
     or v_p #>> '{tries,0,card_last_four}' is distinct from '0007'
     or v_p #>> '{tries,0,bank_message}' is distinct from 'Do not honor'
     or v_p #>> '{tries,0,response_code}' is distinct from '05'
     or v_p #>> '{tries,0,method}' is distinct from 'VISA'
     or v_p #>> '{tries,0,card_issuer}' is not null then
    raise exception 'FAIL 11: the Tap record reads %', v_p;
  end if;

  -- 12. A checkout that never became an order carries its lines, and they
  -- reconcile with its subtotal.
  select e into v_c from jsonb_array_elements(v -> 'checkouts') e
   where e ->> 'checkout_id' = 'a1000000-0000-4000-8000-0000000000a2';
  if v_c ->> 'status' is distinct from 'expired' or v_c ->> 'order_number' is not null
     or v_c ->> 'completed_at' is not null or v_c ->> 'branch' is distinct from 'Export branch'
     or v_c ->> 'your_note' is distinct from 'Alice checkout note'
     or v_c ->> 'payment_method' is distinct from 'online'
     or v_c ->> 'order_type' is distinct from 'delivery'
     or jsonb_array_length(v_c -> 'items') is distinct from 2 then
    raise exception 'FAIL 12: the abandoned checkout reads %', v_c;
  end if;
  -- 15. The coupon as priced, not as typed; the address as it was, without
  -- the address row's id or her own customer id.
  if v_c ->> 'coupon_code' is distinct from 'ALICE15' then
    raise exception 'FAIL 15: the coupon reads %, expected the priced ALICE15', v_c ->> 'coupon_code';
  end if;
  select array_agg(k order by k collate "C") into v_keys from jsonb_object_keys(v_c -> 'deliver_to') k;
  if v_keys is distinct from array['description', 'is_default', 'label', 'latitude', 'longitude',
       'national_short_address']
     or v_c #>> '{deliver_to,label}' is distinct from 'Alice home' then
    raise exception 'FAIL 15: the address reads %', v_c -> 'deliver_to';
  end if;
  select sum((e ->> 'line_total')::numeric) into v_sum from jsonb_array_elements(v_c -> 'items') e;
  if v_sum is distinct from (v_c ->> 'subtotal')::numeric then
    raise exception 'FAIL 12: its lines add up to %, its subtotal is %', v_sum, v_c ->> 'subtotal';
  end if;
  if v_c #>> '{items,0,item}' is distinct from 'Zinger meal'
     or v_c #>> '{items,0,variant}' is distinct from 'Large'
     or v_c #>> '{items,0,your_note}' is distinct from 'No onions'
     or v_c #>> '{items,0,add_ons,0,name}' is distinct from 'Extra sauce'
     or (v_c #>> '{items,0,add_ons,0,price}')::numeric is distinct from 2.00
     or v_c #>> '{items,1,item}' is distinct from 'Lemon mint'
     or jsonb_typeof(v_c #> '{items,1,add_ons}') is distinct from 'array' then
    raise exception 'FAIL 12: its lines read %', v_c -> 'items';
  end if;
  select e into v_c from jsonb_array_elements(v -> 'checkouts') e
   where e ->> 'checkout_id' = 'a1000000-0000-4000-8000-0000000000a1';
  if v_c ->> 'status' is distinct from 'consumed'
     or v_c ->> 'order_number' is distinct from 'SM-TEST-EXPORT-2'
     or v_c ->> 'completed_at' is null
     or v_c ? 'items' or v_c ? 'total' then
    raise exception 'FAIL 15: the completed checkout reads %', v_c;
  end if;
  -- 15. Her checkout that points at Bob's order: no order number, so its own
  -- details stand instead.
  select e into v_c from jsonb_array_elements(v -> 'checkouts') e
   where e ->> 'checkout_id' = 'a1000000-0000-4000-8000-0000000000a3';
  if v_c ->> 'order_number' is not null or (v_c ->> 'total')::numeric is distinct from 7.00 then
    raise exception 'FAIL 15: the checkout linked to another customer''s order reads %', v_c;
  end if;

  -- 13 (Alice's half). Every key that existed before is still there, with its
  -- type.
  if jsonb_typeof(v -> 'account') is distinct from 'object' or jsonb_typeof(v -> 'orders') is distinct from 'array'
     or jsonb_typeof(v -> 'saved_addresses') is distinct from 'array'
     or jsonb_typeof(v -> 'loyalty_history') is distinct from 'array'
     or jsonb_typeof(v -> 'notification_devices') is distinct from 'array'
     or jsonb_typeof(v -> 'about') is distinct from 'string' or v ->> 'generated_at' is null then
    raise exception 'FAIL 13: a key that existed before changed shape';
  end if;
  if jsonb_array_length(v -> 'orders') is distinct from 3 then
    raise exception 'FAIL 13: % orders exported, expected her 3', jsonb_array_length(v -> 'orders');
  end if;

  raise notice 'cases 8-12, 14-16 ok -- her payment records, checkouts and refunds, nothing of anyone else''s or of a deleted customer''s, nothing left out leaked';
end $$;
reset role;

-- ============================================================================
-- 8-9 again, as Bob: the same rule from the other side.
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '0e100000-0000-0000-0000-0000000000b2';
do $$
declare v jsonb; v_txt text;
begin
  v := public.export_my_data();
  v_txt := v::text;
  if (select array_agg(coalesce(e ->> 'payment_id', e ->> 'invoice_id') order by e ->> 'started_at')
        from jsonb_array_elements(v -> 'payments') e)
     is distinct from array['pay_bob_paid', 'inv_bob_abandoned'] then
    raise exception 'FAIL 8b: Bob''s payment records are %', v -> 'payments';
  end if;
  if jsonb_array_length(v -> 'checkouts') is distinct from 2 or jsonb_array_length(v -> 'refunds') is distinct from 1
     or v #>> '{refunds,0,payment_id}' is distinct from 'pay_bob_paid'
     or v #>> '{payments,0,tries,0,card_issuer}' is distinct from 'Bob Card Bank' then
    raise exception 'FAIL 8b: Bob''s checkouts or refunds are wrong';
  end if;
  -- 16. A code with no words of its own reads as a plain refund, in both
  -- languages; the code itself is not exported.
  if v #>> '{refunds,0,reason}' is distinct from 'A refund of your payment.'
     or v #>> '{refunds,0,reason_ar}' is distinct from 'استرداد المبلغ الذي دفعته.'
     or position('bob_other_reason_plant' in v_txt) > 0 then
    raise exception 'FAIL 16: Bob''s refund reason reads %', v -> 'refunds';
  end if;
  if position('bob-typed-coupon' in v_txt) > 0 then
    raise exception 'FAIL 15: Bob''s raw typed coupon was exported';
  end if;
  if position('pay_orphan' in v_txt) > 0 or position('SM-TEST-EXPORT-ORPHAN' in v_txt) > 0
     or position('Orphan Bank' in v_txt) > 0 then
    raise exception 'FAIL 14: a deleted customer''s payment or refund reached Bob''s export';
  end if;
  if v_txt ilike '%alice%' or position('pay_crosslinked' in v_txt) > 0
     or position('a1000000-0000-4000-8000' in v_txt) > 0
     or position('BOB-CLAIM-PLANT' in v_txt) > 0 or position('refund_BOBIDEMPLANT' in v_txt) > 0 then
    raise exception 'FAIL 8b/9/10: Bob''s export carries Alice''s data, the cross-linked record, or his refund''s internals';
  end if;
  raise notice 'case 8b ok -- Bob gets his own rows and none of Alice''s';
end $$;
reset role;

-- ============================================================================
-- 13. The honest empty case: a customer with no payments.
-- ============================================================================
set local role authenticated;
set local request.jwt.claim.sub = '0e100000-0000-0000-0000-0000000000c3';
do $$
declare v jsonb; v_key text;
begin
  v := public.export_my_data();
  foreach v_key in array array['payments', 'checkouts', 'refunds'] loop
    if v -> v_key is distinct from '[]'::jsonb then
      raise exception 'FAIL 13: % is %, expected []', v_key, coalesce((v -> v_key)::text, 'null');
    end if;
  end loop;
  if jsonb_typeof(v -> 'account') is distinct from 'object' then
    raise exception 'FAIL 13: the account of a customer with no payments is missing';
  end if;
  -- 14, the plainest form: a customer with no rows at all still gets none of
  -- the deleted customer's.
  if position('pay_orphan' in v::text) > 0 or position('SM-TEST-EXPORT-ORPHAN' in v::text) > 0 then
    raise exception 'FAIL 14: a deleted customer''s payment or refund reached Carol''s export';
  end if;
  raise notice 'cases 13-14 ok -- no payments, three empty lists, nothing of a deleted customer''s';
end $$;
reset role;

rollback;
