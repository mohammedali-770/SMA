import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  // serializers
  buildGetOrderRequest, buildActiveOrdersRequest, buildSearchOrdersRequest, buildFetchOrdersRequest,
  buildUpdateOrderRequest, buildCreateOrderRequest, serializeCreateOrder,
  buildUpdateCashPaymentRequest, buildUpdateOnlinePaymentRequest, buildVoidAllRequest,
  buildListItemsRequest, buildGetItemRequest, buildCreateProductRequest, buildUpdateProductRequest,
  buildDeleteProductRequest, buildDeleteProductsBulkRequest,
  buildListCategoriesRequest, buildCreateCategoryRequest, buildUpdateCategoryRequest,
  buildDeleteCategoryRequest, buildDeleteCategoriesBulkRequest,
  buildListAddonsRequest, buildListAddonGroupsRequest, buildCreateAddonRequest, buildDeleteAddonRequest,
  buildCreateAddonGroupRequest, buildDeleteAddonGroupRequest, buildListBranchesRequest,
  // validators
  parseCatalogListResponse, parseOrderResponse, parseOrderListResponse, parseDeleteResponse,
  parseSuccessResponse,
  // redaction
  redactLazywait, redactSecretsInString,
  // pagination
  paginationQuery,
  // client
  createLazywaitApiClient,
  type CreateOrderRequest, type LazywaitRequestSpec,
} from './lazywaitApi.ts';
import { buildCreateOrderPayload, type LazywaitConfig } from './lazywait';

import branchesFixture from './__fixtures__/lazywait/branches.json';
import itemsFixture from './__fixtures__/lazywait/items.json';
import categoriesFixture from './__fixtures__/lazywait/categories.json';
import addonsFixture from './__fixtures__/lazywait/addons.json';
import addonGroupsFixture from './__fixtures__/lazywait/addon_groups.json';
import orderFixture from './__fixtures__/lazywait/order.json';
import ordersListFixture from './__fixtures__/lazywait/orders_list.json';
import createOrderSuccessFixture from './__fixtures__/lazywait/create_order_success.json';

const CFG: LazywaitConfig = { baseUrl: 'https://apiv2.example.test/v1', clientId: 'CID_1', apiToken: 'lw_live_UNITTESTTOKEN' };

const pickupItems = [{ menuItemId: 'IT_BURGER', name: 'Beef Burger', quantity: 2, unitPrice: 28.75 }];

