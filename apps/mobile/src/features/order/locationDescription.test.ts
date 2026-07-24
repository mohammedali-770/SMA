import { describe, expect, it } from 'vitest';

import {
  DESCRIPTION_MAX_LENGTH,
  checkDescription,
  descriptionCopy,
  descriptionMessage,
  isDescriptionValid,
  normalizeDescription,
} from './locationDescription';

describe('checkDescription', () => {
  it('accepts a real landmark and returns the trimmed value', () => {
    const r = checkDescription('  near Al Salam grocery  ');
    expect(r.valid).toBe(true);
    expect(r.value).toBe('near Al Salam grocery');
    expect(r.problem).toBeNull();
  });

  it('rejects empty and whitespace-only input as `empty`, not `too_short`', () => {
    for (const raw of ['', '   ', '\t', '\n  \n', ' ']) {
      const r = checkDescription(raw);
      expect(r.valid).toBe(false);
      // Whitespace has not been "filled in" — calling it too short would imply
      // adding more spaces could fix it.
      expect(r.problem).toBe('empty');
      expect(r.value).toBe('');
    }
  });

  it('treats null and undefined as empty', () => {
    expect(checkDescription(null).problem).toBe('empty');
    expect(checkDescription(undefined).problem).toBe('empty');
  });

  it('rejects a value that is too short to locate anyone', () => {
    expect(checkDescription('abc').problem).toBe('too_short');
    // Trimming happens before measuring, so padding cannot buy length.
    expect(checkDescription('  ab  ').problem).toBe('too_short');
  });

  it('rejects a value past the column width', () => {
    expect(checkDescription('x'.repeat(DESCRIPTION_MAX_LENGTH)).valid).toBe(true);
    expect(checkDescription('x'.repeat(DESCRIPTION_MAX_LENGTH + 1)).problem).toBe('too_long');
  });

  it('accepts Arabic landmarks', () => {
    const r = checkDescription('قرب بقالة السلام');
    expect(r.valid).toBe(true);
    expect(r.value).toBe('قرب بقالة السلام');
  });
});

describe('isDescriptionValid', () => {
  it('gates a confirm button on the same rule as the validator', () => {
    expect(isDescriptionValid('beside the mosque')).toBe(true);
    expect(isDescriptionValid('   ')).toBe(false);
    expect(isDescriptionValid(null)).toBe(false);
  });
});

describe('normalizeDescription', () => {
  it('returns the trimmed value when usable', () => {
    expect(normalizeDescription('  beside the mosque ')).toBe('beside the mosque');
  });

  it('never persists an empty or whitespace-only string', () => {
    // The old code did `landmark.trim() || null`, which returned null for
    // whitespace but happily stored a 1-character value.
    expect(normalizeDescription('   ')).toBeNull();
    expect(normalizeDescription('')).toBeNull();
    expect(normalizeDescription('ab')).toBeNull();
  });
});

describe('descriptionCopy', () => {
  it('never labels the field optional in either language', () => {
    for (const lang of ['en', 'ar'] as const) {
      const joined = Object.values(descriptionCopy[lang]).join(' ').toLowerCase();
      expect(joined).not.toContain('optional');
      expect(joined).not.toContain('اختياري');
    }
  });

  it('uses the one agreed meaning in both languages', () => {
    expect(descriptionCopy.en.label).toBe('Location description / nearest landmark');
    expect(descriptionCopy.ar.label).toBe('وصف الموقع / أقرب معلم');
  });

  it('has a message for every problem case in both languages', () => {
    for (const lang of ['en', 'ar'] as const) {
      for (const problem of ['empty', 'too_short', 'too_long'] as const) {
        const msg = descriptionMessage(problem, lang);
        expect(msg).toBeTruthy();
        expect((msg as string).length).toBeGreaterThan(0);
      }
    }
  });

  it('returns no message when the value is valid', () => {
    expect(descriptionMessage(null, 'en')).toBeNull();
    expect(descriptionMessage(null, 'ar')).toBeNull();
  });

  it('keeps inline messages short enough not to dominate the form', () => {
    // Information hierarchy: the inline hint states the fix, it is not a lecture.
    for (const lang of ['en', 'ar'] as const) {
      for (const problem of ['empty', 'too_short', 'too_long'] as const) {
        expect((descriptionMessage(problem, lang) as string).length).toBeLessThanOrEqual(80);
      }
    }
  });
});
