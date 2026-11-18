import { describe, expect, it } from 'vitest';

import { evaluateAudit } from '../../scripts/audit-gate.mjs';

/*
 * scripts/audit-gate.mjs decides both dependency audit gates. A gate that passes is only evidence if
 * it can still fail, so this suite starts from the web tree's real audit shape on 2026-11-18 —
 * GHSA-fc5q-39xc-vjpf on picomatch, excepted, reaching vite and vitest — and mutates one thing at a
 * time. Every mutant must fail, and must fail for the reason it was built to provoke.
 */

const GHSA = 'GHSA-fc5q-39xc-vjpf';

type Via = string | { source: number; url: string; title: string; severity: string; range: string };
type Vuln = { severity: string; via: Via[]; effects: string[] };

function advisory(ghsa: string, severity = 'high', source = 1247710): Via {
  return {
    source,
    url: `https://github.com/advisories/${ghsa}`,
    title: `advisory ${ghsa}`,
    severity,
    range: '<=4.0.7',
  };
}

/** The web tree's high records exactly as `npm audit --json` reported them on 2026-11-18. */
function webReport(): {
  metadata: { vulnerabilities: Record<string, number> };
  vulnerabilities: Record<string, Vuln>;
} {
  return {
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 4, high: 5, critical: 0, total: 9 } },
    vulnerabilities: {
      picomatch: {
        severity: 'high',
        via: [advisory(GHSA)],
        effects: ['fdir', 'tinyglobby', 'vite', 'vitest'],
      },
      fdir: { severity: 'high', via: ['picomatch'], effects: ['vite'] },
      tinyglobby: { severity: 'high', via: ['fdir', 'picomatch'], effects: ['vitest'] },
      vite: { severity: 'high', via: ['fdir', 'picomatch', 'tinyglobby'], effects: [] },
      vitest: { severity: 'high', via: ['picomatch', 'tinyglobby'], effects: [] },
      // A moderate the gate does not block (docs/DEPENDENCY_ADVISORIES.md §3.2).
      glob: {
        severity: 'moderate',
        via: [advisory('GHSA-3g3m-2fjr-6pw4', 'moderate', 1244013)],
        effects: [],
      },
    },
  };
}

const PROOF = 'src/lib/picomatchReachability.test.ts';

function webConfig(overrides: Record<string, unknown> = {}) {
  return {
    tree: 'web',
    expires: '2027-01-31',
    now: new Date('2026-11-18T12:00:00Z'),
    allowed: new Map([[GHSA, { package: 'picomatch', reason: 'build/test-time only' }]]),
    proofs: new Map([[GHSA, PROOF]]),
    bounds: new Map([
      ['picomatch', new Set(['fdir', 'tinyglobby', 'vite', 'vitest'])],
      ['fdir', new Set(['tinyglobby', 'vite'])],
      ['tinyglobby', new Set(['vite', 'vitest'])],
    ]),
    roots: new Set(['vite', 'vitest']),
    packageJson: { dependencies: { react: '^19' }, devDependencies: { vite: '^6.4.5', vitest: '^4.1.12' } },
    sourceLabel: 'src',
    loadSources: () => [{ file: 'src/main.tsx', text: `import React from 'react';` }],
    readFile: (path: string) => (path === PROOF ? `// proof for ${GHSA}` : null),
    preconditions: [() => null],
    ...overrides,
  };
}

function failuresOf(result: { ok: boolean; failures: string[] }) {
  expect(result.ok, 'the mutant passed the gate').toBe(false);
  return result.failures.join('\n');
}

describe('audit gate — the real 2026-11-18 web shape', () => {
  it('passes, annotating the excepted advisory as a warning', () => {
    const result = evaluateAudit(webReport(), webConfig());
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0]).toMatch(
      /^::warning title=npm audit high \[excepted\]: picomatch \(GHSA-fc5q-39xc-vjpf\)/,
    );
    expect(result.log.join('\n')).toContain('accepted until 2027-01-31: picomatch GHSA-fc5q-39xc-vjpf');
  });

  it('fails the same report with an empty allowlist, as the gate did before the exception', () => {
    const result = evaluateAudit(webReport(), webConfig({ allowed: new Map(), proofs: new Map() }));
    expect(failuresOf(result)).toContain(`unapproved direct high advisories: picomatch:${GHSA}`);
    expect(result.annotations[0]).toMatch(/^::error /);
  });
});

