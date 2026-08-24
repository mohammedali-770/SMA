# Payment & Refund Work — POSTPONED

> **Status: POSTPONED (owner decision, 2026-07-29).**
> The payment gateway provider has **not been selected yet**. Until it is,
> nothing in the payment / payment-processing / refund area may be modified,
> deployed, scheduled or tested.
>
> **Nothing was deleted.** All payment code, migrations, database objects and
> deployed Edge Functions remain exactly as they were. The only live change
> made under this decision was **disabling the `payment-refund-worker` cron
> job** so no automated refund processing can start while the area is frozen.

This document is the authoritative record of the postponement. It supplements
— and does not replace — the standing freeze in `CLAUDE.md` §6.

> **UPDATE 2026-08-24 — a SECOND candidate provider now exists in the
> repository.** The owner said "maybe we will go with MOYASAR" and pointed at
> Moyasar's API documentation. A complete, tested, **inert** Moyasar integration
> was built on `claude/moyasar-payment-api-jy3gwb` so the choice can be made
> against real code instead of a brochure. **The postponement below still
> stands**: no provider has been selected, nothing was deployed, no migration was
> applied, no credential exists, and Moyasar is not enabled anywhere. See §9.

---

## 1. The decision

The owner instructed, on 2026-07-29:

- Ignore all payment gateway, payment processing and refund-related work.
- Do **not** modify, deploy, schedule or test any payment/refund functionality.
- Disable the `payment-refund-worker` cron job if it is active.
- Do **not** delete existing payment code or migrations.
- Continue with non-payment work only.
- Keep payment work clearly documented and postponed until the gateway is
  officially selected.

The existing Tap integration is treated as **provisional**. It is still wired
up in Production because live ordering depends on it, but it must not be
treated as the final provider choice, and no further work is to be built on
top of it until the decision is made.

## 2. What is frozen

No change of any kind — repository, Production, or configuration — may be made
to:

| Area | Includes |
| --- | --- |
| Payment Edge Functions | `payment-initiate`, `payment-verify`, `payment-webhook`, `payment-return`, `payment-test-config`, `payment-refund` |
| Tap diagnostic functions | `tap-admin-test-return`, `tap-diag-temp`, `tap-return-probe` |
| Shared payment helpers | `supabase/functions/_shared/tap.ts`, `supabase/functions/_shared/tapVerify.ts`, `supabase/functions/_shared/tapRefund.ts`, `supabase/functions/_shared/moyasar.ts`, `supabase/functions/_shared/moyasarVerify.ts`, `supabase/functions/_shared/moyasarRefund.ts` |
| Admin payment surface | `src/components/admin/TapPaymentPanel.tsx`, `src/components/admin/MoyasarPaymentPanel.tsx`, `src/lib/tapAdminTest.ts`, `src/lib/moyasarAdminTest.ts`, and the `payment` slot of `src/components/admin/IntegrationCard.tsx` |
| Checkout sessions | `checkout_sessions` table, its RPCs, and the checkout/session functions |
| Refund stack | `order_refunds`, `orders.refund_state` and its timestamp/failure columns, `claim_order_refund`, `finalize_order_refund`, `list_failed_order_refunds`, `order_refund_due`, `enforce_refund_state_transition`, `expire_stale_order_refund_claims`, `invoke_payment_refund_processor` |
| Scheduling | The `payment-refund-worker` cron job (and any new payment/refund schedule) |
| Provider configuration | The `payment`/`tap` row in `integration_settings`, Tap credentials, and the refund trigger secret in Vault |
| Payment business rules | Pricing→capture→settlement→refund policy, idempotency keys, retry policy |
| **Mobile client payment surface** | `apps/mobile/src/app/payment/**` (hosted-checkout and return routes), `TapWebView*.tsx`, `features/checkout/paymentFlow*`, `checkoutHandoff*`, `pendingSession*`, `webviewPolicy*`, `lib/payment.ts` |

Reopening any of the above requires **separate, explicit owner approval**
(`CLAUDE.md` §5 and §6).

**The mobile row is new (2026-08-19), and it was added because the omission had
already cost something.** The freeze table and the `payments` ownership rule both
listed only Edge Functions and database objects, so a change to the app's own
payment surface fired no CI rule and matched nothing in this document. A branch
took a self-declared "scoped exception" to the freeze in `CheckoutScreen.tsx`,
recording an owner instruction that had not been given, and nothing flagged it —
it was caught by reading the commit body. The ownership rule now covers these
paths, so the next one fails CI unless this document changes with it.

