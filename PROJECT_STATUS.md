# Spicy Meal (SMA) — Project Status & Developer Onboarding

> Last updated: 2026-08-05 (default-branch head `160401d`).
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
  app.json              Static Expo config (single source of truth)
  app.config.js         Dynamic layer: drops the Sentry config plugin when
                        SENTRY_AUTH_TOKEN is absent (see docs/SENTRY_*)
  eas.json              EAS build profiles (development / preview / production)
  src/app/              expo-router routes (incl. dev-sentry test screen)
  src/lib/observability/  Sentry: mobile (index.ts), web (index.web.ts),
                          shared framework-free sanitize/classify/config,
                          webCore/webConfig/webRoutes/webClassify
  scripts/export-web.js Web export wrapper (public env injection)
src/                    Admin console (Vite): components/, context/, lib/
  components/AdminDashboard.tsx + components/admin/  staff panels
  lib/                  API/capability/business-logic modules (unit-tested)
design-system/          "Ember on Cream" shared source of truth: tokens.ts,
                        money.ts, buttonState.ts, fieldState.ts. Synced into
                        the two apps by scripts/sync-design-system.mjs; CI
                        enforces it (npm run design-system:check).
scripts/                sync-design-system.mjs, check-design-system-hygiene.mjs,
                        branch-audit.sh (git branch classifier)
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
    prod 0.05.
  Ingestion works everywhere; **stack traces are unsymbolicated** until the
  `SENTRY_AUTH_TOKEN` secret exists (§5).
- **Auth**: Supabase auth with WhatsApp OTP flow.
- **Account deletion** flow (store-compliance requirement).
- **Push notifications are DORMANT.** The `push`/`expo` integration row is
  `enabled = false` (set 2026-07-29 with owner approval), with zero credentials
  and zero registered devices. Do not enable it.

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

**65** live `schema_migrations` rows; **64** repository migration files;
**zero unapplied**. Latest live version `20260805061955`.

Three migrations were applied on **2026-08-05** with explicit owner approval,
through the MCP `apply_migration` workflow — one call per file, in filename
order, following `docs/MIGRATION_RUNBOOK_20260801_ADDRESS_DELETE.md`:

| File | From | Applied version |
| --- | --- | --- |
| `20260801120000_address_single_default.sql` | PR #142 | `20260805061621` |
| `20260801120100_checkout_session_address_fk_set_null.sql` | PR #142 | `20260805061912` |
| `20260802120000_address_description_trim_all_whitespace.sql` | PR #146 | `20260805061955` |

Together these make one default address per customer a server-enforced
invariant, let a customer delete an address that has backed an online checkout
(with a guard so a captured payment can never fail to become an order), and
close a live defect where a landmark of only tabs and newlines satisfied the
courier-landmark rule.

The checkout-session snapshot fingerprint was **identical before and after**
(`0bffc7257feb7ff29731ec6ac35247fd`), so no session row was written or
re-priced. Advisors report zero ERROR on both Security and Performance. The full
pre-live and verification record is in `docs/MIGRATIONS.md` §1.

> ⚠️ **Two follow-ups remain.** The application smoke test (run-book Step 4.5 —
> add/promote an address and the three delete cases, in the app as a real
> customer) has **not** been done and needs a device. Version alignment
> (run-book Step 3) was deliberately skipped: it is a separate live history
> write needing its own explicit owner approval, and skipping it just leaves a
> class-B entry, which is what most of the ledger already looks like.

Earlier context, still accurate: ten migrations were applied on 2026-07-29,
eight of them closing a Production incident in which the deployed frontend was
running eight migrations ahead of the database.

> **Do not reconcile the ledger by comparing filename version prefixes to
> `schema_migrations.version` — they do not match.** Repository filenames carry
> their own timestamps (e.g. `20260707120000_extensions_enums_helpers.sql` is
> live as version `20260708062345`), and three older files map to differently
> named rows: `place_order`, `loyalty` and `order_idempotency` were consolidated
> into `order_idempotency_and_place_order` and `harden_trigger_functions`, and
> `checkout_sessions` was applied as three rows. Mapping is **by name, through
> `docs/MIGRATIONS.md`** — that is what the ledger is for, and a naive version
> diff reports ~54 false "unapplied" migrations.

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

