import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FUNCTION_REGION, internalFunctionUrl } from './functionRegion.ts';

describe('internalFunctionUrl', () => {
  it('pins a function-to-function call to the database region', () => {
    expect(internalFunctionUrl('https://p.supabase.co', 'lazywait-sync')).toBe(
      'https://p.supabase.co/functions/v1/lazywait-sync?forceFunctionRegion=eu-central-1',
    );
  });

  it('names the same region as the app', () => {
    const app = readFileSync(
      new URL('../../../apps/mobile/src/lib/functionRegion.ts', import.meta.url),
      'utf8',
    );
    expect(app).toContain(`export const FUNCTION_REGION = '${FUNCTION_REGION}';`);
  });

  it('names the project region the docs record', () => {
    // The project region is not in config.toml; PAYMENTS.md §2 records it.
    const doc = readFileSync(new URL('../../../docs/PAYMENTS.md', import.meta.url), 'utf8');
    expect(doc).toContain(`\`${FUNCTION_REGION}\``);
  });
});
