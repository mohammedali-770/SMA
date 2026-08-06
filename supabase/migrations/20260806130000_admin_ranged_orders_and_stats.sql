-- Bounded admin order reads: a date-ranged report feed and an aggregate stats
-- feed, so the console stops downloading the whole orders table.
--
-- THE PROBLEM
-- `AppContext.refreshOrders()` calls `admin_list_orders_with_items(null)` — the
-- UNBOUNDED arm — on every staff sign-in and after every status advance. That
-- returns EVERY order in the system, with every line item and every modifier,
-- as one jsonb blob. It is unbounded because three surfaces read the whole
-- in-memory list:
--
--   * ReportsPanel  — filters by a date range, in memory
--   * StatsPanel    — all-time revenue, active count, average ticket, per-branch
--   * LiveOrdersPanel — renders the filtered list, unpaginated
--
-- So the fetch could not simply be capped: capping it would have silently
-- truncated the financial reports, which is worse than being slow. Both halves
-- have to move together, which is what this migration is for.
--
-- At 300 orders/day the blob passes 100 MB inside a year, and it is re-fetched
-- on every sign-in. This is a scheduled outage, not a slow page.
--
-- WHY THIS NEEDS A MIGRATION AT ALL
-- Staff hold NO direct privilege on `public.orders` (20260724200000). Every
-- staff read goes through a SECURITY DEFINER RPC, so a PostgREST `.gte()` range
-- filter is not available to the client — the range has to be a function
-- parameter.
--
-- WHAT THIS ADDS
--   1. `admin_list_orders_for_range(p_from, p_to, p_branch)` — the report feed.
--      Half-open `[p_from, p_to)` so the caller passes day boundaries without a
--      23:59:59.999 fencepost. Returns an ENVELOPE, not a bare array, so an
--      over-large range refuses explicitly instead of truncating a financial
--      report into a quietly wrong one.
--   2. `admin_order_stats()` — the dashboard tiles and the per-branch bar chart,
--      aggregated server-side. Constant-size payload regardless of table size.
--
-- Both are `is_staff()`-gated internally, exactly like
-- `admin_list_orders_with_items`, and both are `stable` + `security definer`
-- with a pinned `search_path`.
--
-- PROJECTION IS DELIBERATELY LEANER THAN THE LIVE FEED
-- The range feed returns NO customer name, NO customer phone, NO notes, NO
-- address snapshot and NO item modifiers. The reports never read them. Dropping
-- them cuts the payload several-fold AND means running a financial report no
-- longer pulls customer PII into the browser at all.
--
-- SAFETY
-- - Purely additive. No table, column, constraint, policy or existing function
--   is altered. `admin_list_orders_with_items` is untouched and still serves the
--   live feed.
-- - Read-only: both functions are `stable` and contain no write.
-- - Idempotent: `create or replace` only.
--
-- NOT APPLIED TO PRODUCTION by this change. Production schema changes go only
-- through the owner-approved apply_migration workflow (docs/MIGRATIONS.md).
-- `supabase db push` is forbidden against production (CLAUDE.md §8).

