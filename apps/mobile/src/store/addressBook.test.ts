/**
 * Framework-free on purpose: vitest.config.ts runs mobile tests under Node and
 * forbids React Native imports here, so this exercises the reducer the
 * AddressProvider delegates to rather than rendering the provider.
 */
import { describe, expect, it } from 'vitest';

import {
  applyAddressEvent, contextNeedsReset, EMPTY_ADDRESS_BOOK, findAddress, NEW_ADDRESS,
  preselectAddress, shouldBecomeDefault, type AddressBookState,
} from './addressBook';
import type { SavedAddress } from '../types/models';

function addr(id: string, over: Partial<SavedAddress> = {}): SavedAddress {
  return {
    id,
    label: `Address ${id}`,
    description: 'blue gate beside the pharmacy',
    nationalShortAddress: '',
    lat: 24.7136,
    lng: 46.6753,
    isDefault: false,
    ...over,
  };
}

const READY: AddressBookState = {
  status: 'ready',
  addresses: [addr('a1', { isDefault: true }), addr('a2')],
  error: null,
  pending: null,
};

describe('loading and listing', () => {
  it('load_start marks loading without clearing a list the customer can still use', () => {
    const s = applyAddressEvent(READY, { type: 'load_start' });
    expect(s.status).toBe('loading');
    expect(s.addresses).toHaveLength(2);
  });

  it('load_start clears a stale error', () => {
    const s = applyAddressEvent({ ...READY, error: 'boom' }, { type: 'load_start' });
    expect(s.error).toBeNull();
  });

  it('load_success replaces the list and settles to ready', () => {
    const s = applyAddressEvent(EMPTY_ADDRESS_BOOK, {
      type: 'load_success', addresses: [addr('x1'), addr('x2')],
    });
    expect(s.status).toBe('ready');
    expect(s.addresses.map((a) => a.id)).toEqual(['x1', 'x2']);
    expect(s.error).toBeNull();
  });

  it('load_success keeps the server ordering', () => {
    const s = applyAddressEvent(EMPTY_ADDRESS_BOOK, {
      type: 'load_success', addresses: [addr('c'), addr('a'), addr('b')],
    });
    expect(s.addresses.map((a) => a.id)).toEqual(['c', 'a', 'b']);
  });

  it('load_success collapses a server list carrying two defaults', () => {
    const s = applyAddressEvent(EMPTY_ADDRESS_BOOK, {
      type: 'load_success',
      addresses: [addr('a1', { isDefault: true }), addr('a2', { isDefault: true })],
    });
    expect(s.addresses.filter((a) => a.isDefault)).toHaveLength(1);
    expect(s.addresses.find((a) => a.isDefault)?.id).toBe('a1');
  });
});

describe('API failure and retry', () => {
  it('a failed refresh KEEPS the addresses already loaded', () => {
    const s = applyAddressEvent(READY, { type: 'load_failure', message: "We couldn't load your addresses" });
    expect(s.status).toBe('error');
    expect(s.addresses).toHaveLength(2);
    expect(s.error).toBe("We couldn't load your addresses");
  });

  it('a failed FIRST load leaves an empty list and an error to retry from', () => {
    const s = applyAddressEvent(
      applyAddressEvent(EMPTY_ADDRESS_BOOK, { type: 'load_start' }),
      { type: 'load_failure', message: 'offline' },
    );
    expect(s.status).toBe('error');
    expect(s.addresses).toEqual([]);
  });

  it('a retry after a failure recovers cleanly', () => {
    const failed = applyAddressEvent(READY, { type: 'load_failure', message: 'offline' });
    const retried = applyAddressEvent(failed, { type: 'load_start' });
    const done = applyAddressEvent(retried, { type: 'load_success', addresses: [addr('a1')] });
    expect(done.status).toBe('ready');
    expect(done.error).toBeNull();
    expect(done.addresses.map((a) => a.id)).toEqual(['a1']);
  });

  it('a failed mutation clears pending, keeps the list, and reports the message', () => {
    const busy = applyAddressEvent(READY, { type: 'mutation_start', id: 'a2' });
    expect(busy.pending).toBe('a2');

    const failed = applyAddressEvent(busy, { type: 'mutation_failure', message: 'in use' });
    expect(failed.pending).toBeNull();
    expect(failed.error).toBe('in use');
    expect(failed.addresses).toHaveLength(2);
  });

  it('a mutation that fails does not remove or alter any address', () => {
    const before = READY.addresses;
    const after = applyAddressEvent(
      applyAddressEvent(READY, { type: 'mutation_start', id: 'a1' }),
      { type: 'mutation_failure', message: 'nope' },
    );
    expect(after.addresses).toEqual(before);
  });

  it('error_cleared dismisses without touching anything else', () => {
    const withError = { ...READY, error: 'boom' };
    const cleared = applyAddressEvent(withError, { type: 'error_cleared' });
    expect(cleared.error).toBeNull();
    expect(cleared.addresses).toEqual(READY.addresses);
  });

  it('error_cleared is identity when there is no error', () => {
    expect(applyAddressEvent(READY, { type: 'error_cleared' })).toBe(READY);
  });
});

