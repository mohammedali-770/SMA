# Deploying Spicy Meal (web/admin) to Vercel

The Vercel site serves **two** applications from one build:

| Path | App | Source |
| --- | --- | --- |
| `/` | Customer storefront + Admin Dashboard (static Vite SPA) | `src/` |
| `/app/` | Customer Expo web app | `apps/mobile/`, exported by `expo export --platform web` into `dist/app` |

There is **no separate admin URL** — after you sign in at the root, the app
renders the Admin Dashboard when your `profiles.role` is `admin`/`accountant`
(see the "Bootstrapping the first admin" section in `supabase/README.md`).

`npm run build` runs the whole pipeline: `npm --prefix apps/mobile ci` →
`vite build` → the Expo web export into `dist/app`. The mobile install must come
first — `vite build` transforms `apps/mobile/src`, whose tsconfig extends
`expo/tsconfig.base`, so it needs `apps/mobile/node_modules` to already exist.

`vercel.json` (repo root) already pins the build settings, an SPA rewrite, and the
security headers (CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`) recommended by the security review. The
CSP is tuned to what the app actually uses: Supabase REST + realtime WebSocket,
Sentry ingestion, Google Fonts, and `https:`/`data:` images. **No secret is stored
in this repo.**

## One-time setup (Vercel dashboard)

1. Go to https://vercel.com → **Add New… → Project** → **Import Git Repository**,
   and pick `mohammedali-770/SMA`. Authorize Vercel for the repo if prompted.
2. Vercel auto-detects **Vite** (Build = `npm run build`, Output = `dist`). Leave as
   detected — `vercel.json` also declares them.
3. **Production Branch** — **Project → Settings → Environments → Production**.
   Set the tracked branch to the repository's default branch:

   ```text
   claude/project-build-ie4b56
   ```

   > 📍 **It is under Environments, not Git.** Vercel moved it: Settings → Git
   > now holds only the repository connection and commit behaviour, while
   > branch-to-environment mapping lives under Environments. Earlier revisions of
   > this document sent readers to Settings → Git, and before that named the
   > now-retired branch `claude/spicy-meal-security-review-ks5kfs`. Both wrong
   > instructions are why the setting drifted in the first place.

   > ⚠️ **Setting this does NOT fix existing deployments.** A deployment's
   > environment is decided **when it is created**, so every deployment built
   > before the setting took effect stays a **Preview** forever. After changing
   > it you must either push a new commit, or open **Deployments**, find the
   > newest build of the default branch and use **⋯ → Promote to Production**.
   > Promoting is what creates the first Production deployment and moves the
   > production alias.
   >
   > Do **not** push to `main` to force a deployment — `main` is a protected
   > branch (`CLAUDE.md` §1).

   Every other branch/PR still gets an automatic **Preview** URL.

   **Resolved 2026-08-05 (Issue #102).** The Production Branch was unset, so the
   default branch only ever deployed as a Preview and production served a build
   roughly two days stale — fifteen merged pull requests, including the customer
   -note fix and the removal of false ZATCA compliance claims, were not reaching
   customers. Fixed by setting the branch **and promoting** the newest build.
   Verified with §"Verifying what production is actually serving" below.
4. **Environment Variables** (Project → Settings → Environment Variables) — add
   these for the **Production** (and Preview) environments:

   | Name | Value | Notes |
   |---|---|---|
   | `VITE_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` | from Supabase → Settings → API |
   | `VITE_SUPABASE_ANON_KEY` | your **anon / public** key | public-safe; RLS is the boundary |
   | `EXPO_PUBLIC_SUPABASE_URL` | same project URL | consumed by the `/app` customer build |
   | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | same anon key | consumed by the `/app` customer build |
   | `EXPO_PUBLIC_MAP_PROVIDER` | `google` | customer map |
   | `EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | browser-restricted Maps key | never commit it |
   | `EXPO_PUBLIC_MAP_WEBVIEW_BASE_URL` | `https://app.spicymeal.com.sa/app/` | customer map WebView origin |

   > ⚠️ Only the **anon** key. NEVER put the `service_role` key (or any provider
   > secret) in a `VITE_`- or `EXPO_PUBLIC_`-prefixed variable — those ship to the
   > browser. The same rule applies to `SENTRY_AUTH_TOKEN` (Issue #81): it is a
   > build-time secret only, and must never be `VITE_`/`EXPO_PUBLIC_`.
   > Without the Supabase vars the site builds and runs on **bundled demo data**
   > (no real login/admin).

5. Click **Deploy**. You'll get a URL like `https://sma-<hash>.vercel.app` (add a
   custom domain later in Settings → Domains).

## After it's live

1. In **Supabase → Authentication → URL Configuration**, add your Vercel URL to the
   **Site URL** / **Redirect URLs** so email/password sign-in works from that origin.
2. Sign up a normal account in the app, then promote it in the Supabase SQL editor:
   ```sql
   update public.profiles set role = 'admin' where id = '<auth-user-uuid>';
   ```
3. Sign in with that account → the **Admin Dashboard** renders at the site root.

## Verifying what production is actually serving

> ⚠️ **The `/` vs `/app/` check below is necessary but NOT sufficient.** On
> 2026-08-05 it **passed while production was serving a two-day-old build**. It
> only detects the catch-all-rewrite failure, not a stale or unpromoted
> deployment. Treat it as step 1 of 3, never as the answer.

### 1. Both surfaces respond and are distinct

```bash
curl -sSI https://app.spicymeal.com.sa/      | head -1
curl -sSI https://app.spicymeal.com.sa/app/  | head -1

diff <(curl -sS https://app.spicymeal.com.sa/) <(curl -sS https://app.spicymeal.com.sa/app/) >/dev/null \
  && echo 'FAIL: / and /app/ are identical — the customer app is not being served' \
  || echo 'OK: distinct documents'

curl -sS https://app.spicymeal.com.sa/app/ | grep -o '/app/_expo/static/js/web/entry-[^"]*\.js'
```

### 2. Did the alias actually move? — the `age` header

A production deployment purges the edge cache. If `age` keeps climbing across a
deploy, **the alias never moved** and you are looking at an old artifact.

```bash
curl -sSI https://app.spicymeal.com.sa/ | grep -iE '^age:|x-vercel-cache'
```

`age: 0` right after promoting is what success looks like. `age: 171417`
(≈47 h) is what Issue #102 looked like.

Equivalent check in the dashboard, and the fastest tell of all: open
**Deployments** with *All Environments* selected. **If every row is badged
`Preview` and there is no `Production` row, nothing has ever been promoted** —
that is the #102 condition, visible at a glance.

### 3. Is it *today's* code? — grep a known-recent string

The only check that actually proves what shipped.

```bash
D=https://app.spicymeal.com.sa
# a) real chunk names are INSIDE the entry bundle, not in index.html
ENTRY=$(curl -sS $D/ | grep -oE '/assets/index-[^"]+\.js' | head -1)
curl -sS "$D$ENTRY" | grep -oE '[A-Za-z0-9_]+-[A-Za-z0-9_-]{8}\.js' | sort -u

# b) fetch the chunk you care about and grep it for something merged recently
curl -sS "$D/assets/AdminDashboard-<hash>.js" | grep -c 'Customer note:'
```

> 🪤 **`vercel.json`'s SPA catch-all returns `index.html` with HTTP 200 for any
> unknown path.** So a guessed asset URL "succeeds" with a ~545-byte HTML page,
> and grepping it for JavaScript finds nothing — which reads as "the code is
> missing" when the URL was simply wrong. Always take chunk names from the
> deployed entry bundle (step a). Never assume a 200 means the file exists.

> Production asset hashes legitimately differ from a local `npm run build`,
> because the real build injects `VITE_*` / `EXPO_PUBLIC_*` values. Hash
> mismatch is **not** evidence of staleness; a missing string is.

Then check the security headers:
```bash
curl -sSI https://app.spicymeal.com.sa/ | grep -iE 'content-security-policy|strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy'
```
If a browser console shows a CSP violation for a resource the app legitimately needs,
adjust the matching directive in `vercel.json` and redeploy (validate against the
live app before tightening further).

Never let an API key or environment-variable **value** appear in deployment logs.

## Redeploys

Any push to the Production Branch auto-builds and redeploys. Preview deployments are
created for PRs automatically. To change env vars, edit them in the Vercel dashboard
and redeploy (env is read at build time).

> Vercel production changes require explicit owner approval (`CLAUDE.md` §5).
