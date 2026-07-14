import { describe, expect, it } from 'vitest';

import {
  isPlaceholderValue, mailtoLink, normalizeSaudiMobile, supportDescription, telLink,
  visibleSupportChannels, whatsappLink, workingHoursText, type SupportSettings,
} from './supportContact';

function settings(over: Partial<SupportSettings> = {}): SupportSettings {
  return {
    phone: '+966 55 123 4567', whatsapp: '+966551234567', email: 'support@spicymeal.sa',
    hoursEn: 'Daily 11:00–23:00', hoursAr: 'يومياً ١١:٠٠–٢٣:٠٠',
    descEn: 'We reply within minutes.', descAr: 'نرد خلال دقائق.',
    phoneEnabled: true, whatsappEnabled: true, emailEnabled: true,
    ...over,
  };
}

describe('placeholder guard (no placeholder ever reaches a customer)', () => {
  it('rejects the seeded placeholder phone and email', () => {
    expect(isPlaceholderValue('+966 5X XXX XXXX')).toBe(true);
    expect(isPlaceholderValue('support@example.com')).toBe(true);
    expect(isPlaceholderValue('05XXXXXXXX (edit in Admin)')).toBe(true);
    expect(telLink('+966 5X XXX XXXX')).toBeNull();
    expect(mailtoLink('support@example.com')).toBeNull();
    expect(whatsappLink('+966 5X XXX XXXX')).toBeNull();
  });
  it('accepts real values', () => {
    expect(isPlaceholderValue('+966551234567')).toBe(false);
    expect(isPlaceholderValue('support@spicymeal.sa')).toBe(false);
  });
});

describe('link construction (only tel:/mailto:/https://wa.me allowed)', () => {
  it('tel: keeps + and digits only', () => {
    expect(telLink('+966 55 123-4567')).toBe('tel:+966551234567');
    expect(telLink('0551234567')).toBe('tel:0551234567');
    expect(telLink('12345')).toBeNull(); // too short
  });
  it('wa.me accepts ALL Saudi mobile formats and normalizes to 9665XXXXXXXX', () => {
    expect(whatsappLink('0551234567')).toBe('https://wa.me/966551234567');      // 05XXXXXXXX
    expect(whatsappLink('551234567')).toBe('https://wa.me/966551234567');       // 5XXXXXXXX
    expect(whatsappLink('+966551234567')).toBe('https://wa.me/966551234567');   // +9665XXXXXXXX
    expect(whatsappLink('00966551234567')).toBe('https://wa.me/966551234567');  // 009665XXXXXXXX
    expect(whatsappLink('+966 55 123 4567')).toBe('https://wa.me/966551234567'); // separators ok
    expect(normalizeSaudiMobile('0551234567')).toBe('966551234567');
  });
  it('wa.me hides invalid lengths, landlines, and unsupported international numbers', () => {
    expect(whatsappLink('12345')).toBeNull();            // invalid length
    expect(whatsappLink('05512345')).toBeNull();         // too short
    expect(whatsappLink('055123456789')).toBeNull();     // too long
    expect(whatsappLink('0112345678')).toBeNull();       // Saudi landline
    expect(whatsappLink('+966112345678')).toBeNull();    // Saudi landline (intl)
    expect(whatsappLink('+14155551234')).toBeNull();     // non-Saudi international
    expect(whatsappLink('some text')).toBeNull();        // arbitrary text
  });
  it('an international prefix is NEVER rewritten into a fabricated Saudi number (review P2)', () => {
    expect(whatsappLink('00551234567')).toBeNull();      // 00 + Brazil-style digits — NOT 966551234567
    expect(whatsappLink('+00551234567')).toBeNull();     // +00 garbage
    expect(whatsappLink('+551234567')).toBeNull();       // +55… is Brazil, not a local Saudi mobile
    expect(whatsappLink('0000966551234567')).toBeNull(); // malformed prefix soup
    expect(normalizeSaudiMobile('966551234567')).toBe('966551234567'); // bare intl digits stay OK
  });
  it('mailto validates the address', () => {
    expect(mailtoLink('support@spicymeal.sa')).toBe('mailto:support@spicymeal.sa');
    expect(mailtoLink('not-an-email')).toBeNull();
    expect(mailtoLink('a@b')).toBeNull();
  });
  it('an admin-stored value can never smuggle a URL/scheme', () => {
    expect(telLink('javascript:alert(1)')).toBeNull();
    expect(whatsappLink('https://evil.example')).toBeNull();
    expect(mailtoLink('https://evil.example/pay')).toBeNull();
  });
});

describe('visibleSupportChannels', () => {
  it('shows all three configured+enabled channels in fixed order', () => {
    const rows = visibleSupportChannels(settings());
    expect(rows.map((r) => r.kind)).toEqual(['phone', 'whatsapp', 'email']);
    expect(rows[0].url).toBe('tel:+966551234567');
    expect(rows[1].url).toBe('https://wa.me/966551234567');
    expect(rows[2].url).toBe('mailto:support@spicymeal.sa');
  });
  it('hides disabled channels even when configured', () => {
    const rows = visibleSupportChannels(settings({ whatsappEnabled: false }));
    expect(rows.map((r) => r.kind)).toEqual(['phone', 'email']);
  });
  it('hides enabled channels whose value is missing, invalid, or placeholder', () => {
    expect(visibleSupportChannels(settings({ phone: null }))).toHaveLength(2);
    expect(visibleSupportChannels(settings({ email: 'support@example.com' }))).toHaveLength(2);
    expect(visibleSupportChannels(settings({ whatsapp: '+966 5X XXX XXXX' }))).toHaveLength(2);
  });
  it('renders nothing when settings are absent or everything is off', () => {
    expect(visibleSupportChannels(null)).toEqual([]);
    expect(visibleSupportChannels(settings({ phoneEnabled: false, whatsappEnabled: false, emailEnabled: false }))).toEqual([]);
  });
});

describe('working hours + description per language', () => {
  it('returns the language-matched text', () => {
    expect(workingHoursText(settings(), 'en')).toBe('Daily 11:00–23:00');
    expect(workingHoursText(settings(), 'ar')).toBe('يومياً ١١:٠٠–٢٣:٠٠');
    expect(supportDescription(settings(), 'ar')).toBe('نرد خلال دقائق.');
  });
  it('hides when empty or placeholder', () => {
    expect(workingHoursText(settings({ hoursEn: '  ' }), 'en')).toBeNull();
    expect(supportDescription(settings({ descEn: 'placeholder — edit in Admin' }), 'en')).toBeNull();
    expect(workingHoursText(null, 'en')).toBeNull();
  });
});
