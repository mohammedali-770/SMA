# Admin push notifications — closures on the phone

**Status: step 1 of 4 is built. Nothing sends yet.** The console is installable
and a service worker is registered; there is no subscription store, no sender
and no trigger. An admin cannot receive a notification today, and no code path
attempts to send one.

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

## 4. What is still to build

**Step 2 — subscriptions.** A migration adding `admin_push_subscriptions`
(endpoint, keys, admin id, language) gated on `is_admin()`, plus save/delete
RPCs, plus a control in the console header that requests permission. Permission
must be requested from a real tap; Apple requires the user gesture.

**Step 3 — the sender.** An Edge Function that signs a VAPID token, encrypts the
payload and POSTs to the push endpoint. Expo cannot do this — it is not the
mobile app. It must delete a subscription on `410 Gone`, so a reinstalled phone
cleans itself up rather than accumulating dead rows.

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

1. Apply the step 2 migration.
2. Apply the step 4 migration.
3. Deploy the sender Edge Function.
4. Add the VAPID private key as a secret. Generate it so the private half never
   crosses the wire, the way the alert-dispatch trigger secret was handled
   (`docs/OWNER_ACTIONS.md` §28).
5. **Delete the Home Screen icon and re-add it** after step 1 reaches
   Production. See §1 — this cannot be skipped.

## 6. The limitation, stated rather than buried

Apple's web push is best-effort. A subscription can be dropped if the web app is
left unopened for a long period, and there is no delivery receipt. The console
control will show the subscription is gone and re-granting is one tap, but this
is **not** as reliable as a native app push. For an operational alert acted on
the same day that is the right trade; it would be the wrong one for anything
safety-critical.
