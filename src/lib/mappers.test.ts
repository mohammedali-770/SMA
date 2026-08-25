import { describe, it, expect } from 'vitest';
import {
  mapBranch, mapCategory, mapProduct, mapModifierGroup, buildAvailabilityMatrix,
  mapProfile, mapAddress, mapOrder, mapBrandSettings, mapLoyaltySettings,
  brandPatchToDb, loyaltyPatchToDb, productToDbInsert, branchPatchToDb,
  orderDisplayNumber,
} from './mappers';
import { orderLineLabel } from '../types';
import type {
  DbBranch, DbCategory, DbProduct, DbModifierGroup, DbModifier, DbProductModifierGroup,
  DbBranchAvailability, DbAppSettings, DbProfile, DbAddress, DbOrderWithItems,
} from './api';

describe('catalog mappers', () => {
  it('maps a branch row to camelCase with numeric coercion', () => {
    const row: DbBranch = {
      id: 'b1', name_en: 'Olaya', name_ar: 'العليا', address_en: 'St', address_ar: 'شارع',
      phone: '+966', latitude: 24.7, longitude: 46.6,
      delivery_fee: 15, min_delivery_order: 40, is_active: true,
    };
    const b = mapBranch(row);
    expect(b).toMatchObject({ id: 'b1', nameEn: 'Olaya', nameAr: 'العليا', deliveryFee: 15, minDeliveryOrder: 40, isActive: true });
  });

  it('carries the delivery pause timer through, defaulting to null', () => {
    // It was mapped nowhere, so the call-centre panel could say delivery was off
    // but never when it comes back.
    const base: DbBranch = {
      id: 'b1', name_en: 'Olaya', name_ar: 'العليا', address_en: null, address_ar: null,
      phone: null, latitude: null, longitude: null,
      delivery_fee: 15, min_delivery_order: 40, is_active: true,
    };
    expect(mapBranch(base).deliveryClosedUntil).toBeNull();
    expect(mapBranch({ ...base, delivery_closed_until: '2026-08-20T18:00:00Z' }).deliveryClosedUntil)
      .toBe('2026-08-20T18:00:00Z');
  });

  it('maps a category row', () => {
    const row: DbCategory = { id: 'c1', name_en: 'Burgers', name_ar: 'برجر', sort_order: 2, is_active: true };
    expect(mapCategory(row)).toEqual({ id: 'c1', nameEn: 'Burgers', nameAr: 'برجر', sortOrder: 2 });
  });

  it('derives a product\'s modifierGroupIds from the M:N links', () => {
    const p: DbProduct = {
      id: 'p1', category_id: 'c1', name_en: 'Burger', name_ar: 'برجر',
      description_en: null, description_ar: null, price: 32, calories: 780,
      image_url: null, is_active: true, sort_order: 1,
    };
    const links: DbProductModifierGroup[] = [
      { product_id: 'p1', group_id: 'g1', sort_order: 1 },
      { product_id: 'p2', group_id: 'g9', sort_order: 1 },
      { product_id: 'p1', group_id: 'g2', sort_order: 2 },
    ];
    const mapped = mapProduct(p, links);
    expect(mapped.modifierGroupIds).toEqual(['g1', 'g2']);
    expect(mapped.price).toBe(32);
    expect(mapped.imageUrl).toContain('http'); // falls back when null
  });

  it('nests a group\'s active modifiers and defaults an unbounded max_select', () => {
    const g: DbModifierGroup = { id: 'g1', name_en: 'Heat', name_ar: 'حرارة', min_select: 1, max_select: null, is_required: true };
    const mods: DbModifier[] = [
      { id: 'm1', group_id: 'g1', name_en: 'Mild', name_ar: 'خفيف', price: 0, sort_order: 1, is_active: true },
      { id: 'm2', group_id: 'gX', name_en: 'Other', name_ar: 'آخر', price: 0, sort_order: 1, is_active: true },
    ];
    const mapped = mapModifierGroup(g, mods);
    expect(mapped.maxSelection).toBe(99);
    expect(mapped.modifiers.map(m => m.id)).toEqual(['m1']);
  });

  it('builds the availability matrix defaulting to available, applying exceptions', () => {
    const products = [{ id: 'p1' }, { id: 'p2' }] as DbProduct[];
    const branches = [{ id: 'b1' }, { id: 'b2' }] as DbBranch[];
    const rows: DbBranchAvailability[] = [{ product_id: 'p1', branch_id: 'b2', is_available: false }];
    const m = buildAvailabilityMatrix(products, branches, rows);
    expect(m.p1.b1).toBe(true);  // no row -> available
    expect(m.p1.b2).toBe(false); // explicit sold-out
    expect(m.p2.b1).toBe(true);
  });
});

