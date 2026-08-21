/**
 * Web build of the delivery-location picker: renders Google Maps JS directly
 * in the page (no WebView needed in a real browser) with the same props
 * contract as the native component — draggable pin, tap-to-set, `readOnly`
 * preview mode, and the same
 * compact in-map current-location control. Arabic labels are shaped natively by
 * Google. When the google provider/key is absent it shows the same setup hint as
 * native, and manual coordinate entry in the caller keeps working.
 *
 * Browser geolocation replaces expo-location here, and Google's own Geocoder
 * replaces expo's reverse geocoder, but both go through the same shared rules in
 * ./locationControl so web and native cannot drift.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { mapConfig } from '../lib/map';
import { color, radius, space, type } from '../design-system/generated/tokens';
import { CrosshairIcon } from './Icons';
import {
  FIX_FRESH_MS, LOCATE_TIMEOUT_MS, classifyLocateFailure, isFixFresh, isUsableFix,
  locateFailureMessage, roundCoord, shouldStartLocate,
  LOCATE_BTN_BOTTOM, LOCATE_BTN_RIGHT, LOCATE_BTN_SIZE, MAP_HEIGHT,
  type CachedFix, type LocateLang, type LocateState,
} from './locationControl';
import { makeStyles } from '../theme/makeStyles';
import { useThemeColors } from '../theme/ThemeProvider';

interface LocationPickerMapProps {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  lang: LocateLang;
  labels: { locateHint: string; useMyLocation: string; setupRequired: string };
  onAddressResolved?: (text: string) => void;
  /** PREVIEW mode — see the native component for the full rationale. Must stay
   *  in lockstep with it: the same screens ship in the web export, and a web
   *  build that still let the pin be dragged would put Checkout back to editing
   *  a location it is only supposed to confirm. */
  readOnly?: boolean;
  /** Preview height. Defaults to the full picker height. */
  height?: number;
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

export const LocationPickerMap: React.FC<LocationPickerMapProps> = ({
  lat, lng, onChange, lang, labels, onAddressResolved, readOnly = false, height,
}) => {
  const styles = useStyles();
  const colors = useThemeColors();
  const hostRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  const [locateState, setLocateState] = useState<LocateState>('idle');
  const [locateError, setLocateError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const lastFixRef = useRef<CachedFix | null>(null);

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
        fullscreenControl: false,
        // Same stacking as native: zoom mid-right, locate control bottom-right.
        zoomControl: !readOnly, zoomControlOptions: { position: g.ControlPosition.RIGHT_CENTER },
        gestureHandling: readOnly ? 'none' : 'auto', keyboardShortcuts: !readOnly,
      });
      mapRef.current = map;
      const marker = new g.Marker({ position: start, map, draggable: !readOnly });
      markerRef.current = marker;
      if (!readOnly) marker.addListener('dragend', () => {
        const p = marker.getPosition();
        if (p) onChange(roundCoord(p.lat()), roundCoord(p.lng()));
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!readOnly) map.addListener('click', (e: any) => {
        if (!e.latLng) return;
        marker.setPosition(e.latLng);
        onChange(roundCoord(e.latLng.lat()), roundCoord(e.latLng.lng()));
      });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; markerRef.current?.setMap?.(null); markerRef.current = null; mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured]);

  /** Move camera + pin, publish coordinates, optionally name the place. */
  const applyFix = useCallback((la: number, ln: number, reverseGeocode: boolean) => {
    const rLa = roundCoord(la);
    const rLn = roundCoord(ln);
    mapRef.current?.panTo?.({ lat: rLa, lng: rLn });
    markerRef.current?.setPosition?.({ lat: rLa, lng: rLn });
    onChange(rLa, rLn);
    if (!reverseGeocode || !onAddressResolved) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (globalThis as any).google?.maps;
    if (!g?.Geocoder) return;
    try {
      new g.Geocoder().geocode(
        { location: { lat: rLa, lng: rLn }, language: lang },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (results: any[], status: string) => {
          if (status !== 'OK' || !results?.[0]) return;
          const text = results[0].formatted_address;
          if (typeof text === 'string' && text) onAddressResolved(text);
        },
      );
    } catch { /* best effort only */ }
  }, [onChange, onAddressResolved, lang]);

  const useMyLocation = useCallback(() => {
    if (!shouldStartLocate(locateState)) return; // repeated-tap guard
    if (!('geolocation' in navigator)) {
      setLocateError(locateFailureMessage('unavailable', lang));
      setLocateState('error');
      return;
    }
    setLocateState('locating');
    setLocateError(null);

    // Reuse a recent fix for instant feedback; the live reading still refines it.
    const cached = lastFixRef.current;
    if (cached && isFixFresh(cached, Date.now())) applyFix(cached.lat, cached.lng, false);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (!isUsableFix(latitude, longitude)) {
          setLocateError(locateFailureMessage('unavailable', lang));
          setLocateState('error');
          return;
        }
        lastFixRef.current = { lat: latitude, lng: longitude, at: Date.now() };
        applyFix(latitude, longitude, true);
        setLocateState('idle');
      },
      (err) => {
        setLocateError(locateFailureMessage(classifyLocateFailure(err), lang));
        setLocateState('error');
      },
      { enableHighAccuracy: true, timeout: LOCATE_TIMEOUT_MS, maximumAge: FIX_FRESH_MS },
    );
  }, [locateState, lang, applyFix]);

  if (!configured || failed) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>{labels.setupRequired}</Text>
      </View>
    );
  }

  const locating = locateState === 'locating';

  return (
    <View>
      <View style={[styles.mapWrap, height != null && { height }]}>
        {/* Plain DOM host for Google Maps — valid in react-native-web trees. */}
        <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
        {readOnly ? null : <Pressable
          onPress={useMyLocation}
          accessibilityRole="button"
          accessibilityLabel={labels.useMyLocation}
          accessibilityState={{ busy: locating, disabled: locating }}
          accessibilityHint={labels.locateHint}
          hitSlop={8}
          style={({ pressed }) => [styles.locateBtn, pressed && !locating && styles.locateBtnPressed]}
        >
          {locating
            ? <ActivityIndicator size="small" color={colors.ember} />
            : <CrosshairIcon size={22} color={colors.ember} />}
        </Pressable>}
      </View>
      {readOnly ? null : <Text style={styles.hint}>{labels.locateHint}</Text>}
      {locateError ? <Text style={styles.locateError}>{locateError}</Text> : null}
    </View>
  );
};

const useStyles = makeStyles((colors) => ({
  mapWrap: {
    height: MAP_HEIGHT, borderRadius: radius.md, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.appLine, position: 'relative',
  },
  locateBtn: {
    // Geometry is asserted in locationControl.test.ts.
    position: 'absolute', right: LOCATE_BTN_RIGHT, bottom: LOCATE_BTN_BOTTOM,
    width: LOCATE_BTN_SIZE, height: LOCATE_BTN_SIZE, borderRadius: LOCATE_BTN_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.appSurface,
    borderWidth: 1, borderColor: colors.appLine,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  locateBtnPressed: { backgroundColor: colors.appSurface2 },
  hint: { fontSize: type.label.size, color: colors.appText2, marginTop: space.s1 },
  locateError: { fontSize: type.label.size, color: colors.danger, fontWeight: '700', marginTop: space.s1 },
  fallback: { padding: space.s4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.appLine, backgroundColor: colors.appSurface },
  fallbackText: { fontSize: type.label.size, color: colors.appText2, fontWeight: '700', textAlign: 'center' },
}));
