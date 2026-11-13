# Deploying Spicy Meal Web Surfaces to Vercel

> **Updated 2026-08-12; §2 and §7 updated 2026-11-12.** This runbook describes the current two-surface build. It does not document native EAS/store deployment; use `README_MOBILE.md` and `RELEASE_CHECKLIST.md` for that.

## 1. What Vercel serves

One repository build produces two web applications and one public static page:

| Path | Application | Source |
| --- | --- | --- |
| `/` | Staff/admin entry surface | root Vite app under `src/` |
| `/app/` | Customer web application | Expo/React Native Web export from `apps/mobile/` |
| `/legal`, `/legal/<doc>` | **Public** legal & policy page — no login | second Vite entry `legal.html` + `src/legal/` |
| `/privacy`, `/terms`, `/support` | Aliases onto the same page | `vercel.json` rewrites |

The customer `/app` surface is the same Expo application used for native development; it is not the historical hand-built emulator.

**Why `/legal` exists and must keep working.** App Store Connect and Play Console both
require a privacy-policy URL a reviewer can open with **no account**; an in-app screen
does not satisfy either store. Its rewrites are listed in `vercel.json` **before** the
`/(.*)` catch-all — put anything after that catch-all and it silently serves the admin
shell instead, which is exactly the state that made this page necessary. The page reads
the active `legal_documents` rows anonymously (the `legal_documents_select_public` RLS
policy grants `anon` SELECT on `is_active` rows only), so editing a document in the
admin console updates the public page with no redeploy, and a draft can never leak.

The root app determines the signed-in role and exposes the staff/admin experience only through the current server-authorized role/MFA path.

## 2. Build pipeline

The repository production build is:

```bash
npm run build
```

The root script intentionally:

1. installs the mobile dependency tree;
2. builds the Vite/admin application;
3. exports the Expo customer web app into `dist/app`;
4. scans every shipped bundle for build-tool libraries that must never ship (`scripts/bundle-forbidden-libs.mjs`);
5. fails if any file under `dist/app/assets/` or `dist/app/_expo/` lacks a 32-hex content hash in its name (`scripts/check-immutable-asset-names.mjs`) — `vercel.json` serves both as `immutable` for a year, which is only correct for content-hashed names;
6. enforces the web performance budget (`scripts/web-budget.mjs`, below).

Steps 4-6 run inside the build rather than beside it, because `npm run build` is what Vercel runs: a failure there is a deploy that does not happen.

### Web performance budget

`scripts/web-budget.mjs` fails the build when `/app` grows past a threshold set just above what it measured on 2026-11-12. Sizes are brotli quality 4, the stand-in the assessment used for Vercel's on-the-fly compression; Vercel's own encoding measured about 6% larger for the entry, so compare these numbers with each other, not with a production transfer size.

| Measure | Threshold | Measured 2026-11-12 | Why it matters |
| --- | --- | --- | --- |
| `/app` entry bundle (br) | 1040 KB | 1 014 118 B | One bundle by design; every first visit downloads all of it before anything renders. |
| First load: entry + the 8 start-up fonts + brand mark (br) | 1900 KB | 1 862 605 B (entry 1 014 118, fonts 720 895, mark 127 592) | What a cold visit must fetch before the chooser is usable. With the old 885 px mark it was 2 123 038 B, which fails. |
| Any UI image under `dist/app/assets/assets/` or `dist/*.png` (raw) | 150 KB | largest 127 587 B (the brand mark) | PNG does not compress on the wire. `dist/logo.png` (430 KB) is exempt by name: it is the iOS `apple-touch-icon` and the logo master, and neither UI draws it. |

The start-up fonts are read from `DESIGN_SYSTEM_FONTS` in `apps/mobile/src/design-system/fonts.ts`, so registering another font is counted without editing the script. `src/lib/webBudget.test.ts` fails if the thresholds above drift from the script's.

**Lower a threshold when a change makes room; raise one only in a change that says why the growth is worth it.** The experience targets the budget stands in for, measured with the assessment's throttled-phone harness (400 kbps, 400 ms RTT, 4x CPU), and not enforced in CI:

- cold first paint under 2 s — met by the `/app` splash (first paint about 0.5 s; it was 22 s of blank page);
- cold chooser usable under 26.5 s now, 15 s as the target;
- warm chooser under 3.5 s, warm transfer under 60 KB, and **zero** revalidations of hashed assets on a warm load;
- total long tasks under 1.5 s at 4x CPU.

Do not reorder the mobile install behind the Vite build: root web source imports/transforms mobile/shared code whose TypeScript config depends on the Expo dependency tree.

Local pre-release check:

```bash
nvm use
npm ci
npm --prefix apps/mobile ci
npm run build
```

## 3. Production branch

Vercel Production must track:

```text
claude/project-build-ie4b56
```

