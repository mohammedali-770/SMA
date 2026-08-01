/**
 * Address write payloads, ownership and failure classification — FRAMEWORK-FREE
 * and fully unit-tested.
 *
 * `services/api.ts` imports `lib/supabase`, which pulls in React Native, so the
 * vitest suite cannot exercise the address calls directly. Everything about
 * those calls that can actually be WRONG lives here instead: which columns a
 * patch is allowed to touch, that a create is stamped with the signed-in user,
 * that the Saudi short address is upper-cased to match the column CHECK, and
 * what a customer is told when the write fails.
 *
 * The server remains authoritative. RLS (`customer_id = auth.uid()`) is what
 * actually isolates one customer's addresses from another's; the ownership
 * guard here only stops the app from issuing a write it knows is unauthenticated.
 */

/** Create/update DTO. Mirrors the columns the customer is allowed to write. */
export interface AddressInput {
  label?: string | null;
  description?: string | null;
  nationalShortAddress?: string | null;
  latitude: number;
  longitude: number;
  isDefault?: boolean;
}

/**
 * The Saudi National Short Address column is `CHECK (~ '^[A-Z]{4}[0-9]{4}$')`
 * — uppercase only. The field accepts either case, so normalize before writing
 * or a lowercase entry is rejected by the database rather than by the form.
 * Blank becomes null: an empty string is not a code.
 */
export function normalizeShortAddress(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim().toUpperCase();
  return value.length === 0 ? null : value;
}

/** Trim an optional free-text column, collapsing "absent" and "blank" to null. */
export function normalizeOptionalText(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  return value.length === 0 ? null : value;
}

/**
 * Ownership guard for the create path. `customer_id` is never taken from the
 * caller — it is stamped from the live session, so a client cannot write an
 * address into someone else's book even before RLS has its say.
 */
export function requireCustomerId(userId: string | null | undefined): string {
  if (!userId) throw new Error('You must be signed in to save an address.');
  return userId;
}

/** The insert row for a new address, owned by `customerId`. */
export function toAddressInsert(input: AddressInput, customerId: string): Record<string, unknown> {
  return {
    customer_id: customerId,
    label: normalizeOptionalText(input.label),
    description: normalizeOptionalText(input.description),
    national_short_address: normalizeShortAddress(input.nationalShortAddress),
    latitude: input.latitude,
    longitude: input.longitude,
    is_default: input.isDefault ?? false,
  };
}

/**
 * The update row for an existing address. Only keys the caller actually
 * supplied are sent, so editing a label can never blank a landmark, and
 * `customer_id` is not writable here at all — re-parenting an address to
 * another customer is not something this API can express.
 */
export function toAddressPatch(patch: Partial<AddressInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.label !== undefined) row.label = normalizeOptionalText(patch.label);
  if (patch.description !== undefined) row.description = normalizeOptionalText(patch.description);
  if (patch.nationalShortAddress !== undefined) {
    row.national_short_address = normalizeShortAddress(patch.nationalShortAddress);
  }
  if (patch.latitude !== undefined) row.latitude = patch.latitude;
  if (patch.longitude !== undefined) row.longitude = patch.longitude;
  if (patch.isDefault !== undefined) row.is_default = patch.isDefault;
  return row;
}

/** True when a patch would send nothing — PostgREST rejects an empty body. */
export function isEmptyPatch(row: Record<string, unknown>): boolean {
  return Object.keys(row).length === 0;
}

