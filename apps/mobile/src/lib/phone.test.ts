import { describe, it, expect } from 'vitest';

import {
  toSaudiE164, toSaudiNational, isSaudiMobile, sanitizeSaudiNationalInput,
  formatSaudiNational, formatSaudiE164, toAsciiDigits,
} from './phone';

// Every shape a Saudi customer might type or paste. All of them must land on the
// same canonical string, because signInWithOtp / verifyOtp / the Send SMS hook
// all key off it.
describe('toSaudiE164 — accepts every Saudi input pattern', () => {
  const CANONICAL = '+966512345678';
  const forms = [
    '0512345678',            // local, trunk prefix
    '512345678',             // bare national
    '966512345678',          // country code, no plus
    '+966512345678',         // E.164
    '00966512345678',        // IDD prefix
    '+966 51 234 5678',      // spaces
    '+966-51-234-5678',      // dashes
    '(051) 234-5678',        // parentheses + trunk prefix
    '+966 (51) 234 5678',
    '051 234 5678',
    '+96605 1234 5678',      // country code with the trunk 0 left in
    '9660512345678',         // country code + trunk 0
    '00966 051 234 5678',    // IDD + trunk 0 + spacing
    ' 0512345678 ',          // stray whitespace
    '٠٥١٢٣٤٥٦٧٨',            // Arabic-Indic digits
    '۰۵۱۲۳۴۵۶۷۸',            // Extended (Persian) Arabic-Indic digits
    '+٩٦٦٥١٢٣٤٥٦٧٨',         // Arabic-Indic with a plus
  ];

  for (const form of forms) {
    it(`normalizes ${form}`, () => {
      expect(toSaudiE164(form)).toBe(CANONICAL);
    });
  }

  it('strips the bidi marks RTL keyboards wrap around numbers', () => {
    expect(toSaudiE164('\u200F0512345678\u200E')).toBe(CANONICAL);
  });

  it('accepts every 5X operator range (no stale prefix allow-list)', () => {
    for (let x = 0; x <= 9; x++) {
      expect(toSaudiE164(`05${x}1234567`)).toBe(`+9665${x}1234567`);
    }
  });
});

describe('toSaudiE164 — rejects everything that is not a Saudi mobile', () => {
  it('rejects foreign numbers', () => {
    expect(toSaudiE164('+14155552671')).toBeNull();   // US
    expect(toSaudiE164('+971501234567')).toBeNull();  // UAE
    expect(toSaudiE164('+201234567890')).toBeNull();  // Egypt
    expect(toSaudiE164('+996512345678')).toBeNull();  // Kyrgyzstan (+996, not +966)
    expect(toSaudiE164('0044123456789')).toBeNull();  // UK via IDD
  });

  it('rejects Saudi landlines and other non-mobile prefixes', () => {
    expect(toSaudiE164('+966112345678')).toBeNull();  // Riyadh landline
    expect(toSaudiE164('011234 5678')).toBeNull();
    expect(toSaudiE164('+966412345678')).toBeNull();
  });

  it('rejects wrong lengths', () => {
    expect(toSaudiE164('05123456')).toBeNull();       // too short
    expect(toSaudiE164('051234567890')).toBeNull();   // too long
    expect(toSaudiE164('+96651234')).toBeNull();
    expect(toSaudiE164('123')).toBeNull();
  });

  it('rejects junk, empties and injection attempts', () => {
    expect(toSaudiE164('')).toBeNull();
    expect(toSaudiE164(null)).toBeNull();
    expect(toSaudiE164(undefined)).toBeNull();
    expect(toSaudiE164('not-a-phone')).toBeNull();
    expect(toSaudiE164("+966512345678'; drop table")).toBeNull();
    expect(toSaudiE164('0512345678 OR 1=1')).toBeNull();
    expect(toSaudiE164('05123456e8')).toBeNull();
  });

  it('rejects a plus that is not the leading sign', () => {
    expect(toSaudiE164('966+512345678')).toBeNull();
  });
});

describe('toSaudiNational / isSaudiMobile', () => {
  it('returns the 9-digit national part', () => {
    expect(toSaudiNational('+966512345678')).toBe('512345678');
    expect(toSaudiNational('0512345678')).toBe('512345678');
  });
  it('reports usability', () => {
    expect(isSaudiMobile('0512345678')).toBe(true);
    expect(isSaudiMobile('+14155552671')).toBe(false);
  });
});

describe('sanitizeSaudiNationalInput', () => {
  it('keeps digits only', () => {
    expect(sanitizeSaudiNationalInput('51 234-5678')).toBe('512345678');
    expect(sanitizeSaudiNationalInput('abc51x2345678')).toBe('512345678');
  });
  it('absorbs a pasted country code / IDD prefix / trunk zero', () => {
    expect(sanitizeSaudiNationalInput('+966512345678')).toBe('512345678');
    expect(sanitizeSaudiNationalInput('00966512345678')).toBe('512345678');
    expect(sanitizeSaudiNationalInput('966512345678')).toBe('512345678');
    expect(sanitizeSaudiNationalInput('0512345678')).toBe('512345678');
    expect(sanitizeSaudiNationalInput('9660512345678')).toBe('512345678');
  });
  it('folds Arabic-Indic digits as they are typed', () => {
    expect(sanitizeSaudiNationalInput('٠٥١٢٣٤٥٦٧٨')).toBe('512345678');
  });
  it('caps the field at the 9-digit national length', () => {
    expect(sanitizeSaudiNationalInput('5123456789999')).toBe('512345678');
  });
  it('is stable under repeated application', () => {
    const once = sanitizeSaudiNationalInput('+966 51 234 5678');
    expect(sanitizeSaudiNationalInput(once)).toBe(once);
  });
});

describe('display formatting', () => {
  it('groups a national part the way Saudi numbers are read', () => {
    expect(formatSaudiNational('512345678')).toBe('51 234 5678');
    expect(formatSaudiNational('512')).toBe('51 2');
    expect(formatSaudiNational('')).toBe('');
  });
  it('formats a canonical number for display', () => {
    expect(formatSaudiE164('+966512345678')).toBe('+966 51 234 5678');
  });
  it('leaves an unrecognized string untouched', () => {
    expect(formatSaudiE164('+14155552671')).toBe('+14155552671');
  });
});

describe('toAsciiDigits', () => {
  it('folds both Arabic-Indic digit blocks', () => {
    expect(toAsciiDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(toAsciiDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });
  it('leaves ASCII untouched', () => {
    expect(toAsciiDigits('+966 51')).toBe('+966 51');
  });
});
