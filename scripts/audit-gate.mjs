/**
 * Shared verdict logic for the two dependency audit gates, with exact, time-bounded HIGH exceptions.
 *
 * `scripts/audit-web-high.mjs` and `scripts/audit-mobile-high.mjs` each pass their own tree's exception
 * tables to `runAuditGate`, which runs `npm audit` and prints the result. The verdict itself is
 * `evaluateAudit`, which performs no I/O: every file it needs is read through a function it is given.
 * That is what lets `src/lib/auditGate.test.ts` feed it a mutated report and prove the gate still fails.
 *
 * WHY IT WAS EXTRACTED (2026-11-18). Until then the mobile gate held all of this logic and the web gate
 * held none: it failed on any high at all, with no exception mechanism, because it had never needed one.
 * GHSA-fc5q-39xc-vjpf (picomatch, no patched release) reached both trees at once. Copying two hundred
 * lines of boundary checks into the web gate would have left two copies to drift apart, and the web copy
 * would have been the less reviewed one. The logic below is the mobile gate's, moved without changing
 * a verdict; its history is in docs/DEPENDENCY_ADVISORIES.md §4.10, §4.11 and §4.15.
 *
 * npm audit v2 models a direct advisory in `via` and propagates its severity up the reverse dependency
 * graph in `effects`. Before accepting an exception, four independent boundaries are checked:
 *   1. every direct HIGH advisory object is one of the exact allowlisted GHSAs, on the package it was
 *      reviewed for;
 *   2. every bounded package has only its approved immediate parents, and no package on an approved
 *      path (except a declared root) is a direct dependency of the tree or imported by its source;
 *   3. every HIGH vulnerability record belongs to the union of the excepted packages' recursive
 *      `effects` closures;
 *   4. the precondition each exception rests on still holds (its proof exists and names it, plus any
 *      checks the tree adds).
 *
 * Any critical, another direct high advisory, a new immediate parent, any high record outside that
 * closure, malformed output, or expiry fails.
 *
 * EVERY DIRECT HIGH/CRITICAL ADVISORY IS ANNOTATED BEFORE ANY VERDICT. An earlier mobile gate checked
 * the expiry first and exited, and from 2026-10-02 to 2026-10-08 its one "exception expired" line
 * stood in front of five new advisories, including a CRITICAL, none of which it named.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { FORBIDDEN_LIBS } from './bundle-forbidden-libs.mjs';

function ghsaFromUrl(url) {
  const match = String(url ?? '').match(/GHSA-[0-9a-z-]+/i);
  return match?.[0] ?? null;
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** The import forms the source scan recognises: `from 'x'`, `require('x')`, `import('x')`, `import 'x'`. */
export function importPattern(pkg) {
  return new RegExp(
    `(?:\\bfrom\\s*|\\brequire\\s*\\(\\s*|\\bimport\\s*\\(\\s*|^\\s*import\\s+)['"\`]${escapeRe(pkg)}(?:/[^'"\`]*)?['"\`]`,
    'm',
  );
}

/**
 * @param {object} report  parsed `npm audit --json` output
 * @param {object} config
 * @param {string} config.tree                  'web' or 'mobile', used in messages
 * @param {string} config.expires               YYYY-MM-DD; applies only while `allowed` holds an entry
 * @param {Date}   [config.now]
 * @param {Map<string, {package: string, reason: string}>} config.allowed   GHSA -> reviewed package
 * @param {Map<string, string>} config.proofs   GHSA -> path of the test that proves its reachability
 * @param {Map<string, Set<string>>} config.bounds  package -> the only immediate parents it may have
 * @param {Set<string>} config.roots            packages on an approved path that are direct by design
 * @param {object} config.packageJson           the tree's own package.json
 * @param {string} config.sourceLabel           the source directory scanned for imports, for messages
 * @param {() => Array<{file: string, text: string}>} config.loadSources  may throw
 * @param {(path: string) => string | null} config.readFile  null when the file cannot be read
 * @param {Array<() => string | null>} [config.preconditions]  each returns a failure message or null
 * @returns {{ annotations: string[], failures: string[], log: string[], ok: boolean }}
 */
