// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Field } from './Field';

afterEach(cleanup);

describe('Field (web) — accessibility', () => {
  it('associates the label with the control', () => {
    render(<Field id="phone" label="Phone number" value="" onValueChange={() => {}} />);
    // getByLabelText only resolves if the association is real.
    expect(screen.getByLabelText('Phone number')).toBeTruthy();
  });

  it('marks the field invalid and links the error message', () => {
    render(
      <Field id="phone" label="Phone number" value="5" onValueChange={() => {}} error="Invalid number" />,
    );
    const input = screen.getByLabelText('Phone number');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('phone-error');
    expect(screen.getByRole('alert').textContent).toBe('Invalid number');
  });

  it('links the hint when there is no error', () => {
    render(<Field id="addr" label="Short address" value="" onValueChange={() => {}} hint="From the map pin" />);
    const input = screen.getByLabelText('Short address');
    expect(input.getAttribute('aria-describedby')).toBe('addr-hint');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the error INSTEAD of the hint, never both', () => {
    render(
      <Field
        id="addr"
        label="Short address"
        value="x"
        onValueChange={() => {}}
        hint="From the map pin"
        error="Invalid code"
      />,
    );
    expect(screen.getByText('Invalid code')).toBeTruthy();
    expect(screen.queryByText('From the map pin')).toBeNull();
  });

  it('reports required state to assistive tech', () => {
    render(<Field id="name" label="Name" value="" onValueChange={() => {}} required />);
    expect(screen.getByLabelText('Name').hasAttribute('required')).toBe(true);
  });

  it('does not emit changes while disabled', () => {
    const onValueChange = vi.fn();
    render(<Field id="name" label="Name" value="" onValueChange={onValueChange} disabled />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'nope' } });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('emits the raw value on change', () => {
    const onValueChange = vi.fn();
    render(<Field id="name" label="Name" value="" onValueChange={onValueChange} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Nora' } });
    expect(onValueChange).toHaveBeenCalledWith('Nora');
  });

  it('pins numeric fields LTR so Arabic copy cannot reorder digits', () => {
    render(<Field id="otp" label="Code" value="492031" onValueChange={() => {}} numeric />);
    // `.num` carries direction:ltr + unicode-bidi:isolate + tabular mono.
    expect(screen.getByLabelText('Code').className).toContain('num');
  });

  it('generates a unique id when none is supplied', () => {
    render(
      <>
        <Field label="A" value="" onValueChange={() => {}} error="Bad" />
        <Field label="B" value="" onValueChange={() => {}} error="Bad" />
      </>,
    );
    const [a, b] = screen.getAllByRole('textbox');
    expect(a.getAttribute('aria-describedby')).not.toBe(b.getAttribute('aria-describedby'));
  });
});
