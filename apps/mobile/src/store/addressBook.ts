/**
 * The address-book state machine — FRAMEWORK-FREE and fully unit-tested.
 *
 * WHY A SHARED BOOK AT ALL
 * Checkout and the order-type gate each used to hold their own
 * `useState<SavedAddress[]>` filled by a mount-only `addresses.listMine()`.
 * Expo Router keeps stack screens mounted, so an address edited anywhere else
 * was invisible to an already-mounted Checkout until the app restarted. Profile
 * now owns a full CRUD surface, which turns that from a latent oddity into a
 * customer ordering to an address they just deleted. One book, one fetch, every
 * reader live.
 *
 * The transitions live here rather than inside the provider so the rules that
 * actually matter — a failed refresh must not blank a usable list, only one
 * address may be default, a delete must drop the row everywhere — are testable
 * without a renderer.
 */
import type { SavedAddress } from '../types/models';

export type AddressBookStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AddressBookState {
  status: AddressBookStatus;
  addresses: SavedAddress[];
  /** Customer-facing text for the last failure, or null. Never a raw provider string. */
  error: string | null;
  /**
   * Id of the address currently being written, `NEW_ADDRESS` while creating, or
   * null. Drives per-row spinners without a second piece of state.
   */
  pending: string | null;
}

/** `pending` sentinel for a create, which has no id yet. */
export const NEW_ADDRESS = 'new';

export const EMPTY_ADDRESS_BOOK: AddressBookState = {
  status: 'idle',
  addresses: [],
  error: null,
  pending: null,
};

export type AddressBookEvent =
  | { type: 'load_start' }
  | { type: 'load_success'; addresses: SavedAddress[] }
  | { type: 'load_failure'; message: string }
  | { type: 'mutation_start'; id: string }
  | { type: 'mutation_failure'; message: string }
  | { type: 'upserted'; address: SavedAddress }
  | { type: 'removed'; id: string }
  | { type: 'error_cleared' }
  | { type: 'signed_out' };

/**
 * Enforce the single-default invariant in the list the UI is rendering.
 *
 * The database enforces it too (see the address_single_default migration), but
 * the client cannot wait for a refetch to stop showing two "Default" badges
 * after a tap. This mirrors the trigger exactly: setting one default clears the
 * others; nothing here can invent a default that the server did not grant.
 */
function withSingleDefault(list: SavedAddress[], defaultId: string): SavedAddress[] {
  return list.map((a) => (a.isDefault && a.id !== defaultId ? { ...a, isDefault: false } : a));
}

export function applyAddressEvent(
  state: AddressBookState,
  event: AddressBookEvent,
): AddressBookState {
  switch (event.type) {
    case 'load_start':
      // Keeps the current list on purpose: a refresh must not flash an empty
      // address book at a customer who already has one.
      return { ...state, status: 'loading', error: null };

    case 'load_success': {
      const addresses = event.addresses;
      const chosen = addresses.find((a) => a.isDefault);
      return {
        status: 'ready',
        addresses: chosen ? withSingleDefault(addresses, chosen.id) : addresses,
        error: null,
        pending: null,
      };
    }

    case 'load_failure':
      // A transient failure keeps the last known list — the same rule the
      // profile cache uses. Losing a loaded address book to one bad request
      // would send the customer back through the address gate for nothing.
      return { ...state, status: 'error', error: event.message };

    case 'mutation_start':
      return { ...state, pending: event.id, error: null };

    case 'mutation_failure':
      return { ...state, pending: null, error: event.message };

    case 'upserted': {
      const address = event.address;
      const exists = state.addresses.some((a) => a.id === address.id);
      // Replace in place, or append. Appending keeps the server's created_at
      // ordering, which is what `listMine` returns.
      const next = exists
        ? state.addresses.map((a) => (a.id === address.id ? address : a))
        : [...state.addresses, address];
      return {
        status: 'ready',
        addresses: address.isDefault ? withSingleDefault(next, address.id) : next,
        error: null,
        pending: null,
      };
    }

    case 'removed':
      return {
        ...state,
        status: 'ready',
        addresses: state.addresses.filter((a) => a.id !== event.id),
        error: null,
        pending: null,
      };

    case 'error_cleared':
      return state.error === null ? state : { ...state, error: null };

    case 'signed_out':
      // Immediate and total: on a shared phone the next account must never see
      // the previous customer's addresses, not even for one frame.
      return EMPTY_ADDRESS_BOOK;

    default:
      return state;
  }
}

