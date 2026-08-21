/**
 * Customer delivery-location picker (mobile).
 *
 * Renders a real interactive map (Google Maps JS or Mapbox, provider-switched
 * in lib/map.ts) + draggable pin inside a WebView — which
 * runs in Expo Go today with no native map module or EAS build. The pin position
 * is posted back to React Native via `postMessage`. Coordinates are validated
 * server-side by place_order.
 *
 * The current-location control is a compact circular button overlaid on the map
 * beneath the zoom cluster, in the position Google Maps itself uses. It was
 * previously a full-width button *below* the map that awaited a fresh
 * high-accuracy fix on every press with no busy state, so a cold GPS looked like
 * a dead button and customers queued more fixes by tapping again. Now:
 *   - a last-known fix moves the pin immediately (perceived speed), then a
 *     fresh reading refines it;
 *   - the control shows its own spinner and ignores presses while working;
 *   - every failure degrades to one short line — dragging the pin always still
 *     works, so no failure here blocks the order.
 * Logic testable without a renderer lives in ./locationControl.
 *
 * Isolated behind this component so a later swap to a native map
 * (@rnmapbox/maps on an EAS dev build) is a localized change.
 */
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { mapConfig } from '../lib/map';
import { captureMessage } from '../lib/observability';
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
  /** Language for the control's own error line (the map has no i18n context). */
  lang: LocateLang;
  labels: { locateHint: string; useMyLocation: string; setupRequired: string };
  /**
   * Reverse-geocoded street/district for the picked point, when the platform can
   * resolve one. Callers use it to prefill the location description.
   */
  onAddressResolved?: (text: string) => void;
  /**
   * PREVIEW mode: show where the location is, do not let the customer move it.
   *
   * The pin is not draggable, map clicks do not move it, the zoom cluster and
   * the locate control are gone, gestures are off, and `locateHint` is not
   * rendered — every affordance that says "adjust this" is removed, because in
   * preview mode nothing the customer does here can change the coordinate.
   *
   * Checkout uses this to CONFIRM the location already chosen at the order-type
   * gate. Changing it there means selecting a different saved location; editing
   * a location's pin or landmark happens in location settings, on the one screen
   * that owns it. `onChange` is never called in this mode.
   */
  readOnly?: boolean;
  /** Preview height. Defaults to the full picker height. */
  height?: number;
}

function buildGoogleHtml(key: string, lat: number, lng: number, readOnly: boolean): string {
  // Google Maps JS API in the WebView. Arabic street names are shaped natively.
  // The key must be referrer-restricted; the WebView is loaded with a baseUrl
  // from an allowed domain so requests carry that referrer.
  //
  // `gm_authFailure` is Google's documented hook for a rejected key — it is what
  // fires on RefererNotAllowedMapError (baseUrl missing or not in the key's
  // referrer allowlist) and InvalidKeyMapError. Without it the API silently
  // renders a blank grey canvas, which is indistinguishable from a network
  // stall, so the reason is posted back to RN and reported instead.
  //
  // Zoom sits at RIGHT_CENTER so the app's locate control can occupy the
  // bottom-right corner without overlapping it — the stacking Google Maps uses.
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>html,body,#map{margin:0;padding:0;height:100%;width:100%}</style>
</head><body><div id="map"></div><script>
  var map, marker;
  function fail(reason){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({__mapError:reason})); }
  window.gm_authFailure = function(){ fail('google_auth_failure'); };
  window.onerror = function(m){ fail('script_error: ' + String(m).slice(0,120)); };
  function post(){ if (marker && window.ReactNativeWebView) { var p = marker.getPosition(); window.ReactNativeWebView.postMessage(JSON.stringify({lat:p.lat(),lng:p.lng()})); } }
  window.__init = function(){
    map = new google.maps.Map(document.getElementById('map'), {
      center: {lat:${lat}, lng:${lng}}, zoom: 14,
      clickableIcons: false, streetViewControl: false, mapTypeControl: false, fullscreenControl: false, disableDefaultUI: true,
      zoomControl: ${readOnly ? 'false' : 'true'}, zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
      gestureHandling: ${readOnly ? "'none'" : "'auto'"}, keyboardShortcuts: ${readOnly ? 'false' : 'true'}
    });
    marker = new google.maps.Marker({ position: {lat:${lat}, lng:${lng}}, map: map, draggable: ${readOnly ? 'false' : 'true'} });
    ${readOnly ? '' : "marker.addListener('dragend', post); map.addListener('click', function(e){ marker.setPosition(e.latLng); post(); });"}
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({__mapReady:true}));
  };
  window.recenter = function(la, ln){ if (map && marker) { map.panTo({lat:la, lng:ln}); marker.setPosition({lat:la, lng:ln}); post(); } };
