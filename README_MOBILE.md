# 📱 Spicy Meal — Customer Mobile App

The Spicy Meal customer application is a **real Expo / React Native app** located in [`apps/mobile/`](apps/mobile/). It is no longer a WebView wrapper around the admin website.

The same application code targets:

- iOS via EAS Build
- Android via EAS Build
- Web via React Native Web, exported under `/app`

## Current stack

- Expo SDK 57
- React Native 0.86.2
- React 19.2.3
- Expo Router
- React Native Web
- Supabase JS
- Sentry React Native
- EAS Build with remote app versioning

The static Expo configuration is in [`apps/mobile/app.json`](apps/mobile/app.json), the dynamic Sentry-aware config layer is in `apps/mobile/app.config.js`, and EAS profiles are defined in [`apps/mobile/eas.json`](apps/mobile/eas.json).

## App identity

| Platform | Identifier |
| --- | --- |
| Expo project | `spicy-meal` |
| EAS project ID | `c8422901-b27a-40b3-91c7-b6ce99d97936` |
| iOS bundle identifier | `com.spicymeal.app` |
| Android package | `sa.com.spicymeal.app` |
| Deep-link scheme | `spicymeal://` |
| Web base URL | `/app` |

The app is portrait-only, phone-focused on iOS (`supportsTablet: false`), and declares only foreground location permissions for the delivery-map experience.

## Main customer flows

- WhatsApp/Supabase phone authentication for Saudi mobile numbers.
- Blocking Pickup / Delivery order-type selection.
- Branch-aware menu, categories, banners and product modifiers.
- Cart and quantity management.
- Saved delivery-address CRUD and default-address management.
- Map pin/current-location workflow with delivery guidance/landmark validation.
- Checkout and customer-safe order confirmation/receipt states.
- Order history.
- Profile editing and in-app account deletion.
- Arabic/English and RTL layout.
- System / Light / Dark appearance.
- Sentry crash/error observability.

Payment/provider code exists but is deliberately frozen while the final payment gateway decision is pending. Do not change or test payment/refund behavior as part of ordinary mobile work; see [`docs/PAYMENT_POSTPONEMENT.md`](docs/PAYMENT_POSTPONEMENT.md).

Push code is also retained but dormant by product decision.

## Local setup

The repository standard is **Node 22** (`.nvmrc`). From the repository root:

```bash
nvm use
npm --prefix apps/mobile ci
```

Then run one of:

```bash
# Expo development server
npm --prefix apps/mobile start

# Open Android through Expo tooling
npm --prefix apps/mobile run android

# Open iOS through Expo tooling
npm --prefix apps/mobile run ios

# Customer app in the browser
npm --prefix apps/mobile run web
```

The mobile dependency tree is intentionally separate from the root/admin dependency tree. For full repository development, install both:

```bash
npm ci
npm --prefix apps/mobile ci
```

## Environment

Local/client environment variables use the `EXPO_PUBLIC_*` namespace. The normal application requires the Supabase project URL and anon/publishable key.

The anon/publishable key is a client credential and **RLS is the security boundary**. Never place the Supabase service-role key, Meta credentials, payment secrets, Sentry auth token or any other server/provider secret in an `EXPO_PUBLIC_*` value.

EAS profile environment values live in `apps/mobile/eas.json` and/or the EAS environment/secret store depending on the variable. Production source-map upload expects `SENTRY_AUTH_TOKEN` in the EAS production environment; that token must never be committed.

## Quality checks

From the repository root:

```bash
# Mobile TypeScript
npm --prefix apps/mobile run typecheck

# Root + framework-free mobile unit tests
npm test

# Shared design-system consistency/hygiene
npm run design-system:check

# Expo project health
cd apps/mobile
npx expo-doctor
cd ../..

# Full web production export through the root build
npm run build
```

The root `npm run build` deliberately installs mobile dependencies first, builds the Vite admin app, then exports the Expo web application into `dist/app`.

## EAS build profiles

Run EAS commands from `apps/mobile/` (or pass the correct working directory in automation).

### Development

`development` creates an internal development-client build.

```bash
cd apps/mobile
npx eas-cli build --platform android --profile development
```

### Preview

`preview` is internal distribution. Android produces an APK for device testing.

```bash
cd apps/mobile
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile preview
```

### Production

`production` uses remote versioning and auto-increment. Android produces an app bundle; iOS produces the store/TestFlight build.

```bash
cd apps/mobile
npx eas-cli build --platform android --profile production
npx eas-cli build --platform ios --profile production
```

**Starting a production or store build requires explicit owner approval.** Follow [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) rather than treating these commands as routine development commands.

## Web export

The customer web app is the Expo app itself, not a separate emulator:

```bash
npm --prefix apps/mobile run build:web
```

The root production build runs this automatically after the Vite admin build. Vercel serves the resulting Expo SPA at `/app`.

## Important configuration files

```text
apps/mobile/
  app.json                 Static Expo identity/platform config
  app.config.js            Dynamic config and Sentry plugin gating
  eas.json                 development / preview / production profiles
  package.json             Mobile dependencies and commands
  metro.config.js          Metro configuration
  scripts/export-web.js    Production web-export wrapper
  src/app/                 Expo Router routes
  src/features/            Customer feature modules
  src/design-system/       Generated/shared mobile design-system mirror
  src/theme/               Runtime theme provider and theme guards
```

## Release state

The current production branch includes the August 12 feature-retention integration. Source-level gates completed before that merge, including TypeScript, tests, design-system checks, Expo checks and web/Vercel build validation.

A fresh physical-device **Build 5** validation is still a distinct release gate; merging source does not substitute for installing and exercising a native build.

For release/build history and operational status, use [`PROJECT_STATUS.md`](PROJECT_STATUS.md), [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) and [`docs/BRANCH_FEATURE_RETENTION_AUDIT.md`](docs/BRANCH_FEATURE_RETENTION_AUDIT.md).