import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A source-shape tripwire, and honest about being one.
 *
 * The handlers import Deno-only modules, so Vitest cannot load them and no test
 * can execute their control flow. `deno check` only typechecks. That leaves the
 * AAL2 gate — the entire fix — pinned by nothing at all: someone could delete
 * the four lines in a refactor and every other test would still pass.
 *
 * These assertions read the source as text. That is weaker than executing it and
 * it will not survive an aggressive rewrite, which is the point: a rewrite of an
 * authorization gate SHOULD have to look at this file and decide deliberately.
 * It catches the realistic regression — a line quietly dropped or reordered —
 * not a determined author.
 *
 * The real behavioural coverage lives in adminAuth.test.ts, which executes the
 * decision itself.
 */

const FUNCTIONS = [
  'staff-accounts',
  'email-test-config',
  'whatsapp-test-config',
] as const;

function source(fn: string): string {
  return readFileSync(new URL(`../${fn}/index.ts`, import.meta.url), 'utf8');
}

describe.each(FUNCTIONS)('%s admin gate wiring', (fn) => {
  const src = source(fn);

  it('asks Postgres for is_admin() rather than trusting the role alone', () => {
    expect(src).toContain("rpc('is_admin')");
    expect(src).toContain('decideAdminAuthorization');
  });

  // PRESENCE IS NOT INVOCATION. An earlier version of this suite asserted only
  // that the strings above appear, and a mutant that left the gate DEFINED but
  // never CALLED sailed through it — which is the original defect exactly. The
  // decision must be computed and acted on.
  it('acts on the decision: denies the request when it is not allowed', () => {
    expect(src).toMatch(/if \(!\w+\.allowed\) return json\(/);
  });

  it('never decides admin authorization from the profile role by itself', () => {
    // The exact shape of the original defect. If this string comes back, the
    // AAL2 check has been bypassed.
    expect(src).not.toMatch(/if \(!profile \|\| profile\.role !== 'admin'\) return json/);
  });

  it('gates AFTER resolving the user, so an expired session reads as 401', () => {
    // supabase-js falls back to sending the anon key when a session refresh
    // fails. Gating before getUser() would report that as "two-factor required"
    // instead of "unauthorized" and send the admin to the wrong remedy.
    const getUser = src.indexOf('auth.getUser()');
    const gate = src.indexOf("rpc('is_admin')");
    expect(getUser).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(getUser);
  });
});

describe('staff-accounts privileged actions', () => {
  const src = source('staff-accounts');

  it('re-asserts authorization before every service-role account mutation', () => {
    // One lexical guard at the door is not enough for irreversible, credential
    // issuing operations: a refactor that moves it leaves these naked.
    for (const call of ['updateUserById', 'deleteUser(targetId)']) {
      const mutation = src.indexOf(call);
      expect(mutation).toBeGreaterThan(-1);
      const preceding = src.slice(0, mutation);
      const lastCheck = preceding.lastIndexOf('await authorize()');
      expect(lastCheck).toBeGreaterThan(-1);
      // The re-check must be near the mutation, not merely somewhere above it.
      expect(preceding.slice(lastCheck).split('\n').length).toBeLessThan(12);
    }
  });

  it('still gates the account-creating call behind the same decision', () => {
    // Match the CALL, not the prose. An earlier version of this test searched
    // for 'auth.admin.createUser' and matched the explanatory comment beside
    // the gate, which sits above it — the assertion failed on correct code.
    const create = src.indexOf('await admin.auth.admin.createUser({');
    const gate = src.indexOf('const entry = await authorize()');
    expect(create).toBeGreaterThan(-1);
    // -1 would otherwise satisfy `create > gate` if the gate were deleted.
    expect(gate).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(gate);
  });
});

describe('the frozen payment function is not touched by this fix', () => {
  it('payment-test-config keeps its own gate (CLAUDE.md §6 freeze)', () => {
    // Deliberately asserts the OPPOSITE of the others. payment-test-config has
    // the identical defect and a worse blast radius, but it is under the payment
    // freeze and must not be modified without a separate owner decision. If this
    // test starts failing, someone has changed frozen code — check that it was
    // approved before making the test pass.
    const src = source('payment-test-config');
    expect(src).not.toContain('decideAdminAuthorization');
  });
});
