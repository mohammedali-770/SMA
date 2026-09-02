# WhatsApp customer login — Supabase Phone Auth + Send SMS Hook + Meta Cloud API

Customers log in with a WhatsApp one-time code — **this is the only customer
login path, and it accepts Saudi mobile numbers only.** **Supabase Auth (GoTrue)
is the sole login authority**: it generates the OTP and issues the session.
WhatsApp is only the *delivery channel* for the code Supabase generated.
Admin/staff login is unchanged (email + password, web console). Everything ships
**disabled by default**.

## 0. The two customer-facing rules

1. **WhatsApp only.** The customer app has no email/password sign-in or sign-up.
   `auth.signIn` / `auth.signUp` no longer exist in `apps/mobile/src/services/api.ts`.
   If WhatsApp login is not enabled, the login screen says so instead of offering
   another way in.
2. **Saudi (+966) only.** Every number resolves to `+9665XXXXXXXX` or is
   rejected. Enforced in three places:
   - `apps/mobile/src/lib/phone.ts` — client normalizer + the `+966` field UI.
   - `_shared/whatsapp.ts` `normalizeSaudiPhoneE164` — used by
     `auth-send-sms-whatsapp` (login) and `whatsapp-send-otp` /
     `whatsapp-verify-otp` (phone verification). **This is the enforcement
     point** — a client can be bypassed; the hook cannot.
   - The hook still fails closed on anything that isn't a KSA mobile.

   Every Saudi input pattern is accepted and folded to the same canonical
   string: `05XXXXXXXX`, `5XXXXXXXX`, `9665…`, `009665…`, `+9665…`, the country
   code with the trunk `0` left in (`+96605…`), spaces / dashes / parentheses,
   and Arabic-Indic digits (`٠٥…` / `۰۵…`). All `5X` operator ranges are allowed
   — no operator-prefix allow-list, because CITC keeps allocating new ones.
   Saudi landlines, foreign numbers and wrong lengths are rejected.

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
  `auth.whatsappLoginAvailability`. Email/password `signIn`/`signUp` **removed**.
- `src/features/auth/loginAvailability.ts` (+ test) — **NEW.** The tri-state
  readiness contract and the send-outcome helper (see §6.1).
- `src/lib/phone.ts` (+ `phone.test.ts`) — Saudi-only normalizer:
  `toSaudiE164` / `toSaudiNational` / `isSaudiMobile` /
  `sanitizeSaudiNationalInput` / `formatSaudiE164` (mirrors the server).
- `src/components/SaudiPhoneInput.tsx` — **NEW.** Fixed `+966` prefix + the
  9-digit national part; absorbs any pasted Saudi form. Shared by login and
  profile verification.
- `src/features/auth/PhoneOtpLogin.tsx` — WhatsApp login screen (Saudi field).
- `src/features/auth/LoginScreen.tsx` — WhatsApp only; shows an "unavailable"
  card when the feature flag is off (no email path to fall back to).
- `src/features/profile/VerifyPhoneWhatsApp.tsx` — same Saudi field.
- `src/i18n/strings.ts` — WhatsApp/Saudi login strings (en/ar); the email-auth
  strings are gone.

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
Hook are enabled in the dashboard. Until then the `whatsapp_login_enabled()` flag
returns false and the app shows "WhatsApp login isn't available right now" —
**there is no email fallback any more, so customers cannot log in until this is
switched on.** Treat the flag as a launch gate, not a preference.

### 6.1 The flag is a hint; the hook is the gate (tri-state)

`auth.whatsappLoginAvailability()` returns **three** values, never a boolean:

| Value | Meaning | Login screen renders |
| --- | --- | --- |
| `enabled` | flag read, genuinely ON | phone form |
| `disabled` | flag read, genuinely OFF | "unavailable" card |
| `unknown` | flag **could not be read** (network / RPC / RLS error, or a non-boolean payload) | phone form |

