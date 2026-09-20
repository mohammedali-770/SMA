# Admin push notifications — closures on the phone

**Status: THE SERVER SIDE IS COMPLETE AND IDLE. One step remains and it is
physical — re-adding the Home Screen icon.** Both migrations are applied
(`20260927120000` → `20260920050434`, `20260928120000` → `20260920061858`), the
VAPID public key is in `app_settings`, `admin-push-dispatch` is deployed as
version 1, and the pg_cron driver ticks every minute and succeeds. A branch
closing an item, a size or delivery now genuinely queues a notification.

**Nothing sends, and that is now a statement about SUBSCRIBERS rather than about
configuration.** `admin_push_subscriptions` holds **0 rows**. Only an
administrator enabling the bell on their own installed console can add one, and
iOS fixes a web app's push capability at install time — which is why
`docs/OWNER_ACTIONS.md` §41.6 (delete the Home Screen icon and re-add it) is
last, and is the only step left.

**Still unproven until that tap:** whether the two halves of the VAPID key pair
match. `assertVapidKeyPair` runs only inside the deployed function, after the
caller gate, so no probe from outside can reach it — every unauthenticated
attempt stops at 401. The bell is the test, and one notification within a few
seconds is the pass.

## What this is for

When a branch takes something off the menu, the admin should learn about it on
their phone rather than by opening the console and noticing. The owner asked for
this on 2026-09-18 and chose the behaviour; §2 records exactly what was chosen,
so a later change knows what was a decision and what was a default.

## The one constraint that shapes everything

**This is WEB push to the staff console, not Expo push to the customer app, and
the two never meet.**

That is deliberate rather than incidental. `push_devices` — the table behind
customer order notifications — is keyed by `customer_id`, a foreign key to
`profiles`, and every row in it belongs to a customer. Measured 2026-09-18: 5
active devices, all customers; the admin, both branch staff and the call centre
hold **zero**. Reusing that channel for staff would mean widening a live
customer audience model (CLAUDE.md §7) and would put one bad predicate between a
branch closure and 5 real customers' lock screens.

A separate channel cannot make that mistake, because it has no access to
`push_devices` at all.

### Apple's rules, which are not negotiable

Verified against Apple's published requirements before this was designed:

- Web push needs **iOS/iPadOS 16.4 or later**.
- It works **only for a web app added to the Home Screen**. Safari on iOS can
  never receive one, whatever permission is granted.
- The site must serve a **manifest with `display: standalone`** (or
  `fullscreen`). Without it `PushManager` never appears in the service worker,
  however correct everything else is. This is the single most common way a web
  push integration fails silently on iPhone.
- iOS fixes an installed web app's capabilities **at install time**. A Home
  Screen entry added before the manifest shipped does not gain push when the
  manifest arrives — it has to be removed and re-added.

That last point applies to the owner personally: the console was already on the
Home Screen (named تقفيل المنتجات) before any of this existed, so that entry must
be deleted and re-added once step 1 is deployed. `pushReadiness()` detects this
exact state and returns `needs-reinstall` rather than the useless
"unsupported".

## 2. The behaviour the owner chose

Recorded so a future change can tell a decision from a default.

| Question | Decision |
| --- | --- |
| Which closures notify | Whole item, price tier (size), and delivery pause |
| Which do **not** | Option/add-on closures — highest volume, lowest cost |
| Reopens | **Silent.** Closing only, including the sweeper's automatic reopen |
| The admin's own actions | **Notify.** They asked for the receipt that it landed |
| Grouping | **None.** One notification per event, no batching or digest |
| Language | **Arabic**, always |
| Recipients | Any admin who opts in, all branches. Never branch staff, never the call centre, never customers |
| Branch count | 17 real branches (the 40 rows in Production are test data) |

Batching was offered and declined. If the volume becomes unpleasant, the place
to add it is the sender, not the trigger — the trigger should keep recording
every event.

## 3. What exists after step 1

| File | Role |
| --- | --- |
| `public/manifest.webmanifest` | `display: standalone`, Arabic name, three icons. The thing iOS requires. |
| `public/sw.js` | Service worker: `push` and `notificationclick` only. |
| `src/lib/pwa/pushSupport.ts` | Pure readiness check: `ready` / `needs-install` / `needs-reinstall` / `unsupported`. |
| `src/lib/pwa/registerServiceWorker.ts` | Fire-and-forget registration, memoised, never throws. |
| `index.html` | Manifest link, `theme-color`, Apple web-app meta tags. |
| `public/icon-{192,512}.png`, `icon-maskable-512.png` | Generated from `public/logo.png`. The maskable one sits inside the 80% safe zone on the brand cream so Android's circular crop never clips the art. |

