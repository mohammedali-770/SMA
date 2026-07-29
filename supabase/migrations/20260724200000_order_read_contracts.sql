-- ============================================================================
-- Spicy Meal — separate CUSTOMER and STAFF order-read contracts.
--
-- THE EXPOSURE THIS CLOSES. `grant select on public.orders to authenticated`
-- (20260707120500:107) is TABLE-WIDE, and RLS filters ROWS, not COLUMNS. A
-- signed-in customer could therefore read their own internal identifiers
-- directly, regardless of what the app requests:
--     GET /rest/v1/orders?select=order_number,pos_create_attempt_token
-- Three surfaces expressed that single root cause:
--   1. the PostgREST table read above;
--   2. `place_order`, which `returns public.orders` and is granted to
--      `authenticated`, so a direct RPC call returns the whole row;
--   3. the `supabase_realtime` publication, which carries `public.orders`
--      change payloads (the FULL row) to any authorized subscriber.
--
-- All three are closed here by splitting the read contracts:
--   * CUSTOMERS keep direct table access but only to explicitly listed,
--     customer-safe COLUMNS (column-level GRANT). Row ownership is unchanged.
--   * STAFF stop reading/writing the table directly and use SECURITY DEFINER
--     RPCs that enforce is_staff()/is_admin() internally.
--   * `place_order` is revoked from `authenticated` and replaced, for customer
--     callers, by a thin wrapper returning an explicit customer-safe object.
--   * `public.orders` leaves the realtime publication; a staff-only signal table
--     replaces it, carrying no order contents, amounts or PII.
--
-- ORDERING. This migration runs AFTER 20260724180000 (opaque Tap reference) and
-- 20260724190000 (loyalty history semantics). It is independent of both: it
-- touches neither payment_records/tap_begin_payment_attempt nor
-- loyalty_transactions. The loyalty historical-row fix that an earlier draft of
-- this file carried is already delivered by 20260724190000 and is NOT repeated.
--
-- FORWARD-ONLY and, at authoring time, REPOSITORY-ONLY / UNAPPLIED.
-- No cron, Vault, credential, payment-provider or push behaviour is changed.
-- No service-role credential is introduced anywhere.
--
-- NOT APPLIED TO PRODUCTION by this change (docs/MIGRATIONS.md; CLAUDE.md §8).
-- ============================================================================

-- ---- 1. CUSTOMER contract: column-scoped access to public.orders ------------
-- Row-level ownership is unchanged (policy orders_select_own_or_staff still
-- applies). What changes is the COLUMN surface: a customer may read only the
-- columns the customer experience genuinely renders or derives state from.
-- Everything else — the internal SM-… order number, the Create-Order fencing
-- token, POS/integration diagnostics, refund internals, staff notes and customer
-- PII the customer surface does not need — is no longer selectable, so an
-- explicit PostgREST request for one fails with a privilege error.
--
-- NOTE: RLS policy expressions (which reference customer_id) are evaluated by
-- the system and do NOT require the caller to hold a column privilege, so
-- ownership enforcement is unaffected by dropping customer_id from the grant.
-- The same is true of the order_items / order_item_modifiers policies, which
-- reference orders.customer_id in an EXISTS subquery.
revoke select on public.orders from authenticated;

-- Also drop the table-wide status write: staff now go through
-- admin_set_order_status(), and no customer ever had a policy permitting it.
revoke update (status) on public.orders from authenticated;

grant select (
  id, status, order_type, created_at,
  branch_id, branch_name_en, branch_name_ar,
  subtotal, delivery_fee, discount_amount, loyalty_discount_amount,
  vat_amount, total, loyalty_points_earned,
  payment_status, payment_method,
  lazywait_order_number,          -- the branch's own number: the ONLY one shown
  lazywait_sync_state, lazywait_ref, sync_blocked_reason,
  sync_next_attempt_at, pos_create_attempted_at,
  pos_customer_retry_count, refund_state
) on public.orders to authenticated;

