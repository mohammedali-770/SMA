# Contributing to the documentation

This page is the standard. It covers where a new document goes, how it should read, and what the automation will and will not do for you.

The short version: **documentation ships in the same pull request as the behaviour it describes** ([CLAUDE.md §14](../CLAUDE.md)). Everything below exists to make that practical rather than aspirational.

## Which kind of document are you writing?

Four kinds, distinguished by what the reader is doing when they open it. The distinction is from [Diátaxis](https://diataxis.fr/), and it matters because mixing two kinds in one document is the most common way a good page becomes unusable.

| Kind | The reader is… | Lives in | Examples here |
| --- | --- | --- | --- |
| **Reference** | Looking something up | `docs/reference/` — **generated** | Edge Function inventory, database objects |
| **How-to** | Doing a specific task, often under pressure | `docs/` | [Incident response](INCIDENT_RESPONSE.md), [Rollback](ROLLBACK.md), [Branch onboarding](BRANCH_ONBOARDING.md) |
| **Explanation** | Trying to understand why | `docs/`, `docs/decisions/` | [Architecture](ARCHITECTURE.md), [Payment postponement](PAYMENT_POSTPONEMENT.md) |
| **Manual** | Operating the product, not the code | `docs/` | [Staff manual](STAFF_MANUAL.md) |

If you are about to add a "Background" section to a runbook, or a "How to run it" section to an architecture page, you have two documents. Split them and link.

**Do not add a second document that restates a fact an existing one already owns.** Two documents describing the same behaviour will disagree within a month, and the reader has no way to tell which one lost. Update the owner instead.

## Where a new document goes

```
docs/reference/     generated only — never hand-write a file here
docs/decisions/     one file per decision, numbered, never edited after acceptance
docs/integrations/  third-party API contracts
docs/readiness/     dated review evidence, immutable
docs/               everything else: runbooks, manuals, explanations
```

Filenames: `SCREAMING_SNAKE.md` for the established operational set, `kebab-case.md` for newer and narrower documents. Both are in use; match the neighbours rather than renaming existing files.

## House style

This repository's documentation has a specific voice, and it is worth keeping. The rules below are the ones that have actually prevented mistakes.

### Say what is unknown

The most valuable sentence in this documentation set is some version of *"source cannot prove this."* When you do not know, write that you do not know, and say what would settle it.

> Source contains CI checks and a controlled deployment path, but source cannot prove whether Vercel auto-deploy or the gated deploy path is currently active in the dashboard.

Never fill a gap with a guess that reads like a fact. A reader cannot tell them apart, and during an incident they will act on it.

### Date every live claim

Anything about production — a dashboard setting, a deployed version, a row count, a store console state — is true as of a moment, and the moment is part of the fact.

> Current read-only migration snapshot (2026-08-12): 79 repository migration files / 85 live migration-history rows.

Avoid bare "currently". A "currently" with no date becomes a lie silently; a dated claim becomes visibly old, which is the behaviour you want.

### Write for the reader's worst day

How-to documents are read by someone who is tired, on their phone, and being asked when the orders will start flowing again. Lead with the action. Put the explanation after it, or in a different document.

Number steps that must happen in order. Say what "done" looks like after each one. Say explicitly what to do when a step fails — "if this returns nothing, go to §4" beats leaving the reader to infer it.

### Name things the way people say them

A customer manages *notifications*, not `push_devices` rows. An operator looks at the *live orders panel*, not `LiveOrdersPanel.tsx`. Use the product word first and the code identifier in parentheses when both are needed. Reference documents are the exception — there the identifier *is* the subject.

### Be concrete about consequences

"Be careful with this" tells the reader nothing. Say what happens: *"admin broadcasts are immediate and cannot be recalled, and reach every device with `promos_enabled = true`."*

### Do not carry retired facts forward

When something changes, delete the old description rather than layering a correction on top. Specifically, never leave text describing the prototype emulator as current, the mobile app as a WebView wrapper, a retired branch as production, Tap or Geidea as the chosen payment provider, or push as dormant. All of those have been true at some point and none of them are now.

### Secrets

Names, never values. It is fine and useful to document that `SUPABASE_SERVICE_ROLE_KEY` exists, where it is configured, and what depends on it. It is never acceptable to include its value, a fragment of it, a JWT, a session cookie, an OTP, or customer personal data — in a document, a code comment, a test fixture, a log line, or a pull-request description ([CLAUDE.md §9](../CLAUDE.md)).

## Templates

### Runbook

```markdown
# <Thing that broke or task to perform>

**When to use this.** <The symptom or trigger, in the words someone would use.>
**Time to complete.** <Rough.>
**You need.** <Access, credentials, approvals — including whether this needs owner approval.>

## Before you start
<Anything that makes the situation worse if skipped.>

## Steps
1. <Action.> — you should see <observable result>.
   - If instead you see <failure>, <what to do>.
2. …

## Verify it worked
<How to be sure, from the outside.>

## If it did not work
<Escalation, and what to capture before escalating.>

## Related
<Links.>
```

### Architecture decision record

See [`decisions/README.md`](decisions/README.md). Copy [`decisions/0000-template.md`](decisions/0000-template.md).

## What the automation does

Two checks run as `npm run docs:check`, and both run in CI.

### 1. Generated reference must not drift

`scripts/docs-generate.mjs --check` regenerates every file in `docs/reference/` in memory and compares. Any difference fails.

You will hit this when you add a route, an Edge Function, a table, an RPC, an environment variable, an npm script or a workflow job. The fix is always the same:

```sh
npm run docs:generate
git add docs/reference
```

Never hand-edit a file in `docs/reference/`. Your edit will be silently reverted by the next run, and the build stays red until then. If the generated output is wrong, fix the generator — the output is a symptom.

### 2. Owned documents must move with their code

`scripts/docs-check-ownership.mjs` reads [`ownership.json`](ownership.json). Each rule maps source paths to the document that must change alongside them. Touch the code without touching the document and the check fails, telling you which rule fired, why it exists, and which documents satisfy it.

The map is narrow on purpose — ten rules covering payments, push, WhatsApp sign-in, the POS integration, account deletion, the order lifecycle, order integrity, maps, OTP entry and deployment. These are the areas where stale documentation has actually cost something. A rule that fires on every change gets routed around on every change.

**Adding a rule is the correct response to finding a stale document.** Removing one needs a reason in the pull request.

#### The exemption, and when to use it

Some changes genuinely do not affect documented behaviour: a rename, a test-only change, a dependency bump, a formatting pass. Record that in a commit message:

```
docs-exempt: payments — renamed a local variable, no behaviour change
```

The reason is required. It lands in history where a reviewer sees it.

What this is not for: deferring documentation you intend to write later. An exemption used that way removes the only signal that the document is now wrong, which is worse than never having had the rule. If the change alters behaviour, write the sentence — it is usually one sentence.

### 3. Source must stay readable (added 2026-09-02)

`scripts/format-check.mjs` runs in `design-system.yml` and enforces exactly two things on a pull request's own diff:

1. **A file added on this branch must be Prettier-clean.** New code is free to be held to the standard; nothing existing is disturbed.
2. **A file changed on this branch must not be machine-compressed** — mean line length at most 100 characters.

Rule 2 is the one that matters. The 2026-09-02 audit found **14 source files committed compressed**: `AccountSettingsScreen.tsx` is one line of 1,968 characters, `ProfileScreen.tsx` is 20 lines holding 7 KB. Every change to one of those diffs as a whole-file rewrite, which defeats review — and the change-control rules in `CLAUDE.md` §15 are built entirely on reading diffs. It happened because the repository had **no formatter at all**: `npm run lint` is `tsc --noEmit`, which has no opinion about layout.

**Why not simply "Prettier must pass on changed files"?** That was measured and rejected: **318 of 400** tracked TypeScript files are not currently Prettier-clean, so the gate would attach a several-hundred-line reformat to every one-line bugfix — and there are no rendering tests here to prove a JSX reformat changed nothing.

`npm run format -- <path>` runs Prettier for real on whatever you point it at.

**Paying one of the 14 down, and the squash-merge trap.** Reformatting a file rewrites every line of it, so `git blame` afterwards attributes the whole file to your commit. For the three small files done in the first pass that costs nothing worth avoiding; for `HomeMenuScreen.tsx` (16 KB) or `ProfileScreen.tsx` (7 KB) it would.

`git` solves this with a `.git-blame-ignore-revs` file listing formatting-only revisions, which GitHub reads automatically. **This repository squash-merges** — every pull request lands as a single commit with one parent — so a dedicated formatting commit on a branch is *never* an ancestor of the merged history, and listing it does nothing at all. That was tried, and caught in review on #312; check it yourself with `git merge-base --is-ancestor <sha> origin/claude/project-build-ie4b56`.

A working entry therefore takes **two pull requests**, because a commit cannot name its own future squash SHA:

1. one pull request that changes **nothing but formatting**, merged to some SHA `S`;
2. a follow-up that creates or appends to `.git-blame-ignore-revs` with `S`.

There is no `.git-blame-ignore-revs` in the repository yet — whoever does step 1 first creates it in step 2. Never add an entry for a commit that exists only on a branch.

## Review checklist

Before requesting review on a change that touches behaviour:

- [ ] `npm run docs:check` passes
- [ ] Generated reference regenerated and committed, if the shape of the system changed
- [ ] The owning document says what the behaviour is **now**, not what changed
- [ ] Any live claim carries a date and says how it was verified
- [ ] Anything uncertain is written as uncertain
- [ ] No secret values, no customer data
- [ ] A consequential choice with a rejected alternative has a [decision record](decisions/README.md)
- [ ] No new document restating something an existing one already owns

## Related

- [Documentation hub](README.md) — the map of everything
- [CLAUDE.md](../CLAUDE.md) — mandatory change-control rules; §14 is the documentation rule
- [Decision records](decisions/README.md)
- [Generated reference](reference/README.md)