export function evaluateAudit(report, config) {
  const annotations = [];
  const failures = [];
  const log = [];
  const done = (ok) => ({ annotations, failures, log, ok });
  const fatal = (message) => {
    failures.push(message);
    return done(false);
  };

  const { tree, allowed, proofs, bounds, roots } = config;
  const now = config.now ?? new Date();

  if (!report || typeof report !== 'object' || !report.vulnerabilities || !report.metadata) {
    return fatal('npm audit JSON is missing expected vulnerabilities/metadata fields');
  }

  const vulnerabilities = report.vulnerabilities;
  const counts = report.metadata?.vulnerabilities ?? {};
  const critical = Number(counts.critical ?? 0);
  const high = Number(counts.high ?? 0);
  // An expiry with nothing listed is not a failure: with an empty list, any high already fails as
  // unapproved below, and an "exception expired" line on top of it would name an exception that does
  // not exist.
  const expired = allowed.size > 0 && new Date(`${config.expires}T23:59:59Z`) < now;
  const exceptedPackages = new Set([...allowed.values()].map((m) => m.package));

  if (critical === 0 && high === 0) {
    // Nothing to except. An expired date is irrelevant here, and saying so would only train readers to
    // ignore the message — but flag a stale allowlist so it gets retired rather than silently carried.
    log.push(`${tree} dependency audit: no high/critical vulnerabilities`);
    if (allowed.size > 0) {
      // A warning, not a failure: every advisory clearing is a good outcome and must not turn CI red.
      // But a plain log line is never read, and a stale allowlist would accept its packages again if
      // they returned before expiry.
      annotations.push(
        `::warning::the ${tree} audit exception list is now unused; retire it so a returning advisory is reviewed rather than silently accepted`,
      );
    }
    return done(true);
  }

  // --- Report first: annotate every direct high/critical advisory -------------------------------
  // Before any verdict, so nothing below can hide what is actually present.
  const direct = [];
  for (const [name, v] of Object.entries(vulnerabilities)) {
    for (const cause of Array.isArray(v?.via) ? v.via : []) {
      if (typeof cause !== 'object' || cause === null) continue;
      const severity = String(cause.severity ?? '').toLowerCase();
      if (!['high', 'critical'].includes(severity)) continue;
      direct.push({
        name,
        severity,
        ghsa: ghsaFromUrl(cause.url),
        source: cause.source,
        title: String(cause.title ?? 'security advisory'),
        range: String(cause.range ?? v.range ?? ''),
        url: String(cause.url ?? ''),
      });
    }
  }
  for (const a of direct) {
    const id = a.ghsa ?? a.source ?? 'unknown-advisory';
    const exception = a.ghsa ? allowed.get(a.ghsa) : null;
    // An excepted advisory is a WARNING, not an error: `::error` renders red on a PR even when the gate
    // passes, and a gate that is red on every green run teaches people to stop reading it.
    const excepted = Boolean(exception && exception.package === a.name && a.severity === 'high');
    const level = excepted ? 'warning' : 'error';
    const tag = excepted ? ' [excepted]' : '';
    const range = a.range ? ` affected ${a.range};` : '';
    const url = a.url ? ` ${a.url}` : '';
    annotations.push(
      `::${level} title=npm audit ${a.severity}${tag}: ${a.name} (${id})::${a.title};${range}${url}`,
    );
  }
  if (direct.length === 0) {
    return fatal(
      `${tree} dependency audit contains ${critical} critical and ${high} high record(s), but no direct advisory objects could be identified`,
    );
  }

  // --- Then verdicts ---------------------------------------------------------------------------
  if (critical > 0)
    failures.push(`${critical} CRITICAL vulnerability record(s); criticals are never excepted`);
  if (expired) {
    failures.push(
      `the ${tree} audit exception expired on ${config.expires}; re-review the advisories annotated above before extending it`,
    );
  }

  // Every package on an approved path — each bounded package AND every approved parent, except a
  // declared root — must stay out of the tree's own dependencies and its own source. The approved
  // parents are included on purpose: a bound proves the excepted code is reached only THROUGH its
  // parents, and proves nothing if the app depends on one of those parents directly (review on #416).
  const onApprovedPath = new Set(bounds.keys());
  for (const parents of bounds.values()) for (const parent of parents) onApprovedPath.add(parent);
  for (const pkg of exceptedPackages) onApprovedPath.add(pkg);
  for (const root of roots) onApprovedPath.delete(root);

  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const pkg of onApprovedPath) {
      if (config.packageJson?.[field]?.[pkg]) {
        failures.push(
          `${pkg} became a direct ${tree} ${field} entry; the exception assumes it is reached only through its approved parents`,
        );
      }
    }
  }

  // A package need not be DECLARED to be used: npm hoists transitive packages into node_modules, so
  // source can import one nobody listed. No package.json check sees that, so the tree's own source is
  // scanned. Fails closed if the source cannot be read, or if there is none.
  if (onApprovedPath.size > 0) {
    let sources;
    try {
      sources = config.loadSources();
    } catch {
      return fatal(
        `could not read ${config.sourceLabel} to check that no source imports a package on an approved path`,
      );
    }
    if (sources.length === 0) {
      // A scan over nothing would pass for ever. Fail rather than count it as evidence.
      return fatal(`found no source files under ${config.sourceLabel}; the import scan would prove nothing`);
    }
    const patterns = [...onApprovedPath].map((pkg) => [pkg, importPattern(pkg)]);
    const importers = [];
    for (const { file, text } of sources) {
      for (const [pkg, re] of patterns) if (re.test(text)) importers.push(`${file} imports ${pkg}`);
    }
    if (importers.length > 0) {
      failures.push(
        `source imports a package the exceptions assume is reached only through its approved parents: ${importers.join('; ')}`,
      );
    }
  }

  // Boundary 1 — exact advisory identity. A different HIGH on an excepted package must not inherit the
  // exception just because the package name matches.
  const observed = new Set();
  const unapproved = [];
  for (const a of direct) {
    if (a.severity === 'critical') continue; // already a failure above
    const exception = a.ghsa ? allowed.get(a.ghsa) : null;
    if (!exception || exception.package !== a.name) {
      unapproved.push(`${a.name}:${a.ghsa ?? a.source ?? 'unknown-advisory'}`);
      continue;
    }
    observed.add(a.ghsa);
  }
  if (unapproved.length > 0) failures.push(`unapproved direct high advisories: ${unapproved.join(', ')}`);

  // Boundary 2 — reachability. Every bounded package that is present must have only its approved
  // immediate parents. Generic intermediates are bounded as well as the excepted leaf: a bound that
  // stops at a general-purpose library proves nothing (#416).
  for (const [pkg, parents] of bounds) {
    const v = vulnerabilities[pkg];
    if (!v) continue; // not in the audit: nothing to bound
    if (exceptedPackages.has(pkg) && String(v.severity) !== 'high') {
      failures.push(`${pkg} audit record changed severity to ${v.severity}; re-review the exception`);
      continue;
    }
    const immediate = Array.isArray(v.effects) ? v.effects : [];
    if (immediate.length === 0) {
      failures.push(`${pkg} has no immediate reverse-dependency parents; cannot prove the approved ancestry`);
      continue;
    }
    const stray = immediate.filter((name) => !parents.has(name));
    if (stray.length > 0) {
      failures.push(`${pkg} is now reachable through an unapproved immediate parent: ${stray.join(', ')}`);
    }
  }

  // Collect the recursive effects closure of the EXCEPTED packages for boundary 3.
  const affected = new Set();
  for (const pkg of exceptedPackages) {
    if (!vulnerabilities[pkg]) continue;
    const queue = [pkg];
    affected.add(pkg);
    while (queue.length > 0) {
      const current = queue.shift();
      const node = vulnerabilities[current];
      if (!node || !Array.isArray(node.effects)) {
        failures.push(`audit effects graph is incomplete at ${current}`);
        break;
      }
      for (const parent of node.effects) {
        if (typeof parent !== 'string' || !parent) {
          failures.push(`malformed effects parent at ${current}`);
          continue;
        }
        if (!vulnerabilities[parent]) {
          failures.push(`effects graph references unknown package ${parent} from ${current}`);
          continue;
        }
        if (affected.has(parent)) continue;
        affected.add(parent);
        queue.push(parent);
      }
    }
  }

  // Boundary 3 — every HIGH record must be explained by an excepted package.
  const outside = Object.entries(vulnerabilities)
    .filter(([, v]) => String(v?.severity) === 'high')
    .map(([name]) => name)
    .filter((name) => !affected.has(name));
  if (outside.length > 0) {
    failures.push(
      `high records exist outside the excepted packages' dependency closure: ${outside.join(', ')}`,
    );
  }

  // A listed advisory that has disappeared is good news, but the list must then be shortened, or it
  // quietly grows into an unrecorded blanket allowance. UNCONDITIONAL, deliberately: guarding it on the
  // package still being present skipped exactly the case that matters (#416).
  for (const ghsa of allowed.keys()) {
    if (!observed.has(ghsa)) {
      const meta = allowed.get(ghsa);
      failures.push(
        `allowlisted advisory ${ghsa} (${meta.package}) is no longer present; remove it from the allowlist rather than carrying it`,
      );
    }
  }

  // Boundary 4 — the PRECONDITION an exception rests on, enforced here and not only in the document
  // (the node-forge lesson, §4.11). The proof must exist and still name the advisory.
  for (const ghsa of observed) {
    const proof = proofs.get(ghsa);
    if (!proof) {
      failures.push(`allowlisted advisory ${ghsa} has no reachability proof registered in PROOFS`);
      continue;
    }
    const text = config.readFile(proof);
    if (text === null) {
      failures.push(
        `the reachability proof for ${ghsa} (${proof}) could not be read; the exception rests on it`,
      );
      continue;
    }
    if (!text.includes(ghsa)) {
      failures.push(
        `the reachability proof ${proof} no longer names ${ghsa}; re-review docs/DEPENDENCY_ADVISORIES.md §3 before relying on the exception`,
      );
    }
  }
  if (observed.size > 0) {
    for (const check of config.preconditions ?? []) {
      const problem = check();
      if (problem) failures.push(problem);
    }
  }

  if (failures.length > 0) return done(false);

  log.push(`${tree} dependency audit: ${high} high record(s), all attributable to the reviewed advisories`);
  for (const [ghsa, meta] of allowed)
    log.push(`  accepted until ${config.expires}: ${meta.package} ${ghsa} — ${meta.reason}`);
  log.push('any critical, any other high advisory, or a reachability change still fails this gate');
  return done(true);
}