-- ---------------------------------------------------------------------------
-- 1. Ranged report feed
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_orders_for_range(
  p_from     timestamptz,
  p_to       timestamptz,
  p_branch   uuid    default null,
  p_max_rows integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- The ceiling exists so a report can never be silently wrong. Above it the
  -- function returns NO rows and says so, and the console asks the operator to
  -- narrow the range — rather than returning the first N and letting somebody
  -- file a VAT return computed from a truncated set.
  --
  -- Sized against the payload, not the row count: the lean projection is roughly
  -- 400 bytes/order, so 10k orders is about 4 MB, which a report export can
  -- reasonably carry. A range that exceeds it wants server-side aggregation,
  -- which is a larger change than this one.
  c_hard_max constant integer := 10000;
  -- `p_max_rows` can only LOWER the ceiling, never raise it — `least` against the
  -- hard maximum. A caller cannot restore the unbounded fetch this replaces. It
  -- exists so the refusal branch is directly testable without seeding 10k rows.
  v_max_rows integer := least(coalesce(p_max_rows, c_hard_max), c_hard_max);
  v_count    integer;
  v_rows     jsonb;
begin
  if not public.is_staff() then
    raise exception 'Only staff may list orders' using errcode = '42501';
  end if;
  if p_from is null or p_to is null then
    raise exception 'p_from and p_to are required' using errcode = '22004';
  end if;
  if p_to <= p_from then
    raise exception 'p_to must be after p_from' using errcode = '22023';
  end if;

  -- Counted before projecting so an over-large range costs an index scan, not a
  -- 400 MB jsonb build that is then thrown away.
  select count(*) into v_count
    from public.orders o
   where o.created_at >= p_from
     and o.created_at <  p_to
     and (p_branch is null or o.branch_id = p_branch);

  if v_count > v_max_rows then
    return jsonb_build_object(
      'row_count',      v_count,
      'max_rows',       v_max_rows,
      'limit_exceeded', true,
      'orders',         '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_rows from (
    select
      o.id, o.order_number,
      o.branch_id, o.branch_name_en, o.branch_name_ar,
      o.status, o.order_type,
      o.subtotal, o.delivery_fee, o.discount_amount, o.loyalty_discount_amount,
      o.vat_amount, o.total,
      o.coupon_code, o.created_at,
      o.sync_status, o.lazywait_sync_state, o.lazywait_ref,
      o.lazywait_order_number, o.sync_last_error, o.sync_blocked_reason,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'product_id', i.product_id,
          'name_en', i.name_en, 'name_ar', i.name_ar,
          'unit_price', i.unit_price, 'quantity', i.quantity)
          order by i.id)
        from public.order_items i where i.order_id = o.id
      ), '[]'::jsonb) as order_items
    from public.orders o
    where o.created_at >= p_from
      and o.created_at <  p_to
      and (p_branch is null or o.branch_id = p_branch)
    order by o.created_at desc
  ) t;

  return jsonb_build_object(
    'row_count',      v_count,
    'max_rows',       v_max_rows,
    'limit_exceeded', false,
    'orders',         v_rows
  );
end $$;

revoke all on function public.admin_list_orders_for_range(timestamptz, timestamptz, uuid, integer) from public, anon;
grant execute on function public.admin_list_orders_for_range(timestamptz, timestamptz, uuid, integer) to authenticated;

comment on function public.admin_list_orders_for_range(timestamptz, timestamptz, uuid, integer) is
  'Staff report feed for a half-open [p_from, p_to) window, optionally one branch (is_staff enforced internally). Returns {row_count, max_rows, limit_exceeded, orders}; above the ceiling it returns no rows and sets limit_exceeded so a report is never silently truncated. Projection excludes customer name, phone, notes, address snapshot and item modifiers — the reports do not read them.';

-- ---------------------------------------------------------------------------
-- 2. Aggregate dashboard stats
-- ---------------------------------------------------------------------------
-- StatsPanel computed these by summing the whole in-memory order list. The
-- numbers are defined to match that computation EXACTLY, so the tiles do not
-- change value when the client stops holding every order:
--
--   delivered_revenue = sum(total) where status = 'delivered'
--   active_orders     = count where status not in ('delivered','cancelled')
--   total_orders      = count of ALL orders
--   total_amount      = sum(total) over ALL orders   (average ticket numerator)
--   branches[]        = per-branch sum(total) and count over ALL orders
--
-- `total_amount` deliberately spans every status, including cancelled, because
-- that is what the "average ticket" tile has always divided. Changing it here
-- would move a number on the dashboard under cover of a performance change.
create or replace function public.admin_order_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_totals   record;
  v_branches jsonb;
