import { describe, expect, it } from 'vitest';

import { buildReturnDeepLink, escapeHtmlAttr, queryUuid, sanitizeUuid } from './returnLink.ts';

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('sanitizeUuid', () => {
  it('accepts a strict UUID and rejects everything else', () => {
    expect(sanitizeUuid(UUID)).toBe(UUID);
    expect(sanitizeUuid('not-a-uuid')).toBe('');
    expect(sanitizeUuid('')).toBe('');
    expect(sanitizeUuid(null)).toBe('');
    expect(sanitizeUuid(undefined)).toBe('');
    // No injection can survive UUID validation.
    expect(sanitizeUuid(`${UUID}"><script>`)).toBe('');
  });
});

describe('buildReturnDeepLink', () => {
  it('prefers a valid session (new flow)', () => {
    expect(buildReturnDeepLink(null, UUID)).toBe(`spicymeal://payment/return?session=${UUID}`);
  });
  it('falls back to a valid order (legacy flow)', () => {
    expect(buildReturnDeepLink(UUID, null)).toBe(`spicymeal://payment/return?order=${UUID}`);
  });
  it('session wins when both are present', () => {
    expect(buildReturnDeepLink(UUID, UUID)).toBe(`spicymeal://payment/return?session=${UUID}`);
  });
  it('never emits an attacker value — only the bare scheme when ids are invalid', () => {
    expect(buildReturnDeepLink('evil', 'evil')).toBe('spicymeal://payment/return');
    expect(buildReturnDeepLink('https://evil.com', null)).toBe('spicymeal://payment/return');
  });
});

// Moyasar documents no query parameters for success_url or back_url. Should it
// append its own with a second '?', '…/payment-return?session=<uuid>' arrives
// as '…?session=<uuid>?id=…&status=paid', and URL parsing hands back the value
// '<uuid>?id=…', which strict validation used to throw away.
describe('a provider that appends its own query with a second "?"', () => {
  const PAYMENT = '79cced57-9deb-4c4b-8f48-59c124f79688';
  const returned = (query: string) => {
    const url = new URL(`https://example.supabase.co/functions/v1/payment-return?${query}`);
    return buildReturnDeepLink(url.searchParams.get('order'), url.searchParams.get('session'));
  };

  it('still forwards the session, and nothing the provider added', () => {
    expect(returned(`session=${UUID}?id=${PAYMENT}&status=paid&message=Succeeded`)).toBe(
      `spicymeal://payment/return?session=${UUID}`,
    );
  });
  it('still forwards the order on the legacy flow', () => {
    expect(returned(`order=${UUID}?id=${PAYMENT}`)).toBe(`spicymeal://payment/return?order=${UUID}`);
  });
  it('repairs only that shape: the UUID must still be the whole value up to the "?"', () => {
    expect(queryUuid(`${UUID}?id=${PAYMENT}`)).toBe(UUID);
    expect(queryUuid(`${UUID}?`)).toBe(UUID);
    expect(queryUuid(UUID)).toBe(UUID);
    for (const raw of [`${UUID}x`, `${UUID}&id=1`, `${UUID}#x`, `x${UUID}`, `x?${UUID}`, `?${UUID}`, '', null]) {
      expect(queryUuid(raw), String(raw)).toBe('');
    }
  });
  it('never forwards anything from the tail, however hostile', () => {
    expect(returned(`session=${UUID}?"><script>alert(1)</script>`)).toBe(
      `spicymeal://payment/return?session=${UUID}`,
    );
    expect(returned('session=evil?https://evil.example')).toBe('spicymeal://payment/return');
  });
});

describe('escapeHtmlAttr', () => {
  it('escapes the characters that could break out of an href/content attribute', () => {
    expect(escapeHtmlAttr('a"b&c<d>')).toBe('a&quot;b&amp;c&lt;d&gt;');
  });
  it('leaves a clean deep link unchanged', () => {
    expect(escapeHtmlAttr(`spicymeal://payment/return?session=${UUID}`)).toBe(`spicymeal://payment/return?session=${UUID}`);
  });
});
