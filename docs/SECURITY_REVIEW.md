# Spicy Meal — Cybersecurity Review & Hardening (2026-07-08)

Full-code security audit + hardening pass across the web/admin frontend, the Expo
mobile app, Supabase (Postgres RLS, RPCs, migrations), Supabase Edge Functions,
the Lazywait POS integration, and the prepared Geidea payment flow. No feature,
UX, pricing, VAT, coupon, loyalty, order-flow, Lazywait-payload, payment, or admin-
permission behavior was changed except to fix a confirmed security bug.

---

## 1. Executive summary

The codebase has a **strong, deliberately security-conscious posture**. Money is
recomputed server-side (`place_order` is the single source of truth), secrets are
held only in `integration_settings.secret_config` (table fully revoked from the
API; only `has_secret` is ever returned), every SECURITY DEFINER function pins
`search_path`, all 20 public tables have RLS, webhooks verify HMAC signatures
(timing-safe) before mutating anything, and the mobile client is correctly
configured (AsyncStorage, `detectSessionInUrl:false`, anon-only).

The audit (11-dimension multi-agent fan-out + adversarial verification, plus a
manual review of every critical path, plus Supabase's own security/performance
advisors) found **no Critical or High vulnerabilities**. It confirmed a small set
of Medium/Low/Info issues, all now fixed or documented. Every fix preserves
existing behavior (the one behavior *tightening* — the sync worker now fails
closed — has no live caller and was already mandated by the pilot runbook).

## 2. Risk rating

| Overall pre-fix | **LOW–MEDIUM** |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 (coupon race, sync-worker fail-open) — **fixed** |
| Low | 4 (log amplification, upstream-error passthrough, Android cleartext, dead placeholder secrets) — **fixed** |
| Info / recommendation | CORS wildcard, CSP/headers, OTP/push rate-limit, leaked-password protection, PII retention, mobile dev-dep advisories — **documented** |

## 3. Confirmed vulnerabilities (and their fixes)

### M-1 Coupon `usage_limit` race (TOCTOU) — MEDIUM — FIXED
`validate_coupon()` reads `coupons.usage_count` with no row lock, and `place_order`
bumped the counter with an unconditional `usage_count = usage_count + 1` only after
the order insert. Concurrent checkouts of the same near-limit coupon all read the
stale count, all pass the limit check, and all redeem it → a `usage_limit`-capped
coupon can be over-redeemed (revenue loss). The loyalty path already took
`FOR UPDATE` on the profile row; the coupon row was never locked.
**Fix** (`supabase/migrations/20260708160000_sec_coupon_usage_race.sql`): redefine
`place_order` (byte-identical body — verified by diff — except this block) so the
counter bump is a **conditional** update that only succeeds while under the limit,
and the order is rejected (whole transaction rolls back) if a concurrent order
exhausted it. The `UPDATE` row-locks the coupon, serializing check-then-increment.
Valid single-use behavior is unchanged; only the racy over-limit redemption is
refused.

### M-2 `lazywait-sync` trigger auth fails open — MEDIUM — FIXED
`lazywait-sync` runs with `verify_jwt=false` (server/cron caller). Its shared-secret
gate was `if (triggerSecret && header !== triggerSecret) 401` — so when
`sync_trigger_secret` was **unset**, the check was skipped and the function was
invocable with no auth (anyone could trigger sync runs → Lazywait API load / retry
acceleration; it cannot leak data or create orders).
**Fix** (`supabase/functions/lazywait-sync/index.ts`): **fail closed** — require the
secret to be configured (503 if absent) *and* match the `x-sync-secret` header
(401 otherwise). No live caller exists (no `pg_cron` schedule; pilot not started),
and the pilot runbook already mandated the secret, so nothing breaks.

### L-1 payment-webhook stores full attacker body on signature mismatch — LOW — FIXED
`payment-webhook` (`verify_jwt=false`, internet-reachable) inserted the entire,
unbounded, attacker-controlled JSON (`request: evt`) into `integration_sync_logs`
on **every** signature-mismatch — a storage-growth / log-flooding vector on the one
insert path reachable without a valid HMAC. (It cannot mark an order paid — that
still needs a valid signature + amount match.)
**Fix** (`supabase/functions/payment-webhook/index.ts`): on mismatch, store only a
bounded snapshot (`merchant_reference_id` capped 64 chars, `status` capped 32,
`body_bytes`) instead of the full body. Ops visibility preserved; write is now
bounded. The authenticated skip/confirm paths still keep the full payload
(legitimate reconciliation data, staff-only).

### L-2 payment-initiate leaks upstream Geidea error body to client — LOW — FIXED
On a failed Geidea session creation, `payment-initiate` returned `details: result`
(the raw upstream response body) to the browser, potentially exposing internal
gateway/error detail.
**Fix** (`supabase/functions/payment-initiate/index.ts`): log the upstream detail
**server-side** (`console.error`, truncated) and return a generic error to the
client. Same error strings/status; only the internal `details` blob is removed.
The full body is still retained server-side in `payment_records.raw` on success.

