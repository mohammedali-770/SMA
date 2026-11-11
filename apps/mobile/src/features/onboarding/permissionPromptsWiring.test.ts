import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * WHICH code may raise an OS permission dialog is a property of the whole app,
 * not of one file, and nothing at runtime would notice it regress: a dialog
 * that appears at the wrong moment still "works". These pin it.
 *
 *  - Location is asked only where it is used — the pickup tab (nearest
 *    branches) and "Use my location" on the delivery map. The first run used to
 *    ask straight after sign-in, with no context at all.
 *  - The OS notification prompt is raised only behind an explicit tap: the
 *    consent screen's Allow button, or a Profile toggle. The OS dialog cannot
 *    say that offers come with order updates; the consent screen in front of it
 *    does (Apple 4.5.4, CLAUDE.md §7).
 */

const SRC = resolve(__dirname, '../..');

/** Source with comments removed, so prose about an API cannot satisfy a check. */
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

const FILES = sourceFiles(SRC).map((path) => ({
  rel: relative(SRC, path).split('\\').join('/'),
  code: strip(readFileSync(path, 'utf8')),
}));

const code = (rel: string) => {
  const file = FILES.find((f) => f.rel === rel);
  if (!file) throw new Error(`${rel} not found under src/`);
  return file.code;
};

/** Every source file that contains `needle`, sorted. */
const filesContaining = (needle: string) =>
  FILES.filter((f) => f.code.includes(needle))
    .map((f) => f.rel)
    .sort();

describe('location is asked only where it is used', () => {
  it('requestForegroundPermissionsAsync is called from exactly the delivery map and the pickup tab', () => {
    expect(filesContaining('requestForegroundPermissionsAsync')).toEqual([
      'components/LocationPickerMap.tsx',
      'features/order/OrderTypeSelectScreen.tsx',
    ]);
  });

  it('the first run no longer touches location at all', () => {
    expect(code('features/onboarding/useFirstRunPermissions.ts')).not.toContain('expo-location');
  });
});

describe('the OS notification prompt sits behind an explicit tap', () => {
  it('only the registration module talks to the OS permission API', () => {
    expect(filesContaining('requestPermissionsAsync')).toEqual([
      'features/notifications/pushRegistration.ts',
    ]);
  });

  it('ensureNotificationPermission is called only by the Profile toggles and the consent Allow path', () => {
    const callers = filesContaining('ensureNotificationPermission(').filter(
      (rel) => !rel.startsWith('features/notifications/pushRegistration'),
    );
    expect(callers).toEqual([
      'features/notifications/NotificationSettings.tsx',
      'features/onboarding/useFirstRunPermissions.ts',
    ]);
  });

  it('the first run raises it only from allow(), never when the screen is decided', () => {
    const hook = code('features/onboarding/useFirstRunPermissions.ts');
    const allowAt = hook.indexOf('const allow = useCallback');
    expect(allowAt).toBeGreaterThan(-1);
    expect(hook.slice(0, allowAt)).not.toContain('ensureNotificationPermission(');
    expect(hook.slice(allowAt)).toContain('ensureNotificationPermission(');
  });

  it('the Android channel is created on launch, not only behind Allow', () => {
    // push-dispatch sends on channel 'default', and a notification for a
    // channel that does not exist is not shown. Android 12 and older never see
    // the consent prompt (granted at install), so a channel created only in
    // allow() would leave them registered and shown nothing (review on #425).
    const hook = code('features/onboarding/useFirstRunPermissions.ts');
    const allowAt = hook.indexOf('const allow = useCallback');
    const beforeAllow = hook.slice(0, allowAt);
    expect(beforeAllow).toContain('ensureAndroidChannel()');
    // ...and before the first-run flag can return early, so it runs every launch.
    expect(beforeAllow.indexOf('ensureAndroidChannel()')).toBeLessThan(beforeAllow.indexOf('readFirstRun()'));
  });

  it('allow() re-checks the grant before registering, so a choice made meanwhile stands', () => {
    const allow = code('features/onboarding/useFirstRunPermissions.ts').split('const allow = useCallback')[1];
    expect(allow.indexOf('shouldRegisterOnFirstRun(await hasNotificationPermission())')).toBeGreaterThan(-1);
    expect(allow.indexOf('shouldRegisterOnFirstRun(')).toBeLessThan(
      allow.indexOf('ensureNotificationPermission('),
    );
  });
});

describe('the consent screen is wired where it can be seen, and nowhere it gets in the way', () => {
  it('the tabs layout renders it, never over the order-type pop-up', () => {
    const tabs = code('app/(tabs)/_layout.tsx');
    expect(tabs).toContain('<NotificationConsentModal consent={consent} blocked={requireOrderChoice} />');
    expect(tabs).toContain('useNotificationOnboarding(');
  });

  it('nothing outside the onboarding hook calls the first-run or sign-in hooks directly', () => {
    expect(filesContaining('useFirstRunPermissions(')).toEqual([
      'features/onboarding/useFirstRunPermissions.ts',
      'features/onboarding/useNotificationOnboarding.ts',
    ]);
    expect(filesContaining('usePushDeviceSync(')).toEqual([
      'features/notifications/usePushDeviceSync.ts',
      'features/onboarding/useNotificationOnboarding.ts',
    ]);
  });

  it('the screen decides visibility through consentScreenVisible', () => {
    expect(code('features/notifications/NotificationConsentModal.tsx')).toContain(
      'consentScreenVisible({ pathname, blocked })',
    );
  });
});
