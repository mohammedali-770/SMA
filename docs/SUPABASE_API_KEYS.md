# Supabase API keys — moving off the legacy `anon` / `service_role` keys

> Owner of: `supabase/functions/_shared/apiKeys.ts` and every call site that
> holds a Supabase API key. Written 2026-11-09 as Workstream S1 of the
> 2026-11-09 compliance plan. Owner steps are mirrored in `OWNER_ACTIONS.md` §42.
>
> **Amended 2026-11-18 by the step 9 cleanup (§5 below).** That change removes every
> legacy fallback and may be merged **only after step 8 has been done and has
> held, with no legacy-key traffic in the logs**. Where §2 says "before step 9",
> it describes the code that shipped from 2026-11-09 until that merge.

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
  `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS`, and **nothing else**.
  An entry must be an `sb_secret_…` / `sb_publishable_…` key respectively, so a
  legacy JWT or the wrong kind of key in the map is ignored. With no usable key
  they return `null`, and `adminClient()`, `userClient()`, `serviceTarget()` and
  `callerTarget()` throw `MISSING_SECRET_KEY` / `MISSING_PUBLISHABLE_KEY`, which
  name the new variables. **Before step 9** they fell back to
  `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`.
- `serviceCallHeaders(key)` — for one of our functions calling another as the
  service: `apikey` only. **Before step 9** a legacy key also went on
  `Authorization: Bearer`.
- `isServiceCall(req)` — the receiver side. Accepts only an `sb_secret_…` key on
  `apikey` that matches **any** key in `SUPABASE_SECRET_KEYS`, so rotating a
  secret key never strands a sender. Constant-time. Neither a publishable key
  nor the legacy `Authorization: Bearer <service_role>` matches. **Before step
  9** that legacy Bearer was accepted as well.
- `withoutOpaqueBearer()` — a fetch wrapper for supabase-js that drops only
  `Authorization: Bearer sb_…`. A forwarded user JWT is untouched. Since step 9
  every client is built with it.

