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
It permits only the exact, time-bounded HIGH exceptions recorded in §3.2; any
critical advisory, any other direct high advisory, any high record outside the
approved dependency closure, malformed audit output, or an expired exception
still fails CI.

The gate is set at **high**, not at moderate. That threshold is a deliberate
trade-off: the mobile tree carries a block of moderate advisories from upstream
Expo packages that have no non-breaking fix (§3.1). Gating at moderate would
fail every PR on something this repository cannot fix, and a gate that is always
red is a gate everybody learns to ignore.

As of **2026-08-10**, the web tree is clean at high/critical. The mobile tree has
two reviewed direct HIGH advisories in `image-size`; npm propagates those two
advisories to 15 high dependency records. They are the only current high-level
exception and are bounded by §3.2 and by the CI script itself.

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

### 3.2 `image-size` — two infinite-loop DoS advisories — HIGH (mobile build toolchain)

| Field | Value |
| --- | --- |
| **Package** | `image-size` |
| **Advisories** | `GHSA-w3rx-r6r6-pgpr` / CVE-2025-71330; `GHSA-5p2g-fcmc-qvqq` / CVE-2025-71329 |
| **Severity** | High |
| **Affected according to GitHub Advisory Database** | `<= 2.0.2` |
| **Patched release as of review** | None (`first_patched_version: null` for both reviewed advisories) |
| **Reachability in SMA** | Transitive Node build tooling through Metro/Expo; not executable code shipped in the customer application bundle |
| **Reviewed** | 2026-08-10 |
| **Exception expires** | **2026-09-10** |
| **Clear when** | A patched `image-size`/Expo/Metro dependency path is released and can be adopted without an unsafe SDK regression |

Both advisories describe crafted image buffers that can make `image-size` enter
an infinite loop and block the Node.js event loop. npm propagates that HIGH
severity through Metro, Expo, React Native and their reverse dependents, which is
why `npm audit` reports 15 high vulnerability records even though the direct
HIGH advisory objects are these two `image-size` findings.

This is **not** a blanket audit bypass. `scripts/audit-mobile-high.mjs` validates
that the only direct HIGH advisory objects are exactly these two GHSAs on
`image-size`, then proves every other HIGH record belongs to `image-size`'s
recursive npm `effects` closure. Any critical advisory, another direct high
advisory, another high dependency path, an unexpected audit shape, or expiry on
2026-09-10 fails the gate.

`npm audit fix --force` is not accepted as the remedy here because the current
suggestion changes the Expo SDK/toolchain line rather than applying a released
`image-size` patch. Re-review immediately when the upstream advisory gains a
patched version; do not extend the expiry merely to make CI green.

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
