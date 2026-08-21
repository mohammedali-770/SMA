/**
 * Registers Tap's card view with React Native's legacy view-manager interop.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NOT ACTIVE. This plugin is deliberately NOT listed in `app.json` → plugins.
 * `card-react-native` is not a dependency, online payment is disabled, and the
 * Tap agreement is not signed. It is committed now so the fix exists, is
 * reviewed, and is tested — not so that it runs. To activate, once the SDK is
 * actually installed and the freeze is lifted, add to app.json:
 *
 *     "plugins": [ ..., "./plugins/withTapCardInterop" ]
 * ────────────────────────────────────────────────────────────────────────────
 *
 * WHY IT IS NEEDED AT ALL.
 * `card-react-native@1.0.8` ships a PAPER view manager on both platforms —
 * `RCTViewManager` on iOS, `SimpleViewManager` on Android — and declares no
 * `codegenConfig`, so it is not a Fabric component. We are on React Native
 * 0.86 (Expo SDK 57), where the New Architecture is mandatory and cannot be
 * disabled, so such a view can only render through the interop layer.
 *
 * The two platforms are NOT symmetric, and that asymmetry is this file:
 *
 *   Android  `ReactNativeFeatureFlagsDefaults.useFabricInterop()` returns TRUE
 *            by default and view managers resolve through ViewManagerRegistry.
 *            Nothing to do.
 *
 *   iOS      `RCTLegacyViewManagerInteropComponentView` matches against a
 *            HARDCODED allowlist — DatePicker, ProgressView, MaskedView and the
 *            ART views. A third-party component is not in it, and no
 *            autolinking path adds one. It must be registered at runtime,
 *            before the first render.
 *
 * THE FAILURE MODE IS QUIET, AND IT LIES ABOUT ITS CAUSE.
 * `card-react-native`'s index.tsx guards with
 * `UIManager.getViewManagerConfig(...) != null` and substitutes a component
 * that throws its generic "did you rebuild / are you on Expo Go" linking error.
 * That message points at a build problem which does not exist, so anyone
 * debugging it goes looking in entirely the wrong place. Hence this comment.
 *
 * The registered name is the RN module name, which React Native derives by
 * dropping the `Manager` suffix from `CardSdkReactNativeViewManager` — the same
 * string `index.tsx` passes to `requireNativeComponent`.
 *
 * See docs/integrations/Tap_API_Reference.md §4.1.
 */

const COMPONENT_NAME = 'CardSdkReactNativeView';
const IMPORT = '#import <React/RCTLegacyViewManagerInteropComponentView.h>';
const CALL =
  `  [RCTLegacyViewManagerInteropComponentView supportLegacyViewManagerWithName:@"${COMPONENT_NAME}"];`;

/**
 * The whole transform, as a pure function so it can be tested without Expo.
 *
 * @param {string} contents  AppDelegate source.
 * @param {string} language  As reported by the config-plugin mod ('objc' | 'objcpp' | 'swift').
 * @returns {string} the modified source, unchanged if already applied.
 */
function addTapCardInterop(contents, language) {
  if (contents.includes(`supportLegacyViewManagerWithName:@"${COMPONENT_NAME}"`)) {
    return contents; // already applied — re-running prebuild must not duplicate it
  }

  if (language !== 'objc' && language !== 'objcpp') {
    // Fail loudly. Silently skipping would reproduce exactly the quiet failure
    // this plugin exists to prevent.
    throw new Error(
      `withTapCardInterop: expected an Objective-C AppDelegate, got "${language}". ` +
        'A Swift AppDelegate needs the equivalent call written in Swift.',
    );
  }

  const anchor = /(- \(BOOL\)application:\(UIApplication \*\)application didFinishLaunchingWithOptions:\(NSDictionary \*\)launchOptions\s*\{\n)/;
  if (!anchor.test(contents)) {
    throw new Error(
      'withTapCardInterop: could not find didFinishLaunchingWithOptions in the AppDelegate. ' +
        'The template changed — update this plugin rather than skipping it.',
    );
  }

  let out = contents;
  if (!out.includes(IMPORT)) {
    out = out.replace(/#import "AppDelegate\.h"/, `#import "AppDelegate.h"\n${IMPORT}`);
  }
  // Registered BEFORE super, so the very first render already resolves.
  return out.replace(anchor, `$1${CALL}\n`);
}

function withTapCardInterop(config) {
  // Required lazily so the pure transform above is testable without Expo
  // installed at the root, where the unit suite runs.
  const { withAppDelegate } = require('@expo/config-plugins');
  return withAppDelegate(config, (cfg) => {
    cfg.modResults.contents = addTapCardInterop(
      cfg.modResults.contents,
      cfg.modResults.language,
    );
    return cfg;
  });
}

module.exports = withTapCardInterop;
module.exports.addTapCardInterop = addTapCardInterop;
module.exports.COMPONENT_NAME = COMPONENT_NAME;
