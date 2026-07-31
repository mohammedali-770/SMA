// @vitest-environment jsdom
/**
 * Render tests for language-aware console typography.
 *
 * The contract scans in `consolePrimitives.test.ts` prove the SOURCE does not
 * hardcode a family. These prove the RENDERED output actually changes with the
 * language, and — just as importantly — that the primitives still render at all
 * outside a provider.
 *
 * That second case is the whole reason `useDsLang` exists rather than each
 * component calling `useApp()`: `useApp` throws without a provider, which would
 * make every one of these components unrenderable in a unit test or in
 * isolation.
 */
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AppContext } from '../../context/AppContext';
import { Button } from './Button';
import { Card } from './Card';
import { Field } from './Field';
import { Notice } from './Notice';
import { StatusPill } from './StatusPill';
import { Text } from './Text';

/** Class assertions use plain strings: jest-dom is not wired up in this repo,
 * and adding a matcher library to assert one substring would be more setup than
 * the assertion is worth.
 */

/**
 * Minimal context: these primitives read exactly one field. Casting past the
 * full AppContextType is deliberate — building a whole app context to assert a
 * font family would couple this test to every unrelated provider change.
 */
function withLang(lang: 'en' | 'ar', ui: React.ReactNode) {
  return render(
    <AppContext.Provider value={{ adminLang: lang } as never}>{ui}</AppContext.Provider>,
  );
}

afterEach(cleanup);

const AR = 'font-ds-ar';
const EN = 'font-ds-en';
const NUM = 'font-ds-num';

describe('console typography follows the active language', () => {
  it('Text renders Arabic copy in the Arabic family', () => {
    withLang('ar', <Text>الطلبات المباشرة</Text>);
    expect(screen.getByText('الطلبات المباشرة').className).toContain(AR);
  });

  it('Text renders English copy in the Latin family', () => {
    withLang('en', <Text>Live Orders</Text>);
    expect(screen.getByText('Live Orders').className).toContain(EN);
  });

  it('Button follows the language', () => {
    withLang('ar', <Button label="حفظ" onClick={() => {}} />);
    expect(screen.getByRole('button').className).toContain(AR);

    withLang('en', <Button label="Save" onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Save' }).className).toContain(EN);
  });

  it('Field follows the language', () => {
    withLang('ar', <Field id="a" label="الاسم" value="" onValueChange={() => {}} />);
    expect(screen.getByLabelText(/الاسم/).className).toContain(AR);

    withLang('en', <Field id="b" label="Name" value="" onValueChange={() => {}} />);
    expect(screen.getByLabelText(/Name/).className).toContain(EN);
  });

  it('numeric wins over language — a structured number is mono in both', () => {
    withLang('ar', <Text numeric>1042</Text>);
    expect(screen.getByText('1042').className).toContain(NUM);
    expect(screen.getByText('1042').className).not.toContain(AR);
  });

  it('renders OUTSIDE a provider without throwing, falling back to Latin', () => {
    // useApp() would throw here. The whole point of the defensive hook.
    expect(() => render(<Text>Standalone</Text>)).not.toThrow();
    expect(screen.getByText('Standalone').className).toContain(EN);

    expect(() => render(<Button label="Standalone button" onClick={() => {}} />)).not.toThrow();
    expect(screen.getByRole('button', { name: 'Standalone button' }).className).toContain(EN);

    expect(() =>
      render(<Field id="c" label="Standalone field" value="" onValueChange={() => {}} />),
    ).not.toThrow();
    expect(screen.getByLabelText(/Standalone field/).className).toContain(EN);
  });
});

describe('composed primitives inherit typography through Text', () => {
  it('Card content resolves Arabic via its Text child, not independently', () => {
    const { container } = withLang('ar', <Card><Text>محتوى</Text></Card>);
    // The Card element itself carries NO family class — it has no text node.
    expect(container.firstElementChild?.className).not.toMatch(/font-ds-/);
    expect(screen.getByText('محتوى').className).toContain(AR);
  });

  it('Notice resolves Arabic through Text', () => {
    withLang('ar', <Notice title="تحذير" action="افعل هذا" />);
    expect(screen.getByText('تحذير').className).toContain(AR);
    expect(screen.getByText('افعل هذا').className).toContain(AR);
  });

  it('StatusPill resolves Arabic through Text', () => {
    withLang('ar', <StatusPill label="قيد التحضير" tone="info" />);
    expect(screen.getByText('قيد التحضير').className).toContain(AR);
  });

  it('switching the language switches every composed label together', () => {
    const ui = (
      <>
        <Notice title="Warning" />
        <StatusPill label="Preparing" />
      </>
    );
    withLang('en', ui);
    expect(screen.getByText('Warning').className).toContain(EN);
    expect(screen.getByText('Preparing').className).toContain(EN);
  });
});
