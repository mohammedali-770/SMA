import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveCustomerOrderState, type OrderConfirmationInput } from './orderConfirmation';

/**
 * SQL/TypeScript parity tripwire for the customer order state.
 *
 * `public.customer_order_state` is the documented server authority and
 * `deriveCustomerOrderState` is its mirror. Until 2026-08-28 NOTHING enforced
 * that they agree: the two suites are hand-maintained case lists that run in
 * different jobs against different artifacts, so neither can contradict the
 * other into a red build. The migration's own header claimed "both sides are
 * unit-tested against the same case table so they cannot drift" — there was no
 * shared case table, and they had already drifted twice:
 *
 *   1. `failed` + a FUTURE sync_next_attempt_at. SQL said 'sending_to_branch'
 *      (a leftover auto-retry arm); TS said 'branch_failed_retry_available'.
 *      TS was right — the manual-resend-only policy removed automatic retries.
 *      Both suites were green on the contradiction.
 *   2. `syncing` + pos_create_attempted_at — the normal in-flight window.
 *      SQL said 'verifying_with_branch' and showed a customer "we could not
 *      verify whether the branch received this order" on a healthy order.
 *
 * The SQL half could never have caught either, and not because of a missing
 * case: `.github/workflows/sql-suites.yml` filters on `supabase/(migrations|
 * tests)/`, so a TypeScript-only diff — exactly the shape that produces this
 * drift — skips the SQL job entirely. THIS test lives in the always-run vitest
 * suite and reads the migration as text, so a TS-only change that diverges from
 * the SQL goes red.
 *
 * It pins CLAUSE ORDER, which is what both defects were, rather than trying to
 * execute SQL in Node. Where a case can be evaluated on the TS side it is also
 * asserted against the real implementation, so this cannot drift into testing
 * only itself.
 */
const MIGRATIONS_DIR = new URL('../../../../../supabase/migrations/', import.meta.url);

/**
 * Strip SQL comments. Block comments NEST in Postgres, so a non-nesting regex
 * would leave the tail of `/* a /* b *\/ c *\/` behind as if it were code; this
 * counts depth instead. Line comments go after, so a `--` inside a block cannot
 * confuse it.
 */
function stripSqlComments(sql: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < sql.length; i += 1) {
    if (sql.startsWith('/*', i)) { depth += 1; i += 1; continue; }
    if (depth > 0 && sql.startsWith('*/', i)) { depth -= 1; i += 1; continue; }
    if (depth === 0) out += sql[i];
  }
  return out
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

/**
 * Remove whitespace entirely and lower-case, so formatting cannot fake either a
 * divergence or a match. A clause wrapped across lines, re-indented, or given a
 * space after a comma by a formatter must compare equal to the same clause on
 * one line — otherwise this tripwire cries wolf on a pgFormatter pass and gets
 * disabled, which is worse than not having it.
 */
