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
  name_ar: string | null;
  /**
   * VAT-INCLUSIVE price, and only when Lazywait actually sent one. Items
   * authored in the Lazywait dashboard carry `price_with_vat`; items uploaded
   * from a spreadsheet do NOT, and leave this null. Never derived here — the
   * VAT rate belongs to `app_settings`, so the SQL importer grosses
   * `price_excl_vat` up instead of this module guessing 15%.
   */
  price_with_vat: number | null;
  /**
   * VAT-EXCLUSIVE price. Lazywait's plain `price` field IS this value —
   * confirmed against Production: Chicken Wings / Small is `price:
   * 6.086956521739131`, and 6.086956521739131 x 1.15 = 7.00, the menu price.
   * Every price row the catalog returns carries it.
   */
  price_excl_vat: number | null;
  /** Per-tier online visibility. `false` = POS-only, never shown to customers. */
  show_online: boolean | null;
  /** Per-tier active flag; a retired tier stays in the payload as active:false. */
  active: boolean | null;
  calories: number | null;
}

export interface NormalizedCatalogRecord {
  entity_type: CatalogEntityType;
  lazywait_id: string;
  name_en: string | null;
  name_ar: string | null;
  name_other: string | null;      // e.g. Turkish test data with no en/ar
  parent_id: string | null;       // item->category, addon->group (reference)
  description_en: string | null;  // item `details.en`
  description_ar: string | null;  // item `details.ar`
  show_online: boolean | null;    // record-level online visibility
  active: boolean | null;         // record-level active flag
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

