import { describe, expect, it } from 'vitest';
import { recordStaffAction, staffAuditArgs, type RecordAdminActionCall } from './audit';

const ADMIN = '0a000000-0000-0000-0000-0000000a0ad1';
const TARGET = '0a000000-0000-0000-0000-0000000a0ac1';

describe('staffAuditArgs', () => {
  it('builds exactly the record_admin_action arguments', () => {
    expect(staffAuditArgs('staff_password_reset', ADMIN, TARGET, 'branch_staff')).toEqual({
      p_actor: ADMIN,
      p_action: 'staff_password_reset',
      p_target_table: 'auth.users',
      p_target_id: TARGET,
      p_detail: { target_role: 'branch_staff' },
    });
    expect(staffAuditArgs('staff_account_delete', ADMIN, TARGET, 'call_center').p_action).toBe(
      'staff_account_delete',
    );
  });

  it('has nowhere to put a password', () => {
    // Four parameters, none of them a credential, and no key the RPC would
    // refuse (it refuses password/secret/token-like keys at any depth).
    expect(staffAuditArgs.length).toBe(4);
    const json = JSON.stringify(staffAuditArgs('staff_password_reset', ADMIN, TARGET, 'branch_staff'));
    expect(json).not.toMatch(/"[^"]*(password|secret|token)[^"]*"\s*:/i);
  });
});

describe('recordStaffAction', () => {
  const args = staffAuditArgs('staff_account_delete', ADMIN, TARGET, 'branch_staff');

  it('passes the arguments through and reports success', async () => {
    const seen: unknown[] = [];
    const call: RecordAdminActionCall = (a) => {
      seen.push(a);
      return Promise.resolve({ error: null });
    };
    expect(await recordStaffAction(call, args)).toBe(true);
    expect(seen).toEqual([args]);
  });

  it('reports a refused or missing RPC as false, without throwing', async () => {
    const missing: RecordAdminActionCall = () => Promise.resolve({ error: { code: 'PGRST202' } });
    expect(await recordStaffAction(missing, args)).toBe(false);
    const rejecting: RecordAdminActionCall = () => Promise.reject(new Error('network'));
    await expect(recordStaffAction(rejecting, args)).resolves.toBe(false);
    const throwing: RecordAdminActionCall = () => {
      throw new Error('boom');
    };
    await expect(recordStaffAction(throwing, args)).resolves.toBe(false);
  });
});
