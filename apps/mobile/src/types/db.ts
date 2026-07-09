/**
 * Postgres row shapes (snake_case) returned by PostgREST / the RPCs, mirroring
 * the customer-facing subset of the web app's src/lib/api.ts. These match the
 * columns produced by the existing supabase/migrations — the mobile app does
 * NOT redefine or migrate anything, it reuses the same backend.
 *
 * Admin-only shapes (coupons table, integration_settings) are intentionally
 * omitted: the customer app never reads or writes them.
 */
export type UserRole = 'customer' | 'admin' | 'accountant';
export type OrderStatus =
  | 'received' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';
export type OrderType = 'delivery' | 'pickup';
export type DbSyncStatus = 'not_synced' | 'syncing' | 'synced' | 'failed';

export interface DbBranch {
  id: string; name_en: string; name_ar: string;
  address_en: string | null; address_ar: string | null; phone: string | null;
  latitude: number | null; longitude: number | null;
  delivery_fee: number; min_delivery_order: number; is_active: boolean;
  // Delivery-zone feature flags (optional so a pre-migration project still parses).
  delivery_enabled?: boolean;
  pickup_enabled?: boolean;
  delivery_temporarily_closed?: boolean;
  estimated_delivery_minutes?: number | null;
}
/** Active per-branch delivery coverage polygon (safe columns only). */
export interface DbBranchDeliveryZone {
  id: string; branch_id: string; name: string | null;
  zone_geojson: unknown; is_active: boolean;
}
export interface DbCategory {
  id: string; name_en: string; name_ar: string; sort_order: number; is_active: boolean;
}
export interface DbProduct {
  id: string; category_id: string; name_en: string; name_ar: string;
  description_en: string | null; description_ar: string | null;
  price: number; calories: number | null; image_url: string | null;
  is_active: boolean; sort_order: number;
}
export interface DbModifierGroup {
  id: string; name_en: string; name_ar: string;
  min_select: number; max_select: number | null; is_required: boolean;
}
export interface DbModifier {
  id: string; group_id: string; name_en: string; name_ar: string;
  price: number; sort_order: number; is_active: boolean;
}
export interface DbProductModifierGroup { product_id: string; group_id: string; sort_order: number; }
export interface DbBranchAvailability { branch_id: string; product_id: string; is_available: boolean; }
export interface DbAppSettings {
  id: boolean; brand_name_en: string; brand_name_ar: string;
  primary_color: string; secondary_color: string; currency: string;
  vat_percentage: number; loyalty_enabled: boolean;
  points_per_riyal: number; discount_per_point: number; min_points_to_redeem: number;
  // Admin-configured payment availability (optional so a pre-migration project
  // still parses; the app falls back to cash-on / online-off defaults).
  online_payment_enabled?: boolean;
  cash_payment_enabled?: boolean;
  default_payment_method?: 'online' | 'cash' | null;
  payment_outage_mode_enabled?: boolean;
}
export interface DbProfile {
  id: string; full_name: string | null; phone_number: string | null;
  email: string | null; role: UserRole; loyalty_points: number;
  phone_verified?: boolean; phone_verified_at?: string | null;
}
export interface DbAddress {
  id: string; customer_id: string; label: string | null; description: string | null;
  national_short_address: string | null; latitude: number | null; longitude: number | null;
  is_default: boolean;
}
export interface DbOrder {
  id: string; order_number: string; customer_id: string | null;
  customer_name: string | null; customer_phone: string | null;
  branch_id: string; branch_name_en: string | null; branch_name_ar: string | null;
  status: OrderStatus; order_type: OrderType;
  subtotal: number; delivery_fee: number; discount_amount: number;
  loyalty_discount_amount: number; vat_amount: number; total: number;
  payment_status: 'pending' | 'paid'; payment_method: string | null;
  payment_provider?: string | null; paid_at?: string | null;
  coupon_code: string | null; notes: string | null; created_at: string;
  sync_status: DbSyncStatus; address_snapshot: Record<string, unknown> | null;
  loyalty_points_earned: number; loyalty_points_redeemed: number;
}
export interface DbOrderItem {
  id: string; order_id: string; product_id: string | null;
  name_en: string; name_ar: string; unit_price: number; quantity: number; line_total: number;
}
export interface DbOrderItemModifier {
  id: string; order_item_id: string; modifier_id: string | null;
  name_en: string; name_ar: string; price: number;
}
export type DbOrderWithItems = DbOrder & {
  order_items: (DbOrderItem & { order_item_modifiers: DbOrderItemModifier[] })[];
};
export interface DbLoyaltyTransaction {
  id: string; profile_id: string; order_id: string | null;
  type: 'earn' | 'redeem' | 'adjustment'; points: number;
  balance_after: number | null; reason: string | null; created_at: string;
}
