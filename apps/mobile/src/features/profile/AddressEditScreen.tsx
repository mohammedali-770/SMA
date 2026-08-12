/**
 * Add / edit one saved address.
 *
 * Every rule this screen enforces already existed and is enforced elsewhere by
 * the same code:
 *   - the mandatory delivery landmark — `checkDescription`, shared with Checkout
 *     and the order-type gate, mirrored by trg_addresses_require_description;
 *   - the Saudi National Short Address format — `validateShortAddress`, mirrored
 *     by the column CHECK;
 *   - a usable pin — `isUsableFix`, the same guard the map's locate button uses.
 * They are composed in `addressForm.ts` and validated there, so this file holds
 * state and no opinions about what a valid address is.
 *
 * The map is `components/LocationPickerMap`, the same picker Checkout and the
 * gate use, recentered by remounting it with a changing `key` — its documented
 * recenter mechanism.
 *
 * Editing an address the customer is CURRENTLY ordering to clears the order
 * context: the context caches a copy of the landmark and coordinates, and
 * Checkout reconciles against that copy at place-order time, so a stale copy
 * would write the OLD landmark back over the one just saved.
 */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Header } from '../../components/Header';
import { LocationPickerMap } from '../../components/LocationPickerMap';
import { Screen } from '../../components/Screen';
import { EmptyView, LoadingView } from '../../components/StateViews';
import { color, space } from '../../design-system/generated/tokens';
import { Button } from '../../design-system/ui/Button';
import { SelectableChip } from '../../design-system/ui/Chip';
import { columnStyles } from '../../design-system/ui/ContentColumn';
import { Field } from '../../design-system/ui/Field';
import { Notice } from '../../design-system/ui/Notice';
import { Text } from '../../design-system/ui/Text';
import {
  addressFormCopy, toAddressInput, toAddressPatchFromForm, toFormValues, validateAddressForm,
  type AddressFormValues,
} from './addressForm';
import { descriptionCopy } from '../order/locationDescription';
import {
  contextNeedsReset, findAddress, NEW_ADDRESS, patchStalesOrderContext, shouldBecomeDefault,
} from '../../store/addressBook';
import { useI18n } from '../../i18n/I18nProvider';
import { mapConfig } from '../../lib/map';
import { useAddressBook, useOrderContext } from '../../store';
import type { SavedAddress } from '../../types/models';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';

const NO_ERRORS = { description: null, nationalShortAddress: null, label: null, location: null };

export function AddressEditScreen() {
  const colors = useThemeColors();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : NEW_ADDRESS;
  const book = useAddressBook();

  // `book.error` is one app-wide field that nothing on a navigation path clears,
  // so a delete that failed on the list screen would otherwise render here as a
  // red blocking alert about an address this form is not even editing.
  const { clearError } = book;
  useEffect(() => { clearError(); }, [clearError]);

  const existing = findAddress(book.addresses, id);
  const creating = id === NEW_ADDRESS;

  // A deep link (or a cold start) can land here before the book has loaded. The
  // form seeds its state ONCE from `existing`, so mounting it early would seed a
  // real address as a blank new one — and then save a duplicate. Wait instead.
  const resolving = !creating && !existing && (book.status === 'idle' || book.status === 'loading');

  if (resolving) {
    return (
      <Screen background={colors.appBg}>
        <Header title={t('addrEditTitle')} showBack safeTop />
        <LoadingView label={t('addrLoading')} />
      </Screen>
    );
  }

  // The book has settled and this id is not in it — the address was deleted, or
  // the URL is stale (these routes also ship in the web build, where Back/
  // Forward and a refresh can replay a dead address id). Say so. Falling
  // through to the form would present a blank "New address" titled as an edit,
  // and a save would silently create a second address instead of changing the
  // one asked for.
  if (!creating && !existing) {
    return (
      <Screen background={colors.appBg}>
        <Header title={t('addrEditTitle')} showBack safeTop />
        <EmptyView
          title={t('addrNotFound')}
          subtitle={t('addrNotFoundSub')}
          actionLabel={t('addrTitle')}
          onAction={() => router.replace('/profile/addresses')}
        />
      </Screen>
    );
  }

  // Remount the form when the identity it was seeded from changes.
  return <AddressEditForm key={existing?.id ?? NEW_ADDRESS} existing={existing} />;
}

