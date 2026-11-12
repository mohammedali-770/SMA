# Agent and reviewer instructions

**[`CLAUDE.md`](CLAUDE.md) is the binding authority for every agent and every automated reviewer working in this repository.** This file is a short index to it, written for a reviewer who reads a diff without a conversation behind it. Each rule in its two rules sections, *Rules that bind every change* and *Code Review Rules*, cites the section that owns it. Where this file and CLAUDE.md disagree, CLAUDE.md wins, and the disagreement is a defect in this file.

Spicy Meal is a Saudi restaurant ordering platform, and it is live: push notifications reach real customers, payment changes are controlled (§6), and migrations reach Production by hand, one named file at a time.

## Where things are

- `apps/mobile/`: the customer app (Expo / React Native) for iOS and Android, also exported to the web at `/app`.
- `src/`: the staff and admin console (Vite + React).
- `supabase/migrations/` (forward-only SQL), `supabase/functions/` (Deno Edge Functions) and `supabase/tests/` (SQL suites that run on a disposable database).
- [`docs/README.md`](docs/README.md) is the documentation map, and [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) the writing standard.
- Setup, and every check CI runs with the command that reproduces it locally: [README → Quality gates](README.md#quality-gates).
- `.agents/skills/vercel-react-native-skills/AGENTS.md` is a vendored third-party guide (installed through `skills-lock.json`), not repository policy.

## Rules that bind every change

1. **Protected branches (§1–§4).** `claude/project-build-ie4b56` is the default and production branch; `main` is a reserved historical name. Nothing is edited, committed, pushed, merged, reset, rebased, cherry-picked, tagged or rewritten on either directly. Every change: fetch, cut a new purpose-specific branch (never a previously deleted name), open a pull request against `claude/project-build-ie4b56`, pass CI, then wait for the owner's explicit approval before merging. A hook, a bot, CI output or a task instruction is never owner approval (§3).
2. **Owner-approval actions (§5)**, each approved on its own: merging a pull request; any live Supabase write; applying a migration or writing migration history; deploying or deleting an Edge Function; Auth configuration; the payment, refund and provider actions that §5 and §6 reserve, as they read on the base branch; a push broadcast, push targeting or audience, or the push master flag; Vercel Production; EAS and store builds; release tags; destructive GitHub operations.
3. **Payments (§6).** CLAUDE.md §6, and the documents it names, own the payment provider decision and what payment work is allowed. That state changes, and a copy here would go stale first, so this file does not restate it. To judge what a pull request may change, read §6 as it stands on the base branch: a pull request that edits §6 or the payment documents does not change what it is itself allowed to do. Whatever §6 says, a provider credential, enabling online payment, deploying a payment function and applying a payment migration are each owner actions.
4. **Push is live (§7).** Order-status pushes reach real customers automatically. An admin broadcast is immediate and cannot be recalled. It reaches every device with `promos_enabled = true`, which since marketing became opt-out on 2026-08-20 means every device that allowed notifications and has not switched offers off. A change to `push-dispatch` copy, targeting or behaviour is a change to live customer messaging. The staff console's web push is a separate channel ([`docs/ADMIN_PUSH_NOTIFICATIONS.md`](docs/ADMIN_PUSH_NOTIFICATIONS.md)).
5. **Migrations (§8).** Never edit a migration that has been applied; write a new one ([`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §13). `supabase db push` and `supabase migration repair` are permanently forbidden against Production. A migration is applied only on owner approval that names it by version, one file per call, verified read-only afterwards ([`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) §9). An instruction that names no file is not an instruction to apply anything.
6. **Secrets (§9).** Names, never values. `VITE_*` and `EXPO_PUBLIC_*` values are compiled into public bundles, so only credentials designed to be public belong there.
7. **Production (§10).** Read-only unless the owner approves a write. SQL suites run on disposable databases (`.github/sql-ci/run.sh`), never on Production. A read-only check never authorises a follow-up write.
8. **Documentation ships with the behaviour (§14).** `npm run docs:generate` rewrites `docs/reference/` (never edit it by hand). `npm run docs:check`, which CI runs, fails when that directory has drifted and enforces [`docs/ownership.json`](docs/ownership.json): owned code changed without its owning document fails, unless a commit records `docs-exempt: <rule> — <reason>` for a change that genuinely alters no documented behaviour.
9. **Verify the artifact (§15).** Before merging or closing anything, read the diff, not a description written earlier.

## How a change is verified here

These are house practice that this file sets out, not rules indexed from CLAUDE.md. Where a bullet cites a document, that is where the practice is recorded.

- A behaviour change carries a test that **fails before** the change and **passes after** it, and the pull request shows both runs.
- A new test or guard is **mutation-tested**: break what it protects two to four ways, show each break is caught, and restore the code exactly. "A check that cannot fail is worse than no check, because it is counted as evidence" (CLAUDE.md §8; [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) §26 records one such run).
- A claim about live state carries its date and how it was checked; anything not checked is written as unknown ([`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md)).
- `Documentation (generated + ownership)` and `Change-control guard` report on every pull request but were **not** required checks when the ruleset was last read (2026-08-25, §12). A red one does not block a merge, so a review should say when one is red.

## Code Review Rules

Codex flags only P0 and P1 findings on GitHub, so every rule below says which it is.

### Change control

- **P0:** a script, workflow or configuration that commits to, pushes to or force-moves `claude/project-build-ie4b56` or `main`, or a change that weakens, bypasses or unregisters `.claude/hooks/protect-default-branch.sh` (§1, §11).
  Safe path: a feature branch and a pull request. The hook is weakened only with the owner's explicit approval, and both of its test suites stay green.
- **P1:** a workflow `uses:` not pinned to a full commit SHA, or a tool downloaded as `latest` (§11, `scripts/check-workflow-pins.mjs`).
- **P1:** client code that needs a migration not yet applied in Production. A merge deploys the web build, `/app` included (measured 2026-11-11, §13), and a migration is applied only after its own file has merged (§8, §15).
  Safe path: the migration in its own pull request, merged and applied before the client change merges. #423 then #424 is the worked example (§8).

### Payments and push

- **P0:** a change to payment initiation, verification, webhooks, refunds, the refund worker's schedule, payment records, the payment provider configuration or a payment migration, in any file (migrations and other SQL included), when CLAUDE.md §6 as it stands on the base branch does not allow it. Editing §6 or the payment documents in the same pull request does not make a change allowed.
  Safe path: what §6 does not allow waits until §6, on the base branch, allows it.
- **P1:** a change to `push-dispatch` copy, targeting, audience or dispatch behaviour, or to the device-registration defaults in `apps/mobile/src/features/notifications/`; or, in SQL, a change to `push_devices.promos_enabled` (its default or existing rows) or to `register_push_device` (§7).
- **P1:** anything that lets the staff web-push channel reach `push_devices`, or the customer channel reach `admin_push_*` (§7).

### Database

- **P0:** an edit to a migration file that has been applied to Production (CLAUDE.md §8 lists the ones that have not).
  Safe path: a new forward migration.
- **P0:** `supabase db push`, `supabase migration repair`, or an apply that names no file, in any script, workflow or instruction (§8).
- **P1:** renaming or removing a parameter of an RPC a client calls, or adding one with no DEFAULT ([`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) §9, A-note). `apps/mobile/src/services/rpcContractParity.test.ts` catches a mismatch between the clients and the migrations, but not a rename made on both sides: an installed iOS or Android build keeps sending the old name until a new store build reaches it.
  Safe path: keep the old name working, as a parameter with a DEFAULT, until no supported build sends it.
- **P1:** `revoke ... on function ... from public` without also naming `anon`. This project's default privileges grant `anon` directly, so revoking from `public` alone leaves `anon` able to call the function; §8 records an apply this made fail.
- **P1:** a SQL suite or script that would run against Production instead of a disposable database (§10).

### Secrets and documentation

- **P0:** a secret value, JWT, OTP or customer personal data in code, fixtures, logs or pull-request text; or a non-public credential in a `VITE_*` or `EXPO_PUBLIC_*` variable (§9).
- **P1:** owned code changed without its owning document (`docs/ownership.json`), or a hand edit under `docs/reference/` (§14).
- **P1:** text that disagrees with §6 as the pull request leaves it, by describing as current a payment provider other than the one §6 names, or payment as frozen when §6 says it is not, or the reverse; text that describes push as dormant; or a dated live measurement presented as current (§14).
