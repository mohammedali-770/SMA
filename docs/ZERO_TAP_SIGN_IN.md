# Zero-Tap Sign-In restoration — design, for approval before any code

> **Status: PROPOSED, 2026-11-10. Nothing here is built.** The 2026-11-09
> compliance plan puts an owner approval on this document before any code is
> written, because the hard part is a security decision rather than a coding
> task. **The decisions are in §9.** Every claim about Google's or Supabase's
> behaviour was read from their own pages on 2026-11-10 and is dated. What nobody
> has measured yet is labelled as unmeasured.

## 1. What Google requires

[Play Console Help, answer 17492799](https://support.google.com/googleplay/android-developer/answer/17492799),
announced with the
[26 August 2026 Android Developers blog post](https://android-developers.googleblog.com/2026/08/app-quality-memory-optimization-secure-onboarding.html):

> From April 2027, apps that support user sign-in (optional or mandatory) must
> support Zero-Tap Sign-In restoration when a user moves from their previous
> Android device to a new one and selects to restore their data either from a
> device-to-device transfer or cloud backup.

| Question | Google's answer | For this app |
| --- | --- | --- |
| When? | *"From April 2027"*. The month only, no day | Plan for 1 April |
| Who? | Apps with sign-in, *"mobile/tablet form factors"*, Android 9 and later | **In scope.** Phone-and-code sign-in is not carved out: *"the Restore Credentials API is designed to work with any authentication method"* |
| Exemptions? | Games, for now. Apps *"subject to strict regulatory or compliance mandates … (such as financial services or healthcare) may be eligible"*, on a request made *"prior to the enforcement date"* | **None applies.** A food-ordering app is not regulated in that sense |
| The older route? | Block Store counts only *"if the integration was completed and in production on or before September 30, 2026"* | **Closed.** That date has passed |
| How is it judged? | *"Successful user sign in restoration is determined through successful restore key retrieval, resulting in the user being automatically signed in. Apps we identify as not meeting this requirement will be notified."* | See the tension below |
| What does failing cost? | *"to maintain full publishing capabilities and optimal visibility in the Play Store"* (blog). No concrete mechanism is stated | Treat it as a publishing risk |

**The sentence this design turns on**, from the same page:

> Upon retrieving a restore key on a new device, your app must decide whether to
> require an additional step-up verification. Restoring the user's identity
> context (for example, displaying "Welcome back, Alex") is sufficient to meet
> the requirement. However, note that a device-to-device restoration provides
> strong proof of possession and should therefore not require an additional MFA
> step.

Two readings sit side by side on Google's page:

- **"Resulting in the user being automatically signed in"** (how it is judged).
- **"Restoring the user's identity context … is sufficient"** (what is enough).

§5 builds on the second and keeps the first within reach.

## 2. Where this app stands today

- **Sign-in is a WhatsApp code and nothing else.** That is Supabase phone auth
  plus a Send SMS hook that delivers the code over WhatsApp. It is rate-limited
  per phone: a 60-second cooldown, 5 sends an hour and 10 a day
  ([`WHATSAPP_LOGIN.md`](WHATSAPP_LOGIN.md) §7.2).
- **The session never leaves the phone, by design.** The refresh token lives in
  the device keystore as `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, and
  `android:allowBackup` is `false`. `apps/mobile/src/lib/secureSessionStorage.ts`
  says so plainly: *"restoring a phone from a backup signs the customer out. That
  is correct for a credential"*.
- **So the requirement must not be met by loosening that rule.** Putting the
  refresh token into backups would make every Google backup a bearer credential
  for the account. Restore Credentials exists so that an app does not have to do
  that.
- **No Android customer exists yet.** All 5 registered push devices were iOS when
  read on 2026-11-10. Play production also waits on the 14-day closed test
  ([`GO_LIVE_READINESS.md`](GO_LIVE_READINESS.md) C8). The deadline still
  applies to the first production release after April 2027.

## 3. How Restore Credentials works

From [Implement Restore Credentials](https://developer.android.com/identity/sign-in/restore-credentials-implementation),
read 2026-11-10.

**Requirements:** Android 9 (API 28) or later, Google Play services 24.22 or
later, and `androidx.credentials` 1.5.0 or later (1.6.0 is the current stable
release). A device without them throws a provider-configuration exception, and the
app falls back to ordinary sign-in.

**1. Create, after sign-in.** `CreateRestoreCredentialRequest(requestJson,
isCloudBackupEnabled = true)` takes passkey-shaped WebAuthn creation options:

- `challenge`;
- `rp`;
- `user.id`;
- `pubKeyCredParams` including −7 and −257;
- `residentKey: "required"`.

Creation is silent. The response is a registration that the server verifies, and
the server stores the public key. If end-to-end-encrypted backup is unavailable
(no Google account, backup off, or no screen lock), the call throws and the app
retries with cloud backup off. That copy supports device-to-device transfer only.

**2. Get, on the first launch of a new device.** The app fetches options from an
**unauthenticated** endpoint (`challenge`, `rpId`, empty `allowCredentials`) and
calls Credential Manager with `GetRestoreCredentialOption` as the only option. The
result's `authenticationResponseJson` is a WebAuthn assertion, and the server
*"identifies the user from the `response.userHandle`"*.

**3. Clear, on sign-out.** A "dual clear": `ClearCredentialStateRequest()` and
then `ClearCredentialStateRequest(TYPE_CLEAR_RESTORE_CREDENTIAL)`. It also runs
when the server invalidates the session.

**Facts that shape the design:**

- **The key survives `allowBackup="false"`.** *"Google Play services transfers
  the `RestoreCredential` key pair… regardless of whether `android:allowBackup`
  is `true` or `false`."* Nothing about this app's backup rule has to change.
- **A cloud copy is protected by the old phone's screen lock.** Google's backup
  help says it is *"end-to-end encrypted with your device's screen lock PIN,
  pattern or password"*. A device-to-device copy needs the old phone itself.
- **One key per app, bound to the package and its signing certificate.**
  *"Restore Credentials supports only one account per app"*, and uninstalling
  deletes it.
- **Android sends `uv = false`.** Google says to *"accept `uv = false` for
  restore key assertions"*.
- **Push tokens are not restored.** The app's normal sign-in path already
  re-registers the device (`usePushDeviceSync`).

**Not yet measured, and both decide implementation details:**

1. Whether a restore assertion sets the user-present (UP) flag. Two secondary
   sources say it may be 0.
2. Whether `rp.id` needs a Digital Asset Links file (`assetlinks.json`) on the
   domain. Passkeys do; for restore keys it is unconfirmed.

**Only a device test can answer them** (§8, step 2).

## 4. The hard part: turning a verified key into a session

**Supabase Auth has no server-side call that issues a session for an existing
user.** That was read from supabase-js's admin API on 2026-11-10, and the
standing request for one (supabase discussion 11854, 2023) has no answer.
Everything below is a way around that gap, and each way has a price.

| | Approach | Status | The risk that decides it |
| --- | --- | --- | --- |
| **A** | **Supabase passkeys as the server.** Register the restore key through Supabase's passkey registration, and verify it through `verifyAuthentication`, which issues a normal session | **Experimental.** *"The API may change without notice"* ([docs](https://supabase.com/docs/guides/auth/passkeys)) | Supabase's verifier requires the UP flag, and if restore assertions carry UP = 0 it rejects them. Enabling passkeys also lets every signed-in customer register general passkeys, a lasting credential that survives a sign-out everywhere |
| **B** | **Our Edge Function verifies, then signs in through a custom OIDC provider.** It mints a 60-second ID token with our own key and publishes the public key at an issuer URL. The app calls `signInWithIdToken` with a `custom:` provider | Custom providers since April 2026. ID-token sign-in is visible in Supabase's source and types more than in its guides; identity linking needs "Manual linking (beta)" | **The issuer key becomes a master key** for every linked account. A token for an unlinked subject may create a new account unless a hook refuses it. Documentation is thin |
| **C** | **Our Edge Function verifies, then captures a phone code.** It calls `signInWithOtp`; the Send SMS hook diverts that code to the function instead of WhatsApp; the function calls `verifyOtp` | Generally available APIs only | **The hook becomes a code-interception path.** One bug there is account takeover for any phone number. It also races real logins and spends the per-phone budget |
| **D** | **A synthetic email per account,** then `generateLink` and `verifyOtp` | Generally available | Writes a fake confirmed email onto every customer, which is a data-minimisation problem and changes how identities link |
| **E** | **No new session path.** The verified key identifies the customer, the app shows "Welcome back, <first name>" with the number filled in, and the customer signs in with the normal WhatsApp code | Uses only what runs today | Rests on Google's *"identity context … is sufficient"*. If Google enforces the *"automatically signed in"* reading instead, E is not enough on its own |

**Rejected outright: C and D.** C turns the one gate on customer login into a
bypass whose only protection is the correctness of new code. D falsifies account
data to work around an API gap.

## 5. Recommendation: two steps, with E first

**Step 1, for April 2027: build E.**

- It is the part every approach needs anyway: the native module, key
  registration, and server-side verification of the assertion. A and B are E
  plus a session at the end.
- It adds **no new way to obtain a session**. The WhatsApp code, the hook and the
  rate limits stay the only gate.
- Google's own text calls it sufficient.
- It does not tie a dated requirement to a feature Supabase calls experimental.

**Step 2, true zero-tap: decide after the device test.**

- **Prefer A** if Supabase passkeys are generally available by then and accept
  real restore assertions.
- **Otherwise B**, with the issuer key held like the service-role key.
- Either is a separate approval, because it is the moment a stored key alone
  becomes enough to sign in.

**What E costs the customer:** one tap and a code instead of none. Google says a
device-to-device restore *"should … not require an additional MFA step"*. Here
the code is not an extra factor but the only sign-in this app has, so E asks for
the same proof a new device asks for today, with the number already filled in.

## 6. Step 1, designed

### On the phone (Android only; iOS does nothing)

- **A small Expo native module in Kotlin**, exposing `create`, `get` and
  `clear`.
  - No maintained React Native library covers restore keys: the one that does,
    `expo-restore-credentials`, was first published on 2026-10-30 by one
    maintainer.
  - Read it as a reference, do not depend on it.
- **Create** after a successful code sign-in, and at start-up when a signed-in
  customer has no key registered. Prefer cloud backup, and fall back to
  device-to-device when encrypted backup is unavailable.
- **Get** on a launch with no session. On success, show the welcome card with
  the number filled in; on any failure, show the ordinary sign-in screen.
- **Clear** on sign-out, on account deletion, and when the server rejects the
  session.

### On the server

- **A new table**, one row per registered key:
  - the customer;
  - the credential id;
  - the public key;
  - the sign counter;
  - the time it was created;
  - the time it was last used;
  - the time it was revoked.
  - **No client role can read or write it.** RLS on, no policies, grants revoked —
    the shape `admin_push_subscriptions` already uses. The functions below are
    its only door.
- **`user.id` is a random handle mapped to the customer**, never the customer id
  or the phone number.
- **Three Edge Functions:**
  1. **Register** — signed in. Issues creation options, verifies the
     registration and stores the key.
  2. **Options** — signed out. Issues a single-use challenge that expires in two
     minutes.
  3. **Identify** — signed out. Verifies the assertion, checks the key is not
     revoked and the customer is not deleted, and returns only the first name
     and the phone number.
- **Verification uses `@simplewebauthn/server`**, which runs in Edge Functions.
  - `expectedOrigin` is `android:apk-key-hash:` plus the hash of each signing
    certificate: the Play App Signing key and the EAS upload key.
  - `requireUserVerification` is false.
  - The UP rule is set from the device test.
- **The two signed-out functions are rate-limited** per address and per
  credential, like every other unauthenticated path here.
- **Revocation:**
  - sign-out revokes the key the device registered;
  - account deletion revokes all of them (`account-delete-process`).

### What step 1 deliberately does not change

- the refresh-token rule;
- `allowBackup`;
- the Send SMS hook;
- the login rate limits;
- anything on iOS.

## 7. Threat model

| Threat | Step 1 (E) | Step 2 (A or B) |
| --- | --- | --- |
| A stolen Google account restores a cloud backup | It also needs the old phone's screen-lock secret to decrypt the key, and then the WhatsApp code. **No takeover from the key alone** | It still needs the screen-lock secret, and then **the key alone signs in.** That is the trade Google recommends for device-to-device and is the reason step 2 is a separate decision |
| A thief with the old phone, unlocked | Can already open the app. The key adds nothing | Same |
| Another app on the device | The key is bound to this app's package and signing certificate | Same |
| A forged or replayed assertion | Single-use challenges, a signature check against the stored key, and a revocation check | Same, and a session rides on it, so the device test and a security review gate it |
| Enumerating customers through Identify | Returns data only for a valid assertion, and is rate-limited | Same |
| A customer signs out, then a backup restores an old key | The key is revoked server-side at sign-out, so it identifies nobody | Same |
| The verifier or issuer key leaks | Nothing to leak; no key issues sessions | **B:** a master key for every linked account. **A:** no such key |

## 8. Build plan and the owner actions it needs

1. **The Expo SDK 58 upgrade first.** The module is written once, against the
   SDK that ships it.
2. **A device test**, as a throwaway build. Its four checks:
   - create a key;
   - restore through Android Studio's device-to-device test (cloud cannot be
     tested while `allowBackup` is false);
   - read the UP and UV flags;
   - check whether Digital Asset Links are required.
3. **One pull request** containing:
   - the module;
   - the migration;
   - the three functions;
   - tests (unit, a SQL suite for the table's privileges, and wiring);
   - docs: this file, `RECORD_OF_PROCESSING.md`, the Data safety review, and an
     ownership rule.
4. **The owner actions, each under CLAUDE.md §5:**
   - apply the migration;
   - deploy the three functions;
   - publish a privacy-policy sentence about restoring an account on a new
     Android device;
   - an EAS build;
   - a device check on a real restore.
5. **It must be in a production release before April 2027.** Working back from
   that, the build that carries it belongs in February at the latest.

## 9. Decisions for you

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Build step 1 (E) as the April 2027 answer | **Yes** |
| D2 | Pursue true zero-tap later, choosing A or B after the device test | Decide after the test; prefer A once it is generally available |
| D3 | Revoke a device's key on the server at sign-out, even though Google suggests keeping keys alive through a device transition | **Yes.** A signed-out customer should start signed out on any device, which is also what Google requires for signed-out users |
| D4 | Back keys up to the cloud when encrypted backup is available, falling back to device-to-device | **Yes** |
| D5 | Ask for an exemption | **No.** The app does not meet the stated criteria |

**Nothing in this document is approved by being merged.** Merging records the
design. Each decision above is yours to give in conversation, and step 2 needs its
own approval when it comes.

## Sources

All read on 2026-11-10.

- Google, Play Console Help
  [answer 17492799](https://support.google.com/googleplay/android-developer/answer/17492799)
  and the
  [26 August 2026 blog post](https://android-developers.googleblog.com/2026/08/app-quality-memory-optimization-secure-onboarding.html)
- Android, [Restore Credentials](https://developer.android.com/identity/sign-in/restore-credentials),
  [Implement Restore Credentials](https://developer.android.com/identity/sign-in/restore-credentials-implementation)
  and [Test Restore Credentials](https://developer.android.com/identity/sign-in/test-restore-credentials)
- Android, [Credentials library releases](https://developer.android.com/jetpack/androidx/releases/credentials)
- Google, [backup encryption help](https://support.google.com/android/answer/2819582)
- Supabase, [Passkeys](https://supabase.com/docs/guides/auth/passkeys),
  [Custom OAuth providers](https://supabase.com/docs/guides/auth/custom-oauth-providers),
  [JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys) and the
  [Send SMS hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)
- [`@simplewebauthn/server`](https://jsr.io/@simplewebauthn/server) on JSR
- This repository:
  - `apps/mobile/src/lib/secureSessionStorage.ts`;
  - `apps/mobile/app.json`;
  - [`WHATSAPP_LOGIN.md`](WHATSAPP_LOGIN.md);
  - [`GO_LIVE_READINESS.md`](GO_LIVE_READINESS.md) C8.
