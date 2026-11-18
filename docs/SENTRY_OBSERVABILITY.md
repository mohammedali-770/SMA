# Spicy Meal — Mobile Sentry Observability

> **Updated 2026-11-10.** Current mobile compatibility baseline: Expo SDK 58 / React Native 0.88.1 / `@sentry/react-native` 8.28.x. Until then it was Expo SDK 57 / React Native 0.86.2 / 7.11.x (recorded 2026-08-12).

## Identity

- Sentry organization: `first-taste-trading-company`
- Project: `react-native`
- Native app: `apps/mobile/`
- DSN: public ingestion identifier resolved by the checked-in observability config (overrideable through the documented public DSN env variable)
- `SENTRY_AUTH_TOKEN`: **secret build-time management/source-map credential**, never a client-public variable

The DSN may ship in a client bundle; the auth token may not.

## Current integration

Mobile uses:

- `@sentry/react-native` on the Expo SDK 58-compatible 8.28.x line. It moved from 7.11.x with the SDK 58 upgrade. Sentry's [v7 to v8 guide](https://docs.sentry.io/platforms/react-native/migration/v7-to-v8/) lists only build-tooling and minimum-version changes (iOS 15+, Xcode 16.4+, Android Gradle Plugin 7.4+, Kotlin 1.8+), and no change to what is collected;
- `@sentry/react-native/expo` config plugin;
- Sentry-aware Metro configuration / Debug IDs;
- initialization from the mobile root observability module;
- a root error boundary with a safe bilingual fallback.

Coverage includes native/JS release crashes, unhandled JS errors/rejections, React render failures and conservative tracing.

### Expo Router navigation instrumentation

Expo Router navigation-span integration is **intentionally disabled**. It stayed disabled through the move from 7.11 to 8.28 on 2026-11-10: the upgrade changed versions, not this decision. Do not re-add an API from a newer Sentry major just because an old example uses it.

**Since 8.x the SDK turns it ON by default, so the decision is now enforced in code.**
`@sentry/react-native` 8 adds its `ExpoRouter` integration whenever tracing is on, and
ours is (the sample rates are numbers). In 8.28.0 it does nothing, but only by accident:
it requires an expo-router internal path that expo-router 58 no longer ships. Sentry
8.33 rewrote that lookup, so an upgrade would switch navigation spans and breadcrumbs on
with no change here. So `Sentry.init` receives the SDK defaults minus `ExpoRouter`
(`DISABLED_DEFAULT_INTEGRATIONS` in `src/lib/observability/config.ts`). `config.test.ts`
pins the filter, the wiring and the integration's name in the installed SDK.

Metro prints a warning about `expo-router/build/global-state/router-store` during
native builds. It is that same missing path, and it is expected.

Restore navigation instrumentation only after upgrading to a Sentry version verified compatible with the installed Expo/RN stack, by removing the name from that list.

## Android release builds are minified — added 2026-11-10, decided 2026-11-18

From the Expo SDK 58 upgrade, Android release builds run R8, set explicitly in
`apps/mobile/app.json` (`expo-build-properties`,
`android.enableMinifyInReleaseBuilds`). R8 renames Java and Kotlin classes, so
**native Android stack frames in Sentry are obfuscated** unless R8's mapping file
is uploaded.

**Decided 2026-11-18 by the owner: mapping upload is ON.** It takes effect at the
next EAS Android build; every build before it stays obfuscated (see below).

- **JavaScript stack traces are unaffected.** They come from the Hermes bundle
  and its Debug IDs, not from R8.
- **How it is on.** The Sentry plugin entry in `app.json` carries an
  `experimental_android` block with `enableAndroidGradlePlugin: true`, which makes
  the installed plugin (`@sentry/react-native` 8.28.0,
  `plugin/build/withSentry.js:62-70`) apply the Sentry Android Gradle Plugin
  (SAGP) 6.22.0 (`plugin/build/withSentryAndroidGradlePlugin.js`). Sentry still
  calls the option experimental. Every sub-option is set explicitly, not left to
  a default:

  | Option | Value | Why |
  | --- | --- | --- |
  | `includeProguardMapping` | `true` | builds the ProGuard UUID into the app and bundles the mapping |
  | `autoUploadProguardMapping` | `true` | written as `shouldSentryAutoUpload()`, so `SENTRY_DISABLE_AUTO_UPLOAD=true` still stops it |
  | `uploadNativeSymbols`, `autoUploadNativeSymbols` | `false` | NDK symbols were never uploaded; out of scope for this decision |
  | `includeNativeSources`, `includeSourceContext` | `false` | no source code leaves the build |
  | `dexguardEnabled` | `false` | R8, not DexGuard |

