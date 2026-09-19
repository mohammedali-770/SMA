# Admin push notifications — closures on the phone

**Status: steps 1, 2 and 3 are built. Nothing sends yet, and that is now a
statement about CONFIGURATION rather than about missing code.** The console is
installable, a service worker is registered, an admin can subscribe from the
header, and the sender exists. What does not exist is a deployed function, a
VAPID key pair, an applied migration or a trigger — so today there is still no
path by which a notification is produced. Every one of those is a separate owner
action under CLAUDE.md §5, listed in §5 below.

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
| `supabase/migrations/20260927120000_admin_push_subscriptions.sql` | `admin_push_subscriptions` (closed table), `app_settings.admin_push_vapid_public_key`, and three `is_admin()`-gated RPCs. **Written, not applied.** Detail: `docs/MIGRATIONS.md` §49. |
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

## 4. What is still to build

**Step 4 — the trigger.** `branch_availability_events` and
`branch_delivery_events` **already record every closure**, with `branch_id`,
`product_id`, `variant_id`, `modifier_id`, `action`, `reason_code`,
`changed_by`, `actor_role` and `source`. So the trigger hangs off those two
tables and **no closure RPC is modified** — the code that takes items off the
menu is not touched by this feature at all. Filter: `modifier_id is null` drops
add-ons; the close action drops reopens.

## 5. Owner actions

Each is separate under CLAUDE.md §5; approval for one is not approval for the
next.

Full steps, in order, with the commands: `docs/OWNER_ACTIONS.md` §41.

1. Apply `20260927120000_admin_push_subscriptions` (step 2).
2. Generate a VAPID key pair — `node scripts/generate-vapid-keys.mjs`.
3. Store both halves as Edge Function secrets, and the **public** half in
   `app_settings.admin_push_vapid_public_key` (a live write, so its own §5
   action).
4. Deploy `admin-push-dispatch`.
5. **Delete the Home Screen icon and re-add it** after step 1 reaches
   Production. See §1 — this cannot be skipped.
6. Apply the step 4 migration, once it is written.

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
