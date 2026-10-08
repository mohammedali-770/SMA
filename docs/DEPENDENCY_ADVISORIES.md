# Dependency advisories — gate, standing exceptions, and how to clear them

> Owned by `.github/workflows/production-gates.yml` (job: **Dependency audit**).
> This file is the only sanctioned place to record an advisory that is knowingly
> left unfixed. If an advisory is not listed here, CI failing on it is correct
> and the fix — not an edit to this file — is the answer.

---

## 1. What the gate enforces

Both dependency trees are audited on every PR. The web/admin tree still runs:

```bash
npm audit --audit-level=high
```

The mobile tree runs `scripts/audit-mobile-high.mjs`, which itself executes
`npm --prefix apps/mobile audit --audit-level=high --json` and fails closed.
It permits only the exact, time-bounded HIGH exceptions recorded in §3.2 and
§3.3; any critical advisory, any other direct high advisory, any high record
outside the approved dependency closure, malformed audit output, or an expired
exception still fails CI.

**It annotates every direct high/critical advisory before reaching any verdict.**
Until 2026-10-08 it checked the expiry date first and exited, so once the date
passed it printed only *"exception expired"*. From 2026-10-02 to 2026-10-08 that
one line stood in front of five new root advisories, including a **CRITICAL**,
and named none of them. Bumping the date would not have accepted them — the
allowlist check would still have failed — but a routine-sounding message was
hiding a critical. An expired exception can no longer be the only thing a reader
sees. Excepted advisories are annotated as warnings rather than errors, because
an `::error` renders red on a PR even when the gate passes, and a gate that is red
on every green run teaches people to stop reading it.

The gate is set at **high**, not at moderate. That threshold is a deliberate
trade-off: the mobile tree carries a block of moderate advisories from upstream
Expo packages that have no non-breaking fix (§3.1). Gating at moderate would
fail every PR on something this repository cannot fix, and a gate that is always
red is a gate everybody learns to ignore.

As of **2026-10-08**, the web tree is clean at high/critical. The mobile tree has
no critical and two reviewed direct HIGH advisories — `braces` (§3.2) and
`node-forge` (§3.3) — which npm propagates to 20 high dependency records. Both
are in packages with **no patched release**, both are reached only through
build/CLI tooling, and neither is in the customer bundle. The `image-size`
exception that preceded them is retired (§4.5).

*Superseded, kept because the count is the point:* as of 2026-09-02 the mobile
tree carried two `image-size` advisories propagating to 15 high records.

## 2. Why `npm audit fix` is not the default remedy here

On the mobile tree, plain `npm audit fix` can re-resolve a large portion of the
Expo CLI toolchain, React Native codegen, and related build tooling. On an app
heading for store review, that is a large, mostly unrelated change surface.

Prefer, in order:

1. **A targeted `overrides` entry** when the vulnerable package has a compatible
   fixed release and the dependent API contract remains valid.
2. **A real dependency upgrade** when the direct dependency has a fixed release,
   with the app built and smoke-tested afterwards.
3. **`npm audit fix`** only when the resulting lockfile diff is small enough to
   review, or when a deliberate SDK upgrade is already planned.
4. **A documented, expiring exception** only when there is no released fix and
   reachability/risk has been reviewed. The gate must remain fail-closed for all
   other advisories.

Always inspect dependency diffs before committing them.

## 3. Standing exceptions

### 3.1 Upstream Expo — moderate advisories (mobile tree)

| Field | Value |
| --- | --- |
| **Packages** | `@expo/config`, `@expo/config-plugins`, `@expo/prebuild-config`, `expo-splash-screen` and transitive dependents |
| **Severity** | Moderate |
| **Status** | Accepted — no non-breaking fix available on the current SDK line |
| **Reviewed** | 2026-08-03 |
| **Next review** | On the next Expo SDK upgrade, or 2026-11-03, whichever comes first |

These are build-time packages: the Expo config/prebuild toolchain runs on a
developer machine or EAS builder, not on a customer's phone. They are not
reachable from the shipped application bundle. A forced audit fix would move
the project off its deliberately pinned Expo SDK line rather than apply a small
security patch.