describe('audit gate — every other new high still fails', () => {
  it('a new high advisory on an unrelated package', () => {
    const report = webReport();
    report.vulnerabilities.lodash = {
      severity: 'high',
      via: [advisory('GHSA-aaaa-bbbb-cccc', 'high', 9)],
      effects: [],
    };
    report.metadata.vulnerabilities.high += 1;
    const result = evaluateAudit(report, webConfig());
    const failures = failuresOf(result);
    expect(failures).toContain('unapproved direct high advisories: lodash:GHSA-aaaa-bbbb-cccc');
    expect(failures).toContain(
      "high records exist outside the excepted packages' dependency closure: lodash",
    );
    // Named as an error, alongside the excepted warning.
    expect(
      result.annotations.some((a) => a.startsWith('::error') && a.includes('lodash (GHSA-aaaa-bbbb-cccc)')),
    ).toBe(true);
  });

  it('a second, different high advisory on picomatch itself', () => {
    const report = webReport();
    report.vulnerabilities.picomatch.via.push(advisory('GHSA-zzzz-yyyy-xxxx', 'high', 10));
    expect(failuresOf(evaluateAudit(report, webConfig()))).toContain(
      'unapproved direct high advisories: picomatch:GHSA-zzzz-yyyy-xxxx',
    );
  });

  it('the excepted GHSA reported on a different package', () => {
    const report = webReport();
    report.vulnerabilities.fdir.via.push(advisory(GHSA));
    expect(failuresOf(evaluateAudit(report, webConfig()))).toContain(
      `unapproved direct high advisories: fdir:${GHSA}`,
    );
  });

  it('the excepted advisory raised to critical', () => {
    const report = webReport();
    report.vulnerabilities.picomatch.via = [advisory(GHSA, 'critical')];
    report.metadata.vulnerabilities.critical = 1;
    const failures = failuresOf(evaluateAudit(report, webConfig()));
    expect(failures).toContain('criticals are never excepted');
  });

  it('a critical anywhere', () => {
    const report = webReport();
    report.vulnerabilities['shell-quote'] = {
      severity: 'critical',
      via: [advisory('GHSA-pqg4-j6r4-53mv', 'critical', 11)],
      effects: [],
    };
    report.metadata.vulnerabilities.critical = 1;
    expect(failuresOf(evaluateAudit(report, webConfig()))).toContain('1 CRITICAL vulnerability record(s)');
  });

  it('a high record outside picomatch’s closure, with no advisory of its own', () => {
    const report = webReport();
    report.vulnerabilities.rollup = { severity: 'high', via: ['picomatch'], effects: [] };
    expect(failuresOf(evaluateAudit(report, webConfig()))).toContain('dependency closure: rollup');
  });
});

describe('audit gate — reachability', () => {
  it('picomatch gains an unapproved immediate parent', () => {
    const report = webReport();
    report.vulnerabilities.picomatch.effects.push('chokidar');
    report.vulnerabilities.chokidar = { severity: 'high', via: ['picomatch'], effects: [] };
    expect(failuresOf(evaluateAudit(report, webConfig()))).toContain(
      'picomatch is now reachable through an unapproved immediate parent: chokidar',
    );
  });

  it('a generic globbing library gains an unapproved parent (the #416 lesson)', () => {
    const report = webReport();
    report.vulnerabilities.tinyglobby.effects.push('some-runtime-lib');
    report.vulnerabilities['some-runtime-lib'] = { severity: 'high', via: ['tinyglobby'], effects: [] };
    expect(failuresOf(evaluateAudit(report, webConfig()))).toContain(
      'tinyglobby is now reachable through an unapproved immediate parent: some-runtime-lib',
    );
  });

  it('picomatch declared as a direct dependency', () => {
    const config = webConfig({ packageJson: { dependencies: { picomatch: '^4.0.7' }, devDependencies: {} } });
    expect(failuresOf(evaluateAudit(webReport(), config))).toContain(
      'picomatch became a direct web dependencies entry',
    );
  });

  it('a generic carrier declared as a direct dependency', () => {
    const config = webConfig({ packageJson: { dependencies: { tinyglobby: '^0.2.17' } } });
    expect(failuresOf(evaluateAudit(webReport(), config))).toContain(
      'tinyglobby became a direct web dependencies entry',
    );
  });

  it('source imports picomatch without declaring it', () => {
    const config = webConfig({
      loadSources: () => [{ file: 'src/lib/glob.ts', text: `import pm from 'picomatch/lib/parse';` }],
    });
    expect(failuresOf(evaluateAudit(webReport(), config))).toContain('src/lib/glob.ts imports picomatch');
  });

  it('a declared root (the tool itself) may be imported and declared', () => {
    const config = webConfig({
      loadSources: () => [{ file: 'src/x.ts', text: `import { defineConfig } from 'vite';` }],
    });
    expect(evaluateAudit(webReport(), config).ok).toBe(true);
  });

  it('fails closed when the source cannot be read, or is empty', () => {
    const unreadable = webConfig({
      loadSources: () => {
        throw new Error('EACCES');
      },
    });
    expect(failuresOf(evaluateAudit(webReport(), unreadable))).toContain('could not read src');
    expect(failuresOf(evaluateAudit(webReport(), webConfig({ loadSources: () => [] })))).toContain(
      'the import scan would prove nothing',
    );
  });
});

