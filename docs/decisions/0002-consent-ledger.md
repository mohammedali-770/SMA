# 0002 — Record each customer's consent decisions in an append-only ledger

- **Status.** Proposed
- **Date.** 2026-11-10
- **Deciders.** Repository owner, with counsel on the legal questions

## Context

**Nothing records consent today.** Measured live on 2026-09-10 and recorded in
[`GO_LIVE_READINESS.md`](../GO_LIVE_READINESS.md) A3: no column or table in the
database records that any customer accepted any policy or agreed to anything.
`legal_documents.requires_acceptance` is false on every row. The only consent
*state* is `push_devices.promos_enabled`, and it is only state: one boolean per
device, overwritten on every change. It has no history, no time, no record of
what the customer was shown, and it moves to a new owner when a phone changes
hands.

**What the customer is shown has just become worth recording.** Since #425 the
app shows consent text before the OS notification prompt, and once as a notice
where the OS never asks (Android 12 and older, a second account on a shared
phone). Marketing is opt-OUT by owner decision (CLAUDE.md §7). That makes the
evidence question sharper, not weaker: an opt-out model's defence is that the
customer was told, and nothing proves they were. The only trace of the consent
screen is a flag in the phone's own storage, which the server never sees.

**Constraints that are not obvious from the code:**

- Push is a LIVE customer channel. Nothing in this design may change who
  receives what. A failed write to a ledger must never switch a customer's offers
  on or off.
- Every write path today goes through `SECURITY DEFINER` RPCs with RLS closed to
  direct writes (`register_push_device`). A ledger should follow the same shape.
- Account deletion anonymises retained orders and deletes the rest. What happens
  to consent evidence after erasure is a legal question, not an engineering one.
- Whether PDPL accepts an opt-out model for marketing at all is counsel's
  question (`OWNER_ACTIONS.md` §44). This design is useful under either answer.
  Under opt-out it is the evidence of what the customer was told. Under opt-in it
  becomes the gate itself.

## Options considered

### Option A — Keep relying on `push_devices.promos_enabled`

No work. But it cannot show when a customer agreed, to what wording, in which
language, or that they were ever told. It is overwritten on every change and
reassigned on a shared phone. It records the switch, not the consent.

### Option B — Add consent columns to `push_devices`

For example `consent_text_version` and `consented_at`. Small, but it inherits
every weakness of the row it sits on. It is per device rather than per customer.
It is overwritten rather than appended, and lost on reassignment. It also mixes
targeting state with evidence, so a bug in one becomes a bug in the other.

### Option C — An append-only `consent_events` table

One row per decision or disclosure: customer, purpose (`marketing_push` first;
`terms` and `privacy` when acceptance is required), what happened (`shown`,
`granted`, `declined`, `withdrawn`), the exact text shown (a string key and a
version, or a hash of the rendered text), language, surface (`first_run_prompt`,
`notice`, `profile_toggle`), platform, time.

It is written only by a `SECURITY DEFINER` RPC that stamps `auth.uid()` itself,
so there is no customer id to forge, the same model as `export_my_data()`. It is
readable by the customer through `export_my_data()` and by an administrator at
AAL2, and is never updated. Client writes are best-effort with retry and **never
gate the UI or the push preferences**.

### Option D — An acceptance table for legal documents only

Covers terms and privacy-policy acceptance once `requires_acceptance` is used.
It does not cover marketing push, which is the live exposure. It folds into
Option C as two more purposes.

## Decision

Proposed: **Option C**, with marketing push as the first purpose. Option D's
acceptance records become two further purposes in the same table when the owner
decides acceptance is required.

## Consequences

**What this makes easier.** Answering a regulator, a store reviewer or a
customer with *who* agreed, *when*, to *which words*, in *which language*, and
whether they later withdrew. `export_my_data()` can include it, which is what
the access right expects. A future move to opt-in becomes a one-place change.

**What this makes harder, or costs us.**
- A migration, which is a §5 apply, plus a client write on three surfaces: the
  consent screen, the notice and the Profile toggles.
- Retention after erasure needs a legal answer before it ships; deleting the
  evidence with the account is the conservative default.
- Writing the exact text version means string keys for consent copy must be
  versioned, not edited in place. That is a real discipline change for
  `strings.ts`.
- None of this proves consent for the customers registered **before** it
  ships; that gap stays recorded, not papered over.

**What would make us revisit this.**
- Counsel's answer on opt-out versus opt-in.
- A move of marketing to a second channel (WhatsApp or email), which would add
  purposes.
- Any change to the push audience model, which CLAUDE.md §7 already makes an
  owner decision.
