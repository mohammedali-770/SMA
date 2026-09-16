# Google Play submission — the record, and the route to production

> **Read the dates.** This document mixes two kinds of fact and they age
> differently.
>
> **Dashboard state** — track status, what has been uploaded, what has been
> declared — is true only on the date beside it. Play Console changes without
> touching this repository, and CLAUDE.md §14 warns specifically against carrying
> a dated dashboard fact forward as though it were current. Every such fact below
> carries its reading date.
>
> **Durable fact** — why an answer was given, what a declaration is coupled to,
> what a measurement method can and cannot prove — stays true until the thing it
> describes changes. Those are the parts worth reading before you change loyalty,
> payment or the menu.
>
> **Assembled 2026-09-16**, from a Play Console session that took the app from
> nothing to a Draft record with an active internal-testing track. Most of the
> reference material below moved here verbatim from `OWNER_ACTIONS.md` §38, which
> had grown into a 461-line reference inside a file that describes itself as "a
> current decision register, not an incident diary". §38 keeps the owner actions
> and points here.

---

## 1. Where this stands — read 2026-09-16

| Track | State |
| --- | --- |
| Production | Inactive |
| Open testing | Inactive |
| Closed testing | **Inactive** — and this is the one that matters, see §2 |
| Internal testing | **Active · Not reviewed** |

The app record is still a **Draft app** carrying the temporary name
`sa.com.spicymeal.app (unreviewed)`, because the store listing is incomplete.

**What exists:** the app record, package `sa.com.spicymeal.app`, one AAB uploaded
to internal testing, and the declarations in §§6-10 answered.

**What does not:** a completed store listing (§11), any closed test, and
therefore any route to production.

### The uploaded bundle is current, and that is measured

`v1.0.0`, versionCode 2, built from commit `f82cecb`, `targetSdkVersion 36`.

Nothing under `apps/mobile/` has changed on the default branch since that commit:

```
git diff --name-only f82cecbe origin/claude/project-build-ie4b56 -- apps/mobile/
  (no output)
```

So the bundle carries every mobile change on the branch, including #377's cash
payment selector. The commits after it touch the web legal pages, the Play icon,
store assets and documentation only. **Re-run that command before trusting this
paragraph** — it is a one-line check and it is the whole evidence.

---

## 2. THE GATE — a personal developer account cannot publish to production yet

This is the single most consequential fact about the release, and until
2026-09-16 the repository did not mention it anywhere. A repo-wide search for
"closed test", "12 test", "14 days", "production access" and "tester" returned
nothing relevant, while §38's steps assumed Production was reachable and did not
even name which track to upload to.

