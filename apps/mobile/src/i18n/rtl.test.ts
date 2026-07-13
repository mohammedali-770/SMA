import { describe, expect, it } from 'vitest';

import { rtlRow, rtlText } from './rtl';

describe('rtlText', () => {
  it('aligns right in Arabic, left otherwise', () => {
    expect(rtlText(true)).toEqual({ textAlign: 'right' });
    expect(rtlText(false)).toEqual({ textAlign: 'left' });
  });
});

describe('rtlRow', () => {
  it('mirrors the row in Arabic, keeps it in English', () => {
    expect(rtlRow(true)).toEqual({ flexDirection: 'row-reverse' });
    expect(rtlRow(false)).toEqual({ flexDirection: 'row' });
  });
});
