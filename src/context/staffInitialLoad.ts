/**
 * The staff console's first read after sign-in.
 *
 * The catalog and the live order window are independent reads, and they used
 * to run one after the other: `await refreshCatalog()`, then
 * `await refreshOrders()`, then every profile. Both now START together; the
 * profile list is gone from this path entirely (the Loyalty section reads its
 * own page when it opens).
 *
 *   - `onCatalog` runs as soon as the catalog arrives, so the branch default is
 *     set without waiting for the orders;
 *   - one failing read does not discard the other: `Promise.allSettled` waits
 *     for both, and the first failure's message is returned for `dataError`.
 */
export interface StaffInitialLoad<C> {
  loadCatalog: () => Promise<C>;
  loadOrders: () => Promise<unknown>;
  onCatalog: (catalog: C) => void;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Resolves to the first failure's message, or null when both reads succeeded. */
export async function runStaffInitialLoad<C>({
  loadCatalog,
  loadOrders,
  onCatalog,
}: StaffInitialLoad<C>): Promise<string | null> {
  const results = await Promise.allSettled([loadCatalog().then(onCatalog), loadOrders()]);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  return failed ? message(failed.reason) : null;
}
