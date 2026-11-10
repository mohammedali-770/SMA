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
It permits only exact, time-bounded HIGH exceptions recorded in §3, and only
while each one's evidence still holds. **There are none today**; §4.15 records the
last. Any critical advisory, any other direct high advisory, any high record
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

As of **2026-11-10**, both trees are clean at high/critical, and **the mobile
gate holds no exception at all**. The last one, `decode-uri-component`, left with
the Expo SDK 58 upgrade, which removed `query-string` from `expo-router`
(§4.15). What remains are moderates, which the gate does not block (§3.1).

*Superseded 2026-11-10:* as of 2026-11-09 the mobile tree had one reviewed direct
HIGH advisory, `decode-uri-component`, propagating to 3 high records
(`decode-uri-component`, `query-string`, `expo-router`). It was the first
exception here that **shipped**. It was accepted because the vulnerable function
was proven never to be called, not because the code never reached a phone.

**On 2026-11-09 both gates were red, and every PR and every gated Vercel deploy
with them.** The `braces`/`node-forge` exception expired on 2026-11-07 with five
new `node-forge` highs, a `zod` high and a `decode-uri-component` high behind it,
and the web tree had picked up `undici` and `vite` highs. The fixes are §4.10–
§4.14; the gate annotated every one of them before refusing, which is the
2026-10-08 change paying for itself.

*Superseded, kept because the count is the point:* as of 2026-10-08 the mobile
tree carried two build-tool exceptions (`braces`, `node-forge`) propagating to
20 high records; as of 2026-09-02, two `image-size` advisories propagating to 15.

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
| **Packages** | `glob` (GHSA-3g3m-2fjr-6pw4) and `minimatch` (GHSA-g3hv-75wg-m249). They are reached through `@expo/cli` and `@expo/fingerprint`, propagating to `expo`, and since the SDK 58 upgrade also through `@sentry/bundler-plugins` under `@sentry/react-native` 8.28. That is **7 moderate records, measured 2026-11-10**. `decode-uri-component`'s older moderate, GHSA-vcc3-ghjq-m6fr, left with §4.15 |
| **Severity** | Moderate |
| **Status** | Accepted. There is no fix on the SDK 58 line either: `npm audit` offers only semver-major moves, which here are **downgrades** (`expo` 53.0.11, `@sentry/react-native` 8.20.0), not fixes |
| **Reviewed** | 2026-11-10, on the SDK 58 upgrade (previously 2026-11-09 and 2026-08-03, for a different set: `@expo/config`, `@expo/config-plugins`, `@expo/prebuild-config`, `expo-splash-screen`, which the Expo 57.0.32 patch line no longer reports) |
| **Next review** | On the next Expo SDK upgrade, or 2027-03-31, whichever comes first |

`@expo/fingerprint` hashes the native project to decide whether a build needs
a fresh native binary. It runs on a developer machine or EAS builder, not on a
customer's phone, and its glob patterns come from the project's own files.
**The 2026-11-03 review date was missed by six days** — nothing runs the moderate
review on a schedule, which Workstream S5 of the 2026-11-09 compliance plan adds
for the high gate and should be read as covering this table too.

**To clear:** upgrade the Expo SDK deliberately, rebuild all targets, re-run the
audit, and remove this exception when the advisories disappear.

### What the gate cannot see — stated rather than implied

> **Read with the date in mind.** This section was written for the build-tool
> exceptions retired on 2026-11-09 (§4.10, §4.11). Its argument — the dependency
> graph cannot tell build-time from runtime use, so only the built bundle can
> answer "does this ship?" — still holds, and the bundle scan it describes is
> **kept**: `braces`, `micromatch` and `node-forge` are build-tool libraries that
> must never reach a customer, excepted or not, and `node-forge` alone took six
> HIGH advisories in a year. The exception retired on 2026-11-10 (§4.15) was the
> opposite case: a library that shipped on purpose, bounded by a reachability
> proof instead of by the scan.

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
- **Not guaranteed by the audit gate:** that a *new* third-party dependency does
  not pull `node-forge` or `braces` into the customer bundle through a CLI library
  it depends on. Adding such a dependency is a deliberate act the graph cannot
  distinguish from today's legitimate edges.

