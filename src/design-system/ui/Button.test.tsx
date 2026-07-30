// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from './Button';

afterEach(cleanup);

describe('Button (web)', () => {
  it('fires onClick when idle', () => {
    const onClick = vi.fn();
    render(<Button label="Place order" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Place order' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire while loading — the double-charge guard', () => {
    const onClick = vi.fn();
    render(<Button label="Place order" onClick={onClick} loading />);
    const btn = screen.getByRole('button', { name: 'Place order' }) as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('does NOT fire when disabled', () => {
    const onClick = vi.fn();
    render(<Button label="Save" onClick={onClick} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('still refuses the press if the disabled attribute is stripped', () => {
    // Defence in depth: `disabled` is trivially removable in devtools, and a
    // programmatic .click() ignores pointer-events. The handler must self-guard.
    const onClick = vi.fn();
    render(<Button label="Pay" onClick={onClick} loading />);
    const btn = screen.getByRole('button', { name: 'Pay' }) as HTMLButtonElement;
    btn.disabled = false;
    btn.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is not busy when merely disabled', () => {
    render(<Button label="Save" onClick={() => {}} disabled />);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-busy')).toBe('false');
  });

  it('keeps the label visible while loading so the button does not resize', () => {
    render(<Button label="Verifying" onClick={() => {}} loading />);
    expect(screen.getByText('Verifying')).toBeTruthy();
  });

  it('exposes aria-disabled for assistive tech, not just the attribute', () => {
    render(<Button label="Save" onClick={() => {}} disabled />);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('defaults to type="button" so it cannot accidentally submit a form', () => {
    render(<Button label="Cancel" onClick={() => {}} />);
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('type')).toBe('button');
  });
});