/**
 * Which saved address a delivery screen should start on.
 *
 * This is the rule Checkout already applied inline — the address carried in the
 * order context wins, then the customer's default, then the first saved row —
 * lifted out so the order-type gate and Checkout cannot drift apart, and so it
 * can be tested. Rows with unusable coordinates are skipped: a 0/0 address
 * would drop the map pin in the Atlantic.
 */
export function preselectAddress(
  addresses: SavedAddress[],
  preferredId: string | null | undefined,
): SavedAddress | null {
  const usable = addresses.filter(
    (a) => Number.isFinite(a.lat) && Number.isFinite(a.lng) && !(a.lat === 0 && a.lng === 0),
  );
  const preferred = preferredId ? usable.find((a) => a.id === preferredId) : undefined;
  return preferred ?? usable.find((a) => a.isDefault) ?? usable[0] ?? null;
}

/**
 * True when a change to `changedId` invalidates the customer's current ordering
 * decision.
 *
 * The order context caches a COPY of the delivery address (id, coordinates,
 * landmark). Editing the address behind it would leave Checkout seeding the old
 * landmark — and then writing it back over the new one when it reconciles at
 * place-order time. Deleting it leaves a dangling id that `place_order` will
 * reject. Both are repaired the same way: drop the context so the blocking gate
 * re-resolves branch and zone from the address as it now stands.
 *
 * A pickup context is never affected — it carries no address.
 */
export function contextNeedsReset(
  context: { orderType: string; addressId: string | null } | null | undefined,
  changedId: string,
): boolean {
  if (!context) return false;
  if (context.orderType !== 'delivery') return false;
  return context.addressId === changedId;
}

/**
 * True when an edit actually staled the copy the order context is holding.
 *
 * `contextNeedsReset` answers "is this the address I am ordering to"; this
 * answers "did anything the context CACHED change". The context caches branch,
 * addressId, coordinates and the landmark — not the label and not `isDefault`.
 * Without this second question, promoting the address you are currently
 * ordering to from the editor threw the customer back through the blocking
 * order-type gate, while the identical promotion from the list did nothing at
 * all. One action, two outcomes, neither of them necessary.
 */
export function patchStalesOrderContext(patch: {
  latitude?: unknown;
  longitude?: unknown;
  description?: unknown;
}): boolean {
  return patch.latitude !== undefined
    || patch.longitude !== undefined
    || patch.description !== undefined;
}

/**
 * Backoff for a failed address-book load, in milliseconds; `null` ends the
 * schedule.
 *
 * The book is fetched ONCE per signed-in session — the provider lives at the
 * app root and never remounts — so without this a single failed `listMine()` on
 * a flaky cold start left the customer with no saved addresses for the rest of
 * the process. They would then re-drop a pin at an address they had already
 * saved, creating a duplicate. Per-screen fetches used to self-heal on remount;
 * a shared book has to heal itself.
 *
 * Same shape and reasoning as `profileRetryDelayMs` in profileCache.ts: short,
 * bounded, and finished rather than infinite — a customer who is genuinely
 * offline should not have a request loop running behind the app.
 */
export const ADDRESS_RETRY_DELAYS_MS = [1_000, 3_000, 8_000] as const;

export function addressRetryDelayMs(attempt: number): number | null {
  if (attempt < 1) return null;
  return ADDRESS_RETRY_DELAYS_MS[attempt - 1] ?? null;
}

/** The address a screen is editing, or null when the id is unknown/new. */
export function findAddress(
  addresses: SavedAddress[],
  id: string | null | undefined,
): SavedAddress | null {
  if (!id || id === NEW_ADDRESS) return null;
  return addresses.find((a) => a.id === id) ?? null;
}

/**
 * Whether a newly created address should become the default.
 *
 * The first address a customer saves is their default — otherwise a book with
 * exactly one address shows no default at all and Checkout falls through to
 * "first row" by accident rather than by decision. This matches what the
 * order-type gate already did when it created an address inline.
 */
export function shouldBecomeDefault(existing: SavedAddress[]): boolean {
  return existing.length === 0;
}
