import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPO_BASE_HEADERS, expoPushHeaders } from './expoHeaders';

/**
 * S03#1: push-dispatch sends Expo's access token when, and only when, the
 * EXPO_ACCESS_TOKEN secret is set. Without it the request must be exactly what
 * it has always been, because push is a live customer channel (CLAUDE.md §7).
 */
describe('expoPushHeaders', () => {
  it('without a token sends exactly the headers push-dispatch always sent', () => {
    for (const t of [undefined, null, '', '   ', '\n']) {
      expect(expoPushHeaders(t)).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
      });
    }
  });

  it('with a token adds a bearer Authorization header and keeps the rest', () => {
    expect(expoPushHeaders('tok_123')).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer tok_123',
    });
  });

  it('trims whitespace a pasted secret may carry', () => {
    expect(expoPushHeaders('  tok_123\n').Authorization).toBe('Bearer tok_123');
  });

  it('never mutates the shared base headers', () => {
    const h = expoPushHeaders('tok_123');
    h['X-Extra'] = '1';
    expect(EXPO_BASE_HEADERS).toEqual({ 'Content-Type': 'application/json', Accept: 'application/json' });
    expect(Object.isFrozen(EXPO_BASE_HEADERS)).toBe(true);
  });
});

/** The same source with comments removed, so an explanation cannot satisfy an assertion. */
function code(): string {
  return readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

describe('push-dispatch wiring', () => {
  it('builds the Expo request headers from EXPO_ACCESS_TOKEN', () => {
    const src = code();
    const fetchAt = src.indexOf('fetch(EXPO_PUSH_URL');
    expect(fetchAt).toBeGreaterThan(-1);
    const call = src.slice(fetchAt, src.indexOf('});', fetchAt));
    expect(call).toMatch(/headers:\s*expoPushHeaders\(Deno\.env\.get\('EXPO_ACCESS_TOKEN'\)\)/);
  });

  it('has exactly one Expo send, so no path can skip the token', () => {
    expect(code().match(/fetch\(EXPO_PUSH_URL/g)?.length).toBe(1);
  });

  it('never logs the access token', () => {
    const src = code();
    expect(src).not.toMatch(/console\.[a-z]+\([^)]*EXPO_ACCESS_TOKEN/);
    const helper = readFileSync(new URL('./expoHeaders.ts', import.meta.url), 'utf8');
    expect(helper).not.toMatch(/console\./);
  });
});
