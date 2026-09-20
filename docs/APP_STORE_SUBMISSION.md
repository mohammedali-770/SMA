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
| newest iOS build | **1.0.0 (25)**, `8df309aa-434b-46ad-8bfa-4566c68e6763`, commit `b7868e2`, FINISHED 2026-09-20 06:54 UTC |
| **build 25 uploaded to App Store Connect** | **YES, 2026-09-20 07:19:28 UTC** — and EAS reported the submission ERRORED again, for the same reason. §3a |
| **build 25 live in TestFlight** | **not yet confirmed.** The upload completed and Apple was processing; confirm by INSTALLING it, not by reading a status |
| previous iOS build | **1.0.0 (24)**, `91dfe52c-03a1-4846-8401-7c28e60bed9d`, commit `8e4cd8a1`, FINISHED 2026-09-16 |
| **build 24 live in TestFlight** | **YES** — installed and exercised on a real device at 11:11:40 UTC. Confirmed by USE, not by an API read; see §8 |
| internal testers | **already configured.** Internal testing needs no Beta App Review |
| build 23 | **SUPERSEDED, do not submit** — it is the one Apple refused. §3 |
| previous build in TestFlight | **1.0.0 (22)**, submitted 2026-08-26 |

**The purpose-string blocker is fixed and build 24 carries it** — verified in the
binary, not the config: its `Info.plist` holds **two** usage descriptions,
when-in-use and motion, with no `UIBackgroundModes`. Build 24 is uploaded.
**What remains is entirely App Store Connect console work** (§8), none of which
needs another build.

**BUILD 25 EXISTS FOR A FEATURE, NOT FOR A BLOCKER, and the distinction decides
what happens if it is delayed.** Nothing Apple refused is fixed in it. It carries
the **customer half of per-size closing** (`OWNER_ACTIONS.md` §40): without it, a
customer whose app predates `b7868e2` who orders a size a branch has closed gets
a **generic error at the payment step** rather than the server's sentence,
because `failureMessage` returns a translated key
(`apps/mobile/src/lib/errors/reportFailure.ts:65-71`).

**`app_settings.variant_closing_enabled` is now TRUE**, flipped 2026-09-20
07:47:05 UTC on explicit owner approval, so the branch console's per-size
controls are live (§8 item 5, `OWNER_ACTIONS.md` §40.3). **That did not by itself
put anyone at risk, and the reason is worth carrying:** the flag gates the
CONSOLE rather than the API, and with **zero** sizes closed no client behaves
differently whatever it says. **The risk above begins when a branch actually
closes a size** — so what still binds is getting build 25 onto every device that
can order BEFORE a size is closed for real.

**"Needs another build" means NOTHING KNOWN NEEDS ONE — it is not a promise that
App Review will not force one**, and the distinction is worth keeping because
this line is the one a reader acts on. Build 24 is confirmed processed by USE
(the table above, and §8), which is stronger evidence than a console status
read: TestFlight does not make a build installable until processing succeeds.
So processing cannot retroactively invalidate it, and no *console* step in §8
requires a binary.

**The known exception is guideline 4.5.4.** Apple expects an explicit in-app
opt-in before marketing push; here the opt-out toggle is the consent surface, a
deliberate decision the owner accepted on 2026-08-20 (CLAUDE.md §7). If App
Review rejects on it, the fix is one line — `promosEnabled: false` in
`DEFAULT_DEVICE_PREFS` — but a one-line fix still ships as a **new build with a
higher number**, because build numbers are unique per version train (§3a). That
is a review risk, not a processing risk, and it is the only one currently
identified.

---

## 2. Build 23 was current *until this record was written*, which is why this matters

**Read the tense. Build 23 is SUPERSEDED and must not be submitted** — it is the
build Apple refused, and the fix in §3 changes `apps/mobile/` to correct it. The
next build, 1.0.0 (24), is the first submittable one.

**As measured on 2026-09-16, immediately BEFORE the purpose-string fix landed**,
`git diff --name-only f82cecbe <default-branch> -- apps/mobile/` returned **zero
files**. Every commit between that build and that moment touched `assets/store`,
`src/legal`, `scripts`, `docs`, `vite.config.ts`, `legal.html`,
`.github/workflows` and root `package.json` (npm scripts only) — none of which
enters the iOS binary, and `src/legal` is the web legal page, not mirrored into
the app.

