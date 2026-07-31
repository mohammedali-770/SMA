import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { AlertTriangle, LocateFixed } from 'lucide-react';

import { Button } from '../../design-system/ui/Button';
import { Notice } from '../../design-system/ui/Notice';
import { Text } from '../../design-system/ui/Text';
import { Branch, DeliveryZone } from '../../types';
import { ensureRtlTextPlugin, mapConfig } from '../../lib/map';
import { circleRing, geometryToPolygons, loadGoogleMaps, locateMe, polygonsToGeometry, type LngLat } from '../../lib/googleMaps';
import type { GeoJSONGeometry } from '../../lib/geo';
import { MapSearchBox } from '../MapSearchBox';
import { AdminModal } from './view/shared/AdminModal';

interface DeliveryZoneModalProps {
  branch: Branch;
  existingZone?: DeliveryZone;
  disabled: boolean;            // accountant = view-only
  isRTL: boolean;
  onClose: () => void;
  onSave: (branchId: string, geojson: GeoJSONGeometry) => Promise<void>;
  onClear: (branchId: string) => Promise<void>;
}

// Ember. The literal mirrors `--color-ember` because a map SDK draws to its own
// canvas and cannot read a CSS custom property; if that token moves, move this.
const ZONE_COLOR = '#E02D3D';
const ZONE_STYLE = { fillColor: ZONE_COLOR, fillOpacity: 0.12, strokeColor: ZONE_COLOR, strokeWeight: 2 };

// "Draw" seeds a ready-made circular zone (editable + draggable) instead of
// point-by-point clicking — Google removed DrawingManager in v3.65, and the
// seeded-shape pattern is the easier UX anyway: drag the handles to fit,
// drag between handles to add detail, drag the shape to move it.

/**
 * Admin delivery-zone drawing. Provider-switched (lib/map.ts): Google Maps JS
 * (DrawingManager) or Mapbox (mapbox-gl-draw). Either way, Save extracts one
 * GeoJSON Geometry (Polygon or MultiPolygon) and calls the admin RPC (which
 * re-validates server-side). Falls back to a clear "map setup required"
 * message when the provider has no key/token.
 */
