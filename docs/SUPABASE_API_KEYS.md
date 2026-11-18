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
   payment functions) and the console (seven admin functions) call Edge
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

- **The payment functions and `_shared/paymentSync.ts`** were frozen
  (CLAUDE.md §6) when this was written. They import `adminClient()`, but a
  deployed function runs the bundle it was deployed with, and deploys are manual
  (`deploy-functions.yml` is `workflow_dispatch` only), so nothing here reaches
  them. **Owner decision 2026-11-09: they go dark when the legacy keys are
  deactivated**, which is acceptable only because online payment is off — verify
  `app_settings.online_payment_enabled = false` immediately before step 8.

  **Changed 2026-11-12.** The freeze was lifted for repository work on
  2026-11-11, when the owner chose Moyasar. The live bundles are still the July
  Tap-era ones, so the paragraph above still describes Production. Five of the
  seven Moyasar-only functions (`payment-initiate`, `-verify`, `-webhook`,
  `-refund`, `-test-config`) build their clients with `adminClient()` /
  `userClient()`, so the seven-function deploy (`OWNER_ACTIONS.md` §47.4) moves
  them to the helper. **`_shared/paymentSync.ts:25` still reads
  `SUPABASE_ANON_KEY` directly**, and that was not changed by the Moyasar work.
  If online payment is on before step 8, check that file first.

  **Corrected 2026-11-18.** "The live bundles are still the July Tap-era ones"
  is no longer true. The read-only inventory in §3 found that all 7 live payment
  functions are Moyasar bundles. They were deployed 2026-11-13, except
  `payment-refund`, deployed 2026-11-17. All 7 carry the new-key helper, and
  each is byte-identical to the default branch. The 2026-11-09 reason for the
  payment functions going dark at step 8 was bundles that predate the helper.
  That reason no longer holds, except for the one direct read in
  `_shared/paymentSync.ts:25` (§3, "For steps 7 and 8"). This correction is
  about which code is deployed. It makes no payment decision.
- **The JWT signing-key migration** is a separate, independent change. The
  user access tokens Supabase Auth issues are still signed by the project's JWT
  secret; rotating that secret would invalidate every session at once. Out of
  scope here.
- **The web console and the mobile app** are separate PRs, each with its own
  deploy and rollback: #420 (console, legal pages, prerender) and #421 (the app
  and its `/app` web export).

## 3. Owner steps, in order (each is a separate §5 action)

**Progress, 2026-11-18.**
- **Step 2 is done.** A publishable key (`default`) and a secret key exist alongside the legacy ones (owner-confirmed; the publishable key read through the Supabase connector).
- **§4's open question is settled:** sending the publishable key on both `apikey` and `Authorization: Bearer` returned 200 from `GET /auth/v1/settings` and from the `legal_documents` read.
- **Step 6's `eas.json` prerequisite is this change:** all three profiles carry `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, pinned by `apps/mobile/src/lib/env.test.ts`, which also refuses any `sb_secret_` value. The legacy anon variable stays as the fallback until step 9.
- **Steps 3, 4 and 5 are done (2026-11-18), each on the owner's word:** "deploy the 9 key-switch functions" for steps 3–4, and "go ahead with 1 and 2" for the two Vercel variables in step 5. Detail below.
- **Step 6 started 2026-11-18** on the owner's word ("do 6, 7, 8 and 9"). GitHub Actions run 44258720558 (EAS Build, `production`, `all`, from `5c78d17`) succeeded at 07:26 UTC and handed both builds to EAS: iOS auto-submits to TestFlight, Android is build-only. Its SENTRY_AUTH_TOKEN preflight passed.
- **Step 7 baseline, read-only from the gateway logs (`request.sb.jwt.apikey.payload.role = 'anon'`), 2026-11-18:** legacy-key traffic still came from the installed TestFlight app `SpicyMeal/28` (last 05:37 UTC), a Windows browser with the console open (last 06:12), an iPhone browser on `/app` (last 05:39), and a `node` client, most plausibly Vercel's build-time prerender (last 06:28). Nothing after the step-5 redeploy (07:13). Step 7 is closed only when, after testers install the step-6 build and open tabs are reloaded, no legacy traffic remains.
- **Step 7 closed 2026-11-18**, read-only from the gateway logs after the owner installed iOS build 29. From 07:47 UTC no request carried a legacy key: build 29 (`SpicyMeal/29`), the console and `/app` in browsers, and the build-time prerender (`node`) all sent the publishable key, and every Edge Function call sent the secret key. The last legacy request was at 07:46:48, a burst of 15 from a Windows browser on the console. The console ships no caching service worker (`public/sw.js` has no `fetch` handler), so that was a window loaded before the step-5 redeploy, still running the old bundle.
- **Step 8 done 2026-11-18** by the owner in the Supabase dashboard (Project Settings → API Keys → Legacy API Keys). `app_settings.online_payment_enabled` was read live as `false` first. **It has held**, measured from the logs and the database, read-only:
  - 08:15–08:34 UTC: every gateway request returned 200 (or 101 for realtime); no 401, and no legacy key. `account-delete-scheduler` → `account-delete-process` ran every minute with the secret key, 20/20; `lazywait-sync`'s cron 19/19; the console's `payment-test-config` read 200;
  - the owner then reported the app, menu and console working and placed a test order: SM-2026-000093, cash pickup, created 08:36:30, reached the POS at 08:36:38 on its first attempt (`sync_attempt_count = 0`, no error), and its `pos_confirmed` push was logged at 08:36:38. `order-intake` and `push-dispatch` both returned 200;
  - not exercised by the check: an operations-alert email, an admin web push and an online payment (off).
