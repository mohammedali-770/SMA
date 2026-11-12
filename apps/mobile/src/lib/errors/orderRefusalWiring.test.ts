/**
 * How an order refusal reaches the customer, end to end.
 *
 *   place_customer_order raises P0001 with an English sentence
 *   → order-intake returns { error: error.message } with HTTP 400
 *   → placeAndSync throws an Error carrying that sentence
 *   → CheckoutScreen calls failureMessage(e, t, …)
 *   → describeFailure maps the sentence to a key, rendered in the active language.
 *
 * Before 20261005120000, placeAndSync threw supabase-js's own message ("Edge
 * Function returned a non-2xx status code") and discarded the body, so every
 * refusal read as the generic apology. The screens are React Native and
 * services/api.ts imports the Supabase client, so the wiring is asserted on
 * the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('order refusal wiring', () => {
  it('order-intake passes the RPC message through as the error body', () => {
    const intake = read('supabase/functions/order-intake/index.ts');
    expect(intake).toContain("'place_customer_order'");
    expect(intake).toContain('if (error) return json({ error: error.message }, 400);');
  });

  it('placeAndSync throws the server sentence, not the client wrapper', () => {
    const api = read('apps/mobile/src/services/api.ts');
    const start = api.indexOf('async placeAndSync(');
    const body = api.slice(start, api.indexOf('\n  },', start));
    expect(body).toContain('if (error) throw new Error(await functionErrorText(error));');
    expect(body).not.toContain('if (error) throw new Error(error.message);');
    expect(api).toMatch(
      /async function functionErrorText\([^)]*\): Promise<string> \{[\s\S]*?ctx\.json\(\)[\s\S]*?body\.error[\s\S]*?return error\.message;/,
    );
  });

  it('the cash checkout renders the failure through failureMessage', () => {
    const screen = read('apps/mobile/src/features/checkout/CheckoutScreen.tsx');
    expect(screen).toContain('await orders.placeAndSync(orderInput);');
    expect(screen).toContain("setError(failureMessage(e, t, { subsystem: 'checkout', op: 'place_order' }));");
  });
});
