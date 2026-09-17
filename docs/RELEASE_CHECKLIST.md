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
- [ ] Push is LIVE: any change to notification copy, targeting or dispatch behaviour is a change to real customer messaging and was explicitly approved. Marketing is **opt-OUT** since the owner decision of 2026-08-20 — `DEFAULT_DEVICE_PREFS` sets `promosEnabled: true`, so granting the OS notification prompt enrols the device in offers, and the Profile toggle is the opt-out (CLAUDE.md §7). The column default `push_devices.promos_enabled` stays FALSE and never decides a live device's targeting.

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

**Verified live 2026-08-25.** The five contexts listed above are required by the
`Protect default branch` ruleset, which is active with no bypass actors and
applies only to the default branch. **`Documentation (generated + ownership)` is
NOT among them**, so a pull request failing `npm run docs:check` can still be
merged — treat that gate as advisory until it is added (`OWNER_ACTIONS.md` §14, evidence in §5).
The ruleset also sets `strict_required_status_checks_policy: true`, so a branch
must be up to date with the base before merging; expect a second pull request
merged straight after a first to need a branch update first.

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

## 8. App Store and Play submission

**Store *policy* readiness is a separate, one-time gate:
[`GO_LIVE_READINESS.md`](GO_LIVE_READINESS.md)** covers Apple's guidelines, Google
Play's requirements and Saudi PDPL, with each item traced to its source standard.
Work that gate before the first submission; the list below is the per-release
re-check.

Re-check these live immediately before submission; do not copy old audit status forward:

- [ ] Public Privacy Policy URL works without login.
- [ ] Terms/refund/delete-account/support pages reflect shipped product behavior.
- [ ] In-app account deletion and public policy are consistent.
- [ ] Reviewer login/test instructions work and do not expose production secrets.
- [ ] **Create the App Review test-phone entry.** First verify the number is UNUSED — `select count(*) from auth.users where phone = '+9665XXXXXXXX';` must return **0**. A number already enrolled signs the reviewer into that person's existing account (orders, saved addresses), because the profile trigger only fires for new users. Then map the fixed code and confirm it signs in. It is a permanent reusable login until removed, so §11 removes it — do not skip that. Detail: `OWNER_ACTIONS.md` §27.
- [ ] Store metadata, screenshots, support contact and category information are current.
- [ ] iOS bundle identifier / Android package match production config.
- [ ] Version/build numbers and signing credentials are correct.
- [ ] Encryption/privacy declarations match the actual app.
- [ ] Required native device validation is complete.

**Each store holds its own copy of the reviewer credentials**, so §11's removal step
has to update both, not just App Store Connect. Play in particular keeps them on the
app record and reuses them for every future review.

### App Store / TestFlight only

This section had no iOS-specific item either — the bundle identifier was the only
Apple line on the page — until 2026-09-16, when App Store Connect **refused the
upload** of a build that had passed every gate above. The answers behind these
boxes are in [`APP_STORE_SUBMISSION.md`](APP_STORE_SUBMISSION.md).

- [ ] **Purpose strings survive the resolved config AND the binary.**
      `apps/mobile/src/components/iosPurposeStrings.test.ts` guards the config
      side. The binary side only proves itself at upload: error **90683**
      (`EAS_UPLOAD_TO_ASC_MISSING_PURPOSE_STRING`) means a **linked** framework
      references a protected API and Apple wants the string whether the app calls
      it or not. **Adding an Expo module can introduce this without any code
      change of yours.**
- [ ] **`npx expo install --check`** immediately before the build. The SDK patch
      drift has recurred twice, most recently four days after being recorded
      closed.
- [ ] **Internal or external?** Internal (≤100 App Store Connect users) needs
      **no Beta App Review**. External (≤10,000) needs review on the group's
      first build, which pulls in the reviewer sign-in below.
