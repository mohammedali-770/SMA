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
| newest iOS build | **1.0.0 (27)**, `c285ee99-5566-41bf-9832-fe15175795ce`, commit `0969b1f8`, FINISHED 2026-09-20 17:05 UTC |
| **build 27 uploaded to App Store Connect** | **YES** — and the submission reported SUCCESS, unlike 24 and 25. §3a |
| **build 27 live in TestFlight** | **YES** — installed and exercised on a real device 2026-09-21. Confirmed by USE, not by an API read |
| what 27 carries | all three category-chip fixes and the per-size customer half. **What it has PROVED is narrower** — see §8 item 6; the checkout refusal remains unobserved |
| superseded builds | 25 (`b7868e2`, per-size customer half) and 26 (`47ab0221`, first chip fix). Both were installed and used; neither is current |
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

**The known exception is guideline 4.5.4.** Apple expects consent *"via consent
language displayed in your app's UI"* before marketing push, plus an in-app
opt-out. **Since 2026-11-10 the language is there**: the first run shows a
consent screen before the OS prompt, stating order updates **and** occasional
offers and where to turn offers off, and the OS prompt is raised only from its
Allow button. The Profile toggle remains the opt-out. Marketing is still
opt-OUT — offers come on with the grant — which is the deliberate decision the
owner accepted on 2026-08-20 and re-confirmed on 2026-11-09 (CLAUDE.md §7), and
the residual risk. If App Review rejects on it, the fix is one line —
`promosEnabled: false` in `DEFAULT_DEVICE_PREFS` — but a one-line fix still ships
as a **new build with a higher number**, because build numbers are unique per
version train (§3a). That is a review risk, not a processing risk, and it is the
only one currently identified. **The consent screen first ships in the next
build**: every build already uploaded predates it, so a reviewer of one of those
sees no in-app text.

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

**The when-in-use string was rewritten again on 2026-11-10**, because it described
one use of three. It said location was used *"while you are choosing a delivery
point"*. The pickup tab also asks, to list the nearest branches
(`OrderTypeSelectScreen.tsx`), and checkout reads an existing grant to warn when
the delivery pin is far from the customer (`CheckoutScreen.tsx`, which never
asks). It now names all three, says it is used only while the app is open, and
keeps "never used in the background". The same change removed the OS location
prompt that the first run used to raise straight after sign-in, with nothing on
screen to explain it; location is now asked only on the pickup tab and at "Use
my location". Two cases were added to the test: the base string must equal the
English locale (the 2026-09-09 rewrite reached one and not the other), and both
languages must name the branch list. The Arabic joins `OWNER_ACTIONS.md` §35.

**Added 2026-11-10 for Expo SDK 58: `locationFullAccuracyPermission` is `false`.**
expo-location 58's plugin began writing `NSLocationTemporaryUsageDescriptionDictionary`,
a generic, English-only "temporary full accuracy" placeholder, unless that prop is
`false`. Only the separate `expo-location/next` module can make that request, and
nothing imports it. Measured on an SDK 58 prebuild: the key is present without the
prop and absent with it, and the when-in-use and motion strings are unchanged. The
test file pins the prop and the absence of any `expo-location/next` import.

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

**IT HAPPENED AGAIN ON BUILD 25, 2026-09-20, LINE FOR LINE.** Two for two, which
at the time read as "this is simply how this path behaves".

**CORRECTED 2026-09-21 — THAT CONCLUSION WAS OVERSTATED, AND THE OVERSTATEMENT IS
THE MORE USEFUL RECORD.** Builds **26 and 27 both submitted CLEANLY**, reporting
success with no `ERRORED` status at all. The tally is **2 of 4**, so the failure
is **INTERMITTENT, not normal**. The sentence this replaces said to treat
`ERRORED` as "the expected outcome" — a rule induced from two consecutive
observations, stated as a property of the system, and falsified by the next two.
**Two samples in a row is a pattern to watch, not a law**; the file should have
said so.

**What survives the correction is the part that actually matters, and it is
unchanged: an `ERRORED` submission does not mean the upload failed.** Read the
log timeline before resubmitting. If `File upload ... completed!` appears, the
binary is at Apple and the next step is App Store Connect, not another
submission — build numbers are unique per version train, so a resubmit can only
be refused. That rule held on all four builds regardless of which status they
reported.

The two failures were identical to each other:

