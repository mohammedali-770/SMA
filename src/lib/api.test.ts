import { beforeEach, describe, expect, it, vi } from 'vitest';
import { admin } from './api';
import { supabase } from './supabase';
import { BranchHasDependenciesError } from './branchDeletion';

// The data-access layer talks to a real Supabase client; mock it so we can drive
// the branch-delete guard's decision paths deterministically. Server-side RLS
// (admin-only) and the FK constraints are the real guarantees — an adversarial
// checker already confirmed those; these tests cover the client-side UX guard.
vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }));

interface Scenario {
  ordersCount?: number;
  sessionsCount?: number;
  /** Error the `branches.delete()` resolves with (null = success / no-op). */
  deleteError?: unknown;
}

function wireSupabase(scenario: Scenario) {
  const deleteEq = vi.fn(() => Promise.resolve({ error: scenario.deleteError ?? null }));
  const del = vi.fn(() => ({ eq: deleteEq }));
  const tablesQueried: string[] = [];

  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    tablesQueried.push(table);
    if (table === 'orders') {
      return { select: () => ({ eq: () => Promise.resolve({ count: scenario.ordersCount ?? 0, error: null }) }) };
    }
    if (table === 'checkout_sessions') {
      return { select: () => ({ eq: () => Promise.resolve({ count: scenario.sessionsCount ?? 0, error: null }) }) };
    }
    if (table === 'branches') return { delete: del };
    throw new Error(`unexpected table queried: ${table}`);
  }) as unknown as typeof supabase.from);

  return { deleteEq, del, tablesQueried };
}

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected the call to reject, but it resolved');
}

describe('admin.deleteBranch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks (advisory pre-check) when the branch still has orders — never fires the delete', async () => {
    const { deleteEq } = wireSupabase({ ordersCount: 3, sessionsCount: 0 });
    const err = await captureError(() => admin.deleteBranch('b1'));
    expect(err).toBeInstanceOf(BranchHasDependenciesError);
    expect((err as BranchHasDependenciesError).counts).toEqual({ orders: 3, checkoutSessions: 0 });
    expect(deleteEq).not.toHaveBeenCalled();
  });

  it('blocks when the branch has checkout sessions but no orders', async () => {
    const { deleteEq } = wireSupabase({ ordersCount: 0, sessionsCount: 2 });
    const err = await captureError(() => admin.deleteBranch('b1'));
    expect(err).toBeInstanceOf(BranchHasDependenciesError);
    expect((err as BranchHasDependenciesError).counts).toEqual({ orders: 0, checkoutSessions: 2 });
    expect(deleteEq).not.toHaveBeenCalled();
  });

  it('deletes a pristine branch (no orders, no sessions) and issues the scoped delete', async () => {
    const { del, deleteEq, tablesQueried } = wireSupabase({ ordersCount: 0, sessionsCount: 0 });
    await expect(admin.deleteBranch('b1')).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledTimes(1);
    expect(deleteEq).toHaveBeenCalledWith('id', 'b1');
    // Silent-cascade awareness: the pre-check consults ONLY the FK-blocking
    // tables; the cascade tables are intentionally not counted (they go away
    // with the branch) so pristine deletes are never falsely blocked.
    expect(tablesQueried).toContain('orders');
    expect(tablesQueried).toContain('checkout_sessions');
    expect(tablesQueried).not.toContain('branch_product_availability');
    expect(tablesQueried).not.toContain('branch_delivery_zones');
  });

  it('maps a raw Postgres FK violation (23503) on delete to the friendly error (hard backstop)', async () => {
    // Simulates a race: the pre-check saw 0 rows, but an order landed before the
    // delete, so the FK RESTRICT fires. The raw constraint string must NOT leak.
    const { del } = wireSupabase({
      ordersCount: 0,
      sessionsCount: 0,
      deleteError: {
        code: '23503',
        message: 'update or delete on table "branches" violates foreign key constraint "orders_branch_id_fkey"',
      },
    });
    const err = await captureError(() => admin.deleteBranch('b1'));
    expect(err).toBeInstanceOf(BranchHasDependenciesError);
    expect((err as Error).message).not.toContain('foreign key');
    expect(del).toHaveBeenCalledTimes(1); // the delete WAS attempted
  });

  it('surfaces an unrelated delete error verbatim (does not mask it as a dependency block)', async () => {
    const { del } = wireSupabase({
      ordersCount: 0,
      sessionsCount: 0,
      deleteError: { code: '42501', message: 'permission denied for table branches' },
    });
    const err = await captureError(() => admin.deleteBranch('b1'));
    expect(err).not.toBeInstanceOf(BranchHasDependenciesError);
    expect((err as Error).message).toBe('permission denied for table branches');
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('a non-admin delete is a harmless no-op: RLS hides the rows and returns no error', async () => {
    // For a non-admin the count queries are RLS-limited (they see 0 rows) and the
    // delete matches 0 rows server-side, returning no error. The client can't and
    // shouldn't distinguish this from a real delete — RLS is the authoritative
    // guard (already verified by the checker). The wrapper must simply not throw.
    const { deleteEq } = wireSupabase({ ordersCount: 0, sessionsCount: 0, deleteError: null });
    await expect(admin.deleteBranch('b1')).resolves.toBeUndefined();
    expect(deleteEq).toHaveBeenCalledWith('id', 'b1');
  });
});
