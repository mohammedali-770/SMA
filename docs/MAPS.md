# Maps — delivery location picker

The customer app's delivery-location picker ([`LocationPickerMap`](../apps/mobile/src/components/LocationPickerMap.tsx))
renders an interactive map with a draggable pin. On native it runs inside a
`WebView`; on web (`LocationPickerMap.web.tsx`) it mounts the Google Maps JS
API directly. Both read their configuration from
[`apps/mobile/src/lib/map.ts`](../apps/mobile/src/lib/map.ts).

**The map is credential-gated.** With no key the picker renders a "Map setup
required" hint instead of a map, and the caller's manual coordinate entry keeps
working. That is a deliberate degrade, not a crash — but it also means a
missing key looks exactly like a broken feature to the customer.

## Provider

Google Maps. `EXPO_PUBLIC_MAP_PROVIDER=google` selects it; Mapbox remains
supported in the code as an alternative but is not configured.

## Required environment variables

| Variable | Value | Why |
| --- | --- | --- |
| `EXPO_PUBLIC_MAP_PROVIDER` | `google` | Without it the code defaults to `mapbox` and looks for a token that does not exist. |
| `EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | `AIza…` | The Maps JavaScript API browser key. |
| `EXPO_PUBLIC_MAP_WEBVIEW_BASE_URL` | `https://sma.vercel.app/app/` | The `WebView` base URL. **Required.** |

### Why the base URL is not optional

A `WebView` loading inline HTML has no origin, so its requests to
`maps.googleapis.com` carry no `Referer` header. A referrer-restricted key
rejects those with `RefererNotAllowedMapError` and the API renders a blank grey
canvas. Passing `baseUrl` makes the page load under a real origin so the
referrer matches the key's allowlist.

The value must be a URL the key's HTTP-referrer restriction allows. Nothing is
fetched from it — it only establishes the origin.

## Google Cloud setup

1. **APIs & Services → Library** — enable **Maps JavaScript API**.
2. **Credentials** — create (or reuse) an API key.
3. On that key set **Application restrictions → HTTP referrers (web sites)** and
   add:
   - `https://sma.vercel.app/*` — covers the WebView base URL and the web build
   - any custom domain later pointed at the same deployment
4. Set **API restrictions → Restrict key → Maps JavaScript API** so the key
   cannot be reused against other billable APIs.
5. Confirm a **billing account** is attached to the project. Maps JS returns
   `BillingNotEnabledMapError` — again, a grey map — without one.

The browser key is public by design (it ships in the JS bundle). The referrer
restriction, not secrecy, is what protects it. Never put it in `eas.json`.

## Setting the variables for EAS builds

Keys are stored as **EAS environment variables**, not committed. Each build
profile in [`apps/mobile/eas.json`](../apps/mobile/eas.json) pins its
`environment`, so a variable must exist in each environment you build.

Run from `apps/mobile/`, once per environment:

```bash
eas env:create --environment production \
  --name EXPO_PUBLIC_MAP_PROVIDER --value google --visibility plaintext
eas env:create --environment production \
  --name EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY --value 'AIza…' --visibility sensitive
eas env:create --environment production \
  --name EXPO_PUBLIC_MAP_WEBVIEW_BASE_URL --value 'https://sma.vercel.app/app/' --visibility plaintext
```

Repeat with `--environment preview` and `--environment development`.

Use `sensitive`, not `secret`, for the key. `secret` variables cannot be pulled
back out of EAS (`eas env:pull` will not return them), which makes local
reproduction and verification harder — and it buys nothing here, because an
`EXPO_PUBLIC_*` value is inlined into the client bundle and readable by end
users regardless of its visibility level. `sensitive` still keeps it out of the
EAS dashboard and build logs.

Verify before building:

```bash
eas env:list --environment preview
```

### Build profile → environment

`environment` is set explicitly on all three profiles. This matters: when it is
omitted, EAS infers the environment (`production` only when
`distribution: "store"`, `development` when `developmentClient: true`,
otherwise `preview`). The `production` profile sets neither field, so before
this was pinned it silently resolved to the **preview** environment — a key
created only in `production` would never have reached a production build.

## Local development

Copy `apps/mobile/.env.example` to `.env.local` and fill the same three values.
`.env*` is gitignored repo-wide.

## Web build

The Vercel `/app` export runs
[`apps/mobile/scripts/export-web.js`](../apps/mobile/scripts/export-web.js),
which forwards `process.env`. Set the same three variables in the Vercel
project's environment for the web map to render. `vercel.json` already allows
`maps.googleapis.com` in the CSP.

## Diagnosing a blank or missing map

`LocationPickerMap` reports failures to Sentry as `MAP_LOAD_FAILED`
(`subsystem: app`, `op: map_load`) with a reason:

| Reason | Cause |
| --- | --- |
| *(no event; "setup required" shown)* | No key in the build — `isConfigured` is false and the WebView never mounts. |
| `google_auth_failure` | Key rejected: referrer not allowlisted, key invalid, or billing off. |
| `google_script_load_failed` | The Maps JS bundle could not be fetched — network or blocked domain. |
| `http_<status>` | The WebView itself got an HTTP error. |
| `webview: <description>` | Native WebView load failure. |

The `has_base_url` tag on the event shows whether
`EXPO_PUBLIC_MAP_WEBVIEW_BASE_URL` was set in that build — `false` alongside
`google_auth_failure` is the referrer problem.

To check what a built app actually received, look for the inlined values:

```bash
npx expo export --platform web --output-dir /tmp/check
grep -ro 'AIza[A-Za-z0-9_-]*' /tmp/check | head
```

No match means the variable was absent (or marked `secret`) at build time.
