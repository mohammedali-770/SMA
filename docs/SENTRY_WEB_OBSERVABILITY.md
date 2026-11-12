# Spicy Meal — Web / Admin Sentry Observability

> **Updated 2026-11-11.** Companion to `SENTRY_OBSERVABILITY.md` for the two browser surfaces built and deployed together.
>
> **Measured 2026-11-11: neither web surface sends readable stack traces from production.** The admin-web source-map upload did not run for the production build, and `/app` has no source-map path at all. Detail under "Source maps" below.

## Surfaces

| Tag | Application | Runtime |
| --- | --- | --- |
| `admin-web` | staff/admin Vite application at `/` | `@sentry/react` browser SDK |
| `expo-web` | customer Expo web export at `/app` | browser observability implementation |
| native (separate) | iOS/Android Expo app | `@sentry/react-native` 8.28.x (`~8.28.0` in `apps/mobile/package.json` since the Expo SDK 58 upgrade) |

The two web surfaces share the same release commit but remain distinguishable by surface/environment tags.

## Identity and secrets

The web/admin surfaces use the same Sentry organization/project strategy as mobile.

- DSN is a public ingestion identifier and may be present in browser configuration.
- `SENTRY_AUTH_TOKEN` is a **server/build secret** used for source-map upload tooling and must never be exposed through `VITE_*` or `EXPO_PUBLIC_*`.

The Aug 11 native release work recorded the EAS production token setup. Vercel remains a separate environment: verify its current `SENTRY_AUTH_TOKEN` before relying on **admin-web** production symbolication rather than treating a historical setup statement as permanent truth.

**Read on 2026-11-11, it was not there.** The production console build carried none of the marks the upload leaves (next section), so the token was absent from the environment that built it.

## Initialization and release identity

- Admin initializes through the root web observability module.
- Expo web uses the platform-resolved browser observability implementation from the mobile tree.
- Both deploy from the same Vercel commit and use the repository's commit-derived web release identity.
- Test runners should not report production telemetry.
- Development reporting remains opt-in; preview/production reporting follows current source configuration.

The source modules/tests are the authority for exact sampling values; do not duplicate a numeric sampling table here that can silently drift from code.

## Source maps — two separate pipelines

Do **not** treat the two browser surfaces as having one source-map upload path.

### Admin web (`/`) — implemented in source, not running in production

`vite.config.ts` enables hidden Vite source maps only when `SENTRY_AUTH_TOKEN` exists, runs the official Sentry Vite plugin, uploads the maps, and removes them from the deployed output.

**Measured 2026-11-11 by plain GETs of the production site: the upload is not running.**

- The production console entry, `assets/main-CqsZiU3h.js`, and its `supabaseKey` chunk were built from commit `622a133`, which the entry inlines. Neither contains a Sentry debug ID: zero `sentry-dbid`, zero `_sentryDebugIdIdentifier`, no `sourceMappingURL`.
- The installed plugin (`@sentry/vite-plugin` 5.4.0) injects a debug ID into every JS chunk whenever it runs with source maps on. The injection is in the `renderChunk` hook of `@sentry/bundler-plugins`.
- So the plugin did not run for that build, which means `SENTRY_AUTH_TOKEN` was not in the environment that built it. On this project that is Vercel's own production build, because the gated GitHub deploy job is skipped (CLAUDE.md §13).

Until it is fixed, admin-web events reach Sentry with minified frames. The fix is a setting, not code: the owner adds `SENTRY_AUTH_TOKEN` to the Vercel project's Production environment as a sensitive build variable (`OWNER_ACTIONS.md` §11). The evidence that it worked is `sentry-dbid` in the next production `main-*.js`, then an approved test event with a readable stack.

For admin-web production symbolication:

- [ ] Vercel has the current `SENTRY_AUTH_TOKEN` secret (not a browser-visible env variable).
- [ ] Vite build runs the intended Sentry upload path.
- [ ] Vite source maps are not published as public assets.
- [ ] an approved **admin-web** test event resolves to the correct release and readable stack.

### Expo web (`/app`) — upload path not implemented yet

`apps/mobile/scripts/export-web.js` currently runs:

```text
expo export --platform web --clear --output-dir ../../dist/app
```

It injects public release/environment metadata, but it **does not generate/upload a separate Expo-web source-map set to Sentry** and deliberately does not read/forward `SENTRY_AUTH_TOKEN`.

**Measured 2026-11-11:** the production `/app` entry, `entry-cd9713086d63a9e558548cd8274fe48b.js` (commit `622a133`, about 4.4 MB), carries one Sentry debug ID but no `sourceMappingURL`, and a GET for its `.map` returns 403. No map is ever produced, so there is nothing to upload even once a token exists, and every `/app` event reaches Sentry with minified frames. Adding the token to Vercel does not change this; the export itself has to produce and upload maps.

