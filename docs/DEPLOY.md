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
3. **Production Branch** (Project → Settings → Git): set it to the repository's
   default branch

   ```text
   claude/project-build-ie4b56
   ```

   > ⚠️ **This matters more than it looks.** If the Production Branch is unset or
   > points at any other branch, the default branch only ever deploys as a
   > **Preview**, and the production URL falls through to the admin SPA catch-all
   > rewrite — so `/` and `/app/` return byte-identical HTML and the customer Expo
   > web app is never actually served. That is the open defect tracked in
   > **Issue #102**. Earlier revisions of this document named the now-retired
   > branch `claude/spicy-meal-security-review-ks5kfs` here; that instruction was
   > wrong and is the reason the setting drifted.
   >
   > Do **not** push to `main` to force a deployment — `main` is a protected
   > branch (`CLAUDE.md` §1).

   Every other branch/PR still gets an automatic **Preview** URL.
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

## Verifying a Production deployment

Prefer a **fresh Production redeploy** of the default-branch HEAD rather than
promoting a stale Preview artifact, so the Production environment variables are
included during the build. Then confirm both apps are actually distinct:

```bash
# 1) Both respond
curl -sSI https://app.spicymeal.com.sa/      | head -1
curl -sSI https://app.spicymeal.com.sa/app/  | head -1

# 2) They are NOT byte-identical (the failure mode in Issue #102)
diff <(curl -sS https://app.spicymeal.com.sa/) <(curl -sS https://app.spicymeal.com.sa/app/) >/dev/null \
  && echo 'FAIL: / and /app/ are identical — Production Branch is wrong' \
  || echo 'OK: distinct documents'

# 3) /app/ references the Expo web entry bundle
curl -sS https://app.spicymeal.com.sa/app/ | grep -o '/app/_expo/static/js/web/entry-[^"]*\.js'
```

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
