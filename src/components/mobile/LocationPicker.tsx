import React, { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { MapPin } from 'lucide-react';
import { mapConfig } from '../../lib/map';
import { MapSearchBox } from '../MapSearchBox';

interface LocationPickerProps {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  isRTL: boolean;
}

/**
 * Customer delivery-location picker (web): a Mapbox map with a draggable pin.
 * Drag the marker or tap the map to set coordinates. When the map token is
 * absent it renders a setup hint and the caller's manual lat/lng inputs remain
 * the fallback — delivery still requires coordinates, validated server-side.
 */
export const LocationPicker: React.FC<LocationPickerProps> = ({ lat, lng, onChange, isRTL }) => {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  useEffect(() => {
    if (!mapConfig.isConfigured || !container.current) return;
    mapboxgl.accessToken = mapConfig.publicToken;
    // Treat (0,0) and non-finite coords as "no location yet": centre on the
    // default (Riyadh) at city zoom so the admin gets a clear, recognisable map
    // to click on — NOT the middle of the ocean at Null Island (0,0), which
    // renders as a featureless zoomed-out globe.
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
    const start: [number, number] = hasCoords
      ? [lng, lat]
      : [mapConfig.defaultCenter.lng, mapConfig.defaultCenter.lat];
    const map = new mapboxgl.Map({
      container: container.current,
      style: mapConfig.styleUrl,
      center: start,
      zoom: hasCoords ? 14 : mapConfig.defaultZoom,
      // Flat mercator, not the globe — a small picker reads far clearer as a
      // traditional street map than as a sphere in space.
      projection: 'mercator',
    });
    mapRef.current = map;

    // This picker is lazy/Suspense-mounted inside a modal, so the container can
    // still be settling its size when the map initialises. Without a resize the
    // GL canvas keeps the wrong dimensions and tiles never paint (controls show
    // over a blank map). A ResizeObserver corrects it once layout settles and on
    // any later container size change.
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(container.current);

    const marker = new mapboxgl.Marker({ color: '#7c3aed', draggable: true }).setLngLat(start).addTo(map);
    markerRef.current = marker;
    marker.on('dragend', () => {
      const { lng: mlng, lat: mlat } = marker.getLngLat();
      onChange(Number(mlat.toFixed(6)), Number(mlng.toFixed(6)));
    });
    map.on('click', (e) => {
      marker.setLngLat(e.lngLat);
      onChange(Number(e.lngLat.lat.toFixed(6)), Number(e.lngLat.lng.toFixed(6)));
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-left');

    return () => { ro.disconnect(); map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the marker in sync when the parent updates coords (e.g. manual inputs).
  useEffect(() => {
    if (markerRef.current && Number.isFinite(lat) && Number.isFinite(lng)) {
      markerRef.current.setLngLat([lng, lat]);
    }
  }, [lat, lng]);

  // Address search picked a place → drop the pin there, fly to it, set coords.
  const goToSearchResult = (rlng: number, rlat: number) => {
    onChange(Number(rlat.toFixed(6)), Number(rlng.toFixed(6)));
    markerRef.current?.setLngLat([rlng, rlat]);
    mapRef.current?.flyTo({ center: [rlng, rlat], zoom: 15, duration: 800 });
  };

  if (!mapConfig.isConfigured) {
    return (
      <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-[10px] font-bold text-amber-800 flex items-center gap-2">
        <MapPin className="w-4 h-4 flex-shrink-0" />
        {isRTL ? 'إعداد الخريطة مطلوب — أدخل الإحداثيات يدوياً أدناه.' : 'Map setup required — enter coordinates manually below.'}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <MapSearchBox isRTL={isRTL} onSelect={goToSearchResult} />
      <div ref={container} className="w-full h-56 rounded-lg overflow-hidden border border-gray-200" />
      <p className="text-[9px] text-gray-400 font-bold">
        {isRTL ? 'ابحث عن العنوان أعلاه، أو حرّك الدبوس إلى موقعك بالضبط.' : 'Search the address above, or move the pin to your exact location.'}
      </p>
    </div>
  );
};
