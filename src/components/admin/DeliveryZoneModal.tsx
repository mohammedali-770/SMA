import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { AlertTriangle, MapPin } from 'lucide-react';
import { Branch, DeliveryZone } from '../../types';
import { mapConfig } from '../../lib/map';
import type { GeoJSONGeometry } from '../../lib/geo';

interface DeliveryZoneModalProps {
  branch: Branch;
  existingZone?: DeliveryZone;
  disabled: boolean;            // accountant = view-only
  isRTL: boolean;
  onClose: () => void;
  onSave: (branchId: string, geojson: GeoJSONGeometry) => Promise<void>;
  onClear: (branchId: string) => Promise<void>;
}

/**
 * Admin delivery-zone drawing. Renders a Mapbox map centered on the branch with
 * mapbox-gl-draw polygon tools. Save extracts a single GeoJSON Geometry (Polygon
 * or MultiPolygon) and calls the admin RPC (which re-validates server-side).
 * Falls back to a clear "map setup required" message when the token is absent.
 */
export const DeliveryZoneModal: React.FC<DeliveryZoneModalProps> = ({
  branch, existingZone, disabled, isRTL, onClose, onSave, onClear,
}) => {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const hasBranchCoords = Number.isFinite(branch.latitude) && Number.isFinite(branch.longitude)
    && !(branch.latitude === 0 && branch.longitude === 0);

  useEffect(() => {
    if (!mapConfig.isConfigured || !mapContainer.current) return;
    mapboxgl.accessToken = mapConfig.publicToken;

    const center: [number, number] = hasBranchCoords
      ? [branch.longitude, branch.latitude]
      : [mapConfig.defaultCenter.lng, mapConfig.defaultCenter.lat];

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: mapConfig.styleUrl,
      center,
      zoom: hasBranchCoords ? 12 : mapConfig.defaultZoom,
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

  const startDraw = () => { drawRef.current?.changeMode('draw_polygon'); };
  const startEdit = () => { drawRef.current?.changeMode('simple_select'); };
  const clearDrawing = () => { drawRef.current?.deleteAll(); };

  const collectGeometry = (): GeoJSONGeometry | null => {
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
              {isRTL
                ? 'أضف رمز Mapbox العام (VITE_MAPBOX_PUBLIC_TOKEN) لتفعيل رسم مناطق التوصيل.'
                : 'Set VITE_MAPBOX_PUBLIC_TOKEN to enable delivery-area drawing. The rest of the dashboard is unaffected.'}
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

            <div ref={mapContainer} className="w-full h-[360px] rounded-xl overflow-hidden border border-slate-200" />

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
