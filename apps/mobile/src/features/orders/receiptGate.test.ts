import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { CustomerOrderState } from './orderConfirmation';
import { RECEIPT_WAIT_FOR_NUMBER_MS, showFullReceipt } from './receiptGate';

describe('the receipt page waits for the branch order number (owner, 2026-11-18)', () => {
  it('holds the page while the order is being sent', () => {
    expect(showFullReceipt('sending_to_branch', 0)).toBe(false);
    expect(showFullReceipt('sending_to_branch', 6_000)).toBe(false);
  });

  it('shows it anyway at the bound, so a slow POS never strands the customer', () => {
    expect(RECEIPT_WAIT_FOR_NUMBER_MS).toBe(20_000);
    expect(showFullReceipt('sending_to_branch', RECEIPT_WAIT_FOR_NUMBER_MS - 1)).toBe(false);
    expect(showFullReceipt('sending_to_branch', RECEIPT_WAIT_FOR_NUMBER_MS)).toBe(true);
  });

  it('shows every other state at once', () => {
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
    for (const s of others) expect(showFullReceipt(s, 0), s).toBe(true);
  });

  it('is wired into the receipt screen: skeleton while held, timer to the bound', () => {
    const src = readFileSync(resolve(__dirname, 'ReceiptScreen.tsx'), 'utf8');
    expect(src).toContain('{loading || holdForNumber ? (');
    expect(src).toContain(
      'const holdForNumber = state != null && !showFullReceipt(state, waitStart == null ? 0 : Date.now() - waitStart);',
    );
    expect(src).toContain('setTimeout(() => setWaitTick((n) => n + 1), RECEIPT_WAIT_FOR_NUMBER_MS)');
  });
});
