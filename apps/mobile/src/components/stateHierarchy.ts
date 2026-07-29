/**
 * Full-screen state hierarchy — FRAMEWORK-FREE and unit-tested.
 *
 * `ErrorView` used to render whatever string it was handed as the heading. That
 * string is often a provider or transport message ("Network request failed", a
 * PostgREST error, an HTTP status), so the most prominent text on the screen
 * could be something the customer can neither understand nor act on.
 *
 * This decides what becomes the heading and what is demoted to quiet detail.
 * Technical text is never discarded — support asks customers to read it back —
 * it simply stops being the headline.
 */

/**
 * Does this read like a string that escaped from a library rather than one
 * written for a customer? Deliberately conservative: a false negative just
 * keeps today's behaviour, while a false positive would hide a good message
 * behind a generic one.
 */
export function looksTechnical(message: string): boolean {
  const m = (message ?? '').trim();
  if (!m) return true;
  return (
    // Transport / runtime vocabulary, bare HTTP status codes, JSON or markup
    // fragments, URLs, and snake_case tokens.
    /(\b(error|exception|failed|failure|fetch|network request|timeout|timed out|null|undefined|status code|econn[a-z]*|\d{3})\b|[{}[\]<>]|https?:\/\/|_[a-z]+_)/i.test(m)
    // Postgres-style quoted identifiers, e.g. relation "orders" does not exist.
    // Straight quotes around a lowercase snake token do not occur in our copy.
    || /"[a-z_]{2,}"/.test(m)
  );
}

export interface StatePresentation {
  /** Step 1 — the loudest line. */
  heading: string;
  /** Step 3 — quiet supporting detail, or null when there is nothing to add. */
  detail: string | null;
}

/**
 * Split a raw message into heading + detail.
 *
 * - An explicit `title` always wins and pushes `message` to detail.
 * - A technical `message` is replaced by `fallbackTitle` and demoted.
 * - A human `message` stays as the heading with no detail (no repetition —
 *   showing the same sentence twice is exactly the repetition the hierarchy
 *   rule asks us to remove).
 */
export function presentState(input: {
  message: string;
  title?: string | null;
  fallbackTitle: string;
}): StatePresentation {
  const message = (input.message ?? '').trim();
  if (input.title) {
    return { heading: input.title, detail: message && message !== input.title ? message : null };
  }
  if (looksTechnical(message)) {
    return { heading: input.fallbackTitle, detail: message || null };
  }
  return { heading: message, detail: null };
}
