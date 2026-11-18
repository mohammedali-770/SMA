import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * Android release builds are R8-minified (`expo-build-properties`
 * `enableMinifyInReleaseBuilds`), so a native Android frame in a Sentry event
 * reads `a.b.c` unless Sentry holds that build's R8 mapping file. The owner
 * decided on 2026-11-18 to upload it at build time (docs/SENTRY_OBSERVABILITY.md,
 * "Android release builds are minified").
 *
 * The mechanism is the `experimental_android` block of the
 * `@sentry/react-native/expo` plugin in app.json, which applies the Sentry
 * Android Gradle Plugin (SAGP). This suite pins three things:
 *
 * 1. app.json asks for mapping upload and nothing else from SAGP;
 * 2. the INSTALLED plugin turns that into a Gradle config that uploads the
 *    mapping, adds no second copy of the Sentry Android SDK and adds no
 *    bytecode auto-instrumentation — checked by running the real plugin, so an
 *    SDK upgrade that changes what it writes fails here rather than in an EAS
 *    build;
 * 3. app.config.js still strips the whole plugin when SENTRY_AUTH_TOKEN is
 *    absent, so a tokenless build applies no SAGP at all and cannot fail on it.
 */

const require = createRequire(import.meta.url);

type PluginEntry = string | [string, Record<string, unknown>];
type ExpoConfig = { name: string; slug: string; plugins?: PluginEntry[]; [key: string]: unknown };
type GradleMod = (config: Record<string, unknown>) => Promise<{ modResults: { contents: string } }>;

const SENTRY_PLUGIN = '@sentry/react-native/expo';

const appJson = JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8')) as {
  expo: ExpoConfig;
};

const sentryEntries = (plugins: PluginEntry[] = []) =>
  plugins.filter((entry) => (Array.isArray(entry) ? entry[0] : entry) === SENTRY_PLUGIN);

const sentryProps = (): Record<string, unknown> => {
  const [entry] = sentryEntries(appJson.expo.plugins);
  if (!Array.isArray(entry)) throw new Error('the Sentry plugin has no options in app.json');
  return entry[1];
};

/** The decision, stated once. Every key is set explicitly rather than left to a plugin default. */
const EXPECTED_ANDROID = {
  enableAndroidGradlePlugin: true,
  includeProguardMapping: true,
  autoUploadProguardMapping: true,
  dexguardEnabled: false,
  uploadNativeSymbols: false,
  autoUploadNativeSymbols: false,
  includeNativeSources: false,
  includeSourceContext: false,
};

/** Runs one of the plugin's Android Gradle mods over a stand-in file, as `expo prebuild` would. */
async function runGradleMod(config: Record<string, unknown>, modName: string, contents: string) {
  const mods = (config.mods as { android?: Record<string, GradleMod> } | undefined)?.android;
  const mod = mods?.[modName];
  if (!mod) return contents;
  const result = await mod({
    ...config,
    modRequest: {
      platform: 'android',
      modName,
      projectRoot: '/virtual',
      platformProjectRoot: '/virtual/android',
      introspect: false,
    },
    modResults: { language: 'groovy', contents },
  });
  return result.modResults.contents;
}

/** The two files SAGP touches, reduced to the anchors the plugin looks for. */
const PROJECT_BUILD_GRADLE = `buildscript {
  repositories {
    google()
    mavenCentral()
  }
  dependencies {
    classpath('com.android.tools.build:gradle')
  }
}
`;
const APP_BUILD_GRADLE = `apply plugin: "com.android.application"

android {
    namespace 'sa.com.spicymeal.app'
}
`;

async function prebuildAndroidGradle(props: Record<string, unknown>) {
  const { withSentry } = require('@sentry/react-native/expo') as {
    withSentry: (config: ExpoConfig, props: Record<string, unknown>) => Record<string, unknown>;
  };
  // A fresh object each time: the plugin deletes keys from its props.
  const config = withSentry(
    { name: 'sentry-mapping-test', slug: 'sentry-mapping-test' },
    structuredClone(props),
  );
  return {
    project: await runGradleMod(config, 'projectBuildGradle', PROJECT_BUILD_GRADLE),
    app: await runGradleMod(config, 'appBuildGradle', APP_BUILD_GRADLE),
  };
}

