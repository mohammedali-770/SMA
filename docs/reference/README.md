<!-- ------------------------------------------------------------------
     GENERATED FILE — DO NOT EDIT.
     Regenerate with: npm run docs:generate
     CI fails if this file drifts from its source (npm run docs:check).
     Derived from: `scripts/docs-generate.mjs`
     Describes the REPOSITORY, not live Production.
     ------------------------------------------------------------------ -->

# Generated reference

Machine-derived inventories of the system. Everything in this directory is regenerated from source; editing a file here by hand will be reverted by the next run and fails CI in the meantime.

| Document | Answers |
| --- | --- |
| [Application surface](app-surface.md) | Which screens and panels exist, and where their code lives |
| [Edge Functions](edge-functions.md) | What each function does, how it deploys, whether it can bypass RLS |
| [Database objects](database.md) | Which tables, RPCs, policies and triggers the migrations declare |
| [Test inventory](testing.md) | What is covered, where the tests are, how to run them |
| [Environment variables](environment.md) | Which variables the code reads, and which of them are public |
| [CI gates and scripts](ci-and-scripts.md) | Which checks run, what they are called, what you can run locally |

## Regenerating

```sh
npm run docs:generate   # rewrite these files
npm run docs:check      # fail if they drifted, and check documentation ownership
```

`docs:check` runs in CI. A change that alters the shape of the system — a new route, a new Edge Function, a new table, a new environment variable — will turn CI red until the reference is regenerated and committed. That is the intended behaviour: it is how the inventory stays true without anybody having to remember.

## What is deliberately *not* here

These files describe the repository. They cannot describe live Production — no network call is made — and they carry no rationale. Why a thing is built the way it is belongs in an [architecture decision record](../decisions/README.md); what to do when it breaks belongs in a runbook; what Production currently holds is verified read-only and dated in [`../OWNER_ACTIONS.md`](../OWNER_ACTIONS.md).
