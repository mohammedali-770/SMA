// @vitest-environment jsdom
//
// The bulk importer for branch trading hours and delivery areas.
//
// THE BEHAVIOUR WORTH PINNING IS WHAT IT DOES *NOT* DO. A paste box that writes
// on paste, or that silently picks a branch when a name is ambiguous, would fill
// forty branches with wrong data faster than any form could. So: pasting writes
// nothing, Apply writes exactly the rows the preview showed, an area that
// already exists is skipped rather than inserted a second time, and an
// accountant cannot press Apply at all.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  saveWorkingHours: vi.fn(),
  addArea: vi.fn(),
  allAreas: vi.fn(),
}));

vi.mock('../../lib/branchConfigApi', () => ({ branchConfig: api }));

import { BranchDataImportPanel } from './BranchDataImportPanel';

const BRANCHES = [
  { id: 'b-olaya', nameEn: 'Olaya', nameAr: 'العليا' },
  { id: 'b-malaz', nameEn: 'Malaz', nameAr: 'الملز' },
];

const HOURS_HEADER = 'branch\tsun\tmon\ttue\twed\tthu\tfri\tsat';
const OPEN_ROW = '11:00-23:00\t11:00-23:00\t11:00-23:00\t11:00-23:00\t11:00-23:00\t11:00-23:00\t11:00-23:00';

function renderPanel(disabled = false) {
  return render(<BranchDataImportPanel branches={BRANCHES} lang="en" disabled={disabled} />);
}

/**
 * The two paste boxes, in render order: hours first, areas second.
 *
 * Matched on a leading "branch " because testing-library's default normaliser
 * collapses the placeholder's tabs to single spaces.
 */
function boxes(): HTMLTextAreaElement[] {
  return screen.getAllByPlaceholderText(/^branch /);
}

function paste(index: number, text: string) {
  fireEvent.change(boxes()[index], { target: { value: text } });
}

function check(index: number) {
  fireEvent.click(screen.getAllByRole('button', { name: 'Check' })[index]);
}

