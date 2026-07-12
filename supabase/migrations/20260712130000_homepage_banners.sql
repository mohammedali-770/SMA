-- ============================================================================
-- Spicy Meal — homepage promotional banners (mobile app homepage).
--
-- Admin-managed marketing banners shown on the customer app homepage, above the
-- search bar. Purely ADDITIVE: creates one new table, one storage bucket, and
-- their policies. It does NOT touch menu, branches, orders, payments, Lazywait,
-- integration_settings, or any existing policy/function.
--
-- Security (mirrors app_settings/catalog conventions):
--   - anon + customers may SELECT only ACTIVE banners inside their date window.
--   - staff (admin + accountant) may SELECT all rows (management/preview).
--   - only admins may INSERT/UPDATE/DELETE.
--   - banner images live in the public `banner-images` bucket: public READ
--     (marketing images), admin-only writes. No service-role key is exposed.
-- ============================================================================

create table if not exists public.homepage_banners (
  id           uuid primary key default gen_random_uuid(),
  title_en     text,
  title_ar     text,
  image_url    text not null,
  storage_path text,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  starts_at    timestamptz,
  ends_at      timestamptz,
  action_type  text not null default 'none' check (action_type in ('none', 'category', 'product')),
  action_value text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null
);

comment on table public.homepage_banners is
  'Admin-managed homepage marketing banners for the mobile app. Public reads active, in-window rows only; admins manage.';

-- Fast path for the public "active, ordered" read.
create index if not exists homepage_banners_active_idx
  on public.homepage_banners (is_active, sort_order, created_at desc);

drop trigger if exists set_homepage_banners_updated_at on public.homepage_banners;
create trigger set_homepage_banners_updated_at
  before update on public.homepage_banners
  for each row execute function public.set_updated_at();

alter table public.homepage_banners enable row level security;

revoke all on public.homepage_banners from anon, authenticated;
grant select on public.homepage_banners to anon, authenticated;
grant insert, update, delete on public.homepage_banners to authenticated;

-- Public/customer: only active banners inside their optional date window.
drop policy if exists homepage_banners_select_public on public.homepage_banners;
create policy homepage_banners_select_public on public.homepage_banners
  for select to anon, authenticated
  using (
    is_active
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >= now())
  );

-- Staff (admin + accountant) may read ALL banners for management/preview.
drop policy if exists homepage_banners_select_staff on public.homepage_banners;
create policy homepage_banners_select_staff on public.homepage_banners
  for select to authenticated
  using (public.is_staff());

-- Only admins may write.
drop policy if exists homepage_banners_admin_insert on public.homepage_banners;
create policy homepage_banners_admin_insert on public.homepage_banners
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists homepage_banners_admin_update on public.homepage_banners;
create policy homepage_banners_admin_update on public.homepage_banners
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists homepage_banners_admin_delete on public.homepage_banners;
create policy homepage_banners_admin_delete on public.homepage_banners
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage bucket for banner images: public read, admin-only writes.
-- 5 MB cap; jpg/png/webp only (enforced again in the admin UI before upload).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banner-images', 'banner-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = true,
      file_size_limit    = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- NOTE: no public SELECT policy on storage.objects is needed. A PUBLIC bucket
-- already serves images via the CDN path (/storage/v1/object/public/...), which
-- is what getPublicUrl() returns and what the app <img>/Image loads. Adding a
-- broad SELECT policy would additionally let clients LIST every file in the
-- bucket (flagged by advisor 0025) — unnecessary, so it is intentionally omitted.

-- Admin-only uploads / replacements / deletes.
drop policy if exists banner_images_admin_insert on storage.objects;
create policy banner_images_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'banner-images' and public.is_admin());

drop policy if exists banner_images_admin_update on storage.objects;
create policy banner_images_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'banner-images' and public.is_admin())
  with check (bucket_id = 'banner-images' and public.is_admin());

drop policy if exists banner_images_admin_delete on storage.objects;
create policy banner_images_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'banner-images' and public.is_admin());
