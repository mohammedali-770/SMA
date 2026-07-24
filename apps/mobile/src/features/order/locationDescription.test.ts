import { describe, expect, it } from 'vitest';

import {
  DESCRIPTION_MAX_LENGTH,
  checkDescription,
  descriptionCopy,
  descriptionMessage,
  echoesAddress,
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

  it('asks for delivery guidance, not for the address again', () => {
    // The label must name what the customer has to add. "Location description"
    // alone invited people to retype the street the map already knows.
    expect(descriptionCopy.en.label).toBe('Delivery guidance (building, entrance, apartment or landmark)');
    expect(descriptionCopy.ar.label).toBe('إرشادات التوصيل (المبنى أو المدخل أو الشقة أو أقرب معلم)');
    for (const w of ['building', 'entrance', 'apartment', 'landmark']) {
      expect(descriptionCopy.en.label.toLowerCase()).toContain(w);
    }
  });

  it('keeps the resolved address labelled as separate context', () => {
    expect(descriptionCopy.en.addressPrefix).toBe('Selected location');
    expect(descriptionCopy.ar.addressPrefix).toBe('الموقع المحدد');
  });

  it('has a message for every problem case in both languages', () => {
    for (const lang of ['en', 'ar'] as const) {
      for (const problem of ['empty', 'too_short', 'too_long', 'echoes_address'] as const) {
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
      for (const problem of ['empty', 'too_short', 'too_long', 'echoes_address'] as const) {
        expect((descriptionMessage(problem, lang) as string).length).toBeLessThanOrEqual(80);
      }
    }
  });
});


describe('address vs delivery guidance — a pin must not satisfy the rule for you', () => {
  // The picker reverse-geocodes the pin. An earlier revision prefilled the
  // description field with that text, which let the map satisfy the mandatory
  // guidance requirement without the customer typing anything.
  const RESOLVED = 'King Fahd Road, Al Olaya, Riyadh';

  it('rejects the reverse-geocoded address pasted back verbatim', () => {
    const r = checkDescription(RESOLVED, RESOLVED);
    expect(r.valid).toBe(false);
    expect(r.problem).toBe('echoes_address');
  });

  it('rejects a trivial reformatting of the same address', () => {
    // Punctuation, case and spacing differences are not new information.
    expect(checkDescription('king fahd road  al olaya, riyadh.', RESOLVED).problem).toBe('echoes_address');
    expect(checkDescription('King Fahd Road - Al Olaya - Riyadh', RESOLVED).problem).toBe('echoes_address');
  });

  it('rejects the address plus one filler word', () => {
    expect(checkDescription('King Fahd Road Al Olaya Riyadh near', RESOLVED).problem).toBe('echoes_address');
  });

  it('accepts genuine delivery guidance that also mentions the street', () => {
    const r = checkDescription('King Fahd Road, blue building second entrance flat 12', RESOLVED);
    expect(r.valid).toBe(true);
  });

  it('accepts guidance that shares no words with the address', () => {
    expect(checkDescription('blue gate beside the pharmacy', RESOLVED).valid).toBe(true);
  });

  it('accepts Arabic guidance against an Arabic resolved address', () => {
    const ar = 'طريق الملك فهد، العليا، الرياض';
    expect(checkDescription(ar, ar).problem).toBe('echoes_address');
    expect(checkDescription('المبنى الأزرق المدخل الثاني شقة ١٢', ar).valid).toBe(true);
  });

  it('ignores Arabic diacritics and tatweel when comparing', () => {
    const ar = 'طريق الملك فهد';
    // Same words, decorated — still an echo, not guidance.
    expect(echoesAddress('طريـــق الملك فهد', ar)).toBe(true);
  });

  it('still applies the length rules before the echo rule', () => {
    expect(checkDescription('', RESOLVED).problem).toBe('empty');
    expect(checkDescription('   ', RESOLVED).problem).toBe('empty');
    expect(checkDescription('abc', RESOLVED).problem).toBe('too_short');
  });

  it('skips the echo rule when no address has been resolved', () => {
    // Reverse geocoding is best-effort; when it fails the customer is not
    // punished for text that merely looks address-like.
    expect(checkDescription('King Fahd Road, Al Olaya, Riyadh', null).valid).toBe(true);
    expect(checkDescription('King Fahd Road, Al Olaya, Riyadh').valid).toBe(true);
    expect(echoesAddress('anything', null)).toBe(false);
    expect(echoesAddress('anything', '')).toBe(false);
  });

  it('gates confirmation of a NEWLY SELECTED PIN on real guidance', () => {
    // Simulates: customer drops a pin, the map resolves an address, and the
    // description field still holds only that address.
    const newPinAddress = 'Prince Sultan Street, Al Khobar';
    expect(isDescriptionValid(newPinAddress, newPinAddress)).toBe(false);
    expect(normalizeDescription(newPinAddress, newPinAddress)).toBeNull();
    // Only after the customer adds real guidance does confirmation unlock.
    expect(isDescriptionValid('Prince Sultan Street, white tower entrance C', newPinAddress)).toBe(true);
  });

  it('has an echo message in both languages that asks for the missing detail', () => {
    for (const lang of ['en', 'ar'] as const) {
      const msg = descriptionMessage('echoes_address', lang);
      expect(msg).toBeTruthy();
      expect((msg as string).length).toBeLessThanOrEqual(80);
    }
    expect(descriptionCopy.en.echoes_address.toLowerCase()).toContain('entrance');
    expect(descriptionCopy.ar.echoes_address).toContain('المدخل');
  });
});
