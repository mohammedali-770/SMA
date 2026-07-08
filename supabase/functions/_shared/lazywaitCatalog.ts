/**
 * Lazywait catalog — PURE, defensive extraction of pulled catalog payloads.
 *
 * The exact response field names of the confirmed catalog endpoints
 * (/platform/branches, /menu/products/categories, /menu/products/items,
 * /menu/addons, /menu/addons-groups) are not fully documented, and test data
 * may carry only Turkish names, null prices, or null selection bounds. These
 * helpers therefore read DEFENSIVELY (trying several likely field names) and
 * keep the full raw record so nothing is lost — they never invent values.
 *
 * No Deno/Node-only APIs → unit-testable under Vitest and runnable under Deno.
 */

export type CatalogEntityType = 'branch' | 'category' | 'item' | 'addon' | 'addon_group';

export interface NormalizedPrice {
  price_id: string | null;
  name: string | null;
  price_with_vat: number | null;
  price_excl_vat: number | null;
}

export interface NormalizedCatalogRecord {
  entity_type: CatalogEntityType;
  lazywait_id: string;
  name_en: string | null;
  name_ar: string | null;
  name_other: string | null;      // e.g. Turkish test data with no en/ar
  parent_id: string | null;       // item->category, addon->group (reference)
  prices: NormalizedPrice[] | null;
  branches_ids: string[] | null;
  min_selection: number | null;
  max_selection: number | null;
  multi_max: number | null;
  raw: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Small field pickers (null-safe)
// ---------------------------------------------------------------------------
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pickStr(obj: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function pickNum(obj: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Names — en / ar / a fallback (handles a localized `name` object or a plain
// string that may be Turkish). Never throws on missing/null.
// ---------------------------------------------------------------------------
function extractNames(raw: Record<string, unknown>): {
  name_en: string | null; name_ar: string | null; name_other: string | null;
} {
  let en = pickStr(raw, ['name_en', 'nameEn', 'english_name', 'title_en']);
  let ar = pickStr(raw, ['name_ar', 'nameAr', 'arabic_name', 'title_ar']);
  let other: string | null = null;

  const n = raw.name ?? raw.title ?? raw.label ?? raw.display_name;
  if (typeof n === 'string') {
    other = n.trim() || null;
  } else if (isObj(n)) {
    en = en ?? pickStr(n, ['en', 'english']);
    ar = ar ?? pickStr(n, ['ar', 'arabic']);
    other = pickStr(n, ['tr', 'turkish', 'default', 'value']);
  }

  // translations: [{ locale/lang, name/value }]
  const tr = raw.translations ?? raw.locales;
  if (Array.isArray(tr)) {
    for (const t of tr) {
      if (!isObj(t)) continue;
      const locale = (pickStr(t, ['locale', 'lang', 'language', 'code']) ?? '').toLowerCase();
      const val = pickStr(t, ['name', 'value', 'text', 'title']);
      if (!val) continue;
      if (locale.startsWith('en')) en = en ?? val;
      else if (locale.startsWith('ar')) ar = ar ?? val;
      else other = other ?? val;
    }
  }
  return { name_en: en, name_ar: ar, name_other: other };
}

// ---------------------------------------------------------------------------
// Prices (items). Handles a `prices` array, a single `price` object, or a flat
// numeric price. Null price / null price_id are preserved as null.
// ---------------------------------------------------------------------------
function extractPrices(raw: Record<string, unknown>): NormalizedPrice[] | null {
  const one = (p: Record<string, unknown>): NormalizedPrice => ({
    price_id: pickStr(p, ['price_id', 'priceId', 'id']),
    name: pickStr(p, ['name', 'price_name', 'title', 'label']),
    price_with_vat: pickNum(p, ['price_with_vat', 'priceWithVat', 'price_with_tax', 'gross_price', 'gross']),
    price_excl_vat: pickNum(p, ['price_excluding_vat', 'price_without_vat', 'price_excl_vat', 'net_price', 'net']),
  });

  const arr = raw.prices ?? raw.price_list ?? raw.variants;
  if (Array.isArray(arr) && arr.length) {
    return arr.filter(isObj).map((p) => one(p as Record<string, unknown>));
  }
  if (isObj(raw.price)) return [one(raw.price as Record<string, unknown>)];

  // Flat numeric price fallback (still capture the single price_id if present).
  const flat = pickNum(raw, ['price', 'price_with_vat', 'amount']);
  const flatId = pickStr(raw, ['price_id', 'priceId']);
  if (flat != null || flatId != null) {
    return [{
      price_id: flatId,
      name: null,
      price_with_vat: flat,
      price_excl_vat: pickNum(raw, ['price_excluding_vat', 'price_without_vat', 'net']),
    }];
  }
  return null;
}

function extractBranchesIds(raw: Record<string, unknown>): string[] | null {
  const arr = raw.branches_ids ?? raw.branchesIds ?? raw.branch_ids ?? raw.branchIds;
  if (Array.isArray(arr)) {
    const ids = arr.map((v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''))
      .filter((s) => s !== '');
    return ids.length ? ids : null;
  }
  const single = pickStr(raw, ['branch_id', 'branchId']);
  return single ? [single] : null;
}

// ---------------------------------------------------------------------------
// Per-entity id + parent field names.
// ---------------------------------------------------------------------------
const ID_KEYS: Record<CatalogEntityType, string[]> = {
  branch: ['branch_id', 'branchId', 'id'],
  category: ['category_id', 'categoryId', 'id'],
  item: ['menu_item_id', 'menuItemId', 'item_id', 'itemId', 'id'],
  addon: ['addon_id', 'addonId', 'id'],
  addon_group: ['addons_group_id', 'addon_group_id', 'addonsGroupId', 'group_id', 'groupId', 'id'],
};

function extractParentId(entity: CatalogEntityType, raw: Record<string, unknown>): string | null {
  if (entity === 'item') return pickStr(raw, ['category_id', 'categoryId', 'category']);
  if (entity === 'addon') return pickStr(raw, ['addons_group_id', 'addon_group_id', 'group_id', 'groupId']);
  return null;
}

/**
 * Normalize ONE raw catalog record. Returns null when no usable id is present
 * (an id-less record can't be mapped and is skipped by the caller).
 */
export function extractCatalogRecord(
  entity: CatalogEntityType, raw: unknown,
): NormalizedCatalogRecord | null {
  if (!isObj(raw)) return null;
  const id = pickStr(raw, ID_KEYS[entity]);
  if (!id) return null;

  const names = extractNames(raw);
  const isGroup = entity === 'addon_group';
  return {
    entity_type: entity,
    lazywait_id: id,
    name_en: names.name_en,
    name_ar: names.name_ar,
    name_other: names.name_other,
    parent_id: extractParentId(entity, raw),
    // Items carry a price list; addons may carry a single (possibly null) price.
    prices: (entity === 'item' || entity === 'addon') ? extractPrices(raw) : null,
    branches_ids: (entity === 'item' || entity === 'category') ? extractBranchesIds(raw) : null,
    min_selection: isGroup ? pickNum(raw, ['min_selection', 'minSelection', 'min']) : null,
    max_selection: isGroup ? pickNum(raw, ['max_selection', 'maxSelection', 'max']) : null,
    multi_max: isGroup ? pickNum(raw, ['multi_max', 'multiMax', 'max_quantity', 'maxQuantity']) : null,
    raw: raw as Record<string, unknown>,
  };
}

/**
 * Pull the record array out of a catalog response envelope. Accepts a bare
 * array, or a `{ data | results | items | records | <plural> }` wrapper.
 */
export function extractCatalogList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isObj) as Record<string, unknown>[];
  if (isObj(payload)) {
    for (const k of ['data', 'results', 'items', 'records', 'branches', 'categories', 'addons', 'groups', 'list']) {
      const v = payload[k];
      if (Array.isArray(v)) return v.filter(isObj) as Record<string, unknown>[];
    }
  }
  return [];
}

/** Normalize a whole endpoint response into mappable records (id-less dropped). */
export function normalizeCatalogPayload(
  entity: CatalogEntityType, payload: unknown,
): NormalizedCatalogRecord[] {
  return extractCatalogList(payload)
    .map((r) => extractCatalogRecord(entity, r))
    .filter((r): r is NormalizedCatalogRecord => r !== null);
}
