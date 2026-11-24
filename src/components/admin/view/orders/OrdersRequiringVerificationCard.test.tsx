// @vitest-environment jsdom
/**
 * The ambiguous-POS queue card polls `list_pos_confirmation_required` every 60
 * seconds, and that RPC refuses everyone but an administrator (F-X11-006). For
 * anyone else the card must send nothing, ever, and must say why it is not
 * showing a queue instead of vanishing.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const posConfirmationRequired = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/api', () => ({
  orders: { posConfirmationRequired: (n: number) => posConfirmationRequired(n) },
}));

import { OrdersRequiringVerificationCard } from './OrdersRequiringVerificationCard';
import { POS_VERIFY_REFRESH_MS } from './ordersView';

beforeEach(() => {
  vi.useFakeTimers();
  posConfirmationRequired.mockReset();
  posConfirmationRequired.mockResolvedValue({ total: 0, items: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('OrdersRequiringVerificationCard', () => {
  it('sends no request on mount or on any later tick when the caller cannot read it', async () => {
    render(<OrdersRequiringVerificationCard adminLang="en" onView={() => {}} canRead={false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POS_VERIFY_REFRESH_MS * 3);
    });
    expect(posConfirmationRequired).not.toHaveBeenCalled();
  });

  it('says the queue is administrators only, in both languages', () => {
    const { unmount } = render(
      <OrdersRequiringVerificationCard adminLang="en" onView={() => {}} canRead={false} />,
    );
    expect(screen.getByText(/visible to administrators only/)).toBeTruthy();
    unmount();
    render(<OrdersRequiringVerificationCard adminLang="ar" onView={() => {}} canRead={false} />);
    expect(screen.getByText(/متاحة للمشرفين فقط/)).toBeTruthy();
  });

  it('still reads on mount and every 60 seconds for an administrator', async () => {
    render(<OrdersRequiringVerificationCard adminLang="en" onView={() => {}} canRead />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(posConfirmationRequired).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POS_VERIFY_REFRESH_MS);
    });
    expect(posConfirmationRequired).toHaveBeenCalledTimes(2);
  });

  it('stops polling when the caller loses read access', async () => {
    const { rerender } = render(<OrdersRequiringVerificationCard adminLang="en" onView={() => {}} canRead />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender(<OrdersRequiringVerificationCard adminLang="en" onView={() => {}} canRead={false} />);
    posConfirmationRequired.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POS_VERIFY_REFRESH_MS * 2);
    });
    expect(posConfirmationRequired).not.toHaveBeenCalled();
  });
});
