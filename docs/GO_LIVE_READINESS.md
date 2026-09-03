# Go-live readiness — the one-time launch gate

> **Assessed 2026-09-02.** Every status below was read from the live system or the
> source tree on that date. **Re-verify before submitting to either store.**
> CLAUDE.md §14 warns specifically against carrying dated dashboard facts forward
> as though they were current, and this document is mostly dashboard facts.
>
> **Partially re-verified 2026-09-03:** D7, E7 and G5 were resolved from ⬜ to ✅
> and E8 was added. Those four rows carry that date; **every other row is still a
> 2026-09-02 reading** and has not been re-checked. The go/no-go summary is
> unchanged — none of the four is a blocker.

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
| B7 | Public privacy policy and support URLs resolve without login | ⬜ | Also required by `RELEASE_CHECKLIST.md` §8. |

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
| D3 | Admin actions require role **and** AAL2 | ✅ | `public.is_admin()` checks both; the four admin Edge Functions and `payment-test-config` were corrected to use it (CLAUDE.md §6, §7). |
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

## Go / no-go summary

**Hard blockers as assessed on 2026-09-02:**

1. **A1 — PDPL cross-border transfer.** Saudi personal data in `eu-central-1`
   without a recorded lawful basis. Needs counsel, and possibly a region move.
2. **E1 — no PITR.** Free plan; unrecoverable data window.
3. **G1/G2 — no payment provider**, if the launch is meant to take card payment.
   Not a blocker for a cash-only launch.

**Accepted or decided risks, recorded rather than re-argued:** A4/B2 (opt-out
marketing push, accepted 2026-08-20), C2 (`ACCESS_FINE_LOCATION` breadth),
E2 (single admin), D5 (`image-size` exception until 2026-10-02), G6 (campaigns
built but unreachable), G7 (no operator view of failed refunds).

**The largest unknowns are legal, not technical.** Everything in section A except
A6 needs somebody who is not an engineer.

**Owner sign-off:** ☐ go ☐ no-go — date: ______

## When to re-run this

Re-assess when any of these change: a new category of personal data, a new
platform permission, the Supabase region or plan, the payment provider, the push
consent model, or a new sub-processor. Otherwise the statuses above are a snapshot
of 2026-09-02 and should be treated as history.
