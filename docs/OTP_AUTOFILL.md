# WhatsApp Zero-tap OTP autofill (issue #97)

Client-side autofill for the one-time code, wired into the **existing** OTP verify
paths. Autofill only ever **reads** an incoming code and hands it to the code the
app already used — it never sends, generates, stores, or verifies a code itself.
Supabase Auth remains the sole authority.

> **Changed 2026-09-02.** There used to be *two* verify authorities: Supabase Auth
> for login, and the `whatsapp-verify-otp` Edge Function for the Profile
> phone-verification card. That card lost its entry point on 2026-08-13
> (`99dc6dd`, the approved iOS UX batch) and the orphaned component was deleted on
> 2026-09-02, along with its `whatsappOtp` client wrapper. **Login is now the only
> OTP surface in the app**, which costs nothing: the
> `handle_auth_user_phone_confirmed` trigger sets `profiles.phone_verified` on
> every successful login, so the card was verifying something login had already
> proven. The Edge Function is still deployed and untouched — see
> `docs/WHATSAPP_LOGIN.md` §9.

## What shipped in this slice

All code lives in `apps/mobile/` — the Expo app is the app's only phone-OTP
surface, and it renders on native iOS/Android **and** on web (react-native-web),
so one implementation covers all three targets.

| File | Role |
| --- | --- |
| `src/features/otp/otpAutofill.ts` | PURE, framework-free logic: code normalization/extraction (Arabic-Indic aware) and the WebOTP capability guard + read (dependency-injected navigator). |
| `src/features/otp/otpAutofill.test.ts` | Unit tests for the above (parsing, extraction, capability guard with a mock `navigator.credentials`). Runs under the root Node vitest suite. |
| `src/features/otp/useOtpAutofill.ts` | React hook: WebOTP on web (guarded, `AbortController` cleaned up on unmount); no-op on native (autofill there is declarative on the input). |
| `src/features/otp/OtpCodeInput.tsx` | **One real `TextInput`** carrying the autofill contract, drawn to look like separate digit cells. |
| `src/features/otp/OtpPasteAssist.tsx` | One-tap paste affordance, shown only when the clipboard holds something and the code is incomplete. |
| `src/features/otp/OtpResendTimer.tsx` | Owns the resend countdown so its per-second tick cannot re-render the code field. |
| `src/features/auth/PhoneOtpLogin.tsx` | Login screen — code step uses `OtpCodeInput` + `useOtpAutofill`; the same `verify()` path is reused. |
| ~~`src/features/profile/VerifyPhoneWhatsApp.tsx`~~ | Profile phone-verification card — same wiring. **Deleted 2026-09-02**; its entry point had been gone since 2026-08-13. |

### Why one input, not six boxes

The original implementation used six separate `TextInput`s. **On iOS that
structure is why autofill never appeared**, for two compounding reasons:

1. **iOS offers the QuickType code suggestion to a field it believes holds the
   whole code.** Six one-character fields do not read that way, and only box 0
   carried `textContentType="oneTimeCode"`.
2. **iOS 26 drops a field's focused state on re-render**, and the resend
   countdown ticked once per second *in the screen that owned the input* — so
   the focused field was torn down and rebuilt roughly sixty times during a
   single cooldown. The suggestion cannot persist on a field that keeps losing
   focus.

So the field is now a single `TextInput` with `maxLength={length}`, styled to
*look* like separate cells (the digits are rendered over it). The autofill
contract sits on the one real field, and `OtpResendTimer` owns the countdown in
its own subtree so a tick re-renders the timer and nothing else.

`otpAutofill.ts` lost its multi-box distribution helpers (`BoxEdit`,
`applyBoxInput`, `applyBackspace`) along with the boxes — there is no longer a
per-box cursor to manage. Normalization and extraction are unchanged.

### One-tap paste (`OtpPasteAssist`)

iOS 26.x does not reliably surface the keyboard autofill suggestion for codes
delivered by **WhatsApp**. Apple's developer forums report the same across
26.0.1–26.3, there is no public API to opt into — only an OS heuristic — and
WhatsApp's own "Copy code" button works every time. The app therefore meets the
customer where the platform is reliable: copy in WhatsApp, one tap here.

- **iOS 16+** renders `UIPasteControl` (`ClipboardPasteButton`), which pastes
  **without** the "Allow Paste?" dialog — the tap itself is the consent.
- **Elsewhere** a plain action reads the clipboard on press. That does prompt
  once on iOS, but it is never reached on a version that has the control.