**The question that actually matters — does this code reach a customer? — is a
property of the built bundle, not the graph, and since 2026-10-09 it is checked
there, inside the build itself.** `npm run build` ends with
`node scripts/bundle-forbidden-libs.mjs dist`, which fails if code from
`node-forge`, `micromatch` or `braces` is in any JavaScript it just emitted — the
admin console and the Expo web export alike. The owner accepted merging #416
with the gap open on the condition that this follow-up close it.

**It lives in the build script, not in a CI step, because a CI step would have
checked the wrong artifact.** The first version of this check was a separate step
in the Production build job, scanning CI's own temporary `dist`. But production is
not deployed from that `dist`: it is rebuilt by Vercel's Git integration, or by
`vercel build --prod` in the gated deploy job, with production environment
settings — so the bundle customers receive was never the one scanned. Review
caught that on #417. `npm run build` is Vercel's `buildCommand` (`vercel.json`),
which makes it the build in all three places one happens: the CI build job,
Vercel's Git deploys and the gated deploy. A failing scan fails that build, so a
deploy that would ship one of these libraries does not happen and the previous
deploy keeps serving.

**How it recognises a library.** Minifiers rename identifiers but keep string
literals, so each library is identified by error messages from its *own* source.
Every signature was proven three ways before it was trusted: it survives
minification (present in a real minified bundle of its library), it is absent
from what this project ships, and it is distinctive. Generic phrases were rejected
on purpose — `"Expected a string"` is said by both `braces` and `micromatch` and
by libraries that are neither, and matching it would turn CI red for nothing.

**Signatures are chosen per vulnerable module, not per package — the first
version chose them per package and missed one.** Neither `braces` nor
`node-forge` has an `exports` map, so a dependency can import a single module by
its subpath and bundle nothing else from the library. `braces/lib/compile` — the
advisory's named sink — imported alone matched **nothing**: the only `braces`
signature lived in `lib/expand.js`. Review caught that on #417. Each vulnerable
module was then bundled alone and its closure read from esbuild's metafile, and
each is now recognised by a literal from **its own source**:

| imported alone | modules in its closure | signatures that match |
| --- | --- | --- |
| `braces/lib/compile` | `compile`, `utils`, `fill-range` | `compile`'s own `'node.isClose'` |
| `braces/lib/expand` | `expand`, `utils`, `stringify`, `fill-range` | `expand`'s `rangeLimit` message |
| `braces/lib/parse` | `parse`, `utils`, `stringify`, `constants` | `parse`'s `), exceeds max characters (` |
| `node-forge/lib/rsa` | 17 modules, including `asn1`, `random`, `aes`, `cipherModes` | `rsa`'s own `RSASSA-PKCS1-v1_5` message, `asn1`'s, and `cipherModes`' |

**`compile`'s only literal is a debug line upstream left in** —
`console.log('node.isClose', …)`. It survives minification, but in whichever
quote style the minifier picks (Metro keeps single quotes, esbuild emits double),
so it is matched as a *whole string literal*, quotes included: bare,
`node.isClose` is ordinary code in `xmlbuilder` and `plist`. Proven against
Metro's real output by planting `require("braces/lib/compile")` in the app and
building: the scan names the shipped entry file on `'node.isClose'`.

**Nothing in the table may come from a library that is not itself excepted —
and the first fix broke that rule.** It recognised `compile` by `fill-range`'s
`Invalid range arguments: `, since `compile` always loads it. But `fill-range` is
a separate package with no advisory, so an app using it *without* `braces` would
have failed the build as though `braces` had shipped. Review caught that on #417
too; the suite now bundles `fill-range` alone and requires **no** finding.

