# Store submission — Apple App Store and Google Play

> **Requirements researched 2026-09-05** against Apple and Google's published
> rules as they stand on that date. **Project evaluated 2026-09-05** against the
> source tree at `origin/claude/project-build-ie4b56` (`debad19`) and, where a
> row says so, against live Production read-only.
>
> Store console state — App Store Connect, Play Console, EAS, the Apple and
> Google developer accounts — **cannot be read from this repository**. Every row
> marked ⬜ needs a human with those logins. Do not let a later reader mistake
> this snapshot for current console truth (CLAUDE.md §14).

## What this is, and what it is not

Three documents cover launch, and they do not overlap:

| Document | Question it answers |
| --- | --- |
| [`GO_LIVE_READINESS.md`](GO_LIVE_READINESS.md) | *May this product go live at all?* Privacy law, security, operations, commercial readiness. |
| **This document** | *What do the two app stores demand of a first submission, and what is left to satisfy them?* |
| [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) | *Is **this build** safe to ship?* Run every time. |

Where a store requirement is already tracked in `GO_LIVE_READINESS.md` (its
sections **B** and **C**, and addendum items **X1**, **X2**, **X4**) this
document cites the row rather than restating it, and says plainly where it
**adds** something that document does not carry. Four requirements below are new
here: Apple's **age-rating questionnaire** (mandatory since 31 January 2026, and
its social-media declaration since September 2026), Apple's **iOS 26 SDK build
floor**, Play's **12-testers / 14-days closed-test gate**, and the **map
credential** that is absent from `eas.json`.

Marks: ✅ satisfied · ⚠️ works with an accepted or open risk · ❌ not satisfied ·
⬜ not determinable from here.

---

## 1. The requirements, as they stand in September 2026

### Apple

| # | Requirement | Rule | In force |
| --- | --- | --- | --- |
| a | Built with the **iOS 26 SDK** (Xcode 26) | Apple SDK floor | New submissions **and** updates since 28 April 2026 |
| b | **Updated age-rating questionnaire** answered — 4+, 9+, 13+, 16+, 18+ | App Store Connect | Since 31 January 2026; unanswered apps are **blocked from submitting** |
| c | **Social-media capability declaration** | App Store Connect | Required on new apps and updates from **September 2026** — i.e. now |
| d | **Privacy nutrition labels** ("App Privacy") complete and accurate | 5.1 | Always; tightened for 2026 |
| e | **Privacy manifest** (`PrivacyInfo.xcprivacy`) for the app and every bundled SDK, declaring required-reason API use | 5.1.2 | Since 1 May 2024 |
| f | **Privacy policy URL** reachable with no account | 5.1.1(i) | Always |
| g | **In-app account deletion**, easy to find | 5.1.1(v) | Since 30 June 2022 |
| h | **Working demo credentials** and review notes for anything behind sign-in | 2.1 | Always |
| i | **Marketing push requires opt-in consent shown in the app's own UI**, plus an in-app opt-out | 4.5.4 | Always |
| j | Digital goods use IAP; **physical goods and services must not** | 3.1.1 / 3.1.5(a) | Always |
| k | **Sign in with Apple** (or an equivalent) if the app uses a *third-party* login service for the primary account | 4.8 | Always — exempt when the app uses only its own account system |
| l | **Export-compliance / encryption** answer | 5.1 / ATS | Always |
| m | App is **complete, functional and free of placeholders** on the reviewer's device | 2.1 / 2.3 | Always |

### Google Play