describe('audit gate — the exception cannot outlive its evidence', () => {
  it('expired, and the advisory is still named', () => {
    const result = evaluateAudit(webReport(), webConfig({ now: new Date('2027-02-01T00:00:00Z') }));
    expect(failuresOf(result)).toContain('the web audit exception expired on 2027-01-31');
    expect(result.annotations.join('\n')).toContain(GHSA);
  });

  it('still valid on the last day', () => {
    expect(evaluateAudit(webReport(), webConfig({ now: new Date('2027-01-31T23:00:00Z') })).ok).toBe(true);
  });

  it('the proof deleted', () => {
    expect(failuresOf(evaluateAudit(webReport(), webConfig({ readFile: () => null })))).toContain(
      `the reachability proof for ${GHSA} (${PROOF}) could not be read`,
    );
  });

  it('the proof no longer names the advisory', () => {
    expect(
      failuresOf(evaluateAudit(webReport(), webConfig({ readFile: () => '// nothing here' }))),
    ).toContain(`no longer names ${GHSA}`);
  });

  it('no proof registered', () => {
    expect(failuresOf(evaluateAudit(webReport(), webConfig({ proofs: new Map() })))).toContain(
      'has no reachability proof registered',
    );
  });

  it('a precondition stops holding (the bundle scan forgets picomatch)', () => {
    const config = webConfig({
      preconditions: [() => 'scripts/bundle-forbidden-libs.mjs no longer recognises picomatch'],
    });
    expect(failuresOf(evaluateAudit(webReport(), config))).toContain('no longer recognises picomatch');
  });

  it('the advisory disappears while another high remains: the stale entry must be removed', () => {
    const report = webReport();
    report.vulnerabilities.picomatch.via = [advisory('GHSA-zzzz-yyyy-xxxx', 'high', 10)];
    expect(failuresOf(evaluateAudit(report, webConfig()))).toContain(
      `allowlisted advisory ${GHSA} (picomatch) is no longer present`,
    );
  });

  it('everything clears: passes, with a warning to retire the unused entry', () => {
    const report = { metadata: { vulnerabilities: { high: 0, critical: 0 } }, vulnerabilities: {} };
    const result = evaluateAudit(report, webConfig());
    expect(result.ok).toBe(true);
    expect(result.annotations.join('\n')).toContain('the web audit exception list is now unused');
  });
});

describe('audit gate — malformed input', () => {
  it('refuses a report without vulnerabilities or metadata', () => {
    expect(failuresOf(evaluateAudit({}, webConfig()))).toContain('missing expected vulnerabilities/metadata');
  });

  it('refuses highs with no direct advisory object', () => {
    const report = webReport();
    report.vulnerabilities.picomatch.via = ['fdir'];
    expect(failuresOf(evaluateAudit(report, webConfig()))).toContain(
      'no direct advisory objects could be identified',
    );
  });

  it('refuses an effects graph that names an unknown package', () => {
    const report = webReport();
    report.vulnerabilities.vite.effects = ['ghost'];
    expect(failuresOf(evaluateAudit(report, webConfig()))).toContain(
      'effects graph references unknown package ghost',
    );
  });
});
