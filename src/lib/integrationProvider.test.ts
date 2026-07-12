import { describe, it, expect } from 'vitest';
import { initialProviderName } from './integrationProvider';

describe('initialProviderName', () => {
  it('coerces a stale stored value to the first offered option (the Codex P2 case)', () => {
    // payment row seeded 'sandbox', card now offers only ['tap'] -> must become 'tap'
    expect(initialProviderName('sandbox', ['tap'])).toBe('tap');
    expect(initialProviderName('moyasar', ['tap'])).toBe('tap');
  });
  it('keeps a stored value that the card still offers', () => {
    expect(initialProviderName('tap', ['tap'])).toBe('tap');
    expect(initialProviderName('meta_cloud', ['meta_cloud'])).toBe('meta_cloud');
    expect(initialProviderName('smtp', ['smtp', 'other'])).toBe('smtp');
  });
  it('falls back to the first option when nothing is stored', () => {
    expect(initialProviderName(null, ['tap'])).toBe('tap');
    expect(initialProviderName(undefined, ['smtp'])).toBe('smtp');
    expect(initialProviderName('', ['lazywait'])).toBe('lazywait');
  });
  it('is safe with no options', () => {
    expect(initialProviderName('x', [])).toBe('x');
    expect(initialProviderName(null, undefined)).toBe('');
  });
});
