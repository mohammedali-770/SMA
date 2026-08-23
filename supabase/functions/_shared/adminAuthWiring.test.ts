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

/**
 * The same source with comments removed.
 *
 * Needed because these files DOCUMENT the defect they fixed by quoting the old
 * line, and an assertion that the old line is gone will otherwise match the
 * explanation of its removal. That has now happened twice in this suite — once
 * against `auth.admin.createUser` in prose, once against push-dispatch's
 * `profile?.role === 'admin' ? ...` quote. Keeping the quote is right; the
 * assertion is what has to be precise.
 */
function code(fn: string): string {
  return source(fn)
    .replace(/\/\*[\s\S]*?\*\//g, '')       // block comments, including /** */
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line)) // whole-line // comments
    .join('\n');
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

  // INVOCATION IS NOT USE, either — the second half of the same lesson, and it
  // cost a real surviving mutant to learn. This passes every assertion above:
  //
  //     const { data: isAdmin, error: adminErr } = await caller.rpc('is_admin');
  //     const gate = decideAdminAuthorization({ data: true, error: null }, profile?.role);
  //
  // The RPC is called, the decision is computed, the denial is returned — and
  // the answer is thrown away, restoring the exact AAL1 hole this file exists to
  // prevent. `deno check` does not object: an unused local is not a type error,
  // and CI runs `deno check`, never `deno lint`. So pin the DATA FLOW: the
  // decision's first argument must be built from identifiers, never literals.
  it('feeds the RPC RESULT into the decision, not a hardcoded value', () => {
    expect(src).not.toMatch(
      /decideAdminAuthorization\(\s*\{\s*data:\s*(?:true|false|null|undefined|\d)/,
    );
    // `data:` must be an identifier or member expression (isAdmin, rpcRes.data).
    expect(src).toMatch(/decideAdminAuthorization\(\s*\{\s*data:\s*[A-Za-z_$][\w$.]*\s*,/);
    // ...and the error channel must be wired too, or a failed check reads as a
    // clean denial instead of the 500 it is.
    expect(src).not.toMatch(/decideAdminAuthorization\(\s*\{[^}]*error:\s*(?:null|undefined|false)\s*[},]/);
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

// push-dispatch does not fit the shape above: its gate lives in a helper that
// returns the caller's id for attribution, and two of its four actions accept a
// service-role call instead. It gets its own assertions rather than a loosened
// shared one — this is the LIVE function, and its broadcast cannot be recalled.
describe('push-dispatch admin gate wiring', () => {
  const src = source('push-dispatch');

  it('asks Postgres for is_admin() rather than trusting the role alone', () => {
    expect(src).toContain("rpc('is_admin')");
    expect(src).toContain('decideAdminAuthorization');
  });

  it('no longer decides admin authority from the profile role by itself', () => {
    // The exact shape of the original defect in this file. It was missed by a
    // sweep for `role !== 'admin'` because it spells the same test as a ternary,
    // so pin THIS spelling too — a lexical sweep will not find it again either.
    // Checked against CODE: the header deliberately quotes the old line.
    expect(code('push-dispatch')).not.toContain("profile?.role === 'admin' ? user.id : null");
    expect(source('push-dispatch')).toContain("profile?.role === 'admin' ? user.id : null");
  });

  it('feeds the RPC RESULT into the decision, not a hardcoded value', () => {
    expect(src).not.toMatch(
      /decideAdminAuthorization\(\s*\{\s*data:\s*(?:true|false|null|undefined|\d)/,
    );
    expect(src).toMatch(/decideAdminAuthorization\(\s*\{\s*data:\s*[A-Za-z_$][\w$.]*\s*[,.]/);
  });

  it('gates AFTER resolving the user, so an expired session reads as 401', () => {
    const getUser = src.indexOf('auth.getUser()');
    const gate = src.indexOf("rpc('is_admin')");
    expect(getUser).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(getUser);
  });

  it('gates EVERY action, including the two that also accept a service call', () => {
    // broadcast is the one that cannot be recalled, but a missed gate on any of
    // the four is an unauthorized send. Assert the helper is consulted four
    // times and that no call site was left on the old helper name.
    expect(code('push-dispatch')).not.toContain('callingAdminId');
    const calls = src.match(/await callingAdmin\(req, admin\)/g) ?? [];
    expect(calls.length).toBe(4);
    // The two service-or-admin actions must still let the service role through
    // without a JWT — order-intake and lazywait-webhook depend on it.
    expect(src).toMatch(/const fromService = isServiceRoleCall\(req\);/);
    expect((src.match(/if \(!fromService\) \{/g) ?? []).length).toBe(2);
  });

  it('returns the decision\'s own status and message, not a flat 403', () => {
    // A caller told "forbidden" when the real answer is "complete two-factor"
    // has no way to know what to do. Four call sites, all returning the
    // decision verbatim.
    const returns = src.match(/return json\(\{ error: who\.error, code: who\.code \}, who\.status\)/g) ?? [];
    expect(returns.length).toBe(4);
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
