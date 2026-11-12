-- Regenerates e2e/fixtures/guest-catalog.json: what a signed-out visitor can
-- read, exported AS `anon` so row-level security and column grants decide the
-- rows exactly as PostgREST would.
--
-- Run it against a database built by the SQL CI harness (bootstrap, the whole
-- migration chain, then supabase/seed.sql — never Production):
--
--   psql -X -q -At -v ON_ERROR_STOP=1 -d <that database> \
--     -f e2e/fixtures/export-guest-catalog.sql > e2e/fixtures/guest-catalog.json
--   npx prettier --write e2e/fixtures/guest-catalog.json
--
-- Tables are listed by name rather than discovered, so a guest read of a table
-- not listed here fails the spec loudly instead of being answered with [].
--
-- `orders` is deliberately absent. As `anon` it raises "permission denied for
-- table orders" (42501), and the spec answers it that way.
begin;
set local role anon;
select json_build_object(
  'branches',                     (select coalesce(json_agg(t order by t.id), '[]') from public.branches t),
  'categories',                   (select coalesce(json_agg(t order by t.id), '[]') from public.categories t),
  'products',                     (select coalesce(json_agg(t order by t.id), '[]') from public.products t),
  'product_variants',             (select coalesce(json_agg(t order by t.id), '[]') from public.product_variants t),
  'modifier_groups',              (select coalesce(json_agg(t order by t.id), '[]') from public.modifier_groups t),
  'modifiers',                    (select coalesce(json_agg(t order by t.id), '[]') from public.modifiers t),
  'product_modifier_groups',      (select coalesce(json_agg(t order by t.product_id, t.group_id), '[]') from public.product_modifier_groups t),
  'branch_product_availability',  (select coalesce(json_agg(t), '[]') from public.branch_product_availability t),
  'branch_modifier_availability', (select coalesce(json_agg(t), '[]') from public.branch_modifier_availability t),
  'branch_variant_availability',  (select coalesce(json_agg(t), '[]') from public.branch_variant_availability t),
  'branch_delivery_zones',        (select coalesce(json_agg(t), '[]') from public.branch_delivery_zones t),
  'homepage_banners',             (select coalesce(json_agg(t), '[]') from public.homepage_banners t),
  'app_settings',                 (select coalesce(json_agg(t), '[]') from public.app_settings t),
  -- Read-only RPCs a guest calls, keyed by name, holding what anon gets back.
  'rpc', json_build_object(
    'whatsapp_login_enabled',     to_json(public.whatsapp_login_enabled())
  )
);
rollback;
