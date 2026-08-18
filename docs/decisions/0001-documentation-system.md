# 0001 — Three-layer documentation with CI-enforced freshness

- **Status.** Accepted
- **Date.** 2026-08-18
- **Deciders.** Repository owner

## Context

The project is approaching production. It already carries a large body of documentation — around forty documents covering architecture, runbooks, integration contracts and operational decisions — and the writing is unusually careful: it dates its live claims, states what source cannot prove, and refuses to guess.

The problem is not quality. It is that nothing keeps it true. [CLAUDE.md §14](../../CLAUDE.md) already requires documentation to change alongside behaviour, and that rule is followed most of the time, which is exactly the failure mode that matters: the gaps are invisible. Nobody knows which page quietly stopped being accurate three weeks ago, and the moment that is discovered is usually an incident.

Two categories rot differently and need different treatment:

- **Inventories** — what routes exist, which Edge Functions there are, which tables and RPCs, which environment variables, which CI checks. These go stale on almost every change and nobody remembers to update them. They are also purely mechanical: every fact in them is derivable from source.
- **Prose** — runbooks, integration contracts, the payment freeze. These cannot be derived. They go stale less often but far more dangerously, because they are what someone reads while production is broken.

Two working precedents already existed in the repository and shaped the answer. `scripts/sync-design-system.mjs` generates mirrored modules and fails CI when one is hand-edited. `.github/workflows/function-drift.yml` compares deployed Edge Function names against the repository on a schedule, and is candid that it cannot compare content. Both treat "the documentation is either correct or the build is red" as the normal standard.

The owner's requirement was that documentation update itself when the project changes. Taken literally that is not possible — no tool writes a runbook — so the question became which mechanisms deliver that intent for which content.

## Options considered

### Option A — A documentation site (Docusaurus or MkDocs)

Searchable, navigable, versioned, and it looks the part. Rejected as the primary answer because it solves presentation, not truth: a beautifully rendered stale runbook is still a stale runbook. It also adds a build target and a deploy path, and any Vercel production change is owner-approval-gated under [CLAUDE.md §13](../../CLAUDE.md). The structure chosen here is plain Markdown in a conventional layout, so a site generator can be pointed at it later without rewriting content.

### Option B — Extract everything from source comments

Generate the whole documentation set from JSDoc and SQL comments. Rejected because the most valuable material in this repository is precisely what does not live next to code: why payments are frozen, what to do when orders strand, which dashboard facts source cannot prove. Those are cross-cutting and deliberative. Forcing them into file headers would lose them.

### Option C — A review checklist and discipline

Add documentation to the pull-request template and trust review. Rejected because it is what exists now, in the form of CLAUDE.md §14, and the drift being addressed accumulated under it. A control that depends on nobody ever being in a hurry is not a control.

### Option D — Generate what is derivable, enforce ownership on what is not

Three layers. **Generated** reference regenerated from source, with a `--check` mode that fails CI on drift. **Owned** prose mapped to source paths, so changing the code without touching its document fails CI. **Curated** everything else, held by review and §14.

Chosen.

## Decision

Adopt the three-layer model.

- `scripts/docs-generate.mjs` writes `docs/reference/`, sorted and free of timestamps so output is deterministic. `--check` fails when a file drifts.
- `scripts/docs-check-ownership.mjs` enforces `docs/ownership.json`, which maps source globs to the documents that must change with them, with a commit-message exemption that requires a stated reason.
- `npm run docs:check` runs both and is a blocking CI gate.
- `docs/CONTRIBUTING.md` records the house style so the voice survives contributors.
- Decision records live here.

The ownership map starts at ten rules, covering the areas where stale documentation has already had a cost: payments, push, WhatsApp sign-in, the POS integration, account deletion, the order lifecycle, order integrity, maps, OTP entry, and deployment paths.

## Consequences

**What this makes easier.** The inventory questions that come up during an incident — what does this function do, can it bypass RLS, which check is this, is this tested — have a current answer that cannot silently be wrong. New contributors get a real map. The generated CI table settles a specific recurring confusion: the emitted status-check context for the design-system job is `design-system`, the job ID, not the workflow's display name.

**What this makes harder, or costs us.** Every change that alters the shape of the system now carries a regeneration step, and forgetting it turns CI red. Changes in the ten owned areas cannot merge without a documentation edit or a written exemption. That is friction, and it is the point, but it is real and it is paid on every pull request. The generators also parse source with regular expressions rather than a compiler or a SQL parser, so they are approximate at the edges — a table created inside a `DO` block, or an unconventional comment style, may be missed. The files say what they are derived from so a reader can check.

**The boundary this does not cross.** Nothing generated here describes production. No network call is made. A table listed in the database reference is a table some migration declares, not proof of what the live database holds. Live state stays where it belongs: verified read-only, dated, and recorded in [`OWNER_ACTIONS.md`](../OWNER_ACTIONS.md).

**What would make us revisit this.** If the exemption escape hatch is used routinely rather than exceptionally, the map is wrong — either too broad or aimed at the wrong paths — and should be re-cut rather than tolerated. If the generators' regex parsing starts producing wrong output rather than merely incomplete output, replace them with real parsers. If the documentation set grows past what a Markdown directory can navigate, revisit Option A on top of this structure rather than instead of it.

## Related

- [Documentation hub](../README.md)
- [Contributing to the documentation](../CONTRIBUTING.md)
- [Ownership map](../ownership.json)
- [Generated reference](../reference/README.md)
- `scripts/sync-design-system.mjs` — the generator-plus-check precedent this follows
- [CLAUDE.md §14](../../CLAUDE.md) — the rule this makes enforceable