describe('adding', () => {
  it('appends a new address and clears pending', () => {
    const busy = applyAddressEvent(READY, { type: 'mutation_start', id: NEW_ADDRESS });
    const s = applyAddressEvent(busy, { type: 'upserted', address: addr('a3') });
    expect(s.addresses.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
    expect(s.pending).toBeNull();
    expect(s.status).toBe('ready');
  });

  it('a new DEFAULT demotes the previous one, mirroring the database trigger', () => {
    const s = applyAddressEvent(READY, { type: 'upserted', address: addr('a3', { isDefault: true }) });
    expect(s.addresses.filter((a) => a.isDefault).map((a) => a.id)).toEqual(['a3']);
  });

  it('the first address a customer saves becomes their default', () => {
    expect(shouldBecomeDefault([])).toBe(true);
    expect(shouldBecomeDefault([addr('a1')])).toBe(false);
  });
});

describe('editing', () => {
  it('replaces the edited address in place, preserving order', () => {
    const edited = addr('a1', { isDefault: true, description: 'white tower, entrance C' });
    const s = applyAddressEvent(READY, { type: 'upserted', address: edited });
    expect(s.addresses.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(s.addresses[0].description).toBe('white tower, entrance C');
  });

  it('promoting a2 demotes a1 — never two defaults on screen', () => {
    const s = applyAddressEvent(READY, { type: 'upserted', address: addr('a2', { isDefault: true }) });
    expect(s.addresses.filter((a) => a.isDefault).map((a) => a.id)).toEqual(['a2']);
  });

  it('editing a non-default address leaves the default alone', () => {
    const s = applyAddressEvent(READY, { type: 'upserted', address: addr('a2', { label: 'Work' }) });
    expect(s.addresses.find((a) => a.id === 'a1')?.isDefault).toBe(true);
    expect(s.addresses.find((a) => a.id === 'a2')?.label).toBe('Work');
  });
});

describe('deleting', () => {
  it('drops the address everywhere and clears pending', () => {
    const busy = applyAddressEvent(READY, { type: 'mutation_start', id: 'a2' });
    const s = applyAddressEvent(busy, { type: 'removed', id: 'a2' });
    expect(s.addresses.map((a) => a.id)).toEqual(['a1']);
    expect(s.pending).toBeNull();
  });

  it('deleting an unknown id is a no-op rather than an error', () => {
    const s = applyAddressEvent(READY, { type: 'removed', id: 'ghost' });
    expect(s.addresses).toHaveLength(2);
  });

  it('deleting the last address empties the book', () => {
    const one: AddressBookState = { ...READY, addresses: [addr('a1', { isDefault: true })] };
    expect(applyAddressEvent(one, { type: 'removed', id: 'a1' }).addresses).toEqual([]);
  });
});

describe('sign-out', () => {
  it('clears the book immediately so a shared phone never leaks a book', () => {
    expect(applyAddressEvent(READY, { type: 'signed_out' })).toEqual(EMPTY_ADDRESS_BOOK);
  });

  it('clears mid-write too', () => {
    const busy = applyAddressEvent(READY, { type: 'mutation_start', id: 'a1' });
    expect(applyAddressEvent(busy, { type: 'signed_out' })).toEqual(EMPTY_ADDRESS_BOOK);
  });
});

describe('preselectAddress — the rule Checkout and the order-type gate share', () => {
  const list = [addr('a1'), addr('a2', { isDefault: true }), addr('a3')];

  it('prefers the address carried in the order context', () => {
    expect(preselectAddress(list, 'a3')?.id).toBe('a3');
  });

  it('falls back to the default when the context names none', () => {
    expect(preselectAddress(list, null)?.id).toBe('a2');
  });

  it('falls back to the default when the context names a DELETED address', () => {
    expect(preselectAddress(list, 'gone')?.id).toBe('a2');
  });

  it('falls back to the first row when there is no default', () => {
    expect(preselectAddress([addr('a1'), addr('a2')], null)?.id).toBe('a1');
  });

  it('returns null for an empty book', () => {
    expect(preselectAddress([], 'a1')).toBeNull();
  });

  it('skips 0/0 rows so the pin never lands in the Atlantic', () => {
    const withNullIsland = [addr('bad', { lat: 0, lng: 0, isDefault: true }), addr('good')];
    expect(preselectAddress(withNullIsland, null)?.id).toBe('good');
  });

  it('skips a preferred address whose coordinates are unusable', () => {
    const list2 = [addr('bad', { lat: Number.NaN, lng: 0 }), addr('good')];
    expect(preselectAddress(list2, 'bad')?.id).toBe('good');
  });
});

describe('contextNeedsReset', () => {
  it('is true when the changed address is the one being ordered to', () => {
    expect(contextNeedsReset({ orderType: 'delivery', addressId: 'a1' }, 'a1')).toBe(true);
  });

  it('is false for a different address', () => {
    expect(contextNeedsReset({ orderType: 'delivery', addressId: 'a1' }, 'a2')).toBe(false);
  });

  it('is false for a pickup context, which carries no address', () => {
    expect(contextNeedsReset({ orderType: 'pickup', addressId: null }, 'a1')).toBe(false);
  });

  it('is false when there is no context at all', () => {
    expect(contextNeedsReset(null, 'a1')).toBe(false);
    expect(contextNeedsReset(undefined, 'a1')).toBe(false);
  });

  it('is false for a delivery context with no address id', () => {
    expect(contextNeedsReset({ orderType: 'delivery', addressId: null }, 'a1')).toBe(false);
  });
});

describe('findAddress', () => {
  it('finds a saved address by id', () => {
    expect(findAddress(READY.addresses, 'a2')?.id).toBe('a2');
  });

  it('returns null for the create sentinel', () => {
    expect(findAddress(READY.addresses, NEW_ADDRESS)).toBeNull();
  });

  it('returns null for an unknown or missing id', () => {
    expect(findAddress(READY.addresses, 'ghost')).toBeNull();
    expect(findAddress(READY.addresses, null)).toBeNull();
    expect(findAddress(READY.addresses, undefined)).toBeNull();
  });
});
