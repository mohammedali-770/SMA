# Spicy Meal — Sentry Error Monitoring: Web & Admin Dashboard

Companion to `SENTRY_OBSERVABILITY.md` (mobile). One Sentry org/project, one
privacy pipeline, three tagged surfaces.

## Identity

- **Organization**: `first-taste-trading-company`
- **Project**: `react-native` (shared with mobile — one project keeps triage,
  alert rules and the Issue #81 token setup in one place; surfaces are fully
  separable by tags, so a dedicated web project was not technically necessary)
- **DSN**: the same owner-provided **public** ingestion identifier as mobile,
  pinned in `apps/mobile/src/lib/observability/webConfig.ts`
  (`WEB_DEFAULT_SENTRY_DSN`; a unit test keeps it identical to the mobile
  constant). Overrides: `VITE_SENTRY_DSN` (admin) / `EXPO_PUBLIC_SENTRY_DSN`
  (expo-web).
- **`SENTRY_AUTH_TOKEN` IS a secret** — see Issue #81 (the single shared owner
  action). Only ever in encrypted CI/Vercel/EAS secret stores; never in the
  repository, logs, PRs, or browser-visible (`VITE_*`/`EXPO_PUBLIC_*`) vars.

## Supported surfaces

| Surface tag (`app_surface`) | App | Runtime | Init location |
| --- | --- | --- | --- |
| `admin-web` | staff console (root Vite app) | `@sentry/react` 10.x | `src/main.tsx` → `src/lib/observability` |
| `expo-web` | customer app at `/app` (Expo web export) | `@sentry/react` 10.x | `apps/mobile/src/lib/observability/index.web.ts` |
| *(none — mobile)* | iOS/Android | `@sentry/react-native` 8.x | unchanged (PR #80) |

- Metro platform resolution loads `index.web.ts` **only** for web builds;
  native builds keep the merged mobile implementation byte-for-byte.
- Both web surfaces share ONE implementation
  (`apps/mobile/src/lib/observability/webCore.ts`) plus the framework-free
  sanitize/classify/webConfig/webRoutes modules — all unit-tested at the root.
- **No SSR exists** (static Vite build + static Expo export behind Vercel
  rewrites), so no server-side SDK is installed. Supabase Edge Functions are
  backend and out of scope.

## Filtering events by surface

- Admin console: `app_surface:admin-web`
- Customer web app: `app_surface:expo-web`
- Mobile: no `app_surface` tag; `sdk.name:sentry.javascript.react-native`

## Environments & release

Resolution order (`resolveWebEnvironment`, unit-tested): explicit
`VITE_SENTRY_ENV`/`EXPO_PUBLIC_SENTRY_ENV` → Vercel build env
(`VITE_VERCEL_ENV`; the expo-web export receives `VERCEL_ENV` via
`scripts/export-web.js`) → hostname heuristics (`localhost` → development,
`…-git-….vercel.app` → preview) → dev builds development, else production.

Reporting policy (identical to mobile): test runners **never**; development
**only** with `VITE_SENTRY_DEV=1` / `EXPO_PUBLIC_SENTRY_DEV=1`;
preview/production always.

Release: `spicy-meal-web@<12-char commit sha>` for both web bundles (they
deploy atomically from one commit; Vercel exposes the sha). Locally the
release is unset. Symbolication itself uses Debug IDs, not release names.

## Sampling

| Environment | traces | profiling |
| --- | --- | --- |
| production | 0.05 | 0 |
| preview | 0.15 | 0 |
| development | 0 | 0 |

Off by policy everywhere (owner approval required to enable): session replay,
screenshots, user-feedback widget, profiling, INP/long-task instrumentation,
interaction breadcrumbs, `sendDefaultPii`.

## Coverage

Unhandled browser errors + unhandled promise rejections (SDK global handlers),
React render errors (root boundaries: new `src/components/
ObservabilityErrorBoundary.tsx` for admin; the existing mobile boundary works
unchanged on expo-web), pageload/navigation transactions with **templated**
names, and handled failures via the safe API.

### Route normalization (`webRoutes.ts`, unit-tested)

`/orders/7c2f…` → `/orders/[id]` · `/customers/0501234567` →
`/customers/[id]` · `/payments/tap_x` → `/payments/[id]` ·
`/admin/orders?id=42#x` → `/admin/orders`. UUIDs, numeric ids, hex ids,
provider-prefixed refs, phone/email-shaped and long opaque segments all
become `[id]`; query strings and fragments are dropped entirely. Applied to
transaction names AND navigation breadcrumbs.

## Safe capture API (use this, never `@sentry/react` directly)

Admin: `src/lib/observability` · Expo-web: same `../lib/observability` API as
native. Functions: `captureWebException` / `captureWebMessage` /
`addSafeWebBreadcrumb` / `setSafeWebContext` / `withWebErrorMonitoring`
(+ the mobile-named equivalents on expo-web). Pass **safe error codes and
small scalars** — subsystem, op, `safe_error_code`, status, duration, retry
count. Never customer/order/payment/profile objects, sessions, raw bodies,
DOM or form contents.

## Expected-error classification

Shared mobile list (offline, aborts, coupons, closed branch, OTP retry, bank
decline, expired session …) **plus** web-only noise (ResizeObserver loops,
AbortError). Chunk/dynamic-import failures are deliberately **captured**
(deploy version-skew signal) even though they contain "failed to fetch".
Rules live in `classify.ts` + `webClassify.ts`, both unit-tested; add new
patterns there (with tests) rather than Sentry-side ignores.

## Privacy & sanitization (always on)

Same engine as mobile (`sanitize.ts`): sensitive-key redaction, value-pattern
scrubbing (JWTs, bearer values, emails, Saudi/international phones, card-like
digit runs, Tap refs, coordinates), URL query+fragment stripping on every
text surface, span walking, header sanitization, cookies/bodies dropped,
`user` reduced to a pseudonymous id (web attaches **no** user identity at
all). Breadcrumbs: `touch`/`ui.*` (clicks, inputs, DOM) dropped everywhere;
console dropped outside development; http crumbs keep method/status/clean URL
only; navigation crumbs keep templated from/to. Browser-extension frames are
denied (`denyUrls`).

### Admin Dashboard restrictions (strictest)

Never capture: table contents, customer/order/payment records,
account-deletion requests, alert/digest payloads, health snapshot payloads,
integration credentials, staff identities, search or filter values, exports.
Only panel/operation names, safe error codes, HTTP status, latency, counts.
No admin user identity is attached in v1.

## Source maps

- **Admin (Vite)**: `@sentry/vite-plugin` in `vite.config.ts`, active **only
  when `SENTRY_AUTH_TOKEN` exists** in the build environment. It then builds
  hidden source maps, uploads them, and **deletes every `.map` from `dist/`**
  before deploy. Without the token (local, preview, today's CI): no maps
  generated, no upload, no failure — build output is unchanged.
- **Expo web**: exported through `getSentryExpoConfig` (Debug IDs already in
  place from PR #80); the export emits no public `.map` files. Upload for the
  web export is wired the same token-gated way once Issue #81 is done
  (`npx sentry-expo-upload-sourcemaps` can backfill if ever needed).
- **Owner action**: Issue #81 (unchanged, single shared action) — add
  `SENTRY_AUTH_TOKEN` to Vercel (Production env) in addition to EAS. Until
  then web events are ingested but unsymbolicated — acceptable pre-launch,
  a release-blocker at launch per the mobile checklist.
- `*.js.map` is gitignored; never commit maps; never serve maps publicly.

## CSP

The deployed CSP (`vercel.json`) includes
`https://o4511778933243904.ingest.de.sentry.io` in `connect-src` — required
for ingestion from both web surfaces. `SENTRY_INGEST_ORIGIN` in
`webConfig.ts` pins the value under test. If the DSN is ever rotated, update
both together.

## Local development & verification

1. Nothing is sent by default (`development` + no opt-in flag).
2. Admin: run `VITE_SENTRY_DEV=1 npm run dev`, open the browser console and
   use `__spicySentryTest.status() / .message() / .exception() /
   .rejection()` — the hooks are registered only in dev builds (`import.meta.
   env.DEV` guard + dynamic import) and do not exist in production bundles.
3. Expo web: `EXPO_PUBLIC_SENTRY_DEV=1 npx expo start --web` and visit
   `/dev-sentry` (unchanged screen; release builds redirect home).
4. Check events arrive with `environment:development` and the right
   `app_surface` tag. **Never** run verification against production.

## Rollback / disable

- **Server-level (immediate, no build)**: disable the DSN key in Sentry —
  stops ingestion for mobile AND web (shared project).
- **Config-level**: revert the init call in `src/main.tsx` (admin) or ship a
  build with `VITE_SENTRY_ENV`-gated disable via a reviewed PR; for expo-web,
  the `EXPO_PUBLIC_SENTRY_DSN` override can point at nothing only via a
  reviewed PR — prefer the server-level kill switch for urgency.
- Removing the CSP entry also hard-stops browser ingestion (deploy required).

## Triage

Search per surface (`app_surface:...`), then `subsystem` / `op` /
`safe_error_code` tags as on mobile. `mechanism:react_error_boundary` marks
render crashes with a sanitized `component_stack`. Symbolication status:
until Issue #81 is complete, web stacks show minified frames — correlate via
release `spicy-meal-web@<sha>` and Debug IDs after the token exists.
