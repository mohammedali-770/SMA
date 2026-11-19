// @vitest-environment jsdom
//
// Which actions the payment dialog offers in each state, observed by rendering.
// Every React Native import is replaced, so no native module loads here.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  ActivityIndicator: () => React.createElement('div', { 'data-testid': 'spinner' }),
  StyleSheet: { create: (s: unknown) => s },
  View: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
}));
vi.mock('../../../design-system/generated/tokens', () => ({
  color: {},
  space: new Proxy({}, { get: () => 0 }),
}));
vi.mock('../../../design-system/ui/Button', () => ({
  Button: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) =>
    React.createElement('button', { onClick: onPress, disabled }, label),
}));
vi.mock('../../../design-system/ui/Chip', () => ({
  StatusPill: ({ label }: { label: string }) => React.createElement('span', null, label),
}));
vi.mock('../../../design-system/ui/Text', () => ({
  Text: ({ children }: { children?: React.ReactNode }) => React.createElement('p', null, children),
}));
vi.mock('./Dialog', () => ({
  Dialog: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? React.createElement('div', { role: 'dialog' }, children) : null,
}));
vi.mock('../../../theme/makeStyles', () => ({ makeStyles: () => () => ({}) }));
vi.mock('../../../theme/ThemeProvider', () => ({ useThemeColors: () => ({ ember: '#000' }) }));

import { PaymentStatusDialog, type PayState } from './PaymentStatusDialog';

const labels = {
  title: 'Payment',
  opening: 'Opening',
  verifying: 'Verifying',
  cancel: 'Cancel',
  close: 'Close',
  continuePayment: 'Continue payment',
  verifyAgain: 'Check again',
  tryAgain: 'Try again',
  statusPending: 'Pending',
  statusFailed: 'Declined',
  statusCancelled: 'Cancelled',
  statusExpired: 'Expired',
  useCash: 'Pay in cash instead',
  getHelp: 'Contact support',
};

function show(state: PayState, opts: { cash?: boolean } = {}) {
  const handlers = {
    onContinue: vi.fn(),
    onVerifyAgain: vi.fn(),
    onResume: vi.fn(),
    onRetryFresh: vi.fn(),
    onClose: vi.fn(),
    onUseCash: vi.fn(),
    onGetHelp: vi.fn(),
  };
  render(
    <PaymentStatusDialog
      state={state}
      message="msg"
      busy={false}
      labels={labels}
      onContinue={handlers.onContinue}
      onVerifyAgain={handlers.onVerifyAgain}
      onResume={handlers.onResume}
      onRetryFresh={handlers.onRetryFresh}
      onClose={handlers.onClose}
      onUseCash={opts.cash === false ? undefined : handlers.onUseCash}
      onGetHelp={handlers.onGetHelp}
    />,
  );
  return handlers;
}

const buttons = () => screen.queryAllByRole('button').map((b) => b.textContent);

afterEach(cleanup);

describe('payment dialog actions', () => {
  it.each(['failed', 'cancelled', 'expired'] as const)(
    '%s offers Try again, Pay in cash instead, Contact support and Close',
    (state) => {
      const h = show(state);
      expect(buttons()).toEqual(['Try again', 'Pay in cash instead', 'Contact support', 'Close']);
      fireEvent.click(screen.getByText('Pay in cash instead'));
      expect(h.onUseCash).toHaveBeenCalledTimes(1);
      // Switching method never starts a new payment by itself.
      expect(h.onRetryFresh).not.toHaveBeenCalled();
      fireEvent.click(screen.getByText('Contact support'));
      expect(h.onGetHelp).toHaveBeenCalledTimes(1);
    },
  );

  it('does not offer cash when cash is not available', () => {
    show('failed', { cash: false });
    expect(buttons()).toEqual(['Try again', 'Contact support', 'Close']);
  });

  it('a payment that may still settle never offers cash', () => {
    // Paying cash beside a still-open card charge could mean paying twice.
    show('pending');
    expect(buttons()).toEqual(['Continue payment', 'Check again', 'Contact support', 'Close']);
  });

  it('a transient error resumes the same session and never offers cash', () => {
    show('error');
    expect(buttons()).toEqual(['Try again', 'Contact support', 'Close']);
  });

  it.each(['opening', 'verifying'] as const)('%s shows only Cancel', (state) => {
    show(state);
    expect(buttons()).toEqual(['Cancel']);
  });
});