Only a **confirmed** `disabled` hides the form. This matters because WhatsApp is
the only way in: if an unreadable flag were collapsed into "off", a single
transient status-RPC blip would show every customer the unavailable card even
though login works perfectly. `readLoginFlag` therefore never rejects and never
maps a failure to `disabled`.

Rendering the form on `unknown` is safe because the client was never the
authority. `auth-send-sms-whatsapp` fails closed and returns 503 "WhatsApp login
is temporarily unavailable" when `whatsapp_login_enabled !== true`, so
`signInWithOtp` rejects and `requestLoginCode` reports `failed` — the customer
sees the server's reason and is never advanced to the code step. Worst case on a
flag-read failure is one honest error message instead of a total lockout.

Covered by `src/features/auth/loginAvailability.test.ts` (18 tests: flag ON, flag
OFF, RPC/RLS/network read failure, and server rejection while login is really
off).

> Stronger option: instead of storing `send_sms_hook_secret` in `secret_config`,
> set it as the Edge Function env var `SEND_SMS_HOOK_SECRET` (and the OTP pepper as
> `WHATSAPP_OTP_HMAC_SECRET`). The function prefers env vars when present.
>
> **Caveat:** the pre-login readiness flag `whatsapp_login_enabled()` runs in SQL
> and **cannot see Edge Function env vars**. If you use the env-var path and leave
> `secret_config.send_sms_hook_secret` empty, the flag stays `false` — and since
> WhatsApp is now the only login path, the app shows the "unavailable" card even
> though the hook itself would work. In that setup you **must** also store the
> hook secret in `secret_config` (the app never reads it — the flag only checks
> presence).

---

## 7. Admin/staff login impact

**None.** The web Admin Dashboard login (`src/components/AuthScreen.tsx`) is
email/password only and was not touched. There is no WhatsApp login on the admin
screen. Existing admin/accountant accounts keep working exactly as before.

### 7.1 `whatsapp-test-config` now requires AAL2, not just the admin role

Nothing about **customer** login changed here. This is about the admin diagnostics
endpoint behind the WhatsApp card — the one that reads the provider's readiness and
sends a test OTP.

It used to authorize the way three sibling admin functions did — `staff-accounts`,
`email-test-config` and the still-frozen `payment-test-config`:

```ts
if (!profile || profile.role !== 'admin') return json({ error: 'forbidden' }, 403);
```

That checks the **role** and not the MFA assurance level. Everywhere in SQL, admin
authority is `is_admin()` = role `admin` **and** `jwt_has_aal2()`
(`20260810142000_staff_mfa_aal2.sql`). An administrator signed in with email and
password but without completing TOTP therefore passed this gate while every RLS
policy and admin RPC refused them — and `whatsapp-test-config` then works through
the **service-role** client, which bypasses RLS. At AAL1 that endpoint could read
`integration_settings` readiness and fire a real WhatsApp template send.

It now calls `public.is_admin()` **as the caller** and judges the answer with the
shared pure predicate in `supabase/functions/_shared/adminAuth.ts`:

```ts
const caller = userClient(authHeader);
const { data: { user } } = await caller.auth.getUser();
if (!user) return json({ error: 'unauthorized' }, 401);
const { data: profile } = await admin.from('profiles').select('role')…
const { data: isAdmin, error: adminErr } = await caller.rpc('is_admin');
const gate = decideAdminAuthorization({ data: isAdmin, error: adminErr }, profile?.role);
if (!gate.allowed) return json({ error: gate.error, code: gate.code }, gate.status);
```

Three details that are deliberate rather than incidental:

- **Postgres decides, not TypeScript.** Decoding `aal` from the JWT here would be a
  second implementation of the predicate in a second language with nothing in CI
  comparing them, so the next auth migration would diverge silently. PostgREST also
  populates `request.jwt.claims` only after verifying the signature, so a forged
  token cannot reach the comparison — a property a local decode does not have.
- **The gate sits *after* `getUser()`.** `supabase-js` falls back to sending the
  anon key when a session refresh fails, so gating earlier would report an expired
  session as "two-factor required" and send the admin to the wrong remedy.