# 5) Expo config sanity (after touching app.json / app.config.js)
npx --prefix apps/mobile expo config --type prebuild --json > /dev/null
#    Full source-map gate check: docs/SENTRY_OBSERVABILITY.md
#    → "Verifying the source-map gate"
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

- **Issue #102 (open)** — set the Vercel **Production Branch** to
  `claude/project-build-ie4b56` and trigger a fresh Production redeploy. While it
  is unset, the default branch only deploys as a Preview and `/` and `/app/`
  serve byte-identical HTML, so the customer Expo web app is not actually being
  served in production. Owner action only (Vercel dashboard) — see
  `docs/DEPLOY.md`.

  **This is the single largest open production-readiness gap** — it is the one
  item that means the customer app is not truly live.

Closed since the last update:

- **Issue #81 (closed 2026-07-29, completed)** — the `SENTRY_AUTH_TOKEN`
  source-map secret. Both upload gates are conditional
  (`apps/mobile/app.config.js`, `vite.config.ts`) and activate on their own once
  the token is present; no code change was required.

### Open pull-request queue — 13 PRs

Thirteen pull requests are open against the default branch, several of them
production-readiness gates (CI gates #147, release discipline #152, mobile
store readiness #149, route guards #151). They are small and, in the order
given, almost collision-free.

**`docs/GIT_BRANCHES.md` is authoritative** for the queue: it lists every PR,
the recommended merge order, the three file collisions, the one stacked pair
(#146 sits on #145, not on the default branch) and the one superseded PR
recommended for closure (#111). Read it before merging anything.

Needs an owner decision:

- **Discounts & campaigns** — eight business questions in
  `docs/DISCOUNTS_CAMPAIGNS.md` block wiring campaigns into `place_order`.

Resolved 2026-07-29:

- **Push integration row.** It had drifted to `enabled = true` in Production
  (with zero credentials and zero devices) while `CLAUDE.md` §7 and this
  document both described it as disabled. With owner approval it was set back to
  `enabled = false`, so Production now matches the documented intent. Exactly one
  row changed; no credentials were added or removed.

Documentation debt:

- The five account-deletion migrations are applied and live but not yet itemized
  in `docs/MIGRATIONS.md` §4/§5 (tracked in §1 of that document).

## 6. Authoritative docs (read these before changing the related area)

| Doc | Owns |
| --- | --- |
| `CLAUDE.md` | Change-control rules for ALL agent/automated work (§7 below) |
| `docs/GIT_BRANCHES.md` | Git branch inventory, the open-PR merge order, branch hygiene |
| `docs/MIGRATIONS.md` | Migration ledger + the only allowed Production schema workflow |
| `docs/PAYMENT_POSTPONEMENT.md` | The payment/refund freeze: scope, live state, resume checklist |
| `docs/DEPLOY.md` | Vercel deployment, Production Branch, env vars, verification |
| `docs/OPERATIONS_ALERTS_DIGEST.md` | Alerts/digest engine, activation state, runbook |
| `docs/ORDER_CONFIRMATION_FLOW.md` | Order confirmation lifecycle + refund enrolment rules |
| `docs/DISCOUNTS_CAMPAIGNS.md` | Campaigns schema, what is live, open business questions |
| `docs/SENTRY_OBSERVABILITY.md` | Mobile crash reporting runbook + the source-map gate |
| `docs/SENTRY_WEB_OBSERVABILITY.md` | Web/admin error monitoring runbook |
| `docs/INCIDENT_RESPONSE.md` | What to do when it breaks — **and why nothing pages you** |
| `docs/ROLLBACK.md` | Getting back to a known-good state, per surface |
| `docs/BACKUP_RECOVERY.md` | Backup/PITR state (**UNVERIFIED**) and the restore drill |
| `docs/DEPENDENCY_ADVISORIES.md` | The audit gate and its standing exceptions |
| `docs/OWNER_ACTIONS.md` | **Everything blocked on the owner**, ordered by risk |
| `SECURITY.md` | How to report a vulnerability to us |
| `README.md` / `README_MOBILE.md` | General app documentation |

> ⚠️ **Two of these describe gaps, not capabilities.** `docs/BACKUP_RECOVERY.md`
> records that no backup has been verified and no restore has ever been drilled;
> `docs/INCIDENT_RESPONSE.md` §1 records that no alert can currently reach a
> human. Read both before assuming this system is operationally covered.

## 7. Rules that must never be broken

These are binding for humans and AI agents alike (full text in `CLAUDE.md`):

1. **Never commit/push directly to the protected branches**
   (`claude/project-build-ie4b56` = production default, and `main`).
   Every change: fresh branch off the default branch → PR → explicit owner
   approval → merge. A PreToolUse hook additionally blocks agent sessions
   from editing on a protected checkout. **Delete the head branch when a PR
   merges** — see `docs/GIT_BRANCHES.md` §7 for why (60 branches accumulated,
   47 of them finished).
2. **Payment/Tap area is FROZEN and payment work is POSTPONED** — no changes
   without separate explicit owner approval, and none at all until a gateway
   provider is selected (`docs/PAYMENT_POSTPONEMENT.md`).
3. **Push notifications stay dormant** — row disabled, no credentials, no
   enabling.
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
| #144 | Run-book for the two unapplied address-deletion migrations | `9032dfa` |
| #143 | Admin dashboard navigation + branch overview reorganized | `e3130a2` |
| #142 | Customer profile address and name management (mobile) | `d2bf2ea` |
| #141 | Money display: configured VAT rate, mono price digits, delivery fee | `8faaca5` |
| #140 | Accessible focus management in the console modals | `7979129` |
| #139 | Muted ink raised to WCAG AA | `76887b2` |
| #118–#136 | **"Ember on Cream" design system** — tokens, self-hosted fonts, shared Price/Button/Field, then a surface-by-surface migration of the customer app and the entire admin console, ending in the removal of all legacy mobile UI | `271cc22`…`e5b1c72` |
| #120 | Repository standardized on Node 22 via `.nvmrc` | `e5458984` |
| #116 | Corrected the source-map gate verification commands | `1a69416` |
| #115 | Conditional Sentry source-map gate on mobile (`app.config.js`) | `537d345` |
| #114 | Production EAS builds no longer fail on the missing Sentry token | `bff19ff` |
| #113 | Payment postponement + migration ledger reconciliation + doc corrections | `9f0ec87` |
| #112 | Refund worker scheduler + stale-claim reaper; `caller_can_read_order` anon revoke | `e36fff1` |
| #85 | Operations automation cron health | `06c9bb0` |
| #84 | `PROJECT_STATUS.md` onboarding document | `e520f0a` |
| #83 | Sentry error monitoring for web + admin (`admin-web`/`expo-web`) | `736a6a0` |
| #80 | Sentry crash reporting for the mobile app | `22e5aca` |
| #78 | Internal activation of alerts/digest (live crons) | `ffa3ba3` |

`docs/MIGRATIONS.md` maps every repository migration file to its applied
Production version.

## 9. Test & quality snapshot

- Root vitest: **1605 tests across 107 files, all passing** — re-run and
  verified 2026-08-05 at head `9032dfa`. `npm run lint` (root `tsc --noEmit`)
  is clean. (The previously recorded figure of 764 was from 2026-07-24 and is
  superseded.)

  > **`npm test` requires `apps/mobile` dependencies to be installed.** Root
  > vitest deliberately includes the framework-free `apps/mobile` tests, and
  > `apps/mobile/tsconfig.json` extends `expo/tsconfig.base`. Without
  > `npm --prefix apps/mobile ci`, 44 of the 107 test files fail to load with
  > `failed to resolve "extends":"expo/tsconfig.base"`. That is a missing
  > install, not a broken test — run both installs from §4 before trusting a
  > red suite.
- **Sentry source-map gate (`apps/mobile/app.config.js`, #115) — VERIFIED
  2026-07-29.** Both checks in `docs/SENTRY_OBSERVABILITY.md` →
  "Verifying the source-map gate" pass: direct evaluation returns **4** plugins
  without the token and **5** with it, and `expo config --type prebuild` reports
  the Sentry plugin absent (**0**) then present (**1**). Config resolution
  succeeds, so the file cannot break a build, and Expo genuinely honours the
  gate rather than only the function returning the right value.
  **Still unproven:** that omitting the plugin leaves *native crash capture*
  intact — config resolution cannot establish that. The reasoning is that the
  native SDK is autolinked from the `@sentry/react-native` dependency and
  started by `Sentry.init()`, with Debug IDs from the `getSentryExpoConfig`
  Metro wrapper, none of which route through the config plugin. The first
  production EAS build is the definitive check: it should complete, and Sentry
  should still receive events from that build.
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
