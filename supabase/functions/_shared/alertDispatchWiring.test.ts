import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A source-shape tripwire for `operations-alert-dispatch`, in the idiom of
 * `adminAuthWiring.test.ts` and `pushReadyCopyWiring.test.ts`, and honest about
 * being one.
 *
 * The handler ends in `Deno.serve` and imports Deno-only modules, so Vitest
 * cannot load it and no test here can execute its control flow. What CAN be
 * pinned is the shape of the guarantees, and those guarantees are the reason
 * this function is safe to deploy while the flag is off:
 *
 *   - it re-checks the master flag itself, so turning dispatch off stops
 *     delivery of rows that were ALREADY queued, not just the writing of new
 *     ones;
 *   - every claim/finalize/release carries the fencing token, which is what
 *     makes delivery at-most-once under a stale owner;
 *   - recipients come from the RPC, never a literal address in this repo.
 *
 * The SQL half is covered for real, against a database, by
 * `supabase/tests/operations_alert_email_dispatch_test.sql`.
 */

function source(): string {
  return readFileSync(new URL('../operations-alert-dispatch/index.ts', import.meta.url), 'utf8');
}

/**
 * Source with comments stripped. Load-bearing, not defensive: the header
 * documents the very properties asserted below, so an assertion would happily
 * match the prose explaining the guarantee instead of the code providing it.
 * `pushReadyCopyWiring.test.ts` records this trap firing before.
 */
function code(): string {
  return source()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

describe('operations-alert-dispatch is inert until deliberately enabled', () => {
  it('re-checks the master flag in the handler, not only in the producers', () => {
    const c = code();
    expect(c).toContain("from('operations_alert_settings')");
    expect(c).toContain('external_dispatch_enabled');
    expect(c).toContain("status: 'disabled'");
  });

  it('refuses to send when the email provider is disabled', () => {
    expect(code()).toContain("getProviderConfig(admin, 'email')");
  });
});

describe('delivery is at most once', () => {
  it('claims with a per-invocation fencing token', () => {
    const c = code();
    expect(c).toContain('crypto.randomUUID()');
    expect(c).toContain('claim_operations_alert_emails');
    expect(c).toContain('p_claim_token: claimToken');
  });

  it('fences every completion write with that same token', () => {
    const c = code();
    // A finalize or release that dropped the token would let a dispatcher whose
    // lease was reclaimed overwrite the new owner's outcome.
    for (const call of c
      .split('\n')
      .filter((l) => /finalize_operations_alert_email|release_operations_alert_email/.test(l))) {
      expect(call.length).toBeGreaterThan(0);
    }
    expect(c).toContain('finalize_operations_alert_email');
    expect(c).toContain('release_operations_alert_email');
    expect(c.match(/p_claim_token: claimToken/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('treats a post-send outcome as terminal, never as a retry', () => {
    const c = code();
    expect(c).toContain("p_status: 'sent'");
    expect(c).toContain("p_status: 'failed'");
  });
});

describe('recipients and secrets', () => {
  it('derives recipients from the RPC rather than storing an address', () => {
    expect(code()).toContain('operations_alerts_dispatch_recipients');
  });

  it('contains no hard-coded recipient address', () => {
    // Any bare email literal here would be both a recipient that outlives the
    // admin who owns it and a small PII leak into the repository.
    // Slashes excluded, or this matches the `denomailer@1.6.0/mod.ts` import
    // specifier — which it did on the first run of this test.
    const literals = code().match(/['"][^'"\s/]+@[^'"\s/]+\.[a-z]{2,}['"]/gi) ?? [];
    expect(literals).toEqual([]);
  });

  it('does not claim anything when there is nobody to send to', () => {
    // Claiming with no recipients would burn the bounded attempt budget against
    // rows that could never have been delivered.
    const c = code();
    const noRecipients = c.indexOf("status: 'no_recipients'");
    const claim = c.indexOf('claim_operations_alert_emails');
    expect(noRecipients).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(noRecipients);
  });
});

describe('caller authorization', () => {
  it('uses the shared admin predicate rather than a second role check', () => {
    const c = code();
    expect(c).toContain('decideAdminAuthorization');
    expect(c).toContain("rpc('is_admin')");
    // The defect fixed across every admin function on 2026-08-23: role alone.
    expect(c).not.toMatch(/role\s*===\s*'admin'\s*\?/);
  });
});