| | build 24 (2026-09-16) | build 25 (2026-09-20) |
| --- | --- | --- |
| chunks uploaded | 6/6 | 6/6 |
| `File upload … completed!` | 11:05:33 | **07:19:28** |
| `status = PROCESSING` polls | ~3 min | ~1 min 13 s, 8 polls |
| Apple's answer | HTTP 500 `UNEXPECTED_ERROR` | **HTTP 500 `UNEXPECTED_ERROR`, identical body** |
| structured error | `UNKNOWN_ERROR` **with** a log | `UNKNOWN_ERROR` **with** a log |
| where the 500 landed | the status poll | the status poll |
| the transfer itself | succeeded | **succeeded** |

The polling window differing by a factor of two while the outcome is identical
says the 500 is not a timeout on a slow processing run — but note what that does
and does not support. It rules out "Apple was just slow that day". It does NOT
establish that the endpoint always answers 500, which is the inference drawn
here originally and disproved by builds 26 and 27.

**Build 25 was submitted knowing this**, and the failure was predicted out loud
before the command ran, which is the point of writing it down. Nothing was
resubmitted on reflex; the log was read first and it said what this table says.
**The same prediction was made before build 26 and was WRONG** — it succeeded.
A prediction that holds twice and then fails twice was never a prediction; it
was a description of the sample.

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
own.** That is what build 23 showed. The paragraph that followed it was wrong,
and the correction is below.

### Corrected 2026-11-10 — two SDKs in this app are on Apple's list

This section used to say *"Apple's requirement lands on SDKs on its
commonly-used list; none of these is on it today."* That was false, and B4's ✅
rested on it. Apple's [list of SDKs that require a privacy manifest and
signature](https://developer.apple.com/support/third-party-SDK-requirements/),
read 2026-11-10, names **`SDWebImage`** and **`hermes`**. The page says:

> You must include the privacy manifest for any SDK listed below when you submit
> new apps in App Store Connect that include those SDKs, or when you submit an
> app update that adds one of the listed SDKs as part of the update. Signatures
> are also required in these cases where the listed SDKs are used as binary
> dependencies. Any version of a listed SDK, as well as any SDKs that repackage
> those on the list, are included in the requirement.

This app has never been submitted for App Review, so its first submission is a
"new app" in that sentence, and it contains both SDKs.

| SDK | How it reaches the binary | Its own manifest | Signature | Evidence, 2026-11-10 |
| --- | --- | --- | --- | --- |
| **SDWebImage** 5.21.x — `expo-image` 57 pins `~> 5.21.0` | Built from source by CocoaPods. Expo's precompiled path is opt-in (`EXPO_USE_PRECOMPILED_MODULES=1`), and nothing in this repository sets it | **Declared by the pod.** The `Core` subspec of 5.21.7 has `resource_bundles = {'SDWebImage': ['WebImage/PrivacyInfo.xcprivacy']}` | Not required for a source dependency | Podspec read from the CocoaPods CDN. **This contradicts build 23's measurement above**, which found no SDWebImage manifest. Only the next `.ipa` can say which is right |
| **Hermes V1** — `hermesvm.framework`, bundle id `dev.hermesengine.iphoneos`, React Native 0.86 | Prebuilt binary, downloaded from Maven Central by the `hermes-engine` pod | **None** | **None** | The release artifact `hermes-ios-250829098.0.17-hermes-ios-release.tar.gz` (sha256 prefix `2967ee51b41bd433`) holds 116 entries, with no `PrivacyInfo.xcprivacy` and no `_CodeSignature`. The device slice holds only the binary and its `Info.plist`. The legacy Hermes 0.17.0 artifact has neither either |

**What follows from that, stated in proportion:**

- **Hermes is how React Native ships to every app that uses it.** The missing
  manifest and signature are upstream, not something this repository chose.
  What React Native does instead is write its core required-reason APIs into the
  *app's* own manifest (`privacy_manifest_utils.rb`, `get_core_accessed_apis`).
  Those are exactly the three entries this app's manifest carries. Hermes gets no
  manifest of its own, and the page does not say whether Apple accepts that for a
  listed binary SDK.
- **The only evidence of Apple's practice is that builds 24–27 uploaded and were
  processed.** That is TestFlight processing. Apple's sentence names
  *submission*, and no build of this app has been submitted for review yet.
- **What to check before the first submission:**
  1. Search the App Store Connect email for **`ITMS-91061`** (missing privacy
     manifest) and **`ITMS-91065`** (missing signature) against builds 24–27.
  2. On the next `.ipa`, look for `SDWebImage.bundle/PrivacyInfo.xcprivacy` and
     for any manifest inside `hermesvm.framework`.
  3. Re-read the list when the Expo SDK 58 upgrade lands, because the Hermes
     artifact changes with it.

  If Apple has flagged either SDK, that is a release blocker to raise before
  submitting, not after a rejection.

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
rejects foreign numbers at the hook).