- **The new failure mode is `403` with `code: 'mfa_required'`**, distinct from the
  plain `forbidden` a non-admin gets. The admin console surfaces the `error`
  sentence verbatim, so it reads as an instruction to complete the two-factor step.

**Who this affects.** The admin console already demands TOTP at sign-in
(`StaffMfaGate`), so the normal UI path is unchanged. It bites an admin account
with no enrolled TOTP factor calling the function directly. As of 2026-08-23 one of
the two admin accounts has no verified factor.

**Not live yet.** The deployed `whatsapp-test-config` is v2 from 2026-07-09 and
predates this change; redeploying it is a separate owner approval
([`OWNER_ACTIONS.md`](OWNER_ACTIONS.md) §5, recorded in §16).

`auth-send-sms-whatsapp`, `whatsapp-send-otp`, `whatsapp-verify-otp` and
`whatsapp-webhook` are **untouched** — none of them is admin-gated, and the customer
login path in §2 is unaffected in every respect.

---

## 7.2 Rate limiting on the login path (added 2026-08-31)

**What was unprotected.** There are two OTP senders in `_shared/whatsappSend.ts`:

| sender | limiting |
| --- | --- |
| `sendOtpViaWhatsApp` — phone **verification** | `otp_begin_send`: cooldown / hourly / daily |
| `deliverOtpTemplate` — the raw sender | **none** |

`auth-send-sms-whatsapp` — the Send SMS Hook every real customer login goes
through — called `deliverOtpTemplate` **directly**. So login had no per-phone
cooldown, no per-IP cap and no daily ceiling in our code. The only throttle was
Supabase Auth's own project-wide SMS limit, which is dashboard state and **not
verifiable from the repository**. Every attempt is a **billable** Meta
authentication-template message.

### A reservation, not a check — and the first attempt got this wrong

The first version of this fix counted rows in `whatsapp_message_logs`. That table
is written **after** the Meta POST returns, so under concurrency every request in
a burst reads the same pre-send history, every one sees room, and every one sends.
It was documented as "a check, not a reservation" that "bounds the rate". Review
pointed out that under a burst it bounds *nothing*, which is correct — it would
have shipped a limiter that fails exactly when it is needed.

The budget is now consumed **before** the send:

1. `pg_advisory_xact_lock(hashtext(phone))` — serialises callers for the **same
   number only**, so two different customers never contend;
2. count reservations in the window;
3. refuse, or **insert the reservation** and return its id.

Steps 2 and 3 are inside the lock, so count-then-insert cannot interleave. The
lock is transaction-scoped: it releases on commit *or* rollback, so a failed call
cannot wedge a number.

`otp_release_send` hands the budget back when delivery fails — otherwise a Meta
outage would burn every customer's daily quota while delivering nothing. Bounded
residual risk, stated rather than hidden: someone who can reliably force delivery
failure for **one** number can retry that number freely. It costs our API calls,
not delivered messages, and cannot reach any other number.

### The budget is shared, in both directions

The first version claimed counting both message types stopped an attacker
alternating between the senders. It did not: `otp_begin_send` counted
`otp_challenges` and never saw login sends, so a caller could spend the login
allowance and then a **separate** verification allowance. The test asserted only
the direction that happened to work.

Both senders now take their limits from `otp_send_reservations`, under the same
per-phone lock. The suite asserts **both** directions.

**One deliberate asymmetry:** `otp_begin_send` does **not** release. That path has
always consumed budget at challenge creation rather than on delivery success, and
changing that is a behaviour change to a live path — not something to fold into a
rate-limit fix.

### What is actually tested

`supabase/tests/otp_login_rate_limit_test.sql` asserts nine properties, including
the boundary (4 against a cap of 5 allowed, the 5th refused), release being
id-scoped and idempotent, and the shared budget both ways.

The concurrency case uses **dblink for a genuine second session**: session A
reserves inside an open transaction and holds the lock; session B attempts the
same number with a short `lock_timeout` and must time out. An earlier draft seeded
*committed* rows instead — which passes with or without the lock, and so proved
nothing. Removing the lock now makes the suite fail with `NOT_SERIALISED`.

