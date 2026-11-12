/**
 * The most of one item a single order line may hold — FRAMEWORK-FREE.
 *
 * The database refuses more: `order_items_quantity_max`, a CHECK of
 * `quantity <= 50` added by supabase/migrations/20261005120000_server_input_bounds.sql.
 * The app stops its steppers at the same number so an honest customer never
 * meets that refusal. `quantityLimit.test.ts` reads the migration and fails if
 * the two numbers drift apart.
 *
 * 50 is a proposal the owner has to confirm (docs/OWNER_ACTIONS.md §48). The
 * largest real line in Production was 7 when it was chosen (2026-11-12).
 */
export const MAX_LINE_QUANTITY = 50;

/** One more, but never past the cap. */
export function incrementQuantity(quantity: number): number {
  return Math.min(MAX_LINE_QUANTITY, quantity + 1);
}

/**
 * Two lines of the same item merging into one (adding a dish already in the
 * cart). The merged line is capped too, or adding the same dish twice would
 * build a line the server refuses.
 */
export function mergeQuantities(a: number, b: number): number {
  return Math.min(MAX_LINE_QUANTITY, a + b);
}

/** Bring any quantity into 1..MAX_LINE_QUANTITY. */
export function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1;
  return Math.max(1, Math.min(MAX_LINE_QUANTITY, Math.trunc(quantity)));
}
