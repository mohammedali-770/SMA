/**
 * AddressProvider — ONE address book, shared by every screen that reads or
 * writes a delivery address.
 *
 * Before this, Checkout and the order-type gate each fetched `addresses.listMine()`
 * once on mount into their own local state. Expo Router keeps stack screens
 * mounted, so nothing that happened elsewhere could reach them: an address edited
 * in Profile stayed stale in a mounted Checkout until the app restarted, and a
 * deleted one stayed selectable. With Profile owning full CRUD that stops being a
 * curiosity and becomes an order sent to an address that no longer exists.
 *
 * The transitions are in the pure reducer (store/addressBook.ts) — this component
 * is only the fetch, the session lifecycle and the write wrappers. Every write
 * goes through here so a caller cannot mutate the server without the book
 * hearing about it.
 *
 * The write path is unchanged: `addresses.create` / `update` / `remove` /
 * `setDefault` are the same RLS-scoped calls, and `place_order` remains the
 * authority on whether an address is actually serviceable.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from './AuthProvider';
import {
  addressRetryDelayMs, applyAddressEvent, EMPTY_ADDRESS_BOOK, NEW_ADDRESS,
  type AddressBookState, type AddressBookStatus,
} from './addressBook';
import { addressErrorCopy, addressErrorMessage, type AddressInput } from '../services/addressPayload';
import { useI18n } from '../i18n/I18nProvider';
import { mapAddress } from '../lib/mappers';
import { addresses as addressApi } from '../services/api';
import type { SavedAddress } from '../types/models';

export interface AddressBookValue {
  addresses: SavedAddress[];
  status: AddressBookStatus;
  /** Customer-facing text for the last failure, or null. */
  error: string | null;
  /** Id of the row being written, `'new'` while creating, or null. */
  pending: string | null;
  /** Re-read the book from the server (pull-to-refresh / retry). */
  reload: () => Promise<void>;
  /** Dismiss the current error without retrying. */
  clearError: () => void;
  create: (input: AddressInput) => Promise<SavedAddress>;
  update: (id: string, patch: Partial<AddressInput>) => Promise<SavedAddress>;
  remove: (id: string) => Promise<void>;
  setDefault: (id: string) => Promise<SavedAddress>;
}

/**
 * Exported ONLY for the dev fixture provider (src/dev/FixtureProvider.tsx).
 * Production code uses `useAddressBook()`.
 */
export const AddressBookContext = createContext<AddressBookValue | null>(null);

