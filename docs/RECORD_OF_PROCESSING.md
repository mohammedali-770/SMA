# Record of processing activities

> **Status: engineering-drafted 2026-11-10, NOT yet reviewed by counsel.** It is
> built from the schema, the code and the live privacy policy (`privacy_policy`
> v2.3, effective 2026-09-16), and every live figure in it is dated. The
> **lawful-basis column is engineering's reading of what each activity relies
> on, not legal advice**; counsel's review is `OWNER_ACTIONS.md` §44.
>
> **Why it exists.** PDPL Art 31 and Implementing Regulation (IR) Art 33 require
> the controller to keep a written record of its processing, keep it current,
> give it to SDAIA on request, and keep it **for five years after the processing
> ends**. IR Art 33(5) sets the minimum contents, and this file follows them:
> - controller and contact details;
> - purposes;
> - categories of data and of data subjects;
> - retention;
> - recipients;
> - transfers outside the Kingdom;
> - security measures.
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
| Data protection officer | None appointed. IR Art 32 requires one where core activities involve regular and systematic monitoring of data subjects, or are based on sensitive data; whether either applies is counsel's call (`OWNER_ACTIONS.md` §44 item 4) |
| Registration with SDAIA | Not determinable from the repository (`GO_LIVE_READINESS.md` A2). Needed in practice either way: the breach-notification e-service requires a registration certificate (§44 item 1) |
| Security measures | Summarised in [`SECURITY_REVIEW.md`](SECURITY_REVIEW.md) and the go-live security rows. Row-level security on every table (65 of 65, measured 2026-11-09). No client holds the service key. Administrators need a second factor (AAL2). Sign-in codes are rate-limited. Telemetry goes out without default personal data and through a scrubber, and `PLAY_STORE_SUBMISSION.md` §6 records what can still remain |

## Processing activities

"Supabase" means the project database, sign-in and functions, hosted in
**eu-central-1 (Frankfurt, Germany)**, read live 2026-09-02.

