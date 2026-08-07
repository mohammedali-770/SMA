# Dependency advisories — gate, standing exceptions, and how to clear them

> Owned by `.github/workflows/production-gates.yml` (job: **Dependency audit**).
> This file is the only sanctioned place to record an advisory that is knowingly
> left unfixed. If an advisory is not listed here, CI failing on it is correct
> and the fix — not an edit to this file — is the answer.

---

## 1. What the gate enforces

Both trees are audited on every PR into the default branch:

```bash
npm audit --audit-level=high                 # web / admin console
npm --prefix apps/mobile audit --audit-level=high
```

The gate is set at **high**, not at moderate. That threshold is a deliberate
trade-off, not laziness: the mobile tree carries a block of moderate advisories
from upstream Expo packages that have no non-breaking fix (§3). Gating at
moderate would fail every PR on something this repository cannot fix, and a gate
that is always red is a gate everybody learns to ignore.

**Both trees are currently clean at `high`** — re-verified 2026-08-05, after the
`undici` fix in §4.3. Any high/critical advisory that appears from now on is
new, and CI will block it.

## 2. Why `npm audit fix` is not the default remedy here

On the mobile tree, plain `npm audit fix` re-resolves roughly **95 packages** —
the entire `@expo/*` CLI toolchain, `@react-native/*` codegen, and the Sentry
CLI and its per-platform binaries — for a two-package security patch. On an app
that is heading for App Store and Play review, that is a large, mostly untested
change surface whose failure mode (a broken EAS build) shows up late.

Prefer, in order:

1. **A targeted `overrides` entry** in the affected `package.json`, when the
   vulnerable package appears once in the tree and the fix stays within the same
   major. This is what the resolved entries in §4 do.
2. **A real dependency upgrade**, when the direct dependency has a fixed
   release — with the app built and smoke-tested afterwards.
3. **`npm audit fix`**, only when the resulting lockfile diff is small enough to
   read, or when an SDK upgrade was going to happen anyway.

Always inspect the diff before committing:

```bash
git diff --stat apps/mobile/package-lock.json
```

## 3. Standing exceptions

### 3.1 Upstream Expo — 12 moderate advisories (mobile tree)

| Field | Value |
| --- | --- |
| **Packages** | `@expo/config`, `@expo/config-plugins`, `@expo/prebuild-config`, `expo-splash-screen` and their transitive dependents |
| **Severity** | Moderate (0 high, 0 critical) |
| **Status** | Accepted — no non-breaking fix available |
| **First recorded** | PR #80 (Sentry mobile crash reporting) |
| **Reviewed** | 2026-08-03 |
| **Next review** | On the next Expo SDK upgrade, or 2026-11-03, whichever comes first |

These are **build-time** packages: the Expo config/prebuild toolchain runs on a
developer machine or an EAS builder, not on a customer's phone. They are not
reachable from the shipped app bundle. `npm audit fix --force` resolves them only
by moving off the pinned Expo SDK 57 line, which is a deliberate, separately
planned upgrade — not a security patch.

**To clear:** upgrade the Expo SDK. Re-run the audit afterwards and delete this
section if the count reaches zero.

## 4. Resolved

### 4.1 `postcss` — path traversal (GHSA-r28c-9q8g-f849) — HIGH

Arbitrary `.map` file disclosure via `sourceMappingURL` auto-loading.
Present in **both** trees at 8.5.16, transitively (Tailwind/Vite in the web tree,
the Metro/Expo web pipeline in the mobile tree).

- Web tree: `npm audit fix --package-lock-only` → 8.5.25 (patch, 11-line diff).
- Mobile tree: `overrides` entry in `apps/mobile/package.json` → `^8.5.25`.

### 4.2 `brace-expansion` — DoS via unbounded expansion (GHSA-mh99-v99m-4gvg) — HIGH

Out-of-memory process crash on a maliciously crafted brace pattern. Present in
both trees at 5.0.7, transitively.

- Web tree: `npm audit fix --package-lock-only` → 5.0.9.
- Mobile tree: `overrides` entry → `^5.0.9`.

Both packages appeared exactly once in each tree and both bumps stay within the
same major, so no dependent's API expectations changed.

### 4.3 `undici` — five advisories at 7.28.0 — HIGH (web tree)

Response desynchronization via the retry interceptor (GHSA-8xcm-r25x-g524),
cross-user information disclosure and a parse-time crash via degenerate private
cache directives (GHSA-4cwx-7wf7-3272), CRLF injection via a blob-like body
`type` (GHSA-m8rv-5g2x-5cg5), cross-user disclosure via whitespace around equals
in `Cache-Control` (GHSA-jr45-8vmc-qm54), and cookie-attribute injection
(GHSA-v3r7-h72x-cjcm).

**This is the first advisory the gate from PR #147 caught on its own.** It did
not exist when that gate was written; it appeared in the advisory feed
afterwards and blocked the next PR, which is precisely the behaviour §1
promises.

- Web tree: `overrides` entry in the root `package.json` → `^7.29.0`.
- Mobile tree: not present.

Reachability: `undici` enters this tree **once**, via `jsdom`, which is a
`devDependency` used only for the vitest jsdom environment. It is never bundled
and never reaches a customer — so the practical exposure was test tooling, not
production. It was still fixed rather than excepted: the bump stays inside major
7 (7.28.0 → 7.29.0), the lockfile diff is three lines, and `npm ci`, `npm run
lint` and the full 1628-test suite all pass on it. An exception would have cost
more to justify than the fix cost to apply.

### 4.4 `js-yaml` — quadratic CPU consumption in `!!omap` (GHSA-5p4m-2wfm-xmqj) — HIGH (mobile tree)

CVE-2026-59870. A crafted `!!omap` node makes resolution quadratic in the number
of keys, so a small document costs a large amount of CPU — CWE-407, CVSS 7.5.
The fix was not backported below 4.3.1.

**The second advisory the PR #147 gate has caught on its own**, and like §4.3 it
appeared in the feed after the gate was written and blocked the next PR. It was
published while PR #167 was waiting on GitHub Actions billing, so the same
commit that passed the audit on 2026-08-06 failed it on 2026-08-07 without a
single line of its own changing.

- Mobile tree: `overrides` entry in `apps/mobile/package.json` → `^4.3.1`.
- Web tree: not present.

Reachability: `js-yaml` enters this tree **once**, via
`expo → @expo/cli → @expo/xcpretty`. `@expo/xcpretty` formats Xcode build logs,
so it runs on a macOS build host, parses output this project produces itself,
and is never bundled into the app. The practical exposure was a build machine
spending CPU on its own build output, not a customer-facing path.

Fixed rather than excepted, on the same reasoning as §4.3: `4.3.1` sits inside
`@expo/xcpretty`'s own declared `^4.1.0` range, so nothing's API expectations
change; the lockfile diff is three lines; and `npm ci`, both typechecks, the
full 1697-test suite and the production build all pass on it. `npm audit fix`
was again avoided — it re-resolves most of the Expo toolchain (§2).

## 5. Adding an exception

Do not silence an advisory by lowering `--audit-level`, adding `--omit`, or
appending `|| true` to the audit step. Instead add a subsection under §3 with:

- the package, advisory ID and severity;
- **why** there is no acceptable fix today (not merely that one is inconvenient);
- whether the code is reachable at runtime on a customer device or server, or is
  build-time only;
- a concrete condition that clears it, and a review date.

An exception with no review date is not an exception, it is an unrecorded risk.