export const DeliveryZoneModal: React.FC<DeliveryZoneModalProps> = ({
  branch, existingZone, disabled, isRTL, onClose, onSave, onClear,
}) => {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const gMapRef = useRef<google.maps.Map | null>(null);
  const gPolysRef = useRef<google.maps.Polygon[]>([]);
  const [gAdjusting, setGAdjusting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const hasBranchCoords = Number.isFinite(branch.latitude) && Number.isFinite(branch.longitude)
    && !(branch.latitude === 0 && branch.longitude === 0);
  const center = hasBranchCoords
    ? { lng: branch.longitude, lat: branch.latitude }
    : mapConfig.defaultCenter;
  const initialZoom = hasBranchCoords ? 12 : mapConfig.defaultZoom;

  // ---- Google provider --------------------------------------------------
  useEffect(() => {
    if (mapConfig.provider !== 'google' || !mapConfig.isConfigured || !mapContainer.current) return;
    let cancelled = false;
    loadGoogleMaps(isRTL).then(() => {
      if (cancelled || !mapContainer.current) return;
      try {
      const g = window.google!.maps;
      const map = new g.Map(mapContainer.current, {
        center, zoom: initialZoom,
        clickableIcons: false, streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
      });
      gMapRef.current = map;

      if (hasBranchCoords) {
        const marker = new g.Marker({ position: center, map, title: isRTL ? branch.nameAr : branch.nameEn });
        const info = new g.InfoWindow({ content: isRTL ? branch.nameAr : branch.nameEn });
        marker.addListener('click', () => info.open({ map, anchor: marker }));
      }

      // Preload the saved zone so the admin previews/edits it.
      if (existingZone?.geojson) {
        try {
          const bounds = new g.LatLngBounds();
          for (const rings of geometryToPolygons(existingZone.geojson)) {
            const poly = new g.Polygon({
              ...ZONE_STYLE, map,
              paths: rings.map(ring => ring.map(([lng, lat]) => ({ lng, lat }))),
            });
            gPolysRef.current.push(poly);
            rings.forEach(ring => ring.forEach(([lng, lat]) => bounds.extend({ lng, lat })));
          }
          if (!bounds.isEmpty()) map.fitBounds(bounds, 40);
        } catch { /* ignore malformed preload */ }
      }

      setReady(true);
      } catch (e) {
        // The map may already be on screen — report init failure accurately
        // instead of claiming the whole API failed to load.
        console.error('google map init failed', e);
        setError(isRTL ? 'تعذّرت تهيئة الخريطة.' : 'Map initialization failed.');
      }
    }).catch(() => setError(isRTL ? 'تعذّر تحميل خرائط Google.' : 'Google Maps failed to load.'));
    return () => {
      cancelled = true;
      gPolysRef.current.forEach(p => p.setMap(null));
      gPolysRef.current = [];
      gMapRef.current = null; // the Maps API has no destroy(); dropping refs releases the container
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Mapbox provider (fallback) ---------------------------------------
  useEffect(() => {
    if (mapConfig.provider !== 'mapbox' || !mapConfig.isConfigured || !mapContainer.current) return;
    mapboxgl.accessToken = mapConfig.publicToken;
    ensureRtlTextPlugin(mapboxgl); // Arabic label shaping (idempotent)

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: mapConfig.styleUrl,
      center: [center.lng, center.lat],
      zoom: initialZoom,
      projection: 'mercator', // flat street map, not the globe — clearer for drawing zones
    });
    mapRef.current = map;

    // The modal animates in (scale-up), so the container may not be at its final
    // size when the map initialises. Without a resize the GL canvas keeps the
    // wrong dimensions and tiles never paint (controls show over a blank map). A
    // ResizeObserver corrects it once layout settles and on any later change.
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(mapContainer.current);

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: disabled ? {} : { polygon: true, trash: true },
    });
    drawRef.current = draw;
    map.addControl(draw as unknown as mapboxgl.IControl);
    map.addControl(new mapboxgl.NavigationControl(), 'top-left');

    map.on('load', () => {
      if (hasBranchCoords) {
        new mapboxgl.Marker({ color: ZONE_COLOR })
          .setLngLat([branch.longitude, branch.latitude])
          .setPopup(new mapboxgl.Popup().setText(isRTL ? branch.nameAr : branch.nameEn))
          .addTo(map);
      }
      // Preload the existing zone so the admin edits/previews it.
      if (existingZone?.geojson) {
        try {
          draw.add({ type: 'Feature', properties: {}, geometry: existingZone.geojson } as GeoJSON.Feature);
          const b = new mapboxgl.LngLatBounds();
          const addRing = (ring: number[][]) => ring.forEach(([lng, lat]) => b.extend([lng, lat]));
          if (existingZone.geojson.type === 'Polygon') existingZone.geojson.coordinates.forEach(addRing);
          else existingZone.geojson.coordinates.forEach(poly => poly.forEach(addRing));
          if (!b.isEmpty()) map.fitBounds(b, { padding: 40, maxZoom: 14, duration: 0 });
        } catch { /* ignore malformed preload */ }
      }
      setReady(true);
    });

    return () => { ro.disconnect(); map.remove(); mapRef.current = null; drawRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isGoogle = mapConfig.provider === 'google';

  /**
   * Seed a ready-made circular zone at the current view center, immediately
   * editable + draggable — the admin stretches it into shape instead of
   * clicking vertex by vertex. Sized to ~1/5 of the visible map so it always
   * appears at a comfortable, grabbable size.
   */
  const seedGZone = () => {
    const map = gMapRef.current;
    if (!map) return;
    const g = window.google!.maps;
    const c = map.getCenter()?.toJSON() ?? center;
    let radius = 2000;
    const b = map.getBounds();
    if (b) {
      const latSpanMeters = (b.getNorthEast().lat() - b.getSouthWest().lat()) * 111_320;
      radius = Math.max(300, Math.min(8000, latSpanMeters / 5));
    }
    const ring = circleRing(c, radius, 16);
    gPolysRef.current.push(new g.Polygon({
      ...ZONE_STYLE, map,
      paths: ring.map(([lng, lat]) => ({ lng, lat })),
      editable: true, draggable: true,
    }));
    setGAdjusting(true);
  };

  const startDraw = () => {
    if (isGoogle) seedGZone();
    else drawRef.current?.changeMode('draw_polygon');
  };
  const startEdit = () => {
    if (isGoogle) {
      gPolysRef.current.forEach(p => { p.setEditable(true); p.setDraggable(true); });
      if (gPolysRef.current.length > 0) setGAdjusting(true);
    } else {
      drawRef.current?.changeMode('simple_select');
    }
  };
  const clearDrawing = () => {
    if (isGoogle) {
      gPolysRef.current.forEach(p => p.setMap(null));
      gPolysRef.current = [];
      setGAdjusting(false);
    } else {
      drawRef.current?.deleteAll();
    }
  };
  const [locating, setLocating] = useState(false);
  const handleLocate = async () => {
    setLocating(true);
    try {
      const { lat, lng } = await locateMe();
      flyTo(lng, lat);
    } catch {
      setError(isRTL ? 'تعذّر تحديد موقعك — تأكد من السماح بالوصول إلى الموقع.' : 'Could not get your location — make sure location access is allowed.');
    } finally {
      setLocating(false);
    }
  };

  const flyTo = (lng: number, lat: number) => {
    if (isGoogle) { gMapRef.current?.panTo({ lng, lat }); gMapRef.current?.setZoom(13); }
    else mapRef.current?.flyTo({ center: [lng, lat], zoom: 13, duration: 800 });
  };

  const collectGeometry = (): GeoJSONGeometry | null => {
    if (isGoogle) {
      const polygons: LngLat[][][] = gPolysRef.current.map(p =>
        p.getPaths().getArray().map(path =>
          path.getArray().map(pt => [pt.lng(), pt.lat()] as LngLat)));
      return polygonsToGeometry(polygons) as GeoJSONGeometry | null;
    }
    const draw = drawRef.current;
    if (!draw) return null;
    const polys = draw.getAll().features.filter(f => f.geometry?.type === 'Polygon');
    if (polys.length === 0) return null;
    if (polys.length === 1) return polys[0].geometry as GeoJSONGeometry;
    return {
      type: 'MultiPolygon',
      coordinates: polys.map(p => (p.geometry as GeoJSON.Polygon).coordinates),
    };
  };

  const handleSave = async () => {
    setError(null);
    const geometry = collectGeometry();
    if (!geometry) { setError(isRTL ? 'ارسم منطقة التوصيل أولاً.' : 'Draw a delivery area first.'); return; }
    setBusy(true);
    try {
      await onSave(branch.id, geometry);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : (isRTL ? 'منطقة التوصيل غير صالحة.' : 'Delivery area polygon is invalid.'));
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setError(null);
    clearDrawing();
    if (!existingZone) return; // nothing saved to remove
    setBusy(true);
    try {
      await onClear(branch.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminModal
      title={isRTL ? 'منطقة التوصيل' : 'Delivery Area'}
      subtitle={isRTL ? branch.nameAr : branch.nameEn}
      isRTL={isRTL}
      onClose={onClose}
      size="xl"
      footer={
        disabled ? (
          <Text variant="caption" tone="tertiary" as="p">{isRTL ? 'العرض فقط' : 'View only'}</Text>
        ) : mapConfig.isConfigured ? (
          <>
            <Button
              label={isRTL ? 'ارسم منطقة التوصيل' : 'Draw delivery area'}
              onClick={startDraw}
              disabled={busy || !ready}
              variant="secondary"
            />
            <Button
              label={isRTL ? 'تعديل منطقة التوصيل' : 'Edit delivery area'}
              onClick={startEdit}
              disabled={busy || !ready}
              variant="ghost"
            />
            <Button
              label={isRTL ? 'مسح منطقة التوصيل' : 'Clear delivery area'}
              onClick={() => { void handleClear(); }}
              disabled={busy || !ready}
              variant="danger"
            />
            <Button
              label={busy ? (isRTL ? 'جارٍ الحفظ…' : 'Saving…') : (isRTL ? 'حفظ منطقة التوصيل' : 'Save delivery area')}
              onClick={() => { void handleSave(); }}
              disabled={busy || !ready}
              loading={busy}
            />
          </>
        ) : null
      }
    >
      {!mapConfig.isConfigured ? (
        <div className="space-y-2 py-8 text-center">
          <AlertTriangle className="mx-auto size-8 text-amber-ink" aria-hidden="true" />
          <Text variant="heading" as="p">{isRTL ? 'إعداد الخريطة مطلوب' : 'Map setup required'}</Text>
          <Text variant="body" tone="secondary" as="p" className="mx-auto max-w-sm">
            {isGoogle
              ? (isRTL
                ? 'أضف مفتاح Google Maps ‏(VITE_GOOGLE_MAPS_API_KEY) لتفعيل رسم مناطق التوصيل.'
                : 'Set VITE_GOOGLE_MAPS_API_KEY to enable delivery-area drawing. The rest of the dashboard is unaffected.')
              : (isRTL
                ? 'أضف رمز Mapbox العام (VITE_MAPBOX_PUBLIC_TOKEN) لتفعيل رسم مناطق التوصيل.'
                : 'Set VITE_MAPBOX_PUBLIC_TOKEN to enable delivery-area drawing. The rest of the dashboard is unaffected.')}
          </Text>
        </div>
      ) : (
        <>
          {!hasBranchCoords && (
            <Notice
              title={isRTL ? 'حدّد موقع الفرع قبل رسم منطقة التوصيل.' : 'Set branch location before drawing delivery area.'}
              tone="warning"
            />
          )}

          <MapSearchBox isRTL={isRTL} onSelect={flyTo} />

          <div className="relative">
            <div ref={mapContainer} className="h-[360px] w-full overflow-hidden rounded-[var(--radius-ds-md)] border border-con-line" />
            <button
              type="button"
              onClick={() => void handleLocate()}
              disabled={locating || !ready}
              title={isRTL ? 'موقعي' : 'My location'}
              aria-label={isRTL ? 'موقعي' : 'My location'}
              className="ds-motion absolute bottom-3 end-3 z-10 inline-flex size-9 items-center justify-center rounded-full border border-con-line bg-con-surface transition-colors duration-150 hover:bg-con-surface-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <LocateFixed className={`size-4 text-ember ${locating ? 'animate-pulse' : ''}`} aria-hidden="true" />
            </button>
          </div>

          {gAdjusting && (
            <div className="rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface-2 p-2 text-center">
              <Text variant="caption" tone="secondary" as="p">
                {isRTL
                  ? 'اسحب النقاط لتشكيل منطقة التوصيل، واسحب بين النقاط لإضافة نقطة، واسحب الشكل لنقله — ثم احفظ.'
                  : 'Drag the points to shape the area, drag between points to add one, drag the shape to move it — then Save.'}
              </Text>
            </div>
          )}

          {error && <Notice title={error} tone="blocking" />}
        </>
      )}
    </AdminModal>
  );
};
