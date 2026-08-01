/**
 * Framework-free on purpose: vitest.config.ts runs mobile tests under Node and
 * forbids React Native imports here, so this exercises the payload/ownership/
 * error module `services/api.ts` delegates to rather than the Supabase calls.
 */
import { describe, expect, it } from 'vitest';

import {
  addressErrorCopy, addressErrorMessage, classifyAddressError, isEmptyPatch,
  normalizeOptionalText, normalizeShortAddress, requireCustomerId, toAddressInsert, toAddressPatch,
} from './addressPayload';

const BASE = { latitude: 24.7136, longitude: 46.6753 };

describe('ownership', () => {
  it('stamps the signed-in user as the owner', () => {
    const row = toAddressInsert({ ...BASE, description: 'blue gate' }, 'user-1');
    expect(row.customer_id).toBe('user-1');
  });

  it('refuses to build a create payload with no session', () => {
    expect(() => requireCustomerId(null)).toThrow(/signed in/i);
    expect(() => requireCustomerId(undefined)).toThrow(/signed in/i);
    expect(() => requireCustomerId('')).toThrow(/signed in/i);
  });

  it('returns the id when there is a session', () => {
    expect(requireCustomerId('user-1')).toBe('user-1');
  });

  it('an UPDATE can never re-parent an address to another customer', () => {
    // customer_id is not an expressible key of the patch DTO, and nothing in
    // toAddressPatch can produce it — so RLS is never asked to defend against
    // a write this client could actually issue.
    const row = toAddressPatch({
      label: 'Home',
      // @ts-expect-error — proving the DTO refuses it at the type level too.
      customer_id: 'someone-else',
    });
    expect(row).not.toHaveProperty('customer_id');
    expect(Object.keys(row)).toEqual(['label']);
  });
});

describe('normalizeShortAddress', () => {
  it('upper-cases so the column CHECK (^[A-Z]{4}[0-9]{4}$) accepts it', () => {
    expect(normalizeShortAddress('rrbb1234')).toBe('RRBB1234');
  });

  it('trims before storing', () => {
    expect(normalizeShortAddress('  RRBB1234  ')).toBe('RRBB1234');
  });

  it('treats blank and whitespace-only as absent, not as an empty code', () => {
    expect(normalizeShortAddress('')).toBeNull();
    expect(normalizeShortAddress('   ')).toBeNull();
    expect(normalizeShortAddress(null)).toBeNull();
    expect(normalizeShortAddress(undefined)).toBeNull();
  });
});

describe('normalizeOptionalText', () => {
  it('trims and collapses blank to null', () => {
    expect(normalizeOptionalText('  Home  ')).toBe('Home');
    expect(normalizeOptionalText('   ')).toBeNull();
    expect(normalizeOptionalText(undefined)).toBeNull();
  });
});

describe('toAddressInsert', () => {
  it('writes exactly the customer-writable columns', () => {
    const row = toAddressInsert({
      ...BASE, label: 'Home', description: 'blue gate beside the pharmacy',
      nationalShortAddress: 'rrbb1234', isDefault: true,
    }, 'user-1');

    expect(row).toEqual({
      customer_id: 'user-1',
      label: 'Home',
      description: 'blue gate beside the pharmacy',
      national_short_address: 'RRBB1234',
      latitude: 24.7136,
      longitude: 46.6753,
      is_default: true,
    });
  });

  it('defaults is_default to false rather than leaving it undefined', () => {
    const row = toAddressInsert({ ...BASE, description: 'blue gate' }, 'user-1');
    expect(row.is_default).toBe(false);
  });

  it('keeps 0 coordinates as numbers rather than dropping them', () => {
    const row = toAddressInsert({ latitude: 0, longitude: 0, description: 'x' }, 'u');
    expect(row.latitude).toBe(0);
    expect(row.longitude).toBe(0);
  });
});

describe('toAddressPatch', () => {
  it('sends ONLY the keys the caller supplied', () => {
    expect(toAddressPatch({ description: 'white tower, entrance C' }))
      .toEqual({ description: 'white tower, entrance C' });
  });

  it('editing a label cannot blank the mandatory landmark', () => {
    const row = toAddressPatch({ label: 'Work' });
    expect(row).not.toHaveProperty('description');
  });

  it('an explicit null is sent (clearing an optional column) — undefined is not', () => {
    expect(toAddressPatch({ label: null })).toEqual({ label: null });
    expect(toAddressPatch({ label: undefined })).toEqual({});
  });

  it('sends is_default: false, which is falsy but meaningful', () => {
    expect(toAddressPatch({ isDefault: false })).toEqual({ is_default: false });
  });

  it('sends latitude: 0, which is falsy but meaningful', () => {
    expect(toAddressPatch({ latitude: 0 })).toEqual({ latitude: 0 });
  });

  it('upper-cases a short address on update too', () => {
    expect(toAddressPatch({ nationalShortAddress: 'rrbb1234' }))
      .toEqual({ national_short_address: 'RRBB1234' });
  });

  it('isEmptyPatch spots the no-op write PostgREST would reject', () => {
    expect(isEmptyPatch(toAddressPatch({}))).toBe(true);
    expect(isEmptyPatch(toAddressPatch({ label: 'Home' }))).toBe(false);
  });
});

