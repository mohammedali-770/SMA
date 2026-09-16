import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Deliberate tripwire, in the style of the app.json couplings in
 * `features/notifications/notificationPolicy.test.ts` — a manifest assertion,
 * because what it guards is which keys reach the built Info.plist and nothing
 * in the running app can observe that.
 *
 * WHY THIS EXISTS, stated plainly because the cost was real.
 *
 * On 2026-09-10 (#356, GO_LIVE_READINESS B8/N1) the `expo-location` config
 * plugin was declared explicitly with `false` for three purpose strings, to stop
 * it injecting generic `Allow $(PRODUCT_NAME) to…` placeholders for capabilities
 * the app never uses. Two of those three were right and remain `false`. The
 * third, `motionUsagePermission`, was not: on 2026-09-16 App Store Connect
 * REJECTED THE UPLOAD of build 23 with
 *
 *   EAS_UPLOAD_TO_ASC_MISSING_PURPOSE_STRING
 *   Missing keys reported by App Store Connect:
 *   - NSMotionUsageDescription
 *
 * Apple's validator demands the string because CoreMotion is LINKED, not
 * because it is called: `ExpoLocation.framework` inside the built .ipa carries
 * 54 references to `CMMotionActivity`/`CoreMotion`. The app itself never
 * requests motion activity, which is exactly why the string says so.
 *
 * THE LESSON, and the reason this is a test rather than a note: B8 verified the
 * removal with `expo config --type introspect`, which reads the resolved CONFIG.
 * That proved the key was gone. It could not prove the key was unnecessary —
 * only the binary and Apple's validator can, and no iOS submission was attempted
 * between the change and the next one, a six-day gap in which nothing could have
 * caught it. A config check is not an artifact check.
 */
describe('iOS Info.plist purpose strings (GO_LIVE_READINESS B8, N1)', () => {
  // Read the REAL manifest — a stub would defeat the point of the tripwire.
  const appJson = JSON.parse(
    readFileSync(new URL('../../app.json', import.meta.url), 'utf8'),
  ) as {
    expo: {
      locales?: Record<string, string>;
      plugins?: (string | [string, Record<string, unknown>])[];
      ios?: { infoPlist?: Record<string, unknown> };
    };
  };

  const pluginName = (p: string | [string, Record<string, unknown>]) =>
    Array.isArray(p) ? p[0] : p;

  const locationPlugin = (appJson.expo.plugins ?? []).find(
    (p) => pluginName(p) === 'expo-location',
  );

  const locationProps = (
    Array.isArray(locationPlugin) ? locationPlugin[1] : undefined
  ) as Record<string, unknown> | undefined;

  it('declares the expo-location plugin explicitly, so its injections are controlled', () => {
    expect(locationPlugin).toBeDefined();
    expect(locationProps).toBeDefined();
  });

  /**
   * The regression this file is named for. `false` deletes the key
   * (`expo-location/plugin/build/withLocation.js` maps the prop straight onto
   * `NSMotionUsageDescription`), and a deleted key is an upload Apple refuses.
   */
  it('supplies NSMotionUsageDescription, because CoreMotion is linked by ExpoLocation', () => {
    const motion = locationProps?.motionUsagePermission;
    expect(
      typeof motion === 'string' && motion.trim().length > 0,
      'motionUsagePermission must be a non-empty string. `false` deletes ' +
        'NSMotionUsageDescription, and App Store Connect rejects the upload: ' +
        'EAS_UPLOAD_TO_ASC_MISSING_PURPOSE_STRING.',
    ).toBe(true);
  });

  /**
   * The two that were correctly removed. An Always-location declaration for a
   * capability the app does not use invites an App Review question with no good
   * answer, and Apple does NOT require these — its rejection of build 23 named
   * `NSMotionUsageDescription` and nothing else.
   */
  it.each([
    'locationAlwaysAndWhenInUsePermission',
    'locationAlwaysPermission',
  ])('keeps %s disabled — the app has no background location', (prop) => {
    expect(locationProps?.[prop]).toBe(false);
  });

  it('keeps the when-in-use string on ios.infoPlist, where it is authored', () => {
    const whenInUse = appJson.expo.ios?.infoPlist?.NSLocationWhenInUseUsageDescription;
    expect(typeof whenInUse === 'string' && whenInUse.trim().length > 0).toBe(true);
  });

  /**
   * Every purpose string a customer can be shown must exist in both languages.
   * `CFBundleAllowMixedLocalizations` is on and `expo.locales` maps both files,
   * so a key present in one and missing from the other silently falls back to
   * English for an Arabic device.
   */
  describe('both locales carry every purpose string', () => {
    const locales = appJson.expo.locales ?? {};
    const loaded = Object.entries(locales).map(([tag, rel]) => ({
      tag,
      ios: (
        JSON.parse(
          readFileSync(new URL(`../../${rel.replace(/^\.\//, '')}`, import.meta.url), 'utf8'),
        ) as { ios?: Record<string, string> }
      ).ios ?? {},
    }));

    it('maps both ar and en', () => {
      expect(loaded.map((l) => l.tag).sort()).toEqual(['ar', 'en']);
    });

    it.each(['NSLocationWhenInUseUsageDescription', 'NSMotionUsageDescription'])(
      'defines %s in every locale',
      (key) => {
        for (const { tag, ios } of loaded) {
          const value = ios[key];
          expect(
            typeof value === 'string' && value.trim().length > 0,
            `${tag}.json is missing ${key}`,
          ).toBe(true);
        }
      },
    );

    /**
     * Not a translation check — nobody can assert that here. It catches the
     * copy-paste that leaves the Arabic file holding the English sentence,
     * which is the failure mode a reviewer would actually see.
     */
    it('does not leave the Arabic file holding the English string', () => {
      const en = loaded.find((l) => l.tag === 'en')?.ios ?? {};
      const ar = loaded.find((l) => l.tag === 'ar')?.ios ?? {};
      for (const key of Object.keys(en)) {
        if (key === 'CFBundleDisplayName') continue;
        expect(ar[key], `ar.json ${key} is identical to en.json`).not.toBe(en[key]);
      }
    });
  });
});
