import { describe, it, expect } from 'vitest';
import {
  normalizePhoneE164, normalizeSaudiPhoneE164, generateOtp, hashOtp, randomSalt,
  buildOtpTemplateMessage, sanitizeProviderResponse,
} from './whatsapp';

describe('normalizePhoneE164', () => {
  it('converts Saudi local forms to +9665XXXXXXXX', () => {
    expect(normalizePhoneE164('0512345678')).toEqual({ ok: true, e164: '+966512345678' });
    expect(normalizePhoneE164('512345678')).toEqual({ ok: true, e164: '+966512345678' });
    expect(normalizePhoneE164('966512345678')).toEqual({ ok: true, e164: '+966512345678' });
    expect(normalizePhoneE164('+966 51 234 5678')).toEqual({ ok: true, e164: '+966512345678' });
    expect(normalizePhoneE164('00966512345678')).toEqual({ ok: true, e164: '+966512345678' });
  });
  it('accepts other valid E.164 numbers', () => {
    expect(normalizePhoneE164('+14155552671')).toEqual({ ok: true, e164: '+14155552671' });
  });
  it('rejects junk, empties, and injection attempts', () => {
    expect(normalizePhoneE164('').ok).toBe(false);
    expect(normalizePhoneE164(null).ok).toBe(false);
    expect(normalizePhoneE164('not-a-phone').ok).toBe(false);
    expect(normalizePhoneE164('123').ok).toBe(false);
    expect(normalizePhoneE164("+966512345678'; drop table").ok).toBe(false); // stripped → still valid? ensure sanitized
  });
  it('rejects malformed Saudi numbers (wrong national prefix/length)', () => {
    expect(normalizePhoneE164('+966412345678').ok).toBe(false); // not a mobile (must start 5)
    expect(normalizePhoneE164('+96651234').ok).toBe(false);      // too short
  });
});

// The customer-facing rule: WhatsApp login and phone verification are KSA-only.
// Must stay behaviourally identical to apps/mobile/src/lib/phone.ts.
describe('normalizeSaudiPhoneE164', () => {
  const CANONICAL = '+966512345678';

  it('accepts every Saudi input pattern', () => {
    for (const form of [
      '0512345678', '512345678', '966512345678', '+966512345678', '00966512345678',
      '+966 51 234 5678', '+966-51-234-5678', '(051) 234-5678', '051 234 5678',
      '+96605 1234 5678', '9660512345678', '00966 051 234 5678', ' 0512345678 ',
      '٠٥١٢٣٤٥٦٧٨',  // Arabic-Indic digits
      '۰۵۱۲۳۴۵۶۷۸',  // Persian digits
      '\u200F0512345678\u200E',  // bidi-wrapped
    ]) {
      expect(normalizeSaudiPhoneE164(form)).toEqual({ ok: true, e164: CANONICAL });
    }
  });

  it('accepts every 5X operator range', () => {
    for (let x = 0; x <= 9; x++) {
      expect(normalizeSaudiPhoneE164(`05${x}1234567`)).toEqual({ ok: true, e164: `+9665${x}1234567` });
    }
  });

  it('rejects non-Saudi numbers', () => {
    expect(normalizeSaudiPhoneE164('+14155552671').ok).toBe(false);   // US
    expect(normalizeSaudiPhoneE164('+971501234567').ok).toBe(false);  // UAE
    expect(normalizeSaudiPhoneE164('+996512345678').ok).toBe(false);  // +996, not +966
    expect(normalizeSaudiPhoneE164('0044123456789').ok).toBe(false);  // UK via IDD
  });

  it('rejects Saudi landlines, wrong lengths, junk and injection attempts', () => {
    expect(normalizeSaudiPhoneE164('+966112345678').ok).toBe(false);
    expect(normalizeSaudiPhoneE164('+966412345678').ok).toBe(false);
    expect(normalizeSaudiPhoneE164('05123456').ok).toBe(false);
    expect(normalizeSaudiPhoneE164('051234567890').ok).toBe(false);
    expect(normalizeSaudiPhoneE164('').ok).toBe(false);
    expect(normalizeSaudiPhoneE164(null).ok).toBe(false);
    expect(normalizeSaudiPhoneE164('not-a-phone').ok).toBe(false);
    expect(normalizeSaudiPhoneE164("+966512345678'; drop table").ok).toBe(false);
    expect(normalizeSaudiPhoneE164('966+512345678').ok).toBe(false);
  });
});