**That suite would have skipped in CI.** Five suites read
`test.dblink_conninfo`, nothing set it, and each opens with a loud `SKIP` when it
is absent — so every concurrency guarantee in this repository has been skipping
since it was written, reporting the same green as a passing suite.
`.github/sql-ci/run.sh` now hands each suite a conninfo for its own clone. All
five run; none skip.

### Ordering, when this is applied and deployed

Apply the migration **first**. It defines the RPCs `auth-send-sms-whatsapp`
calls.

**CORRECTED 2026-09-01 — this paragraph, and the migration's own header, said the
apply implies TWO deploys, `auth-send-sms-whatsapp` and `whatsapp-send-otp`. It
implies ONE.** The reasoning behind the second was that `otp_begin_send` changed,
but a function body changing server-side does not require redeploying its caller:
the signature is byte-identical, so the deployed call still binds and simply
executes the new body. `whatsapp-send-otp` is not modified by this work at all —
it does not appear in PR #301's diff, and the bundle deployed in Production
already contains the unchanged 13-argument `admin.rpc('otp_begin_send', …)` call
in `_shared/whatsappSend.ts`. Redeploying it would have been a production write
that changed nothing.

On first apply the reservation table is empty, so per-phone limits reset once.

### STATUS 2026-09-02 — APPLIED and DEPLOYED. The login path is now rate-limited.

`20260831130000_otp_login_rate_limit` was applied to Production on **2026-09-01 at
12:46:15 UTC** (live version `20260901124615`, history 121 → 122; ledger row 77 in
`docs/MIGRATIONS.md`), and **`auth-send-sms-whatsapp` was deployed as version 2 on
2026-09-02**, both on explicit owner approval.

**The hole described in §7.2 is closed.** Every real customer login now reserves
against the shared per-phone budget before the Meta send. The effective limits
come from `resolveWhatsAppConfig`: **60 s cooldown** (`resend_cooldown_seconds`),
**5 per hour**, **10 per day** — shared with the phone-verification path, in both
directions.

**A refusal returns 429** with a deliberately generic message. The reason
(`cooldown` / `hourly_limit` / `daily_limit`) is **not** echoed, because telling a
caller which limit it hit reveals how much traffic a given number has already had.

**It fails OPEN on an RPC error, by design.** If `otp_reserve_send` cannot be
reached, the send proceeds. A limiter that is unreachable must not become an
outage of the entire login system — the trade is a temporary loss of limiting, not
a loss of login.

| | |
| --- | --- |
| `otp_send_reservations` | created, RLS on, **0 policies** (deny-by-default), **0 rows** |
| `otp_reserve_send` / `otp_release_send` | created, 1 overload each, `service_role` only |
| `otp_begin_send` | redefined in place — signature byte-identical, overload count still **1** |
| exposure | `anon` and `authenticated`: no table select/insert, no execute on any of the three |
| advisors | 0 ERROR; the only finding naming a new object is the expected "RLS enabled, but no policies exist" |

**Nothing remains.** `auth-send-sms-whatsapp` was the one deploy this work
required, and it shipped on 2026-09-02 as **version 2**, `verify_jwt` preserved at
`false` (the hook is called by Supabase Auth with a Standard Webhooks signature,
not a JWT — flipping that would break every login).

**Verified after deploying, without sending anybody an OTP:**

| check | result |
| --- | --- |
| the function boots | **yes** — `GET` returns the hook-shaped `405 Method not allowed` |
| the signature gate holds | **yes** — an unsigned `POST` returns `401 Invalid signature`, at step 2, before any reservation or Meta send |
| cost of that smoke test | **zero** — `otp_send_reservations` still 0 rows, no `whatsapp_message_logs` row |
| bundle | all six files present live; the reservation call and the release call are both in the deployed `index.ts` |