- **What SAGP does NOT do here, and why that holds.** The plugin hard-codes
  `autoInstallation { enabled = false }` and `tracingInstrumentation { enabled =
  false }` into the Gradle block it writes (`withSentryAndroidGradlePlugin.js:61-66`);
  neither is an option. Both matter. SAGP 6.22.0's auto-install defaults ON and
  would pin `sentry-android` 8.56.0, below the 8.57.0 the RN SDK expects
  (`sentry.gradle.kts:21`), and tracing instrumentation rewrites OkHttp, Room and
  file I/O bytecode. `sentryAndroidMapping.test.ts` runs the installed plugin and
  fails if either line changes in a future SDK.
- **What SAGP still does that the Expo plugin cannot switch off.** Read from the
  SAGP 6.22.0 jar on 2026-11-18, stated rather than buried:
  - `runtimeOptimizations` defaults ON. It rewrites two classes of the Sentry
    Android SDK at build time (`io.sentry.util.LoadClass` and
    `io.sentry.android.core.ManifestMetadataReader`) so they read values computed
    at build time from the resolved dependencies and the merged manifest. It is
    meant to change startup cost, not behaviour. It is not instrumentation of app
    code.
  - `telemetry` defaults ON: SAGP reports its own build-time errors and timings to
    Sentry's SaaS. That is build-machine data, not customer data.
  - `includeDependenciesReport` defaults ON: a list of the app's Java
    dependencies goes into the app bundle as an asset.

  Turning any of these off would need hand-written Gradle in a local config plugin,
  which this repository cannot run here (no Android SDK) and which the upstream
  plugin does not offer. Raise it as its own change if any of them matters.
- **No token, no SAGP.** `app.config.js` removes the whole Sentry plugin when
  `SENTRY_AUTH_TOKEN` is absent, so a tokenless build applies neither the JS
  source-map upload nor SAGP and cannot fail on either. Verified 2026-11-18 by
  `expo prebuild --platform android` with and without a dummy token: with it, the
  only change against the previous `app.json` is the SAGP classpath in
  `android/build.gradle`, `apply plugin: "io.sentry.android.gradle"` and the
  `sentry { ... }` block in `android/app/build.gradle`; without it, nothing
  Sentry-related is generated at all.
- **A build already shipped stays obfuscated.** Sentry matches a mapping to an
  event through a ProGuard UUID that SAGP builds into the app
  (`io.sentry.proguard-uuid`). A build made without the plugin carries none, so no
  later upload can de-obfuscate it.
- **Preview builds bundle the UUID but do not upload.** `eas.json` sets
  `SENTRY_DISABLE_AUTO_UPLOAD=true` for development and preview, which the Gradle
  block honours. A preview test of the upload itself needs that unset and the
  token present in the preview environment.
- **Play Console still de-obfuscates production crashes.** AGP puts the mapping
  inside each app bundle, so Android vitals and a manual retrace keep working.
- **R8 is this repository's choice, not an SDK 58 default.** The SDK 58 template still
  defaults `enableMinifyInReleaseBuilds` to false; only the `app.json` setting turns
  it on.

### Verify it on the first Android production build after 2026-11-18

None of this has run in Gradle yet: no Android SDK is available where it was
written, so the prebuild output is the strongest evidence so far.

1. **The build log shows the upload.** Look for the
   `uploadSentryProguardMappings<Variant>` task (for this app
   `uploadSentryProguardMappingsRelease`) running, not skipped, and sentry-cli
   reporting the mapping uploaded. A `WARNING: @sentry/react-native depends on
   sentry-android 8.57.0, but version … was resolved` line means a second SDK
   copy got in, and is a failure.
2. **Sentry holds the mapping.** In the `react-native` project, Settings → Debug
   Files (ProGuard) lists a mapping uploaded at the build's time.
3. **A native frame reads as real names.** An approved test event from a native
   Android path on that build shows `io.sentry.…` / `sa.com.spicymeal.app.…`
   class and method names, not one-letter names. Sending a test event from a
   production build is an owner-approved action.

If the build fails in a Sentry task, the fastest revert is
`"enableAndroidGradlePlugin": false` in `app.json`; that leaves JS source maps
and crash reporting exactly as they were.

## Environment behavior

| Environment | Reporting |
| --- | --- |
| development | disabled unless explicitly enabled for development testing |
| preview | enabled under preview environment tagging |
| production | enabled |
| unit tests | disabled |

Production/preview events must remain distinguishable by Sentry environment/release metadata.