**One honest limit.** `CheckoutScreen.tsx` is deliberately **not** in the
`payments` rule: it is the whole order screen, not a payment module, and a rule
that fires on every checkout edit gets exempted on every checkout edit. It is
covered by `order-lifecycle` instead, so a change there still has to update
`docs/ORDER_CONFIRMATION_FLOW.md` — which is where the two payment-specific
catches inside it are described. That is a weaker gate than this one: it demands
documentation, not reconciliation against the freeze. Read the payment catches in
that file as frozen even though the rule pointing at them is not the payments
rule.

## 3. What changed on 2026-07-29

Exactly one live change:

```sql
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'payment-refund-worker'),
  active := false
);
```

Verified afterwards:

| Check | Result |
| --- | --- |
| `payment-refund-worker` | jobid 6, schedule `*/5 * * * *`, **`active = false`** |
| Job row / schedule / command | **preserved** — disabled, not dropped |
| `invoke_payment_refund_processor()` | still exists, unchanged |
| `expire_stale_order_refund_claims()` | still exists, unchanged |
| `order_refunds`, `claim_order_refund`, `finalize_order_refund` | still exist, unchanged |
| Migration count | 62 live rows, unchanged |
| Orders / enrolled refunds / refund rows | 23 / 0 / 0 — unchanged |

Nothing else was touched: no function was redeployed, no migration was
applied, no secret was rotated or removed, no repository file was edited.

## 4. The five operational crons stay ACTIVE

Disabling the refund worker must not be confused with pausing operations.
These remain active and are **not** part of the payment freeze:

| Job | id | Schedule | Purpose |
| --- | --- | --- | --- |
| `account-deletion-processor` | 1 | `* * * * *` | Store-compliance account deletion |
| `lazywait-sync` | 2 | `* * * * *` | Lazywait POS order sync |
| `order-integrity-watchdog` | 3 | `*/2 * * * *` | Observe-only order integrity monitoring |
| `operations-alerts-evaluator` | 4 | `*/5 * * * *` | Internal operations alerts |
| `operations-digest-generator` | 5 | `0 * * * *` | Internal AR/EN daily digest |

## 5. Live payment state at the time of postponement

Recorded so the state can be compared when the area is reopened.

- **Tap integration row** (`integration_settings`, `payment`/`tap`):
  `enabled = true`, credentials present (3 secret keys / 5 public keys).
  **Deliberately left enabled** — customers place orders through the live
  checkout, and disabling the provider row would break ordering. Postponement
  freezes *work on* payments; it does not switch off the running checkout.
- **Deployed payment Edge Functions** (all left as-is): `payment-initiate` v6,
  `payment-webhook` v4, `payment-return` v6, `payment-verify` v2,
  `payment-test-config` v3, `payment-refund` v1, `tap-admin-test-return` v2,
  `tap-diag-temp` v2, `tap-return-probe` v2.
- **Refund trigger secret**: provisioned in Vault, retained, never printed.
  Without it `payment-refund` returns `503` and processes nothing — a second,
  independent reason no refund can run while the worker is disabled.
- **Data**: 23 orders, **0 paid**, **0** orders enrolled for refund
  (`refund_state` all `none`), **0** rows in `order_refunds`,
  9 `payment_records`.

Because zero orders are enrolled for refund and zero refund rows exist, the
disabled worker has **no backlog**. Nothing is queued and waiting.

## 6. Retained payment migrations (applied, not to be edited)

All of these are already applied to Production and are **never** to be edited
(`CLAUDE.md` §8, `docs/MIGRATIONS.md` §2). They stay exactly where they are:

| Repository file | Live version |
| --- | --- |
| `20260709140000_payment_methods.sql` | `20260709111046` |
| `20260712120000_tap_payments.sql` | `20260712070033` |
| `20260712160000_checkout_sessions.sql` | `20260712185657` |
| `20260712170000_checkout_sessions_hardening.sql` | `20260713044036` |
| `20260724120000_order_confirmation_state_machine.sql` | `20260729074810` |
| `20260724180000_tap_reference_order_opaque.sql` | `20260729080617` |
| `20260729090000_payment_refund_scheduler.sql` | `20260729112224` |

Any future change is a **new** migration, applied only through the
owner-approved `apply_migration` workflow.

## 7. Open design question to settle BEFORE reopening

This is recorded here because it is the strongest reason the worker must stay
disabled — it is **not** being fixed now, because the payment area is frozen
and the fix depends on which provider is chosen.

