import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory AsyncStorage: the store's only dependency.
const mem = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => mem.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: async (k: string) => {
      mem.delete(k);
    },
  },
}));

import { loadPendingSession, savePendingSession } from './pendingSessionStore';

describe('savePendingSession keeps a checkout tied to the cart it was begun for', () => {
  beforeEach(() => mem.clear());

  it('records the cart key given when a checkout is begun', async () => {
    await savePendingSession('s1', 10, 'cart-meal');
    expect(await loadPendingSession()).toEqual({ sessionId: 's1', at: 10, cartKey: 'cart-meal', checkoutKey: null });
  });

  it('a resume (no key given) keeps the key already saved for the same session', async () => {
    await savePendingSession('s1', 10, 'cart-meal');
    await savePendingSession('s1', 20);
    expect(await loadPendingSession()).toEqual({ sessionId: 's1', at: 20, cartKey: 'cart-meal', checkoutKey: null });
  });

  it('records the card checkout key alongside, and a resume keeps both', async () => {
    await savePendingSession('s1', 10, 'cart-meal', 'chk-pickup');
    await savePendingSession('s1', 20);
    expect(await loadPendingSession()).toEqual({ sessionId: 's1', at: 20, cartKey: 'cart-meal', checkoutKey: 'chk-pickup' });
  });

  it('never carries a checkout key over to a different session', async () => {
    await savePendingSession('s1', 10, 'cart-meal', 'chk-pickup');
    await savePendingSession('s2', 20, 'cart-meal');
    expect(await loadPendingSession()).toEqual({ sessionId: 's2', at: 20, cartKey: 'cart-meal', checkoutKey: null });
  });

  it('never carries a key over to a different session', async () => {
    await savePendingSession('s1', 10, 'cart-meal');
    await savePendingSession('s2', 20);
    expect(await loadPendingSession()).toEqual({ sessionId: 's2', at: 20, cartKey: null, checkoutKey: null });
  });
});