**To clear:** upgrade the Expo SDK deliberately, rebuild all targets, re-run the
audit, and remove this exception when the advisories disappear.

### 3.2 `braces` — stack-exhaustion DoS — HIGH (mobile build toolchain)

| Field | Value |
| --- | --- |
| **Package** | `braces` |
| **Advisory** | `GHSA-vfj7-8cjw-p6xm` |
| **Severity** | High |
| **Affected** | `<= 3.0.3` |
| **Patched release as of review** | **None.** `3.0.3` is the latest published version and is itself affected |
| **Reachability in SMA** | `braces` ← `micromatch` ← `metro-file-map` / `@expo/metro-file-map`: build-time file watching over the repository's own glob patterns. **The gate bounds `micromatch`'s parents, not only `braces`'** — see below |
| **In the customer bundle?** | **No** — measured against the deployed `/app` entry bundle (4.4 MB): zero `micromatch`, zero `braces` library code. Its single `braces` hit is React Helmet's error text *"Did you forget to wrap your children in braces?"* |
| **Reviewed** | 2026-10-08 |
| **Exception expires** | **2026-11-07** |
| **Clear when** | `braces` publishes a release above `3.0.3`, or `micromatch` stops depending on an affected line |

A stack-exhaustion DoS on deeply nested brace patterns. Reaching it needs an
attacker-supplied glob pattern fed to the bundler during a build; in SMA those
patterns come from the repository's own Metro configuration.

**Why the bound reaches two levels up.** `braces`' only parent is `micromatch`,
a general-purpose glob library that any runtime package could use. The first
version of this exception bounded only `braces`' parent — so a customer-runtime
package depending on `micromatch` would have joined the approved closure and
passed. The gate now also requires `micromatch`'s parents to be exactly the two
Metro file-map packages, and rejects `micromatch` as a direct mobile dependency.
Review caught this on #416. **A reachability bound has to reach a build tool; a
bound that stops at a generic library proves nothing.**

### 3.3 `node-forge` — PKCS#1 v1.5 signature verification — HIGH (mobile CLI toolchain)

| Field | Value |
| --- | --- |
| **Package** | `node-forge` |
| **Advisory** | `GHSA-86w9-cpqp-85rv` |
| **Severity** | High |
| **Affected** | `<= 1.4.0` |
| **Patched release as of review** | **None.** `1.4.0` is the latest published version and is itself affected |
| **Reachability in SMA** | `node-forge` ← `@expo/cli`, `@expo/code-signing-certificates`: the Expo CLI and its EAS Update code-signing helper |
| **In the customer bundle?** | **No** — zero `node-forge`, `forge.pki`, `pkcs12` or PEM certificate strings in the deployed `/app` bundle, and no app source imports it |
| **Reviewed** | 2026-10-08 |
| **Exception expires** | **2026-11-07** |
| **Clear when** | `node-forge` publishes a release above `1.4.0`, or Expo's code-signing path stops depending on it |

**The flaw is in signature verification, so the deciding question was whether
this app verifies anything with it.** It does not. The only place the Expo
toolchain uses `node-forge` to sign or verify is **EAS Update code signing**, and
that is not configured here — checked against the **resolved** Expo config
(`npx expo config`, which combines `app.json` with the dynamic `app.config.js`):
no `updates` block, no `codeSigningCertificate`, no updates plugin. And
**`expo-updates` is not in the mobile lockfile at all**, nor declared by anything
in it. The first version of this entry cited `app.json` alone, which was
incomplete: a dynamic `app.config.js` can enable code signing that `app.json`
does not show. The conclusion held; the evidence did not cover it until the
resolved config was read. On a
device, update signatures are verified by native code in `expo-updates`, not by
this library. **That precondition is now enforced by the gate, not by this paragraph.** The
gate fails the `node-forge` exception if `expo-updates` appears anywhere in the
mobile lockfile, or if any of `app.json` / `app.config.{js,ts,mjs,cjs}` mentions
`codeSigningCertificate`, `codeSigningMetadata` or `expo-updates`. It is a static
check because the audit job installs nothing, and it does not need the resolved
config: EAS Update code signing cannot run without `expo-updates`, so that
package's absence rules the feature out. Turning code signing on therefore fails
CI and forces this review — which is the point, since it is the one change that
would give the flaw a live consumer.

