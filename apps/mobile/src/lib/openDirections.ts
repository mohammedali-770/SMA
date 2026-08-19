/**
 * Opens branch directions, letting the customer pick their maps app.
 *
 * On iOS both Apple Maps and Google Maps are common, and silently forcing one
 * is the kind of small rudeness people notice — so when Google Maps is actually
 * installed the customer is asked. When it is not, there is no choice to make
 * and Apple Maps opens directly rather than showing a one-option menu.
 *
 * Android is left alone: the `geo:` intent already hands the choice to the OS,
 * which shows the system app picker. Adding our own sheet on top would be a
 * second chooser in front of the real one.
 */
import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';

import { buildGoogleMapsUrl, hasUsableCoordinates } from './maps';
import { directionsUrl } from './mapsLink';

/** iOS only: is the Google Maps app present? */
async function googleMapsInstalled(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    // Requires 'comgooglemaps' in ios.infoPlist.LSApplicationQueriesSchemes,
    // otherwise iOS answers false regardless of what is installed.
    return await Linking.canOpenURL('comgooglemaps://');
  } catch {
    return false;
  }
}

const open = (url: string) => { void Linking.openURL(url).catch(() => { /* no handler */ }); };

export interface DirectionsLabels {
  /** Sheet title, e.g. "Open directions in". */
  title: string;
  appleMaps: string;
  googleMaps: string;
  cancel: string;
}

/**
 * Open directions to a branch. Does nothing when the coordinates are unusable —
 * callers hide the control in that case, this is the second line of defence.
 */
export async function openDirections(
  lat: unknown,
  lng: unknown,
  label: string,
  labels: DirectionsLabels,
): Promise<void> {
  if (!hasUsableCoordinates(lat, lng)) return;
  const native = directionsUrl(lat, lng, label);
  if (!native) return;

  if (!(await googleMapsInstalled())) { open(native); return; }

  const google = buildGoogleMapsUrl(lat as number, lng as number, true);
  const choose = (index: number) => {
    if (index === 0) open(native);
    else if (index === 1) open(google);
  };

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: labels.title,
        options: [labels.appleMaps, labels.googleMaps, labels.cancel],
        cancelButtonIndex: 2,
      },
      choose,
    );
    return;
  }

  Alert.alert(labels.title, undefined, [
    { text: labels.appleMaps, onPress: () => choose(0) },
    { text: labels.googleMaps, onPress: () => choose(1) },
    { text: labels.cancel, style: 'cancel' },
  ]);
}
