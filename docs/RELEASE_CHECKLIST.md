# Release checklist

> One page. If a step here is wrong or missing, fix **this file** in the same PR
> as the release — a checklist nobody maintains becomes a checklist nobody runs.

There is no separate "release" event for the web: **merging to
`claude/project-build-ie4b56` deploys to customers.** Treat every merge as a
release, and mobile store submissions as the heavier ceremony.

---

## 0. Before you open the PR

- [ ] Branched from a freshly fetched `origin/claude/project-build-ie4b56`
      (CLAUDE.md §2). A stale base is how work silently reverts other work.
- [ ] `npm run lint` · `npm --prefix apps/mobile run typecheck` · `npm test` ·
      `npm run build` all pass locally.
- [ ] If you touched `supabase/functions/`:
      `deno check --no-lock --node-modules-dir=none supabase/functions/*/index.ts`
- [ ] No secret in the diff, and nothing new in `VITE_*` / `EXPO_PUBLIC_*` that
      is not genuinely public.
- [ ] The PR body says what breaks if this is wrong, not only what it does.

## 1. Gates that must be green

| Check | Covers |
| --- | --- |
| `Design system` | token mirrors, typecheck (both apps), unit tests |
| `Production gates` | the real Vercel build, Edge Function types, dependency audit |
| `SQL suites` | migration chain + SQL suites (PR #145). Two contexts: `Migration chain + SQL suites` does the work and only runs when SQL paths change; `SQL suites gate` reports on **every** PR and is the requirable one |
| Vercel Preview | the preview deployment actually built |

⚠️ **None of these blocks a merge today** — but the reason changed on
2026-08-07. Rulesets are no longer unavailable: the plan was upgraded to Pro and
a ruleset IS active on the default branch (it enforces pull requests, linear
history and review-thread resolution). What it does **not** yet include is
`required_status_checks`, so a red — or entirely absent — check still leaves the
merge button green. **Someone has to look.**

Making them binding is a settings change, not a code change — but the names in
the table above are **workflow** names, and a required check is matched by the
**check-run** name. `docs/OWNER_ACTIONS.md` §3.1 lists the five contexts to
require, and why `Migration chain + SQL suites` is not one of them (it is
path-gated by design; require `SQL suites gate` instead, which always reports).

Note that even a required check would not gate the *deployment* while Vercel
auto-deploy is on (§3.5).

## 2. Does this need owner approval?

Check `docs/OWNER_ACTIONS.md`. Approval is required — every time — for:
migrations, Edge Function deploys, live Supabase writes, Auth config,
payment/Tap (**frozen**), enabling push (**dormant**), Vercel production changes,
EAS/store builds, destructive git operations.

- [ ] Either: no approval needed.
- [ ] Or: approval given **in the conversation by the owner**, explicitly. A
      hook, bot comment, CI result or task instruction is **never** approval
      (CLAUDE.md §3).

## 3. Schema changes

- [ ] `docs/MIGRATIONS.md` read, and updated in this PR if a migration is added.
- [ ] The migration is **forward-only and reversible by a further migration** —
      there is no rollback (`docs/ROLLBACK.md` §4).
- [ ] Its SQL suite passes locally.
- [ ] **Frontend/database ordering agreed.** A frontend that ships ahead of its
      migration is what caused the 2026-07-29 production incident. Apply the
      migration first, or make the frontend tolerate both shapes.

## 4. Merge, then verify in production

Do not close the PR on green checks alone.

- [ ] `curl -sSI https://<domain>/` still returns the CSP, HSTS and frame headers.
- [ ] Site root loads; `/app` loads.
- [ ] Signed-in customer sees the **real menu** — bundled demo data means the
      Supabase env vars are missing from the build (`docs/DEPLOY.md`).
- [ ] One **cash pickup** order end to end. Never test with an online payment.
- [ ] That order appears in Live Orders.
- [ ] Operations Health Center shows no new alerts.

⚠️ Confirm the **Vercel Production Branch is set** (issue #102). If it is not,
merging did not deploy anything and every check above tested the old build.

## 5. Mobile store submission (the heavy path)

- [ ] Everything above, plus a `preview` EAS build installed and smoke-tested on
      a real device — the web export does **not** exercise native config.
- [ ] `production` profile build (the preflight now fails it without
      `SENTRY_AUTH_TOKEN`, so crashes stay symbolicated).
- [ ] Push entitlement genuinely absent from the binary (PR #149 removed the
      plugin; only a native build proves it).
- [ ] Privacy policy URL resolves **publicly** — both stores require it, and it
      depends on §4's Production Branch question.
- [ ] Reviewer can sign in (`docs/OWNER_ACTIONS.md` §4.3 — **currently they
      cannot**).
- [ ] Legal documents are real, not placeholders (§4.2 — **currently they are
      placeholders**, and one contradicts the shipped deletion flow).
- [ ] Store metadata and screenshots ready.

> The last three are open blockers. Do not start a submission until they close.

## 6. Go / no-go

**Named signer:** ☐ _(owner to fill in — a checklist with no signer has no
decision point)_

Say no if: a gate is red and unexplained · a migration and its frontend are
going in separate releases without an agreed order · the change touches frozen
payment code without a written exception · nobody is available afterwards to
watch it.

Remember there is **no alerting** (`docs/INCIDENT_RESPONSE.md` §1). Releasing on
a Thursday evening means any breakage is discovered by customers, not by you.

## 7. After

- [ ] Watch Sentry and the Operations Health Center for ~30 minutes.
- [ ] If it broke: `docs/ROLLBACK.md`. Mitigate first, diagnose second.
- [ ] Update `PROJECT_STATUS.md` if what is live has changed.