### Both exceptions are bounded by the gate, not by this document

`scripts/audit-mobile-high.mjs` accepts only these two exact GHSAs on these two
exact packages; bounds the immediate parents of each excepted package **and of
the generic `micromatch` between `braces` and Metro**; requires every HIGH record
to belong to the union of the two packages' npm `effects` closures; enforces the
code-signing precondition `node-forge` rests on; and fails if a listed advisory is
no longer present, so a stale entry cannot sit waiting to accept its package
again.

**It also keeps every package on an approved path out of the app itself** — each
bounded package *and every approved parent* — in two ways. None may be a direct
mobile dependency; and the app's own source (`apps/mobile/src`) may not import
any of them, which catches a hoisted package used without being declared, a path
no `package.json` check can see. A bound proves the excepted code is reached only
*through* a build tool, and proves nothing if the app uses that build tool's
library directly: `@expo/code-signing-certificates` is an ordinary JS library
whose only dependency is `node-forge`, so declaring and importing it would put the
signature-verification flaw in the customer bundle while every graph check still
passed. The import pattern was validated on ten known-positive import forms and
six look-alike negatives before its clean result on the real source was trusted;
an empty source tree fails rather than passing as a scan over nothing.

**That heading was false when first written, for one precondition.** The
`node-forge` exception rested on code signing being off, and only this document
said so — the gate would have kept passing with code signing on. Review caught it
on #416, together with the `micromatch` bound and a weakened stale-entry check
(below). A second review pass then found the approved parents unchecked for
directness; that whole class — declared *or* imported — is now closed. All of it
is enforced in the gate.

**Mutation-tested against the real audit output, every mutant's precondition
confirmed before its verdict was counted:**

| mutant | result |
| --- | --- |
| an unreviewed high | killed |
| a new reachability path for `node-forge` | killed |
| `micromatch` gains an unapproved parent | killed |
| `micromatch` becomes a direct dependency | killed |
| code signing configured in `app.json` | killed |
| `@expo/code-signing-certificates` declared as a direct dependency | killed — and **survives** the revision before it |
| `@expo/cli` declared as a direct dependency | killed |
| app source imports `node-forge` **without declaring it** | killed |
| a listed advisory whose package has left the tree | killed |
| an expired date | killed — and still names every advisory |
| a real critical (lockfile-confirmed: 6 critical records) | killed |
| a critical plus an expired date — the state of 2026-10-02 to 2026-10-08 | killed — and names the critical |

### What the gate cannot see — stated rather than implied

**The gate bounds the dependency graph, and the graph cannot tell build-time
from runtime use.** That is a real limit, and a third review pass on #416 reached
it. Its finding: a *new* customer-runtime dependency that itself depends on
`@expo/code-signing-certificates` would be absorbed into the approved closure,
and the gate would pass.

It cannot be closed by bounding one more hop, and that was measured rather than
argued. `node-forge`'s chain runs
`node-forge ← @expo/cli ← expo ← @sentry/react-native` — and `expo` and
`@sentry/react-native` are packages that **ship in the customer app** and
legitimately list the CLI as a dependency. Any bound strict enough to reject a
hypothetical runtime consumer also rejects that legitimate edge, i.e. today's
tree. Each additional bound only moves the open edge one hop higher. The review
findings went 3 → 1 → 1, each the same class one level up; the gate stopped being
extended there on purpose.

**So what the gate does and does not guarantee:**

- **Guaranteed:** no listed package or approved parent is declared by the app or
  imported by its source; no unapproved parent reaches the excepted packages; no
  other high or any critical passes; code signing cannot be switched on silently;
  and a stale or expired entry fails loudly.
- **Not guaranteed:** that a *new* third-party dependency does not pull `node-forge`
  or `braces` into the customer bundle through a CLI library it depends on. Adding
  such a dependency is a deliberate act the gate does not detect.

