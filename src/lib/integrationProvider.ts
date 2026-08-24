/**
 * Choose the provider_name an IntegrationCard should start editing with.
 *
 * The stored value can be stale relative to what the card now offers — e.g. the
 * payment row is seeded `provider_name='sandbox'` but the card only offers
 * `['tap']`. With a single option the <select> never fires onChange, so a Save
 * would persist the stale `sandbox` and `resolveTapConfig` would reject the
 * gateway as `not_tap`, leaving checkout unavailable despite a "configured" card.
 * Coercing an unoffered value to the first valid option makes Save persist a
 * usable provider. Pure + framework-free so it's unit-tested directly.
 */
export function initialProviderName(
  storedName: string | null | undefined,
  options: readonly string[] | undefined,
): string {
  const opts = options ?? [];
  const stored = storedName ?? '';
  if (opts.length > 0 && !opts.includes(stored)) return opts[0];
  return stored || (opts[0] ?? '');
}

/**
 * Pick the field set an IntegrationCard should render for the currently selected
 * provider.
 *
 * A provider slot used to mean one provider, so one field list per slot was
 * enough. The payment slot now offers two, and they need genuinely different
 * inputs: Tap wants a merchant id, a source id and `sk_`-prefixed keys; Moyasar
 * wants no merchant id at all, a webhook secret token (its only webhook
 * authentication) and both `sk_` and `pk_` keys. Rendering the union of both
 * would present an administrator with four boxes that do nothing for the
 * provider they picked, which is how a "configured" gateway ends up missing the
 * one field that mattered.
 *
 * Falls back to the slot's own fields when the selected provider has no override,
 * so every other integration keeps behaving exactly as it did.
 */
export interface ProviderFieldSet<P, S> {
  publicFields: readonly P[];
  secretFields: readonly S[];
}

export function providerFieldSet<P, S>(
  base: ProviderFieldSet<P, S>,
  byProvider: Record<string, ProviderFieldSet<P, S>> | undefined,
  providerName: string | null | undefined,
): ProviderFieldSet<P, S> {
  const key = (providerName ?? '').toLowerCase();
  const override = byProvider?.[key];
  return override ?? base;
}