beforeEach(() => {
  api.saveWorkingHours.mockReset().mockResolvedValue(undefined);
  api.addArea.mockReset().mockResolvedValue(undefined);
  api.allAreas.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

describe('BranchDataImportPanel — working hours', () => {
  it('writes NOTHING on paste, and nothing on Check', async () => {
    renderPanel();
    paste(0, `${HOURS_HEADER}\nOlaya\t${OPEN_ROW}`);
    expect(api.saveWorkingHours).not.toHaveBeenCalled();
    check(0);
    await screen.findByText('1 branch(es) ready');
    expect(api.saveWorkingHours).not.toHaveBeenCalled();
  });

  it('previews the branches it will touch before any write', async () => {
    renderPanel();
    paste(
      0,
      `${HOURS_HEADER}\nOlaya\t${OPEN_ROW}\nMalaz\tclosed\tclosed\tclosed\tclosed\tclosed\tclosed\tclosed`,
    );
    check(0);
    await screen.findByText('2 branch(es) ready');
    expect(screen.getByText('Olaya')).toBeTruthy();
    expect(screen.getByText('open 7 days')).toBeTruthy();
    expect(screen.getByText('7 day(s) closed')).toBeTruthy();
  });

  it('applies one call per branch with the seven parsed days', async () => {
    renderPanel();
    paste(0, `${HOURS_HEADER}\nOlaya\t${OPEN_ROW}`);
    check(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to 1 branch(es)' }));

    await waitFor(() => expect(api.saveWorkingHours).toHaveBeenCalledTimes(1));
    const [branchId, days] = api.saveWorkingHours.mock.calls[0];
    expect(branchId).toBe('b-olaya');
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({
      dayOfWeek: 0,
      isClosed: false,
      opensAt: '11:00',
      closesAt: '23:00',
    });
    await screen.findByText('Applied');
  });

  it('shows the refused rows and applies only the rest', async () => {
    renderPanel();
    paste(0, `${HOURS_HEADER}\nNowhere\t${OPEN_ROW}\nMalaz\t${OPEN_ROW}`);
    check(0);
    await screen.findByText('1 row(s) refused');
    expect(screen.getByText('line 2: no branch matches "Nowhere"')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Apply to 1 branch(es)' }));
    await waitFor(() => expect(api.saveWorkingHours).toHaveBeenCalledTimes(1));
    expect(api.saveWorkingHours.mock.calls[0][0]).toBe('b-malaz');
  });

  it('reports a partial failure instead of claiming success', async () => {
    api.saveWorkingHours
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('permission denied'));
    renderPanel();
    paste(0, `${HOURS_HEADER}\nOlaya\t${OPEN_ROW}\nMalaz\t${OPEN_ROW}`);
    check(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Apply to 2 branch(es)' }));

    await screen.findByText('Partly applied');
    expect(screen.getByText('written: 1 · failed: 1')).toBeTruthy();
    expect(screen.getByText('Malaz: permission denied')).toBeTruthy();
  });

  it('discards a stale plan when the paste changes', async () => {
    renderPanel();
    paste(0, `${HOURS_HEADER}\nOlaya\t${OPEN_ROW}`);
    check(0);
    await screen.findByText('1 branch(es) ready');
    // Editing after Check must not leave an Apply button describing the OLD text.
    paste(0, `${HOURS_HEADER}\nMalaz\t${OPEN_ROW}`);
    expect(screen.queryByRole('button', { name: /^Apply to/ })).toBeNull();
  });

  it('does not let an accountant apply', async () => {
    renderPanel(true);
    paste(0, `${HOURS_HEADER}\nOlaya\t${OPEN_ROW}`);
    check(0);
    const apply = await screen.findByRole('button', { name: 'Apply to 1 branch(es)' });
    expect(apply.hasAttribute('disabled')).toBe(true);
    fireEvent.click(apply);
    expect(api.saveWorkingHours).not.toHaveBeenCalled();
  });
});

describe('BranchDataImportPanel — delivery areas', () => {
  const AREAS_HEADER = 'branch\tname_ar\tname_en';

  it('reads the existing areas at Check, not at mount', async () => {
    renderPanel();
    expect(api.allAreas).not.toHaveBeenCalled();
    paste(1, `${AREAS_HEADER}\nOlaya\tالسليمانية\tSulaimaniyah`);
    check(1);
    await waitFor(() => expect(api.allAreas).toHaveBeenCalledTimes(1));
  });

  it('SKIPS an area the branch already has rather than inserting a second one', async () => {
    api.allAreas.mockResolvedValue([
      {
        id: 'a1',
        branchId: 'b-olaya',
        nameAr: 'السليمانية',
        nameEn: null,
        sortOrder: 0,
        isDisabled: false,
        disabledUntil: null,
      },
    ]);
    renderPanel();
    paste(1, [AREAS_HEADER, 'Olaya\tالسليمانية\t', 'Malaz\tالمروج\t'].join('\n'));
    check(1);

    await screen.findByText('1 new area(s)');
    expect(screen.getByText('1 already there')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add 1 area(s)' }));
    await waitFor(() => expect(api.addArea).toHaveBeenCalledTimes(1));
    expect(api.addArea).toHaveBeenCalledWith('b-malaz', 'المروج', null);
    await screen.findByText('written: 1 · duplicates skipped: 1');
  });

  it('carries the English name through when the sheet has one', async () => {
    renderPanel();
    paste(1, `${AREAS_HEADER}\nOlaya\tالسليمانية\tSulaimaniyah`);
    check(1);
    fireEvent.click(await screen.findByRole('button', { name: 'Add 1 area(s)' }));
    await waitFor(() => expect(api.addArea).toHaveBeenCalledWith('b-olaya', 'السليمانية', 'Sulaimaniyah'));
  });

  it('re-applying the same paste adds nothing, because addArea always inserts', async () => {
    renderPanel();
    paste(1, `${AREAS_HEADER}\nOlaya\tالسليمانية\t`);
    check(1);
    fireEvent.click(await screen.findByRole('button', { name: 'Add 1 area(s)' }));
    await waitFor(() => expect(api.addArea).toHaveBeenCalledTimes(1));
    // The row is a duplicate now, so the button reads zero and refuses the press.
    const again = await screen.findByRole('button', { name: 'Add 0 area(s)' });
    expect(again.hasAttribute('disabled')).toBe(true);
    fireEvent.click(again);
    expect(api.addArea).toHaveBeenCalledTimes(1);
  });

  it('says plainly when the existing areas could not be read', async () => {
    api.allAreas.mockRejectedValue(new Error('network down'));
    renderPanel();
    paste(1, `${AREAS_HEADER}\nOlaya\tالسليمانية\t`);
    check(1);
    await screen.findByText('Existing areas could not be read');
    // It still parses, so the administrator is not stuck — but the warning says
    // the duplicate check is not protecting them.
    expect(screen.getByText('1 new area(s)')).toBeTruthy();
  });
});
