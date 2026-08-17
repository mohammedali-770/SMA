/**
 * AsyncStorage keys used by the mobile app, in one place so no two features
 * can collide — and so nobody "cleans up" a key literal without realizing it
 * orphans data already persisted on customers' devices. NEVER change these
 * values: a changed key silently discards every existing cart / language
 * preference in the field.
 *
 * Not listed here (still local to the frozen payment/checkout flow, to be
 * consolidated once that code is unfrozen): the pending checkout-session and
 * WebView hand-off keys, and the GoTrue session keys managed by supabase-js.
 */
export const CART_STORAGE_KEY = 'spicymeal.cart';
export const LANGUAGE_STORAGE_KEY = 'spicymeal.lang';
export const ORDER_CONTEXT_STORAGE_KEY = 'spicymeal.orderContext';
/**
 * On-device behaviour profile behind the cart suggestion strip. No version
 * suffix in the KEY — the header above forbids ever changing these values, so
 * the schema version lives inside the payload as `v` instead.
 */
export const SUGGESTIONS_STORAGE_KEY = 'spicymeal.suggestions';
