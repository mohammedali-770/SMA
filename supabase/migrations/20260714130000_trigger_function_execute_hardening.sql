-- Spicy Meal — security hygiene: close direct RPC execution of trigger-only
-- functions (Supabase Security Advisor: "Public Can Execute SECURITY DEFINER
-- Function" / client-executable function warnings).
--
-- The three functions below are TRIGGER-ONLY implementation details:
--   * handle_auth_user_phone_confirmed() — trigger on_auth_user_phone_confirmed
--     (auth.users, AFTER UPDATE OF phone_confirmed_at): mirrors the confirmed
--     phone onto the profile.
--   * set_lazywait_initial_sync()       — trigger set_orders_lazywait_initial_sync
--     (orders): seeds the POS sync state on insert.
--   * stamp_payment_record_ts()         — trigger stamp_payment_record_ts
--     (payment_records): stamps confirmed_at/failed_at on status transitions.
--
-- They were created with the default PUBLIC EXECUTE grant, which additionally
-- exposed them at /rest/v1/rpc/<name> to anon and authenticated callers.
-- PostgREST cannot actually invoke trigger-returning functions, so this was
-- not exploitable — but the grants are unnecessary, inconsistent with the
-- repo's other trigger functions (set_updated_at / handle_new_user /
-- set_order_number, which already have no client grants), and they trip the
-- Security Advisor. This migration REVOKES the client EXECUTE grants only:
--
--   * the functions are NOT dropped, recreated, or altered;
--   * their triggers are NOT touched and keep firing exactly as before —
--     trigger execution does not require EXECUTE privilege from the role
--     performing the DML (proven in production by the three already-restricted
--     trigger functions above);
--   * SECURITY DEFINER/INVOKER status, ownership, search_path, table
--     permissions and RLS policies are all unchanged;
--   * no new grant is added to service_role or any client role — the function
--     owner (postgres) retains its normal owner privileges implicitly.
--
-- NOTE (deployment): migration-history reconciliation between this repository
-- and the live project is still PENDING. Do NOT apply this file via
-- `supabase db push` until that separate reconciliation task is approved —
-- apply it through the same owner-approved mechanism used for the other live
-- migrations.

revoke execute on function public.handle_auth_user_phone_confirmed()
  from public, anon, authenticated;

revoke execute on function public.set_lazywait_initial_sync()
  from public, anon, authenticated;

revoke execute on function public.stamp_payment_record_ts()
  from public, anon, authenticated;
