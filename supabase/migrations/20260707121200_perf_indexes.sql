-- ============================================================================
-- Spicy Meal — high-traffic performance indexes (16 branches, high order volume).
--
-- Adds composite/partial indexes for the hot access patterns and removes the
-- single-column orders indexes that are now redundant prefixes of the
-- composites (fewer indexes = cheaper writes on the busiest table).
--
-- NOTE for an already-large PRODUCTION table: create these with
--   CREATE INDEX CONCURRENTLY ...   (run outside a transaction / via psql, not
-- inside a migration transaction) to avoid holding a write lock. At pre-launch
-- the tables are small, so the plain statements below are fine.
-- ============================================================================

-- ---- orders: the hot list queries -----------------------------------------
-- Admin per-branch board:      where branch_id = ?   order by created_at desc
create index if not exists orders_branch_created_idx   on public.orders (branch_id, created_at desc);
-- Admin status filter / KPIs:  where status = ?       order by created_at desc
create index if not exists orders_status_created_idx   on public.orders (status, created_at desc);
-- Customer order history + RLS (customer_id = auth.uid()) order by created_at desc
create index if not exists orders_customer_created_idx on public.orders (customer_id, created_at desc);

-- The single-column versions are leading-column prefixes of the composites
-- above, so they add write cost for no read benefit. Keep orders_created_at_idx
-- for the filterless "all orders, newest first" admin view.
drop index if exists public.orders_branch_id_idx;
drop index if exists public.orders_status_idx;
drop index if exists public.orders_customer_id_idx;

-- ---- orders: Lazywait sync worker paths -----------------------------------
-- Pull the sync queue (unsynced + failed retries), oldest first.
create index if not exists orders_sync_queue_idx
  on public.orders (created_at)
  where sync_status in ('not_synced', 'failed');
-- Map a Lazywait id (webhook/callback) back to the local order.
create index if not exists orders_lazywait_order_id_idx
  on public.orders (lazywait_order_id)
  where lazywait_order_id is not null;

-- ---- catalog read path (menu) ---------------------------------------------
-- Small tables, so marginal, but cheap and lets an index scan satisfy the
-- ORDER BY on the storefront's active menu query.
create index if not exists products_active_sort_idx   on public.products (is_active, sort_order);
create index if not exists categories_active_sort_idx on public.categories (is_active, sort_order);

-- ---- already-covered (no index added, intentionally) ----------------------
--  * branch_product_availability — PK (branch_id, product_id) + bpa_product_id_idx
--  * product_modifier_groups     — PK (product_id, group_id)  + pmg_group_id_idx
--  * coupons.code                — UNIQUE constraint (exact-match lookup)
--  * order_items(order_id), order_item_modifiers(order_item_id) — already indexed
--  * loyalty_transactions(profile_id, created_at), (order_id)   — already indexed