**The question that actually matters — does this code reach a customer? — is a
property of the built bundle, not the graph.** It was answered by measurement on
2026-10-08: zero `node-forge`, `micromatch` or `braces` library code in the
deployed `/app` bundle. Enforcing it continuously means asserting it against the
bundle the Production build job emits, which is a CI change of its own and is not
in this one. Until then, the residual exposure is bounded by **the 2026-11-07
expiry**, which forces this review again within a month.

**The stale-entry check was weakened, then restored.** The original `image-size`
gate failed unconditionally on any unobserved allowlisted advisory. The first
version of this rewrite added a guard that skipped the check when the package was
absent from the tree — exactly the case that matters. Run against that version,
the "listed advisory whose package has left the tree" mutant **survives**, which
is the proof the defect was real rather than hypothetical.

## 4. Resolved

### 4.1 `postcss` — path traversal (GHSA-r28c-9q8g-f849) — HIGH

Arbitrary `.map` file disclosure via `sourceMappingURL` auto-loading.
Present in both trees at 8.5.16, transitively.

- Web tree: patched to 8.5.25.
- Mobile tree: `overrides` entry → `^8.5.25`.

### 4.2 `brace-expansion` — DoS via unbounded expansion (GHSA-mh99-v99m-4gvg) — HIGH

Out-of-memory process crash on a maliciously crafted brace pattern.

- Web tree: patched to 5.0.9.
- Mobile tree: `overrides` entry → `^5.0.9`.

### 4.3 `undici` — five advisories at 7.28.0 — HIGH (web tree)

`undici` entered this tree only through `jsdom`, a test/dev dependency. It was
still fixed rather than excepted because a compatible patch existed.

- Web tree: root `package.json` override → `^7.29.0`.
- Mobile tree: not present.

### 4.4 `js-yaml` — quadratic CPU consumption in `!!omap` (GHSA-5p4m-2wfm-xmqj) — HIGH (mobile tree)

CVE-2026-59870. `js-yaml` reaches the mobile tree through
`expo → @expo/cli → @expo/xcpretty`, a build-log formatter. A compatible patched
release existed, so the issue was fixed rather than excepted.

- Mobile tree: `overrides` entry → `^4.3.1`.
- Web tree: not present.

### 4.5 `image-size` — two infinite-loop DoS advisories — HIGH — RETIRED 2026-10-08

The exception that sat at §3.2 from 2026-08-10. **Retired by removing the
package, not by extending the date** — `image-size` is no longer in either tree.

`metro@0.84.5` replaced its `image-size` dependency with an internal reader
(`metro/src/lib/imageSize`). The mobile tree carried **two complete Metro
families**: `0.84.5`, which `@expo/metro` pins exactly and which Expo's own build
runs on, and a duplicate `0.84.4` pulled in by
`@react-native/community-cli-plugin`, which still depended on `image-size`.
`apps/mobile/package.json` now pins the fourteen Metro packages to `0.84.5`,
exactly matching Expo's pin. The plugin declares `metro: ^0.84.3`, which `0.84.5`
satisfies, so this stays inside the declared contract. Lockfile: **19 packages
removed, 0 added**; outside the Metro family nothing moved.

**Evidence that the change is safe:** the full production build passes (Vite and
the Expo web export); and the old reader (`image-size@1.2.1`) and Metro's new one
return **identical dimensions on all 51 images** Metro sizes — the app's own
assets plus the `expo-router` and React Navigation library assets.

**Why `image-size@2.0.4` was not the fix.** It was published on 2026-09-14 and
patches both advisories, so the exception's stated premise — "no patched release"
— had stopped being true. But it cannot be dropped under `metro@0.84.4`: in the
ordinary non-zip case Metro calls `imageSize(filePath)` with a **path string**
(`Assets.js:174-177`), and 2.x's default export accepts only a buffer. Measured on
`apps/mobile/assets/icon.png`: `1.2.1` returns `1024x1024` for both a path and a
buffer; `2.0.4` returns `1024x1024` for a buffer and **throws** on the path. An
override to 2.x would have broken every image in every build. A patched release
existing is not the same as a patched release being adoptable.

