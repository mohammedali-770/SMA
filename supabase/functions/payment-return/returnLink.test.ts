import { describe, expect, it } from 'vitest';

import { buildReturnDeepLink, escapeHtmlAttr, sanitizeUuid } from './returnLink.ts';

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

describe('escapeHtmlAttr', () => {
  it('escapes the characters that could break out of an href/content attribute', () => {
    expect(escapeHtmlAttr('a"b&c<d>')).toBe('a&quot;b&amp;c&lt;d&gt;');
  });
  it('leaves a clean deep link unchanged', () => {
    expect(escapeHtmlAttr(`spicymeal://payment/return?session=${UUID}`)).toBe(`spicymeal://payment/return?session=${UUID}`);
  });
});