- [ ] **Test information** — beta app description, what to test, feedback email.
      Required for both tiers. **Do not put a personal address in the feedback
      field**; every tester sees it.
- [ ] **App Privacy answers** still match what the app collects. Re-check after
      any change to analytics, location, push targeting or a third-party SDK,
      and keep them consistent with Play's Data Safety form — the two are the
      same facts and both stores cross-check them against the privacy policy.
- [ ] **Export compliance** — `ios.config.usesNonExemptEncryption` still matches
      reality. It is `false` today; adding cryptography changes the answer.
- [ ] **Reviewer credentials on the App Store Connect record**, and remember §11
      removes the Auth test-phone entry afterwards — **each store keeps its own
      copy**, so removal has to update both.
- [ ] **If an EAS submission reports failure, do not retry before reading the
      log.** `ERRORED` does not mean the upload failed — on 2026-09-16 Apple
      returned a 500 on the *status poll* after the binary had already been
      delivered, and the resubmit was refused with "build number has already been
      used". If the log contains `File upload ... completed!`, go and look at App
      Store Connect instead.
- [ ] **Finding the log at all**: the CLI prints only "Something went wrong",
      `submission.error` is often null and `submission.logFiles` often empty. The
      URL lives at `submissions.byId(…) { jobRun { logFileUrls } }` and the
      structured error at `jobRun { errors { … } }` — check both, because a given
      failure may produce one without the other. **The log is Brotli-compressed
      with nothing declaring it**; decompress with
      `zlib.brotliDecompressSync`, then filter the JSON lines on `level >= 40`.

### Google Play only

This section was titled "App Store / Play submission" and contained **no Play-specific
item at all** until 2026-09-16 — the Android package identifier was the only Android
line on the page. The answers behind these boxes are in
[`PLAY_STORE_SUBMISSION.md`](PLAY_STORE_SUBMISSION.md).

- [ ] **Closed-testing gate**, if the developer account is personal and was created on
      or after 13 November 2023: **12 testers opted in, day N of 14**, and production
      access applied for. **Internal testing does not count.** This is calendar time, so
      check it before planning a date, not after (`GO_LIVE_READINESS.md` C8).
- [ ] **Track and release status** in `apps/mobile/eas.json` match the track you
      actually intend. `internal` does not advance the closed-testing clock, and a
      `draft` release is not distributed to testers at all.
- [ ] **Release notes in both languages**, ≤500 characters each, from
      [`store/LISTING_COPY.md`](store/LISTING_COPY.md).
- [ ] **Data Safety form** still matches what the app collects — re-check after any
      change to analytics, location, push targeting or a third-party SDK.
- [ ] **Content rating questionnaire** still describes the app. Adding user-to-user
      content, or anything age-restricted to the menu, changes the answers.
- [ ] **App content → App access** still carries working reviewer credentials.
- [ ] **The listing copy's claims table** re-read against live settings — points are
      still pickup-only, payment is still cash, prices still include VAT. A claim that
      was true when drafted is the failure mode that table exists to prevent.
- [ ] **Screenshots still show the shipped build.** They are one build behind as of
      2026-09-16, and they can be replaced without a new release.
- [ ] **Staged rollout percentage** chosen deliberately.

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
- [ ] **Remove the App Review test-phone entry** (Authentication → Phone provider), then **verify** it by attempting a sign-in with the same number and code and confirming it is refused. While it exists it is a permanent reusable login to that account, and the pair is printed in the App Store Connect review notes. **Update BOTH stores' copies at the same time** — Play keeps the credentials on the app record and reuses them for every future review, so removing the Auth entry without updating Play means the *next* Play update is reviewed against a login that no longer works. Detail: `OWNER_ACTIONS.md` §27 and `PLAY_STORE_SUBMISSION.md` §4.
- [ ] If mitigation is required, use `docs/ROLLBACK.md` / `docs/INCIDENT_RESPONSE.md` and prioritize safety over diagnosis.