# Supabase API keys — moving off the legacy `anon` / `service_role` keys

> Owner of: `supabase/functions/_shared/apiKeys.ts` and every call site that
> holds a Supabase API key. Written 2026-11-09 as Workstream S1 of the
> 2026-11-09 compliance plan. Owner steps are mirrored in `OWNER_ACTIONS.md` §42.

## 1. Why, and by when

Supabase is retiring the JWT-based `anon` and `service_role` keys. Its migration
guide (supabase.com/docs/guides/getting-started/migrating-to-new-api-keys, read
2026-11-09) says they "keep working until the end of 2026", and its timetable
lists deletion as "Late 2026, TBC". The replacements are opaque keys:

| legacy | replacement | used by |
| --- | --- | --- |
| `anon` | **publishable** `sb_publishable_…` | the customer app, the admin console, the `/app` web export |
| `service_role` | **secret** `sb_secret_…` | Edge Functions |

**The new keys are not JWTs, and three things this codebase relied on change
with that:**

1. **Our own server-side calls send them on `apikey` only.** The guide: "Send
   publishable and secret keys on the `apikey` header only … the platform
   tries to parse it as a JWT and rejects the request with `Invalid JWT`." The
   API-keys page excepts a bearer that exactly equals `apikey`, but the same
   hosted page also says such a request "will be rejected as the value is not a
   JWT". **The pages disagree, and the one behaviour they all agree on is
   apikey-only, so that is what every call our functions make sends.** Clients
   cannot do the same, because supabase-js adds the bearer itself (point 3).
2. **`verify_jwt` only understands the legacy keys.** For the new ones the
   gateway "does not verify the `apikey` header" — a function must check it
   itself. Every function one of ours calls is already `verify_jwt = false`, so
   no flag changes; the receivers now check the key in code.
3. **supabase-js sends `Authorization: Bearer <key>` whenever there is no user
   session.** Measured in the installed 2.110 (`dist/index.mjs`):
   `fetchWithAuth` falls back to the key when there is no access token, and the
   Auth client always sets it. So a client built with a publishable key puts
   `Bearer sb_publishable_…` on every signed-out request, **including the
   app's login**.

   What makes that work is the gateway. Supabase's self-hosted docs ("New API
   Keys and Asymmetric Authentication") say that on **REST, Auth and Storage**
   a missing `Authorization`, or one starting `Bearer sb_`, is replaced with the
   role's internal JWT. **That replacement is skipped on `/functions/v1/`.**
   For a client the rule is therefore:
   - a signed-out REST, Auth or Storage call is fine;
   - a signed-out Edge Function call is not.

   Checked 2026-11-09: the app (`order-intake`, `account-delete-request`, the
   frozen payment functions) and the console (seven admin functions) call Edge
   Functions **only while signed in**, so the bearer there is the user's JWT.
   **Any future signed-out feature, such as the planned guest menu, must read
   through REST, not through an Edge Function.** Inside our functions,
   `withoutOpaqueBearer()` drops the copied bearer, so server-side calls stay
   apikey-only either way.

## 2. What the code does

`supabase/functions/_shared/apiKeys.ts` (executable tests:
`apiKeys.test.ts`):

- `secretKey()` / `publishableKey()` return the `default` entry of
  `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` once the project has new
  keys, and **fall back to the legacy key otherwise** — malformed or empty JSON
  included. Until the owner creates the keys, every function behaves exactly as
  before, headers byte-for-byte.
- `serviceCallHeaders(key)` — for one of our functions calling another as the
  service: legacy → `apikey` + `Authorization: Bearer` (unchanged); opaque →
  `apikey` only.
- `isServiceCall(req)` — the receiver side. Accepts the legacy
  `Authorization: Bearer <service_role>` **or** an opaque secret on `apikey`
  matching **any** key in `SUPABASE_SECRET_KEYS` (so rotating a secret key never
  strands a sender). Constant-time. A publishable key never matches.
- `withoutOpaqueBearer()` — a fetch wrapper for supabase-js that drops only
  `Authorization: Bearer sb_…`. A forwarded user JWT is untouched.

**Every service-key call site, and what moved:**

| site | role | change |
| --- | --- | --- |
| `_shared/supabaseClient.ts` `adminClient()`, `userClient()` | supabase-js clients for ~20 functions | key from the helper; opaque → `withoutOpaqueBearer` |
| `_shared/rest.ts` `serviceTarget()`, `callerTarget()` | dependency-free PostgREST path (order-intake) | key from the helper; opaque service target sends no `Authorization` |
| `push-dispatch`, `admin-push-dispatch`, `operations-alert-dispatch`, `account-delete-process` | **receivers** | `isServiceCall` replaces four hand-rolled `===` checks |
| `lazywait-sync` → push-dispatch; `account-delete-request` and `account-delete-scheduler` → account-delete-process | **senders** | `serviceCallHeaders(secretKey())` |
| `order-intake` → lazywait-sync | instant POS kick | `apikey` is now `publishableKey()`; the call authenticates on `x-sync-secret` |
| 5 `pg_cron` → `net.http_post` jobs | scheduled invocations | **none** — each sends only its own secret, never a Supabase key (verified by reading every migration that schedules one) |

