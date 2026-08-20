/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from './supabase';

/**
 * Branch-operations reads and writes.
 *
 * Two things are deliberately asymmetric here. Reads go straight to the table:
 * `branch_product_availability` is world-readable, and the columns this asks
 * for are the non-sensitive ones by design — the staff user id and the
 * operator's note live only on the audit table. Writes go exclusively through
 * the RPCs, because branch operators hold no direct grant on the table; the
 * catalog write policy is `is_admin()` only. Authorization is re-checked
 * server-side in every case.
 */
export type OpsReasonCode =
  | 'out_of_stock'
  | 'supplier_delay'
  | 'equipment_down'
  | 'quality_hold'
  | 'other';

export interface BranchAvailabilityRow {
  productId: string;
  isAvailable: boolean;
  /** Scheduled auto-restore time. Null on an untimed (admin) closure. */
  snoozedUntil: string | null;
  reasonCode: OpsReasonCode | null;
}

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export const opsApi = {
  /** The signed-in operator's pinned branch id, or null when unassigned. */
  async myBranchId(): Promise<string | null> {
    const { data, error } = await supabase
      .from('staff_branch_assignments')
      .select('branch_id')
      .maybeSingle();
    fail(error);
    return (data?.branch_id as string | undefined) ?? null;
  },

  /**
   * Availability exceptions for one branch. Absence of a row means available,
   * so this returns only the exceptions — the caller treats anything missing as
   * on sale, matching how the rest of the app reads this table.
   */
  async branchAvailability(branchId: string): Promise<BranchAvailabilityRow[]> {
    const { data, error } = await supabase
      .from('branch_product_availability')
      .select('product_id, is_available, snoozed_until, reason_code')
      .eq('branch_id', branchId);
    fail(error);
    return (data ?? []).map((r) => ({
      productId: r.product_id as string,
      isAvailable: r.is_available as boolean,
      snoozedUntil: (r.snoozed_until as string | null) ?? null,
      reasonCode: (r.reason_code as OpsReasonCode | null) ?? null,
    }));
  },

  /** Close a product at this branch for a bounded number of minutes. */
  async snoozeProduct(input: {
    branchId: string;
    productId: string;
    minutes: number;
    reasonCode: OpsReasonCode;
    note?: string | null;
  }): Promise<void> {
    const { error } = await supabase.rpc('set_product_snooze', {
      p_branch_id: input.branchId,
      p_product_id: input.productId,
      p_minutes: input.minutes,
      p_reason_code: input.reasonCode,
      p_note: input.note?.trim() ? input.note.trim() : null,
    });
    fail(error);
  },

  /** Reopen a product at this branch immediately. Idempotent server-side. */
  async reopenProduct(branchId: string, productId: string): Promise<void> {
    const { error } = await supabase.rpc('clear_product_snooze', {
      p_branch_id: branchId,
      p_product_id: productId,
    });
    fail(error);
  },
};
