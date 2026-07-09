# WhatsApp customer login — Supabase Phone Auth + Send SMS Hook + Meta Cloud API

Customers log in with a WhatsApp one-time code. **Supabase Auth (GoTrue) is the
sole login authority** — it generates the OTP and issues the session. WhatsApp is
only the *delivery channel* for the code Supabase generated. Admin/staff login is
unchanged (email + password). Everything ships **disabled by default**.

---

## 1. Supabase project (confirmed)

- **Ref:** `wxfmmnihidsdyemasstf`
- **URL:** `https://wxfmmnihidsdyemasstf.supabase.co`

This is the live "spicy-meal-ordering" project: it holds all data + every prior
migration and is hardcoded in `apps/mobile/eas.json` (all three build profiles).
The alternative `bllvfmgrxymetzaewvcs` **does not exist** in this account
(verified via the Supabase API), so it was a typo. All work here targets
`wxfmmnihidsdyemasstf`.

---

## 2. Final login architecture

```
Customer app                         Supabase Auth (GoTrue)          Edge Fn: auth-send-sms-whatsapp        Meta WhatsApp Cloud API
 │                                        │                                    │                                    │
 │ 1. signInWithOtp({ phone })  ───────▶  │                                    │                                    │
 │                                        │ 2. generate OTP (Supabase owns it) │                                    │
 │                                        │ 3. Send SMS Hook (Standard Webhooks signed) ─▶ verify signature         │
 │                                        │    body { user:{phone}, sms:{otp} }│ 4. take OTP from payload            │
 │                                        │                                    │ 5. POST auth template ───────────▶ │ delivers code on WhatsApp
 │                                        │ ◀─ 200 {} (or {error})             │                                    │
 │ 6. customer reads code                 │                                    │                                    │
 │ 7. verifyOtp({ phone, token,           │                                    │                                    │
 │      type:'sms' })          ─────────▶ │ 8. validate → REAL session         │                                    │
 │ ◀───────── session ────────────────────│ 9. handle_new_user trigger makes a 'customer' profile               │
```

Key guarantees:
- The login code is **never** generated in our code and the custom
  `otp_challenges` table is **never** consulted for login.
- `verifyOtp` returns a genuine GoTrue session, persisted by the existing mobile
  session handling (AsyncStorage). No fake/local session is ever minted.
- The Meta access token lives only in the Edge Function request header — never in
  the app, git, logs, or any client response. OTP is never logged.

---

## 3. Files changed / added

**Edge Functions (`supabase/functions/`)**
- `auth-send-sms-whatsapp/index.ts` — **NEW.** The Send SMS Hook.
- `_shared/authHook.ts` + `_shared/authHook.test.ts` — **NEW.** Standard-Webhooks
  signature verification + payload parsing (pure, unit-tested).
- `_shared/whatsappSend.ts` — added `deliverOtpTemplate()` (Meta POST + log only,
  no challenge) reused by the hook; `sendOtpViaWhatsApp` refactored onto it.
- `whatsapp-test-config/index.ts` — status now also reports `login_enabled` +
  `send_sms_hook_secret_set`.
- `config.toml` — registered `[functions.auth-send-sms-whatsapp] verify_jwt=false`.
- `README.md` — documented the new hook + relabeled send/verify as *secondary*.

**Database (`supabase/migrations/`)**
- `20260710150000_whatsapp_login.sql` — `handle_new_user` also seeds
  `phone_verified` for phone signups; new `on_auth_user_phone_confirmed` trigger
  syncs `phone_verified` when a phone is confirmed (role never touched); adds the
  `whatsapp_login_enabled` + `otp_default_language` config keys.
- `20260710150100_whatsapp_login_status_rpc.sql` — `whatsapp_login_enabled()`
  anon-safe boolean feature flag for the pre-login app.

**Mobile app (`apps/mobile/`)**
- `src/services/api.ts` — `auth.signInWithPhone`, `auth.verifyPhone`,
  `auth.whatsappLoginEnabled`.
