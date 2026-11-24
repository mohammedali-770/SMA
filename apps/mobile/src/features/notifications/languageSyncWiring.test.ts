import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbPushDevice } from '../../types/db';

/**
 * F-X08-001: the language the server holds for a device used to be fixed at
 * registration, so every push stayed in it after the customer switched the app
 * language. These pin the WIRING, which no test of the pure rule can see: that
 * the sync calls the existing registration RPC with the STORED preferences, and
 * that the hook actually runs it when the language changes.
 */

const mocks = vi.hoisted(() => ({
  mine: vi.fn(),
  register: vi.fn(),
  deactivate: vi.fn(),
  token: 'ExponentPushToken[test-token-0001]',
}));

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: { eas: { projectId: 'p' } } } } }));
vi.mock('expo-device', () => ({ isDevice: true }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-notifications', () => ({
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: mocks.token })),
  setNotificationChannelAsync: vi.fn(),
  AndroidImportance: { HIGH: 4 },
}));
vi.mock('../../services/api', () => ({
  pushDevices: { mine: mocks.mine, register: mocks.register, deactivateToken: mocks.deactivate },
}));

import { deactivateThisDeviceStrict, registerThisDevice, syncDeviceLang } from './pushRegistration';

const device = (over: Partial<DbPushDevice> = {}): DbPushDevice => ({
  id: 'd1',
  customer_id: 'c1',
  expo_push_token: mocks.token,
  platform: 'ios',
  lang: 'en',
  is_active: true,
  order_updates_enabled: true,
  promos_enabled: false,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  ...over,
});

beforeEach(() => {
  mocks.mine.mockReset();
  mocks.register.mockReset();
  mocks.deactivate.mockReset();
  mocks.deactivate.mockResolvedValue(undefined);
  mocks.register.mockImplementation(async (i: { lang: 'en' | 'ar' }) => device({ lang: i.lang }));
});

