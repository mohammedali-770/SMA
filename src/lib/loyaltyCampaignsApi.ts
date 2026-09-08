/**
 * Points-earning campaigns — the console's side of `public.loyalty_multipliers`.
 *
 * A campaign multiplies what an order EARNS; it never changes what an order
 * COSTS, and it can never reduce earning (the column CHECK is `between 1 and
 * 10`). That is worth stating here because the two are easy to conflate: money
 * off is `campaigns`, a different table with different constraints, currently
 * blocked on open business questions.
 *
 * These are ordinary RLS-gated table writes rather than a SECURITY DEFINER RPC,
 * and deliberately so: unlike a comped member — one row of which is unlimited
 * free food — the worst a bad row here can do is over-reward within a bounded
 * multiplier, and `is_admin()` (role AND AAL2) already gates every write at the
 * policy level. Adding an RPC would move the gate without tightening it.
 *
 * Customers never read this table. They see the RESULT, through the points
 * figure at checkout and on the receipt, both computed server-side.
 */
import { supabase } from './supabase';

export interface LoyaltyCampaign {
  id: string;
  name_en: string;
  name_ar: string;
  /** Between 1 and 10. 2 = double points; 1.5 = "+50% points". */
  multiplier: number;
  starts_at: string | null;
  ends_at: string | null;
  branch_id: string | null;
  product_id: string | null;
  category_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface LoyaltyCampaignInput {
  name_en: string;
  name_ar: string;
  multiplier: number;
  starts_at?: string | null;
  ends_at?: string | null;
  branch_id?: string | null;
  product_id?: string | null;
  category_id?: string | null;
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export const loyaltyCampaigns = {
  /** Newest first — an operator is nearly always looking for what they just made. */
  async list(): Promise<LoyaltyCampaign[]> {
    return unwrap<LoyaltyCampaign[]>(
      await supabase
        .from('loyalty_multipliers')
        .select('id, name_en, name_ar, multiplier, starts_at, ends_at, branch_id, product_id, category_id, is_active, created_at')
        .order('created_at', { ascending: false }),
    );
  },

  async create(input: LoyaltyCampaignInput): Promise<void> {
    // Empty strings are sent as NULL rather than as dates: an unset window bound
    // means "open-ended", and '' would be rejected as a malformed timestamp with
    // an error that explains nothing to the operator.
    const row = {
      name_en: input.name_en.trim(),
      name_ar: input.name_ar.trim(),
      multiplier: input.multiplier,
      starts_at: input.starts_at || null,
      ends_at: input.ends_at || null,
      branch_id: input.branch_id || null,
      product_id: input.product_id || null,
      category_id: input.category_id || null,
    };
    const { error } = await supabase.from('loyalty_multipliers').insert(row);
    if (error) throw new Error(error.message);
  },

  /**
   * Deactivating is the normal way to stop a campaign, and is preferred over
   * deleting: the row stays readable next to the orders it affected.
   */
  async setActive(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('loyalty_multipliers')
      .update({ is_active: isActive })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('loyalty_multipliers').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};
