# Spicy Meal — Web / Admin Sentry Observability

> **Updated 2026-08-12.** Companion to `SENTRY_OBSERVABILITY.md` for the two browser surfaces built and deployed together.

## Surfaces

| Tag | Application | Runtime |
| --- | --- | --- |
| `admin-web` | staff/admin Vite application at `/` | `@sentry/react` browser SDK |
| `expo-web` | customer Expo web export at `/app` | browser observability implementation |
| native (separate) | iOS/Android Expo app | `@sentry/react-native` 7.11.x |

The two web surfaces share the same release commit but remain distinguishable by surface/environment tags.

## Identity and secrets

The web/admin surfaces use the same Sentry organization/project strategy as mobile.

- DSN is a public ingestion identifier and may be present in browser configuration.
- `SENTRY_AUTH_TOKEN` is a **server/build secret** used for source-map upload tooling and must never be exposed through `VITE_*` or `EXPO_PUBLIC_*`.

The Aug 11 native release work recorded the EAS production token setup. Vercel remains a separate environment: verify its current `SENTRY_AUTH_TOKEN` before relying on production web symbolication rather than treating a historical setup statement as permanent truth.

## Initialization and release identity

- Admin initializes through the root web observability module.
- Expo web uses the platform-resolved browser observability implementation from the mobile tree.
- Both deploy from the same Vercel commit and use the repository's commit-derived web release identity.
- Test runners should not report production telemetry.
- Development reporting remains opt-in; preview/production reporting follows current source configuration.

The source modules/tests are the authority for exact sampling values; do not duplicate a numeric sampling table here that can silently drift from code.

## Source maps

The Vite Sentry plugin is gated by the build-time auth token. When the token is absent the web build can still complete, but source-map upload/symbolication is not complete.

For a production release:

- [ ] Vercel has the current `SENTRY_AUTH_TOKEN` secret (not a browser-visible env variable).
- [ ] Vite build runs the intended Sentry upload path.
- [ ] source maps are not published as public assets.
- [ ] an approved test event resolves to the correct release and readable stack.

Do not log the token or put it in `VITE_*`.

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
- [ ] approved test event is symbolicated when the upload token is configured.
- [ ] sanitized payload contains no customer/payment/auth secrets.

Use `docs/DEPLOY.md` for production-artifact verification; an arbitrary HTTP 200 does not prove the current bundle is served.

## Related files/docs

- `src/lib/observability/` — admin browser implementation.
- `apps/mobile/src/lib/observability/` — shared/mobile/expo-web implementation.
- `vite.config.ts` — web source-map/plugin gate.
- `docs/SENTRY_OBSERVABILITY.md` — native/mobile runbook.
- `docs/DEPLOY.md` — deployment verification.
- `docs/RELEASE_CHECKLIST.md` — release gates.