Distinctiveness was measured over all 19 284 installed JavaScript files in both trees: each `braces`
signature occurs in exactly six — the library's own module, and five build/dev
tools that **vendor a full copy of `braces`**: `vite`, two `rollup` bundles,
`prettier`, and `resolve-workspace-root` (under `@expo/config`). No unrelated
library says any of them, so a match always means `braces`' code. Those vendored
copies are a gap the audit gate cannot see at all — npm audits declared packages,
not code inlined into another package — and the bundle check catches them if one
ever ships. `micromatch`'s signature occurs only in `micromatch` and the two of
those tools that vendor it too (`prettier`, `resolve-workspace-root`); each
`node-forge` signature only in `node-forge`'s own module and its two prebuilt
`dist` bundles. `rsa` is caught three times over because it loads `random → aes →
cipherModes`; that is why removing both its own and `asn1`'s signature still
passed under mutation, and it was traced to that closure rather than assumed.
The suite bundles each of these four modules alone on every run and requires it
to be recognised; restoring the original single `braces` signature fails it on
`compile` and `parse`.

**A signature that stops matching does not fail anything — the check would just
pass for ever.** So `src/lib/bundleForbiddenLibs.test.ts` re-bundles each library
minified on every run and requires each signature to survive, *individually*:
mutation testing showed that rewording one of a library's messages is caught only
by the per-signature assertion, because the library-level check still passes on
the others. A dead signature beside a live one would silently shrink what is
caught. The same suite proves the scan fails closed on a missing or empty build
rather than passing on nothing.

**What the bundle check does not see.** It scans what `npm run build` emits.
Native iOS and Android JavaScript is built by EAS, not by that script; the web export comes from the same
source and Metro configuration and is a strong proxy, but a library imported only
from a platform-specific file (`*.native.ts`, `*.ios.ts`, `*.android.ts`) would
not appear in it. And `compile` on its own is recognised only through a
`console.log` call, so a build that strips console calls (`drop_console`,
`babel-plugin-transform-remove-console` — neither configured today) would
silently lose that one module; `parse` and `expand` would still be caught. That
is narrower than the gap it replaces, and the **2026-11-07 expiry** still forces
this review within a month.

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

### 4.10 `braces` — stack-exhaustion DoS (GHSA-vfj7-8cjw-p6xm) — HIGH — RETIRED 2026-11-09

