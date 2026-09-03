# Deploying Spicy Meal Web Surfaces to Vercel

> **Updated 2026-08-12.** This runbook describes the current two-surface build. It does not document native EAS/store deployment; use `README_MOBILE.md` and `RELEASE_CHECKLIST.md` for that.

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
3. exports the Expo customer web app into `dist/app`.

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

The SPA catch-all can return `index.html` with HTTP 200 for an invalid application/asset path. Therefore:

- a 200 at `/` is only liveness evidence;
- a guessed asset URL returning 200 does not prove the asset exists;
- use actual asset references from the deployed entry document/bundle;
- use the deployment/commit SHA as the authoritative staleness check.

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

Do not perform online-payment/refund tests while the payment freeze is active unless separately approved.

## 9. Auto-deploy versus gated deploy

Repository source contains CI checks and a controlled deployment path, but **the current Vercel auto-deploy/dashboard state cannot be proved from Git source alone**.

If production policy is intended to be “deploy only after all CI checks pass,” verify the current setup against `OWNER_ACTIONS.md` §6 before changing anything:

- Vercel auto-deploy behavior;
- repository deploy-gate variable/secrets;
- exact GitHub check-run names;
- a successful preview/trial of the gated path.

Do not enable a second deploy path while auto-deploy is still active and accidentally double-deploy every merge.

## 10. Environment-variable changes

Vite/Expo public env values are build-time inputs. Changing them requires a new deployment/build to affect the shipped browser bundle.

After changing env values:

1. create/redeploy the intended environment;
2. verify the deployment used the new configuration without leaking values into logs;
3. verify the production alias moved to the intended artifact only when approved.

## 11. Rollback

Use `docs/ROLLBACK.md`. The goal is to return to a known reviewed deployment, not to make unreviewed edits directly in the Vercel dashboard under incident pressure.

Database/Edge Function rollback is a separate problem from web artifact rollback; follow the owning runbook and approval boundary.

## 12. Related docs

- `README.md` — current platform overview.
- `PROJECT_STATUS.md` — current source/release state.
- `docs/RELEASE_CHECKLIST.md` — release gates.
- `docs/OWNER_ACTIONS.md` — live dashboard/owner decisions.
- `docs/MAPS.md` — map provider configuration.
- `docs/SENTRY_WEB_OBSERVABILITY.md` — web observability.
- `docs/ROLLBACK.md` — mitigation/rollback.