- The affordance appears **only** when the clipboard actually holds something
  and the code is still incomplete, so it is never dead furniture. The check
  uses `hasStringAsync` precisely because it does **not** prompt.

### Graceful degradation (by design)

- **Web**: `navigator.credentials.get({ otp: { transport: ['sms'] }, signal })`,
  guarded by `isWebOtpSupported` (requires the `OTPCredential` global +
  `navigator.credentials.get`). Unsupported browser, abort, or user-declined →
  resolves `null`, manual entry stays fully usable. The `AbortController` is
  aborted on unmount / when the code step closes.
- **iOS**: `textContentType="oneTimeCode"` on the single field → QuickType
  offers the code above the keyboard and fills the whole field at once. When it
  does not appear (see the WhatsApp caveat above), `OtpPasteAssist` is the
  reliable path.
- **Android**: `autoComplete="sms-otp"` — Android's documented OTP hint, kept
  byte-identical to what shipped before rather than assuming the native hint
  mapping matches the cross-platform value.
- **`Platform.select` needs its `default` key.** With only `ios` and `android`
  keys it returns `undefined` on web, emitting no `autocomplete` attribute at
  all. Web is given `'one-time-code'`, which is the value the HTML spec
  actually defines — note that the pre-existing code sent Android's `sms-otp`
  to web, which is not a valid HTML token either. Web autofill in practice
  comes from WebOTP below; the attribute is the belt to its braces.
- **No native module is required and none is assumed** — there is no crash path
  if a native SMS-retriever module is absent (the native branch of the hook is a
  no-op; see the OWNER follow-up below for true zero-tap on Android).

### RTL / i18n

- The field itself adds no user-facing strings; it reuses the existing translated
  labels (`enterLoginCode` / `enterVerificationCode`) for their accessibility
  labels, so AR + EN are covered by the current translation system.
- The digit cells are intentionally **not** mirrored in Arabic — a numeric code
  reads left-to-right (first cell = first digit) in both languages, matching the
  established `SaudiPhoneInput` convention. Only the label above follows the
  reading edge (`rtlText`).
- `OtpPasteAssist` and `OtpResendTimer` do add user-facing strings; both
  languages are covered in `src/i18n/strings.ts` and pinned by the i18n contract
  tests (identical key sets, non-empty values, AR ≠ EN).

## OWNER / blocked follow-ups (NOT done here — require owner action)

1. **Meta WhatsApp Authentication template** with the *copy-code / one-tap
   autofill* button, configured and approved in the WhatsApp Manager. Real
   zero-tap delivery depends on this template being live.
2. **Android app hash / SMS Retriever** setup for true hands-free autofill: the
   app's package name + signing-key SHA registered with Meta, plus a native
   SMS-retriever module (e.g. `react-native-otp-verify`) wired into the no-op
   native seam in `useOtpAutofill`. Deferred because it needs credentials and a
   native build.
3. **Real on-device testing** on physical Android + iOS handsets and a mobile
   browser that supports WebOTP (Chrome on Android). Autofill **cannot** be
   verified in this environment — no device, no live SMS/WhatsApp send.
4. Confirm the **production OTP length** in Supabase Auth settings matches
   `DEFAULT_OTP_LENGTH` (6) — see assumptions.

## Assumptions

- **OTP length is 6.** Supabase Phone Auth issues a 6-digit token by default, and
  the (since-deleted) profile-verification flow already hard-required exactly 6
  digits. Login previously accepted 4–8 digits in its regex (unchanged); the boxes
  render 6. If Auth is ever configured for a different length, update
  `DEFAULT_OTP_LENGTH`.
- The Expo web build (react-native-web) is the "web" target for issue #97; the
  separate `src/` web app uses email/password and has no phone-OTP screen, so
  WebOTP belongs on the mobile OTP screens, not there.
- Autofill on the code step auto-submits (fills the boxes and calls the existing
  `verify()`), matching "hands it to the existing verify function".
- `textContentType`/`autoComplete` are best-effort platform affordances; the
  programmatic WebOTP path is the guaranteed web channel.

## Reviewer checklist

- [ ] `otpAutofill.ts` stays framework-free (no React/RN/Expo/Supabase imports) so
      it keeps running under the Node vitest suite.
- [ ] Confirm the auto-submit-on-autofill UX is desired (vs. fill-only).
- [ ] Confirm the non-mirrored (LTR) digit row is the intended RTL behavior.
- [ ] Sanity-check that `verify` is invoked as `() => verify()` / `verify(code)` —
      never passed directly to a press handler (which would pass the event as the
      code argument).
- [ ] Owner items above before any real autofill claim.