// --- I/O shell -------------------------------------------------------------------------------------

/** File text, or null when it cannot be read. */
export function readFileOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Every JS/TS file under `dir`, skipping node_modules and dot-directories. Files matching `exclude` are
 * left out. Throws if `dir` cannot be read, which `evaluateAudit` turns into a failure.
 */
export function sourceFiles(dir, exclude = null) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, exclude));
    else if (/\.(?:[cm]?[jt]sx?)$/.test(name) && !(exclude && exclude.test(name))) out.push(full);
  }
  return out;
}

/**
 * The precondition a BUILD-TIME exception rests on: the shipped-bundle scan still knows the library and
 * still runs inside `npm run build`, the command every deploy path uses (docs/DEPENDENCY_ADVISORIES.md,
 * "What the gate cannot see"). The graph checks above cannot tell build-time from runtime use; the scan
 * of the built bundle can, so the exception must not outlive it.
 */
export function bundleScanCovers(lib, rootPackageJson) {
  return () => {
    const signatures = FORBIDDEN_LIBS[lib];
    if (!Array.isArray(signatures) || signatures.length === 0) {
      return `scripts/bundle-forbidden-libs.mjs no longer recognises ${lib}; the exception assumes a build that ships it fails`;
    }
    const build = String(rootPackageJson?.scripts?.build ?? '');
    if (!build.includes('node scripts/bundle-forbidden-libs.mjs dist')) {
      return `npm run build no longer runs scripts/bundle-forbidden-libs.mjs on dist; the ${lib} exception rests on that scan`;
    }
    return null;
  };
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

/** Run `npm audit` with `npmArgs`, evaluate it with `config`, print, and exit. */
export function runAuditGate(npmArgs, config) {
  const run = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (run.error) fail(`npm audit could not run: ${run.error.message}`);

  let report;
  try {
    report = JSON.parse(run.stdout || '{}');
  } catch {
    fail('npm audit did not return valid JSON');
  }
  if (!report || typeof report !== 'object' || !report.vulnerabilities || !report.metadata) {
    const stderr = String(run.stderr || '').trim();
    fail(`npm audit JSON is missing expected vulnerabilities/metadata fields${stderr ? `: ${stderr}` : ''}`);
  }

  const result = evaluateAudit(report, config);
  for (const line of result.annotations) console.error(line);
  for (const line of result.log) console.log(line);
  if (!result.ok) {
    for (const f of result.failures) console.error(`::error::${f}`);
    process.exit(1);
  }
}