| # | Requirement | Rule | In force |
| --- | --- | --- | --- |
| n | **Target API level 36 (Android 16)** | Target API policy | New apps and updates since **31 August 2026** (extensions to 1 November 2026) |
| o | **Android App Bundle** (`.aab`), not APK, for production | Play delivery | Since August 2021 |
| p | **Closed test: ≥12 testers, opted in continuously for ≥14 days**, with genuine use, before production access | Testing requirement for **personal** developer accounts created after 13 Nov 2023 | Current — **organisation accounts verified with a D-U-N-S number are exempt** |
| q | **Data safety form** — 14 data categories: collected, shared, why, how secured, deletable | User Data | Since April 2022; enforcement tightened April 2025 |
| r | **Privacy policy URL** on the store listing | User Data | Since July 2022 |
| s | **Account deletion — in-app *and* through a web resource** that needs no app install | Account deletion policy | Current |
| t | **Content rating** (IARC questionnaire) | App content | Always |
| u | **Target audience and content** declaration | App content | Always |
| v | **Ads** declaration | App content | Always |
| w | **App access** — sign-in credentials or instructions for the reviewer | App content | Required whenever any feature is behind authentication |
| x | **Financial features** and **Health apps** declarations | App content | Must be answered even to say "none" |
| y | **Permissions declaration** for sensitive permissions; precise location needs a demonstrated core use | User Data / permissions | Current |
| z | **Developer account verification** (identity, address, contact; D-U-N-S for organisations) | Play policy | Current |

Sources are listed at the end.

---

## 2. Evaluation — Apple

