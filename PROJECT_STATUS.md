# Spicy Meal (SMA) — Project Status & Developer Onboarding

> **Source state updated: 2026-08-12**  
> Production/default branch at the start of this documentation refresh: `af3611445d08f5f30c0a284d494f0b23ab713876` (PR #200).  
> This document describes the **current source/release state**. Older production-data counts from August 7 were point-in-time audit evidence and are not repeated here as if they were still live measurements.

## 1. What this project is

Spicy Meal is the production codebase for First Taste Trading Company's customer ordering platform.

| Surface | Location | Technology | Delivery |
| --- | --- | --- | --- |
| Customer mobile app | `apps/mobile/` | Expo SDK 57, React Native 0.86.2, Expo Router | iOS / Android through EAS |
| Customer web app | `apps/mobile/` | React Native Web / Expo export | Vercel `/app` |
| Staff/admin console | `src/` | Vite 6, React 19, Tailwind CSS 4 | Vercel site root |
| Backend | `supabase/` | Supabase Postgres, Auth, RLS, Edge Functions, pg_cron | Production Supabase project |
| Shared design system | `design-system/` | TypeScript tokens/state contracts | Mirrored into both clients |

The old prototype/localStorage emulator architecture is obsolete. Supabase is the authoritative backend.

## 2. Current repository state

As of 2026-08-12:

- `claude/project-build-ie4b56` is the default/production branch.
- Historical feature/release branches have been deleted after retention verification.
- The feature-retention integration from `release/mobile-next-build` was merged through **PR #200**.
- The final pre-merge source gates for that release included TypeScript, unit tests, design-system checks, Expo checks, web build/export and Vercel validation.
- A fresh **physical-device Build 5 validation remains a separate release step**. Source merge is not a substitute for installing and exercising a native build.

See [`docs/GIT_BRANCHES.md`](docs/GIT_BRANCHES.md) and [`docs/BRANCH_FEATURE_RETENTION_AUDIT.md`](docs/BRANCH_FEATURE_RETENTION_AUDIT.md).

## 3. Current major capabilities

### Customer app

- Arabic / English, RTL.
- WhatsApp/Supabase Saudi phone login.
- Blocking Pickup / Delivery order-type selection.
- Branch-aware menu, categories, banners, modifiers and availability.
- Cart, quantity editing and server-authoritative checkout.
- Saved addresses, default address, map/current-location flow and required delivery guidance.
- Orders, receipts and customer-safe order references.
- Profile editing and account deletion.
- System / Light / Dark appearance.
- Sentry observability.

### Admin/staff

- Live Orders, receipt/ticket workflow and safe order-status handling.
- Catalog, branch, banner, availability and delivery-zone management.
- Lazywait catalog/mapping and operational review.
- Financial/management reports using persisted order/VAT values.
- Operations Health and health badge.
- Operations Alerts/digest.
- Order Integrity and stranded-order visibility.
- Staff Access role administration with audit history.
- TOTP/AAL2 staff MFA boundary.
- Integration, legal and system-settings surfaces.

### Backend/security

Recent production-readiness work now includes:

- server-side order lifecycle/cancellation compensation;
- persisted historical VAT reporting;
- CSV formula-injection hardening;
- account-deletion manual-review resolution;
- stranded-order health/alert coverage;
- hot-path RLS/performance hardening;
- product edits that preserve disabled state;
- database-enforced modifier cardinality;
- authenticated boundary for legacy WhatsApp verification sends;
- audited staff role administration;
- staff-access admin UI;
- TOTP/AAL2 enforcement for privileged staff paths;
- removal of anonymous role-helper RPC exposure.

## 4. Mobile release baseline

The current mobile tree is Expo SDK 57 / React Native 0.86.2.

The August 11 iOS release-readiness fixes aligned:

- `expo` / Expo modules to the SDK 57 compatibility line;
- React Native 0.86.2;
- `react-native-reanimated` 4.5.1;
- `react-native-worklets` 0.10.1;
- `@sentry/react-native` 7.11.x compatibility line.

The August 12 feature-retention pass then restored/verified historical behavior before consolidation, including:

- language switching on the blocking order-type gate;
- customer-facing `#` prefix on external/display order references;
- System / Light / Dark appearance behavior;
- runtime palette-binding regression protection.

For build commands and native configuration, use [`README_MOBILE.md`](README_MOBILE.md).

## 5. Deliberately inactive/frozen areas

### Payment and refunds — FROZEN

The final payment provider has not been selected. Existing Tap/payment/refund source remains for continuity/history, but ordinary work must not modify, deploy, schedule or test that area.

Automated refund processing remains disabled. The authoritative decision is [`docs/PAYMENT_POSTPONEMENT.md`](docs/PAYMENT_POSTPONEMENT.md).

### Push notifications — DORMANT

Push source exists, but push remains intentionally disabled/unconfigured as a customer channel unless separately approved.

### Discounts/campaigns — schema exists, product wiring remains decision-gated

The campaign/discount foundation exists, but product/business decisions still govern whether/how it is wired into live ordering. See [`docs/DISCOUNTS_CAMPAIGNS.md`](docs/DISCOUNTS_CAMPAIGNS.md).

## 6. Repository layout

```text
apps/mobile/              Expo customer app: iOS / Android / web
src/                      Staff/admin Vite application
design-system/            Shared Ember-on-Cream source tokens/state contracts
supabase/
  migrations/             Forward-only migrations
  functions/              Deno Edge Functions + _shared helpers
  tests/                  SQL regression suites
scripts/                  Design-system/audit/repository tooling
docs/                     Current runbooks + historical audit evidence
.github/workflows/         CI, EAS and controlled deployment workflows
CLAUDE.md                  Mandatory change-control rules
README.md                  High-level project entry point
README_MOBILE.md           Mobile/EAS guide
```

Use [`docs/README.md`](docs/README.md) as the documentation index.

## 7. Local development

### Prerequisite

**Node 22 is required.** `.nvmrc` is the source of truth.

```bash
nvm use
node -v
```

See [`docs/NODE_VERSION.md`](docs/NODE_VERSION.md).

### Install

```bash
npm ci
npm --prefix apps/mobile ci
```

### Run

```bash
# Admin/staff console
npm run dev

# Customer app on web
npm --prefix apps/mobile run web

# Expo dev server
npm --prefix apps/mobile start
```

### Required quality checks

```bash
npm run lint
npm test
npm --prefix apps/mobile run typecheck
npm run design-system:check
npm run build
```

After native/config dependency changes, also run the appropriate Expo checks from `apps/mobile/`, including `expo-doctor` and a clean prebuild/export as required by the release checklist.

## 8. Environment and secrets

Public client configuration may include the Supabase project URL and anon/publishable key. Those values do not bypass RLS.

Never put server/provider secrets in:

- `VITE_*` values;
- `EXPO_PUBLIC_*` values;
- committed `.env` files;
- logs/tests/fixtures;
- PR descriptions or screenshots.

Service-role credentials and external provider secrets belong only in server-side configuration/secret stores.

## 9. Database rules

[`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) is the authoritative production migration ledger.

Binding rules:

- new forward-only migration for each schema change;
- never edit an already-applied migration;
- never run `supabase db push` against production;
- never run `supabase migration repair` against production;
- production migration/application requires the approved workflow and explicit owner approval.

## 10. Git/change-control rules

Read [`CLAUDE.md`](CLAUDE.md) before changing the repository.

Normal workflow:

1. Fetch the current production branch.
2. Create a fresh purpose-specific branch.
3. Make and validate the change there.
4. Open a PR against `claude/project-build-ie4b56`.
5. Do not merge without explicit owner approval.
6. Let merged head branches be deleted; do not recreate the old branch backlog.

## 11. Release/deployment model

### Web

Merges to the configured production branch are the web release path. `npm run build` creates both:

- the Vite admin build;
- the Expo customer web export under `dist/app`.

Use [`docs/DEPLOY.md`](docs/DEPLOY.md) and [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md).

### Native

EAS profiles:

- `development` — internal development client;
- `preview` — internal distribution, Android APK;
- `production` — store/TestFlight path with remote versioning/auto-increment.

Starting EAS/store builds requires explicit owner approval.

## 12. Current documentation ownership

| Area | Authoritative document |
| --- | --- |
| Project overview | `README.md` |
| Current engineering/release state | `PROJECT_STATUS.md` |
| Mobile/EAS | `README_MOBILE.md` |
| Architecture | `docs/ARCHITECTURE.md` |
| Docs navigation | `docs/README.md` |
| Change-control | `CLAUDE.md` |
| Release checks | `docs/RELEASE_CHECKLIST.md` |
| Deployment | `docs/DEPLOY.md` |
| Database migrations | `docs/MIGRATIONS.md` |
| Payment/refund freeze | `docs/PAYMENT_POSTPONEMENT.md` |
| Git branch state | `docs/GIT_BRANCHES.md` |
| Feature-retention evidence | `docs/BRANCH_FEATURE_RETENTION_AUDIT.md` |

Historical audit documents should remain clearly dated snapshots and should not be used as a current work queue.

## 13. Operational truth vs historical measurements

Several older revisions of this file contained detailed production row counts and one-day operational findings. Those measurements were useful audit evidence, but they age immediately.

This current-status document therefore separates **source/release truth** from **point-in-time production measurements**. Do not copy an old count forward and label it "current" without re-querying the live system.

When a production measurement matters, record the date, data source and whether the query was read-only.