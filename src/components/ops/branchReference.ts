/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BranchReferenceRow, DeliveryRequestRow } from '../../lib/opsApi';

/**
 * Pure logic for the branch reference sheet and the delivery-request panel,
 * kept out of the components so both can be tested without rendering.
 */

/* -------------------------------------------------------------------------- */
/* Delivery requests                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Whether a request is still waiting for the call centre.
 *
 * Expiry is evaluated HERE as well as server-side, and deliberately so: the
 * server retires a stale request only when somebody touches it, so a row can
 * sit at `pending` past its own `expires_at`. A console that trusted `status`
 * alone would show "waiting for the call centre" for a request nobody can
 * accept any more — which is the one thing a cashier must not be told.
 */
export function isAwaiting(req: DeliveryRequestRow, now: number): boolean {
  return req.status === 'pending' && Date.parse(req.expiresAt) > now;
}

/** The request a cashier is currently waiting on, if any. */
export function awaitingRequest(
  requests: readonly DeliveryRequestRow[],
  now: number,
): DeliveryRequestRow | null {
  return requests.find((r) => isAwaiting(r, now)) ?? null;
}

/**
 * The most recent request worth REPORTING once nothing is waiting — an
 * answered request the cashier has probably not seen yet.
 *
 * Only `accepted` and `declined` qualify. A request the branch withdrew needs
 * no report (they withdrew it), and an expired one is reported by its absence
 * plus the ability to send a new one.
 */
export function lastAnswered(
  requests: readonly DeliveryRequestRow[],
  now: number,
): DeliveryRequestRow | null {
  if (awaitingRequest(requests, now)) return null;
  return requests.find((r) => r.status === 'accepted' || r.status === 'declined') ?? null;
}

/**
 * Whether the branch may file a new request.
 *
 * Mirrors the server's refusals so the button is disabled rather than the
 * cashier meeting an error: one open request per branch, and nothing to ask
 * for while delivery is already closed. The server remains the authority — this
 * only avoids a pointless round trip.
 */
export function canRequest(input: {
  requests: readonly DeliveryRequestRow[];
  deliveryClosed: boolean;
  now: number;
}): boolean {
  if (input.deliveryClosed) return false;
  return awaitingRequest(input.requests, input.now) === null;
}

/** Minutes left before an unanswered request retires itself, or 0. */
export function minutesUntilExpiry(req: DeliveryRequestRow, now: number): number {
  const ms = Date.parse(req.expiresAt) - now;
  return ms <= 0 ? 0 : Math.ceil(ms / 60000);
}

/* -------------------------------------------------------------------------- */
/* Reference sheet                                                            */
/* -------------------------------------------------------------------------- */

/** What a secret shows before it is revealed. Never derived from the value. */
export const SECRET_MASK = '••••••••';

/**
 * The text to display for one entry.
 *
 * A secret always renders as the fixed mask until a value has been revealed
 * into component state. The mask is a CONSTANT rather than a function of the
 * value's length, because a length-derived mask leaks the length.
 */
export function displayValue(entry: BranchReferenceRow, revealed: string | undefined): string {
  if (entry.kind !== 'secret') return entry.valuePlain ?? '';
  return revealed ?? SECRET_MASK;
}

/** Whether this entry has a hidden value the operator could ask to see. */
export function isHidden(entry: BranchReferenceRow, revealed: string | undefined): boolean {
  return entry.kind === 'secret' && revealed === undefined;
}

/**
 * Whether the value should render as a link.
 *
 * Only `http:` and `https:` — a `javascript:` or `data:` URL in a field an
 * administrator types is the obvious way to turn this sheet into a delivery
 * mechanism, so the scheme is allowlisted rather than the dangerous ones
 * blocked. Anything else renders as plain text, which is safe and still useful.
 */
export function safeHref(entry: BranchReferenceRow): string | null {
  if (entry.kind !== 'link') return null;
  const raw = (entry.valuePlain ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A `tel:` target for a phone entry, or null when it holds no usable digits. */
export function telHref(entry: BranchReferenceRow): string | null {
  if (entry.kind !== 'phone') return null;
  const digits = (entry.valuePlain ?? '').replace(/[^\d+]/g, '');
  return digits.length >= 3 ? `tel:${digits}` : null;
}

/** Entries in display order: the sheet is an administrator's ordering, kept. */
export function orderedEntries(rows: readonly BranchReferenceRow[]): BranchReferenceRow[] {
  return [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.labelEn.localeCompare(b.labelEn));
}