**The 2026-09-02 re-review was wrong on one question, and the correction is the
point of keeping this entry.** It asked *"Does upgrading the dependent escape it?"*
and answered **No**, citing `metro@0.87.0`, then the latest — which did still
declare `image-size: ^1.0.2`. But `metro@0.84.5`, published **2026-08-19**, two
weeks before that review and one patch above the installed `0.84.4`, had already
dropped it. The review checked the newest release and not the patch line of the
installed minor. Its other two answers were accurate on the day: no patched
`image-size` existed until 2026-09-14, and `0.87.0` really did declare it.

To be exact about what was missed: on 2026-09-02 `0.84.5` was **published** but
**not yet in the tree** — the lockfile then held only `metro@0.84.4` and
`@expo/metro@56.0.0`. It arrived later, nested, when `@expo/metro` moved to
`56.0.2`. So the escape was one patch release away and inside the declared range,
not already installed.

**The generalisable rule: "no upgrade escapes it" must be checked against the
patch line of what is installed, not only against the latest release.** A newer
major or minor still carrying the dependency says nothing about whether a patch of
the current one dropped it.

### 4.6 `shell-quote` — command injection in `quote()` (GHSA-pqg4-j6r4-53mv) — CRITICAL (mobile tree)

Command injection via a line terminator in a token following a `{ comment }`
token. Affected `>= 1.8.4 < 1.11.0`; the mobile tree held `1.9.0` through
`react-devtools-core` (`^1.6.1`).

- Mobile tree: `overrides` entry → `^1.11.0`, resolving `1.12.0`.
- Web tree: not present.

**It was present and unreported between 2026-10-02 and 2026-10-08**, hidden
behind the expired-exception message described in §1.

### 4.7 `brace-expansion` — three further DoS advisories — HIGH (both trees)

`GHSA-q2hr-2g5m-vwhr` (`< 5.0.12`), `GHSA-qhr7-859c-m2p7` (`< 5.0.11`) and
`GHSA-6j4f-fj2g-mc7p` (`< 5.0.10`), all scoped to `>= 4.0.0`, published after
§4.2's fix to `5.0.9`.

- Web tree: patched to `5.0.12` inside `minimatch`'s `^5.0.5`; no override needed.
  It was checked first that the web tree carries a single 5.x copy, so nothing
  on 1.x or 2.x is forced up a major.
- Mobile tree: existing `overrides` entry raised `^5.0.9` → `^5.0.12`.

### 4.8 `source-map-js` — event-loop DoS via indexed source maps (GHSA-68fv-2mgg-jv7q) — HIGH (both trees)

Affected `>= 1.0.0 < 1.2.2`.

- Web tree: patched to `1.2.2` inside the `^1.2.1` its three dependents declare.
- Mobile tree: `overrides` entry → `^1.2.2`.

### 4.9 `undici` — two advisories at 7.29.0 — HIGH (web tree)

`GHSA-rfgv-xxqx-mfg5` (DoS via an unrequested WebSocket subprotocol) and
`GHSA-w293-vg96-wgc3` (TLS certificate validation bypass in `BalancedPool`), both
fixed in `7.29.1`. Still reached only through `jsdom`, a test dependency.

- Web tree: root `overrides` entry `^7.29.0` → `~7.29.1`. **Tilde on purpose:**
  `^7.29.1` resolves to `7.30.0`, a minor bump nobody needed. Tilde holds it to
  the patch.

## 5. Adding or extending an exception

Do not silence an advisory by lowering `--audit-level`, adding `--omit`, or
appending `|| true`. Any exception must record:

- package and exact advisory IDs;
- severity;
- why no acceptable released fix exists today;
- runtime/build-time reachability;
- a concrete condition that clears it;
- a short review/expiry date; and
- fail-closed CI logic narrow enough that a different advisory cannot inherit the
  exception accidentally.

An exception with no review date and no enforcement boundary is not an
exception; it is an unrecorded risk.
