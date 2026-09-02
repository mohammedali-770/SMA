/**
 * App-level discounts & promotional campaigns (#100) — shared PURE display
 * logic plus a thin, typed data-access wrapper.
 *
 * SERVER-AUTHORITATIVE: the discount amount is NEVER computed on the client.
 * `campaignsApi.validate()` calls the `compute_campaign_discount` RPC, which
 * recomputes and clamps the discount server-side against the real campaign
 * rules and product subtotal; the client only displays what the server returns.
 *
 * The pure helpers below are DISPLAY-ONLY — which auto-apply promos are live,
 * and a human label for an offer. They mirror the campaigns public RLS the
 * mobile app relies on, and they never decide a charge.
 *
 * NOT WIRED — READ THIS BEFORE CHANGING OR DELETING IT (recorded 2026-09-02).
 * Nothing imports this module except its own test. There is no Campaigns tab in
 * the admin console and no campaign surface in the customer app, so no operator
 * can create a campaign and no customer can redeem one. `place_order` has no
 * campaign awareness either, so `campaign_redemptions` is never written and
 * `global_limit` / `per_user_limit` are unenforced.
 *
 * It is kept ON PURPOSE. The schema and `compute_campaign_discount` are APPLIED
 * to Production; deleting this file would throw away the finished client half of
 * a live server contract while changing nothing operationally. The remaining work
 * and the eight business questions gating it are in docs/DISCOUNTS_CAMPAIGNS.md.
 */
import { supabase } from './supabase';

export type CampaignType = 'percentage' | 'fixed' | 'free_delivery';

export interface DbCampaign {
  id: string;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  type: CampaignType;
  value: number;
  code: string | null;
  starts_at: string | null;
  ends_at: string | null;
  min_order_amount: number;
  max_discount_amount: number | null;
  per_user_limit: number | null;
  global_limit: number | null;
  branch_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** One row returned by the compute_campaign_discount RPC (server-computed). */
export interface CampaignDiscount {
  valid: boolean;
  campaign_id: string | null;
  code: string | null;
  type: CampaignType | null;
  name_en: string | null;
  name_ar: string | null;
  discount_amount: number;
  free_delivery: boolean;
  message: string;
}

/** The fields the "is this promo live for a customer" check needs. */
export interface LiveCampaignRow {
  is_active: boolean;
  code: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

/**
 * Auto-apply promos a customer should currently see, mirroring the campaigns
 * public RLS policy exactly:
 *   is_active AND code IS NULL (coded promos are secret) AND
 *   (starts_at is null OR starts_at <= now) AND (ends_at is null OR ends_at >= now)
 * DISPLAY-ONLY; the mobile app enforces this server-side via RLS.
 */
export function selectLiveCampaigns<T extends LiveCampaignRow>(rows: readonly T[], nowMs: number): T[] {
  return rows.filter(
    (c) =>
      c.is_active &&
      c.code == null &&
      (c.starts_at == null || Date.parse(c.starts_at) <= nowMs) &&
      (c.ends_at == null || Date.parse(c.ends_at) >= nowMs),
  );
}

/**
 * Human, DISPLAY-ONLY summary of a campaign's offer (e.g. "20% off up to 15
 * SAR", "30 SAR off", "Free delivery"). Never a computed charge — the server
 * owns the real discount math.
 */
export function formatCampaignSummary(
  c: Pick<DbCampaign, 'type' | 'value' | 'max_discount_amount'>,
  lang: 'en' | 'ar' = 'en',
): string {
  const ar = lang === 'ar';
  switch (c.type) {
    case 'free_delivery':
      return ar ? 'توصيل مجاني' : 'Free delivery';
    case 'fixed':
      return ar ? `خصم ${c.value} ريال` : `${c.value} SAR off`;
    case 'percentage': {
      const base = ar ? `خصم ${c.value}%` : `${c.value}% off`;
      if (c.max_discount_amount != null) {
        return ar ? `${base} حتى ${c.max_discount_amount} ريال` : `${base} up to ${c.max_discount_amount} SAR`;
      }
      return base;
    }
  }
}

// ---------------------------------------------------------------------------
// Thin typed data-access wrapper (mirrors the `coupons` object in api.ts).
// ---------------------------------------------------------------------------
function ok<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export const campaignsApi = {
  /**
   * Server-authoritative validation. Returns the SERVER-computed discount for a
   * server-known subtotal; the client cannot dictate the amount. Pass a `code`
   * (secret promo) OR a `campaignId` (auto-apply promo).
   */
  async validate(input: {
    code?: string | null;
    campaignId?: string | null;
    subtotal: number;
    deliveryFee?: number;
    branchId?: string | null;
  }): Promise<CampaignDiscount> {
    const rows = ok<CampaignDiscount[]>(
      await supabase.rpc('compute_campaign_discount', {
        p_code: input.code ?? null,
        p_campaign_id: input.campaignId ?? null,
        p_subtotal: input.subtotal,
        p_delivery_fee: input.deliveryFee ?? 0,
        p_branch_id: input.branchId ?? null,
      }),
    );
    return rows[0];
  },
  /** Admin CRUD (RLS admin-only). Customer reads return only live auto-apply promos. */
  list: async () =>
    ok<DbCampaign[]>(await supabase.from('campaigns').select('*').order('created_at', { ascending: false })),
  async create(c: Partial<DbCampaign>) {
    return ok<DbCampaign>(await supabase.from('campaigns').insert(c).select().single());
  },
  async update(id: string, patch: Partial<DbCampaign>) {
    const { error } = await supabase.from('campaigns').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async remove(id: string) {
    const { error } = await supabase.from('campaigns').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};