| # | Activity | Purpose | Whose data | Personal data | Recipients | Retention | Lawful basis (engineering's reading) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Sign-in** (WhatsApp code) | Prove the customer holds the mobile number | Customers, and anyone who starts sign-in | Mobile number; the one-time code's hash and expiry; a hash of the IP address; a record that a code was sent | Supabase; Meta (WhatsApp Business) delivers the code | Codes: **24 hours after expiry**, by a daily sweep. Send reservations: **2 days**. Send records (`whatsapp_message_logs`): **until the account is deleted — no time limit** (see Findings) | Contract — the customer asks to sign in |
| 2 | **Customer account** | Keep the account the customer created | Customers | Name, mobile number, optional email, when the number was verified | Supabase | For as long as the account is open; deleted with it | Contract |
| 3 | **Ordering and fulfilment** | Take the order, send it to the branch, prepare it, hand it over or deliver it | Customers | Order contents, amounts and VAT, branch, pickup or delivery, status and history, notes on the order and on items, the name and number on the order, the delivery address as it was when ordered | Supabase; Lazywait, the branch point-of-sale system, which prints the name, number, address, items and notes on the kitchen ticket | Kept for the tax and accounting period (the policy's wording; **no figure is stated anywhere**, see Findings). On account deletion the name, number, notes and address on retained orders are cleared | Contract; legal obligation (tax and accounting records) |
| 4 | **Delivery addresses** | Deliver to the right door | Customers who order delivery | Address text, national short address, map coordinates | Supabase; **Google** draws the map, receives the coordinates of the point picked, and provides address search; turning a point into a street address is done by Google on web and Android and by **Apple** on iPhone | Until the customer deletes the address (a real delete) or the account. The copy on past orders is activity 3 | Contract |
| 5 | **Device location, on the phone** | List the nearest branches on the pickup tab; place the delivery pin; warn at checkout when the pin is far from the customer | Customers who allow location | The device's position while the app is open | **None.** The branch list and the checkout warning are computed on the device and nothing is sent. A pin the customer then saves becomes activity 4 | Not stored | Consent — the OS permission, asked where it is used (#425). The privacy policy names only the pin, which is a gap: `docs/legal/PRIVACY_POLICY_LOCATION_USES_CORRECTION.md` |
| 6 | **Order-status notifications** | Tell the customer when their order is preparing, ready, out for delivery, delivered | Customers who allow notifications | Push token per device, platform, app language, the two channel switches; a log of what was sent | Supabase; Expo, then Apple (APNs) or Google (FCM), to reach the device | **Device record** (token, platform, language, switches): until the account is deleted. Turning both switches off only marks the device inactive (`deactivate_push_device` sets `is_active = false`): sending stops, the row and token stay. **Send log** (`notification_log`): one row per order and status, with no token or customer field, kept with its order. Neither has a purge (see Findings) | Contract (service messages about an order the customer placed), with the OS permission |
| 7 | **Offers by notification** (marketing) | Send occasional offers | Customers who allow notifications and have not turned offers off | The same token, and the offers switch | Same as 6 | Same as 6: turning offers off stops them and keeps the device record | **Consent, on an opt-out model** (CLAUDE.md §7). Since #425 the consent text is shown before the OS prompt, and once as a notice where the OS never asks. **No record of consent is kept** (`GO_LIVE_READINESS.md` A3; proposed fix in `docs/decisions/0002-consent-ledger.md`). Read against the texts on 2026-11-10, opt-out does not match their wording: PDPL Art 25 asks for *prior* consent, and IR Art 11 for a separate, documented consent per purpose (`OWNER_ACTIONS.md` §44 item 6) |
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

**What the law asks for each of these, read 2026-11-10.** Hosting with a
foreign processor is a transfer (PDPL Art 1(9), Art 29). SDAIA has published
**no list of adequate countries**, so no recipient above has an adequacy
finding. Each needs one of the Transfer Regulation's Art 4(2) cases, with its
safeguard: SDAIA's standard contractual clauses (v1.0, unedited), binding common
rules, or an accreditation certificate. Each also needs a **risk assessment
before** transferring (Art 7). Whether *"the data protection commitments in our
contract"* meets that for each recipient is the largest open legal item on this
page (`GO_LIVE_READINESS.md` A1, `OWNER_ACTIONS.md` §44 item 5).

**There is no duty today to store personal data inside the Kingdom.** SDAIA's
October 2026 consultation proposes one, and it is not law at the time of
writing. Two recipients above are unknown because the repository cannot see
them; the owner can.

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
5. **Switching notifications off does not delete anything.** It stops sending
   and keeps the device record — token, platform, language, switches — until
   the account is deleted. Nothing purges a device that stays inactive, or one
   whose token stopped working. The per-order send log (`notification_log`) has
   no purge either; it holds no token or customer field and lives with its
   order. Measured 2026-11-10: **5 device records, 0 inactive; 68 send-log rows,
   the oldest from 2026-07-23**, so nothing stale has built up yet. A retention
   period for inactive device records is the fix, and it needs an owner
   decision on the period, as for finding 1. Found in review on #427.

## Keeping this record true

Update this file in the same pull request as any change that adds a kind of
personal data, a purpose, a recipient or a retention rule (CLAUDE.md §14). The
recipients and their regions are the part most likely to drift: re-read them
when a processor is added, removed or moves region.

## Sources

SDAIA's published texts, read 2026-11-10 from its National Data Governance
Platform (DGP), in SDAIA's English translations. **The Arabic texts govern.**

- PDPL: https://dgp.sdaia.gov.sa/wps/wcm/connect/ce84f976-2fdf-4a76-a8c4-638b7ca9e3ba/Personal+Data+English.pdf?MOD=AJPERES
- Implementing Regulation: https://dgp.sdaia.gov.sa/wps/wcm/connect/2a9a4744-a2ae-444f-bad2-6dacde843637/The+impelementing+regulation+of+the+personal+data+protection+law.pdf?MOD=AJPERES
- Transfer Regulation (Resolution 1840, Umm Al-Qura 1 Sep 2024): https://dgp.sdaia.gov.sa/wps/wcm/connect/e5bbede0-1119-4f70-b4ef-f043ce58d780/Regulation+on+Personal+Data+Transfer+Outside+the+Kingdom..pdf?MOD=AJPERES
- Standard contractual clauses v1.0: https://dgp.sdaia.gov.sa/wps/wcm/connect/016534ff-df3b-4bf4-80d7-d7145f41a926/Standard+Contractual+Clauses+For+Personal+Data+Transfer.pdf?MOD=AJPERES
- Transfer risk-assessment guideline: https://dgp.sdaia.gov.sa/wps/wcm/connect/16aec46f-ea3d-47f6-8e0d-e49ffa2349d5/Risk+Assessment+Guideline+for+Transferring+Personal+Data+Outside+the+Kingdom.pdf?MOD=AJPERES
- Register Rules: https://dgp.sdaia.gov.sa/wps/wcm/connect/047a4149-ba11-4919-9341-260164125ba5/The+Rules+Governing+the+National+Register+of+Controllers+Within+the+Kingdom.pdf?MOD=AJPERES
- Record-of-processing guideline (SDAIA template): https://dgp.sdaia.gov.sa/wps/wcm/connect/19ec3250-16a6-47c7-8e8c-b8e1d6f86633/Personal+Data+Processing+Activities+Records+Guideline.pdf?MOD=AJPERES
- Breach-notification e-service: https://dgp.sdaia.gov.sa/wps/portal/pdp/services/personaldatabreachnotification
- October 2026 consultation on amending the Implementing Regulation: https://www.uqn.gov.sa/news/reports/4002043. The draft's content is known only from law-firm summaries; its own text could not be read.