</script>
<script async src="https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__init" onerror="fail('google_script_load_failed')"></script>
</body></html>`;
}

function buildHtml(token: string, style: string, lat: number, lng: number, readOnly: boolean): string {
  // Mapbox GL JS is loaded from the Mapbox CDN (the WebView has network access).
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link href="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js"></script>
<style>html,body,#map{margin:0;padding:0;height:100%;width:100%}</style>
</head><body><div id="map"></div><script>
  mapboxgl.accessToken = ${JSON.stringify(token)};
  var map = new mapboxgl.Map({ container:'map', style:${JSON.stringify(style)}, center:[${lng},${lat}], zoom:14, interactive:${readOnly ? 'false' : 'true'} });
  var marker = new mapboxgl.Marker({ color:'#7c3aed', draggable:${readOnly ? 'false' : 'true'} }).setLngLat([${lng},${lat}]).addTo(map);
  function post(){ var p = marker.getLngLat(); if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({lat:p.lat,lng:p.lng})); }
  function fail(reason){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({__mapError:reason})); }
  // A rejected/URL-restricted token surfaces here as a 401 rather than throwing.
  map.on('error', function(e){ fail('mapbox_error: ' + String((e && e.error && e.error.message) || 'unknown').slice(0,120)); });
  map.on('load', function(){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({__mapReady:true})); });
  ${readOnly ? '' : "marker.on('dragend', post); map.on('click', function(e){ marker.setLngLat(e.lngLat); post(); });"}
  window.recenter = function(la, ln){ map.flyTo({center:[ln,la]}); marker.setLngLat([ln,la]); post(); };
</script></body></html>`;
}

