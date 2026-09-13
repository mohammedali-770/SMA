// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => ({}),
}));

import type { DeliveryRequestRow } from '../../lib/opsApi';
import type { Branch } from '../../types';
import { RequestsWaitingCard } from './RequestsWaitingCard';
import { opsT } from './opsStrings';

const NOW = Date.parse('2026-09-13T12:00:00Z');

const i18n = {
  t: (k: Parameters<typeof opsT>[1]) => opsT('en', k),
  isRTL: false,
  lang: 'en' as const,
  setLang: () => {},
};

const branch: Branch = {
  id: 'b1',
  nameEn: 'Riyadh',
  nameAr: 'الرياض',
  addressAr: '',
  addressEn: '',
  phone: '',
  latitude: 0,
  longitude: 0,
  isActive: true,
  deliveryFee: 0,
  minDeliveryOrder: 0,
};

function req(over: Partial<DeliveryRequestRow> = {}): DeliveryRequestRow {
  return {
    id: 'r1',
    branchId: 'b1',
    requestedMinutes: 60,
    reasonCode: 'no_driver',
    note: null,
    requestedAt: '2026-09-13T11:30:00Z',
    expiresAt: '2026-09-13T12:30:00Z',
    status: 'pending',
    resolutionNote: null,
    appliedMinutes: null,
    ...over,
  };
}

afterEach(cleanup);

describe('RequestsWaitingCard', () => {
  it('renders NOTHING when the queue is empty', () => {
    // An empty queue is the normal state; a permanent "no requests" panel would
    // be noise on a board designed to show only what is wrong.
    const { container } = render(
      <RequestsWaitingCard
        requests={[]}
        branches={[branch]}
        now={NOW}
        busy={false}
        error={null}
        i18n={i18n as never}
        onAnswer={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('names the branch, the duration asked for, and the REASON', () => {
    render(
      <RequestsWaitingCard
        requests={[req()]}
        branches={[branch]}
        now={NOW}
        busy={false}
        error={null}
        i18n={i18n as never}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText(/Riyadh/)).toBeTruthy();
    // reason_code used to be fetched and discarded; the operator could not tell
    // "no driver" from "kitchen overload" without ringing the branch.
    expect(screen.getByText(new RegExp(opsT('en', 'dreason_no_driver')))).toBeTruthy();
  });

  it("shows the branch's own note, which is the thing worth reading", () => {
    render(
      <RequestsWaitingCard
        requests={[req({ note: 'Both riders called in sick' })]}
        branches={[branch]}
        now={NOW}
        busy={false}
        error={null}
        i18n={i18n as never}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText('Both riders called in sick')).toBeTruthy();
  });

  it('HIDES a row that is past its expiry even while status says pending', () => {
    // The server retires a stale request only when somebody touches it, so a
    // row can still read 'pending'. Offering Accept on one would be offering a
    // button that cannot work.
    const { container } = render(
      <RequestsWaitingCard
        requests={[req({ expiresAt: '2026-09-13T11:59:00Z' })]}
        branches={[branch]}
        now={NOW}
        busy={false}
        error={null}
        i18n={i18n as never}
        onAnswer={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('answers accept and decline distinctly', () => {
    const onAnswer = vi.fn();
    render(
      <RequestsWaitingCard
        requests={[req()]}
        branches={[branch]}
        now={NOW}
        busy={false}
        error={null}
        i18n={i18n as never}
        onAnswer={onAnswer}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: opsT('en', 'requestAccept') }));
    expect(onAnswer).toHaveBeenCalledWith('r1', true);
    fireEvent.click(screen.getByRole('button', { name: opsT('en', 'requestDecline') }));
    expect(onAnswer).toHaveBeenCalledWith('r1', false);
  });

  it('disables both actions while an answer is in flight', () => {
    render(
      <RequestsWaitingCard
        requests={[req()]}
        branches={[branch]}
        now={NOW}
        busy
        error={null}
        i18n={i18n as never}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: opsT('en', 'requestAccept') }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: opsT('en', 'requestDecline') }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('renders an error even when the queue has emptied underneath it', () => {
    // The expired case answers a request and empties the queue; the message
    // explaining why must survive that.
    render(
      <RequestsWaitingCard
        requests={[]}
        branches={[branch]}
        now={NOW}
        busy={false}
        error={opsT('en', 'requestNowExpired')}
        i18n={i18n as never}
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText(opsT('en', 'requestNowExpired'))).toBeTruthy();
  });
});
