/**
 * Explicit column lists for the customer app's catalog reads.
 *
 * WHY THIS EXISTS. The menu was read with `select('*')`, which sent every
 * column of every row to every device, guest or signed in. That included
 * columns no screen reads: the POS mapping ids, `lazywait_price_ref`, and on
 * `app_settings` `payment_updated_by` — an administrator's user id, readable by
 * `anon`. With an explicit list the products response shrinks by about half.
 *
 * THE RISK IS THE OPPOSITE ONE, and it is the reason for the contract test.
 * PostgREST refuses the WHOLE select when one listed column does not exist or
 * cannot be read, so a typo here does not hide a field: it blanks the menu for
 * every customer, on every installed build, until a new build ships.
 * `catalogSelect.test.ts` therefore pins three things:
 *
 *   - every column a mapper (or anything else typed with these rows) reads is
 *     in its list, found with the TypeScript checker, not by eye;
 *   - each select literal is exactly its list, joined;
 *   - `services/api.ts` uses these literals and no `select('*')` on these tables.
 *
 * Every column below was also checked to exist and to be readable by `anon`
 * against a database built from the migration chain (`docs/MIGRATIONS.md`).
 *
 * Each list is what the mappers read plus the rest of its `types/db.ts` row
 * type, so the declared type stays true of what is fetched: supabase-js infers
 * the row from the literal, and the compiler refuses a list that omits a
 * required field of the type it is cast to.
 *
 * RULE: add a column only when a mapper reads it, and only once the migration
 * that adds it is APPLIED in Production. A build carrying a column the live
 * database lacks fails the whole menu load — the `orders.is_comped` outage.
 *
 * Framework-free, so the contract test imports it under Node.
 */
import type {
  DbAppSettings,
  DbBranch,
  DbCategory,
  DbModifier,
  DbModifierGroup,
  DbProduct,
  DbProductVariant,
} from '../types/db';

export const BRANCH_COLUMNS = [
  'id',
  'name_en',
  'name_ar',
  'address_en',
  'address_ar',
  'phone',
  'latitude',
  'longitude',
  'is_active',
  'delivery_fee',
  'min_delivery_order',
  'delivery_enabled',
  'pickup_enabled',
  'delivery_temporarily_closed',
  'estimated_delivery_minutes',
] as const satisfies readonly (keyof DbBranch)[];

export const CATEGORY_COLUMNS = [
  'id',
  'name_en',
  'name_ar',
  'sort_order',
  'is_active',
] as const satisfies readonly (keyof DbCategory)[];

export const PRODUCT_COLUMNS = [
  'id',
  'category_id',
  'name_en',
  'name_ar',
  'description_en',
  'description_ar',
  'price',
  'calories',
  'image_url',
  'is_active',
  'sort_order',
] as const satisfies readonly (keyof DbProduct)[];

export const PRODUCT_VARIANT_COLUMNS = [
  'id',
  'product_id',
  'name_en',
  'name_ar',
  'price',
  'calories',
  'sort_order',
  'is_active',
] as const satisfies readonly (keyof DbProductVariant)[];

export const MODIFIER_GROUP_COLUMNS = [
  'id',
  'name_en',
  'name_ar',
  'min_select',
  'max_select',
  'is_required',
] as const satisfies readonly (keyof DbModifierGroup)[];

export const MODIFIER_COLUMNS = [
  'id',
  'group_id',
  'name_en',
  'name_ar',
  'price',
  'sort_order',
  'is_active',
] as const satisfies readonly (keyof DbModifier)[];

export const APP_SETTINGS_COLUMNS = [
  'id',
  // brand
  'brand_name_en',
  'brand_name_ar',
  'primary_color',
  'secondary_color',
  'currency',
  'vat_percentage',
  // loyalty
  'loyalty_enabled',
  'points_per_riyal',
  'discount_per_point',
  'min_points_to_redeem',
  'loyalty_pickup_only',
  'loyalty_expiry_enabled',
  'loyalty_expiry_next_run_on',
  // payment availability (non-secret)
  'online_payment_enabled',
  'cash_payment_enabled',
  'default_payment_method',
  'payment_outage_mode_enabled',
  // contact & support
  'support_phone',
  'support_whatsapp',
  'support_email',
  'support_hours_en',
  'support_hours_ar',
  'support_desc_en',
  'support_desc_ar',
  'support_phone_enabled',
  'support_whatsapp_enabled',
  'support_email_enabled',
] as const satisfies readonly (keyof DbAppSettings)[];

/**
 * Columns of `app_settings` that must never be listed: they identify a person
 * or are operator-only, and no customer screen reads them.
 */
export const APP_SETTINGS_NEVER_SELECTED = ['payment_updated_by'] as const;

// The select literals. Each MUST stay one unbroken string literal: supabase-js
// infers the row type from the literal type, and a computed string collapses
// it. `catalogSelect.test.ts` pins each to its list above.
export const BRANCH_SELECT =
  'id, name_en, name_ar, address_en, address_ar, phone, latitude, longitude, is_active, delivery_fee, min_delivery_order, delivery_enabled, pickup_enabled, delivery_temporarily_closed, estimated_delivery_minutes';
export const CATEGORY_SELECT = 'id, name_en, name_ar, sort_order, is_active';
export const PRODUCT_SELECT =
  'id, category_id, name_en, name_ar, description_en, description_ar, price, calories, image_url, is_active, sort_order';
export const PRODUCT_VARIANT_SELECT =
  'id, product_id, name_en, name_ar, price, calories, sort_order, is_active';
export const MODIFIER_GROUP_SELECT = 'id, name_en, name_ar, min_select, max_select, is_required';
export const MODIFIER_SELECT = 'id, group_id, name_en, name_ar, price, sort_order, is_active';
export const APP_SETTINGS_SELECT =
  'id, brand_name_en, brand_name_ar, primary_color, secondary_color, currency, vat_percentage, loyalty_enabled, points_per_riyal, discount_per_point, min_points_to_redeem, loyalty_pickup_only, loyalty_expiry_enabled, loyalty_expiry_next_run_on, online_payment_enabled, cash_payment_enabled, default_payment_method, payment_outage_mode_enabled, support_phone, support_whatsapp, support_email, support_hours_en, support_hours_ar, support_desc_en, support_desc_ar, support_phone_enabled, support_whatsapp_enabled, support_email_enabled';

/** Table → its list, for the contract test and the database check. */
export const CATALOG_SELECTS = {
  branches: { columns: BRANCH_COLUMNS, select: BRANCH_SELECT, rowType: 'DbBranch' },
  categories: { columns: CATEGORY_COLUMNS, select: CATEGORY_SELECT, rowType: 'DbCategory' },
  products: { columns: PRODUCT_COLUMNS, select: PRODUCT_SELECT, rowType: 'DbProduct' },
  product_variants: {
    columns: PRODUCT_VARIANT_COLUMNS,
    select: PRODUCT_VARIANT_SELECT,
    rowType: 'DbProductVariant',
  },
  modifier_groups: {
    columns: MODIFIER_GROUP_COLUMNS,
    select: MODIFIER_GROUP_SELECT,
    rowType: 'DbModifierGroup',
  },
  modifiers: { columns: MODIFIER_COLUMNS, select: MODIFIER_SELECT, rowType: 'DbModifier' },
  app_settings: { columns: APP_SETTINGS_COLUMNS, select: APP_SETTINGS_SELECT, rowType: 'DbAppSettings' },
} as const;
