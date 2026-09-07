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
 *     stops a stale owner overwriting a newer outcome. Note it does NOT make
 *     delivery at-most-once -- a crash after SMTP accepts but before `sent` is
 *     persisted re-sends. Deliberate, and explained in the handler's header;
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

describe('delivery is fenced, and at least once across a crash', () => {
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

  it('records a terminal outcome for every send attempt', () => {
    const c = code();
    expect(c).toContain("p_status: 'sent'");
    expect(c).toContain("p_status: 'failed'");
  });
});

describe('REGRESSION: the claim result shape matches the RPC that produces it', () => {
  // THE DEFECT THIS PINS (#328). `claim_operations_alert_emails` declares
  // RETURNS TABLE (id, language, subject_safe, body_safe, attempt_count), and
  // PostgREST serialises THOSE names. That function's final SELECT aliases them
  // c_id, c_language, ... purely to keep the plpgsql body unambiguous, and the
  // TypeScript interface was written against the aliases. Every field was
  // therefore undefined: SMTP got no subject and no body, and every
  // finalize/release passed `p_id: undefined`, matching zero rows and stranding
  // the claim until its lease expired -- at which point it was re-sent.
  //
  // Neither existing layer caught it. The SQL suite calls the RPC from SQL,
  // where output column names do not matter; the source-shape tests grepped for
  // strings that were present and wrong. This reads BOTH artifacts and compares
  // them, which is the only way this class of drift is visible.
  function migrationSource() {
    return readFileSync(
      new URL('../../migrations/20260903120000_operations_alert_email_dispatch.sql', import.meta.url),
      'utf8',
    );
  }

  function declaredColumns() {
    const m = /claim_operations_alert_emails\([\s\S]*?returns table \(([^)]*)\)/i.exec(migrationSource());
    expect(m).not.toBeNull();
    return String(m ? m[1] : '')
      .split(',')
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  it('declares exactly the columns the handler expects', () => {
    expect(declaredColumns()).toEqual(['id', 'language', 'subject_safe', 'body_safe', 'attempt_count']);
  });

  it('reads every claimed field by its DECLARED name, never a CTE alias', () => {
    const c = code();
    for (const col of declaredColumns()) {
      expect(c).toContain(col + ':');
    }
    expect(c).not.toMatch(/row\.c_/);
  });

  it('passes a real row id to finalize and release', () => {
    const c = code();
    expect(c).toContain('p_id: row.id');
    expect(c).not.toContain('p_id: row.c_id');
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

describe('the scheduler path', () => {
  // THE DEFECT THIS PINS (#329). The first version read the trigger secret out
  // of an `x-alert-dispatch-secret` header while the docs claimed this function
  // could never read, log or leak it. The plaintext arrived on every tick. What
  // arrives now is a nonce, a timestamp and an HMAC over them.
  it('reads a signature, never the secret itself', () => {
    const c = code();
    expect(c).toContain("req.headers.get('x-alert-dispatch-nonce')");
    expect(c).toContain("req.headers.get('x-alert-dispatch-timestamp')");
    expect(c).toContain("req.headers.get('x-alert-dispatch-signature')");
    expect(c).toContain('verify_operations_alert_dispatch_signature');
    // The header name, and the RPC that took the plaintext, must both be gone.
    expect(c).not.toContain("headers.get('x-alert-dispatch-secret')");
    expect(c).not.toContain('verify_operations_alert_dispatch_secret');
  });

  it('never fetches the expected secret from anywhere', () => {
    // Reading it out of a table would be the older lazywait-sync shape, and is
    // deliberately not what happens here.
    const c = code();
    expect(c).not.toMatch(/decrypted_secrets/);
    expect(c).not.toMatch(/dispatch_secret['"]?\s*\]/);
  });

  it('sends all three signature components to the RPC', () => {
    // Passing only some of them would let Postgres verify a signature over
    // material the caller did not actually present.
    const c = code();
    expect(c).toContain('p_nonce: nonce');
    expect(c).toContain('p_timestamp: stamp');
    expect(c).toContain('p_signature: signature');
  });

  it('treats a partial header set as an attempted scheduler call, not a bypass', () => {
    // If the gate required all three to be present, a caller could omit one and
    // fall through to whichever gate comes next. Any one of them must commit
    // the request to signature verification.
    const c = code();
    expect(c).toMatch(/nonce !== null \|\| stamp !== null \|\| signature !== null/);
  });

  it('treats a non-true RPC result as a refusal', () => {
    // Fail-closed: the RPC already returns a boolean, but a truthy non-boolean
    // must never authenticate a caller.
    expect(code()).toContain('ok !== true');
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