**Guest browsing changes what a reviewer can reach without signing in, but only
from the build that carries it.** It was added for guideline **5.1.1(v)** on
2026-11-09 (PR "Let a signed-out customer browse the menu"):
- a guest can open the menu, choose a pickup branch, view products and fill a cart;
- an account is asked for only at checkout, for delivery (addresses are saved to
  an account), and on the Orders and Profile tabs. Each prompt returns the
  customer where they were after signing in.

**Every build installed before that one still opens on the login screen**, so a
reviewer outside Saudi Arabia cannot get past the first screen of those builds.
Either way, a reviewer still needs the test number below to place an order.

**Prerequisite, met 2026-11-11:** `20260930120000_product_variants_guest_read` is
applied (`MIGRATIONS.md` §52). Before it, Production refused a signed-out read of
the menu's price tiers, and a guest would have seen "Something went wrong" on the
home screen. A signed-out visitor to production `/app` now opens on the
order-type chooser.

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

**The next build is the first on Expo SDK 58 (2026-11-10).** Builds 23 to 27 were
SDK 57. SDK 58's EAS image is Xcode 27.1 with the iOS 27 SDK, and Apple requires
that from April 2027: *"iOS and iPadOS apps must be built with the iOS 27 &
iPadOS 27 SDK or later"* ([news, 9 September 2026](https://developer.apple.com/news/?id=k1mtkt1k)).
`eas.json` names no image, so read the build log to confirm which one ran. The
first SDK 58 build also needs `RELEASE_CHECKLIST.md` §7's added checks before it
reaches testers.

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
4. ~~**Confirm the build in TestFlight by INSTALLING it.**~~ **DONE.** Build 25
   was installed, then 26, then **27** on 2026-09-21 — each confirmed by use
   rather than by an API read, which is the only answer available here and the
   one that found a three-week outage the first time (item 2).
5. ~~**Flip `app_settings.variant_closing_enabled`**~~ — **DONE 2026-09-20
   07:47:05 UTC** on explicit owner approval. It reads `true`, nothing else
   moved, and both client roles were confirmed to read it by performing the
   select rather than checking the grant. `OWNER_ACTIONS.md` §40.3.
6. **Close a size and check checkout names it. STILL OUTSTANDING — and a draft
   of this list claimed it was done.** Of the six surfaces, two are confirmed
   (the app greys the size; admin push arrives — owner, 2026-09-20), two were
   observed BROKEN on 2026-09-20 and fixed by #408 without being re-tested (the
   branch console headline and the call-centre board), and two have never been
   observed at all: **checkout refusing by name**, and an item with every size
   closed reporting as unorderable.

   **The checkout row is the point of builds 25, 26 and 27** and is asserted from
   the code, never seen. The correction and how the false claim arose — a short
   "all works" read as covering a six-row test, against a live audit trail
   showing ZERO writes that day — are recorded in `OWNER_ACTIONS.md` §40.

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
does not count"*, `track: "internal"`) and iOS is TestFlight internal only.
Live: **6 distinct people have ever placed an order, 3
in the last 30 days** (40 orders in 30 days, 76 all time, last one 2026-09-16),
with 5 active push devices. Review's second finding on #406 asked for
"rollout/adoption" as the gate, which is the right instinct and the wrong unit
here: there is no public rollout to wait on, and the honest version of the rule
is a checkable list of testers rather than an adoption curve. **Re-measure
before relying on this — the moment either store goes to a public track, the
bound stops holding.**

**Corrected 2026-09-21: the citation above also listed `releaseStatus: "draft"`,
and that stopped being true the same day** — it is now `completed`. The claim it
supports is unaffected, because an internal track is not public distribution
whatever its release status. But the citation had stopped describing the file,
and a reader checking it would have found it false with no way to tell a stale
record from a wrong conclusion. There is a second-order point worth keeping: a
`completed` internal release is precisely the route by which a tester receives
build 25 instead of a draft nobody can install, so the change makes this
precondition easier to satisfy rather than harder. **A retraction that leaves its
own citations standing has not retracted anything** — the same defect recorded
against `OWNER_ACTIONS` §40.2, caught here in a different document.
7. **Enter the App Privacy answers** from §4 in the console.
8. **Enter the test information** from §6.
9. For **external** testing: the §7 Auth entry, then submit for Beta App Review.
10. **Before the first App Review submission, run the §5 checks** (added
    2026-11-10):
    - search the App Store Connect email for `ITMS-91061` / `ITMS-91065`
      against builds 24–27;
    - look for the SDWebImage and Hermes manifests in the next `.ipa`.
