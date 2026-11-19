import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * What the branch POS is told about a card payment, held to the records that
 * say who receives payment data. Gap PG-09 in
 * `docs/readiness/20261113-card-payments-gaps.md`.
 *
 * WHY THIS EXISTS. Once a card payment is confirmed, `pushLazywaitOnlinePayment`
 * (`paymentSync.ts`) sends Lazywait the order's total, Moyasar's payment id and
 * the payment type "Online Credit Card" (the bare word "card" until
 * 2026-11-19). Until 2026-11-13 the record of processing named Moyasar as
 * the only recipient of payment data, and on 2026-11-14 its ordering activity
 * (3) still did not say it. Nothing tied the request to the records, so a field
 * added to it would reach the POS with no record anywhere that it does.
 *
 * WHAT IT CHECKS. The sources are read as text, which is weaker than running
 * them, and that is the point: a change to what the POS receives should have to
 * come here and decide.
 *   1. the request carries exactly the fields classified below, so a new one
 *      fails until it is classified and the records name it;
 *   2. those fields mean what the records say: the total is the order's, and
 *      the approval number is the Moyasar payment id;
 *   3. the record of processing names, in activity 3 (ordering) and in
 *      activity 15 (online card payment), every customer field the POS gets;
 *      and both say it is sent each time the payment is confirmed while the
 *      POS holds the order, which paymentPosTiming.test.ts measures;
 *   4. the privacy draft's proposed Lazywait line, in both languages, still
 *      tells customers the POS can receive the amount and Moyasar's reference.
 */

const SYNC = new URL('./paymentSync.ts', import.meta.url);
const VERIFY = new URL('./moyasarVerify.ts', import.meta.url);
const ROPA = new URL('../../../docs/RECORD_OF_PROCESSING.md', import.meta.url);
const PRIVACY_DRAFT = new URL('../../../docs/legal/PRIVACY_POLICY_CARD_PAYMENTS_DRAFT.md', import.meta.url);

/**
 * Each field the POS receives, and what it tells the POS about the customer,
 * with the words the record of processing must use for it.
 */
const CUSTOMER_FIELDS: Record<string, RegExp> = {
  Trans_Amount: /order(?:'|’)s total/, // the order total, which is the amount paid
  Approval_No: /Moyasar(?:'|’)s payment id/,
  Card_Type: /the words "Online Credit Card"/, // always the constant ONLINE_PAYMENT_TYPE
};

/** Our own integration identifiers: about our POS account, not the customer. */
const INTEGRATION_FIELDS = ['client_id', 'branch_id', 'order_ref'];

/** Source without comments, so prose that quotes the code cannot satisfy a check. */
function code(url: URL): string {
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/** The keys of the object literal sent as `body` to update-online-payment. */
function postedFields(src: string): { fields: string[]; body: string } {
  const at = src.indexOf("path: '/pos/orders/update-online-payment'");
  if (at < 0) throw new Error('paymentSync.ts no longer posts update-online-payment: re-read this test');
  const open = src.indexOf('body: {', at);
  const close = src.indexOf('}', open);
  if (open < 0 || close < 0) throw new Error('could not find the request body');
  const body = src.slice(open + 'body: {'.length, close);
  const fields = [...body.matchAll(/(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1]);
  return { fields, body };
}

function ropaRow(n: number): string {
  const row = readFileSync(ROPA, 'utf8')
    .split('\n')
    .find((line) => line.startsWith(`| ${n} | `));
  if (!row) throw new Error(`RECORD_OF_PROCESSING.md has no activity ${n} row`);
  return row;
}

describe('what the POS receives about a card payment', () => {
  it('is exactly the classified fields, no more and no fewer', () => {
    const { fields } = postedFields(code(SYNC));
    // A floor, so a reader that silently found nothing cannot pass.
    expect(fields.length).toBeGreaterThanOrEqual(3);
    expect([...fields].sort()).toEqual([...Object.keys(CUSTOMER_FIELDS), ...INTEGRATION_FIELDS].sort());
  });

  it('means what the records say it means', () => {
    const { body } = postedFields(code(SYNC));
    expect(body).toMatch(/Trans_Amount:\s*round2\(Number\(order\.total\b/);
    expect(body).toMatch(/Card_Type:\s*ONLINE_PAYMENT_TYPE\b/);
    expect(code(SYNC)).toMatch(/export const ONLINE_PAYMENT_TYPE = 'Online Credit Card';/);
    expect(body).toMatch(/Approval_No:\s*approvalNo\b/);
    // The approval number is the Moyasar PAYMENT id: the only caller passes it.
    const verify = code(VERIFY);
    const calls = [...verify.matchAll(/pushLazywaitOnlinePayment\(([\s\S]*?)\)\s*\.catch/g)];
    expect(calls).toHaveLength(1);
    expect(calls[0][1].trim()).toMatch(/,\s*paymentId,?$/);
  });
});

describe('the record of processing names it', () => {
  it.each([3, 15])('activity %i names every customer field the POS receives', (n) => {
    const row = ropaRow(n);
    expect(row).toContain('Lazywait');
    expect(row).toContain('paymentSync.ts');
    for (const [field, words] of Object.entries(CUSTOMER_FIELDS)) {
      expect(row, `activity ${n} does not name ${field}`).toMatch(words);
    }
  });

  // WHEN it is sent, as paymentPosTiming.test.ts measures it: on every
  // confirmation while the POS holds the order, so possibly more than once.
  // The first version of these rows said "once" and "nothing sends it later".
  it.each([3, 15])('activity %i says it is sent each time the payment is confirmed', (n) => {
    const row = ropaRow(n);
    expect(row).toMatch(/each time (?:it|our server) confirms the payment while the POS holds the order/);
    expect(row).not.toMatch(/sent once|nothing sends it later/i);
  });
});

describe('the privacy draft tells customers', () => {
  const draft = readFileSync(PRIVACY_DRAFT, 'utf8');
  const proposed = draft.slice(
    draft.indexOf('\n## Proposed text'),
    draft.indexOf('\n## What changed and why'),
  );

  it('finds its proposed text', () => {
    expect(proposed.length).toBeGreaterThan(1000);
  });

  // Twice per language, because the draft gives each edit twice: inside the full
  // WHO WE SHARE IT WITH section, and again as the single line to publish. A
  // check that accepted either copy let one of them be dropped unnoticed.
  const count = (needle: string) => proposed.split(needle).length - 1;

  it('in English, in the full section and in the line to publish', () => {
    expect(
      count(
        "Lazywait — the point-of-sale system in our branches, which receives your order so the kitchen can prepare it. If you pay online, it can also receive the amount paid and Moyasar's reference for the payment.",
      ),
    ).toBe(2);
  });

  it('in Arabic, in the full section and in the line to publish', () => {
    expect(
      count(
        'Lazywait — نظام نقاط البيع في فروعنا، ويستقبل طلبك ليتمكن المطبخ من تحضيره. وعند الدفع الإلكتروني، قد يستقبل أيضاً المبلغ المدفوع والرقم المرجعي للدفعة لدى Moyasar.',
      ),
    ).toBe(2);
  });
});