describe('generateOtp', () => {
  it('returns a zero-padded 6-digit numeric string', () => {
    for (let i = 0; i < 200; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
      const n = Number(otp);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });
  it('is not constant (uses randomness)', () => {
    const set = new Set(Array.from({ length: 50 }, () => generateOtp()));
    expect(set.size).toBeGreaterThan(1);
  });
});

describe('hashOtp', () => {
  it('is deterministic for the same inputs and never equals the plaintext', async () => {
    const h1 = await hashOtp('pepper', '+966512345678', 'phone_verification', '123456', 'salt');
    const h2 = await hashOtp('pepper', '+966512345678', 'phone_verification', '123456', 'salt');
    expect(h1).toBe(h2);
    expect(h1).not.toContain('123456');
  });
  it('differs when pepper, salt, otp, phone, or purpose change', async () => {
    const base = await hashOtp('pepper', '+966512345678', 'phone_verification', '123456', 'salt');
    expect(await hashOtp('other', '+966512345678', 'phone_verification', '123456', 'salt')).not.toBe(base);
    expect(await hashOtp('pepper', '+966512345678', 'phone_verification', '123456', 'salt2')).not.toBe(base);
    expect(await hashOtp('pepper', '+966512345678', 'phone_verification', '654321', 'salt')).not.toBe(base);
    expect(await hashOtp('pepper', '+966512999999', 'phone_verification', '123456', 'salt')).not.toBe(base);
    expect(await hashOtp('pepper', '+966512345678', 'login', '123456', 'salt')).not.toBe(base);
  });
  it('randomSalt produces distinct hex strings', () => {
    expect(randomSalt()).not.toBe(randomSalt());
    expect(randomSalt()).toMatch(/^[0-9a-f]+$/);
  });
});

describe('buildOtpTemplateMessage', () => {
  it('builds a Meta auth-template body with body + copy-code button, digits-only recipient', () => {
    const msg = buildOtpTemplateMessage({ to: '+966512345678', templateName: 'otp_ar', langCode: 'ar', otp: '123456' });
    expect(msg.messaging_product).toBe('whatsapp');
    expect(msg.to).toBe('966512345678'); // no leading '+'
    const tpl = msg.template as any;
    expect(tpl.name).toBe('otp_ar');
    expect(tpl.language).toEqual({ code: 'ar' });
    expect(tpl.components[0]).toEqual({ type: 'body', parameters: [{ type: 'text', text: '123456' }] });
    expect(tpl.components[1]).toEqual({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '123456' }] });
  });
  it('omits the button when hasCopyButton is false', () => {
    const msg = buildOtpTemplateMessage({ to: '966512345678', templateName: 'otp_en', langCode: 'en_US', otp: '000111', hasCopyButton: false });
    const tpl = msg.template as any;
    expect(tpl.components).toHaveLength(1);
    expect(tpl.components[0].type).toBe('body');
  });
});

describe('sanitizeProviderResponse', () => {
  it('extracts the message id from a success response', () => {
    expect(sanitizeProviderResponse({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.ABC' }] }))
      .toEqual({ message_id: 'wamid.ABC', error_code: null, error_message: null });
  });
  it('extracts a safe error summary and drops noise', () => {
    const out = sanitizeProviderResponse({ error: { message: 'Invalid parameter', code: 100, type: 'OAuthException', fbtrace_id: 'X' } });
    expect(out.message_id).toBeNull();
    expect(out.error_code).toBe('100');
    expect(out.error_message).toBe('Invalid parameter');
  });
  it('handles empty / unknown shapes', () => {
    expect(sanitizeProviderResponse(null)).toEqual({ message_id: null, error_code: null, error_message: null });
    expect(sanitizeProviderResponse({})).toEqual({ message_id: null, error_code: null, error_message: null });
  });
});
