import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * What the branch POS is told about a card payment, held to the records that
 * say who receives payment data. Gap PG-09 in
 * `docs/readiness/20261113-card-payments-gaps.md`.
 *
 * WHY THIS EXISTS. A card payment reaches Lazywait on the ticket itself: one
 * `order_payments` line built by `posOrderPayments` (`posPaidFlag.ts`) and sent
 * by lazywait-sync when the ticket is created paid. Until 2026-11-19 it went
 * by a separate call, `pushLazywaitOnlinePayment` (`paymentSync.ts`), which
 * was removed that day. Until 2026-11-13 the record of processing named
 * Moyasar as the only recipient of payment data. Nothing tied the request to
 * the records, so a field added to it would reach the POS with no record
 * anywhere that it does.
 *
 * WHAT IT CHECKS. The sources are read as text, which is weaker than running
 * them, and that is the point: a change to what the POS receives should have to
 * come here and decide.
 *   1. the payment line carries exactly the fields classified below, so a new
 *      one fails until it is classified and the records name it;
 *   2. those fields mean what the records say: the amount is the order's
 *      total, and the approval number is the Moyasar payment id;
 *   3. the removed call stays removed: nothing posts update-online-payment;
 *   4. the record of processing names, in activity 3 (ordering) and in
 *      activity 15 (online card payment), every customer field the POS gets,
 *      and says it travels on the ticket when it is created paid;
 *   5. the privacy draft's proposed Lazywait line, in both languages, still
 *      tells customers the POS can receive the amount and Moyasar's reference.
 */

const LINE = new URL('./posPaidFlag.ts', import.meta.url);
const SYNC = new URL('./paymentSync.ts', import.meta.url);
const VERIFY = new URL('./moyasarVerify.ts', import.meta.url);
const WORKER = new URL('../lazywait-sync/index.ts', import.meta.url);
const ROPA = new URL('../../../docs/RECORD_OF_PROCESSING.md', import.meta.url);
const PRIVACY_DRAFT = new URL('../../../docs/legal/PRIVACY_POLICY_CARD_PAYMENTS_DRAFT.md', import.meta.url);

/**
 * Each field of the payment line that says something about the customer's
 * payment, with the words the record of processing must use for it.
 */
const CUSTOMER_FIELDS: Record<string, RegExp> = {
  amount: /order(?:'|’)s total/, // the order total, which is the amount paid
  payment_amount: /order(?:'|’)s total/, // the same value: the field the POS list reads
  Approval_No: /Moyasar(?:'|’)s payment id/,
  transaction_uuid: /Moyasar(?:'|’)s payment id/, // the same id as Approval_No
  Card_Type: /card scheme \(such as mada or Visa\) and its last four digits/,
  Card_Number: /last four digits/, // masked: four asterisks + the last four
  names: /label naming the card brand or Apple Pay/,
};

/** Fixed values, about the payment line rather than the customer. */
const FIXED_FIELDS = ['status'];

/** Source without comments, so prose that quotes the code cannot satisfy a check. */
function code(url: URL): string {
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

/** The fields of the payment line: the `entry` literal plus later `entry.X =`. */
function lineFields(src: string): { fields: string[]; body: string } {
  const fn = src.indexOf('export function posOrderPayments(');
  if (fn < 0) throw new Error('posPaidFlag.ts no longer builds the payment line: re-read this test');
  const open = src.indexOf('const entry: Record<string, unknown> = {', fn);
  const close = src.indexOf('};', open);
  if (open < 0 || close < 0) throw new Error('could not find the payment line literal');
  const body = src.slice(open, close);
  const literal = [...body.matchAll(/(?:\{|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?=[:,])/g)].map((m) => m[1]);
  const end = src.indexOf('return [entry];', close);
  const later = [...src.slice(close, end).matchAll(/\bentry\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g)].map(
    (m) => m[1],
  );
  return { fields: [...new Set([...literal, ...later])], body: src.slice(open, end) };
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
    const { fields } = lineFields(code(LINE));
    // A floor, so a reader that silently found nothing cannot pass.
    expect(fields.length).toBeGreaterThanOrEqual(5);
    expect([...fields].sort()).toEqual([...Object.keys(CUSTOMER_FIELDS), ...FIXED_FIELDS].sort());
  });

  it('means what the records say it means', () => {
    const { body } = lineFields(code(LINE));
    expect(body).toMatch(/\bamount,/);
    expect(body).toMatch(/\bpayment_amount:\s*amount\b/);
    expect(body).toMatch(/Card_Type:\s*posCardType\(record\.card_scheme\)/);
    expect(body).toMatch(/Card_Number:\s*maskedCardNumber\(record\.card_last_four\)/);
    expect(body).toMatch(/\bstatus:\s*'approved'/);
    expect(body).toMatch(/entry\.Approval_No\s*=\s*ref\b/);
    expect(body).toMatch(/entry\.transaction_uuid\s*=\s*ref\b/);
    expect(code(LINE)).toMatch(/const ref = typeof record\.provider_ref === 'string'/);
    // The worker passes the order total and the paid record carrying Moyasar's payment id.
    expect(code(WORKER)).toMatch(/posOrderPayments\(\s*posIsPaid,\s*order\.total,/);
    expect(code(WORKER)).toMatch(/select\('id, provider_ref, card_scheme, card_last_four, raw'\)/);
  });

  it('is sent only on the ticket: the separate payment call stays removed', () => {
    for (const url of [SYNC, VERIFY, WORKER]) {
      expect(code(url)).not.toMatch(/update-online-payment|pushLazywaitOnlinePayment/);
    }
  });
});

describe('the record of processing names it', () => {
  it.each([3, 15])('activity %i names every customer field the POS receives', (n) => {
    const row = ropaRow(n);
    expect(row).toContain('Lazywait');
    expect(row).toContain('posPaidFlag.ts');
    for (const [field, words] of Object.entries(CUSTOMER_FIELDS)) {
      expect(row, `activity ${n} does not name ${field}`).toMatch(words);
    }
  });

  // WHEN it is sent: on the ticket, when it is created paid. Until 2026-11-19 a
  // separate call sent it on every confirmation; these rows must not say that
  // is still so.
  it.each([3, 15])('activity %i says it travels on the ticket when it is created paid', (n) => {
    const row = ropaRow(n);
    expect(row).toMatch(/sent when the ticket is created paid|It is sent when the ticket is created paid/);
    expect(row).not.toMatch(/It is sent each time our server confirms/);
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
        "Lazywait — the point-of-sale system in our branches, which receives your order so the kitchen can prepare it. If you pay online, it can also receive the amount paid, your card's type (such as mada or Visa) and its last four digits, and Moyasar's reference for the payment.",
      ),
    ).toBe(2);
  });

  it('in Arabic, in the full section and in the line to publish', () => {
    expect(
      count(
        'Lazywait — نظام نقاط البيع في فروعنا، ويستقبل طلبك ليتمكن المطبخ من تحضيره. وعند الدفع الإلكتروني، قد يستقبل أيضاً المبلغ المدفوع ونوع بطاقتك (مثل مدى أو Visa) وآخر أربعة أرقام منها، والرقم المرجعي للدفعة لدى Moyasar.',
      ),
    ).toBe(2);
  });
});
