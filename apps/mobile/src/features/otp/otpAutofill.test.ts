import { describe, expect, it, vi } from 'vitest';

import {
  applyBackspace,
  applyBoxInput,
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

describe('applyBoxInput', () => {
  const empty = ['', '', '', '', '', ''];

  it('fills a box with a single digit and auto-advances', () => {
    expect(applyBoxInput(empty, 0, '4', 6)).toEqual({
      boxes: ['4', '', '', '', '', ''],
      focusIndex: 1,
    });
  });

  it('does not advance past the last box', () => {
    const boxes = ['1', '2', '3', '4', '5', ''];
    expect(applyBoxInput(boxes, 5, '6', 6)).toEqual({
      boxes: ['1', '2', '3', '4', '5', '6'],
      focusIndex: 5,
    });
  });

  it('replaces the digit and advances when typing into a filled box', () => {
    // Controlled input reports old + new ("7" + "9") when a filled box is typed.
    const boxes = ['7', '', '', '', '', ''];
    expect(applyBoxInput(boxes, 0, '79', 6)).toEqual({
      boxes: ['9', '', '', '', '', ''],
      focusIndex: 1,
    });
  });

  it('clears a box on empty input and stays put', () => {
    const boxes = ['1', '2', '', '', '', ''];
    expect(applyBoxInput(boxes, 1, '', 6)).toEqual({
      boxes: ['1', '', '', '', '', ''],
      focusIndex: 1,
    });
  });

  it('distributes a pasted full code from the target box', () => {
    expect(applyBoxInput(empty, 0, '123456', 6)).toEqual({
      boxes: ['1', '2', '3', '4', '5', '6'],
      focusIndex: 5,
    });
  });

  it('distributes a partial paste and clamps at the field length', () => {
    const boxes = ['1', '', '', '', '', ''];
    expect(applyBoxInput(boxes, 2, '9876', 6)).toEqual({
      boxes: ['1', '', '9', '8', '7', '6'],
      focusIndex: 5,
    });
  });

  it('folds Arabic-Indic digits when pasting', () => {
    expect(applyBoxInput(empty, 0, '١٢٣', 6)).toEqual({
      boxes: ['1', '2', '3', '', '', ''],
      focusIndex: 3,
    });
  });
});

describe('applyBackspace', () => {
  it('clears a filled box in place', () => {
    const boxes = ['1', '2', '3', '', '', ''];
    expect(applyBackspace(boxes, 2)).toEqual({
      boxes: ['1', '2', '', '', '', ''],
      focusIndex: 2,
    });
  });

  it('steps back and clears the previous box when the current is empty', () => {
    const boxes = ['1', '2', '', '', '', ''];
    expect(applyBackspace(boxes, 2)).toEqual({
      boxes: ['1', '', '', '', '', ''],
      focusIndex: 1,
    });
  });

  it('stays at index 0 when already at the first box', () => {
    const boxes = ['', '', '', '', '', ''];
    expect(applyBackspace(boxes, 0)).toEqual({
      boxes: ['', '', '', '', '', ''],
      focusIndex: 0,
    });
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
