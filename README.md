# 🌶️ Spicy Meal (SMA) — Production Ordering Platform

Spicy Meal is the production codebase for First Taste Trading Company's customer ordering experience, staff/admin console, and Supabase backend.

This repository is **not the old prototype/emulator anymore**. The customer app is a real Expo / React Native application, the staff console is a separate React web application, and Supabase is the server-side source of truth for authentication, catalog data, orders, operations, and integrations.

> **Current development state:** pre-launch / release-readiness. The production branch contains the current application and backend definition, but native store/device validation is still a release gate. Payment/refund work remains deliberately frozen until the final payment provider is selected.

## Product surfaces

| Surface | Location | Stack | Purpose |
| --- | --- | --- | --- |
| 📱 Customer app | `apps/mobile/` | Expo SDK 57, React Native 0.86, Expo Router | Native iOS/Android ordering app plus the `/app` web export |
| 🖥️ Staff/admin console | `src/` | Vite 6, React 19, Tailwind CSS 4 | Live orders, catalog, branches, reports, operations, staff access, integrations |
| 🗄️ Backend | `supabase/` | Supabase Postgres, RLS, Auth, pg_cron, Edge Functions | Server-authoritative data, business rules, automation and external integrations |
| 🎨 Shared design system | `design-system/` | TypeScript tokens and state contracts | Shared visual/business presentation primitives mirrored into both clients |

## What is implemented

### Customer app

- Arabic and English with RTL support.
- Blocking Pickup / Delivery order-type selection before browsing.
- Branch-aware catalog, categories, banners, modifiers and availability.
- Cart, quantity editing, delivery address book, map/location flow and required delivery guidance.
- WhatsApp-based Saudi phone authentication through Supabase Auth.
- Order history, receipts and customer-safe order references.
- Account/profile management and in-app account deletion.
- System / Light / Dark appearance with runtime theme binding.
- Sentry observability and production-safe error handling.
- Native iOS/Android builds through EAS plus React Native Web export at `/app`.

### Staff/admin console

- Live Orders and receipt/ticket workflows.
- Menu, product, category, banner and branch management.
- Delivery zones, branch availability and Lazywait catalog/mapping tools.
- Financial/management reporting with persisted order/VAT values.
- Operations Health, Operations Alerts, Order Integrity and stranded-order visibility.
- Audited staff role administration and TOTP/AAL2 MFA enforcement for staff access.
- Integration configuration surfaces, legal-document management and system settings.
- Responsive Ember-on-Cream design system with System / Light / Dark appearance.

### Backend and integrations

- Supabase Auth, PostgREST/RPC and Row Level Security are the authorization boundary.
- Server-authoritative order totals, modifier rules, coupon/loyalty rules and order lifecycle controls.
- Lazywait POS synchronization, webhook handling, confirmation-required recovery states and admin verification feeds.
- WhatsApp login-delivery and profile phone-verification flows.
- Account-deletion request/processing workflow.
- Scheduled operations-health and alerting functions.
- Payment/Tap source remains in the repository but is **provisional and frozen** while the final gateway decision is pending. Automated refund processing remains disabled. See [`docs/PAYMENT_POSTPONEMENT.md`](docs/PAYMENT_POSTPONEMENT.md).
- Push-notification code is retained but **dormant by product decision**.

## Tech stack

### Admin/web

- Vite 6
- React 19
- TypeScript
- Tailwind CSS 4
- Supabase JS
- Sentry
- Mapbox / Google Maps provider abstraction

### Customer app

- Expo SDK 57
- React Native 0.86.2
- React 19.2.3
- Expo Router
- React Native Web
- Supabase JS
- Sentry React Native
- EAS Build

### Backend

- Supabase Postgres + RLS
- Supabase Auth
- Supabase Edge Functions (Deno)
- pg_cron / database automation
- SQL migration and regression-test suites

## Getting started

**Node 22 is required.** `.nvmrc` is the repository source of truth. See [`docs/NODE_VERSION.md`](docs/NODE_VERSION.md).

```bash
# Match the repository Node version
nvm use

# Install both dependency trees
npm ci
npm --prefix apps/mobile ci

# Admin/staff console
npm run dev

# Customer app in the browser
npm --prefix apps/mobile run web

# Expo dev server for native development
npm --prefix apps/mobile start
```

Create local environment files from the examples as needed. Client-side Supabase anon/publishable credentials are public by design; **service-role/provider secrets must never be placed in client env files or committed**.

## Quality gates

```bash
# Root/admin TypeScript
npm run lint

# Root + framework-free mobile unit tests
npm test

# Mobile TypeScript
npm --prefix apps/mobile run typecheck

# Shared design-system sync/hygiene
npm run design-system:check

# Full production build: admin site + Expo web export
npm run build
```

Additional SQL and Edge Function checks run in CI. Production database changes must follow the migration workflow documented in [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md).

## Repository layout

```text
apps/mobile/            Customer Expo app (iOS / Android / web)
src/                    Staff/admin Vite application
design-system/          Shared Ember-on-Cream tokens and UI state contracts
supabase/
  migrations/           Forward-only database migrations
  functions/            Deno Edge Functions and shared server helpers
  tests/                SQL regression suites
scripts/                Design-system, audit and repository tooling
docs/                   Architecture, release, operations and audit documentation
.github/workflows/       CI, release and controlled deployment workflows
CLAUDE.md                Mandatory repository change-control rules
PROJECT_STATUS.md        Current engineering/release status
README_MOBILE.md         Mobile/EAS-specific developer guide
```

## Deployment and release model

- `claude/project-build-ie4b56` is the default/production branch.
- Vercel serves the admin application at the site root and the Expo web export under `/app`.
- EAS profiles in `apps/mobile/eas.json` cover `development`, `preview` and `production` builds.
- Production native builds require the normal release gates and explicit owner approval.
- The August 12 branch-retention release was merged after source/typecheck/tests/design-system/Expo/web/Vercel checks; physical-device Build 5 validation remains a separate release step.

## Documentation

Start with [`docs/README.md`](docs/README.md). The most important documents are:

- [`PROJECT_STATUS.md`](PROJECT_STATUS.md) — current project/release status and onboarding.
- [`CLAUDE.md`](CLAUDE.md) — mandatory change-control and production-safety rules.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current system architecture.
- [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) — release gates and verification.
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — Vercel/deployment behavior.
- [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) — authoritative production migration ledger.
- [`docs/PAYMENT_POSTPONEMENT.md`](docs/PAYMENT_POSTPONEMENT.md) — payment/refund freeze.
- [`docs/BRANCH_FEATURE_RETENTION_AUDIT.md`](docs/BRANCH_FEATURE_RETENTION_AUDIT.md) — final feature-retention evidence from the branch cleanup.

## Important safety rules

Do not treat this repository like a sandbox:

- Do not push directly to the production branch; use a fresh branch and PR.
- Do not use `supabase db push` or `supabase migration repair` against production.
- Do not modify payment/refund/provider behavior while the payment area is frozen.
- Do not enable push notifications without explicit approval.
- Do not commit secrets, service-role keys or provider credentials.

See [`CLAUDE.md`](CLAUDE.md) for the binding rules.