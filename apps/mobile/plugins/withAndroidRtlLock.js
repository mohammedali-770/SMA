/**
 * Keeps Android's NATIVE layout left-to-right, as it has always been in this app.
 *
 * WHY. The app mirrors its own layout for Arabic (src/i18n/rtl.ts, the design-system
 * Text, OtpCodeInput, SuggestionStrip and friends) and deliberately never asks React
 * Native to mirror natively; I18nProvider explains why. That only works while native
 * layout stays left-to-right.
 *
 * Until React Native 0.88 it always did on Android, by accident. I18nUtil decided RTL
 * from `Locale.getAvailableLocales()[0]`, an arbitrary installed locale (in practice
 * "af", so never RTL). RN 0.88.0 fixed that to read the ACTIVE locale (changelog,
 * Android Fixed: "Detect RTL from the active locale instead of an arbitrary installed
 * one", e46189e1e1). Expo SDK 58 brings 0.88. So on a phone whose system language is
 * Arabic, native layout now mirrors, and the app's own mirroring flips it back: rows
 * run in the wrong order, Arabic text sits at the left edge, the OTP boxes fill from
 * the right. Nothing crashes, which is why only a device shows it.
 *
 * WHAT. `I18nUtil.instance.allowRTL(this, false)` in MainApplication.onCreate, before
 * `loadReactNative(this)`. RN's isRTL is `supportsRtl && (forced || (allowed &&
 * deviceLanguageIsRtl))` and the app never forces, so disallowing RTL makes native
 * layout left-to-right on every phone: SDK 57's effective state, exactly. The value
 * is a SharedPreferences write that isRTL reads back on the spot, and
 * Application.onCreate runs before any activity or React surface, so even the first
 * launch after the update is covered. A JS-side I18nManager.allowRTL(false) would be
 * too late for that launch.
 *
 * NOT `android:supportsRtl="false"`: that would also un-mirror Android's own widgets
 * (alert dialogs, the share sheet), which Arabic-language phones mirror today.
 *
 * iOS IS DELIBERATELY UNTOUCHED. Whether iOS already mirrors natively on an
 * Arabic-language iPhone is a separate question with its own decision
 * (docs/RELEASE_CHECKLIST.md §7), because changing it would change shipped behaviour.
 *
 * TO LET NATIVE LAYOUT MIRROR LATER, removing this plugin is not enough: the
 * preference persists on installed devices, so the app must call allowRTL(this, true)
 * once.
 */

const IMPORT = 'import com.facebook.react.modules.i18nmanager.I18nUtil';
const CALL = 'I18nUtil.instance.allowRTL(this, false)';
const LOAD = 'loadReactNative(this)';

/**
 * The whole transform, as a pure function so it can be tested without Expo.
 *
 * @param {string} contents  MainApplication source.
 * @param {string} language  As reported by the config-plugin mod ('java' | 'kt').
 * @returns {string} the modified source, unchanged if already applied.
 */
function addAndroidRtlLock(contents, language) {
  if (contents.includes(CALL)) {
    return contents; // already applied; re-running prebuild must not duplicate it
  }

  // Every failure below is loud on purpose. Silently skipping would ship a build that
  // mirrors twice on Arabic-language phones, the exact defect this plugin prevents.
  if (language !== 'kt') {
    throw new Error(
      `withAndroidRtlLock: expected a Kotlin MainApplication, got "${language}". ` +
        'Update this plugin for the new template rather than skipping it.',
    );
  }

  const onCreate = contents.indexOf('override fun onCreate()');
  const loads = contents.split(LOAD).length - 1;
  if (onCreate === -1 || loads !== 1 || contents.indexOf(LOAD) < onCreate) {
    throw new Error(
      `withAndroidRtlLock: expected exactly one ${LOAD} inside onCreate() in MainApplication. ` +
        'The template changed; update this plugin rather than skipping it.',
    );
  }

  let out = contents;
  if (!out.includes(IMPORT)) {
    if (!/^import /m.test(out)) {
      throw new Error('withAndroidRtlLock: MainApplication has no import block to extend.');
    }
    out = out.replace(/^import /m, `${IMPORT}\nimport `);
  }
  // Before loadReactNative, at the same indentation, so it runs before React starts.
  return out.replace(/^([ \t]*)loadReactNative\(this\)$/m, `$1${CALL}\n$1${LOAD}`);
}

function withAndroidRtlLock(config) {
  // Required lazily so the pure transform above is testable without Expo installed
  // at the root, where the unit suite runs.
  const { withMainApplication } = require('expo/config-plugins');
  return withMainApplication(config, (cfg) => {
    cfg.modResults.contents = addAndroidRtlLock(cfg.modResults.contents, cfg.modResults.language);
    return cfg;
  });
}

module.exports = withAndroidRtlLock;
module.exports.addAndroidRtlLock = addAndroidRtlLock;
module.exports.CALL = CALL;
module.exports.IMPORT = IMPORT;
