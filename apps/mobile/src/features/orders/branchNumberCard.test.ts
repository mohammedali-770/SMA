/**
 * The branch-number card on the receipt appears ONLY when there is a number
 * (owner, 2026-11-18, repeated). A customer is never shown a "not issued yet"
 * placeholder («لم يصدر بعد» / «سيظهر هنا فور إصداره من الفرع»); until the
 * branch issues the number, the state pill and its sentence say what is
 * happening. The screen is React Native, so the gate is asserted on the source,
 * as in cancelledOrderWiring.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STRINGS } from '../../i18n/strings';
import { confirmationPresentation } from './orderConfirmation';

const HERO = readFileSync(resolve(__dirname, 'view/ConfirmationHero.tsx'), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the receipt never shows a pending branch number', () => {
  it('renders the number card only when the flag AND a number are both present', () => {
    expect(code(HERO)).toContain('{p.showBranchNumber && branchNumber ? (');
    expect(code(HERO)).not.toMatch(/\{p\.showBranchNumber \? \(/);
  });

  it('announces the number to a screen reader only when there is one', () => {
    expect(code(HERO)).toContain(
      "p.showBranchNumber&&branchNumber?`${t('oc_branch_order_number')} ${branchNumber}`:null",
    );
  });

  it('has no placeholder copy left to show, in either language', () => {
    for (const lang of ['en', 'ar'] as const) {
      const table = STRINGS[lang] as Record<string, string>;
      expect(Object.keys(table).filter((k) => k.startsWith('oc_number_pending'))).toEqual([]);
    }
    const phrases = [
      'لم يصدر بعد',
      'سيظهر هنا فور إصداره من الفرع',
      'Not issued yet',
      'as soon as the branch issues it',
    ];
    const root = resolve(__dirname, '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
          const src = code(readFileSync(p, 'utf8'));
          for (const ph of phrases) if (src.includes(ph)) offenders.push(`${p}: ${ph}`);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

// The same rule, for the status: a customer is never told the order is being
// sent to the branch (owner, 2026-11-18, repeated, screenshot of build 30).
describe('the receipt never says the order is being sent to the branch', () => {
  it('shows "Order received" while the order is in flight', () => {
    const p = confirmationPresentation('sending_to_branch');
    expect(p.titleKey).toBe('oc_received');
    expect(p.bodyKey).toBe('oc_received_body');
    expect(STRINGS.en.oc_received_body).toBe('We will let you know as soon as your order is confirmed.');
    expect(STRINGS.ar.oc_received_body).toBe('سنُعلمك فور تأكيد طلبك.');
  });

  it('has no "sending" copy left anywhere in the app, in either language', () => {
    for (const lang of ['en', 'ar'] as const) {
      const table = STRINGS[lang] as Record<string, string>;
      expect(Object.keys(table).filter((k) => k.startsWith('oc_sending'))).toEqual([]);
    }
    expect(code(HERO)).not.toContain("state==='sending_to_branch'");
    const phrases = [
      'الإرسال إلى الفرع',
      'يتم إرسال طلبك إلى الفرع الآن',
      'جارٍ إرسال طلبك إلى الفرع',
      'Sending to the branch',
      'sending your order to the branch',
      'being sent to the branch',
    ];
    const root = resolve(__dirname, '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
          const src = code(readFileSync(p, 'utf8'));
          for (const ph of phrases) if (src.includes(ph)) offenders.push(`${p}: ${ph}`);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
