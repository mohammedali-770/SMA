// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { Field } from './Field';

afterEach(cleanup);

/**
 * Acceptance checks for the Button/Field migration brief. These assert the
 * properties a call site is allowed to rely on once it swaps, so a future
 * refactor cannot quietly regress them.
 */

describe('required indicator is excluded from the accessible name', () => {
  it('the asterisk is not part of the field name', () => {
    render(<Field id="short-address" label="Short address" value="" onValueChange={() => {}} required />);
    // Resolves ONLY if the accessible name is exactly "Short address".
    // If the asterisk leaked in, the name would be "Short address *" and a
    // screen reader would announce "Short address star".
    const input = screen.getByLabelText('Short address');
    expect(input).toBeTruthy();
    expect(screen.queryByLabelText('Short address *')).toBeNull();
  });

  it('required is still conveyed programmatically, not visually only', () => {
    render(<Field id="name" label="Name" value="" onValueChange={() => {}} required />);
    expect(screen.getByLabelText('Name').hasAttribute('required')).toBe(true);
  });

  it('the asterisk is hidden from assistive tech', () => {
    const { container } = render(<Field id="n" label="Name" value="" onValueChange={() => {}} required />);
    const star = Array.from(container.querySelectorAll('span')).find((s) => s.textContent?.includes('*'));
    expect(star?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('keyboard, focus and submit behaviour', () => {
  it('focus and blur handlers still reach the caller', () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    render(<Field id="n" label="Name" value="" onValueChange={() => {}} onFocus={onFocus} onBlur={onBlur} />);
    const input = screen.getByLabelText('Name');
    fireEvent.focus(input);
    expect(onFocus).toHaveBeenCalledTimes(1);
    fireEvent.blur(input);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('the field is reachable by keyboard (not removed from tab order)', () => {
    render(<Field id="n" label="Name" value="" onValueChange={() => {}} />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);
  });

  it('a disabled field is not focusable', () => {
    render(<Field id="n" label="Name" value="" onValueChange={() => {}} disabled />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    input.focus();
    expect(document.activeElement).not.toBe(input);
  });

  it('Button defaults to type="button" so it cannot submit a form by accident', () => {
    render(<Button label="Cancel" onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('type')).toBe('button');
  });

  it('Button can opt into submit explicitly', () => {
    render(<Button label="Save" onClick={() => {}} type="submit" />);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('type')).toBe('submit');
  });

  it('a keyboard Enter on a disabled Button does not execute', () => {
    const onClick = vi.fn();
    render(<Button label="Pay" onClick={onClick} disabled />);
    const btn = screen.getByRole('button', { name: 'Pay' });
    fireEvent.keyDown(btn, { key: 'Enter', code: 'Enter' });
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Arabic and English labels and messages', () => {
  it('renders an Arabic label and error without mangling them', () => {
    render(
      <Field id="ar" label="رقم الجوال" value="" onValueChange={() => {}} error="رقم غير صحيح" required />,
    );
    expect(screen.getByLabelText('رقم الجوال')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('رقم غير صحيح');
  });

  it('renders an English label and error', () => {
    render(<Field id="en" label="Phone number" value="" onValueChange={() => {}} error="Invalid number" />);
    expect(screen.getByLabelText('Phone number')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Invalid number');
  });

  it('uses logical alignment so the field mirrors from dir, not hardcoded sides', () => {
    const { container } = render(<Field id="x" label="Label" value="" onValueChange={() => {}} />);
    const label = container.querySelector('label')!;
    // text-start / ps-/pe- mirror automatically; text-left / pl- would not.
    expect(label.className).toContain('text-start');
    expect(label.className).not.toMatch(/\btext-left\b|\btext-right\b/);
  });
});
