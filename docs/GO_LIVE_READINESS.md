# Go-live readiness — the one-time launch gate

> **Assessed 2026-09-02.** Every status below was read from the live system or the
> source tree on that date. **Re-verify before submitting to either store.**
> CLAUDE.md §14 warns specifically against carrying dated dashboard facts forward
> as though they were current, and this document is mostly dashboard facts.
>
> **Re-verified in part on 2026-09-03, twice.** First, D7, E7 and G5 moved from ⬜
> to ✅ and E8 was added. Then a five-dimension live audit — each dimension attacked
> by an independent adversarial reviewer — produced the **Addendum** below, which
> adds seven blockers this document did not carry, corrects **D3** (it was green and
> wrong), and revises the go/no-go summary.
>
> **Everything not named in the addendum or dated 2026-09-03 is still a 2026-09-02
> reading and has not been re-checked.**

## What this is, and what it is not

This is the **one-time** gate: *is this product allowed to go live at all?* It is
about store policy, privacy law, security posture and operational readiness.

[`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) is the **per-release** gate: is
*this build* safe to ship? Change-control, CI, migration order, device validation,
go/no-go. Both are needed and they do not overlap: you run the release checklist
every time, and this one once — then again only when something structural changes
(a new data category, a new permission, a new region, a payment provider).

Items are marked:

| mark | meaning |
| --- | --- |
| ✅ | verified in place on the date shown |
| ⚠️ | works, but carries a known accepted risk or needs a decision |
| ❌ | not satisfied — a launch blocker until resolved or consciously accepted |
| ⬜ | cannot be determined from the repository; needs a human to check |

**Engineering cannot sign off section A.** Those are legal determinations. The
rule in `RELEASE_CHECKLIST.md` — *"if legal wording is incomplete, do not invent
it in an engineering release"* — applies to this whole document.

---

## A. Saudi PDPL — the section that needs counsel

Saudi Arabia's Personal Data Protection Law came into force 14 September 2023 and
has been fully enforceable since 14 September 2024. SDAIA's enforcement committees
issued 48 violation decisions across 2025–26, covering processing without a lawful
basis, unauthorised disclosure, missing safeguards, and **marketing without
consent**. Administrative penalties reach SAR 5 million.

This app processes Saudi personal data by design: customer names, `+9665…` phone
numbers, delivery addresses, map coordinates, and order history.

| # | Item | Status | Evidence / note |
| --- | --- | --- | --- |
| A1 | **Cross-border transfer has a lawful basis** | ❌ | The Supabase project is **`eu-central-1` — Frankfurt** (`get_project`, 2026-09-02). PDPL generally requires personal data collected in the Kingdom to stay there absent an adequacy finding or approved safeguards. This is the largest open item in this document and it is a legal question, not an engineering one. Resolving it may mean a transfer mechanism, or moving the project to a Kingdom region — which is a migration, not a setting. |
| A2 | Controller registered with SDAIA | ⬜ | Registration on SDAIA's platform is mandatory for controllers. Not determinable from the repository. |
| A3 | Lawful basis for each processing purpose | ⬜ | Consent is the PDPL default. Ordering, delivery, loyalty, marketing push and Sentry telemetry are distinct purposes and may not share one basis. |
| A4 | **Marketing consent** | ⚠️ | Push marketing is **opt-out**: `DEFAULT_DEVICE_PREFS` sets `promosEnabled: true`, so granting the OS notification prompt enrols the device in offers (CLAUDE.md §7, owner decision 2026-08-20). "Marketing communications without consent" is an enumerated PDPL violation. The same design is also the Apple 4.5.4 exposure in B2 — one decision, two regulators. |
| A5 | 72-hour breach notification path to SDAIA | ⬜ | [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) covers technical incident handling; it does not name a regulator, a deadline or who notifies. |
| A6 | Data-subject rights: access, correction, deletion, **portability** | ⚠️ | Deletion and correction exist (`AccountSettingsScreen.tsx`, `anonymize_account_data`, [`account-deletion-scheduler.md`](account-deletion-scheduler.md)). **Access and portability — giving a customer a copy of their data — have no implementation.** |
| A7 | Privacy notice in Arabic and English, matching actual behaviour | ⬜ | Legal documents are served from `legal_documents` (`src/lib/legal.ts`). Whether the text is current, bilingual and accurate is a content review. |
| A8 | Processor agreements with sub-processors | ⬜ | Supabase, Meta (WhatsApp), Sentry, Vercel, Expo/EAS, Google Maps and Lazywait all receive or hold personal data. |

---

## B. Apple — App Store Review Guidelines

| # | Item | Status | Evidence / note |
| --- | --- | --- | --- |
| B1 | **5.1.1(v)** in-app account deletion, easy to find | ✅ | `apps/mobile/src/features/profile/AccountSettingsScreen.tsx`, covered by `accountDeletion.test.ts` and a scheduler runbook. Confirm placement is prominent, not buried. |
| B2 | **4.5.4** marketing push requires explicit opt-in | ⚠️ | 4.5.4 requires consent *"via consent language displayed in your app's UI"* plus an in-app opt-out. Here the OS permission dialog is treated as the consent moment and the Profile toggle is the opt-out. This was raised with the owner on 2026-08-20 and **accepted**; CLAUDE.md §7 records that the revert is one line (`promosEnabled: false`) if App Review rejects on 4.5.4. Recorded here, not re-litigated. |
| B3 | Privacy nutrition labels declared and accurate | ⬜ | Must cover phone, name, precise/coarse location, addresses, order history, device token, and Sentry diagnostics. Wrong labels are a rejection and an account-flag risk. |
| B4 | Privacy manifest / required-reason APIs | ⬜ | Enforced for the binary and its SDKs. Verify Expo, Sentry and Maps SDKs ship manifests. |
| B5 | Encryption declaration | ✅ | `usesNonExemptEncryption: false` in `apps/mobile/app.json`. Confirm it stays true if cryptography is added. |
| B6 | Reviewer test account and instructions | ⬜ | Login is **WhatsApp OTP to a Saudi mobile only** (`normalizeSaudiPhoneE164` — foreign numbers are rejected at the hook). A reviewer outside KSA cannot sign in unaided. This needs a working reviewer path, and it is easy to overlook. |
| B7 | Public privacy policy and support URLs resolve without login | ✅ verified live 2026-09-03 | Was ❌ in substance: `vercel.json` rewrote **every** path to the admin shell, so `/privacy` returned 200 **while serving the admin console** — which is why nobody caught it. Fixed by #318 and **verified against the deployed site**, not just merged: `https://app.spicymeal.com.sa/privacy`, `/legal` and `/legal/privacy-policy` each return the 3,944-byte legal entry (`<title>Legal &amp; Policies — Spicy Meal</title>`), the shipped chunk targets the right project and contains no `innerHTML`, and the exact anonymous PostgREST request the page makes returns **all 9 active documents** including the 4,334-byte privacy policy. **The URL to paste into both store listings is `https://app.spicymeal.com.sa/privacy`**; support is `/support`, terms `/terms`. Editing a document in the admin console updates these pages with no redeploy. |

---

## C. Google Play

| # | Item | Status | Evidence / note |
| --- | --- | --- | --- |
| C1 | **Target API level** | ⬜ | New apps and updates must target **API 36 (Android 16)** in 2026; existing apps needed API 35 by 31 August 2026, with extensions available to 1 November 2026. `app.json` sets **no explicit target**, so it inherits the Expo SDK default — Expo SDK `~57.0.14` / RN `0.86.2` should satisfy this, but **verify on the built artifact, not from config**. |
| C2 | **`ACCESS_FINE_LOCATION` justified** | ⚠️ | Requested in `app.json` alongside `ACCESS_COARSE_LOCATION`. Play now requires a demonstrated core use case for precise location. The app's own iOS purpose string says location is used *"only to center the delivery map on you. You can always move the pin manually."* That argues for COARSE. Either justify FINE honestly or drop it. |
| C3 | No background location | ✅ | Neither `ACCESS_BACKGROUND_LOCATION` nor a location foreground service is declared. |
| C4 | `POST_NOTIFICATIONS` handled | ✅ | Declared; the runtime prompt is the consent moment (see A4/B2). |
| C5 | Data safety form matches reality | ⬜ | Must agree with B3 and with what the SDKs actually collect. Third-party SDKs collect data you did not write code for. |
| C6 | Package identity | ⚠️ | Android `sa.com.spicymeal.app` vs iOS `com.spicymeal.app`. Not a blocker; make it a deliberate choice before first publish, because neither is changeable afterwards. |

---

## D. Security

Shaped by OWASP's mobile guidance and mapped to controls this repository already
has, so it is a verification list rather than an aspiration.

| # | Item | Status | Evidence / note |
| --- | --- | --- | --- |
| D1 | No secrets in the client bundle | ✅ | CLAUDE.md §9 draws the boundary; `VITE_*` / `EXPO_PUBLIC_*` are client-visible by definition. |
| D2 | RLS on customer data, deny-by-default | ✅ | Enforced per table; `otp_send_reservations` is the recent example — RLS on, **zero policies**, service-role only. |
| D3 | Admin actions require role **and** AAL2 | ⚠️ one exception, corrected 2026-09-03 | `public.is_admin()` checks both, and the **four** admin Edge Functions were corrected **and deployed**. This row previously also claimed `payment-test-config`; that is **false in Production** and was corrected here after reading the deployed bundle: `payment-test-config` v3 (deployed 2026-07-12) still runs `if (!profile \|\| profile.role !== 'admin')` — role only, no AAL2. The repository version calls `is_admin()`; the deploy was consciously not done (CLAUDE.md §6 says so explicitly), and this table said otherwise. It matters because that function's `verify_order` reaches `confirm_order_payment` through the service-role client, bypassing RLS. Practically unreachable today — online payment is off, so no CAPTURED charge can exist, and the one admin holds a verified TOTP factor — but it is a live AAL1 hole, and it cannot be shipped alone (see the addendum, payment bundles). |
| D4 | Authentication rate limiting | ✅ | Live since 2026-09-02: `auth-send-sms-whatsapp` v2 reserves against a shared per-phone budget before every send — 60 s cooldown, 5/hour, 10/day ([`WHATSAPP_LOGIN.md`](WHATSAPP_LOGIN.md)). **Not yet exercised by a real customer login.** |
| D5 | Dependency advisories gated in CI | ⚠️ | `Dependency audit (high+)` runs on every PR. One standing exception — two `image-size` advisories with no patched release — **expires 2026-10-02** ([`DEPENDENCY_ADVISORIES.md`](DEPENDENCY_ADVISORIES.md)). If it lapses, every merge blocks. |
| D6 | No orphan privileged accounts | ✅ | `admin@spicymeal.app` — an admin on an **unregistered domain**, never signed in, no TOTP — was deleted 2026-09-02. `customer@spicymeal.app` is banned with its session revoked. |
| D7 | Transport security | ✅ | Verified 2026-09-03. `app.json` sets **no** `usesCleartextTraffic`, `networkSecurityConfig` or `NSAppTransportSecurity`/`NSAllowsArbitraryLoads` key, so both platforms' secure defaults apply — and on Expo SDK 57 / React Native 0.86 the Android target SDK is well past 28, where cleartext is denied by default. No `http://` endpoint exists in shipped mobile source; the only occurrences are comments, tests, and `webviewPolicy.ts`, which **blocks** `http://` explicitly. |

---

## E. Reliability and operations

| # | Item | Status | Evidence / note |
| --- | --- | --- | --- |
| E1 | **Point-in-time recovery** | ❌ | The Supabase organisation is on the **free** plan (`get_organization`, 2026-09-02), so PITR cannot be purchased. Before real orders and real money, an unrecoverable window is a business risk, not a technical preference. See [`BACKUP_RECOVERY.md`](BACKUP_RECOVERY.md). |
| E2 | **Administrator redundancy** | ⚠️ | Exactly **one** admin (`mohammed.ali@spicymeal.com.sa`) with **one** verified TOTP factor. `StaffMfaGate.tsx:49` only offers enrolment when no verified factor exists, so the console cannot add a second. Break-glass does exist: remove the factor via the Supabase dashboard and the gate offers enrolment again — so this is a lockout inconvenience, not a permanent loss. |
| E3 | Order-integrity monitoring | ✅ | `order_integrity_watchdog` runs every 2 minutes over **13 rules**, including cash orders since 2026-09-01 ([`ORDER_INTEGRITY_WATCHDOG.md`](ORDER_INTEGRITY_WATCHDOG.md)). |
| E4 | Error monitoring | ⬜ | Sentry is configured for web and native. Confirm native source maps resolve for production builds. |
| E5 | Incident response is current | ⬜ | [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) exists; confirm the contacts and escalation path are real people who are reachable. |
| E6 | POS integration proven end to end | ✅ | Delivery reaches Lazywait — SM-2026-000059 became POS ticket #3 in 42 s ([`LAZYWAIT.md`](LAZYWAIT.md)). |
| E7 | Closed-branch enforcement | ✅ | Verified 2026-09-03, and the question was mis-framed. `place_order` refuses server-side on **`is_active`** ("The selected branch is not available"), on `delivery_enabled` / `delivery_temporarily_closed` for delivery, and on `pickup_enabled` for pickup — the UI is not the only gate. Trading hours are a **separate, deliberately advisory** concept: `branch_working_hours` carries its own table comment *"ADVISORY ONLY … NOTHING enforces these"*, no order path reads it, and the admin editor tells the user so in as many words — *"Orders are not blocked outside these hours — use Open/Closed for that."* **The consequence to accept knowingly: there is no schedule, so orders are accepted around the clock unless a human deactivates or pauses the branch.** Currently moot — the table holds **0 rows** across all 40 branches. |
| E8 | **OTP delivery is unobservable** | ⚠️ | Found 2026-09-03. `whatsapp-webhook` rejects every Meta delivery callback with a **503**, because the `whatsapp` row in `integration_settings` has no `app_secret` (key presence read; no value). The handler fails closed, which is correct — but it means there is **no delivery, read or failure status for any OTP ever sent**: all 30 `whatsapp_message_logs` rows come from the *send* paths, none from the webhook. Login itself is unaffected and customers do receive codes. The cost is that "my code never arrived" — the commonest launch-day support call for a phone-login app — is currently undiagnosable. One secret to set: [`OWNER_ACTIONS.md`](OWNER_ACTIONS.md) §25. |

---

## F. Accessibility and localisation

| # | Item | Status | Evidence / note |
| --- | --- | --- | --- |
| F1 | Arabic and English, including RTL | ⬜ | Both ship; `RELEASE_CHECKLIST.md` §7 already requires RTL device validation. |
| F2 | Dynamic type / large text | ⬜ | Verify layouts survive the largest system font. |
| F3 | Contrast and dark mode | ⚠️ | `design-system:check` enforces token hygiene, not perceived contrast. §7 of the release checklist calls out "unreadable frozen-light colors" as a real past failure. |
| F4 | Screen-reader labels on primary flows | ⬜ | Menu → cart → checkout → confirmation, in both languages. |
| F5 | Tap-target sizes | ⬜ | Both platforms publish minimums. |

---

## G. Commercial readiness

| # | Item | Status | Evidence / note |
| --- | --- | --- | --- |
| G1 | **Payment provider** | ❌ for card payment · ✅ for a cash launch | No provider is selected and payment work is **frozen** (CLAUDE.md §6). Tap is provisional, Moyasar is complete but inert — its migration is deliberately unapplied. Live data agrees: of 65 orders, 63 are `payment_status = 'pending'` and the only 2 `paid` are comped zero-total. **A cash-only launch is coherent today; an online-payment launch is not.** |
| G2 | Refunds | ❌ if taking payment | Automated refund processing is intentionally disabled under the freeze. |
| G3 | Menu content ready | ⬜ | 55 active products; **1** now carries an image. Decide whether launching with mostly image-less products is acceptable. |
| G4 | Store listing assets | ⬜ | Screenshots, description, category, support contact — in both languages. |
| G5 | Terms, refund and delivery policy match behaviour | ✅ for a cash launch | Verified 2026-09-03 against the **live** `legal_documents` rows (all 9 active, effective 2026-08-18). The copy was already written for a cash-only launch and says so plainly: `payment_policy` — *"paid in cash … Online card payment is not currently available in the app"* and *"We have not yet selected an online payment provider"*; `cancellation_refund_policy` — *"Where a refund is due, it is settled in cash at the branch that prepared the order."* Nothing promises card payment or an online refund. The cancellation window (*"while your order is still Received"*) is also accurate: `received` remains the live status on 62 of 68 orders and the app still renders it as **Received** — only its *push* was retired on 2026-08-27. **Re-check this the moment a payment provider is chosen**, since both documents promise to be updated *before* the option appears. |
| G6 | **Campaigns / promo codes are not a launch feature** | ⚠️ known gap | The schema (`campaigns`, `campaign_redemptions`, `compute_campaign_discount`) is applied to Production, but **there is no UI in either app** — no admin tab, no customer entry point — and `place_order` has no campaign awareness, so `global_limit`/`per_user_limit` are unenforced and no redemption row is ever written. Established by the 2026-09-02 dead-code audit. **Do not advertise promo codes at launch.** Detail: `docs/DISCOUNTS_CAMPAIGNS.md` Part 1. |
| G7 | **A failed refund is invisible to operators** | ⚠️ known gap | `list_failed_order_refunds()` is live and correctly admin-gated (role **and** AAL2), but **no admin screen calls it** and `order_refunds` is not read anywhere in `src/` or `apps/`. If a refund fails there is no surface that shows it. FROZEN under §6, so recorded rather than fixed — but it matters the moment G1/G2 are answered. |

---

## Addendum — 2026-09-03 live audit

**What this is.** A five-dimension audit run on 2026-09-03 against live Production
and the source tree, each dimension independently re-checked by an adversarial
reviewer instructed to attack it from both directions. It found items this document
did not have, and it corrected one row of it (**D3**, above). The sections A–G
remain a 2026-09-02 snapshot except where a row says otherwise; **this addendum is
the 2026-09-03 layer, and nothing here silently rewrites a row above it.**

**How to read the evidence labels.** *Live-verified* means a query, an HTTP request
or a deployed artifact was read on 2026-09-03. *Source-verified* means the claim was
read out of the repository. *Asserted* means neither was possible from a session and
a human must check. Items are separated by who can act, because that is the
difference between a task and a decision.

### New hard blockers this document did not carry

X7 was added after the first pass, when the audit's final round landed; it is the
most time-sensitive item on this page.

| # | Item | Evidence | Action |
| --- | --- | --- | --- |
| **X1** | **A store reviewer cannot sign in.** Authentication is WhatsApp OTP to a **Saudi mobile only**, enforced twice: `SaudiPhoneInput` renders a fixed `+966` and sanitises input to a 9-digit `5XXXXXXXX`, and `phone.ts` accepts only `/^5\d{8}$/`, so `sendCode` refuses and the button is `disabled={!isSaudiMobile(national)}`. A reviewer in Cupertino cannot type their own number, and cannot receive a WhatsApp code for a Saudi one. | source-verified | Apple requires working demo credentials for anything behind sign-in (guideline 2.1). Decide the mechanism — a test number whose code is obtainable, or documented App Review notes — **before** submitting. Owner decision; under an hour once decided. |
| **X2** | **No production build exists for the code that would ship.** The newest **iOS** production build is 1.0.0 (22), commit `6265781a`, 2026-08-26 — **~54 commits stale**, predating the delivery-to-POS go-live. Every **Android** build ever made is a `preview` APK: **no production app-bundle has ever been produced**, and `eas.json`'s `submit.production` contains only `ios.ascAppId`, so there is no Play track configured. | live-verified via authenticated EAS CLI | One production build per platform, then the §1 physical-device gate. Android additionally needs a Play Console record, data-safety and content-rating forms. Owner; days. |
| **X3** | **Nothing pages a human, and that is structural rather than a switched-off toggle.** The alert engine works and has proved it — `operations_alert_outbox` holds **112 rows**, including a critical `order_integrity:stranded_orders`, and **every one** is `('in_app','recorded')`. None has ever left the database. If the POS fails during Friday dinner, no person is told. | live-verified | Launch-week stopgap costs nothing: a named human checks Admin → Order Integrity at fixed times each service day, and that expectation is written down. Real dispatch is new code plus a migration. |
| **X4** | **In-app account deletion is buried three levels deep** — Profile → "Policies, privacy & contact" → a list of nine legal documents → "Account & privacy" → "Delete account". The Profile screen has no deletion entry at all. Apple 5.1.1(v) requires it to be *easily found*. | source-verified | One `MenuRow` on `ProfileScreen`. Under an hour — but it must ride the build in **X2**. |
| **X5** | **The order lifecycle past `received` has never executed in Production, and every transition pushes a live customer notification.** All 68 orders are `received` (62) or `cancelled` (6). Zero `direction='webhook'` rows from the POS: the status callback has **never fired**. A real customer today gets `pos_confirmed` and then hears nothing, ever. | live-verified | Investigate before coding: confirm with Lazywait whether the callback is registered at all. If it is not, the admin console's manual status path *is* the launch mechanism and must be rehearsed end to end on one order. |
| **X6** | **The `ready` push tells delivery customers to come and collect.** Delivery has been live since 2026-08-27, and `push-dispatch`'s `ready` copy says collect, in both languages. | source-verified | A one-line copy fix, code-only. It must land **before** any lifecycle rehearsal (**X5**), or the rehearsal sends the wrong message to a real person. |
| **X7** | **The only customer login channel is unexercised, fallback-free and may expire inside launch week.** WhatsApp OTP is the sole route in: `otp_channel_default='whatsapp'`, `sms_otp_fallback_enabled=false`, and the SMS provider row is `sandbox`/disabled — **there is no fallback of any kind**. Live 2026-09-03: the last `auth_login` OTP was sent **2026-08-21** (**0 in the last 7 days**), the last customer sign-in was the same day, and `otp_send_reservations` is empty — so **no real login has ever run through `auth-send-sms-whatsapp` v2**, deployed 2026-09-02. The WhatsApp `integration_settings` row was last updated **2026-07-10, 54 days ago**. | live-verified; **the expiry is an inference, not a reading** — key *names* only were read, never a value, and a Meta **System User** token does not expire while a standard one lapses at 60 days (which would fall ~2026-09-08) | Confirm in Meta Business Manager which token type is in use and when it expires, and that templates `spicymeal_otp_en`/`_ar` are still approved. Then **run one real end-to-end login before launch.** If the token has lapsed, 100% of signups fail at the front door — and with §25 (no delivery callbacks) and X3 (no external alerting) the first signal is a customer complaint. Owner; minutes to check. |

### Corrections to claims already in this document

- **D3 was green and wrong** — corrected in place above.
- **Push audience is far smaller than CLAUDE.md §7 implies.** §7 warns a broadcast now
  reaches "close to the whole active base". Live: `push_devices` holds **4 active rows,
  all iOS, exactly 1 with `promos_enabled`**. The consent model is as §7 describes; the
  blast radius today is not. **Android push has therefore never been exercised at all.**
- **The single-admin lockout is less severe than §16/E2 suggest.** Break-glass exists —
  removing the factor from the Supabase dashboard re-offers enrolment. It is a lockout
  inconvenience, not permanent loss. Still worth a second admin.
- **Security posture is better than this document's silence implies.** `get_advisors`
  returns **zero ERROR-level findings**; the 15 INFO `rls_enabled_no_policy` hits are all
  service-role-only operational tables, where deny-all is the correct design.
- **A second free-plan wall sits behind E1.** The database is **88 MB against the free
  plan's 500 MB ceiling**. Not urgent, but it is the same upgrade decision.

### Should-fix, cash launch

| Item | Evidence | Note |
| --- | --- | --- |
| **62 stale test orders sit in the kitchen's active queue**, spanning 2026-07 onward. Production opens on day one with a board that is not clean. | live-verified | Cancel them through the admin path before launch. A live write, so owner-approved. |
| **Four real delivery orders still show `received` to customers who never got food** — SM-2026-000032, -000049, -000057, -000058, all `blocked` / `delivery_schema_unconfirmed`. | live-verified | Contact those four customers and cancel the orders. Owner. |
| **The one live branch has no contact phone** (`phone = ''`), and the branch table holds **40 rows with near-duplicates** — two `Al Jesh`, two `Al-Awjam`, three `City Mall` — where the wrong row is often the unmapped one. | live-verified | Activating a duplicate at launch sends every order from it to `blocked`/`missing_branch_mapping`, and per **X3** silently. Audit `lazywait_branch_id` before activating anything beyond Nasserah. |
| **The live POS integration posts to a vendor DEV host** (`apiv2-dev.lazywait.com`), unchanged since 2026-07-24. 58 real tickets prove it works, and the owner confirmed on 2026-08-24 that this *is* the POS for this branch. | live-verified | A vendor dev environment normally carries no SLA and can be reset without notice. One email to Lazywait before paying customers depend on it. |
| **Checkout makes the customer wait 2.3–8.3 s**, by design — `order-intake` waits synchronously for the POS so the receipt can show a real ticket number. | live-verified | Accept consciously for launch; make sure the button shows progress. Making it asynchronous is a redesign, not a launch-week task. |
| **The POS failure/retry/dead-letter machinery has never executed once.** Zero failed `lazywait` rows in the system's whole history; 0 incidents across 30,977 watchdog runs. | live-verified | Well designed, entirely unproven. Rehearse on a disposable database, **never** against Production during trading. |
| **`whatsapp-webhook` is dead for want of an `app_secret`** — already `OWNER_ACTIONS.md` §25 and row **E8**, repeated here because WhatsApp OTP is the *only* way a customer signs in, and it is unmonitored. | live-verified | One credential. Minutes. |
| **Expo SDK patch drift** — `expo-doctor` reports 11 packages behind the SDK's pinned set, including `expo-notifications`. | live-verified | `npx expo install --check` plus a regression pass. Do it *before* the **X2** builds, not after. |
| **`ACCESS_FINE_LOCATION` is requested while the app's own purpose string describes a coarse use** ("only to center the delivery map on you"). | source-verified | One line in `app.json`, or a written justification for Play's precise-location form. |
| **No iOS app-level privacy manifest.** `app.json` has no `ios.privacyManifests`, so Expo's plugin emits no `PrivacyInfo.xcprivacy` for the app target. | source-verified | Discovered at upload rather than at build. Minutes if it turns out to be needed. |

### Card-payment launch only — none of this applies to a cash launch

These are recorded so the cash decision is made with its alternative priced honestly.

- **Online card payment is not a week of work.** No provider is selected and no merchant
  agreement is signed with either candidate. Merchant KYC/onboarding is the long pole and
  is outside anyone's control here — typically weeks, then 2–4 weeks of engineering.
  Live: **9 `payment_records`, zero ever `paid`**; the only two `paid` orders are comped
  zero-total.
- **Every payment Edge Function is an 8-week-old bundle, and redeploying is not a no-op.**
  Read directly from the deployed artifact: `payment-test-config` v3's `tapVerify.ts` has
  no session-first branch, while the repository version calls `finalize_checkout_session`.
  "Just redeploy the payment functions" would ship checkout-session finalisation and the
  POS retry/deadline lifecycle into Production as a side effect. This is also why **D3**'s
  exception cannot be fixed on its own.
- **Refund *enrolment* is automatic while refund *processing* is disabled.** Two enabled
  triggers on `orders` write `refund_state='pending'` and an `order_refunds` row for a paid
  order that provably never reached the POS, while cron job 6 (`payment-refund-worker`) is
  correctly inactive. The system would promise refunds nothing is running to pay.
- **There is no operator surface for refunds at all.** `list_failed_order_refunds()` exists
  and is correctly `is_admin()`-gated, and has **zero call sites** in either client. For a
  cash launch this costs nothing — the live policy already says refunds are settled in cash
  at the branch, which matches reality exactly.

### Open, and honestly unresolved

- **Trading hours are enforced nowhere and configured nowhere.** `branch_working_hours`
  holds **0 rows across all 40 branches**, and no order path reads it — by design, per the
  table's own comment and row **E7**. The *consequence* is what needs a decision: the shop
  is orderable **24/7** unless a human toggles `is_active` / `pickup_enabled` /
  `delivery_enabled`. Both reviewers rated this a blocker; **E7** rates the mechanism
  correct. Both are right about different things. The launch-week answer is a written
  human routine, not code.
- **Arabic word order on printed Lazywait tickets** (`OWNER_ACTIONS.md` §22 item B) could
  not be confirmed or refuted — no printed ticket is inspectable from a session. It needs
  somebody to look at one.

---

## Go / no-go summary

**Revised 2026-09-03 by the addendum above. The 2026-09-02 list had three items; it
now has eight, and the shape of the launch has changed with it.**

**Decide this first, because it removes three of the eight:** cash-only, or card at
launch? The system today *is* a cash system and enforces it end to end — 66 of 68
orders are `payment_status='pending'` and the only two `paid` are comped zero-total.
A cash launch is coherent now. A card launch is a provider decision plus merchant
onboarding measured in weeks, and is not compatible with a one-week go-live.

**Hard blockers for a CASH launch (nine):**

1. **A1 — PDPL cross-border transfer.** Saudi personal data in `eu-central-1` with no
   recorded lawful basis. Counsel, possibly a region move. Longest lead time on the
   list; nothing else shortens it. *(2026-09-02)*
2. **E1 — no PITR.** Free plan, so it cannot even be purchased. Unrecoverable data
   window before real money. *(2026-09-02)*
3. **X2 — no production build exists for the code that would ship.** iOS is ~54
   commits stale; Android has never had a production build at all. *(2026-09-03)*
4. **§1 — physical-device validation has never been performed**, on either platform.
   It gates on X2. *(2026-09-02, re-confirmed)*
5. **X1 — a store reviewer cannot sign in.** Login is hard-locked to Saudi mobiles
   with a WhatsApp OTP. Apple guideline 2.1. *(2026-09-03)*
6. **X4 — account deletion is buried three levels deep.** Apple 5.1.1(v). Rides the
   X2 build, so it must be decided before the build, not after. *(2026-09-03)*
7. **X3 — nothing pages a human.** All 112 alerts ever raised stopped inside the
   database. A launch-week human routine closes it for free. *(2026-09-03)*
8. **X5/X6 — the order lifecycle past `received` has never run in Production**, and
   the `ready` push currently tells delivery customers to come and collect. Fix the
   copy, then rehearse once. *(2026-09-03)*
9. **X7 — the only login channel is unexercised, fallback-free, and its credential
   may lapse inside launch week.** No customer has signed in since 2026-08-21 and the
   WhatsApp settings row is 54 days old. Cheapest item on this list to check and the
   most total in its failure: nobody can sign up at all. *(2026-09-03)*

**Additionally, and only if taking card payment:** G1/G2 (no provider, weeks of
onboarding), the 8-week-old payment bundles that cannot be redeployed safely one at a
time, and automatic refund *enrolment* against disabled refund *processing*.

**Accepted or decided risks, recorded rather than re-argued:** A4/B2 (opt-out
marketing push, accepted 2026-08-20 — note the live audience is 4 devices, 1 opted
into promos), C2 (`ACCESS_FINE_LOCATION` breadth), E2 (single admin — break-glass
exists), D5 (`image-size` exception until 2026-10-02), G6 (campaigns built but
unreachable), G7 (no operator view of failed refunds — costless for a cash launch).

**The largest unknowns are still legal, not technical.** Everything in section A
except A6 needs somebody who is not an engineer. **The largest *new* finding is
operational rather than legal: nothing that fails at 20:00 on a Friday reaches a
person.**

**Two content facts that decide how launch looks, neither of them a blocker:** 54 of
55 active products have no image and 40 have no English description; and 62 stale
test orders plus 4 stranded real delivery orders are sitting in the live queue today.

**Owner sign-off:** ☐ go ☐ no-go — date: ______

## When to re-run this

Re-assess when any of these change: a new category of personal data, a new
platform permission, the Supabase region or plan, the payment provider, the push
consent model, or a new sub-processor. Otherwise the statuses above are a snapshot
of 2026-09-02 and should be treated as history.
