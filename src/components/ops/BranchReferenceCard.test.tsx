// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// The design-system primitives read the active language through useDsLang's
// defensive useContext, so AppContext must exist even though this card does
// not use it.
vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => ({}),
}));

import type { BranchReferenceRow } from '../../lib/opsApi';
import { BranchReferenceCard } from './BranchReferenceCard';
import { SECRET_MASK } from './branchReference';
import { opsT } from './opsStrings';

const i18n = {
  t: (k: Parameters<typeof opsT>[1]) => opsT('en', k),
  isRTL: false,
  lang: 'en' as const,
  setLang: () => {},
};

function row(over: Partial<BranchReferenceRow> = {}): BranchReferenceRow {
  return {
    id: 'e1',
    branchId: 'b1',
    kind: 'text',
    labelEn: 'Bin day',
    labelAr: 'يوم النفايات',
    valuePlain: 'Tuesday',
    sortOrder: 0,
    ...over,
  };
}

const secretRow = row({
  id: 's1',
  kind: 'secret',
  labelEn: 'Aggregator password',
  labelAr: 'كلمة المرور',
  valuePlain: null,
  sortOrder: 1,
});

afterEach(cleanup);

describe('BranchReferenceCard', () => {
  it('shows plain values immediately', () => {
    render(<BranchReferenceCard entries={[row()]} i18n={i18n as never} onReveal={vi.fn()} />);
    expect(screen.getByText('Bin day')).toBeTruthy();
    expect(screen.getByText('Tuesday')).toBeTruthy();
  });

  it('NEVER calls reveal on render — the audit trail depends on it', async () => {
    // Every reveal writes a server audit row. A reveal-on-mount would write one
    // every time the screen opened and make the trail worthless for the only
    // question it exists to answer: who looked, and when.
    const onReveal = vi.fn().mockResolvedValue('secret-value');
    render(<BranchReferenceCard entries={[row(), secretRow]} i18n={i18n as never} onReveal={onReveal} />);
    // Give any effect a chance to run before asserting absence.
    await waitFor(() => expect(screen.getByText('Aggregator password')).toBeTruthy());
    expect(onReveal).not.toHaveBeenCalled();
  });

  it('masks a secret, and the mask does not vary with the value', () => {
    render(<BranchReferenceCard entries={[secretRow]} i18n={i18n as never} onReveal={vi.fn()} />);
    expect(screen.getByText(SECRET_MASK)).toBeTruthy();
    expect(screen.queryByText('secret-value')).toBeNull();
  });

  it('reveals only on the button press, once per press', async () => {
    const onReveal = vi.fn().mockResolvedValue('secret-value');
    render(<BranchReferenceCard entries={[secretRow]} i18n={i18n as never} onReveal={onReveal} />);

    fireEvent.click(screen.getByRole('button', { name: opsT('en', 'referenceReveal') }));
    await waitFor(() => expect(screen.getByText('secret-value')).toBeTruthy());
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenCalledWith('s1');
  });

  it('hiding forgets the value locally and showing again is a FRESH reveal', async () => {
    // Re-revealing writes a second audit row on purpose: the person looked
    // twice, and the trail should say so.
    const onReveal = vi.fn().mockResolvedValue('secret-value');
    render(<BranchReferenceCard entries={[secretRow]} i18n={i18n as never} onReveal={onReveal} />);

    fireEvent.click(screen.getByRole('button', { name: opsT('en', 'referenceReveal') }));
    await waitFor(() => expect(screen.getByText('secret-value')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: opsT('en', 'referenceHide') }));
    await waitFor(() => expect(screen.getByText(SECRET_MASK)).toBeTruthy());
    expect(screen.queryByText('secret-value')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: opsT('en', 'referenceReveal') }));
    await waitFor(() => expect(onReveal).toHaveBeenCalledTimes(2));
  });

  it('surfaces a failed reveal and keeps the value masked', async () => {
    const onReveal = vi.fn().mockRejectedValue(new Error('Not authorized to reveal this entry'));
    render(<BranchReferenceCard entries={[secretRow]} i18n={i18n as never} onReveal={onReveal} />);

    fireEvent.click(screen.getByRole('button', { name: opsT('en', 'referenceReveal') }));
    await waitFor(() => expect(screen.getByText('Not authorized to reveal this entry')).toBeTruthy());
    expect(screen.getByText(SECRET_MASK)).toBeTruthy();
  });

  it('shows the audit notice only when a secret is present', () => {
    const { rerender } = render(
      <BranchReferenceCard entries={[row()]} i18n={i18n as never} onReveal={vi.fn()} />,
    );
    expect(screen.queryByText(opsT('en', 'referenceAuditNotice'))).toBeNull();

    rerender(<BranchReferenceCard entries={[row(), secretRow]} i18n={i18n as never} onReveal={vi.fn()} />);
    expect(screen.getByText(opsT('en', 'referenceAuditNotice'))).toBeTruthy();
  });

  it('renders an empty sheet as guidance rather than a blank card', () => {
    render(<BranchReferenceCard entries={[]} i18n={i18n as never} onReveal={vi.fn()} />);
    expect(screen.getByText(opsT('en', 'referenceEmptyTitle'))).toBeTruthy();
  });

  it('links only http(s), and renders a refused scheme as text', () => {
    render(
      <BranchReferenceCard
        entries={[
          row({ id: 'l1', kind: 'link', labelEn: 'Portal', valuePlain: 'https://example.com/x' }),
          row({ id: 'l2', kind: 'link', labelEn: 'Bad', valuePlain: 'javascript:alert(1)' }),
        ]}
        i18n={i18n as never}
        onReveal={vi.fn()}
      />,
    );
    const good = screen.getByText('https://example.com/x').closest('a');
    expect(good?.getAttribute('href')).toBe('https://example.com/x');
    expect(good?.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText('javascript:alert(1)').closest('a')).toBeNull();
  });
});
