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
/** Reasons a branch's delivery, or one advisory area, gets paused. */
export type DeliveryReasonCode =
  | 'no_driver'
  | 'weather'
  | 'kitchen_overload'
  | 'area_incident'
  | 'other';

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

/** The same, for one OPTION rather than a whole product. */
export interface BranchModifierAvailabilityRow {
  modifierId: string;
  isAvailable: boolean;
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

  /**
   * Availability exceptions across EVERY branch, for the call-centre board.
   *
   * One unfiltered read rather than one per branch: the table stores only
   * exceptions, so it is small by construction, and a per-branch fan-out would
   * scale with the number of branches for no benefit.
   */
  async allAvailability(): Promise<(BranchAvailabilityRow & { branchId: string })[]> {
    const { data, error } = await supabase
      .from('branch_product_availability')
      .select('branch_id, product_id, is_available, snoozed_until, reason_code');
    fail(error);
    return (data ?? []).map((r) => ({
      branchId: r.branch_id as string,
      productId: r.product_id as string,
      isAvailable: r.is_available as boolean,
      snoozedUntil: (r.snoozed_until as string | null) ?? null,
      reasonCode: (r.reason_code as OpsReasonCode | null) ?? null,
    }));
  },

  /**
   * Option-availability exceptions for one branch. Exceptions only, exactly as
   * for products — an absent row means the option is on sale.
   */
  async branchModifierAvailability(branchId: string): Promise<BranchModifierAvailabilityRow[]> {
    const { data, error } = await supabase
      .from('branch_modifier_availability')
      .select('modifier_id, is_available, snoozed_until, reason_code')
      .eq('branch_id', branchId);
    fail(error);
    return (data ?? []).map((r) => ({
      modifierId: r.modifier_id as string,
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

  /** Close one option at this branch for a bounded number of minutes. */
  async snoozeModifier(input: {
    branchId: string;
    modifierId: string;
    minutes: number;
    reasonCode: OpsReasonCode;
    note?: string | null;
  }): Promise<void> {
    const { error } = await supabase.rpc('set_modifier_snooze', {
      p_branch_id: input.branchId,
      p_modifier_id: input.modifierId,
      p_minutes: input.minutes,
      p_reason_code: input.reasonCode,
      p_note: input.note?.trim() ? input.note.trim() : null,
    });
    fail(error);
  },

  /** Reopen one option at this branch immediately. Idempotent server-side. */
  async reopenModifier(branchId: string, modifierId: string): Promise<void> {
    const { error } = await supabase.rpc('clear_modifier_snooze', {
      p_branch_id: branchId,
      p_modifier_id: modifierId,
    });
    fail(error);
  },

  /**
   * Pause a branch's delivery for a bounded period.
   *
   * Authorized server-side for admins and the call centre only — branch staff
   * are deliberately excluded, the mirror image of item snoozing, which
   * excludes the call centre. Pickup is unaffected: pausing delivery must never
   * take a whole branch offline.
   */
  async pauseDelivery(input: {
    branchId: string;
    minutes: number;
    reasonCode: DeliveryReasonCode;
    note?: string | null;
  }): Promise<void> {
    const { error } = await supabase.rpc('set_branch_delivery_pause', {
      p_branch_id: input.branchId,
      p_minutes: input.minutes,
      p_reason_code: input.reasonCode,
      p_note: input.note?.trim() ? input.note.trim() : null,
    });
    fail(error);
  },

  /** Resume delivery immediately. Idempotent server-side. */
  async resumeDelivery(branchId: string): Promise<void> {
    const { error } = await supabase.rpc('clear_branch_delivery_pause', {
      p_branch_id: branchId,
    });
    fail(error);
  },

  /**
   * Disable one ADVISORY named area. This does not stop the app accepting
   * orders from it — delivery eligibility is decided solely by the branch
   * polygon. The area list exists for call-centre staff taking phone orders.
   */
  async disableArea(input: {
    areaId: string;
    minutes: number;
    reasonCode: DeliveryReasonCode;
    note?: string | null;
  }): Promise<void> {
    const { error } = await supabase.rpc('set_delivery_area_disabled', {
      p_area_id: input.areaId,
      p_minutes: input.minutes,
      p_reason_code: input.reasonCode,
      p_note: input.note?.trim() ? input.note.trim() : null,
    });
    fail(error);
  },

  async enableArea(areaId: string): Promise<void> {
    const { error } = await supabase.rpc('clear_delivery_area_disabled', { p_area_id: areaId });
    fail(error);
  },
};