begin
  if not public.is_staff() then
    raise exception 'Only staff may read order stats' using errcode = '42501';
  end if;

  select
    count(*)                                                              as total_orders,
    coalesce(sum(o.total), 0)                                             as total_amount,
    coalesce(sum(o.total) filter (where o.status = 'delivered'), 0)       as delivered_revenue,
    count(*) filter (where o.status not in ('delivered', 'cancelled'))    as active_orders
  into v_totals
  from public.orders o;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.sales desc), '[]'::jsonb) into v_branches from (
    select
      o.branch_id,
      coalesce(sum(o.total), 0) as sales,
      count(*)                  as order_count
    from public.orders o
    where o.branch_id is not null
    group by o.branch_id
  ) b;

  return jsonb_build_object(
    'total_orders',      v_totals.total_orders,
    'total_amount',      v_totals.total_amount,
    'delivered_revenue', v_totals.delivered_revenue,
    'active_orders',     v_totals.active_orders,
    'branches',          v_branches
  );
end $$;

revoke all on function public.admin_order_stats() from public, anon;
grant execute on function public.admin_order_stats() to authenticated;

comment on function public.admin_order_stats() is
  'Aggregate order figures for the admin dashboard tiles and per-branch chart (is_staff enforced internally). Constant-size payload. Definitions match the previous in-memory computation exactly, including total_amount spanning every status.';

-- ---------------------------------------------------------------------------
-- 3. The live board's bounded feed must never hide outstanding work
-- ---------------------------------------------------------------------------
-- Bounding the console's fetch (above) introduced a way to lose an order.
--
-- `admin_list_orders_with_items(p_limit)` returns the p_limit most RECENT orders
-- by created_at. Once more than p_limit newer orders exist, an older order is
-- not fetched at all — regardless of its status. An order stuck in `received`,
-- `preparing`, `ready` or `out_for_delivery` therefore vanishes from the Live
-- Orders board, and neither the search box nor the "show older" control can
-- recover it, because the row was never in the browser. Work still owed to a
-- customer would silently stop being visible to the kitchen.
--
-- That is the precise failure this whole change set exists to avoid, so the
-- window is made STATUS-AWARE rather than purely chronological: the p_limit most
-- recent orders, PLUS every order that is not yet settled, however old.
--
-- The unsettled arm is deliberately uncapped. Capping it would reintroduce the
-- same silent drop one level down, and an unsettled backlog large enough to
-- matter is an operational emergency the board should be showing, not hiding.
-- In normal operation it is a handful of rows.
--
-- `p_limit is null` keeps the original unbounded behaviour exactly, so this is a
-- widening: every caller sees a superset of what it saw before, never less. The
-- signature, name, volatility, security and search_path are unchanged, and
-- migration 20260724200000 is not edited (CLAUDE.md §2.3) — this supersedes it.
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
    where p_limit is null
       -- the recent window …
       or o.id in (
            select r.id from public.orders r
             order by r.created_at desc
             limit greatest(1, p_limit)
          )
       -- … plus everything still owed to a customer, however old.
       or o.status not in ('delivered', 'cancelled')
    order by o.created_at desc
  ) t;

  return v_rows;
end $$;

comment on function public.admin_list_orders_with_items(integer) is
  'Staff order feed with items + modifiers (is_staff enforced internally). Explicit column projection; never returns pos_create_attempt_token (20260724200000). Since 20260806130000 the bounded arm is status-aware: the p_limit most recent orders PLUS every unsettled order regardless of age, so bounding the console fetch cannot hide outstanding work from the kitchen.';

-- ---------------------------------------------------------------------------
-- Rollback
-- ---------------------------------------------------------------------------
-- drop function if exists public.admin_list_orders_for_range(timestamptz, timestamptz, uuid, integer);
-- drop function if exists public.admin_order_stats();
-- ...and restore admin_list_orders_with_items from 20260724200000:179-232. Note
-- that doing so reinstates the hidden-outstanding-order problem above whenever
-- the caller passes a limit, so prefer fixing forward.
-- The two added functions are unreferenced by anything else in the schema. The
-- console would have to be reverted in the same step.