describe('classifyAddressError', () => {
  it('reads the SQLSTATE when it survived', () => {
    expect(classifyAddressError({ code: '23503', message: '' })).toBe('constrained');
    expect(classifyAddressError({ code: '23514', message: '' })).toBe('invalid_description');
    expect(classifyAddressError({ code: '42501', message: '' })).toBe('not_signed_in');
    expect(classifyAddressError({ code: 'PGRST116', message: '' })).toBe('not_found');
  });

  it('recognises the live-checkout guard by its dedicated SQLSTATE', () => {
    // trg_addresses_guard_live_checkout raises 55006 while a checkout session
    // could still turn the address into an order. Deleting then would leave a
    // captured payment with no order it could become.
    expect(classifyAddressError({ code: '55006', message: '' })).toBe('checkout_in_progress');
  });

  it('recognises the live-checkout guard by message when the code is lost', () => {
    expect(classifyAddressError(new Error('This address is used by a checkout that has not finished.')))
      .toBe('checkout_in_progress');
  });

  it('does NOT confuse the live-checkout guard with a generic FK refusal', () => {
    // The two must stay distinguishable: one is self-resolving and the message
    // says so; the other is a surprise.
    expect(classifyAddressError({ code: '55006', message: '' }))
      .not.toBe(classifyAddressError({ code: '23503', message: '' }));
  });

  it('classifies an UNEXPECTED foreign-key refusal as a generic constraint failure', () => {
    // The one customers used to hit — checkout_sessions.address_id with no ON
    // DELETE action — is fixed at the schema level by migration 20260801120100,
    // so a 23503 here is now a surprise, not a documented dead end.
    expect(classifyAddressError(new Error(
      'update or delete on table "addresses" violates foreign key constraint '
      + '"some_future_table_address_id_fkey" on table "some_future_table"',
    ))).toBe('constrained');
  });

  it('no longer tells the customer a delete is permanently impossible', () => {
    // The old copy said the address was "linked to a payment" and could not be
    // deleted, which was true only because of the FK that 20260801120100
    // relaxes. Neither remaining message may claim a permanent dead end.
    for (const lang of ['en', 'ar'] as const) {
      for (const key of ['constrained', 'checkout_in_progress'] as const) {
        expect(addressErrorCopy[lang][key]).not.toMatch(/can't be deleted|cannot be deleted|لا يمكن حذفه/i);
      }
    }
  });

  it('the live-checkout message promises recovery, because the guard really does lift', () => {
    expect(addressErrorCopy.en.checkout_in_progress).toMatch(/once that order finishes/i);
    expect(addressErrorCopy.ar.checkout_in_progress).toMatch(/بعد اكتمال/);
  });

  it('recognises the mandatory-landmark trigger by message when the code is lost', () => {
    expect(classifyAddressError(new Error('A location description (nearest landmark) is required.')))
      .toBe('invalid_description');
  });

  it('recognises an RLS refusal', () => {
    expect(classifyAddressError(new Error('new row violates row-level security policy')))
      .toBe('not_signed_in');
  });

  it('recognises a transport failure', () => {
    expect(classifyAddressError(new Error('Network request failed'))).toBe('network');
    expect(classifyAddressError(new Error('fetch failed'))).toBe('network');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(classifyAddressError(new Error('teapot'))).toBe('unknown');
    expect(classifyAddressError(null)).toBe('unknown');
    expect(classifyAddressError(undefined)).toBe('unknown');
    expect(classifyAddressError('a bare string')).toBe('unknown');
  });
});

describe('addressErrorMessage', () => {
  it('never returns a raw provider string to the customer', () => {
    const raw = 'update or delete on table "addresses" violates foreign key constraint';
    const msg = addressErrorMessage(new Error(raw), 'en');
    expect(msg).toBe(addressErrorCopy.en.constrained);
    expect(msg).not.toContain('foreign key');
  });

  it('has copy for every problem, in both languages', () => {
    const problems = [
      'not_signed_in', 'checkout_in_progress', 'constrained', 'not_found', 'invalid_description',
      'network', 'unknown',
    ] as const;
    for (const lang of ['en', 'ar'] as const) {
      for (const p of problems) {
        expect(typeof addressErrorCopy[lang][p]).toBe('string');
        expect(addressErrorCopy[lang][p].length).toBeGreaterThan(0);
      }
    }
  });

  it('the Arabic copy is Arabic, not the English string reused', () => {
    for (const key of Object.keys(addressErrorCopy.en) as (keyof typeof addressErrorCopy.en)[]) {
      expect(addressErrorCopy.ar[key]).not.toBe(addressErrorCopy.en[key]);
      expect(/[؀-ۿ]/.test(addressErrorCopy.ar[key])).toBe(true);
    }
  });

  it('resolves to the right language', () => {
    expect(addressErrorMessage(new Error('Network request failed'), 'ar'))
      .toBe(addressErrorCopy.ar.network);
  });
});