export type AddressProblem =
  | 'not_signed_in'
  /**
   * A checkout that can still become an order references this address.
   *
   * Raised as SQLSTATE 55006 by trg_addresses_guard_live_checkout. Deleting the
   * address in that window could leave a captured payment with no order it can
   * be turned into, so the guard refuses.
   *
   * The copy deliberately does NOT say "try again once that order finishes".
   * The refusal does lift when the checkout completes — but nothing in the
   * schema ever cancels a session, so an ABANDONED or declined online checkout
   * leaves one sitting in `pending_payment`/`expired` indefinitely, and for that
   * address the lift never comes on its own. Naming a completion the customer
   * may never be able to cause would be the same false promise the old
   * "try again shortly" copy made. It names the two things that DO work:
   * finishing the checkout, and asking support (server-side deletes are exempt
   * from the guard).
   */
  | 'checkout_in_progress'
  /**
   * A foreign key still points at this address.
   *
   * This is NO LONGER an expected outcome. It used to be: `checkout_sessions`
   * referenced `addresses(id)` with no ON DELETE action and session rows are
   * kept forever, so any address that had ever backed an online checkout was
   * undeletable for the life of the account, and the copy said so. Migration
   * 20260801120100 makes that FK ON DELETE SET NULL, matching `orders`, so the
   * one case customers actually hit is gone.
   *
   * The state is kept because an unexpected reference is still possible — a
   * future table, or this migration not yet being applied to the environment
   * the app is talking to. The copy therefore no longer claims the address is
   * permanently undeletable, and no longer claims that waiting will fix it. It
   * says what is true of a constraint we did not anticipate: it could not be
   * removed right now, and support can find out why.
   */
  | 'constrained'
  | 'not_found'
  | 'invalid_description'
  | 'network'
  | 'unknown';

interface CodedError {
  code?: unknown;
  message?: unknown;
}

/**
 * Turn a PostgREST/network failure into one of the states the UI actually has
 * copy for. Reads the SQLSTATE when `services/api.ts` preserved it and falls
 * back to the message text, because a few transport paths lose the code.
 *
 * `constrained` is the residual foreign-key case. The one customers used to hit
 * — an address that had ever backed an online checkout — is fixed at the schema
 * level by migration 20260801120100, so this is now a genuine surprise rather
 * than a documented dead end, and the copy is written accordingly.
 */
export function classifyAddressError(err: unknown): AddressProblem {
  const e = (err ?? {}) as CodedError;
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';

  // Checked before the generic FK case: the guard is deliberately a distinct
  // SQLSTATE precisely so it does not read as an unexpected constraint.
  if (code === '55006' || /checkout that has not finished/.test(message)) {
    return 'checkout_in_progress';
  }
  if (code === '23503' || /violates foreign key constraint/.test(message)) return 'constrained';
  if (code === '23514' || code === '23502' || /location description|landmark/.test(message)) {
    return 'invalid_description';
  }
  if (code === '42501' || /row-level security|not authenticated|signed in|jwt/.test(message)) {
    return 'not_signed_in';
  }
  if (code === 'PGRST116' || /no rows|not found/.test(message)) return 'not_found';
  if (/network|fetch failed|timeout|offline|failed to fetch/.test(message)) return 'network';
  return 'unknown';
}

/**
 * One short line per failure, both languages. Kept beside the classifier so a
 * new problem case cannot be added without its message.
 */
export const addressErrorCopy = {
  en: {
    not_signed_in: 'Sign in again to manage your addresses',
    checkout_in_progress: "A checkout you started still uses this address. Complete that checkout, or contact us to remove it.",
    constrained: "We couldn't remove that address. Please try again, or contact us if it keeps happening.",
    not_found: "That address is no longer saved",
    invalid_description: 'Add a nearby landmark so the driver can find you',
    network: "We couldn't reach the server. Check your connection and try again.",
    unknown: "That didn't save. Please try again.",
    loadFailed: "We couldn't load your addresses",
  },
  ar: {
    not_signed_in: 'سجّل الدخول مرة أخرى لإدارة عناوينك',
    checkout_in_progress: 'هناك عملية شراء بدأتها ما زالت تستخدم هذا العنوان. أكمل تلك العملية، أو تواصل معنا لحذفه.',
    constrained: 'تعذّر حذف هذا العنوان. حاول مرة أخرى، أو تواصل معنا إذا تكرر الأمر.',
    not_found: 'لم يعد هذا العنوان محفوظاً',
    invalid_description: 'أضف أقرب معلم حتى يتمكن المندوب من الوصول إليك',
    network: 'تعذّر الوصول إلى الخادم. تحقق من اتصالك وحاول مرة أخرى.',
    unknown: 'لم يتم الحفظ. حاول مرة أخرى.',
    loadFailed: 'تعذّر تحميل عناوينك',
  },
} as const;

export type AddressErrorLang = keyof typeof addressErrorCopy;

/** The customer-facing message for a failure. Never a raw provider string. */
export function addressErrorMessage(err: unknown, lang: AddressErrorLang): string {
  return addressErrorCopy[lang][classifyAddressError(err)];
}
