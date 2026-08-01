/**
 * The one accessible modal foundation for the console.
 *
 * Everything that makes a dialog behave like a dialog lives here, so there is a
 * single place it can be right: the scrim, the portal, the focus trap, Escape,
 * focus restoration, and marking the rest of the page inert. `AdminModal` adds
 * the standard header/footer on top; `OrderReceiptModal` keeps its own header
 * and uses this for the behaviour. Neither implements any of it twice.
 *
 * WHY A PORTAL. `inert` cannot be applied to "everything except me" while the
 * dialog is a descendant of the thing being inerted. Rendering to `document.body`
 * makes the app root a sibling, which is then inertable in one line. React keeps
 * component state and refs across the move, so the delivery-zone map's container
 * ref and ResizeObserver are unaffected.
 *
 * WHERE INITIAL FOCUS GOES, and why it is the container rather than the first
 * control. The first focusable element in these dialogs is the ✕, and the ones
 * after it are a status <select> that changes an order, a Clear that deletes a
 * delivery zone, and a Save. Landing focus on any of them means one stray
 * keystroke does something. Focusing the labelled container announces the dialog
 * to a screen reader and leaves the first Tab to the operator. A caller that has
 * a genuinely safe first field can opt in with `initialFocus`.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Elements that can hold focus. `[data-focus-guard]` is excluded so the trap's
 * own sentinels never become a tab stop.
 */
const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Exported so a test can assert on THIS list rather than re-querying the DOM.
 * A test that runs its own `querySelectorAll` still passes when this function
 * returns nothing, which is precisely the way a focus trap dies quietly.
 */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    // Filtered by ATTRIBUTE, not by `offsetParent`. offsetParent is the usual
    // "is it visible" trick and it is wrong here twice over: it is always null
    // under jsdom, which would silently empty this list and make the trap a
    // no-op in every test; and these dialogs remove hidden branches from the
    // DOM entirely rather than hiding them, so there is nothing for it to catch.
    .filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
}

export function ModalShell({
  label,
  isRTL,
  onClose,
  /**
   * Whether Escape and the scrim may close this dialog. Mirrors whether the
   * caller offers a Cancel affordance at all — a dialog you cannot cancel must
   * not be cancellable by keyboard either.
   */
  dismissable = true,
  /** CSS selector for a safe control to focus instead of the container. */
  initialFocus,
  className = '',
  children,
}: {
  label: string;
  isRTL: boolean;
  onClose: () => void;
  dismissable?: boolean;
  initialFocus?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Captured on mount, BEFORE focus moves, so it is genuinely the element the
  // operator pressed rather than whatever happens to be focused at close time.
  if (openerRef.current === null && typeof document !== 'undefined') {
    openerRef.current = document.activeElement as HTMLElement | null;
  }

  // --- initial focus + restore -------------------------------------------
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = openerRef.current;

    const target = initialFocus
      ? dialog.querySelector<HTMLElement>(initialFocus) ?? dialog
      : dialog;
    target.focus({ preventScroll: true });

    return () => {
      // Only restore if focus is still ours to move. If something else has
      // already claimed it (a toast, a navigation), stealing it back is worse.
      const active = document.activeElement;
      if (active === document.body || active === null || dialog.contains(active)) {
        opener?.focus?.({ preventScroll: true });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- background inert ---------------------------------------------------
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    // `inert` removes the subtree from the tab order AND from the accessibility
    // tree, which is the pair `aria-hidden` alone does not give.
    root.setAttribute('inert', '');
    root.setAttribute('aria-hidden', 'true');
    return () => {
      root.removeAttribute('inert');
      root.removeAttribute('aria-hidden');
    };
  }, []);

  // --- Escape -------------------------------------------------------------
  useEffect(() => {
    if (!dismissable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismissable, onClose]);

  // --- focus trap ---------------------------------------------------------
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = focusableWithin(dialog);
    if (items.length === 0) {
      // Nothing to move to; keep focus on the container rather than letting it
      // escape to the inerted page behind.
      e.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus({ preventScroll: true });
    }
  }, []);

  const tree = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/60 p-4"
      dir={isRTL ? 'rtl' : 'ltr'}
      onKeyDown={onKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        // Only now that the page behind is genuinely inert and focus is genuinely
        // trapped. Claiming modality without them is worse than saying nothing.
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  );

  // SSR / non-DOM guard: the console is client-only, but a portal to a body that
  // does not exist is a crash rather than a degraded render.
  if (typeof document === 'undefined') return null;
  return createPortal(tree, document.body);
}
