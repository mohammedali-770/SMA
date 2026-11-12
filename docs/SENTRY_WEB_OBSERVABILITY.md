# Spicy Meal — Web / Admin Sentry Observability

> **Updated 2026-11-12.** Companion to `SENTRY_OBSERVABILITY.md` for the two browser surfaces built and deployed together.
>
> **Measured 2026-11-11: neither web surface sends readable stack traces from production.** The admin-web source-map upload did not run for the production build, and `/app` had no source-map path at all.
>
> **Changed 2026-11-12: `/app` now has one, behind the same `SENTRY_AUTH_TOKEN` gate as the console.** Neither surface uploads until that token is in the Vercel build. One setting then turns both on in the same build (`OWNER_ACTIONS.md` §11). Detail under "Source maps" below.

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

The Aug 11 native release work recorded the EAS production token setup. Vercel remains a separate environment: verify its current `SENTRY_AUTH_TOKEN` before relying on **admin-web** or **`/app`** production symbolication rather than treating a historical setup statement as permanent truth.

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

### Expo web (`/app`) — implemented in source 2026-11-12, waiting for the token

`apps/mobile/scripts/export-web.js` asks `planWebExport` in `apps/mobile/scripts/webExportSourceMaps.js` what to run. The gate is `Boolean(process.env.SENTRY_AUTH_TOKEN)`, the same test `vite.config.ts` and `apps/mobile/app.config.js` use.

**Without the token nothing changed.** The export runs exactly as it did before:

```text
expo export --platform web --clear --output-dir ../../dist/app
```

Measured 2026-11-12: a no-token export after the change was byte-identical to one before it, over all 58 files in `dist/app`, and so was its log. CI has no token, so CI takes this path.

**With the token, five steps run, in this order:**

1. The same export plus `--source-maps`. Metro writes `entry-<hash>.js.map` beside the bundle, appends `//# sourceMappingURL=/app/…js.map` and `//# debugId=<id>`, and embeds the same Debug ID in the code.
2. `sentry-expo-upload-sourcemaps dist/app`, the uploader `@sentry/react-native` 8.28 ships. It runs `sentry-cli sourcemaps upload <bundle> <map>` from `@sentry/cli` 3.8.0, with org `first-taste-trading-company` and project `react-native` read from the `@sentry/react-native/expo` entry in `app.json`. Sentry matches events to maps by Debug ID, so no release name is needed. `SENTRY_URL` from the environment overrides the URL in `app.json`.
3. Every `*.map` under `dist/app` is deleted. This always runs, even when the export or the upload failed.
4. The `sourceMappingURL` comment is removed, so the shipped bundle does not point at a file that is not there. This matches the console's `sourcemap: 'hidden'`. The `//# debugId=` comment stays, because Sentry matches on it.
5. `dist/app` is scanned again. **The build fails** if any `.map` file or `sourceMappingURL` comment is left.

**If the upload fails, the build warns and carries on.** That is what the console does: the Sentry Vite plugin passes an upload error to `handleRecoverableError(e, false)` in `@sentry/bundler-plugins`, which logs it and does not throw. Vercel's Git integration builds production on every merge (CLAUDE.md §13). If the build failed here, a Sentry outage or an expired token would block a release. A map shipping is the failure that matters, and step 5 fails the build for that.

The console's own `filesToDeleteAfterUpload: ['dist/**/*.map']` cannot cover `/app`: `vite build` finishes before the export starts, so step 3 does that job here.

**Measured locally 2026-11-12 with a fake token (no request reached Sentry):**

- With a stub `sentry-cli` (`SENTRY_CLI_EXECUTABLE`), it uploaded the bundle and its 15 MB map, then left 0 `.map` files and 0 `sourceMappingURL` comments. The shipped entry kept the no-token build's file name and byte content, plus one trailing `//# debugId=` line whose ID matches the uploaded map.
- When the upload failed, the build printed the warning, exited 0, and produced the same 58 files. This held both with a stub that exits 1 and with the real `sentry-cli` in a network-less namespace.

**Not yet verified:** a real upload, and a symbolicated `/app` event. Both need the token in Vercel. After the next production deploy with the token, the build log should show `[export-web] /app source maps uploaded to Sentry.`, then an approved `/app` test event should show readable frames.

Therefore:

- Expo-web runtime events reach Sentry with environment/release/surface metadata either way;
- until the token is in the Vercel build, `/app` frames stay minified, as they always have;
- do **not** mark `/app` symbolication verified until a production build log shows the upload and an approved `/app` test event resolves;
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
- [ ] Expo-web event routing/tags are verified separately; **`/app` symbolication is verified only when the build log shows `[export-web] /app source maps uploaded to Sentry.` and an approved `/app` test event resolves**.
- [ ] sanitized payload contains no customer/payment/auth secrets.

Use `docs/DEPLOY.md` for production-artifact verification; an arbitrary HTTP 200 does not prove the current bundle is served.

## Related files/docs

- `src/lib/observability/` — admin browser implementation.
- `apps/mobile/src/lib/observability/` — shared/mobile/expo-web implementation.
- `vite.config.ts` — **admin/Vite** source-map/plugin gate.
- `apps/mobile/scripts/export-web.js` — Expo web export; runs the token-gated `/app` source-map path.
- `apps/mobile/scripts/webExportSourceMaps.js` — that path: plan, upload, delete, strip, verify (tests: `apps/mobile/src/lib/webExportSourceMaps.test.ts`).
- `docs/SENTRY_OBSERVABILITY.md` — native/mobile runbook.
- `docs/DEPLOY.md` — deployment verification.
- `docs/RELEASE_CHECKLIST.md` — release gates.