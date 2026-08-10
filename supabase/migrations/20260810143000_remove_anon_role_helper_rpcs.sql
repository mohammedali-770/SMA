-- ============================================================================
-- Spicy Meal — remove anonymous SECURITY DEFINER role-helper RPC exposure.
--
-- Public catalog policies historically used `(is_active OR is_staff())` for a
-- combined anon/authenticated role list. That forced the SECURITY DEFINER role
-- helper to remain anonymously executable even though an anonymous caller can
-- never legitimately be staff. Split each policy into:
--   * active rows for anon + authenticated; and
--   * inactive rows for authenticated staff only.
-- Then remove anon access to role helpers. Admin-only policies accidentally
-- declared TO public are narrowed to authenticated as well.
--
-- Re-runnable by design: the SQL CI harness replays the ENTIRE migration chain
-- as an idempotence report. Earlier catalog migrations recreate the legacy
-- policies during that replay, so this migration must drop BOTH legacy names and
-- its own replacement names before recreating the final policy set.
-- ============================================================================

-- Branches ------------------------------------------------------------------
drop policy if exists branches_select_public on public.branches;
drop policy if exists branches_select_active_public on public.branches;
drop policy if exists branches_select_inactive_staff on public.branches;
create policy branches_select_active_public
  on public.branches for select to anon, authenticated
  using (is_active);
create policy branches_select_inactive_staff
  on public.branches for select to authenticated
  using (not is_active and public.is_staff());

-- Categories ----------------------------------------------------------------
drop policy if exists categories_select_public on public.categories;
drop policy if exists categories_select_active_public on public.categories;
drop policy if exists categories_select_inactive_staff on public.categories;
create policy categories_select_active_public
  on public.categories for select to anon, authenticated
  using (is_active);
create policy categories_select_inactive_staff
  on public.categories for select to authenticated
  using (not is_active and public.is_staff());

-- Products ------------------------------------------------------------------
drop policy if exists products_select_public on public.products;
drop policy if exists products_select_active_public on public.products;
drop policy if exists products_select_inactive_staff on public.products;
create policy products_select_active_public
  on public.products for select to anon, authenticated
  using (is_active);
create policy products_select_inactive_staff
  on public.products for select to authenticated
  using (not is_active and public.is_staff());

-- Modifiers -----------------------------------------------------------------
drop policy if exists modifiers_select_public on public.modifiers;
drop policy if exists modifiers_select_active_public on public.modifiers;
drop policy if exists modifiers_select_inactive_staff on public.modifiers;
create policy modifiers_select_active_public
  on public.modifiers for select to anon, authenticated
  using (is_active);
create policy modifiers_select_inactive_staff
  on public.modifiers for select to authenticated
  using (not is_active and public.is_staff());

-- Delivery zones ------------------------------------------------------------
drop policy if exists bdz_select_public on public.branch_delivery_zones;
drop policy if exists bdz_select_active_public on public.branch_delivery_zones;
drop policy if exists bdz_select_inactive_staff on public.branch_delivery_zones;
create policy bdz_select_active_public
  on public.branch_delivery_zones for select to anon, authenticated
  using (is_active);
create policy bdz_select_inactive_staff
  on public.branch_delivery_zones for select to authenticated
  using (not is_active and public.is_staff());

-- These two policies were declared TO public even though their predicate is
-- admin-only. Make the intended role explicit so anon never evaluates is_admin.
drop policy if exists notification_log_admin_select on public.notification_log;
create policy notification_log_admin_select
  on public.notification_log for select to authenticated
  using (public.is_admin());

drop policy if exists push_devices_admin_select on public.push_devices;
create policy push_devices_admin_select
  on public.push_devices for select to authenticated
  using (public.is_admin());

-- `current_app_role` is internal plumbing only; clients never need to call it
-- directly. is_admin/is_staff must remain executable by authenticated because
-- authenticated RLS policies evaluate them, but anonymous callers no longer do.
revoke execute on function public.current_app_role() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_staff() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;

comment on function public.current_app_role() is
  'Internal role lookup used by staff authorization helpers. Direct client EXECUTE revoked; is_admin/is_staff call it under SECURITY DEFINER ownership.';
comment on function public.is_admin() is
  'Authenticated-policy helper only. Direct anon EXECUTE revoked; returns true only for admin role plus AAL2.';
comment on function public.is_staff() is
  'Authenticated-policy helper only. Direct anon EXECUTE revoked; returns true only for admin/accountant role plus AAL2.';
