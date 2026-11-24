-- ============================================================================
-- F-X10-002: image and banner-action values are checked at the database, and the
-- POS catalog import never replaces an image that is already there.
--
-- Pairs with supabase/migrations/20261124130000_catalog_image_url_checks.sql.
-- Runs against a throwaway Postgres with the whole chain applied. RAISES on any
-- failed assertion.
--
-- Covers:
--   * the helper accepts https URLs and refuses everything else;
--   * products.image_url: NULL, '' and https pass; http, javascript:, data:, a
--     URL with userinfo and an over-long value are refused, on INSERT and UPDATE;
--   * homepage_banners.image_url: https only;
--   * homepage_banners.action_value: a product action needs a UUID; a path, a
--     query or an over-long value is refused; a category action may hold text;
--   * the importer: an image already on the product is kept, an empty (NULL or
--     '') image is filled from the POS photo, a non-https photo is ignored
--     without aborting the import, a new product takes a valid photo only.
-- ============================================================================
begin;
set local session_replication_role = replica;  -- skip FK/triggers for fixtures

create temp table _r (k text primary key, v text);

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_cat   uuid := gen_random_uuid();
  v_txt   text;
  v_name  text;
  v_n     int;
  v_s     text;
  v_bad   text[] := array[
    'http://example.test/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA',
    'https://user@example.test/a.jpg', 'https://exa mple.test/a.jpg', '//example.test/a.jpg',
    'https://example.test/' || repeat('a', 2100)];
