// @vitest-environment jsdom
/**
 * Delivery-zone Save and Clear change the LIVE zone at once: Clear makes
 * place_order refuse every delivery order for the branch, and Save replaces the
 * area with nothing kept of the old one (audit F-WAD-02-002). Both ask first,
 * naming the branch and the effect, and a decline writes nothing and leaves the
 * drawing alone.
 *
 * The map SDKs are replaced with inert stubs; only the confirmation wiring is
 * under test.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Branch, DeliveryZone } from '../../types';

const draw = vi.hoisted(() => ({
  deleteAll: vi.fn(),
  getAll: vi.fn(() => ({
    features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }],
  })),
}));

vi.mock('mapbox-gl', () => {
  class Map {
    on(event: string, cb: () => void) { if (event === 'load') cb(); }
    addControl() {}
    resize() {}
    remove() {}
    flyTo() {}
    fitBounds() {}
  }
  class NavigationControl {}
  class Marker { setLngLat() { return this; } setPopup() { return this; } addTo() { return this; } }
  class Popup { setText() { return this; } }
  class LngLatBounds { extend() {} isEmpty() { return true; } }
  return { default: { Map, NavigationControl, Marker, Popup, LngLatBounds, accessToken: '' } };
});
vi.mock('@mapbox/mapbox-gl-draw', () => ({
  default: class {
    add() {}
    changeMode() {}
    deleteAll() { draw.deleteAll(); }
    getAll() { return draw.getAll(); }
  },
}));
vi.mock('mapbox-gl/dist/mapbox-gl.css', () => ({}));
vi.mock('@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css', () => ({}));
vi.mock('../../lib/map', () => ({
  ensureRtlTextPlugin: () => {},
  mapConfig: {
    provider: 'mapbox', isConfigured: true, publicToken: 't', styleUrl: 's',
    defaultCenter: { lng: 46.7, lat: 24.7 }, defaultZoom: 10,
  },
}));
vi.mock('../../lib/googleMaps', () => ({
  circleRing: () => [], geometryToPolygons: () => [], loadGoogleMaps: async () => {},
  locateMe: async () => ({ lat: 0, lng: 0 }), polygonsToGeometry: () => null,
}));
vi.mock('../MapSearchBox', () => ({ MapSearchBox: () => null }));

import { DeliveryZoneModal } from './DeliveryZoneModal';

const branch = {
  id: 'b1', nameEn: 'Olaya', nameAr: 'العليا', addressEn: '', addressAr: '', phone: '',
  latitude: 24.7, longitude: 46.6, isActive: true, deliveryFee: 0, minDeliveryOrder: 0,
} as Branch;
const zone = { id: 'z1', branchId: 'b1', isActive: true, geojson: { type: 'Polygon', coordinates: [] } } as unknown as DeliveryZone;

const onSave = vi.fn(async (_branchId: string, _geometry: unknown) => {});
const onClear = vi.fn(async (_branchId: string) => {});
const onClose = vi.fn();

function open(isRTL = false, withZone = true) {
  render(
    <DeliveryZoneModal
      branch={branch} existingZone={withZone ? zone : undefined} disabled={false} isRTL={isRTL}
      onClose={onClose} onSave={onSave} onClear={onClear}
    />,
  );
}
const button = async (name: RegExp) => {
  const b = (await screen.findByRole('button', { name })) as HTMLButtonElement;
  await waitFor(() => expect(b.disabled).toBe(false));
  return b;
};

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} disconnect() {} };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Clear delivery area', () => {
  it('asks first, says delivery orders are refused, and a decline clears nothing', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    open();
    fireEvent.click(await button(/Clear delivery area/));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(String(confirm.mock.calls[0][0])).toMatch(/Clear the delivery area for “Olaya”\? Every delivery order for this branch is refused/);
    expect(onClear).not.toHaveBeenCalled();
    // Declining must not wipe what is drawn on the map either.
    expect(draw.deleteAll).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clears and closes once the admin accepts', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    open();
    fireEvent.click(await button(/Clear delivery area/));
    await waitFor(() => expect(onClear).toHaveBeenCalledWith('b1'));
    expect(draw.deleteAll).toHaveBeenCalled();
  });

  it('asks in Arabic when the console is Arabic', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    open(true);
    fireEvent.click(await button(/مسح منطقة التوصيل/));
    expect(String(confirm.mock.calls[0][0])).toMatch(/مسح منطقة التوصيل لفرع «العليا»/);
  });
});

describe('Save delivery area', () => {
  it('asks first, says the old area is replaced, and a decline saves nothing', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    open();
    fireEvent.click(await button(/Save delivery area/));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(String(confirm.mock.calls[0][0])).toMatch(/Replace the live delivery area for “Olaya”/);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('saves the drawn geometry once the admin accepts', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    open();
    fireEvent.click(await button(/Save delivery area/));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toBe('b1');
  });

  it('a first-ever area is described as setting one, not replacing one', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    open(false, false);
    fireEvent.click(await button(/Save delivery area/));
    expect(String(confirm.mock.calls[0][0])).toMatch(/Save the delivery area for “Olaya”/);
  });

  it('does not ask when there is nothing drawn: the existing "Draw a delivery area first" error stands', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    draw.getAll.mockReturnValueOnce({ features: [] });
    open();
    fireEvent.click(await button(/Save delivery area/));
    expect(await screen.findByText(/Draw a delivery area first/)).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