describe('syncDeviceLang sends the new language through register_push_device with the stored preferences', () => {
  it('offers ON stays ON, and the language changes', async () => {
    mocks.mine.mockResolvedValue([device({ promos_enabled: true })]);
    const row = await syncDeviceLang('ar');
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledWith({
      token: mocks.token,
      platform: 'ios',
      lang: 'ar',
      orderUpdatesEnabled: true,
      promosEnabled: true,
    });
    expect(row?.lang).toBe('ar');
  });

  it('offers OFF stays OFF, and order updates OFF stays OFF', async () => {
    mocks.mine.mockResolvedValue([device({ order_updates_enabled: false, promos_enabled: false })]);
    await syncDeviceLang('ar');
    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({ lang: 'ar', orderUpdatesEnabled: false, promosEnabled: false }),
    );
  });

  it("reads only this token's row among the customer's devices", async () => {
    mocks.mine.mockResolvedValue([
      device({ expo_push_token: 'ExponentPushToken[someone-else-02]', promos_enabled: true }),
      device({ promos_enabled: false }),
    ]);
    await syncDeviceLang('ar');
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({ promosEnabled: false }));
  });

  it('does nothing when the language already matches', async () => {
    mocks.mine.mockResolvedValue([device({ lang: 'ar' })]);
    expect(await syncDeviceLang('ar')).toBeNull();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('does not reactivate a silenced device', async () => {
    mocks.mine.mockResolvedValue([device({ is_active: false, order_updates_enabled: false })]);
    expect(await syncDeviceLang('ar')).toBeNull();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('never registers on an absent row or a failed lookup', async () => {
    mocks.mine.mockResolvedValue([]);
    expect(await syncDeviceLang('ar')).toBeNull();
    mocks.mine.mockRejectedValue(new Error('network'));
    expect(await syncDeviceLang('ar')).toBeNull();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('lets a failed write throw, so the caller can leave it for next time', async () => {
    mocks.mine.mockResolvedValue([device()]);
    mocks.register.mockRejectedValue(new Error('rpc'));
    await expect(syncDeviceLang('ar')).rejects.toThrow('rpc');
  });
});

describe('the hook runs the sync, and nothing else in it can rewrite preferences', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const hook = strip(readFileSync(new URL('./usePushDeviceSync.ts', import.meta.url), 'utf8'));
  const registration = strip(readFileSync(new URL('./pushRegistration.ts', import.meta.url), 'utf8'));
  const web = strip(readFileSync(new URL('./pushRegistration.web.ts', import.meta.url), 'utf8'));

  it('the hook calls syncDeviceLang when the language or the settled row changes', () => {
    expect(hook).toContain('syncDeviceLang(target)');
    expect(hook).toContain('deviceLangSyncPrefs({ lang, device: settled })');
    expect(hook).toContain('}, [signedIn, lang, settled]);');
  });

  it('the hook never registers with preferences of its own in the language path', () => {
    const effect = hook.split('syncing.current = true;')[1] ?? '';
    expect(effect).not.toContain('registerThisDevice');
    expect(effect).not.toContain('DEFAULT_DEVICE_PREFS');
  });

  it("syncDeviceLang passes the policy's stored preferences, never the defaults", () => {
    const fn = registration.split('export function syncDeviceLang')[1].split('\nexport ')[0];
    expect(fn).toContain('registerUnserialised(lang, prefs)');
    expect(fn).not.toContain('DEFAULT_DEVICE_PREFS');
    expect(fn).toContain("lookup.status !== 'found'");
  });

  it('every write to the device row goes through the one queue', () => {
    for (const name of ['registerThisDevice', 'syncDeviceLang', 'deactivateThisDeviceStrict']) {
      const fn = registration.split(`export function ${name}`)[1].split('\nexport ')[0];
      expect(fn, name).toContain('serialiseDeviceWrite(');
    }
    // The queue entry for the sync holds the read AND the write: they must not be split.
    const sync = registration.split('export function syncDeviceLang')[1].split('\nexport ')[0];
    expect(sync.indexOf('lookupThisDevice()')).toBeLessThan(sync.indexOf('registerUnserialised'));
  });

  it('the web build mirrors the signature and writes nothing', () => {
    expect(web).toContain("export async function syncDeviceLang(_lang: 'en' | 'ar')");
  });
});

/**
 * Review finding on F-X08-001: the sync reads the stored preferences and writes
 * them back, and `register_push_device` forces `is_active = true`. A Profile
 * change that lands between that read and that write must not be undone.
 */
describe('device writes run one at a time, so a language sync never undoes a preference change', () => {
  const deferred = <T>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };
  const flush = async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };

  it('an opt-out asked for while the sync is reading is the LAST write', async () => {
    const read = deferred<DbPushDevice[]>();
    mocks.mine.mockReturnValue(read.promise);

    const sync = syncDeviceLang('ar');
    await flush(); // the sync is now waiting on its read of the stored row
    const optOut = registerThisDevice('en', { orderUpdatesEnabled: true, promosEnabled: false });
    await flush();
    // The stored row still says offers ON (the read is stale by the time it lands).
    read.resolve([device({ promos_enabled: true })]);
    await Promise.all([sync, optOut]);

    const writes = mocks.register.mock.calls.map((c) => c[0] as { promosEnabled: boolean });
    expect(writes).toHaveLength(2);
    expect(writes[writes.length - 1].promosEnabled).toBe(false);
  });

  it('a deactivation asked for while the sync is reading comes AFTER the sync write', async () => {
    const read = deferred<DbPushDevice[]>();
    mocks.mine.mockReturnValue(read.promise);

    const sync = syncDeviceLang('ar');
    await flush();
    const off = deactivateThisDeviceStrict();
    await flush();
    read.resolve([device({ promos_enabled: true })]);
    await Promise.all([sync, off]);

    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.deactivate).toHaveBeenCalledTimes(1);
    expect(mocks.deactivate.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.register.mock.invocationCallOrder[0],
    );
  });

  it('a failed write rejects its own caller and does not block the next one', async () => {
    mocks.register.mockRejectedValueOnce(new Error('rpc down'));
    const first = registerThisDevice('en', { orderUpdatesEnabled: true, promosEnabled: true });
    const second = registerThisDevice('ar', { orderUpdatesEnabled: true, promosEnabled: false });
    await expect(first).rejects.toThrow('rpc down');
    await expect(second).resolves.toBeTruthy();
    expect(mocks.register).toHaveBeenCalledTimes(2);
  });
});
