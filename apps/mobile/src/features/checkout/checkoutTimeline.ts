/**
 * How long each step of a card checkout took, measured on the device.
 *
 * Until 2026-11-19 every checkout timing in this project was measured by hand
 * from screenshots and database timestamps. This records milliseconds from the
 * customer's "Place order" tap to each step, and CheckoutScreen sends them as
 * ONE info-level Sentry message per card checkout ("card checkout timeline").
 *
 * It carries durations and an outcome word ONLY: no session id, order id,
 * amount, card detail, phone or name. Pure and clock-injected so it is tested
 * without a device.
 */
export type CheckoutStep =
  | 'session_begun' // begin_checkout_session answered
  | 'page_requested' // payment-initiate answered with a page to open
  | 'page_ready' // Moyasar's page first painted in the WebView
  | 'page_left' // the WebView handed back (paid page or closed)
  | 'verified'; // payment-verify answered

export type CheckoutOutcome = 'paid' | 'pending' | 'failed' | 'cancelled' | 'expired' | 'error' | 'refused';

export interface CheckoutTimeline {
  /** Record a step once; a repeated step keeps its first time. */
  mark: (step: CheckoutStep, at?: number) => void;
  /** Milliseconds from the tap to each recorded step. */
  marks: () => Partial<Record<CheckoutStep, number>>;
  /** True the first time it is called, false after: one report per checkout. */
  claimReport: () => boolean;
}

export function createCheckoutTimeline(now: () => number = Date.now): CheckoutTimeline {
  const startedAt = now();
  const recorded: Partial<Record<CheckoutStep, number>> = {};
  let reported = false;
  return {
    mark(step, at) {
      if (recorded[step] != null) return;
      recorded[step] = Math.max(0, Math.round((at ?? now()) - startedAt));
    },
    marks: () => ({ ...recorded }),
    claimReport() {
      if (reported) return false;
      reported = true;
      return true;
    },
  };
}
