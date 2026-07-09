# Deploying Spicy Meal (web/admin) to Vercel

The web app (customer storefront + Admin Dashboard) is a static Vite SPA. There is
**no separate admin URL** — after you sign in, the app renders the Admin Dashboard
at the site root when your `profiles.role` is `admin`/`accountant` (see the
"Bootstrapping the first admin" section in `supabase/README.md`).

`vercel.json` (repo root) already pins the build settings, an SPA rewrite, and the
security headers (CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`) recommended by the security review. The
CSP is tuned to what the app actually uses: Supabase REST + realtime WebSocket,
Google Fonts, and `https:`/`data:` images. **No secret is stored in this repo.**

## One-time setup (Vercel dashboard)

1. Go to https://vercel.com → **Add New… → Project** → **Import Git Repository**,
   and pick `mohammedali-770/SMA`. Authorize Vercel for the repo if prompted.
2. Vercel auto-detects **Vite** (Build = `npm run build`, Output = `dist`). Leave as
   detected — `vercel.json` also declares them.
3. **Production Branch** (Project → Settings → Git): set it to the branch you want
   live. This deploy config currently lives on
   `claude/spicy-meal-security-review-ks5kfs`; set that as the Production Branch, or
   merge the config into your default branch first, so the headers/rewrite apply to
   production. Every other branch/PR gets an automatic **Preview** URL.
4. **Environment Variables** (Project → Settings → Environment Variables) — add both
   for the **Production** (and Preview) environments:

   | Name | Value | Notes |
   |---|---|---|
   | `VITE_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` | from Supabase → Settings → API |
   | `VITE_SUPABASE_ANON_KEY` | your **anon / public** key | public-safe; RLS is the boundary |

   > ⚠️ Only the **anon** key. NEVER put the `service_role` key (or any provider
   > secret) in a `VITE_`-prefixed variable — it would ship to the browser.
   > Without these two vars the site builds and runs on **bundled demo data** (no
   > real login/admin).

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

## Redeploys

Any push to the Production Branch auto-builds and redeploys. Preview deployments are
created for PRs automatically. To change env vars, edit them in the Vercel dashboard
and redeploy (env is read at build time).

## Verifying the security headers

After deploy, check the headers are present:
```bash
curl -sSI https://<your-app>.vercel.app | grep -iE 'content-security-policy|strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy'
```
If a browser console shows a CSP violation for a resource the app legitimately needs,
adjust the matching directive in `vercel.json` and redeploy (validate against the
live app before tightening further).
