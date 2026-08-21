/** Persisted customer cart. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CART_STORAGE_KEY as CART_KEY } from '../lib/storageKeys';
import { noteCartAdd } from '../features/cart/suggestionStore';
import { computeUnitPrice, makeCartItemId, cartSubtotal } from '../utils/format';
import { uuidv4 } from '../utils/uuid';
import type { CartItem, Modifier, Product } from '../types/models';

export interface CartValue {
  items: CartItem[]; count: number; subtotal: number; idempotencyKey: string;
  addItem: (product: Product, selected: { [groupId: string]: Modifier[] }, quantity: number, note?: string | null) => void;
  updateItem: (cartItemId: string, product: Product, selected: { [groupId: string]: Modifier[] }, quantity: number, note?: string | null) => void;
  incrementLine: (cartItemId: string) => void; decrementLine: (cartItemId: string) => void;
  removeLine: (cartItemId: string) => void; clear: () => void;
  toOrderItems: () => { product_id: string; quantity: number; modifier_ids?: string[]; note?: string }[];
}
export const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => uuidv4());
  const hydrated = useRef(false);
  // The pre-add basket for the suggestion model. It cannot be read from the
  // `setItems` updater (updaters must be pure, and StrictMode double-invokes
  // them, which would double-count every add) nor from the closure (stale).
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => {
    AsyncStorage.getItem(CART_KEY).then((raw) => { if (raw) { try { setItems(JSON.parse(raw) as CartItem[]); } catch {} } }).catch(() => {}).finally(() => { hydrated.current = true; });
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(CART_KEY, JSON.stringify(items)).catch(() => {});
    setIdempotencyKey(uuidv4());
  }, [items]);

  const addItem = useCallback((product: Product, selected: { [groupId: string]: Modifier[] }, quantity: number, note?: string | null) => {
    // Every add in the app funnels through here — menu one-tap, product page and
    // the cart suggestion strip — so this is the one place the on-device
    // suggestion model can learn from. Fire-and-forget and fully swallowed: it
    // cannot alter cart state, throw, or change timing.
    noteCartAdd(product, itemsRef.current);
    // The note is part of the id, so two portions of the same dish with
    // different instructions stay two lines instead of merging and losing one.
    const trimmedNote = (note ?? '').trim() || undefined;
    const cartItemId = makeCartItemId(product.id, selected, trimmedNote); const unitPrice = computeUnitPrice(product, selected);
    setItems((prev) => {
      const existing = prev.find((it) => it.cartItemId === cartItemId);
      return existing ? prev.map((it) => it.cartItemId === cartItemId ? { ...it, quantity: it.quantity + quantity } : it)
        : [...prev, { cartItemId, product, selectedModifiers: selected, quantity, unitPrice, note: trimmedNote }];
    });
  }, []);

  const updateItem = useCallback((oldId: string, product: Product, selected: { [groupId: string]: Modifier[] }, quantity: number, note?: string | null) => {
    if (quantity <= 0) { setItems((prev) => prev.filter((it) => it.cartItemId !== oldId)); return; }
    const trimmedNote = (note ?? '').trim() || undefined;
    const newId = makeCartItemId(product.id, selected, trimmedNote); const unitPrice = computeUnitPrice(product, selected);
    setItems((prev) => {
      if (!prev.some((it) => it.cartItemId === oldId)) return prev;
      if (newId !== oldId && prev.some((it) => it.cartItemId === newId)) {
        return prev.filter((it) => it.cartItemId !== oldId).map((it) => it.cartItemId === newId ? { ...it, quantity: it.quantity + quantity } : it);
      }
      return prev.map((it) => it.cartItemId === oldId ? { cartItemId: newId, product, selectedModifiers: selected, quantity, unitPrice, note: trimmedNote } : it);
    });
  }, []);

  const incrementLine = useCallback((id: string) => setItems((p) => p.map((it) => it.cartItemId === id ? { ...it, quantity: it.quantity + 1 } : it)), []);
  const decrementLine = useCallback((id: string) => setItems((p) => p.flatMap((it) => it.cartItemId !== id ? [it] : it.quantity - 1 <= 0 ? [] : [{ ...it, quantity: it.quantity - 1 }])), []);
  const removeLine = useCallback((id: string) => setItems((p) => p.filter((it) => it.cartItemId !== id)), []);
  const clear = useCallback(() => setItems([]), []);
  // `note` is omitted rather than sent as null when there is none: place_order
  // reads it with `->> 'note'`, and an absent key and a JSON null both normalize
  // to NULL server-side, but omitting keeps the submitted body honest.
  const toOrderItems = useCallback(() => items.map((it) => ({
    product_id: it.product.id,
    quantity: it.quantity,
    modifier_ids: Object.values(it.selectedModifiers).flat().map((m) => m.id),
    ...(it.note ? { note: it.note } : {}),
  })), [items]);
  const count = useMemo(() => items.reduce((n, it) => n + it.quantity, 0), [items]);
  const subtotal = useMemo(() => cartSubtotal(items), [items]);
  const value = useMemo<CartValue>(() => ({ items, count, subtotal, idempotencyKey, addItem, updateItem, incrementLine, decrementLine, removeLine, clear, toOrderItems }), [items, count, subtotal, idempotencyKey, addItem, updateItem, incrementLine, decrementLine, removeLine, clear, toOrderItems]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
export function useCart(): CartValue { const ctx = useContext(CartContext); if (!ctx) throw new Error('useCart must be used within CartProvider'); return ctx; }