**Not changed, on purpose:**

- **The five payment functions and `_shared/paymentSync.ts`** are frozen
  (CLAUDE.md §6). They import `adminClient()`, but a deployed function runs the
  bundle it was deployed with, and deploys are manual (`deploy-functions.yml` is
  `workflow_dispatch` only), so nothing here reaches them. **Owner decision
  2026-11-09: they go dark when the legacy keys are deactivated**, which is
  acceptable only because online payment is off — verify
  `app_settings.online_payment_enabled = false` immediately before step 8.
  They are fixed whenever the payment freeze lifts.
- **The JWT signing-key migration** is a separate, independent change. The
  user access tokens Supabase Auth issues are still signed by the project's JWT
  secret; rotating that secret would invalidate every session at once. Out of
  scope here.
- **The web console and the mobile app** are separate PRs, each with its own
  deploy and rollback: #420 (console, legal pages, prerender) and #421 (the app
  and its `/app` web export).

## 3. Owner steps, in order (each is a separate §5 action)

The order exists so that no step can break a running path: receivers learn the
new format before any sender uses it, and the legacy keys stay until nothing
depends on them.

| # | step | why here | verify |
| --- | --- | --- | --- |
| 1 | Merge this PR (CI green) | code is inert until step 2 | — |
| 2 | Dashboard → Settings → API Keys → **create** publishable + secret keys | additive: legacy keys keep working | Edge Functions → Secrets lists `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` |
| 3 | Deploy the **receivers**: `push-dispatch`, `admin-push-dispatch`, `operations-alert-dispatch`, `account-delete-process` | they must accept the new format before anything sends it | each function's logs; a POS-sync push still arrives |
| 4 | Deploy the **senders** and shared-client users: `lazywait-sync`, `account-delete-request`, `account-delete-scheduler`, `order-intake` (all four bundle files, see `ORDER_CONFIRMATION_FLOW.md`), then the rest | senders switch to `apikey`-only on this deploy | place a test order: the POS kick and the confirmation push both happen; the scheduler's next run succeeds |
| 5 | Vercel env (Production **and** Preview), then a gated redeploy — **after #420 and #421, and after the §4 check passes**. **Two** variables, same value: `VITE_SUPABASE_PUBLISHABLE_KEY` (console, legal pages, prerender) and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the `/app` web export, built by the same `npm run build`) | the console must send `apikey` only first; with only the `VITE_` variable set, `/app` would keep shipping the legacy key and break at step 8 | console sign-in and reads work; `/app` loads the menu and reaches the login screen |
| 6 | **December EAS build pair** with the publishable key, distributed to every tester. Needs `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` added to the three `apps/mobile/eas.json` profiles first: a small PR, and the value is public | installed binaries carry the old key until replaced | the app signs in and orders on the new build |
| 7 | Logs: confirm no remaining legacy-key traffic | a remaining caller would break at step 8 | — |
| 8 | Verify `online_payment_enabled = false`, then **deactivate** the legacy keys (reversible) | the payment functions go dark here, by decision | smoke test: order, push, deletion request, alerts |
| 9 | Cleanup PR removes the legacy fallbacks | only once step 8 has held | — |

**Rollback at any step:** reactivate the legacy keys (the dashboard toggle is
reversible). Because every helper prefers the new key but accepts the old one,
re-deploying an older bundle is never needed.

## 4. What is not yet known, stated rather than glossed

- **Whether the hosted gateway replaces `Bearer sb_publishable_…` on REST and
  Auth, as the self-hosted docs describe (§1 point 3).** This decides whether the
  clients work signed out, and the app's login screen is a signed-out Auth call.
  supabase-js is Supabase's own client and sends exactly this, which is strong
  evidence that it is accepted — but it is not a measurement.

  **Settle it read-only straight after step 2, before step 5 or 6.** Send the
  publishable key on **both** `apikey` and `Authorization: Bearer` to:
  - `GET /auth/v1/settings`
  - `GET /rest/v1/legal_documents?select=document_type&is_active=eq.true`

  Each must return 200. **Do not set the Vercel variables or build the December
  binaries until both do.** Our functions never send this bearer, so their
  correctness does not depend on the answer.
- Supabase's exact deletion date ("Late 2026, TBC"). Steps 2-8 should therefore
  finish in December, not wait for an announcement.
