import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CUSTOMER_RESEND_LIMIT, deriveCustomerOrderState, type OrderConfirmationInput } from './orderConfirmation';

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
 * It pins the COMPLETE ORDERED CLAUSE SEQUENCE of both functions rather than
 * trying to execute SQL in Node, and where a case can be evaluated on the TS
 * side it is also asserted against the real implementation, so this cannot drift
 * into testing only itself.
 *
 * Sampling a few clauses was tried first and was not enough — see the comment on
 * clauses() for the three mutations that walked through it.
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

/**
 * The body split into its ordered `when …` segments.
 *
 * Pinning four sampled needles was NOT enough, and that was proven by mutation
 * rather than argued: a clause inserted ABOVE all four preserves their relative
 * order, so `when p_sync_state = 'syncing' and coalesce(p_retry_count,0) > 0
 * then 'verifying_with_branch'` — which reintroduces the SM-2026-000070 screen
 * for any resent order — passed. So did flipping the resend budget's `<` to
 * `<=`, and so did swapping the eligibility predicate's `then 'not_failed'` to
 * `then 'eligible'`, which would make every non-failed order resendable
 * INCLUDING an in-flight one and duplicate a live kitchen ticket.
 *
 * The whole sequence is therefore pinned. Any insertion, deletion, reordering,
 * predicate edit or result change is red and has to be re-approved by updating
 * the expected array below — deliberately, with the diff in front of you.
 * Whitespace and comments are normalised away first, so a reformat is silent.
 */
function clauses(fn: string): string[] {
  return definitionBody(fn).replace(/^selectcase/, '').split(/(?=when)/).filter(Boolean);
}

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

  it('pins the FULL clause sequence of customer_order_state', () => {
    expect(clauses('customer_order_state')).toEqual([
      "whenp_refund_state='failed'then'final_failure_refund_failed'",
      "whenp_refund_state='refunded'then'final_failure_refunded'",
      "whenp_refund_statein('pending','processing')then'final_failure_refund_pending'",
      "whenp_payment_method='online'andcoalesce(p_payment_status,'pending')<>'paid'then'payment_pending'",
      'whennotpublic.pos_confirmation_channel_active(p_sync_state,p_blocked_reason)thencase',
      "whenp_payment_status='paid'then'accepted_no_pos_channel'else'accepted_no_pos_channel_unpaid'end",
      "whenp_sync_state='synced'andpublic.lazywait_pos_ref_is_usable(p_ref)then'confirmed_by_branch'",
      "whenp_sync_state='confirmation_required'then'verifying_with_branch'",
      "whenp_sync_state='synced'then'verifying_with_branch'",
      "whenp_refisnotnullthen'verifying_with_branch'",
      "whenp_sync_state='syncing'then'sending_to_branch'",
      "whenp_marker_atisnotnullthen'verifying_with_branch'",
      "whenp_sync_statein('pending','awaiting_payment')then'sending_to_branch'",
      'whencoalesce(p_retry_count,0)<public.customer_pos_resend_limit()thencase',
      "whenp_payment_status='paid'then'branch_failed_retry_available'else'unpaid_branch_failed_retry_available'endelsecase",
      "whenp_payment_status='paid'then'final_failure_refund_pending'else'unpaid_final_failure'endend;",
    ]);
  });

  it('pins the FULL clause sequence of the resend-eligibility predicate', () => {
    // Guarded just as tightly as the state function, and for a harder reason: a
    // wrong result here does not show the wrong copy, it sends a second Create
    // Order for an order already in flight.
    expect(clauses('customer_manual_pos_resend_eligibility')).toEqual([
      "whencoalesce(p_refund_state,'none')<>'none'then'refund_in_progress'",
      "whennotpublic.pos_confirmation_channel_active(p_sync_state,p_blocked_reason)then'not_applicable'",
      "whenp_payment_method='online'andcoalesce(p_payment_status,'pending')<>'paid'then'not_paid'",
      "whenp_refisnotnullthen'ref_present'",
      "whenp_sync_state='synced'then'ref_present'",
      "whenp_sync_state='confirmation_required'then'verification_required'",
      "whenp_marker_atisnotnullthen'may_have_sent'",
      "whenp_sync_statenotin('failed','dead_letter','blocked')then'not_failed'",
      "whencoalesce(p_retry_count,0)>=public.customer_pos_resend_limit()then'attempt_limit_reached'else'eligible'end;",
    ]);
  });

  it('ties the TypeScript resend limit to the SQL one', () => {
    // Nothing connected these two numbers: orderConfirmation.test.ts uses the
    // TS constant on both sides of its own assertion, so the SQL literal could
    // change alone and only show up as a resend the server silently refuses.
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const defs = files
      .map((f) => normalize(readFileSync(new URL(f, MIGRATIONS_DIR), 'utf8')))
      .filter((c) => c.includes(normalize('create or replace function public.customer_pos_resend_limit')));
    expect(defs.length, 'no migration defines customer_pos_resend_limit').toBeGreaterThan(0);
    const m = /customer_pos_resend_limit\(\)returnsinteger.*?select(\d+)/.exec(defs[defs.length - 1]);
    expect(m, 'could not read the SQL resend limit literal').not.toBeNull();
    expect(Number((m as RegExpExecArray)[1])).toBe(CUSTOMER_RESEND_LIMIT);
  });
});
