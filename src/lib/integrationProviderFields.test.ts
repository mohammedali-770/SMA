import { describe, it, expect } from 'vitest';
import { providerFieldSet } from './integrationProvider';

const base = {
  publicFields: [{ key: 'merchant_id' }, { key: 'source_id' }],
  secretFields: [{ key: 'test_secret_key' }],
};
const byProvider = {
  moyasar: {
    publicFields: [{ key: 'test_publishable_key' }],
    secretFields: [{ key: 'test_secret_key' }, { key: 'test_webhook_secret_token' }],
  },
};

describe('providerFieldSet', () => {
  it('returns the override for a provider that has one', () => {
    const f = providerFieldSet(base, byProvider, 'moyasar');
    expect(f.publicFields.map(x => x.key)).toEqual(['test_publishable_key']);
    expect(f.secretFields.map(x => x.key)).toContain('test_webhook_secret_token');
  });

  /** Every other integration slot must keep behaving exactly as before. */
  it('falls back to the slot fields when the provider has no override', () => {
    expect(providerFieldSet(base, byProvider, 'tap')).toBe(base);
    expect(providerFieldSet(base, undefined, 'moyasar')).toBe(base);
    expect(providerFieldSet(base, byProvider, null)).toBe(base);
    expect(providerFieldSet(base, byProvider, '')).toBe(base);
  });

  it('matches the provider case-insensitively', () => {
    expect(providerFieldSet(base, byProvider, 'MOYASAR').publicFields.map(x => x.key))
      .toEqual(['test_publishable_key']);
  });

  /**
   * The failure this prevents: rendering the union of both providers' fields
   * would show an administrator inputs that do nothing for the provider they
   * picked — which is how a "configured" gateway ends up missing the one field
   * that mattered (for Moyasar, the webhook secret).
   */
  it('never leaks the other provider’s fields into the selected set', () => {
    const f = providerFieldSet(base, byProvider, 'moyasar');
    expect(f.publicFields.map(x => x.key)).not.toContain('merchant_id');
    expect(f.publicFields.map(x => x.key)).not.toContain('source_id');
  });
});
