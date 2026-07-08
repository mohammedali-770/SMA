# Spicy Meal — Customer Mobile App (Expo)

A **real Expo React Native** app (SDK 57, Expo Router, TypeScript) for the Spicy
Meal customer. It is an **additive track** that reuses the existing Supabase
backend (schema, RLS, RPCs, Edge Function boundary) untouched. The web SPA and
admin dashboard in the repo root are independent and unaffected.

## Run

```bash
cd apps/mobile
npm install
cp .env.example .env.local   # fill with your Supabase project URL + anon key
npx expo start               # press i / a, or scan the QR with Expo Go
npm run typecheck            # tsc --noEmit
```

> On a physical device / emulator, `EXPO_PUBLIC_SUPABASE_URL` must be reachable
> from the device — use your project's `https://…supabase.co` URL (not
> `127.0.0.1`). Android needs HTTPS unless you add a cleartext build-properties
> plugin for local http.

## Environment

Only two **public** variables (Expo inlines `EXPO_PUBLIC_*` into the bundle):

| Var | Meaning |
|-----|---------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (same project the web app uses) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key — safe to ship; RLS is the boundary |

The service_role key and every provider secret (payment / SMS / push / Lazywait)
are **never** in the app — they live server-side in `integration_settings` /
Edge Function secrets.

## Auth session storage

Supabase Auth is configured for React Native in `src/lib/supabase.ts`:
`storage: AsyncStorage`, `persistSession: true`, `autoRefreshToken: true`,
`detectSessionInUrl: false`, with token refresh gated on app foreground. No
browser `localStorage` is used.

## Structure

```
src/
  app/                 Expo Router routes (index, (auth), (tabs), product/[id], cart, checkout, receipt/[id], branch)
  features/            Screen implementations (auth, branch, menu, product, cart, checkout, orders, profile)
  components/          Reusable UI (Button, Header, Screen, StateViews, QtyStepper, Logo)
  store/               Providers: Auth, Catalog (+ selected branch), Cart (+ idempotency key)
  services/api.ts      Supabase data layer (customer subset of the web app's api.ts)
  lib/                 supabase client, env, mappers
  types/               db row + domain model types
  i18n/                EN/AR strings + provider (RTL foundation)
  utils/               formatting, pricing preview, uuid
```

## Backend reused (not rebuilt)

Supabase Auth · `profiles.role` · `branches` · `categories` · `products` ·
`modifier_groups`/`modifiers` · `branch_product_availability` · `validate_coupon`
RPC · **`place_order` RPC** (server-authoritative totals + idempotency key) ·
`orders` history · `addresses` · `app_settings` · `loyalty_transactions` (read).

## Scope of the first vertical slice

Launch → session check → login/sign-up → **manual** branch select → home+menu
(one page) → product + modifiers → cart → checkout (`place_order`) → receipt →
order history. No payment, SMS/OTP, or Lazywait — those remain server-side,
later tracks.
