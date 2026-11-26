# Faster card payment: Apple Pay and saved cards (proposed design)

**Status: proposed, 2026-11-18. Nothing here is built.** Building any part is
payment work and needs the owner's go-ahead; each live step (a Moyasar setting,
an Apple certificate, a deploy, an EAS build) is its own owner action
(CLAUDE.md §5).

## 1. Why

Measured on the TEST card order SM-2026-000099 (2026-11-18, 1.00 SAR, Visa):

| Step | Time |
| --- | --- |
| Tap "Confirm" → payment page open | ~3 s |
| **Typing the card on Moyasar's page + 3-D Secure** | **~75 s** |
| Card approved → order created | ~6 s |
| Order created → receipt | ~15 s, removed by #495 |

Our server time is being cut separately: #495 answers before the POS handoff,
and #496 runs function calls next to the database. What remains is the
customer typing a card. Only two things remove that:

- **Apple Pay**: one tap and Face ID.
- **A saved card**: one tap, no typing.

## 2. Apple Pay: test what we already have first

**Apple Pay may already work.** The payment WebView sets `enableApplePay` and
injects no script (`apps/mobile/src/app/payment/checkout.tsx`; `PAYMENTS.md`
§5). Moyasar's hosted page shows the Apple Pay button inside the app; the
owner's 2026-11-18 screenshot shows it. What has never been tested is
**tapping it** on a real iPhone. Moyasar has not confirmed that Apple Pay works
inside a third-party app's WebView (`PAYMENTS.md` §11, question 1).