| # | Requirement | Status | Evidence, 2026-09-05 |
| --- | --- | --- | --- |
| **AP1** | iOS 26 SDK floor (a) | ⬜ | Expo SDK `~57.0.14` / React Native `0.86.2` (`apps/mobile/package.json`) builds against Xcode 26 on EAS, so this should hold. But `eas.json` pins **no build image**, so the SDK is whatever EAS defaults to on build day. **Verify on the artifact, not from config.** |
| **AP2** | Age-rating questionnaire (b) | ⬜ **not previously tracked** | Cannot be read from the repository. If it has never been answered for app `6800210683`, **submission is blocked in App Store Connect until it is** — this is a hard gate, not a warning. The live privacy policy states *"The app is not intended for children under 18"*, which is the input to answer it with; reconcile that with the rating actually chosen, because an 18+ food-ordering app is an unusual declaration and it must match the listing. |
| **AP3** | Social-media declaration (c) | ⬜ **not previously tracked** | In force from September 2026 — it applies to this submission. The app has no user-to-user content, no profiles and no messaging, so the answer is straightforward; it still has to be given. |
| **AP4** | Privacy nutrition labels (d) | ⬜ | `GO_LIVE_READINESS.md` **B3**. A complete draft, derived from the live privacy policy, is in **§4** below — it is a starting point for the person filling the form, not a substitute for checking what the SDKs actually send. |
| **AP5** | Privacy manifest (e) | ⚠️ | `app.json` has **no `ios.privacyManifests` key**, so Expo emits no `PrivacyInfo.xcprivacy` for the *app* target. Bundled SDKs (Expo modules, React Native, Sentry) ship their own. The app itself reaches required-reason APIs through `@react-native-async-storage/async-storage` (UserDefaults, reason `CA92.1`) and file-timestamp APIs. Missing app-level declarations surface as **ITMS-91053 at upload**, after the build — cheap to add now, expensive to discover at 2 a.m. on submission day. |
| **AP6** | Public privacy policy URL (f) | ✅ live-verified | `https://app.spicymeal.com.sa/privacy` (`vercel.json` rewrite → `legal.html`; `requestFromPath` maps `/privacy` → `privacy_policy`). Live read 2026-09-05: **9 active legal documents, all bilingual**, effective 2026-08-18; the English privacy policy is 4,334 characters and names every sub-processor. `GO_LIVE_READINESS.md` **B7** verified the deployed page itself on 2026-09-03. |
| **AP7** | In-app account deletion (g) | ⚠️ in source, **never shipped** | `ProfileScreen.tsx` links one tap to `/account/delete`; `DeleteAccountScreen.tsx` + `accountDeletion.ts` are covered by `accountDeletion.test.ts`. **No production build contains it** — see AP12/**X2**. |
| **AP8** | Demo credentials (h) | ❌ **hard blocker** | `GO_LIVE_READINESS.md` **X1**. Sign-in is WhatsApp OTP to a Saudi mobile only, enforced twice (`SaudiPhoneInput` renders a fixed `+966`; `phone.ts` accepts `/^5\d{8}$/`). A reviewer cannot type their own number and cannot receive a code for a Saudi one. Everything past the login screen is unreviewable. |
| **AP9** | Marketing push opt-in (i) | ⚠️ accepted risk | `DEFAULT_DEVICE_PREFS` sets `promosEnabled: true`; the OS permission dialog is treated as the consent moment and the Profile toggle is the opt-out. Owner-accepted 2026-08-20 (CLAUDE.md §7). The revert if App Review rejects is one line. Recorded, not re-argued. |
| **AP10** | No IAP for physical goods (j) | ✅ live-verified | `app_settings.online_payment_enabled = false`, `cash_payment_enabled = true` (read 2026-09-05). Checkout therefore offers cash only, so no payment path is exercised and none is broken. Food is a physical good — IAP is not merely unnecessary, it is **prohibited** here. |
| **AP11** | Sign in with Apple (k) | ✅ exempt | The app uses only First Taste's own phone-OTP account system. 4.8 binds apps that use a *third-party* login service; there is none. Adding Google or Facebook sign-in later would create the obligation. |
| **AP12** | Complete and functional build (m) | ❌ **hard blocker** | `GO_LIVE_READINESS.md` **X2**: newest iOS production build is 1.0.0 (22), commit `6265781a`, ~54 commits stale — it predates delivery-to-POS go-live and does **not** contain the AP7 deletion entry point. **New this document:** `eas.json`'s production `env` block carries only Supabase and Sentry values — **neither `EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN` nor `EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` is there.** If neither exists as an EAS-hosted environment variable for the `production` environment, `isMapConfigured` is **false** in the shipped binary and the delivery-address map does not render. That is a guideline 2.1 rejection, found by a reviewer rather than by us. |
| **AP13** | Encryption declaration (l) | ✅ | `ios.config.usesNonExemptEncryption: false` in `app.json`. Transport security is at platform defaults with no ATS exception (`GO_LIVE_READINESS.md` **D7**). Re-answer if cryptography is ever added. |
| **AP14** | Permission purpose strings | ⚠️ | `NSLocationWhenInUseUsageDescription` is present, specific and honest: *"…only to center the delivery map on you. You can always move the pin manually."* It is the **only** usage description in `app.json`, which is correct — notifications need none, and nothing else is requested on iOS. But see GP9: Android asks for `ACCESS_FINE_LOCATION` while this string describes a coarse use. |

---

## 3. Evaluation — Google Play

| # | Requirement | Status | Evidence, 2026-09-05 |
| --- | --- | --- | --- |
| **GP1** | Target API 36 (n) | ⬜ | `app.json` sets no explicit target and there is no `expo-build-properties` plugin, so it inherits the Expo SDK 57 default, which should be API 36. The deadline has **already passed** for new apps, so this is now a submission gate rather than a countdown. Verify on the built `.aab`, not from config. |
| **GP2** | App Bundle (o) | ✅ | `eas.json` → `build.production.android.buildType: "app-bundle"`. The `preview` profile builds an APK, which is correct for internal distribution and must not be what is uploaded. |
| **GP3** | Closed test, 12 testers / 14 days (p) | ⬜ **not previously tracked — the longest schedule item on this page** | Applies to **personal** developer accounts created after 13 November 2023, and is waived for organisation accounts verified with a D-U-N-S number. Which one this is cannot be read from here. **If the account is personal, production access is at minimum 14 days away from the moment 12 real testers opt in** — and Google now checks that they genuinely used the app. This does not run in parallel with a fix; it runs in parallel with *everything*, so start it first. |
| **GP4** | Play Console record + submit path (n–z) | ❌ **hard blocker** | `GO_LIVE_READINESS.md` **X2**: every Android build ever made is a `preview` APK — **no production app-bundle has ever been produced** — and `eas.json`'s `submit.production` contains only `ios.ascAppId`. There is no `android` submit configuration, so no Play track and no service-account key. |
| **GP5** | Data safety form (q) | ⬜ | Draft in **§4**. Must agree with AP4 and with what the SDKs actually transmit, not only with code we wrote. |
| **GP6** | Privacy policy URL (r) | ✅ | Same URL as AP6. |
| **GP7** | Account deletion, in-app **and** web (s) | ⚠️ in-app · ✅ web | The web resource exists and is public: **`https://app.spicymeal.com.sa/legal/account-data-deletion`**. It describes both routes — Delete Account in the app, or a request to support from the registered number or email, with identity verification either way — and states what is deleted, what is retained for tax and accounting, and that it is irreversible. That satisfies the policy's web-resource limb. A web **form** would be more robust than a page pointing at an email address, but it is not required. The in-app half is AP7: written, unshipped. |
| **GP8** | Content rating, IARC (t) | ⬜ | Straightforward for a food-ordering app; must still be completed before publishing. |
| **GP9** | Target audience and content (u) | ⬜ | The live privacy policy says the app is **not intended for under-18s**. Declaring an adult-only audience keeps the app out of Families policy, which is the right outcome — but the declaration, the Apple age rating (AP2) and the policy text must all say the same thing. |
| **GP10** | Ads declaration (v) | ✅ answerable "no" | No advertising SDK is present. Dependencies are Expo modules, Supabase, Sentry and React Native only; no advertising identifier is read anywhere (`grep` for `NSUserTracking`/`AppTrackingTransparency`/`idfa` returns nothing in `apps/mobile`). |
| **GP11** | App access for reviewers (w) | ❌ **hard blocker** | The same defect as AP8. Play asks for credentials or step-by-step access instructions; there is currently no set of either that works. |
| **GP12** | Permissions — precise location (y) | ⚠️ | `app.json` requests `ACCESS_FINE_LOCATION` **and** `ACCESS_COARSE_LOCATION`. The app's own purpose string describes centring a map the user can drag, which argues for coarse. Either drop `ACCESS_FINE_LOCATION` — one line — or write the precise-location justification Play asks for. `GO_LIVE_READINESS.md` **C2**. |
| **GP13** | No background location (y) | ✅ | Neither `ACCESS_BACKGROUND_LOCATION` nor a location foreground service is declared. |
| **GP14** | `POST_NOTIFICATIONS` (y) | ✅ | Declared; requested at runtime through `pushRegistration.ts`. |
| **GP15** | Financial features / Health declarations (x) | ✅ answerable "none" | Cash on delivery is not a financial feature — no payments are processed in-app and online payment is off live. No health functionality. Both forms still have to be submitted. |
| **GP16** | Developer verification (z) | ⬜ | Account-level; needs the console. If organisation verification is being pursued to escape GP3, note it takes **2–4 weeks**. |
| **GP17** | Package identity | ⚠️ decide once | Android `sa.com.spicymeal.app` vs iOS `com.spicymeal.app`. Not a policy problem, but **neither is changeable after first publish**. Make it a deliberate choice now. |

---

## 4. Draft data declarations

Both stores ask the same question in two shapes. This mapping is derived from the
**live privacy policy** (read 2026-09-05) and the source tree, and is offered so
the two forms are filled from one consistent source. **It is a draft: verify what
Sentry, Expo push and the map provider actually transmit before submitting** —
third-party SDKs collect data nobody in this repository wrote code for.

| Data | Collected | Linked to user | Purpose | Apple label category | Play data-safety category |
| --- | --- | --- | --- | --- | --- |
| Name | Yes | Yes | App functionality | Contact Info → Name | Personal info → Name |
| Mobile number | Yes | Yes | App functionality, account | Contact Info → Phone Number | Personal info → Phone number |
| Email (optional) | Yes | Yes | Account, support | Contact Info → Email | Personal info → Email address |
| Delivery address | Yes | Yes | App functionality | Contact Info → Physical Address | Personal info → Address |
| Map pin / device location | Yes, only while choosing a delivery point, with permission | Yes | App functionality | Location → Precise Location | Location → Approximate **or** precise (must match GP12) |
| Order history, items, amounts, VAT | Yes | Yes | App functionality, legal records | Purchases → Purchase History | Financial info → Purchase history |
| Loyalty points | Yes | Yes | App functionality | Usage Data → Product Interaction | App activity → In-app actions |
| Push token, device type, language | Yes | Yes | App functionality, marketing (offers) | Identifiers → Device ID | Device or other IDs |
| OTP send/verify records | Yes | Yes | Security, fraud prevention | Contact Info (phone) | Personal info → Phone number |
| Crash and diagnostic data (Sentry) | Yes | Verify | App functionality, diagnostics | Diagnostics → Crash Data, Performance Data | App info and performance → Crash logs, Diagnostics |
| App version, device model, OS | Yes | Verify | Diagnostics | Diagnostics | App info and performance |

Answers common to both forms, from the live policy:

- **Sharing.** Data is shared with processors only — Supabase, Lazywait (POS),
  Meta/WhatsApp, Expo with APNs and FCM, Sentry, the map provider, the email
  provider. The policy states *"We do not sell your personal data, and we do not
  share it for third-party advertising."* Note Play's April 2025 clarification of
  what counts as "sharing" — processor transfers under contract are generally
  *collection*, not sharing; confirm each one against the current definition.
- **Encryption in transit:** yes (AP13, `GO_LIVE_READINESS.md` **D7**).
- **Deletion request:** yes, in-app and via the web resource (GP7).
- **Used for tracking (Apple):** no. No advertising identifier is read.

**One inconsistency to fix before either form is submitted.** The privacy policy
names **Mapbox** as the map provider. The mobile app chooses its provider at
build time — `EXPO_PUBLIC_MAP_PROVIDER`, defaulting to `mapbox`, with a Google
Maps path wired and ready (`src/lib/map.ts`, `LocationPickerMap.tsx`) — and
`app.json` additionally declares `LSApplicationQueriesSchemes: ["comgooglemaps"]`
so the app can hand off directions to Google Maps. Whichever provider the shipped
build actually uses, and the directions hand-off, must both be named in the
policy and in both forms. A declaration that does not match the binary is the
kind of error that costs an account flag, not just a rejection.

---

## 5. The action list

Ordered by *when you must start it*, not by size. Phase 0 items have lead times
measured in weeks and gate everything after them.

### Phase 0 — start today; these have external lead times

| # | Action | Owner | Why it is first |
| --- | --- | --- | --- |
| 1 | **Determine the Play developer account type.** Personal account created after 13 Nov 2023 → the 12-testers / 14-days closed test applies (GP3). Organisation with a verified D-U-N-S → exempt. | Owner | If personal, **nothing reaches Play production for at least 14 days after 12 testers opt in**. If you would rather escape it, D-U-N-S verification is 2–4 weeks — longer than the test. Decide now, either way. |
| 2 | **If the closed test applies, open it and recruit 12 testers** as soon as a `preview` build exists. It does not need the final build. | Owner | The clock is what is scarce, not the build. Google now checks testers genuinely used the app. |
| 3 | **Answer Apple's age-rating questionnaire** for app `6800210683`, including the September 2026 social-media declaration (AP2, AP3). | Owner | Unanswered, **App Store Connect blocks submission outright**. Minutes of work; total if skipped. |
| 4 | **Decide the reviewer sign-in mechanism** (AP8/GP11/**X1**). Options: a whitelisted test phone number with a fixed code; a Saudi number the owner controls whose WhatsApp code can be relayed in App Review notes; or a documented reviewer bypass. | Owner + engineering | Blocks *both* stores. Under an hour to implement once decided — but it is a security-surface change to the login path, so it needs review, not a hack. |
| 5 | **Verify the WhatsApp OTP credential has not lapsed** and run one real end-to-end login (**X7**). | Owner | If the Meta token has expired, no reviewer and no customer can sign in. Minutes to check. |
| 6 | **Resolve the two launch blockers that are not store rules but gate go-live**: PDPL cross-border transfer (**A1**) and no point-in-time recovery on the free Supabase plan (**E1**). | Owner + counsel | Not the stores' business, but they are the reason a green submission would still not be a launch. `GO_LIVE_READINESS.md` §A, §E. |

### Phase 1 — engineering, before any production build

| # | Action | Where | Note |
| --- | --- | --- | --- |
| 7 | **Confirm the map credential exists for the `production` EAS environment** — `EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN`, or `EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` with `EXPO_PUBLIC_MAP_PROVIDER=google`. | EAS environment variables | Absent from `eas.json`. If it is not in EAS either, the delivery map is dead in the shipped app: guideline 2.1, found by the reviewer. Check **before** building. |
| 8 | **Add `ios.privacyManifests`** to `app.json` declaring the app target's required-reason API use (UserDefaults `CA92.1` for AsyncStorage; file-timestamp APIs). | `apps/mobile/app.json` | AP5. Otherwise discovered as ITMS-91053 at upload. |
| 9 | **Decide `ACCESS_FINE_LOCATION`**: drop it, or write the precise-location justification. | `apps/mobile/app.json` | GP12. Dropping it is one line and matches the app's own purpose string. |
| 10 | **Settle the package identifiers** — `sa.com.spicymeal.app` vs `com.spicymeal.app`. | `apps/mobile/app.json` | GP17. Irreversible after first publish. |
| 11 | **Reconcile the map provider with the privacy policy** — name the provider the build actually uses, plus the Google Maps directions hand-off. | `legal_documents.privacy_policy` (admin console) | §4. Editing the document updates the public pages with no redeploy. |
| 12 | **Close the Expo SDK patch drift** — `npx expo install --check` reports 11 packages behind, including `expo-notifications`. Then a regression pass. | `apps/mobile` | Do it *before* the production builds, not after. |
| 13 | **Add the Android submit configuration** — `submit.production.android` with the Play service-account key and track. | `eas.json` | GP4. Needs the Play Console record to exist first. |

### Phase 2 — build and validate

| # | Action | Note |
| --- | --- | --- |
| 14 | **Produce one production build per platform** (**X2**). iOS is ~54 commits stale; Android has never had a production app-bundle. | This build is the first one containing the in-app deletion entry point (AP7). |
| 15 | **Verify on the artifact, not the config:** iOS built against the iOS 26 SDK (AP1); Android `targetSdkVersion` = 36 (GP1). | Both are floors that are already in force. |
| 16 | **Physical-device validation on both platforms** — `RELEASE_CHECKLIST.md` §1 and §7, including RTL Arabic. Never performed on either platform. | Confirm specifically: the map renders, deletion is reachable in one tap from Profile, and checkout completes as cash. |
| 17 | **Rehearse the order lifecycle past `received` end to end** (**X5**) — it has never executed in Production, and every transition pushes a live customer. | Its precondition (**X6**, the `ready` copy) is fixed and deployed. |

### Phase 3 — console forms and listing

| # | Action | Store |
| --- | --- | --- |
| 18 | **Privacy nutrition labels** from the §4 mapping, after verifying SDK behaviour. | Apple |
| 19 | **Data safety form** from the same mapping; declare deletion available and the web URL. | Play |
| 20 | **Content rating (IARC)** questionnaire. | Play |
| 21 | **Target audience and content** — adult audience, consistent with AP2 and the privacy policy. | Play |
| 22 | **Ads: none. Financial features: none. Health: none.** All three must be answered. | Play |
| 23 | **App access** — the Phase 0 item 4 credentials, with step-by-step instructions. | Play (and App Review notes for Apple) |
| 24 | **Store listing in English and Arabic**: name, subtitle, description, keywords, category (Food & Drink), screenshots at every required device size, support URL `https://app.spicymeal.com.sa/support`, privacy URL `https://app.spicymeal.com.sa/privacy`. | Both |
| 25 | **Account-deletion URL** — `https://app.spicymeal.com.sa/legal/account-data-deletion`. | Play data safety |
| 26 | **Export compliance**: no non-exempt encryption (AP13). | Apple |

**Nothing in Phase 3 exists yet.** The repository contains no screenshots, no
listing copy and no store metadata of any kind — this was checked, not assumed.
Budget real time for item 24 in two languages; it is the item most often
underestimated.

### Phase 4 — submit

| # | Action |
| --- | --- |
| 27 | Confirm `online_payment_enabled` is still `false` before submitting, so the reviewer sees a coherent cash-only checkout and no dead payment path (AP10). |
| 28 | Clear the live queue first: **62 stale test orders** and **4 stranded delivery orders** whose customers still see `received` (`GO_LIVE_READINESS.md`, *Should-fix*). Both are live writes and need owner approval. |
| 29 | Fill a name into the launch-week alert watch (`INCIDENT_RESPONSE.md` §1b) — nothing pages a human today (**X3**). |
| 30 | Submit iOS. Submit Android **only after** the GP3 closed test has cleared, if it applies. |

---

## 6. Rejection risk, ranked

1. **Reviewer cannot sign in** (AP8/GP11). Certain rejection on both stores. Everything past the login screen is unreviewable.
2. **Age-rating questionnaire unanswered** (AP2). Not a rejection — a *block*: the submission cannot be created.
3. **The map does not render in the shipped build** (AP12, item 7). Guideline 2.1. Silent until a reviewer taps "add address".
4. **Nutrition labels or data-safety answers that do not match the binary** (AP4/GP5). Rejection at best; an account-integrity flag at worst.
5. **Play closed-test gate not started** (GP3). Not a rejection — a 14-day wall discovered at the moment you try to promote to production.
6. **Marketing push opt-out under 4.5.4** (AP9). Owner-accepted, revert is one line.
7. **Precise location without justification** (GP12). Usually a data-safety follow-up question rather than a rejection.

---

## 7. What could not be determined from here

Everything marked ⬜ above, and specifically: the Play developer account type and
verification state (GP3, GP16); whether the Apple age-rating questionnaire has
been answered (AP2); which EAS environment variables exist for the `production`
environment (item 7); the App Store Connect and Play Console listing state; and
what the third-party SDKs actually transmit at runtime (§4). Check each
read-only, or record it as unknown. Do not fill a gap with a guess — CLAUDE.md's
closing rule.

## When to re-run this

Re-assess on any of: a new data category or permission, a payment provider
decision, a change to the push consent model, a new sub-processor, a new Expo SDK
major, or the next annual move of Apple's SDK floor and Play's target API level.

---

## Sources

Requirement research, 2026-09-05:

- [Apple — App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple — User Privacy and Data Use](https://developer.apple.com/app-store/user-privacy-and-data-use/)
- [Apple — Updated age ratings in App Store Connect](https://developer.apple.com/news/?id=ks775ehf)
- [Apple — App Store Review Guideline 5.1.1(v): account deletion (developer forums)](https://developer.apple.com/forums/thread/693997)
- [Google Play — Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878)
- [Google Play — App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Google Play — Understanding app account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Google Play — Provide information for the Data safety section](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Google Play — Prepare your app for review (App content)](https://support.google.com/googleplay/android-developer/answer/9859455)
- [Google Play — User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311)
- [Google Play — Developer Program Policy](https://support.google.com/googleplay/android-developer/answer/17517561)
