# App Store / TestFlight submission — the iOS record

> **Opened 2026-09-16**, the day the first TestFlight submission of the current
> build was attempted and **rejected**. This is the iOS counterpart to
> [`PLAY_STORE_SUBMISSION.md`](PLAY_STORE_SUBMISSION.md) and owns every App Store
> Connect answer the way that file owns Play's.
>
> [`GO_LIVE_READINESS.md`](GO_LIVE_READINESS.md) is the one-time policy gate and
> [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) §8 is the per-release re-check.
> This file is the **answers**, so those two point here rather than restating
> them — two copies of a form Apple cross-checks is how one of them goes quietly
> wrong.

---

## 1. Where this stands

| thing | state |
| --- | --- |
| App Store Connect app record | exists — ASC App ID **6800210683**, bundle `com.spicymeal.app` |
| ASC API key in EAS | working — `W7LY8D9FKX` (`[Expo] EAS Submit kROBQixX90`), read and write both exercised 2026-09-16 |
| TestFlight groups | **3 already exist** on the app record, reported by the CLI before it scheduled |
| newest iOS build | **1.0.0 (23)**, `fcb7d682-7b31-4d9b-ac22-9e0a86ea2493`, commit `f82cecbe`, FINISHED 2026-09-14 |
| that build in TestFlight | **NO — Apple rejected the upload.** §3 |
| newest build actually in TestFlight | **1.0.0 (22)**, submitted 2026-08-26 |

**The blocker is a purpose string, not a credential, not a policy item, and not
the binary's contents.** It needs one config line, already fixed, and a rebuild.

---

## 2. Build 23 was current, which is why this matters

`git diff --name-only f82cecbe <default-branch> -- apps/mobile/` returns **zero
files**. Every commit since that build touched `assets/store`, `src/legal`,
`scripts`, `docs`, `vite.config.ts`, `legal.html`, `.github/workflows` and root
`package.json` (npm scripts only) — none of which enters the iOS binary, and
`src/legal` is the web legal page, not mirrored into the app.

**This retires the iOS half of `GO_LIVE_READINESS.md` X2**, which said *"the
newest iOS production build is 1.0.0 (22), commit `6265781a`, 2026-08-26 — ~54
commits stale"* and concluded *"What survives is iOS, and it survives whole."*
Both platforms have had a current production build at `f82cecbe` since
2026-09-14. That row was refreshed for Android on 2026-09-15/16 while its iOS
half was left on a **2026-09-03** EAS read — which the row's own evidence column
states. **Half a row refreshed is a row that lies about the other half.**

Two things the build carries that no customer has yet held, both confirmed by
`git grep` against the commit rather than assumed:

- **A6** — *Get a copy of my data*, `export_my_data` in `src/services/api.ts`;
- the **"You'll earn N points"** checkout line, `preview_loyalty_points` in
  `src/features/checkout/CheckoutScreen.tsx`.

---

## 3. Why the upload was rejected, and what it cost

Two submissions were scheduled on 2026-09-16 (`2632f5a6…`, `885d555b…`). Both
ERRORED in about 70 seconds.

### Getting the error out was itself work worth recording

The CLI printed only *"Something went wrong when submitting your app to Apple App
Store Connect."* `submission.error` was **null**, and `logFiles` was **empty** —
while the successful 2026-08-26 submission has two log files. The message only
appears by walking the GraphQL API one level deeper:

```
submissions.byId(...) { jobRun { errors { errorCode message } } }
```

**If an EAS submission fails with no logs, read `jobRun.errors`.** Nothing in the
CLI output points there.

### The error

```
EAS_UPLOAD_TO_ASC_MISSING_PURPOSE_STRING
Build upload was rejected by App Store Connect because Info.plist is
missing one or more privacy purpose strings.
Missing keys reported by App Store Connect:
- NSMotionUsageDescription
```

App Store Connect's own wording, from the build-upload record, states the rule
plainly:

> **90683: Missing purpose string in Info.plist.** […] If you're using external
> libraries or SDKs, they may reference APIs that require a purpose string.
> **While your app might not use these APIs, a purpose string is still
> required.**

### The cause is ours

