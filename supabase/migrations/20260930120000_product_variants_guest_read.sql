-- Spicy Meal — let a signed-out customer read the menu's price tiers.
--
-- THE DEFECT, measured live 2026-11-09. Every signed-out read of
-- `product_variants` fails with 42501, which PostgREST returns as HTTP 401 —
-- not an empty list, a refusal. The table grants anon SELECT; the policy is
-- the problem:
--
--     product_variants_select_public  FOR SELECT TO anon, authenticated
--       USING (is_active OR public.is_staff())
--
-- anon has no EXECUTE on `is_staff()` (20260810143000 removed it, correctly:
-- an anonymous caller can never be staff). Postgres checks EXECUTE on every
-- function in a policy expression when the query starts, before it evaluates
-- a single row, so the `is_active` half never gets a chance: the whole read is
-- refused.
--
-- IT IS A REGRESSION OF A FIX THIS REPOSITORY ALREADY MADE. 20260810143000 split
-- exactly this shape on branches, categories, products and modifiers when it
-- took the role helpers away from anon. product_variants arrived two weeks
-- later (20260824120000) and brought the combined `OR is_staff()` form back.
-- Nobody noticed because the app has never been used signed out: it sends a
-- signed-out user to the login screen before the menu loads. Guest browsing
-- (App Store guideline 5.1.1(v)) is what makes it matter.
--
-- Of all 17 SELECT policies that admit anon, this is the ONLY one that calls a
-- function anon cannot execute (read live). The paired suite turns that
-- observation into a rule for every future table.
--
-- THE FIX is the same split, with the same names pattern:
--   * active tiers for anon + authenticated;
--   * inactive tiers for authenticated staff only.
-- For authenticated callers the two permissive policies OR together into
-- `is_active OR (NOT is_active AND is_staff())`, which is the old predicate —
-- so nothing changes for a signed-in customer or for staff. For anon the read
-- now succeeds and returns active tiers only.
--
-- RE-RUNNABLE BY DESIGN, for the reason 20260810143000 records: the SQL CI
-- harness replays the whole chain, and 20260824120000 recreates the legacy
-- policy during that replay, so this file drops the legacy name AND its own
-- names before creating the final set.
--
-- MONEY PATH UNTOUCHED: no function is defined or redefined; asserted below.
-- NO DEPLOY IMPLIED. Applying it is a §5 action, named by version, and it must
-- land before any build that lets a signed-out user reach the menu.

drop policy if exists product_variants_select_public         on public.product_variants;
drop policy if exists product_variants_select_active_public  on public.product_variants;
drop policy if exists product_variants_select_inactive_staff on public.product_variants;

create policy product_variants_select_active_public
  on public.product_variants for select to anon, authenticated
  using (is_active);

create policy product_variants_select_inactive_staff
  on public.product_variants for select to authenticated
  using (not is_active and public.is_staff());

-- ---------------------------------------------------------------------------
-- Self-verification — outcomes, not statements.
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_n    integer;
  v_txt  text;
  v_list text;
begin
  -- (1) The exact policy set: the admin write policy is untouched, the legacy
  --     combined policy is gone, and the two replacements exist as written.
  select string_agg(policyname || '|' || cmd || '|' || roles::text, ', ' order by policyname)
    into v_list
    from pg_policies
   where schemaname = 'public' and tablename = 'product_variants';
  if v_list is distinct from
       'product_variants_admin_write|ALL|{authenticated}, '
    || 'product_variants_select_active_public|SELECT|{anon,authenticated}, '
    || 'product_variants_select_inactive_staff|SELECT|{authenticated}' then
    raise exception 'unexpected product_variants policy set: %', coalesce(v_list, 'NULL');
  end if;

  -- (2) The OUTCOME: anon's read succeeds. A predicate is not an outcome, so
  --     the read is actually performed under the anon role.
  begin
    set local role anon;
    select count(*) into v_n from public.product_variants;
    reset role;
  exception when others then
    reset role;
    raise exception 'anon still cannot read product_variants: % (%)', sqlerrm, sqlstate;
  end;

  -- (3) Money path untouched. `is distinct from`, so a NULL fails.
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'place_order';
  if v_txt is distinct from '12b6816d256c29b76edf947ae1a7ea77' then
    raise exception 'place_order moved to %, expected 12b6816d256c29b76edf947ae1a7ea77', coalesce(v_txt, 'NULL');
  end if;
  select md5(pg_get_functiondef(p.oid)) into v_txt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'compute_order_snapshot';
  if v_txt is distinct from '22e2d42935459e7bf93abb2941b56325' then
    raise exception 'compute_order_snapshot moved to %, expected 22e2d42935459e7bf93abb2941b56325', coalesce(v_txt, 'NULL');
  end if;

  raise notice 'product_variants: anon reads active tiers; staff still read inactive ones';
end
$verify$;
