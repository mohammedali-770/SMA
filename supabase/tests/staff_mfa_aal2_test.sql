-- ============================================================================
-- Staff MFA authorization-boundary regression coverage.
-- The CI harness replaces jwt_has_aal2() with true after migrations so existing
-- role tests remain focused. This suite therefore tests the immutable AAL parser
-- and proves the production role predicates are wired to the MFA helper.
-- ============================================================================
begin;

do $$
begin
  if public.aal_claim_satisfies_staff_mfa(null) then
    raise exception 'AAL FAILED: null unexpectedly satisfies staff MFA';
  end if;
  if public.aal_claim_satisfies_staff_mfa('aal1') then
    raise exception 'AAL FAILED: aal1 unexpectedly satisfies staff MFA';
  end if;
  if not public.aal_claim_satisfies_staff_mfa('aal2') then
    raise exception 'AAL FAILED: aal2 did not satisfy staff MFA';
  end if;
  if public.aal_claim_satisfies_staff_mfa('AAL2')
     or public.aal_claim_satisfies_staff_mfa('aal3')
     or public.aal_claim_satisfies_staff_mfa('') then
    raise exception 'AAL FAILED: non-exact claim unexpectedly accepted';
  end if;
end $$;

-- The migration-chain definitions (before harness replacement of jwt_has_aal2)
-- must make both staff predicates depend on the MFA helper. is_admin/is_staff
-- themselves are intentionally still used by RLS/RPCs; only the helper is kept
-- off the client RPC surface.
do $$
declare
  v_admin text := pg_get_functiondef('public.is_admin()'::regprocedure);
  v_staff text := pg_get_functiondef('public.is_staff()'::regprocedure);
begin
  if position('jwt_has_aal2' in v_admin) = 0 then
    raise exception 'WIRING FAILED: is_admin() does not depend on jwt_has_aal2()';
  end if;
  if position('jwt_has_aal2' in v_staff) = 0 then
    raise exception 'WIRING FAILED: is_staff() does not depend on jwt_has_aal2()';
  end if;
end $$;

-- Internal MFA helpers must not become user-callable RPCs.
do $$
begin
  if has_function_privilege('anon', 'public.jwt_has_aal2()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.jwt_has_aal2()', 'EXECUTE') then
    raise exception 'PRIVILEGE FAILED: jwt_has_aal2 is client executable';
  end if;
  if has_function_privilege('anon', 'public.aal_claim_satisfies_staff_mfa(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.aal_claim_satisfies_staff_mfa(text)', 'EXECUTE') then
    raise exception 'PRIVILEGE FAILED: AAL parser is client executable';
  end if;
end $$;

rollback;
