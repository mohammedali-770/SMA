# Rollback — getting back to a known-good state

> **Status: written, only partly rehearsed.** Every procedure below is derived
> from the repository and the platform's documented behaviour. The ones marked
> **UNREHEARSED** have never been executed against this project. Rehearse them
> before you need them — the first time you run a rollback should not be during
> an incident.

The three deployable surfaces fail and recover independently. Identify which one
is broken before doing anything, because the fast path for one is unavailable for
another.

| Surface | Rolls back in | Mechanism |
| --- | --- | --- |
| Admin console + customer web (`/` and `/app`) | ~30 seconds | Vercel Instant Rollback |
| Edge Functions | minutes | Redeploy the previous source |
| Mobile app (iOS/Android) | **days** | App store review — there is no OTA channel |
| Database schema | **no automated path** | See §4 and `docs/MIGRATIONS.md` |

---

## 0. First: is it actually a deploy?

Before rolling anything back, rule out the cheaper explanations. A rollback that
does not address the cause costs you the ability to diagnose it.

1. **Is Supabase up?** <https://status.supabase.com> — if the database or Auth is
   down, rolling back the frontend changes nothing.
2. **Is it a config change rather than a code change?** Vercel environment
   variables are read at **build time** (`docs/DEPLOY.md`). Changing one in the
   dashboard does nothing until a redeploy — and rolling back to a deployment
   built with the *old* variables will silently restore the old values too.
3. **Did a migration land recently?** Check `docs/MIGRATIONS.md`. A frontend
   rollback against a migrated database can be worse than the bug.
4. **What changed?** `git log --oneline origin/claude/project-build-ie4b56 -10`.

---

## 1. Web — admin console and customer app

Both surfaces are one Vercel project: the root Vite build serves the admin
console, and the Expo web export is served at `/app`.

### Fast path — Instant Rollback (~30s, no build)

1. Vercel dashboard → the project → **Deployments**.
2. Find the last deployment known good (check the commit message and timestamp).
3. **⋯ → Instant Rollback** (older UI: **Promote to Production**).
4. Verify — see §5.

Instant Rollback re-points the production alias at an already-built artifact. It
does not rebuild, so it is fast and cannot fail on a build error.

> ⚠️ **The rolled-back artifact carries the environment variables it was built
> with.** If the incident was caused by an env-var change, Instant Rollback also
> reverts to the old values — usually what you want, but be deliberate about it.
> If you changed an env var *and* need the new code, you must redeploy, not roll
> back.

### Slow path — revert the commit

When the bad change must leave the branch (not just production):

```bash
git fetch origin
git checkout -b fix/revert-<what> origin/claude/project-build-ie4b56
git revert --no-edit <bad-sha>
git push -u origin fix/revert-<what>
gh pr create --base claude/project-build-ie4b56
```

Then get owner approval and merge. This rebuilds, so it takes as long as a normal
deploy and *can* fail. Use Instant Rollback first to stop the bleeding, then
revert properly.

> ⚠️ **Known issue (#102): production may not track the default branch.** If the
> Vercel Production Branch is unset, merging does not deploy and rolling back a
> commit does not un-deploy. Confirm the Production Branch is
> `claude/project-build-ie4b56` before relying on any of this.

---

## 2. Edge Functions

**UNREHEARSED.** There is no version history in the Supabase Functions UI to roll
back to — recovery means redeploying the previous source.

```bash
git checkout <last-good-sha> -- supabase/functions/<name>
supabase functions deploy <name> --project-ref wxfmmnihidsdyemasstf
```

Note the JWT flag: `payment-webhook` and `payment-return` deploy with
`--no-verify-jwt`; every other function keeps verification on. Deploying one of
those two *without* the flag silently breaks it — the caller has no Supabase JWT.
`supabase/config.toml` is the source of truth for each function's setting.

⚠️ Deploying an Edge Function is **owner-approval-gated** (CLAUDE.md §5), and the
payment functions are **frozen** (§6). During an incident, ask — do not assume
the incident is its own approval.

⚠️ There is currently **no record of which commit each deployed function was
built from**. Determining "the last good version" means reading git history and
inferring. Fixing that (a deployed-function manifest) is tracked in the
readiness plan.

---

## 3. Mobile app — there is no fast rollback

**This is the gap to understand before launch.** The app has no `expo-updates` /
EAS Update channel, so a JavaScript regression cannot be pushed to devices. The
only routes are:

1. **Submit a fixed build** and request expedited review (Apple: hours to days;
   Google: hours). This is the real path.
2. **Halt the rollout** — Google Play staged rollout can be paused; App Store
   phased release can be paused. This stops *new* installs. It does **not** fix
   users who already updated.
3. **Remove the app from sale** — only for something catastrophic (data loss,
   payment defect). It does not touch installed copies.

**Mitigations that do not need a store cycle**, because the server is the lever:

- Most order-flow behaviour is server-authoritative. Disabling a payment method,
  deactivating a branch, or turning off a coupon changes app behaviour instantly
  via the database, with no client release.
- If the app is broken against the current backend, prefer making the **backend
  tolerate the old client** over shipping a client fix. Old clients never fully
  disappear regardless.

Adopting EAS Update, plus a server-driven minimum-supported-version gate, is the
structural fix and is tracked in the readiness plan.

---

## 4. Database — there is no rollback

Migrations are applied forward only, through the owner-approved `apply_migration`
workflow. `supabase db push` and `supabase migration repair` are permanently
forbidden against production (CLAUDE.md §8).

Recovery from a bad migration is a **forward** migration that undoes the change,
authored and approved like any other. There is no `down` step.

This makes the pre-apply gate the real control. See `docs/MIGRATIONS.md`, which
is the authoritative ledger and records the gate for every applied migration.

⚠️ If the bad migration destroyed or corrupted data, a forward migration cannot
help you — that is a restore, and restore procedure/PITR state is documented in
`docs/BACKUP_RECOVERY.md`. Read that file's status warning.

---

## 5. Verify the rollback actually took

Do not close an incident on the deployment dashboard turning green.

```bash
# Security headers still present (they live in vercel.json, so a rollback to a
# commit predating them silently drops the CSP)
curl -sSI https://<production-domain>/ | grep -iE \
  'content-security-policy|strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy'

# Both surfaces actually serve
curl -sS -o /dev/null -w '%{http_code}\n' https://<production-domain>/
curl -sS -o /dev/null -w '%{http_code}\n' https://<production-domain>/app
```

Then, in a private window:

1. Sign in as a customer and load the menu — proves Supabase env vars survived
   the rollback. **If the menu shows bundled demo data, the env vars are missing
   from the rolled-back build** (`docs/DEPLOY.md`).
2. Place a **cash pickup** order end to end. Do not test with an online payment
   during an incident.
3. Sign in as staff and confirm the order appears in Live Orders.
4. Open Operations Health Center and confirm no new alerts.

---

## 6. After

- Write down what broke, what you did, and how long it took. Even three lines in
  the PR is better than nothing — it is the only input to making the next one
  faster.
- If a rollback path in this file turned out to be wrong or slower than stated,
  **fix this file in the same PR as the code fix.** A runbook nobody corrects
  after using it decays into fiction.
- If the cause was a missing gate, add the gate — see
  `.github/workflows/production-gates.yml`.
