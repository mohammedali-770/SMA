import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-shape tripwire for F-X05-001, and honest about being one: the handlers
 * import Deno-only modules, so Vitest cannot execute them. The decision itself is
 * executed in accountDeletion.test.ts; this pins that both handlers ASK it, feed
 * it the role they just read, and act on the answer before anything destructive.
 */

function code(fn: string): string {
  return readFileSync(new URL(`../${fn}/index.ts`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

describe('account-delete-request refuses staff before any verification or enqueue', () => {
  const src = code('account-delete-request');

  it('reads the caller role for the JWT user id and feeds it to the decision', () => {
    expect(src).toMatch(/\.from\('profiles'\)\.select\('role'\)\.eq\('id', user\.id\)/);
    expect(src).toMatch(/decideDeletionAccountGuard\(\{ role: roleRow\?\.role, error: roleErr \}\)/);
  });

  it('acts on the decision and returns its status', () => {
    expect(src).toMatch(/if \(!guard\.allowed\) return json\(\{[^}]*\}, guard\.status\)/);
  });

  it('gates BEFORE the OTP send, the existing-request return, password check and enqueue', () => {
    const gate = src.indexOf('if (!guard.allowed)');
    expect(gate).toBeGreaterThan(-1);
    for (const later of [
      "body.action === 'send_otp'",
      "body.action === 'submit'",
      'await verifyPassword(email',
      "rpc('create_account_deletion_request'",
    ]) {
      const at = src.indexOf(later);
      expect(at, later).toBeGreaterThan(-1);
      expect(at, later).toBeGreaterThan(gate);
    }
  });

  it('does not derive the role from the request body', () => {
    expect(src).not.toMatch(/body\.role/);
  });
});

describe('account-delete-process holds a staff account for a human', () => {
  const src = code('account-delete-process');

  it('reads the role and holds a non-customer in manual_review with the safe reason', () => {
    expect(src).toMatch(/\.from\('profiles'\)\.select\('role'\)\.eq\('id', userId\)/);
    expect(src).toContain('if (profileErr) throw profileErr;');
    expect(src).toMatch(/if \(!isCustomerRoleForDeletion\(profileRow\?\.role\)\)/);
    expect(src).toMatch(/status: 'manual_review',\s*manual_review_reason: STAFF_DELETION_HOLD_REASON/);
  });

  it('holds BEFORE blocker checks, anonymization and the Auth delete', () => {
    const hold = src.indexOf('isCustomerRoleForDeletion(profileRow');
    expect(hold).toBeGreaterThan(-1);
    for (const later of [
      "rpc('anonymize_account_data'",
      'deleteAuthUser(admin, userId)',
      'classifyBlockers(',
    ]) {
      const at = src.indexOf(later);
      expect(at, later).toBeGreaterThan(hold);
    }
  });
});