- **Step 9 is #487**, mergeable now that step 8 has held, on the owner's word. After it: the 17 non-payment redeploys and removing `VITE_SUPABASE_ANON_KEY` from Vercel, each its own approval (listed in #487).

**Steps 3–4: which functions needed a deploy.** A read-only inventory of all 25 live Edge Functions was taken first:

- **16 already ran the new-key code.** That is every function deployed 2026-11-13 or later, which includes three of step 3's four receivers (`push-dispatch`, `admin-push-dispatch`, `operations-alert-dispatch`), `account-delete-request`, and all 7 payment functions. The payment bundles are byte-identical to the default branch.
- **9 did not.** Those 9 were deployed from the default branch at `5c78d17`. No file under `supabase/functions/` changed between `0dd6a20` and `5c78d17`. The order was the receiver first, then the senders, then the rest. Each deploy was one call.

| Function | Version | `verify_jwt` | `ezbr_sha256` |
| --- | --- | --- | --- |
| `account-delete-process` (receiver) | 5 → 6 | `false` | `1b94e218…` |
| `lazywait-sync` | 14 → 15 | `false` | `ea544471…` |
| `account-delete-scheduler` | 4 → 5 | `false` | `9340a9b5…` |
| `order-intake` | 15 → 16 | `true` | `27d62d50…` |
| `lazywait-catalog` | 6 → 7 | `true` | `ea9cd517…` |
| `lazywait-webhook` | 5 → 6 | `false` | `a8b9e493…` |
| `whatsapp-send-otp` | 5 → 6 | `true` | `0f16763a…` |
| `whatsapp-verify-otp` | 5 → 6 | `true` | `c0892b69…` |
| `whatsapp-webhook` | 6 → 7 | `false` | `3a5af1dc…` |

After the deploys, each function was read back by script, and every file was compared with `cmp` against the bundle. All were byte-identical. Each `verify_jwt` matches `supabase/config.toml`. At deploy time, 0 orders were in a sync state and 0 deletion requests were open.

**What the 9 deploys changed:**

- **`account-delete-process` now accepts the new secret key.** Before this deploy there was a refusal. Once the keys existed (step 2), `account-delete-request` v5, which was already on the new code, sent its post-request notification with the new key, and live `account-delete-process` v5 refused it with 403. No customer was affected, because the scheduled run still used the legacy key. This is the one place where the receivers-first order was not met, because step 2 came before step 3.
- **`lazywait-sync` and `lazywait-catalog` now carry #371's POS base-URL allowlist:** https only, and the host must be `lazywait.com` or a subdomain of it (`LAZYWAIT.md`, "The POS base URL is allowlisted"). Before this deploy, neither live bundle carried it. The stored base URL was read live before the deploy: `https` on `apiv2-dev.lazywait.com`, which the allowlist admits, so nothing changed for today's configuration.
- **`lazywait-sync`'s two no-row gate refusals now log the order id**, as JSON lines (#439; `LAZYWAIT.md`, "Gate refusals that write no row").
- **`whatsapp-send-otp` gains #437's 3-second timeout on the Meta send.**
- **The other functions change key handling only.**

The table's live checks for steps 3–4 (a test order's POS kick and push, and the scheduler's next run) are not recorded here. What was verified is the read-back above.

**Step 5: Vercel project `sma`.**

- Two variables were added as sensitive, for Production and Preview, with the same publishable value: `VITE_SUPABASE_PUBLISHABLE_KEY` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Production was then redeployed from `5c78d17` (deployment `dpl_BrEAYDgcEWWRwUfmggAabHnTMTKq`).

Verified afterwards:

- The live `/app` entry bundle contains the publishable key, and does not contain the legacy `anon` JWT.
- The live console bundle contains the publishable key, which `supabaseKey.ts` prefers. It also contains the legacy key, inlined as the fallback. That is expected until step 9 removes `VITE_SUPABASE_ANON_KEY`.
- A headless guest visit to `/app` had 0 page errors, and all 13 catalogue REST reads returned 200.
- The console sign-in page and `/privacy` loaded with 0 errors, and `/privacy`'s REST read returned 200. A staff sign-in was not part of this check.

**For steps 7 and 8: one direct legacy-key read is left.** The inventory found one non-test site that still reads the legacy key directly. `_shared/paymentSync.ts:25` reads `SUPABASE_ANON_KEY` and sends it as `apikey` on the post-payment kick to `lazywait-sync`. It is bundled into the four payment functions that import `_shared/moyasarVerify.ts`: `payment-initiate`, `payment-verify`, `payment-webhook` and `payment-test-config`. Online payment is off, so the call is idle today. The kick is best-effort and wrapped in `try`/`catch`. If it is refused, the scheduled `lazywait-sync` run still picks the order up. This record is documentation only and does not change the code. The fix is ordinary repository work under CLAUDE.md §6, which lifted the payment freeze for repository work on 2026-11-11; it is made in the step 9 cleanup pull request (#487), and reaches Production only with a later, separately approved deploy of those four payment functions. Read it before step 8 if online payment is on by then.

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
