# 🌶️ Spicy Meal (SMA) — Production Ordering Platform

Spicy Meal is the production codebase for First Taste Trading Company's customer ordering experience, staff/admin console, and Supabase backend.

This repository is **not the old prototype/emulator anymore**. The customer app is a real Expo / React Native application, the staff console is a separate React web application, and Supabase is the server-side source of truth for authentication, catalog data, orders, operations, and integrations.

> **Current development state:** pre-launch / release-readiness. The production branch contains the current application and backend definition, but native store/device validation is still a release gate. The payment provider is Moyasar (owner decision, 2026-11-11); online payment was off on that date, and the go-live steps are owner actions (`docs/OWNER_ACTIONS.md` §47).

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
- Online card payment is **Moyasar**, the provider the owner chose on 2026-11-11; the Tap and Geidea code is removed. Online payment and automated refunds were both off on 2026-11-11, and each step that turns them on is a separate owner approval ([`CLAUDE.md`](CLAUDE.md) §6, [`docs/OWNER_ACTIONS.md`](docs/OWNER_ACTIONS.md) §47). *Changed 2026-11-12: this line said the payment code was provisional and frozen.*
- Push notifications are **live**: order updates reach customers who allowed notifications automatically, and marketing is opt-out, so a broadcast reaches every one of them who has not switched offers off ([`CLAUDE.md`](CLAUDE.md) §7).

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

> **The two Expo commands below rewrite a tracked file.** Each runs `expo start`, which rewrites the `include` array of `apps/mobile/tsconfig.json` and drops `.expo/types/**/*.ts` and `expo-env.d.ts` (measured 2026-11-11 with `start` and `web`). Never commit that edit. Revert it with `git checkout -- apps/mobile/tsconfig.json`; `npm run design-system:check` fails while it is present. Detail: [`docs/DEV_VISUAL_REVIEW.md`](docs/DEV_VISUAL_REVIEW.md).

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

Create local environment files from the two templates as needed: `cp .env.example .env.local` for the console, and `cp apps/mobile/.env.example apps/mobile/.env.local` for the customer app. Client-side Supabase anon/publishable credentials are public by design; **service-role/provider secrets must never be placed in client env files or committed**.

## Quality gates

Every check CI runs on a pull request, and the command that reproduces it locally, from the repository root with both dependency trees installed. Each group is headed by the status-check context CI reports; [`docs/reference/ci-and-scripts.md`](docs/reference/ci-and-scripts.md) is the generated list of every workflow and job.

```bash
# design-system
npm run format:check                    # new files Prettier-clean, no machine-compressed source
npm run lint                            # root/admin TypeScript (tsc --noEmit)
npm --prefix apps/mobile run typecheck  # mobile TypeScript
npm test                                # every Vitest suite, root and framework-free mobile
npm run design-system:check             # token mirrors and design-system hygiene
npm run logo:check && npm run play-icon:check && npm run play-feature-graphic:check && npm run play-screenshots:check

# Documentation (generated + ownership)
npm run docs:check                      # generated reference, ownership rules, recorded hashes, test phone numbers

# Production build (Vite + Expo web export)
npm run build                           # reinstalls apps/mobile dependencies first, then builds dist/
find dist -name '*.map'                 # must print nothing: source maps never ship
npx playwright install --only-shell chromium  # once per Playwright version; the lockfile fixes which build
npm run test:e2e                        # a guest's journey through dist/, hermetic (e2e/guest-journey.spec.ts)

# Edge Function typecheck (Deno), with Deno 2.9.4 as CI pins it
deno check --no-lock --node-modules-dir=none supabase/functions/*/index.ts

# Dependency audit (high+)
node scripts/audit-web-high.mjs
node scripts/audit-mobile-high.mjs

# Change-control guard
bash .claude/hooks/protect-default-branch.test.sh
GUARD_TEST_STRICT=1 bash .claude/hooks/test-protect-default-branch.sh
node scripts/check-workflow-pins.mjs

# Migration chain + SQL suites: a disposable Postgres 16 + PostGIS 3 server only, never Production
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=postgres bash .github/sql-ci/run.sh
# run.sh ends with the existing-data stage (report-only); to point it at chosen files:
SQL_CI_NEW_MIGRATIONS='<file>.sql' PGHOST=127.0.0.1 PGUSER=postgres bash .github/sql-ci/existing-data.sh
```

The SQL harness needs the stub extensions in `.github/sql-ci/extensions/` copied into the server's extension directory first, as `.github/workflows/sql-suites.yml` does, because the chain runs `create extension pg_cron` and `pg_net`. Its CI job is path-gated, so it runs only when SQL changes.

Production database changes must follow the approved migration workflow.

**Migration status verified read-only on 2026-08-12:** the repository contains **79 migration files**, Production contains **85 migration-history rows**, the latest live version is **`20260810115029`**, and all 11 migration names added after the Aug 7 snapshot are represented live. See [`docs/MIGRATION_RECONCILIATION_20260812.md`](docs/MIGRATION_RECONCILIATION_20260812.md). The large historical [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) remains the workflow/provenance ledger; its Aug 7 headline counts are historical.

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
AGENTS.md                The rules an automated reviewer applies, indexed to CLAUDE.md
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
- [`AGENTS.md`](AGENTS.md) — the rules an automated reviewer such as Codex applies, indexed to CLAUDE.md.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current system architecture.
- [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) — release gates and verification.
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — Vercel/deployment behavior.
- [`docs/MIGRATION_RECONCILIATION_20260812.md`](docs/MIGRATION_RECONCILIATION_20260812.md) — latest read-only Production migration snapshot.
- [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) — historical migration workflow/provenance ledger.
- [`docs/OWNER_ACTIONS.md`](docs/OWNER_ACTIONS.md) — current owner/live-dashboard decisions.
- [`docs/PAYMENTS.md`](docs/PAYMENTS.md) — payments with Moyasar; [`docs/PAYMENT_POSTPONEMENT.md`](docs/PAYMENT_POSTPONEMENT.md) — the payment freeze, history to 2026-11-11.
- [`docs/BRANCH_FEATURE_RETENTION_AUDIT.md`](docs/BRANCH_FEATURE_RETENTION_AUDIT.md) — final feature-retention evidence from the branch cleanup.

## Important safety rules

Do not treat this repository like a sandbox:

- Do not push directly to the production branch; use a fresh branch and PR.
- Do not use `supabase db push` or `supabase migration repair` against production.
- Keep Moyasar the only payment provider. Do not apply a payment migration, deploy a payment function, enter a key, change the Moyasar dashboard, switch the payment row or online payment, or make a live payment or refund without explicit approval for that step.
- Push notifications are live. Do not send a broadcast, change notification targeting, or turn the push master flag on or off without explicit approval. Marketing push has been opt-out since 2026-08-20, so a broadcast reaches nearly the whole active base.
- Do not commit secrets, service-role keys or provider credentials.

See [`CLAUDE.md`](CLAUDE.md) for the binding rules.