### L-3 Android cleartext traffic enabled — LOW — FIXED
Root `app.json` set `expo-build-properties → android → usesCleartextTraffic: true`,
globally disabling Android's plaintext-HTTP block.
**Fix**: set to `false`. All app endpoints are HTTPS (Supabase), and the Expo dev
client handles Metro/localhost cleartext via its own debug network config, so dev
is unaffected. (The real mobile app in `apps/mobile/app.json` never set this flag.)

### L-4 Dead placeholder provider secrets shipped in the web bundle — LOW — FIXED
`src/data/initialData.ts` exported `INITIAL_PAYMENT_SETTINGS.secretKey`,
`INITIAL_SMS_SETTINGS.apiKey`, `INITIAL_NOTIFICATION_SETTINGS.apiKey` (fake
placeholder secret-shaped values) — bundled into the client and **referenced
nowhere** (dead exports).
**Fix**: removed the three dead constants and their now-unused type imports (the
same treatment already applied to `INITIAL_LAZYWAIT_SETTINGS`). Provider config
lives only in `integration_settings`; the admin UI reads the non-secret projection.

## 4. Potential risks / needs manual verification (not code-changed)

- **Loyalty/coupon require deploy to take effect.** M-1's fix ships as a migration;
  it only protects production once `supabase db push` applies it (see §9).
- **`send-otp` / `push-dispatch`** are `501` placeholders with `verify_jwt=false`
  and no rate-limit/auth. Before either is implemented, add per-phone + per-IP rate
  limiting (OTP) and a caller auth gate (push). Already noted with `TODO`s in code.
- **PII retention** in `payment_records.raw` and the authenticated webhook log
  paths (full gateway payload, staff-only). Standard for reconciliation; consider a
  retention/redaction policy and row TTL before scale.
- **Leaked-password protection is OFF** in Supabase Auth (advisor `0027`). Enable
  HaveIBeenPwned checking in the dashboard (Auth → Policies) — free, no code.
- **Coupon/loyalty cross-account abuse beyond the counter** is bounded by the fixes
  above; monitor coupon redemption vs. limits in reporting.

## 5. No-issue areas verified (controls confirmed correct)

- **Secrets boundary:** `integration_settings` fully revoked from anon/authenticated
  (RLS + no grant); `list/upsert_integration_settings` return only `has_secret`; no
  RPC or query returns `secret_config`. The leaked Lazywait test token is **absent
  from the working tree and full git history**. The `eas.json` JWT is the public
  **anon** key (`role:anon`), public by design.
- **Order integrity:** `place_order` binds `customer_id = auth.uid()`, recomputes
  subtotal/VAT/coupon/delivery/loyalty from the DB, prices from `products.price`,
  validates branch/product availability, forces `payment_status='pending'`,
  row-locks the profile for loyalty, and is idempotent via a unique index.
- **Payments:** `confirm_order_payment` is service-role-only, `search_path`-pinned,
  amount-must-equal-order-total, idempotent, row-locked; both webhooks verify HMAC
  (timing-safe) **before** any mutation; a forged callback cannot mark paid.
- **RLS/authorization:** RLS on all 20 tables; customers see only their own
  orders/addresses/profile/loyalty; staff read-only where intended; **column-level
  grants** stop customers from editing their own `role`/`loyalty_points`; coupons
  admin-only and codes never client-readable; catalog config tables are read-only
  to clients.
- **SECURITY DEFINER hygiene:** every definer function pins `set search_path=public`
  (Supabase advisor reported **no** `function_search_path_mutable`); admin/staff
  RPCs check `is_admin()`/`is_staff()`; dynamic SQL (`execute format`) uses only
  `%I`/positional identifiers over hardcoded table-name arrays (no injection).
- **Edge Functions:** `verify_jwt` matches each caller (user vs webhook vs cron vs
  admin); `lazywait-catalog` enforces `is_admin()`; no `eval`/dynamic code; no
  SSRF (outbound base URLs come from admin config, not customer input); error
  responses no longer leak upstream detail (L-2).