// ===========================================================================
// 1) Request serialization — methods, paths, query, body, exact casing
// ===========================================================================
describe('request serialization — paths/methods/query', () => {
  it('GET /pos/order carries branch_id + order_ref (client_id added by transport)', () => {
    expect(buildGetOrderRequest({ branchId: 'BR_RUH', orderRef: 'REF_1' })).toEqual({
      method: 'GET', path: '/pos/order', query: { branch_id: 'BR_RUH', order_ref: 'REF_1' },
    });
  });

  it('active-orders + search leave undefined optional filters unset', () => {
    expect(buildActiveOrdersRequest()).toEqual({
      method: 'GET', path: '/pos/orders/active-orders',
      query: { branch_id: undefined, user_id: undefined, lookback: undefined },
    });
    expect(buildActiveOrdersRequest({ branchId: 'BR_JED', lookbackMinutes: 60 }).query).toEqual({
      branch_id: 'BR_JED', user_id: undefined, lookback: '60',
    });
  });

  it('fetch-multiple posts order_refs', () => {
    expect(buildFetchOrdersRequest({ orderRefs: ['A', 'B'] })).toEqual({
      method: 'POST', path: '/pos/orders', body: { order_refs: ['A', 'B'] },
    });
  });

  it('menu pagination is sent ONLY when both offset AND limit are present', () => {
    expect(paginationQuery()).toEqual({});
    expect(paginationQuery(10, undefined)).toEqual({});
    expect(paginationQuery(undefined, 20)).toEqual({});
    expect(paginationQuery(10, 20)).toEqual({ offset: '10', limit: '20' });
    expect(buildListItemsRequest({ offset: 5 }).query).toEqual({ branch_id: undefined });
    expect(buildListItemsRequest({ offset: 5, limit: 25, branchId: 'BR_RUH' }).query).toEqual({
      branch_id: 'BR_RUH', offset: '5', limit: '25',
    });
  });

  it('GET /menu/products/item + item/category list + branches paths', () => {
    expect(buildGetItemRequest({ menuItemId: 'IT_1' })).toEqual({
      method: 'GET', path: '/menu/products/item', query: { menu_item_id: 'IT_1' },
    });
    expect(buildListCategoriesRequest().path).toBe('/menu/products/categories');
    expect(buildListAddonsRequest().path).toBe('/menu/addons');
    expect(buildListAddonGroupsRequest().path).toBe('/menu/addons-groups');
    expect(buildListBranchesRequest().path).toBe('/platform/branches');
  });

  it('DELETE product/category identify by query + expect plain-text ok; addon deletes use path params', () => {
    expect(buildDeleteProductRequest({ menuItemId: 'IT_9' })).toEqual({
      method: 'DELETE', path: '/menu/products/item', query: { menu_item_id: 'IT_9' }, expectTextOk: true,
    });
    expect(buildDeleteCategoryRequest({ categoryId: 'CAT_9' })).toEqual({
      method: 'DELETE', path: '/menu/products/category', query: { category_id: 'CAT_9' }, expectTextOk: true,
    });
    expect(buildDeleteAddonRequest({ addonId: 'AD 9/x' }).path).toBe('/menu/addons/AD%209%2Fx');
    expect(buildDeleteAddonGroupRequest({ addonsGroupId: 'GRP_1' }).path).toBe('/menu/addons-groups/GRP_1');
    expect(buildDeleteProductsBulkRequest({ menuItemIds: ['a', 'b'] }).body).toEqual({ menu_item_ids: ['a', 'b'] });
    expect(buildDeleteCategoriesBulkRequest({ categoryIds: ['c'] }).body).toEqual({ category_ids: ['c'] });
  });
});

describe('exact case-sensitive field names', () => {
  it('payment fields: Trans_Amount / Approval_No / Card_Type / Card_Number / transaction_uuid', () => {
    const cash = buildUpdateCashPaymentRequest({
      clientId: 'C', branchId: 'B', orderRef: 'R', transAmount: 57.505, approvalNo: 'APP1', transactionUuid: 'uuid-1',
    });
    expect(cash.body).toEqual({
      client_id: 'C', branch_id: 'B', order_ref: 'R', Trans_Amount: 57.51, Approval_No: 'APP1', transaction_uuid: 'uuid-1',
    });
    const online = buildUpdateOnlinePaymentRequest({
      clientId: 'C', branchId: 'B', orderRef: 'R', transAmount: 40, approvalNo: 'APP2',
      cardType: 'card', cardNumber: '4111111111111111', transactionUuid: 'uuid-2',
    });
    expect(online.body).toEqual({
      client_id: 'C', branch_id: 'B', order_ref: 'R', Trans_Amount: 40, Approval_No: 'APP2',
      Card_Type: 'card', Card_Number: '4111111111111111', transaction_uuid: 'uuid-2',
    });
    // These are the documented capitalizations — a lower-cased variant must NOT appear.
    const keys = Object.keys(online.body as Record<string, unknown>);
    expect(keys).toContain('Trans_Amount');
    expect(keys).not.toContain('trans_amount');
  });

  it('void-all preserves the documented spelling `cancelation_reason`', () => {
    const v = buildVoidAllRequest({ clientId: 'C', branchId: 'B', cancelationReason: 'shift_close' });
    expect(v.body).toEqual({ client_id: 'C', branch_id: 'B', cancelation_reason: 'shift_close' });
    expect(JSON.stringify(v.body)).not.toMatch(/cancellation/);
  });

  it('addon: alert_level is NUMERIC, consumption is an OBJECT', () => {
    const a = buildCreateAddonRequest({
      addonId: 'AD1', addonsGroupId: 'GRP1', nameEn: 'Cheese', price: 5,
      alertLevel: 3, consumption: { unit: 'slice', qty: 1 },
    });
    const body = a.body as Record<string, unknown>;
    expect(body.addon_id).toBe('AD1');
    expect(body.addons_group_id).toBe('GRP1');
    expect(typeof body.alert_level).toBe('number');
    expect(body.alert_level).toBe(3);
    expect(body.consumption).toEqual({ unit: 'slice', qty: 1 });
    expect(typeof body.consumption).toBe('object');
  });

  it('addon-group: auto_selected_addons + included_custom_addons_ids are STRING arrays', () => {
    const g = buildCreateAddonGroupRequest({
      addonsGroupId: 'GRP1', nameEn: 'Toppings', minSelection: 0, maxSelection: 3, multiMax: 2,
      autoSelectedAddons: ['AD1'], includedCustomAddonsIds: ['AD1', 'AD2'],
    });
    const body = g.body as Record<string, unknown>;
    expect(body.auto_selected_addons).toEqual(['AD1']);
    expect(body.included_custom_addons_ids).toEqual(['AD1', 'AD2']);
    expect(Array.isArray(body.auto_selected_addons)).toBe(true);
    expect((body.auto_selected_addons as unknown[]).every((x) => typeof x === 'string')).toBe(true);
  });

  it('product write uses catalog casing (menu_item_id/category_id/prices/branches_ids)', () => {
    const create = buildCreateProductRequest({
      categoryId: 'CAT_MAIN', nameEn: 'Burger', nameAr: 'برجر', branchesIds: ['BR_RUH'],
      prices: [{ priceId: 'PR1', name: 'Single', priceWithVat: 28.755 }],
    });
    expect(create).toMatchObject({ method: 'POST', path: '/menu/products/item' });
    expect(create.body).toEqual({
      category_id: 'CAT_MAIN', name_en: 'Burger', name_ar: 'برجر', branches_ids: ['BR_RUH'],
      prices: [{ price_id: 'PR1', name: 'Single', price_with_vat: 28.76 }],
    });
    expect(buildUpdateProductRequest({ menuItemId: 'IT_1', nameEn: 'X' }).method).toBe('PUT');
  });
});

