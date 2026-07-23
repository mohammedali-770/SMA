# Spicy Meal (SMA) — Project Status & Developer Onboarding

> Last updated: 2026-07-23 (default-branch head `736a6a0`).
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
  builds go through EAS with **remote** versioning.

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

- **Ordering + checkout + Tap payments** (payment area is FROZEN — §7).
- **Lazywait POS integration**: `lazywait-sync` worker with deadline-bounded
  retries, `confirmation_required` lifecycle state, reaper, and an admin
  "Orders Requiring Verification" panel.
- **Order Integrity watchdog** + admin triage panel.
- **Operations Health Center**: staff RPC `operations_health_summary()`
  (SECURITY DEFINER, staff-gated with 42501) + admin panel.
- **Smart Operations Alerts + Daily Digest** (live and ACTIVE):
  evaluator cron `operations-alerts-evaluator` every 5 min, digest cron
  `operations-digest-generator` hourly (08:00 Asia/Riyadh in-function gate),
  AR/EN digests, alerts inbox in the admin dashboard. **External dispatch is
  disabled by design** — alerts/digests are internal (in-dashboard) only.
- **Sentry crash/error monitoring** (org `first-taste-trading-company`,
  project `react-native`) on all three surfaces:
  - mobile (PR #80): native + JS crashes, sampling prod 0.08;
  - web/admin (PR #83): `admin-web` + `expo-web` surface tags, sampling
    prod 0.05 — see §5 for the one pending owner action.
- **Auth**: Supabase auth with WhatsApp OTP flow. **Push notifications are
  DORMANT** (integration row disabled, no credentials) — do not enable.
- **Account deletion** flow (store-compliance requirement).

Migration state: the repo `supabase/migrations/` chain and the Production
migration history are reconciled through `docs/MIGRATIONS.md` (the
authoritative ledger — read it before touching anything database-related).
Live schema changes go ONLY through the owner-approved MCP `apply_migration`
workflow; `supabase db push` and `supabase migration repair` are permanently
forbidden against Production.

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
npm test                             # vitest: 653 tests (root + framework-free mobile)
npm --prefix apps/mobile run typecheck
npm run build                        # full production build (Vite + Expo web export)
```

Notes:
- Root vitest deliberately includes `apps/mobile/src/**/*.test.ts` for
  FRAMEWORK-FREE modules only (no RN/Expo imports in those test files).
- `supabase/tests/*.sql` run against a throwaway local PG harness — never
  against Production.
- Sentry is silent in dev unless you opt in (`VITE_SENTRY_DEV=1` /
  `EXPO_PUBLIC_SENTRY_DEV=1`); test runners are always silent.

## 5. Pending items / owner actions

- **Issue #81 (open)** — create the `SENTRY_AUTH_TOKEN` secret in EAS *and*
  Vercel so release builds upload source maps. Until then, Sentry ingestion
  works but stack traces are unsymbolicated. The token is a real secret:
  never commit it, never put it in `EXPO_PUBLIC_*`/`VITE_*`.
- **Issue #79 (follow-up)** — optional monitoring of pg_cron job health for
  the alerts/digest jobs.
- Store launch checklist lives in `docs/SENTRY_OBSERVABILITY.md`
  (launch-day verification) and `docs/MIGRATIONS.md` (schema state).

## 6. Authoritative docs (read these before changing the related area)

| Doc | Owns |
| --- | --- |
| `CLAUDE.md` | Change-control rules for ALL agent/automated work (§7 below) |
| `docs/MIGRATIONS.md` | Migration ledger + the only allowed Production schema workflow |
| `docs/OPERATIONS_ALERTS_DIGEST.md` | Alerts/digest engine, activation state, runbook |
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
2. **Payment/Tap area is FROZEN** (payment-verify, payment-webhook,
   checkout/session functions, Tap settings) — no changes without separate
   explicit owner approval.
3. **Push notifications stay disabled** — no credentials, no enabling.
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
| #83 | Sentry error monitoring for web + admin (`admin-web`/`expo-web`) | `736a6a0` |
| #80 | Sentry crash reporting for the mobile app | `22e5aca` |
| #78 | Internal activation of alerts/digest (live crons) | `ffa3ba3` |
| #77 | Smart Operations Alerts + Daily Digest engine | `600b6d4` |
| #75 | Operations Health Center | (merged, live) |
| #71 | Health-summary foundation | (merged, live) |

Production Supabase also carries the corresponding live migration versions —
`docs/MIGRATIONS.md` maps every repo file to its applied Production version.

## 9. Test & quality snapshot (at last merge)

- Root vitest: **653/653 passing** (admin logic, Edge-Function helpers,
  framework-free mobile logic, observability sanitization/classification).
- TypeScript: root and mobile programs clean (`--noEmit`), root now with
  real React 19 types.
- SQL suites: alerts/digest/activation/watchdog/health suites pass in the
  local PG harness.
- `npm audit` (root): 0 vulnerabilities. Mobile tree has one pre-existing
  upstream Expo advisory (documented in PR #80, not introduced by this repo).
- Bundles: no source maps shipped, no secrets, dev-only test tooling
  excluded from production output.
