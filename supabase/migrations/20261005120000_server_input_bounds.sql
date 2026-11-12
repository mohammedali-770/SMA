-- ============================================================================
-- SERVER INPUT BOUNDS AND ORDER LIMITS
--
-- Five gaps from the 2026-11-11 assessment, plus one bug found while fixing
-- them. Each rule here already existed in the app and nowhere else, or did not
-- exist at all. The app is not a security boundary: a signed-in customer can
-- call PostgREST with the same key and the same session the app uses.
--
--  1. S04#1. order_items.quantity had no upper bound. A cash order of 1,000,000
--     units of one item passed every check, reached the POS sync queue and
--     wrote a 27,000,000-point earn_pending row. place_customer_order now
--     refuses a line above 50 (item 5). The largest real line in Production is
--     7 (read 2026-11-12). It is a guard in the cash wrapper, not a table
--     CHECK: a CHECK on order_items would also bind insert_order_from_snapshot,
--     which writes a paid order's lines after the charge is captured, and that
--     path is frozen (CLAUDE.md section 6; Codex review on #445).
--
--  2. S04#2. profiles.full_name, profiles.email, addresses.label and the
--     address coordinates were validated only in the app. A name of 9,934
--     characters with a newline and bidi override characters was copied into
--     orders.customer_name and sent to the POS as the ticket's customer name.
--     New BEFORE triggers, in the convention of enforce_address_description
--     and enforce_order_note: they check a row when it is created and when the
--     guarded column changes, so an existing row stays updatable on every
--     other column. handle_new_user now trims a long metadata name instead of
--     letting the new trigger refuse the signup.
--
--  3. The villa bug. 20260802120000 trims landmarks with E' \t\r\n\f\v'.
--     PostgreSQL's escape strings have no \v, so that character is the LETTER
--     v: btrim('villa', E' \t\n\r\f\v') is 'illa'. A five-letter landmark
--     starting or ending in v was refused, and the real vertical tab was never
--     trimmed. The function is redefined with chr(11); nothing else changes.
--     (20260819120000 already avoided this for order notes, and its suite
--     says why.)
--
--  4. S05#3. storage.objects has no SELECT policy for the two image buckets.
--     Supabase Storage deletes only rows the caller can also SELECT, so an
--     administrator's remove() matched nothing and returned success. Old
--     banner and product images stayed public. New SELECT policies for
--     administrators only, and only while the Storage server is running a
--     delete: listing stays closed for everyone, administrators included.
--
--  5. S07#1 and S02#1, in public.place_customer_order ONLY. That wrapper is
--     what customers can execute; place_order is not granted to them
--     (20260724200000). The wrapper now:
--       - refuses a line of more than 50 of one item, for every caller and
--         every call, retries included;
--       - serialises one customer's calls with a transaction advisory lock;
--       - refuses a profile that is not phone_verified;
--       - refuses a customer who already has order_limit_open open orders
--         placed in the last 24 hours (default 5);
--       - refuses a customer who placed order_limit_per_hour orders in the
--         last hour (default 10).
--     An idempotent retry of an order that already exists skips the last
--     three, so a lost response can still be recovered.
--
-- WHAT THIS DOES NOT TOUCH
--   - place_order and compute_order_snapshot. The money-path pair is asserted
--     unchanged at the end (12b6816d... / 22e2d429...).
--   - The online checkout-session path (begin_checkout_session,
--     begin_*_attempt, insert_order_from_snapshot). It is frozen under
--     CLAUDE.md section 6. Two consequences, stated rather than hidden:
--       a. the line cap does not cover online orders: compute_order_snapshot
--          accepts a line above 50, exactly as it does today, and this file
--          leaves the snapshot insert alone. Before online payment is
--          enabled, the payment change must refuse such a snapshot before any
--          charge is created; a table-wide CHECK can follow it then.
--       b. the phone rule and the order limits do not cover online orders.
--     Online payment is disabled today, so neither is reachable.
--   - Existing rows. The triggers do not run on existing rows. Production
--     complies (2026-11-12:
--     longest name 13, longest email 29, longest label 24, 0 coordinates out
--     of range across 3 addresses, largest quantity 7).
--
-- NOT APPLIED TO PRODUCTION by this change. Applying it is a CLAUDE.md
-- section 5 action, named by version. Never bulk-apply: the frozen Moyasar
-- file 20260824100000 sorts ahead of this one.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Preconditions. Fail before changing anything.
-- ---------------------------------------------------------------------------
do $pre$
begin
  -- The storage policies call these. If authenticated could not execute them,
  -- every storage.objects query that applies SELECT policies would fail with
  -- 42501, admin uploads included. Read live 2026-11-12: all three exist;
  -- their grants were not read, so this check is what proves them.
  if to_regprocedure('storage.operation()') is null
     or to_regprocedure('storage.allow_any_operation(text[])') is null then
    raise exception 'server input bounds: storage.operation() or storage.allow_any_operation(text[]) is missing';
  end if;
  if not has_function_privilege('authenticated', 'storage.allow_any_operation(text[])', 'execute')
     or not has_function_privilege('authenticated', 'storage.operation()', 'execute') then
    raise exception 'server input bounds: authenticated cannot execute the storage operation helpers';
  end if;
  if not exists (select 1 from storage.buckets where id = 'product-images')
     or not exists (select 1 from storage.buckets where id = 'banner-images') then
    raise exception 'server input bounds: a bucket id is not what the policies expect';
  end if;
end
$pre$;


-- ---------------------------------------------------------------------------
-- 1. S04#1 — order_items.quantity upper bound
-- ---------------------------------------------------------------------------
-- Enforced in place_customer_order (section 5), which every customer order
-- goes through, app and console alike. NOT as a CHECK on order_items: a
-- constraint there would also bind insert_order_from_snapshot, the frozen
-- payment path that writes a paid order's lines after the charge is captured,
-- so a 51-unit snapshot would be charged and then fail. Its own verification
-- (6.1) refuses to land if any upper bound on order_items.quantity exists.
--
-- 50 is a proposal the owner must confirm (docs/OWNER_ACTIONS.md section 48).
-- The app caps its steppers at the same number (apps/mobile/src/features/cart/
-- quantityLimit.ts), and a test fails if the two disagree.


-- ---------------------------------------------------------------------------
-- 2. S04#2 — profile name and email
-- ---------------------------------------------------------------------------
-- The characters a name may not contain: C0 and C1 controls, DEL, and the
-- Unicode bidirectional formatting characters (U+061C, U+200E, U+200F,
-- U+202A..U+202E, U+2066..U+2069), which can reverse how a ticket prints.
-- Whitespace controls (tab, newline) are folded to a space by the normaliser
-- first, exactly as the app's normalizeCustomerName does, so only the rest are
-- refused. The app's letters-only rule is NOT mirrored: the server bounds what
-- can harm a ticket, not what a name may look like.
create or replace function public.profile_name_normalized(p_name text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(btrim(regexp_replace(p_name, '\s+', ' ', 'g'), ' '), '');
$$;

comment on function public.profile_name_normalized(text) is
  'A profile name with runs of whitespace folded to one space, trimmed, and NULL when empty. Mirrors normalizeCustomerName in the mobile app (20261005120000).';

-- authenticated MUST keep EXECUTE on both helpers. The trigger below is not
-- SECURITY DEFINER: it runs as the customer whose PATCH fired it, so a revoke
-- here makes every name update fail with 42501. (Superuser sessions can hide
-- that: a plan cached while running as postgres inlines the SQL function and
-- skips the check. The suite discards plans before impersonating for this
-- reason.) Both are pure functions over their argument.
revoke all on function public.profile_name_normalized(text) from public, anon;
grant execute on function public.profile_name_normalized(text) to authenticated;

-- The bidirectional formatting characters are written as \uXXXX regex escapes,
-- not as raw characters: a raw one is invisible in a diff and in the SQL an
-- inline apply transports, so a changed or dropped one would change this rule
-- with nothing to see. The set is U+061C, U+200E, U+200F, U+202A-U+202E and
-- U+2066-U+2069; 6.3 below calls the function on each of the twelve.
create or replace function public.profile_name_has_control_chars(p_name text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    p_name ~ '[\x01-\x1f\x7f-\x9f\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]',
    false);
$$;

comment on function public.profile_name_has_control_chars(text) is
  'True when a name holds a C0/C1 control, DEL, or a Unicode bidirectional formatting character (20261005120000).';

revoke all on function public.profile_name_has_control_chars(text) from public, anon;
grant execute on function public.profile_name_has_control_chars(text) to authenticated;

create or replace function public.enforce_profile_text_bounds()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' or new.full_name is distinct from old.full_name then
    new.full_name := public.profile_name_normalized(new.full_name);
    if public.profile_name_has_control_chars(new.full_name) then
      raise exception
        using
          errcode = 'check_violation',
          message = 'Your name contains characters that cannot be used.',
          detail  = 'profiles.full_name may not contain control or bidirectional formatting characters.',
          hint    = 'Use letters and spaces only.';
    end if;
    if char_length(new.full_name) > 80 then
      raise exception
        using
          errcode = 'check_violation',
          message = 'Your name is too long. Keep it under 80 characters.',
          detail  = format('profiles.full_name must be at most 80 characters; got %s.',
                           char_length(new.full_name));
    end if;
  end if;

  if (tg_op = 'INSERT' or new.email is distinct from old.email)
     and char_length(new.email) > 254 then
    raise exception
      using
        errcode = 'check_violation',
        message = 'The email address is too long.',
        detail  = format('profiles.email must be at most 254 characters; got %s.',
                         char_length(new.email));
  end if;

  return new;
end;
$$;

comment on function public.enforce_profile_text_bounds() is
  'Normalises profiles.full_name and refuses a name over 80 characters or holding control/bidi characters, and an email over 254 characters, on insert or when the column changes (20261005120000).';

revoke all on function public.enforce_profile_text_bounds() from public, anon, authenticated;

drop trigger if exists trg_profiles_text_bounds on public.profiles;
create trigger trg_profiles_text_bounds
  before insert or update of full_name, email on public.profiles
  for each row execute function public.enforce_profile_text_bounds();

-- handle_new_user runs on every auth.users insert: the WhatsApp/phone signup
-- and staff-accounts provisioning (admin.createUser with user_metadata
-- full_name). If the trigger above could refuse its insert, a long or odd
-- metadata name would block the signup itself. So the metadata name is made
-- acceptable here: control characters removed, normalised, cut to 80
-- characters. An email over 254 characters is not copied; auth.users still
-- holds it. Everything else is the body from 20260827100000, unchanged.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := public.profile_name_normalized(
    regexp_replace(
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
      '[\x01-\x08\x0e-\x1f\x7f-\x9f\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]', '', 'g'));
  v_name := public.profile_name_normalized(left(v_name, 80));

  insert into public.profiles (id, full_name, phone_number, email, phone_verified, phone_verified_at)
  values (
    new.id,
    v_name,
    new.phone,
    case when char_length(new.email) <= 254 then new.email end,
    (new.phone_confirmed_at is not null),
    new.phone_confirmed_at
  )
  on conflict (id) do nothing;

  -- Only a number Auth has already confirmed at insert time. An unconfirmed
  -- signup claims nothing here; it claims below, when the OTP lands.
  if new.phone_confirmed_at is not null then
    perform public.claim_comp_membership(new.id, new.phone);
  end if;

  return new;
end $$;


-- ---------------------------------------------------------------------------
-- 2b. S04#2 — address label and coordinates
-- ---------------------------------------------------------------------------
-- The label is measured as stored. The app trims and cuts it to 60 before
-- sending (addressForm.ts, OrderTypeSelectScreen), so measuring after a trim
-- here would only let padding through. A coordinate may still be NULL, as
-- before; NaN and infinity are out of range.
create or replace function public.enforce_address_bounds()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' or new.label is distinct from old.label)
     and char_length(new.label) > 60 then
    raise exception
      using
        errcode = 'check_violation',
        message = 'The address name is too long. Keep it under 60 characters.',
        detail  = format('addresses.label must be at most 60 characters; got %s.',
                         char_length(new.label));
  end if;

  if tg_op = 'INSERT'
     or new.latitude is distinct from old.latitude
     or new.longitude is distinct from old.longitude then
    if (new.latitude is not null and not (new.latitude between -90 and 90))
       or (new.longitude is not null and not (new.longitude between -180 and 180)) then
      raise exception
        using
          errcode = 'check_violation',
          message = 'The location is not a valid point on the map.',
          detail  = 'addresses.latitude must be between -90 and 90 and longitude between -180 and 180.';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.enforce_address_bounds() is
  'Refuses an address label over 60 characters and coordinates outside -90..90 / -180..180, on insert or when the column changes (20261005120000).';

revoke all on function public.enforce_address_bounds() from public, anon, authenticated;

drop trigger if exists trg_addresses_bounds on public.addresses;
create trigger trg_addresses_bounds
  before insert or update of label, latitude, longitude on public.addresses
  for each row execute function public.enforce_address_bounds();


-- ---------------------------------------------------------------------------
-- 3. The villa bug — address_description_is_usable trims the letter v
-- ---------------------------------------------------------------------------
-- Same name, signature, language, volatility and search_path as
-- 20260802120000, so trg_addresses_require_description keeps working
-- untouched. The only change is the trim set: \x0B is the vertical tab, where
-- \v was the letter v. Strictly a correction: 'villa' becomes acceptable, and a
-- landmark of vertical tabs stops qualifying.
create or replace function public.address_description_is_usable(p_description text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  -- The character set is EXPLICIT. btrim's default is a space and only a
  -- space. Write the vertical tab as \x0B: PostgreSQL has no \v escape, and
  -- E'\v' is the letter v (20261005120000 fixed exactly that here).
  select p_description is not null
     and char_length(btrim(p_description, E' \t\r\n\f\x0B')) >= 5
     and char_length(btrim(p_description, E' \t\r\n\f\x0B')) <= 500;
$$;

comment on function public.address_description_is_usable(text) is
  'True when a delivery address description is a usable landmark (5..500 chars after trimming ASCII whitespace: space, tab, CR, LF, form feed, vertical tab). Mirrors the mobile client rule. The vertical tab is written \x0B because E''\v'' is the letter v (20261005120000).';


-- ---------------------------------------------------------------------------
-- 4. S05#3 — administrators can delete the images they upload
-- ---------------------------------------------------------------------------
-- Supabase Storage authorises a delete by running it as the caller, under RLS,
-- with RETURNING (supabase/storage src/storage/object.ts, deleteObjects ->
-- authorizeDeleteTargets). PostgreSQL applies SELECT policies to a DELETE that
-- returns or filters rows, so with no SELECT policy the delete matched nothing.
--
-- The policy is scoped to the delete operation with storage.allow_any_operation.
-- The Storage server sets the transaction-local storage.operation from the
-- route (src/internal/database/postgres/scope.ts: set_config('storage.operation',
-- ...)). The two delete routes set 'storage.object.delete' (one object) and
-- 'storage.object.delete_many' (remove(), which the console uses), per
-- src/http/routes/operations.ts at commit d0461d8748fc0f8346a25d3743155e15aa3ce091
-- (2026-11-10). Both names are unchanged since at least 4c945f9 (2025-01-09).
-- allow_any_operation strips a leading 'storage.' from both sides.
--
-- So an administrator still cannot LIST either bucket; the rows become visible
-- only inside a delete. No anon or customer SELECT is added. Splinter lint 0025
-- (public_bucket_allows_listing) flags only a qual that is empty, true, or a
-- bare bucket_id comparison, so neither policy matches it.
drop policy if exists product_images_admin_delete_select on storage.objects;
create policy product_images_admin_delete_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'product-images'
    and public.is_admin()
    and storage.allow_any_operation(array['object.delete', 'object.delete_many'])
  );

drop policy if exists banner_images_admin_delete_select on storage.objects;
create policy banner_images_admin_delete_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'banner-images'
    and public.is_admin()
    and storage.allow_any_operation(array['object.delete', 'object.delete_many'])
  );


-- ---------------------------------------------------------------------------
-- 5. S07#1 and S02#1 — limits in the customer wrapper
-- ---------------------------------------------------------------------------
-- Thresholds live in app_settings so the owner can tune them without a
-- migration. app_settings grants are table-level, so both columns are readable
-- by anon and authenticated like every other setting; they are not secret.
alter table public.app_settings
  add column if not exists order_limit_open integer not null default 5,
  add column if not exists order_limit_per_hour integer not null default 10;

alter table public.app_settings
  drop constraint if exists app_settings_order_limit_open_check;
alter table public.app_settings
  add constraint app_settings_order_limit_open_check
  check (order_limit_open between 1 and 100);
alter table public.app_settings
  drop constraint if exists app_settings_order_limit_per_hour_check;
alter table public.app_settings
  add constraint app_settings_order_limit_per_hour_check
  check (order_limit_per_hour between 1 and 100);

comment on column public.app_settings.order_limit_open is
  'place_customer_order refuses a customer who already has this many orders in received/preparing/ready/out_for_delivery placed in the last 24 hours (20261005120000).';
comment on column public.app_settings.order_limit_per_hour is
  'place_customer_order refuses a customer who placed this many orders in the last hour, any status (20261005120000).';

-- The wrapper. The projection below is byte-for-byte the one from
-- 20260724200000; only the guard block before the place_order call is new.
--
-- WHY THE LOCK. Without it two concurrent calls by one customer both count
-- before either has inserted, and both pass. place_order's own
-- `profiles ... for update` does not help, because it is taken AFTER the
-- count. The lock is transaction-scoped, keyed on the caller, so different
-- customers never wait on each other.
--
-- WHY 24 HOURS ON THE OPEN COUNT. orders.status moves only when staff move it
-- in the console; the POS webhook writes lazywait_status, not status. A cash
-- order placed 2026-09-26 is still 'received' today. Without a window, a
-- customer whose old orders were never closed would be refused for ever.
create or replace function public.place_customer_order(
  p_branch_id       uuid,
  p_order_type      public.order_type,
  p_items           jsonb,
  p_address_id      uuid    default null,
  p_coupon_code     text    default null,
  p_notes           text    default null,
  p_loyalty_points  integer default 0,
  p_idempotency_key uuid    default null,
  p_payment_method  text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order      public.orders;
  v_uid        uuid := auth.uid();
  v_verified   boolean;
  v_open_limit integer;
  v_hour_limit integer;
  v_open       integer;
  v_hour       integer;
begin
  -- S04#1. At most 50 of one item per line, read exactly as place_order reads
  -- it. The constraint name in the message is what the app matches on.
  if jsonb_typeof(p_items) = 'array' and exists (
       select 1 from jsonb_array_elements(p_items) as e(value)
        where coalesce((e.value ->> 'quantity')::int, 0) > 50) then
    raise exception
      using
        errcode    = '23514',
        constraint = 'order_items_quantity_max',
        message    = 'order_items_quantity_max: at most 50 of one item per order line.';
  end if;

  -- No caller: place_order raises its own 28000, unchanged.
  if v_uid is not null then
    perform pg_advisory_xact_lock(hashtext('spicymeal:place-customer-order:' || v_uid::text));

    -- A retry of an order that already exists is not a new order. place_order
    -- returns the existing row for it, so the limits must not refuse it.
    if p_idempotency_key is null
       or not exists (select 1 from public.orders o
                       where o.customer_id = v_uid
                         and o.idempotency_key = p_idempotency_key) then

      select p.phone_verified into v_verified
        from public.profiles p where p.id = v_uid;
      if v_verified is distinct from true then
        raise exception
          using
            errcode = 'P0001',
            message = 'Please verify your phone number before placing an order.',
            hint    = 'Sign in with your WhatsApp number.';
      end if;

      select s.order_limit_open, s.order_limit_per_hour
        into v_open_limit, v_hour_limit
        from public.app_settings s where s.id = true;
      v_open_limit := coalesce(v_open_limit, 5);
      v_hour_limit := coalesce(v_hour_limit, 10);

      select count(*) into v_open
        from public.orders o
       where o.customer_id = v_uid
         and o.status in ('received', 'preparing', 'ready', 'out_for_delivery')
         and o.created_at > now() - interval '24 hours';
      if v_open >= v_open_limit then
        raise exception
          using
            errcode = 'P0001',
            message = format('You already have %s orders in progress. Please wait until one is ready before placing another.', v_open);
      end if;

      select count(*) into v_hour
        from public.orders o
       where o.customer_id = v_uid
         and o.created_at > now() - interval '1 hour';
      if v_hour >= v_hour_limit then
        raise exception
          using
            errcode = 'P0001',
            message = format('You have placed %s orders in the last hour. Please try again later.', v_hour);
      end if;
    end if;
  end if;

  v_order := public.place_order(
    p_branch_id, p_order_type, p_items, p_address_id, p_coupon_code,
    p_notes, p_loyalty_points, p_idempotency_key, p_payment_method);

  -- EXPLICIT customer-safe projection, identical to the §1 column grant. No
  -- order_number, no pos_create_attempt_token, no POS/integration/refund/
  -- idempotency internals, no staff notes, no customer PII copies.
  return jsonb_build_object(
    'id',                        v_order.id,
    'status',                    v_order.status,
    'order_type',                v_order.order_type,
    'created_at',                v_order.created_at,
    'branch_id',                 v_order.branch_id,
    'branch_name_en',            v_order.branch_name_en,
    'branch_name_ar',            v_order.branch_name_ar,
    'subtotal',                  v_order.subtotal,
    'delivery_fee',              v_order.delivery_fee,
    'discount_amount',           v_order.discount_amount,
    'loyalty_discount_amount',   v_order.loyalty_discount_amount,
    'vat_amount',                v_order.vat_amount,
    'total',                     v_order.total,
    'loyalty_points_earned',     v_order.loyalty_points_earned,
    'payment_status',            v_order.payment_status,
    'payment_method',            v_order.payment_method,
    'lazywait_order_number',     v_order.lazywait_order_number,
    'lazywait_sync_state',       v_order.lazywait_sync_state,
    'lazywait_ref',              v_order.lazywait_ref,
    'sync_blocked_reason',       v_order.sync_blocked_reason,
    'sync_next_attempt_at',      v_order.sync_next_attempt_at,
    'pos_create_attempted_at',   v_order.pos_create_attempted_at,
    'pos_customer_retry_count',  v_order.pos_customer_retry_count,
    'refund_state',              v_order.refund_state
  );
end $$;

-- create or replace keeps the existing ACL. Restated so the grant does not
-- depend on history, and asserted below.
revoke all on function public.place_customer_order(
  uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text
) from public, anon;
grant execute on function public.place_customer_order(
  uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text
) to authenticated;

comment on function public.place_customer_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text) is
  'Customer-facing wrapper over the UNCHANGED place_order. Refuses a caller who is not phone_verified or is over app_settings.order_limit_open / order_limit_per_hour, serialised per caller (20261005120000); otherwise identical pricing, coupons, VAT, loyalty, transactionality and idempotency, returning an explicit customer-safe projection (20260724200000).';


-- ---------------------------------------------------------------------------
-- 6. Self-verification. Outcomes, not statements.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_txt  text;
  v_n    integer;
  v_open integer;
  v_hour integer;
begin
  -- 6.1 No upper bound on order_items.quantity. One there would bind the
  -- frozen snapshot insert too; the cap lives in the wrapper (6.7).
  select count(*) into v_n
    from pg_constraint c
   where c.conrelid = 'public.order_items'::regclass
     and c.contype = 'c'
     and (c.conname = 'order_items_quantity_max'
          or pg_get_constraintdef(c.oid) ~* 'quantity\s*(<|<=)');
  if v_n is distinct from 0 then
    raise exception 'server input bounds: % upper bound(s) on order_items.quantity, which would change the frozen snapshot path', v_n;
  end if;

  -- 6.2 Both triggers exist, are enabled, and fire on the guarded columns.
  select count(*) into v_n
    from pg_trigger t
   where not t.tgisinternal and t.tgenabled = 'O'
     and ((t.tgrelid = 'public.profiles'::regclass and t.tgname = 'trg_profiles_text_bounds'
           and t.tgfoid = 'public.enforce_profile_text_bounds()'::regprocedure)
       or (t.tgrelid = 'public.addresses'::regclass and t.tgname = 'trg_addresses_bounds'
           and t.tgfoid = 'public.enforce_address_bounds()'::regprocedure));
  if v_n is distinct from 2 then
    raise exception 'server input bounds: expected 2 enabled bound triggers, found %', v_n;
  end if;

  -- 6.2b The triggers run as the caller, so the caller must be able to run
  -- what they call. A revoke here would break every customer's name edit.
  if not has_function_privilege('authenticated', 'public.profile_name_normalized(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.profile_name_has_control_chars(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.address_description_is_usable(text)', 'execute') then
    raise exception 'server input bounds: authenticated cannot execute a helper its triggers call';
  end if;

  -- 6.3 The rules themselves, by calling them.
  if public.profile_name_normalized(E'  Mohammed \t\n Ali  ') is distinct from 'Mohammed Ali' then
    raise exception 'server input bounds: name normalisation is wrong';
  end if;
  if public.profile_name_has_control_chars('محمد علي') is distinct from false
     or public.profile_name_has_control_chars('evil' || chr(8238)) is distinct from true
     or public.profile_name_has_control_chars('a' || chr(7) || 'b') is distinct from true then
    raise exception 'server input bounds: the control-character rule is wrong';
  end if;
  -- Each of the twelve bidi formatting characters is refused, and the
  -- joiners Arabic and Persian names can carry (U+200C, U+200D) and the
  -- neighbours of each range are not.
  select count(*) into v_n
    from unnest(array[1564, 8206, 8207, 8234, 8235, 8236, 8237, 8238, 8294, 8295, 8296, 8297]) c
   where public.profile_name_has_control_chars('a' || chr(c) || 'b') is true;
  if v_n is distinct from 12 then
    raise exception 'server input bounds: % of the 12 bidi formatting characters are refused, expected 12', v_n;
  end if;
  select count(*) into v_n
    from unnest(array[1563, 1565, 8204, 8205, 8233, 8239, 8293, 8298]) c
   where public.profile_name_has_control_chars('a' || chr(c) || 'b') is distinct from false;
  if v_n is distinct from 0 then
    raise exception 'server input bounds: % characters outside the bidi set are refused, expected 0', v_n;
  end if;

  -- 6.4 The trim set holds a vertical tab and not the letter v.
  if public.address_description_is_usable('villa') is distinct from true
     or public.address_description_is_usable('vvvv v') is distinct from true
     or public.address_description_is_usable(repeat(chr(11), 6)) is distinct from false
     or public.address_description_is_usable(chr(11) || ' ab ' || chr(11)) is distinct from false then
    raise exception 'server input bounds: the landmark trim set still treats v as whitespace, or misses the vertical tab';
  end if;

  -- 6.5 Exactly the two intended SELECT policies, for authenticated only, each
  -- admin-gated and delete-scoped, and no SELECT policy on storage.objects for
  -- anon or public.
  select count(*) into v_n
    from pg_policies p
   where p.schemaname = 'storage' and p.tablename = 'objects'
     and p.policyname in ('product_images_admin_delete_select', 'banner_images_admin_delete_select')
     and p.cmd = 'SELECT' and p.permissive = 'PERMISSIVE'
     and p.roles = array['authenticated']::name[]
     and p.qual like '%is_admin()%'
     -- The operation list must be EXACTLY the two delete routes. A like over
     -- the qual would still match with 'object.list' appended, which would
     -- let an administrator list both buckets.
     and substring(p.qual from 'allow_any_operation\((ARRAY\[[^]]*\])\)')
           is not distinct from 'ARRAY[''object.delete''::text, ''object.delete_many''::text]'
     and (char_length(p.qual) - char_length(replace(p.qual, 'allow_any_operation', '')))
           = char_length('allow_any_operation')
     and p.qual !~* '\mor\M'
     and p.qual like '%bucket_id = ''' ||
           case p.policyname when 'product_images_admin_delete_select' then 'product-images'
                             else 'banner-images' end || '''%';
  if v_n is distinct from 2 then
    raise exception 'server input bounds: expected 2 admin delete-scoped SELECT policies, found %', v_n;
  end if;
  if exists (select 1 from pg_policies p
              where p.schemaname = 'storage' and p.tablename = 'objects'
                and p.cmd in ('SELECT', 'ALL')
                and p.roles && array['anon', 'public']::name[]) then
    raise exception 'server input bounds: a SELECT policy on storage.objects reaches anon or public';
  end if;

  -- 6.6 The thresholds hold their defaults on the live row.
  select s.order_limit_open, s.order_limit_per_hour into v_open, v_hour
    from public.app_settings s where s.id = true;
  if found and (v_open is distinct from 5 or v_hour is distinct from 10) then
    raise exception 'server input bounds: thresholds are %/%, expected 5/10', v_open, v_hour;
  end if;

  -- 6.7 The wrapper: one overload, definer, anon cannot execute it,
  -- authenticated can, and its stored body holds the lock and the three
  -- refusal statements (checked as statements, comments stripped).
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_customer_order';
  if v_n is distinct from 1 then
    raise exception 'server input bounds: expected one place_customer_order, found %', v_n;
  end if;
  if has_function_privilege('anon',
       'public.place_customer_order(uuid,public.order_type,jsonb,uuid,text,text,integer,uuid,text)', 'execute')
     or not has_function_privilege('authenticated',
       'public.place_customer_order(uuid,public.order_type,jsonb,uuid,text,text,integer,uuid,text)', 'execute') then
    raise exception 'server input bounds: place_customer_order grants moved';
  end if;
  -- The guard statements, read from the body with comments stripped, so a
  -- comment naming a token cannot satisfy the check. Each is a STATEMENT
  -- shape and must appear exactly once. This proves the statements are in
  -- the stored body; it does not prove they run in the right order or
  -- refuse the right callers. That is the paired suite's job
  -- (supabase/tests/server_input_bounds_test.sql, CASES 6-9 and 11).
  select regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g')
    into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_customer_order' and p.prosecdef;
  if v_txt is null then
    raise exception 'server input bounds: place_customer_order is not a SECURITY DEFINER function';
  end if;
  select count(*) into v_n
    from unnest(array[
      'if jsonb_typeof(p_items) = ''array'' and exists (',
      'select 1 from jsonb_array_elements(p_items) as e(value)',
      'where coalesce((e.value ->> ''quantity'')::int, 0) > 50) then',
      'perform pg_advisory_xact_lock(hashtext(''spicymeal:place-customer-order:'' || v_uid::text));',
      'select p.phone_verified into v_verified',
      'if v_verified is distinct from true then',
      'into v_open_limit, v_hour_limit',
      'and o.created_at > now() - interval ''24 hours'';',
      'if v_open >= v_open_limit then',
      'and o.created_at > now() - interval ''1 hour'';',
      'if v_hour >= v_hour_limit then'
    ]) as shape(t)
   where (char_length(v_txt) - char_length(replace(v_txt, shape.t, ''))) = char_length(shape.t);
  if v_n is distinct from 11 then
    raise exception 'server input bounds: place_customer_order is missing its guard (% of 11 statements found exactly once)', v_n;
  end if;

  -- 6.8 handle_new_user still claims comp membership and now bounds the name.
  select regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g')
    into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'handle_new_user';
  if v_txt is null
     or position('claim_comp_membership' in v_txt) = 0
     or position('v_name := public.profile_name_normalized(left(v_name, 80));' in v_txt) = 0 then
    raise exception 'server input bounds: handle_new_user lost its comp claim or its name bound';
  end if;

  -- 6.9 The money path is untouched.
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_txt is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'place_order moved to %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_txt, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;

  raise notice 'server input bounds: at most 50 per cash order line, name/email/label/coordinate triggers, landmark trim fixed, admin delete-scoped image SELECT, customer order limits; money path unchanged';
end
$verify$;
