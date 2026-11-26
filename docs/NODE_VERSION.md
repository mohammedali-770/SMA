# Node version

**The repository and Vercel production standard is Node 22.**

`.nvmrc` at the repository root is the developer/CI source of truth. Every
`setup-node` step in the GitHub workflows (eight, across `dependency-audit-weekly.yml`,
`design-system.yml`, `docs.yml`, `eas-build.yml`, `eas-status.yml` and three jobs of
`production-gates.yml`, counted 2026-11-26 with `grep -c setup-node`) reads it via
`node-version-file: .nvmrc` rather than hardcoding a number, so the version cannot
drift between those steps. *(Two things are outside that guarantee:
`change-control.yml` runs `node scripts/check-workflow-pins.mjs` with no
`setup-node` step, so that gate uses whatever Node the `ubuntu-latest` runner
carries, and its guard-test job uses the runner's Node as one of its parsers on
purpose.)*

The root `package.json` also declares `engines.node: "22.x"`. Vercel reads that
field and uses it to select the build runtime, overriding the project-level Node
setting. Keeping both declarations aligned prevents CI and production from
silently running different Node majors.

```bash
nvm use          # reads .nvmrc
node -v          # v22.x
```

## Why 22 and not 20

The unit suite imports `src/lib/supabase.ts`, and `@supabase/realtime-js`
requires a native global `WebSocket`. Node 20 does not provide one, so the whole
suite fails to start:

```
Error: Node.js detected but native WebSocket not found.
Suggested solution: Ensure you are running Node.js 22+ or provide a WebSocket
implementation via the transport option.
 ❯ src/lib/supabase.ts   (the `createClient` call; the line number moves)
```

Node 22 is therefore a floor, not a preference. It is also the version used by
EAS-related GitHub workflows and the production web build. *(The Node version used
by EAS **cloud** builds is not set by `.nvmrc`: `apps/mobile/eas.json` has no
`node` key, so it is EAS's default, which is not known from the repository.)*

## Where the version applies

| Surface | Node | Notes |
| --- | --- | --- |
| Local development | `.nvmrc` | `nvm use` selects Node 22. |
| GitHub Actions | `.nvmrc` | Workflows use `node-version-file: .nvmrc`. |
| Vercel builds | `package.json` `engines.node` | Overrides the Vercel project-level Node setting. |
| `eas-build.yml` | `.nvmrc` | Fires on `workflow_dispatch` or a `mobile-build-*` tag only. |
| `eas-status.yml` | `.nvmrc` | Read-only EAS query; never starts a build. |
| `deploy-functions.yml` | n/a | Uses `supabase/setup-cli`; no Node/npm setup. |
| `design-system.yml`, `docs.yml`, `production-gates.yml`, `dependency-audit-weekly.yml` | `.nvmrc` | Added 2026-11-26 to the table; `design-system.yml` is the job that runs `npm test`. |
| `change-control.yml` | runner default | No `setup-node` step. |

## Why the Vercel pin was added separately

Earlier CI-standardisation work deliberately did **not** add `engines.node`,
because doing so changes the deployed Vercel runtime and therefore deserved a
separate production change. A later live Vercel audit found the project setting
on Node 24.x while the repository and CI were standardized on Node 22.

The production-safe correction is to pin Node 22 in source using
`engines.node`. Vercel documents that this setting overrides the dashboard Node
selection, removing that runtime drift without relying on an out-of-band project
setting.

## Changing the standard

Change `.nvmrc` and `package.json` together. Then verify:

- the unit suite still runs (`npm test`);
- production/web builds still run (`npm run build`);
- `eas-cli` still supports the version (`eas-build.yml`, `eas-status.yml`);
- Vercel preview/build output reports the intended Node major before production promotion.
