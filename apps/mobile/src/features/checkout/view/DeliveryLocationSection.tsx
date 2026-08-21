/**
 * Delivery location at Checkout: CONFIRM the location already chosen, don't ask
 * for it again.
 *
 * The order-type gate is a blocking screen the customer cannot get past without
 * resolving a delivery location — and `confirmNewAddress` there always persists
 * it through `addressBook.create`, so by the time Checkout renders there is
 * always a saved address behind the order context. Checkout used to re-present
 * the whole picker anyway: a draggable map, the mandatory guidance field, an
 * optional building line and the saved list. That asked the customer to redo a
 * decision they had already made, and it made Checkout a SECOND place the
 * landmark could be edited — the exact duplication `order/locationDescription`
 * was written to end.
 *
 * So this screen now only ever SELECTS:
 *
 * 1. Default view — the chosen location, read-only: a non-interactive map
 *    preview, the location's label, and its landmark. One action, "change".
 * 2. Change view — the other SAVED locations, as radio rows. Changing means
 *    picking a different saved location; it does not mean editing one.
 * 3. Creating or editing a location happens in location settings
 *    (`/profile/addresses`), the one screen that owns it, reached from the row
 *    under the list.
 *
 * Because of that, Checkout never writes an address any more. `place_order`
 * receives the id of a saved address that already carries a validated landmark.
 *
 * The device-GPS mismatch is a WARNING and never a block. Ordering to an address
 * you are not standing at is completely normal — home from work, a relative's
 * house, an office — so this states the distance and gets out of the way.
 */
import React from 'react';
import { Pressable, View } from 'react-native';

import { PinIcon } from '../../../components/Icons';
import { LocationPickerMap } from '../../../components/LocationPickerMap';
import { radius, space } from '../../../design-system/generated/tokens';
import { Button } from '../../../design-system/ui/Button';
import { Notice } from '../../../design-system/ui/Notice';
import { Text } from '../../../design-system/ui/Text';
import { useI18n } from '../../../i18n/I18nProvider';
import { SavedAddressList } from './SavedAddressList';
import type { SavedAddress } from '../../../types/models';
import { makeStyles } from '../../../theme/makeStyles';

/** Height of the confirm-view map. Shorter than the picker — it is a reference,
 *  not a workspace, and it must not push the rest of Checkout off-screen. */
export const PREVIEW_MAP_HEIGHT = 132;

export interface DeliveryLocationLabels {
  /** "Change location" — opens the saved-location picker. */
  change: string;
  /** "Confirm location" — commits the picked row and closes the picker. */
  confirm: string;
  cancel: string;
  /** Title of the saved list in the change view. */
  savedTitle: string;
  /** Shown for a saved location with no label of its own. */
  savedFallbackLabel: string;
  /** The row that leaves for location settings. */
  manageTitle: string;
  manageSubtitle: string;
  /** Shown instead of the card when no usable location resolved. */
  missing: string;
}

