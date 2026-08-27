import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A source-shape tripwire for order-intake's immediate POS sync, in the same
 * spirit as `adminAuthWiring.test.ts` and `lazywaitBaseUrlWiring.test.ts`, and
 * equally honest about its limits: the handler imports Deno-only modules, so
 * Vitest cannot execute it and `deno check` only typechecks. What no other test
 * can pin is the ORDERING and the GATING of two side effects, and both of those
 * are the whole customer-visible behaviour.
 *
 * THE DEFECT THIS EXISTS FOR. The sync kick was written as
 * `if (order_type === 'pickup')`, correct only while the insert trigger parked
 * every delivery order at `blocked`. Once migration 20260827120000 opened that
 * gate, the leftover condition meant a delivery order never got its immediate
 * kick and fell through to the once-a-minute cron: measured at 17.8-44.6 s from
 * placing the order to the branch number appearing, every one a first-attempt
 * success, so the wait was the tick and never the POS.
 *
 * It also produced the false "sent it to the kitchen" push, because the push
 * fires AFTER the sync block — so skipping the block for delivery meant telling
 * the customer the kitchen had an order that had not been sent anywhere.
 */
const SRC = readFileSync(new URL('../order-intake/index.ts', import.meta.url), 'utf8');

/** Source with `//` comments stripped — this file DOCUMENTS the old condition. */
const CODE = SRC.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

describe('order-intake — immediate POS sync wiring', () => {
  it('does NOT gate the sync kick on order type', () => {
    // The exact leftover, and anything shaped like it.
    expect(CODE).not.toMatch(/order_type\s*\)?\s*===\s*['"]pickup['"]/);
    expect(CODE).not.toMatch(/===\s*['"]pickup['"]\s*\)\s*\{/);
  });

  it('still kicks the worker, with the server-side secret', () => {
    expect(CODE).toContain('/functions/v1/lazywait-sync');
    expect(CODE).toContain("'x-sync-secret'");
    // The secret is read server-side and must never be spelled into the response.
    expect(CODE).toContain('sync_trigger_secret');
  });

  it('attempts the sync BEFORE telling the customer their order was received', () => {
    // This ordering is the honesty property: the push must not claim the
    // kitchen has an order that has not been sent. Positional, deliberately.
    const sync = CODE.indexOf('/functions/v1/lazywait-sync');
    const push = CODE.indexOf('/functions/v1/push-dispatch');
    expect(sync).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(-1);
    expect(sync).toBeLessThan(push);
  });

  it('keeps the sync non-fatal — a POS problem can never fail the order', () => {
    // The kick sits inside a try/catch that swallows, and is bounded.
    expect(CODE).toContain('SYNC_TIMEOUT_MS');
    expect(CODE).toContain('AbortSignal.timeout');
  });
});
