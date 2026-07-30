import { describe, expect, it } from 'vitest';

import {
  firstError,
  resolveFieldState,
  validateRequired,
  validateShortAddress,
} from './generated/fieldState';

describe('resolveFieldState — accessibility wiring', () => {
  it('points aria-describedby at the hint when there is no error', () => {
    const s = resolveFieldState({ id: 'phone', hint: 'WhatsApp' });
    expect(s.describedById).toBe('phone-hint');
    expect(s.message).toBe('WhatsApp');
    expect(s.messageIsError).toBe(false);
    expect(s.accessibility.invalid).toBe(false);
  });

  it('points aria-describedby at the error when one exists', () => {
    const s = resolveFieldState({ id: 'phone', hint: 'WhatsApp', error: 'Invalid number' });
    expect(s.describedById).toBe('phone-error');
    expect(s.accessibility.invalid).toBe(true);
  });

  it('an error REPLACES the hint — never two lines of prose under one input', () => {
    const s = resolveFieldState({ id: 'a', hint: 'Some hint', error: 'Required' });
    expect(s.message).toBe('Required');
    expect(s.message).not.toContain('Some hint');
  });

  it('announces errors politely rather than rendering them silently', () => {
    expect(resolveFieldState({ id: 'a', error: 'Required' }).accessibility.liveRegion).toBe('polite');
    expect(resolveFieldState({ id: 'a' }).accessibility.liveRegion).toBe('none');
  });

  it('has no described-by when there is neither hint nor error', () => {
    expect(resolveFieldState({ id: 'a' }).describedById).toBeNull();
    expect(resolveFieldState({ id: 'a' }).message).toBeNull();
  });

  it('treats whitespace-only text as absent', () => {
    const s = resolveFieldState({ id: 'a', hint: '   ', error: '  ' });
    expect(s.message).toBeNull();
    expect(s.accessibility.invalid).toBe(false);
  });

  it('reports tone: error beats focus beats idle', () => {
    expect(resolveFieldState({ id: 'a' }).tone).toBe('idle');
    expect(resolveFieldState({ id: 'a', focused: true }).tone).toBe('focus');
    expect(resolveFieldState({ id: 'a', focused: true, error: 'x' }).tone).toBe('error');
  });

  it('propagates required and disabled to assistive tech', () => {
    const s = resolveFieldState({ id: 'a', required: true, disabled: true });
    expect(s.accessibility.required).toBe(true);
    expect(s.accessibility.disabled).toBe(true);
    expect(s.disabled).toBe(true);
  });

  it('derives stable, unique ids from the field id', () => {
    const s = resolveFieldState({ id: 'short-address' });
    expect(s.labelId).toBe('short-address-label');
    expect(s.errorId).toBe('short-address-error');
    expect(s.hintId).toBe('short-address-hint');
  });
});

describe('validators', () => {
  it('flags empty required fields in the active language', () => {
    expect(validateRequired('', 'en')).toEqual({ valid: false, error: 'Required' });
    expect(validateRequired('', 'ar')).toEqual({ valid: false, error: 'حقل مطلوب' });
    expect(validateRequired('  ', 'en').valid).toBe(false);
    expect(validateRequired('x', 'en').valid).toBe(true);
  });

  it('keeps error copy to a few words (design-system voice rule)', () => {
    for (const lang of ['en', 'ar'] as const) {
      const msg = validateRequired('', lang).error ?? '';
      expect(msg.split(/\s+/).length).toBeLessThanOrEqual(5);
    }
  });

  it('accepts a valid Saudi national short address', () => {
    expect(validateShortAddress('RRBB1234').valid).toBe(true);
    expect(validateShortAddress('rrbb1234').valid).toBe(true);
  });

  it('rejects malformed short addresses', () => {
    expect(validateShortAddress('RRB1234').valid).toBe(false); // 3 letters
    expect(validateShortAddress('RRBB123').valid).toBe(false); // 3 digits
    expect(validateShortAddress('RRBB12345').valid).toBe(false); // 5 digits
    expect(validateShortAddress('1234RRBB').valid).toBe(false); // wrong order
  });

  it('leaves emptiness to the required validator, not the format one', () => {
    expect(validateShortAddress('').valid).toBe(true);
  });

  it('surfaces only the first failure so one field never shows two errors', () => {
    const err = firstError([
      validateRequired('', 'en'),
      validateShortAddress('nope', 'en'),
    ]);
    expect(err).toBe('Required');
    expect(firstError([validateRequired('ok', 'en')])).toBeNull();
  });
});