- `src/lib/phone.ts` — `toE164()` client normalizer (mirrors the server).
- `src/features/auth/PhoneOtpLogin.tsx` — **NEW.** WhatsApp login screen.
- `src/features/auth/LoginScreen.tsx` — WhatsApp primary + email fallback.
- `src/features/profile/VerifyPhoneWhatsApp.tsx` — relabeled (not login).
- `src/i18n/strings.ts` — login + relabel strings (en/ar).

**Web admin (`src/`)**
- `components/admin/IntegrationCard.tsx` — WhatsApp spec gains the login toggle
  (`whatsapp_login_enabled`), `otp_default_language`, and the write-only
  `send_sms_hook_secret`.
- `components/admin/WhatsAppOtpPanel.tsx` — login-readiness indicators.
- `lib/api.ts` — `WhatsAppOtpStatus` gains the two login fields.

---

## 4. Supabase Auth dashboard settings you must configure

In the Supabase dashboard for `wxfmmnihidsdyemasstf`:

1. **Authentication → Providers → Phone:** enable **Phone** auth. You do NOT need
   a Twilio/etc. provider — the Send SMS Hook replaces it. (If the dashboard
   requires a provider selection, choosing the hook path is enough.)
2. **Authentication → Hooks → Send SMS hook:** enable it and point it at the
   Edge Function:
   `https://wxfmmnihidsdyemasstf.supabase.co/functions/v1/auth-send-sms-whatsapp`
   Supabase generates a **hook secret** in the form `v1,whsec_…`. Copy it.
3. (Recommended) Set OTP length to 6 and a 5-minute expiry to match the template.
4. Rate limits: keep Supabase's phone OTP rate limits on (defense in depth).

The hook secret goes into the app (step 6 below), not into git.

---

## 5. Meta WhatsApp Cloud API settings you must configure

1. Create/verify a **WhatsApp Business** app + phone number (Meta Business Mgr).
2. Create an approved **Authentication** template (with the **copy-code** button)
   in each language you serve — e.g. `otp_code_en` (en_US) and `otp_code_ar` (ar).
3. Get: **Phone Number ID**, a **permanent Access Token** (System User token), and
   optionally the **WABA ID**.
4. (Only for delivery-status webhooks — not required for login) the existing
   `whatsapp-webhook` function + App Secret + verify token.

---

## 6. Admin: turn it on (once 4 + 5 are done)

Admin Dashboard → Integrations → **WhatsApp OTP (Meta Cloud API)** card:

- Public: `graph_api_version` (`v21.0`), `phone_number_id`, template names +
  languages, **`otp_default_language`** (`en`/`ar`), **Enable WhatsApp customer
  LOGIN** (`whatsapp_login_enabled`) = ON.
- Secret (write-only): `access_token`, **`send_sms_hook_secret`** (the `v1,whsec_…`
  from Supabase step 2), and (for the webhook) `app_secret` / `webhook_verify_token`.
  Secrets **merge** on save — you can add the hook secret later (typing only that
  field) without re-entering the Meta secrets; existing keys are preserved.
- Flip the card's master **enabled** switch ON.

Login only activates when **all** of: provider enabled + `whatsapp_login_enabled` +
`phone_number_id` + `access_token` + **`send_sms_hook_secret`** + the template for
the configured `otp_default_language` are present, AND Phone Auth + the Send SMS
Hook are enabled in the dashboard. Until then the mobile app shows email login (the
`whatsapp_login_enabled()` flag returns false).

> Stronger option: instead of storing `send_sms_hook_secret` in `secret_config`,
> set it as the Edge Function env var `SEND_SMS_HOOK_SECRET` (and the OTP pepper as
> `WHATSAPP_OTP_HMAC_SECRET`). The function prefers env vars when present.
>
> **Caveat:** the pre-login readiness flag `whatsapp_login_enabled()` runs in SQL
> and **cannot see Edge Function env vars**. If you use the env-var path and leave
> `secret_config.send_sms_hook_secret` empty, the flag stays `false` and the app
> keeps showing email login (safe — the hook still works if a client calls it). To
> surface WhatsApp login as the default in that setup, also store the hook secret
> in `secret_config` (the app never reads it — the flag only checks presence).

