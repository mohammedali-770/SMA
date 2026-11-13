/**
 * Call-site wiring for the 2026-11-12 console load fixes, read from source with
 * comments stripped (so a comment describing the old code cannot satisfy, or
 * fail, an assertion).
 *
 *   - the Lazywait monitor passes its 200-order limit;
 *   - the staff sign-in path no longer reads every profile, and starts the
 *     catalog and orders through `runStaffInitialLoad` rather than in series;
 *   - Settings → Loyalty no longer sums `profiles` from context.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LAZYWAIT_MONITOR_ROWS } from '../components/admin/LazywaitPanel';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Remove block and line comments, leaving string contents alone. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += src[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else {
      if (c === "'" || c === '"' || c === '`') quote = c;
      out += c;
      i++;
    }
  }
  return out;
}

/** The text of `const <name> = useCallback(...)` up to the next top-level `const`. */
function callbackBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = useCallback(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = src.indexOf('\n  const ', start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

describe('Lazywait monitor', () => {
  it('reads the server-filtered sync feed, 50 rows, with no client-side filter', () => {
    expect(LAZYWAIT_MONITOR_ROWS).toBe(50);
    const src = stripComments(read('src/components/admin/LazywaitPanel.tsx'));
    expect(src).toContain('ordersApi.lazywaitMonitor(LAZYWAIT_MONITOR_ROWS)');
    expect(src).not.toMatch(/ordersApi\.list\(/);
    expect(src).not.toMatch(/\.filter\(/);
    expect(src).not.toMatch(/\bDbOrder\b/);
  });

  it('no console source reads the general staff feed', () => {
    const files = [
      'src/lib/api.ts',
      'src/context/AppContext.tsx',
      'src/components/admin/LazywaitPanel.tsx',
      'src/components/admin/StatsPanel.tsx',
      'src/components/admin/ReportsPanel.tsx',
      'src/components/admin/view/orders/OrdersRequiringVerificationCard.tsx',
    ];
    for (const f of files) {
      const src = stripComments(read(f));
      expect(src, f).not.toMatch(/ordersApi\.list\(/);
      expect(src, f).not.toMatch(/['"]admin_list_orders['"]/);
    }
  });

  it('Push Tools counts through the RPC, not a push_devices read', () => {
    const api = stripComments(read('src/lib/api.ts'));
    expect(api).not.toMatch(/from\(\s*['"]push_devices['"]\s*\)/);
    expect(api).toContain("rpc('customer_push_device_counts')");
  });
});

describe('staff sign-in load', () => {
  const ctx = stripComments(read('src/context/AppContext.tsx'));
  const body = callbackBody(ctx, 'loadEverything');

  it('reads no profile list', () => {
    expect(ctx).not.toMatch(/profilesApi/);
    expect(body).not.toMatch(/from\(\s*'profiles'\s*\)/);
    expect(body).not.toMatch(/profiles\s*\.\s*list\s*\(/);
  });

  it('starts catalog and orders together for staff, through runStaffInitialLoad', () => {
    expect(body).toMatch(
      /runStaffInitialLoad\(\{\s*loadCatalog:\s*refreshCatalog,\s*loadOrders:\s*refreshOrders,\s*onCatalog:\s*selectDefaultBranch/,
    );
    // The staff arm must not await the catalog and then the orders in series.
    const staffArm = body.slice(body.indexOf("if (user.role === 'customer')"));
    const afterCustomer = staffArm.slice(staffArm.indexOf('return;') + 'return;'.length);
    expect(afterCustomer).not.toMatch(/await refreshCatalog\(\)/);
    expect(afterCustomer).not.toMatch(/await refreshOrders\(\)/);
  });

  it('keeps the ops-console roles on the catalog-only path', () => {
    const ops = body.slice(body.indexOf('if (isOpsConsoleRole(user.role))'));
    const opsArm = ops.slice(0, ops.indexOf('return;'));
    expect(opsArm).toContain('await refreshCatalog()');
    expect(opsArm).not.toContain('refreshOrders');
  });

  it('no longer offers updateCustomerPoints, whose delta came from the profile list', () => {
    expect(ctx).not.toMatch(/updateCustomerPoints/);
  });
});

describe('Settings → Loyalty', () => {
  it('reads its own totals and ledger instead of summing `profiles` from context', () => {
    const settings = stripComments(read('src/components/admin/SettingsPanel.tsx'));
    expect(settings).not.toMatch(/\bprofiles\b/);
    expect(settings).toContain('<LoyaltyLedgerSection');
    const ledger = stripComments(read('src/components/admin/LoyaltyLedgerSection.tsx'));
    expect(ledger).toContain('loyaltyApi.stats()');
    expect(ledger).toContain('profilesApi.loyaltyLedgerPage(');
    expect(ledger).not.toMatch(/useApp\(/);
  });

  it('mounts the section only on the Loyalty sub-tab', () => {
    const settings = stripComments(read('src/components/admin/SettingsPanel.tsx'));
    const tab = settings.indexOf("settingsSubTab === 'loyalty' && (");
    const mount = settings.indexOf('<LoyaltyLedgerSection');
    const nextTab = settings.indexOf("settingsSubTab === 'support' && (");
    expect(tab).toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(tab);
    expect(mount).toBeLessThan(nextTab);
  });
});