**Running that command today returns four files** — `app.json`, both locale files
and `iosPurposeStrings.test.ts` — because the fix is one of them. That is the
correct answer, not a regression: it is what "build 23 is superseded" looks like
from the command line. **Review caught this paragraph asserting the zero-file
result as a present-tense fact in the very change that falsified it** (#388),
which is the same defect as a `legal_documents` row edited without its own date,
one directory over.

**The durable point survives the tense change**, and it is about the readiness
gate rather than about build 23. For three weeks the iOS build genuinely tracked
the Android one commit-for-commit while the gate said it did not, so this
retires the iOS half of `GO_LIVE_READINESS.md` X2 — which said *"the
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

## 3a. Build 24 — it uploaded, and EAS said it failed

**Build 24 is in App Store Connect.** It was built from `8e4cd8a1` (the merged
default branch, carrying both the purpose-string fix and the SDK patch bump) and
verified **in the binary** before submitting, not in the config that caused the
last failure: `Info.plist` holds **two** usage descriptions — when-in-use and
motion — and no `UIBackgroundModes`.

### The submission reported ERRORED and the upload had already succeeded

This is the most useful operational fact on this page, because the obvious
response to it is wrong.

**IT HAPPENED AGAIN ON BUILD 25, 2026-09-20, LINE FOR LINE — so treat it as the
NORMAL behaviour of this path rather than as an Apple outage.** That is the
single most important amendment this section has had. Two for two is not a
coincidence, and the practical consequence is that **an `ERRORED` iOS submission
here is the expected outcome, and reading it as a failure is the mistake**:

| | build 24 (2026-09-16) | build 25 (2026-09-20) |
| --- | --- | --- |
| chunks uploaded | 6/6 | 6/6 |
| `File upload … completed!` | 11:05:33 | **07:19:28** |
| `status = PROCESSING` polls | ~3 min | ~1 min 13 s, 8 polls |
| Apple's answer | HTTP 500 `UNEXPECTED_ERROR` | **HTTP 500 `UNEXPECTED_ERROR`, identical body** |
| structured error | `UNKNOWN_ERROR` **with** a log | `UNKNOWN_ERROR` **with** a log |
| where the 500 landed | the status poll | the status poll |
| the transfer itself | succeeded | **succeeded** |

The polling window differing by a factor of two while the outcome is identical is
itself evidence: the 500 is not a timeout on a slow processing run, it is what
that endpoint returns.

**Build 25 was submitted knowing this**, and the failure was predicted out loud
before the command ran, which is the point of writing it down. Nothing was
resubmitted on reflex; the log was read first and it said what this table says.

| UTC | what the log says |
| --- | --- |
| 11:05:31-32 | all **6 chunks** uploaded |
| 11:05:32 | `Committing upload...` |
| 11:05:33 | **`File upload (ID: e063b258-…) completed!`** |
| 11:05:34 → 11:08:29 | `Waiting for build upload to complete... (status = PROCESSING)`, ~3 minutes |
| 11:09:00 | Apple returns **HTTP 500**, EAS fails the step |

```
Unexpected response (500) from App Store Connect:
  "status": "500", "code": "UNEXPECTED_ERROR",
  "detail": "An unexpected error occurred on the server side."
```

**The 500 hit the status-polling call, not the transfer.** The binary was already
delivered and Apple was processing it. EAS nonetheless marks the whole submission
`ERRORED`, with no distinction between "we could not upload" and "we uploaded and
then lost track of it".

**Proven rather than assumed, by the retry.** Resubmitting the same build returned:

> `Build number 24 for app version 1.0.0 has already been used. App Store Connect
> requires unique build numbers within each app version (version train).`

That is Apple stating it holds build 24. The retry cost four minutes and was
refused cleanly — no duplicate, no harm — but it was avoidable.

### Two rules to carry

1. **An EAS submission marked ERRORED does not mean the upload failed.** Read the
   log timeline before retrying: if `File upload ... completed!` appears, the
   binary is at Apple and the right next step is to look at App Store Connect,
   not to resubmit. Resubmitting a delivered build can only be refused, because
   build numbers are unique per version train.
2. **The submission logs are Brotli-compressed, and nothing says so.**
   `Content-Type` is unset, `file` reports "data", and gzip/zlib/bz2/lzma all
   fail. The first read of one produced screenfuls of binary garbage.

   ```bash
   node -e "const z=require('zlib'),f=require('fs');
     process.stdout.write(z.brotliDecompressSync(f.readFileSync('log')))"
   ```

   The decompressed file is **JSON lines**; filter on `level >= 40` to get
   straight to the failures.

**How to get the log at all** is §3's lesson and still applies: the CLI prints
only *"Something went wrong"*, `submission.error` is null, and `submission
.logFiles` is empty. The URL is at `submissions.byId(…) { jobRun { logFileUrls } }`,
and the structured error — when there is one — at `jobRun { errors { errorCode
message } }`. Note that build 23's failure produced a structured
`EAS_UPLOAD_TO_ASC_MISSING_PURPOSE_STRING` with **no** log file, while build 24's
produced `UNKNOWN_ERROR` **with** one. **Check both.**

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

1. ~~Merge the purpose-string fix, build, submit.~~ **DONE 2026-09-16.** #388
   merged the fix, #389 cleared the SDK patch drift that `npx expo install
   --check` found immediately before the build (three packages, the third
   recurrence), build 24 was produced from `8e4cd8a1` and uploaded at 11:05:33
   UTC. §3a covers the misleading ERRORED status.
2. ~~Confirm build 24 in TestFlight and add internal testers.~~ **DONE, and
   confirmed by USE rather than by an API read.** Internal testers were already
   configured, and build 24 was installed and exercised on a real device: order
   `SM-2026-000083` was placed through it at **11:11:40 UTC**, about two minutes
   after Apple finished processing the upload.

   **That is the only evidence available here, and it is better than the
   alternative.** The EAS CLI cannot list App Store Connect builds, and this
   submission reported ERRORED while having actually succeeded (§3a), so nothing
   in the pipeline could answer "is it installable?" — only opening the app
   could.

   **AND IT IMMEDIATELY FOUND A THREE-WEEK OUTAGE.** The first order placed
   through build 24 produced a truthful "Order confirmed" push and then an error
   screen: "My Orders" and the receipt had been failing since 2026-08-26 for
   every client built after that date, because `orders.is_comped` and
   `orders.comp_discount_amount` were never granted to `authenticated` while the
   client select asked for them. Fixed by `20260922120000`, applied the same day
   — `MIGRATIONS.md` §43 and ledger row 96.

   **This is the argument for a device test rather than a green pipeline, in one
   sentence: every gate passed on a build whose main screen could not load.**
3. ~~Build and submit 1.0.0 (25), the per-size customer half.~~ **DONE
   2026-09-20.** Built from `b7868e2` (06:54 UTC), submitted 07:19, upload
   completed **07:19:28**, EAS reported ERRORED for the second-consecutive
   status-poll 500 — §3a. **Not resubmitted**, per the rule that section exists
   to state.
4. **Confirm build 25 in TestFlight by INSTALLING it**, the same way build 24 was
   confirmed — nothing in the pipeline can answer "is it installable?", and the
   one time it was answered by opening the app it found a three-week outage
   (item 2).
5. ~~**Flip `app_settings.variant_closing_enabled`**~~ — **DONE 2026-09-20
   07:47:05 UTC** on explicit owner approval. It reads `true`, nothing else
   moved, and both client roles were confirmed to read it by performing the
   select rather than checking the grant. `OWNER_ACTIONS.md` §40.3.
6. **Then** close a size in the branch console and check the customer app refuses
   it with the server's sentence rather than a generic payment error. If
   anything is wrong, flip the flag back: one statement, reversible, and with no
   size closed the system is exactly where it started.

**Steps 5 and 6 are in that order for a reason, and an earlier revision of this
list had them the other way round — which was IMPOSSIBLE TO FOLLOW.** It said to
close a size in the console and *then* flip the flag. The flag is what puts the
per-size control in the console (`src/components/ops/BranchConsole.tsx:73-76`,
`perSizeEnabled`, defaulting false and staying false on any read error), so
while it is false there is no control to close a size with. Review caught the
circularity on #406. **A runbook step whose precondition the previous step
removes is not a cautious ordering, it is a dead end.**

**FLIPPING THE FLAG IS NOT THE MOMENT OF EXPOSURE, and conflating the two is
what made the bad ordering look prudent.** The flag gates the CONSOLE, not the
API: `set_variant_snooze` and `clear_variant_snooze` authorize on `is_admin()
or is_branch_operator(branch)` **without consulting it** (CLAUDE.md §8, measured
on #396). And with **zero** sizes closed — `branch_variant_availability` held 0
rows when this was written — no client behaves any differently whatever the flag
says. **The exposure begins when a branch actually closes a size, not when the
control appears.**

**So the prerequisite that matters is about closing sizes in anger, not about
flipping the flag:** before a branch closes a size for real, every device that
can order should be on build 25 or later. Older clients accept a closed size and
then show a generic error at the payment step, because `failureMessage` returns
a translated key rather than the server's sentence.

**The population that has to be on 25 is small and bounded, measured 2026-09-20
rather than assumed:** the app is **not publicly distributed on either store** —
Play is internal testing only (`PLAY_STORE_SUBMISSION.md` §2: *"Internal testing
does not count"*, `track: "internal"`, `releaseStatus: "draft"`) and iOS is
TestFlight internal only. Live: **6 distinct people have ever placed an order, 3
in the last 30 days** (40 orders in 30 days, 76 all time, last one 2026-09-16),
with 5 active push devices. Review's second finding on #406 asked for
"rollout/adoption" as the gate, which is the right instinct and the wrong unit
here: there is no public rollout to wait on, and the honest version of the rule
is a checkable list of testers rather than an adoption curve. **Re-measure
before relying on this — the moment either store goes to a public track, the
bound stops holding.**
7. **Enter the App Privacy answers** from §4 in the console.
8. **Enter the test information** from §6.
9. For **external** testing: the §7 Auth entry, then submit for Beta App Review.

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
