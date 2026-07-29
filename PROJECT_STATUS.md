# Spicy Meal (SMA) — Project Status & Developer Onboarding

> Last updated: 2026-07-29 (default-branch head `e36fff1`).
> Read this first when opening the project in VS Code (or any editor) from a
> fresh clone. It tells you what this repository is, what is LIVE in
> production, how to run everything, and which rules must never be broken.

---

## 1. What this project is

**Spicy Meal** is a Saudi fast-food ordering platform (Arabic-first, RTL,
English supported) for شركة الطعم الأول للتجارة (First Taste Trading Company).
One repository contains three user-facing apps and the backend definition:

| Surface | Where | Tech | Served at |
| --- | --- | --- | --- |
| Customer mobile app | `apps/mobile/` | Expo SDK 57 / React Native 0.86 / expo-router | iOS + Android (EAS builds) |
| Customer web app | `apps/mobile/` (same code, web export) | React Native Web via `expo export --platform web` | `/app` on the Vercel site |
| Admin/staff console | `src/` (repo root) | Vite 6 + React 19 + Tailwind 4 | Vercel site root |
| Backend | `supabase/` | Supabase (Postgres 17, RLS, pg_cron, Edge Functions) | Production project `wxfmmnihidsdyemasstf` |

- Bundle IDs: iOS `com.spicymeal.app`, Android `sa.com.spicymeal.app`.
- The root Vite app redirects signed-in customers to `/app`; staff roles
  (admin/accountant) get the AdminDashboard.
- Deployment: Vercel builds the default branch (`npm run build` = mobile
  `npm ci` → `vite build` → Expo web export into `dist/app`). Mobile store
  builds go through EAS with **remote** versioning. See `docs/DEPLOY.md`.

## 2. Repository layout

```
apps/mobile/            Expo app (customer iOS/Android/web)
  src/app/              expo-router routes (incl. dev-sentry test screen)
  src/lib/observability/  Sentry: mobile (index.ts), web (index.web.ts),
                          shared framework-free sanitize/classify/config,
                          webCore/webConfig/webRoutes/webClassify
  scripts/export-web.js Web export wrapper (public env injection)
src/                    Admin console (Vite): components/, context/, lib/
  components/AdminDashboard.tsx + components/admin/  staff panels
  lib/                  API/capability/business-logic modules (unit-tested)
supabase/
  migrations/           Migration files (see docs/MIGRATIONS.md — the ledger)
  functions/            Edge Functions (payment, lazywait-sync, OTP, …)
  tests/                SQL test suites (run in a local PG harness only)
docs/                   Authoritative runbooks (see §6)
CLAUDE.md               MANDATORY change-control rules (read before any change)
vercel.json             Vercel build, rewrites, headers (CSP incl. Sentry)
vite.config.ts          Vite + token-gated Sentry source-map upload
vitest.config.ts        Root unit-test config (includes framework-free
                        apps/mobile tests)
```

## 3. What is LIVE in Production right now

The default branch **is** production. Everything below is deployed and active:

- **Ordering + checkout + Tap payments.** Customers order and pay today, but
  **all payment/refund WORK is postponed** — see §5 and
  `docs/PAYMENT_POSTPONEMENT.md`.
- **Lazywait POS integration**: `lazywait-sync` worker with deadline-bounded
  retries, `confirmation_required` lifecycle state, reaper, and an admin
  "Orders Requiring Verification" panel.
- **Order Integrity watchdog** + admin triage panel.
- **Operations Health Center**: staff RPC `operations_health_summary()`
  (SECURITY DEFINER, staff-gated with 42501) + admin panel, now monitoring a
  5-job allowlist (three critical crons + the two internal automation crons).
- **Smart Operations Alerts + Daily Digest** (live and ACTIVE):
  evaluator cron `operations-alerts-evaluator` every 5 min, digest cron
  `operations-digest-generator` hourly (08:00 Asia/Riyadh in-function gate),
  AR/EN digests, alerts inbox in the admin dashboard. **External dispatch is
  disabled by design** — alerts/digests are internal (in-dashboard) only.
- **Order confirmation state machine** — one authoritative customer-visible
  order state, server-counted manual resends, and refund *enrolment*. Refund
  *processing* is not running (§5).
- **Discounts & campaigns schema** — tables, RLS and
  `compute_campaign_discount()` are live, but **inert**: `place_order` does not
  call the RPC, so no discount can affect an order total yet. Eight open
  business questions gate the wiring — `docs/DISCOUNTS_CAMPAIGNS.md`.
