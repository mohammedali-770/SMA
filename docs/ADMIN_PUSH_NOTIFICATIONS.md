# Admin push notifications — closures on the phone

**Status: steps 1 and 2 are built. Nothing sends yet.** The console is
installable, a service worker is registered, and an admin can subscribe from the
header once the step 2 migration is applied and a VAPID key is configured. There
is still no sender and no trigger, so **no code path attempts to send anything**
— subscribing stores a row and produces no notification.

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

## 4. What is still to build

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