describe('order mapper', () => {
  it('maps a nested order (items + modifiers + address snapshot + sync status)', () => {
    const row = {
      id: 'o1', order_number: 'SM-2026-000001', customer_id: 'u1',
      customer_name: 'Ali', customer_phone: '+966', branch_id: 'b1',
      branch_name_en: 'Olaya', branch_name_ar: 'العليا', status: 'received', order_type: 'delivery',
      subtotal: 54, delivery_fee: 15, discount_amount: 5.4, loyalty_discount_amount: 0,
      vat_amount: 8.3, total: 63.6, payment_status: 'pending', payment_method: null,
      coupon_code: 'SPICY15', notes: null, created_at: '2026-07-07T00:00:00Z',
      sync_status: 'syncing',
      address_snapshot: { id: 'a1', label: 'Home', description: 'St', national_short_address: 'RRBB1234', latitude: 24.7, longitude: 46.6, is_default: true },
      order_items: [
        {
          id: 'i1', order_id: 'o1', product_id: 'p1', name_en: 'Burger', name_ar: 'برجر',
          unit_price: 34, quantity: 1, line_total: 34,
          order_item_modifiers: [
            { id: 'im1', order_item_id: 'i1', modifier_id: 'm3', name_en: 'Volcano', name_ar: 'بركان', price: 2 },
          ],
        },
      ],
    } as unknown as DbOrderWithItems;
    const o = mapOrder(row);
    expect(o.orderNumber).toBe('SM-2026-000001');
    expect(o.couponCode).toBe('SPICY15'); // real coupon code carried through for reports
    expect(o.orderSyncStatus).toBe('pending_sync'); // 'syncing' -> 'pending_sync'
    expect(o.paymentStatus).toBe('pending');
    expect(o.address?.nationalShortAddress).toBe('RRBB1234');
    expect(o.items).toHaveLength(1);
    expect(o.items[0].price).toBe(34);
    expect(o.items[0].selectedModifiers[0].nameEn).toBe('Volcano');
    expect(o.notes).toBeUndefined(); // null note -> absent, not the string "null"
  });

  /**
   * `notes` is the customer's free-text instruction — allergies, door codes.
   * The column and the staff RPC projection both always carried it, but the
   * mapper dropped it, so nothing downstream could render it. These pin the
   * mapping and the trim, because the receipt modal decides whether to show the
   * highlighted note panel purely on this value being present.
   */
  function orderRowWithNotes(notes: unknown) {
    return {
      id: 'o1', order_number: 'SM-2026-000002', customer_id: 'u1',
      customer_name: 'Ali', customer_phone: '+966', branch_id: 'b1',
      branch_name_en: 'Olaya', branch_name_ar: 'العليا', status: 'received', order_type: 'pickup',
      subtotal: 10, delivery_fee: 0, discount_amount: 0, loyalty_discount_amount: 0,
      vat_amount: 1.3, total: 10, payment_status: 'paid', payment_method: 'cash',
      coupon_code: null, notes, created_at: '2026-07-07T00:00:00Z',
      sync_status: 'synced', address_snapshot: null, order_items: [],
    } as unknown as DbOrderWithItems;
  }

  it('carries the customer note through so staff can read it', () => {
    const o = mapOrder(orderRowWithNotes('SEVERE NUT ALLERGY'));
    expect(o.notes).toBe('SEVERE NUT ALLERGY');
  });

  it('trims a whitespace-only note to undefined so no empty note panel renders', () => {
    // An empty highlighted panel reads as a real instruction the reader failed to
    // parse, which is worse than showing nothing.
    expect(mapOrder(orderRowWithNotes('   \n  ')).notes).toBeUndefined();
  });

  it('trims surrounding whitespace but preserves the note body verbatim', () => {
    const o = mapOrder(orderRowWithNotes('  no onions\nring twice  '));
    expect(o.notes).toBe('no onions\nring twice');
  });
});