Apple's rules make it plausible. WKWebView supports Apple Pay since iOS 13, and
injected scripts no longer disable it since iOS 16
(https://developer.apple.com/documentation/safari-release-notes/safari-16-release-notes).
The app's floor is iOS 16.4.

**Step A1, owner, on a real iPhone, in TEST mode, no code:**

> **Corrected 2026-11-26: A1 is not a five-minute check with no side effects, and
> the "no code" framing hides owner-approved changes.** Written 2026-11-18, before
> the state below was recorded. Before anyone runs it:
>
> - **Customer checkout is refused in TEST mode** (`payment-initiate` answers
>   `test_mode`) unless the Edge Function secret `PAYMENT_ALLOW_TEST_CHECKOUT` is
>   exactly `true` (`PAYMENTS.md` §3, "The testing-phase switch"). That secret
>   must be unset again before card payments go live, and setting or unsetting it
>   is an owner-approved Supabase secrets change. Whether it is set now is not
>   known from the repository.
> - **A test order is a real order**: it is created paid, goes to the branch POS
>   as a real kitchen ticket, earns loyalty points on delivery and shows in
>   reports. At 200.00 to 300.00 SAR that is a large phantom ticket to warn the
>   branch about, and the refund is a separate step (`PAYMENTS.md` §3).
> - **Read live 2026-11-24, `online_payment_enabled` is `true`** (19 online orders
>   paid, `PAYMENTS.md` §1). The gateway's mode was not read. If it is LIVE,
>   running A1 "in TEST mode" would mean switching the payment row back to TEST
>   while customers can pay, which refuses them. Check the payment row's mode
>   first; do not switch it for this check without the owner's approval.
> - `PAYMENTS.md` §9 part B lists the Apple Pay sheet as a live-mode go-live
>   check on a real iPhone, so this proposal and that list disagree on the mode.

1. Place a **card** order whose total is **between 200.00 and 300.00 SAR**.
   Moyasar's Apple Pay sandbox succeeds only in that range (`PAYMENTS.md` §9.A).
2. On the payment page, tap **Apple Pay**.
3. Report one of:
   - the sheet appears and the payment succeeds: receipt shown, order paid;
   - the sheet appears and fails;
   - nothing happens.

**If A1 passes:** native Apple Pay is not needed now. The remaining Apple Pay
work is making the button more prominent, which needs Moyasar's page settings,
not code.

**If A1 fails:** we build a native Apple Pay sheet, §4. That needs the Apple
prerequisites in §6 and is best done with the company Apple account move
(`iOS_Move_To_Company_Account` plan; no file of that name is in the repository
as of 2026-11-26, so the dependency cannot be followed from here), because the Merchant ID and certificate
belong to the account that ships the app.

## 3. Saved cards

### What Moyasar offers

Quoted from Moyasar's documentation (read 2026-11-18):

- **Saving a card during a payment** is the recommended path: "Save card during
  a payment (recommended) | `source.save_card: true` on any payment | Charge
  now and save the card in one step"
  (https://docs.moyasar.com/docs/guides/tokenization/overview.md). "Moyasar runs
  3DS for the actual payment amount, and the resulting token is immediately
  `active` for future use"
  (https://docs.moyasar.com/docs/guides/tokenization/save-card-in-payment.md).
- **It needs a feature switched on:** "This requires **Tokenization** feature to
  be enabled for the merchant"
  (https://docs.moyasar.com/api/payments/01-create-payment).
- **mada is supported:** "Supported cards: Mada, Visa, Mastercard, Amex, and
  UnionPay" (tokenization overview).
- **Charging a saved card:** `POST /v1/payments` with
  `source: { type: "token", token }`. "By default, 3DS is not triggered for
  token payments"; when it is, the payment comes back `initiated` with a
  `source.transaction_url`
  (https://docs.moyasar.com/docs/guides/tokenization/tokenized-cards.md).
- **Display and removal:** a token exposes `brand`, `last_four`, `month`,
  `year`, `name`. `DELETE /v1/tokens/:id` removes it. Tokens are invalidated
  when the card expires (token object and delete-token pages).

**The hosted invoice page we use today cannot save a card.** `POST /v1/invoices`
documents no `save_card` or tokenization option
(https://docs.moyasar.com/api/invoices/01-create-invoice). Saving needs the card
entered through Moyasar's own form, Moyasar.js or the mobile SDK, instead of the
invoice page.

### Proposed flow

**First card payment, with "Save this card":**

1. The server creates the invoice exactly as today.
2. Instead of the invoice page, the WebView opens **our own small payment page**
   hosting Moyasar's form (Moyasar.js), initialised with that invoice. Moyasar
   documents paying an existing invoice from the form: "`invoice_id` … enables
   you to pay an invoice that is already created but not paid"
   (https://docs.moyasar.com/docs/guides/references/form-configuration/index.md).
   With the customer's consent, the form also sets `save_card: true`.
3. The card goes from Moyasar's form **straight to Moyasar**; it never reaches
   our servers. Moyasar: "Sending cardholder data to the merchant backend is
   prohibited"
   (https://docs.moyasar.com/docs/getting-started/authentication.md).
4. `payment-verify` confirms exactly as today, by fetching the payment
   server-to-server. The saved token is read from **that fetched payment**, not
   from anything the app reports, and stored against the customer.

**A returning customer:**

1. Checkout offers **"Pay with Visa •••• 1111"** next to "Card" and "Cash".
   Nothing is preselected for a first-time customer (owner decision,
   2026-09-14). **Corrected 2026-11-26:** since 2026-11-19 the app remembers each
   account's last method and preselects it when it was **online** and online is
   offered; cash is never preselected (`rememberedPreselection` in
   `apps/mobile/src/lib/payment.ts`, `PAYMENTS.md` §4, "A returning customer's
   last method"). How a remembered "saved card" choice would be stored in and
   restored from that memory is not designed here.
2. On tap, the server charges the token with the **secret key**. A token never
   goes to the app.
3. If Moyasar asks for 3-D Secure, the WebView opens the `transaction_url`.
   Otherwise the payment settles at once.
4. Verification and the order are exactly as today.

**Profile → Payment cards** lists saved cards (brand and last four) with
**Remove**, which deletes the token at Moyasar and our row.

### What it needs in the code (once approved)

- A table `saved_payment_cards`: customer, Moyasar token, brand, last four,
  expiry, created. RLS keeps it own-rows-only, and the token column is never
  readable by a client role. One migration (apply is §5).
- `payment-initiate`: a "pay with saved card" path (a token charge).
- `payment-verify`: store the token from a verified, consented first payment.
- Our hosted card-form page, with Moyasar.js loaded under a CSP that allows it.
- App: the saved-card option at checkout, the "Save this card" consent
  (EN + AR), and Profile → Payment cards.
- Account deletion and data export include saved cards. Erasure deletes the
  tokens at Moyasar.
- Tests and docs as for every payment change.

## 4. Native Apple Pay (only if step A1 fails)

- Moyasar's React Native SDK is `react-native-moyasar-sdk`. The latest is
  0.15.0, published 2026-08-18. It has a native Apple Pay sheet.
- Two blockers to check first, on a device:
  - its peer dependency is `react-native-webview ^13`, and the app is on 14.0.1;
  - its Apple Pay module uses React Native's legacy bridge, and the app runs
    React Native 0.88.
- The documented fallback is a small native module. It shows Apple's sheet and
  sends the encrypted Apple Pay token to `payment-initiate`, which creates the
  payment with `source: { type: "applepay", token }` and the secret key
  (https://docs.moyasar.com/api/payments/01-create-payment).

## 5. Decisions for the owner

| # | Decision | Recommendation |
| --- | --- | --- |
| D1 | Run step A1 (Apple Pay in the current WebView) | Yes, no code, but not "five minutes, no side effects": read the corrected preconditions under A1 first (2026-11-26) |
| D2 | Build saved cards (§3) | Yes, after Moyasar enables Tokenization and answers the SAQ question in §6 |
| D3 | "Save this card" wording, EN and AR | I draft it; the Arabic gets a native read (`OWNER_ACTIONS.md` §35) |
| D4 | Native Apple Pay (§4) | Only if A1 fails, and with the company Apple account |

## 6. What the owner must arrange

**For saved cards:**

1. Ask Moyasar to enable **Tokenization** on the account, for both test and
   live.
2. Ask Moyasar which **PCI SAQ** applies when cards are entered through
   Moyasar.js on our own page instead of their hosted invoice page. Moyasar's
   documentation does not say.

**For native Apple Pay, only if A1 fails:**

3. An Apple **Merchant ID** (`merchant.…`) in the account that ships the app,
   and the **Apple Pay** capability on the app's bundle ID.
4. In the Moyasar dashboard: Settings → Apple Pay - Certificate → Add
   Certificate → **Download CSR**.
5. In Apple's portal, create the Payment Processing Certificate from that CSR.
   Answer **No** to China Mainland: "If you select **Yes**, Apple Pay payments
   will not work"
   (https://docs.moyasar.com/docs/guides/apple-pay/apple-developer-account.md).
   Upload `apple_pay.cer` back to Moyasar.
6. Renew the certificate before it expires: "Apple Pay payment processing
   certificates expire every 25 months" (same page).
