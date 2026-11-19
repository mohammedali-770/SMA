import { describe, expect, it } from 'vitest';

import { STRINGS } from '../../i18n/strings';
import { vatInvoiceNoteKey } from './vatInvoiceNote';

describe('VAT invoice note on the receipt', () => {
  it('pickup: handed over at the branch', () => {
    expect(vatInvoiceNoteKey({ status: 'preparing', orderType: 'pickup', total: 45 })).toBe(
      'vatInvoicePickup',
    );
  });

  it('delivery: handed over by the driver', () => {
    expect(vatInvoiceNoteKey({ status: 'out_for_delivery', orderType: 'delivery', total: 60 })).toBe(
      'vatInvoiceDelivery',
    );
  });

  it('no note on a cancelled order or one with nothing charged', () => {
    expect(vatInvoiceNoteKey({ status: 'cancelled', orderType: 'pickup', total: 45 })).toBeNull();
    expect(vatInvoiceNoteKey({ status: 'delivered', orderType: 'delivery', total: 0 })).toBeNull();
  });

  it('no note for an unknown order type', () => {
    expect(vatInvoiceNoteKey({ status: 'received', orderType: 'dine_in', total: 10 })).toBeNull();
  });

  it('says where the invoice comes from, in both languages', () => {
    expect(STRINGS.en.vatInvoicePickup).toMatch(/branch/i);
    expect(STRINGS.en.vatInvoiceDelivery).toMatch(/driver/i);
    expect(STRINGS.ar.vatInvoicePickup).toContain('الفرع');
    expect(STRINGS.ar.vatInvoiceDelivery).toContain('مندوب التوصيل');
  });
});

describe('the receipt shows it', () => {
  it('renders the note under the total', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, 'view/ReceiptBody.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).toContain('const vatNoteKey = vatInvoiceNoteKey(order);');
    expect(src).toMatch(
      /\{vatNoteKey \? \(\s*<Text variant="caption" tone="tertiary">\{t\(vatNoteKey\)\}<\/Text>/,
    );
  });
});
