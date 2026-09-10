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
  listReferencedCodes: vi.fn(),
  create: vi.fn(),
  updateBounds: vi.fn(),
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
  api.listReferencedCodes.mockResolvedValue(new Set<string>());
  api.create.mockResolvedValue(undefined);
  api.updateBounds.mockResolvedValue(undefined);
  api.setActive.mockResolvedValue(undefined);
  api.remove.mockResolvedValue(undefined);
});

afterEach(cleanup);

const renderPanel = () => render(<CouponsPanel lang="en" />);

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

  it('clears a stale percentage cap when the type switches to fixed', async () => {
    // validate_coupon applies max_discount_amount to a fixed coupon too, so a
    // leftover cap of 10 would silently turn a fixed 50 into a 10.
    renderPanel();
    await screen.findByText(/No promo code is live/i);
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'FIXED50' } });
    fireEvent.change(screen.getByLabelText('Discount cap'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'fixed' } });
    expect((screen.getByLabelText('Discount cap') as HTMLInputElement).value).toBe('');
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

describe('stopping is primary; deleting a referenced code is not offered', () => {
  it('offers Delete only when no order refers to the code', async () => {
    api.list.mockResolvedValue([coupon({ usage_count: 0 })]);
    renderPanel();
    await screen.findByText('WELCOME10');
    expect(screen.getByRole('button', { name: /Delete/i })).toBeTruthy();
  });

  it('withholds Delete when an ORDER refers to it, even at zero uses', async () => {
    // The case the first version got wrong. `guard_used_coupon_identity` keys
    // on orders.coupon_code, and a cancelled order keeps its code while
    // admin_set_order_status decrements usage_count — so 0 uses did not mean
    // deletable, and Delete produced a "never redeemed" confirmation followed
    // by a 23503.
    api.list.mockResolvedValue([coupon({ usage_count: 0 })]);
    api.listReferencedCodes.mockResolvedValue(new Set(['WELCOME10']));
    renderPanel();
    await screen.findByText('WELCOME10');
    expect(screen.queryByRole('button', { name: /Delete/i })).toBeNull();
    expect(screen.getByText('On an order')).toBeTruthy();
  });

  it('withholds Delete on a positive usage count too', async () => {
    api.list.mockResolvedValue([coupon({ usage_count: 3, usage_limit: 10 })]);
    renderPanel();
    await screen.findByText('WELCOME10');
    expect(screen.queryByRole('button', { name: /Delete/i })).toBeNull();
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

describe('the accountant case is handled by NOT mounting this panel', () => {
  it('is asserted where the decision lives — the nav gate, not a prop here', () => {
    // The panel used to take `readOnly` so an accountant could see the screen
    // without editing it. That was impossible: `coupons_admin_all` is gated on
    // is_admin(), which excludes `accountant`, so RLS would hand them an empty
    // list and this panel would report "No promo code is live" — the exact
    // false all-clear it exists to prevent. The tab is now hidden for them
    // instead (`GatedVisibility.coupons`, pinned in adminNav.test.ts), and the
    // dead prop was removed rather than left with a story attached.
    expect(CouponsPanel.length).toBe(1);
  });
});

describe('an existing code can be re-bounded — the thing the screen is for', () => {
  it('writes only the bounds, never the code or its value', async () => {
    // Without this an unbounded code that had been redeemed could be neither
    // deleted (the trigger refuses) nor bounded, so the operator was still
    // left with the database write this panel replaces.
    api.list.mockResolvedValue([coupon({ usage_count: 4 })]);
    renderPanel();
    await screen.findByText('WELCOME10');

    fireEvent.click(screen.getByRole('button', { name: /^Bounds$/i }));
    // Scoped by the editor's own input ids: the create form above carries the
    // same visible labels, so a bare getByLabelText matches both and would
    // silently drive the wrong form.
    fireEvent.change(await screen.findByLabelText('Expires', { selector: '#cb-end-c1' }), {
      target: { value: '2026-12-31T00:00' },
    });
    fireEvent.change(screen.getByLabelText('Usage limit', { selector: '#cb-limit-c1' }), {
      target: { value: '25' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save bounds/i }));

    await waitFor(() => expect(api.updateBounds).toHaveBeenCalledTimes(1));
    expect(api.updateBounds.mock.calls[0][0]).toBe('c1');
    expect(api.updateBounds.mock.calls[0][1]).toMatchObject({ usageLimit: '25' });
  });
});

describe('a failed load never produces a false all-clear', () => {
  it('surfaces the error', async () => {
    api.list.mockRejectedValue(new Error('permission denied for table coupons'));
    renderPanel();
    expect(await screen.findByText(/permission denied for table coupons/i)).toBeTruthy();
  });

  it('does NOT claim that no code is live when the load failed', async () => {
    // The whole point of this screen is reassurance about discount exposure. A
    // connectivity blip printing "No promo code is live" beside an error is the
    // exact false all-clear it exists to prevent.
    api.list.mockRejectedValue(new Error('network'));
    renderPanel();
    await screen.findByText(/network/i);
    expect(screen.queryByText(/No promo code is live/i)).toBeNull();
  });

  it('a failing reference lookup also suppresses the count', async () => {
    // Deletability depends on it, so a partial load must not be presented as a
    // complete picture either.
    api.list.mockResolvedValue([coupon()]);
    api.listReferencedCodes.mockRejectedValue(new Error('network'));
    renderPanel();
    await screen.findByText(/network/i);
    expect(screen.queryByText(/can be redeemed right now/i)).toBeNull();
  });
});