On 2026-09-10, `887d861` (#356 — `GO_LIVE_READINESS.md` **B8**, item **N1**)
declared the `expo-location` config plugin explicitly with `false` for three
purpose strings, to stop it injecting generic `Allow $(PRODUCT_NAME) to…`
placeholders for capabilities the app never uses. Two of the three were right and
remain `false`. `motionUsagePermission` was not.

**Apple requires the string on LINKAGE, not on use**, and that was measured
against the artifact rather than argued:

| evidence | value |
| --- | --- |
| `ExpoLocation.framework` in the `.ipa`, references to `CMMotionActivity`/`CoreMotion` | **54** |
| build 23 `Info.plist`, usage descriptions | **1** — `NSLocationWhenInUseUsageDescription` only |
| app's own calls to motion activity | none |

The regression boundary is exact. Build **22** (`6265781`, 2026-08-25) predates
the change and **uploaded successfully**. Build **23** (`f82cecb`, 2026-09-14) is
the first build after it and cannot be uploaded at all.

### The lesson, which is the durable part

**B8 verified the removal with `expo config --type introspect`.** That reads the
resolved **config**. It proved the key was gone; it could not prove the key was
**unnecessary** — only the binary and Apple's validator can say that. And no iOS
submission was attempted in the six days between the change and the next build,
so nothing could have caught it.

**A config check is not an artifact check.** It is the same shape as reading the
AAB's own manifest for C1 instead of trusting `app.json`, and the same shape as
fetching the deployed legal page instead of trusting the database row
(`OWNER_ACTIONS.md` §34).

### The fix

`motionUsagePermission` now carries an honest string, in `app.json` and in **both
locale files** beside the location one:

> **EN** — Spicy Meal does not request motion or fitness data. This description is
> required because the location library bundled in the app links Apple's motion
> framework, which Spicy Meal never calls.
>
> **AR** — لا يطلب سبايسي ميل بيانات الحركة أو اللياقة. يظهر هذا الوصف لأن مكتبة
> الموقع المضمّنة في التطبيق ترتبط بإطار الحركة من Apple، وهو إطار لا يستدعيه
> سبايسي ميل أبداً.

It says the app does not use the data, because it does not. **It is never shown
to a customer** — a purpose string appears only when the API is called, and
nothing calls it. It exists for Apple's validator and for a reviewer's question.

**The two Always-location props stay `false`.** Apple's rejection named the motion
key and nothing else, so B8's actual intent is preserved. Re-checked on the
resolved config: motion **present**, `NSLocationAlwaysUsageDescription` and
`NSLocationAlwaysAndWhenInUseUsageDescription` **absent**, no `UIBackgroundModes`.

**The Arabic is engineering-drafted and has not had a native read** — the same
caveat as `OWNER_ACTIONS.md` §29, §33a and §35. Fold it into that review.

`apps/mobile/src/components/iosPurposeStrings.test.ts` pins all of it: the motion
string non-empty, both Always props `false`, the when-in-use string present, every
purpose string in both locales, and the Arabic file not holding the English
sentence. Mutation-tested three ways, all three killed.

---

## 4. App Privacy labels — `GO_LIVE_READINESS.md` B3

**Derived, not copied.** The source facts are
[`PLAY_STORE_SUBMISSION.md`](PLAY_STORE_SUBMISSION.md) §6's thirteen Play data
types, each already traced to a schema line or code path. Apple uses different
categories **and** an axis Play has no equivalent of — *Used to Track You* /
*Linked to You* / *Not Linked to You* — so the mapping is the work.

### Used to Track You: **NO**, for every type

Measured against the `.ipa`, not assumed:

| check | result |
| --- | --- |
| `ATTrackingManager` / `advertisingIdentifier` / `ASIdentifierManager` across the app binary and all 15 frameworks | **0** |
| `NSUserTrackingUsageDescription` in `Info.plist` | absent |
| `SKAdNetworkItems` | absent |
| app root `PrivacyInfo.xcprivacy` → `NSPrivacyTracking` | **false** |

**So no ATT prompt is required.** Declaring tracking where there is none invites a
prompt the app cannot justify; declaring none where there is some is a rejection.
Both directions are checked above.

### The table

| Apple category | Type | Collected | Linked to You | Why / evidence |
| --- | --- | --- | --- | --- |
| Contact Info | Phone Number | Yes, **required** | **Linked** | The account identity — `profiles.phone_number`, `orders.customer_phone`. Sign-in is WhatsApp OTP to a Saudi mobile |
| Contact Info | Name | Yes, **optional** | **Linked** | `profiles.full_name` is nullable; 3 of 9 live profiles have none |
| Contact Info | Email Address | Yes, optional | **Linked** | `profileService.ts:10` writes `email \|\| null`; never required to order |
| Contact Info | Physical Address | Yes, optional (delivery only) | **Linked** | `addresses.description`, `.national_short_address` |
| Location | Precise Location | Yes, optional | **Linked** | `addresses.latitude/longitude`; `LocationPickerMap.tsx:226` requests `Accuracy.High` |
| Location | Coarse Location | Yes, optional | **Linked** | same picker, coarse fallback |
| Identifiers | User ID | Yes | **Linked** | `profiles.id` |
| Identifiers | Device ID | Yes, **required** | **Linked** | `push_devices.expo_push_token` |
| Purchases | Purchase History | Yes | **Linked** | `orders`, `order_items`. **No payment instrument** — launch is cash-only; `payment_method` records *how*, not a card |
| User Content | Other User Content | Yes, optional | **Linked** | `orders.notes`, `order_items.note` — free-text, printed on the kitchen ticket |
| Diagnostics | Crash Data | Yes, **required** | **Linked** | Sentry. No user opt-out |
| Diagnostics | Performance Data | Yes, **required** | **Linked** | Sentry, `tracesSampleRate` sampled |

**Financial Info: NO. Health & Fitness: NO. Browsing History: NO. Search History:
NO. Sensitive Info: NO. Contacts: NO.**

### Two answers that are argued rather than guessed

**Crash Data is *Linked to You*, and Sentry's own manifest disagrees.**
`Sentry.bundle/PrivacyInfo.xcprivacy` inside the `.ipa` declares
`NSPrivacyCollectedDataTypeCrashData` with `Linked: false`. That describes the
SDK's defaults. **Our configuration is not the default**: `sanitize.ts:223-226`
reduces `event.user` to `{ id }` and drops every other field, so a crash report
carries the account id. **The developer's declaration governs, not the bundled
SDK manifest** — declare Linked. This is the same fact that makes §6 mark Play's
"User IDs" row as collected.

**Device ID carries no marketing purpose on Apple's form the way it does on
Play's.** Play asks for a purpose list and the push token's opt-out promos make
"Advertising or marketing" mandatory there (CLAUDE.md §7). Apple's App Privacy
asks for *purposes* too — declare **App Functionality** and **Product
Personalization**; it is not "Third-Party Advertising", because nothing is sold
or shared with an ad network.

**These must agree with C5 / the Play Data Safety form.** They are the same facts
in two shapes, and Apple and Google both cross-check a published privacy policy
against the declared form. The policy is `privacy_policy` v2.3
(`OWNER_ACTIONS.md` §34).

---

## 5. Privacy manifests — `GO_LIVE_READINESS.md` B4

**Measured from the `.ipa` of build 23**, which is what B4 asked for and nobody
had done. **14** `PrivacyInfo.xcprivacy` files ship.

The app's own, at `SpicyMeal.app/PrivacyInfo.xcprivacy`:

| field | value |
| --- | --- |
| `NSPrivacyTracking` | **false** |
| `NSPrivacyTrackingDomains` | none |
| `NSPrivacyCollectedDataTypes` | 0 |
| `NSPrivacyAccessedAPITypes` | 3 — `FileTimestamp` `C617.1`, `UserDefaults` `CA92.1`, `SystemBootTime` `35F9.1` |

Dependencies shipping a manifest: Sentry, ExpoApplication, ExpoConstants,
ExpoDevice, ExpoNotifications, ExpoSystemUI, React-Core, React-cxxreact,
React-timing, RNCAsyncStorage, and boost/folly/glog inside
`ReactNativeDependencies.framework`. **Most ship it as a sibling
`*_privacy.bundle`, not inside the `.framework`** — worth knowing before
concluding a pod is missing one.

**Stated rather than glossed: `ExpoLocation`, `ExpoImage`, `ExpoFileSystem`,
`ExpoModulesCore` and the four `SDWebImage` frameworks ship no manifest of their
own.** Apple's requirement lands on SDKs on its commonly-used list; none of these
is on it today, and the app's own manifest covers the required-reason APIs it
uses. Re-check this if Apple extends the list.

---

## 6. TestFlight — the internal/external boundary

Verified against App Store Connect Help, not from memory.

| | Internal | External |
| --- | --- | --- |
| limit | **100** App Store Connect users with access to the content | **10,000** people |
| Beta App Review | **not required** | **required on the first build** of a group |
| test information | required | required |
| build access | 90 days | 90 days |

**Managed Apple Accounts created in reserved domains cannot test builds.**

**So internal testing is reachable the moment a build uploads and finishes
processing.** External testing pulls in the reviewer sign-in problem below.

### Test information — paste-ready

**Beta app description (EN)**

> Spicy Meal is the ordering app for a Saudi restaurant. Browse the menu, build
> an order with add-ons and variants, choose pickup or delivery, place the order
> and follow it through preparation to collection or dispatch. Payment at launch
> is cash on collection or delivery — no card is taken in the app. Prices include
> VAT. Loyalty points are earned and redeemed on pickup orders only.

**Beta app description (AR)** *(engineering-drafted, no native read — §29)*

> سبايسي ميل هو تطبيق الطلب لمطعم سعودي. تصفّح القائمة، وكوّن طلبك مع الإضافات
> والأحجام، واختر الاستلام أو التوصيل، ثم أرسل الطلب وتابعه حتى التحضير والاستلام
> أو الانطلاق. الدفع عند الإطلاق نقداً عند الاستلام أو التوصيل — لا تُؤخذ أي بطاقة
> داخل التطبيق. الأسعار شاملة ضريبة القيمة المضافة. تُكتسب نقاط الولاء وتُستبدل في
> طلبات الاستلام فقط.

**What to test**

> 1. Sign in with a Saudi mobile number and the WhatsApp one-time code.
> 2. Build an order with add-ons and a size variant; check the total and that the
>    VAT line matches the menu prices.
> 3. Place a **pickup** order and follow the status notifications through to
>    ready.
> 4. Place a **delivery** order, choose the map pin, and confirm the address
>    that appears on the confirmation is the one you picked.
> 5. **New in this build:** Profile → Account & privacy → *Get a copy of my data*.
> 6. **New in this build:** the "You'll earn N points" line at checkout on a
>    pickup order.
> 7. Profile → *Delete account*, one tap from the Profile screen. **This really
>    deletes** — use a throwaway account.

**Feedback email:** the support address already on the app record. **Do not put a
personal address here** — it is shown to every tester.

**Sign-in for a reviewer:** §7 below. It is required for external review and is
**not yet in place**.

---

## 7. Reviewer sign-in — still open, and it gates external testing only

Login is **WhatsApp OTP to a Saudi mobile only** (`normalizeSaudiPhoneE164`
rejects foreign numbers at the hook) and there is **no guest or browse-only
mode**, so a reviewer outside Saudi Arabia cannot get past the first screen.

The mechanism is decided and proven: a **Supabase Auth test-OTP number**, needing
no code change. `OWNER_ACTIONS.md` §27 holds the mechanism and paste-ready review
notes; `PLAY_STORE_SUBMISSION.md` §4a holds the evidence that the hosted
dashboard short-circuits the custom Send SMS Hook.

**What is not done is the Auth entry itself.** It is a §5 Auth configuration
change. `RELEASE_CHECKLIST.md` §8 requires verifying the number is **unused**
first —

```sql
select count(*) from auth.users where phone = '+9665XXXXXXXX';  -- must be 0
```

— because a number already enrolled signs the reviewer into that person's real
account, orders and saved addresses included: the profile trigger only fires for
new users. It is a permanent reusable login until removed, which is why §11
removes it.

**Each store keeps its own copy of these credentials.** §11's removal step has to
update both, and Play in particular reuses them for every future review.

---

## 8. What is left, in order

1. **Merge the purpose-string fix**, then **build** (it will be 1.0.0 (24) —
   `appVersionSource: remote` with `autoIncrement: true`), then **submit**. Each
   is a §5 action.
   **Run `npx expo install --check` immediately before the build** — SDK patch
   drift has recurred twice, most recently four days after being recorded closed
   (`GO_LIVE_READINESS.md`).
2. **Add internal testers** in App Store Connect. That is the only step between a
   processed build and an installable one.
3. **Enter the App Privacy answers** from §4 in the console.
4. **Enter the test information** from §6.
5. For **external** testing: the §7 Auth entry, then submit for Beta App Review.

**Not gating TestFlight, but gating an App Store release:** the §1
physical-device validation gate, which has run on neither platform.

---

## 9. Open questions

- **Does Apple's App Privacy accept "Product Personalization" for the push
  token** given promos are opt-out (CLAUDE.md §7)? The Play form forced
  "Advertising or marketing"; Apple's taxonomy differs and the honest answer may
  be "Third-Party Advertising: No, Developer's Advertising or Marketing: Yes".
  Decide before entering the form, and keep it consistent with C5.
- **Will Apple query B2 / guideline 4.5.4** — marketing push is opt-OUT here, with
  the OS permission dialog as the consent moment (owner decision 2026-08-20, risk
  accepted). If App Review rejects, the revert is one line:
  `promosEnabled: false` in `DEFAULT_DEVICE_PREFS`.
- **`supportsTablet: false`** — iPad screenshots are therefore not required, but
  confirm the App Store listing is iPhone-only before uploading assets.
