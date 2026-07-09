-- ============================================================================
-- Delivery zones (per-branch coverage polygons) + branch delivery/pickup flags.
--
-- This migration is ADDITIVE and changes no existing behavior:
--   * enables PostGIS (in the `extensions` schema, Supabase convention),
--   * adds delivery/pickup enablement + temporary-closure flags to branches
--     (all default to the current implicit behavior: delivery & pickup ON),
--   * creates branch_delivery_zones (one active MultiPolygon per branch),
--   * adds a server-side point-in-zone helper + admin-only write RPCs.
--
-- Order-creation enforcement lives in a SEPARATE, later migration
-- (20260710120100_place_order_delivery_zone.sql) so this one can be applied
-- first without rejecting any delivery order before zones are drawn.
-- ============================================================================

create extension if not exists postgis with schema extensions;

-- ---- Branch operational flags ---------------------------------------------
-- Defaults preserve today's behavior: a branch delivers and offers pickup
-- unless an admin turns it off. `delivery_temporarily_closed` is a soft,
-- reversible outage switch distinct from `is_active` (whole-branch closure).
alter table public.branches add column if not exists delivery_enabled            boolean not null default true;
alter table public.branches add column if not exists pickup_enabled              boolean not null default true;
alter table public.branches add column if not exists delivery_temporarily_closed boolean not null default false;
-- Display-only ETA shown to customers/admin; NOT used in any pricing math.
alter table public.branches add column if not exists estimated_delivery_minutes  integer
  check (estimated_delivery_minutes is null or estimated_delivery_minutes >= 0);

-- ---- Delivery-zone table ---------------------------------------------------
create table if not exists public.branch_delivery_zones (
  id                         uuid primary key default gen_random_uuid(),
  branch_id                  uuid not null references public.branches(id) on delete cascade,
  name                       text,
  -- Server-normalized GeoJSON (from ST_AsGeoJSON of the validated geometry) so
  -- the frontend renders exactly what was validated/stored.
  zone_geojson               jsonb not null,
  zone_polygon               extensions.geometry(MultiPolygon, 4326) not null,
  is_active                  boolean not null default true,
  -- Placeholders for future per-zone overrides. NOT wired into pricing yet:
  -- place_order uses branch-level delivery_fee / min_delivery_order.
  delivery_fee               numeric(10,2) check (delivery_fee is null or delivery_fee >= 0),
  min_order                  numeric(10,2) check (min_order is null or min_order >= 0),
  estimated_delivery_minutes integer       check (estimated_delivery_minutes is null or estimated_delivery_minutes >= 0),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid references public.profiles(id) on delete set null
);

create index if not exists bdz_branch_active_idx on public.branch_delivery_zones (branch_id, is_active);
create index if not exists bdz_polygon_gist      on public.branch_delivery_zones using gist (zone_polygon);
-- At most one ACTIVE zone per branch (belt-and-suspenders around the write RPC).
create unique index if not exists bdz_one_active_per_branch
  on public.branch_delivery_zones (branch_id) where is_active;

drop trigger if exists set_branch_delivery_zones_updated_at on public.branch_delivery_zones;
create trigger set_branch_delivery_zones_updated_at
  before update on public.branch_delivery_zones
  for each row execute function public.set_updated_at();

-- ---- RLS: customers/anon read ACTIVE zones; staff read all; NO client writes
alter table public.branch_delivery_zones enable row level security;
revoke all on public.branch_delivery_zones from anon, authenticated;
grant select on public.branch_delivery_zones to anon, authenticated;

drop policy if exists bdz_select_public on public.branch_delivery_zones;
create policy bdz_select_public on public.branch_delivery_zones
  for select to anon, authenticated using (is_active or public.is_staff());
-- No insert/update/delete policy: all writes go through the SECURITY DEFINER
-- RPCs below (which run as owner and bypass RLS). Reads that reach customers
-- must select explicit columns and omit `updated_by`.

