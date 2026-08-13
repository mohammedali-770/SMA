/** Session-only order type + branch/address context. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useCatalog } from './CatalogProvider';
import { isOrderContextValid, makeDeliveryContext, makePickupContext, type OrderContext } from '../features/order/orderContext';
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
