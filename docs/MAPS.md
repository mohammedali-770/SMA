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
| `EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | *(the existing dashboard key)* | Same value as the dashboard's `VITE_GOOGLE_MAPS_API_KEY`. The names differ because Vite only inlines `VITE_*` and Metro only inlines `EXPO_PUBLIC_*`. |
| `EXPO_PUBLIC_MAP_WEBVIEW_BASE_URL` | `https://app.spicymeal.com.sa/` | The `WebView` base URL. **Required.** |

The key is **not new**. The dashboard already uses a working Google Maps browser
key, set in the Vercel project as `VITE_GOOGLE_MAPS_API_KEY` and read at
[`src/lib/map.ts`](../src/lib/map.ts). The mobile app reuses that same value
under its own variable name. Do not mint a second key, and do not commit either.

### Why the base URL is not optional

A `WebView` loading inline HTML has no origin, so its requests to
`maps.googleapis.com` carry no `Referer` header. A referrer-restricted key
rejects those with `RefererNotAllowedMapError` and the API renders a blank grey
canvas. Passing `baseUrl` makes the page load under a real origin so the
referrer matches the key's allowlist.

The value must be a URL the key's HTTP-referrer restriction allows. Nothing is
fetched from it — it only establishes the origin.

## Google Cloud setup

Applies to the **existing** dashboard key — reuse it, don't create one.

1. **Credentials** — open the key already used by the dashboard.
2. Under **Application restrictions → HTTP referrers (web sites)**, confirm the
   list covers `https://app.spicymeal.com.sa/*`. The dashboard and the customer
   web export are one Vercel deployment on that domain (dashboard at `/`, Expo
   web at `/app/*`, see [`vercel.json`](../vercel.json)), so a single
   `https://app.spicymeal.com.sa/*` entry covers the dashboard, the web map and
   the mobile WebView. If it is already there, **no change is needed**.
3. Under **API restrictions**, the key must allow **both**:
   - **Maps JavaScript API** — the maps themselves
   - **Places API (New)** — the address search box
     ([`MapSearchBox.tsx`](../src/components/MapSearchBox.tsx) posts this same
     key to `places.googleapis.com/v1/places:searchText`)

   Restricting to Maps JavaScript API alone **breaks the dashboard's delivery
   zone and branch address search**.
4. Confirm a **billing account** is attached. Maps JS returns
   `BillingNotEnabledMapError` — again, a grey map — without one.

### What the referrer restriction does and does not protect

The browser key is public by design: it ships in the web JS bundle and, once
this lands, in the app binary. On the web the referrer restriction is a genuine
control because the browser sets `Referer` and the page cannot forge it.

**In a WebView it is not.** The app supplies its own `baseUrl`, so anyone who
unpacks the binary has both the key and the ability to send any referrer they
like. Reusing the dashboard key therefore moves it from "readable only by
someone who can reach the deployment" to "extractable from a shipped app". This
is accepted for the current WebView implementation; the practical mitigations
are a **quota cap** on the key, or a second key on the same referrer so mobile
traffic cannot exhaust the dashboard's quota.

If the picker is ever moved to the native Google Maps SDKs, that build needs
separate Android- and iOS-restricted keys — application restrictions there are
by package name + SHA-1 / bundle id, which a referrer-restricted key cannot
satisfy.

Never put the key in `eas.json` or any committed file.

## Setting the variables for EAS builds

Keys are stored as **EAS environment variables**, not committed. Each build
profile in [`apps/mobile/eas.json`](../apps/mobile/eas.json) pins its
`environment`, so a variable must exist in each environment you build.

Run from `apps/mobile/`, once per environment:

```bash
eas env:create --environment production \
  --name EXPO_PUBLIC_MAP_PROVIDER --value google --visibility plaintext
eas env:create --environment production \
  --name EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY --value '<existing dashboard key>' --visibility sensitive
eas env:create --environment production \
  --name EXPO_PUBLIC_MAP_WEBVIEW_BASE_URL --value 'https://app.spicymeal.com.sa/' --visibility plaintext
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

## Directions to a branch — the maps chooser

Separate from the picker above: the order-confirmation screen offers
**Directions to branch** for *pickup* orders, which hands off to a maps app
rather than rendering a map. It needs no API key — these are public URL schemes.

**Files:** [`openDirections.ts`](../apps/mobile/src/lib/openDirections.ts)
(platform behaviour), [`mapsLink.ts`](../apps/mobile/src/lib/mapsLink.ts)
(native/Apple URL), [`maps.ts`](../apps/mobile/src/lib/maps.ts)
(`buildGoogleMapsUrl`, `hasUsableCoordinates`). The URL builders are pure and
unit-tested; only `openDirections` touches the platform.

| Platform | Behaviour |
| --- | --- |
| **iOS, Google Maps installed** | An `ActionSheetIOS` asks which app to use. |
| **iOS, Google Maps absent** | Apple Maps opens directly — a one-option menu is not a choice. |
| **Android** | The `geo:` intent opens the **OS app picker**. The app deliberately adds no sheet of its own; that would put a second chooser in front of the real one. |

### `LSApplicationQueriesSchemes` is load-bearing on iOS

Detecting Google Maps uses `Linking.canOpenURL('comgooglemaps://')`, and **iOS
answers `false` regardless of what is installed unless the scheme is declared**
in `apps/mobile/app.json` → `ios.infoPlist.LSApplicationQueriesSchemes`:

```json
"LSApplicationQueriesSchemes": ["comgooglemaps"]
```

Without it every iOS customer silently gets Apple Maps and the chooser never
appears — a failure that looks exactly like the feature not having shipped. It
is an installed-app probe, so it is a privacy-adjacent declaration worth
knowing about; it reveals only whether that one scheme can be opened.

**No pull-request job reads `app.json`** — the EAS workflow is
`workflow_dispatch` plus tag-push — so this key is first exercised at build
time. A missing or misspelt entry will not be caught by CI.

### Guards, and one dead branch

`openDirections` returns without doing anything when the coordinates are
unusable. Callers already hide the control in that case; this is the second line
of defence. On the confirmation screen the button renders only for a pickup
order whose branch is in the catalog with usable coordinates — a delivery order
never shows it, because the food travels to the customer.

**Known dead branch:** the `Alert.alert` chooser at the end of `openDirections`
is unreachable. `googleMapsInstalled()` returns `false` for every non-iOS
platform, so Android and web always take the early `open(native)` return above
it. It is harmless, but do not read it as the Android path — Android's chooser
is the OS app picker, not this alert.

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
