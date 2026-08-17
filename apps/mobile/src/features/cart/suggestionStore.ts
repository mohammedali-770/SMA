/**
 * AsyncStorage side of the cart suggestion profile. Everything that can be
 * reasoned about lives in `suggestionState.ts` (pure, unit-tested); this file
 * is key + in-memory cache + debounce + delegation, and nothing else. It is
 * untested by vitest BY CONSTRUCTION — which is exactly why it must stay thin.
 *
 * Never throws. Every entry point is individually swallowed, matching the
 * contract `features/checkout/pendingSessionStore.ts` states for checkout: a
 * storage hiccup here degrades the strip to cold start and never touches the
 * cart.
 *
 * A MODULE SINGLETON, NOT A REACT PROVIDER. A fifth app-wide provider for one
 * cart section would be heavier than this file. The trade is deliberate: no
 * React surface, no context plumbing, and the state is process-wide anyway.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { SUGGESTIONS_STORAGE_KEY } from '../../lib/storageKeys';
import {
  EMPTY_STATE,
  decayState,
  parseSuggestionState,
  recordAdd,
  recordImpressions,
  serializeSuggestionState,
  type SuggestionState,
} from './suggestionState';
import type { CartItem, Product } from '../../types/models';

/** Trailing write debounce. The cart already writes on every items change. */
const WRITE_DEBOUNCE_MS = 1_200;
/** Bounded replay buffer for events that land before hydration resolves. */
const MAX_QUEUED_EVENTS = 20;

type QueuedEvent =
  | { kind: 'add'; productId: string; categoryId: string; cartCategoryIds: string[]; at: number }
  | { kind: 'impressions'; productIds: string[]; at: number };

let cache: SuggestionState = EMPTY_STATE;
let hydrated = false;
let hydrating: Promise<SuggestionState> | null = null;
let queue: QueuedEvent[] = [];
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const payload = (() => {
      try {
        return serializeSuggestionState(cache);
      } catch {
        return null;
      }
    })();
    if (payload === null) return;
    AsyncStorage.setItem(SUGGESTIONS_STORAGE_KEY, payload).catch(() => {});
  }, WRITE_DEBOUNCE_MS);
}

function applyEvent(event: QueuedEvent): void {
  cache = event.kind === 'add'
    ? recordAdd(
      cache,
      { productId: event.productId, categoryId: event.categoryId, cartCategoryIds: event.cartCategoryIds },
      event.at,
    )
    : recordImpressions(cache, event.productIds, event.at);
}

function enqueue(event: QueuedEvent): void {
  if (hydrated) {
    applyEvent(event);
    scheduleWrite();
    return;
  }
  // Without this the first add after every cold launch is dropped — a
  // systematic bias against the basket-opening add, the most informative event
  // there is. Bounded so a stuck hydration cannot grow it without limit.
  if (queue.length >= MAX_QUEUED_EVENTS) queue.shift();
  queue.push(event);
}

/** Loads the profile once. Safe to call repeatedly; concurrent calls share one read. */
export function hydrateSuggestions(): Promise<SuggestionState> {
  if (hydrated) return Promise.resolve(cache);
  if (hydrating) return hydrating;

  hydrating = AsyncStorage.getItem(SUGGESTIONS_STORAGE_KEY)
    .then((raw) => parseSuggestionState(raw))
    .catch(() => EMPTY_STATE)
    .then((loaded) => {
      cache = loaded;
      hydrated = true;
      hydrating = null;
      // Replay in timestamp order: the queue is append-only but a caller could
      // in principle interleave, and ordering matters for fatigue-vs-add.
      const pending = queue.slice().sort((l, r) => l.at - r.at);
      queue = [];
      if (pending.length > 0) {
        for (const event of pending) applyEvent(event);
        scheduleWrite();
      }
      return cache;
    });

  return hydrating;
}

/** In-memory profile decayed to `now`. Cheap — safe to call per slate computation. */
export function readSuggestions(now: number): SuggestionState {
  try {
    cache = decayState(cache, now);
    return cache;
  } catch {
    return EMPTY_STATE;
  }
}

/**
 * Fire-and-forget learning write. `itemsBeforeAdd` must be the basket as it was
 * BEFORE this product went in, so the co-occurrence edge points the right way.
 */
export function noteCartAdd(product: Product, itemsBeforeAdd: readonly CartItem[]): void {
  try {
    if (!product?.id) return;
    const cartCategoryIds: string[] = [];
    const seen = new Set<string>();
    for (const item of itemsBeforeAdd) {
      const id = item?.product?.categoryId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      cartCategoryIds.push(id);
    }
    enqueue({
      kind: 'add',
      productId: product.id,
      categoryId: product.categoryId,
      cartCategoryIds,
      at: Date.now(),
    });
  } catch {
    /* learning is best-effort; it must never affect the cart */
  }
}

/** Fire-and-forget. Called once per slate, after the dwell — see `useCartSuggestions`. */
export function noteImpressions(productIds: readonly string[]): void {
  try {
    if (productIds.length === 0) return;
    enqueue({ kind: 'impressions', productIds: [...productIds], at: Date.now() });
  } catch {
    /* ignore */
  }
}