Historically, issue #102 was caused by an unset Production Branch: the default branch produced Previews while the production alias stayed on an old build. That incident is history, not proof that the setting can never drift again.

Before a major release, verify in the **current Vercel dashboard** that the Production environment still tracks the intended branch and that the deployed Production artifact corresponds to the intended commit.

Do not push to an alternate branch such as the retired `main` name to force a deployment.

## 4. Vercel project configuration

Repository configuration lives in `vercel.json` and the root build scripts. Dashboard configuration should match the repository rather than override it accidentally.

Expected build/output:

```text
Build command: npm run build
Output directory: dist
```

`vercel.json` also defines SPA rewrites and security headers. Review the actual file before changing CSP/headers; do not copy an old list from documentation.

Any Production Vercel settings change requires explicit owner approval.

## 5. Environment variables

Both web surfaces need their public Supabase client configuration at build time.

Typical public variables include:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
```

Map-provider variables depend on the currently selected provider/configuration; use the checked-in `.env.example` files and `docs/MAPS.md` rather than copying a stale key list from this document.

### A production console build without its Supabase settings fails (since 2026-11-12)

`vite build` refuses to build when Vercel sets `VERCEL_ENV=production` and the
console has no `VITE_SUPABASE_URL`, or neither `VITE_SUPABASE_PUBLISHABLE_KEY`
nor `VITE_SUPABASE_ANON_KEY` (either key is enough, as at run time). The error
names what is missing. `supabaseBuildGuard` in `src/lib/supabaseKey.ts` decides,
and `vite.config.ts` calls it for every build.

- **Why.** Before this, the build succeeded and the console sent every request
  to a placeholder host, so nobody could sign in. Its startup warning also
  claimed a demo-data fallback that no longer exists; it now says requests will
  fail.
- **What a failed build does.** A failed Vercel build is never promoted, so
  production keeps serving the previous deployment. Fix the variables and
  redeploy (§10).
- **Preview builds only warn**, loudly, in the build log. A build outside Vercel
  (CI, local) sets no `VERCEL_ENV` and is not checked.
- **`/app` has no such gap.** `apps/mobile/scripts/export-web.js` falls back to
  committed public values for `EXPO_PUBLIC_SUPABASE_URL` and the legacy anon key,
  so the Expo web export always has a configuration. It is not checked here.

### Secret rule

Never expose a server secret through a browser-prefixed variable:

- no Supabase `service_role` key in `VITE_*` or `EXPO_PUBLIC_*`;
- no payment/provider secret;
- no Meta app secret;
- no SMTP password;
- no `SENTRY_AUTH_TOKEN` in a client-public variable.

The Supabase anon/publishable key is a client credential by design; RLS/JWT/server authorization remains the security boundary.

## 6. Authentication / staff access after deployment

Do **not** bootstrap staff access with the old direct SQL shortcut that used to live in this runbook.

Current staff access has audited role administration plus an AAL2/TOTP gate. Use the supported admin Staff Access workflow / server-authorized role-administration contracts documented by the current source.

Customer login is the current Supabase Auth + WhatsApp phone flow; do not configure deployment around the old email/password onboarding description.

If an environment has no usable initial administrator, treat bootstrap as a deliberate privileged recovery/setup action and document/approve the exact method rather than adding an ad-hoc SQL promotion command to a general deployment guide.

## 7. Verify the deployment, not only the merge

A successful merge/check does not prove which artifact the production alias serves.

### Surface checks

```bash
D=https://<production-domain>

