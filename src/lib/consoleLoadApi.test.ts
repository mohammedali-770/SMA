/**
 * The console's data-access calls that the 2026-11-12 load assessment bounded.
 *
 *   - `orders.list(limit)` passes its limit to `admin_list_orders`; without one
 *     the RPC returns every order with customer PII (63 MB at 50 000 orders);
 *   - `profiles.loyaltyLedgerPage` reads one page of customers, a fixed column
 *     list, ordered by name AND id, with an exact count — never `select('*')`;
 *   - `loyalty.stats()` calls `admin_loyalty_stats` with no arguments;
 *   - `lazywaitCatalog.items()` never asks for the `raw` snapshot;
 *   - a push-dispatch failure shows the server's sentence whether it arrives as
 *     `error` or as `reason`.
 *
 * Supabase is mocked: these pin what the client SENDS.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

import {
  LAZYWAIT_CATALOG_ITEM_COLUMNS,
  LOYALTY_LEDGER_COLUMNS,
  lazywaitCatalog,
  loyalty,
  orders,
  profiles,
  pushAdmin,
  pushErrorMessage,
} from './api';
import { supabase } from './supabase';

beforeEach(() => vi.clearAllMocks());

describe('orders.list', () => {
  it('passes the limit it is given to admin_list_orders', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as never);
    await orders.list(200);
    expect(supabase.rpc).toHaveBeenCalledWith('admin_list_orders', { p_limit: 200 });
  });

  it('still sends null (the unbounded arm) only when no limit is given', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null } as never);
    await orders.list();
    expect(supabase.rpc).toHaveBeenCalledWith('admin_list_orders', { p_limit: null });
  });
});

describe('profiles', () => {
  it('has no list() that reads every profile', () => {
    expect((profiles as Record<string, unknown>).list).toBeUndefined();
  });

  it('reads one ledger page: fixed columns, customers only, ordered by name then id, exact count', async () => {
    const calls: [string, unknown[]][] = [];
    const chain: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ['select', 'eq', 'order']) {
      chain[m] = (...a: unknown[]) => {
        calls.push([m, a]);
        return chain;
      };
    }
    chain.range = (...a: unknown[]) => {
      calls.push(['range', a]);
      return Promise.resolve({
        data: [
          { id: 'c1', full_name: 'A', phone_number: null, email: null, role: 'customer', loyalty_points: 5 },
        ],
        count: 1234,
        error: null,
      });
    };
    vi.mocked(supabase.from).mockReturnValue(chain as never);

    const page = await profiles.loyaltyLedgerPage(100);

    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(calls).toEqual([
      ['select', [LOYALTY_LEDGER_COLUMNS, { count: 'exact' }]],
      ['eq', ['role', 'customer']],
      ['order', ['full_name']],
      ['order', ['id']],
      ['range', [100, 149]],
    ]);
    expect(LOYALTY_LEDGER_COLUMNS).not.toContain('*');
    expect(page.total).toBe(1234);
    expect(page.rows).toHaveLength(1);
  });

  it('throws the PostgREST error rather than returning an empty page', async () => {
    const chain: Record<string, (...a: unknown[]) => unknown> = {};
    for (const m of ['select', 'eq', 'order']) chain[m] = () => chain;
    chain.range = () => Promise.resolve({ data: null, count: null, error: { message: 'boom' } });
    vi.mocked(supabase.from).mockReturnValue(chain as never);
    await expect(profiles.loyaltyLedgerPage(0)).rejects.toThrow('boom');
  });
});

describe('loyalty.stats', () => {
  it('calls admin_loyalty_stats with no arguments', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { member_count: 3, points_total: 9 },
      error: null,
    } as never);
    await expect(loyalty.stats()).resolves.toEqual({ member_count: 3, points_total: 9 });
    expect(supabase.rpc).toHaveBeenCalledWith('admin_loyalty_stats');
  });
});

describe('lazywaitCatalog.items', () => {
  it('selects the declared columns and never the raw snapshot', async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null });
    vi.mocked(supabase.from).mockReturnValue({ select } as never);
    await lazywaitCatalog.items();
    expect(supabase.from).toHaveBeenCalledWith('lazywait_catalog_items');
    expect(select).toHaveBeenCalledWith(LAZYWAIT_CATALOG_ITEM_COLUMNS);
    const cols = LAZYWAIT_CATALOG_ITEM_COLUMNS.split(',').map((c) => c.trim());
    expect(cols).not.toContain('raw');
    expect(cols).not.toContain('*');
    // What the mapping screen reads.
    for (const c of ['id', 'entity_type', 'lazywait_id', 'name_en', 'name_ar', 'name_other', 'prices']) {
      expect(cols).toContain(c);
    }
  });
});

describe('push-dispatch error text', () => {
  it('prefers `error`', () => {
    expect(pushErrorMessage({ error: 'Admin MFA required', reason: 'x' }, 'fallback')).toBe(
      'Admin MFA required',
    );
  });

  it('falls back to `reason` — the dependency-failure body', () => {
    expect(
      pushErrorMessage({ status: 'error', reason: 'device lookup failed (transient)' }, 'fallback'),
    ).toBe('device lookup failed (transient)');
  });

  it('keeps the transport message when the body says nothing usable', () => {
    expect(pushErrorMessage(null, 'fallback')).toBe('fallback');
    expect(pushErrorMessage({ status: 'error' }, 'fallback')).toBe('fallback');
    expect(pushErrorMessage({ error: '  ', reason: 42 }, 'fallback')).toBe('fallback');
  });

  it('surfaces a `reason`-only 500 from a broadcast as the thrown message', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
        context: { json: async () => ({ status: 'error', reason: 'device lookup failed (transient)' }) },
      }),
    } as never);
    await expect(
      pushAdmin.broadcast({ titleEn: 'a', titleAr: 'b', bodyEn: 'c', bodyAr: 'd' }),
    ).rejects.toThrow('device lookup failed (transient)');
  });
});