The clients read only the publishable key: `src/lib/supabaseKey.ts`
(`VITE_SUPABASE_PUBLISHABLE_KEY`, used by the console, the legal pages and the
prerender) and `apps/mobile/src/lib/env.ts`
(`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). A value that does not start with
`sb_publishable_` counts as unset, so a leftover legacy JWT or a pasted secret
key makes the app report itself unconfigured. A Vercel production build in that
state fails, and Vercel keeps serving the previous deployment.

`legacyKeyGuard.test.ts` fails if any file outside its allow-list contains a
legacy key JWT for this project, or reads one of the four legacy variables. The
allow-list is test files only: there is no production exception.

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

  **Fixed by step 9 (#487).** `triggerLazywaitSyncOnce` now sends
  `publishableKey()` as `apikey`, exactly as `order-intake` does, and skips the
  kick when there is no publishable key. `paymentSyncKick.test.ts` executes it.
  The guard has no exception for the file any more. Four payment bundles include
  it (`payment-initiate`, `-verify`, `-webhook`, `-test-config`), so the fix
  reaches Production only when those are redeployed. **That is a separate live
  owner action, not covered by this cleanup.** Until then:
  - the live bundles keep the old kick, which sends the deactivated anon key as
    `apikey` to `lazywait-sync`. **Treat that kick as refused after step 8.**
    The function itself would not refuse it: v15 never reads `apikey`, is
    `verify_jwt = false`, and authorizes only on `x-sync-secret`
    (`lazywait-sync/index.ts` lines 34-50). But the request reaches the gateway
    first. The hosted gateway checks `apikey` against the project's keys, and
    Supabase does not document whether it lets a deactivated legacy JWT through
    to a `verify_jwt = false` function. That was not measured, because measuring
    it needs the legacy keys deactivated;
  - nothing is lost. The kick is wrapped in `try`, has an 11-second timeout and
    never fails the payment. The once-a-minute `lazywait-sync` cron, which sends
    only `x-sync-secret`, picks the paid order up on its next run. The cost is at
    most about a minute of POS latency for an online order;
  - it matters only while online payment is on. The live payment functions are
    all Moyasar bundles (read-only inventory, 2026-11-18): deployed 2026-11-13,
    `payment-refund` 2026-11-17, each byte-identical to the default branch at
    `5c78d17`. Their Supabase clients already use the new-key helper, so they
    keep working at step 8. The kick is the only part of them that does not.
- **The JWT signing-key migration** is a separate, independent change. The
  user access tokens Supabase Auth issues are still signed by the project's JWT
  secret; rotating that secret would invalidate every session at once. Out of
  scope here.
- **The web console and the mobile app** are separate PRs, each with its own
  deploy and rollback: #420 (console, legal pages, prerender) and #421 (the app
  and its `/app` web export).

## 3. Owner steps, in order (each is a separate §5 action)

**Progress, 2026-11-18.**
- **Step 9 is written and NOT merged** (`security/legacy-key-cleanup-20261118`, §5 below). Merge it only after step 8 has held.
- **Step 2 is done.** A publishable key (`default`) and a secret key exist alongside the legacy ones (owner-confirmed; the publishable key read through the Supabase connector).
- **§4's open question is settled:** sending the publishable key on both `apikey` and `Authorization: Bearer` returned 200 from `GET /auth/v1/settings` and from the `legal_documents` read.
- **Step 6's `eas.json` prerequisite landed in #485:** all three profiles carry `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, pinned by `apps/mobile/src/lib/env.test.ts`, which also refuses any `sb_secret_` value. The legacy anon variable stayed as the fallback until step 9, which removes it from all three.
- **Steps 3, 4 and 5 are done (2026-11-18), each on the owner's word:** "deploy the 9 key-switch functions" for steps 3–4, and "go ahead with 1 and 2" for the two Vercel variables in step 5. Detail below.
- **Step 6 started 2026-11-18** on the owner's word ("do 6, 7, 8 and 9"). GitHub Actions run 44258720558 (EAS Build, `production`, `all`, from `5c78d17`) succeeded at 07:26 UTC and handed both builds to EAS: iOS auto-submits to TestFlight, Android is build-only. Its SENTRY_AUTH_TOKEN preflight passed.
- **Step 7 baseline, read-only from the gateway logs (`request.sb.jwt.apikey.payload.role = 'anon'`), 2026-11-18:** legacy-key traffic still came from the installed TestFlight app `SpicyMeal/28` (last 05:37 UTC), a Windows browser with the console open (last 06:12), an iPhone browser on `/app` (last 05:39), and a `node` client, most plausibly Vercel's build-time prerender (last 06:28). Nothing after the step-5 redeploy (07:13). Step 7 is closed only when, after testers install the step-6 build and open tabs are reloaded, no legacy traffic remains.
- **Steps 8 and 9 wait on step 7.** Deactivating the legacy keys before then would stop every installed copy of build 28. Step 9's cleanup is #487, which must not merge until step 8 has held.

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

**For steps 7 and 8: one direct legacy-key read is left.** The inventory found one non-test site that still reads the legacy key directly. `_shared/paymentSync.ts:25` reads `SUPABASE_ANON_KEY` and sends it as `apikey` on the post-payment kick to `lazywait-sync`. It is bundled into the four payment functions that import `_shared/moyasarVerify.ts`: `payment-initiate`, `payment-verify`, `payment-webhook` and `payment-test-config`. Online payment is off, so the call is idle today. The kick is best-effort and wrapped in `try`/`catch`. If it is refused, the scheduled `lazywait-sync` run still picks the order up. The fix is in step 9 (#487, §2 above): ordinary repository work under CLAUDE.md §6, which lifted the payment freeze for repository work on 2026-11-11. It reaches Production only with a later, separately approved deploy of those four payment functions. Read this before step 8 if online payment is on by then.

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
| 9 | Merge the cleanup PR that removes the legacy fallbacks (§5 below), then redeploy each function in §5's list, one at a time, each its own CLAUDE.md §5 action. Then remove `VITE_SUPABASE_ANON_KEY` from Vercel (Production and Preview) | only once step 8 has held and the logs show no legacy-key traffic | after each redeploy, the same smoke test as step 8; after the Vercel change, the console signs in and `/app` reaches the login screen |

**Rollback at any step up to 8:** reactivate the legacy keys (the dashboard
toggle is reversible). Because every helper before step 9 prefers the new key
but accepts the old one, re-deploying an older bundle is never needed.

**Rollback after step 9 is different.** A function redeployed from the cleanup
no longer reads or accepts a legacy key. Reactivating the legacy keys therefore
does not help it. A function that breaks because `SUPABASE_SECRET_KEYS` /
`SUPABASE_PUBLISHABLE_KEYS` went missing must be fixed by restoring those
secrets, or by redeploying the pre-step-9 bundle. Web builds that fail the same
way are fixed by restoring the Vercel variable.

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

## 5. Step 9 — the cleanup (written 2026-11-18, not merged)

Branch `security/legacy-key-cleanup-20261118` (#487). It removes every
legacy-key fallback in the tree, including the direct `SUPABASE_ANON_KEY` read in
`_shared/paymentSync.ts` (§2).

### Merge preconditions — all four, checked on the day

1. **Step 8 is done and has held.** The legacy keys are deactivated, and
   ordering, push, deletion requests and alerts have kept working since.
2. **No legacy-key traffic in the logs** (step 7 repeated after step 8). Use the
   dashboard's "last used" indicators for the legacy keys, and the Edge Function
   logs for 401s.
3. **The new keys are present where the code now requires them.** Edge
   Functions → Secrets lists `SUPABASE_SECRET_KEYS` and
   `SUPABASE_PUBLISHABLE_KEYS`. Vercel Production **and** Preview carry
   `VITE_SUPABASE_PUBLISHABLE_KEY` (step 5). Without it, a production build now
   fails instead of falling back. `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` should
   be set too, although `/app` now falls back to the publishable key in
   `export-web.js` rather than to the legacy JWT.
4. **The installed apps already carry the publishable key** (step 6's December
   build pair). The cleanup removes the legacy anon key from all three
   `eas.json` profiles. Builds made after it have only the publishable key.

**A merge ships the web build.** Per CLAUDE.md §13, every merge to the default
branch reaches Vercel production. The function bundles do **not** change until
each redeploy below.

### What changes

- **Functions:** `apiKeys.ts` reads only the new keys and fails closed (§2).
  `serviceTarget()` sends `apikey` alone. Receivers accept only an `sb_secret_…`
  key on `apikey`. The supabase-js clients always use `withoutOpaqueBearer`.
- **Clients:** the console, the legal pages, the prerender and the Expo app read
  only the publishable key. `eas.json` and `export-web.js` no longer contain the
  legacy anon JWT, and `export-web.js` now falls back to the same publishable key
  the EAS profiles ship. `.env.example`, `apps/mobile/.env.example` and
  `src/vite-env.d.ts` no longer name the anon variable.
- **Guard:** `legacyKeyGuard.test.ts` (§2). It was mutation-tested: re-adding
  any one of six legacy reads or literals (`env('SUPABASE_SERVICE_ROLE_KEY')`
  and `Deno.env.get('SUPABASE_ANON_KEY')` in `apiKeys.ts`,
  `process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY` in `env.ts`,
  `import.meta.env.VITE_SUPABASE_ANON_KEY` in `supabase.ts`, the anon JWT in
  `eas.json`, and a service_role JWT in a document) fails it. So does putting
  the `SUPABASE_ANON_KEY` read back in `paymentSync.ts`, which also fails
  `paymentSyncKick.test.ts`.

### Redeploys — each one a separate CLAUDE.md §5 action

Computed by diffing every function's local import closure against the default
branch at `5c78d17`. A function is listed when any file in its bundle differs.

**22 of 24 functions change.** Most change only because they bundle
`_shared/apiKeys.ts` and `_shared/supabaseClient.ts`:

- **Receivers.** Their own `index.ts` changes too: `push-dispatch`,
  `admin-push-dispatch`, `operations-alert-dispatch`, `account-delete-process`.
- **Senders and the checkout path:** `lazywait-sync`, `account-delete-request`,
  `account-delete-scheduler` (`handler.ts`), and `order-intake`. `order-intake`
  is four files, of which `index.ts`, `rest.ts` and `apiKeys.ts` change;
  `ORDER_CONFIRMATION_FLOW.md`.
- **Shared client only:** `auth-send-sms-whatsapp`, `email-test-config`,
  `lazywait-catalog`, `lazywait-webhook`, `staff-accounts`, `whatsapp-send-otp`,
  `whatsapp-test-config`, `whatsapp-verify-otp`, `whatsapp-webhook`.
- **Payment: not part of this cleanup's redeploys; each needs its own
  approval.** `payment-initiate`, `payment-test-config`, `payment-verify` and
  `payment-webhook` change through `apiKeys.ts`, `supabaseClient.ts` and the
  `paymentSync.ts` fix. `payment-refund` changes through the first two only.
  - Redeploying a payment function is a live payment action. CLAUDE.md §6 keeps
    that as its own §5 approval, and approval for this cleanup does not cover it.
  - The live bundles are Moyasar bundles that already prefer the new keys
    (read-only inventory, 2026-11-18), so step 8 does not need them redeployed.
  - Until they are redeployed, they keep the old `paymentSync` kick, refused
    after step 8 (§2). That costs at most about a minute of POS latency, and only
    while online payment is on.
- **Unchanged:** `payment-admin-test-return`, `payment-return`.

**Order.** Before step 9, every receiver already accepted the `apikey`-only
form, and every sender redeployed at step 4 already sends it. So these
redeploys can go in any order. Receivers first is still the conservative
choice. Before each redeploy, confirm the function's step 3/4 deploy is live: a
sender still on a pre-2026-11-09 bundle would send the legacy Bearer, which a
step-9 receiver refuses.

### After merge — owner steps

- Remove **`VITE_SUPABASE_ANON_KEY`** from Vercel, Production and Preview. No
  code reads it any more. This is a Vercel change, so it is its own CLAUDE.md §5 action.
  Do the same for `EXPO_PUBLIC_SUPABASE_ANON_KEY` if it was ever set there.
- Leave `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` in the Edge Function
  environment alone. No step-9 code reads either, but the live payment bundles
  read the first until they are redeployed. Whether the platform lets them be
  removed at all is not documented here.
