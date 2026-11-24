/**
 * F-X11-001 — the console's only route out of account-deletion `manual_review`.
 *
 * Pinned: the read is restricted to manual_review (a completed erasure must
 * never be offered for resolution), the retry flag mirrors the RPC's own guard,
 * and the ONLY write is the existing RPC with exactly its three arguments. The
 * table has no client write grant, so a `.update()` here would fail in
 * Production and succeed against a permissive mock — hence the source check.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  chain: {} as Record<string, ReturnType<typeof vi.fn>>,
  from: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('./supabase', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import { accountDeletionReview } from './accountDeletionReviewApi';

beforeEach(() => {
  vi.clearAllMocks();
  const result = { data: [] as unknown[], error: null as { message: string } | null };
  h.chain.select = vi.fn(() => h.chain);
  h.chain.eq = vi.fn(() => h.chain);
  h.chain.order = vi.fn(() => h.chain);
  h.chain.limit = vi.fn(() => Promise.resolve(result));
  h.chain.__result = result as never;
  h.from.mockReturnValue(h.chain);
  h.rpc.mockResolvedValue({ data: {}, error: null });
});

describe('accountDeletionReview.list', () => {
  it('reads only manual_review rows, oldest first', async () => {
    await accountDeletionReview.list();
    expect(h.from).toHaveBeenCalledWith('account_deletion_requests');
    expect(h.chain.eq).toHaveBeenCalledWith('status', 'manual_review');
    expect(h.chain.order).toHaveBeenCalledWith('requested_at', { ascending: true });
  });

  it('mirrors the RPC retry guard and does not leak the user id', async () => {
    (h.chain.__result as unknown as { data: unknown[] }).data = [
      { id: 'a', requested_at: 't1', manual_review_reason: 'x', user_id: 'u', identity_verified_at: 't' },
      { id: 'b', requested_at: 't2', manual_review_reason: 'y', user_id: null, identity_verified_at: 't' },
      { id: 'c', requested_at: 't3', manual_review_reason: 'z', user_id: 'u', identity_verified_at: null },
    ];
    const rows = await accountDeletionReview.list();
    expect(rows.map((r) => r.canRetry)).toEqual([true, false, false]);
    expect(JSON.stringify(rows)).not.toContain('"u"');
    expect(rows[0]).toEqual({ id: 'a', requested_at: 't1', reason: 'x', canRetry: true });
  });

  it('throws the server message', async () => {
    (h.chain.__result as unknown as { error: { message: string } }).error = { message: 'boom' };
    await expect(accountDeletionReview.list()).rejects.toThrow('boom');
  });
});

describe('accountDeletionReview.resolve', () => {
  it('calls the existing RPC with exactly its arguments', async () => {
    await accountDeletionReview.resolve('req-1', 'fail', '  checked with owner ');
    expect(h.rpc).toHaveBeenCalledWith('resolve_account_deletion_request', {
      p_request_id: 'req-1',
      p_action: 'fail',
      p_note: 'checked with owner',
    });
  });

  it('sends a null note when none was typed', async () => {
    await accountDeletionReview.resolve('req-1', 'retry', '   ');
    expect(h.rpc).toHaveBeenCalledWith('resolve_account_deletion_request', {
      p_request_id: 'req-1',
      p_action: 'retry',
      p_note: null,
    });
  });

  it('surfaces a refusal (an admin at AAL1 gets 42501 from the RPC)', async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Only admins may resolve account deletion reviews' },
    });
    await expect(accountDeletionReview.resolve('r', 'fail', '')).rejects.toThrow(/Only admins/);
  });

  it('has no write path other than the RPC', () => {
    const src = readFileSync(join(__dirname, 'accountDeletionReviewApi.ts'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(src).not.toMatch(/\.(update|insert|delete|upsert)\(/);
    expect(src.match(/\.rpc\(/g)).toHaveLength(1);
  });
});
