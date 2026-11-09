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

1. **They travel on `apikey` only.** The guide: "Send publishable and secret
   keys on the `apikey` header only … the platform tries to parse it as a JWT
   and rejects the request with `Invalid JWT`." The API-keys page excepts a
   bearer that exactly equals `apikey`, and the self-hosted gateway docs say
   that case is rebuilt from `apikey` — but the hosted page also says such a
   request "will be rejected as the value is not a JWT". **The pages disagree,
   and the one behaviour they all agree on is apikey-only, so that is what this
   code sends.** It can be settled by measurement once the keys exist (§4).
2. **`verify_jwt` only understands the legacy keys.** For the new ones the
   gateway "does not verify the `apikey` header" — a function must check it
   itself. Every function one of ours calls is already `verify_jwt = false`, so
   no flag changes; the receivers now check the key in code.
3. **supabase-js sends `Authorization: Bearer <key>` whenever there is no user
   session**, so a client built with an opaque key would put it on both headers.

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
- **The web console and the mobile app** (PR-S1b / PR-S1c) are separate PRs,
  each with its own deploy and rollback.

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
| 5 | Vercel env (Production **and** Preview): publishable key, then a gated redeploy — **after PR-S1b** | the console must send `apikey` only first | console sign-in and reads work |
| 6 | **December EAS build pair** with the publishable key (PR-S1c), distributed to every tester | installed binaries carry the old key until replaced | the app signs in and orders on the new build |
| 7 | Logs: confirm no remaining legacy-key traffic | a remaining caller would break at step 8 | — |
| 8 | Verify `online_payment_enabled = false`, then **deactivate** the legacy keys (reversible) | the payment functions go dark here, by decision | smoke test: order, push, deletion request, alerts |
| 9 | Cleanup PR removes the legacy fallbacks | only once step 8 has held | — |

**Rollback at any step:** reactivate the legacy keys (the dashboard toggle is
reversible). Because every helper prefers the new key but accepts the old one,
re-deploying an older bundle is never needed.

## 4. What is not yet known, stated rather than glossed

- Whether the hosted gateway accepts `Authorization: Bearer sb_…` when it equals
  `apikey` (§1 point 1). The code never sends it, so the answer does not change
  correctness; it only decides whether `withoutOpaqueBearer` is necessary or
  belt-and-braces. Settle it after step 2 by reading one function's logs.
- Supabase's exact deletion date ("Late 2026, TBC"). Steps 2-8 should therefore
  finish in December, not wait for an announcement.
