// @vitest-environment jsdom
//
// F-X11-001. A request held in manual_review locks the account and had no exit
// from any client. These pin the screen that is now that exit: it lists the
// held requests with their safe reason code and age, confirms before resolving,
// resolves ONLY through the RPC wrapper, and does not offer a retry the server
// would refuse.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ list: vi.fn(), resolve: vi.fn() }));
vi.mock('../../lib/accountDeletionReviewApi', async (orig) => ({
  ...(await orig<typeof import('../../lib/accountDeletionReviewApi')>()),
  accountDeletionReview: api,
}));

import { AccountDeletionReviewPanel } from './AccountDeletionReviewPanel';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const sla = {
  id: 'aaaaaaaa-1111-2222-3333-444444444444',
  requested_at: hoursAgo(50),
  reason: 'blocked_active_order_over_sla',
  canRetry: true,
};
const staff = {
  id: 'bbbbbbbb-1111-2222-3333-444444444444',
  requested_at: hoursAgo(3),
  reason: 'staff_account_requires_admin',
  canRetry: true,
};
const orphan = {
  id: 'cccccccc-1111-2222-3333-444444444444',
  requested_at: hoursAgo(1),
  reason: 'anonymize',
  canRetry: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue([sla, staff]);
  api.resolve.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AccountDeletionReviewPanel', () => {
  it('lists each held request with its reason code and age', async () => {
    render(<AccountDeletionReviewPanel lang="en" />);
    expect(await screen.findByText('aaaaaaaa')).toBeTruthy();
    expect(screen.getByText('blocked_active_order_over_sla')).toBeTruthy();
    expect(screen.getByText('staff_account_requires_admin')).toBeTruthy();
    expect(screen.getByText(/Held for 2d/)).toBeTruthy();
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('says so when nothing is held', async () => {
    api.list.mockResolvedValue([]);
    render(<AccountDeletionReviewPanel lang="en" />);
    expect(await screen.findByText('No account deletions are held for review.')).toBeTruthy();
  });

  it('resolves through the RPC wrapper after a confirmation naming the request', async () => {
    const confirmSpy = vi.fn((_m?: string) => true);
    vi.stubGlobal('confirm', confirmSpy);
    render(<AccountDeletionReviewPanel lang="en" />);
    fireEvent.change(await screen.findByLabelText('aaaaaaaa note'), { target: { value: 'order is stuck' } });
    fireEvent.click(screen.getAllByText('Close as failed')[0]);
    await waitFor(() => expect(api.resolve).toHaveBeenCalledWith(sla.id, 'fail', 'order is stuck'));
    const message = String(confirmSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('aaaaaaaa');
    expect(message).toContain('releases the account lock');
    // and the list is re-read so the resolved row disappears
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('retry confirms, calls retry, and warns a staff hold is simply held again', async () => {
    const confirmSpy = vi.fn((_m?: string) => true);
    vi.stubGlobal('confirm', confirmSpy);
    render(<AccountDeletionReviewPanel lang="en" />);
    await screen.findByText('bbbbbbbb');
    fireEvent.click(screen.getAllByText('Retry')[1]);
    await waitFor(() => expect(api.resolve).toHaveBeenCalledWith(staff.id, 'retry', ''));
    expect(String(confirmSpy.mock.calls[0]?.[0])).toContain('held again');
  });

  it('writes nothing when the confirmation is cancelled', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );
    render(<AccountDeletionReviewPanel lang="en" />);
    fireEvent.click((await screen.findAllByText('Close as failed'))[0]);
    await waitFor(() => expect(api.resolve).not.toHaveBeenCalled());
  });

  it('does not offer Retry where the server would refuse it', async () => {
    api.list.mockResolvedValue([orphan]);
    render(<AccountDeletionReviewPanel lang="en" />);
    await screen.findByText('cccccccc');
    expect(screen.queryByText('Retry')).toBeNull();
    expect(screen.getByText('Close as failed')).toBeTruthy();
  });

  it('shows the server refusal verbatim (an admin without AAL2)', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    api.resolve.mockRejectedValue(new Error('Only admins may resolve account deletion reviews'));
    render(<AccountDeletionReviewPanel lang="en" />);
    fireEvent.click((await screen.findAllByText('Close as failed'))[0]);
    expect(await screen.findByText('Only admins may resolve account deletion reviews')).toBeTruthy();
  });

  it('renders in Arabic, right to left', async () => {
    const { container } = render(<AccountDeletionReviewPanel lang="ar" />);
    expect(await screen.findByText('طلبات حذف الحسابات المعلّقة')).toBeTruthy();
    expect(screen.getAllByText('إغلاق كفاشل').length).toBe(2);
    expect(container.querySelector('[dir="rtl"]')).toBeTruthy();
  });
});

describe('console wiring', () => {
  const dash = readFileSync(join(__dirname, '..', 'AdminDashboard.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  it('mounts the panel on the Health tab for admins only', () => {
    expect(dash).toContain('import { AccountDeletionReviewPanel }');
    expect(dash).toMatch(/canTriage\s*&&\s*<AccountDeletionReviewPanel/);
  });
});