### The service worker caches nothing, on purpose

`public/sw.js` has **no `fetch` handler**, and that is the most important line in
it. A worker that intercepts `fetch` can serve a broken shell to every staff
device and keep serving it after the fix ships, because the broken worker is the
thing deciding what to serve. This console has already had one outage where
nobody could sign in. Push needs no caching, so the worker takes none: with no
`fetch` handler the browser reaches the network exactly as it does today, and
the worst a broken worker can do is fail to show a notification.

### Every push must show something

Apple revokes a subscription that receives a push and displays nothing, so every
branch of the `push` handler ends in `showNotification` — including the
malformed-payload path, which falls back to the brand name. A silent push is not
a smaller bug than a wrong one; it is how a subscription quietly dies.

**That promise was broken in the first version, and only a review caught it.**
`event.data.json()` parses a literal JSON `null` perfectly well, so the
`try/catch` never saw it — and reading `payload.title` then threw **outside** the
try block, before `waitUntil` and before `showNotification`. A number, a string,
an array and a boolean all fail identically. The handler now accepts only a
non-null, non-array object. The lesson is narrow and worth keeping: **a
`try/catch` around a parse does not protect the code that reads the parsed
value.**

### Two URL rules, both learned the hard way

`consolePath()` parses the payload's target against the worker's own origin and
compares `url.origin`. It does **not** check prefixes, because prefix checks kept
being wrong in new ways:

- `//evil.example` starts with a slash. Caught by a test before the first
  review.
- `/\evil.example/x` starts with a *single* slash, and the URL parser treats a
  backslash as a path separator — so it resolves to `https://evil.example/x`.
  Caught by review.
- `https://console.example.evil.com` merely **starts with** our origin, so any
  `startsWith` on `href` admits it. Caught by mutation testing, not by review.

Each is an open redirect driven by a push payload. Parsing and comparing the
origin asks the same question the browser will ask when the notification is
tapped, which is the only version of this check that stays right.

`consolePath()` also refuses an `/app` target, and `notificationclick` reuses
only console windows. This origin serves the **customer** web export at `/app`,
and `matchAll` returns any same-origin window — so without the filter, tapping a
staff alert could navigate a customer's open tab away and discard its state.

## 3b. What step 2 added

| File | Role |
| --- | --- |
| `supabase/migrations/20260927120000_admin_push_subscriptions.sql` | `admin_push_subscriptions` (closed table), `app_settings.admin_push_vapid_public_key`, and three `is_admin()`-gated RPCs. **APPLIED 2026-09-20**, live version `20260920050434`, ledger row 101 — the table is empty and the VAPID column is NULL, so nobody is subscribed and nothing can be sent. Detail: `docs/MIGRATIONS.md` §49. |
| `supabase/tests/admin_push_subscriptions_test.sql` | 8 cases / 23 assertions pinning the closed table, the refusals and the endpoint-reassignment rule. |
| `src/lib/adminPushApi.ts` | The console's side. Reads fail soft; writes throw, because the admin pressed a button and is owed a truthful answer. |
| `src/lib/pwa/adminPushState.ts` | The seven-state resolver. |
| `src/lib/pwa/pushSubscription.ts` | base64url → key bytes, and subscription serialisation that returns null rather than a half-record. |
| `src/components/admin/useAdminPush.ts` | The hook. Every browser call wrapped; never throws, never blocks a render. |
| `src/components/admin/view/PushBell.tsx` | The header control. |

**Seven states, and only two of them are a button.** `unsupported`,
`needs-install`, `needs-reinstall`, `denied` and `not-configured` render as a
static chip carrying the remedy, because none of them can be fixed by tapping.
Offering a tappable bell to someone on an iPhone in Safari — where no amount of
tapping can ever work — is how a feature earns a reputation for being broken.

**The permission prompt comes from the tap, not from mount.** Browsers refuse
`Notification.requestPermission()` outside a user gesture, which is why the hook
exposes a toggle rather than doing this on load.