`classifyRefundResponse()` in `supabase/functions/_shared/tapRefund.ts`
resolves three outcomes: `succeeded`, `failed`, and `pending`. `pending`
covers everything ambiguous — in-flight, undocumented status, 5xx, timeout,
transport error — and a `pending` outcome **releases the claim so the refund
is retried later**.

That is the right conservative choice for a *manual* process: it never tells a
customer a refund completed when it may not have, and never writes off a
refund that may still succeed. But combined with an automatic every-5-minutes
scheduler it is a **double-refund risk**, because Tap's `reference.merchant`
is a reconciliation reference, **not** a provider-side idempotency key: a
refund that actually succeeded but returned ambiguously would be re-attempted.

`expire_stale_order_refund_claims()` mitigates *stuck leases* (it escalates a
stale `processing` claim to `failed`/`lease_expired` rather than retrying it),
but it does not change the in-function `pending` release path.

### UPDATE 2026-08-19 — Tap answers this, with a 24-hour caveat

Researched from Tap's public documentation (`docs/integrations/Tap_API_Reference.md`),
under an explicit owner instruction to investigate Tap. **Not confirmed by Tap and
not tested against a live account.**

Tap **does** provide a true idempotency key: `reference.idempotent` restricts
duplicate transactions on Authorize, Charges **and Refunds** — the same string
returns the first response instead of initiating a second refund. Tap also
documents a refund retrieve endpoint.

Two things follow, and they pull in opposite directions:

1. **The refund path now sends it.** `buildRefundBody` previously sent only
   `reference.merchant`, which is exactly the "reconciliation reference, not an
   idempotency key" this section describes. It now sends `reference.idempotent`
   as well.
2. **The key expires after 24 hours.** A refund retried beyond that window is a
   genuinely new refund as far as Tap is concerned. So the double-refund risk is
   **bounded, not eliminated**, and the every-5-minutes worker could still cross
   that boundary on a long-stuck refund.

**This section therefore stands.** The worker stays disabled. What has changed is
that the remaining work is now specific rather than open-ended: either confirm
`GET /v2/refunds/{id}` can resolve an ambiguous attempt (Q3 in the Tap
reference), or make the claim/release path refuse to retry past the idempotency
window and route those refunds to human review instead.

**A related defect was found and fixed in the same pass.** The CHARGE payload had
`idempotent` at the top level, where Tap's schema does not define it, so charge
idempotency had never been active at all — a retried `payment-initiate` could
have created a second charge. Nothing was affected in practice because online
payment has never been enabled. See the Tap reference §2.

**Before any automated refund processing is re-enabled**, the chosen provider
must supply either a true idempotency key on the refund endpoint, or a
reliable refund-status lookup that can resolve an ambiguous attempt before a
retry. If neither exists, ambiguous refunds must route to human review instead
of being retried automatically.

### UPDATE 2026-08-24 — Moyasar answers this the OTHER way, and better

Researched from Moyasar's public documentation
(`docs/integrations/Moyasar_API_Reference.md` §4). **Not confirmed by Moyasar and
not tested against a live account.**

Moyasar takes the two halves of the requirement above and swaps which one it
satisfies.

1. **It has no refund idempotency key at all.** `given_id` is documented for
   `POST /v1/payments` only; no idempotency parameter is documented on
   `POST /v1/payments/{id}/refund` — nor on `POST /v1/invoices`, which is the
   call our checkout actually makes. On that axis Moyasar is **worse than Tap**,
   which at least offers a 24-hour `reference.idempotent` on refunds.
2. **It has the reliable status lookup that Tap only maybe had.**
   `GET /v1/payments/{id}` returns `status`, the cumulative `refunded` amount in
   minor units, and `refunded_at`. Those three fields answer "did my ambiguous
   attempt actually land?" precisely, which is exactly the second option this
   section demands.

`resolveRefundFromPayment()` in `supabase/functions/_shared/moyasarRefund.ts`
implements that resolution, and `payment-refund` runs it **before any retry**
rather than re-POSTing blind. A refund whose timestamp is set but whose amount
does not reconcile resolves to `refund_ambiguous_needs_review` and is parked for
a person — never retried, because a retry is the one action that could send the
money twice.

The missing invoice idempotency is handled the same way, one step earlier: the
initiate path never retries a failed invoice create. It looks the invoice up by
the per-attempt reference in its metadata and adopts the existing one, and if
that lookup fails it creates nothing at all.