describe('Sentry Android R8 mapping upload', () => {
  it('app.json enables SAGP for mapping upload only, every option explicit', () => {
    expect(sentryEntries(appJson.expo.plugins)).toHaveLength(1);
    expect(sentryProps().experimental_android).toEqual(EXPECTED_ANDROID);
  });

  it('the installed plugin writes a Gradle config that uploads the mapping and nothing more', async () => {
    const { project, app } = await prebuildAndroidGradle(sentryProps());

    expect(project).toMatch(/classpath\("io\.sentry:sentry-android-gradle-plugin:[\d.]+"\)/);
    expect(app.startsWith('apply plugin: "io.sentry.android.gradle"\n')).toBe(true);

    const block = app.slice(app.indexOf('sentry {'));
    expect(app.indexOf('sentry {')).toBeGreaterThan(-1);
    // Mapping: bundled and uploaded. Upload follows the RN SDK's own switch, so
    // SENTRY_DISABLE_AUTO_UPLOAD (development/preview profiles) still turns it off.
    expect(block).toContain('includeProguardMapping = true');
    expect(block).toContain('autoUploadProguardMapping = shouldSentryAutoUpload()');
    // No duplicate sentry-android: the RN SDK pins its own version.
    expect(block).toMatch(/autoInstallation \{\s*enabled = false\s*\}/);
    // No bytecode auto-instrumentation of OkHttp, Room, File I/O and friends.
    expect(block).toMatch(/tracingInstrumentation \{\s*enabled = false\s*\}/);
    // Native symbols and sources are out of scope for this decision.
    expect(block).toContain('uploadNativeSymbols = false');
    expect(block).toContain('autoUploadNativeSymbols = false');
    expect(block).toContain('includeNativeSources = false');
    expect(block).toContain('includeSourceContext = false');
    expect(block).toContain('dexguardEnabled = false');
  });

  it('without enableAndroidGradlePlugin the same plugin applies no SAGP (the control for the test above)', async () => {
    const props = sentryProps();
    const { project, app } = await prebuildAndroidGradle({
      ...props,
      experimental_android: { ...(props.experimental_android as object), enableAndroidGradlePlugin: false },
    });
    expect(project).not.toContain('sentry-android-gradle-plugin');
    expect(app).not.toContain('io.sentry.android.gradle');
    expect(app).not.toContain('sentry {');
  });

  describe('app.config.js token gate', () => {
    const original = process.env.SENTRY_AUTH_TOKEN;
    afterEach(() => {
      if (original === undefined) delete process.env.SENTRY_AUTH_TOKEN;
      else process.env.SENTRY_AUTH_TOKEN = original;
    });

    const resolve = () => {
      const appConfig = require('../../app.config.js') as (ctx: { config: ExpoConfig }) => ExpoConfig;
      return appConfig({ config: structuredClone(appJson.expo) });
    };

    it('keeps the Sentry plugin, mapping options intact, when the token is present', () => {
      process.env.SENTRY_AUTH_TOKEN = 'dummy-token-for-test';
      const [entry] = sentryEntries(resolve().plugins);
      expect(Array.isArray(entry) ? entry[1].experimental_android : undefined).toEqual(EXPECTED_ANDROID);
    });

    it('removes the Sentry plugin, and with it SAGP, when the token is absent', () => {
      delete process.env.SENTRY_AUTH_TOKEN;
      const resolved = resolve();
      expect(sentryEntries(resolved.plugins)).toHaveLength(0);
      expect(JSON.stringify(resolved.plugins)).not.toContain('enableAndroidGradlePlugin');
      // Only the Sentry entry goes; every other plugin survives.
      expect(resolved.plugins).toHaveLength((appJson.expo.plugins ?? []).length - 1);
    });
  });
});
