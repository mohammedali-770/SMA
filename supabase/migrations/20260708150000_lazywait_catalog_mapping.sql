-- ============================================================================
-- Spicy Meal — Lazywait catalog mapping (pull cache + admin mapping RPCs).
--
-- Lets an admin pull the Lazywait catalog (branches/categories/items/addons/
-- addon-groups) into a server-side cache, review suggested matches, and CONFIRM
-- ID mappings into the local records — WITHOUT ever overwriting local names or
-- prices (Lazywait data is used for ID mapping + reference only) and WITHOUT
-- exposing any secret to the browser.
--
-- Adds:
--   1. products.lazywait_price_ref jsonb — optional price reference snapshot
--      (price_id + name + price_with_vat + price_excl_vat). Reference only; the
--      local price column is never touched, and price_id is NOT sent in Create
--      Order yet.
--   2. lazywait_catalog_items — the pulled catalog cache (staff-readable; only
--      the service-role Edge Function writes it). Stores ids/names/prices/raw.
--   3. lazywait_catalog_pulls — one row per pull run (last sync time + safe
--      per-endpoint errors), staff-readable.
--   4. set_lazywait_mapping / clear_lazywait_mapping — admin-only RPCs that
--      write ONLY the mapping id columns (+ price ref for products).
--   5. lazywait_mapping_status() — staff-only summary (mapped/total per entity,
--      blocked orders, readiness, secrets-configured BOOLEAN — never the secret).
--
-- Idempotent: create-if-not-exists + create-or-replace throughout.
-- ============================================================================

-- ---- 1. Optional product price reference snapshot -------------------------
alter table public.products add column if not exists lazywait_price_ref jsonb;

-- ---- 2. Pulled catalog cache ----------------------------------------------
create table if not exists public.lazywait_catalog_items (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null check (entity_type in ('branch','category','item','addon','addon_group')),
  lazywait_id   text not null,
  name_en       text,
  name_ar       text,
  name_other    text,          -- fallback display name (e.g. Turkish test data)
  parent_id     text,          -- item->category_id, addon->addons_group_id (reference)
  prices        jsonb,         -- item: [{price_id,name,price_with_vat,price_excl_vat}], else null
  branches_ids  jsonb,         -- lazywait branch ids the record is available in
  min_selection integer,       -- addon_group (nullable)
  max_selection integer,       -- addon_group (nullable)
  multi_max     integer,       -- addon_group (nullable)
  raw           jsonb not null default '{}'::jsonb,   -- full snapshot for review
  pulled_at     timestamptz not null default now(),
  unique (entity_type, lazywait_id)
);
create index if not exists lazywait_catalog_items_entity_idx
  on public.lazywait_catalog_items (entity_type);

-- ---- 3. Pull run log (last sync time + safe errors) -----------------------
create table if not exists public.lazywait_catalog_pulls (
  id         uuid primary key default gen_random_uuid(),
  status     text not null check (status in ('success','partial','error')),
  counts     jsonb not null default '{}'::jsonb,   -- {branches,categories,items,addons,addon_groups}
  errors     jsonb not null default '[]'::jsonb,   -- [{endpoint,message}] sanitized
  created_at timestamptz not null default now()
);
create index if not exists lazywait_catalog_pulls_created_idx
  on public.lazywait_catalog_pulls (created_at desc);

-- ---- RLS: staff may read the cache/pulls; only service_role writes ---------
-- (service_role bypasses RLS; authenticated gets SELECT gated to staff; no
--  insert/update/delete grant to authenticated at all.)
do $$
declare t text;
begin
  foreach t in array array['lazywait_catalog_items','lazywait_catalog_pulls']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_staff())',
      t || '_staff_read', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- set_lazywait_mapping(): admin CONFIRMS an id mapping onto a local record.