**A subscription missing either key is discarded, not stored.** It can never be
pushed to, so storing it would show the admin a "subscribed" device that
silently never notifies.

## 3c. What step 3 added — the sender

| File | Role |
| --- | --- |
| `supabase/functions/_shared/webPush.ts` | VAPID signing (RFC 8292) and `aes128gcm` payload encryption (RFC 8291). Pure Web Crypto; no Deno APIs, so CI executes it. |
| `supabase/functions/_shared/webPush.test.ts` | 54 cases, including the RFC's own encryption vector. |
| `supabase/functions/_shared/adminPush.ts` | The decisions: who a send may reach, what the worker receives, what a status code means. |
| `supabase/functions/_shared/adminPush.test.ts` | 47 cases over those decisions. |
| `supabase/functions/_shared/adminPushWiring.test.ts` | Source-shape tripwires for the handler, plus the executed payload contract against `public/sw.js`. |
| `supabase/functions/admin-push-dispatch/index.ts` | The handler. **Written, not deployed.** |
| `scripts/generate-vapid-keys.mjs` | Produces the key pair and prints where each half goes. |
| `src/lib/adminPushApi.ts` | Gained `sendAdminPushConfirmation()`. |

### It is written by hand, and the RFC's test vector is why that is defensible

Every mature web-push library is a Node package that wants `node:crypto`,
`node:http` and a bundler; the Deno ports are thin and unmaintained. Everything
the protocol needs — ECDH on P-256, HKDF-SHA256, AES-128-GCM and ECDSA P-256 —
is already in the Web Crypto API that Deno and Node both ship, so this is about
150 lines of standard-library calls instead of a supply-chain edge for staff
notifications.

That trade only holds if the implementation is checked against something other
than itself. **`webPush.test.ts` encrypts RFC 8291 §5's plaintext with RFC 8291
§5's keys and salt and asserts the body matches RFC 8291 §5's published
ciphertext byte for byte.** A round-trip test — encrypt, decrypt, compare —
passes just as happily with the two HKDF info strings swapped, the record size
written little-endian, or the last-record delimiter set to `0x01`. None of those
would ever display a notification on a real phone, and all of them are
self-consistent. **Thirteen of fourteen deliberate mutations were killed by that
suite**, including swapped info strings, a little-endian record size, a
non-final delimiter, a transposed key-info operand order, a truncated ECDH
secret and a VAPID token signed over the wrong bytes. The fourteenth survives
and is recorded in the test file rather than hidden: it removes a fallback whose
only purpose is a runtime Node cannot emulate.

A second suite of twelve mutations against the handler — hard-coding the scope
to `all`, reading the scope from the request body, judging an admin on their
role alone, deleting a subscription on 403, logging a whole endpoint, reaching
for `push_devices` — is killed in full by `adminPushWiring.test.ts`. **Two of
those twelve initially survived, and both survivals were instructive.** One was
a regex that a longer mutant walked past; the other was an assertion satisfied
by the `import` line that *names* a helper rather than by the call that uses it.
That second one is the repository's "a check a comment can satisfy is not a
check" wearing a new costume, and the fix — stripping the import block as well
as the comments — protects every future assertion in that file.

### The only typecheck that speaks for an Edge Function is `deno check`

Worth recording because it cost a red CI run. `supabase/functions` is excluded
from the repository's `tsconfig.json`, so `npm run lint` never sees these files;
a separate strict `tsc` run over `webPush.ts` with `lib: ["es2022", "dom"]`
passed cleanly. CI's `deno check` then produced **eight errors**, all the same
one: since TypeScript 5.7 a bare `Uint8Array` means
`Uint8Array<ArrayBufferLike>`, `ArrayBufferLike` includes `SharedArrayBuffer`,
and Deno's `BufferSource` — unlike the DOM's — refuses it. So every value handed
to `crypto.subtle` and to `fetch` was rejected.

The fix is a `Bytes = Uint8Array<ArrayBuffer>` alias threaded through the module.
The lesson is that the DOM lib is the looser of the two definitions, so passing
under it proves nothing about the runtime these functions actually run on. Deno
2.9.4 — the version CI pins — reproduces the gate exactly and is worth running
before pushing anything under `supabase/functions/`.

### An admin can only ever push to their own devices