function normalize(sql: string): string {
  return stripSqlComments(sql).replace(/\s+/g, '').toLowerCase();
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

/**
 * The body of the LATEST migration that (re)defines `fn` — resolved, never
 * hard-coded, and matched on NORMALIZED text so casing or line wrapping in a
 * future migration cannot make the resolver silently fall back to an older file.
 * That fail-open mode would be the exact failure this test exists to prevent:
 * confident assertions against a superseded artifact.
 *
 * Filename order is the repository's declared apply order. It is NOT the live
 * database's order — `apply_migration` stamps its own apply-time version, and
 * this file may be unapplied entirely — so what this returns is "the definition
 * the repository intends", which is the thing the TypeScript must mirror.
 *
 * The returned slice ENDS at the definition's own `$$;`, so a later function in
 * the same file can never satisfy an assertion about this one.
 */
function definitionBody(fn: string): string {
  const needle = normalize(`create or replace function public.${fn}`);
  // Whitespace-tolerant locator for the same text in the un-collapsed source, so
  // the slice boundaries stay meaningful while matching stays format-proof.
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\b`,
    'i',
  );
  const matches = migrationFiles().filter((f) =>
    normalize(readFileSync(new URL(f, MIGRATIONS_DIR), 'utf8')).includes(needle));
  expect(matches.length, `no migration defines ${fn}`).toBeGreaterThan(0);
  const file = matches[matches.length - 1];
  const sql = stripSqlComments(readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8'));
  const m = re.exec(sql);
  expect(m, `definition of ${fn} not found in ${file} after comment stripping`).not.toBeNull();
  const start = sql.indexOf('select case', (m as RegExpExecArray).index);
  const end = sql.indexOf('$$;', start);
  expect(start, `CASE expression not found for ${fn} in ${file}`).toBeGreaterThan(-1);
  expect(end, `end of ${fn} body not found in ${file}`).toBeGreaterThan(start);
  return normalize(sql.slice(start, end));
}

const caseBody = () => definitionBody('customer_order_state');

const at = (needle: string): number => {
  const i = caseBody().indexOf(normalize(needle));
  expect(i, `clause not found in the SQL CASE body: ${needle}`).toBeGreaterThan(-1);
  return i;
};

const IN_FLIGHT = "when p_sync_state = 'syncing' then 'sending_to_branch'";
const MARKER = "when p_marker_at is not null then 'verifying_with_branch'";
const REF = "when p_ref is not null then 'verifying_with_branch'";
const QUEUED = "when p_sync_state in ('pending','awaiting_payment') then 'sending_to_branch'";

function paid(over: Partial<OrderConfirmationInput> = {}): OrderConfirmationInput {
  return {
    orderType: 'pickup', paymentMethod: 'online', paymentStatus: 'paid',
    syncState: 'pending', ref: null, blockedReason: null, nextAttemptAt: null,
    posCreateAttemptedAt: null, customerRetryCount: 0, refundState: 'none', ...over,
  };
}
const past = () => new Date(Date.now() - 60_000).toISOString();
const future = () => new Date(Date.now() + 60_000).toISOString();

describe('customer_order_state — SQL/TS parity', () => {
  it('checks the in-flight send BEFORE the phase marker, on both sides', () => {
    expect(at(IN_FLIGHT)).toBeLessThan(at(MARKER));
    expect(deriveCustomerOrderState(paid({ syncState: 'syncing', posCreateAttemptedAt: past() })))
      .toBe('sending_to_branch');
  });

  it('keeps the ref test ahead of the in-flight test, on both sides', () => {
    // A syncing row that already holds a reference is genuinely ambiguous.
    expect(at(REF)).toBeLessThan(at(IN_FLIGHT));
    expect(deriveCustomerOrderState(paid({ syncState: 'syncing', ref: '#5', posCreateAttemptedAt: past() })))
      .toBe('verifying_with_branch');
  });

  it('keeps a marker that outlived its send ambiguous, on both sides', () => {
    expect(at(MARKER)).toBeLessThan(at(QUEUED));
    for (const s of ['pending', 'failed', 'dead_letter']) {
      expect(deriveCustomerOrderState(paid({ syncState: s, posCreateAttemptedAt: past() })), s)
        .toBe('verifying_with_branch');
    }
  });

  it('has no automatic-retry arm on either side', () => {
    // The manual-resend-only policy removed automatic retries; a future
    // sync_next_attempt_at is legacy data and must not read as "still trying".
    // This was a live SQL/TS divergence for months, with both suites green.
    expect(caseBody()).not.toContain('p_next_attempt_at');
    expect(deriveCustomerOrderState(paid({ syncState: 'failed', nextAttemptAt: future() })))
      .toBe('branch_failed_retry_available');
  });

  it('does NOT reorder the resend-eligibility predicate', () => {
    // customer_manual_pos_resend_eligibility keeps marker-first ordering on
    // purpose: an order whose POST is in flight must never be resent, because
    // Create Order has no idempotency key. Aligning it with the state function
    // would duplicate a kitchen ticket. Guarded here because the two functions
    // look similar enough to "fix" together.
    const body = definitionBody('customer_manual_pos_resend_eligibility');
    const marker = body.indexOf(normalize("when p_marker_at is not null then 'may_have_sent'"));
    const notFailed = body.indexOf(normalize("when p_sync_state not in ('failed','dead_letter','blocked')"));
    expect(marker, 'marker clause not found in the eligibility predicate').toBeGreaterThan(-1);
    expect(notFailed, 'not-failed clause not found in the eligibility predicate').toBeGreaterThan(-1);
    expect(marker).toBeLessThan(notFailed);
  });
});
