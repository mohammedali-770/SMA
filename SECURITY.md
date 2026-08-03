# Security policy

Spicy Meal (سبايسي ميل) is operated by شركة الطعم الأول للتجارة (First Taste
Trading Company). We take reports about our customer app, web app and backend
seriously.

## Reporting a vulnerability

**Email:** `mohammed.ali@1sttaste.com`
Please put `SECURITY` in the subject line.

If you can, include:

- what you found and why it matters;
- the steps to reproduce it;
- the affected surface — customer app (iOS/Android), `/app` web, the admin
  console, or the API;
- anything you need from us to demonstrate it.

Encrypted reporting is not yet available. If you need it, say so in a first
message without details and we will arrange a channel.

## What to expect

| | |
| --- | --- |
| Acknowledgement | within **3 business days** |
| Initial assessment | within **10 business days** |
| Fix timeline | shared once assessed; critical issues are prioritised immediately |

We will tell you when the issue is resolved, and we are happy to credit you
publicly if you would like that.

## Scope

**In scope**

- The customer mobile apps (iOS, Android) and the customer web app at `/app`
- The admin/staff console
- The Supabase backend: RLS policies, RPCs, Edge Functions
- Authentication, including the WhatsApp OTP flow

**Out of scope**

- Denial of service, volumetric or stress testing
- Social engineering of our staff, branches or customers
- Physical attacks against restaurant locations
- Reports from automated scanners with no demonstrated impact
- Vulnerabilities in third-party platforms themselves (Supabase, Vercel, Expo,
  the payment provider) — please report those upstream; tell us if we are
  exposed by one
- Missing hardening headers or best practices with no exploitable consequence

## Please do not

- Access, modify or delete data belonging to anyone else. **Use your own
  account.** If you believe you can reach another customer's orders, addresses or
  loyalty balance, stop as soon as you have proof and tell us — do not enumerate.
- Place real orders you do not intend to pay for, or interfere with real orders.
  Every order in this system reaches an actual kitchen and can cause real food to
  be prepared and real money to move.
- Run automated scanning that degrades service for customers.
- Disclose publicly before we have had a chance to fix it.

Acting in good faith within this policy, we will not pursue or support legal
action against you.

## No bug bounty

We do not currently run a paid bounty programme. We will acknowledge and credit
you, and we are grateful for the report.

## Personal data

If a report involves personal data (customer names, phone numbers, addresses,
order history), tell us immediately and **do not retain copies**. As a Saudi
entity we have obligations under the Personal Data Protection Law, and a
notification clock may start when we learn of an incident. Prompt reporting helps
us meet it.

---

_Last reviewed: 2026-08-03_
