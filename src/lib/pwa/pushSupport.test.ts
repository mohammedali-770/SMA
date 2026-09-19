import { describe, expect, it } from 'vitest';
import { isIosDevice, pushReadiness, readPushEnvironment, type PushEnvironment } from './pushSupport';

const base: PushEnvironment = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  isStandalone: false,
  isIos: false,
};

describe('pushReadiness', () => {
  it('is ready on a desktop browser with the full API surface', () => {
    expect(pushReadiness(base)).toBe('ready');
  });

  it('is ready on an installed iOS web app that exposes PushManager', () => {
    expect(pushReadiness({ ...base, isIos: true, isStandalone: true })).toBe('ready');
  });

  it('asks for a Home Screen install when iOS is in a browser tab', () => {
    // Safari on iOS can never receive a push, however the APIs look.
    expect(pushReadiness({ ...base, isIos: true, isStandalone: false })).toBe('needs-install');
  });

  it('still asks for the install when iOS Safari also lacks PushManager', () => {
    expect(pushReadiness({ ...base, isIos: true, isStandalone: false, hasPushManager: false })).toBe(
      'needs-install',
    );
  });

  it('asks for a REINSTALL when installed on iOS without PushManager', () => {
    // This is the admin's real starting state: a Home Screen entry added before
    // the app served a manifest. Re-adding it is the only remedy.
    expect(pushReadiness({ ...base, isIos: true, isStandalone: true, hasPushManager: false })).toBe(
      'needs-reinstall',
    );
  });

  it('does not offer a reinstall off iOS — there is nothing to reinstall', () => {
    expect(pushReadiness({ ...base, hasPushManager: false })).toBe('unsupported');
    expect(pushReadiness({ ...base, hasPushManager: false, isStandalone: true })).toBe('unsupported');
  });

  it('is unsupported without a service worker, whatever else is present', () => {
    expect(pushReadiness({ ...base, hasServiceWorker: false })).toBe('unsupported');
    expect(pushReadiness({ ...base, hasServiceWorker: false, isIos: true, isStandalone: true })).toBe(
      'unsupported',
    );
  });

  it('is unsupported without the Notification API', () => {
    expect(pushReadiness({ ...base, hasNotification: false })).toBe('unsupported');
  });
});

describe('isIosDevice', () => {
  it('detects iPhone, iPad and iPod from the user agent', () => {
    for (const ua of ['iPhone', 'iPad', 'iPod touch']) {
      expect(isIosDevice({ userAgent: `Mozilla/5.0 (${ua})` } as Navigator)).toBe(true);
    }
  });

  it('detects iPadOS 13+, which reports itself as a Mac', () => {
    expect(
      isIosDevice({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      } as unknown as Navigator),
    ).toBe(true);
  });

  it('does not mistake a real Mac for an iPad', () => {
    expect(
      isIosDevice({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      } as unknown as Navigator),
    ).toBe(false);
  });

  it('survives a navigator with no userAgent at all', () => {
    expect(isIosDevice({} as Navigator)).toBe(false);
  });
});

describe('readPushEnvironment', () => {
  it('reads standalone from the iOS navigator flag', () => {
    const nav = { userAgent: 'iPhone', standalone: true, serviceWorker: {} } as unknown as Navigator;
    const win = { PushManager: class {}, Notification: class {} } as unknown as Window & typeof globalThis;
    const env = readPushEnvironment(win, nav);
    expect(env.isStandalone).toBe(true);
    expect(env.isIos).toBe(true);
    expect(pushReadiness(env)).toBe('ready');
  });

  it('falls back to the display-mode media query', () => {
    const nav = { userAgent: 'Chrome', serviceWorker: {} } as unknown as Navigator;
    const win = {
      PushManager: class {},
      Notification: class {},
      matchMedia: (q: string) => ({ matches: q.includes('standalone') }),
    } as unknown as Window & typeof globalThis;
    expect(readPushEnvironment(win, nav).isStandalone).toBe(true);
  });

  it('treats a throwing matchMedia as "not standalone" rather than crashing', () => {
    // A check that cannot fail safely is worse than no check: this must not be
    // allowed to take the console down on an exotic browser.
    const nav = { userAgent: 'Chrome', serviceWorker: {} } as unknown as Navigator;
    const win = {
      PushManager: class {},
      Notification: class {},
      matchMedia: () => {
        throw new Error('nope');
      },
    } as unknown as Window & typeof globalThis;
    expect(readPushEnvironment(win, nav).isStandalone).toBe(false);
  });

  it('reports the absence of each API honestly', () => {
    const env = readPushEnvironment(
      {} as unknown as Window & typeof globalThis,
      { userAgent: 'Chrome' } as Navigator,
    );
    expect(env).toMatchObject({
      hasServiceWorker: false,
      hasPushManager: false,
      hasNotification: false,
    });
    expect(pushReadiness(env)).toBe('unsupported');
  });
});