`scopeFor` gives `all` to the service role and `self` to an authenticated admin,
and that is not a setting. The console's confirmation send runs as the signed-in
admin, so without the rule any administrator at AAL2 could put arbitrary text on
every other administrator's lock screen — the same class of capability as
`push-dispatch`'s broadcast, which is fenced for exactly this reason. Only the
database, through the service role, fans out.

### Turning the control on sends one notification, deliberately

Storing a subscription tells the admin nothing about whether a notification can
reach their phone: the sender has to be deployed, a key pair configured, and the
public half has to match the one they just subscribed with. Each of those is a
separate owner action and each fails silently. So enabling the control asks the
sender for one confirmation notification to that device. **A failure there does
not undo the toggle or raise an error** — the subscription is stored either way
and the control's state is already truthful. The notification arriving is the
end-to-end evidence; its absence is the diagnostic.

**It names the device that was just enabled, and review caught that it didn't.**
The first version sent to every device that admin owned. An admin who already
had a subscribed phone would get the confirmation *there* — which looks exactly
like proof that the browser they are sitting in front of works, and is not. The
endpoint is now passed and the sender narrows to that row, **ANDed with the
scope filter** so naming somebody else's endpoint reaches nothing rather than
reaching them.

### The payload size is measured on the largest variant, not the first

`parseNotificationRequest` refuses copy that could not be encrypted into one
record. The first version measured the Arabic payload with `at: 0`, which
understates the real thing twice: a bilingual request may carry a longer English
body that only an English-registered device sees, and `at` is a 13-digit epoch at
delivery rather than one character. A request could therefore pass the check and
throw inside `encryptPayload` for some devices and not others — counted as a
failure, and looking like a flaky push service. Both languages are now measured
at a full-width timestamp. Review caught this one too.

### The stored endpoint is untrusted input, and review caught that it wasn't

`save_admin_push_subscription` checks only that the endpoint is non-empty, so
what the sender POSTs to is whatever was stored — and storing one needs an admin
at AAL2. The first version fetched it unvalidated, which turns one row edit into
a connector to any address the Edge runtime can reach, the cloud metadata
endpoint included. This is not an anonymous SSRF; it is containment for a
compromised admin session or a leaked service key, which bypasses RLS entirely —
the same reasoning, and now literally the same host rules, as `smtpTarget.ts`.

Two halves, and neither implies the other:

- **`refusePushEndpoint`** requires HTTPS, no credentials in the URL, and a
  public dotted hostname — refusing IP literals in all four spellings, IPv6,
  and the `.local` / `.internal` / `.localhost` / `.home.arpa` suffixes. An
  optional `ADMIN_PUSH_ALLOWED_HOSTS` narrows it further.
- **`redirect: 'manual'`** stops a *checked* host handing the request on. The
  guard is otherwise undone by one `Location` header.

The host rules moved to `supabase/functions/_shared/publicHost.ts` rather than
being copied: duplicating forty lines of security-critical host parsing is how
two copies of a rule drift apart. The 34-case SMTP suite passes unchanged, which
is what makes the extraction verified rather than assumed.

### A subscription is deleted on 404 and 410, and on nothing else

A 401 means our VAPID token is wrong; a 403 that our key does not match the
subscription; a 413 that the payload is too big; a 429 that we are sending too
fast. Every one of those is our problem, and treating any of them as "the
subscription is gone" would wipe every admin's registration the first time a key
was mistyped — silently, and recoverable only by each admin noticing and
re-enabling. Repeated non-gone failures still prune, but only after 20 of them.

### The two halves of the key pair are checked before anything is sent

The public half lives in `app_settings.admin_push_vapid_public_key` because the
browser needs it to subscribe; the private half is an Edge Function secret. They
are typed into two different places, so the sender refuses to send unless they
are a real key pair **and** the public half matches the one clients subscribed
with. Without that check a transposed character produces an opaque 401 from
every endpoint, which reads like a dead feature rather than a typo.

## 3d. What step 4 added — the trigger and the queue