**This section still stands and the worker stays disabled.** What has changed is
that for Moyasar the §7 blocker is now a *code review* rather than an open
question about the API. Re-enabling the worker remains a separate, explicit owner
action under §5, and would additionally need the provider to be chosen, the
account to exist, and the behaviour to be proven in the sandbox.

### Committed but DORMANT — the Tap card interop plugin (2026-08-19)

`apps/mobile/plugins/withTapCardInterop.js` exists and is unit-tested, and is
**deliberately not listed in `app.json` → plugins**. It therefore runs on no
build and changes no binary. `card-react-native` is not a dependency, online
payment is disabled, and the agreement is not signed.

It is committed dormant on purpose: the finding it encodes is easy to lose and
expensive to rediscover. `card-react-native` ships a legacy paper view manager
with no `codegenConfig`, so under the mandatory New Architecture on RN 0.86 it
renders on Android (interop is on by default) but **fails silently on iOS**,
where `RCTLegacyViewManagerInteropComponentView` matches a hardcoded allowlist
that no third-party component is in. The library's own error message blames the
build, so the cause is not where anyone would look. Full detail:
`docs/integrations/Tap_API_Reference.md` §4.1.

**To activate**, once the SDK is installed and the freeze is lifted, add
`"./plugins/withTapCardInterop"` to the plugins array. That is a payment change
and needs its own owner approval.

**Still unproven:** that the card fields render once registered, and that Tap's
Android SDK does not collide with Expo SDK 57. Both need an EAS build on a real
device — neither can be settled from source.

## 8. Resume checklist (when the gateway is officially selected)

Each item requires its own explicit owner approval — none of it is authorized
by this document.

1. Record the selected provider and supersede this document. Two candidates now
   have working code: Tap (§5, already wired to Production) and Moyasar (§9).
   §9.4 is the comparison to decide from.
2. Decide the migration path for the provisional Tap integration (keep,
   replace, or run both during a transition).
3. Resolve §7: confirm provider idempotency / status-lookup guarantees, and
   rework `classifyRefundResponse()` and the claim/release path accordingly.
4. Re-review `payment-refund` end to end against the chosen provider.
5. Re-test in a non-production context — never against live customer orders.
6. Re-enable the worker only after 3–5 pass:
   ```sql
   select cron.alter_job(
     job_id := (select jobid from cron.job where jobname = 'payment-refund-worker'),
     active := true
   );
   ```
7. Verify the first scheduled runs against a zero backlog before any real
   refund is allowed to flow.
8. Update `docs/MIGRATIONS.md`, `PROJECT_STATUS.md` and `CLAUDE.md` §6.

## 9. Moyasar — the second candidate (2026-08-24)

**Status: BUILT, INERT, NOT CHOSEN.** The owner said "maybe we will go with
MOYASAR" and supplied `https://docs.moyasar.com/api/api-introduction`. That is an
instruction to build the integration, not a decision to adopt the provider, so
what exists is a complete implementation that does nothing until somebody
deliberately turns it on.

### 9.1 What was added, and what it cannot do

| Added | |
| --- | --- |
| `supabase/functions/_shared/moyasar.ts` | Amounts, config resolution, invoice payload, status maps, webhook token check, verification binding, sanitizers |
| `supabase/functions/_shared/moyasarVerify.ts` | Invoice + payment retrieval, validate-and-confirm, invoice reconciliation |
| `supabase/functions/_shared/moyasarRefund.ts` | Refund body, response classification, resolve-before-retry |
| `supabase/migrations/20260824100000_moyasar_payment_provider.sql` | `payment_records.provider_checkout_ref`, provider-generic `begin_payment_attempt` / `begin_session_attempt` |
| `src/components/admin/MoyasarPaymentPanel.tsx`, `src/lib/moyasarAdminTest.ts` | Admin readiness + sandbox test |
| `docs/integrations/Moyasar_API_Reference.md` | The researched API reference |
| Moyasar branches in `payment-initiate`, `payment-verify`, `payment-webhook`, `payment-refund`, `payment-test-config` | Dispatch only |

**Nothing about this is live, and four independent things keep it that way:**

1. `integration_settings.provider_name` is not `'moyasar'`, so every payment
   function falls through its Moyasar branch without entering it.
2. No Moyasar credential exists — not in the repository, not in
   `integration_settings`, not in Vault.
3. **No Edge Function was deployed** and **the migration was not applied**, so
   `begin_payment_attempt` does not exist in Production. Even a fully configured
   provider row would fail at the first RPC.