## Release naming/versioning

Native release/build identity follows the app bundle/package and EAS remote versioning.

Production EAS uses remote versioning and auto-increment. Do not hard-code a build number into this document as if it were permanent.

## Source maps and `SENTRY_AUTH_TOKEN`

`apps/mobile/app.config.js` dynamically removes the Sentry Expo config plugin when `SENTRY_AUTH_TOKEN` is absent. This prevents a missing upload credential from turning every build into a native build failure.

Important distinction:

- SDK crash reporting can still initialize without the upload token;
- build-time source-map/debug-symbol upload needs the token/config plugin;
- a successful build without symbol upload is not equivalent to a fully observable production release.

The Aug 11 iOS release-readiness work recorded `SENTRY_AUTH_TOKEN` in the EAS production environment and verified the resolved production config included the Sentry plugin.

**What CI checks, since 2026-11-12.** A `production` run of
`.github/workflows/eas-build.yml` lists the EAS `production` environment's
variable names (`eas env:list production --format short`, project and account
scope, eas-cli 25.3.0) and refuses to start the build unless
`SENTRY_AUTH_TOKEN` is among them. The listing's output is captured and never
printed, because a plaintext variable's value would be in it; only the answer
and a count reach the log. Before that date the step tested a **GitHub Actions
secret** of the same name, which the cloud build never reads: it passed when EAS
had lost the token and blocked a correct build when only EAS held it. That
GitHub secret is no longer read by any workflow. The check proves the variable
exists, not that the token works.

Do **not** reintroduce the old action item “create the token” as if it is still known missing. Instead, for every production release verify the current secret/environment and successful upload because secrets can expire, be rotated or be removed outside Git.

Never:

- commit `SENTRY_AUTH_TOKEN`;
- put it in `EXPO_PUBLIC_*`;
- print it in CI/build logs;
- commit generated source maps;
- serve source maps publicly as a workaround.

## Privacy policy for captured telemetry

The observability layer is intentionally conservative.

Do not enable without separate approval:

- session replay;
- screenshots;
- view hierarchy capture;
- profiling;
- broad interaction/touch breadcrumbs;
- default PII collection;
- raw request/response capture.

The safe observability wrappers/sanitizers exist specifically to avoid provider/customer/payment/auth payloads entering Sentry.

### Never send

- Authorization/cookie/session/JWT values;
- OTPs;
- full phone/email/address data;
- precise latitude/longitude;
- payment/card/provider payloads;
- raw order/customer/profile objects;
- secret configuration;
- full HTTP request/response bodies.

Prefer subsystem/operation identifiers, bounded error codes and small non-PII scalars.

## Safe capture API

Use the repository observability abstraction under `apps/mobile/src/lib/observability` rather than importing Sentry directly throughout feature code.

Typical operations include:

- capture exception through the safe wrapper;
- capture bounded warning/message;
- safe breadcrumb;
- operational tags/context;
- monitored function wrapper.

If a new failure class needs telemetry, add it to the shared classification/sanitization layer with tests rather than bypassing that layer at the call site.

## Expected versus unexpected failures

Expected customer/network/business outcomes generally should not become crash issues:

- offline/network unavailable;
- aborted request;
- invalid/expired coupon;
- closed/unavailable branch/item;
- OTP retry/cooldown/rate limit;
- user-cancelled or bank-declined payment states where the product handles them;
- expired session requiring re-authentication.

Unexpected technical/integrity failures should be captured through the safe wrapper.

Classification rules live in the source/tested observability modules; those are the authority when this list differs from code.

## Native release validation

For the next approved production/native Build 5:

- [ ] EAS production environment exposes `SENTRY_AUTH_TOKEN` to the build without logging it.
- [ ] Resolved Expo config includes the Sentry plugin.
- [ ] Build completes without Sentry/native framework mismatch.
- [ ] App cold-launches on a physical device.
- [ ] An approved safe test error arrives in the correct environment/release.
- [ ] Stack is symbolicated/source-mapped as expected.
- [ ] No PII appears in the event/breadcrumb payload.

Starting that build/test still follows the owner-approval release boundary.

## Related files/docs

- `apps/mobile/app.json` — static Expo/Sentry plugin config.
- `apps/mobile/app.config.js` — token-aware plugin gating.
- `apps/mobile/metro.config.js` — Sentry-aware Metro config.
- `apps/mobile/src/lib/observability/` — runtime capture/sanitize/classify logic.
- `docs/SENTRY_WEB_OBSERVABILITY.md` — admin + Expo-web monitoring.
- `docs/RELEASE_CHECKLIST.md` — release verification.