function AddressEditForm({ existing }: { existing: SavedAddress | null }) {
  const styles = useStyles();
  const colors = useThemeColors();
  const { t, pick, lang } = useI18n();
  const book = useAddressBook();
  const orderCtx = useOrderContext();
  const isNew = existing === null;

  // Seeded once. Re-seeding from `existing` on every render would discard the
  // customer's keystrokes the moment the book refreshed underneath them.
  const [values, setValues] = useState<AddressFormValues>(() => toFormValues(existing));
  const [isDefault, setIsDefault] = useState<boolean>(
    () => existing?.isDefault ?? shouldBecomeDefault(book.addresses),
  );
  // Validation only after a save attempt or a blur, so an untouched form is not
  // pre-painted red.
  const [touched, setTouched] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [recenterSeed, setRecenterSeed] = useState(0);
  const [saving, setSaving] = useState(false);

  const copy = addressFormCopy[lang];
  const descCopy = descriptionCopy[lang];

  const result = useMemo(
    () => validateAddressForm(values, lang, resolvedAddress),
    [values, lang, resolvedAddress],
  );
  const show = touched ? result.errors : NO_ERRORS;

  const mapLat = values.lat ?? mapConfig.defaultCenter.lat;
  const mapLng = values.lng ?? mapConfig.defaultCenter.lng;

  const save = async () => {
    setTouched(true);
    if (!result.valid || saving) return;
    setSaving(true);
    try {
      if (isNew) {
        // `isDefault` is sent on create; the database clears any previous
        // default (address_single_default), so this is one write, not two.
        await book.create(toAddressInput(values, { isDefault }));
      } else {
        const patch = toAddressPatchFromForm(values, existing);
        if (isDefault && !existing.isDefault) patch.isDefault = true;
        // Nothing changed — issue no write rather than a no-op round-trip that
        // could fail for no reason. Leaving the screen is still correct.
        if (Object.keys(patch).length > 0) {
          await book.update(existing.id, patch);
          // Reset only when the copy the context CACHED actually went stale
          // (pin or landmark). Renaming or promoting the address you are
          // currently ordering to must not bounce you through the blocking
          // gate — the list's "Make default" doesn't, and the two surfaces
          // must agree.
          if (patchStalesOrderContext(patch) && contextNeedsReset(orderCtx.context, existing.id)) {
            orderCtx.clear();
          }
        }
      }
      router.back();
    } catch {
      // book.error holds the customer-facing message; the Notice renders it and
      // the customer stays on the form with their input intact.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen background={colors.appBg}>
      <Header title={isNew ? t('addrNewTitle') : t('addrEditTitle')} showBack safeTop />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[columnStyles.column, styles.column]}>
            {book.error ? <Notice title={book.error} tone="blocking" /> : null}

            <View style={styles.map}>
              <LocationPickerMap
                key={recenterSeed}
                lat={mapLat}
                lng={mapLng}
                lang={lang}
                onChange={(lat, lng) => setValues((s) => ({ ...s, lat, lng }))}
                onAddressResolved={setResolvedAddress}
                labels={{
                  locateHint: t('otMapMoveHint'),
                  useMyLocation: t('otUseMyLocation'),
                  setupRequired: t('otMapSetup'),
                }}
              />
            </View>

            {/* Read-only context. Never prefilled into the landmark field —
                that is what made the mandatory-landmark rule satisfiable
                without the customer typing anything. */}
            {resolvedAddress ? (
              <Text variant="caption" tone="tertiary" numberOfLines={2}>
                {`${descCopy.addressPrefix}: ${resolvedAddress}`}
              </Text>
            ) : null}

            {show.location ? <Notice title={show.location} tone="blocking" /> : null}

            <Field
              id="profile-address-description"
              label={descCopy.label}
              required
              value={values.description}
              onChangeText={(v) => setValues((s) => ({ ...s, description: v }))}
              onBlur={() => setTouched(true)}
              error={show.description}
              placeholder={descCopy.placeholder}
              multiline
              inputStyle={styles.multiline}
            />

            <Field
              id="profile-address-label"
              label={copy.labelField}
              value={values.label}
              onChangeText={(v) => setValues((s) => ({ ...s, label: v }))}
              error={show.label}
              placeholder={copy.labelPlaceholder}
            />

            <Field
              id="profile-address-short"
              label={copy.shortAddressField}
              value={values.nationalShortAddress}
              onChangeText={(v) => setValues((s) => ({ ...s, nationalShortAddress: v }))}
              onBlur={() => setTouched(true)}
              error={show.nationalShortAddress}
              hint={copy.shortAddressHint}
              autoCapitalize="characters"
              autoCorrect={false}
              numeric
            />

            {/* An address that is already the default cannot be un-defaulted
                here — there would be no default at all afterwards. It changes by
                promoting a different address in the list. */}
            <SelectableChip
              label={t('addrSetAsDefault')}
              selected={isDefault}
              onPress={() => {
                if (existing?.isDefault) return;
                setIsDefault((d) => !d);
              }}
              style={styles.defaultChip}
            />

            <Button label={t('addrSave')} onPress={() => { void save(); }} loading={saving} style={styles.save} />
            <Button label={t('cancel')} variant="ghost" onPress={() => router.back()} disabled={saving} />

            {/* Recenter escape hatch: the picker only re-centres on remount,
                which a new key forces. */}
            {values.lat !== null && values.lng !== null ? (
              <Button
                label={pick('Re-centre the map on the pin', 'إعادة توسيط الخريطة على العلامة')}
                variant="ghost"
                onPress={() => setRecenterSeed((s) => s + 1)}
              />
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  scroll: { padding: space.s4, paddingBottom: space.s6 * 2, alignItems: 'center' },
  column: { gap: space.s4 },
  map: { overflow: 'hidden' },
  multiline: { minHeight: 84, paddingTop: space.s3, textAlignVertical: 'top' },
  defaultChip: { alignSelf: 'flex-start', minHeight: 44 },
  save: { marginTop: space.s2 },
}));
