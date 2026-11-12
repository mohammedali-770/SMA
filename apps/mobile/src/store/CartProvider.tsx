/** Persisted customer cart. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CART_STORAGE_KEY as CART_KEY } from '../lib/storageKeys';
import { noteCartAdd } from '../features/cart/suggestionStore';
import { computeUnitPrice, makeCartItemId, cartSubtotal } from '../utils/format';
import { uuidv4 } from '../utils/uuid';
import { clampQuantity, incrementQuantity, mergeQuantities } from '../features/cart/quantityLimit';
import { cartOrderItems, cartOrderSignature } from '../features/cart/cartOrderBody';
import { repriceCart } from '../features/cart/repriceCart';
import { CART_SCHEMA_VERSION, cheapestVariant, parsePersistedCart } from '../features/cart/cartSchema';
import { useCatalog } from './CatalogProvider';
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

// Pure, and moved out so Node tests can import them without this module's
// React Native graph (it reads the catalog). Re-exported for existing callers.
export { CART_SCHEMA_VERSION, cheapestVariant, parsePersistedCart } from '../features/cart/cartSchema';

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => uuidv4());
  const hydrated = useRef(false);
  // State as well as the ref: the reprice below has to run again once the
  // persisted cart is in, and a ref change re-renders nothing.
  const [hydrationDone, setHydrationDone] = useState(false);
  const { products, modifierGroupsById } = useCatalog();
  // The pre-add basket for the suggestion model. It cannot be read from the
  // `setItems` updater (updaters must be pure, and StrictMode double-invokes
  // them, which would double-count every add) nor from the closure (stale).
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => {
    AsyncStorage.getItem(CART_KEY).then((raw) => { if (raw) setItems(parsePersistedCart(raw)); }).catch(() => {}).finally(() => { hydrated.current = true; setHydrationDone(true); });
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem(CART_KEY, JSON.stringify({ v: CART_SCHEMA_VERSION, items })).catch(() => {});
  }, [items]);
  // The key stands for the order being asked for, so it rotates when the body
  // place_order would receive changes, not on every change to `items`. A
  // reprice changes prices and flags only, and must keep the key: otherwise a
  // retry after a lost response would place a second order (see cartOrderBody).
  const orderSignature = useMemo(() => cartOrderSignature(items), [items]);
  useEffect(() => {
    if (!hydrated.current) return;
    setIdempotencyKey(uuidv4());
  }, [orderSignature]);
  // Prices were snapshotted when a line was added and then kept for ever, so a
  // persisted cart, or a long-lived app, showed yesterday's price while
  // place_order charged today's. Re-price from the catalog once the persisted
  // cart is in, and again whenever the catalog's products or options change
  // (its foreground and menu-focus refresh re-reads them). repriceCart returns
  // the same array when nothing differs, so this writes nothing in the common
  // case, and it is a pure updater, so StrictMode's double call is harmless.
  useEffect(() => {
    if (!hydrationDone) return;
    setItems((prev) => {
      const r = repriceCart(prev, products, modifierGroupsById);
      return r.changed ? r.items : prev;
    });
  }, [hydrationDone, products, modifierGroupsById]);

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
      // Capped at MAX_LINE_QUANTITY: the database refuses a longer line.
      return existing ? prev.map((it) => it.cartItemId === cartItemId ? { ...it, quantity: mergeQuantities(it.quantity, quantity) } : it)
        : [...prev, { cartItemId, product, variant: tier ?? undefined, selectedModifiers: selected, quantity: clampQuantity(quantity), unitPrice, note: trimmedNote }];
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
        return prev.filter((it) => it.cartItemId !== oldId).map((it) => it.cartItemId === newId ? { ...it, quantity: mergeQuantities(it.quantity, quantity) } : it);
      }
      return prev.map((it) => it.cartItemId === oldId ? { cartItemId: newId, product, variant: tier ?? undefined, selectedModifiers: selected, quantity: clampQuantity(quantity), unitPrice, note: trimmedNote } : it);
    });
  }, []);

  const incrementLine = useCallback((id: string) => setItems((p) => p.map((it) => it.cartItemId === id ? { ...it, quantity: incrementQuantity(it.quantity) } : it)), []);
  const decrementLine = useCallback((id: string) => setItems((p) => p.flatMap((it) => it.cartItemId !== id ? [it] : it.quantity - 1 <= 0 ? [] : [{ ...it, quantity: it.quantity - 1 }])), []);
  const removeLine = useCallback((id: string) => setItems((p) => p.filter((it) => it.cartItemId !== id)), []);
  const clear = useCallback(() => setItems([]), []);
  // The body place_order receives. Built in cartOrderBody so the key rotation
  // above and the submitted body cannot disagree about what "the order" is.
  const toOrderItems = useCallback(() => cartOrderItems(items), [items]);
  const count = useMemo(() => items.reduce((n, it) => n + it.quantity, 0), [items]);
  const subtotal = useMemo(() => cartSubtotal(items), [items]);
  const value = useMemo<CartValue>(() => ({ items, count, subtotal, idempotencyKey, addItem, updateItem, incrementLine, decrementLine, removeLine, clear, toOrderItems }), [items, count, subtotal, idempotencyKey, addItem, updateItem, incrementLine, decrementLine, removeLine, clear, toOrderItems]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
export function useCart(): CartValue { const ctx = useContext(CartContext); if (!ctx) throw new Error('useCart must be used within CartProvider'); return ctx; }
