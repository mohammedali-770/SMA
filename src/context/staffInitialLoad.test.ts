import { describe, expect, it, vi } from 'vitest';

import { runStaffInitialLoad } from './staffInitialLoad';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('runStaffInitialLoad', () => {
  it('starts the orders read before the catalog has answered', async () => {
    const catalog = deferred<string>();
    const loadOrders = vi.fn(() => new Promise<void>(() => {}));
    void runStaffInitialLoad({ loadCatalog: () => catalog.promise, loadOrders, onCatalog: () => {} });
    expect(loadOrders).toHaveBeenCalledTimes(1);
  });

  it('applies the catalog as soon as it arrives, while orders are still loading', async () => {
    const catalog = deferred<string>();
    const orders = deferred<void>();
    const onCatalog = vi.fn();
    const done = runStaffInitialLoad({
      loadCatalog: () => catalog.promise,
      loadOrders: () => orders.promise,
      onCatalog,
    });
    catalog.resolve('menu');
    await flush();
    expect(onCatalog).toHaveBeenCalledWith('menu');
    orders.resolve();
    await expect(done).resolves.toBeNull();
  });

  it('a failed orders read still lets the catalog land, and reports the failure', async () => {
    const onCatalog = vi.fn();
    const result = await runStaffInitialLoad({
      loadCatalog: async () => 'menu',
      loadOrders: async () => {
        throw new Error('orders refused');
      },
      onCatalog,
    });
    expect(onCatalog).toHaveBeenCalledWith('menu');
    expect(result).toBe('orders refused');
  });

  it('a failed catalog read does not stop the orders read, and is reported', async () => {
    const loadOrders = vi.fn(async () => {});
    const onCatalog = vi.fn();
    const result = await runStaffInitialLoad({
      loadCatalog: async () => {
        throw new Error('catalog refused');
      },
      loadOrders,
      onCatalog,
    });
    expect(loadOrders).toHaveBeenCalledTimes(1);
    expect(onCatalog).not.toHaveBeenCalled();
    expect(result).toBe('catalog refused');
  });

  it('waits for BOTH reads before resolving, even when the first one fails', async () => {
    const orders = deferred<void>();
    let settled = false;
    const done = runStaffInitialLoad({
      loadCatalog: async () => {
        throw new Error('catalog refused');
      },
      loadOrders: () => orders.promise,
      onCatalog: () => {},
    }).then((r) => {
      settled = true;
      return r;
    });
    await flush();
    expect(settled).toBe(false);
    orders.resolve();
    await expect(done).resolves.toBe('catalog refused');
  });
});