| File | Role |
| --- | --- |
| `supabase/migrations/20260928120000_admin_push_closure_notifications.sql` | The queue, the copy, the two enqueue triggers, claim/finalize, the signature verifier, the pg_cron driver. **APPLIED 2026-09-20**, live version `20260920061858`, ledger row 102 — the outbox is empty, both Vault secrets exist, and the cron job ticks every minute and succeeds. Detail: `docs/MIGRATIONS.md` §50. |
| `supabase/tests/admin_push_closure_notifications_test.sql` | 13 cases, including the one that breaks the composer on purpose. |
| `supabase/functions/admin-push-dispatch/index.ts` | Gained the queue-drain mode and the scheduler gate. |

### No closure RPC is modified, and that is the design

`branch_availability_events` and `branch_delivery_events` have recorded every
closure since 2026-08-20 — branch, subject, action, duration, reason, actor and
source — and the availability table is append-only and never pruned. So a
trigger hangs off each of those two tables and **nothing on the path a cashier
uses to take an item off the menu is touched**. `set_product_snooze`,
`set_variant_snooze`, `set_branch_delivery_pause` and the two clear functions
are exactly what they were, and the migration's own verification fails the apply
if any of them has gone missing or learned about this feature.

### A notification must never be able to block a closure

The enqueue triggers run **inside** the transaction that closes the item, so an
exception in one would abort the closure itself — a cashier told "could not
close Large" because a product name was null. Both bodies swallow every
exception, warn, and return.

That guard is tested by breaking it on purpose: the suite replaces the copy
composer with one that raises, drives the real `set_product_snooze`, and asserts
the closure still lands and is still audited. It then restores the composer and
asserts the same closure **does** queue a notice — so the case cannot pass by
the composer never being called at all.

### The queue is pulled, not pushed

The driver pokes the sender once a tick and the sender claims rows, exactly as
`operations-alert-dispatch` does. Composing a payload in Postgres and POSTing it
per notification was rejected because `net.http_post` is fire-and-forget: the
database would have to write `sent` at the moment it posted, which is a claim it
cannot support. Pulling means the process that actually talks to the push
service is the one that records the outcome.

### The deployed bundle is NOT byte-identical to this repository

**`admin-push-dispatch` version 1 was deployed 2026-09-20 from commit
`38c50f7`, and its comments were stripped in transport.** Every executable
statement is present and identical; the doc comments in `index.ts`,
`adminAuth.ts`, `adminPush.ts`, `webPush.ts`, `publicHost.ts` and
`supabaseClient.ts` are not. `cors.ts` went whole.

**Why it happened.** The MCP deploy tool takes file contents inline, so the
bundle is hand-transcribed. The seven files total ≈ 61 KB and the comments were
dropped to fit them into one call. That was a poor trade and is recorded rather
than quietly left.

**Why it was not corrected by redeploying.** A second hand-transcription of
61 KB to restore comments would risk a mistyped operator reaching production, on
a function whose behaviour is currently verified. That trades a documentation
problem for a correctness one. The comments do not execute; a typo does.

**Nothing automated will ever notice this**, which is the reason it is written
down. `deploy-functions.yml` cannot run — it needs `SUPABASE_ACCESS_TOKEN`,
which has never existed and which `docs/OWNER_ACTIONS.md` §15 recommends against
creating, because a Supabase token cannot be scoped to one project and this
repository is public. `function-drift.yml` compares NAMES only and says so in
its own header: *"the Supabase CLI exposes no content hash"*. So a future
session fetching the bundle with `get_edge_function` would find a mismatch and,
without this note, could not tell transport from tampering.

**What was verified instead of byte-equality:** `deno check` clean on the
repository source before deploying; the deployed function probed live — `GET`
→ 405, unauthenticated `POST` → 401, and a scheduler-header `POST` → **401 rather
than 500**, which is the documented fail-closed branch for the signature RPC not
yet existing. The #402 fix is present: one guarded `parseNotificationRequest`.

**The durable fix is a deploy path that sends exact bytes**, not a more careful
retype. That is an owner decision about tooling, and §15's safer alternative is
the place to start.

### A queue drain must not be judged by direct-mode rules

**Fixed 2026-09-20, found while deploying rather than in review.** The handler
parsed the request body twice. The first parse was correctly guarded by
`if (mode === 'direct')`; the second sat at top level and returned **400** when
it failed. A queue body carries no `title`/`body` — its copy comes from the rows
it claims, through `requestFromQueueRow` — so **every scheduler call was refused
`400 title is required` before it could claim anything**, and the value the
second parse produced was never read.

