/**
 * Cart state (persisted to AsyncStorage) + the place_order idempotency key.
 *
 * The cart is a client convenience only — every price shown here is a preview.
 * On checkout, place_order recomputes all amounts server-side from product ids
 * and modifier ids, so the client can never set its own totals.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { computeUnitPrice, makeCartItemId, cartSubtotal } from '../utils/format';
import { uuidv4 } from '../utils/uuid';
import type { CartItem, Modifier, Product } from '../types/models';

const CART_KEY = 'spicymeal.cart';

interface CartValue {
  items: CartItem[];
  count: number;
  subtotal: number;
  /** Retry-safe key for place_order; stable until the cart changes or is cleared. */
  idempotencyKey: string;
  addItem: (product: Product, selected: { [groupId: string]: Modifier[] }, quantity: number) => void;
  incrementLine: (cartItemId: string) => void;
  decrementLine: (cartItemId: string) => void;
  removeLine: (cartItemId: string) => void;
  clear: () => void;
  /** RPC payload: product ids + chosen modifier ids (no prices — server computes). */
  toOrderItems: () => { product_id: string; quantity: number; modifier_ids?: string[] }[];
}

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => uuidv4());
  const hydrated = useRef(false);

  // Restore a persisted cart on first mount.
  useEffect(() => {
    AsyncStorage.getItem(CART_KEY)
      .then((raw) => {
        if (raw) {
          try { setItems(JSON.parse(raw) as CartItem[]); } catch { /* ignore corrupt */ }
        }
      })
      .catch(() => {})
      .finally(() => { hydrated.current = true; });
  }, []);

  // Persist + rotate the idempotency key whenever the cart contents change. A
  // changed cart is a different order, so it must not reuse a prior key.
  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(CART_KEY, JSON.stringify(items)).catch(() => {});
    setIdempotencyKey(uuidv4());
  }, [items]);

  const addItem = useCallback(
    (product: Product, selected: { [groupId: string]: Modifier[] }, quantity: number) => {
      const cartItemId = makeCartItemId(product.id, selected);
      const unitPrice = computeUnitPrice(product, selected);
      setItems((prev) => {
        const existing = prev.find((it) => it.cartItemId === cartItemId);
        if (existing) {
          return prev.map((it) =>
            it.cartItemId === cartItemId ? { ...it, quantity: it.quantity + quantity } : it,
          );
        }
        return [...prev, { cartItemId, product, selectedModifiers: selected, quantity, unitPrice }];
      });
    },
    [],
  );

  const incrementLine = useCallback((id: string) => {
    setItems((prev) => prev.map((it) => (it.cartItemId === id ? { ...it, quantity: it.quantity + 1 } : it)));
  }, []);

  const decrementLine = useCallback((id: string) => {
    setItems((prev) =>
      prev.flatMap((it) => {
        if (it.cartItemId !== id) return [it];
        const q = it.quantity - 1;
        return q <= 0 ? [] : [{ ...it, quantity: q }];
      }),
    );
  }, []);

  const removeLine = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.cartItemId !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const toOrderItems = useCallback(
    () => items.map((it) => ({
      product_id: it.product.id,
      quantity: it.quantity,
      modifier_ids: Object.values(it.selectedModifiers).flat().map((m) => m.id),
    })),
    [items],
  );

  const count = useMemo(() => items.reduce((n, it) => n + it.quantity, 0), [items]);
  const subtotal = useMemo(() => cartSubtotal(items), [items]);

  const value = useMemo<CartValue>(() => ({
    items, count, subtotal, idempotencyKey,
    addItem, incrementLine, decrementLine, removeLine, clear, toOrderItems,
  }), [items, count, subtotal, idempotencyKey, addItem, incrementLine, decrementLine, removeLine, clear, toOrderItems]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
