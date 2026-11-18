import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { STRINGS } from '../../i18n/strings';
import type { CustomerOrderState } from './orderConfirmation';
import { awaitingBranchNumber, waitingPhase, WAITING_SLOW_AFTER_MS } from './receiptGate';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the order page appears only with the branch order number (owner, 2026-11-18)', () => {
  it('shows the waiting window, never the page, while the order is in flight', () => {
    expect(awaitingBranchNumber('sending_to_branch')).toBe(true);
  });

  it('shows the page at once for every other state', () => {
    const others: CustomerOrderState[] = [
      'payment_pending',
      'accepted_no_pos_channel',
      'accepted_no_pos_channel_unpaid',
      'confirmed_by_branch',
      'verifying_with_branch',
      'branch_failed_retry_available',
      'unpaid_branch_failed_retry_available',
      'final_failure_refund_pending',
      'final_failure_refunded',
      'final_failure_refund_failed',
      'unpaid_final_failure',
      'order_cancelled',
    ];
    for (const s of others) expect(awaitingBranchNumber(s), s).toBe(false);
  });

  it('a slow POS changes the window, it never falls back to the page', () => {
    expect(WAITING_SLOW_AFTER_MS).toBe(30_000);
    expect(waitingPhase(0)).toBe('active');
    expect(waitingPhase(WAITING_SLOW_AFTER_MS - 1)).toBe('active');
    expect(waitingPhase(WAITING_SLOW_AFTER_MS)).toBe('slow');
    expect(waitingPhase(10 * 60_000)).toBe('slow');
  });
});

describe('the receipt screen is wired to the gate', () => {
  const screen = code(read('ReceiptScreen.tsx'));

  it('renders the waiting window while awaiting the number, with no time-based fallback to the page', () => {
    expect(screen).toContain(
      'const waiting = order != null && awaitingBranchNumber(orderConfirmationState(order));',
    );
    expect(screen).toContain(') : waiting ? (');
    expect(screen).toContain('<OrderWaitingView');
    expect(screen).not.toMatch(/showFullReceipt|RECEIPT_WAIT_FOR_NUMBER_MS|holdForNumber/);
  });

  it('marks a card order as paid in the window, and offers My Orders when slow', () => {
    expect(screen).toContain("paid={order.paymentStatus === 'paid' && order.paymentMethod === 'online'}");
    expect(screen).toContain("onViewOrders={() => leave('/(tabs)/orders')}");
  });

  it('starts polling without needing the order to be loaded first', () => {
    expect(screen).toContain('return startReceiptPolling({');
    expect(screen).toContain('getOrder: () => orderRef.current,');
  });
});

describe('the waiting window', () => {
  const view = code(read('view/OrderWaitingView.tsx'));

  it('asks the customer to keep the app open, in both languages', () => {
    expect(STRINGS.en.ow_body).toBe(
      'Please keep the app open. Your order number will appear here in a few seconds.',
    );
    expect(STRINGS.ar.ow_body).toBe('فضلاً لا تُغلق التطبيق. سيظهر رقم طلبك هنا خلال ثوانٍ.');
    expect(STRINGS.ar.ow_title).toBe('جارٍ تأكيد طلبك…');
  });

  it('shows a live counter and a turning ring while active, and removes both when slow', () => {
    expect(view).toContain('<Text style={styles.count}>{seconds}</Text>');
    expect(view).toContain("if (phase === 'slow') return undefined;");
    expect(view).toContain("if (reduceMotion || phase === 'slow') return undefined;");
    expect(view).toContain("{phase === 'active' ? (");
  });

  it('when slow, drops the "keep the app open" ask and offers My Orders', () => {
    expect(view).toContain("const body = phase === 'slow' ? t('ow_slow_body') : t('ow_body');");
    expect(view).toMatch(
      /\{phase === 'slow' \? \(\s*<View style=\{styles\.footer\}>\s*<Button label=\{t\('viewMyOrders'\)\}/,
    );
    expect(STRINGS.ar.ow_slow_body).not.toContain('لا تُغلق');
    expect(STRINGS.en.ow_slow_body).not.toMatch(/keep the app open/i);
  });

  it('is one accessible element whose counter is not announced every second', () => {
    expect(view).toContain('accessibilityLiveRegion="polite"');
    expect(view).toMatch(/<View\s+style=\{styles\.ringStage\}\s+accessibilityElementsHidden/);
  });
});
