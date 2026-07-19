import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { AlertTriangle, LocateFixed, MapPin } from 'lucide-react';
import { Branch, DeliveryZone } from '../../types';
import { ensureRtlTextPlugin, mapConfig } from '../../lib/map';
import { geometryToPolygons, loadGoogleMaps, locateMe, polygonsToGeometry, type LngLat } from '../../lib/googleMaps';
import type { GeoJSONGeometry } from '../../lib/geo';
import { MapSearchBox } from '../MapSearchBox';

interface DeliveryZoneModalProps {
  branch: Branch;
  existingZone?: DeliveryZone;
  disabled: boolean;            // accountant = view-only
  isRTL: boolean;
  onClose: () => void;
  onSave: (branchId: string, geojson: GeoJSONGeometry) => Promise<void>;
  onClear: (branchId: string) => Promise<void>;
}

const ZONE_STYLE = { fillColor: '#7c3aed', fillOpacity: 0.12, strokeColor: '#7c3aed', strokeWeight: 2 };

// @types/google.maps ships the drawing library as an empty class (legacy-lib
// sparse typing) — the runtime API below is documented and stable, so model
// just the members we use.
interface GDrawingManager {
  setMap(map: google.maps.Map | null): void;
  setDrawingMode(mode: string | null): void;
}
interface GOverlayCompleteEvent {
  type: string;
  overlay?: { setMap(map: google.maps.Map | null): void };
}

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
  const gDrawRef = useRef<GDrawingManager | null>(null);
  const gPolysRef = useRef<google.maps.Polygon[]>([]);
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
    loadGoogleMaps(isRTL, ['drawing']).then(() => {
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

      const DrawingManagerCtor = g.drawing.DrawingManager as unknown as new (opts: object) => GDrawingManager;
      const draw = new DrawingManagerCtor({
        map,
        drawingControl: false, // our own buttons drive the modes
        polygonOptions: { ...ZONE_STYLE, editable: false },
      });
      gDrawRef.current = draw;
      g.event.addListener(draw as unknown as object, 'overlaycomplete', (e: GOverlayCompleteEvent) => {
        if (e.type === g.drawing.OverlayType.POLYGON) {
          gPolysRef.current.push(e.overlay as unknown as google.maps.Polygon);
          draw.setDrawingMode(null); // one shape per gesture, like the Mapbox editor
        } else {
          e.overlay?.setMap(null);
        }
      });
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
      gDrawRef.current?.setMap(null);
      gDrawRef.current = null;
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
        new mapboxgl.Marker({ color: '#7c3aed' })
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

  const startDraw = () => {
    if (isGoogle) gDrawRef.current?.setDrawingMode(window.google!.maps.drawing.OverlayType.POLYGON);
    else drawRef.current?.changeMode('draw_polygon');
  };
  const startEdit = () => {
    if (isGoogle) gPolysRef.current.forEach(p => p.setEditable(true));
    else drawRef.current?.changeMode('simple_select');
  };
  const clearDrawing = () => {
    if (isGoogle) {
      gPolysRef.current.forEach(p => p.setMap(null));
      gPolysRef.current = [];
      gDrawRef.current?.setDrawingMode(null);
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
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-50 flex items-center justify-center p-4" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
      <div className="glass-panel w-full max-w-2xl overflow-hidden rounded-[1.5rem] shadow-2xl animate-scale-up">
        <div className="p-4 bg-white/20 border-b border-white/10 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            <div>
              <h4 className="text-[10px] font-black text-gray-500 uppercase">{isRTL ? 'منطقة التوصيل' : 'Delivery Area'}</h4>
              <p className="text-sm font-extrabold text-primary">{isRTL ? branch.nameAr : branch.nameEn}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-white border border-gray-200 flex items-center justify-center font-bold text-gray-400 hover:bg-gray-100" aria-label={isRTL ? 'إغلاق' : 'Close'}>✕</button>
        </div>

        {!mapConfig.isConfigured ? (
          <div className="p-8 text-center space-y-2">
            <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
            <p className="text-sm font-black text-slate-700">{isRTL ? 'إعداد الخريطة مطلوب' : 'Map setup required'}</p>
            <p className="text-[11px] text-slate-500 font-bold max-w-sm mx-auto">
              {isGoogle
                ? (isRTL
                  ? 'أضف مفتاح Google Maps ‏(VITE_GOOGLE_MAPS_API_KEY) لتفعيل رسم مناطق التوصيل.'
                  : 'Set VITE_GOOGLE_MAPS_API_KEY to enable delivery-area drawing. The rest of the dashboard is unaffected.')
                : (isRTL
                  ? 'أضف رمز Mapbox العام (VITE_MAPBOX_PUBLIC_TOKEN) لتفعيل رسم مناطق التوصيل.'
                  : 'Set VITE_MAPBOX_PUBLIC_TOKEN to enable delivery-area drawing. The rest of the dashboard is unaffected.')}
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {!hasBranchCoords && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[11px] font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                {isRTL ? 'حدّد موقع الفرع قبل رسم منطقة التوصيل.' : 'Set branch location before drawing delivery area.'}
              </div>
            )}

            <MapSearchBox isRTL={isRTL} onSelect={flyTo} />
            <div className="relative">
              <div ref={mapContainer} className="w-full h-[360px] rounded-xl overflow-hidden border border-slate-200" />
              <button
                type="button"
                onClick={() => void handleLocate()}
                disabled={locating || !ready}
                title={isRTL ? 'موقعي' : 'My location'}
                aria-label={isRTL ? 'موقعي' : 'My location'}
                className="absolute bottom-3 end-3 z-10 w-9 h-9 rounded-full bg-white shadow-md border border-slate-200 flex items-center justify-center text-primary hover:bg-slate-50 disabled:opacity-40"
              >
                <LocateFixed className={locating ? 'w-4 h-4 animate-pulse' : 'w-4 h-4'} />
              </button>
            </div>

            {error && (
              <div className="p-2.5 bg-red-50 border border-red-100 rounded-xl text-red-800 text-[11px] font-bold">{error}</div>
            )}

            {!disabled && (
              <div className="flex flex-wrap gap-2 justify-end">
                <button onClick={startDraw} disabled={busy || !ready} className="text-[11px] font-black py-2 px-3 rounded-xl bg-primary/10 text-primary border border-primary/20 disabled:opacity-40">{isRTL ? 'ارسم منطقة التوصيل' : 'Draw delivery area'}</button>
                <button onClick={startEdit} disabled={busy || !ready} className="text-[11px] font-black py-2 px-3 rounded-xl bg-white/60 text-slate-700 border border-slate-200 disabled:opacity-40">{isRTL ? 'تعديل منطقة التوصيل' : 'Edit delivery area'}</button>
                <button onClick={handleClear} disabled={busy || !ready} className="text-[11px] font-black py-2 px-3 rounded-xl bg-red-50 text-red-600 border border-red-200 disabled:opacity-40">{isRTL ? 'مسح منطقة التوصيل' : 'Clear delivery area'}</button>
                <button onClick={handleSave} disabled={busy || !ready} className="text-[11px] font-black py-2 px-4 rounded-xl bg-primary text-white disabled:opacity-40">{busy ? (isRTL ? 'جارٍ الحفظ…' : 'Saving…') : (isRTL ? 'حفظ منطقة التوصيل' : 'Save delivery area')}</button>
              </div>
            )}
            {disabled && (
              <p className="text-[10px] text-slate-400 font-bold text-center">{isRTL ? 'العرض فقط' : 'View only'}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
