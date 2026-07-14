/**
 * OrderContextProvider — the single source of truth for the customer's ordering
 * decision (pickup/delivery + the branch/address it resolves to). Persisted to
 * AsyncStorage so a relaunch keeps a still-valid choice, but re-validated against
 * the freshly-loaded catalog on every render so a branch that has closed or a
 * zone that changed can never leave a silently-invalid context in place.
 *
 * It is the ONLY writer of the catalog's mirrored `selectedBranch` — the menu,
 * product, cart and checkout screens keep reading `useCatalog().selectedBranch`
 * unchanged, while order_type/address come from `useOrderContext()`. One writer,
 * so the two can never drift.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useCatalog } from './CatalogProvider';
import {
  isOrderContextValid, makeDeliveryContext, makePickupContext, type OrderContext,
} from '../features/order/orderContext';
import { ORDER_CONTEXT_STORAGE_KEY as ORDER_CTX_KEY } from '../lib/storageKeys';
import type { Branch } from '../types/models';

interface DeliverySelection {
  branch: Branch;
  addressId: string | null;
  lat: number;
  lng: number;
  description?: string | null;
}

interface OrderContextValue {
  context: OrderContext | null;
  /** True once the persisted context has been read (avoids gating before hydration). */
  ready: boolean;
  /** Valid against the currently-loaded catalog (false while the catalog loads). */
  valid: boolean;
  setPickup: (branch: Branch) => void;
  setDelivery: (opts: DeliverySelection) => void;
  clear: () => void;
}

const Ctx = createContext<OrderContextValue | null>(null);

export function OrderContextProvider({ children }: { children: React.ReactNode }) {
  const { branches, deliveryZones, loading, setSelectedBranch } = useCatalog();
  const [context, setContext] = useState<OrderContext | null>(null);
  const [ready, setReady] = useState(false);

  // Hydrate once from storage.
  useEffect(() => {
    AsyncStorage.getItem(ORDER_CTX_KEY)
      .then((raw) => {
        if (raw) { try { setContext(JSON.parse(raw) as OrderContext); } catch { /* ignore corrupt */ } }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  // Persist whenever the context changes (after hydration).
  useEffect(() => {
    if (!ready) return;
    if (context) AsyncStorage.setItem(ORDER_CTX_KEY, JSON.stringify(context)).catch(() => {});
    else AsyncStorage.removeItem(ORDER_CTX_KEY).catch(() => {});
  }, [context, ready]);

  const valid = useMemo(
    () => !loading && isOrderContextValid(context, branches, deliveryZones),
    [loading, context, branches, deliveryZones],
  );

  // Mirror the context's branch into the catalog for the menu/product/checkout
  // screens. Only mirror a branch that still exists; otherwise clear it (the gate
  // sends the customer back to selection).
  useEffect(() => {
    if (!ready) return;
    const id = context?.branchId ?? null;
    setSelectedBranch(id && branches.some((b) => b.id === id) ? id : null);
  }, [ready, context, branches, setSelectedBranch]);

  const setPickup = useCallback((branch: Branch) => {
    setContext(makePickupContext(branch, Date.now()));
    setSelectedBranch(branch.id);
  }, [setSelectedBranch]);

  const setDelivery = useCallback((opts: DeliverySelection) => {
    setContext(makeDeliveryContext(
      opts.branch,
      { addressId: opts.addressId, lat: opts.lat, lng: opts.lng, description: opts.description ?? null },
      Date.now(),
    ));
    setSelectedBranch(opts.branch.id);
  }, [setSelectedBranch]);

  const clear = useCallback(() => {
    setContext(null);
    setSelectedBranch(null);
  }, [setSelectedBranch]);

  const value = useMemo<OrderContextValue>(
    () => ({ context, ready, valid, setPickup, setDelivery, clear }),
    [context, ready, valid, setPickup, setDelivery, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrderContext(): OrderContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useOrderContext must be used within OrderContextProvider');
  return ctx;
}
