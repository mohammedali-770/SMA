/**
 * Framework-free on purpose: vitest.config.ts runs mobile tests under Node and
 * forbids React Native imports here, so this exercises the form module the
 * editor delegates to rather than rendering the screen.
 *
 * The point of most of these cases is that the profile editor enforces the SAME
 * rules as Checkout and the order-type gate — a landmark the gate would accept
 * must save here, and one it would reject must not.
 */
import { describe, expect, it } from 'vitest';

import {
  addressFormCopy, EMPTY_ADDRESS_FORM, LABEL_MAX_LENGTH, toAddressInput,
  toAddressPatchFromForm, toFormValues, validateAddressForm, type AddressFormValues,
} from './addressForm';
import { descriptionCopy } from '../order/locationDescription';

function form(over: Partial<AddressFormValues> = {}): AddressFormValues {
  return {
    label: 'Home',
    description: 'blue villa gate beside the pharmacy',
    nationalShortAddress: '',
    lat: 24.7136,
    lng: 46.6753,
    ...over,
  };
}

const SAVED = {
  label: 'Home',
  description: 'blue villa gate beside the pharmacy',
  nationalShortAddress: 'RRBB1234',
  lat: 24.7136,
  lng: 46.6753,
};

describe('validateAddressForm — a complete address', () => {
  it('accepts a filled form', () => {
    const res = validateAddressForm(form(), 'en');
    expect(res.valid).toBe(true);
    expect(res.errors).toEqual({
      description: null, nationalShortAddress: null, label: null, location: null,
    });
  });

  it('accepts an Arabic landmark', () => {
    expect(validateAddressForm(form({ description: 'المبنى الأزرق، المدخل الثاني' }), 'ar').valid).toBe(true);
  });
});

describe('validateAddressForm — the mandatory landmark', () => {
  it('rejects an empty landmark with the SHARED copy, not a new message', () => {
    const res = validateAddressForm(form({ description: '' }), 'en');
    expect(res.valid).toBe(false);
    expect(res.descriptionProblem).toBe('empty');
    expect(res.errors.description).toBe(descriptionCopy.en.empty);
  });

  it('rejects a whitespace-only landmark as empty', () => {
    expect(validateAddressForm(form({ description: '    ' }), 'en').descriptionProblem).toBe('empty');
  });

  it('rejects a too-short landmark', () => {
    expect(validateAddressForm(form({ description: 'abc' }), 'en').descriptionProblem).toBe('too_short');
  });

  it('rejects the reverse-geocoded address pasted back as guidance', () => {
    // The rule that makes the landmark mean something: it cannot be satisfied
    // by the text the map already knows.
    const resolved = 'King Fahd Rd, Al Olaya, Riyadh';
    const res = validateAddressForm(form({ description: 'King Fahd Rd, Al Olaya, Riyadh' }), 'en', resolved);
    expect(res.valid).toBe(false);
    expect(res.descriptionProblem).toBe('echoes_address');
  });

  it('accepts real guidance added to the address text', () => {
    const resolved = 'King Fahd Rd, Al Olaya, Riyadh';
    const res = validateAddressForm(
      form({ description: 'King Fahd Rd — blue gate next to the pharmacy' }), 'en', resolved,
    );
    expect(res.valid).toBe(true);
  });

  it('uses the Arabic message in Arabic', () => {
    expect(validateAddressForm(form({ description: '' }), 'ar').errors.description)
      .toBe(descriptionCopy.ar.empty);
  });
});

describe('validateAddressForm — the pin', () => {
  it('rejects a form with no pin dropped', () => {
    const res = validateAddressForm(form({ lat: null, lng: null }), 'en');
    expect(res.valid).toBe(false);
    expect(res.errors.location).toBe(addressFormCopy.en.missingLocation);
  });

  it('rejects the null-island 0/0 an emulator reports as a fix', () => {
    expect(validateAddressForm(form({ lat: 0, lng: 0 }), 'en').valid).toBe(false);
  });

  it('rejects out-of-range coordinates', () => {
    expect(validateAddressForm(form({ lat: 99, lng: 46 }), 'en').valid).toBe(false);
  });
});

describe('validateAddressForm — the optional fields', () => {
  it('accepts an empty short address (it is optional)', () => {
    expect(validateAddressForm(form({ nationalShortAddress: '' }), 'en').valid).toBe(true);
  });

  it('accepts a valid short address in either case', () => {
    expect(validateAddressForm(form({ nationalShortAddress: 'RRBB1234' }), 'en').valid).toBe(true);
    expect(validateAddressForm(form({ nationalShortAddress: 'rrbb1234' }), 'en').valid).toBe(true);
  });

  it('rejects a malformed short address', () => {
    const res = validateAddressForm(form({ nationalShortAddress: 'RB12' }), 'en');
    expect(res.valid).toBe(false);
    expect(res.errors.nationalShortAddress).toBeTruthy();
  });

  it('accepts an empty label', () => {
    expect(validateAddressForm(form({ label: '' }), 'en').valid).toBe(true);
  });

  it('rejects an unusably long label', () => {
    const res = validateAddressForm(form({ label: 'x'.repeat(LABEL_MAX_LENGTH + 1) }), 'en');
    expect(res.valid).toBe(false);
    expect(res.errors.label).toBe(addressFormCopy.en.labelTooLong);
  });

  it('an untouched empty form is invalid but does not claim a label problem', () => {
    const res = validateAddressForm(EMPTY_ADDRESS_FORM, 'en');
    expect(res.valid).toBe(false);
    expect(res.errors.label).toBeNull();
    expect(res.errors.nationalShortAddress).toBeNull();
  });
});

