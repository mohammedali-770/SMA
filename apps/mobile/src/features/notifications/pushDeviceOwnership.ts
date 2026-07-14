/**
 * Push-device OWNERSHIP CONTRACT — a pure, framework-free model of the
 * register_push_device / deactivate_push_device SECURITY DEFINER RPCs
 * (supabase/migrations/20260714090000_push_notifications.sql).
 *
 * The SQL is the runtime implementation; this module is the executable
 * specification the unit tests exercise (pushDeviceOwnership.test.ts), and
 * both MUST encode the same rules:
 *  - An Expo token identifies the PHYSICAL DEVICE and is globally unique.
 *  - register(user, token) atomically claims the token for `user`: on a
 *    shared phone the row is REASSIGNED, the previous owner loses targeting,
 *    and the previous owner's preferences are NOT inherited — the new
 *    registration's preferences apply.
 *  - Registration always reactivates the row, so it stays sufficient even
 *    when a previous logout cleanup never ran.
 *  - deactivate(token) is idempotent and works regardless of current owner
 *    (token possession proves device possession).
 *  - Only Expo-formatted tokens are accepted.
 */

export interface PushDeviceRecord {
  customerId: string;
  token: string;
  isActive: boolean;
  orderUpdatesEnabled: boolean;
  promosEnabled: boolean;
  lang: 'en' | 'ar';
}

/** Mirrors the RPC's token guard. */
export function isValidExpoToken(token: string): boolean {
  const t = token.trim();
  return t.length >= 10 && t.length <= 200 && /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(t);
}

export interface RegisterInput {
  customerId: string;
  token: string;
  lang: 'en' | 'ar';
  orderUpdatesEnabled: boolean;
  promosEnabled: boolean;
}

/**
 * Apply a registration to the device registry (token-unique). Returns the new
 * registry. Throws on an invalid token — same as the RPC.
 */
export function applyRegister(registry: PushDeviceRecord[], input: RegisterInput): PushDeviceRecord[] {
  if (!isValidExpoToken(input.token)) throw new Error('invalid token');
  const next: PushDeviceRecord = {
    customerId: input.customerId,
    token: input.token.trim(),
    isActive: true,
    orderUpdatesEnabled: input.orderUpdatesEnabled,
    promosEnabled: input.promosEnabled,
    lang: input.lang,
  };
  const others = registry.filter((r) => r.token !== next.token);
  // Token-unique upsert: any previous row for this token (ANY owner) is
  // replaced — ownership transfers, old preferences are not inherited.
  return [...others, next];
}

/** Idempotent, owner-independent deactivation (the sign-out path). */
export function applyDeactivate(registry: PushDeviceRecord[], token: string): PushDeviceRecord[] {
  return registry.map((r) => (r.token === token.trim() ? { ...r, isActive: false } : r));
}

/** Who would an order-update push for `customerId` target? (dispatch rule) */
export function orderUpdateTargets(registry: PushDeviceRecord[], customerId: string): PushDeviceRecord[] {
  return registry.filter((r) => r.customerId === customerId && r.isActive && r.orderUpdatesEnabled);
}