describe('orderDisplayNumber', () => {
  it('shows the Lazywait POS number as primary with the SM number secondary once synced', () => {
    expect(orderDisplayNumber({ orderNumber: 'SM-2026-000005', lazywaitOrderNumber: '#1' }))
      .toEqual({ primary: '#1', secondary: 'SM-2026-000005' });
  });
  it('falls back to the SM number when there is no POS number (unsynced/delivery/off)', () => {
    expect(orderDisplayNumber({ orderNumber: 'SM-2026-000005', lazywaitOrderNumber: null }))
      .toEqual({ primary: 'SM-2026-000005', secondary: null });
    expect(orderDisplayNumber({ orderNumber: 'SM-2026-000005' }))
      .toEqual({ primary: 'SM-2026-000005', secondary: null });
    expect(orderDisplayNumber({ orderNumber: 'SM-2026-000005', lazywaitOrderNumber: '   ' }))
      .toEqual({ primary: 'SM-2026-000005', secondary: null });
  });
});

describe('profile + address mappers', () => {
  it('maps a profile row', () => {
    const p: DbProfile = { id: 'u1', full_name: 'Ali', phone_number: '+966', email: 'a@b.co', role: 'admin', loyalty_points: 120 };
    expect(mapProfile(p)).toMatchObject({ id: 'u1', fullName: 'Ali', role: 'admin', loyaltyPoints: 120 });
  });
  it('maps an address row', () => {
    const a: DbAddress = { id: 'a1', customer_id: 'u1', label: 'Home', description: 'St', national_short_address: 'RRBB1234', latitude: 1, longitude: 2, is_default: true };
    expect(mapAddress(a)).toMatchObject({ id: 'a1', label: 'Home', nationalShortAddress: 'RRBB1234', lat: 1, lng: 2, isDefault: true });
  });
});

describe('settings mappers', () => {
  const s: DbAppSettings = {
    id: true, brand_name_en: 'Spicy Meal', brand_name_ar: 'سبايسي',
    primary_color: '#111111', secondary_color: '#222222', currency: 'SAR',
    vat_percentage: 15, loyalty_enabled: true, points_per_riyal: 1,
    discount_per_point: 0.1, min_points_to_redeem: 100,
  };
  it('maps brand colours + VAT from app_settings', () => {
    const b = mapBrandSettings(s);
    expect(b.primaryColor).toBe('#111111');
    expect(b.secondaryColor).toBe('#222222');
    expect(b.vatPercentage).toBe(15);
  });
  it('maps loyalty config from app_settings', () => {
    expect(mapLoyaltySettings(s)).toEqual({ isEnabled: true, pointsPerRiyal: 1, minPointsToRedeem: 100, discountPerPoint: 0.1 });
  });
});

describe('reverse patch mappers (app -> DB)', () => {
  it('only includes provided brand fields', () => {
    expect(brandPatchToDb({ primaryColor: '#abc' })).toEqual({ primary_color: '#abc' });
    expect(brandPatchToDb({ vatPercentage: 15, secondaryColor: '#def' })).toEqual({ vat_percentage: 15, secondary_color: '#def' });
    expect(brandPatchToDb({ logoUrl: 'x' })).toEqual({}); // not backed
  });
  it('maps loyalty patches', () => {
    expect(loyaltyPatchToDb({ pointsPerRiyal: 2, isEnabled: false })).toEqual({ points_per_riyal: 2, loyalty_enabled: false });
  });
  it('maps a branch patch', () => {
    expect(branchPatchToDb({ deliveryFee: 20, isActive: false })).toEqual({ delivery_fee: 20, is_active: false });
  });
  it('persists branch location + address + phone (regression: these were dropped)', () => {
    expect(branchPatchToDb({ latitude: 24.7136, longitude: 46.6753 }))
      .toEqual({ latitude: 24.7136, longitude: 46.6753 });
    expect(branchPatchToDb({ addressEn: 'A', addressAr: 'ع', phone: '+966500000000' }))
      .toEqual({ address_en: 'A', address_ar: 'ع', phone: '+966500000000' });
  });
  it('omits branch fields that were not provided', () => {
    expect(branchPatchToDb({ nameEn: 'X' })).toEqual({ name_en: 'X' });
  });
  it('NEVER writes the delivery pause timer, unlike every other branch field', () => {
    // Server-owned: set_branch_delivery_pause writes it, clear_branch_delivery_pause
    // and the sweeper clear it, and a BEFORE trigger nulls it when the pause
    // lifts. A client patch carrying it could strand a timer on a running branch
    // or forge a resume time nothing will honour.
    expect(branchPatchToDb({ deliveryClosedUntil: '2026-08-20T18:00:00Z' })).toEqual({});
    expect(branchPatchToDb({ deliveryTemporarilyClosed: false, deliveryClosedUntil: '2026-08-20T18:00:00Z' }))
      .toEqual({ delivery_temporarily_closed: false });
  });
  it('maps a product insert with sort order', () => {
    const ins = productToDbInsert({
      categoryId: 'c1', nameEn: 'X', nameAr: 'س', descriptionEn: 'd', descriptionAr: 'د',
      price: 10, imageUrl: 'u', calories: 5, isActive: true, modifierGroupIds: [], variants: [],
    }, 3);
    expect(ins).toMatchObject({ category_id: 'c1', name_en: 'X', price: 10, sort_order: 3, is_active: true });
  });
});

