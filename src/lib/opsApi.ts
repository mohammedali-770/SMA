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

/** Live delivery state for one branch, read fresh rather than from the context. */
export interface BranchDeliveryState {
  branchId: string;
  deliveryTemporarilyClosed: boolean;
  deliveryClosedUntil: string | null;
}

/**
 * A branch's request for the call centre to close delivery.
 *
 * Filing one changes NOTHING about delivery — only an accepted request does,
 * and only the call centre can accept. The branch's side of this is therefore
 * "ask and wait", which is why the console shows the waiting state rather than
 * a success toast.
 */
export interface DeliveryRequestRow {
  id: string;
  branchId: string;
  requestedMinutes: number;
  reasonCode: DeliveryReasonCode;
  note: string | null;
  requestedAt: string;
  expiresAt: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  resolutionNote: string | null;
  appliedMinutes: number | null;
}

/**
 * One row of the branch reference sheet.
 *
 * `kind === 'secret'` rows carry NO value: the plaintext lives in Supabase
 * Vault and is returned only by `revealReference`, which is branch-scoped and
 * audited server-side. A secret row reaching the client is not a leak — there
 * is nothing in it to leak.
 */
export interface BranchReferenceRow {
  id: string;
  branchId: string;
  kind: 'text' | 'link' | 'phone' | 'secret';
  labelEn: string;
  labelAr: string;
  valuePlain: string | null;
  sortOrder: number;
}

/** The same, for one OPTION rather than a whole product. */
export interface BranchModifierAvailabilityRow {
  modifierId: string;
  isAvailable: boolean;
  snoozedUntil: string | null;
  reasonCode: OpsReasonCode | null;
}

/**
 * One PRICE TIER's availability at one branch (20260923120000). Same
 * exceptions-only storage as the two above: an absent row means on sale.
 */
