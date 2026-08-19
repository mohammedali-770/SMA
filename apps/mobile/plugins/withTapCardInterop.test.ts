import { describe, expect, it } from 'vitest';

// Only the PURE transform is imported — the plugin wrapper requires
// @expo/config-plugins lazily, which is not installed where this suite runs.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { addTapCardInterop, COMPONENT_NAME } = require('./withTapCardInterop.js');

/** The shape Expo's iOS template actually generates. */
const APP_DELEGATE = `#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <React/RCTLinkingManager.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"main";
  self.initialProps = @{};
  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

@end
`;

describe('addTapCardInterop', () => {
  it('registers the component React Native actually looks for', () => {
    // RN derives the module name by dropping `Manager` from
    // CardSdkReactNativeViewManager; index.tsx passes the same string to
    // requireNativeComponent. If these drift, the view silently never resolves.
    expect(COMPONENT_NAME).toBe('CardSdkReactNativeView');

    const out = addTapCardInterop(APP_DELEGATE, 'objcpp');
    expect(out).toContain(
      '[RCTLegacyViewManagerInteropComponentView supportLegacyViewManagerWithName:@"CardSdkReactNativeView"];',
    );
  });

  it('adds the interop header import', () => {
    const out = addTapCardInterop(APP_DELEGATE, 'objcpp');
    expect(out).toContain('#import <React/RCTLegacyViewManagerInteropComponentView.h>');
  });

  it('registers INSIDE didFinishLaunching and BEFORE super', () => {
    // Order matters: registration has to happen before the first render, or the
    // allowlist check has already failed by the time the view mounts.
    const out = addTapCardInterop(APP_DELEGATE, 'objcpp');
    expect(
      /launchOptions\s*\{\n\s*\[RCTLegacyViewManagerInteropComponentView/.test(out),
    ).toBe(true);
    expect(out.indexOf('supportLegacyViewManagerWithName'))
      .toBeLessThan(out.indexOf('return [super application'));
  });

  it('is idempotent — prebuild runs repeatedly', () => {
    const once = addTapCardInterop(APP_DELEGATE, 'objcpp');
    const twice = addTapCardInterop(once, 'objcpp');
    expect(twice).toBe(once);
    expect((twice.match(/supportLegacyViewManagerWithName/g) ?? []).length).toBe(1);
  });

  it('accepts plain objc as well as objcpp', () => {
    expect(addTapCardInterop(APP_DELEGATE, 'objc')).toContain('supportLegacyViewManagerWithName');
  });

  it('THROWS on a Swift AppDelegate rather than skipping silently', () => {
    // Silently doing nothing would reproduce the exact failure this plugin
    // exists to prevent: a missing view whose error message blames the build.
    expect(() => addTapCardInterop('import UIKit', 'swift')).toThrow(/Objective-C/);
  });

  it('THROWS when the template no longer has the expected entry point', () => {
    expect(() => addTapCardInterop('#import "AppDelegate.h"\n@end\n', 'objcpp'))
      .toThrow(/didFinishLaunchingWithOptions/);
  });
});
