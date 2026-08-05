import { describe, expect, it } from 'vitest';

import { numericFieldDisplay, parseNumericCommit } from './numericField';

/**
 * These pin the exact defect that shipped: `parseFloat(raw) || 0`.
 *
 * Every case below returned 0 under the old expression, and 0 is a REAL value
 * for a delivery fee (free delivery) and for a VAT rate (no tax on any order,
 * retroactively re-split across every historical receipt). The contract here is
 * that none of them may ever produce a committable value.
 */
describe('parseNumericCommit — inputs that must never persist a zero', () => {
  const cannotCommit = ['', '   ', 'abc', '-', '.', 'NaN', 'Infinity', '1e', '--5'];

  it.each(cannotCommit)('refuses %o instead of coercing it to 0', (raw) => {
    const result = parseNumericCommit(raw);
    expect(result.ok).toBe(false);
  });

  it('refuses a blank field by default — blank is not zero', () => {
    expect(parseNumericCommit('')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects a partial numeric like "12abc" that parseFloat would have accepted as 12', () => {
    // parseFloat('12abc') === 12 — it would have silently persisted a number
    // the operator never finished typing.
    expect(parseNumericCommit('12abc').ok).toBe(false);
  });
});

describe('parseNumericCommit — valid values', () => {
  it('accepts a plain fee', () => {
    expect(parseNumericCommit('25')).toEqual({ ok: true, value: 25 });
  });

  it('accepts a decimal fee and surrounding whitespace', () => {
    expect(parseNumericCommit(' 12.50 ')).toEqual({ ok: true, value: 12.5 });
  });

  it('accepts an explicit zero when the operator actually types it', () => {
    // Free delivery is a legitimate setting. The bug was never that 0 is
    // invalid — it is that BLANK became 0 without anyone choosing it.
    expect(parseNumericCommit('0')).toEqual({ ok: true, value: 0 });
  });
});

describe('parseNumericCommit — bounds', () => {
  it('rejects a negative fee', () => {
    expect(parseNumericCommit('-5')).toEqual({ ok: false, reason: 'below-min' });
  });

  it('rejects a VAT rate above 100%', () => {
    expect(parseNumericCommit('150', { max: 100 })).toEqual({ ok: false, reason: 'above-max' });
  });

  it('accepts the boundaries themselves', () => {
    expect(parseNumericCommit('0', { max: 100 })).toEqual({ ok: true, value: 0 });
    expect(parseNumericCommit('100', { max: 100 })).toEqual({ ok: true, value: 100 });
  });
});

describe('parseNumericCommit — optional and integer fields', () => {
  it('commits null for a blank optional field, never 0', () => {
    // The delivery ETA is "not set", which must not render as "0 minutes".
    expect(parseNumericCommit('', { allowEmpty: true })).toEqual({ ok: true, value: null });
  });

  it('rejects a fractional value where only whole units make sense', () => {
    expect(parseNumericCommit('12.5', { integer: true }).ok).toBe(false);
    expect(parseNumericCommit('12', { integer: true })).toEqual({ ok: true, value: 12 });
  });
});

describe('numericFieldDisplay', () => {
  it('renders a stored number', () => {
    expect(numericFieldDisplay(25)).toBe('25');
    expect(numericFieldDisplay(0)).toBe('0');
  });

  it('renders blank for an unset value rather than the string "0"', () => {
    expect(numericFieldDisplay(null)).toBe('');
    expect(numericFieldDisplay(undefined)).toBe('');
    expect(numericFieldDisplay(NaN)).toBe('');
  });
});