// ===========================================================================
// 2) Create Order — confirmed pickup + gated assumed delivery/add-on body
// ===========================================================================
describe('serializeCreateOrder — confirmed body (default, delivery gate OFF)', () => {
  it('equals the audited buildCreateOrderPayload output exactly', () => {
    const req: CreateOrderRequest = {
      clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'pickup', customerName: 'Ahmed', items: pickupItems,
    };
    const confirmed = buildCreateOrderPayload({
      clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'pickup', customerName: 'Ahmed', items: pickupItems,
    });
    expect(serializeCreateOrder(req)).toEqual(confirmed);
  });

  it('still equals it when EVERY confirmed field is supplied — the two builders cannot drift', () => {
    const full = {
      clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'pickup' as const, customerName: 'Ahmed',
      orderDetails: 'Ring the bell', customerId: 'CRM_9', customerPhone: '0541234567', isPaid: false,
      items: [{
        menuItemId: 'IT_BURGER', name: 'Beef Burger', nameAr: 'برجر', quantity: 1, unitPrice: 30,
        menuCategoryId: 'CAT_MAIN', priceId: 'PR_SINGLE', note: 'No onions',
        addons: [{ addonId: 'AD_CHEESE', nameEn: 'Extra Cheese', nameAr: 'جبن', price: 5 }],
      }],
    };
    expect(serializeCreateOrder(full)).toEqual(buildCreateOrderPayload(full));
  });

  it('serializes the confirmed per-item fields with exact contract casing', () => {
    const built = serializeCreateOrder({
      clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'pickup', customerName: 'Ahmed',
      items: [{
        menuItemId: 'IT_BURGER', name: 'Beef Burger', nameAr: 'برجر لحم', quantity: 1, unitPrice: 33.75,
        menuCategoryId: 'CAT_MAIN', priceId: 'PR_SINGLE', note: 'No onions',
        addons: [{ addonId: 'AD_CHEESE', nameEn: 'Extra Cheese', nameAr: 'جبن إضافي', price: 5, quantity: 1 }],
      }],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.order_items).toEqual([{
      menu_item_id: 'IT_BURGER',
      name: 'Beef Burger',
      names: { en: 'Beef Burger', ar: 'برجر لحم' },
      quantity: 1,
      price: 28.75,                         // 33.75 − the 5.00 add-on
      menu_category_id: 'CAT_MAIN',
      price_id: 'PR_SINGLE',
      details: 'No onions',
      addons: [{
        addon_id: 'AD_CHEESE', name: 'Extra Cheese',
        names: { en: 'Extra Cheese', ar: 'جبن إضافي' }, quantity: 1, price: 5,
      }],
    }]);
    // `addons_group_id` was a WRONG assumption — it is not part of the order
    // add-on object in the contract and must not reappear.
    expect(JSON.stringify(built.payload)).not.toContain('addons_group_id');
  });

  it('sends NO delivery assumption by default even when delivery data is present', () => {
    const built = serializeCreateOrder({
      clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'pickup', customerName: 'Ahmed',
      items: [{ ...pickupItems[0], priceId: 'PR_SINGLE' }],
      delivery: { address: 'Riyadh', latitude: 24.7, longitude: 46.6, fee: 12.5 },
    });
    expect(built.ok).toBe(true);
    const s = JSON.stringify(built);
    expect(s).not.toMatch(/delivery_address|latitude|longitude|order_delivery_fee|order_deliveries/);
    // ...while the CONFIRMED fields do go out.
    expect(s).toContain('price_id');
  });

  it('BLOCKS delivery by default (schema unconfirmed) — the safe result', () => {
    expect(serializeCreateOrder({
      clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'delivery', customerName: 'A', items: pickupItems,
    })).toEqual({ ok: false, blockedReason: 'delivery_schema_unconfirmed' });
  });

  it('never sends a totals field — the contract cannot settle VAT-inclusive vs exclusive (Q9)', () => {
    const built = serializeCreateOrder({
      clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'pickup', customerName: 'A', items: pickupItems,
    });
    expect(built.ok).toBe(true);
    const keys = built.ok ? Object.keys(built.payload) : [];
    for (const k of ['subtotal', 'discount', 'tax', 'tax_percentage', 'total', 'order_delivery_fee']) {
      expect(keys).not.toContain(k);
    }
  });
});

describe('serializeCreateOrder — GATED delivery assumptions (allowAssumedFields: true)', () => {
  it('builds a delivery payload using the CORRECTED field names', () => {
    const built = serializeCreateOrder({
      clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'delivery', customerName: 'Sara',
      allowAssumedFields: true, items: pickupItems,
      customerId: 'CRM_42', customerPhone: '0501234567', isPaid: true,
      orderDetails: 'Gate 3',
      delivery: { address: 'King Fahd Rd, Riyadh', latitude: 24.7136, longitude: 46.6753, fee: 12.5 },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const p = built.payload;
    expect(p.order_type).toBe('delivery');
    expect(p.customer_id).toBe('CRM_42');
    // CORRECTED: the contract splits the phone; E.164 must never be the cell.
    expect(p.customer_cell).toBe('501234567');
    expect(p.country_code).toBe('+966');
    expect(p.is_paid).toBe(true);
    expect(p.delivery_address).toBe('King Fahd Rd, Riyadh');
    // CORRECTED: `order_delivery_fee`, not `delivery_fee`.
    expect(p.order_delivery_fee).toBe(12.5);
    expect('delivery_fee' in p).toBe(false);
    // CORRECTED: there is no `delivery_notes` field; the order note is `order_details`.
    expect('delivery_notes' in p).toBe(false);
    expect(p.order_details).toBe('Gate 3');
    // Still an invention — the contract has no coordinate field at all.
    expect(p.latitude).toBe(24.7136);
    expect(p.longitude).toBe(46.6753);
    expect(p.source).toBe('LWAPI');
  });

  it('NEVER emits server-owned identity fields, even via extraAssumedFields', () => {
    const built = serializeCreateOrder({
      clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'delivery', customerName: 'Sara',
      allowAssumedFields: true, items: pickupItems,
      extraAssumedFields: { order_ref: 'HACK', order_id: 'X', order_number: 'Y', order_date: 'Z', promo_code: 'OK' },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const keys = Object.keys(built.payload);
    expect(keys).not.toContain('order_ref');
    expect(keys).not.toContain('order_id');
    expect(keys).not.toContain('order_number');
    expect(keys).not.toContain('order_date');
    expect(built.payload.promo_code).toBe('OK'); // non-identity extras pass through
  });

  it('still blocks on unmapped branch / items even with the gate ON', () => {
    const base = { clientId: 'CID_1', orderType: 'delivery', customerName: 'A', allowAssumedFields: true } as const;
    expect(serializeCreateOrder({ ...base, branchId: null, items: pickupItems }))
      .toEqual({ ok: false, blockedReason: 'missing_branch_mapping' });
    expect(serializeCreateOrder({ ...base, branchId: 'BR_RUH', items: [] }))
      .toEqual({ ok: false, blockedReason: 'no_items' });
    expect(serializeCreateOrder({ ...base, branchId: 'BR_RUH', items: [{ menuItemId: null, name: 'X', quantity: 1, unitPrice: 5 }] }))
      .toEqual({ ok: false, blockedReason: 'missing_item_mapping' });
  });

  it('folds an UNMAPPED add-on into `details` here too — the gated path shares the confirmed builder', () => {
    const built = serializeCreateOrder({
      clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'delivery', customerName: 'A',
      allowAssumedFields: true,
      items: [{ menuItemId: 'IT_1', name: 'X', quantity: 1, unitPrice: 5, addons: [{ addonId: '', nameEn: 'Volcano' }] }],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const item = (built.payload.order_items as Record<string, unknown>[])[0];
    expect('addons' in item).toBe(false);
    expect(item.details).toBe('Volcano');
    expect(item.price).toBe(5);
  });
});

describe('buildCreateOrderRequest', () => {
  it('returns a POST /pos/orders/create spec when the body builds', () => {
    const r = buildCreateOrderRequest({ clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'pickup', customerName: 'A', items: pickupItems });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.method).toBe('POST');
    expect(r.spec.path).toBe('/pos/orders/create');
  });
  it('propagates a block reason instead of a spec', () => {
    const r = buildCreateOrderRequest({ clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'delivery', customerName: 'A', items: pickupItems });
    expect(r).toEqual({ ok: false, blockedReason: 'delivery_schema_unconfirmed' });
  });
});

describe('update order — order_items is a FULL replacement, order_ref in path', () => {
  it('puts to /pos/orders/:order_ref with a replacement order_items array', () => {
    const spec = buildUpdateOrderRequest({
      clientId: 'CID_1', orderRef: 'REF 7/x', branchId: 'BR_RUH',
      orderItems: [{ menuItemId: 'IT_1', name: 'A', quantity: 3, unitPrice: 10 }], customerName: 'A',
    });
    expect(spec.method).toBe('PUT');
    expect(spec.path).toBe('/pos/orders/REF%207%2Fx'); // order_ref path-encoded, never in the body
    expect(spec.body).toEqual({
      client_id: 'CID_1',
      order_items: [{ menu_item_id: 'IT_1', name: 'A', names: { en: 'A' }, quantity: 3, price: 10 }],
      branch_id: 'BR_RUH', customer_name: 'A',
    });
    expect(JSON.stringify(spec.body)).not.toMatch(/order_ref|order_id|order_number|order_date/);
  });
});

// ===========================================================================
// 3) Response parsing — catalog (ar/en), orders, plain-text ok delete, success
// ===========================================================================
describe('response parsing — catalog lists with Arabic/English names', () => {
  it('branches: maps ids + en/ar names, keeps a deactivated branch in raw', () => {
    const r = parseCatalogListResponse('branch', branchesFixture);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.count).toBe(3);
    const byId = Object.fromEntries(r.value.records.map((x) => [x.lazywait_id, x]));
    expect(byId.BR_RUH.name_en).toBe('Riyadh Downtown');
    expect(byId.BR_RUH.name_ar).toBe('وسط الرياض');
    expect(byId.BR_JED.name_ar).toBe('كورنيش جدة');
    expect(byId.BR_OLD.raw.is_active).toBe(false); // deactivated flag preserved for the caller
  });

  it('items/categories/addons/addon-groups parse ar/en + numeric/array fields', () => {
    const items = parseCatalogListResponse('item', itemsFixture);
    const cats = parseCatalogListResponse('category', categoriesFixture);
    const addons = parseCatalogListResponse('addon', addonsFixture);
    const groups = parseCatalogListResponse('addon_group', addonGroupsFixture);
    expect(items.ok && items.value.records[0].name_ar).toBe('برجر لحم');
    expect(items.ok && items.value.records[0].prices?.length).toBe(2);
    expect(cats.ok && cats.value.records[1].name_ar).toBe('المشروبات');
    expect(addons.ok && addons.value.records[0].name_ar).toBe('جبن إضافي');
    // null-priced addon does not crash
    expect(addons.ok && addons.value.records[1].prices).toBeNull();
    expect(groups.ok && groups.value.records[0].min_selection).toBe(0);
    expect(groups.ok && groups.value.records[0].max_selection).toBe(3);
  });
});

describe('response parsing — orders', () => {
  it('parses a single order (identity + items) and an order list', () => {
    const one = parseOrderResponse(orderFixture);
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(one.value.order?.order_ref).toBe('REF_1001');
    expect(one.value.order?.order_items[0].menu_item_id).toBe('IT_BURGER');
    const list = parseOrderListResponse(ordersListFixture);
    expect(list.ok && list.value.count).toBe(2);
  });
  it('flags a body with no order object as invalid', () => {
    const r = parseOrderResponse({ nothing: true });
    expect(r.ok).toBe(false);
  });
});

describe('response parsing — plain-text `ok` delete + JSON success', () => {
  it('accepts a plain-text ok body as a typed delete success (not the {raw} fallback)', () => {
    const r = parseDeleteResponse({ ok: true, status: 200, data: { raw: 'ok' }, code: null, retryAfterMs: null, error: null, text: 'ok' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ deleted: true, via: 'text', raw: 'ok' });
  });
  it('accepts a JSON {success:true} delete body', () => {
    const r = parseDeleteResponse({ ok: true, status: 200, data: { success: true }, code: null, retryAfterMs: null, error: null, text: '{"success":true}' });
    expect(r.ok && r.value.via).toBe('json');
  });
  it('rejects an unacknowledged delete (non-2xx, no ok token)', () => {
    const r = parseDeleteResponse({ ok: false, status: 500, data: null, code: null, retryAfterMs: null, error: 'boom', text: '' });
    expect(r.ok).toBe(false);
  });
  it('parseSuccessResponse reads a boolean success', () => {
    expect(parseSuccessResponse({ success: true }).ok).toBe(true);
    const miss = parseSuccessResponse({ foo: 1 });
    expect(miss.ok).toBe(true); // structurally valid but flagged
    expect(miss.issues.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 4) Redaction — token/Bearer, phone, email, card fields
// ===========================================================================
describe('redaction', () => {
  it('scrubs Bearer/lw_/whsec token-shaped strings', () => {
    expect(redactSecretsInString('Authorization: Bearer lw_live_abcDEF123')).toBe('Authorization: Bearer ***');
    expect(redactSecretsInString('key=lw_live_supersecretvalue')).toBe('key=lw_***');
    expect(redactSecretsInString('sig whsec_deadbeefcafe')).toBe('sig whsec_***');
  });

  it('deep-redacts sensitive keys and token-shaped values, keeps safe fields', () => {
    const redacted = redactLazywait({
      api_token: 'lw_live_secret', Authorization: 'Bearer lw_live_secret',
      customer_phone: '+966501234567', customer_cell: '0501234567', email: 'a@b.com',
      Card_Number: '4111111111111111', Approval_No: 'APP123',
      order: { branch_id: 'BR_RUH', note: 'call Bearer lw_live_x', customer_name: 'Guest' },
    }) as Record<string, unknown>;
    expect(redacted.api_token).toBe('***');
    expect(redacted.Authorization).toBe('***');
    expect(redacted.customer_phone).toBe('***');
    expect(redacted.customer_cell).toBe('***');
    expect(redacted.email).toBe('***');
    expect(redacted.Card_Number).toBe('***');
    expect(redacted.Approval_No).toBe('***');
    const order = redacted.order as Record<string, unknown>;
    expect(order.branch_id).toBe('BR_RUH');            // safe field kept
    expect(order.customer_name).toBe('Guest');          // name is not redacted
    expect(order.note).toBe('call Bearer ***');         // token stripped from free text
  });
});

// ===========================================================================
// 5) Client (fetch-stubbed) — auth header, timeout, error mapping, dedupe
// ===========================================================================
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('client — transport integration', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('injects the Bearer token header + client_id query, never in the body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(branchesFixture));
    const client = createLazywaitApiClient(CFG);
    const r = await client.listBranches();
    expect(r.ok).toBe(true);
    expect(r.data?.count).toBe(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('client_id=CID_1');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer lw_live_UNITTESTTOKEN');
    expect(init.body).toBeUndefined(); // GET
  });

  it('parses a plain-text `ok` product delete via the client', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }));
    const client = createLazywaitApiClient(CFG);
    const r = await client.deleteProduct({ menuItemId: 'IT_9' });
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ deleted: true, via: 'text', raw: 'ok' });
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('maps a timeout (AbortError) to status 0 + redacted error', async () => {
    fetchMock.mockImplementationOnce(() => { const e = new Error('aborted'); e.name = 'AbortError'; return Promise.reject(e); });
    const client = createLazywaitApiClient(CFG);
    const r = await client.listItems();
    expect(r.status).toBe(0);
    expect(r.error).toBe('timeout');
    expect(r.valid).toBe(true); // an empty catalog list is structurally valid
  });

  it('redacts a Bearer token that leaks into a transport error message', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('connect fail for Bearer lw_live_LEAK')));
    const client = createLazywaitApiClient(CFG);
    const r = await client.listBranches();
    expect(r.error).toContain('Bearer ***');
    expect(r.error).not.toContain('lw_live_LEAK');
  });
});

describe('client.createOrder — duplicate prevention + no false success', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it('NEVER re-POSTs when a Lazywait ref already exists (no idempotency key)', async () => {
    const client = createLazywaitApiClient(CFG);
    const r = await client.createOrder(
      { clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'pickup', customerName: 'A', items: pickupItems },
      { existingRef: 'REF_EXISTING' },
    );
    expect(r.sent).toBe(false);
    expect(r.blockedReason).toBe('already_created_no_resend');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send a delivery order without the gate (safe block, no POST)', async () => {
    const client = createLazywaitApiClient(CFG);
    const r = await client.createOrder({ clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'delivery', customerName: 'A', items: pickupItems });
    expect(r.sent).toBe(false);
    expect(r.blockedReason).toBe('delivery_schema_unconfirmed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies 2xx+success+ref as OK (confirmed)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(createOrderSuccessFixture));
    const client = createLazywaitApiClient(CFG);
    const r = await client.createOrder({ clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'pickup', customerName: 'A', items: pickupItems });
    expect(r.sent).toBe(true);
    expect(r.outcome?.kind).toBe('ok');
    expect(r.outcome?.orderRef).toBe('REF_2002');
  });

  it('2xx success WITHOUT a usable ref is AMBIGUOUS — never a false confirmation', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, order: {} }));
    const client = createLazywaitApiClient(CFG);
    const r = await client.createOrder({ clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'pickup', customerName: 'A', items: pickupItems });
    expect(r.outcome?.kind).toBe('ambiguous');
    expect(r.outcome?.orderRef).toBeNull();
  });
});