The boot check is the one that mattered: the deploy bundle flattens
`../_shared/…` imports to `./…`, so a mistake there would have failed at module
load and taken every login down. A live login test was deliberately **not**
performed — it would send a billable authentication-template message to a real
customer's number.

### The verification path needs NO deploy, and is already limited

An earlier revision of this section listed `whatsapp-send-otp` as a second
required deploy. That was wrong, and the correction matters because it would have
meant a production write that accomplished nothing.

The migration replaced `otp_begin_send`'s **body** under a byte-identical
13-argument signature. A caller does not need redeploying for that — the existing
binding resolves to the new body. So the verification path did not merely keep
working; **it started using the shared reservation budget at 12:46:15 UTC, the
moment the migration was applied.** Its limits now come from
`otp_send_reservations` under the same per-phone advisory lock as the login path
will, and a verification send consumes budget the login path can see. That is live
today.

Checked three ways rather than reasoned about:

| evidence | result |
| --- | --- |
| files changed by PR #301 (`44a27cf`) | 8 files; the only Edge Function touched is `auth-send-sms-whatsapp/index.ts`. `_shared/whatsappSend.ts` and `whatsapp-send-otp/` are absent from the diff |
| the **deployed** `whatsapp-send-otp` bundle (v2), read live | its embedded `_shared/whatsappSend.ts` carries the unchanged 13-argument `admin.rpc('otp_begin_send', …)` call |
| `otp_begin_send` after the apply | overload count **1** — the signature did not fork, so nothing became ambiguous |

Return shape and reason strings (`ok` / `cooldown` / `hourly_limit` /
`daily_limit`) are unchanged, so the handler's branching is unaffected. There were
**0** `otp_challenges` rows in the preceding two days, so the one-time limit reset
at apply time throttled and freed nobody.

**One unrelated observation, recorded rather than acted on:** the deployed bundle
is not byte-identical to the repository copy — the deployed source carries no
JSDoc blocks and condensed helpers, and it was deployed 2026-08-10, before these
files first appear in git history (`624872d` adds them as new files). The exported
surface and the RPC call site match. That drift predates this work, is not caused
by the migration, and is not a reason to deploy as part of it.

Behaviour was proven on the disposable local cluster via
`supabase/tests/otp_login_rate_limit_test.sql`, **not** against Production —
exercising it live would mean writing reservation rows, which an apply approval
does not cover (§10).

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

Both now use `normalizeSaudiPhoneE164`, so profile verification follows the same
Saudi-only rule as login. `whatsapp-test-config` (admin diagnostics send) and
`account-delete-request` (re-verifies a phone already stored on the profile)
deliberately keep the country-agnostic `normalizePhoneE164`: the admin test send
must be able to target any number, and account deletion must never be blocked by
the shape of the phone already on the profile.

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

- **No legacy accounts to migrate.** Confirmed by the owner: there are no
  existing customer accounts to preserve. Any test/unused accounts left over are
  not required, so no email→phone linking or profile reconciliation is needed.
  Nothing is auto-merged and nothing is deleted by this change.
- **No fallback:** if WhatsApp login is off or misconfigured, customers cannot
  log in at all. The Send SMS Hook fails closed by design, so verify the whole
  chain (§12) before flipping the flag.
- **Saudi mobiles only, by design.** There is no country picker; a non-Saudi
  number cannot be used to sign up or log in.
- Meta template approval can take time — do not flip `whatsapp_login_enabled`
  ON until the templates are approved and tested end-to-end.

### If a future account ever does need linking
Do it **server-side** for a *signed-in* user via GoTrue admin
`updateUserById({ phone })` (or the `phone_change` flow) — that keeps one
`auth.uid()` and one profile. Never merge by writing `profiles` directly.

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
   **Send SMS Hook secret = Yes**; the login screen shows the `+966` field
   instead of the "unavailable" card.
7. Test end-to-end with a real Saudi number, then announce to customers.

Because there is no email fallback, steps 1–6 are a hard prerequisite for
customers being able to log in at all — not an enhancement.