  // Lazywait nests localized names under `names`/`item_names`/`cat_names`/
  // `category_names` (objects keyed by locale, e.g. {en, ar, tr}). Prefer those,
  // then fall back to the generic single-name fields.
  const n = raw.names ?? raw.item_names ?? raw.name ?? raw.title ?? raw.label
    ?? raw.display_name ?? raw.cat_names ?? raw.category_names;
  if (typeof n === 'string') {
    other = n.trim() || null;
  } else if (isObj(n)) {
    en = en ?? pickStr(n, ['en', 'english']);
    ar = ar ?? pickStr(n, ['ar', 'arabic']);
    other = pickStr(n, ['tr', 'turkish', 'default', 'value']) ?? en ?? ar;
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

function pickBool(obj: Record<string, unknown> | null | undefined, keys: string[]): boolean | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase();
      if (t === 'true' || t === 'yes' || t === '1') return true;
      if (t === 'false' || t === 'no' || t === '0') return false;
    }
    if (typeof v === 'number' && (v === 0 || v === 1)) return v === 1;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Prices (items). Handles a `prices` array, a single `price` object, or a flat
// numeric price. Null price / null price_id are preserved as null.
//
// THE PRICE FIELD IS `price`, AND IT EXCLUDES VAT. This is the bug that kept
// the whole menu out of the app: every price row Lazywait returns carries its
// money in a plain `price` key, and this function used to look only for
// `price_with_vat` / `price_excluding_vat` / `net_price`. None of those exist
// on a spreadsheet-sourced item, so all 126 Production price rows normalized to
// `{price_with_vat: null, price_excl_vat: null}`; `import_lazywait_catalog()`
// then read 0, and imported every product priced 0 and hidden.
//
// That `price` is the NET figure is not a guess. Dashboard-authored items send
// BOTH keys, and across all 21 such rows `price_with_vat === price x 1.15`
// exactly (45.21739130434783 -> 52, 66.08695652173914 -> 76). Spreadsheet rows
// send only `price`, and the customer-facing menu price is likewise `price` x
// 1.15 (6.086956521739131 -> 7.00 for Chicken Wings / Small).
//
// `price_with_vat` is therefore recorded ONLY when Lazywait actually sent it.
// Grossing the net figure up is the SQL importer's job, because the VAT rate
// lives in `app_settings.vat_percentage` and must not be hardcoded here.
// ---------------------------------------------------------------------------
function extractPrices(raw: Record<string, unknown>): NormalizedPrice[] | null {
  const one = (p: Record<string, unknown>): NormalizedPrice => {
    const names = isObj(p.names) ? p.names : null;
    return {
      price_id: pickStr(p, ['price_id', 'priceId', 'id']),
      // Lazywait price variants label themselves under `names: {en, ar, tr}` too.
      name: pickStr(p, ['name', 'price_name', 'title', 'label'])
        ?? pickStr(names, ['en', 'ar', 'tr', 'value']),
      name_ar: pickStr(p, ['name_ar', 'nameAr']) ?? pickStr(names, ['ar']),
      price_with_vat: pickNum(p, ['price_with_vat', 'priceWithVat', 'price_with_tax', 'gross_price', 'gross']),
      price_excl_vat: pickNum(p, [
        'price', 'price_excluding_vat', 'price_without_vat', 'price_excl_vat', 'net_price', 'net',
      ]),
      show_online: pickBool(p, ['show_online', 'showOnline']),
      active: pickBool(p, ['active', 'is_active']),
      calories: pickNum(p, ['calories']),
    };
  };

  const arr = raw.prices ?? raw.price_list ?? raw.variants;
  if (Array.isArray(arr) && arr.length) {
    return arr.filter(isObj).map((p) => one(p as Record<string, unknown>));
  }
  if (isObj(raw.price)) return [one(raw.price as Record<string, unknown>)];

  // Flat numeric price fallback (still capture the single price_id if present).
  // `price` is net here too — an add-on is the only record that reaches this
  // branch, and it uses the same field with the same meaning as a price row.
  const flat = pickNum(raw, ['price', 'amount']);
  const flatGross = pickNum(raw, ['price_with_vat', 'priceWithVat']);
  const flatId = pickStr(raw, ['price_id', 'priceId']);
  if (flat != null || flatGross != null || flatId != null) {
    return [{
      price_id: flatId,
      name: null,
      name_ar: null,
      price_with_vat: flatGross,
      price_excl_vat: flat ?? pickNum(raw, ['price_excluding_vat', 'price_without_vat', 'net']),
      show_online: pickBool(raw, ['show_online', 'showOnline']),
      active: pickBool(raw, ['active', 'is_active']),
      calories: pickNum(raw, ['calories']),
    }];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Item descriptions. Lazywait nests them under `details: {en, ar}` — the same
// shape as `names`. Nothing read this before, so every imported product had an
// empty description even though the POS had one.
// ---------------------------------------------------------------------------
function extractDescriptions(raw: Record<string, unknown>): {
  description_en: string | null; description_ar: string | null;
} {
  const d = raw.details ?? raw.description ?? raw.descriptions ?? raw.item_details;
  if (typeof d === 'string') {
    const t = d.trim();
    return { description_en: t || null, description_ar: null };
  }
  if (isObj(d)) {
    return {
      description_en: pickStr(d, ['en', 'english']),
      description_ar: pickStr(d, ['ar', 'arabic']),
    };
  }
  return {
    description_en: pickStr(raw, ['description_en', 'details_en']),
    description_ar: pickStr(raw, ['description_ar', 'details_ar']),
  };
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
  // `menu_category_id` FIRST: that is the key Lazywait actually sends on an
  // item, and omitting it left `parent_id` null on every Production item. The
  // SQL importer happened to survive because it falls back to
  // `raw->>'menu_category_id'` itself, but the client-side mapping suggester
  // reads `parent_id` and could not group a single item by its category.
  if (entity === 'item') {
    return pickStr(raw, ['menu_category_id', 'menuCategoryId', 'category_id', 'categoryId', 'category']);
  }
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
  const descriptions = extractDescriptions(raw);
  const isGroup = entity === 'addon_group';
  return {
    entity_type: entity,
    lazywait_id: id,
    name_en: names.name_en,
    name_ar: names.name_ar,
    name_other: names.name_other,
    parent_id: extractParentId(entity, raw),
    description_en: entity === 'item' ? descriptions.description_en : null,
    description_ar: entity === 'item' ? descriptions.description_ar : null,
    // Absent means "not stated", not "hidden" — the importer treats null as
    // visible/active so a payload without the flags behaves as it does today.
    show_online: pickBool(raw, ['show_online', 'showOnline']),
    active: pickBool(raw, ['active', 'is_active']),
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
 * Envelope keys tried BEFORE the generic list, per entity.
 *
 * Only `addon_group` is listed, deliberately. The generic keys below cover the
 * plural of every other entity (`branches`, `categories`, `items`, `addons`),
 * and those four demonstrably parse. The generic list does carry a bare
 * `groups`, but not `addons_groups` / `addon_groups` — the `addons_`-prefixed
 * style the item payload uses for `addons_groups_ids` — so if
 * `/menu/addons-groups` wraps under either of those, nothing matched. Every
 * catalog pull since the importer was written has reported `addon_groups: 0` as
 * a clean success with no error, which is consistent with that but does not
 * prove it: the endpoint's actual envelope has never been captured, and a
 * `data` / `results` / `groups` wrapper would have parsed fine all along.
 *
 * Adding the group keys to the generic list would also work, but a group
 * envelope may itself carry an `addons` key (the add-ons belonging to each
 * group), and `addons` sits ahead of `groups` in the generic order — so a group
 * response would be at risk of being read as an add-on list. Trying the
 * entity's own keys first removes that ambiguity.
 */
const ENTITY_LIST_KEYS: Partial<Record<CatalogEntityType, string[]>> = {
  addon_group: ['addons_groups', 'addon_groups', 'addonsGroups', 'addonGroups', 'groups'],
};

/**
 * Pull the record array out of a catalog response envelope. Accepts a bare
 * array, or a `{ data | results | items | records | <plural> }` wrapper.
 *
 * `entity` is optional and only narrows the search: when given, that entity's
 * own envelope keys are tried first (see ENTITY_LIST_KEYS). Callers that omit
 * it get exactly the previous behaviour.
 */
export function extractCatalogList(
  payload: unknown, entity?: CatalogEntityType,
): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isObj) as Record<string, unknown>[];
  if (isObj(payload)) {
    const preferred = entity ? (ENTITY_LIST_KEYS[entity] ?? []) : [];
    const keys = [
      ...preferred,
      'data', 'results', 'items', 'records', 'branches', 'categories', 'addons', 'groups', 'list',
    ];
    for (const k of keys) {
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
  return extractCatalogList(payload, entity)
    .map((r) => extractCatalogRecord(entity, r))
    .filter((r): r is NormalizedCatalogRecord => r !== null);
}