-- ---- 1b. Keep order_items / order_item_modifiers readable by their owner -----
-- Those two RLS policies decide row visibility with a SUBQUERY against
-- public.orders: `exists (select 1 from public.orders o where o.id = … and
-- (o.customer_id = auth.uid() or is_staff()))`. Unlike a table's own policy
-- (which the system evaluates without needing column privileges), a cross-table
-- subquery inside a policy is an ORDINARY query and DOES require the caller to
-- hold SELECT on the columns it reads — here orders.customer_id. §1 just revoked
-- that, so without this change a customer can no longer read their OWN order
-- lines (PostgREST embedding compiles to exactly this join).
--
-- Fix: move the ownership decision into a SECURITY DEFINER helper. It is owned
-- by the table owner (which does not force RLS on orders), so it can read
-- customer_id to answer "may the current caller read this order?" without the
-- caller holding a column grant. auth.uid()/is_staff() still reflect the
-- original caller. This keeps customer_id OUT of the customer grant.
create or replace function public.caller_can_read_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and (o.customer_id = auth.uid() or public.is_staff())
  );
$$;

revoke all on function public.caller_can_read_order(uuid) from public;
grant execute on function public.caller_can_read_order(uuid) to authenticated;

comment on function public.caller_can_read_order(uuid) is
  'Ownership predicate for order_items/order_item_modifiers RLS. SECURITY DEFINER so the check can read orders.customer_id after the customer grant was narrowed to safe columns (20260724200000).';

drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items
  for select to authenticated
  using (public.caller_can_read_order(order_items.order_id));

drop policy if exists order_item_modifiers_select on public.order_item_modifiers;
create policy order_item_modifiers_select on public.order_item_modifiers
  for select to authenticated
  using (exists (
    select 1 from public.order_items oi
    where oi.id = order_item_modifiers.order_item_id
      and public.caller_can_read_order(oi.order_id)
  ));

-- ---- 2. STAFF contract: SECURITY DEFINER RPCs -------------------------------
-- Staff no longer read or write public.orders directly. These three functions
-- are the whole staff order surface. Each enforces authorization internally with
-- the repository's established predicates, pins search_path, and is revoked from
-- PUBLIC/anon. No service-role key is involved — the browser calls these with
-- the staff member's own JWT, so authorization is still per-user.
--
-- SECURITY DEFINER is justified here specifically because the caller has been
-- stripped of the underlying table privilege by §1; the function is the only
-- path, and it re-checks the same predicate the RLS policy used.

