/** Persisted customer cart. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CART_STORAGE_KEY as CART_KEY } from '../lib/storageKeys';
import { computeUnitPrice, makeCartItemId, cartSubtotal } from '../utils/format';
import { uuidv4 } from '../utils/uuid';
import type { CartItem, Modifier, Product } from '../types/models';

export interface CartValue {
  items: CartItem[]; count: number; subtotal: number; idempotencyKey: string;
  addItem: (product: Product, selected: { [groupId: string]: Modifier[] }, quantity: number) => void;
  updateItem: (cartItemId: string, product: Product, selected: { [groupId: string]: Modifier[] }, quantity: number) => void;
  incrementLine: (cartItemId: string) => void; decrementLine: (cartItemId: string) => void;
  removeLine: (cartItemId: string) => void; clear: () => void;
  toOrderItems: () => { product_id: string; quantity: number; modifier_ids?: string[] }[];
}
export const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => uuidv4());
  const hydrated = useRef(false);
  useEffect(() => {
    AsyncStorage.getItem(CART_KEY).then((raw) => { if (raw) { try { setItems(JSON.parse(raw) as CartItem[]); } catch {} } }).catch(() => {}).finally(() => { hydrated.current = true; });
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(CART_KEY, JSON.stringify(items)).catch(() => {});
    setIdempotencyKey(uuidv4());
  }, [items]);

  const addItem = useCallback((product: Product, selected: { [groupId: string]: Modifier[] }, quantity: number) => {
    const cartItemId = makeCartItemId(product.id, selected); const unitPrice = computeUnitPrice(product, selected);
    setItems((prev) => {
      const existing = prev.find((it) => it.cartItemId === cartItemId);
      return existing ? prev.map((it) => it.cartItemId === cartItemId ? { ...it, quantity: it.quantity + quantity } : it)
        : [...prev, { cartItemId, product, selectedModifiers: selected, quantity, unitPrice }];
    });
  }, []);

  const updateItem = useCallback((oldId: string, product: Product, selected: { [groupId: string]: Modifier[] }, quantity: number) => {
    if (quantity <= 0) { setItems((prev) => prev.filter((it) => it.cartItemId !== oldId)); return; }
    const newId = makeCartItemId(product.id, selected); const unitPrice = computeUnitPrice(product, selected);
    setItems((prev) => {
      if (!prev.some((it) => it.cartItemId === oldId)) return prev;
      if (newId !== oldId && prev.some((it) => it.cartItemId === newId)) {
        return prev.filter((it) => it.cartItemId !== oldId).map((it) => it.cartItemId === newId ? { ...it, quantity: it.quantity + quantity } : it);
      }
      return prev.map((it) => it.cartItemId === oldId ? { cartItemId: newId, product, selectedModifiers: selected, quantity, unitPrice } : it);
    });
  }, []);

  const incrementLine = useCallback((id: string) => setItems((p) => p.map((it) => it.cartItemId === id ? { ...it, quantity: it.quantity + 1 } : it)), []);
  const decrementLine = useCallback((id: string) => setItems((p) => p.flatMap((it) => it.cartItemId !== id ? [it] : it.quantity - 1 <= 0 ? [] : [{ ...it, quantity: it.quantity - 1 }])), []);
  const removeLine = useCallback((id: string) => setItems((p) => p.filter((it) => it.cartItemId !== id)), []);
  const clear = useCallback(() => setItems([]), []);
  const toOrderItems = useCallback(() => items.map((it) => ({ product_id: it.product.id, quantity: it.quantity, modifier_ids: Object.values(it.selectedModifiers).flat().map((m) => m.id) })), [items]);
  const count = useMemo(() => items.reduce((n, it) => n + it.quantity, 0), [items]);
  const subtotal = useMemo(() => cartSubtotal(items), [items]);
  const value = useMemo<CartValue>(() => ({ items, count, subtotal, idempotencyKey, addItem, updateItem, incrementLine, decrementLine, removeLine, clear, toOrderItems }), [items, count, subtotal, idempotencyKey, addItem, updateItem, incrementLine, decrementLine, removeLine, clear, toOrderItems]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
export function useCart(): CartValue { const ctx = useContext(CartContext); if (!ctx) throw new Error('useCart must be used within CartProvider'); return ctx; }
