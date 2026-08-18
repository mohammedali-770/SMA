<!-- ------------------------------------------------------------------
     GENERATED FILE — DO NOT EDIT.
     Regenerate with: npm run docs:generate
     CI fails if this file drifts from its source (npm run docs:check).
     Derived from: `src/`, `apps/mobile/src/`, `supabase/functions/`
     Describes the REPOSITORY, not live Production.
     ------------------------------------------------------------------ -->

# Environment variables

Every environment variable the code reads, split by whether its value is visible to anyone who downloads the app. **Names only — this file must never carry a value.**

## Client-visible

`VITE_*` and `EXPO_PUBLIC_*` values are compiled into the shipped bundle. Anyone can read them out of the app. Only ever put credentials here that are *designed* to be public client credentials, such as a Supabase publishable key or a bundle-restricted map token (CLAUDE.md §9).

- `EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`
- `EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN`
- `EXPO_PUBLIC_MAPBOX_STYLE_URL`
- `EXPO_PUBLIC_MAP_PROVIDER`
- `EXPO_PUBLIC_MAP_WEBVIEW_BASE_URL`
- `EXPO_PUBLIC_SENTRY_DEV`
- `EXPO_PUBLIC_SENTRY_DSN`
- `EXPO_PUBLIC_SENTRY_ENV`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_VERCEL_ENV`
- `EXPO_PUBLIC_WEB_COMMIT_SHA`
- `VITE_GOOGLE_MAPS_API_KEY`
- `VITE_MAPBOX_PUBLIC_TOKEN`
- `VITE_MAPBOX_STYLE_URL`
- `VITE_MAP_PROVIDER`
- `VITE_SENTRY_DEV`
- `VITE_SENTRY_DSN`
- `VITE_SENTRY_ENV`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_URL`
- `VITE_VERCEL_ENV`
- `VITE_VERCEL_GIT_COMMIT_SHA`

## Server-side only

Read by Edge Functions from the Deno environment. These are secrets. They live in the Supabase dashboard and in EAS, never in the repository, and they must not appear in logs, tests, fixtures or pull-request descriptions.

- `SEND_SMS_HOOK_SECRET`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL`
- `WHATSAPP_OTP_HMAC_SECRET`

> Presence in this list means the code *reads* the variable. It does not prove the variable is configured in any environment. A missing secret usually surfaces as a function returning a configuration error rather than a build failure.
