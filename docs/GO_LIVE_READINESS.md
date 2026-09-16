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
> **Re-verified in full on 2026-09-10** — seven dimensions against live
> Production, the deployed artifacts and the source, each then attacked by an
> adversarial reviewer. See **Second layer — 2026-09-10 re-verification** below.
> That pass corrected **A3, A5, A7, C1, C2, F3, F5 and G3 in place**, added
> **A9** and **B8**, refreshed every count, and found one structural fact this
> document had never carried: **there are two customer channels, and the web one
> is current** — so several rows marked "needs the X2 build" are in fact
> delivered on web today.
>
> **Re-verified in part on 2026-09-16, after the Play Console submission pass.**
> **B6** moved ⬜ → ✅ and **X1** was struck — the reviewer sign-in mechanism is now
> proven live, not merely decided. **C5**, **G3**, **G4** and **X2** were corrected in
> place, and **C8 was added**: a closed-testing gate that blocks Production and that
> this document, `OWNER_ACTIONS.md` §38 and `RELEASE_CHECKLIST.md` §8 had all been
> written without. Every Play Console answer now lives in
> [`PLAY_STORE_SUBMISSION.md`](PLAY_STORE_SUBMISSION.md), which owns them; the rows
> here point at it rather than restating it.
>
> **Everything not named in a dated layer is still a 2026-09-02 reading.**

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
| A3 | Lawful basis for each processing purpose | ⬜ legal · **one half now measured** | **Measured live 2026-09-10, and it is worse than "unknown": there is no consent record of any kind.** Every column in the `public` schema was searched for `%consent%`, `%accept%`, `%terms%`, `%agreed%`, `%opt_in%`, `%marketing%` — exactly **one** column matches in the entire database, `legal_documents.requires_acceptance`, and it is **false on all 9 rows**. No acceptance or consent table exists. Nothing records that any customer accepted any version of any policy. Marketing state lives only in `push_devices.promos_enabled`, a mutable boolean whose sole timestamp is `updated_at` — a preference, not a demonstrable consent tied to a document version. The legal call remains a human's. Consent is the PDPL default. Ordering, delivery, loyalty, marketing push and Sentry telemetry are distinct purposes and may not share one basis. |
| A4 | **Marketing consent** | ⚠️ | Push marketing is **opt-out**: `DEFAULT_DEVICE_PREFS` sets `promosEnabled: true`, so granting the OS notification prompt enrols the device in offers (CLAUDE.md §7, owner decision 2026-08-20). "Marketing communications without consent" is an enumerated PDPL violation. The same design is also the Apple 4.5.4 exposure in B2 — one decision, two regulators. |
| A5 | 72-hour breach notification path to SDAIA | ❌ **re-marked 2026-09-10** | Was ⬜ "needs a human to check". It was checked, and the control is **absent** rather than unverified: a case-insensitive grep of [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) for `sdaia`, `regulator`, `72[- ]hour` and `notif.*authority` returns **zero matches**, and repository-wide the only `docs/` file containing "SDAIA" is this one. No regulator named, no deadline stated, nobody designated to notify. **The cheapest legal item on this page** — a page of writing plus a named person, not code. Note the interaction with **X3**: with nothing paging a human, a breach would have to be noticed by the launch-week watcher poll before any 72-hour clock could start. |
| A6 | Data-subject rights: access, correction, deletion, **portability** | ⚠️ APPLIED 2026-09-09, needs only the X2 build | Deletion and correction existed; **access and portability had no implementation at all** — confirmed live before building (zero `public` functions matching `%export%`, `%portab%`, `%my_data%`). `20260912120000_export_my_data.sql` adds `export_my_data()`: **zero arguments by design**, subject is always `auth.uid()`, so it cannot be pointed at another customer. Returns account, addresses, orders with line items **and their selected add-ons**, the full loyalty ledger, the comp flag, and notification preferences; withholds the push **token** and all internal operational state. The test applied to every field: *every number in the export must be accountable from the export itself* — which is why add-ons and the comp flag are in, since both sit inside figures the customer would otherwise be unable to reconcile. Surfaced at Profile → Account & privacy → *Get a copy of my data*, shared through React Native's core `Share` so it needs no new native module. **KNOWN LIMIT:** the share text crosses Android's Binder buffer (~1 MB, shared), so an export above 256 KB refuses with a support message rather than failing silently — a guard, not a cure. The real fix is a file attachment via `expo-file-system` + `expo-sharing`, which is a native dependency and therefore rides the next build. **APPLIED to Production 2026-09-09 07:32:09 UTC** (live version `20260909073209`, ledger row 86) on explicit owner approval naming the target by version. Verified live rather than inferred from a clean apply — which matters here, because a `plpgsql` body is not name-resolved at creation and this one reads **65 distinct columns across seven tables**: all 65 are present in live `information_schema` (0 missing), and the function was then called as a real customer inside a read-only transaction — which resolves every name at execution and is the stronger check. (This entry first said "38 columns across six tables"; review corrected it on #350.) It returns the 7 intended keys and **1 order out of the 71 in the table**, that one the caller's own; the anonymous path raises `42501` rather than returning an empty document that would look like a successful export of nothing; `anon` cannot execute it and `compute_order_snapshot` is still reachable by neither role. **Only the X2 build now stands between this and ✅** — the screen is merged and wired, the RPC is live, and nothing in a customer's hands calls it yet. **Applied is not delivered.** |
| A7 | Privacy notice in Arabic and English, matching actual behaviour | ⚠️ **re-marked 2026-09-10** — the review happened; two residuals | Legal documents are served from `legal_documents` (`src/lib/legal.ts`). Whether the text is current, bilingual and accurate is a content review. **That content review HAS been done and this row did not know it:** [`LEGAL_DOCUMENTS_AUDIT.md`](LEGAL_DOCUMENTS_AUDIT.md) records all nine rows read end to end on 2026-09-08 — four corrected to v2.1, five verified accurate — and `offers_loyalty_terms` went to v2.2 on 2026-09-09. All nine carry non-empty `content_ar`. **Two residuals keep it off ✅:** the binding Arabic has never had a native read (`OWNER_ACTIONS.md` §29, §33a, §35), and **A9 below** — one live statement that the software does not match. |
| A8 | Processor agreements with sub-processors | ⬜ | Supabase, Meta (WhatsApp), Sentry, Vercel, Expo/EAS, Google Maps and Lazywait all receive or hold personal data. |

---

## B. Apple — App Store Review Guidelines

| # | Item | Status | Evidence / note |
| --- | --- | --- | --- |
| B1 | **5.1.1(v)** in-app account deletion, easy to find | ✅ **LIVE — confirmed in the shipped binary 2026-09-15** | This row was ✅ while its own evidence cell ended *"Confirm placement is prominent, not buried"* — a confirmation nobody had made. **X4 was the answer, and it was `buried`:** the only route was Profile → "Policies, privacy & contact" → a network-fetched list of nine legal documents → "Account & privacy" → "Delete account". Fixed in source: `ProfileScreen.tsx` now carries a `Delete account` row linking straight to `/account/delete`, one tap from Profile. The deletion flow itself (`DeleteAccountScreen.tsx`, covered by `accountDeletion.test.ts` and a scheduler runbook) was never the problem. **This cell said "Not ✅ live until the X2 build ships it" — the X2 build HAS shipped, and the row was not updated.** Settled on the artefact rather than on the merge: `grep -a` against `base/assets/index.android.bundle` in the production AAB (`v1.0.0`, versionCode 2, commit `f82cecbe`) finds `/account/delete`, `Delete account` and `Get a copy of my data` all present. It is in the binary that will be uploaded. |
| B2 | **4.5.4** marketing push requires explicit opt-in | ⚠️ | 4.5.4 requires consent *"via consent language displayed in your app's UI"* plus an in-app opt-out. Here the OS permission dialog is treated as the consent moment and the Profile toggle is the opt-out. This was raised with the owner on 2026-08-20 and **accepted**; CLAUDE.md §7 records that the revert is one line (`promosEnabled: false`) if App Review rejects on 4.5.4. Recorded here, not re-litigated. |
| B3 | Privacy nutrition labels declared and accurate | ⬜ | Must cover phone, name, precise/coarse location, addresses, order history, device token, and Sentry diagnostics. Wrong labels are a rejection and an account-flag risk. |
| B4 | Privacy manifest / required-reason APIs | ⬜ | Enforced for the binary and its SDKs. Verify Expo, Sentry and Maps SDKs ship manifests. |
| B5 | Encryption declaration | ✅ | `usesNonExemptEncryption: false` in `apps/mobile/app.json`. Confirm it stays true if cryptography is added. |
| B6 | Reviewer test account and instructions | ✅ **mechanism decided 2026-09-03, PROVEN LIVE 2026-09-16** | Login is **WhatsApp OTP to a Saudi mobile only** (`normalizeSaudiPhoneE164` — foreign numbers are rejected at the hook) and there is **no guest or browse-only mode**, so a reviewer outside KSA cannot get past the first screen on either store. **This row said "it is easy to overlook" for a week after the path was decided — the row itself is the thing that was overlooked.** The mechanism is a **Supabase Auth test-OTP number**, needing no code change: `OWNER_ACTIONS.md` §27 for the mechanism and the paste-ready review notes. **The assumption underneath it is no longer an assumption.** §27's "Auth skips delivery for a test number" was quoted from the **self-hosting** guide, and whether the hosted dashboard short-circuits a **custom Send SMS Hook** — which is what this project uses — was unestablished. It does: an auth user signed in on 2026-09-15 with **no `otp_send_reservations` row and no `whatsapp_message_logs` row**, while every number that went through the hook left both, paired within two seconds. Evidence and the masked correlation: [`PLAY_STORE_SUBMISSION.md`](PLAY_STORE_SUBMISSION.md) §4a. **Two things are Play-specific:** the field is **App content → App access → "All or some functionality is restricted"**, and **Play keeps the credentials and reuses them for every future review**, so `RELEASE_CHECKLIST.md` §11's removal step breaks the *next* Play review unless Play's copy is updated at the same time. |
| B7 | Public privacy policy and support URLs resolve without login | ✅ **VERIFIED LIVE 2026-09-15, after the deploy** | Was ❌ in substance: `vercel.json` rewrote **every** path to the admin shell, so `/privacy` returned 200 **while serving the admin console** — which is why nobody caught it. Fixed by #318 and **verified against the deployed site**, not just merged: `https://app.spicymeal.com.sa/privacy`, `/legal` and `/legal/privacy-policy` each return the 3,944-byte legal entry (`<title>Legal &amp; Policies — Spicy Meal</title>`), the shipped chunk targets the right project and contains no `innerHTML`, and the exact anonymous PostgREST request the page makes returns **all 9 active documents** including the 4,334-byte privacy policy. **REOPENED 2026-09-15: every check in this cell passed and the page still serves no policy text to a client that does not run JavaScript.** Strip `<script>` from the live response and **253 visible characters** remain — a notice reading *"These documents are loaded from our servers and need JavaScript enabled"* — in which the word "privacy" appears **zero** times. The row verified HTTP 200, 3,944 bytes and the `<title>` (all reproduced exactly on 2026-09-15) and then that the anonymous PostgREST read works; **nobody read the page the way Play's automated policy-URL fetch reads it**, and that fetch does not execute JavaScript. All of `/privacy`, `/terms`, `/support` and `/legal/account-data-deletion` rewrite to the same shell, so all four are affected. The fix is to server-render or pre-render the document text into `legal.html` at build time — the documents are already anonymously readable, so only *when* the text enters the page changes. Detail and the Play consequence: `docs/OWNER_ACTIONS.md` §38. **FIXED, and measured on a real build rather than reasoned about:** a Vite plugin (`src/legal/prerender.ts`, wired in `vite.config.ts`) fetches the active documents at build time and writes them into `legal.html` before any script runs. Built against Production, the same strip-`<script>` measurement goes **253 → 34,936 visible characters**, now containing "privacy", "personal data", "delete" and «الخصوصية». A browser never sees that block — CSS hides `#prerendered` by default and a `<noscript><style>` reveals it, so the live fetch still governs every real visitor and editing a document in the console still needs no redeploy. **That inversion is a correction, not the original design, and it is the sharpest lesson in this row.** The first version hid the block from an inline `<script>`; `vercel.json` serves `script-src 'self' https://maps.googleapis.com` on `/(.*)` with no nonce, hash or `'unsafe-inline'`, so that script would have been **blocked on every deployed legal route** — the class never set, the snapshot never hidden, and every visitor served the live policy with a **stale duplicate underneath it**. Worse than the defect being fixed, and invisible everywhere except production: `vite build`, `vite preview` and the test suite all serve no CSP. Review caught it on #381. `style-src` does carry `'unsafe-inline'`, so the `<noscript><style>` needs no script and no CSP change, and a text extractor never consults CSS. `prerender.test.ts` now asserts every `<script>` in `legal.html` carries a `src`, mutation-tested both ways. **It fails OPEN in every direction** — no credentials, unreachable database, non-200, empty result or missing markers each warn and emit exactly today's page; proven by building with the env vars unset. Escaping is the security-critical part, because the bodies are admin-authored: `src/legal/prerender.test.ts` covers it in 14 cases. **CLOSED on the deployed page, not on the merge.** Measured against `https://app.spicymeal.com.sa/privacy` after Vercel shipped `71306f1`: **3,944 → 55,243 bytes** and **245 → 36,775 visible characters** with `<script>` stripped, carrying "Privacy Policy", "personal data", "Account & Data Deletion", «الخصوصية» and the support address. `/terms`, `/support` and `/legal/account-data-deletion` return byte-identical figures. The live page carries **exactly one `<script>` and it has a `src`**, with the snapshot hidden by default and revealed inside `<noscript>` — checked against the CSP the server actually sends (`script-src 'self' https://maps.googleapis.com`, and `style-src` carrying `'unsafe-inline'`, read from the response headers rather than from `vercel.json`). **The gap between this row's previous ✅ and its real state was five days of a required store URL serving no policy**, so the standard it is now held to is the deployed response, never the merge. **The URL to paste into both store listings is `https://app.spicymeal.com.sa/privacy`**; support is `/support`, terms `/terms`. Editing a document in the admin console updates these pages with no redeploy. |

---

## C. Google Play

| # | Item | Status | Evidence / note |
| --- | --- | --- | --- |
| C1 | **Target API level** | ✅ **SETTLED 2026-09-15 on the production AAB** | **Read off the artefact that will be uploaded, not inferred from the checkout — which is what this row asked for.** The Android production bundle (`v1.0.0` versionCode 2, commit `f82cecbe`) was downloaded from EAS and its `base/manifest/AndroidManifest.xml` decoded from aapt2 protobuf. It declares **`targetSdkVersion 36`**, `minSdkVersion 24`, `compileSdkVersion 36` (`platformBuildVersionName 16`). **New apps and updates must target API 36 (Android 16) in 2026** — API 35 was the 2025 requirement and is now only the availability threshold for *existing* apps, so 36 is the requirement met exactly, not a cushion. **This sentence said "the floor is 35, so 36 clears it with a year in hand" until review caught it (#380), and the error is worth recording rather than overwriting: the row said the right thing before this edit** — *"New apps and updates must target API 36 (Android 16) in 2026; existing apps needed API 35 by 31 August 2026"* — and the rewrite replaced a correct researched statement with a wrong one. The bundle was compliant either way, which is exactly why it would have survived unnoticed until some later build targeted 35 and was approved against a baseline that had quietly moved. The 2026-09-14 build-artifact reading was therefore correct; it is now reproducible, because the bundle itself is the evidence. **Three release-safety attributes were read in the same pass and are recorded here rather than left to be re-asked:** no `android:debuggable` attribute is present; no `android:usesCleartextTraffic` attribute is present, so targetSdk 36's secure-by-default applies and D7 is confirmed on the shipping artefact rather than on source; and `android:allowBackup="false"`, so the session token cannot be pulled out of a cloud backup. ABIs: `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64`. Upload-key certificate SHA-256 `4D:64:34:E9:AE:F5:7E:74:3A:9A:AA:1F:20:83:D4:29:61:CB:0E:5D:88:77:59:B2:3E:08:0E:64:98:F1:9D:ED`, valid to 2053-12-08 — that is the **upload** key; Play App Signing will hold its own app-signing key. |
| C2 | **`ACCESS_FINE_LOCATION` justified** | ⚠️ decided 2026-09-08 — keep FINE | **This row's premise was wrong and is corrected here.** It reasoned from the iOS purpose string alone and concluded the app only needs COARSE. The code disagrees: `LocationPickerMap.tsx:226` requests `Location.Accuracy.High` — deliberately, with a cached-fix fast path and a timeout guard — in the delivery-pin picker, the one screen that decides where the food is taken. `Accuracy.High` requires FINE on Android. The other two call sites (`OrderTypeSelectScreen`, `CheckoutScreen`) use `Balanced` and would be fine on COARSE. So FINE is **used**, and the defect was the justification, not the permission: the purpose string said location was used *"only to center the delivery map"*, which undersells it to a reviewer. Rewritten to state precise delivery placement, while-in-use only, never background. **Play's data-safety form needs the same sentence** — that part is an owner action. **CORRECTED AGAIN 2026-09-10, because the first correction only landed in one place out of two.** The 2026-09-09 rewrite went into `app.json`'s base `Info.plist`. The app also ships `en` and `ar` locale files, which `@expo/config-plugins` turns into per-language `InfoPlist.strings` — **and iOS prefers those over the base plist**. Both still read *"only to center the delivery map on you"*, last touched 2026-08-13. So the corrected sentence was dead text for every customer, in both languages, and would have been read by App Review in its old form. `apps/mobile/locales/en.json` and `ar.json` now carry the precise-delivery-placement wording; the Arabic is engineering-drafted (`OWNER_ACTIONS.md` §35). **The generalisable lesson: a localised app has more than one copy of every purpose string, and the base plist is the one the customer never sees.** |
| C3 | No background location | ✅ | Neither `ACCESS_BACKGROUND_LOCATION` nor a location foreground service is declared. |
| C4 | `POST_NOTIFICATIONS` handled | ✅ | Declared; the runtime prompt is the consent moment (see A4/B2). |
| C5 | Data safety form matches reality | ⚠️ **derived from the schema and the code; answered in Console 2026-09-16** | Was ⬜ and content-free while the whole form had already been derived. **All thirteen data types, each traced to the schema line or code path it comes from, are in [`PLAY_STORE_SUBMISSION.md`](PLAY_STORE_SUBMISSION.md) §6** — this row deliberately does not restate them, because two copies of a form Play cross-checks is how one of them goes quietly wrong. Three answers are argued there rather than guessed: **Name is optional**, not required; **crash logs and diagnostics are REQUIRED**, because the customer gets no opt-out; and the push token carries an **Advertising or marketing** purpose, because promos are opt-out (CLAUDE.md §7). **The "Shared" column is deliberately unanswered** — four vendors receive customer data and each is plausibly a *processor*, which Play excludes from "sharing"; that classification is yours and, where a DPA is unclear, counsel's. Under-disclosing is the dangerous direction. Must agree with **B3** (Apple's labels, the same facts in a different form), and is **blocked by A9**: the form cannot be truthfully completed while the live privacy policy names Mapbox as the map sub-processor (`OWNER_ACTIONS.md` §34 — publish that correction *first*). |
| C6 | Package identity | ⚠️ | Android `sa.com.spicymeal.app` vs iOS `com.spicymeal.app`. Not a blocker; make it a deliberate choice before first publish, because neither is changeable afterwards. |
| C7 | **The merged permission surface is 32 entries, not 4** | ⚠️ **measured 2026-09-15; advisory, not blocking** | `app.json` declares four Android permissions (`INTERNET`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `POST_NOTIFICATIONS`). The **production AAB's merged manifest declares 32 `uses-permission` entries**, because library manifests merge in. This row exists so the store-listing permission list is not a surprise. **Attributed rather than guessed:** the 13 launcher badge-count permissions (`com.sec.…`, `com.htc.…`, `com.huawei.…`, `com.oppo.…`, `com.sonyericsson.…`, `com.sonymobile.…`, `com.anddoes.…`, `com.majeur.…`, `me.everything.badger.…`, `android.permission.READ_APP_BADGE`) come from `expo-notifications`, which pulls `me.leolin:ShortcutBadger:1.1.22@aar` (`apps/mobile/node_modules/expo-notifications/android/build.gradle:45`). `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, `VIBRATE` and the two `com.google.android.c2dm.permission` entries are the FCM/notification stack. `USE_BIOMETRIC`/`USE_FINGERPRINT` come from `androidx.biometric:biometric:1.1.0`, pulled by `expo-secure-store` (`apps/mobile/node_modules/expo-secure-store/android/build.gradle:18`) — it is the only dependency in the tree that requests it, and `expo-local-authentication` is not installed. **`SYSTEM_ALERT_WINDOW` is the one worth a second look:** it is present in the release bundle, and the only manifest in the checkout that declares it is React Native's **debug** source set (`node_modules/react-native/ReactAndroid/src/debug/AndroidManifest.xml`), so the attribution could not be closed from the tree — the release `react-android` AAR is resolved from Maven at EAS build time. It is **not** a Play blocker: "Display over other apps" needs no Permissions Declaration Form, and none of the permissions that do (SMS, Call Log, `MANAGE_EXTERNAL_STORAGE`, `QUERY_ALL_PACKAGES`, `REQUEST_INSTALL_PACKAGES`, `ACCESS_BACKGROUND_LOCATION`, `CAMERA`, `RECORD_AUDIO`, `READ_CONTACTS`) is present — each checked by name. `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` are present but capped with `maxSdkVersion` (32 on read), so they are inert on any modern device and trigger no declaration. |
| C8 | **Production is gated behind a closed test — the developer account is PERSONAL** | ❌ **added 2026-09-16; nothing in this repository carried it before** | A **personal** Play developer account cannot publish to Production on demand. It must first run a **closed** test with **12 testers opted in for 14 continuous days**, and then **apply for production access** — an application Google reviews (“usually seven days or less”), not a switch that flips. **Internal testing does not count toward it**, and internal testing is the only track this app has: Production, Open and Closed are all **Inactive**, Internal is **Active · Not reviewed** (Console state read 2026-09-16). **Three ways the clock silently resets:** 12 *invited* is not 12 *opted in*; a tester who leaves breaks the count; and the 14 days are continuous, not cumulative. **Accounts created before 13 November 2023 are exempt**, so check the creation date before planning around this. `OWNER_ACTIONS.md` §38 and `RELEASE_CHECKLIST.md` §8 were both written as though Production were reachable from a finished submission — a repo-wide search on 2026-09-16 for "closed test", "12 test", "14 days" and "production access" returned nothing relevant, so the assumption was never stated and therefore never checked. Detail: [`PLAY_STORE_SUBMISSION.md`](PLAY_STORE_SUBMISSION.md) §2. |

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
| F3 | Contrast and dark mode | ⚠️ **measured and partly fixed 2026-09-10** | **Dark mode had no contrast floor at all, and one real failure was found.** `contrastContract.test.ts` pinned only the LIGHT inks; the dark palette is hand-authored in `apps/mobile/src/theme/palette.ts` and nothing asserted it. Measuring all 75 dark pairings found `color.ember` failing WCAG AA as normal-size text — **and it fails in light too**: 4.08:1 at worst light, 3.15:1 dark, against the grounds text actually lands on. The one body-size site was `LoginScreen.policyLink`, the link to the terms and privacy documents. **Fixed** by adding an `emberText` ink (light `#AE0F20` 6.51:1, dark `#ED7480` 5.31:1) and pointing that link at it; `ember` stays as a fill and as large text, where it is legitimate. **The durable half is `apps/mobile/src/theme/darkContrastContract.test.ts`** — 28 assertions, mutation-tested, which give dark mode the floor it never had. Two things were checked and deliberately NOT changed: `heatOff` on `appSurface3` (2.02:1) is a placeholder icon where an image is missing — decorative, not a contrast obligation — and `disabledFg` (4.44:1) is exempt under WCAG 1.4.3. `design-system:check` still enforces token hygiene, not perceived contrast. §7 of the release checklist calls out "unreadable frozen-light colors" as a real past failure. |
| F4 | Screen-reader labels on primary flows | ⬜ | Menu → cart → checkout → confirmation, in both languages. |
| F5 | Tap-target sizes | ⚠️ **swept and partly fixed 2026-09-10** | Both platforms publish minimums (Apple 44pt, Android 48dp) and `tokens.hitTarget = 44` already encodes it. A sweep of every declared `minHeight`/`minWidth` in `apps/mobile/src` found four interactive controls below it on the primary flow. **Three are fixed** — `CartScreen` remove (34 → `hitTarget`), `SuggestionStrip` add (34 → `hitTarget`), `OrderTypeRow` (36 → `hitTarget`). **One was deliberately left**: `app/payment/checkout.tsx` close (36), because that file is inside the §6 payment freeze and a tap-target height is not worth touching a frozen path for — the screen is unreachable while online payment is off. Fix it with the first payment change that is approved. |

---

## G. Commercial readiness

| # | Item | Status | Evidence / note |
| --- | --- | --- | --- |
| G1 | **Payment provider** | ❌ for card payment · ✅ for a cash launch | No provider is selected and payment work is **frozen** (CLAUDE.md §6). Tap is provisional, Moyasar is complete but inert — its migration is deliberately unapplied. Live data agrees: of 65 orders, 63 are `payment_status = 'pending'` and the only 2 `paid` are comped zero-total. **A cash-only launch is coherent today; an online-payment launch is not.** |
| G2 | Refunds | ❌ if taking payment | Automated refund processing is intentionally disabled under the freeze. |
| G3 | Menu content ready | ⚠️ **re-measured 2026-09-10** | 55 active products; **4** carry an image — **re-read live 2026-09-16, up from 1**, and the timing is the evidence: `max(products.updated_at)` is `2026-09-16 04:52:07 UTC`, the same minute the owner's screenshot captures are stamped, so three images went up immediately before the captures were taken. **The point survives the correction — 51 of 55 active products still have none**, and the four sit at the top of the `وجبات` category, which is what the menu screenshot shows and not what a customer scrolling the rest of the menu sees. **The row understated it: 40 of the 55 have no description in EITHER language**, not just no English. So three quarters of the menu is a name and a price. Decide whether that is the launch you want; it is days-to-weeks of photography and bilingual copy, and it is the single largest determinant of how the app LOOKS on day one. |
| G4 | Store listing assets | ⚠️ **three of seven done (2026-09-16)** — was ⬜, which contradicted this row’s own body | Measured rather than listed: an exhaustive image inventory of the tree on 2026-09-15 returned 11 files and **none** was a store asset. **DONE — the 512×512 Play icon.** Play takes an upload rather than reading the AAB, and every icon here was 1024×1024 (the largest inside the bundle is a 432×432 adaptive foreground), so the listing could not be saved. `scripts/build-play-icon.mjs` now generates `assets/store/play-icon-512.png` from the same master, and `npm run play-icon:check` guards it in CI beside `logo:check`. **DONE — five phone screenshots**, `assets/store/screenshots/phone-1..5-*.png`, composed from the owner's own device captures of the live app. The captures are 736×1600 — ratio 0.460, **narrower than 9:16's 0.5625** — so Play rejects the shape before anyone looks at the content; `scripts/build-play-screenshots.mjs` crops the iOS status bar (measured at source rows 42-66 in all five) and places the remainder on a 1080×1920 canvas, and `npm run play-screenshots:check` asserts that contract in CI. **The mark was wrong, not the body.** ⬜ means "cannot be determined from the repository"; both completed items are *in* the repository and CI-checked. **DRAFTED, NOT ENTERED — short and full descriptions in both languages**, `docs/store/LISTING_COPY.md`, with a claims table recording which live behaviour each sentence depends on. **A SEVENTH ITEM THIS ROW NEVER CARRIED: Play’s "App name" field.** It is a Console field of its own, independent of `app.json` and of anything in the AAB, it is what a customer sees in search results, and the Console holds a **temporary name** today. **DONE — the 1024×500 feature graphic**, `assets/store/play-feature-graphic-1024x500.png`, generated from the same brand master by `scripts/build-play-feature-graphic.mjs` and guarded by `npm run play-feature-graphic:check`. **All three committed assets now carry the colour type Play asks for, and that is not one rule but three:** a *32-bit PNG with alpha* for the icon, and *JPEG or 24-bit PNG with no alpha* for the feature graphic and every screenshot — so an asset that is merely fully opaque still declares a channel Play refuses. Codex caught it on the feature graphic (#383) and the same defect was in the screenshots. **Still missing: the app category** (Food & Drink, Console-only) and the **final app name**. **Do not reuse existing copy for the descriptions:** `metadata.json` describes the monorepo and `index.html`'s title advertises the POS, neither of which a customer sees; and the marketing site claims **16 branches** where Production has **1 active**. Contact details are ready — `info@spicymeal.com.sa` / `+966920031495`, live in `app_settings`. |
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

X7 was added after the first pass, when the audit's final round landed. It was the
most time-sensitive item on this page **until 2026-09-07, when the credential was
read directly from Meta and found to be permanent** — see its row. What survives of
it is a test that has not been run, not a clock that is running out.

| # | Item | Evidence | Action |
| --- | --- | --- | --- |
| **X1** | ~~**A store reviewer cannot sign in.**~~ — **MECHANISM PROVEN LIVE 2026-09-16**, see the action cell and `PLAY_STORE_SUBMISSION.md` §4a. The finding, kept because the reasoning is the point: Authentication is WhatsApp OTP to a **Saudi mobile only**, enforced twice: `SaudiPhoneInput` renders a fixed `+966` and sanitises input to a 9-digit `5XXXXXXXX`, and `phone.ts` accepts only `/^5\d{8}$/`, so `sendCode` refuses and the button is `disabled={!isSaudiMobile(national)}`. A reviewer in Cupertino cannot type their own number, and cannot receive a WhatsApp code for a Saudi one. | source-verified | **MECHANISM DECIDED 2026-09-03 — a Supabase Auth test-OTP number** (`OWNER_ACTIONS.md` §27), which needs **no code change**: Auth skips delivery for a test number and accepts only the mapped code, so the WhatsApp hook is never invoked, no Meta template is billed and no `otp_send_reservations` budget is consumed. A test number in `5XXXXXXXX` form already passes `isSaudiMobile`, and `phone.ts` deliberately does not narrow to operator prefixes (pinned by `phone.test.ts`, which canonicalises on a `51` number). `handle_new_user` creates the profile, so the reviewer lands on a normal account. **Open: one Auth configuration action (§5) — map a DEDICATED, VERIFIED-UNUSED number to a fixed code (`select count(*) from auth.users where phone = …` must return 0; 4 of 9 auth users already carry phones, so this is a live risk — an enrolled number signs the reviewer into that customer's orders and addresses), test the pair before submitting, then REMOVE the entry once review concludes and verify it no longer signs in.** The row previously said to set an expiry; there is no per-entry expiry on hosted test-phone entries (that is a self-hosting env var), so removal is the control and `RELEASE_CHECKLIST.md` §11 carries it as a checkbox. §27 carries the paste-ready App Store Connect notes. Minutes, not hours. |
| **X2** | **No *current* production build exists for the code that would ship — HALF REFUTED 2026-09-16, and the refuted half is Android.** The original reading stands for iOS: the newest **iOS** production build is 1.0.0 (22), commit `6265781a`, 2026-08-26 — **~54 commits stale**, predating the delivery-to-POS go-live. **Both Android clauses are now false and are retracted here rather than left standing.** An Android production app bundle **exists** — `v1.0.0`, versionCode 2, commit `f82cecbe`, `targetSdkVersion 36` — and has been **uploaded to Play's internal-testing track**, which is Active. And `apps/mobile/eas.json` **does** carry `submit.production.android`; what it lacks is a service-account key, which is a **credential, not a missing track** — a distinction this row collapsed. **The bundle is also still functionally current:** `git diff --name-only f82cecbe HEAD -- apps/mobile/` returns nothing, so every mobile change on the default branch is in it. What survives is iOS, and it survives whole. | live-verified via authenticated EAS CLI (2026-09-03); the Android half re-read off the AAB's own manifest (C1) and the Play Console on 2026-09-15/16, and retracted here | **iOS:** one current production build, then the §1 physical-device gate. **Android:** the record, the bundle and the internal track all exist — what is open is **C8**'s closed-testing gate (calendar time), the remaining listing items (**G4**), and step 5 of `OWNER_ACTIONS.md` §38. The Android half is no longer measured in build time. |
| **X3** | **Nothing pages a human, and that is structural rather than a switched-off toggle.** The alert engine works and has proved it — `operations_alert_outbox` holds **136 rows** as of the 2026-09-07 read (**112** when this row was first written on 2026-09-03), including a critical `order_integrity:stranded_orders`, and **every one** is `('in_app','recorded')`. None has ever left the database. If the POS fails during Friday dinner, no person is told. | live-verified | **STOPGAP WRITTEN DOWN 2026-09-03 — `INCIDENT_RESPONSE.md` §1b**: a named watcher (primary + backup, owner fills the table), three fixed checks per service day anchored to the service rather than the clock, what to open, and an `open`-vs-`recovered` rule so a watcher chases state rather than rows. It records the **measured baseline** — all six alert states are currently `recovered`, the only recurring signal is `lazywait:sync_degraded` opening and clearing within the evaluator's own 5-minute interval, and the sole critical incident (2026-08-10, stranded orders + platform health) recovered in two hours — so a watcher can tell normal from not. It is honest that it is a **poll, not a page**: nothing covers the gap between checks or out of hours. **Real dispatch is APPLIED AND DEPLOYED as of 2026-09-07, and still inert** — migration `20260903120000` plus the `operations-alert-dispatch` function (version 1, deployed 07:18:43 UTC), over the already-configured SMTP credential (`OWNER_ACTIONS.md` §28). It removes, for the **email channel only**, the three interlocks v1 used to make external delivery impossible; `whatsapp` and `push` stay structurally blocked. Applying changes no behaviour — the flag stays false and the migration self-verifies that. Recipients derive from admin profiles, so no address is stored. Severity floor defaults to `critical`, which is measured rather than guessed: mailing warnings would have sent eight emails for the four `lazywait:sync_degraded` non-events on record. **The invocation path exists as of `20260903130000`** — `pg_cron` calls `invoke_operations_alert_dispatch()` every five minutes, matching the evaluator's cadence, with the trigger secret held in Vault and never transmitted — the driver sends a nonce, a timestamp and an HMAC over them, and Postgres recomputes it, so the function cannot read, log or leak the value it authenticates against. The first scheduler put the plaintext in a header while claiming the opposite; review caught that on #329. This row previously claimed enabling the flag sent mail; **it did not — nothing called the function at all**, which review caught on #328. **Four owner steps close X3, and steps 1 and 2 are DONE. Step 1:** `…120000` applied 2026-09-07 06:46:38 UTC (live version `20260907064638`, ledger row 79) on approval naming the target by version; it changed no behaviour — flag still false, outbox still 136 rows with zero on the `email` channel, money-path hashes identical, Moyasar re-verified absent. **Step 2:** `operations-alert-dispatch` deployed as version 1 at 07:18:43 UTC on its own approval, `verify_jwt = false`, and probed inert rather than assumed to be — `GET` 405, unauthenticated `POST` 401, and a scheduler-header `POST` **fails closed at 500**, because the signature RPC ships in the still-unapplied `…130000`. That is why the deploy goes first: applying the scheduler first would point a five-minute cron job at a function that does not exist. **Step 3:** the two Vault secrets created 08:21:35 / 08:21:44 UTC and `…130000` applied 08:23:17 UTC (live version `20260907082317`, ledger row 80) — the `pg_cron` job now exists on `*/5 * * * *` and ticks harmlessly, proven behaviourally: `invoke_operations_alert_dispatch()` returns `null`, the early-return branch before any Vault read or HTTP request. The trigger secret was generated **inside Postgres** and never crossed the wire, so nobody has ever seen it; it was verified by length (64 hex) rather than by reading. **ONE remains: enable the flag — the only step that actually sends mail.** It is done in the admin console (Alerts → Settings → "External dispatch (email)"), signed in as an admin **with two-factor completed**, since the RPC requires AAL2. **Corrected 2026-09-13: that RPC has no service-role side door, but the underlying table does** — `operations_alert_settings` has RLS with zero policies, so `service_role` (which bypasses RLS) can write the flag directly. The console is the route by rule and attribution, not by impossibility; see `CLAUDE.md` §8. That control was **disabled** until 2026-09-07 under a caption claiming no dispatcher existed — true of v1, false once the dispatcher shipped — with a test pinning the disabled state, so the limitation had become self-enforcing; review caught it on #332 and it was fixed separately. Until it happens, §1b's named watcher IS the answer — and stays worth keeping afterwards, for the case where the dispatcher is itself what breaks. |
| **X4** | ~~In-app account deletion is buried three levels deep.~~ **FIXED IN SOURCE 2026-09-03.** A `MenuRow` on `ProfileScreen` links straight to `/account/delete`, gated on `status === 'signed_in'` — and **so is the Addresses row beside it, as of 2026-09-03** — one rule for both rows on the screen. That row guarded on `profile`, which was never a data dependency: `addressCount` comes from `useAddressBook()`, and `AddressProvider.tsx:58` loads the book from `status` and `userId` alone, never `profile`. It therefore hid **address management** from a signed-in customer whose profile row is null — the same defect as the deletion one, surfaced by review on #323 and fixed rather than left standing. Both destinations are `AuthGate`-wrapped and `AuthGate` gates on `status`, so guard and route now agree. **CORRECTED 2026-09-03: this cell said "guarded on `profile` to match the Addresses row" until now. That was the pre-review design and it is the opposite of what shipped** — review caught it on #321, because gating on `profile` would hide deletion from a signed-in user, the exact failure this row exists to fix. `signed_in` with `profile === null` is reachable three ways in `AuthProvider.tsx` (an authoritative null from `fetch_success`, the synchronous `signed_in` in `onChange` before the deferred fetch resolves, and retry exhaustion), and `/account/delete` is valid for that auth account in all three. Signed-out visitors never reach the tab at all: `apps/mobile/src/app/(tabs)/_layout.tsx:39` redirects them to login. Reuses the existing `delAccount` string, already present in both languages, so `strings.ts` is untouched. | **binary-verified 2026-09-15** | **SHIPPED.** This cell said "Rides the X2 build — inert until then"; that build exists and carries it — `/account/delete` and `Delete account` are both present in the production AAB's JS bundle. No test asserts it: all 62 mobile test files are `.test.ts`, there are no RN render tests, and `vitest.config.ts` forbids mobile tests importing React Native or Expo. Stated rather than papered over. |
| **X5** | **The order lifecycle past `received` has never executed in Production, and every transition pushes a live customer notification.** All 68 orders are `received` (62) or `cancelled` (6). Zero `direction='webhook'` rows from the POS: the status callback has **never fired**. A real customer today gets `pos_confirmed` and then hears nothing, ever. | live-verified | Investigate before coding: confirm with Lazywait whether the callback is registered at all. If it is not, the admin console's manual status path *is* the launch mechanism and must be rehearsed end to end on one order. |
| **X6** | ~~The `ready` push tells delivery customers to come and collect.~~ **FIXED AND LIVE 2026-09-03.** `order_type` now rides the order row `push-dispatch` already reads, and `ready` — the only status whose meaning differs by fulfilment — branches on it. Pickup copy is byte-identical; delivery gets *"ready and will be on its way shortly"*, which promises no time and does not pre-empt `out_for_delivery`. Pinned by `pushReadyCopyWiring.test.ts`, mutation-tested against four regressions. | **live-verified** | **DONE — deployed 2026-09-03 as `push-dispatch` v6**, `verify_jwt` preserved at `false`. All five bundle files were read back and hashed against the merged branch: byte-identical. The function boots and the JWT gate is still off (`GET` → 405 from the handler, not a platform 401), proven without sending a push. Sequenced **before** X5 deliberately, so the rehearsal now sends the corrected copy. Residual: the delivery **Arabic is engineering-drafted and has not had a native read** — live on an engineer's draft, ten minutes to close (`OWNER_ACTIONS.md` §26). |
| **X7** | ~~The only customer login channel is unexercised, fallback-free and may expire inside launch week.~~ **THE EXPIRY FEAR IS REFUTED, MEASURED 2026-09-07 (UTC). The credential does not expire.** Meta's own `debug_token` reports `type: SYSTEM_USER`, `is_valid: true`, `expires_at: 0` and `data_access_expires_at: 0` — a System User token, permanent by construction — on app `SpicyMealWA`, carrying `whatsapp_business_messaging` and `whatsapp_business_management`. Both login templates are live: `spicymeal_otp_en` and `spicymeal_otp_ar`, **APPROVED**, category `AUTHENTICATION` (2 templates on the account, **0 not approved**). The sending number — `1165712249955347`, which **is** the configured `phone_number_id` rather than a sibling — is `status: CONNECTED`, `account_mode: LIVE`, `quality_rating: GREEN`, `name_status: APPROVED`, PIN enabled. **`code_verification_status: EXPIRED` is benign and was checked rather than assumed**: it describes the onboarding verification code, not live registration, and `CONNECTED`/`LIVE` is the field that governs whether a send succeeds. **What remains is the smaller half, and it is still true:** the channel is **unexercised** — the last `auth_login` OTP was **2026-08-21**, `otp_send_reservations` is empty, so **no real login has ever run through `auth-send-sms-whatsapp` v2** (deployed 2026-09-02) — and **fallback-free**: `otp_channel_default='whatsapp'`, `sms_otp_fallback_enabled=false`, SMS provider row `sandbox`/disabled. | **live-verified against Meta, no longer an inference.** The previous cell said so explicitly: *"the expiry is an inference, not a reading"*. It has now been read. **Method matters here** — the token was interpolated into the request **inside Postgres** via `pg_net`, so it never entered a tool call, a shell command, a transcript or the repository; `debug_token` is read-only, sends no message and consumes no messaging quota. Afterwards, `net._http_response` and the pg_net queue were searched **by predicate** for the token: **0 rows retain it.** | **The Business Manager check is DONE and needs nothing from the owner.** What is left is **one real end-to-end login before launch** — sign in on a real handset with a real Saudi number and confirm the code arrives, which also becomes the first exercise of `auth-send-sms-whatsapp` v2 and its rate limiter. This is now a *test*, not an *investigation*: the infrastructure behind it is proven healthy. Consider it alongside X1's Auth test-OTP entry, which deliberately bypasses this path and so does **not** substitute for it. |

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
| ~~**Expo SDK patch drift**~~ **CLOSED 2026-09-14, immediately before the X2 builds.** It had returned since the 2026-09-10 pass: `npx expo install --check` reported **14 packages** behind the SDK 57 pinned set, `expo` `57.0.21 → 57.0.22` and `expo-notifications` `57.0.17 → 57.0.18` among them — the latter mattering because push is a live customer channel (§7). `npx expo install --fix` bumped all of them (patch-level only, no minor or major moved), and `--check` now reports **Dependencies are up to date**. | re-verified 2026-09-14 | Regression pass run before the builds, not after: mobile typecheck, web typecheck, **3 015** vitest tests, design-system, logo, docs and both dependency-audit gates all green. **THE DRIFT RECURS** — it was recorded closed on 2026-09-10 and was back within four days, because Expo ships SDK patches continuously. Re-run `npx expo install --check` immediately before every production build rather than trusting this row. |
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

## Second layer — 2026-09-10 re-verification

**What this is.** Every row above was re-checked against live Production, the
deployed artifacts and the source tree on 2026-09-10, seven dimensions at a
time, each then attacked by an adversarial reviewer told to refute it. Rows the
check found wrong were corrected **in place** above and say so. This layer
carries what is genuinely new, and the counts, which had all moved.

### The structural finding: there are TWO customer channels, not one

**This document has never carried it, and it changes what "undelivered" means.**
`docs/DEPLOY.md` designates `/app/` as the customer web application, and that
Vercel deployment is **newer than the iOS binary and fully current**. Verified
2026-09-10: `https://app.spicymeal.com.sa/app` returns 200 and serves the
customer app — an Expo web export, entry bundle 4 429 268 bytes — which contains
`export_my_data`, `preview_loyalty_points`, the *Get a copy of my data* label and
the `/account/delete` route.

So every feature this page describes as "merged but needing the X2 build" **is
reachable today on web**. That does not retire X2 — the native app is what a
store reviewer opens and what most customers will use — but it does mean:

- **A6 is delivered on web** and undelivered on native. The PDPL access and
  portability right has a working customer route today.
- **B1's deletion row** likewise: `/account/delete` is live on web.
- "Applied is not delivered" was the right instinct and the wrong conclusion.
  **Ask which channel**, every time.

Nothing else on this page reasons about the web channel either. It has no store
review, no binary, and no release gate of its own — which is convenient now and
is itself an unexamined surface.

### New rows

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| **A9** | **The privacy policy names the wrong map sub-processor** | ⚠️ **CORRECTED IN THE DATABASE 2026-09-16; the public page is STALE until a rebuild** | `privacy_policy` v2.1 says `Mapbox — the map you use to choose a delivery location` in **both languages**. The shipped web bundle carries a Google Maps key (`AIza` present) and **no Mapbox token** (`pk.` absent, 0 occurrences), and `googleMaps.ts` uses Google **Places** for address search. A named processor receives nothing while an unnamed one receives the customer's **delivery coordinates** — wrong in both directions, in the document destined for both store listings. Replacement text, evidence and its limits: [`legal/PRIVACY_POLICY_MAP_PROCESSOR_CORRECTION.md`](legal/PRIVACY_POLICY_MAP_PROCESSOR_CORRECTION.md); owner action `OWNER_ACTIONS.md` §34. **That variable was read, and the row that said it could not be is corrected.** `eas env:list --environment production` gives `EXPO_PUBLIC_MAP_PROVIDER=google`, with **zero Mapbox variables** in that environment — so the Mapbox branch has no token and could not work even if selected. Native and web agree, which settled §34 on **Option A (Google only)**. **`privacy_policy` v2.2 was published 2026-09-16**, both languages, one line changed and every other byte verified identical.

**IT IS NOT ✅, AND THE REASON IS THE MOST USEFUL THING ON THIS ROW.** The database is correct and so is every JavaScript-enabled reader — the app, and the web page in a browser. **The no-JavaScript snapshot still says Mapbox and still says v2.1**, because B7's prerender plugin runs with `apply: 'build'` and bakes the documents into `legal.html` during `vite build`. Verified on the deployed page after publication: still `v2.1 · 2026-09-08`, still `Mapbox — the map you use to choose a delivery location.`, byte-identical response size.

**Play's policy checker is exactly a no-JavaScript reader**, so from Google's point of view nothing changed. A Vercel production rebuild closes this and is an owner action (§13). **Generalise it: editing a `legal_documents` row does not reach a no-JavaScript client until the site is rebuilt.** B7 fixed "no content without JavaScript" and, unremarked until now, replaced it with "content without JavaScript is frozen at the last deploy". |
| **B8** | **The iOS binary declared three purpose strings for capabilities the app never uses** — ✅ fixed 2026-09-10 | `expo-location`'s config plugin is auto-applied and injected `NSLocationAlwaysAndWhenInUseUsageDescription`, `NSLocationAlwaysUsageDescription` and `NSMotionUsageDescription`, all generic `Allow $(PRODUCT_NAME) to…` placeholders. An Always-location and a Motion declaration invite an App Review question with no good answer, since neither capability is used. Fixed by declaring the plugin explicitly with `false` for those three, which makes `applyPermissions` delete them. **Verified from the resolved config, not from source**: `expo config --type introspect` now yields exactly **one** usage description — the corrected when-in-use string — and no `UIBackgroundModes`. |

### The adversarial pass found one more cash blocker, and it is the sharpest thing on this page

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| **G8** | ~~Two live, uncapped, never-expiring promo codes are redeemable from checkout today~~ — **RESOLVED 2026-09-10: both deactivated** | ✅ | On explicit owner approval, both rows were set `is_active = false` — **deactivated, not deleted**, so the decision is reversible. **Proven rather than assumed:** `validate_coupon` is `STABLE`, so it was called read-only against each code afterwards and both return `valid = false`, discount **0**, reason *"Coupon is inactive"*. The gate was also confirmed **before** the write — one overload, body carrying `if not c.is_active then` — because setting a flag nothing reads would have been theatre. Nothing else moved: 2 rows before and after, `usage_count` still **0**, **72** orders unchanged with **0** carrying a discount, money-path pair identical. **A data change, not schema** — no migration, and `validate_coupon` itself is unchanged. **The codes were guessable brand-and-number strings**, seeded 2026-07-08 and never redeemed; an unbounded discount is bad, an unbounded *guessable* one is worse. **And the screen that was missing now exists** — Finance → Promo Codes, added the same day — so re-enabling or bounding a code is no longer a database write. It renders each way a code is unbounded, prices a draft before it is saved, refuses to delete a redeemed code, and holds a percentage to 0-100, which the column does not. Record: `OWNER_ACTIONS.md` §36; behaviour: `DISCOUNTS_CAMPAIGNS.md`. |

**Why this was missed until the adversarial pass.** G6 asked whether campaigns
were reachable and answered *no* — correctly, about the `campaigns` table. It
then found `loyalty_multipliers` and answered *no* about that too. Neither is the
table wired into the money path. **`coupons` is a third table**, it is live, and
`validate_coupon` is called from checkout. The lesson generalises: *checking two
tables and finding both inert is not evidence about a third.*

### Four smaller findings from the same pass, recorded rather than actioned

| # | Item | Note |
| --- | --- | --- |
| **D8** | ~~An ACTIVE Production Edge Function has no source in this repository.~~ **WITHDRAWN 2026-09-10 — this was already answered, and the answer was a deliberate decision.** The facts are right (`latency-probe` v2, `ACTIVE`, `verify_jwt: true`, no `supabase/functions/latency-probe/`), but the conclusion was wrong. **`OWNER_ACTIONS.md` §23 is a CLOSED owner decision to KEEP it**, taken 2026-09-03 on live evidence: the deployed body is a single `Deno.serve` returning **HTTP 410 with a fixed JSON string — no database call, no secret, no outbound request**; **0 invocations** across three consecutive 24-hour windows; no cron job or `pg_proc` body names it. The original delete argument rested on a security surface that the 410 stub removed and on legibility, which writing §23 answered. Re-confirmed today: **0 cron jobs and 0 database functions reference it**, and the only repository mentions are §23 and this page. The 23-deployed-vs-22-in-repo drift is documented there as expected, not as a fault. **Nothing is outstanding.** |
| **D10** | **The live admin console already offers Moyasar as a selectable payment provider, with a full credential form.** Read from the deployed bundle: the lazily-loaded `AdminDashboard` chunk ships `providerOptions:["tap","moyasar"]`. Selecting it would be inert today — the Moyasar migration is unapplied and no Moyasar function is deployed — but §6 says choosing the provider is a deliberate owner action, and the console currently presents it as a dropdown. A guard belongs here, not a redesign. |
| **X3c / X3e** | Two facts that change what enabling alert dispatch will actually do. **There is exactly one recipient**: `operations_alerts_dispatch_recipients()` selects `profiles.email where role = 'admin'`, live count **1**, and `operations_alert_settings` has no recipients column at all — so **E2 and X3 are the same single point of failure**, and the one admin who must enable alerting is also the only one who would receive it. And **enabling the flag does not backfill**: all 160-odd queued rows are `channel='in_app'`, and producers only write email rows while the flag is already true, so the backlog will never be mailed. Turning it on is the **first live test** of the chain, not the last step. |
| **X5h** | **The zero-risk rehearsal tool already exists and has never been used.** The deployed `push-dispatch` v6 carries a `test` action behind the same admin+AAL2 gate as broadcast, but targeting **only the calling admin's own devices**. `notification_log where kind='test'` is **0 rows, ever**. Anyone planning the X5 lifecycle rehearsal or the X7 login test should start here — it exercises the push path with a blast radius of one device. |

### The counts had all moved

| Figure | This page said | Live 2026-09-10 |
| --- | --- | --- |
| Orders | 68 | **72** — and one was placed 2026-09-09 |
| Still at `received` | 62 | **66** |
| Ever past `received` | 0 | **0** — X5 is unchanged and that is the point |
| Stale queue to cancel | 62 | **66** — it grew |
| Alerts ever raised | 112, then 136 | **160**, still **0** that have ever left the database |
| Branch near-duplicate groups | 3 | **15** |
| Active products without a description | "40 have no English" | **40 have neither language** |
| Repository migrations / live rows | — | **128 / 133**, one unapplied (Moyasar, frozen) |

### X3 is one step from done, and it is the cheapest blocker left

Three of the four dispatch steps are complete: the base migration applied
2026-09-07, `operations-alert-dispatch` deployed the same day, and the scheduler
applied with its two Vault secrets. **Only `external_dispatch_enabled` remains**
— Alerts → Settings, an admin at **AAL2**. **Corrected 2026-09-13: this read "No
agent can flip it", and that was false.** The RPC is gated on `is_admin()` and
genuinely does refuse a service-role caller — but `operations_alert_settings`
carries RLS with **zero policies**, which leaves the table to `service_role`, and
service role bypasses RLS. A service-key holder can set the flag with a direct
`UPDATE`. The AAL2 requirement is a property of the console path, not of the
setting. `CLAUDE.md` §8 carries the measurement and the standing rule that an
agent does not take the other route; the reason to click it yourself is
attribution, not impossibility.
Until it is on, all 160 alerts stop inside the database and
`INCIDENT_RESPONSE.md` §1b's named watcher — **whose table is still unfilled**
(see **E5**) — is the only thing standing between a Friday-night failure and
nobody knowing.

### Fixed in source on 2026-09-10, all riding the X2 build

Recorded here so the build is known to carry them: **C2** (the location purpose
string, in the locale files that iOS actually reads), **B8** (the three
placeholder purpose strings), **F3** (the AA-failing policy link, plus a
28-assertion dark-mode contrast contract), **F5** (three of four sub-minimum tap
targets), the Expo SDK patch drift (11 packages, `expo` 57.0.14 → 57.0.21, RN
0.86.2 → 0.86.3), and an Android `submit` profile in `eas.json`, which had none.

**D5 was re-reviewed and deliberately not touched.** The `image-size` exception
holds: the latest published version is still 2.0.2 and the advisories cover
`<= 2.0.2`, so npm's `fixAvailable: true` is optimism rather than a patch. The
gate passes, the ancestry is unchanged by the SDK bump, and the expiry stays
**2026-10-02** — `DEPENDENCY_ADVISORIES.md` says not to extend it merely to keep
CI green.

## Go / no-go summary

**Revised 2026-09-03 by the addendum above. The 2026-09-02 list had three items; it
now has nine, and the shape of the launch has changed with it.**

**Decide this first, because it is the difference between nine blockers and twelve:**
cash-only, or card at launch? The nine below apply either way. Card payment does not
remove any of them — it **adds** the three in the *Additionally* paragraph beneath the
list. The system today *is* a cash system and enforces it end to end — 66 of 68 orders
are `payment_status='pending'` and the only two `paid` are comped zero-total. A cash
launch is coherent now. A card launch is a provider decision plus merchant onboarding
measured in weeks, and is not compatible with a one-week go-live.

**Hard blockers for a CASH launch (ten — but see X7).** Nine items, plus **C8**, added
2026-09-16 when the closed-testing gate was found to be documented nowhere in this
repository. The count is deliberately not reduced elsewhere: X7's *credential* risk was
refuted on 2026-09-07 and X2's *Android* half on 2026-09-16, but in both cases what
remains of the item stays on the list with a much smaller shape. Nothing here has been
quietly retired.

1. **A1 — PDPL cross-border transfer.** Saudi personal data in `eu-central-1` with no
   recorded lawful basis. Counsel, possibly a region move. Longest lead time on the
   list; nothing else shortens it. *(2026-09-02)*
2. **E1 — no PITR.** Free plan, so it cannot even be purchased. Unrecoverable data
   window before real money. *(2026-09-02)*
3. **X2 — no *current* production build exists for the code that would ship.** iOS is
   ~54 commits stale and the §1 device gate has run on neither platform. **The Android
   half of this blocker is retired:** a production app bundle exists, is uploaded to
   Play's internal-testing track, and is still functionally current —
   `git diff --name-only f82cecbe HEAD -- apps/mobile/` returns nothing.
   *(2026-09-03; Android half retracted 2026-09-16 — see X2)*
4. **§1 — physical-device validation has never been performed**, on either platform.
   It gates on X2. *(2026-09-02, re-confirmed)*
5. **X1 — a store reviewer cannot sign in.** Login is hard-locked to Saudi mobiles
   with a WhatsApp OTP. Apple guideline 2.1. **Mechanism decided 2026-09-03 — a
   Supabase Auth test-OTP number, needing no code change** (§27, with the review
   notes ready to paste). What remains is one Auth configuration action by the
   owner: map a number you control to a fixed code — then remove that entry after
   review, which is a `RELEASE_CHECKLIST.md` §11 checkbox because it is a
   permanent reusable login until somebody deletes it. *(2026-09-03)*
6. **X4 — account deletion was buried three levels deep.** Apple 5.1.1(v). **Fixed
   in source 2026-09-03**; rides the X2 build, so it is done but not yet shipped.
   *(2026-09-03)*
7. **X3 — nothing pages a human.** All 112 alerts ever raised stopped inside the
   database. **The launch-week routine is now written down** (`INCIDENT_RESPONSE.md`
   §1b) and needs a name filled in against it, not code. It is a poll, not a page.
   The real email dispatcher is **built and inert** behind it (§28); applying,
   deploying and enabling it are three owner actions. *(2026-09-03)*
8. **X5 — the order lifecycle past `received` has never run in Production.** Its
   precondition is now met: **X6 — the `ready` push telling delivery customers to
   collect — is fixed AND deployed** (`push-dispatch` v6, 2026-09-03, §26), so the
   rehearsal no longer sends the wrong message to a real person. The rehearsal
   itself is still owed. *(2026-09-03)*
9. **X7 — the only login channel is unexercised and fallback-free.** **The credential
   fear is gone, measured 2026-09-07:** Meta reports a `SYSTEM_USER` token that
   **never expires**, both OTP templates `APPROVED`, and the sending number
   `CONNECTED`/`LIVE`/`GREEN`. What remains is that **no real login has run since
   2026-08-21** and there is no fallback of any kind, so this is now *one test to
   run* rather than *a thing that may already be broken*. **Reclassify it when you
   plan the week: it is the cheapest item left on this list.** *(2026-09-03, credential
   verified 2026-09-07)*
10. **C8 — Production is gated behind a 14-day closed test, and the clock has not
    started.** The Play developer account is **personal**, so production access must be
    *applied for* after a closed test with **12 testers opted in for 14 continuous
    days**. Internal testing does not count toward it, and the closed track is inactive.
    **This is the only blocker on this page whose cost is calendar time that nobody can
    shorten** — every other item is work, a decision, a credential or counsel. It is
    also the only one this repository did not know about at all until it was looked up.
    *(2026-09-16)*

**Revised again 2026-09-10 — the nine become eleven, and two of them are cheap.**
The 2026-09-03 list stands, with these amendments:

- **A5 joins it** — no breach-notification path exists at all (it was ⬜, it is
  now ❌). Hours of writing plus a named person. **Cheapest item on the page.**
- **A9 is half closed** — the privacy policy was corrected to v2.2 on
  2026-09-16 and names Google. The **public no-JavaScript page still serves the
  old v2.1 text**, because the legal snapshot is baked at build time; a Vercel
  rebuild is what finishes it. See A9.
- **X3 shrinks to one click** — three of its four steps are done. It is now the
  cheapest *owner* item, not a project.
- **X2 shrinks in scope but not in necessity** — the web channel already carries
  the merged work to customers, so X2 is about the store binaries and the device
  gate, not about delivering features.
- **E5 hardens** — the incident-response contacts are placeholders, all five
  roles unfilled. X3's stopgap depends on it, so it is not separable from X3.
- **X7 stays the cheapest test**, unchanged: one real login.

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

**Two content facts that decide how launch looks, neither of them a blocker:** **51
of 55** active products have no image — re-read live 2026-09-16, and it was 54 of 55
on 2026-09-10, a figure this sentence and G3 had both carried — and 40 have no English
description; and 62 stale test orders plus 4 stranded real delivery orders are sitting
in the live queue today.

**Owner sign-off:** ☐ go ☐ no-go — date: ______

## When to re-run this

Re-assess when any of these change: a new category of personal data, a new
platform permission, the Supabase region or plan, the payment provider, the push
consent model, or a new sub-processor. Otherwise the statuses above are a snapshot
of 2026-09-02 and should be treated as history.