-- Writes ONLY the mapping id column(s) — never names, never the local price.
-- For 'product', an optional p_price_ref stores the chosen Lazywait price for
-- reference (and mirrors its price_id into lazywait_price_id). Admin-only.
-- ---------------------------------------------------------------------------
create or replace function public.set_lazywait_mapping(
  p_entity     text,
  p_local_id   uuid,
  p_lazywait_id text,
  p_price_ref  jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   text := nullif(btrim(p_lazywait_id), '');
  v_hit  boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins may edit Lazywait mappings' using errcode = '42501';
  end if;
  if v_id is null then
    raise exception 'lazywait id must not be empty' using errcode = '22023';
  end if;

  if p_entity = 'branch' then
    update public.branches set lazywait_branch_id = v_id where id = p_local_id;
  elsif p_entity = 'category' then
    update public.categories set lazywait_category_id = v_id where id = p_local_id;
  elsif p_entity = 'product' then
    update public.products set
      lazywait_item_id  = v_id,
      lazywait_price_id = case when p_price_ref is not null
                               then nullif(p_price_ref->>'price_id', '')
                               else lazywait_price_id end,
      lazywait_price_ref = case when p_price_ref is not null
                               then p_price_ref else lazywait_price_ref end
    where id = p_local_id;
  elsif p_entity = 'modifier_group' then
    update public.modifier_groups set lazywait_group_id = v_id where id = p_local_id;
  elsif p_entity = 'modifier' then
    update public.modifiers set lazywait_addon_id = v_id where id = p_local_id;
  else
    raise exception 'unknown mapping entity: %', p_entity using errcode = '22023';
  end if;

  get diagnostics v_hit = row_count;
  if not v_hit then
    raise exception 'local % record not found: %', p_entity, p_local_id using errcode = 'P0002';
  end if;
end $$;

revoke all on function public.set_lazywait_mapping(text, uuid, text, jsonb) from public, anon;
grant execute on function public.set_lazywait_mapping(text, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- clear_lazywait_mapping(): admin removes an id mapping (+ price ref for
-- products). Never touches names/prices. Admin-only.
-- ---------------------------------------------------------------------------
create or replace function public.clear_lazywait_mapping(
  p_entity   text,
  p_local_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins may edit Lazywait mappings' using errcode = '42501';
  end if;

  if p_entity = 'branch' then
    update public.branches set lazywait_branch_id = null where id = p_local_id;
  elsif p_entity = 'category' then
    update public.categories set lazywait_category_id = null where id = p_local_id;
  elsif p_entity = 'product' then
    update public.products set lazywait_item_id = null, lazywait_price_id = null,
      lazywait_price_ref = null where id = p_local_id;
  elsif p_entity = 'modifier_group' then
    update public.modifier_groups set lazywait_group_id = null where id = p_local_id;
  elsif p_entity = 'modifier' then
    update public.modifiers set lazywait_addon_id = null where id = p_local_id;
  else
    raise exception 'unknown mapping entity: %', p_entity using errcode = '22023';
  end if;
end $$;

revoke all on function public.clear_lazywait_mapping(text, uuid) from public, anon;
grant execute on function public.clear_lazywait_mapping(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- lazywait_mapping_status(): staff-readable readiness summary. Reports counts
-- and a `secrets_configured` BOOLEAN computed server-side — the secret itself
-- is NEVER returned. Staff-only (admin + accountant may view).
-- ---------------------------------------------------------------------------
create or replace function public.lazywait_mapping_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_total   int; v_branch_mapped   int;
  v_cat_total      int; v_cat_mapped      int;
  v_prod_total     int; v_prod_mapped     int;
  v_group_total    int; v_group_mapped    int;
  v_mod_total      int; v_mod_mapped      int;
  v_blocked        int;
  v_secrets        boolean;
  v_last_pull      timestamptz;
  v_ready_secrets  boolean;
  v_ready_branch   boolean;
  v_ready_products boolean;
  v_ready_noblock  boolean;
begin
  if not public.is_staff() then
    raise exception 'Only staff may view Lazywait mapping status' using errcode = '42501';
  end if;

  select count(*), count(lazywait_branch_id) into v_branch_total, v_branch_mapped
    from public.branches;
  select count(*), count(lazywait_category_id) into v_cat_total, v_cat_mapped
    from public.categories where is_active;
  -- "active menu" products only — those are what a pickup order can contain.
  select count(*), count(lazywait_item_id) into v_prod_total, v_prod_mapped
    from public.products where is_active;
  select count(*), count(lazywait_group_id) into v_group_total, v_group_mapped
    from public.modifier_groups;
  select count(*), count(lazywait_addon_id) into v_mod_total, v_mod_mapped
    from public.modifiers where is_active;

  select count(*) into v_blocked from public.orders
    where lazywait_sync_state = 'blocked'
      and sync_blocked_reason in ('missing_item_mapping','missing_branch_mapping');

  -- api_token + client_id present AND provider enabled — never returns the token.
  select coalesce(bool_or(
           enabled
           and coalesce(secret_config->>'api_token','') <> ''
           and coalesce(public_config->>'client_id','') <> ''
         ), false)
    into v_secrets
    from public.integration_settings where provider_type = 'lazywait';

  select max(created_at) into v_last_pull from public.lazywait_catalog_pulls;

  v_ready_secrets  := v_secrets;
  v_ready_branch   := v_branch_mapped >= 1;
  v_ready_products := v_prod_total > 0 and v_prod_mapped = v_prod_total;
  v_ready_noblock  := v_blocked = 0;

  return jsonb_build_object(
    'branches',        jsonb_build_object('mapped', v_branch_mapped, 'total', v_branch_total),
    'categories',      jsonb_build_object('mapped', v_cat_mapped,    'total', v_cat_total),
    'products',        jsonb_build_object('mapped', v_prod_mapped,   'total', v_prod_total),
    'modifier_groups', jsonb_build_object('mapped', v_group_mapped,  'total', v_group_total),
    'modifiers',       jsonb_build_object('mapped', v_mod_mapped,    'total', v_mod_total),
    'blocked_orders',  v_blocked,
    'secrets_configured', v_secrets,
    'last_pull_at',    v_last_pull,
    'readiness', jsonb_build_object(
      'secrets',               v_ready_secrets,
      'branch_mapped',         v_ready_branch,
      'active_products_mapped', v_ready_products,
      'no_blocked_orders',     v_ready_noblock,
      'ready', (v_ready_secrets and v_ready_branch and v_ready_products and v_ready_noblock)
    )
  );
end $$;

revoke all on function public.lazywait_mapping_status() from public, anon;
grant execute on function public.lazywait_mapping_status() to authenticated;