**Retired because npm's advisory database no longer reports it for `braces`
3.0.3** — measured 2026-11-09 against the registry's bulk advisory endpoint,
which is what `npm audit` reads. Whether it was withdrawn or re-scoped could not
be read from here (the GitHub advisory API is outside this session's scope). The
gate's stale-entry check is what surfaced it: the entry was removed rather than
carried. The original review follows unchanged.


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

### 4.11 `node-forge` — PKCS#1 v1.5 signature verification (GHSA-86w9-cpqp-85rv) — HIGH — RETIRED 2026-11-09

**Fixed by `node-forge` 1.4.3** (published 2026-11-04), which both dependents
accept (`@expo/cli` and `@expo/code-signing-certificates` require `^1.3.3`). It
arrived as part of the Expo 57.0.32 patch bump (§4.12). 1.4.3 also fixes five
further HIGH advisories that appeared after the exception was granted —
GHSA-7wch-p9px-956x (PEM ReDoS), GHSA-jc66-7q78-782g (PKCS#12 MAC forgery),
GHSA-8hrf-8g6f-7xwp and GHSA-hqq3-7jhf-c5jx (TLS DoS), GHSA-5x38-2vff-x55p
(X.509 basicConstraints bypass). The exception expired on 2026-11-07 with all
five unreviewed, and the gate refused them, as designed. The code-signing
precondition and the bundle-scan entry are kept as history and as a guard
respectively. The original review follows unchanged.


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

### How the retired build-tool exceptions were bounded (history)

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

### 4.12 `zod` — memory exhaustion validating oversized collections (GHSA-mrhx-c7xc-m3w5) — HIGH (mobile tree) — RESOLVED 2026-11-09

Reached only through `@expo/cli` (`^3.25.76`); there is no fixed 3.x release.
Cleared **without an exception** by bumping `expo` `~57.0.24` → `~57.0.32`, which
requires `@expo/cli ^57.0.33` — a release that drops `zod` entirely. The same
bump brought `node-forge` 1.4.3 (§4.11) and ~50 patch-level Expo toolchain and
runtime updates; `npx expo install --fix` then aligned `expo-linking`,
`expo-location`, `expo-notifications`, `expo-router` and `expo-splash-screen` to
the versions Expo 57.0.32 expects. Runtime packages moved (e.g.
`expo-modules-core` 57.0.18 → 57.0.25), so the next EAS build carries them and
needs the device regression in `RELEASE_CHECKLIST.md` §7.

### 4.13 `undici` — four advisories at 7.29.1 — HIGH (web tree) — RESOLVED 2026-11-09

GHSA-xjj6-f33q-929c, GHSA-4w7w-5xrc-9h26, GHSA-2m5v-pch6-74hx and
GHSA-qrxm-fqhp-jwvm, all fixed in 7.30.1. The root override moved `~7.29.1` →
`~7.30.2`, inside jsdom's `^7.25.0`. Dev/test dependency only.

### 4.14 `vite` — `launch-editor` existence check bypass on Windows (GHSA-587h-7wmj-h5pm) — HIGH (web tree) — RESOLVED 2026-11-09

Affected `<= 6.4.3`; the range floor moved `^6.2.3` → `^6.4.5`, so a lockfile
regeneration cannot fall back to a vulnerable 6.x. Build tool only.

### 4.15 `decode-uri-component` — quadratic DoS (GHSA-qr28-fpjm-wq7f) — HIGH (SHIPPED, function-unreachable) — RETIRED 2026-11-10

**Retired 2026-11-10 by the Expo SDK 58 upgrade, the fix this exception was
waiting for.** `expo-router` dropped `query-string` in 58.0.13
(expo/expo#50725, "Replace query-string with URLSearchParams"); SDK 58 pins
`~58.0.30`. Measured after the upgrade:

- `npm ls query-string decode-uri-component` in `apps/mobile` is empty.
- The mobile gate reports no high or critical, and its exception tables are
  empty. The expiry now applies only while an entry exists.
- **The empty gate was mutation-tested.** Re-adding `decode-uri-component@0.2.2`
  made it fail (exit 1); removing it again made it pass (exit 0).
- The proof test, `src/lib/decodeUriComponentReachability.test.ts`, was deleted
  with it, because it proved something about code that is no longer installed.

The original review follows unchanged.


| Field | Value |
| --- | --- |
| **Package** | `decode-uri-component` 0.2.2 |
| **Advisory** | `GHSA-qr28-fpjm-wq7f` |
| **Severity** | High |
| **Affected** | `<= 0.5.0` |
| **Patched release** | `0.5.1` — **ESM-only** (`"type": "module"`), so it cannot replace the CommonJS `require()` in `query-string` 7 |
| **Reachability in SMA** | `decode-uri-component` ← `query-string` 7.1.3 ← `expo-router` 57.0.30 — **ships in the customer app** |
| **Why it is accepted anyway** | The vulnerable function is never **called**. Proven by `src/lib/decodeUriComponentReachability.test.ts` against the installed tree on every run — see below |
| **Reviewed** | 2026-11-09 |
| **Exception expires** | **2026-12-31** |
| **Clear when** | The Expo SDK 58 upgrade lands: `expo-router` 58 no longer depends on `query-string` (measured: `expo-router@58.0.30` has no `query-string` dependency) |

**This is a different kind of exception from every one before it, and the
difference is the argument.** The build-tool exceptions it replaces (§4.10,
§4.11) rested on *the code never ships*. This one ships, so that argument is not
available. What is proven instead is narrower: **nothing calls a decoding
function**. That is a weaker guarantee, which is why the expiry is seven weeks
and tied to the upgrade that deletes the package.

**An override was considered and rejected, because it would break the app
instead of fixing it.** `0.5.1` exports `export default function`; `query-string`
7 does `const decodeComponent = require('decode-uri-component')` and calls it.
Metro would bundle that without complaint, but `require()` of a transformed ES
module returns `{ default: fn }`, so the first call would throw a TypeError —
at runtime, on a customer's phone. No `expo-router` 57.x patch drops
`query-string`; every one through 57.0.30 keeps it.

**What the proof checks, against the installed tree, on every run:**

1. `query-string` is 7.1.3 and `decode-uri-component` 0.2.2 — the versions the
   rest was derived from. In 7.1.3 the entry points that reach `decode()` are
   `parse`, `parseUrl`, `stringifyUrl` (it calls `parse`), `pick` and `exclude`;
   `stringify` and `extract` never decode.
2. Exactly four `expo-router` build files import `query-string`, and of all
   their calls on it, **exactly one decodes**: `queryString.parse()` in the
   *vendored* `react-navigation/core/getStateFromPath.js`.
3. That vendored parser is only ever a **default parameter**
   (`linking?.getStateFromPath ?? core.getStateFromPath`). `expo-router`'s
   linking config always supplies its own, which delegates to its fork
   (`fork/getStateFromPath.js`); the fork imports no `query-string` (its own copy
   of the parse is commented out) and never calls the vendored default; and
   nothing in `expo-router` calls the vendored default directly.
4. Nothing else in the installed mobile tree, and nothing in `apps/mobile/src`,
   imports `query-string` or `decode-uri-component` — with a known positive
   (`query-string`'s own `index.js`) asserted first, so a clean result cannot
   mean a blind pattern.

When the proof cannot run in CI (the mobile tree missing), it **fails** rather
than skipping; it skips only on a developer machine without `apps/mobile`
installed. Even on the path it rules out, the impact would be a slow parse of an
attacker-crafted deep link on the customer's own device — a self-inflicted
freeze, not data exposure.

#### How it was bounded (history)

`scripts/audit-mobile-high.mjs` accepts only `GHSA-qr28-fpjm-wq7f` on
`decode-uri-component`, and bounds the whole chain: `decode-uri-component` may
have only `query-string` as its parent, and **`query-string` may have only
`expo-router`** — `query-string` is a general-purpose library, and a second
consumer would call `parse()` with nobody having checked (the same lesson as
#416, where bounding `braces` only at `micromatch` proved nothing).

`expo-router` is declared as the chain's **runtime root**: the one package on an
approved path that is allowed to be a direct dependency, because it is the app's
router. Nothing else on the path may be declared or imported by app source.

**The proof is the precondition, and the gate enforces it** (boundary 4): it
fails if `src/lib/decodeUriComponentReachability.test.ts` is missing or stops
naming the advisory, so the exception cannot outlive its evidence. The retired
`node-forge` exception taught that a precondition living only in this document
is not a precondition (§4.11).

**Mutation-tested, every mutant's precondition confirmed before its verdict was
counted.** Proof (planted into the installed `expo-router` build, then restored
byte-for-byte):

| mutant | result |
| --- | --- |
| a fork file gains a `queryString.parse()` call | killed |
| a fifth `expo-router` file starts importing `query-string` | killed |
| the linking config stops supplying its own `getStateFromPath` | killed |
| app source imports `query-string` | killed |
| another installed package requires `decode-uri-component` | killed |
| the fork delegates to the vendored default parser | killed |

Gate:

| mutant | result |
| --- | --- |
| the proof file deleted | killed |
| the proof no longer names the advisory | killed |
| `query-string` declared as a direct dependency | killed |
| the exception date in the past | killed |

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
