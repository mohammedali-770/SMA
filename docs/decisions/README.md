# Decision records

A decision record captures **why** something is the way it is: the problem, the options, the choice, and what the choice costs. It is the document you want when someone asks "why on earth did they do it like that?" eighteen months later — usually while trying to change it.

## Why keep them

This project has made a number of consequential, non-obvious choices: freezing payments before choosing a provider, mirroring the design system with a generator instead of a workspace package, bundling notification consent into one switch, routing sign-in through WhatsApp rather than SMS. Each was reasoned through carefully. Most of that reasoning currently survives only in pull-request threads and in the memory of whoever was there.

A decision record makes the reasoning durable, and — more usefully — makes the **rejected** options durable. Rediscovering that an approach was already considered and dropped for a good reason is the single largest saving these files produce.

## What deserves one

Write a record when a choice is hard to reverse, when it constrains later work, or when a reasonable person would pick differently.

Concretely: choosing or rejecting a third-party service; a security or privacy boundary; a data model that other things will depend on; anything that changes how the product behaves for a customer; deliberately accepting a limitation.

Do **not** write one for routine implementation. If the answer to "what else could we have done?" is "nothing sensible", there is no decision to record.

## Format

One file per decision, `NNNN-short-kebab-title.md`, numbered sequentially and never reused. Copy [`0000-template.md`](0000-template.md).

A record has a **status**:

| Status | Meaning |
| --- | --- |
| `Proposed` | Written, not yet agreed |
| `Accepted` | In force |
| `Superseded by NNNN` | Replaced; the file stays |
| `Deprecated` | No longer applies, nothing replaced it |

**A record is not edited after it is accepted**, apart from its status line. If the decision changes, write a new record and mark the old one superseded. The point is the trail, and a rewritten record destroys it. This is the opposite of how the rest of `docs/` works, where the current state is what matters — so keep the two apart in your head.

## Relationship to the rest of the documentation

A decision record says *why we chose this*. It does not say *how to operate it* — that is a runbook — or *what exists* — that is [generated reference](../reference/README.md). Where an existing document already carries a decision in depth, the record can be short and link to it rather than duplicating the argument: [`PAYMENT_POSTPONEMENT.md`](../PAYMENT_POSTPONEMENT.md) is the authoritative payment decision and should stay that way.

Older decisions have not been backfilled. Backfilling is worth doing when you are already in the area and the reasoning is still recoverable — write it from the pull request thread while you can still find it. Do not invent a rationale you cannot source; an honest "the reasoning was not recorded" is more useful than a plausible reconstruction.

## Index

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-documentation-system.md) | Three-layer documentation with CI-enforced freshness | Accepted |