// ===========================================================================
// Tier snapshot on an order line.
//
// admin_list_orders_with_items has projected variant_id / variant_name_* since
// 20260824130000, and the mapper discarded all three — so every tiered line
// rendered as the bare product name, and two "Coral" lines at different prices
// were indistinguishable on a ticket.
// ===========================================================================
describe('order line tier snapshot', () => {
  function orderRowWithItem(item: Record<string, unknown>) {
    return {
      id: 'o1', order_number: 'SM-2026-000009', customer_id: 'u1',
      customer_name: 'Ali', customer_phone: '+966', branch_id: 'b1',
      branch_name_en: 'Olaya', branch_name_ar: 'العليا', status: 'received',
      order_type: 'pickup', subtotal: 29, delivery_fee: 0, discount_amount: 0,
      loyalty_discount_amount: 0, vat_amount: 3.8, total: 29,
      payment_status: 'pending', payment_method: null, coupon_code: null,
      notes: null, created_at: '2026-08-24T00:00:00Z', sync_status: 'pending',
      address_snapshot: null,
      order_items: [{
        id: 'i1', order_id: 'o1', product_id: 'p1',
        name_en: 'Coral', name_ar: 'كورال',
        unit_price: 29, quantity: 1, line_total: 29,
        order_item_modifiers: [],
        ...item,
      }],
    } as unknown as DbOrderWithItems;
  }

  it('carries the tier through the mapper instead of discarding it', () => {
    const [item] = mapOrder(orderRowWithItem({
      variant_id: 'V_LARGE', variant_name_en: 'Large', variant_name_ar: 'كبير',
    })).items;
    expect(item.variantId).toBe('V_LARGE');
    expect(item.variantNameEn).toBe('Large');
    expect(item.variantNameAr).toBe('كبير');
  });

  it('leaves the tier undefined for an untiered line, never null', () => {
    const [item] = mapOrder(orderRowWithItem({})).items;
    expect(item.variantId).toBeUndefined();
    expect(item.variantNameEn).toBeUndefined();
    expect(item.variantNameAr).toBeUndefined();
  });

  it('labels a tiered line "Coral — Large", in both directions', () => {
    const [item] = mapOrder(orderRowWithItem({
      variant_id: 'V_LARGE', variant_name_en: 'Large', variant_name_ar: 'كبير',
    })).items;
    expect(orderLineLabel(item, false)).toBe('Coral — Large');
    expect(orderLineLabel(item, true)).toBe('كورال — كبير');
  });

  it('falls back to the bare name with no tier, or when the tier repeats it', () => {
    const [bare] = mapOrder(orderRowWithItem({})).items;
    expect(orderLineLabel(bare, false)).toBe('Coral');
    expect(orderLineLabel({ ...bare, variantNameEn: 'Coral' }, false)).toBe('Coral');
    expect(orderLineLabel({ ...bare, variantNameEn: '   ' }, false)).toBe('Coral');
  });
});
