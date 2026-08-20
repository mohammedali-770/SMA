// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// The editor talks only to branchConfig; AppContext is exported from the mock
// because the design-system primitives read language through useDsLang's
// defensive useContext.
vi.mock('../../../../context/AppContext', () => ({
  AppContext: React.createContext(undefined),
  useApp: () => ({ adminLang: 'en' }),
}));

const mocks = vi.hoisted(() => ({
  areas: vi.fn(),
  addArea: vi.fn(),
  moveArea: vi.fn(),
  deleteArea: vi.fn(),
}));
vi.mock('../../../../lib/branchConfigApi', () => ({ branchConfig: mocks }));

import { DeliveryAreasEditor } from './DeliveryAreasEditor';

const area = (id: string, nameAr: string, sortOrder: number, isDisabled = false) => ({
  id, branchId: 'b1', nameAr, nameEn: nameAr, sortOrder, isDisabled, disabledUntil: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.areas.mockResolvedValue([]);
  mocks.addArea.mockResolvedValue(undefined);
  mocks.moveArea.mockResolvedValue(undefined);
  mocks.deleteArea.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('DeliveryAreasEditor', () => {
  it('says in the UI that areas do not control the app', async () => {
    // The whole hazard of this feature: someone disables "النسيم" and assumes
    // the app stops accepting orders there. It does not. Saying so only in the
    // docs would not reach the person doing it.
    render(<DeliveryAreasEditor branchId="b1" isRTL={false} />);
    expect(await screen.findByText(/Call-centre reference only/i)).toBeTruthy();
    expect(screen.getByText(/do not control the app/i)).toBeTruthy();
  });

  it('loads the branch\'s areas', async () => {
    mocks.areas.mockResolvedValue([area('a1', 'Malaz', 1)]);
    render(<DeliveryAreasEditor branchId="b1" isRTL={false} />);
    await waitFor(() => expect(mocks.areas).toHaveBeenCalledWith('b1'));
    expect(await screen.findByText('Malaz')).toBeTruthy();
  });

  it('adds an area and clears the form', async () => {
    render(<DeliveryAreasEditor branchId="b1" isRTL={false} />);
    const arabic = await screen.findByLabelText(/Area name \(Arabic\)/i);
    fireEvent.change(arabic, { target: { value: 'النسيم' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));
    await waitFor(() => expect(mocks.addArea).toHaveBeenCalledWith('b1', 'النسيم', ''));
    await waitFor(() => expect((arabic as HTMLInputElement).value).toBe(''));
  });

  it('will not add an area with no Arabic name', async () => {
    render(<DeliveryAreasEditor branchId="b1" isRTL={false} />);
    const add = await screen.findByRole('button', { name: /^Add$/i });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(add);
    expect(mocks.addArea).not.toHaveBeenCalled();
  });

  it('renumbers densely when reordering, not just swapping the pair', async () => {
    // Dense renumbering is what stops repeated moves drifting into gaps that
    // make the next move ambiguous.
    mocks.areas.mockResolvedValue([area('a1', 'One', 1), area('a2', 'Two', 2), area('a3', 'Three', 3)]);
    render(<DeliveryAreasEditor branchId="b1" isRTL={false} />);
    fireEvent.click(await screen.findByLabelText(/Move Three up/i));
    await waitFor(() => expect(mocks.moveArea).toHaveBeenCalledWith('a3', 2));
    expect(mocks.moveArea).toHaveBeenCalledWith('a2', 3);
  });

  it('disables the move buttons at the ends of the list', async () => {
    mocks.areas.mockResolvedValue([area('a1', 'One', 1), area('a2', 'Two', 2)]);
    render(<DeliveryAreasEditor branchId="b1" isRTL={false} />);
    expect(((await screen.findByLabelText(/Move One up/i)) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Move Two down/i) as HTMLButtonElement).disabled).toBe(true);
  });

  it('confirms before deleting', async () => {
    mocks.areas.mockResolvedValue([area('a1', 'Malaz', 1)]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<DeliveryAreasEditor branchId="b1" isRTL={false} />);
    fireEvent.click(await screen.findByLabelText(/Delete Malaz/i));
    expect(confirm).toHaveBeenCalled();
    expect(mocks.deleteArea).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByLabelText(/Delete Malaz/i));
    await waitFor(() => expect(mocks.deleteArea).toHaveBeenCalledWith('a1'));
  });

  it('hides every editing affordance from a read-only accountant', async () => {
    mocks.areas.mockResolvedValue([area('a1', 'Malaz', 1)]);
    render(<DeliveryAreasEditor branchId="b1" disabled isRTL={false} />);
    expect(await screen.findByText('Malaz')).toBeTruthy();
    // Hidden, not greyed — matching how the modal hides Save entirely.
    expect(screen.queryByRole('button', { name: /^Add$/i })).toBeNull();
    expect(screen.queryByLabelText(/Delete Malaz/i)).toBeNull();
  });

  it('shows a disabled area as such', async () => {
    mocks.areas.mockResolvedValue([area('a1', 'Malaz', 1, true)]);
    render(<DeliveryAreasEditor branchId="b1" isRTL={false} />);
    expect(await screen.findByText(/Disabled/i)).toBeTruthy();
  });

  it('surfaces a server refusal instead of failing silently', async () => {
    mocks.areas.mockRejectedValue(new Error('Only admins may add a delivery area'));
    render(<DeliveryAreasEditor branchId="b1" isRTL={false} />);
    expect(await screen.findByText(/Only admins may add/i)).toBeTruthy();
  });
});
