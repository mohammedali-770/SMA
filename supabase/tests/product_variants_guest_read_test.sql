-- ============================================================================
-- Guest menu read (migration 20260930120000).
--
-- WHAT THIS PINS, and why each one is worth a test rather than a comment.
--
--   * A SIGNED-OUT READ OF product_variants SUCCEEDS (CASES 1-2). Before the
--     fix it raised 42501 — PostgREST's 401 — because the policy called
--     is_staff(), which anon cannot execute. Run against the chain WITHOUT the
--     migration, CASE 1 fails with exactly that error; that is how the bug was
--     reproduced before it was fixed.
--
--   * NOTHING CHANGES FOR A SIGNED-IN CALLER (CASES 3-4). A customer still sees
--     only active tiers; staff still see inactive ones too.
--
--   * THE RULE, NOT JUST THIS TABLE (CASE 5). For every table in public where
--     anon holds SELECT and some policy admits anon, an anon read must not
--     raise. A future policy that writes `OR is_staff()` for anon — the exact
--     regression this migration repairs, two weeks after 20260810143000 fixed
--     it — fails here instead of breaking the guest menu in production.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

create temporary table t_pvg (
  product_id  uuid,
  active_id   uuid,
  inactive_id uuid
) on commit drop;

do $$
declare
  v_cat      uuid;
  v_product  uuid := gen_random_uuid();
  v_active   uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid();
begin
  select id into v_cat from public.categories order by sort_order limit 1;
  if v_cat is null then
    raise exception 'FIXTURE FAILED: no seeded category';
  end if;

  insert into public.products (id, category_id, name_en, name_ar, price, is_active)
  values (v_product, v_cat, 'Guest Probe Platter', 'طبق تجربة', 30.00, true);
  insert into public.product_variants (id, product_id, name_en, name_ar, price, is_active)
  values (v_active,   v_product, 'Regular', 'عادي', 30.00, true),
         (v_inactive, v_product, 'Family',  'عائلي', 55.00, false);

  insert into t_pvg values (v_product, v_active, v_inactive);
end $$;

-- ---------------------------------------------------------------------------
-- CASE 1 — anon reads product_variants, and sees only the active tier
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx       t_pvg%rowtype;
  v_active   integer;
  v_inactive integer;
begin
  select * into v_fx from t_pvg;
  begin
    set local role anon;
    select count(*) filter (where id = v_fx.active_id),
           count(*) filter (where id = v_fx.inactive_id)
      into v_active, v_inactive
      from public.product_variants
     where product_id = v_fx.product_id;
    reset role;
  exception when others then
    reset role;
    raise exception 'CASE 1 FAILED: anon cannot read product_variants: % (%)', sqlerrm, sqlstate;
  end;
  if v_active <> 1 or v_inactive <> 0 then
    raise exception 'CASE 1 FAILED: anon sees active=% inactive=%, expected 1 and 0', v_active, v_inactive;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 2 — the menu's actual shape: products joined to their tiers, as anon
-- (a PostgREST embed is this join)
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx t_pvg%rowtype;
  v_n  integer;
begin
  select * into v_fx from t_pvg;
  begin
    set local role anon;
    select count(*) into v_n
      from public.products p
      join public.product_variants v on v.product_id = p.id
     where p.id = v_fx.product_id;
    reset role;
  exception when others then
    reset role;
    raise exception 'CASE 2 FAILED: anon cannot join products to their tiers: % (%)', sqlerrm, sqlstate;
  end;
  if v_n <> 1 then
    raise exception 'CASE 2 FAILED: anon sees % tier(s) for the probe product, expected 1', v_n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 3 — a signed-in customer still sees only the active tier
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx       t_pvg%rowtype;
  v_active   integer;
  v_inactive integer;
begin
  select * into v_fx from t_pvg;
  perform set_config('test.auth_uid', gen_random_uuid()::text, true);
  set local role authenticated;
  select count(*) filter (where id = v_fx.active_id),
         count(*) filter (where id = v_fx.inactive_id)
    into v_active, v_inactive
    from public.product_variants
   where product_id = v_fx.product_id;
  reset role;
  perform set_config('test.auth_uid', '', true);
  if v_active <> 1 or v_inactive <> 0 then
    raise exception 'CASE 3 FAILED: customer sees active=% inactive=%, expected 1 and 0', v_active, v_inactive;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 4 — staff still see the inactive tier too
-- ---------------------------------------------------------------------------
do $$
declare
  v_fx       t_pvg%rowtype;
  v_active   integer;
  v_inactive integer;
begin
  select * into v_fx from t_pvg;
  perform set_config('test.is_staff', 'true', true);
  set local role authenticated;
  select count(*) filter (where id = v_fx.active_id),
         count(*) filter (where id = v_fx.inactive_id)
    into v_active, v_inactive
    from public.product_variants
   where product_id = v_fx.product_id;
  reset role;
  perform set_config('test.is_staff', '', true);
  if v_active <> 1 or v_inactive <> 1 then
    raise exception 'CASE 4 FAILED: staff see active=% inactive=%, expected 1 and 1', v_active, v_inactive;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- CASE 5 — every table anon may read, anon CAN read
--
-- "May read" = anon holds table-level SELECT and at least one SELECT (or ALL)
-- policy admits anon (or PUBLIC). For each, a read under the anon role must
-- not raise. An empty result is fine; an error is the defect.
-- ---------------------------------------------------------------------------
do $$
declare
  v_t      text;
  v_failed text := '';
begin
  for v_t in
    select distinct c.relname
      from pg_class c
      join pg_policy pol on pol.polrelid = c.oid
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p')
       and pol.polcmd in ('r', '*')
       and (0 = any(pol.polroles) or 'anon'::regrole::oid = any(pol.polroles))
       and has_table_privilege('anon', c.oid, 'SELECT')
     order by c.relname
  loop
    begin
      set local role anon;
      execute format('select 1 from public.%I limit 1', v_t);
      reset role;
    exception when others then
      reset role;
      v_failed := v_failed || format(' %s (%s: %s);', v_t, sqlstate, sqlerrm);
    end;
  end loop;
  if v_failed <> '' then
    raise exception 'CASE 5 FAILED: anon is admitted by a policy but its read raises:%', v_failed;
  end if;
end $$;

rollback;