curl -sSI "$D/" | head -1
curl -sSI "$D/app/" | head -1
curl -sSI "$D/legal" | head -1
curl -sSI "$D/privacy" | head -1
```

Confirm the routes load the expected distinct applications. For `/legal` and `/privacy`,
a 200 is not sufficient — the catch-all rewrite also returns 200 while serving the admin
shell. Open one in a browser and confirm the policy text renders, signed out.

### Production commit/artifact check

Use Vercel Deployments to verify:

- there is a **Production** deployment, not only Preview deployments;
- it came from `claude/project-build-ie4b56`;
- its commit SHA is the release you intend to serve.

Where the built application embeds the Vercel commit SHA, compare the deployed SHA to the production-branch head. A stale alias should be treated as a release failure.

### Do not trust an arbitrary HTTP 200

The SPA catch-all returns `index.html` with HTTP 200 for any unknown application path. Therefore:

- a 200 at `/` is only liveness evidence;
- use actual asset references from the deployed entry document/bundle;
- use the deployment/commit SHA as the authoritative staleness check.

**Since 2026-11-12 a missing file under a hashed-asset prefix is a 404, not the shell.** The two catch-all rewrites exclude `/assets/`, `/app/_expo/` and `/app/assets/` (`vercel.json`, pinned by `src/lib/vercelConfig.test.ts`). Before that, a chunk a deploy had removed came back as the HTML shell, 200, under the one-year `immutable` header, so a browser cached HTML under a script URL for a year. Every SPA route still resolves: the test derives the `/app` routes from `apps/mobile/src/app` and resolves each one.

### Caching of hashed assets

`/assets/` (console, Vite), `/app/_expo/` (customer bundle) and `/app/assets/` (customer fonts and images, added 2026-11-12) are served `public, max-age=31536000, immutable`. Until `/app/assets/` was added, every warm `/app` load revalidated 9 hashed files — the 8 fonts and the brand mark — before it could use them. Everything else gets Vercel's default `public, max-age=0, must-revalidate`, which is what keeps `index.html` fresh after a deploy.

**A 404 under those prefixes still carries the `immutable` header.** Vercel attaches `headers` by request path before it looks for a file — `vercel build` compiles them to `continue: true` routes ahead of `{ handle: 'filesystem' }` — and `vercel.json` has no way to condition a header on status. A browser can therefore hold a miss for a year. That only matters for a client that asked for a file the current deploy does not have, i.e. a tab that outlived its deploy, and two things cover it:

- the staff console listens for `vite:preloadError` (`src/lib/staleAssetRecovery.ts`): it refetches the failing URL with `cache: 'reload'`, which overwrites the cached miss, then reloads once, guarded by a sessionStorage timestamp so a broken deploy cannot loop. Measured on a local replica of these rules: a chunk cached as 404, restored by a rollback, still failed from cache on a plain request; after the listener ran it loaded, with one reload;
- the customer app is one bundle, so it has no lazy chunk to miss. Its only exposure is an `index.html` fetched from one deploy whose entry request lands on the next; a reload fixes that, because `index.html` is revalidated every time.

**Vercel Skew Protection is the complete fix and is an owner option, not configured here.** With it, a client keeps receiving the assets of the deploy it loaded, so a removed chunk is never requested from a deploy that lacks it. It is a project setting in the Vercel dashboard, available by plan, and changing it is a Vercel Production change under CLAUDE.md §5. Nothing in this repository depends on it.

### Security headers

Verify the deployed response still includes the security headers defined by the current `vercel.json`:

```bash
curl -sSI "$D/" | grep -iE \
  'content-security-policy|strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy'
