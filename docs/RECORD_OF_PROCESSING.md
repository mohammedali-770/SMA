# Record of processing activities

> **Status: engineering-drafted 2026-11-10, NOT yet reviewed by counsel.** It is
> built from the schema, the code and the live privacy policy (`privacy_policy`
> v2.3, effective 2026-09-16), and every live figure in it is dated. The
> **lawful-basis column is engineering's reading of what each activity relies
> on, not legal advice**; counsel's review is `OWNER_ACTIONS.md` §44.
>
> **What this file owns, and what it does not.** It is the per-PURPOSE view:
> why each kind of processing happens, who receives the data, where it goes and
> how long it stays. The per-FIELD evidence, with the table and line each claim
> rests on, is the Data safety derivation in
> [`PLAY_STORE_SUBMISSION.md` §6](PLAY_STORE_SUBMISSION.md) — this file links to
> it rather than repeating it. Readiness status lives in
> [`GO_LIVE_READINESS.md` §A](GO_LIVE_READINESS.md).

## Controller

| | |
| --- | --- |
| Controller | First Taste Trading Company, Kingdom of Saudi Arabia (as named in the privacy policy) |
| Privacy contact | `info@spicymeal.com.sa`, 9200 31495 (as published in the privacy policy) |
| Data protection officer | None appointed. Whether one is required is a question for counsel (§44) |
| Registration with SDAIA | Not determinable from the repository (`GO_LIVE_READINESS.md` A2) |

## Processing activities

"Supabase" means the project database, sign-in and functions, hosted in
**eu-central-1 (Frankfurt, Germany)**, read live 2026-09-02.

