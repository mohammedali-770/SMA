import { describe, expect, it } from 'vitest';

import { looksTechnical, presentState } from './stateHierarchy';

const FALLBACK = "The menu didn't load";

describe('looksTechnical', () => {
  it('flags transport and library strings that reached the UI', () => {
    for (const m of [
      'Network request failed',
      'TypeError: Cannot read properties of undefined',
      'fetch failed',
      'Request timed out',
      'status code 500',
      'ECONNREFUSED',
      'relation "orders" does not exist',
      'https://api.example.com/v1 returned 503',
      '{"code":"PGRST116"}',
      'null',
      'undefined',
    ]) {
      expect(looksTechnical(m), m).toBe(true);
    }
  });

  it('treats an empty message as technical so it can never be the heading', () => {
    expect(looksTechnical('')).toBe(true);
    expect(looksTechnical('   ')).toBe(true);
  });

  it('leaves genuine customer sentences alone', () => {
    for (const m of [
      'Your order is below the delivery minimum',
      'This branch is closed right now',
      'طلبك أقل من الحد الأدنى للتوصيل',
      'هذا الفرع مغلق حالياً',
    ]) {
      expect(looksTechnical(m), m).toBe(false);
    }
  });
});

describe('presentState', () => {
  it('promotes a human message to the heading with nothing repeated below', () => {
    // Showing the same sentence twice is the repetition the hierarchy rule
    // explicitly asks us to remove.
    const r = presentState({ message: 'This branch is closed right now', fallbackTitle: FALLBACK });
    expect(r.heading).toBe('This branch is closed right now');
    expect(r.detail).toBeNull();
  });

  it('demotes technical text under a localized heading, without discarding it', () => {
    const r = presentState({ message: 'Network request failed', fallbackTitle: FALLBACK });
    expect(r.heading).toBe(FALLBACK);
    // Support asks customers to read this back, so it must survive.
    expect(r.detail).toBe('Network request failed');
  });

  it('uses the Arabic fallback when one is supplied', () => {
    const r = presentState({ message: 'fetch failed', fallbackTitle: 'تعذّر تحميل القائمة' });
    expect(r.heading).toBe('تعذّر تحميل القائمة');
    expect(r.detail).toBe('fetch failed');
  });

  it('lets an explicit title win and pushes the message to detail', () => {
    const r = presentState({
      message: 'Something a screen wants shown quietly',
      title: 'We could not reach the branch',
      fallbackTitle: FALLBACK,
    });
    expect(r.heading).toBe('We could not reach the branch');
    expect(r.detail).toBe('Something a screen wants shown quietly');
  });

  it('does not repeat the message when it equals the explicit title', () => {
    const r = presentState({ message: 'Same text', title: 'Same text', fallbackTitle: FALLBACK });
    expect(r.heading).toBe('Same text');
    expect(r.detail).toBeNull();
  });

  it('never leaves an empty heading', () => {
    for (const message of ['', '   ']) {
      const r = presentState({ message, fallbackTitle: FALLBACK });
      expect(r.heading).toBe(FALLBACK);
      expect(r.detail).toBeNull();
    }
  });
});