```

If a legitimate resource is blocked, change the minimum required directive in `vercel.json`, review it, and redeploy. Do not weaken CSP globally to make a console warning disappear.

## 8. Application smoke checks

After an approved web release:

- customer `/app` reaches the real Supabase-backed app;
- WhatsApp/Supabase login flow reaches the expected state;
- order-type gate and catalog load;
- admin/staff login reaches the staff MFA/role gate;
- Live Orders loads;
- Operations Health does not show a new release-caused failure;
- Sentry receives expected environment/release metadata under the approved observability test.

Do not perform online-payment/refund tests as part of an ordinary release. A live payment or refund is its own owner approval (CLAUDE.md §5). The payment freeze was lifted for repository work on 2026-11-11; the planned live payment test is `OWNER_ACTIONS.md` §47.18.

## 9. Auto-deploy versus gated deploy

Repository source contains CI checks and a controlled deployment path, but **the current Vercel auto-deploy/dashboard state cannot be proved from Git source alone**.

**Measured 2026-11-11, read-only: the gated job did not deploy the #424 merge, and the merge reached production anyway.**
- On `577e7e7`, `Deploy to Vercel (gated on CI)` concluded **skipped**. Its three needed jobs were green and the event was a push to the default branch, so the skip means the repository variable `DEPLOY_GATE_ENABLED` is not `'true'`.
- By 05:15 UTC, production `/app` was serving that merge's bundle: its entry chunk carries #424's "keep browsing" text, which first appears on the default branch in that merge.
- So a merge to the default branch reaches production by a path outside this repository's workflows, most plausibly Vercel's Git integration (auto-deploy).

That answers the first item below for the moment it was read. It is dashboard state and can change without a commit, so re-check it before relying on it. Detail: `MIGRATIONS.md` §52.

If production policy is intended to be “deploy only after all CI checks pass,” verify the current setup against `OWNER_ACTIONS.md` §6 before changing anything:

- Vercel auto-deploy behavior;
- repository deploy-gate variable/secrets;
- exact GitHub check-run names;
- a successful preview/trial of the gated path.

Do not enable a second deploy path while auto-deploy is still active and accidentally double-deploy every merge.

**The gated deploy job runs a pinned Vercel CLI** (`vercel@65.3.1`, pinned 2026-11-10). It used to run `npx vercel@latest` three times with the production token, so whatever release npm served that day would have run next to it. The EAS workflows pin `eas-cli` (25.3.0) and install with `--ignore-scripts`, because `EXPO_TOKEN` is in their environment; the two Supabase workflows pin the Supabase CLI (2.122.0). `scripts/check-workflow-pins.mjs`, run by the `Change-control guard` job, fails on any `latest`. Bump a pin deliberately, in its own commit, and say which version and why — `docs/DEPENDENCY_ADVISORIES.md` §8.

## 10. Environment-variable changes

Vite/Expo public env values are build-time inputs. Changing them requires a new deployment/build to affect the shipped browser bundle.

After changing env values:

1. create/redeploy the intended environment;
2. verify the deployment used the new configuration without leaking values into logs;
3. verify the production alias moved to the intended artifact only when approved.

## 11. Rollback

Use `docs/ROLLBACK.md`. The goal is to return to a known reviewed deployment, not to make unreviewed edits directly in the Vercel dashboard under incident pressure.

Database/Edge Function rollback is a separate problem from web artifact rollback; follow the owning runbook and approval boundary.

## 12. Supabase Edge Functions — the payment set

**Added 2026-11-12.** This runbook is about Vercel, but one Edge Function rule
belongs beside it, because the workflow that deploys functions changed with the
Moyasar-only work (CLAUDE.md §6).

**Every deploy of an Edge Function is its own owner approval** (CLAUDE.md §5).
Nothing below grants one.

### The seven payment functions deploy as one set

| Function | `verify_jwt` | Who calls it |
| --- | --- | --- |
| `payment-initiate` | true | the signed-in customer's app |
| `payment-verify` | true | the signed-in customer's app |
| `payment-webhook` | **false** | Moyasar; authenticated by the webhook secret token |
| `payment-return` | **false** | the customer's browser, after Moyasar's page |
| `payment-refund` | **false** | the `payment-refund-worker` cron job, with `refund_trigger_secret` |
| `payment-test-config` | true | an administrator at AAL2, from the console |
| `payment-admin-test-return` | **false** | the browser, after the console's sandbox test |

The values are those in `supabase/config.toml` on 2026-11-12.

**Deploy all seven in one run.** A new payment bundle beside an older one can
open a Moyasar invoice that nothing confirms. `payment-admin-test-return` is new:
it replaces `tap-admin-test-return`, and `payment-test-config` points its sandbox
return at it.

**Order.** Apply `20260824100000_moyasar_payment_provider`, then
`20261003120000_moyasar_only_payments`, each named by version, before this
deploy. Apply `20261004120000_drop_tap_payment_rpcs` only after it. The full
order, with what "done" looks like at each step, is `OWNER_ACTIONS.md` §47.

### `verify_jwt` comes from `supabase/config.toml`

`.github/workflows/deploy-functions.yml` reads each function's
`[functions.<name>] verify_jwt` from `supabase/config.toml` when the job runs:

- `false` deploys with `--no-verify-jwt`;
- `true` deploys with verification on;
- a function with no table, or no `true`/`false` value, stops the run with an
  error.

No list in the workflow can drift from the config. Until 2026-11-11 the workflow
carried its own hard-coded list, which named only `payment-webhook` and
`payment-return`; `payment-refund` would have deployed with verification on and
refused the refund cron job. `deployFunctionsWiring.test.ts` runs the workflow's
own function against the real `config.toml`.

The `all` input deploys exactly the seven above and prints the required
migration order. Any other function must be named.

**As far as the record shows, the workflow has never deployed anything.** It
needs the repository secret `SUPABASE_ACCESS_TOKEN`, which `OWNER_ACTIONS.md` §15
records as never created, and recommends against creating. A deploy by hand (Supabase dashboard or CLI)
must use the same `verify_jwt` values as the table above.

### The old slug is deleted separately, later

`tap-admin-test-return` is still deployed in Production (2026-11-11). Deleting it
is a separate, destructive owner action, done only after the seven-function
deploy (`OWNER_ACTIONS.md` §47.6). Until then a function-name drift report lists
it as extra and `payment-admin-test-return` as missing.

### A secret the payment functions read

`MOYASAR_PROXY_URL` is an Edge Function secret, set in the Supabase dashboard,
never in a `VITE_*` or `EXPO_PUBLIC_*` variable and never in a chat. Every Moyasar
call goes through the proxy when it is set. An unusable value refuses every
Moyasar call, TEST included (`OWNER_ACTIONS.md` §47.11).

## 13. Related docs

- `README.md` — current platform overview.
- `PROJECT_STATUS.md` — current source/release state.
- `docs/RELEASE_CHECKLIST.md` — release gates.
- `docs/OWNER_ACTIONS.md` — live dashboard/owner decisions.
- `docs/MAPS.md` — map provider configuration.
- `docs/SENTRY_WEB_OBSERVABILITY.md` — web observability.
- `docs/ROLLBACK.md` — mitigation/rollback.
- `docs/OWNER_ACTIONS.md` §47 — the Moyasar go-live steps, in order.