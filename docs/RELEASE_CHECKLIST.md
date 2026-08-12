# Spicy Meal Release Checklist

> **Updated 2026-08-12.** Keep this checklist aligned with the actual workflow files. A stale checklist is a release risk, not documentation trivia.

The web/admin release path and the native mobile release path are related but not identical. A green web build does **not** prove the native app is safe to ship.

## 0. Change-control first

Before release work:

- [ ] Work is on a fresh purpose-specific branch from `origin/claude/project-build-ie4b56`.
- [ ] A PR targets `claude/project-build-ie4b56`.
- [ ] No direct production-branch push/merge is being used.
- [ ] Any action that requires explicit owner approval has that approval in the conversation.
- [ ] Payment/refund code is untouched unless a separate payment exception was explicitly approved.
- [ ] Push remains dormant unless a separate rollout decision was explicitly approved.

See `CLAUDE.md`.

## 1. Local/source validation

Run the checks relevant to the change; for a normal application release run the full set:

```bash
nvm use
npm ci
npm --prefix apps/mobile ci

npm run lint
npm test
npm --prefix apps/mobile run typecheck
npm run design-system:check
npm run build
```

After mobile/native dependency or Expo config changes, also run from `apps/mobile/`:

```bash
npx expo-doctor
npx expo install --check
```

Use clean prebuild/export checks when the change touches native dependency/config compatibility.

For Edge Function changes, run the Deno typecheck used by CI. For database changes, run the SQL/migration harness against disposable local infrastructure only.

## 2. CI checks that must be understood

The repository currently defines these key check-run contexts:

- `design-system`
- `Production build (Vite + Expo web export)`
- `Edge Function typecheck (Deno)`
- `Dependency audit (high+)`
- `SQL suites gate`

`Migration chain + SQL suites` is the heavy SQL job and is path-gated; **do not use it as the always-required context.** `SQL suites gate` reports on every PR and represents the SQL decision.

Before relying on GitHub to block a bad merge, verify the current ruleset in GitHub Settings actually requires the intended contexts. Repository source cannot prove dashboard settings. See `OWNER_ACTIONS.md` §5.

- [ ] Every check relevant to this PR is green or deliberately not required by the documented gate logic.
- [ ] No failure is being dismissed as “probably unrelated” without evidence.
- [ ] Vercel Preview/build completed for web-facing changes.
- [ ] Review conversations are resolved.

## 3. Database changes

If the release contains a migration:

- [ ] Read `docs/MIGRATIONS.md` **and** `docs/OWNER_ACTIONS.md` §12.
- [ ] Confirm the current live migration state read-only before deciding what is unapplied.
- [ ] Never infer application status from filename timestamp alone.
- [ ] Migration is forward-only and added as a new file.
- [ ] No historical migration was edited/renamed.
- [ ] SQL suite passes.
- [ ] Frontend/database rollout order is safe if clients can observe both schema versions.
- [ ] Separate explicit owner approval exists for live application.
- [ ] Apply only through the approved production migration workflow.

Never run `supabase db push` or `supabase migration repair` against production.

## 4. Edge Function changes

- [ ] Function typecheck passes.
- [ ] Authentication model (`verify_jwt`, signature/service secret, role check) still matches the caller.
- [ ] No provider/service-role secret can reach a client/log.
- [ ] Deployment is separately approved by the owner.
- [ ] The controlled deployment workflow is used; do not copy old direct deploy commands from historical docs.

Payment functions remain frozen regardless of whether the generic deploy workflow can technically deploy them.

## 5. Web/admin release verification

After the production deployment, verify the deployed result—not only the merge commit:

- [ ] Production deployment points at the expected commit.
- [ ] Site root loads.
- [ ] `/app` loads the Expo customer web app.
- [ ] Security headers remain present (CSP/HSTS/frame policy as defined by current config).
- [ ] Signed-in customer path uses the real Supabase-backed catalog rather than a dev/fixture path.
- [ ] Staff/admin authentication works.
- [ ] Live Orders loads without a new error.
- [ ] Operations Health shows no new release-caused failure.
- [ ] Sentry receives/associates errors with the intended environment/release when tested through the approved observability procedure.

