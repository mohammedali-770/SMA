/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * The branch console must survive a missing optional table.
 *
 * `20260917120000_branch_reference_entries` is merged but NOT applied, so in
 * Production `branch_reference_entries` does not exist. `branchReference()` ran
 * its error through `fail()`, which throws — and the console's refresh awaits
 * it, so one absent optional table took down the WHOLE branch console, including
 * the availability controls staff use mid-service to snooze a sold-out item.
 * (2026-09-13 security audit, finding 2.7.)
 *
 * The degradation is deliberately NARROW, and both halves are pinned here:
 * "relation does not exist" is swallowed; anything else — a permission error, a
 * network failure — still raises, because those mean something an operator
 * needs to see rather than a feature that has not shipped yet.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const from = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ supabase: { from, rpc: vi.fn() } }));

import { opsApi } from './opsApi';

/** Minimal PostgREST builder: every chained call returns the same thenable. */
function builder(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'not']) {
    b[m] = () => b;
  }
  // The call site awaits the builder directly.
  (b as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(result);
  return b;
}

beforeEach(() => from.mockReset());

describe('opsApi.branchReference — missing-table resilience', () => {
  it('returns [] when the table does not exist (Postgres 42P01)', async () => {
    from.mockReturnValue(
      builder({ data: null, error: { code: '42P01', message: 'relation does not exist' } }),
    );
    await expect(opsApi.branchReference('b1')).resolves.toEqual([]);
  });

  it('returns [] on PostgREST schema-cache miss (PGRST205)', async () => {
    from.mockReturnValue(
      builder({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }),
    );
    await expect(opsApi.branchReference('b1')).resolves.toEqual([]);
  });

  it('STILL THROWS on a permission error — this must not be swallowed', async () => {
    // The whole point of the narrow check. A 42501 means the operator is not
    // allowed to see this, which is not the same as "the feature is not live".
    from.mockReturnValue(builder({ data: null, error: { code: '42501', message: 'permission denied' } }));
    await expect(opsApi.branchReference('b1')).rejects.toThrow(/permission denied/);
  });

  it('STILL THROWS on an error carrying no code at all', async () => {
    from.mockReturnValue(builder({ data: null, error: { message: 'network unreachable' } }));
    await expect(opsApi.branchReference('b1')).rejects.toThrow(/network unreachable/);
  });

  it('maps rows normally when the table is present', async () => {
    from.mockReturnValue(
      builder({
        data: [
          {
            id: 'e1',
            branch_id: 'b1',
            kind: 'link',
            label_en: 'Portal',
            label_ar: 'البوابة',
            value_plain: 'https://example.test',
            sort_order: 2,
          },
        ],
        error: null,
      }),
    );
    await expect(opsApi.branchReference('b1')).resolves.toEqual([
      {
        id: 'e1',
        branchId: 'b1',
        kind: 'link',
        labelEn: 'Portal',
        labelAr: 'البوابة',
        valuePlain: 'https://example.test',
        sortOrder: 2,
      },
    ]);
  });
});

/**
 * THE SAME NARROWNESS, FOR THE TIER READS — and the wide version shipped here
 * first, which is why this block exists.
 *
 * Both variant reads used `if (error) return []`, swallowing everything. Review
 * caught it on #408: for the call-centre board that converts "could not read the
 * table" into "no sizes are closed", so the board prints EVERY BRANCH IS RUNNING
 * NORMALLY on an unread table — the exact monitor-blindness #408 exists to fix,
 * reintroduced by its own fix.
 */
describe('opsApi variant-availability reads — narrow resilience', () => {
  // ONLY the board's read. `branchVariantAvailability` deliberately keeps the
  // wide swallow -- see the comment on it, and `opsVariantClosing.test.ts`,
  // which pins that behaviour for the reason #395 established. The first draft
  // of this change narrowed BOTH and that existing test caught it, which is the
  // useful part: the two call sites want opposite things.
  const cases = [
    ['allVariantAvailability', () => opsApi.allVariantAvailability()],
  ] as const;

  for (const [name, call] of cases) {
    it(`${name} returns [] when the table does not exist (42P01)`, async () => {
      from.mockReturnValue(
        builder({ data: null, error: { code: '42P01', message: 'relation does not exist' } }),
      );
      await expect(call()).resolves.toEqual([]);
    });

    it(`${name} returns [] on a PostgREST schema-cache miss (PGRST205)`, async () => {
      from.mockReturnValue(
        builder({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }),
      );
      await expect(call()).resolves.toEqual([]);
    });

    it(`${name} STILL THROWS on a permission error`, async () => {
      // "Not allowed to see this" is not "the feature is not live". Reporting an
      // all-clear built on a read the operator was refused is the worst output.
      from.mockReturnValue(
        builder({ data: null, error: { code: '42501', message: 'permission denied' } }),
      );
      await expect(call()).rejects.toThrow(/permission denied/);
    });

    it(`${name} STILL THROWS on an error carrying no code at all`, async () => {
      from.mockReturnValue(builder({ data: null, error: { message: 'network unreachable' } }));
      await expect(call()).rejects.toThrow(/network unreachable/);
    });
  }
});
