# Spicy Meal — Sentry Crash Reporting & Error Monitoring

## Identity

- **Organization**: `first-taste-trading-company`
- **Project**: `react-native` (mobile iOS + Android; JS + native layers)
- **DSN**: configured in `apps/mobile/src/lib/observability/config.ts`
  (override: `EXPO_PUBLIC_SENTRY_DSN`). The DSN is Sentry's **public
  ingestion identifier** — it ships in client bundles by design and is *not*
  a privileged secret.
- **`SENTRY_AUTH_TOKEN` IS a secret** (management/source-map upload). It
  lives ONLY in encrypted EAS/CI secret storage — never in the repository,
  never in `EXPO_PUBLIC_*`, never in logs, PRs, or reports. `.sentryclirc`
  is gitignored.

## What is integrated (mobile app, `apps/mobile`)

- SDK: `@sentry/react-native` (installed by the official wizard), Expo
  config plugin `@sentry/react-native/expo` (native init + release-build
  source-map upload) and `getSentryExpoConfig` Metro wrapper (Debug IDs).
- Initialization: **once**, at the top of `src/app/_layout.tsx` via
  `initObservability()`; root component wrapped with `Sentry.wrap`.
- Coverage: native iOS/Android crashes (release builds), unhandled JS
  errors, unhandled promise rejections, React render errors (root
  `ObservabilityErrorBoundary` with a bilingual, stack-free fallback), and
  conservative startup tracing. Expo Router navigation-span instrumentation is
  intentionally disabled on the Expo SDK 57 / Sentry 7.11 compatibility line
  and should be restored only after upgrading to a compatible Sentry release.
- Off by policy: session replay (0/0), screenshots, view hierarchy,
  profiling (0), user-interaction tracing AND interaction breadcrumbs (the
  `Sentry.wrap` touch boundary's `touch` crumbs and every `ui.*` crumb —
  including `ui.multiClick` rage taps — are dropped in `beforeBreadcrumb`
  in every environment; they carry component paths and labels of tapped
  UI), failed-request capture, `sendDefaultPii`. Enabling any of these
  needs explicit owner approval.
- **Web/admin**: covered separately — the Expo web export (`/app`) and the
  Vite admin console initialize the browser SDK via a platform-resolved
  `index.web.ts` and `src/lib/observability` respectively; native builds are
  unaffected. See `SENTRY_WEB_OBSERVABILITY.md`.

## Environments

| Environment | Source | Reports? |
| --- | --- | --- |
| `development` | `__DEV__` / EAS `development` profile | only with `EXPO_PUBLIC_SENTRY_DEV=1` |
| `preview` | EAS `preview` profile (`EXPO_PUBLIC_SENTRY_ENV`) | yes (traces ≤ 0.20) |
| `production` | EAS `production` profile | yes (traces 0.08) |

Test runners (vitest/jest) are always disabled. Events from the three
environments are fully distinguishable in Sentry via the `environment` field.

## Release naming

The SDK's native default is used — `<bundle id>@<version>+<build>`:
`com.spicymeal.app@1.0.0+<iOS build>` / `sa.com.spicymeal.app@1.0.0+<versionCode>`.
Build numbers come from EAS **remote** versioning (production auto-increment),
so releases always match the store binaries. The contract is pinned by
`buildSentryRelease` unit tests.

## Source maps

Upload is **gated on `SENTRY_AUTH_TOKEN` on both surfaces, conditionally**, so a
missing token degrades to "no source maps" rather than "no build" — and both
surfaces begin uploading automatically the moment the token exists. **There is
no flag to remember to switch off.**

| Surface | Gate | Location |
| --- | --- | --- |
| Mobile (EAS) | the `@sentry/react-native/expo` config plugin is dropped when the token is absent | `apps/mobile/app.config.js` |
| Web / admin (Vercel) | the Sentry Vite plugin is skipped and `sourcemap` falls back to `false` | `vite.config.ts` |

`apps/mobile/app.json` stays the single source of truth for every static field,
including the Sentry plugin's organization/project/url. `app.config.js` receives
it and — **only when the token is absent** — returns it with the Sentry plugin
filtered out. When the token is present it hands the config back untouched.