-- 2a. Flat staff order list (no line items) — the Lazywait panel's feed.
create or replace function public.admin_list_orders(p_limit integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_rows jsonb;
begin
  if not public.is_staff() then
    raise exception 'Only staff may list orders' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows from (
    select
      o.id, o.order_number, o.customer_id, o.customer_name, o.customer_phone,
      o.branch_id, o.branch_name_en, o.branch_name_ar,
      o.status, o.order_type,
      o.subtotal, o.delivery_fee, o.discount_amount, o.loyalty_discount_amount,
      o.vat_amount, o.total,
      o.loyalty_points_earned, o.loyalty_points_redeemed,
      o.payment_status, o.payment_method, o.payment_provider, o.paid_at,
      o.coupon_code, o.notes, o.created_at, o.updated_at,
      o.sync_status, o.lazywait_sync_state, o.lazywait_ref,
      o.lazywait_order_number, o.lazywait_status,
      o.sync_attempt_count, o.sync_last_error, o.sync_blocked_reason,
      o.synced_at, o.first_pos_sync_failure_at, o.sync_next_attempt_at,
      o.pos_create_attempted_at, o.pos_customer_retry_count,
      o.pos_confirmation_reason, o.refund_state,
      o.address_snapshot
      -- Deliberately NOT exposed even to staff: pos_create_attempt_token is
      -- internal send-phase fencing metadata with no operational meaning in a UI.
    from public.orders o
    order by o.created_at desc
    limit case when p_limit is null then null else greatest(1, p_limit) end
  ) t;

  return v_rows;
end $$;

revoke all on function public.admin_list_orders(integer) from public, anon;
grant execute on function public.admin_list_orders(integer) to authenticated;

comment on function public.admin_list_orders(integer) is
  'Staff order feed (is_staff enforced internally). Explicit column projection; never returns pos_create_attempt_token. Replaces the direct public.orders read (20260724200000).';

-- 2b. Staff order list WITH line items and modifiers — the dashboard feed.
create or replace function public.admin_list_orders_with_items(p_limit integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_rows jsonb;
begin
  if not public.is_staff() then
    raise exception 'Only staff may list orders' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows from (
    select
      o.id, o.order_number, o.customer_id, o.customer_name, o.customer_phone,
      o.branch_id, o.branch_name_en, o.branch_name_ar,
      o.status, o.order_type,
      o.subtotal, o.delivery_fee, o.discount_amount, o.loyalty_discount_amount,
      o.vat_amount, o.total,
      o.loyalty_points_earned, o.loyalty_points_redeemed,
      o.payment_status, o.payment_method, o.payment_provider, o.paid_at,
      o.coupon_code, o.notes, o.created_at, o.updated_at,
      o.sync_status, o.lazywait_sync_state, o.lazywait_ref,
      o.lazywait_order_number, o.lazywait_status,
      o.sync_attempt_count, o.sync_last_error, o.sync_blocked_reason,
      o.synced_at, o.first_pos_sync_failure_at, o.sync_next_attempt_at,
      o.pos_create_attempted_at, o.pos_customer_retry_count,
      o.pos_confirmation_reason, o.refund_state,
      o.address_snapshot,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id, 'order_id', i.order_id, 'product_id', i.product_id,
          'name_en', i.name_en, 'name_ar', i.name_ar,
          'unit_price', i.unit_price, 'quantity', i.quantity,
          'line_total', i.line_total,
          'order_item_modifiers', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', m.id, 'order_item_id', m.order_item_id,
              'modifier_id', m.modifier_id,
              'name_en', m.name_en, 'name_ar', m.name_ar, 'price', m.price)
              order by m.id)
            from public.order_item_modifiers m where m.order_item_id = i.id
          ), '[]'::jsonb))
          order by i.id)
        from public.order_items i where i.order_id = o.id
      ), '[]'::jsonb) as order_items
    from public.orders o
    order by o.created_at desc
    limit case when p_limit is null then null else greatest(1, p_limit) end
  ) t;

  return v_rows;
end $$;

revoke all on function public.admin_list_orders_with_items(integer) from public, anon;
grant execute on function public.admin_list_orders_with_items(integer) to authenticated;

comment on function public.admin_list_orders_with_items(integer) is
  'Staff order feed with items + modifiers (is_staff enforced internally). Explicit column projection; never returns pos_create_attempt_token (20260724200000).';

