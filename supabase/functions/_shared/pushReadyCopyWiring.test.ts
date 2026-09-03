import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A source-shape tripwire for the `ready` push copy, in the idiom of
 * `adminAuthWiring.test.ts`, and honest about being one.
 *
 * `push-dispatch/index.ts` ends in `Deno.serve` and imports Deno-only modules, so
 * Vitest cannot load it and no test can execute its control flow. `STATUS_COPY` is
 * a module-level const and is not exported. That leaves the fix pinned by nothing:
 * someone could collapse the branch back to `STATUS_COPY[status]` in a tidy-up and
 * every other test would still pass.
 *
 * THE DEFECT THIS PINS. Delivery went live 2026-08-27 and the ladder is
 * `preparing → ready → out_for_delivery`, so a delivery order passes through
 * `ready` — and was sent the pickup body, in both languages, then contradicted
 * minutes later by "On the way". The in-app label is neutral, so the push was the
 * only surface making the claim.
 *
 * These assertions read the source as text, which is weaker than executing it.
 * That is the point: a rewrite of live customer messaging SHOULD have to look at
 * this file and decide deliberately.
 */

function source(): string {
  return readFileSync(new URL('../push-dispatch/index.ts', import.meta.url), 'utf8');
}

/**
 * The same source with comments removed.
 *
 * Load-bearing here, not defensive: the fix DOCUMENTS the defect by quoting the
 * old pickup wording in prose, so every assertion below would match the
 * explanation of the fix rather than the code. `adminAuthWiring.test.ts` records
 * this trap firing twice already.
 */
function code(): string {
  return source()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

describe('push-dispatch ready copy is order-type aware', () => {
  it('reads order_type on the row it already fetches', () => {
    // Without this the branch has nothing to branch on. It must come from the
    // ORDER ROW, never the request body — otherwise a caller picks the copy.
    expect(code()).toContain("select('id, customer_id, status, order_type')");
  });

  it('selects delivery copy for ready, and only for ready', () => {
    const c = code();
    expect(c).toContain("status === 'ready' && order.order_type === 'delivery'");
    expect(c).toContain('READY_DELIVERY_COPY');
  });

  it('no longer passes the status table straight to sendToDevices', () => {
    // The exact regression: collapsing the branch back to a bare table lookup.
    const c = code();
    expect(c).not.toContain('sendToDevices(admin, targets, STATUS_COPY[status]');
    expect(c).toContain('sendToDevices(admin, targets, copy,');
  });

  it('never tells a delivery customer to collect, in either language', () => {
    const delivery = /const READY_DELIVERY_COPY = \{[\s\S]*?\n\};/.exec(code())?.[0] ?? '';
    expect(delivery).not.toBe('');
    expect(delivery.toLowerCase()).not.toContain('pickup');
    expect(delivery.toLowerCase()).not.toContain('collect');
    expect(delivery).not.toContain('الاستلام');
  });

  it('leaves the PICKUP wording exactly as it was', () => {
    // The fix is additive. A delivery customer gets new copy; a pickup customer
    // must get the byte-identical message they got before, or this became a
    // rewrite of approved copy rather than a bug fix.
    const c = code();
    expect(c).toContain("body: 'Your order is ready for pickup.'");
    expect(c).toContain("body: 'طلبك جاهز للاستلام.'");
  });
});
