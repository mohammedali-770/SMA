// @vitest-environment jsdom
//
// The screen that decides what a customer can take off a bill.
//
// Only `couponsApi` (the network calls) is mocked — `validateDraft`,
// `couponRisks` and `couponState` run for real, so these tests exercise the
// same rules the panel ships rather than a stand-in for them. The behaviours
// pinned here are the ones that answer the defect this screen was built for:
// two codes sat live in Production with no expiry, no usage limit and no cap,
// and nothing on any screen said so because there was no screen.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Coupon } from '../../lib/couponsApi';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  setActive: vi.fn(),
  remove: vi.fn(),
}));

// Keep the real pure helpers; replace only the calls that touch the network.
vi.mock('../../lib/couponsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/couponsApi')>()),
  couponsApi: api,
}));

import { CouponsPanel } from './CouponsPanel';

const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  id: 'c1',
  code: 'WELCOME10',
  type: 'percentage',
  value: 10,
  is_active: true,
  min_order_amount: 0,
  max_discount_amount: null,
  starts_at: null,
  ends_at: null,
  usage_limit: null,
  usage_count: 0,
  created_at: '2026-09-10T00:00:00Z',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue([]);
  api.create.mockResolvedValue(undefined);
  api.setActive.mockResolvedValue(undefined);
  api.remove.mockResolvedValue(undefined);
});

afterEach(cleanup);

const renderPanel = (readOnly = false) => render(<CouponsPanel lang="en" readOnly={readOnly} />);

describe('the standing answer to "what can be redeemed right now"', () => {
  it('says plainly when nothing is live', async () => {
    renderPanel();
    // The reassurance that was missing when two codes WERE live: an explicit
    // "none", not an empty table the reader has to interpret.
    expect(await screen.findByText(/No promo code is live/i)).toBeTruthy();
  });

  it('counts the codes a customer could actually use', async () => {
    api.list.mockResolvedValue([
      coupon({ id: 'a' }),
      coupon({ id: 'b', is_active: false }),
      coupon({ id: 'c', ends_at: '2020-01-01T00:00:00Z' }),
    ]);
    renderPanel();
    // Three rows, one redeemable. A count of rows would have said three.
    expect(await screen.findByText(/1 code can be redeemed right now/i)).toBeTruthy();
  });
});

describe('unboundedness is rendered, not left as an empty cell', () => {
  it('badges every way an existing code is open-ended', async () => {
    api.list.mockResolvedValue([coupon()]);
    renderPanel();
    await screen.findByText('WELCOME10');
    expect(screen.getAllByText('Never expires').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unlimited uses').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Uncapped %').length).toBeGreaterThan(0);
  });

  it('calls a fully bounded code bounded', async () => {
    api.list.mockResolvedValue([
      coupon({ ends_at: '2026-12-31T00:00:00Z', usage_limit: 100, max_discount_amount: 50 }),
    ]);
    renderPanel();
    await screen.findByText('WELCOME10');
    expect(screen.getByText('Bounded')).toBeTruthy();
    expect(screen.queryByText('Never expires')).toBeNull();
  });
});

describe('the draft is priced before it is saved', () => {
  it('warns while the code is still a draft, not after it is live', async () => {
    renderPanel();
    await screen.findByText(/No promo code is live/i);
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'SUMMER' } });
    fireEvent.change(screen.getByLabelText('Percent (1-100)'), { target: { value: '15' } });
    expect(await screen.findByText(/This code is unbounded/i)).toBeTruthy();
  });

  it('stops warning once the operator bounds it', async () => {
    renderPanel();
    await screen.findByText(/No promo code is live/i);
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'SUMMER' } });
    fireEvent.change(screen.getByLabelText('Percent (1-100)'), { target: { value: '15' } });
    await screen.findByText(/This code is unbounded/i);

    fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2026-12-31T00:00' } });
    fireEvent.change(screen.getByLabelText('Usage limit'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Discount cap'), { target: { value: '25' } });
    await waitFor(() => expect(screen.queryByText(/This code is unbounded/i)).toBeNull());
  });
});

