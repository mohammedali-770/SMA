# Spicy Meal — Redesign Package for Pen.dev

This folder is the **complete, self-contained brief** handed to a design partner
(Pen.dev, or any designer/agency) to redesign the Spicy Meal customer app and
the staff website **from scratch** without losing a single existing feature,
state, rule or piece of copy.

It was produced by reading the entire repository: `apps/mobile/` (Expo customer
app, also exported to web at `/app`), `src/` (admin/staff console), `supabase/`
(schema, RPCs, Edge Functions) and `docs/` (runbooks).

## The four documents

| File | What it is | Who reads it |
| --- | --- | --- |
| [`PENDEV_BRIEF.md`](./PENDEV_BRIEF.md) | The **guidelines and requirements**: scope, brand, non-negotiable rules, platform constraints, accessibility, deliverables, acceptance criteria, sign-off process. | Designer + product owner |
| [`FEATURE_INVENTORY.md`](./FEATURE_INVENTORY.md) | The **parity checklist**: every screen, every state, every control, every admin panel, with a tick-box per item. "Nothing lost" is proven against this file. | Designer + reviewer |
| [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) | Current **design tokens and component contracts** (colours, type scale, spacing, radii, shadows, motion, component states). What may change, what may not. | Designer |
| [`PENDEV_PROMPTS.md`](./PENDEV_PROMPTS.md) | Ready-to-run **`pen` CLI prompts**, one per screen batch, plus the workflow for iterating and exporting. | Whoever drives the tool |

## Read order

1. `PENDEV_BRIEF.md` §1–§4 (what this product is, what must not change)
2. `DESIGN_SYSTEM.md` (the material you are designing with)
3. `FEATURE_INVENTORY.md` (the contract you are designing *against*)
4. `PENDEV_PROMPTS.md` (start producing screens)

## Scope in one sentence

**Visual and interaction redesign only.** Every screen, state, rule, number and
string listed in `FEATURE_INVENTORY.md` must still exist and still behave the
same way; the backend (Supabase schema, RPCs, Edge Functions) is **not** part of
this work and must not be assumed to change.

## Tooling status

The Pen.dev CLI is installed in this environment:

```bash
npm install -g @pen.dev/cli   # already done — @pen.dev/cli@0.3.0
pen status                    # check auth
pen login                     # interactive login (email+password or OTP)
pen --list-workspaces
pen interactive               # recommended mode for iterative design work
```

See `PENDEV_PROMPTS.md` for the concrete invocations.

> **Change-control note.** This folder is documentation only. Nothing here
> authorises a production change, a migration, a deployment, a payment change or
> a push-notification change. Those remain governed by `CLAUDE.md` and require
> explicit owner approval.
