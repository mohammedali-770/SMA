/** Persisted customer cart. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CART_STORAGE_KEY as CART_KEY } from '../lib/storageKeys';
import { noteCartAdd } from '../features/cart/suggestionStore';
import { computeUnitPrice, makeCartItemId, cartSubtotal } from '../utils/format';
import { uuidv4 } from '../utils/uuid';
import type { CartItem, Modifier, Product, ProductVariant } from '../types/models';

export interface CartValue {
  items: CartItem[]; count: number; subtotal: number; idempotencyKey: string;
  addItem: (product: Product, selected: { [groupId: string]: Modifier[] }, quantity: number, note?: string | null, variant?: ProductVariant | null) => void;
  updateItem: (cartItemId: string, product: Product, selected: { [groupId: string]: Modifier[] }, quantity: number, note?: string | null, variant?: ProductVariant | null) => void;
  incrementLine: (cartItemId: string) => void; decrementLine: (cartItemId: string) => void;
  removeLine: (cartItemId: string) => void; clear: () => void;
  toOrderItems: () => { product_id: string; quantity: number; variant_id?: string; modifier_ids?: string[]; note?: string }[];
}
export const CartContext = createContext<CartValue | null>(null);

/**
 * The tier a bare Add uses when the customer was never asked to choose.
 *
 * Deliberately NOT `variants[0]`. Variants arrive in Lazywait `sort_order`,
 * while `products.price` — the "from" price the menu card advertises — is
 * independently the CHEAPEST tier. Taking the first row therefore charges
 * whatever tier the POS happened to list first: for Coral the card reads 20.00
 * and the first row is 29.00, so a one-tap Add silently charged 9.00 more than
 * the card showed. Selecting by price keeps what the customer is charged equal
 * to what they were shown.
 *
 * This is the floor, not the finished behaviour: a multi-tier product should
 * arguably open a picker instead of assuming a tier at all. That is a product
 * decision (see the PR body); this function makes the assumed tier honest under
 * either answer.
 */
export function cheapestVariant(variants: ProductVariant[]): ProductVariant | null {
  let best: ProductVariant | null = null;
  for (const v of variants) {
    if (!best || v.price < best.price) best = v;
  }
  return best;
}

/**
 * Persisted cart schema version, stored INSIDE the payload.
 *
 * The version is not a key suffix because `storageKeys.ts` forbids changing a
 * key's value outright, and `SUGGESTIONS_STORAGE_KEY` sets the same precedent.
 *
 * v1 persisted a bare `CartItem[]` and predates tiers, so its rows carry no
 * `variant`. Hydrating one would omit `variant_id` from `toOrderItems`, and
 * `place_order` rejects a product that has active tiers but no chosen tier — so
 * the customer would be unable to check out at all, with nothing on screen
 * explaining why. A v1 payload is therefore DROPPED rather than half-migrated:
 * a cart that cannot be ordered is worse than an empty one, and the rows cannot
 * be repaired here anyway (CartProvider holds no catalog to resolve tiers from).
 */
export const CART_SCHEMA_VERSION = 2;

/** Read a persisted cart, discarding anything not written by this version. */
export function parsePersistedCart(raw: string): CartItem[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  // v1: a bare array, written before tiers existed.
  if (Array.isArray(parsed)) return [];
  if (!parsed || typeof parsed !== 'object') return [];
  const env = parsed as { v?: unknown; items?: unknown };
  if (env.v !== CART_SCHEMA_VERSION || !Array.isArray(env.items)) return [];
  return env.items as CartItem[];
}

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
    AsyncStorage.getItem(CART_KEY).then((raw) => { if (raw) setItems(parsePersistedCart(raw)); }).catch(() => {}).finally(() => { hydrated.current = true; });
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(CART_KEY, JSON.stringify({ v: CART_SCHEMA_VERSION, items })).catch(() => {});
    setIdempotencyKey(uuidv4());
  }, [items]);

  const addItem = useCallback((product: Product, selected: { [groupId: string]: Modifier[] }, quantity: number, note?: string | null, variant?: ProductVariant | null) => {
    // Every add in the app funnels through here — menu one-tap, product page and
    // the cart suggestion strip — so this is the one place the on-device
    // suggestion model can learn from. Fire-and-forget and fully swallowed: it
    // cannot alter cart state, throw, or change timing.
    noteCartAdd(product, itemsRef.current);
    // The note is part of the id, so two portions of the same dish with
    // different instructions stay two lines instead of merging and losing one.
    const trimmedNote = (note ?? '').trim() || undefined;
    // A product with tiers and none chosen would be refused by place_order, so
    // default to the CHEAPEST tier — the one the menu card advertises — rather
    // than building a line the server will reject, or charging a tier the
    // customer never saw. See cheapestVariant.
    const tier = variant ?? cheapestVariant(product.variants);
    const cartItemId = makeCartItemId(product.id, selected, trimmedNote, tier?.id);
    const unitPrice = computeUnitPrice(product, selected, tier);
    setItems((prev) => {
      const existing = prev.find((it) => it.cartItemId === cartItemId);
      return existing ? prev.map((it) => it.cartItemId === cartItemId ? { ...it, quantity: it.quantity + quantity } : it)
        : [...prev, { cartItemId, product, variant: tier ?? undefined, selectedModifiers: selected, quantity, unitPrice, note: trimmedNote }];
    });
  }, []);

  const updateItem = useCallback((oldId: string, product: Product, selected: { [groupId: string]: Modifier[] }, quantity: number, note?: string | null, variant?: ProductVariant | null) => {
    if (quantity <= 0) { setItems((prev) => prev.filter((it) => it.cartItemId !== oldId)); return; }
    const trimmedNote = (note ?? '').trim() || undefined;
    const tier = variant ?? cheapestVariant(product.variants);
    const newId = makeCartItemId(product.id, selected, trimmedNote, tier?.id);
    const unitPrice = computeUnitPrice(product, selected, tier);
    setItems((prev) => {
      if (!prev.some((it) => it.cartItemId === oldId)) return prev;
      if (newId !== oldId && prev.some((it) => it.cartItemId === newId)) {
        return prev.filter((it) => it.cartItemId !== oldId).map((it) => it.cartItemId === newId ? { ...it, quantity: it.quantity + quantity } : it);
      }
      return prev.map((it) => it.cartItemId === oldId ? { cartItemId: newId, product, variant: tier ?? undefined, selectedModifiers: selected, quantity, unitPrice, note: trimmedNote } : it);
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
    // Omitted, not null, when the product has no tiers — same convention as the
    // note, and place_order reads it with `->> 'variant_id'`.
    ...(it.variant ? { variant_id: it.variant.id } : {}),
    modifier_ids: Object.values(it.selectedModifiers).flat().map((m) => m.id),
    ...(it.note ? { note: it.note } : {}),
  })), [items]);
  const count = useMemo(() => items.reduce((n, it) => n + it.quantity, 0), [items]);
  const subtotal = useMemo(() => cartSubtotal(items), [items]);
  const value = useMemo<CartValue>(() => ({ items, count, subtotal, idempotencyKey, addItem, updateItem, incrementLine, decrementLine, removeLine, clear, toOrderItems }), [items, count, subtotal, idempotencyKey, addItem, updateItem, incrementLine, decrementLine, removeLine, clear, toOrderItems]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
export function useCart(): CartValue { const ctx = useContext(CartContext); if (!ctx) throw new Error('useCart must be used within CartProvider'); return ctx; }
