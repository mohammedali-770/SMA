# WhatsApp Zero-tap OTP autofill (issue #97)

Client-side autofill for the one-time code, wired into the **existing** OTP verify
paths. Autofill only ever **reads** an incoming code and hands it to the code the
app already used — it never sends, generates, stores, or verifies a code itself.
Supabase Auth (login) and the `whatsapp-verify-otp` Edge Function (profile
verification) remain the sole authorities.

## What shipped in this slice

All code lives in `apps/mobile/` — the Expo app is the app's only phone-OTP
surface, and it renders on native iOS/Android **and** on web (react-native-web),
so one implementation covers all three targets.

| File | Role |
| --- | --- |
| `src/features/otp/otpAutofill.ts` | PURE, framework-free logic: code normalization/extraction (Arabic-Indic aware), multi-box distribution (paste / auto-advance / backspace), and the WebOTP capability guard + read (dependency-injected navigator). |
| `src/features/otp/otpAutofill.test.ts` | 26 unit tests for the above (parsing, paste, auto-advance, backspace, capability guard with a mock `navigator.credentials`). Runs under the root Node vitest suite. |
| `src/features/otp/useOtpAutofill.ts` | React hook: WebOTP on web (guarded, `AbortController` cleaned up on unmount); no-op on native (autofill there is declarative on the input). |
| `src/features/otp/OtpCodeInput.tsx` | Multi-box OTP input (paste-to-fill, auto-advance, backspace, `onComplete`); box 0 carries `textContentType="oneTimeCode"` (iOS) + `autoComplete="sms-otp"` (Android). |
| `src/features/auth/PhoneOtpLogin.tsx` | Login screen — code step now uses `OtpCodeInput` + `useOtpAutofill`; the same `verify()` path is reused (now accepts an optional autofilled code). |
| `src/features/profile/VerifyPhoneWhatsApp.tsx` | Profile phone-verification card — same wiring. |

### Graceful degradation (by design)

- **Web**: `navigator.credentials.get({ otp: { transport: ['sms'] }, signal })`,
  guarded by `isWebOtpSupported` (requires the `OTPCredential` global +
  `navigator.credentials.get`). Unsupported browser, abort, or user-declined →
  resolves `null`, manual entry stays fully usable. The `AbortController` is
  aborted on unmount / when the code step closes.
- **iOS**: `textContentType="oneTimeCode"` → QuickType offers the code above the
  keyboard; tapping it fills box 0, which distributes across the boxes.
- **Android**: `autoComplete="sms-otp"` gives the platform autofill affordance.
- **No native module is required and none is assumed** — there is no crash path
  if a native SMS-retriever module is absent (the native branch of the hook is a
  no-op; see the OWNER follow-up below for true zero-tap on Android).

### RTL / i18n

- No new user-facing strings were added; the boxes reuse the existing translated
  labels (`enterLoginCode` / `enterVerificationCode`) for their accessibility
  labels, so AR + EN are covered by the current translation system.
- The digit row is intentionally **not** mirrored in Arabic — a numeric code
  reads left-to-right (box 1 = first digit) in both languages, matching the
  established `SaudiPhoneInput` convention. Only the label above follows the
  reading edge (`rtlText`).

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
  the profile-verification flow already hard-required exactly 6 digits. Login
  previously accepted 4–8 digits in its regex (unchanged); the boxes render 6. If
  Auth is ever configured for a different length, update `DEFAULT_OTP_LENGTH`.
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