Therefore:

- Expo-web runtime events can still reach Sentry with environment/release/surface metadata;
- a configured Vercel token and successful Vite upload prove **admin-web** symbolication only;
- do **not** mark `/app` source-map verification complete until a dedicated Expo-web map generation/upload path is implemented and tested;
- do not reuse/publish source maps as public assets as a workaround.

This is an observability gap, not a reason to expose the auth token to the customer bundle.

Do not log the token or put it in `VITE_*` / `EXPO_PUBLIC_*`.

## Privacy model

Web telemetry follows the same privacy principle as mobile: capture technical failure context, not customer/business payloads.

Never send:

- Auth headers, cookies, JWTs or session tokens;
- OTPs;
- email/phone/address values;
- map coordinates;
- payment/card/provider payloads;
- raw customer/order/profile records;
- form contents/DOM snapshots containing customer data;
- secret integration configuration.

Session replay, screenshots, user-feedback widgets, profiling, broad interaction breadcrumbs and default PII collection remain off unless separately approved.

## Route / URL normalization

Dynamic URLs must be normalized before they become transaction names or breadcrumbs. IDs, UUIDs, phone/email-shaped values, provider refs, query strings and fragments must not become telemetry identifiers.

Use the tested route/classification/sanitization modules in the repository rather than adding ad-hoc replacements at individual call sites.

## Safe capture API

Feature/admin code should use the repository observability wrappers instead of importing Sentry directly everywhere.

Safe context means:

- subsystem;
- operation;
- bounded error code;
- status/result class;
- duration/retry count where non-sensitive;
- normalized route/release/environment.

Do not pass whole Supabase/provider result objects for “debugging.”

## Error classification

Expected operational/browser noise should be classified rather than flooding Sentry:

- normal offline/abort outcomes;
- known validation/business outcomes;
- expected auth/session expiry;
- known browser noise already handled by source classification.

Deployment/version-skew failures such as a missing dynamic chunk are useful production signals and should not be hidden merely because they contain network-like wording.

The shared source classification tests are authoritative.

### Known noise, 2026-11-11: refused order reads from guests on `/app/orders`

From the Expo SDK 58 deploy (2026-11-11 06:08 UTC) until the Orders-tab gate fix is deployed, `/app` sent one event per signed-out visit that opened `/app/orders` directly, by link or by reloading that tab. Each event is a `permission denied for table orders` failure from subsystem `orders`, operation `load_orders`.

- **Not an access problem.** The server refused a read with no session, which is what it should do.
- **The cause was the route.** It mounted `OrdersScreen` while auth was still `loading`. SDK 58 renders a directly opened tab before the session settles, and SDK 57 did not: measured 5 of 5 direct loads against 0 of 5.
- **The fix.** `app/(tabs)/orders.tsx` now renders `OrdersScreen` only for a known `signed_in` session, and `features/auth/ordersTabGate.test.tsx` renders every state.
- **What to do with these events.** Resolve the ones from that window. Do **not** add `permission denied` to the expected list: anywhere else, a refused read is a real signal.

## Admin surface is the strictest context

The staff console can render privileged operational/customer data. Observability code must never inspect/capture visible DOM/form contents to enrich an event.

A useful stack trace + subsystem/op/error code is preferable to leaking a receipt/customer/order payload.

## Release validation

After an approved web release:

- [ ] `/` and `/app` both load.
- [ ] production deployment SHA matches the intended release.
- [ ] admin events carry `app_surface=admin-web`.
- [ ] customer web events carry `app_surface=expo-web`.
- [ ] environments/releases are distinguishable.
- [ ] approved **admin-web** test event is symbolicated when the Vercel upload token is configured.
- [ ] Expo-web event routing/tags are verified separately; **source-map symbolication remains pending until a dedicated upload path exists**.
- [ ] sanitized payload contains no customer/payment/auth secrets.

Use `docs/DEPLOY.md` for production-artifact verification; an arbitrary HTTP 200 does not prove the current bundle is served.

## Related files/docs

- `src/lib/observability/` — admin browser implementation.
- `apps/mobile/src/lib/observability/` — shared/mobile/expo-web implementation.
- `vite.config.ts` — **admin/Vite** source-map/plugin gate.
- `apps/mobile/scripts/export-web.js` — Expo web export; currently no separate Sentry map upload.
- `docs/SENTRY_OBSERVABILITY.md` — native/mobile runbook.
- `docs/DEPLOY.md` — deployment verification.
- `docs/RELEASE_CHECKLIST.md` — release gates.