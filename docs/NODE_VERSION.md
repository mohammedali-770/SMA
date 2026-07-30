# Node version

**The repository standard is Node 22.**

`.nvmrc` at the repository root is the single source of truth. Every workflow
that sets up Node reads it via `node-version-file: .nvmrc` rather than hardcoding
a number, so the version cannot drift between workflows again.

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
 ❯ src/lib/supabase.ts:19:25
```

Node 22 is therefore a floor, not a preference. It is also the version
`eas-build.yml` already used, so standardising on it changed the fewest things.

## Where the version applies

| Workflow | Node | Notes |
| --- | --- | --- |
| `design-system.yml` | `.nvmrc` | The only workflow that runs `npm test`. |
| `eas-build.yml` | `.nvmrc` | Was already 22. Fires on `workflow_dispatch` or a `mobile-build-*` tag only. |
| `eas-status.yml` | `.nvmrc` | Was 20 — the last workflow behind. Read-only EAS query; never starts a build. |
| `deploy-functions.yml` | n/a | Uses `supabase/setup-cli` only. No Node, no npm, nothing to standardise. |

## Deliberately NOT set here

**`engines.node` in `package.json`.** It is the stronger, machine-enforced form
of this standard, but Vercel reads `engines.node` to select the build runtime.
Adding it would change the deployed Node version as a side effect, which is a
production deployment change and does not belong in a CI-standardisation commit.
Track it separately if you want npm to warn on a mismatched local Node.

`.nvmrc` is safe by comparison: Vercel does not read it, so it advises
developers and drives CI without touching the deployment runtime.

## Changing the standard

Edit `.nvmrc`. Every workflow follows automatically. Then check:

- the unit suite still runs (`npm test`);
- `eas-cli` still supports the version (`eas-build.yml`, `eas-status.yml`);
- whether Vercel's project setting should move to match.
