import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CUSTOMER_ORDER_COLUMNS, INTERNAL_ONLY_ORDER_COLUMNS } from './orderSelect';

/**
 * THE GUARD THAT WAS MISSING, and the outage that proves it was needed.
 *
 * `orderSelect.test.ts` pins the select LITERAL to the column ARRAYS, so the
 * client cannot drift from itself. Nothing compared either of them to the
 * DATABASE, and that is the gap a customer fell through.
 *
 * `authenticated` holds COLUMN-LEVEL select grants on `public.orders` — an
 * allowlist, which is why `order_number`, `customer_phone` and the operational
 * sync columns are withheld. A column-level grant does not extend to columns
 * added afterwards.
 *
 * On 2026-08-26 `20260826100000_comp_order_totals.sql` added `orders.is_comped`
 * and `orders.comp_discount_amount` without granting them, and the same day #269
 * added both to CUSTOMER_ORDER_COLUMNS. PostgREST refuses the WHOLE query when
 * one column is unreadable, so from that moment every "My Orders" and every
 * post-order receipt returned
 *
 *   42501: permission denied for table orders
 *
 * and the app rendered "حدث خطأ ما." — on the live web channel, and on any
 * binary built after that date. It ran for three weeks. It survived because the
 * only iOS build in TestFlight predated the change by ONE DAY, so the bug was
 * invisible on the one artifact anyone was running.
 *
 * Two source files agreeing with each other is not a contract. This test makes
 * the third party — the grant — fail CI when it drifts.
 */

const MIGRATION = new URL(
  '../../../../supabase/migrations/20260922120000_orders_comp_columns_customer_grant.sql',
  import.meta.url,
);

/**
 * The SQL suite's own copy of the same list. It is the reason this test checks
 * THREE lists rather than two.
 *
 * `order_read_contracts_test.sql` CASE 1 pins the grant to a hand-written array,
 * and its comment describes this exact failure — "a column reaching the customer
 * selector without its grant breaks every order read". It passed for three weeks
 * anyway, because that array was never updated either: it agreed with the grant,
 * and both disagreed with the client. A test comparing the database to a
 * hand-written copy of the database can only catch a change to the database.
 */
const SQL_SUITE = new URL('../../../../supabase/tests/order_read_contracts_test.sql', import.meta.url);

/** Pull a quoted identifier list out of a named `unnest(array[...])` block. */
function columnsFromArrayLiteral(sql: string, afterMarker: string): string[] {
  const start = sql.indexOf(afterMarker);
  expect(start, `marker not found in migration: ${afterMarker}`).toBeGreaterThan(-1);
  const open = sql.indexOf('array[', start);
  const close = sql.indexOf(']', open);
  expect(open, 'array[ not found after marker').toBeGreaterThan(-1);
  expect(close, '] not found after array[').toBeGreaterThan(open);
  return [...sql.slice(open, close).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('customer order select ↔ database grant parity', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  /**
   * The migration's first assertion block enumerates every column the customer
   * read contract needs `authenticated` to be able to select. If somebody adds a
   * column to CUSTOMER_ORDER_COLUMNS and does not grant it, this fails here
   * rather than on a customer's phone.
   */
  it('the migration asserts exactly the customer column contract', () => {
    const asserted = columnsFromArrayLiteral(sql, 'customer read contract');
    expect([...asserted].sort()).toEqual([...CUSTOMER_ORDER_COLUMNS].sort());
  });

  /**
   * The regression itself. Named explicitly so the reason survives the diff.
   */
  it.each(['is_comped', 'comp_discount_amount'])(
    'grants %s — the column whose absence broke My Orders for three weeks',
    (col) => {
      expect(CUSTOMER_ORDER_COLUMNS).toContain(col);
      expect(sql).toMatch(
        new RegExp(
          `grant\\s+select\\s*\\([^)]*\\b${col}\\b[^)]*\\)\\s+on\\s+public\\.orders\\s+to\\s+authenticated`,
          'i',
        ),
      );
    },
  );

  /**
   * The grant must not quietly widen the other direction. Every column the
   * migration re-asserts as withheld has to be one the client contract already
   * calls internal-only — otherwise the two documents disagree about what a
   * customer may see.
   */
  it('re-asserts only genuinely internal columns as withheld', () => {
    const withheld = columnsFromArrayLiteral(sql, 'withheld set must stay withheld');
    expect(withheld.length).toBeGreaterThan(0);
    for (const col of withheld) {
      expect(INTERNAL_ONLY_ORDER_COLUMNS, `${col} is asserted withheld but is not internal-only`).toContain(
        col,
      );
      expect(CUSTOMER_ORDER_COLUMNS, `${col} is both withheld and in the customer contract`).not.toContain(
        col,
      );
    }
  });

  /**
   * The third list. With this, every place that states what a customer may read
   * is pinned to CUSTOMER_ORDER_COLUMNS rather than to one of the others.
   */
  it('the SQL suite pins the same contract', () => {
    const suite = readFileSync(SQL_SUITE, 'utf8');
    const expected = columnsFromArrayLiteral(suite, 'v_expected text[] :=');
    expect([...expected].sort()).toEqual([...CUSTOMER_ORDER_COLUMNS].sort());
  });

  /** `anon` must gain nothing: it holds no select on `orders` at all. */
  it('never grants anything to anon', () => {
    expect(sql).not.toMatch(/grant\s+select[^;]*\bto\s+anon\b/i);
  });

  /**
   * A column grant cannot bypass a row policy, and the migration is only safe
   * because RLS scopes rows to the owner. If that stops being checked, the grant
   * becomes the only thing between one customer and another's orders.
   */
  it('asserts RLS is still enabled on orders', () => {
    expect(sql).toMatch(/relrowsecurity/);
  });
});