export function DeliveryLocationSection({
  lang,
  lat,
  lng,
  locationLabel,
  locationDescription,
  changing,
  onStartChange,
  onCancelChange,
  onConfirmChange,
  onManageLocations,
  addresses,
  selectedAddressId,
  onSelectAddress,
  gpsWarning,
  blockReason,
  labels,
  mapLabels,
}: {
  lang: 'ar' | 'en';
  lat: number | null;
  lng: number | null;
  locationLabel: string;
  locationDescription: string;
  changing: boolean;
  onStartChange: () => void;
  onCancelChange: () => void;
  onConfirmChange: () => void;
  onManageLocations: () => void;
  addresses: SavedAddress[];
  selectedAddressId: string | null;
  onSelectAddress: (a: SavedAddress) => void;
  /** Non-blocking distance notice, or null when the device is near the pin
   *  (or its position is simply unknown, which is not a warning). */
  gpsWarning: { title: string; body: string } | null;
  blockReason: string | null;
  labels: DeliveryLocationLabels;
  mapLabels: { locateHint: string; useMyLocation: string; setupRequired: string };
}) {
  const styles = useStyles();
  const { isRTL, rtlRow } = useI18n();

  if (changing) {
    return (
      <View style={{ gap: space.s4 }}>
        <SavedAddressList
          addresses={addresses}
          selectedId={selectedAddressId}
          onSelect={onSelectAddress}
          title={labels.savedTitle}
          fallbackLabel={labels.savedFallbackLabel}
        />

        {/* The ONLY route to creating or editing a location. Keeping it out of
            Checkout is what stops the landmark having two owners. */}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={labels.manageTitle}
          accessibilityHint={labels.manageSubtitle}
          onPress={onManageLocations}
          style={({ pressed }) => [styles.manageRow, rtlRow, pressed && styles.pressed]}
        >
          <PinIcon size={20} />
          <View style={styles.manageBody}>
            <Text variant="label">{labels.manageTitle}</Text>
            <Text variant="caption" tone="tertiary">{labels.manageSubtitle}</Text>
          </View>
          <Text variant="title" tone="tertiary">{isRTL ? '‹' : '›'}</Text>
        </Pressable>

        <View style={{ gap: space.s2 }}>
          <Button label={labels.confirm} onPress={onConfirmChange} variant="primary" disabled={!selectedAddressId} />
          <Button label={labels.cancel} onPress={onCancelChange} variant="ghost" size="md" />
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: space.s3 }}>
      {lat != null && lng != null ? (
        <View style={styles.card}>
          {/* readOnly: a preview, not a picker. Nothing the customer does on
              this map can move the pin, so it carries no affordance saying it
              can — no drag, no zoom cluster, no locate button, no hint line. */}
          <LocationPickerMap
            lat={lat}
            lng={lng}
            lang={lang}
            readOnly
            height={PREVIEW_MAP_HEIGHT}
            onChange={() => { /* readOnly — never called */ }}
            labels={mapLabels}
          />
          <View style={styles.body}>
            <View style={[styles.identity, rtlRow]}>
              <PinIcon size={20} />
              <View style={styles.identityBody}>
                <Text variant="heading" numberOfLines={2}>{locationLabel}</Text>
                {locationDescription ? (
                  <Text variant="caption" tone="tertiary" numberOfLines={3}>{locationDescription}</Text>
                ) : null}
              </View>
            </View>
            <View style={styles.divider} />
            <Button label={labels.change} onPress={onStartChange} variant="secondary" size="md" />
          </View>
        </View>
      ) : (
        <Notice title={labels.missing} tone="blocking" />
      )}

      {/* Warning, never a block: delivering to an address you are not standing
          at is the normal case, not an error. */}
      {gpsWarning ? <Notice title={gpsWarning.title} action={gpsWarning.body} tone="warning" /> : null}

      {/* Title only — no action. The footer owns "the one blocking problem"
          and states the fix there; repeating both here rendered the same red
          notice twice on one screen. This stays because the footer shows only
          the WINNING reason, so a delivery problem outranked by (say) a
          below-minimum cart would otherwise leave this section silent. */}
      {blockReason ? <Notice title={blockReason} tone="blocking" /> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1.5,
    borderColor: colors.appLine,
    backgroundColor: colors.appSurface,
    overflow: 'hidden',
  },
  body: { padding: space.s4, gap: space.s3 },
  identity: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s3 },
  identityBody: { flex: 1, gap: 2 },
  divider: { height: 1, backgroundColor: colors.appLine },
  manageRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.s3,
    padding: space.s3, borderRadius: radius.md, borderCurve: 'continuous',
    borderWidth: 1.5, borderColor: colors.appLine, backgroundColor: colors.appSurface,
  },
  manageBody: { flex: 1, gap: 2 },
  pressed: { opacity: 0.8 },
}));