- **Sentry crash/error monitoring** (org `first-taste-trading-company`,
  project `react-native`) on all three surfaces:
  - mobile (PR #80): native + JS crashes, sampling prod 0.08;
  - web/admin (PR #83): `admin-web` + `expo-web` surface tags, sampling
    prod 0.05 — see §5 for the pending owner action.
- **Auth**: Supabase auth with WhatsApp OTP flow.
- **Account deletion** flow (store-compliance requirement).

### Active scheduled jobs (pg_cron)

| Job | Schedule | State |
| --- | --- | --- |
| `account-deletion-processor` | `* * * * *` | active |
| `lazywait-sync` | `* * * * *` | active |
| `order-integrity-watchdog` | `*/2 * * * *` | active |
| `operations-alerts-evaluator` | `*/5 * * * *` | active |
| `operations-digest-generator` | `0 * * * *` | active |
| `payment-refund-worker` | `*/5 * * * *` | **DISABLED** (`active = false`, §5) |

### Migration state

**62** live `schema_migrations` rows; **61** repository migration files;
**zero unapplied**. Latest live version `20260729112238`. Ten migrations were
applied on 2026-07-29, eight of them closing a Production incident in which the
deployed frontend was running eight migrations ahead of the database.

`docs/MIGRATIONS.md` is the authoritative ledger — read it before touching
anything database-related. Live schema changes go ONLY through the
owner-approved MCP `apply_migration` workflow; `supabase db push` and
`supabase migration repair` are permanently forbidden against Production.

## 4. Working in VS Code — setup & daily commands

Prereqs: Node 20+, npm. (No Docker needed for app work; SQL test suites need
a local Postgres 16+ if you want to run them.)

```bash
# 1) Install root (admin web + tests) and mobile deps
npm ci
npm --prefix apps/mobile ci

# 2) Environment (never commit real values; .env* is gitignored)
#    Admin web (Vite):  VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
#    Mobile (Expo):     EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY
#    (the anon key is public by design; RLS is the security boundary)

# 3) Run
npm run dev                          # admin console on :3000
npm --prefix apps/mobile run web     # customer app in the browser
npm --prefix apps/mobile start       # Expo dev server (iOS/Android)

# 4) Quality gates (run before every commit — all must pass)
npm run lint                         # root tsc --noEmit (includes shared web code)
npm test                             # vitest (root + framework-free mobile)
npm --prefix apps/mobile run typecheck
npm run build                        # full production build (Vite + Expo web export)
```

Notes:
- `npm run build` installs `apps/mobile` deps **first** on purpose: `vite build`
  transforms `apps/mobile/src`, whose tsconfig extends `expo/tsconfig.base`, so
  it needs `apps/mobile/node_modules` to already exist. Reordering these breaks
  the Vercel build.
- Root vitest deliberately includes `apps/mobile/src/**/*.test.ts` for
  FRAMEWORK-FREE modules only (no RN/Expo imports in those test files).
- `supabase/tests/*.sql` run against a throwaway local PG harness — never
  against Production.
- Sentry is silent in dev unless you opt in (`VITE_SENTRY_DEV=1` /
  `EXPO_PUBLIC_SENTRY_DEV=1`); test runners are always silent.

## 5. Pending items / owner actions

**Payment & refund work is POSTPONED** (owner decision, 2026-07-29). The
payment gateway provider has not been selected. Do not modify, deploy, schedule
or test any payment/refund functionality. The `payment-refund-worker` cron was
disabled; **nothing was deleted** — all payment code, migrations and Edge
Functions remain intact. Full record, including the open double-refund design
question that must be resolved before the worker is ever re-enabled:
`docs/PAYMENT_POSTPONEMENT.md`.

Open issues:

- **Issue #81 (open, `blocks-production`)** — create the `SENTRY_AUTH_TOKEN`
  secret in EAS *and* Vercel so release builds upload source maps. Until then
  production EAS builds fail at the Sentry upload step, and crash reports arrive
  unsymbolicated. The token is a real secret: never commit it, never put it in
  `EXPO_PUBLIC_*`/`VITE_*`. Owner action only — no repository change needed.
- **Issue #102 (open)** — set the Vercel **Production Branch** to
  `claude/project-build-ie4b56` and trigger a fresh Production redeploy. While it
  is unset, the default branch only deploys as a Preview and `/` and `/app/`
  serve byte-identical HTML, so the customer Expo web app is not actually being
  served in production. Owner action only (Vercel dashboard) — see
  `docs/DEPLOY.md`.

Needs an owner decision:

- **Push notifications.** `CLAUDE.md` §7 and earlier revisions of this document
  state the `push`/`expo` integration row is *disabled*. It is in fact
  `enabled = true` in Production — but with **zero credentials and zero
  registered devices**, so nothing can be sent and the stack is effectively
  dormant. This was left as-is rather than changed, because push configuration
  requires explicit owner approval. Decide whether to set the row to `false` to
  match the documented intent.
- **Discounts & campaigns** — eight business questions in
  `docs/DISCOUNTS_CAMPAIGNS.md` block wiring campaigns into `place_order`.

Documentation debt:

- The five account-deletion migrations are applied and live but not yet itemized
  in `docs/MIGRATIONS.md` §4/§5 (tracked in §1 of that document).

## 6. Authoritative docs (read these before changing the related area)

| Doc | Owns |
| --- | --- |
| `CLAUDE.md` | Change-control rules for ALL agent/automated work (§7 below) |
| `docs/MIGRATIONS.md` | Migration ledger + the only allowed Production schema workflow |
| `docs/PAYMENT_POSTPONEMENT.md` | The payment/refund freeze: scope, live state, resume checklist |
| `docs/DEPLOY.md` | Vercel deployment, Production Branch, env vars, verification |
| `docs/OPERATIONS_ALERTS_DIGEST.md` | Alerts/digest engine, activation state, runbook |
| `docs/ORDER_CONFIRMATION_FLOW.md` | Order confirmation lifecycle + refund enrolment rules |
| `docs/DISCOUNTS_CAMPAIGNS.md` | Campaigns schema, what is live, open business questions |
| `docs/SENTRY_OBSERVABILITY.md` | Mobile crash reporting runbook |
| `docs/SENTRY_WEB_OBSERVABILITY.md` | Web/admin error monitoring runbook |
| `README.md` / `README_MOBILE.md` | General app documentation |

## 7. Rules that must never be broken

These are binding for humans and AI agents alike (full text in `CLAUDE.md`):

1. **Never commit/push directly to the protected branches**
   (`claude/project-build-ie4b56` = production default, and `main`).
   Every change: fresh branch off the default branch → PR → explicit owner
   approval → merge. A PreToolUse hook additionally blocks agent sessions
   from editing on a protected checkout.
2. **Payment/Tap area is FROZEN and payment work is POSTPONED** — no changes
   without separate explicit owner approval, and none at all until a gateway
   provider is selected (`docs/PAYMENT_POSTPONEMENT.md`).
3. **Push notifications stay dormant** — no credentials, no enabling.
4. **Production schema**: only the owner-approved `apply_migration` workflow;
   `supabase db push` / `migration repair` are permanently forbidden; never
   edit an already-applied migration file.
5. Secrets (Sentry auth token, service-role keys, provider credentials) never
   enter the repository, logs, PRs, or client bundles.
6. Actions requiring explicit owner approval every time: PR merges, live
   Supabase writes, migrations, Edge Function deploys, auth config, payment
   work, push enabling, Vercel production changes, EAS/store builds,
   destructive git operations.

## 8. Recent merged milestones (newest first)

| PR | What | Merge |
| --- | --- | --- |
| #112 | Refund worker scheduler + stale-claim reaper; `caller_can_read_order` anon revoke | `e36fff1` |
| #85 | Operations automation cron health | `06c9bb0` |
| #84 | `PROJECT_STATUS.md` onboarding document | `e520f0a` |
| #83 | Sentry error monitoring for web + admin (`admin-web`/`expo-web`) | `736a6a0` |
| #80 | Sentry crash reporting for the mobile app | `22e5aca` |
| #78 | Internal activation of alerts/digest (live crons) | `ffa3ba3` |
| #77 | Smart Operations Alerts + Daily Digest engine | `600b6d4` |
| #75 | Operations Health Center | `91c11b7` |
| #73 | Order Integrity Watchdog | `411c7c9` |
| #71 | Health-summary foundation | `4c3d0bd` |

`docs/MIGRATIONS.md` maps every repository migration file to its applied
Production version.

## 9. Test & quality snapshot

- Root vitest: **764** tests recorded at the 2026-07-24 validation
  (`docs/MIGRATIONS.md` §18). The suite was **not** re-run for the 2026-07-29
  documentation changes — run `npm test` for the current figure before relying
  on it.
- TypeScript: root and mobile programs clean (`--noEmit`), root with real
  React 19 types (`@types/react@^19`, `@types/react-dom@^19`).
- SQL suites: alerts/digest/activation/watchdog/health/order-confirmation/
  loyalty-reason suites pass in the local PG harness. They are never run
  against Production.
- `npm audit` (root): 0 vulnerabilities at the last check. The mobile tree has
  one pre-existing upstream Expo advisory (documented in PR #80, not introduced
  by this repo).
- Bundles: no source maps shipped, no secrets, dev-only test tooling
  excluded from production output.
