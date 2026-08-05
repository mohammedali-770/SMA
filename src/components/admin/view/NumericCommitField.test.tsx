// @vitest-environment jsdom
/**
 * The behavioural half of the fix: typing must not write, and an invalid entry
 * must restore the stored value rather than persist one.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NumericCommitField } from './NumericCommitField';

afterEach(cleanup);

const setup = (over: Partial<React.ComponentProps<typeof NumericCommitField>> = {}) => {
  const onCommit = vi.fn();
  render(
    <NumericCommitField label="Delivery fee" value={25} onCommit={onCommit} {...over} />,
  );
  return { onCommit, input: screen.getByLabelText('Delivery fee') as HTMLInputElement };
};

describe('NumericCommitField', () => {
  it('does NOT write while the operator is typing', () => {
    const { onCommit, input } = setup();
    // The old card wrote on every keystroke: typing "25" persisted 2, then 25.
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.change(input, { target: { value: '25' } });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits once on blur', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(30);
  });

  it('commits on Enter', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(30);
  });

  it('does not commit when the value is unchanged', () => {
    const { onCommit, input } = setup();
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('CLEARING the field restores the stored value and writes nothing', () => {
    // This is the defect: `parseFloat('') || 0` persisted a real 0 SAR fee.
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('25');
  });

  it('rejects a negative entry and restores the stored value', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('25');
  });

  it('rejects a VAT rate over its maximum', () => {
    const onCommit = vi.fn();
    render(<NumericCommitField label="VAT" value={15} onCommit={onCommit} max={100} />);
    const vat = screen.getByLabelText('VAT') as HTMLInputElement;
    fireEvent.change(vat, { target: { value: '150' } });
    fireEvent.blur(vat);
    expect(onCommit).not.toHaveBeenCalled();
    expect(vat.value).toBe('15');
  });

  it('marks a rejected entry with aria-invalid for assistive tech', () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('Escape abandons the edit without writing', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('25');
  });

  it('commits an explicit zero, because free delivery is a real setting', () => {
    const { onCommit, input } = setup();
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(0);
  });

  it('commits null for a blank optional field instead of 0', () => {
    const onCommit = vi.fn();
    render(<NumericCommitField label="ETA" value={30} onCommit={onCommit} allowEmpty integer />);
    const eta = screen.getByLabelText('ETA') as HTMLInputElement;
    fireEvent.change(eta, { target: { value: '' } });
    fireEvent.blur(eta);
    expect(onCommit).toHaveBeenCalledWith(null);
  });
});
