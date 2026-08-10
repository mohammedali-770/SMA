-- ============================================================================
-- Spicy Meal — non-payment security/performance hardening
--
-- Post-production-readiness Supabase advisors (2026-08-10) identified:
--   * trigger-only emit_order_change_event() exposed as an anon/auth RPC;
--   * auth.uid() re-evaluated per row in several high-traffic RLS policies;
--   * high-value foreign keys without covering indexes.
--
-- This migration preserves application authorization semantics. It does NOT
-- touch Tap/payment/refund functions or checkout-session policy/behavior.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Trigger-only function: callers never need direct EXECUTE.
-- PostgreSQL invokes trigger functions through the trigger object; public RPC
-- exposure is unnecessary attack surface. Keep service_role for diagnostics.
-- ---------------------------------------------------------------------------
revoke execute on function public.emit_order_change_event()
  from public, anon, authenticated;
grant execute on function public.emit_order_change_event() to service_role;

-- ---------------------------------------------------------------------------
-- 2. RLS init-plan optimization.
-- Wrapping auth.uid() in a scalar SELECT makes PostgreSQL evaluate the JWT user
-- once per statement rather than once per candidate row. is_staff()/is_admin()
-- checks are intentionally unchanged so authorization semantics stay identical.
-- ---------------------------------------------------------------------------
alter policy profiles_select_own_or_staff on public.profiles
  using ((id = (select auth.uid())) or public.is_staff());

alter policy profiles_update_own_or_admin on public.profiles
  using ((id = (select auth.uid())) or public.is_admin())
  with check ((id = (select auth.uid())) or public.is_admin());

alter policy addresses_own_all on public.addresses
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));

alter policy orders_select_own_or_staff on public.orders
  using ((customer_id = (select auth.uid())) or public.is_staff());

alter policy loyalty_tx_select_own_or_staff on public.loyalty_transactions
  using ((profile_id = (select auth.uid())) or public.is_staff());

alter policy push_devices_select_own on public.push_devices
  using ((select auth.uid()) = customer_id);

alter policy account_deletion_requests_select_own on public.account_deletion_requests
  using (user_id = (select auth.uid()));

alter policy campaign_redemptions_select_own_or_staff on public.campaign_redemptions
  using ((user_id = (select auth.uid())) or public.is_staff());

-- ---------------------------------------------------------------------------
-- 3. Covering indexes for frequently joined/deleted foreign-key paths.
-- The advisor can then use indexed lookups during parent updates/deletes and
-- normal joins instead of scanning child tables. Purely additive; no data change.
-- ---------------------------------------------------------------------------
create index if not exists orders_address_id_idx
  on public.orders(address_id);

create index if not exists order_items_product_id_idx
  on public.order_items(product_id);

create index if not exists order_item_modifiers_modifier_id_idx
  on public.order_item_modifiers(modifier_id);

create index if not exists order_change_events_order_id_idx
  on public.order_change_events(order_id);

create index if not exists account_deletion_resolution_audit_resolved_by_idx
  on public.account_deletion_resolution_audit(resolved_by);

create index if not exists loyalty_transactions_created_by_idx
  on public.loyalty_transactions(created_by);

create index if not exists legal_documents_updated_by_idx
  on public.legal_documents(updated_by);

create index if not exists homepage_banners_updated_by_idx
  on public.homepage_banners(updated_by);

create index if not exists branch_delivery_zones_updated_by_idx
  on public.branch_delivery_zones(updated_by);

create index if not exists campaign_redemptions_order_id_idx
  on public.campaign_redemptions(order_id);

create index if not exists campaigns_updated_by_idx
  on public.campaigns(updated_by);

create index if not exists operations_alert_settings_updated_by_idx
  on public.operations_alert_settings(updated_by);

create index if not exists order_integrity_config_updated_by_idx
  on public.order_integrity_config(updated_by);

create index if not exists order_integrity_incidents_acknowledged_by_idx
  on public.order_integrity_incidents(acknowledged_by);

comment on function public.emit_order_change_event() is
  'Trigger-only order-change event emitter. Direct public/anon/authenticated EXECUTE revoked by 20260810130000; invoked only by the orders trigger (service_role retains diagnostic execute).';
