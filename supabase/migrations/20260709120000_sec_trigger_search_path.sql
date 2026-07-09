-- ============================================================================
-- Spicy Meal — SECURITY hardening: pin search_path on the two trigger functions
-- that were still search_path-mutable.
--
-- All SECURITY DEFINER functions already pin `set search_path = public`. The two
-- remaining plain (non-definer) trigger functions — set_updated_at and
-- set_order_number — did not, so Supabase's `function_search_path_mutable`
-- advisor flags them. They are not a privilege-escalation vector (they run with
-- the invoker's rights, and orders are only ever inserted via the SECURITY
-- DEFINER place_order, which already pins search_path), but pinning the path is
-- zero-risk defense-in-depth and clears the advisor.
--
-- Pure `create or replace` with the SAME body — every existing trigger that
-- references these functions keeps working unchanged. now()/to_char/lpad/nextval
-- all resolve identically under `public` (+ implicit pg_catalog), so behavior is
-- byte-for-byte identical; only the resolved-name safety is tightened.
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.set_order_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number :=
      'SM-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.order_number_seq')::text, 6, '0');
  end if;
  return new;
end $$;
