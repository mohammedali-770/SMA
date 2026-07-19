/**
 * Customer delivery-location picker (mobile).
 *
 * Renders a real interactive map (Google Maps JS or Mapbox, provider-switched
 * in lib/map.ts) + draggable pin inside a WebView — which
 * runs in Expo Go today with no native map module or EAS build. The pin position
 * is posted back to React Native via `postMessage`. `expo-location` optionally
 * centers on the user; if permission is denied the map still works by manual
 * pan/drag (never blocks). Coordinates are validated server-side by place_order.
 *
 * Isolated behind this component so a later swap to a native map
 * (@rnmapbox/maps on an EAS dev build) is a localized change.
 */
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { mapConfig } from '../lib/map';
import { colors, font, radius, spacing } from '../theme';

interface LocationPickerMapProps {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  labels: { moveHint: string; useMyLocation: string; setupRequired: string };
}

function buildGoogleHtml(key: string, lat: number, lng: number): string {
  // Google Maps JS API in the WebView. Arabic street names are shaped natively.
  // The key must be referrer-restricted; the WebView is loaded with a baseUrl
  // from an allowed domain so requests carry that referrer.
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>html,body,#map{margin:0;padding:0;height:100%;width:100%}</style>
</head><body><div id="map"></div><script>
  var map, marker;
  function post(){ if (marker && window.ReactNativeWebView) { var p = marker.getPosition(); window.ReactNativeWebView.postMessage(JSON.stringify({lat:p.lat(),lng:p.lng()})); } }
  window.__init = function(){
    map = new google.maps.Map(document.getElementById('map'), {
      center: {lat:${lat}, lng:${lng}}, zoom: 14,
      clickableIcons: false, streetViewControl: false, mapTypeControl: false, fullscreenControl: false, disableDefaultUI: true, zoomControl: true
    });
    marker = new google.maps.Marker({ position: {lat:${lat}, lng:${lng}}, map: map, draggable: true });
    marker.addListener('dragend', post);
    map.addListener('click', function(e){ marker.setPosition(e.latLng); post(); });
  };
  window.recenter = function(la, ln){ if (map && marker) { map.panTo({lat:la, lng:ln}); marker.setPosition({lat:la, lng:ln}); post(); } };
</script>
<script async src="https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=__init"></script>
</body></html>`;
}

function buildHtml(token: string, style: string, lat: number, lng: number): string {
  // Mapbox GL JS is loaded from the Mapbox CDN (the WebView has network access).
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link href="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js"></script>
<style>html,body,#map{margin:0;padding:0;height:100%;width:100%}</style>
</head><body><div id="map"></div><script>
  mapboxgl.accessToken = ${JSON.stringify(token)};
  var map = new mapboxgl.Map({ container:'map', style:${JSON.stringify(style)}, center:[${lng},${lat}], zoom:14 });
  var marker = new mapboxgl.Marker({ color:'#7c3aed', draggable:true }).setLngLat([${lng},${lat}]).addTo(map);
  function post(){ var p = marker.getLngLat(); if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({lat:p.lat,lng:p.lng})); }
  marker.on('dragend', post);
  map.on('click', function(e){ marker.setLngLat(e.lngLat); post(); });
  window.recenter = function(la, ln){ map.flyTo({center:[ln,la]}); marker.setLngLat([ln,la]); post(); };
</script></body></html>`;
}

export const LocationPickerMap: React.FC<LocationPickerMapProps> = ({ lat, lng, onChange, labels }) => {
  const webRef = useRef<WebView | null>(null);
  const [locating, setLocating] = useState(false);
  // Build the HTML once from the initial coords; further updates go through
  // injectJavaScript so the WebView is not reloaded on every pin move.
  const htmlRef = useRef(mapConfig.provider === 'google'
    ? buildGoogleHtml(mapConfig.googleKey, lat, lng)
    : buildHtml(mapConfig.publicToken, mapConfig.styleUrl, lat, lng));

  if (!mapConfig.isConfigured) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>{labels.setupRequired}</Text>
      </View>
    );
  }

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return; // denied → manual selection still works
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const la = Number(pos.coords.latitude.toFixed(6));
      const ln = Number(pos.coords.longitude.toFixed(6));
      webRef.current?.injectJavaScript(`window.recenter(${la}, ${ln}); true;`);
      onChange(la, ln);
    } catch {
      // ignore; user can still place the pin manually
    } finally {
      setLocating(false);
    }
  };

  return (
    <View>
      <View style={styles.mapWrap}>
        <WebView
          ref={webRef}
          originWhitelist={['*']}
          source={mapConfig.webviewBaseUrl
            ? { html: htmlRef.current, baseUrl: mapConfig.webviewBaseUrl }
            : { html: htmlRef.current }}
          style={styles.web}
          onMessage={(e) => {
            try {
              const d = JSON.parse(e.nativeEvent.data);
              if (typeof d?.lat === 'number' && typeof d?.lng === 'number') {
                onChange(Number(d.lat.toFixed(6)), Number(d.lng.toFixed(6)));
              }
            } catch { /* ignore */ }
          }}
        />
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
  web: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs, gap: spacing.sm },
  hint: { flex: 1, fontSize: font.sm, color: colors.muted },
  locBtn: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.purple },
  locBtnText: { color: colors.white, fontSize: font.sm, fontWeight: '800' },
  fallback: { padding: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  fallbackText: { fontSize: font.sm, color: colors.muted, fontWeight: '700', textAlign: 'center' },
});
