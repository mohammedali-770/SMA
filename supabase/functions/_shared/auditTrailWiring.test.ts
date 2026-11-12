import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A source-shape tripwire for the audit writes added with 20261007120000, in
 * the idiom of `pushReadyCopyWiring.test.ts` and `adminAuthWiring.test.ts`.
 *
 * Both handlers import Deno-only modules and end in `Deno.serve`, so Vitest
 * cannot load them. The helpers they call (`push-dispatch/broadcastLog.ts`,
 * `staff-accounts/audit.ts`) are executed by their own tests; this file pins
 * how the handlers USE them, which nothing else does.
 *
 * WHAT MATTERS MOST HERE IS WHAT DID NOT CHANGE. Push is a live customer
 * channel (CLAUDE.md §7). The broadcast arm gained a log write and nothing
 * else: the same admin gate, the same audience (`is_active` AND
 * `promos_enabled`), the same send, the same response. A broadcast that is
 * reported as failed after it went out invites a second send to every
 * customer, which cannot be recalled, so the log write must not be able to
 * change the response.
 */

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

/** Source with comments removed, so an explanation cannot satisfy an assertion. */
function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

/** The text from `start` up to (not including) the first `end` after it. */
function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  expect(a, `missing: ${start}`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(end, a + start.length);
  expect(b, `missing after ${start}: ${end}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

const PUSH = '../push-dispatch/index.ts';
const STAFF = '../staff-accounts/index.ts';

function broadcastArm(): string {
  return between(code(PUSH), "if (body.action === 'broadcast')", "if (body.action === 'pos_sync')");
}

describe('push-dispatch broadcast: targeting and send unchanged', () => {
  it('still gates on the calling admin and uses its id', () => {
    const arm = broadcastArm();
    expect(arm).toContain('const who = await callingAdmin(req, admin);');
    expect(arm).toContain('if (!who.ok) return json({ error: who.error, code: who.code }, who.status);');
    expect(arm).toContain('const adminId = who.userId;');
  });

  it('still targets active, opted-in devices and nothing wider', () => {
    const arm = broadcastArm();
    const select = between(arm, "admin.from('push_devices')", ';');
    expect(select.replace(/\s+/g, ' ')).toBe(
      "admin.from('push_devices') .select('id, expo_push_token, lang') .eq('is_active', true) .eq('promos_enabled', true)",
    );
  });

  it('still sends the admin copy as a promo, once', () => {
    const arm = broadcastArm();
    expect(arm.match(/sendToDevices\(/g)).toHaveLength(1);
    expect(arm.replace(/\s+/g, ' ')).toContain(
      "const result = await sendToDevices(admin, (devices ?? []) as DeviceRow[], { en: { title: titleEn, body: bodyEn }, ar: { title: titleAr, body: bodyAr }, }, { type: 'promo' });",
    );
  });
});

describe('push-dispatch broadcast: sender and content are logged', () => {
  it('logs through logBroadcast with the verified admin id and the four strings', () => {
    const arm = broadcastArm().replace(/\s+/g, ' ');
    expect(arm).toContain(
      "await logBroadcast( (row) => admin.from('notification_log').insert(row), adminId, { titleEn, titleAr, bodyEn, bodyAr }, result, );",
    );
    expect(code(PUSH)).toContain("import { logBroadcast } from './broadcastLog.ts';");
  });

  it('has no other notification_log write in the arm (the old direct insert is gone)', () => {
    const arm = broadcastArm();
    expect(arm.match(/notification_log/g)).toHaveLength(1);
    expect(arm).not.toContain("insert({ kind: 'broadcast'");
  });

  it('logs AFTER the send and cannot change the response', () => {
    const arm = broadcastArm();
    expect(arm.indexOf('logBroadcast(')).toBeGreaterThan(arm.indexOf('sendToDevices('));
    const after = arm.slice(arm.indexOf('logBroadcast('));
    // Exactly one return after the log write, and it is the success response.
    const returns = after.match(/return [^;]*;/g) ?? [];
    expect(returns).toEqual(["return json({ status: 'ok', ...result }, 200);"]);
    expect(arm).not.toMatch(/\bthrow\b/);
  });

  it('writes sent_by/content only from the helper, never in another arm', () => {
    const c = code(PUSH);
    expect(c).not.toContain('sent_by');
    expect(c).not.toMatch(/\bcontent:/);
    expect(c.match(/logBroadcast\(/g)).toHaveLength(1);
  });

  it('the helper falls back on exactly the column-missing codes', () => {
    const helper = code('../push-dispatch/broadcastLog.ts');
    expect(helper).toContain("export const COLUMN_MISSING_CODES: readonly string[] = ['PGRST204', '42703'];");
    expect(helper).toContain("if (!isColumnMissing(first.error)) return 'not_logged';");
    expect(helper).toContain('const second = await insert(legacyBroadcastLogRow(counts));');
  });
});

describe('staff-accounts: reset and delete are audited after they succeed', () => {
  const c = code(STAFF);

  it.each([
    [
      'reset',
      'admin.auth.admin.updateUserById(targetId, { password })',
      "staffAuditArgs('staff_password_reset', user.id, targetId, String(target.role))",
      'return json({ id: targetId, updated: true }, 200);',
    ],
    [
      'delete',
      'admin.auth.admin.deleteUser(targetId);',
      "staffAuditArgs('staff_account_delete', user.id, targetId, String(target.role))",
      'return json({ id: targetId, deleted: true }, 200);',
    ],
  ])(
    '%s: Admin API call, its error return, then the audit, then the unchanged success response',
    (_name, apiCall, auditCall, success) => {
      const api = c.indexOf(apiCall);
      expect(api).toBeGreaterThan(0);
      const errorReturn = c.indexOf('if (error) return json({ error: sanitize(error.message) }, 400);', api);
      const audit = c.indexOf(auditCall, api);
      const done = c.indexOf(success, api);
      expect(errorReturn).toBeGreaterThan(api);
      expect(audit).toBeGreaterThan(errorReturn);
      expect(done).toBeGreaterThan(audit);
      // Nothing between the audit and the success response can return early.
      expect(c.slice(audit, done)).not.toMatch(/return /);
    },
  );

  it('calls the service-role RPC by its literal name, never with the password', () => {
    expect(c.match(/admin\.rpc\('record_admin_action', args\)/g)).toHaveLength(2);
    expect(c.match(/staffAuditArgs\(/g)).toHaveLength(2);
    // The action name is a string literal that says "password"; the password
    // VARIABLE must not be among the arguments.
    for (const m of c.matchAll(/staffAuditArgs\([^)]*\)\)?/g)) {
      expect(m[0].replace(/'[^']*'/g, "''")).not.toMatch(/password/i);
    }
    expect(c).not.toMatch(/caller\.rpc\('record_admin_action'/);
  });
});
