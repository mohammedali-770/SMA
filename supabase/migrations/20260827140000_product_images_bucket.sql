-- ---------------------------------------------------------------------------
-- Product images — storage bucket only. NO table change.
--
-- WHY THIS EXISTS. `products.image_url` has existed all along, but 55 of 55
-- active products carry NULL, because there has never been a way to put an
-- image there except pasting a URL by hand into the admin form. Lazywait cannot
-- fill the gap: `GET /menu/products/items` does carry a `photo` key (77 of 95
-- cached items have it), but every single value is null, so the catalog import
-- has nothing to copy. Measured 2026-08-27, read-only.
--
-- This adds the missing half — a bucket an administrator can upload into from
-- the dashboard — and nothing else. `products.image_url` keeps its exact
-- meaning: a public URL, wherever it came from. An image uploaded here simply
-- produces one.
--
-- Deliberately a near-copy of `20260712130000_homepage_banners.sql`'s storage
-- half. Same shape, same caps, same admin predicate. Two buckets that behave
-- identically are easier to reason about than one clever shared one, and the
-- banner bucket has been running unchanged since 2026-07-12.
--
-- SEPARATE BUCKET, not a folder inside `banner-images`, on purpose: the two have
-- different lifetimes and different blast radii. A cleanup that empties banners
-- must not be able to delete the menu's photography.
-- ---------------------------------------------------------------------------

-- 5 MB cap; jpg/png/webp only (enforced again in the admin UI before upload, so
-- a rejected file never costs a round trip).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = true,
      file_size_limit    = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- NOTE: no public SELECT policy on storage.objects is needed, and adding one
-- would be a downgrade. A PUBLIC bucket already serves images over the CDN path
-- (/storage/v1/object/public/...), which is what getPublicUrl() returns and what
-- the mobile <Image> loads. A broad SELECT policy would additionally let any
-- client LIST every object in the bucket (advisor 0025). Same reasoning, and the
-- same omission, as the banner bucket.

-- Admin-only uploads / replacements / deletes. `public.is_admin()` is role AND
-- AAL2 — the same predicate every other admin-write policy in this schema uses,
-- so an administrator who has not completed TOTP cannot change the menu's
-- imagery.
drop policy if exists product_images_admin_insert on storage.objects;
create policy product_images_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists product_images_admin_update on storage.objects;
create policy product_images_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists product_images_admin_delete on storage.objects;
create policy product_images_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