// ===========================================================================
// 6) Secret cannot reach mobile/web bundles
// ===========================================================================
describe('no Lazywait secret is importable from src/** or apps/mobile/**', () => {
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

  function walk(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
      const full = `${dir}/${name}`;
      const st = statSync(full);
      if (st.isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it('no client file imports the server-side lazywait client or hardcodes a live key', () => {
    const files = [...walk(`${repoRoot}src`), ...walk(`${repoRoot}apps/mobile/src`)];
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // (a) importing the server transport (which holds the Bearer token)
      if (/from\s+['"][^'"]*_shared\/lazywait(Api|Catalog)?(\.ts)?['"]/.test(src)) offenders.push(`import:${f}`);
      // (b) a real lw_live_/lw_test_ key literal (the admin placeholder `lw_live_…` uses an ellipsis and is excluded)
      if (/lw_(?:live|test)_[A-Za-z0-9]{6,}/.test(src)) offenders.push(`secret:${f}`);
    }
    expect(offenders).toEqual([]);
  });
});

// ===========================================================================
// 7) All 27 endpoints have a serializer (coverage guard)
// ===========================================================================
describe('endpoint coverage', () => {
  it('every serializer returns a well-formed spec', () => {
    const specs: LazywaitRequestSpec[] = [
      buildGetOrderRequest({ branchId: 'B', orderRef: 'R' }),
      buildActiveOrdersRequest(),
      buildSearchOrdersRequest({ query: 'x' }),
      buildFetchOrdersRequest({ orderRefs: ['R'] }),
      buildUpdateOrderRequest({ clientId: 'C', orderRef: 'R', orderItems: [] }),
      buildUpdateCashPaymentRequest({ clientId: 'C', branchId: 'B', orderRef: 'R', transAmount: 1 }),
      buildUpdateOnlinePaymentRequest({ clientId: 'C', branchId: 'B', orderRef: 'R', transAmount: 1, approvalNo: 'A' }),
      buildVoidAllRequest({ clientId: 'C', branchId: 'B' }),
      buildListItemsRequest(), buildGetItemRequest({ menuItemId: 'I' }),
      buildCreateProductRequest({ nameEn: 'x' }), buildUpdateProductRequest({ menuItemId: 'I' }),
      buildDeleteProductRequest({ menuItemId: 'I' }), buildDeleteProductsBulkRequest({ menuItemIds: ['I'] }),
      buildListCategoriesRequest(), buildCreateCategoryRequest({ nameEn: 'x' }), buildUpdateCategoryRequest({ categoryId: 'C' }),
      buildDeleteCategoryRequest({ categoryId: 'C' }), buildDeleteCategoriesBulkRequest({ categoryIds: ['C'] }),
      buildListAddonsRequest(), buildListAddonGroupsRequest(),
      buildCreateAddonRequest({ nameEn: 'x' }), buildDeleteAddonRequest({ addonId: 'A' }),
      buildCreateAddonGroupRequest({ nameEn: 'x' }), buildDeleteAddonGroupRequest({ addonsGroupId: 'G' }),
      buildListBranchesRequest(),
    ];
    // + POST /pos/orders/create (via buildCreateOrderRequest) = 27 endpoints total
    expect(specs.length).toBe(26);
    for (const s of specs) {
      expect(['GET', 'POST', 'PUT', 'DELETE']).toContain(s.method);
      expect(s.path.startsWith('/')).toBe(true);
    }
  });
});

// ===========================================================================
// Client construction — FAIL CLOSED on a missing base URL
//
// `createLazywaitApiClient` used to read `cfg.baseUrl || DEFAULT_BASE_URL`,
// silently binding an unconfigured client to the PRODUCTION Lazywait host. It
// now throws at construction, before any spec can be executed.
// ===========================================================================
describe('client construction — base URL fails closed', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['undefined', undefined as unknown as string],
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('throws on %s instead of defaulting to the production host', (_label, baseUrl) => {
    expect(() => createLazywaitApiClient({ ...CFG, baseUrl }))
      .toThrowError(/lazywait_base_url_not_configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a configured base URL still builds a working client (unchanged behaviour)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(branchesFixture));
    const client = createLazywaitApiClient({ ...CFG, baseUrl: 'https://apiv2-dev.lazywait.com/v1' });
    const r = await client.listBranches();
    expect(r.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0]))
      .toBe('https://apiv2-dev.lazywait.com/v1/platform/branches?client_id=CID_1');
  });

  it('createOrder never runs with a blank base URL — the throw precedes any send', async () => {
    expect(() => createLazywaitApiClient({ ...CFG, baseUrl: '  ' })).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('createOrder on a configured client is byte-identical to today', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(createOrderSuccessFixture));
    const client = createLazywaitApiClient({ ...CFG, baseUrl: 'https://apiv2-dev.lazywait.com/v1' });
    const r = await client.createOrder(
      { clientId: 'CID_1', branchId: 'BR_RUH', orderType: 'pickup', customerName: 'Ahmed', items: pickupItems },
      { existingRef: null },
    );
    expect(r.sent).toBe(true);
    expect(r.blockedReason).toBeNull();
    expect(r.outcome?.kind).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });
});
