-- ============================================================================
-- Lazywait catalog mapping RPCs + status test.
--
-- Runs against a throwaway Postgres with all migrations applied. RAISES on any
-- failed assertion (script aborts non-zero). Covers:
--   * set_lazywait_mapping writes ONLY id/price-ref columns (names + local price
--     untouched) — branch / category / product(+price ref) / group / modifier.
--   * accountant (non-admin) is rejected 42501 on set/clear.
--   * clear_lazywait_mapping clears without touching names/prices.
--   * lazywait_mapping_status counts + readiness, secrets_configured boolean,
--     and NEVER leaks the api_token.
-- ============================================================================
begin;
set local session_replication_role = replica;  -- skip FK/triggers for fixtures

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_acc   uuid := gen_random_uuid();
  v_cat   uuid := gen_random_uuid();
  v_prod  uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_grp   uuid := gen_random_uuid();
  v_mod   uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_status jsonb;
  v_txt text;
  v_name text; v_price numeric;
begin
  -- Fixtures ----------------------------------------------------------------
  insert into auth.users(id, email) values (v_admin, 'a@x'), (v_acc, 'c@x');
  insert into public.profiles(id, role) values (v_admin, 'admin'), (v_acc, 'accountant');

  insert into public.categories(id, name_en, name_ar, is_active) values (v_cat, 'Pizzas', 'بيتزا', true);
  insert into public.products(id, category_id, name_en, name_ar, price, is_active)
    values (v_prod, v_cat, 'Margherita', 'مارغريتا', 25.00, true);
  insert into public.branches(id, name_en, name_ar) values (v_branch, 'Downtown', 'وسط');
  insert into public.modifier_groups(id, name_en, name_ar) values (v_grp, 'Sauces', 'صوصات');
  insert into public.modifiers(id, group_id, name_en, name_ar, price, is_active)
    values (v_mod, v_grp, 'Garlic', 'ثوم', 2.00, true);

  -- A pickup order blocked on missing item mapping.
  insert into public.orders (id, order_number, branch_id, order_type, subtotal, total,
      lazywait_sync_state, sync_blocked_reason)
    values (v_order, 'M-1', v_branch, 'pickup', 25, 25, 'blocked', 'missing_item_mapping');

  -- Configure lazywait secrets (server-side row) — recognizable token value.
  update public.integration_settings
     set enabled = true,
         public_config = jsonb_build_object('base_url','https://apiv2.lazywait.com/v1','client_id','CID_1'),
         secret_config = jsonb_build_object('api_token','lw_test_SECRET_123')
   where provider_type = 'lazywait';

  -- ===== As ADMIN: confirm mappings ========================================
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  perform public.set_lazywait_mapping('branch',   v_branch, 'LWB1');
  perform public.set_lazywait_mapping('category', v_cat,    'LWC1');
  perform public.set_lazywait_mapping('product',  v_prod,   'LWI1',
    jsonb_build_object('price_id','LWP1','name','Large','price_with_vat',25,'price_excl_vat',21.74));
  perform public.set_lazywait_mapping('modifier_group', v_grp, 'LWG1');
  perform public.set_lazywait_mapping('modifier',       v_mod, 'LWA1');

  -- id columns set...
  if (select lazywait_branch_id from public.branches where id = v_branch) <> 'LWB1'
     or (select lazywait_category_id from public.categories where id = v_cat) <> 'LWC1'
     or (select lazywait_item_id from public.products where id = v_prod) <> 'LWI1'
     or (select lazywait_price_id from public.products where id = v_prod) <> 'LWP1'
     or (select lazywait_group_id from public.modifier_groups where id = v_grp) <> 'LWG1'
     or (select lazywait_addon_id from public.modifiers where id = v_mod) <> 'LWA1' then
    raise exception 'SET FAILED: an id column did not persist';
  end if;

  -- ...price ref stored...
  if (select lazywait_price_ref->>'name' from public.products where id = v_prod) <> 'Large' then
    raise exception 'SET FAILED: price ref not stored';
  end if;

  -- ...and local name + price are UNTOUCHED.
  select name_en, price into v_name, v_price from public.products where id = v_prod;
  if v_name <> 'Margherita' or v_price <> 25.00 then
    raise exception 'SET FAILED: local name/price mutated (% / %)', v_name, v_price;
  end if;

  -- ===== As ACCOUNTANT: set/clear rejected 42501 ===========================
  perform set_config('request.jwt.claim.sub', v_acc::text, true);
  begin
    perform public.set_lazywait_mapping('branch', v_branch, 'HACK');
    raise exception 'EXPECTED 42501: accountant set';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.clear_lazywait_mapping('branch', v_branch);
    raise exception 'EXPECTED 42501: accountant clear';
  exception when sqlstate '42501' then null; end;

  -- ===== Status: accountant may VIEW; counts + readiness + no secret leak ===
  v_status := public.lazywait_mapping_status();
  if (v_status#>>'{branches,mapped}')::int <> 1 then raise exception 'STATUS branches.mapped'; end if;
  if (v_status#>>'{products,mapped}')::int <> 1 then raise exception 'STATUS products.mapped'; end if;
  if (v_status#>>'{products,total}')::int  <> 1 then raise exception 'STATUS products.total'; end if;
  if (v_status->>'blocked_orders')::int    <  1 then raise exception 'STATUS blocked_orders'; end if;
  if (v_status->>'secrets_configured')::boolean is not true then raise exception 'STATUS secrets_configured'; end if;
  -- readiness.ready must be false (blocked order + only 1 product mapped == total, but blocked>0)
  if (v_status#>>'{readiness,no_blocked_orders}')::boolean is not false then raise exception 'STATUS readiness.no_blocked_orders'; end if;
  -- CRITICAL: the token must NEVER appear in the status payload.
  v_txt := v_status::text;
  if v_txt ilike '%api_token%' or v_txt like '%lw_test_SECRET_123%' then
    raise exception 'SECRET LEAK in mapping status: %', v_txt;
  end if;

  -- ===== As CUSTOMER (no staff role): status rejected 42501 ================
  insert into public.profiles(id, role) values (gen_random_uuid(), 'customer') returning id into v_admin;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    perform public.lazywait_mapping_status();
    raise exception 'EXPECTED 42501: customer status';
  exception when sqlstate '42501' then null; end;

  -- ===== As ADMIN: clear product mapping (names/price still intact) ========
  perform set_config('request.jwt.claim.sub', (select id from public.profiles where role='admin' limit 1)::text, true);
  perform public.clear_lazywait_mapping('product', v_prod);
  if (select lazywait_item_id from public.products where id = v_prod) is not null
     or (select lazywait_price_ref from public.products where id = v_prod) is not null then
    raise exception 'CLEAR FAILED: product mapping not cleared';
  end if;
  select name_en, price into v_name, v_price from public.products where id = v_prod;
  if v_name <> 'Margherita' or v_price <> 25.00 then
    raise exception 'CLEAR FAILED: local name/price mutated on clear';
  end if;

  raise notice 'ALL MAPPING RPC CASES PASSED — status=%', v_status;
end $$;

rollback;