| # | Activity | Purpose | Whose data | Personal data | Recipients | Retention | Lawful basis (engineering's reading) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Sign-in** (WhatsApp code) | Prove the customer holds the mobile number | Customers, and anyone who starts sign-in | Mobile number; the one-time code's hash and expiry; a hash of the IP address; a record that a code was sent | Supabase; Meta (WhatsApp Business) delivers the code | Codes: **24 hours after expiry**, by a daily sweep. Send reservations: **2 days**. Send records (`whatsapp_message_logs`): **until the account is deleted — no time limit** (see Findings) | Contract — the customer asks to sign in |
| 2 | **Customer account** | Keep the account the customer created | Customers | Name, mobile number, optional email, when the number was verified | Supabase | For as long as the account is open; deleted with it | Contract |
| 3 | **Ordering and fulfilment** | Take the order, send it to the branch, prepare it, hand it over or deliver it | Customers | Order contents, amounts and VAT, branch, pickup or delivery, status and history, notes on the order and on items, the name and number on the order, the delivery address as it was when ordered | Supabase; Lazywait, the branch point-of-sale system, which prints the name, number, address, items and notes on the kitchen ticket | Kept for the tax and accounting period (the policy's wording; **no figure is stated anywhere**, see Findings). On account deletion the name, number, notes and address on retained orders are cleared | Contract; legal obligation (tax and accounting records) |
| 4 | **Delivery addresses** | Deliver to the right door | Customers who order delivery | Address text, national short address, map coordinates | Supabase; **Google** draws the map, receives the coordinates of the point picked, and provides address search; turning a point into a street address is done by Google on web and Android and by **Apple** on iPhone | Until the customer deletes the address or the account | Contract |
| 5 | **Device location, on the phone** | List the nearest branches on the pickup tab; place the delivery pin; warn at checkout when the pin is far from the customer | Customers who allow location | The device's position while the app is open | **None.** The branch list and the checkout warning are computed on the device and nothing is sent. A pin the customer then saves becomes activity 4 | Not stored | Consent — the OS permission, asked where it is used (#425). The privacy policy names only the pin, which is a gap: `docs/legal/PRIVACY_POLICY_LOCATION_USES_CORRECTION.md` |
| 6 | **Order-status notifications** | Tell the customer when their order is preparing, ready, out for delivery, delivered | Customers who allow notifications | Push token per device, platform, app language, the two channel switches; a log of what was sent | Supabase; Expo, then Apple (APNs) or Google (FCM), to reach the device | Until both switches are turned off (the device is deactivated) or the account is deleted | Contract (service messages about an order the customer placed), with the OS permission |
| 7 | **Offers by notification** (marketing) | Send occasional offers | Customers who allow notifications and have not turned offers off | The same token, and the offers switch | Same as 6 | Same as 6 | **Consent, on an opt-out model** (CLAUDE.md §7). Since #425 the consent text is shown before the OS prompt, and once as a notice where the OS never asks. **No record of consent is kept** (`GO_LIVE_READINESS.md` A3; proposed fix in `docs/decisions/0002-consent-ledger.md`). Whether opt-out satisfies PDPL is counsel's question (§44) |
| 8 | **Loyalty** | Run the points programme | Customers | Points balance, points earned and redeemed per order | Supabase | For as long as the account is open; the ledger is deleted with it | Contract (programme terms, `offers_loyalty_terms`) |
| 9 | **Comped customers** | Let staff mark a customer's orders as free | Customers named by staff | Mobile number, a staff note, and an audit trail of who changed it | Supabase | Until staff remove the entry; erased on account deletion | Legitimate interest — counsel to confirm |
| 10 | **Account deletion and data export** | Honour deletion and access requests | Customers | The request and its outcome; the exported copy is produced on demand and not kept | Supabase; Meta delivers the confirmation code for a deletion | Processed automatically; up to 30 days when an active order, a financial process or another exception must be completed first (the app's own wording) | Legal obligation (data-subject rights) |
| 11 | **Crash and error diagnostics** | Find and fix faults | Customers and staff using the apps | App version, device model and OS, language, crash data. Sent with `sendDefaultPii: false` and a scrubber (`PLAY_STORE_SUBMISSION.md` §6) | **Sentry**, EU region — the ingest host is `ingest.de.sentry.io` (`apps/mobile/src/lib/observability/webConfig.ts`) | Set in Sentry's project settings; **not readable from the repository** | Legitimate interest (security and reliability) |
| 12 | **Hosting and request logs** | Serve the web console, the web app and the policy pages | Visitors | IP address and request details, in the providers' own logs | Vercel; Supabase | Set by each provider's plan; **not readable from the repository** | Legitimate interest |
| 13 | **Staff and administrators** | Run the branches and the console securely | Staff | Name, number, email, role, authenticator (TOTP) enrolment, audit trails of their actions, browser push subscriptions for closure alerts | Supabase; the browser's push service (admin web push, `docs/ADMIN_PUSH_NOTIFICATIONS.md`); the email provider for operations alerts | For as long as the person has access | Contract (employment) — counsel to confirm |
| 14 | **Customer support** | Answer questions and complaints | Customers who get in touch | Whatever the customer sends by phone, WhatsApp or email | The business phone line; Meta for WhatsApp chats; the email provider | Outside the app's systems; the policy says "while we need them … and for a reasonable period afterwards" | Contract; legitimate interest |

## Where the data goes outside the Kingdom

The privacy policy says: *"Some of the providers listed above process data
outside the Kingdom of Saudi Arabia. Where that happens, we rely on the data
protection commitments in our contract with that provider."*

| Recipient | Where (as far as the repository shows) | Activities |
| --- | --- | --- |
| Supabase | Germany (eu-central-1) | All stored data |
| Sentry | Germany (EU region) | 11 |
| Expo | United States | 6, 7 |
| Apple, Google | Global | 4, 6, 7 |
| Meta (WhatsApp Business) | Global | 1, 10, 14 |
| Vercel | United States company, global edge network | 12 |
| Lazywait | **Unknown** — the POS vendor's hosting is not visible from here | 3 |
| Email provider | **Unknown** — named in the policy only as "our email provider" | 13, 14 |

Whether "the data protection commitments in our contract" is a basis PDPL
recognises for each of these is the largest open legal item on this page
(`GO_LIVE_READINESS.md` A1, `OWNER_ACTIONS.md` §44). Two rows are unknown
because the repository cannot see them; the owner can.

## Findings made while building this record

1. **Sign-in send records have no time limit.** `whatsapp_message_logs` holds the
   number each code was sent to. It is cleared when the account is deleted and
   by nothing else, so a number that starts sign-in and never finishes would be
   kept indefinitely. Measured 2026-11-10: **40 rows, 7 numbers, the oldest from
   2026-07-10, all older than 30 days — and every number belongs to an existing
   account**, so the abandoned-sign-up case has not yet occurred. The policy
   promises a short period for "verification codes", which the code honours (24
   hours); it states no period for the send record. A retention period for this
   table — and a sweep like the one that already exists for codes — is the fix.
   It needs an owner decision on the period.
2. **The order retention period has no figure.** The policy says orders are kept
   "for the period required by tax and accounting law". Nothing in the
   repository states what that period is, so nothing can delete an order when it
   ends. Counsel should state the figure; a sweep can follow.
3. **The privacy policy names one use of location out of three.** Draft
   correction ready: `docs/legal/PRIVACY_POLICY_LOCATION_USES_CORRECTION.md`
   (`OWNER_ACTIONS.md` §43).
4. **No consent is recorded anywhere** — already `GO_LIVE_READINESS.md` A3. The
   proposed design is `docs/decisions/0002-consent-ledger.md`.

## Keeping this record true

Update this file in the same pull request as any change that adds a kind of
personal data, a purpose, a recipient or a retention rule (CLAUDE.md §14). The
recipients and their regions are the part most likely to drift: re-read them
when a processor is added, removed or moves region.