Had it shipped, applying `20260928120000` would have scheduled a pg_cron job
ticking every minute, refused every time, while closure notices accumulated in
`admin_push_outbox` and expired after two hours. The symptom reads as "push does
not work" rather than as one stray line, which is what makes it worth recording.

**Nothing in CI could have caught it, and that is the generalisable part.**
`deno check` is a typecheck and an unused `const` is legal; the handler ends in
`Deno.serve` and imports Deno-only modules, so Vitest cannot load it and no test
executed the branch. `adminPushWiring.test.ts` now asserts the shape instead:
`parseNotificationRequest` is called **exactly once**, inside the direct-mode
guard. It was written first and watched fail against the unfixed handler, which
is the only thing that makes it evidence rather than decoration.

### A transient failure does not lose the notification

`finalize_admin_push_notification` returns a failed row to the queue until its
attempt budget is spent, and only then writes a terminal `failed`. The first
version wrote `failed` immediately — and the claim RPC never re-claims `failed`
— so the three attempts it advertised were unreachable and one bad minute at a
push service lost a closure notice for good. Review caught it on #399. The
budget is written in three places, so the migration reads two of them out of the
catalog and greps the third, and refuses to apply if they have drifted apart.

### An unconfigured deployment cleans up after itself

With no sender deployed, notices would otherwise queue for ever. The driver
expires anything older than two hours — the sender's TTL is one hour, so an
older notice would not be delivered anyway — and prunes terminal rows after
fourteen days.

**An incomplete Vault is recorded rather than raised**, which is the opposite of
what the alert dispatcher does and the difference is not squeamishness: this
driver does the housekeeping first, and pg_cron runs each job in one
transaction, so an exception would roll the expiry back with it. The fault is
written onto the rows it is holding up instead. A mutation that raises there
passes every other assertion in the suite and fails the expiry case.

### The kill switch defaults TRUE

`app_settings.admin_push_enabled` exists to turn notifications **off**, not to
turn them on. The feature is already gated four ways over — two migrations
applied, a key configured, the sender deployed, an admin subscribed — so a fifth
gate that had to be switched on would be friction rather than safety. It is
checked in the triggers and in the driver, so switching it off stops rows that
are already queued as well as new ones.

## 4. What is still to build

Nothing. All four steps are written; what remains is configuration, in §5.

## 5. Owner actions

Each is separate under CLAUDE.md §5; approval for one is not approval for the
next.

Full steps, in order, with the commands: `docs/OWNER_ACTIONS.md` §41.

1. ~~Apply `20260927120000_admin_push_subscriptions` (step 2).~~ **DONE
   2026-09-20**, live version `20260920050434`, ledger row 101.
2. Generate a VAPID key pair — `node scripts/generate-vapid-keys.mjs`.
3. Store both halves as Edge Function secrets, and the **public** half in
   `app_settings.admin_push_vapid_public_key` (a live write, so its own §5
   action).
4. Deploy `admin-push-dispatch`.
5. ~~Apply `20260928120000_admin_push_closure_notifications` (step 4).~~ **DONE
   2026-09-20**, live version `20260920061858`, ledger row 102.
6. **Delete the Home Screen icon and re-add it**, last. See §1 — iOS fixes an
   installed web app's capabilities at install time, so re-adding it before the
   rest is done means doing it twice.

**CORRECTION, 2026-09-19.** An earlier revision of this list said to generate the
key "so the private half never crosses the wire, the way the alert-dispatch
trigger secret was handled (`docs/OWNER_ACTIONS.md` §28)". **That is not
achievable here, and repeating it would have sent somebody looking for a method
that does not exist.** §28's trick works because Postgres both generates the
secret and performs the HMAC, so the value never has to leave the database.
Signing a VAPID token is ECDSA on P-256, which `pgcrypto` cannot do — the Edge
Function must hold the private key to sign, so the key has to be created
somewhere and pasted into the secret store. What is achievable, and what §41
does, is keeping it to exactly one place: not the repository, not
`app_settings`, not a pull request.

## 6. The limitation, stated rather than buried

Apple's web push is best-effort. A subscription can be dropped if the web app is
left unopened for a long period, and there is no delivery receipt. The console
control will show the subscription is gone and re-granting is one tap, but this
is **not** as reliable as a native app push. For an operational alert acted on
the same day that is the right trade; it would be the wrong one for anything
safety-critical.
