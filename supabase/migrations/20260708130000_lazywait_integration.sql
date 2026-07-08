-- ============================================================================
-- Spicy Meal — Lazywait POS integration (server-side sync).
--
-- Supabase / place_order stays the SOURCE OF TRUTH for order creation, pricing,
-- VAT, coupon, loyalty and order state. Lazywait is a sync DESTINATION only.
-- A Lazywait sync failure must NEVER block the customer order — the order is
-- created locally and queued; the sync worker retries with backoff.
--
-- This migration adds:
--   1. External-id mapping columns (branch/category/product/modifier/group/profile).
--   2. Per-order sync state + retry/backoff/dead-letter tracking columns.
--   3. A BEFORE INSERT trigger that enqueues pickup orders and BLOCKS delivery
--      orders (Lazywait's Create Order delivery schema is not confirmed).
--   4. A claim-locking queue index + RPCs: claim_lazywait_sync_batch (service),
--      record_lazywait_sync (service), requeue_lazywait_order (admin).
--
-- Idempotent: guarded so it can be re-applied safely.
-- ============================================================================

-- ---- 1. External-id mapping columns ---------------------------------------
alter table public.branches        add column if not exists lazywait_branch_id   text;
alter table public.categories      add column if not exists lazywait_category_id text;
alter table public.products        add column if not exists lazywait_item_id     text;
-- Lazywait price variants (price_id) are NOT sent in Create Order (confirmed
-- schema has no price_id). Column kept for future menu mapping only; unused now.
alter table public.products        add column if not exists lazywait_price_id    text;
alter table public.modifier_groups add column if not exists lazywait_group_id    text;
alter table public.modifiers       add column if not exists lazywait_addon_id    text;
alter table public.profiles        add column if not exists lazywait_customer_id text;

-- Fast admin lookups / dedupe of the mapping.
create index if not exists branches_lazywait_branch_id_idx on public.branches(lazywait_branch_id) where lazywait_branch_id is not null;
create index if not exists products_lazywait_item_id_idx   on public.products(lazywait_item_id)    where lazywait_item_id is not null;

-- ---- 2. Per-order Lazywait sync tracking ----------------------------------
-- `lazywait_sync_state` is the AUTHORITATIVE Lazywait state. The legacy
-- `sync_status` enum is kept in sync for the existing app/admin display.
alter table public.orders add column if not exists lazywait_sync_state   text not null default 'pending';
alter table public.orders add column if not exists lazywait_order_number text;   -- e.g. "#1"
alter table public.orders add column if not exists lazywait_status       text;   -- POS order_status_id
alter table public.orders add column if not exists sync_attempt_count    integer not null default 0;
alter table public.orders add column if not exists sync_next_attempt_at  timestamptz;
alter table public.orders add column if not exists sync_last_error       text;
alter table public.orders add column if not exists sync_blocked_reason   text;
alter table public.orders add column if not exists synced_at             timestamptz;
-- (orders.lazywait_order_id and orders.lazywait_ref already exist from the
--  orders migration; lazywait_ref stores the Lazywait order_ref used in all
--  subsequent API calls, lazywait_order_id stores the POS order_id.)

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_lazywait_sync_state_check'
  ) then
    alter table public.orders add constraint orders_lazywait_sync_state_check
      check (lazywait_sync_state in
        ('pending','syncing','synced','failed','blocked','dead_letter','skipped'));
  end if;
end $$;

-- Orders that existed BEFORE the integration must not retroactively sync.
update public.orders set lazywait_sync_state = 'skipped'
  where lazywait_sync_state = 'pending';

-- ---- 3. Enqueue trigger ----------------------------------------------------
-- On insert: pickup -> queue now; delivery -> BLOCK (Lazywait delivery Create
-- Order schema is unconfirmed; do not invent it). The local order is unaffected.
create or replace function public.set_lazywait_initial_sync()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.order_type = 'delivery' then
    new.lazywait_sync_state  := 'blocked';
    new.sync_blocked_reason  := 'delivery_schema_unconfirmed';
    new.sync_next_attempt_at := null;
  else
    new.lazywait_sync_state  := 'pending';
    new.sync_blocked_reason  := null;
    new.sync_next_attempt_at := now();
  end if;
  return new;
end $$;

drop trigger if exists set_orders_lazywait_initial_sync on public.orders;
create trigger set_orders_lazywait_initial_sync
  before insert on public.orders
  for each row execute function public.set_lazywait_initial_sync();

-- ---- 4. Queue index --------------------------------------------------------
-- The worker pulls due, retryable rows oldest-first.
create index if not exists orders_lazywait_queue_idx
  on public.orders (sync_next_attempt_at)
  where lazywait_sync_state in ('pending','failed');

