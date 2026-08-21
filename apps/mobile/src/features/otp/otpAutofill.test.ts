import { describe, expect, it, vi } from 'vitest';

import {
  extractOtp,
  isWebOtpSupported,
  joinBoxes,
  normalizeCode,
  requestWebOtp,
  splitCodeToBoxes,
  type CredentialsGetter,
  type NavigatorLike,
} from './otpAutofill';

describe('normalizeCode', () => {
  it('keeps digits only and caps at maxLen', () => {
    expect(normalizeCode('12-34 56', 6)).toBe('123456');
    expect(normalizeCode('123456789', 6)).toBe('123456');
    expect(normalizeCode('a1b2c3', 6)).toBe('123');
  });
  it('folds Arabic-Indic digits to ASCII', () => {
    expect(normalizeCode('١٢٣٤٥٦', 6)).toBe('123456');
  });
});

describe('extractOtp', () => {
  it('pulls an exact-length run out of a message', () => {
    expect(extractOtp('Your Spicy Meal code is 123456', 6)).toBe('123456');
    expect(extractOtp('رمزك هو ٩٨٧٦٥٤ لا تشاركه', 6)).toBe('987654');
  });
  it('truncates a longer run to the expected length', () => {
    expect(extractOtp('code 12345678', 6)).toBe('123456');
  });
  it('returns null when no run is long enough', () => {
    expect(extractOtp('code 123', 6)).toBeNull();
    expect(extractOtp('no digits here', 6)).toBeNull();
  });
});

describe('splitCodeToBoxes / joinBoxes', () => {
  it('splits into fixed-length boxes and pads with empties', () => {
    expect(splitCodeToBoxes('123', 6)).toEqual(['1', '2', '3', '', '', '']);
    expect(splitCodeToBoxes('123456', 6)).toEqual(['1', '2', '3', '4', '5', '6']);
  });
  it('round-trips through joinBoxes', () => {
    expect(joinBoxes(splitCodeToBoxes('4821', 6))).toBe('4821');
  });
});

/**
 * The iOS autofill contract, pinned as logic.
 *
 * iOS hands an autofilled one-time code to the field as ONE change event
 * containing the whole code — not six keystrokes. OtpCodeInput funnels every
 * change through normalizeCode, so these cases are the ones autofill actually
 * exercises. (The component itself cannot be rendered here: the repo has no
 * react-native testing renderer.)
 */
describe('single-field OTP autofill contract', () => {
  it('accepts all six characters delivered in one call', () => {
    expect(normalizeCode('471928', 6)).toBe('471928');
  });

  it('folds an Arabic-Indic autofill payload (the app is Arabic-first)', () => {
    expect(normalizeCode('\u0664\u0667\u0661\u0669\u0662\u0668', 6)).toBe('471928');
  });

  it('strips separators and spacing some senders add', () => {
    expect(normalizeCode('471-928', 6)).toBe('471928');
    expect(normalizeCode(' 471 928 ', 6)).toBe('471928');
  });

  it('caps an over-long paste at the field length', () => {
    expect(normalizeCode('4719281234', 6)).toBe('471928');
  });

  it('keeps partial entry partial, so onComplete cannot fire early', () => {
    expect(normalizeCode('471', 6)).toBe('471');
    expect(normalizeCode('471', 6).length).toBeLessThan(6);
  });

  it('backspacing to empty clears the code rather than throwing', () => {
    expect(normalizeCode('', 6)).toBe('');
  });

  it('still renders six boxes for any partial code', () => {
    expect(splitCodeToBoxes(normalizeCode('47', 6), 6)).toEqual(['4', '7', '', '', '', '']);
  });
});

describe('isWebOtpSupported (capability guard)', () => {
  const goodNav: NavigatorLike = { credentials: { get: async () => null } };

  it('is false without the OTPCredential global', () => {
    expect(isWebOtpSupported(goodNav, false)).toBe(false);
  });
  it('is false without a navigator', () => {
    expect(isWebOtpSupported(null, true)).toBe(false);
    expect(isWebOtpSupported(undefined, true)).toBe(false);
  });
  it('is false when navigator.credentials.get is missing', () => {
    expect(isWebOtpSupported({}, true)).toBe(false);
    expect(isWebOtpSupported({ credentials: {} as CredentialsGetter }, true)).toBe(false);
  });
  it('is true when the global and navigator.credentials.get are both present', () => {
    expect(isWebOtpSupported(goodNav, true)).toBe(true);
  });
});

describe('requestWebOtp', () => {
  const signal = { aborted: false };

  it('returns the code the browser resolves', async () => {
    const get = vi.fn().mockResolvedValue({ code: '246810' });
    const nav: NavigatorLike = { credentials: { get } };
    await expect(requestWebOtp(nav, signal, 6)).resolves.toBe('246810');
    expect(get).toHaveBeenCalledWith({ otp: { transport: ['sms'] }, signal });
  });

  it('parses a code out of a noisy WebOTP payload', async () => {
    const nav: NavigatorLike = { credentials: { get: async () => ({ code: 'code: 135790' }) } };
    await expect(requestWebOtp(nav, signal, 6)).resolves.toBe('135790');
  });

  it('resolves null on abort / rejection (silent fallback)', async () => {
    const nav: NavigatorLike = { credentials: { get: async () => { throw new Error('aborted'); } } };
    await expect(requestWebOtp(nav, signal, 6)).resolves.toBeNull();
  });

  it('resolves null when the credential carries no code', async () => {
    const nav: NavigatorLike = { credentials: { get: async () => ({ code: '' }) } };
    await expect(requestWebOtp(nav, signal, 6)).resolves.toBeNull();
  });

  it('resolves null when credentials.get is unavailable', async () => {
    await expect(requestWebOtp({}, signal, 6)).resolves.toBeNull();
  });
});