describe('the guards that the database does not provide', () => {
  it('refuses to create a percentage above 100', async () => {
    renderPanel();
    await screen.findByText(/No promo code is live/i);
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'FREE' } });
    fireEvent.change(screen.getByLabelText('Percent (1-100)'), { target: { value: '500' } });

    expect(await screen.findByText(/database does NOT enforce this/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Create code/i }));
    // The assertion that matters: nothing was written.
    expect(api.create).not.toHaveBeenCalled();
  });

  it('upper-cases the code as it is typed, because lowercase is unredeemable', async () => {
    renderPanel();
    await screen.findByText(/No promo code is live/i);
    const input = screen.getByLabelText('Code') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'welcome10' } });
    expect(input.value).toBe('WELCOME10');
  });

  it('creates a valid bounded code', async () => {
    renderPanel();
    await screen.findByText(/No promo code is live/i);
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'SUMMER25' } });
    fireEvent.change(screen.getByLabelText('Percent (1-100)'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '2026-12-31T00:00' } });
    fireEvent.change(screen.getByLabelText('Usage limit'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Discount cap'), { target: { value: '30' } });

    fireEvent.click(screen.getByRole('button', { name: /Create code/i }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0][0]).toMatchObject({ code: 'SUMMER25', type: 'percentage', value: '25' });
  });
});

describe('stopping is primary; deleting a redeemed code is not offered', () => {
  it('offers Delete for a code nothing has ever used', async () => {
    api.list.mockResolvedValue([coupon({ usage_count: 0 })]);
    renderPanel();
    await screen.findByText('WELCOME10');
    expect(screen.getByRole('button', { name: /Delete/i })).toBeTruthy();
  });

  it('withholds Delete once a code has been redeemed, and says why in a word', async () => {
    // orders.coupon_code is text with no foreign key, so deleting a used code
    // leaves a discounted order whose discount cannot be explained.
    api.list.mockResolvedValue([coupon({ usage_count: 3, usage_limit: 10 })]);
    renderPanel();
    await screen.findByText('WELCOME10');
    expect(screen.queryByRole('button', { name: /Delete/i })).toBeNull();
    expect(screen.getByText('Redeemed')).toBeTruthy();
  });

  it('stopping a live code calls setActive(false)', async () => {
    api.list.mockResolvedValue([coupon()]);
    renderPanel();
    await screen.findByText('WELCOME10');
    fireEvent.click(screen.getByRole('button', { name: /^Stop$/i }));
    await waitFor(() => expect(api.setActive).toHaveBeenCalledWith('c1', false));
  });

  it('offers Start for a stopped code', async () => {
    api.list.mockResolvedValue([coupon({ is_active: false })]);
    renderPanel();
    await screen.findByText('WELCOME10');
    fireEvent.click(screen.getByRole('button', { name: /^Start$/i }));
    await waitFor(() => expect(api.setActive).toHaveBeenCalledWith('c1', true));
  });
});

describe('an accountant can read what a discount costs but not create one', () => {
  it('hides the form and the row actions', async () => {
    api.list.mockResolvedValue([coupon()]);
    renderPanel(true);
    await screen.findByText('WELCOME10');
    expect(screen.queryByLabelText('Code')).toBeNull();
    expect(screen.queryByRole('button', { name: /Create code/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Stop$/i })).toBeNull();
    // But the risk badges still render — seeing the exposure is the read half.
    expect(screen.getAllByText('Never expires').length).toBeGreaterThan(0);
  });
});

describe('a failed load is reported rather than shown as an empty list', () => {
  it('surfaces the error', async () => {
    api.list.mockRejectedValue(new Error('permission denied for table coupons'));
    renderPanel();
    expect(await screen.findByText(/permission denied for table coupons/i)).toBeTruthy();
  });
});
