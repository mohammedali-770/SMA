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
  `ObservabilityErrorBoundary` with a bilingual, stack-free fallback),
  Expo Router navigation spans with **templated** paths (`/product/[id]`,
  never raw ids), conservative startup/screen tracing.
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

> ### ⚠️ Source-map upload is currently DISABLED on every EAS profile
>
> `apps/mobile/eas.json` sets `SENTRY_DISABLE_AUTO_UPLOAD: "true"` on
> **development**, **preview** and **production**. Production stack traces are
> therefore **unsymbolicated**, and crash reports still arrive normally —
> ingestion is unaffected, only symbolication is.
>
> **This flag MUST be removed from the `production` profile at the same time as
> the `SENTRY_AUTH_TOKEN` EAS secret is created (Issue #81).** If the secret is
> added while the flag remains, uploads will silently never happen and the
> release will look correctly configured while staying unsymbolicated — a worse
> failure than the build error it replaced, because nothing fails loudly.

**Why the flag exists.** `production` was previously the only profile without
it, so it alone attempted the upload and every production build failed at
`createBundleReleaseJsAndAssets_SentryUpload` with *"Auth token is required for
this request"*. That blocked **all** production mobile builds, including
hotfixes, on a monitoring dependency. Production now degrades instead of
blocking.

**Note the asymmetry with web.** `vite.config.ts` gates upload *conditionally*
on the token being present (`Boolean(process.env.SENTRY_AUTH_TOKEN)`), so the
web build needs no flag and self-corrects the moment the token exists. The EAS
flag is **static** — `eas.json` env values support no interpolation — so it does
not self-correct and requires the manual removal described above.

- Uploaded automatically **during EAS release builds** by the Sentry Expo
  plugin when `SENTRY_AUTH_TOKEN` is present in the build environment **and**
  `SENTRY_DISABLE_AUTO_UPLOAD` is not set.
- **Owner action (one-time)**: create the EAS secret —
  `eas env:create --scope project --name SENTRY_AUTH_TOKEN --visibility secret`
  (or via the Expo dashboard) — **and** delete `SENTRY_DISABLE_AUTO_UPLOAD`
  from the `production` block of `apps/mobile/eas.json` in the same change. For
  any future GitHub-side upload steps, use a GitHub Actions encrypted secret
  with the same name (the repo already uses this pattern for `EXPO_TOKEN`).
- Treat an unsymbolicated production release as a **release-blocker** per the
  launch checklist below. That policy is unchanged; what changed is that the
  build now completes so the decision is a human one rather than a build
  failure.
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
2. Source maps/dSYMs attached (symbolicated sample stack). **Blocked today** —
   see the Source maps warning above; requires the `SENTRY_AUTH_TOKEN` secret
   *and* removal of `SENTRY_DISABLE_AUTO_UPLOAD` from the production profile.
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
- Never delete history; never rotate the DSN in a hurry without updating
  `EXPO_PUBLIC_SENTRY_DSN` in the next build.
