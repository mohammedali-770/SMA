// @vitest-environment jsdom
//
// The panel that decides who eats free. There is NO cap on a comp, so the
// behaviours pinned here are the ones that keep it traceable and hard to do by
// accident: the reason is mandatory, the confirmation is explicit about what is
// being authorised, cancelling writes nothing, and an existing member cannot be
// silently added twice.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  listAudit: vi.fn(),
  search: vi.fn(),
  set: vi.fn(),
}));

vi.mock('../../lib/compMembersApi', () => ({ compMembers: api }));

import { CompMembersPanel } from './CompMembersPanel';

const member = {
  id: 1, profile_id: 'cust-1', phone_e164: '+966500000002',
  full_name: 'Free Eater', phone_number: '+966500000002',
  is_active: true, pending: false, note: 'founding staff member',
  added_at: '2026-08-26T00:00:00Z', updated_at: '2026-08-26T00:00:00Z',
};
/** Comped by number, nobody holds it yet. */
const pendingMember = {
  id: 2, profile_id: null, phone_e164: '+966555820667',
  full_name: null, phone_number: null,
  is_active: true, pending: true, note: 'guest of the owner',
  added_at: '2026-08-27T00:00:00Z', updated_at: '2026-08-27T00:00:00Z',
};
const candidate = {
  id: 'cust-2', full_name: 'New Person', email: 'new@example.test',
  phone_number: '+966500000003',
};

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue([member]);
  api.listAudit.mockResolvedValue([]);
  api.search.mockResolvedValue([candidate]);
  api.set.mockResolvedValue({
    id: 3, profile_id: candidate.id, phone_e164: null,
    is_active: true, was_active: false, pending: false,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CompMembersPanel', () => {
  it('lists current members and the standing no-cap warning', async () => {
    render(<CompMembersPanel lang="en" />);
    expect(await screen.findByText('Free Eater')).toBeTruthy();
    expect(screen.getByText('There is no cap')).toBeTruthy();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(api.listAudit).toHaveBeenCalledWith(50);
  });

  it('refuses to write without a reason, and does not call the server', async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    render(<CompMembersPanel lang="en" />);
    fireEvent.click(await screen.findByLabelText('Search customers'));
    fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'new' } });
    fireEvent.click(screen.getByText('Search'));

    fireEvent.click(await screen.findByText('Comp'));
    await waitFor(() => expect(screen.getByText(/A reason is required/)).toBeTruthy());
    // The reason gate must come BEFORE the confirmation, so an operator is not
    // asked to authorise something the panel is about to refuse anyway.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(api.set).not.toHaveBeenCalled();
  });

  it('names the person and spells out the consequence in the confirmation', async () => {
    const confirmSpy = vi.fn((_message?: string) => true);
    vi.stubGlobal('confirm', confirmSpy);
    render(<CompMembersPanel lang="en" />);
    fireEvent.change(await screen.findByLabelText('Search customers'), { target: { value: 'new' } });
    fireEvent.click(screen.getByText('Search'));

    fireEvent.change(await screen.findByLabelText('cust-2 reason'), {
      target: { value: 'owner family' },
    });
    fireEvent.click(screen.getByText('Comp'));

    await waitFor(() => expect(api.set).toHaveBeenCalledWith(
      { userId: 'cust-2' }, true, 'owner family',
    ));
    const message = String(confirmSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('New Person');
    expect(message).toContain('no cap');
  });

  it('writes nothing when the operator cancels the confirmation', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    render(<CompMembersPanel lang="en" />);
    fireEvent.change(await screen.findByLabelText('Search customers'), { target: { value: 'new' } });
    fireEvent.click(screen.getByText('Search'));
    fireEvent.change(await screen.findByLabelText('cust-2 reason'), {
      target: { value: 'owner family' },
    });
    fireEvent.click(screen.getByText('Comp'));
    await waitFor(() => expect(api.set).not.toHaveBeenCalled());
  });

  it('will not offer to add somebody who is already comped', async () => {
    api.search.mockResolvedValue([
      { id: member.profile_id, full_name: 'Free Eater', email: null, phone_number: null },
    ]);
    render(<CompMembersPanel lang="en" />);
    fireEvent.change(await screen.findByLabelText('Search customers'), { target: { value: 'free' } });
    fireEvent.click(screen.getByText('Search'));
    expect(await screen.findByText('ALREADY COMPED')).toBeTruthy();
    expect((screen.getByText('Comp').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('removes a member with its own reason', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    api.set.mockResolvedValue({
      id: member.id, profile_id: member.profile_id, phone_e164: member.phone_e164,
      is_active: false, was_active: true, pending: false,
    });
    render(<CompMembersPanel lang="en" />);
    fireEvent.change(await screen.findByLabelText('1 reason'), {
      target: { value: 'left the company' },
    });
    fireEvent.click(screen.getByText('Remove'));
    await waitFor(() => expect(api.set).toHaveBeenCalledWith(
      { userId: 'cust-1' }, false, 'left the company',
    ));
  });

  it('surfaces a server refusal rather than reporting success', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    api.set.mockRejectedValue(new Error('Only admins may change comped membership'));
    render(<CompMembersPanel lang="en" />);
    fireEvent.change(await screen.findByLabelText('1 reason'), {
      target: { value: 'left the company' },
    });
    fireEvent.click(screen.getByText('Remove'));
    expect(await screen.findByText('Only admins may change comped membership')).toBeTruthy();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('comps a phone number that belongs to no account yet', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    api.set.mockResolvedValue({
      id: 9, profile_id: null, phone_e164: '+966555820667',
      is_active: true, was_active: false, pending: true,
    });
    render(<CompMembersPanel lang="en" />);

    fireEvent.change(await screen.findByLabelText('Phone number'), {
      target: { value: '0555820667' },
    });
    fireEvent.change(screen.getByLabelText('new-phone reason'), {
      target: { value: 'guest of the owner' },
    });
    fireEvent.click(screen.getByText('Comp this number'));

    // The number goes to the server exactly as typed; normalization is the
    // server's job, so the panel cannot disagree with it.
    await waitFor(() => expect(api.set).toHaveBeenCalledWith(
      { phone: '0555820667' }, true, 'guest of the owner',
    ));
    // A pending result must NOT be reported as a live discount.
    expect(await screen.findByText(/the comp goes live the moment they sign up/)).toBeTruthy();
  });

  it('will not send an obviously too-short number', async () => {
    render(<CompMembersPanel lang="en" />);
    fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: '0555' } });
    expect(
      (screen.getByText('Comp this number').closest('button') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('marks a member nobody has claimed yet, and still allows removing it', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    api.list.mockResolvedValue([pendingMember]);
    render(<CompMembersPanel lang="en" />);

    expect(await screen.findByText('NOT SIGNED UP YET')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('2 reason'), { target: { value: 'invitation withdrawn' } });
    fireEvent.click(screen.getByText('Remove'));
    // No account to name, so the number is the identity the server is given.
    await waitFor(() => expect(api.set).toHaveBeenCalledWith(
      { phone: '+966555820667' }, false, 'invitation withdrawn',
    ));
  });

  it('points a fruitless search at the phone form instead of a dead end', async () => {
    api.search.mockResolvedValue([]);
    render(<CompMembersPanel lang="en" />);
    fireEvent.change(await screen.findByLabelText('Search customers'), {
      target: { value: '+966555820667' },
    });
    fireEvent.click(screen.getByText('Search'));
    expect(await screen.findByText(/may not have an account yet/)).toBeTruthy();
  });

  it('requires two search characters before calling the server', async () => {
    render(<CompMembersPanel lang="en" />);
    fireEvent.change(await screen.findByLabelText('Search customers'), { target: { value: 'n' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.getByText(/at least 2 characters/)).toBeTruthy());
    expect(api.search).not.toHaveBeenCalled();
  });
});
