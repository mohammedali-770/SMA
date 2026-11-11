/** Session-only order type + branch/address context. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthProvider';
import { useCatalog } from './CatalogProvider';
import {
  isOrderContextValid, makeDeliveryContext, makePickupContext, shouldResetOnUserChange, type OrderContext,
} from '../features/order/orderContext';
import type { Branch } from '../types/models';

interface DeliverySelection { branch: Branch; addressId: string | null; lat: number; lng: number; description?: string | null; }
export interface OrderContextValue {
  context: OrderContext | null; ready: boolean; valid: boolean;
  setPickup: (branch: Branch) => void; setDelivery: (opts: DeliverySelection) => void; clear: () => void;
}
export const OrderCtx = createContext<OrderContextValue | null>(null);
const Ctx = OrderCtx;

export function OrderContextProvider({ children }: { children: React.ReactNode }) {
  const { branches, deliveryZones, loading, setSelectedBranch } = useCatalog();
  const [context, setContext] = useState<OrderContext | null>(null);
  const ready = true;
  const valid = useMemo(() => !loading && isOrderContextValid(context, branches, deliveryZones), [loading, context, branches, deliveryZones]);

  // A delivery context holds one customer's saved address: drop it when the
  // signed-in customer changes, including on sign-out. Pickup survives, so a
  // guest's branch choice carries through signing in at checkout.
  const { userId } = useAuth();
  const lastUserId = useRef(userId);
  useEffect(() => {
    const prev = lastUserId.current;
    lastUserId.current = userId;
    setContext((c) => (shouldResetOnUserChange(prev, userId, c) ? null : c));
  }, [userId]);

  useEffect(() => {
    const id = context?.branchId ?? null;
    setSelectedBranch(id && branches.some((b) => b.id === id) ? id : null);
  }, [context, branches, setSelectedBranch]);

  const setPickup = useCallback((branch: Branch) => { setContext(makePickupContext(branch, Date.now())); setSelectedBranch(branch.id); }, [setSelectedBranch]);
  const setDelivery = useCallback((opts: DeliverySelection) => {
    setContext(makeDeliveryContext(opts.branch, { addressId: opts.addressId, lat: opts.lat, lng: opts.lng, description: opts.description ?? null }, Date.now()));
    setSelectedBranch(opts.branch.id);
  }, [setSelectedBranch]);
  const clear = useCallback(() => { setContext(null); setSelectedBranch(null); }, [setSelectedBranch]);
  const value = useMemo<OrderContextValue>(() => ({ context, ready, valid, setPickup, setDelivery, clear }), [context, valid, setPickup, setDelivery, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useOrderContext(): OrderContextValue { const ctx = useContext(Ctx); if (!ctx) throw new Error('useOrderContext must be used within OrderContextProvider'); return ctx; }
