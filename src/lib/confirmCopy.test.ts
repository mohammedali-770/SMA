import { describe, it, expect } from 'vitest';
import {
  cancelOrderConfirmMessage,
  cancelRefundsCard,
  deleteCategoryConfirmMessage,
  deleteProductConfirmMessage,
} from './confirmCopy';

const paidCard = { paymentStatus: 'paid', paymentMethod: 'online', total: 42 } as const;

describe('cancel-order confirmation', () => {
  it('a paid card order says the refund is automatic and irreversible, and names the push', () => {
    const en = cancelOrderConfirmMessage(paidCard, false);
    expect(en).toMatch(/refunded to the customer.s card automatically/);
    expect(en).toMatch(/cannot be undone/);
    expect(en).toMatch(/Order cancelled/);
    const ar = cancelOrderConfirmMessage(paidCard, true);
    expect(ar).toMatch(/بطاقة العميل تلقائياً/);
    expect(ar).toMatch(/تم إلغاء الطلب/);
  });

  it.each([
    ['cash order', { paymentStatus: 'pending', paymentMethod: 'cash', total: 42 }],
    ['cash order marked paid', { paymentStatus: 'paid', paymentMethod: 'cash', total: 42 }],
    ['unpaid online order', { paymentStatus: 'pending', paymentMethod: 'online', total: 42 }],
    ['comped paid online order', { paymentStatus: 'paid', paymentMethod: 'online', total: 0 }],
    ['no method', { paymentStatus: 'paid', total: 42 }],
  ] as const)('%s never claims a card refund', (_n, o) => {
    expect(cancelRefundsCard(o)).toBe(false);
    expect(cancelOrderConfirmMessage(o, false)).not.toMatch(/refund/i);
    expect(cancelOrderConfirmMessage(o, true)).not.toMatch(/بطاقة/);
  });

  it('every variant still states the loyalty and coupon compensation', () => {
    expect(cancelOrderConfirmMessage(paidCard, false)).toMatch(/Loyalty movements/);
    expect(cancelOrderConfirmMessage({ paymentStatus: 'pending', total: 1 }, true)).toMatch(/نقاط الولاء/);
  });
});

describe('delete confirmations', () => {
  it('product: says permanent and names what goes with it, in both languages', () => {
    expect(deleteProductConfirmMessage(false)).toMatch(/Permanently delete/);
    expect(deleteProductConfirmMessage(false)).toMatch(/branch availability/);
    expect(deleteProductConfirmMessage(true)).toMatch(/حذف نهائي/);
  });
  it('category: does not claim products are disabled; says it needs an empty category', () => {
    expect(deleteCategoryConfirmMessage(false)).not.toMatch(/disabled/i);
    expect(deleteCategoryConfirmMessage(false)).toMatch(/still has products cannot be deleted/);
    expect(deleteCategoryConfirmMessage(true)).toMatch(/منتجات/);
  });
});
