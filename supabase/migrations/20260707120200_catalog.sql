-- ============================================================================
-- Spicy Meal — menu catalog: branches, categories, products, modifiers,
-- product↔modifier-group links, and per-branch availability.
-- Read: public (active rows) + staff (all rows). Write: admin only.
-- ============================================================================

-- ---- branches -------------------------------------------------------------
create table if not exists public.branches (
  id                 uuid primary key default gen_random_uuid(),
  name_en            text not null,
  name_ar            text not null,
  address_en         text,
  address_ar         text,
  phone              text,
  latitude           double precision,
  longitude          double precision,
  delivery_fee       numeric(10,2) not null default 0 check (delivery_fee >= 0),
  min_delivery_order numeric(10,2) not null default 0 check (min_delivery_order >= 0),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---- categories -----------------------------------------------------------
create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name_en    text not null,
  name_ar    text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- products -------------------------------------------------------------
create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references public.categories(id) on delete restrict,
  name_en        text not null,
  name_ar        text not null,
  description_en text,
  description_ar text,
  price          numeric(10,2) not null check (price >= 0),
  calories       integer check (calories is null or calories >= 0),
  image_url      text,
  is_active      boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists products_category_id_idx on public.products(category_id);

-- ---- modifier groups & modifiers -----------------------------------------
create table if not exists public.modifier_groups (
  id          uuid primary key default gen_random_uuid(),
  name_en     text not null,
  name_ar     text not null,
  min_select  integer not null default 0 check (min_select >= 0),
  max_select  integer check (max_select is null or max_select >= 1),
  is_required boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.modifiers (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.modifier_groups(id) on delete cascade,
  name_en    text not null,
  name_ar    text not null,
  price      numeric(10,2) not null default 0,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists modifiers_group_id_idx on public.modifiers(group_id);

-- ---- product ↔ modifier-group links (M:N) --------------------------------
create table if not exists public.product_modifier_groups (
  product_id uuid not null references public.products(id) on delete cascade,
  group_id   uuid not null references public.modifier_groups(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (product_id, group_id)
);
create index if not exists pmg_group_id_idx on public.product_modifier_groups(group_id);

-- ---- per-branch product availability --------------------------------------
-- Absence of a row = available (default). An explicit row with is_available =
-- false marks a product unavailable at that branch.
create table if not exists public.branch_product_availability (
  branch_id    uuid not null references public.branches(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  is_available boolean not null default true,
  updated_at   timestamptz not null default now(),
  primary key (branch_id, product_id)
);
create index if not exists bpa_product_id_idx on public.branch_product_availability(product_id);

-- ---- updated_at triggers --------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['branches','categories','products','modifier_groups','modifiers','branch_product_availability']
  loop
    execute format('drop trigger if exists set_%1$s_updated_at on public.%1$s', t);
    execute format(
      'create trigger set_%1$s_updated_at before update on public.%1$s
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---- RLS: public read of active rows (+ staff read all), admin-only writes -
do $$
declare t text;
begin
  foreach t in array array['branches','categories','products','modifier_groups','modifiers',
                           'product_modifier_groups','branch_product_availability']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_write', t);
  end loop;
end $$;

-- Public SELECT policies (active rows for everyone; staff see everything).
drop policy if exists branches_select_public on public.branches;
create policy branches_select_public on public.branches
  for select to anon, authenticated using (is_active or public.is_staff());

drop policy if exists categories_select_public on public.categories;
create policy categories_select_public on public.categories
  for select to anon, authenticated using (is_active or public.is_staff());

drop policy if exists products_select_public on public.products;
create policy products_select_public on public.products
  for select to anon, authenticated using (is_active or public.is_staff());

drop policy if exists modifiers_select_public on public.modifiers;
create policy modifiers_select_public on public.modifiers
  for select to anon, authenticated using (is_active or public.is_staff());

-- Config/link tables carry no sensitive data — readable by everyone.
drop policy if exists modifier_groups_select_public on public.modifier_groups;
create policy modifier_groups_select_public on public.modifier_groups
  for select to anon, authenticated using (true);

drop policy if exists pmg_select_public on public.product_modifier_groups;
create policy pmg_select_public on public.product_modifier_groups
  for select to anon, authenticated using (true);

drop policy if exists bpa_select_public on public.branch_product_availability;
create policy bpa_select_public on public.branch_product_availability
  for select to anon, authenticated using (true);
