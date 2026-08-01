// @vitest-environment jsdom
/**
 * Keyboard and assistive-technology behaviour for the console's modal shell.
 *
 * The old dialogs rendered `role="dialog"` and nothing else — no trap, no
 * Escape, no restore, and the page behind fully reachable by Tab. `aria-modal`
 * was deliberately withheld because claiming modality without enforcing it is
 * worse than saying nothing. These tests are the enforcement, so `aria-modal`
 * can now be true.
 *
 * The trap is the part most likely to rot silently: a helper that returns an
 * empty focusable list still "passes" a naive assertion, so the wrapping tests
 * check the ELEMENT that ends up focused rather than that no error was thrown.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminModal } from './AdminModal';
import { ModalShell, focusableWithin } from './ModalShell';

afterEach(cleanup);

/** The app root the shell inerts. Present in index.html; created here per test. */
function withRoot(children: React.ReactNode) {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return render(<>{children}</>, { container: root });
}

function Harness({ dismissable = true }: { dismissable?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open editor</button>
      <button type="button">Background control</button>
      {open && (
        <AdminModal
          title="Edit branch"
          isRTL={false}
          dismissable={dismissable}
          onClose={() => setOpen(false)}
          footer={<button type="button">Save</button>}
        >
          <input aria-label="Name" />
          <input aria-label="Phone" />
        </AdminModal>
      )}
    </>
  );
}

const dialog = () => screen.getByRole('dialog');
const openIt = () => fireEvent.click(screen.getByRole('button', { name: 'Open editor' }));

describe('modality is claimed only because it is enforced', () => {
  it('marks itself aria-modal and names itself', () => {
    withRoot(<Harness />);
    openIt();
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().getAttribute('aria-label')).toBe('Edit branch');
  });

  it('makes the app root inert AND hidden from assistive tech while open', () => {
    // `inert` removes the subtree from the tab order and the accessibility
    // tree; aria-hidden alone would leave it tabbable.
    withRoot(<Harness />);
    const root = document.getElementById('root')!;
    expect(root.hasAttribute('inert')).toBe(false);
    openIt();
    expect(root.hasAttribute('inert')).toBe(true);
    expect(root.getAttribute('aria-hidden')).toBe('true');
  });

  it('releases the app root on close', () => {
    withRoot(<Harness />);
    const root = document.getElementById('root')!;
    openIt();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(root.hasAttribute('inert')).toBe(false);
    expect(root.hasAttribute('aria-hidden')).toBe(false);
  });

  it('renders outside the app root, so the root can be inerted at all', () => {
    withRoot(<Harness />);
    openIt();
    expect(document.getElementById('root')!.contains(dialog())).toBe(false);
  });
});

describe('initial focus lands somewhere safe', () => {
  it('focuses the dialog container, not a control', () => {
    // The first focusable in these dialogs is the ✕, and the ones after it
    // save, clear a delivery zone or change an order's status. Landing focus on
    // any of them means one stray keystroke does something.
    withRoot(<Harness />);
    openIt();
    expect(document.activeElement).toBe(dialog());
  });

  it('honours an explicit safe target when the caller supplies one', () => {
    withRoot(
      <AdminModal title="T" isRTL={false} onClose={() => {}} initialFocus="input">
        <input aria-label="First" />
      </AdminModal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('First'));
  });
});

describe('focus is trapped', () => {
  const focusables = () =>
    Array.from(dialog().querySelectorAll<HTMLElement>('button, input'));

  it('Tab from the last control wraps to the first', () => {
    withRoot(<Harness />);
    openIt();
    const items = focusables();
    const first = items[0];
    const last = items[items.length - 1];

    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('Shift+Tab from the first control wraps to the last', () => {
    withRoot(<Harness />);
    openIt();
    const items = focusables();
    const first = items[0];
    const last = items[items.length - 1];

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('Shift+Tab from the container wraps to the last, not out of the dialog', () => {
    // The container is where focus starts, so this is the very first keystroke
    // a Shift+Tab user makes.
    withRoot(<Harness />);
    openIt();
    const items = focusables();
    fireEvent.keyDown(dialog(), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('the SHELL’s own focusable list is not empty', () => {
    // Asserts on `focusableWithin`, not on a fresh querySelectorAll. A test
    // that runs its own query still passes when the shell's helper returns
    // nothing — and a trap with an empty list silently stops trapping while
    // every wrapping assertion above keeps passing.
    withRoot(<Harness />);
    openIt();
    expect(focusableWithin(dialog()).length).toBeGreaterThan(2);
    expect(focusableWithin(dialog())).toEqual(focusables());
  });
});

describe('Escape', () => {
  it('closes a dismissable dialog', () => {
    withRoot(<Harness />);
    openIt();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does NOT close one that cannot be cancelled', () => {
    // A dialog with no ✕ must not be escapable either, or the keyboard offers
    // an exit the pointer does not.
    withRoot(<Harness dismissable={false} />);
    openIt();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('hides the ✕ when the dialog is not dismissable', () => {
    withRoot(<Harness dismissable={false} />);
    openIt();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('ignores other keys', () => {
    withRoot(<Harness />);
    openIt();
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'a' });
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });
});

describe('focus returns to whatever opened the dialog', () => {
  it('restores to the trigger after Escape', () => {
    withRoot(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open editor' });
    trigger.focus();
    openIt();
    expect(document.activeElement).not.toBe(trigger);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('restores to the trigger after the ✕', () => {
    withRoot(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open editor' });
    trigger.focus();
    openIt();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(trigger);
  });
});

describe('existing behaviour is preserved', () => {
  it('the ✕ still calls onClose exactly once', () => {
    const onClose = vi.fn();
    withRoot(<ModalShell label="T" isRTL={false} onClose={onClose}><span>body</span></ModalShell>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape does not submit a form inside the dialog', () => {
    // The menu editors put their <form> in the body so Enter-to-submit and
    // native `required` validation keep working. Escape must cancel, not save.
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const onClose = vi.fn();
    withRoot(
      <ModalShell label="T" isRTL={false} onClose={onClose}>
        <form onSubmit={onSubmit}><input aria-label="Field" /><button type="submit">Save</button></form>
      </ModalShell>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders the footer the caller supplies, and it is reachable', () => {
    withRoot(<Harness />);
    openIt();
    const save = screen.getByRole('button', { name: 'Save' });
    save.focus();
    expect(document.activeElement).toBe(save);
  });

  it('RTL direction still reaches the dialog', () => {
    withRoot(
      <AdminModal title="عنوان" isRTL onClose={() => {}}><span>body</span></AdminModal>,
    );
    expect(dialog().closest('[dir]')?.getAttribute('dir')).toBe('rtl');
  });
});
