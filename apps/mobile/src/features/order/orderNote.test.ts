import { describe, expect, it } from 'vitest';

import {
  ORDER_NOTE_COUNTER_THRESHOLD,
  ORDER_NOTE_MAX_LENGTH,
  checkOrderNote,
  isOrderNoteValid,
  normalizeOrderNote,
  orderNoteCopy,
  orderNoteMessage,
  orderNoteRemaining,
  orderNoteRemainingMessage,
} from './orderNote';

describe('checkOrderNote', () => {
  it('accepts a normal instruction and returns the trimmed value', () => {
    const r = checkOrderNote('  no onions, ring the bell twice  ');
    expect(r.valid).toBe(true);
    expect(r.value).toBe('no onions, ring the bell twice');
    expect(r.problem).toBeNull();
  });

  it('treats an absent note as valid — the note is optional', () => {
    for (const raw of ['', '   ', '\t', '\n  \n', null, undefined]) {
      const r = checkOrderNote(raw);
      expect(r.valid).toBe(true);
      expect(r.value).toBe('');
      expect(r.problem).toBeNull();
    }
  });

  it('accepts exactly the maximum and rejects one character more', () => {
    const atLimit = 'x'.repeat(ORDER_NOTE_MAX_LENGTH);
    expect(checkOrderNote(atLimit).valid).toBe(true);

    const overLimit = 'x'.repeat(ORDER_NOTE_MAX_LENGTH + 1);
    const r = checkOrderNote(overLimit);
    expect(r.valid).toBe(false);
    expect(r.problem).toBe('too_long');
  });

  it('measures the TRIMMED length, so surrounding whitespace cannot push a legal note over', () => {
    const padded = `   ${'x'.repeat(ORDER_NOTE_MAX_LENGTH)}   `;
    expect(padded.length).toBeGreaterThan(ORDER_NOTE_MAX_LENGTH);
    expect(checkOrderNote(padded).valid).toBe(true);
  });

  it('counts an Arabic note by characters, not bytes', () => {
    // The server measures with char_length(), which is also characters.
    const arabic = 'ب'.repeat(ORDER_NOTE_MAX_LENGTH);
    expect(checkOrderNote(arabic).valid).toBe(true);
    expect(checkOrderNote('ب'.repeat(ORDER_NOTE_MAX_LENGTH + 1)).valid).toBe(false);
  });
});

describe('normalizeOrderNote', () => {
  it('returns null rather than an empty string when there is no note', () => {
    for (const raw of ['', '   ', '\t\n', null, undefined]) {
      expect(normalizeOrderNote(raw)).toBeNull();
    }
  });

  it('returns the trimmed note when there is one', () => {
    expect(normalizeOrderNote('  extra spicy  ')).toBe('extra spicy');
  });

  it('returns null for an over-long note rather than a truncated one', () => {
    // Silently truncating would drop part of an instruction the customer
    // believed they had given. The UI prevents this state; this is the backstop.
    expect(normalizeOrderNote('x'.repeat(ORDER_NOTE_MAX_LENGTH + 1))).toBeNull();
  });
});

describe('isOrderNoteValid', () => {
  it('mirrors checkOrderNote().valid', () => {
    for (const raw of ['', 'ok', 'x'.repeat(ORDER_NOTE_MAX_LENGTH), 'x'.repeat(ORDER_NOTE_MAX_LENGTH + 1)]) {
      expect(isOrderNoteValid(raw)).toBe(checkOrderNote(raw).valid);
    }
  });
});

describe('orderNoteRemaining', () => {
  it('counts down from the maximum and goes negative past it', () => {
    expect(orderNoteRemaining('')).toBe(ORDER_NOTE_MAX_LENGTH);
    expect(orderNoteRemaining('abc')).toBe(ORDER_NOTE_MAX_LENGTH - 3);
    expect(orderNoteRemaining('x'.repeat(ORDER_NOTE_MAX_LENGTH + 5))).toBe(-5);
  });
});

describe('orderNoteRemainingMessage', () => {
  it('stays hidden until the customer is near the limit', () => {
    expect(orderNoteRemainingMessage('short note', 'en')).toBeNull();
    const nearLimit = 'x'.repeat(ORDER_NOTE_MAX_LENGTH - ORDER_NOTE_COUNTER_THRESHOLD);
    expect(orderNoteRemainingMessage(nearLimit, 'en')).toBe(
      `${ORDER_NOTE_COUNTER_THRESHOLD} characters left`,
    );
  });

  it('never shows a negative count', () => {
    const over = 'x'.repeat(ORDER_NOTE_MAX_LENGTH + 10);
    expect(orderNoteRemainingMessage(over, 'en')).toBe('0 characters left');
    expect(orderNoteRemainingMessage(over, 'ar')).toBe('بقي 0 حرفاً');
  });
});

describe('orderNoteMessage', () => {
  it('returns null when there is no problem', () => {
    expect(orderNoteMessage(null, 'en')).toBeNull();
    expect(orderNoteMessage(null, 'ar')).toBeNull();
  });

  it('has copy in both languages for every problem case', () => {
    const problems = Object.keys(orderNoteCopy.en).filter((k) => k !== 'remaining');
    for (const p of problems) {
      expect(orderNoteMessage(p as 'too_long', 'en')).toBeTruthy();
      expect(orderNoteMessage(p as 'too_long', 'ar')).toBeTruthy();
      expect(orderNoteMessage(p as 'too_long', 'ar')).not.toBe(orderNoteMessage(p as 'too_long', 'en'));
    }
  });

  it('states the same limit the server enforces', () => {
    // If these drift, the customer is told one number and refused by another.
    expect(orderNoteMessage('too_long', 'en')).toContain(String(ORDER_NOTE_MAX_LENGTH));
    expect(orderNoteMessage('too_long', 'ar')).toContain(String(ORDER_NOTE_MAX_LENGTH));
  });
});