---

## 7. Admin/staff login impact

**None.** The web Admin Dashboard login (`src/components/AuthScreen.tsx`) is
email/password only and was not touched. There is no WhatsApp login on the admin
screen. Existing admin/accountant accounts keep working exactly as before.

---

## 8. Customer profile behavior

- On first phone login, GoTrue inserts `auth.users`; the `handle_new_user`
  trigger creates a `profiles` row **with role `customer`** (the column default —
  this path never sets role) and `phone_number` = the E.164 phone.
- `on_auth_user_phone_confirmed` sets `phone_verified` when the phone confirms.
- **A phone user can never become admin/accountant:** `authenticated` has no
  UPDATE grant on `profiles.role` (only `full_name`, `email`, `phone_number`), and
  neither trigger sets role. Verified against the live DB.
- Existing profiles are never overwritten (`on conflict (id) do nothing`).

---

## 9. Previous phone-verification feature

Kept, **secondary, still disabled**. `whatsapp-send-otp` / `whatsapp-verify-otp`
+ `otp_challenges` remain for *profile phone verification only* (Profile screen,
relabeled "Verify phone number — this does not sign you in"). They never issue a
session and are not part of login. `otp_challenges` is logs/secondary only.

---

## 10. Tests & checks run

- `vitest run` — **135 passed** (incl. new `authHook.test.ts`: 14 tests covering
  signature accept/reject, tamper, replay-window, missing-secret fail-closed, and
  payload parsing).
- Web `tsc --noEmit` — clean. Mobile `tsc --noEmit` — clean. `vite build` — clean.
- Live DB guarantees (read-only): role default = `customer`; `authenticated`
  cannot update `role`; `otp_challenges` and `integration_settings` have **zero**
  anon/authenticated grants (OTP hashes + Meta token never client-readable).
- Edge Functions deployed to prod: `auth-send-sms-whatsapp` (v1, verify_jwt=false),
  `whatsapp-test-config` (v2). Provider + login stay disabled.

---

## 11. Remaining risks / notes

- **Account linking:** a customer who previously used email/password gets a
  *separate* auth user when they log in by phone (different `auth.uid()`), so a
  second profile. We do **not** auto-merge (unsafe). Migration plan below.
- The Send SMS Hook fails closed: if WhatsApp is misconfigured, `signInWithOtp`
  errors and the app shows a send-failure message (login can't silently succeed).
- Meta template approval can take time; keep email fallback until it's approved.

### Email → phone migration plan (manual, safe)
1. Keep email login enabled during transition (already the fallback).
2. To link an existing email account to a phone, do it **server-side** for a
   *signed-in* user via GoTrue admin `updateUserById({ phone })` (or the
   `phone_change` flow) — this keeps one `auth.uid()` and one profile. Never merge
   by writing `profiles` directly.
3. If two profiles already exist for one person, reconcile with an admin tool that
   re-points orders/addresses to the surviving `auth.uid()` — out of scope here.

---

## 12. Exact manual steps before enabling in production

1. Supabase dashboard → enable **Phone** auth.
2. Supabase dashboard → **Send SMS hook** → enable → URL =
   `…/functions/v1/auth-send-sms-whatsapp` → copy the `v1,whsec_…` secret.
3. Meta → create WhatsApp app + phone number → get Phone Number ID + permanent
   Access Token.
4. Meta → create + get approval for the **Authentication** templates (EN/AR, with
   copy-code button).
5. Admin Dashboard → WhatsApp card → fill public + secret fields (incl. the hook
   secret), set `whatsapp_login_enabled` ON, set the card **enabled** ON.
6. Verify: admin panel "WhatsApp customer login" shows **Login enabled = Yes** and
   **Send SMS Hook secret = Yes**; the mobile login screen now defaults to
   "Login with WhatsApp".
7. Test end-to-end with a real number, then announce to customers.