describe('toAddressInput', () => {
  it('builds the write payload from a valid form', () => {
    expect(toAddressInput(form({ nationalShortAddress: 'rrbb1234' }), { isDefault: true })).toEqual({
      label: 'Home',
      description: 'blue villa gate beside the pharmacy',
      nationalShortAddress: 'rrbb1234',
      latitude: 24.7136,
      longitude: 46.6753,
      isDefault: true,
    });
  });

  it('sends the TRIMMED landmark, never the raw input', () => {
    expect(toAddressInput(form({ description: '   blue villa gate beside the pharmacy   ' })).description)
      .toBe('blue villa gate beside the pharmacy');
  });

  it('falls back to the landmark when the customer named nothing', () => {
    expect(toAddressInput(form({ label: '   ' })).label).toBe('blue villa gate beside the pharmacy');
  });

  it('truncates the fallback label to the column-safe length', () => {
    const long = 'a '.repeat(80).trim();
    expect((toAddressInput(form({ label: '', description: long })).label ?? '').length)
      .toBe(LABEL_MAX_LENGTH);
  });

  it('omits isDefault entirely when the caller did not decide', () => {
    expect(toAddressInput(form())).not.toHaveProperty('isDefault');
  });

  it('refuses to build a payload from an invalid form', () => {
    expect(() => toAddressInput(form({ description: '' }))).toThrow(/description/i);
    expect(() => toAddressInput(form({ lat: null, lng: null }))).toThrow(/location/i);
  });
});

describe('toFormValues', () => {
  it('seeds a blank form for a new address', () => {
    expect(toFormValues(null)).toEqual(EMPTY_ADDRESS_FORM);
  });

  it('seeds from a saved address', () => {
    expect(toFormValues(SAVED)).toEqual({
      label: 'Home',
      description: 'blue villa gate beside the pharmacy',
      nationalShortAddress: 'RRBB1234',
      lat: 24.7136,
      lng: 46.6753,
    });
  });

  it('treats a historical 0/0 row as "no pin" so the editor asks for one', () => {
    const seeded = toFormValues({ ...SAVED, lat: 0, lng: 0 });
    expect(seeded.lat).toBeNull();
    expect(seeded.lng).toBeNull();
    // …and the landmark is still carried over, so the customer only re-pins.
    expect(seeded.description).toBe(SAVED.description);
  });
});

describe('toAddressPatchFromForm — only what actually changed', () => {
  it('an untouched form produces an empty patch', () => {
    expect(toAddressPatchFromForm(toFormValues(SAVED), SAVED)).toEqual({});
  });

  it('editing the label alone does not rewrite the landmark', () => {
    // Rewriting `description` would re-fire the server-side landmark trigger on
    // a historical row the customer never edited.
    const patch = toAddressPatchFromForm({ ...toFormValues(SAVED), label: 'Work' }, SAVED);
    expect(patch).toEqual({ label: 'Work' });
  });

  it('editing the landmark alone sends only the landmark', () => {
    const patch = toAddressPatchFromForm(
      { ...toFormValues(SAVED), description: 'white tower, entrance C' }, SAVED,
    );
    expect(patch).toEqual({ description: 'white tower, entrance C' });
  });

  it('moving the pin sends both coordinates', () => {
    const patch = toAddressPatchFromForm({ ...toFormValues(SAVED), lat: 24.8, lng: 46.7 }, SAVED);
    expect(patch).toEqual({ latitude: 24.8, longitude: 46.7 });
  });

  it('a case-only short-address edit is not a change', () => {
    const patch = toAddressPatchFromForm(
      { ...toFormValues(SAVED), nationalShortAddress: 'rrbb1234' }, SAVED,
    );
    expect(patch).toEqual({});
  });

  it('a real short-address edit is sent', () => {
    const patch = toAddressPatchFromForm(
      { ...toFormValues(SAVED), nationalShortAddress: 'ZZZZ9999' }, SAVED,
    );
    expect(patch).toEqual({ nationalShortAddress: 'ZZZZ9999' });
  });

  it('never sends isDefault — promotion is a separate, explicit action', () => {
    const patch = toAddressPatchFromForm({ ...toFormValues(SAVED), label: 'Work' }, SAVED);
    expect(patch).not.toHaveProperty('isDefault');
  });
});

describe('bilingual copy', () => {
  it('every key exists in both languages, and the Arabic is Arabic', () => {
    const keys = Object.keys(addressFormCopy.en) as (keyof typeof addressFormCopy.en)[];
    for (const key of keys) {
      expect(typeof addressFormCopy.ar[key]).toBe('string');
      expect(addressFormCopy.ar[key].length).toBeGreaterThan(0);
      expect(/[؀-ۿ]/.test(addressFormCopy.ar[key])).toBe(true);
    }
  });
});