begin
  insert into auth.users(id, email) values (v_admin, 'a@x');
  insert into public.profiles(id, role) values (v_admin, 'admin');
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('test.is_admin', 'true', true);

  insert into public.categories(id, name_en, name_ar) values (v_cat, 'C', 'C');

  -- ---- 1. products.image_url -------------------------------------------------
  insert into public.products(category_id, name_en, name_ar, price, image_url)
  values (v_cat, 'P-null', 'P', 1, null),
         (v_cat, 'P-empty', 'P', 1, ''),
         (v_cat, 'P-https', 'P', 1, 'https://abc.supabase.co/storage/v1/object/public/product-images/products/1-2.webp');

  foreach v_s in array v_bad loop
    begin
      insert into public.products(category_id, name_en, name_ar, price, image_url)
      values (v_cat, 'P-bad', 'P', 1, v_s);
      raise exception '1. products INSERT accepted image_url %', left(v_s, 40);
    exception when check_violation then
      get stacked diagnostics v_name = constraint_name;
      if v_name is distinct from 'products_image_url_safe' then
        raise exception '1. wrong constraint % for products INSERT', v_name;
      end if;
    end;
    begin
      update public.products set image_url = v_s where name_en = 'P-null';
      raise exception '1. products UPDATE accepted image_url %', left(v_s, 40);
    exception when check_violation then null;
    end;
  end loop;

  -- ---- 2. homepage_banners.image_url ----------------------------------------
  insert into public.homepage_banners(image_url) values ('https://abc.supabase.co/storage/v1/object/public/banner-images/x.webp');
  foreach v_s in array v_bad || array['', 'x'] loop
    begin
      insert into public.homepage_banners(image_url) values (v_s);
      raise exception '2. banner INSERT accepted image_url %', left(v_s, 40);
    exception when check_violation then
      get stacked diagnostics v_name = constraint_name;
      if v_name is distinct from 'homepage_banners_image_url_safe' then
        raise exception '2. wrong constraint % for banner image', v_name;
      end if;
    end;
  end loop;

  -- ---- 3. homepage_banners.action_value -------------------------------------
  insert into public.homepage_banners(image_url, action_type, action_value) values
    ('https://example.test/a.jpg', 'product',  '0b4c1d2e-3f40-4a51-8b62-7c83d94ea5f6'),
    ('https://example.test/a.jpg', 'product',  null),
    ('https://example.test/a.jpg', 'none',     null),
    ('https://example.test/a.jpg', 'category', 'burgers');
  foreach v_s in array array[
      '../cart', '/cart', '0b4c1d2e-3f40-4a51-8b62-7c83d94ea5f6/../../x',
      '0b4c1d2e-3f40-4a51-8b62-7c83d94ea5f6?x=1', 'pizza', ''] loop
    begin
      insert into public.homepage_banners(image_url, action_type, action_value)
      values ('https://example.test/a.jpg', 'product', v_s);
      raise exception '3. product banner accepted action_value %', v_s;
    exception when check_violation then
      get stacked diagnostics v_name = constraint_name;
      if v_name is distinct from 'homepage_banners_action_value_safe' then
        raise exception '3. wrong constraint % for action_value', v_name;
      end if;
    end;
  end loop;
  begin
    insert into public.homepage_banners(image_url, action_type, action_value)
    values ('https://example.test/a.jpg', 'category', repeat('a', 201));
    raise exception '3. a 201-character action_value was accepted';
  exception when check_violation then null;
  end;

  -- ---- 4. the importer ------------------------------------------------------
  -- Four existing products and one new one, each with a POS photo in the cache.
  insert into public.lazywait_catalog_items
    (entity_type, lazywait_id, name_en, name_ar, show_online, active, raw)
  values ('category', 'CAT_A', 'A', 'A', true, true, '{"active":true,"show_online":true}');

  insert into public.products(category_id, name_en, name_ar, price, image_url, lazywait_item_id) values
    (v_cat, 'Uploaded', 'U', 1, 'https://abc.supabase.co/storage/v1/object/public/product-images/products/mine.webp', 'IT_UPLOADED'),
    (v_cat, 'Pasted',   'U', 1, 'https://images.example.test/mine.jpg', 'IT_PASTED'),
    (v_cat, 'Blank',    'U', 1, null, 'IT_NULL'),
    (v_cat, 'Empty',    'U', 1, '',   'IT_EMPTY'),
    (v_cat, 'BadPhoto', 'U', 1, null, 'IT_BADPHOTO');

  insert into public.lazywait_catalog_items
    (entity_type, lazywait_id, name_en, name_ar, parent_id, show_online, active, prices, raw)
  select 'item', i.id, i.id, i.id, 'CAT_A', true, true,
         '[{"price_id":"PR","name":"x","price_excl_vat":8.7,"price_with_vat":10,"show_online":true,"active":true}]'::jsonb,
         jsonb_build_object('active', true, 'show_online', true, 'photo', i.photo)
    from (values
      ('IT_UPLOADED', 'https://pos.example.test/pos-uploaded.jpg'),
      ('IT_PASTED',   'https://pos.example.test/pos-pasted.jpg'),
      ('IT_NULL',     'https://pos.example.test/pos-null.jpg'),
      ('IT_EMPTY',    'https://pos.example.test/pos-empty.jpg'),
      ('IT_BADPHOTO', 'javascript:alert(1)'),
      ('IT_NEW_OK',   'https://pos.example.test/pos-new.jpg'),
      ('IT_NEW_BAD',  'http://pos.example.test/pos-new.jpg')
    ) as i(id, photo);

  perform public.import_lazywait_catalog();   -- must not raise on the bad photos

  insert into _r
  select lazywait_item_id, coalesce(image_url, '<null>') from public.products where lazywait_item_id is not null;

  if (select v from _r where k = 'IT_UPLOADED') is distinct from
     'https://abc.supabase.co/storage/v1/object/public/product-images/products/mine.webp' then
    raise exception '4. the import replaced an uploaded image: %', (select v from _r where k = 'IT_UPLOADED');
  end if;
  if (select v from _r where k = 'IT_PASTED') is distinct from 'https://images.example.test/mine.jpg' then
    raise exception '4. the import replaced a pasted image: %', (select v from _r where k = 'IT_PASTED');
  end if;
  if (select v from _r where k = 'IT_NULL') is distinct from 'https://pos.example.test/pos-null.jpg' then
    raise exception '4. an empty (NULL) image was not filled from the POS: %', (select v from _r where k = 'IT_NULL');
  end if;
  if (select v from _r where k = 'IT_EMPTY') is distinct from 'https://pos.example.test/pos-empty.jpg' then
    raise exception '4. an empty-string image was not filled from the POS: %', (select v from _r where k = 'IT_EMPTY');
  end if;
  if (select v from _r where k = 'IT_BADPHOTO') is distinct from '<null>' then
    raise exception '4. a non-https photo was stored: %', (select v from _r where k = 'IT_BADPHOTO');
  end if;
  if (select v from _r where k = 'IT_NEW_OK') is distinct from 'https://pos.example.test/pos-new.jpg' then
    raise exception '4. a new product did not take a valid photo: %', (select v from _r where k = 'IT_NEW_OK');
  end if;
  if (select v from _r where k = 'IT_NEW_BAD') is distinct from '<null>' then
    raise exception '4. a new product stored a non-https photo: %', (select v from _r where k = 'IT_NEW_BAD');
  end if;

  -- A second import over the same cache changes nothing it already settled.
  perform public.import_lazywait_catalog();
  select count(*) into v_n from public.products p
   where p.lazywait_item_id = 'IT_UPLOADED'
     and p.image_url = 'https://abc.supabase.co/storage/v1/object/public/product-images/products/mine.webp';
  if v_n <> 1 then raise exception '4. a second import replaced the uploaded image'; end if;

  raise notice 'catalog_image_url_checks_test: all assertions passed';
end $$;

rollback;