-- ---- Point-in-zone helper (the PostGIS search_path firewall) ----------------
-- place_order pins `search_path = public`; PostGIS lives in `extensions`. So
-- place_order never references a PostGIS symbol directly — it calls only this
-- wrapper, whose own search_path resolves ST_* while place_order's stays clean.
-- ST_Covers (not ST_Contains) so a point exactly on the boundary counts inside.
create or replace function public.point_in_active_delivery_zone(
  p_branch_id uuid,
  p_lat       double precision,
  p_lng       double precision
) returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.branch_delivery_zones z
    where z.branch_id = p_branch_id
      and z.is_active
      and ST_Covers(z.zone_polygon, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326))
  );
$$;

revoke all on function public.point_in_active_delivery_zone(uuid, double precision, double precision) from public, anon;
grant execute on function public.point_in_active_delivery_zone(uuid, double precision, double precision) to authenticated;

-- ---- Admin write RPC: upsert the active delivery zone -----------------------
-- Mirrors set_payment_settings: admin-gated, security definer, pinned
-- search_path, server-side geometry validation, revoke/grant. Accepts a GeoJSON
-- *Geometry* (Polygon or MultiPolygon) — NOT a Feature/FeatureCollection.
create or replace function public.set_branch_delivery_zone(
  p_branch_id uuid,
  p_geojson   jsonb,
  p_name      text    default null,
  p_is_active boolean default true
) returns public.branch_delivery_zones
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_geom extensions.geometry;
  v_row  public.branch_delivery_zones;
begin
  if not public.is_admin() then
    raise exception 'Only admins may edit delivery zones' using errcode = '42501';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'Branch not found' using errcode = '22023';
  end if;
  if p_geojson is null then
    raise exception 'A delivery-zone polygon is required' using errcode = '22023';
  end if;

  -- Parse + repair + normalize to a valid MultiPolygon in EPSG:4326. Any parse
  -- error (e.g. a Feature/FeatureCollection or malformed JSON) is rejected.
  begin
    v_geom := ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(p_geojson::text), 4326)));
  exception when others then
    raise exception 'Invalid zone GeoJSON' using errcode = '22023';
  end;

  if v_geom is null
     or ST_IsEmpty(v_geom)
     or not ST_IsValid(v_geom)
     or ST_GeometryType(v_geom) <> 'ST_MultiPolygon'
     or ST_NPoints(v_geom) < 4 then
    raise exception 'Invalid or degenerate delivery-zone polygon' using errcode = '22023';
  end if;

  -- One active zone per branch: retire the current active one first.
  if coalesce(p_is_active, true) then
    update public.branch_delivery_zones
      set is_active = false, updated_at = now()
      where branch_id = p_branch_id and is_active;
  end if;

  insert into public.branch_delivery_zones
    (branch_id, name, zone_geojson, zone_polygon, is_active, updated_by, updated_at)
  values
    (p_branch_id, p_name, ST_AsGeoJSON(v_geom)::jsonb, v_geom, coalesce(p_is_active, true), auth.uid(), now())
  returning * into v_row;

  return v_row;
end $$;

revoke all on function public.set_branch_delivery_zone(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.set_branch_delivery_zone(uuid, jsonb, text, boolean) to authenticated;

-- ---- Admin write RPC: clear (deactivate) the active zone --------------------
-- Deactivate rather than hard-delete so zone history is preserved.
create or replace function public.clear_branch_delivery_zone(
  p_branch_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins may edit delivery zones' using errcode = '42501';
  end if;
  update public.branch_delivery_zones
    set is_active = false, updated_by = auth.uid(), updated_at = now()
    where branch_id = p_branch_id and is_active;
end $$;

revoke all on function public.clear_branch_delivery_zone(uuid) from public, anon;
grant execute on function public.clear_branch_delivery_zone(uuid) to authenticated;
