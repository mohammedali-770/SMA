# Branch Feature-Retention Audit

Baseline build branch: `claude/project-build-ie4b56`
Baseline commit: `e01c8b5ad5ac48c69d0163a875792f7ef5a4e582`
Next-build integration branch: `release/mobile-next-build`

## Rule

No historical branch is deleted until its intended behavior is checked against the final baseline tree and runtime wiring. Commit ancestry, `git cherry`, or a merged PR by itself is not sufficient proof that a feature still exists or still works, because later commits can replace or remove behavior.

For each branch:
1. Identify its intended user-visible or operational behavior from the PR/commits.
2. Inspect the branch-tip implementation and the corresponding final files on the baseline branch.
3. Trace current imports/routes/config/feature flags to verify the behavior is still reachable.
4. If behavior is missing but still wanted, port it onto `release/mobile-next-build` from the stable baseline rather than merging the stale branch wholesale.
5. Run the appropriate regression/typecheck/Expo/native gates.
6. Only then classify the historical branch as safe to delete.

## Audit results

### `feat/otp-autofill`
Status: **code retained, native zero-tap behavior not fully implemented by the original feature**.

PR #108 was merged and added OTP parsing/input logic, WebOTP support, iOS `textContentType="oneTimeCode"`, and Android `autoComplete="sms-otp"` hints. The current baseline still contains `OtpCodeInput`, `otpAutofill`, `useOtpAutofill`, and wiring in `PhoneOtpLogin`.

However, the original PR explicitly documented that real device enablement was still pending: Meta WhatsApp Authentication template work and Android app-hash/SMS-Retriever native integration. The native hook is intentionally a no-op and relies on declarative OS hints. Therefore a user not seeing automatic WhatsApp OTP fill on the current iOS build does not prove the code was dropped; it exposes that the original branch never completed true native WhatsApp zero-tap behavior.

Action before cleanup: treat this as a feature gap to evaluate for the next build; do not delete the branch merely because its PR merged.

## Remaining branches

Pending one-by-one final-tree and behavior comparison. No deletion until this audit is complete.