**The account is a personal developer account.** Google's requirement, quoted
rather than paraphrased
([Play Console Help, answer 14151465](https://support.google.com/googleplay/android-developer/answer/14151465)):

> a minimum of **12 testers** who have been opted in **continuously for at least
> 14 days**

on the **closed testing** track, after which you "Apply for production" — a
three-part form covering the closed test, the target audience, and what changed
as a result — whose review "usually takes seven days or less". **The production
track stays disabled until that is met.**

**Internal testing does not count.** That is the trap: internal testing is Active
and looks like progress toward production. It is not. The clock runs on the
closed track only, and the closed track is Inactive, so **the clock has not
started**. From here the realistic floor is about **three weeks** — 14 days of
testing plus up to 7 days of review — not days.

**One input is still unknown and it decides whether any of this applies.**
Accounts created **before 13 November 2023 are exempt**. Check the account's
creation date; if it predates that, §2 does not bind and production is reachable
as soon as the listing is complete.

### What this means for `eas.json`

`apps/mobile/eas.json`'s `submit.production.android` carried
`{ "track": "internal", "releaseStatus": "draft" }`. Both values are wrong for
this path, and neither fails loudly:

- **`track: "internal"`** puts every automated submission on internal testing,
  which does not count toward the requirement. You could run it for a month and
  be no closer to production.
- **`releaseStatus: "draft"`** is not distributed to testers at all, so even on
  the right track it would not start the clock. Testers need a `completed`
  release.

**`eas.json` IS UNCHANGED, and an earlier draft of this paragraph claimed
otherwise.** It said "the file now carries a comment saying so". It does not, and
Codex caught the false claim on #385 by reading the file. The correction is worth
more than the sentence it replaces: a document asserting a safeguard that is not
there is worse than one that admits the gap, because the next reader stops
looking.

**Nothing is changed there yet, deliberately.** `track: "internal"` is correct
for the track actually in use today, and wrong only for the closed track — which
does not exist yet. **Do not hardcode a replacement from memory:** Google's own
API documentation says closed tracks "are created manually and they have custom
names", so `alpha` is only the legacy well-known one and may not be what your
track is called. Create the closed test in Play Console, read the track name it
gives you, then set `track` to that and `releaseStatus` to `completed`.

The reasoning could not live in the file either — `eas.json` is JSON and comment
support is undocumented for it, so a `//` key is a guess. It lives here and as a
`RELEASE_CHECKLIST.md` §8 checkbox instead.

Running a submit is an owner-approval action under CLAUDE.md §5 regardless; the
change itself is configuration only.

---

## 3. The uploaded artefact

*Moved verbatim from `OWNER_ACTIONS.md` §38. Detail and the permission surface:
`GO_LIVE_READINESS.md` C1 and C7.*

### The artefact is fine, and that was measured rather than assumed

The AAB was downloaded from EAS (`v1.0.0`, versionCode 2, commit `f82cecbe`,
84,044,112 bytes) and its manifest decoded from aapt2 protobuf. Everything Play
checks mechanically passes: `targetSdkVersion 36` (which is the 2026 requirement for a new app, met exactly — see C1),
`minSdkVersion 24`, no `android:debuggable`, no `android:usesCleartextTraffic`
(so targetSdk 36's secure-by-default holds), `android:allowBackup="false"`, four
ABIs. Detail and the permission surface: `docs/GO_LIVE_READINESS.md` C1 and C7.

**None of the permissions that trigger a Play Permissions Declaration Form are
present** — checked by name, not by absence of worry: no SMS or Call Log, no
`MANAGE_EXTERNAL_STORAGE`, no `QUERY_ALL_PACKAGES`, no
`REQUEST_INSTALL_PACKAGES`, no `ACCESS_BACKGROUND_LOCATION`, no `CAMERA`, no
`RECORD_AUDIO`, no `READ_CONTACTS`. There is also **no `AD_ID` permission and no
advertising SDK** — the only Google Play Services components in the manifest are
`cloudmessaging` and `common.api`. So the advertising-ID declaration is "no".


---

## 4. A reviewer must be able to sign in — RESOLVED 2026-09-16

*The subsection below moved verbatim from §38. It ends with an open question and
a measurement recipe. **Both are now settled, and the answer is in §4a.** Read
the recipe as history rather than as instructions — §4b explains why running it
today would give the wrong answer.*

### THE ONE THAT WILL GET YOU REJECTED IF NOTHING ELSE DOES: a reviewer cannot sign in

This is the same problem §27 solved for Apple, and it applies to Google
identically — but §27 is written entirely in App Store Connect terms, so it would
have been easy to read it as handled and discover otherwise.

**The whole app is behind the login wall.** `apps/mobile/src/app/index.tsx:21`
redirects to `/(auth)/login` unless `status === 'signed_in'`, and
`app/(tabs)/_layout.tsx:41` re-redirects any signed-out session that reaches the
tabs. There is **no guest or browse-only mode** — searched for and found nothing.

**And login is Saudi-mobile-only, enforced on both sides of the wire.** The
client rejects a foreign number (`apps/mobile/src/lib/phone.test.ts:52` pins
`toSaudiE164('+14155552671') === null`) and so does the server
(`supabase/functions/_shared/whatsapp.ts:49`, "anything else — foreign numbers
included — is rejected"). A reviewer in Mountain View cannot type their own
number, and cannot receive a WhatsApp code sent to a Saudi one.

A Play reviewer who cannot get past the first screen files this under **App
functionality / broken or incomplete**, and the first submission fails.

**The fix is already decided and needs no code: §27's Supabase Auth test-OTP
number.** Do that step once and it serves both stores. Two Play-specific notes on
top of §27:

- Play's field is **App content → App access → "All or some functionality is
  restricted"**. Add an instruction with the demo phone number and code in the
  *Username*/*Password* fields, or in the instructions box;
- Play keeps the credentials on the app record and reuses them for **every**
  future review, so §27's removal step matters more here than on iOS: deleting
  the Auth entry while Play still holds the credential means the next update is
  reviewed against a login that no longer works.

**AND ONE THING §27 ASSERTS HAS NOT BEEN VERIFIED FOR A HOSTED PROJECT.** §27
quotes Supabase — *"When a test phone number requests an OTP, the Auth service
skips SMS delivery and accepts only the mapped code"* — and that sentence comes
from the **self-hosting** guide (the `SMS_TEST_OTP` / `SMS_TEST_OTP_VALID_UNTIL`
environment variables). Whether the hosted dashboard's test-phone-numbers feature
also short-circuits a **custom Send SMS Hook** — which is what this project uses,
because the OTP goes out over WhatsApp rather than SMS — is not documented for
the hosted product and is not established here.

**This is the same trap §27 already fell into once.** That section recorded a
correction on 2026-09-03 for exactly this: it had told you to set an expiry that
turned out to be a self-hosting environment variable. This is the second sentence
on the same page quoted as hosted behaviour.

**It is cheap to settle by measurement, and it must be settled before you
submit.** Baselines read live 2026-09-15: `whatsapp_message_logs` holds **30**
rows (newest 2026-08-21 14:24:47Z) and `otp_send_reservations` holds **0**. After
the single confirmation sign-in in §27 step 3, re-read both. **Unchanged means
the hook really was bypassed and the mechanism works.** If either moved, the hook
ran — the test number is being delivered over WhatsApp like any other, a reviewer
still cannot receive it, and the plan needs rethinking before submission rather
than after rejection.

The review-notes text in §27 is written for Apple but transfers with the first
sentence dropped. **Do not put the code in this repository** (§9) — the number
may be recorded, the code may not.


### 4a. The hosted test-OTP feature DOES bypass the custom hook — proven

§38 flagged that Supabase's sentence about test phone numbers comes from the
**self-hosting** guide, and that whether the hosted dashboard's feature also
short-circuits a **custom Send SMS Hook** was undocumented and unestablished.
It is now established, and the answer is yes.

**The evidence is a correlation, not a count.** Read live 2026-09-16, one auth
user signed in without any outbound message being sent:

| What | When (UTC) |
| --- | --- |
| auth user `+9665…00` created | 2026-09-15 11:21:50 |
| same user `last_sign_in_at` | 2026-09-15 11:21:54 |
| `otp_send_reservations` row for that number | **none — no row exists** |
| `whatsapp_message_logs` row for that number | **none — no row exists** |

A reservation is written inside the hook, before the send. **No reservation means
the hook never ran**, and the sign-in completed four seconds after the user was
created. That is the bypass working exactly as the mechanism requires: the Auth
service accepted the mapped code and never called out.

The contrast in the same table makes it sharper. Every number that went through
the hook left both rows, paired within two seconds:

| Reservation | WhatsApp send | Number |
| --- | --- | --- |
| 2026-09-15 11:53:30 | 11:53:32 | `+9665…78` |
| 2026-09-15 11:54:55 | 11:54:56 | `+9665…55` |
| 2026-09-16 04:47:16 | 04:47:18 | `+9665…45` |

**So X1 and B6 are closed on evidence**, not on intent. A Play or App Store
reviewer given the test number will get past the login wall.

Numbers are masked here deliberately. CLAUDE.md §9 forbids the code in this
repository; the number is not recorded either, and the masked prefixes plus the
timestamps are the whole evidence without disclosing anything usable.

**Two orphaned auth users are visible in that data and are worth a glance, not
an action:** `+9665…78` and `+9665…55`, created 2026-09-15, both with
`last_sign_in_at` null and zero orders — OTPs requested over WhatsApp and never
verified. Housekeeping, not a blocker.

### 4b. The recipe above is now UNUSABLE, and that is the transferable lesson

§38 told you to baseline two counters — `whatsapp_message_logs` at **30** rows,
`otp_send_reservations` at **0** — sign in once, and re-read them: unchanged
meant the hook was bypassed.

**Run that today and it says the mechanism is broken.** Both counters have moved
— 33 and 3 — because real sign-ins happened afterwards, including the owner's own
at 04:47 on 2026-09-16. The counters are shared with ordinary traffic, so they
only carried meaning inside a quiet window that has since closed. A later reader
following the recipe in good faith would conclude the opposite of the truth.

**A counter is only evidence while nothing else can move it.** Where a durable
answer is needed, correlate the specific rows instead: for this question, "a
completed sign-in with no paired reservation" is true whenever it is true, and no
amount of unrelated traffic can spoil it. That is what §4a measures, and it is
why §4a will still be checkable next year.


---

## 5. The privacy-policy blocker — corrected in the database, stale on the page

**`privacy_policy` v2.3 is live as of 2026-09-16.** It names Google for the map
and **Apple for the iPhone reverse-geocode**, in both languages. v2.2, half an
hour earlier, named only Google and claimed an "address search" customers do not
have — that phrasing described the admin console, not either customer channel. The deciding fact came from
`eas env:list --environment production`: `EXPO_PUBLIC_MAP_PROVIDER=google`, with
**zero Mapbox variables** in that environment, so `OWNER_ACTIONS.md` §34's
Option A (Google only) was the right text. §34 had recorded that variable as
"not readable from a session"; it is readable, and that claim is now corrected.

**IT IS NOT FINISHED, AND THE REASON GENERALISES TO EVERY FUTURE LEGAL EDIT.**
B7's prerender plugin is `apply: 'build'` — it fetches the documents during
`vite build` and bakes them into `legal.html`. The database edit therefore
reaches the app and any browser with JavaScript, and **does not reach a
no-JavaScript client until the site is rebuilt**. Measured on the deployed page
straight after publishing: still `v2.1 · 2026-09-08`, still the Mapbox line,
byte-identical response size.

**Play's policy checker is a no-JavaScript reader.** So the contradiction between
your Data Safety declaration and your published policy is still live as far as
Google is concerned, until a Vercel production rebuild — an owner action under
§13.

**The rule to carry:** a legal correction is two steps, not one. Publish the row,
then rebuild. B7 fixed "no content without JavaScript" and quietly replaced it
with "content without JavaScript is frozen at the last deploy".

*The original framing, kept because the ordering lesson in it still stands:*

*Moved verbatim from §38. This is `OWNER_ACTIONS.md` §34, and publishing the
correction is a §5 live write needing its own approval. Do it **before** filling
in the Data Safety location rows, not after.*

### A SECOND BLOCKER: the live privacy policy names the wrong map provider, and Google cross-checks

Play compares the Data Safety form against the privacy policy you link, and a
contradiction between them is a rejection reason in its own right. There is one,
and the production AAB settles it rather than leaving it arguable.

**Live `privacy_policy` v2.1 says the map is Mapbox.** The shipped binary says
otherwise, measured on `base/assets/index.android.bundle`:

- `pk.eyJ` (the Mapbox public-token prefix) — **0 occurrences**;
- `maps.googleapis.com` — **present**, together with an `AIza…` Google key;
- the only Mapbox strings are dead constants left in the Hermes string table
  (`mapbox://styles/mapbox/streets-v12`, `MAPBOX_PUBLIC_TOKEN_REFRESHED`) — and
  **with no token in the bundle, no request to Mapbox can be made**, so no
  customer data reaches them.

So the app processes delivery-pin coordinates through **Google Maps Platform**
while telling customers it uses Mapbox. That is a live document naming the wrong
sub-processor for precise location data — the most sensitive type this app
collects.

**This is §34, and this section upgrades its urgency rather than restating it.**
§34 has been an open correction with the replacement text already drafted
(`docs/legal/PRIVACY_POLICY_MAP_PROCESSOR_CORRECTION.md`). It was a
documentation-accuracy item; **for the Play submission it is a blocker**, because
you cannot truthfully complete the Data Safety location rows while the linked
policy names a processor the app does not use.

Publishing it is a §5 live write (editing a `legal_documents` row) and needs its
own approval. Do it **before** filling in the Data Safety form, not after.


---

## 6. Data Safety

*The data-type table below moved verbatim from §38. It is the durable half — each
row is derived from the schema and the code, with citations. §6a records the
answers the table does not carry, which were given in the Console on 2026-09-16.*

### Data Safety — answers derived from the schema and the code, not from memory

Play will not let you publish without this form, and it is the one that is
tedious to answer honestly under time pressure. These answers are derived from the
live `public` schema and the client code; the evidence column is what to re-check
if anything changes.

| Play data type | Collected | Leaves our systems to | Purpose | Evidence |
| --- | --- | --- | --- | --- |
| Name | Yes, **OPTIONAL** | POS | App functionality, Account management | `profiles.full_name`, `orders.customer_name`; sent at `supabase/functions/lazywait-sync/index.ts:323`. **This row said "required" and that was wrong — measured live 2026-09-15:** `profiles.full_name` is nullable and **3 of 9** profiles have none; `orders.customer_name` is nullable and **19 orders carry no name at all**. The POS payload substitutes `'Guest'` (`lazywait-sync/index.ts:323`). Declaring it required would have been a false Data Safety answer about the one field easiest to check |
| Phone number | Yes, **required** | POS, Meta | App functionality, Account management | `profiles.phone_number`, `orders.customer_phone`, `otp_challenges.phone_e164`; POS at `lazywait-sync/index.ts:333`, Meta receives it to deliver the OTP template |
| Email address | Yes, **optional** | — | Account management | `profiles.email`, written only by `apps/mobile/src/features/profile/profileService.ts:10`, `email \|\| null` — it is an optional field on the profile screen, never required to order |
| Address | Yes, optional (delivery only) | POS | App functionality | `addresses.description`, `.national_short_address`; the POS gets `address_snapshot`, not a join, at `lazywait-sync/index.ts:339` |
| Precise location | Yes, optional | — | App functionality | `addresses.latitude/longitude`; `ACCESS_FINE_LOCATION` is genuinely used — `apps/mobile/src/components/LocationPickerMap.tsx:226` requests `Accuracy.High` (see C2) |
| Approximate location | Yes, optional | — | App functionality | `ACCESS_COARSE_LOCATION` |
| Purchase history | Yes | POS | App functionality | `orders`, `order_items` |
| User IDs | Yes | — | App functionality, Account management | `profiles.id` |
| Other user-generated content | Yes, optional | POS | App functionality | `orders.notes`, `order_items.note` — free-text order notes are printed on the ticket |
| Crash logs | Yes, **REQUIRED** | Sentry | Diagnostics | `Sentry.init` at `apps/mobile/src/lib/observability/index.ts:94`. **Required, not optional: there is no user opt-out** — `config.ts`'s `isSentryEnabled` returns `true` for every non-development environment that has a DSN, and `eas.json` sets `EXPO_PUBLIC_SENTRY_ENV=production`, so it is on for every customer |
| Diagnostics | Yes, **REQUIRED** | Sentry | Diagnostics | same, with `tracesSampleRate` sampled; same absence of an opt-out |
| Device or other IDs | Yes, **REQUIRED** | Expo, then FCM/APNs | App functionality **and Advertising or marketing** | `push_devices.expo_push_token`. **The marketing purpose is not optional to declare:** since the 2026-08-20 opt-OUT decision, `DEFAULT_DEVICE_PREFS` sets `promosEnabled: true`, so a device that grants notification permission is registered into the promotional audience without any further action (§7). Declaring only "App functionality" would understate it |
| **Payment info** | **NO** | — | — | Launch is cash-only; no card number, expiry or CVV is ever collected or stored. `payment_method` records *how*, not an instrument |
| **Advertising ID** | **NO** | — | — | No `AD_ID` permission and no ads SDK in the AAB |

**Sentry is configured not to send PII — but "no PII" is too strong, and the
precise version matters for the form.** `sendDefaultPii: false` with a
`beforeSend` scrubber, on native (`observability/index.ts:106,116`) and on web
(`webCore.ts:125,145`). **What it does keep is the pseudonymous user id:**
`sanitize.ts:223-226` reduces `event.user` to `{ id }` and drops every other
field. So crash reports are linkable to an account, which is exactly why "User
IDs" is declared above and why the Sentry rows say REQUIRED.

**The "Shared" column is deliberately NOT answered here, and that is a
correction rather than an omission.** This table's first version marked all four
vendor transfers as **"Yes — shared"**, reasoning that Play defines sharing as
transfer to a third party. That reasoning is incomplete and review caught it
(#380).

**Play's Data Safety guidance excludes transfers to a service provider that
processes the data on the developer's behalf.** Four vendors receive customer
data — the POS (Lazywait) gets name, phone, address snapshot and order contents;
Meta gets the phone number to deliver the OTP template; Expo and then FCM/APNs
get the push token; Sentry gets crash and performance data — and **every one of
them is plausibly a processor rather than a recipient**, which is how this
repository already describes them elsewhere. Answering "shared: yes" for all four
would have contradicted our own privacy documentation inside the form that Play
cross-checks against it.

**So the transfer is the measured fact and the classification is not.** The
column above says where data goes, which is provable from the code. Whether each
transfer is "sharing" in Play's sense depends on the processing role and the
contract with each vendor — a determination for you and, where the DPAs are
unclear, for counsel. **Do not answer that column from this document.**

**The one thing that IS safe to say:** under-disclosing is the dangerous
direction. If a vendor's processor status cannot be established before you
submit, declare the transfer as shared rather than guessing it away — an
over-disclosure is an inaccuracy, an under-disclosure is an enforcement matter.

Two boxes are unambiguous: **encrypted in transit** — yes, everything is HTTPS
to Supabase; **users can request data deletion** — yes, and the URL is below.


### 6a. The answers the table does not carry — given 2026-09-16

| Console question | Answer | Why |
| --- | --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** | The table above; eleven types are collected |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | Everything is HTTPS to Supabase; no cleartext path exists, and the AAB carries no `android:usesCleartextTraffic` |
| Which methods of account creation does your app support? | **Phone number** only | There is no email/password, no social sign-in and no guest mode. Login is WhatsApp OTP to a Saudi mobile, enforced client and server side |
| Do you provide a way for users to request that their account and data be deleted? | **Yes**, with the URL in §7 | Both routes exist: in-app (Profile → Account settings → Delete account) and the public URL Play requires |
| Do you provide a way to request that *some* data be deleted without deleting the account? | **Yes** | `export_my_data()` and the account-deletion request path; see `GO_LIVE_READINESS.md` A6 |

**One correction is worth keeping because the mistake is easy to repeat.** The
purposes list was first answered with **Diagnostics** for the Sentry rows.
Diagnostics is a **data type** in Play's vocabulary, not a purpose; the purpose
for those rows is **Analytics**. The two words appear on adjacent screens and
Play accepts either without complaint, so nothing would have flagged it.

**The "Shared" column is still deliberately unanswered**, exactly as the table
above says. During the Console pass it was first answered "Yes — shared" for all
four vendor transfers, which is wrong in Play's vocabulary: Play excludes
transfers to a **service provider** processing on the developer's behalf. The
column was left to counsel rather than guessed in either direction. Under-
disclosing is the dangerous direction; over-disclosing is merely inaccurate.


---

## 7. The deletion and policy URLs

*Moved verbatim from §38, with one correction and one new finding below it.*

### The data-deletion URL, verified end to end

Play requires a **web** URL where a user can request account deletion without
reinstalling the app. It exists and was checked live on 2026-09-15 rather than
assumed from the route table:

**`https://app.spicymeal.com.sa/legal/account-data-deletion`**

**`HTTP 200`, and it serves the policy text — USE IT.** Measured on the deployed
page after `71306f1` shipped: **36,775 visible characters** with `<script>`
stripped, carrying "Privacy Policy", "personal data", "Account & Data Deletion",
«الخصوصية» and the support address. `/privacy`, `/terms`, `/support` and this URL
all return the same figures. Paste them into Play with no caveat.

### This URL was a BLOCKER for five days, and the reason is worth more than the fix

**Kept as history, not as instruction — nothing below this heading is still
outstanding.** Until 2026-09-15 the page was client-rendered: the same fetch,
with scripts stripped, returned **253 visible characters** saying the documents
*"are loaded from our servers and need JavaScript enabled"*, in which the word
"privacy" appeared **zero** times. Play's policy-URL validation does not execute
JavaScript, so a required privacy policy read as missing.

**`docs/GO_LIVE_READINESS.md` B7 was ✅ throughout, on evidence that did not cover
it** — HTTP status, byte count, `<title>`, and a working anonymous PostgREST
read. **Every one of those checks still passes today.** They were not failing;
they were checking the wrong thing.

**This section made the same mistake one level up, in the paragraph immediately
above.** It called the deletion URL "verified end to end" because the route
resolved *and* the anonymous data read succeeded — two halves of a chain, neither
of them the half Google looks at. Checking more of the wrong thing is not
checking the right thing.

Fixed by pre-rendering the documents into `legal.html` at build time (#381), and
closed against the deployed response rather than the merge (#382).



In-app deletion also exists, which Play requires alongside the URL:
Profile → Account settings → Delete account
(`apps/mobile/src/features/profile/AccountSettingsScreen.tsx:115`).

The other listing URLs are unchanged from B7: privacy
`https://app.spicymeal.com.sa/privacy`, support `/support`, terms `/terms`.


### 7a. Every legal URL serves the same snapshot — verified 2026-09-16

§38 lists `/privacy`, `/terms`, `/support` and `/legal/account-data-deletion` as
though each served its own document. Without JavaScript they do not: all four
return a **byte-identical** response — the same 55,243 bytes — containing the
build-time snapshot of **every** legal document. Only the JavaScript view selects
one.

This is good news for the submission and worth knowing anyway. The deletion URL
genuinely serves deletion text to a client that runs no JavaScript, which is what
Play's checker is, and so does the policy URL. But **the policy URL is not
document-specific**, so do not describe it as "the privacy policy page" in a
context where that distinction matters.

### 7b. The recorded character count could not be reproduced — do not "fix" it

§38 and `GO_LIVE_READINESS.md` B7 both record **36,775** visible characters with
`<script>` stripped. Measuring the same page on 2026-09-16 gives **36,855**, and
three different stripping variants agree on that, so it is not a method
difference.

**Neither number should be trusted, and the reason generalises.** `legal.html`
contains a CSS comment inside `<style>` with the literal text `inline <script>`
— the comment explaining why the snapshot is revealed by `<noscript>` rather than
by a script. A regex-based `<script>…</script>` strip matches *that* opening tag
and runs to the real module script's closing tag, silently deleting a block of
markup from the count. The same false match briefly suggested the page carries
**two** script tags and had regressed against its CSP; it carries exactly one and
it has a `src`, so B7's claim holds.

**Re-measure with a real HTML parser before changing either figure.** Anyone
re-verifying B7 the obvious way — a regex — will get a wrong answer on this
specific page, and will not be able to tell.


---

## 8. Content rating questionnaire — answered 2026-09-16

Until now the repository said this "was not audited here" and was "a set of
declarations only you can make". It has been answered. The answers below are the
record; **where a question could not be reconstructed with confidence it says so
rather than guessing**, and Play Console shows the completed questionnaire, so
those can be read back rather than re-derived.

| Question | Answer | Why |
| --- | --- | --- |
| Violence | **No** | No violent material of any kind |
| Sexuality / nudity | **No** | None |
| Language | **No** | No offensive language; the menu and UI copy are the only text |
| Controlled substances | **No** | No references to or depictions of drugs or alcohol |
| Promotion or sale of age-restricted products | **No** | Food only. No tobacco, alcohol, gambling or similar |
| **Online content** | **YES** | See the correction below — this one was answered wrongly first |
| User content sharing | see below | Customers can attach a free-text note to an order and to individual items; those notes reach the kitchen and the POS, not other customers |
| Miscellaneous (five questions) | not reconstructed | Read back from Console |
| Category | not reconstructed | Read back from Console |
| Target age group | see §10 | |

### The one that was answered wrongly first, and why the wrong answer was tempting

**Online content was first answered "No"**, reasoning that the app shows no
user-generated feed, no browser and no third-party media. That is the wrong test.
Google's own example for this question is *"product listings in the Amazon
Shopping app"* — content fetched after install, which the publisher controls but
which is not part of the download. **The menu is exactly that**: products,
prices, descriptions and photography served from Supabase and changed without a
release. The answer is **Yes**.

Getting this wrong is not cosmetic. The rating is issued on the answers, and a
questionnaire that misdescribes the app is grounds for the rating being revoked
later — which pulls the listing.

### A false positive worth recording, because the pattern recurs

While checking the controlled-substances answer, a scan of the live menu flagged
one product as matching an age-restricted term. It was **"D*rum* Stick"** —
the substring `rum` inside an ordinary chicken product. There is no alcohol on
the menu.

That is the same class of error as the `<script>` inside a CSS comment in §7b,
and as a Firebase-analytics string in the app bundle that turned out to be an
inert stub (§14). **Three times in one session, a substring match was mistaken
for evidence.** A match is a place to look, never a finding.


---

## 9. App content declarations — answered 2026-09-16

| Declaration | Answer | Why |
| --- | --- | --- |
| App access | **All or some functionality is restricted** | The whole app is behind the login wall; the test-number credentials go here. See §4 |
| Ads | **No ads** | No advertising SDK, no `AD_ID` permission — checked by name in the AAB |
| **Financial features** | **Rewards, points, frequent flier miles, and other incentives** | See below — this was answered wrongly first |
| Health features | **None** | See below — this was answered wrongly first |
| Government apps | **No** | Not a government app and not published on behalf of one |
| Human subjects research | **No** | |
| Support services | recorded under **Other** | Not a dating, medical, financial or similarly regulated service |
| Tags | descriptive only | Food and drink ordering |
| Data safety | §6 | |
| Content rating | §8 | |
| Target audience | §10 | |

### Financial features — "none" was wrong

The first answer was **none**, on the reasoning that the app takes no payment
online: payment is cash on pickup or delivery, and card payment is frozen under
CLAUDE.md §6.

That reasoning is about *payments*, and the question is broader. The option list
explicitly names **"Rewards, points, frequent flier miles, and other
incentives"**, and this app runs a loyalty points scheme: points are earned on
pickup orders and redeemed as a discount at checkout. That is a financial feature
in Play's sense whether or not money moves through the app.

**This declaration is coupled to loyalty.** If loyalty is ever removed, this
answer changes. If online payment is ever enabled, a *second* financial feature
applies and this answer changes again — see the coupling table in §11.

### Health features — the tick that should not have been there

**"Disease prevention and public health"** was ticked at one point and removed.
The app is a restaurant ordering app; the allergen notice
(`allergen_food_notice` v2.1) is consumer food-safety information, not a health
feature in Play's sense. Declaring a health feature invites a review standard
this app should not be measured against.


---

## 10. Target audience and the AI asset declaration — answered 2026-09-16

### Target audience

The app targets **adults**, and the "restrict minors" option was taken. It is a
food-ordering app with no content directed at children, and it takes delivery
addresses and phone numbers — data you do not want to be collecting from a child
under a children's-privacy regime.

### AI asset declaration — "Don't label assets"

Play asks whether the listing's assets were created or edited using AI. The
answer given is **Don't label assets**, and the reasoning matters more than the
answer because the answer flips if the inputs change.

Every pixel in the listing is one of three things:

| Asset | Origin |
| --- | --- |
| App icon 512×512 | An exact 2:1 box downscale of the existing brand master — arithmetic, nothing invented |
| Feature graphic 1024×500 | The brand mark composited on a flat cream fill |
| Screenshots 1-5 | Device captures of the running app, cropped and placed on a canvas |

Scripts did the resizing and compositing, but a resize is not a generated asset.
The declaration is about **generative** AI — imagery a model produced — and there
is none.

**The answer rests on one input the repository cannot verify: the menu
photography.** Screenshots 2 and 4 show four product photos uploaded by the owner
(§12). The owner confirmed on 2026-09-16 that these are **real photography**,
which is what makes "Don't label assets" correct.

**If menu photography is ever generated, this declaration must be revisited** —
the answer becomes "Label assets as created or edited using AI", tagging the
screenshots that show the generated images. Nothing in CI can detect this; it is
a question to ask whenever product images change.


---

## 11. The store listing

**The copy lives in [`store/LISTING_COPY.md`](store/LISTING_COPY.md), not here.**
Two reasons: ten kilobytes of verbatim Arabic and English in the middle of a
procedure makes the procedure unreadable, and — more importantly — the ownership
rule that couples the copy to the behaviour it claims needs its own document to
point at. `docs-check-ownership.mjs` satisfies a rule when **any** listed
document is touched, so if the copy's rule named this file, editing the tablet
paragraph would discharge a loyalty-copy obligation. Separating them is what
makes that rule honest.

### Asset inventory — read 2026-09-16

| Asset | State | Where |
| --- | --- | --- |
| App icon 512×512 | ✅ committed, CI-checked | `assets/store/play-icon-512.png` |
| Phone screenshots ×5 | ✅ committed, CI-checked | `assets/store/screenshots/` |
| Feature graphic 1024×500 | ✅ committed, CI-checked | `assets/store/play-feature-graphic-1024x500.png` |
| Short + full description, ar/en | drafted, not entered | `store/LISTING_COPY.md` |
| Release notes, ar/en | drafted, not entered | `store/LISTING_COPY.md` |
| App category | not set — Console-only field | Play Console |
| **App name** | **temporary** — Console-only field | Play Console |

The **App name** is a Console field in its own right, independent of
`app.json`'s name and of anything in the AAB. It is what a customer sees in
search results, and the Console currently holds
`sa.com.spicymeal.app (unreviewed)`. It has never been tracked anywhere in this
repository.

### Two of these blockers are now FIXED — the legal pages LIVE, the icon committed (2026-09-15)

**The 512×512 store icon exists.** Play takes an icon upload rather than reading
it out of the AAB, and every icon in this repository was 1024×1024 — the largest
inside the bundle is a 432×432 adaptive foreground — so the listing could not be
saved at all. `scripts/build-play-icon.mjs` generates
`assets/store/play-icon-512.png` from the same approved master by an exact 2:1
box reduction, and `npm run play-icon:check` guards it in CI beside `logo:check`,
so a re-exported master cannot leave the store icon showing last year's artwork.

Two details worth keeping. The averaging is done in **premultiplied alpha**: the
master is fully opaque today (the script asserts it, because Play wants an opaque
icon and `adaptive-icon.png` — 48% transparent — is the wrong file to reach for),
so premultiplying changes nothing now and is correct the moment a master has soft
edges. And the PNG codec moved to `scripts/lib/png.mjs` rather than being
duplicated; `logo:check` compares generated output byte-for-byte against the
committed assets, so its passing is the proof the extraction was lossless.

**The legal pages now serve their text without JavaScript.** See B7. Built
against Production, the strip-`<script>` measurement goes **253 → 36,775 visible
characters**. **LIVE and verified 2026-09-15** — measured on the deployed page after
Vercel shipped `71306f1`, not inferred from the merge: all four legal URLs return
36,775 visible characters with scripts stripped, the page carries exactly one
`<script>` and it has a `src`, and that was checked against the CSP the server
actually sends rather than the one `vercel.json` declares. The policy URL to give
Play is `https://app.spicymeal.com.sa/privacy`.

**One thing from that work is worth carrying beyond it.** The snapshot was first
hidden by an inline `<script>`, and `vercel.json` sets a CSP with no
`'unsafe-inline'` for scripts — so it would have been blocked in production and
nowhere else, leaving every visitor the live policy plus a stale duplicate. The
rule it produced: **a CSP failure is invisible to every local check**, because
`vite build`, `vite preview` and the test suite all serve no headers. If a change
adds an inline script, a new script host or a new `connect-src` target, read
`vercel.json` — nothing else in the pipeline will tell you.

### The phone screenshots exist (2026-09-16), composed from the owner's own captures

**The captures could not be uploaded as they were, and the reason is geometry
rather than taste.** Play's phone screenshots must be 16:9 or 9:16 with each side
between 320 and 3840 px. The owner's five captures are **736 × 1600 — ratio
0.460**, narrower than 9:16's 0.5625, so Play rejects the shape before a human
ever looks at the content.

`scripts/build-play-screenshots.mjs` does two things, both measured rather than
eyeballed, and `npm run play-screenshots:check` asserts the result in CI beside
`logo:check` and `play-icon:check`:

1. **Crops the top 90 rows.** A full-width dark-pixel scan puts the iOS
   status-bar glyphs at rows **42-66 in all five captures**, and the first pixel
   the app itself drew at row 120 at the earliest. 90 clears the status bar with
   30 rows to spare and removes nothing the app drew. That number is a property
   of these captures, not of iOS — re-measure it if the source device changes.
2. **Places the 736 × 1510 remainder on a 1080 × 1920 canvas** — exactly 9:16,
   1080 on the short side, which is Google's quality recommendation. The 140 px
   margin is not a taste decision: it is the value for which all four margins
   come out equal, and it puts the content scale at 800/736 = **1.087×**, an
   upscale small enough to be invisible.

**ONE PIXEL OF CONTENT WAS EDITED, AND IT IS STATED HERE RATHER THAN BURIED.**
The checkout capture carried the *"الدفع الإلكتروني غير متاح حالياً. الدفع النقدي
مفعل"* banner across source rows 212-266, clipped mid-sentence by where the
customer had scrolled. **PR #377 removed that banner from the app**, so the
capture advertises a notice the shipped build does not render. The script splices
those rows out and refills the freed band at the bottom from the capture's own
bottom rows — asserting first that they are a single flat colour, so the splice
cannot leave a seam (they are pure white, deviation 0). Removing it makes the
screenshot *more* accurate, not less. **The source captures are committed beside
the outputs precisely so that edit is auditable rather than taken on trust.**

**THEY ARE ONE BUILD BEHIND, and that is a real limitation rather than a
quibble.** The same PR #377 also stopped auto-selecting a payment method, so the
shipped checkout carries a selector these captures predate. Nothing about that
risks a rejection — but the checkout screenshot is not what a customer will see
today, and screenshots can be replaced at any time **without a new release**, so
it is worth re-capturing once an Android build is in hand.

**iOS provenance is not itself a problem, and the owner's instinct to ask was
still the right one.** Play does not require screenshots to come from an Android
device, and the app is React Native, so Android renders these screens
near-identically. What *would* have been a problem is a web render — a different
layout engine, different fonts, different metrics — which is why these are device
captures of the real app rather than anything produced in a browser.

### The colour-type contract, and the mistake it caught

**Play's asset rules are not one rule but three, and the difference is a channel
rather than a pixel:**

| Asset | Play requires | PNG colour type |
| --- | --- | --- |
| App icon | 32-bit PNG **with** alpha | 6 |
| Feature graphic | JPEG or 24-bit PNG, **no** alpha | 2 |
| Screenshots | JPEG or 24-bit PNG, **no** alpha | 2 |

`scripts/lib/png.mjs` hardcoded colour type 6, and a browser canvas always hands
back RGBA, so every store asset this repository produced was 32-bit. **That is
correct for the icon and wrong for the other two**, and being *fully opaque* does
not fix it — the IHDR still declares a channel Play refuses.

**Codex caught it on the feature graphic in PR #383, and the same defect was in
the screenshots**, where the checker written to catch exactly this asserted
opacity and said in its own header that "Play does not reject an alpha channel".
It does. The encoder now takes an opt-in colour type, the two no-alpha assets
pass 2, and the check asserts the colour type read back out of the file rather
than the argument that was passed in.

**The generalisable part:** when a contract names a *format*, assert the format,
not a property you believe implies it. "Opaque" and "has no alpha channel" sound
interchangeable and are not, and only one of them is what the other side reads.

**What the CI check can and cannot prove.** It proves geometry and format
(1080 × 1920, **24-bit RGB with no alpha channel**, under Play's 8 MB ceiling,
2-8 images) and it proves the
composition ran — a raw capture dropped into the directory has no uniform
backdrop border and fails, which is mutation-tested five ways. It **cannot** tell
whether the status bar was cropped or whether the image shows this app at all.
Those are review judgements, and the script's own header says so; a check whose
limits are not written down gets read as proving more than it does.

**Still outstanding on the listing:** the 1024 × 500 feature graphic, the short
and full descriptions in both languages, and the Console-only app category.


---

## 12. Menu photography

### One thing a reviewer WILL see, measured live rather than guessed

**SUPERSEDED 2026-09-16 — the count moved, and the timing says why.** Re-read
live: 61 products, 55 active, **4** with a non-empty `image_url`, all four
active. `max(products.updated_at)` is `2026-09-16 04:52:07 UTC` — the same minute
the owner's screenshot captures are stamped (07:52 Riyadh, UTC+3). Three product
images were uploaded immediately before the screenshots were taken, which is why
the menu capture shows real food photography rather than the grey icons this
section was written about.

**The point survives the correction: 51 of 55 active products still have no
image.** Four is enough for the screenshots to look finished, because the images
sit at the top of the `وجبات` category, which is what the menu capture shows. It
is not enough for a customer scrolling the rest of the menu.

**The superseded reading, kept because a dated count is exactly the thing that
goes stale:** read live 2026-09-15 — 61 products, 55 active, 5 active categories,
**1** with a non-empty `image_url`. One branch is active out of 40, which is
correct for a single-branch launch.

**This is not broken and not a policy problem** — it is handled deliberately.
`apps/mobile/src/lib/mappers.ts:105-124` refuses a stock-photo fallback (an
earlier version substituted one Unsplash burger for every product, so the same
burger sat beside "Chicken Wings" and "Fries with cheese"), and `ProductCard`
renders a neutral `DishIcon` when `imageUrl` is empty. The empty state is built
and styled.

**It is a store-listing problem.** Play wants at least two phone screenshots, and
screenshots of a food-ordering app whose menu is 55 grey dish icons read as
unfinished to a human reviewer and to every customer who sees the listing. The
upload path already exists — `20260827140000_product_images_bucket` created a
public bucket an administrator can upload into from the console, and one product
proves the path works end to end.

Nothing blocks submission on this. It is worth an hour with a phone before the
screenshots are taken, not after.


---

## 13. Tablets and Chromebooks — undecided

### One thing measured on the bundle that nobody has decided

The AAB declares **no `<supports-screens>` and no `<uses-feature>` element at
all**, so Android treats the app as supporting every screen size and Play will
distribute it to tablets and Chromebooks. `app.json`'s `"supportsTablet": false`
sits under the **`ios`** key and has no Android effect whatsoever.

Nothing blocks submission on this. But the listing will offer the app on devices
whose layout nobody has looked at, and no tablet screenshot exists. Either supply
7-inch and 10-inch screenshots, or accept the "not designed for this device"
treatment — and if tablets are meant to be out of scope, that is a deliberate
manifest change rather than something to leave implicit.


---

## 14. Corrections made while doing this, kept for the pattern

### A substring match is a place to look, never a finding — three times in one session

This is the most repeatable mistake in the whole pass, and it produced one false
alarm, one false clearance and one false regression report.

| Search | What matched | The truth |
| --- | --- | --- |
| Age-restricted terms across the live menu | `rum` inside **"D*rum* Stick"** | No alcohol on the menu |
| `firebase/analytics` in the AAB's dex | `analytics/connector`, an inert stub | No `FirebaseAnalytics`, no `AppMeasurement`, no `gms/measurement/internal`, zero analytics components in the manifest |
| `<script>` in the served legal page | the literal text inside a **CSS comment** | Exactly one real script, and it has a `src` |

A fourth, in the other direction: a first obfuscation probe scanned only
`classes.dex` with a too-narrow pattern and returned zero package paths, which
reads as "the code is obfuscated". All five dex files carry readable names; it is
not obfuscated. **A narrow search producing nothing is not evidence of absence** —
validate the pattern against a case it should match before trusting a null result.

### Console navigation was guessed, and the guesses were confidently wrong

A "Policy and programmes" group was described that does not exist, and an
`/app-content` URL that redirects. Both were plausible reconstructions of Play
Console's information architecture and both wasted the owner's time. The real
route is **Dashboard → "Set up your app" → View tasks**. Play Console's layout is
dashboard state like any other: look, do not reconstruct.

### THE FIRST UPLOAD CANNOT BE AUTOMATED, and this section said otherwise

**Corrected 2026-09-15, before this document was merged (#380).** Step 3 used to
be step 5's text alone, ending *"Once EAS holds it, `eas submit --platform
android --profile production --latest` runs unattended and I can drive every
later release."* For every release after the first that is true. **For the first
it is false**, and acting on it would have meant configuring a service account,
running `eas submit`, and watching it fail for a reason the section had just
promised was handled.

**The Google Play Developer API cannot create the initial release of a package
that has never had a binary uploaded.** Expo's own Android submission
documentation states the requirement directly: upload the app manually through
Play Console at least once before using EAS Submit. So the ordering is: create
the app record, upload
`spicymeal-v1.0.0-2.aab` by hand into a track, and only then does the API have a
package it can add editions to.

The AAB to upload is the one this section verified — `v1.0.0`, versionCode 2,
built from commit `f82cecbe`. Download it from the EAS build page rather than
rebuilding; a rebuild would produce a different versionCode and a different
artefact from the one whose manifest is recorded in C1.

**The generalisable point is about where the claim came from.** Nothing was
measured for that sentence — it was the reasonable-sounding shape of "credential
unlocks automation", written without checking the one page that documents the
exception. A step that has never been performed is exactly where a plausible
assumption survives unchallenged.


---

## 15. What this document does not know

| Question | Why it cannot be answered from here | What settles it |
| --- | --- | --- |
| Was the developer account created before 13 November 2023? | Account metadata lives in Play Console | If yes, §2's gate does not apply at all — check first, it changes the plan |
| Which category and Miscellaneous answers were given on the rating questionnaire? | Not reconstructed with confidence | Play Console shows the completed questionnaire; read it back |
| Is the "Shared" column answered correctly? | Depends on the data-processing agreements with four vendors | Owner, and where a DPA is unclear, counsel |
| Are 12 testers actually *opted in*, not merely invited? | Play-side, per tester | Check weekly during the closed test |
| Do the screenshots still show the shipped build? | Judgement, not a byte comparison | They do not today — see §11 and the note in §12 |
| Is `loyalty_pickup_only` still true in live settings? | A database value; source cannot prove it | Read it before publishing the listing copy |

---

## Related

- [`OWNER_ACTIONS.md`](OWNER_ACTIONS.md) §38 — the owner steps that need a Google
  identity, and §27 for the reviewer test-number mechanism
- [`GO_LIVE_READINESS.md`](GO_LIVE_READINESS.md) — the one-time launch gate; C1,
  C5, C7, C8, B6, G3, G4 and X2 all touch this document
- [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) §8 — the per-release re-check
- [`store/LISTING_COPY.md`](store/LISTING_COPY.md) — the listing text and its
  claims table
