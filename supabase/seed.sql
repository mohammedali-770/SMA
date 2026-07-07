-- ============================================================================
-- Spicy Meal — local development seed (run by `supabase db reset`).
-- Idempotent (fixed ids + ON CONFLICT). Catalog + coupons only; no auth users.
-- Runs as the service role, so RLS does not apply here.
-- ============================================================================

insert into public.app_settings (id) values (true) on conflict (id) do nothing;

-- ---- branches -------------------------------------------------------------
insert into public.branches (id, name_en, name_ar, address_en, address_ar, phone,
                             latitude, longitude, delivery_fee, min_delivery_order, is_active) values
  ('b0000000-0000-0000-0000-000000000001','Riyadh - Olaya','الرياض - العليا','Olaya St','شارع العليا','+966 11 000 0001',24.7136,46.6753,15,40,true),
  ('b0000000-0000-0000-0000-000000000002','Jeddah - Corniche','جدة - الكورنيش','Corniche Rd','طريق الكورنيش','+966 12 000 0002',21.4901,39.1862,18,50,true)
on conflict (id) do nothing;

-- ---- categories -----------------------------------------------------------
insert into public.categories (id, name_en, name_ar, sort_order) values
  ('c0000000-0000-0000-0000-000000000001','Burgers','برجر',1),
  ('c0000000-0000-0000-0000-000000000002','Sides','المقبلات',2),
  ('c0000000-0000-0000-0000-000000000003','Drinks','المشروبات',3)
on conflict (id) do nothing;

-- ---- products -------------------------------------------------------------
insert into public.products (id, category_id, name_en, name_ar, description_en, description_ar, price, calories, is_active, sort_order) values
  ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Spicy Double Beef','دبل لحم حار','Two flame-grilled patties','قطعتان مشويتان',32.00,780,true,1),
  ('a0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001','Crispy Chicken','دجاج مقرمش','Hand-breaded chicken','دجاج مقرمش',27.00,640,true,2),
  ('a0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000002','Spicy Fries','بطاطس حارة','Crispy spiced fries','بطاطس متبلة',12.00,310,true,1),
  ('a0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000003','Cola','كولا','Ice cold','مثلجة',6.00,140,true,1)
on conflict (id) do nothing;

-- ---- modifier group + modifiers -------------------------------------------
insert into public.modifier_groups (id, name_en, name_ar, min_select, max_select, is_required) values
  ('90000000-0000-0000-0000-000000000001','Heat Level','مستوى الحرارة',1,1,true)
on conflict (id) do nothing;

insert into public.modifiers (id, group_id, name_en, name_ar, price, sort_order, is_active) values
  ('80000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','Mild','خفيف',0,1,true),
  ('80000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001','Hot','حار',0,2,true),
  ('80000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000001','Volcano (+2)','بركان (+٢)',2.00,3,true)
on conflict (id) do nothing;

-- link the two burgers to the Heat Level group
insert into public.product_modifier_groups (product_id, group_id) values
  ('a0000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001')
on conflict (product_id, group_id) do nothing;

-- ---- coupons (mirror the app's current demo codes) ------------------------
insert into public.coupons (code, type, value, is_active, min_order_amount) values
  ('SPICY15','percentage',15,true,0),
  ('RIYADH10','fixed',10,true,0)
on conflict (code) do nothing;
