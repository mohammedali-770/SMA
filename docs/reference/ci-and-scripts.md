<!-- ------------------------------------------------------------------
     GENERATED FILE — DO NOT EDIT.
     Regenerate with: npm run docs:generate
     CI fails if this file drifts from its source (npm run docs:check).
     Derived from: `.github/workflows/`, `package.json`, `scripts/`
     Describes the REPOSITORY, not live Production.
     ------------------------------------------------------------------ -->

# CI gates, workflows and scripts

Every automated check that can run against a change, and every command you can run locally.

## Workflows

The *job name* is what GitHub reports as a status check context. When configuring required checks in **Settings → Rules**, use these emitted names — not the workflow display name (CLAUDE.md §12).

| File | Workflow | Triggers | Jobs (status check contexts) |
| --- | --- | --- | --- |
| `change-control.yml` | Change control | pull request, push, manual | `Change-control guard` |
| `deploy-functions.yml` | Deploy Supabase Functions | manual | `deploy` |
| `design-system.yml` | Design system | pull request, push, manual | `design-system` |
| `docs.yml` | Documentation | pull request, push, manual | `Documentation (generated + ownership)` |
| `eas-build.yml` | EAS Build (mobile) | push, manual | `build` |
| `eas-status.yml` | EAS Build Status (read-only) | manual | `status` |
| `function-drift.yml` | Edge Function drift (read-only) | schedule, manual | `Compare deployed functions against the repository` |
| `production-gates.yml` | Production gates | pull request, push, manual | `Production build (Vite + Expo web export)`<br>`Edge Function typecheck (Deno)`<br>`Dependency audit (high+)`<br>`Deploy to Vercel (gated on CI)` |
| `sql-suites.yml` | SQL suites | pull request, push, manual | `Decide whether the suites must run`<br>`Migration chain + SQL suites`<br>`SQL suites gate` |

> Which contexts are actually *required* is GitHub dashboard state that this repository cannot read. Verify it live before claiming a red merge is blocked.

## npm scripts

| Command | Runs |
| --- | --- |
| `npm run build` | `npm --prefix apps/mobile ci --no-audit --no-fund && vite build && npm --prefix apps/mobile run build:web` |
| `npm run build:site` | `vite build` |
| `npm run clean` | `rm -rf dist server.js` |
| `npm run design-system:check` | `node scripts/sync-design-system.mjs --check && node scripts/check-design-system-hygiene.mjs` |
| `npm run design-system:sync` | `node scripts/sync-design-system.mjs` |
| `npm run dev` | `vite --port=3000 --host=0.0.0.0` |
| `npm run docs:check` | `node scripts/docs-generate.mjs --check && node scripts/docs-check-ownership.mjs` |
| `npm run docs:generate` | `node scripts/docs-generate.mjs` |
| `npm run lint` | `tsc --noEmit` |
| `npm run logo:build` | `node scripts/build-logo-mark.mjs` |
| `npm run logo:check` | `node scripts/build-logo-mark.mjs --check` |
| `npm run preview` | `vite preview` |
| `npm run test` | `vitest run` |
| `npm run test:watch` | `vitest` |

## Repository scripts

- `scripts/audit-mobile-high.mjs` — Fail-closed mobile npm audit gate with a tiny, time-bounded exception list
- `scripts/audit-web-high.mjs` — Fail-closed web/admin npm audit gate
- `scripts/branch-audit.sh`
- `scripts/build-logo-mark.mjs` — Generates the transparent-background brand mark from the official logo master
- `scripts/check-design-system-hygiene.mjs` — Guards the NEW design-system code against re-introducing raw values
- `scripts/docs-check-ownership.mjs` — Enforces the documentation ownership map in docs/ownership.json
- `scripts/docs-generate.mjs` — Generates the machine-derived half of the documentation set
- `scripts/migrate-mobile-runtime-theme.mjs` — Conservative one-shot codemod for the retained System/Light/Dark feature
- `scripts/sync-design-system.mjs` — Mirrors the canonical design-system modules into each app