11. **Answer the two new age-rating descriptors** (§10) **by 12 January 2027**,
    and on any update submitted before then.
12. **Paste the review notes from §11**, with the switch values re-read on the
    day of submission.
13. **From April 2027, every submission needs iPhone Duo screenshots.** Apple's
    [5 October 2026 news post](https://developer.apple.com/news/?id=kkphp5qo)
    says: *"Starting April 2027, any apps or games submitted will need to include
    screenshots for iPhone Duo."* The app is iPhone-only
    (`supportsTablet: false`), and iPhone Duo is an iPhone, so this applies to
    the first submission if it falls after March 2027. Producing them needs the
    device in the simulator, which Xcode 27.1 adds.

**Not gating TestFlight, but gating an App Store release:** the §1
physical-device validation gate, which has run on neither platform.

---

## 9. Open questions

- **Does Apple's App Privacy accept "Product Personalization" for the push
  token** given promos are opt-out (CLAUDE.md §7)? The Play form forced
  "Advertising or marketing"; Apple's taxonomy differs and the honest answer may
  be "Third-Party Advertising: No, Developer's Advertising or Marketing: Yes".
  Decide before entering the form, and keep it consistent with C5.
- **Will Apple query B2 / guideline 4.5.4** — marketing push is opt-OUT here
  (owner decision 2026-08-20, risk accepted, re-confirmed 2026-11-09). Since
  2026-11-10 an in-app consent screen states it before the OS prompt, which is
  the "consent language displayed in your app's UI" the guideline names; the
  remaining question is whether Apple accepts offers coming on with the grant.
  If App Review rejects, the revert is one line: `promosEnabled: false` in
  `DEFAULT_DEVICE_PREFS`.
- **`supportsTablet: false`** — iPad screenshots are therefore not required, but
  confirm the App Store listing is iPhone-only before uploading assets.

---

## 10. Age rating — two new descriptors, due by 12 January 2027

**Opened 2026-11-10. The answers are entered by you in App Store Connect; this
section derives them from the code.** Apple announced on 2 November 2026
([news](https://developer.apple.com/news/?id=yxkh08us)):

> Starting November 16, 2026, App Store Connect will include new content
> descriptors … When completing the age rating questionnaire in App Store
> Connect, you'll need to declare whether your app includes:
>
> Shared Location: Sharing of real-world location with another person or group.
>
> Dating and Relationships: Features that enable dating or relationship
> connections between real people and/or a virtual companion that engages a user
> in sexual or romantic content.
>
> You must provide these declarations when submitting an app update or making
> changes to your age rating questionnaire. All apps must have these declarations
> completed by January 12, 2027.

| Descriptor | Answer | Why |
| --- | --- | --- |
| Dating and Relationships | **No** | Nothing in the app connects one person with another. There is no chat, profile or companion of any kind. |
| Shared Location | **No — recommended, and yours to decide** | Reasoning below. |

**Shared Location, read against what the code does.** The device's position is
read in three places, all while the app is open, and none of them sends it
anywhere:

- **Pickup tab:** sorts branches by distance on the phone
  (`OrderTypeSelectScreen.tsx:44`).
- **Checkout:** compares the position with the delivery pin, on the phone, to warn
  when they are far apart (`CheckoutScreen.tsx:260-266`, read only by
  `mismatchWarning`).
- **"Use my location" on the delivery map:** moves the pin to the device's
  position (`LocationPickerMap.tsx:217-226`).

**What does leave the phone is the delivery address:** the pin the customer
chooses, saved with the address and sent with a delivery order to the branch that
cooks and delivers it. That is the destination of an order, given to the business
fulfilling it. It is not a feature for showing someone's whereabouts to other
people: no live location is shared, no customer sees another's location, and the
app has no driver tracking.

**Why this is a decision rather than a fact.** Read literally, "with another
person" can be stretched to cover a delivery address. If you answer **Yes**:

- Apple says it *"may not have an impact on their minimum age rating in some
  regions."*
- The one region Apple names is **Brazil, which requires A16**. That stops
  mattering if App Store availability is limited to Saudi Arabia, which is on the
  owner checklist.

**Re-read the whole questionnaire while you are there.** Apple's
[upcoming-requirements page](https://developer.apple.com/news/upcoming-requirements/)
records that ratings moved to the new system (4+, 9+, 13+, 16+, 18+) and that
every app had to answer the updated questions *"by January 31, 2026, to avoid an
interruption when submitting your app updates"*. This app had not been submitted
by then. Its first submission is the moment the whole questionnaire gets checked,
not only these two lines.

---

## 11. App Review notes — name every feature a server switch controls

**Opened 2026-11-10.** Guideline **2.5.19** was added on 16 October 2026
([news](https://developer.apple.com/news/?id=92th7e5i)), and reads in full:

> Don't include any hidden, dormant, or undocumented features in your app; your
> app's functionality should be clear to end users and App Review. Attempting to
> hide undocumented features in your app binary, such as through code obfuscation
> or other methods, is grounds for removal of your app from the App Store and
> termination of your developer account.

This binary contains features that a database setting turns on and off without a
new build. None of them is hidden from a customer once it is on. But a reviewer
looking at the app on a given day sees only the ones that are on, and **card
payment is compiled in and switched off**, which is the case the guideline
describes. The safe reading is to name every switch in the review notes.

**Live values, read-only, 2026-11-10.** Re-read them on the day of submission:
they are switches precisely because they change.

| Feature | Switch | Live value | What a customer sees when it is on |
| --- | --- | --- | --- |
| **Card payment at checkout** | `app_settings.online_payment_enabled` | **off** | A card option beside cash. **Dormant.** Turning it on is under the payment freeze (CLAUDE.md §6) |
| Cash payment | `cash_payment_enabled`, `default_payment_method` | on, default `cash` | Pay when collecting, or on delivery |
| Payment outage mode | `payment_outage_mode_enabled` | off | Nothing. The app reads it (`mappers.ts:410`) and no screen uses it |
| Loyalty points | `loyalty_enabled` | on | Earn and redeem points |
| Loyalty on pickup only | `loyalty_pickup_only` | on | Delivery orders neither earn nor redeem |
| Points expiry | `loyalty_expiry_enabled` | off | An expiry date on the loyalty card |
| Points campaigns | rows in `loyalty_multipliers` | none | Extra points on chosen items or dates |
| Per-size availability | `variant_closing_enabled`, rows in `branch_variant_availability` | on, 1 closure | One size of an item shown as unavailable at a branch |
| Delivery, per branch | `branches.delivery_enabled`, `delivery_temporarily_closed` | 1 active branch; delivery on, not paused | Delivery offered, or paused for a while |
| Support contacts | `support_phone_enabled`, `support_whatsapp_enabled`, `support_email_enabled` | phone on, WhatsApp off, email on | The contact options in Profile |
| WhatsApp sign-in | `whatsapp_login_enabled()` | on | The sign-in form; when off, a "sign-in unavailable" card |
| Complimentary orders | active rows in `comp_members` | 2 accounts | For those accounts only, an order with nothing to pay |

**Paste-ready notes (English).** Adjust any line whose switch reads differently on
the day:

```text
Spicy Meal is the ordering app for Spicy Meal restaurants in Saudi Arabia.
Customers browse the menu, order for pickup or delivery, and pay in cash when
they collect or receive the order.

Some features are switched on or off from our server without an app update.
At the time of this submission:
- Card payment: the app contains a card-payment option at checkout. It is
  switched OFF, and no customer can use it. Customers pay cash.
- Loyalty points: ON, earned and redeemed on pickup orders. Points do not
  expire; expiry is switched off.
- Availability: a branch can mark an item, or one size of an item, as
  unavailable, and can pause delivery for a while.
- Support: the phone, WhatsApp and email contacts in Profile can each be shown
  or hidden.
- Complimentary orders: a small number of accounts we choose can receive orders
  at no charge.

Sign-in is by a one-time code sent to the customer's WhatsApp. Reviewer access
is described under Sign-In Information.

Push notifications carry order updates and occasional offers. Offers can be
turned off in Profile > Notifications.
```

**When the build submitted carries guest browsing (#424), add one line** saying
the menu can be browsed without an account and sign-in is asked for at checkout.

**The practice this record adopts** (from the 2026-11-09 compliance plan):

- A dormant feature is turned on for customers only together with a submission
  whose notes declare it.
- For card payment, that is in addition to the freeze, not instead of it. Nothing
  in this section changes any payment setting or behaviour.