-- 2c. Staff status write. ADMIN-gated, matching the pre-existing
-- orders_admin_update policy exactly, so authorization is not weakened.
create or replace function public.admin_set_order_status(
  p_order_id uuid,
  p_status   public.order_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins may change order status' using errcode = '42501';
  end if;
  update public.orders set status = p_status, updated_at = now() where id = p_order_id;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.admin_set_order_status(uuid, public.order_status) from public, anon;
grant execute on function public.admin_set_order_status(uuid, public.order_status) to authenticated;

comment on function public.admin_set_order_status(uuid, public.order_status) is
  'Admin-only order status write (is_admin enforced internally), replacing the direct UPDATE that required grant update(status) (20260724200000).';

-- ---- 3. place_order: no longer reachable with a whole-row return ------------
-- place_order `returns public.orders`, so any authenticated caller could invoke
-- it directly and receive every column — including order_number and
-- pos_create_attempt_token — regardless of the column grant in §1. It is revoked
-- from `authenticated` and kept for service_role/internal callers; customers use
-- the wrapper below.
--
-- The wrapper is a THIN pass-through. It does not re-implement or copy any
-- pricing, modifier, delivery-fee, coupon, VAT, loyalty, transactional or
-- idempotency logic — it calls place_order UNCHANGED and projects the result.
-- auth.uid() reads the request JWT, which SECURITY DEFINER does not alter, so
-- the order still binds to the calling customer. One statement, one transaction.
revoke execute on function public.place_order(
  uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text
) from authenticated;

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
declare v_order public.orders;
begin
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

revoke all on function public.place_customer_order(
  uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text
) from public, anon;
grant execute on function public.place_customer_order(
  uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text
) to authenticated;

comment on function public.place_customer_order(uuid, public.order_type, jsonb, uuid, text, text, integer, uuid, text) is
  'Customer-facing wrapper over the UNCHANGED place_order. Same pricing, coupons, VAT, loyalty, transactionality and idempotency; returns an explicit customer-safe projection instead of the whole public.orders row (20260724200000).';

-- ---- 4. Realtime: staff-only signal table instead of public.orders ----------
-- Realtime change payloads carry the FULL row, so publishing public.orders puts
-- every column on the wire for any authorized subscriber. Replace it with a
-- minimal signal table: no order contents, no amounts, no PII, no SM-… value —
-- only enough for the staff console to know "something changed, refetch".
-- (The dashboard handler already ignores the payload and simply refetches.)
create table if not exists public.order_change_events (
  id         bigserial primary key,
  order_id   uuid not null references public.orders(id) on delete cascade,
  event      text not null check (event in ('insert', 'update')),
  created_at timestamptz not null default now()
);

create index if not exists order_change_events_created_idx
  on public.order_change_events (created_at desc);

alter table public.order_change_events enable row level security;

-- anon gets nothing at all; authenticated gets SELECT, then RLS narrows it to
-- staff. No INSERT/UPDATE/DELETE grant to any client role — only the SECURITY
-- DEFINER trigger writes here.
revoke all on public.order_change_events from anon, authenticated;
grant select on public.order_change_events to authenticated;

drop policy if exists order_change_events_staff_read on public.order_change_events;
create policy order_change_events_staff_read on public.order_change_events
  for select to authenticated
  using (public.is_staff());

-- Emitter. SECURITY DEFINER so it can insert regardless of the writer's rights;
-- it records only the order id and the event kind.
create or replace function public.emit_order_change_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_event_id bigint;
begin
  insert into public.order_change_events (order_id, event)
  values (new.id, case when tg_op = 'INSERT' then 'insert' else 'update' end)
  returning id into v_event_id;

  -- Bounded retention without a scheduled job (this migration schedules
  -- nothing): every 500th event prunes anything older than a day. Deterministic,
  -- so behaviour is reproducible in tests.
  if v_event_id % 500 = 0 then
    delete from public.order_change_events where created_at < now() - interval '1 day';
  end if;

  return null;
end $$;

drop trigger if exists emit_orders_change_event on public.orders;
create trigger emit_orders_change_event
  after insert or update on public.orders
  for each row execute function public.emit_order_change_event();

comment on table public.order_change_events is
  'Staff-only realtime signal: order id + event kind, nothing else. Replaces public.orders in the supabase_realtime publication so customer subscribers can no longer receive full order rows (20260724200000).';

-- Publication swap: orders OUT, the staff-only signal table IN. Guarded exactly
-- like 20260707121100 so a plain Postgres without the publication is a no-op.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
    ) then
      execute 'alter publication supabase_realtime drop table public.orders';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_change_events'
    ) then
      execute 'alter publication supabase_realtime add table public.order_change_events';
    end if;
  end if;
end $$;

-- Rollback
--   grant select on public.orders to authenticated;
--   grant update (status) on public.orders to authenticated;
--   grant execute on function public.place_order(uuid, public.order_type, jsonb,
--     uuid, text, text, integer, uuid, text) to authenticated;
--   drop trigger emit_orders_change_event on public.orders;
--   alter publication supabase_realtime add table public.orders;
--   alter publication supabase_realtime drop table public.order_change_events;
-- Note that doing so reopens every exposure described at the top of this file.
