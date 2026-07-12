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
