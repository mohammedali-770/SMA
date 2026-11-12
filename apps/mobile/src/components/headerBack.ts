/**
 * What the header's back chevron does.
 *
 * On a direct load or a refresh of a page that shows a back chevron (the cart,
 * a product, the legal and profile sub-pages), there is no in-app history, so
 * `router.back()` has nowhere to go and the chevron did nothing at all. It now
 * goes home instead, to the same `HOME_ROUTE` the login screen's "Not now"
 * falls back to.
 *
 * Pure, so the decision is tested without rendering React Native.
 */
export type BackAction = 'custom' | 'back' | 'home';

export function resolveBack(input: { hasOnBack: boolean; canGoBack: boolean }): BackAction {
  if (input.hasOnBack) return 'custom';
  return input.canGoBack ? 'back' : 'home';
}
