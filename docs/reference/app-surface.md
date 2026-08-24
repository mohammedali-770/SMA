<!-- ------------------------------------------------------------------
     GENERATED FILE — DO NOT EDIT.
     Regenerate with: npm run docs:generate
     CI fails if this file drifts from its source (npm run docs:check).
     Derived from: `apps/mobile/src/app/`, `apps/mobile/src/features/`, `src/components/admin/`
     Describes the REPOSITORY, not live Production.
     ------------------------------------------------------------------ -->

# Application surface

Every screen a customer can reach, every panel an administrator can open, and the feature modules behind them. Use this to find the code for a screen someone is describing, and to see at a glance what shipping surface exists.

## Customer app routes

The customer app uses expo-router, so the file path *is* the route. A path segment in square brackets is a parameter.

| Route | File |
| --- | --- |
| `/` | `apps/mobile/src/app/index.tsx` |
| `/(auth)/login` | `apps/mobile/src/app/(auth)/login.tsx` |
| `/(tabs)` | `apps/mobile/src/app/(tabs)/index.tsx` |
| `/(tabs)/orders` | `apps/mobile/src/app/(tabs)/orders.tsx` |
| `/(tabs)/profile` | `apps/mobile/src/app/(tabs)/profile.tsx` |
| `/account/delete` | `apps/mobile/src/app/account/delete.tsx` |
| `/cart` | `apps/mobile/src/app/cart.tsx` |
| `/checkout` | `apps/mobile/src/app/checkout.tsx` |
| `/dev-fixture` | `apps/mobile/src/app/dev-fixture.tsx` _(development only)_ |
| `/dev-preview` | `apps/mobile/src/app/dev-preview.tsx` _(development only)_ |
| `/dev-sentry` | `apps/mobile/src/app/dev-sentry.tsx` _(development only)_ |
| `/legal` | `apps/mobile/src/app/legal/index.tsx` |
| `/legal/[type]` | `apps/mobile/src/app/legal/[type].tsx` |
| `/payment/checkout` | `apps/mobile/src/app/payment/checkout.tsx` |
| `/payment/return` | `apps/mobile/src/app/payment/return.tsx` |
| `/product/[id]` | `apps/mobile/src/app/product/[id].tsx` |
| `/profile/account` | `apps/mobile/src/app/profile/account.tsx` |
| `/profile/address/[id]` | `apps/mobile/src/app/profile/address/[id].tsx` |
| `/profile/addresses` | `apps/mobile/src/app/profile/addresses.tsx` |
| `/profile/notifications` | `apps/mobile/src/app/profile/notifications.tsx` |
| `/receipt/[id]` | `apps/mobile/src/app/receipt/[id].tsx` |
| `/select` | `apps/mobile/src/app/select.tsx` |

Layout files (not routes of their own): `(auth)/_layout.tsx`, `(tabs)/_layout.tsx`, `_layout.tsx`.

## Customer feature modules

Screens are thin. Behaviour lives in feature modules, each of which keeps its pure logic in framework-free files so it can be unit-tested under Node.

| Module | Source files |
| --- | --- |
| `account` | 2 |
| `auth` | 3 |
| `cart` | 6 |
| `checkout` | 22 |
| `legal` | 2 |
| `menu` | 3 |
| `notifications` | 9 |
| `onboarding` | 4 |
| `order` | 6 |
| `orders` | 10 |
| `otp` | 7 |
| `product` | 1 |
| `profile` | 12 |

## Admin console panels

The admin console is panel-based rather than routed: one component per operational area, summarised from each file’s header comment.

| Panel | Purpose |
| --- | --- |
| BannerManagementPanel | Admin-only Banner Management. Admins add/enable/order/delete homepage banners shown in the mobile app (above the search bar). Accountants are… |
| BranchPoliciesPanel | Lazy so mapbox-gl loads only when an admin opens the zone editor |
| EmailServerPanel | Admin Email/SMTP status + test-send panel. Reads config-presence booleans from the `email-test-config` Edge Function (never the SMTP password) and… |
| IntegrationsPanel | Admin-only system console for external integrations + staff access |
| LazywaitPanel | Admin-only Lazywait POS visibility + controls (secure: talks to Supabase via RLS-guarded api calls; no Lazywait secret ever reaches the browser): |
| LegalDocumentsPanel | Admin-only Legal Documents editor. Admins edit the AR/EN title + content, version, effective date, active flag, and requires_acceptance for each… |
| LiveOrdersPanel | Live Orders — the console's busiest surface |
| MenuManagementPanel | — |
| MoyasarPaymentPanel | Admin Moyasar readiness + connection test. Reads config-presence booleans from the `payment-test-config` Edge Function (never any secret key) and… |
| OperationsAlertsPanel | The three filter selects. Native <select> is deliberate — it gives the OS picker on a phone and keyboard type-ahead on a desktop, neither of which a… |
| OperationsHealthPanel | Operations Health Center — READ-ONLY observability |
| OrderIntegrityPanel | Order Integrity Watchdog — admin monitoring (READ + acknowledge/suppress only) |
| PushToolsPanel | Admin push tools (below the push credentials card): |
| ReportsPanel | — |
| SettingsPanel | — |
| StaffAccessPanel | — |
| StatsPanel | The dashboard's four headline figures and the branch sales section |
| TapPaymentPanel | Admin Tap Payments readiness + connection test. Reads config-presence booleans from the `payment-test-config` Edge Function (never any secret key)… |
| WhatsAppOtpPanel | Admin WhatsApp OTP status + test-send panel. Reads config presence booleans from the `whatsapp-test-config` Edge Function (never any secret values)… |
