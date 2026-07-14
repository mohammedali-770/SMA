import { describe, expect, it } from 'vitest';

import { OTP_RESEND_COOLDOWN_SECONDS, sanitizeOtpDigits, tickCooldown } from './otpInput';

describe('sanitizeOtpDigits', () => {
  it('strips every non-digit', () => {
    expect(sanitizeOtpDigits('1a2b3c!', 8)).toBe('123');
    expect(sanitizeOtpDigits(' 4 5-6 ', 8)).toBe('456');
  });
  it('caps at the flow maximum (8 for login, 6 for profile verify)', () => {
    expect(sanitizeOtpDigits('123456789', 8)).toBe('12345678');
    expect(sanitizeOtpDigits('1234567', 6)).toBe('123456');
  });
  it('passes clean input through unchanged', () => {
    expect(sanitizeOtpDigits('123456', 6)).toBe('123456');
    expect(sanitizeOtpDigits('', 6)).toBe('');
  });
});

describe('tickCooldown', () => {
  it('counts down one second per tick', () => {
    expect(tickCooldown(60)).toBe(59);
    expect(tickCooldown(2)).toBe(1);
  });
  it('floors at zero and never goes negative', () => {
    expect(tickCooldown(1)).toBe(0);
    expect(tickCooldown(0)).toBe(0);
  });
});

describe('OTP_RESEND_COOLDOWN_SECONDS', () => {
  it('stays at the 60s both screens have always used', () => {
    expect(OTP_RESEND_COOLDOWN_SECONDS).toBe(60);
  });
});