export const LocationPickerMap: React.FC<LocationPickerMapProps> = ({
  lat, lng, onChange, lang, labels, onAddressResolved, readOnly = false, height,
}) => {
  const styles = useStyles();
  const colors = useThemeColors();
  const webRef = useRef<WebView | null>(null);
  const [locateState, setLocateState] = useState<LocateState>('idle');
  const [locateError, setLocateError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Report the first failure only; a broken key otherwise fires on every
  // re-render and would flood Sentry from a screen the user sits on.
  const reportedRef = useRef(false);
  // Set once the map has actually drawn. Errors after that point are transient
  // (a dropped tile, an unrelated script error) and must NOT tear down a map
  // the customer is already using — only a failure to come up at all is fatal.
  const readyRef = useRef(false);
  const lastFixRef = useRef<CachedFix | null>(null);
  // Coordinates applyFix has just published. window.recenter() posts the pin
  // straight back through onMessage, which would fire onChange a SECOND time
  // with these same coords; recording them here lets onMessage drop that echo so
  // a programmatic recenter reports the move exactly once (a real pin drag lands
  // on different coords and still passes through).
  const lastAppliedRef = useRef<{ lat: number; lng: number } | null>(null);

  const reportFailure = (reason: string) => {
    if (readyRef.current) return;
    setFailed(true);
    if (reportedRef.current) return;
    reportedRef.current = true;
    captureMessage(`map load failed: ${reason}`, {
      subsystem: 'app',
      op: 'map_load',
      code: 'MAP_LOAD_FAILED',
      level: 'error',
      tags: { map_provider: mapConfig.provider, has_base_url: Boolean(mapConfig.webviewBaseUrl) },
    });
  };

  // Build the HTML once from the initial coords; further updates go through
  // injectJavaScript so the WebView is not reloaded on every pin move.
  const htmlRef = useRef(mapConfig.provider === 'google'
    ? buildGoogleHtml(mapConfig.googleKey, lat, lng, readOnly)
    : buildHtml(mapConfig.publicToken, mapConfig.styleUrl, lat, lng, readOnly));

  /** Move camera + pin, publish the coordinates, and try to name the place. */
  const applyFix = useCallback((la: number, ln: number, reverseGeocode: boolean) => {
    const rLa = roundCoord(la);
    const rLn = roundCoord(ln);
    // Record before injecting so the recenter echo (see onMessage) is deduped.
    // onChange is still called directly here so the coordinate is published even
    // if window.recenter isn't defined yet (map still loading) and no echo comes.
    lastAppliedRef.current = { lat: rLa, lng: rLn };
    webRef.current?.injectJavaScript(`window.recenter(${rLa}, ${rLn}); true;`);
    onChange(rLa, rLn);
    if (!reverseGeocode || !onAddressResolved) return;
    // Best-effort only: a missing street name must never fail the locate action.
    Location.reverseGeocodeAsync({ latitude: rLa, longitude: rLn })
      .then((places) => {
        const p = places?.[0];
        if (!p) return;
        const text = [p.name, p.street, p.district, p.city].filter(Boolean).join(', ');
        if (text) onAddressResolved(text);
      })
      .catch(() => { /* no reverse geocoder on this platform / offline */ });
  }, [onChange, onAddressResolved]);

  const useMyLocation = useCallback(async () => {
    if (!shouldStartLocate(locateState)) return; // repeated-tap guard
    setLocateState('locating');
    setLocateError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocateError(locateFailureMessage('permission_denied', lang));
        setLocateState('error');
        return;
      }

      // Show a recent fix straight away so the pin moves on the first frame,
      // then refine with a live reading. `lastFixRef` survives re-presses within
      // the screen, so a second tap feels instant.
      const cached = lastFixRef.current;
      if (cached && isFixFresh(cached, Date.now())) {
        applyFix(cached.lat, cached.lng, false);
      } else {
        const known = await Location.getLastKnownPositionAsync({ maxAge: FIX_FRESH_MS });
        if (known && isUsableFix(known.coords.latitude, known.coords.longitude)) {
          applyFix(known.coords.latitude, known.coords.longitude, false);
        }
      }

      // Most accurate practical reading, bounded so a cold GPS cannot hang the
      // control indefinitely.
      const fresh = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Location request timed out')), LOCATE_TIMEOUT_MS)),
      ]);
      const { latitude, longitude } = fresh.coords;
      if (!isUsableFix(latitude, longitude)) {
        setLocateError(locateFailureMessage('unavailable', lang));
        setLocateState('error');
        return;
      }
      lastFixRef.current = { lat: latitude, lng: longitude, at: Date.now() };
      applyFix(latitude, longitude, true);
      setLocateState('idle');
    } catch (e) {
      setLocateError(locateFailureMessage(classifyLocateFailure(e), lang));
      setLocateState('error');
    }
  }, [locateState, lang, applyFix]);

  // Unconfigured (no key) and load-failure (bad key / no network) both degrade
  // to the same hint — the caller's manual coordinate entry keeps working
  // either way. The two are distinguished in Sentry, not on screen.
  if (!mapConfig.isConfigured || failed) {
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
        <WebView
          ref={webRef}
          originWhitelist={['*']}
          source={mapConfig.webviewBaseUrl
            ? { html: htmlRef.current, baseUrl: mapConfig.webviewBaseUrl }
            : { html: htmlRef.current }}
          style={styles.web}
          // Google Maps JS and Mapbox GL both persist state to localStorage;
          // set explicitly so the map does not depend on the platform default.
          domStorageEnabled
          javaScriptEnabled
          onMessage={(e) => {
            try {
              const d = JSON.parse(e.nativeEvent.data);
              if (d?.__mapReady === true) {
                readyRef.current = true;
                return;
              }
              if (typeof d?.__mapError === 'string') {
                reportFailure(d.__mapError);
                return;
              }
              if (typeof d?.lat === 'number' && typeof d?.lng === 'number') {
                const la = Number(d.lat.toFixed(6));
                const ln = Number(d.lng.toFixed(6));
                const last = lastAppliedRef.current;
                if (last && last.lat === la && last.lng === ln) {
                  // Echo of our own recenter() — applyFix already reported it.
                  lastAppliedRef.current = null;
                  return;
                }
                onChange(la, ln);
              }
            } catch { /* ignore */ }
          }}
          onError={(e) => reportFailure(`webview: ${e.nativeEvent.description ?? 'unknown'}`)}
          onHttpError={(e) => reportFailure(`http_${e.nativeEvent.statusCode}`)}
        />

        {/* In-map current-location control. Bottom-right, clear of the zoom
            cluster (RIGHT_CENTER) and of the map attribution strip. Absent in
            preview mode: it moves the pin, and in preview the pin does not move. */}
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

      {/* Quiet hint — the loud message on these screens is the description
          field's own validation, which must not have to compete with this.
          Preview mode has nothing to hint at: the pin cannot be moved. */}
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
  web: { flex: 1 },
  // 44x44 keeps the control at the platform minimum touch target while staying
  // small enough not to cover the map or the pin.
  locateBtn: {
    // Geometry is asserted in locationControl.test.ts.
    position: 'absolute', right: LOCATE_BTN_RIGHT, bottom: LOCATE_BTN_BOTTOM,
    width: LOCATE_BTN_SIZE, height: LOCATE_BTN_SIZE, borderRadius: LOCATE_BTN_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.appSurface,
    borderWidth: 1, borderColor: colors.appLine,
    // Matches the elevation Google's own map controls carry.
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  locateBtnPressed: { backgroundColor: colors.appSurface2 },
  hint: { fontSize: type.label.size, color: colors.appText2, marginTop: space.s1 },
  locateError: { fontSize: type.label.size, color: colors.danger, fontWeight: '700', marginTop: space.s1 },
  fallback: { padding: space.s4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.appLine, backgroundColor: colors.appSurface },
  fallbackText: { fontSize: type.label.size, color: colors.appText2, fontWeight: '700', textAlign: 'center' },
}));