**Why the gate exists.** The config plugin wires the native source-map /
debug-symbol upload into release builds. Without a token that step fails and
takes the whole build with it (`createBundleReleaseJsAndAssets_SentryUpload` →
*"Auth token is required for this request"*), which previously blocked **all**
production mobile builds, including hotfixes, on a monitoring dependency.

**Crash reporting is not affected by the gate.** The native SDK is autolinked
from the `@sentry/react-native` dependency and started by `Sentry.init()`; Debug
IDs come from the `getSentryExpoConfig` Metro wrapper in `metro.config.js`. Only
build-time upload wiring is conditional. Events flow in every case — stack
traces are simply unsymbolicated until a token is configured.

**`SENTRY_DISABLE_AUTO_UPLOAD` on development and preview is deliberate.** Those
profiles must never upload source maps even when a token is present in the
environment. The `production` profile carries **no** such flag — adding one back
would suppress uploads even once the token exists, defeating the gate.

- **Owner action (one-time, Issue #81)**: create the EAS secret —
  `eas env:create --scope project --name SENTRY_AUTH_TOKEN --visibility secret`
  (or via the Expo dashboard) — and add the same variable in Vercel for
  Production. **No code change is needed**; both gates self-correct. For any
  future GitHub-side upload steps, use a GitHub Actions encrypted secret with
  the same name (the repo already uses this pattern for `EXPO_TOKEN`).
- Treat an unsymbolicated production release as a **release-blocker** per the
  launch checklist below. That policy is unchanged; what changed is that the
  build completes, so shipping unsymbolicated is a deliberate human decision
  rather than a build failure.
- Never commit maps (`*.js.map` gitignored); never serve maps publicly.

## Safe capture API (use this, not `@sentry/react-native` directly)

`apps/mobile/src/lib/observability`:

- `captureException(err, { subsystem, op, code, extra, tags })`
- `captureMessage(msg, { subsystem, level })`
- `addSafeBreadcrumb({ category, message, data })`
- `setOperationalContext(tags)`
- `withErrorMonitoring(fn, ctx)`

Subsystem tags: `auth`, `menu`, `branch`, `cart`, `checkout`, `payment`,
`orders`, `lazywait`, `account_deletion`, `notifications`,
`operations_health`, `operations_alerts`, `app`.

Pass **safe error codes and small scalars** — never customer/order/payment
objects, sessions, or raw HTTP payloads. Everything is deep-sanitized anyway
(see below), but the contract is codes + names, not payloads.

## Error classification

| Disposition | Meaning | Examples |
| --- | --- | --- |
| captured exception | unexpected technical failure | undefined crashes, invariant violations, checkout init exceptions, payment-return parsing errors, order persistence failure after verified payment, native crashes |
| captured warning | notable but non-fatal (`captureMessage`) | fallback paths taken, recoverable inconsistencies |
| breadcrumb only | expected, UI-handled outcome | offline/`Network request failed`, aborted requests, invalid coupon, closed branch, item unavailable, OTP retry/rate limit, payment cancelled/declined-by-bank, expired session with re-login |
| ignored | dev console noise in release builds | console breadcrumbs outside development |

The full pattern list lives in `observability/classify.ts` (unit-tested).
`beforeSend` applies the same classification to *unhandled* rejections, so an
offline fetch that escapes a catch block still doesn't page anyone.

## PII & sanitization (always on)

Key-name redaction (`authorization`, `cookie`, `token`, `jwt`, `otp`,
`phone`, `email`, `address`, `lat`/`lng`, `payment`, `tap`, `card`,
`customer`, `profile`, `push_token`, `device_token`, `lazywait`, `secret`,
`api_key`, `session`, …) plus value-pattern scrubbing (JWTs, bearer values,
emails, Saudi/international phone numbers, card-like digit runs, Tap-style
references, high-precision coordinates) across events, transactions,
breadcrumbs, headers and URLs; request bodies/cookies/query strings are
dropped entirely; `user` is reduced to a pseudonymous id. Safe diagnostics
(status codes, `safe_error_code`, subsystem/op, route templates, durations,
retry counts, platform/environment/release) pass through. All rules are
unit-tested in `sanitize.test.ts`.

## Verifying crash reporting (internal only)

1. Run a **development** build with `EXPO_PUBLIC_SENTRY_DEV=1`.
2. Navigate manually to `/dev-sentry` (linked from nowhere; release builds
   redirect home — customers can never reach it).
3. Send the test message → check Sentry (`environment:development`).
4. Send the handled exception → arrives with `safe_error_code:DEV_TEST_EXCEPTION`.
5. Optional: "Trigger test crash…" (confirmation dialog) → error boundary
   shows the bilingual fallback and the crash event arrives.

**Never** run verification against a production-environment build; Production
must not receive test events.

## Verifying the source-map gate

The gate is plain config resolution, so it can be checked without a build, a
real token, or any network call. Run both — they cover different things.

**1. The gate logic itself.** Exercises `app.config.js` directly against the real
`app.json`, so it depends on no CLI flags and no Expo version behaviour:

```bash
cd apps/mobile
node -e "const c=require('./app.json').expo; const f=require('./app.config.js');
console.log('no token :', f({config:c}).plugins.length);
process.env.SENTRY_AUTH_TOKEN='dummy';
console.log('token    :', f({config:c}).plugins.length);"
# expect   no token : 4   |   token : 5
```

**2. End-to-end resolution through Expo:**

```bash
cd apps/mobile
npx expo config --type prebuild --json \
  | grep -c '@sentry/react-native/expo'                                        # expect 0
SENTRY_AUTH_TOKEN=dummy npx expo config --type prebuild --json \
  | grep -c '@sentry/react-native/expo'                                        # expect 1
```

Use a throwaway value — **never paste the real token into a shell.**

> ⚠️ **Use `--type prebuild`, not `--type public`.** The public config is the
> client manifest; `plugins` is build-time configuration and is not reliably
> present in it. A `--type public` check can therefore print `0` in **both**
> cases — the "expect 0" assertion passes trivially and the "expect 1"
> assertion fails even when the gate is working correctly. A check that cannot
> fail is worse than no check.

Neither command proves that omitting the plugin leaves **native crash capture**
intact — config resolution cannot show that. The first production EAS build is
the definitive check: it should complete, and Sentry should still receive events
from that build.

## Triage workflow

- **Native vs JS**: native crashes show signal/`EXC_*` info and an
  unsymbolicated native frame set until maps/dSYMs upload; JS errors carry a
  JS stack and (boundary errors) `mechanism:react_error_boundary` +
  `component_stack`.
- **Search**: `environment:production release:com.spicymeal.app@1.0.0+42
  subsystem:checkout` — subsystem/op/safe_error_code are tags on every
  safe-API event.
- **Mute expected noise**: prefer adding a pattern to `classify.ts` (with a
  test) over Sentry-side ignores, so the rule is reviewed and versioned.
  Sentry-side "Ignore" is acceptable for one-off third-party noise.
- **Adding context**: only via `setOperationalContext`/`addSafeBreadcrumb`
  with safe scalars. Prohibited forever: names, phones, emails, addresses,
  coordinates, OTPs, tokens, payment references, card data, raw payloads.

## Launch-day verification

1. Latest production build appears under Releases with the expected
   `<bundle id>@<version>+<build>` name.
2. Source maps/dSYMs attached (symbolicated sample stack). Requires the
   `SENTRY_AUTH_TOKEN` secret (Issue #81); no code change is needed once it
   exists.
3. `environment:production` receiving sessions; crash-free rate visible.
4. No PII in a sample of events (spot-check request/user/breadcrumbs).
5. Alerts routing (Sentry alert rules) configured to the team — owner action
   in the Sentry UI.

## Rollback / disable

- **Config-level**: set `enabled: false` via a reviewed PR (initObservability
  gate) and ship a new build; or disable the `EXPO_PUBLIC_SENTRY_DEV` flag
  for dev noise.
- **Server-level (immediate, no build)**: disable the DSN key in Sentry →
  ingestion stops instantly for all existing builds.
- **Upload only**: unset `SENTRY_AUTH_TOKEN` in the EAS/Vercel environment —
  both gates fall back to "no upload" and builds keep succeeding.
- Never delete history; never rotate the DSN in a hurry without updating
  `EXPO_PUBLIC_SENTRY_DSN` in the next build.
