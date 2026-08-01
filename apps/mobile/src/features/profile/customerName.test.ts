/**
 * Framework-free on purpose: vitest.config.ts runs mobile tests under Node and
 * forbids React Native imports here, so this exercises the shared module the
 * screen delegates to rather than rendering the component.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  checkCustomerName, isCustomerNameValid, nameCopy, nameMessage, NAME_MAX_LENGTH,
  normalizeCustomerName, saveCustomerName,
} from './customerName';

describe('normalizeCustomerName', () => {
  it('trims the ends', () => {
    expect(normalizeCustomerName('  Mohammed Ali  ')).toBe('Mohammed Ali');
  });

  it('collapses internal whitespace so one person is not stored as two names', () => {
    expect(normalizeCustomerName('Mohammed    Ali')).toBe('Mohammed Ali');
  });

  it('folds tabs and newlines pasted in from another app', () => {
    expect(normalizeCustomerName('Mohammed\t\nAli')).toBe('Mohammed Ali');
  });

  it('treats null/undefined as empty rather than throwing', () => {
    expect(normalizeCustomerName(null)).toBe('');
    expect(normalizeCustomerName(undefined)).toBe('');
  });
});

describe('checkCustomerName', () => {
  it('accepts an English name', () => {
    expect(checkCustomerName('Mohammed Ali')).toEqual({
      valid: true, value: 'Mohammed Ali', problem: null,
    });
  });

  it('accepts an Arabic name', () => {
    const res = checkCustomerName('نورة العتيبي');
    expect(res.valid).toBe(true);
    expect(res.value).toBe('نورة العتيبي');
  });

  it('accepts an Arabic name carrying diacritics', () => {
    expect(checkCustomerName('مُحَمَّد').valid).toBe(true);
  });

  it('accepts the separators real names use', () => {
    expect(checkCustomerName("Al-Otaibi").valid).toBe(true);
    expect(checkCustomerName("O'Brien").valid).toBe(true);
    expect(checkCustomerName('Ahmed A. Ali').valid).toBe(true);
  });

  it('returns the TRIMMED value, never the raw input', () => {
    expect(checkCustomerName('  Sara  ').value).toBe('Sara');
  });

  it('rejects an empty name', () => {
    expect(checkCustomerName('').problem).toBe('empty');
  });

  it('rejects a whitespace-only name as empty, not too_short', () => {
    // "too short" would imply that adding more spaces could help.
    expect(checkCustomerName('     ').problem).toBe('empty');
  });

  it('rejects a single character as too_short', () => {
    expect(checkCustomerName('A').problem).toBe('too_short');
  });

  it('rejects an over-length name and accepts exactly the maximum', () => {
    expect(checkCustomerName('a'.repeat(NAME_MAX_LENGTH + 1)).problem).toBe('too_long');
    expect(checkCustomerName('a'.repeat(NAME_MAX_LENGTH)).valid).toBe(true);
  });

  it('rejects digits and symbols', () => {
    expect(checkCustomerName('Sara99').problem).toBe('invalid_characters');
    expect(checkCustomerName('<script>').problem).toBe('invalid_characters');
    expect(checkCustomerName('sara@example.com').problem).toBe('invalid_characters');
  });

  it('rejects punctuation with no letter in it at all', () => {
    expect(checkCustomerName('...').problem).toBe('invalid_characters');
    expect(checkCustomerName('--').problem).toBe('invalid_characters');
  });

  it('isCustomerNameValid mirrors the check', () => {
    expect(isCustomerNameValid('Mohammed Ali')).toBe(true);
    expect(isCustomerNameValid('  ')).toBe(false);
  });
});

describe('nameMessage', () => {
  it('returns null when there is no problem', () => {
    expect(nameMessage(null, 'en')).toBeNull();
    expect(nameMessage(null, 'ar')).toBeNull();
  });

  it('has a distinct message for every problem, in both languages', () => {
    const problems = ['empty', 'too_short', 'too_long', 'invalid_characters'] as const;
    for (const lang of ['en', 'ar'] as const) {
      const messages = problems.map((p) => nameMessage(p, lang));
      expect(messages.every((m) => typeof m === 'string' && m.length > 0)).toBe(true);
      expect(new Set(messages).size).toBe(problems.length);
    }
  });

  it('the Arabic copy is actually Arabic, not the English string reused', () => {
    for (const key of Object.keys(nameCopy.en) as (keyof typeof nameCopy.en)[]) {
      // 'English' is deliberately identical in both language tables elsewhere;
      // none of these keys is one of those.
      expect(nameCopy.ar[key]).not.toBe(nameCopy.en[key]);
      expect(/[؀-ۿ]/.test(nameCopy.ar[key])).toBe(true);
    }
  });
});

describe('saveCustomerName', () => {
  it('writes the NORMALIZED value and refreshes the cached profile', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn().mockResolvedValue(undefined);

    const out = await saveCustomerName('  Mohammed   Ali ', 'Old Name', { update, refresh });

    expect(out).toEqual({ status: 'saved', value: 'Mohammed Ali' });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('Mohammed Ali');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes AFTER the write, never before', async () => {
    const order: string[] = [];
    const update = vi.fn().mockImplementation(async () => { order.push('update'); });
    const refresh = vi.fn().mockImplementation(async () => { order.push('refresh'); });

    await saveCustomerName('Sara', '', { update, refresh });

    expect(order).toEqual(['update', 'refresh']);
  });

  it('does not write an invalid name', async () => {
    const update = vi.fn();
    const refresh = vi.fn();

    const out = await saveCustomerName('   ', 'Old Name', { update, refresh });

    expect(out).toEqual({ status: 'invalid', problem: 'empty', value: '' });
    expect(update).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not write when the name is unchanged', async () => {
    const update = vi.fn();
    const refresh = vi.fn();

    const out = await saveCustomerName('Mohammed Ali', 'Mohammed Ali', { update, refresh });

    expect(out).toEqual({ status: 'unchanged', value: 'Mohammed Ali' });
    expect(update).not.toHaveBeenCalled();
  });

  it('treats a spacing-only difference as unchanged', async () => {
    const update = vi.fn();
    const out = await saveCustomerName('  Mohammed  Ali ', 'Mohammed Ali', {
      update, refresh: vi.fn(),
    });

    expect(out.status).toBe('unchanged');
    expect(update).not.toHaveBeenCalled();
  });

  it('reports a failed write and does not refresh', async () => {
    const error = new Error('permission denied');
    const update = vi.fn().mockRejectedValue(error);
    const refresh = vi.fn();

    const out = await saveCustomerName('Sara', 'Old', { update, refresh });

    expect(out).toEqual({ status: 'failed', error, value: 'Sara' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a WRITE that succeeded is still "saved" when the refresh fails', async () => {
    // Reporting a failure here would invite the customer to press Save again on
    // a name that is already stored.
    const update = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn().mockRejectedValue(new Error('offline'));

    const out = await saveCustomerName('Sara', 'Old', { update, refresh });

    expect(out).toEqual({ status: 'saved', value: 'Sara' });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('saves an Arabic name unchanged', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const out = await saveCustomerName('نورة العتيبي', 'Nora', { update, refresh: vi.fn() });

    expect(out).toEqual({ status: 'saved', value: 'نورة العتيبي' });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('نورة العتيبي');
  });

  it('lets a customer who signed up with no name set one', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const out = await saveCustomerName('Mohammed Ali', '', { update, refresh: vi.fn() });

    expect(out.status).toBe('saved');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('Mohammed Ali');
  });
});
