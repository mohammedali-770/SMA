import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COLLECT_MS,
  REFETCH_TIMEOUT_MS,
  RELOAD_GUARD_KEY,
  RELOAD_GUARD_WINDOW_MS,
  createStaleAssetRecovery,
  failedAssetUrl,
  mayReload,
  type RecoveryDeps,
} from './staleAssetRecovery';

const ORIGIN = 'https://spicy.example';
const CHUNK = `${ORIGIN}/assets/AdminDashboard-v5ezbamL.js`;

describe('failedAssetUrl', () => {
  it.each([
    [`Failed to fetch dynamically imported module: ${CHUNK}`, CHUNK],
    [`error loading dynamically imported module: ${CHUNK}`, CHUNK],
    [
      'Unable to preload CSS for /assets/DeliveryZoneModal-CPW6_2MZ.css',
      `${ORIGIN}/assets/DeliveryZoneModal-CPW6_2MZ.css`,
    ],
    [`Failed to fetch dynamically imported module: ${CHUNK}.`, CHUNK],
  ])('reads the URL out of %j', (message, expected) => {
    expect(failedAssetUrl(new Error(message), ORIGIN)).toBe(expected);
    expect(failedAssetUrl(message, ORIGIN)).toBe(expected);
  });

  it('returns null when the browser names no URL (Safari)', () => {
    expect(failedAssetUrl(new TypeError('Importing a module script failed.'), ORIGIN)).toBeNull();
    expect(failedAssetUrl(undefined, ORIGIN)).toBeNull();
    expect(failedAssetUrl({}, ORIGIN)).toBeNull();
  });

  it('never returns a URL on another origin', () => {
    expect(
      failedAssetUrl('Failed to fetch dynamically imported module: https://evil.example/x.js', ORIGIN),
    ).toBeNull();
  });
});

describe('mayReload', () => {
  const now = 1_000_000_000;
  it('reloads when there is no earlier reload, or it is unreadable', () => {
    expect(mayReload(now, null)).toBe(true);
    expect(mayReload(now, 'garbage')).toBe(true);
  });
  it('refuses inside the window and allows after it', () => {
    expect(mayReload(now, String(now - RELOAD_GUARD_WINDOW_MS + 1))).toBe(false);
    expect(mayReload(now, String(now - RELOAD_GUARD_WINDOW_MS))).toBe(true);
  });
  it('treats a future timestamp as recent', () => {
    expect(mayReload(now, String(now + 5_000))).toBe(false);
  });
});

describe('createStaleAssetRecovery', () => {
  let store: Map<string, string>;
  let fetchMock: ReturnType<typeof vi.fn<RecoveryDeps['fetch']>>;
  let reloadMock: ReturnType<typeof vi.fn<RecoveryDeps['reload']>>;
  let deps: RecoveryDeps;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000);
    store = new Map();
    fetchMock = vi.fn<RecoveryDeps['fetch']>(() => Promise.resolve({ status: 200 }));
    reloadMock = vi.fn<RecoveryDeps['reload']>();
    deps = {
      origin: ORIGIN,
      now: () => Date.now(),
      storage: {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => void store.set(k, v),
      },
      fetch: fetchMock,
      reload: reloadMock,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
    };
  });
  afterEach(() => vi.useRealTimers());

  it('refetches the failing chunk with cache:reload, then reloads once', async () => {
    const handle = createStaleAssetRecovery(deps);
    expect(handle(new Error(`Failed to fetch dynamically imported module: ${CHUNK}`))).toBe('scheduled');
    expect(store.get(RELOAD_GUARD_KEY)).toBe('1000000000');
    expect(reloadMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(COLLECT_MS);
    expect(fetchMock).toHaveBeenCalledWith(CHUNK, { cache: 'reload', credentials: 'same-origin' });
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('collects a burst of failures into one refetch round and one reload', async () => {
    const handle = createStaleAssetRecovery(deps);
    handle(new Error(`Failed to fetch dynamically imported module: ${CHUNK}`));
    expect(handle(new Error('Unable to preload CSS for /assets/a-12345678.css'))).toBe('joined');
    await vi.advanceTimersByTimeAsync(COLLECT_MS);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([CHUNK, `${ORIGIN}/assets/a-12345678.css`]);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('still reloads when no URL can be read', async () => {
    createStaleAssetRecovery(deps)(new TypeError('Importing a module script failed.'));
    await vi.advanceTimersByTimeAsync(COLLECT_MS);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('does not wait for ever on a refetch that never answers', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    createStaleAssetRecovery(deps)(`Failed to fetch dynamically imported module: ${CHUNK}`);
    await vi.advanceTimersByTimeAsync(COLLECT_MS + REFETCH_TIMEOUT_MS - 1);
    expect(reloadMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('reloads even when the refetch itself fails', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('offline')));
    createStaleAssetRecovery(deps)(`Failed to fetch dynamically imported module: ${CHUNK}`);
    await vi.advanceTimersByTimeAsync(COLLECT_MS);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('does not loop: a failure right after its own reload is left to the error boundary', async () => {
    store.set(RELOAD_GUARD_KEY, String(Date.now() - 2_000)); // the page we reloaded into
    expect(createStaleAssetRecovery(deps)(`Failed to fetch dynamically imported module: ${CHUNK}`)).toBe(
      'guarded',
    );
    await vi.advanceTimersByTimeAsync(REFETCH_TIMEOUT_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('recovers again once the guard window has passed', async () => {
    store.set(RELOAD_GUARD_KEY, String(Date.now() - RELOAD_GUARD_WINDOW_MS));
    expect(createStaleAssetRecovery(deps)(`Failed to fetch dynamically imported module: ${CHUNK}`)).toBe(
      'scheduled',
    );
    await vi.advanceTimersByTimeAsync(COLLECT_MS);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('never reloads when the guard cannot be written, because then it could loop', async () => {
    deps.storage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
    expect(createStaleAssetRecovery(deps)(`Failed to fetch dynamically imported module: ${CHUNK}`)).toBe(
      'no-storage',
    );
    deps.storage = null;
    expect(createStaleAssetRecovery(deps)(`Failed to fetch dynamically imported module: ${CHUNK}`)).toBe(
      'no-storage',
    );
    deps.storage = { getItem: () => null, setItem: () => undefined }; // a write that does not stick
    expect(createStaleAssetRecovery(deps)(`Failed to fetch dynamically imported module: ${CHUNK}`)).toBe(
      'no-storage',
    );
    await vi.advanceTimersByTimeAsync(REFETCH_TIMEOUT_MS * 2);
    expect(reloadMock).not.toHaveBeenCalled();
  });
});

describe('wiring', () => {
  it('main.tsx installs the listener before the first render', async () => {
    const { readFileSync } = await import('node:fs');
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
    const install = main.indexOf('installStaleAssetRecovery();');
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(main.indexOf('createRoot('));
  });
});
