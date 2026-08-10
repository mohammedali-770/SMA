-- ============================================================================
-- Spicy Meal — require MFA assurance level 2 for every staff/admin privilege.
--
-- A staff role alone is no longer sufficient. `is_admin()` / `is_staff()` are
-- the common authorization predicates used by admin SECURITY DEFINER RPCs and
-- staff RLS policies, so enforcing JWT `aal=aal2` here protects browser callers
-- even if they bypass the React MFA screen and call PostgREST/RPC directly.
--
-- Customers are unaffected: own-row policies continue to use auth.uid() first.
-- Service/scheduled functions use their own service-role/shared-secret contracts
-- and do not become staff merely through these predicates.
-- ============================================================================

create or replace function public.aal_claim_satisfies_staff_mfa(p_aal text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_aal = 'aal2', false);
$$;

create or replace function public.jwt_has_aal2()
returns boolean
language sql
stable
set search_path = public
as $$
  select public.aal_claim_satisfies_staff_mfa(auth.jwt() ->> 'aal');
$$;

-- These helpers are internal authorization plumbing, not public RPC surfaces.
revoke all on function public.aal_claim_satisfies_staff_mfa(text)
  from public, anon, authenticated;
revoke all on function public.jwt_has_aal2()
  from public, anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_app_role() = 'admin'
    and public.jwt_has_aal2(),
    false
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.current_app_role() in ('admin', 'accountant')
    and public.jwt_has_aal2(),
    false
  );
$$;

comment on function public.aal_claim_satisfies_staff_mfa(text) is
  'Pure staff-MFA assurance predicate: only the exact Supabase Auth claim aal2 satisfies staff MFA.';
comment on function public.jwt_has_aal2() is
  'Internal authorization helper. Reads the current Supabase JWT aal claim and returns true only for aal2.';
comment on function public.is_admin() is
  'True only when the current profile role is admin AND the current JWT has aal=aal2 (staff MFA enforced since 20260810142000).';
comment on function public.is_staff() is
  'True only when the current profile role is admin/accountant AND the current JWT has aal=aal2 (staff MFA enforced since 20260810142000).';
