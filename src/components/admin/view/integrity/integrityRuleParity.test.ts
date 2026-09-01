/**
 * The admin rule filter must offer exactly the rules the watchdog evaluates.
 *
 * WHY THIS EXISTS. `RULE_CODES` is the ONLY source for the dropdown in
 * `IntegrityFilters.tsx`. The rules themselves live in a SQL migration. Nothing
 * connected the two, so when `UNPAID_ORDER_NOT_SYNCED` and
 * `UNPAID_ORDER_DEAD_LETTER` were added the list silently fell behind — review
 * caught it, no test did. The failure mode is quiet and bad: the new rules are
 * *critical*, so they raise incidents that page somebody and then cannot be
 * filtered like every other rule.
 *
 * Drift in the other direction matters too. A code left here after its rule is
 * removed puts a dead option in the dropdown that always returns nothing, which
 * reads as "no incidents of this kind" rather than "this rule no longer exists".
 * So the assertion is set EQUALITY, not containment.
 *
 * HOW THE RULES ARE READ. From the LATEST migration that redefines
 * `order_integrity_watchdog`, resolved by scanning rather than hardcoded — the
 * same approach as `orderConfirmationSqlParity.test.ts`, and for the same reason:
 * a hardcoded filename silently stops tracking the function the day somebody adds
 * a newer migration.
 *
 * The rule codes are extracted from the guard each rule is wrapped in,
 * `coalesce((v_rules->>'CODE'), 'true') <> 'false'`, which is what actually
 * decides whether a rule runs. Extracting from the INSERT's literal instead would
 * pass even if a rule were permanently disabled by a mismatched guard.
 */
import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { RULE_CODES } from './integrityView';

const MIGRATIONS_DIR = new URL('../../../../../supabase/migrations/', import.meta.url);
const FN = 'create or replace function public.order_integrity_watchdog()';

/** Strip `--` line comments so a commented-out rule guard cannot be counted. */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

function latestWatchdogMigration(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const matches = files.filter((f) =>
    readFileSync(new URL(f, MIGRATIONS_DIR), 'utf8').includes(FN));
  if (!matches.length) throw new Error(`no migration defines ${FN}`);
  return matches[matches.length - 1];
}

function rulesInMigration(file: string): string[] {
  const sql = stripSqlComments(readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8'));
  const codes = [...sql.matchAll(/v_rules->>'([A-Z_]+)'/g)].map((m) => m[1]);
  return [...new Set(codes)];
}

describe('admin rule filter ↔ watchdog rule set', () => {
  const file = latestWatchdogMigration();
  const sqlRules = rulesInMigration(file);

  it('resolves a migration that actually defines the function', () => {
    expect(file).toMatch(/\.sql$/);
    // A resolver that silently found nothing would make every assertion below
    // vacuously true, so the count is asserted as a floor rather than trusted.
    expect(sqlRules.length).toBeGreaterThanOrEqual(11);
  });

  it('offers exactly the rules the watchdog evaluates — no more, no fewer', () => {
    expect([...RULE_CODES].sort()).toEqual([...sqlRules].sort());
  });

  it('lists every code once', () => {
    expect(new Set(RULE_CODES).size).toBe(RULE_CODES.length);
  });

  it('includes the two cash-order rules, which is the drift that prompted this', () => {
    expect(RULE_CODES).toContain('UNPAID_ORDER_NOT_SYNCED');
    expect(RULE_CODES).toContain('UNPAID_ORDER_DEAD_LETTER');
  });
});