4. `resolveMoyasarConfig()` fails closed on a missing key, a key whose prefix
   does not match its slot, or a missing webhook secret.

Turning any of that around is an owner action under `CLAUDE.md` §5.

**No Tap code path was changed.** The Tap functions, the Tap migrations and
`tap_begin_payment_attempt` / `tap_begin_session_attempt` are untouched; the new
generic RPCs sit beside them and nothing was migrated onto them.

### 9.2 The three differences that shaped the implementation

These are not stylistic. Each one is a place where copying the Tap approach would
have been wrong.

**Cardholder data may not reach our backend.** Moyasar states that sending it
"will result in canceling the agreement … in addition to the immediate
termination of the service". So `POST /v1/payments` with a card source is not an
option, and the integration uses the **hosted Invoice** instead. The card never
touches our infrastructure.

**Amounts are minor units.** Moyasar wants halalas (`100` = 1.00 SAR); Tap wants
major units (`1` = 1.00 SAR). Getting this wrong is a 100× charge. The conversion
lives in one tested function and is never inlined.

**The webhook has no signature.** Tap HMACs the charge fields; Moyasar sends a
`secret_token` in the body, which proves the sender knows a secret but is not
bound to the payload. The webhook is therefore treated as a nudge — it decides
whether we look, never what we conclude — and confirmation always comes from a
server-to-server fetch bound on `payment.invoice_id`. A forged webhook that
guessed the token confirms nothing.

### 9.3 Two ids, and why the refund stack needed no change

Tap issues one id: a charge, created up front and refunded later. Moyasar issues
two: an **invoice** id, known when the attempt opens and owning the hosted URL,
and a **payment** id, which exists only once the customer pays and which is what
`POST /v1/payments/{id}/refund` takes.

So `provider_ref` keeps holding the thing that gets confirmed and refunded (the
payment), exactly as it does for a Tap charge, and the new
`provider_checkout_ref` column holds the invoice. Because
`order_refunds.charge_ref` is populated from `provider_ref`, the entire refund
stack — `claim_order_refund`, `finalize_order_refund`, the partial unique index,
`order_refund_due` — receives a refundable Moyasar payment id with **no change to
any existing RPC**.

### 9.4 Tap versus Moyasar, on the axes that decide it

| | Tap | Moyasar |
| --- | --- | --- |
| Card data on our server | Hosted checkout — no | Prohibited by contract; hosted invoice — no |
| Amount units | major | **minor (halalas)** |
| Webhook authentication | HMAC over charge fields | **shared token in the body, no signature** |
| Checkout idempotency | `reference.idempotent`, 24h | **none documented** → reconcile-before-create |
| Refund idempotency | `reference.idempotent`, 24h | **none documented** |
| Refund status lookup | assumed, unproven (§7 Q3) | **`refunded` + `refunded_at` on the payment** |
| Key/mode confusion detectable | no (opaque keys) | **yes (`sk_test_` / `sk_live_`)** |
| Declined card HTTP code | non-2xx | **201** — status field, not the code, decides |
| Currently wired to Production | yes (provisional) | no |
| Agreement signed | **no** | **no** |

Neither column is a recommendation. The honest summary: Moyasar's webhook
authentication and idempotency story are weaker and had to be compensated for in
our code; its refund-status lookup and self-describing keys are stronger and let
us build two controls Tap could not support.

### 9.5 What is NOT established

- That Moyasar is the provider. **The decision is open.**
- That any of it works. Nothing has been run against a Moyasar account, sandbox
  or live. No account exists.
- The seven open questions in `docs/integrations/Moyasar_API_Reference.md` §11 —
  including which spelling of the failure webhook event is actually sent, and
  whether a metadata list filter fails loudly or silently.
- Anything about fees, settlement or onboarding.

---

## 10. Related documents

| Doc | Owns |
| --- | --- |
| `CLAUDE.md` §5, §6 | The standing payment/Tap freeze and approval rules |
| `docs/MIGRATIONS.md` | Migration ledger and the only approved Production schema workflow |
| `docs/ORDER_CONFIRMATION_FLOW.md` | Order confirmation lifecycle and refund enrolment rules |
| `docs/integrations/Moyasar_API_Reference.md` | The researched Moyasar API contract and its seven open questions |
| `docs/integrations/Tap_API_Reference.md` | The researched Tap API contract |
| `PROJECT_STATUS.md` | Overall project state and onboarding |