export function AddressProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus, userId } = useAuth();
  const { lang } = useI18n();
  const [state, setState] = useState<AddressBookState>(EMPTY_ADDRESS_BOOK);
  const mounted = useRef(true);

  // Epoch counter: a request started for one user must not land after a sign-out
  // or a user switch and repopulate the book with the previous customer's
  // addresses. Bumped on sign-out and on every new load cycle, and checked by
  // BOTH the loader and the write wrappers before they touch state.
  const loadSeq = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRetry = useCallback(() => {
    if (retryTimer.current !== null) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);

  // `lang` is read inside callbacks that must not be rebuilt on every render;
  // a ref keeps the latest value without making every consumer re-render when
  // the language changes.
  const langRef = useRef(lang);
  langRef.current = lang;

  const dispatch = useCallback((event: Parameters<typeof applyAddressEvent>[1]) => {
    if (!mounted.current) return;
    setState((prev) => applyAddressEvent(prev, event));
  }, []);

  /**
   * One load cycle. The first attempt is awaited; a transient failure keeps the
   * last known list and retries on a short bounded schedule in the background.
   *
   * The retry is not belt-and-braces. This provider is mounted at the app root
   * and never remounts, so the book is fetched once per signed-in session —
   * without a retry, one failed `listMine()` on a flaky cold start left the
   * customer with no saved addresses for the whole process, and they would
   * re-drop a pin at an address they had already saved. The per-screen fetches
   * this replaced used to self-heal on remount; a shared book must heal itself.
   */
  const load = useCallback(async () => {
    clearRetry();
    const seq = ++loadSeq.current;
    const attempt = async (n: number): Promise<void> => {
      if (!mounted.current || seq !== loadSeq.current) return;
      dispatch({ type: 'load_start' });
      try {
        const rows = await addressApi.listMine();
        if (!mounted.current || seq !== loadSeq.current) return;
        dispatch({ type: 'load_success', addresses: rows.map(mapAddress) });
      } catch {
        if (!mounted.current || seq !== loadSeq.current) return;
        // A failed refresh keeps the last known list (see the reducer) so a bad
        // request cannot send a customer with saved addresses back to the gate.
        dispatch({ type: 'load_failure', message: addressErrorCopy[langRef.current].loadFailed });
        const delay = addressRetryDelayMs(n);
        if (delay !== null) {
          retryTimer.current = setTimeout(() => { void attempt(n + 1); }, delay);
        }
        // Schedule exhausted → stop. The Saved-addresses screen offers an
        // explicit retry, and the next sign-in starts a fresh cycle.
      }
    };
    await attempt(1);
  }, [clearRetry, dispatch]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearRetry(); };
  }, [clearRetry]);

  // Load on sign-in, clear on sign-out, reload on a user switch. Keyed on
  // `userId` so a token refresh for the same customer does not refetch.
  useEffect(() => {
    if (authStatus === 'loading') return;
    if (authStatus === 'signed_out' || !userId) {
      loadSeq.current += 1; // cancel any in-flight load OR write
      clearRetry();
      dispatch({ type: 'signed_out' });
      return;
    }
    void load();
  }, [authStatus, userId, load, dispatch, clearRetry]);

  /**
   * Run one write, keeping the book and the error state in step.
   *
   * EPOCH-GUARDED like `load`. Without this, a write issued just before sign-out
   * could resolve afterwards and dispatch `upserted` into the cleared book —
   * putting the previous customer's address (their home, with its landmark)
   * back on screen for the next account to see on a shared phone. The write
   * itself is always safe (RLS scopes it and `create` stamps `customer_id` from
   * the live session); it is the local state that must not be resurrected.
   *
   * `apply` runs only while the epoch still holds. Failures re-throw so the
   * calling screen stays on its form rather than navigating away from a save
   * that did not happen.
   */
  const mutate = useCallback(async <T,>(
    id: string,
    run: () => Promise<T>,
    apply: (result: T) => void,
  ): Promise<T> => {
    const seq = loadSeq.current;
    dispatch({ type: 'mutation_start', id });
    try {
      const result = await run();
      if (mounted.current && seq === loadSeq.current) apply(result);
      return result;
    } catch (err) {
      if (mounted.current && seq === loadSeq.current) {
        dispatch({ type: 'mutation_failure', message: addressErrorMessage(err, langRef.current) });
      }
      throw err;
    }
  }, [dispatch]);

  const create = useCallback(async (input: AddressInput): Promise<SavedAddress> => {
    return mutate(
      NEW_ADDRESS,
      async () => mapAddress(await addressApi.create(input)),
      (address) => dispatch({ type: 'upserted', address }),
    );
  }, [mutate, dispatch]);

  const update = useCallback(async (id: string, patch: Partial<AddressInput>): Promise<SavedAddress> => {
    return mutate(
      id,
      async () => mapAddress(await addressApi.update(id, patch)),
      (address) => dispatch({ type: 'upserted', address }),
    );
  }, [mutate, dispatch]);

  const remove = useCallback(async (id: string): Promise<void> => {
    await mutate(
      id,
      async () => { await addressApi.remove(id); },
      () => dispatch({ type: 'removed', id }),
    );
  }, [mutate, dispatch]);

  const setDefault = useCallback(async (id: string): Promise<SavedAddress> => {
    return mutate(
      id,
      // The database clears the previous default; the reducer mirrors that
      // locally so the list never shows two "Default" badges while the write
      // settles.
      async () => mapAddress(await addressApi.setDefault(id)),
      (address) => dispatch({ type: 'upserted', address }),
    );
  }, [mutate, dispatch]);

  const clearError = useCallback(() => dispatch({ type: 'error_cleared' }), [dispatch]);

  const value = useMemo<AddressBookValue>(() => ({
    addresses: state.addresses,
    status: state.status,
    error: state.error,
    pending: state.pending,
    reload: load,
    clearError,
    create,
    update,
    remove,
    setDefault,
  }), [state, load, clearError, create, update, remove, setDefault]);

  return <AddressBookContext.Provider value={value}>{children}</AddressBookContext.Provider>;
}

export function useAddressBook(): AddressBookValue {
  const ctx = useContext(AddressBookContext);
  if (!ctx) throw new Error('useAddressBook must be used within AddressProvider');
  return ctx;
}
