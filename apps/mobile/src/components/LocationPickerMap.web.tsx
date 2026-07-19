/**
 * Web build of the delivery-location picker: renders Google Maps JS directly
 * in the page (no WebView needed in a real browser) with the same props
 * contract as the native component — draggable pin, tap-to-set, "use my
 * location" via browser geolocation. Arabic labels are shaped natively by
 * Google. When the google provider/key is absent it shows the same setup
 * hint as native, and manual coordinate entry in the caller keeps working.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mapConfig } from '../lib/map';
import { colors, font, radius, spacing } from '../theme';

interface LocationPickerMapProps {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  labels: { moveHint: string; useMyLocation: string; setupRequired: string };
}

declare global {
  // eslint-disable-next-line no-var
  var __smaGmapsReady: Promise<void> | undefined;
}

function loadGoogleMapsWeb(key: string): Promise<void> {
  const w = globalThis as typeof globalThis & { google?: { maps?: unknown } };
  if (w.google?.maps) return Promise.resolve();
  if (globalThis.__smaGmapsReady) return globalThis.__smaGmapsReady;
  globalThis.__smaGmapsReady = new Promise<void>((resolve, reject) => {
    const cbName = '__smaGmapsOnReady';
    (globalThis as unknown as Record<string, unknown>)[cbName] = () => resolve();
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=${cbName}`;
    s.async = true;
    s.onerror = () => { globalThis.__smaGmapsReady = undefined; reject(new Error('gmaps load failed')); };
    document.head.appendChild(s);
  });
  return globalThis.__smaGmapsReady;
}

export const LocationPickerMap: React.FC<LocationPickerMapProps> = ({ lat, lng, onChange, labels }) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  const [locating, setLocating] = useState(false);
  const [failed, setFailed] = useState(false);

  const configured = mapConfig.provider === 'google' && Boolean(mapConfig.googleKey);

  useEffect(() => {
    if (!configured || !hostRef.current) return;
    let cancelled = false;
    loadGoogleMapsWeb(mapConfig.googleKey).then(() => {
      if (cancelled || !hostRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (globalThis as any).google.maps;
      const start = { lat, lng };
      const map = new g.Map(hostRef.current, {
        center: start, zoom: 14,
        clickableIcons: false, streetViewControl: false, mapTypeControl: false,
        fullscreenControl: false, zoomControl: true,
      });
      mapRef.current = map;
      const marker = new g.Marker({ position: start, map, draggable: true });
      markerRef.current = marker;
      marker.addListener('dragend', () => {
        const p = marker.getPosition();
        if (p) onChange(Number(p.lat().toFixed(6)), Number(p.lng().toFixed(6)));
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map.addListener('click', (e: any) => {
        if (!e.latLng) return;
        marker.setPosition(e.latLng);
        onChange(Number(e.latLng.lat().toFixed(6)), Number(e.latLng.lng().toFixed(6)));
      });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; markerRef.current?.setMap?.(null); markerRef.current = null; mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  if (!configured || failed) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>{labels.setupRequired}</Text>
      </View>
    );
  }

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = Number(pos.coords.latitude.toFixed(6));
        const ln = Number(pos.coords.longitude.toFixed(6));
        mapRef.current?.panTo?.({ lat: la, lng: ln });
        markerRef.current?.setPosition?.({ lat: la, lng: ln });
        onChange(la, ln);
        setLocating(false);
      },
      () => setLocating(false), // denied → manual pin placement still works
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <View>
      <View style={styles.mapWrap}>
        {/* Plain DOM host for Google Maps — valid in react-native-web trees. */}
        <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
      </View>
      <View style={styles.row}>
        <Text style={styles.hint}>{labels.moveHint}</Text>
        <Pressable onPress={useMyLocation} disabled={locating} style={styles.locBtn}>
          <Text style={styles.locBtnText}>{locating ? '…' : labels.useMyLocation}</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  mapWrap: { height: 240, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs, gap: spacing.sm },
  hint: { flex: 1, fontSize: font.sm, color: colors.muted },
  locBtn: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.purple },
  locBtnText: { color: colors.white, fontSize: font.sm, fontWeight: '800' },
  fallback: { padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  fallbackText: { fontSize: font.sm, color: colors.muted, fontWeight: '700', textAlign: 'center' },
});