export interface BranchVariantAvailabilityRow {
  variantId: string;
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
   * Option-availability exceptions across EVERY branch, for the call-centre
   * board. One unfiltered read, for the same reason as `allAvailability`: the
   * table stores only exceptions, so it is small by construction.
   */
  async allModifierAvailability(): Promise<(BranchModifierAvailabilityRow & { branchId: string })[]> {
    const { data, error } = await supabase
      .from('branch_modifier_availability')
      .select('branch_id, modifier_id, is_available, snoozed_until, reason_code');
    fail(error);
    return (data ?? []).map((r) => ({
      branchId: r.branch_id as string,
      modifierId: r.modifier_id as string,
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

  /**
   * Whether the per-SIZE closing controls are switched on
   * (`app_settings.variant_closing_enabled`, 20260926120000).
   *
   * THE ONLY FUNCTION HERE THAT SWALLOWS ITS ERROR, and the reason is the whole
   * point of the flag. The branch console deploys the moment this merges, while
   * applying the migration is a separate owner action that may come later or
   * not at all. PostgREST answers a select naming a column that does not exist
   * with `42703` — and `fail()` would turn that into a thrown error inside the
   * console's single `refresh()`, taking down the whole screen for every cashier
   * over a feature none of them can use yet. That is the `orders.is_comped`
   * outage in a new costume.
   *
   * So: its own query, never folded into a select that fetches anything needed
   * (one unreadable column fails the WHOLE select), and any error at all resolves
   * to FALSE — controls hidden, which is exactly the pre-migration behaviour.
   */
  async variantClosingEnabled(): Promise<boolean> {
    const { data, error } = await supabase
      .from('app_settings')
      .select('variant_closing_enabled')
      .eq('id', true)
      .maybeSingle();
    if (error) return false;
    return Boolean((data as { variant_closing_enabled?: boolean } | null)?.variant_closing_enabled);
  },

  /**
   * Price-tier availability exceptions for one branch. Exceptions only, exactly
   * as for products and options.
   *
   * IT DEGRADES TO `[]` RATHER THAN THROWING, for the same reason
   * `variantClosingEnabled` does — and leaving it throwing was a real defect
   * caught in review on #395, not a hypothetical. The console's `refresh()` is
   * one `Promise.all`, so in the documented window where this deploys before
   * `20260923120000` is applied, PostgREST's missing-relation error would reject
   * the whole thing: every cashier would get a blocking "could not load" notice
   * instead of their availability, delivery and reference controls, over a table
   * that holds nothing they can use yet.
   *
   * `[]` is the correct answer rather than a fallback: the table stores
   * exceptions only, so no rows means no size is closed — which is exactly what
   * a table that does not exist implies.
   */
  async branchVariantAvailability(branchId: string): Promise<BranchVariantAvailabilityRow[]> {
    const { data, error } = await supabase
      .from('branch_variant_availability')
      .select('variant_id, is_available, snoozed_until, reason_code')
      .eq('branch_id', branchId);
    if (error) return [];
    return (data ?? []).map((r) => ({
      variantId: r.variant_id as string,
      isAvailable: r.is_available as boolean,
      snoozedUntil: (r.snoozed_until as string | null) ?? null,
      reasonCode: (r.reason_code as OpsReasonCode | null) ?? null,
    }));
  },

  /**
   * Live delivery state for every branch.
   *
   * The consoles otherwise read `branches` from the app context, which is
   * loaded once at sign-in — so an operator who paused delivery saw the board
   * stay all-clear, and one who resumed it saw the branch stay paused, until
   * the whole application was reloaded. Safe columns only: the reason code and
   * the staff actor live on `branch_delivery_events`, which anon cannot read.
   */
  async branchDeliveryState(): Promise<BranchDeliveryState[]> {
    const { data, error } = await supabase
      .from('branches')
      .select('id, delivery_temporarily_closed, delivery_closed_until');
    fail(error);
    return (data ?? []).map((r) => ({
      branchId: r.id as string,
      deliveryTemporarilyClosed: (r.delivery_temporarily_closed as boolean | null) ?? false,
      deliveryClosedUntil: (r.delivery_closed_until as string | null) ?? null,
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
   * Close one PRICE TIER at this branch for a bounded number of minutes.
   *
   * `set_variant_snooze` refuses an INACTIVE tier, which is not a detail the
   * console has to reproduce: the sheet lists `activeVariants` only, so the
   * refusal is a backstop against a stale screen rather than a routine path.
   */
  async snoozeVariant(input: {
    branchId: string;
    variantId: string;
    minutes: number;
    reasonCode: OpsReasonCode;
    note?: string | null;
  }): Promise<void> {
    const { error } = await supabase.rpc('set_variant_snooze', {
      p_branch_id: input.branchId,
      p_variant_id: input.variantId,
      p_minutes: input.minutes,
      p_reason_code: input.reasonCode,
      p_note: input.note?.trim() ? input.note.trim() : null,
    });
    fail(error);
  },

  /** Reopen one price tier at this branch immediately. Idempotent server-side. */
  async reopenVariant(branchId: string, variantId: string): Promise<void> {
    const { error } = await supabase.rpc('clear_variant_snooze', {
      p_branch_id: branchId,
      p_variant_id: variantId,
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

  // ---- delivery-closure requests (branch asks, call centre answers) --------

  /**
   * Recent requests for one branch, newest first.
   *
   * Reads the table directly: RLS already restricts it to the branch's own
   * operator, the call centre and staff, and the row carries no secret. The
   * console needs the resolved ones too, so a cashier can see that the last
   * request was declined and why rather than wondering if it was sent.
   */
  async deliveryRequests(branchId: string, limit = 5): Promise<DeliveryRequestRow[]> {
    const { data, error } = await supabase
      .from('branch_delivery_requests')
      .select(
        'id, branch_id, requested_minutes, reason_code, note, requested_at, expires_at, status, resolution_note, applied_minutes',
      )
      .eq('branch_id', branchId)
      .order('requested_at', { ascending: false })
      .limit(limit);
    fail(error);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      branchId: r.branch_id as string,
      requestedMinutes: r.requested_minutes as number,
      reasonCode: r.reason_code as DeliveryReasonCode,
      note: (r.note as string | null) ?? null,
      requestedAt: r.requested_at as string,
      expiresAt: r.expires_at as string,
      status: r.status as DeliveryRequestRow['status'],
      resolutionNote: (r.resolution_note as string | null) ?? null,
      appliedMinutes: (r.applied_minutes as number | null) ?? null,
    }));
  },

  /** Ask the call centre to close delivery. Changes no delivery state. */
  async requestDeliveryPause(input: {
    branchId: string;
    minutes: number;
    reasonCode: DeliveryReasonCode;
    note?: string | null;
  }): Promise<void> {
    const { error } = await supabase.rpc('request_branch_delivery_pause', {
      p_branch_id: input.branchId,
      p_minutes: input.minutes,
      p_reason_code: input.reasonCode,
      p_note: input.note?.trim() ? input.note.trim() : null,
    });
    fail(error);
  },

  /**
   * Every request still waiting, across all branches. Call-centre side.
   *
   * Filters on status only. Expiry is decided by the client from `expiresAt`,
   * because the server retires a stale request only when somebody touches it —
   * so a row can sit at 'pending' past its own expiry, and a board that trusted
   * status alone would offer an Accept button that cannot work.
   */
  async pendingDeliveryRequests(): Promise<DeliveryRequestRow[]> {
    const { data, error } = await supabase
      .from('branch_delivery_requests')
      .select(
        'id, branch_id, requested_minutes, reason_code, note, requested_at, expires_at, status, resolution_note, applied_minutes',
      )
      .eq('status', 'pending')
      .order('requested_at', { ascending: true });
    fail(error);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      branchId: r.branch_id as string,
      requestedMinutes: r.requested_minutes as number,
      reasonCode: r.reason_code as DeliveryReasonCode,
      note: (r.note as string | null) ?? null,
      requestedAt: r.requested_at as string,
      expiresAt: r.expires_at as string,
      status: r.status as DeliveryRequestRow['status'],
      resolutionNote: (r.resolution_note as string | null) ?? null,
      appliedMinutes: (r.applied_minutes as number | null) ?? null,
    }));
  },

  /**
   * Accept or decline one request.
   *
   * Accepting applies the pause through the same RPC an operator's manual pause
   * uses, so there is one implementation and one audit trail. Returns the
   * server's own view, which may be `expired` — a request can lapse between the
   * board rendering and the operator clicking, and the server says so rather
   * than acting on stale information.
   */
  async resolveDeliveryRequest(input: {
    requestId: string;
    accept: boolean;
    minutes?: number | null;
    note?: string | null;
  }): Promise<{ status: string }> {
    const { data, error } = await supabase.rpc('resolve_branch_delivery_request', {
      p_request_id: input.requestId,
      p_accept: input.accept,
      p_minutes: input.minutes ?? null,
      p_note: input.note?.trim() ? input.note.trim() : null,
    });
    fail(error);
    return { status: String((data as { status?: string } | null)?.status ?? 'unknown') };
  },

  /** Withdraw a request the branch no longer needs. Branch-scoped server-side. */
  async cancelDeliveryRequest(requestId: string): Promise<void> {
    const { error } = await supabase.rpc('cancel_branch_delivery_request', {
      p_request_id: requestId,
    });
    fail(error);
  },

  // ---- branch reference sheet ---------------------------------------------

  /**
   * The branch's reference entries. Secret rows come back WITHOUT a value by
   * construction — the column is null for them server-side.
   */
  async branchReference(branchId: string): Promise<BranchReferenceRow[]> {
    const { data, error } = await supabase
      .from('branch_reference_entries')
      .select('id, branch_id, kind, label_en, label_ar, value_plain, sort_order')
      .eq('branch_id', branchId)
      .order('sort_order', { ascending: true });

    // DEGRADE, DO NOT THROW, when the table is not there.
    //
    // `20260917120000` is merged but unapplied, so in Production this table does
    // not exist yet — and `fail(error)` took down the ENTIRE branch console with
    // it, including the availability controls a branch needs mid-service. An
    // optional reference sheet must never cost an operator the ability to snooze
    // a sold-out item (2026-09-13 audit, finding 2.7).
    //
    // Narrow on purpose: only "relation does not exist" (Postgres 42P01, or
    // PostgREST's PGRST205 schema-cache miss) is swallowed. A permission error,
    // a network failure or a malformed query still raises, because those mean
    // something the operator should see.
    const code = (error as { code?: string } | null)?.code;
    if (error && (code === '42P01' || code === 'PGRST205')) return [];
    fail(error);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      branchId: r.branch_id as string,
      kind: r.kind as BranchReferenceRow['kind'],
      labelEn: r.label_en as string,
      labelAr: r.label_ar as string,
      valuePlain: (r.value_plain as string | null) ?? null,
      sortOrder: (r.sort_order as number | null) ?? 0,
    }));
  },

  /**
   * Reveal one stored credential.
   *
   * EVERY CALL IS AUDITED server-side, so this must be driven by a deliberate
   * user action and never by a render, an effect or a prefetch — a component
   * that called this on mount would write an audit row every time the screen
   * was opened and make the trail worthless.
   */
  async revealReference(entryId: string): Promise<string> {
    const { data, error } = await supabase.rpc('branch_reference_reveal', {
      p_entry_id: entryId,
    });
    fail(error);
    const value = (data as { value?: string } | null)?.value;
    if (typeof value !== 'string') throw new Error('The credential could not be read');
    return value;
  },
};
