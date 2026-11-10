import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Only the PURE transform is imported. The plugin wrapper requires
// expo/config-plugins lazily, which is not installed where this suite runs.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { addAndroidRtlLock, CALL, IMPORT } = require('./withAndroidRtlLock.js');

const MOBILE = resolve(__dirname, '..');

/** Expo SDK 58's MainApplication.kt, as `expo prebuild` generates it for this app. */
const MAIN_APPLICATION = `package sa.com.spicymeal.app

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }
    )
  }

  override fun onCreate() {
    super.onCreate()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
`;

describe('addAndroidRtlLock', () => {
  it('disallows native RTL; it never forces a direction', () => {
    expect(CALL).toBe('I18nUtil.instance.allowRTL(this, false)');
    const out = addAndroidRtlLock(MAIN_APPLICATION, 'kt');
    expect(out).toContain(`    ${CALL}\n    loadReactNative(this)`);
    expect(out).not.toMatch(/forceRTL/);
  });

  it('runs inside onCreate, before React Native loads', () => {
    // Order matters: React reads isRTL when its first surface starts, so the call has
    // to land before loadReactNative or the first launch after an update is mirrored.
    const out = addAndroidRtlLock(MAIN_APPLICATION, 'kt');
    const onCreate = out.indexOf('override fun onCreate()');
    const call = out.indexOf(CALL);
    expect(onCreate).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(onCreate);
    expect(call).toBeLessThan(out.indexOf('loadReactNative(this)'));
    expect(call).toBeLessThan(out.indexOf('override fun onConfigurationChanged'));
  });

  it('imports I18nUtil exactly once, inside the import block', () => {
    const out = addAndroidRtlLock(MAIN_APPLICATION, 'kt');
    expect(out.split(IMPORT).length - 1).toBe(1);
    expect(out.indexOf(IMPORT)).toBeGreaterThan(out.indexOf('package sa.com.spicymeal.app'));
    expect(out.indexOf(IMPORT)).toBeLessThan(out.indexOf('class MainApplication'));
  });

  it('changes nothing else', () => {
    const out = addAndroidRtlLock(MAIN_APPLICATION, 'kt');
    const removed = out.replace(`${IMPORT}\n`, '').replace(`    ${CALL}\n`, '');
    expect(removed).toBe(MAIN_APPLICATION);
  });

  it('is idempotent; prebuild runs repeatedly', () => {
    const once = addAndroidRtlLock(MAIN_APPLICATION, 'kt');
    const twice = addAndroidRtlLock(once, 'kt');
    expect(twice).toBe(once);
    expect(twice.split(CALL).length - 1).toBe(1);
  });

  it('fails loudly rather than skipping when the template is not the one it knows', () => {
    expect(() => addAndroidRtlLock(MAIN_APPLICATION, 'java')).toThrow(/Kotlin/);
    const noLoad = MAIN_APPLICATION.replace('    loadReactNative(this)\n', '');
    expect(() => addAndroidRtlLock(noLoad, 'kt')).toThrow(/exactly one/);
    const twoLoads = MAIN_APPLICATION.replace(
      '    loadReactNative(this)\n',
      '    loadReactNative(this)\n    loadReactNative(this)\n',
    );
    expect(() => addAndroidRtlLock(twoLoads, 'kt')).toThrow(/exactly one/);
    const noOnCreate = MAIN_APPLICATION.replace('override fun onCreate()', 'fun start()');
    expect(() => addAndroidRtlLock(noOnCreate, 'kt')).toThrow(/exactly one/);
  });
});

describe('withAndroidRtlLock wiring', () => {
  it('is registered in app.json, exactly once', () => {
    const app = JSON.parse(readFileSync(resolve(MOBILE, 'app.json'), 'utf8'));
    const names = (app.expo.plugins as unknown[]).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names.filter((n) => n === './plugins/withAndroidRtlLock')).toHaveLength(1);
  });

  it('touches Android only: iOS mirroring is a separate decision', () => {
    const src = readFileSync(resolve(__dirname, 'withAndroidRtlLock.js'), 'utf8');
    expect(src).toMatch(/withMainApplication/);
    expect(src).not.toMatch(/withAppDelegate|withInfoPlist|withAndroidManifest/);
  });

  it('calls an API the installed React Native still has', (ctx) => {
    // Kotlin is not compiled in this repository's CI, so a renamed RN API would first
    // surface as a failed EAS build. This reads the installed source instead.
    const util = resolve(
      MOBILE,
      'node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/i18nmanager/I18nUtil.kt',
    );
    if (!existsSync(util)) return ctx.skip();
    const kt = readFileSync(util, 'utf8');
    expect(kt).toMatch(/package com\.facebook\.react\.modules\.i18nmanager/);
    expect(kt).toMatch(/public fun allowRTL\(context: Context, allowRTL: Boolean\)/);
    expect(kt).toMatch(/public val instance: I18nUtil/);
    // isRTL must still require "allowed" for a device-language RTL; if a future RN
    // drops that term, disallowing would stop working and this lock with it.
    expect(kt).toMatch(
      /isRTLForced\(context\) \|\| \(isRTLAllowed\(context\) && isDevicePreferredLanguageRTL/,
    );
  });
});
