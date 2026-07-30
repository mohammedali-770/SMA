/**
 * Delivery location: pin, the pin's own address, the mandatory landmark, an
 * optional building line, and the saved locations.
 *
 * Two things here are load-bearing and easy to lose in a restyle:
 *
 * 1. The reverse-geocoded address is READ-ONLY CONTEXT, never the delivery
 *    guidance and never prefilled into the field. An earlier revision did
 *    prefill it, which meant the mandatory-landmark rule could be satisfied
 *    without the customer typing anything — defeating the point. It is rendered
 *    as a quiet caption above the field precisely so it cannot be mistaken for
 *    an input.
 *
 * 2. The landmark field is REQUIRED and the optional one is not, so they must
 *    not look alike. The required field carries the label, the asterisk and the
 *    error; the optional one is a plain single line underneath with "(optional)"
 *    in its own label.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { LocationPickerMap } from '../../../components/LocationPickerMap';
import { space } from '../../../design-system/generated/tokens';
import { Field } from '../../../design-system/ui/Field';
import { Notice } from '../../../design-system/ui/Notice';
import { Text } from '../../../design-system/ui/Text';
import { descriptionCopy } from '../../order/locationDescription';
import { SavedAddressList } from './SavedAddressList';
import type { SavedAddress } from '../../../types/models';

export function DeliveryLocationSection({
  lang,
  recenterSeed,
  lat,
  lng,
  onPinChange,
  onAddressResolved,
  resolvedAddress,
  description,
  onDescriptionChange,
  onDescriptionBlur,
  descriptionError,
  addressLabel,
  onAddressLabelChange,
  optionalLabel,
  addresses,
  selectedAddressId,
  onSelectAddress,
  savedTitle,
  savedFallbackLabel,
  blockReason,
  mapLabels,
}: {
  lang: 'ar' | 'en';
  recenterSeed: number;
  lat: number;
  lng: number;
  onPinChange: (lat: number, lng: number) => void;
  onAddressResolved: (text: string) => void;
  resolvedAddress: string | null;
  description: string;
  onDescriptionChange: (v: string) => void;
  onDescriptionBlur: () => void;
  descriptionError: string | null;
  addressLabel: string;
  onAddressLabelChange: (v: string) => void;
  optionalLabel: string;
  addresses: SavedAddress[];
  selectedAddressId: string | null;
  onSelectAddress: (a: SavedAddress) => void;
  savedTitle: string;
  savedFallbackLabel: string;
  blockReason: string | null;
  mapLabels: { locateHint: string; useMyLocation: string; setupRequired: string };
}) {
  const copy = descriptionCopy[lang];

  return (
    <View style={{ gap: space.s4 }}>
      <View style={styles.map}>
        <LocationPickerMap
          key={recenterSeed}
          lat={lat}
          lng={lng}
          lang={lang}
          onChange={onPinChange}
          onAddressResolved={onAddressResolved}
          labels={mapLabels}
        />
      </View>

      {resolvedAddress ? (
        <Text variant="caption" tone="tertiary" numberOfLines={2}>
          {`${copy.addressPrefix}: ${resolvedAddress}`}
        </Text>
      ) : null}

      <Field
        id="checkout-delivery-description"
        label={copy.label}
        required
        value={description}
        onChangeText={onDescriptionChange}
        onBlur={onDescriptionBlur}
        error={descriptionError}
        placeholder={copy.placeholder}
        multiline
        inputStyle={styles.multiline}
      />

      <Field
        id="checkout-address-label"
        label={optionalLabel}
        value={addressLabel}
        onChangeText={onAddressLabelChange}
      />

      <SavedAddressList
        addresses={addresses}
        selectedId={selectedAddressId}
        onSelect={onSelectAddress}
        title={savedTitle}
        fallbackLabel={savedFallbackLabel}
      />

      {/* Title only — no action. The footer owns "the one blocking problem"
          and states the fix there; repeating both here rendered the same red
          notice twice on one screen. This stays because the footer shows only
          the WINNING reason, so a delivery problem outranked by (say) a
          below-minimum cart would otherwise leave this section silent. */}
      {blockReason ? <Notice title={blockReason} tone="blocking" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The picker draws its own frame; this only reserves the space and clips it.
  map: { overflow: 'hidden' },
  multiline: { minHeight: 84, paddingTop: space.s3, textAlignVertical: 'top' },
});
