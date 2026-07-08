import { describe, it, expect } from 'vitest';
import {
  normalizeName, pairScore, levelForScore, scoreNames, suggestBestMatch,
} from './lazywaitMatch';

describe('normalizeName', () => {
  it('is null-safe and collapses case/whitespace', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName('   ')).toBe('');
    expect(normalizeName('  Chicken   Burger ')).toBe('chicken burger');
    expect(normalizeName('Chicken Burger')).toBe(normalizeName('chicken  burger'));
  });

  it('normalizes Arabic alef/hamza/taa-marbuta and tashkeel', () => {
    // أ / ا alef variants and ة / ه taa-marbuta collapse to the same key.
    expect(normalizeName('أرز')).toBe(normalizeName('ارز'));
    expect(normalizeName('دجاجة')).toBe(normalizeName('دجاجه'));
    // Harakat (diacritics) are stripped.
    expect(normalizeName('دَجَاج')).toBe(normalizeName('دجاج'));
  });

  it('folds Turkish letters to ascii (test data may be Turkish-only)', () => {
    expect(normalizeName('Köfte')).toBe('kofte');
    expect(normalizeName('Şiş Tavuk')).toBe('sis tavuk');
    expect(normalizeName('İçli Köfte')).toBe('icli kofte');
  });

  it('strips punctuation but keeps digits', () => {
    expect(normalizeName('Pepsi (330ml)')).toBe('pepsi 330ml');
  });
});

describe('pairScore / levelForScore', () => {
  it('exact normalized match is high, token reorder still high', () => {
    expect(pairScore('chicken burger', 'chicken burger')).toBe(1);
    expect(pairScore('chicken burger', 'burger chicken')).toBe(1); // order-insensitive
    expect(levelForScore(1)).toBe('high');
  });
  it('partial overlap is medium/low, unrelated is none', () => {
    expect(levelForScore(pairScore('chicken burger', 'chicken sandwich'))).toBe('low');
    expect(levelForScore(pairScore('chicken burger', 'orange juice'))).toBe('none');
  });
});

describe('scoreNames (cross-language)', () => {
  it('matches on whichever language is present (Arabic side)', () => {
    const local = { nameEn: 'Rice', nameAr: 'أرز' };
    expect(scoreNames(local, { name_ar: 'ارز' })).toBe(1);
  });
  it('matches a Turkish-only catalog name against local English', () => {
    const local = { nameEn: 'Kofte', nameAr: 'كفتة' };
    expect(scoreNames(local, { name_other: 'Köfte' })).toBe(1);
  });
});

describe('suggestBestMatch (confidence gating)', () => {
  const candidates = [
    { lazywait_id: 'LW1', name_en: 'Chicken Burger', name_ar: 'برجر دجاج' },
    { lazywait_id: 'LW2', name_en: 'Beef Burger', name_ar: 'برجر لحم' },
    { lazywait_id: 'LW3', name_en: 'Orange Juice', name_ar: 'عصير برتقال' },
  ];

  it('returns a HIGH-confidence exact match that does NOT require confirmation', () => {
    const s = suggestBestMatch({ nameEn: 'Chicken Burger', nameAr: 'برجر دجاج' }, candidates);
    expect(s?.candidate.lazywait_id).toBe('LW1');
    expect(s?.level).toBe('high');
    expect(s?.requiresConfirmation).toBe(false);
  });

  it('flags a LOW-confidence match as requiring manual confirmation', () => {
    // "Grilled Chicken" only shares one token with "Chicken Burger".
    const s = suggestBestMatch({ nameEn: 'Grilled Chicken', nameAr: 'دجاج مشوي' }, candidates);
    expect(s).not.toBeNull();
    expect(s?.level === 'low' || s?.level === 'medium').toBe(true);
    expect(s?.requiresConfirmation).toBe(true);
  });

  it('returns null when nothing is even a weak match (no false suggestion)', () => {
    expect(suggestBestMatch({ nameEn: 'Mineral Water', nameAr: 'ماء' }, candidates)).toBeNull();
  });
});
