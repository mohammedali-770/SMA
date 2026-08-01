/**
 * The address-editor form rule — FRAMEWORK-FREE and fully unit-tested.
 *
 * This does NOT define a second address validator. It composes the two that
 * already exist and are already mirrored server-side:
 *
 *   - `checkDescription` (features/order/locationDescription.ts) — the mandatory
 *     delivery landmark, mirrored by trg_addresses_require_description;
 *   - `validateShortAddress` (design-system/generated/fieldState.ts) — the Saudi
 *     National Short Address format, mirrored by the column CHECK.
 *
 * Adding a third opinion about what a valid address is would be exactly the
 * failure mode the mandatory-landmark work was done to end: the editor could
 * then create addresses Checkout refuses, or refuse addresses Checkout creates.
 *
 * The only rule genuinely new here is that the pin must be a real point, since
 * the profile editor is the first surface where a customer can save an address
 * without the order-type gate having already resolved a branch for it.
 */
import { isUsableFix } from '../../components/locationControl';
import { validateShortAddress } from '../../design-system/generated/fieldState';
import {
  checkDescription,
  descriptionMessage,
  type DescriptionProblem,
} from '../order/locationDescription';
import type { AddressInput } from '../../services/addressPayload';

/** Longest label the list can render on one line without truncating oddly. */
export const LABEL_MAX_LENGTH = 60;

export interface AddressFormValues {
  label: string;
  description: string;
  nationalShortAddress: string;
  lat: number | null;
  lng: number | null;
}

export const EMPTY_ADDRESS_FORM: AddressFormValues = {
  label: '',
  description: '',
  nationalShortAddress: '',
  lat: null,
  lng: null,
};

export interface AddressFormErrors {
  /** The mandatory landmark. */
  description: string | null;
  /** Optional; only set when a non-empty value is malformed. */
  nationalShortAddress: string | null;
  /** Optional; only set when the label is unusably long. */
  label: string | null;
  /** No pin dropped, or a pin at an impossible/null-island coordinate. */
  location: string | null;
}

export interface AddressFormResult {
  valid: boolean;
  errors: AddressFormErrors;
  /** The landmark problem, so the caller can reuse the shared copy verbatim. */
  descriptionProblem: DescriptionProblem | null;
}

export const addressFormCopy = {
  en: {
    labelField: 'Name this address (optional)',
    labelPlaceholder: 'Home, Work, Mum',
    shortAddressField: 'National Short Address (optional)',
    shortAddressHint: 'Four letters and four numbers, e.g. RRBB1234',
    labelTooLong: `Keep it under ${LABEL_MAX_LENGTH} characters`,
    missingLocation: 'Drop a pin on the map to set this address',
  },
  ar: {
    labelField: 'اسم العنوان (اختياري)',
    labelPlaceholder: 'المنزل، العمل، منزل الوالدة',
    shortAddressField: 'العنوان الوطني المختصر (اختياري)',
    shortAddressHint: 'أربعة أحرف وأربعة أرقام، مثال: RRBB1234',
    labelTooLong: `اجعل الاسم أقل من ${LABEL_MAX_LENGTH} حرفاً`,
    missingLocation: 'حدد الموقع على الخريطة لحفظ هذا العنوان',
  },
} as const;

export type AddressFormLang = keyof typeof addressFormCopy;

/**
 * Validate the whole editor at once.
 *
 * `resolvedAddress` is the reverse-geocoded text for the current pin. Passing it
 * enables the `echoes_address` rule — a customer cannot satisfy the mandatory
 * landmark by pasting back the address the map already knows.
 */
export function validateAddressForm(
  values: AddressFormValues,
  lang: AddressFormLang,
  resolvedAddress?: string | null,
): AddressFormResult {
  const copy = addressFormCopy[lang];

  const desc = checkDescription(values.description, resolvedAddress);
  const short = validateShortAddress(values.nationalShortAddress, lang);
  const labelTooLong = values.label.trim().length > LABEL_MAX_LENGTH;
  const locationOk = isUsableFix(values.lat, values.lng);

  const errors: AddressFormErrors = {
    description: descriptionMessage(desc.problem, lang),
    nationalShortAddress: short.valid ? null : short.error,
    label: labelTooLong ? copy.labelTooLong : null,
    location: locationOk ? null : copy.missingLocation,
  };

  return {
    valid: desc.valid && short.valid && !labelTooLong && locationOk,
    errors,
    descriptionProblem: desc.problem,
  };
}

/**
 * Build the write payload from a VALIDATED form.
 *
 * Throws rather than silently writing a half-valid address: every caller
 * validates first, so reaching here with an invalid form is a programming
 * error, and a thrown error is far cheaper to find than an address row a driver
 * cannot use.
 *
 * The label falls back to the landmark, matching what the order-type gate
 * already does when it creates an address inline — an unnamed address is
 * otherwise a blank row in the list.
 */
export function toAddressInput(
  values: AddressFormValues,
  options: { isDefault?: boolean } = {},
): AddressInput {
  const desc = checkDescription(values.description);
  if (!desc.valid) throw new Error('toAddressInput called with an invalid description');
  if (!isUsableFix(values.lat, values.lng)) {
    throw new Error('toAddressInput called without a usable location');
  }

  const label = values.label.trim() || desc.value;
  return {
    label: label.slice(0, LABEL_MAX_LENGTH),
    description: desc.value,
    nationalShortAddress: values.nationalShortAddress,
    latitude: values.lat as number,
    longitude: values.lng as number,
    ...(options.isDefault === undefined ? {} : { isDefault: options.isDefault }),
  };
}

/** Seed the editor from a saved address, or start blank for a new one. */
export function toFormValues(
  address: {
    label: string;
    description: string;
    nationalShortAddress: string;
    lat: number;
    lng: number;
  } | null,
): AddressFormValues {
  if (!address) return { ...EMPTY_ADDRESS_FORM };
  return {
    label: address.label,
    description: address.description,
    nationalShortAddress: address.nationalShortAddress,
    // A historical row can carry 0/0; treat that as "no pin" so the editor asks
    // for one instead of showing the customer a pin in the ocean.
    lat: isUsableFix(address.lat, address.lng) ? address.lat : null,
    lng: isUsableFix(address.lat, address.lng) ? address.lng : null,
  };
}

/**
 * The patch for an edit: only the fields the customer actually changed.
 *
 * Sending the full row on every save would rewrite `description` even when it
 * was untouched, which makes the server-side landmark trigger re-validate a
 * historical address the customer never edited — the exact failure that
 * migration was written as a trigger (rather than a CHECK) to avoid.
 */
export function toAddressPatchFromForm(
  values: AddressFormValues,
  original: {
    label: string;
    description: string;
    nationalShortAddress: string;
    lat: number;
    lng: number;
  },
): Partial<AddressInput> {
  const next = toAddressInput(values);
  const patch: Partial<AddressInput> = {};
  if (next.label !== original.label) patch.label = next.label;
  if (next.description !== original.description) patch.description = next.description;
  if ((next.nationalShortAddress ?? '').trim().toUpperCase() !== original.nationalShortAddress.toUpperCase()) {
    patch.nationalShortAddress = next.nationalShortAddress;
  }
  if (next.latitude !== original.lat) patch.latitude = next.latitude;
  if (next.longitude !== original.lng) patch.longitude = next.longitude;
  return patch;
}