Do not use “HTTP 200 at `/`” as proof that the deployment is current; the SPA catch-all can return 200 for invalid paths. Use the commit/deployment checks in `docs/DEPLOY.md`.

## 6. Customer order smoke test

When an end-to-end order test is approved:

- [ ] Use the approved non-payment test path unless payment testing was separately authorized.
- [ ] Order-type gate behaves correctly.
- [ ] Correct branch/catalog context is used.
- [ ] Cart/modifier validation is correct.
- [ ] Order reaches the expected admin/POS lifecycle.
- [ ] Customer-visible order reference is safe/external (`#…` where applicable), not an internal SMA row identifier.
- [ ] No unexpected stranded/confirmation-required state is introduced.

Payment/refund behavior is not part of ordinary smoke testing while the payment freeze is active.

## 7. Native preview / Build 5 gate

Before native store submission, a real device must exercise the native bundle.

- [ ] Owner explicitly approved starting the EAS build.
- [ ] EAS build uses the intended profile/environment.
- [ ] Build installs on a physical device.
- [ ] Cold launch succeeds.
- [ ] WhatsApp/Supabase login succeeds.
- [ ] Arabic/English + RTL works.
- [ ] System/Light/Dark appearance works without unreadable frozen-light colors.
- [ ] Pickup/Delivery gate works.
- [ ] Menu, product, cart and checkout screens render correctly.
- [ ] Map/location and saved-address flows work.
- [ ] Orders/history/receipt/profile/delete-account screens work.
- [ ] No native dependency/framework launch crash occurs.
- [ ] Sentry/native source-map path is verified for production builds.

PR #200 completed source retention; this physical-device validation remains a separate gate.

## 8. App Store / Play submission

Re-check these live immediately before submission; do not copy old audit status forward:

- [ ] Public Privacy Policy URL works without login.
- [ ] Terms/refund/delete-account/support pages reflect shipped product behavior.
- [ ] In-app account deletion and public policy are consistent.
- [ ] Reviewer login/test instructions work and do not expose production secrets.
- [ ] Store metadata, screenshots, support contact and category information are current.
- [ ] iOS bundle identifier / Android package match production config.
- [ ] Version/build numbers and signing credentials are correct.
- [ ] Encryption/privacy declarations match the actual app.
- [ ] Required native device validation is complete.

If legal wording is incomplete, do not invent it in an engineering release. Separate factual product corrections from counsel-required language.

## 9. Production settings that source cannot prove

Before a major release, re-verify as appropriate:

- [ ] Vercel production branch/deploy behavior.
- [ ] Whether Vercel auto-deploy or the gated deploy path is actually active.
- [ ] GitHub required status checks/ruleset.
- [ ] Supabase backup/PITR status.
- [ ] `payment-refund-worker` remains disabled while payment work is frozen.
- [ ] External monitoring/incident contacts are operational if the release depends on them.

Record changed dashboard facts in the owning doc; do not leave them as chat-only knowledge.

## 10. Go / no-go

Do not release when:

- a required gate is red/unexplained;
- database/client rollout order is unsafe;
- a native dependency change has not been proven on a device;
- payment/refund code changed without a separately approved exception;
- production deployment cannot be tied to the intended commit;
- no one is available to observe/mitigate the release.

**Owner/sign-off:** ☐ approved / ☐ no-go

## 11. After release

- [ ] Verify the deployed commit/build one more time.
- [ ] Watch Sentry and Operations Health for the agreed observation period.
- [ ] Confirm expected order/operational signals continue.
- [ ] Record any release-specific manual configuration change.
- [ ] If mitigation is required, use `docs/ROLLBACK.md` / `docs/INCIDENT_RESPONSE.md` and prioritize safety over diagnosis.