- **Frontend:** no `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`document.write`,
  no open-redirect sinks; admin actions are RLS/RPC-enforced, not UI-only.
- **Mobile:** anon-only; AsyncStorage session store; `detectSessionInUrl:false`;
  foreground-tied auto-refresh; minimal permissions; no secrets/PII logged.

## 6. Tools run and results

| Tool | Result |
|---|---|
| Manual review (all critical migrations, RPCs, Edge Functions, clients) | Done — controls confirmed |
| Multi-agent audit workflow (11 finder areas × adversarial verify) | 12 findings; 8 CONFIRMED, 2 REFUTED, 1 NEEDS_MANUAL, 1 stub |
| `rg` secret scan (working tree) + `git log -S` (full history) | No real secret; leaked token absent |
| `tsc --noEmit` (web) | Pass |
| `vitest run` (web + edge shared helpers) | 79/79 pass |
| `vite build` | Pass |
| `deno check` (edited Edge Functions) | Pass (all 3) |
| `npm audit` (root) | 0 vulnerabilities |
| `npm audit` (apps/mobile) | 12 moderate — all transitive `uuid` under Expo **build tooling** (dev-only, not shipped); `--force` would break the SDK → not applied, tracked |
| Supabase **security advisor** | No code vulns: RLS-deny table + definer-RPC-executable (by design) + leaked-password toggle |
| Supabase **performance advisor** | Unindexed FKs / RLS init-plan / unused indexes — out of scope for this security pass |
| gitleaks / trufflehog / semgrep / osv-scanner | Not installed in this environment (substituted: `rg` + git history scan + Supabase advisors + manual review) |

## 7. Files changed

- `supabase/migrations/20260708160000_sec_coupon_usage_race.sql` — **new** (M-1).
- `supabase/functions/lazywait-sync/index.ts` — fail-closed trigger (M-2).
- `supabase/functions/payment-webhook/index.ts` — bounded mismatch log (L-1).
- `supabase/functions/payment-initiate/index.ts` — generic client error (L-2).
- `app.json` — `usesCleartextTraffic: false` (L-3).
- `src/data/initialData.ts` — removed dead placeholder-secret constants (L-4).
- `docs/LAZYWAIT_PILOT.md` — `sync_trigger_secret` now marked REQUIRED.

## 8. Remaining risks

- The M-1 migration and the M-2/L-1/L-2 function changes **only take effect after
  deployment** (§9). Until then production retains the old behavior.
- `send-otp`/`push-dispatch` still need rate-limiting/auth **before** they are
  implemented (they are inert 501s today).
- Mobile Expo build-tooling `uuid` advisories remain until Expo ships compatible
  versions; they are dev-time only and not in the shipped binary.
- CORS is `*` on Edge Functions — acceptable (Bearer-token auth, no cookies → no
  CSRF), but tighten to an allowlist if any cookie-based flow is ever added.
- No CSP / security headers at the web hosting layer (SPA is static) — add at the
  host/CDN (see §9 checklist); not injected here to avoid breaking the app untested.

## 9. Production security checklist

Deploy the fixes (all transactional / behavior-preserving):
```bash
supabase db push                                   # applies 20260708160000_sec_coupon_usage_race
supabase functions deploy lazywait-sync payment-webhook payment-initiate
# rebuild the web app (dead placeholder secrets removed) and the Android app (cleartext off)
```
Then:
- [ ] **Rotate the Lazywait API token** (the one pasted during testing is compromised — see §10) and set it only in `integration_settings.secret_config.api_token`.
- [ ] Set `sync_trigger_secret` (now **required** for the sync worker) and pass it as `x-sync-secret`.
- [ ] Enable Supabase **leaked-password protection** (Auth settings).
- [ ] Add CSP + security headers at the web host/CDN, e.g.
      `Content-Security-Policy: default-src 'self'; connect-src 'self' https://*.supabase.co; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'`,
      plus `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, HSTS. Validate against the live app before enforcing.
- [ ] Confirm the service-role key and all provider secrets live only in Edge Function env / `secret_config` — never in a `VITE_`/`EXPO_PUBLIC_` var or the repo.
- [ ] Before enabling `send-otp`/`push-dispatch`: add per-phone + per-IP rate limiting and a caller auth gate.
- [ ] Set up backups + a `payment_records`/`integration_sync_logs` retention policy; monitor coupon redemption vs. limits and failed-signature webhook rates.

## 10. Token rotation reminder

**The Lazywait API token pasted during earlier testing MUST be treated as
compromised and rotated before any pilot/production use.** It is not in the repo or
git history (verified), but it may have been exposed during testing. Generate a
fresh token, store it only server-side in `integration_settings.secret_config`, and
never commit, log, or print it. (The Supabase **anon** key is public by design and
does not require rotation; rotate the **service-role** key and the Geidea
`apiPassword` / Lazywait `webhook_secret` only if they were ever exposed.)

## 11. Go / No-Go for the pilot

**GO (security):** No Critical/High vulnerabilities; all confirmed Medium/Low issues
are fixed behavior-preservingly; secret boundary, order integrity, payment
verification, and RLS are sound. Proceed to the single-branch pickup pilot **after**
(a) deploying the fixes in §9, (b) rotating the Lazywait token, and (c) setting the
now-required `sync_trigger_secret`.

**NO-GO if:** any real secret is found in the bundle/repo/logs; the coupon migration
is not deployed (M-1 unpatched); the sync worker is exposed without its secret; or
leaked-password protection and the deploy checklist above are skipped.
