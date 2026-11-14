/**
 * How a cancelled order reaches the customer, end to end (gap PG-03).
 *
 *   orders.status = 'cancelled'
 *   → ConfirmationHero and OrderCard pass the whole Order to orderConfirmationState
 *   → 'order_cancelled': "Order cancelled", no Resend (orderConfirmation.test.ts)
 *
 *   and, when Resend was pressed on a screen loaded before the cancellation:
 *   request_customer_pos_resend answers {outcome:'unavailable', reason:'order_cancelled', message}
 *   → ReceiptScreen shows oc_resend_cancelled, then re-reads the order.
 *
 * The screens are React Native and services/api.ts imports the Supabase
 * client, so the wiring is asserted on the source, as in orderRefusalWiring.
 * The server half is asserted on the latest migration that defines the
 * function, which is the definition this app is built against.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STRINGS } from '../../i18n/strings';

const ROOT = resolve(__dirname, '../../../../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

/** The body of the newest migration that (re)defines request_customer_pos_resend. */
function latestResendDefinition(): { file: string; body: string } {
  const dir = resolve(ROOT, 'supabase/migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const re = /create\s+or\s+replace\s+function\s+public\.request_customer_pos_resend\s*\(/i;
  const file = files.filter((f) => re.test(readFileSync(resolve(dir, f), 'utf8'))).pop();
  expect(file, 'no migration defines request_customer_pos_resend').toBeDefined();
  const sql = readFileSync(resolve(dir, file as string), 'utf8');
  const start = sql.search(re);
  const end = sql.indexOf('end $$;', start);
  expect(end, 'end of request_customer_pos_resend not found').toBeGreaterThan(start);
  return { file: file as string, body: sql.slice(start, end) };
}

describe('cancelled order wiring', () => {
  it('the server refuses a cancelled order with the reason and message the app reads', () => {
    // Any later redefinition must keep the refusal, or this fails.
    const { body } = latestResendDefinition();
    expect(body).toContain("if v_order.status = 'cancelled' then");
    expect(body).toContain("'reason','order_cancelled'");
    expect(body).toContain("else 'order_cancelled' end;");
    // The English the server sends is the English the app shows.
    expect(body).toContain(`'message','${STRINGS.en.oc_resend_cancelled}'`);
  });

  it('the receipt shows the cancelled-resend message for that reason', () => {
    const screen = read('apps/mobile/src/features/orders/ReceiptScreen.tsx');
    expect(screen).toContain('const res = await orders.requestResend(orderId);');
    expect(screen).toContain(
      "if (res?.reason === 'order_cancelled') setResendError(t('oc_resend_cancelled'));",
    );
  });

  it('the hero and the card read the state from the whole order, status included', () => {
    expect(read('apps/mobile/src/features/orders/view/ConfirmationHero.tsx')).toContain(
      'orderConfirmationState(order)',
    );
    const card = read('apps/mobile/src/features/orders/view/OrderCard.tsx');
    expect(card).toContain('const state = orderConfirmationState(order);');
    // The card's status pill already says Cancelled; the second pill is dropped.
    expect(card).toContain("{state !== 'order_cancelled' ? (");
  });

  it('every new line exists in both languages', () => {
    for (const key of ['oc_cancelled', 'oc_cancelled_body', 'oc_resend_cancelled'] as const) {
      expect(STRINGS.en[key].length, key).toBeGreaterThan(0);
      expect(STRINGS.ar[key].length, key).toBeGreaterThan(0);
      expect(STRINGS.ar[key], key).not.toBe(STRINGS.en[key]);
    }
  });

  it('the hero and body match the live "cancelled" push, word for word', () => {
    const push = read('supabase/functions/push-dispatch/index.ts');
    const block = push.slice(
      push.indexOf('  cancelled: {'),
      push.indexOf('};', push.indexOf('  cancelled: {')),
    );
    expect(block).toContain(
      `en: { title: '${STRINGS.en.oc_cancelled}', body: '${STRINGS.en.oc_cancelled_body}' }`,
    );
    expect(block).toContain(
      `ar: { title: '${STRINGS.ar.oc_cancelled}', body: '${STRINGS.ar.oc_cancelled_body}' }`,
    );
  });
});