-- ---------------------------------------------------------------------------
-- claim_lazywait_sync_batch(): atomically claim up to N due orders for a worker.
-- FOR UPDATE SKIP LOCKED so concurrent workers never double-send. Flips claimed
-- rows to 'syncing' and returns the full rows. Service-role only.
-- ---------------------------------------------------------------------------
create or replace function public.claim_lazywait_sync_batch(p_limit integer default 10)
returns setof public.orders
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.orders o
     set lazywait_sync_state = 'syncing', updated_at = now()
   where o.id in (
     select id from public.orders
      where lazywait_sync_state in ('pending','failed')
        and (sync_next_attempt_at is null or sync_next_attempt_at <= now())
      order by sync_next_attempt_at nulls first, created_at
      limit greatest(1, least(coalesce(p_limit, 10), 100))
      for update skip locked
   )
   returning o.*;
end $$;

revoke all on function public.claim_lazywait_sync_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_lazywait_sync_batch(integer) to service_role;

-- ---------------------------------------------------------------------------
-- record_lazywait_sync(): persist the outcome of a sync attempt + write an
-- integration_sync_logs row. `p_patch` carries only the order fields to update
-- (missing keys are left unchanged). Keeps the legacy sync_status enum aligned
-- for the existing display. Service-role only.
-- ---------------------------------------------------------------------------
create or replace function public.record_lazywait_sync(
  p_order_id   uuid,
  p_patch      jsonb,
  p_log_status text default 'success',   -- success | failed | skipped
  p_direction  text default 'push',
  p_request    jsonb default null,
  p_response   jsonb default null,
  p_error      text  default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text := p_patch->>'lazywait_sync_state';
begin
  update public.orders set
    lazywait_sync_state   = coalesce(v_state, lazywait_sync_state),
    lazywait_ref          = coalesce(p_patch->>'lazywait_ref', lazywait_ref),
    lazywait_order_id     = coalesce(p_patch->>'lazywait_order_id', lazywait_order_id),
    lazywait_order_number = coalesce(p_patch->>'lazywait_order_number', lazywait_order_number),
    lazywait_status       = coalesce(p_patch->>'lazywait_status', lazywait_status),
    sync_attempt_count    = coalesce((p_patch->>'sync_attempt_count')::int, sync_attempt_count),
    sync_next_attempt_at  = case when p_patch ? 'sync_next_attempt_at'
                                 then nullif(p_patch->>'sync_next_attempt_at','')::timestamptz
                                 else sync_next_attempt_at end,
    sync_last_error       = case when p_patch ? 'sync_last_error'
                                 then p_patch->>'sync_last_error' else sync_last_error end,
    sync_blocked_reason   = case when p_patch ? 'sync_blocked_reason'
                                 then p_patch->>'sync_blocked_reason' else sync_blocked_reason end,
    synced_at             = case when p_patch ? 'synced_at'
                                 then nullif(p_patch->>'synced_at','')::timestamptz else synced_at end,
    sync_status           = case
        when v_state = 'synced'  then 'synced'::public.sync_status
        when v_state = 'syncing' then 'syncing'::public.sync_status
        when v_state in ('failed','dead_letter','blocked') then 'failed'::public.sync_status
        when v_state in ('pending','skipped') then 'not_synced'::public.sync_status
        else sync_status end,
    updated_at = now()
  where id = p_order_id;

  insert into public.integration_sync_logs (provider, order_id, direction, status, request, response, error)
    values ('lazywait', p_order_id, p_direction, p_log_status, p_request, p_response, p_error);
end $$;

revoke all on function public.record_lazywait_sync(uuid, jsonb, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_lazywait_sync(uuid, jsonb, text, text, jsonb, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- requeue_lazywait_order(): admin "retry" — reset a failed/blocked/dead_letter/
-- skipped order back to the queue. Admin-only. (Branch/product mapping edits go
-- through the normal admin catalog updates, which RLS already restricts to admins.)
-- ---------------------------------------------------------------------------
create or replace function public.requeue_lazywait_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'Only admins may requeue Lazywait sync' using errcode = '42501';
  end if;
  update public.orders set
    lazywait_sync_state  = 'pending',
    sync_next_attempt_at = now(),
    sync_last_error      = null,
    sync_blocked_reason  = null,
    sync_status          = 'not_synced'::public.sync_status,
    updated_at           = now()
  where id = p_order_id
    and order_type <> 'delivery'      -- delivery stays blocked until schema confirmed
    and lazywait_sync_state in ('failed','blocked','dead_letter','skipped')
  returning * into v_order;
  if not found then
    raise exception 'Order not requeuable (not found, is delivery, or already pending/synced)';
  end if;
  return v_order;
end $$;

revoke all on function public.requeue_lazywait_order(uuid) from public, anon;
grant execute on function public.requeue_lazywait_order(uuid) to authenticated;

-- ---- 5. Seed the non-secret base URL on the lazywait integration row -------
-- Secrets (api_token, webhook_secret) and client_id are set by the admin via
-- upsert_integration_settings — NOT committed here.
update public.integration_settings
   set public_config = coalesce(public_config, '{}'::jsonb)
       || jsonb_build_object('base_url', 'https://apiv2.lazywait.com/v1')
 where provider_type = 'lazywait'
   and coalesce(public_config->>'base_url', '') = '';
