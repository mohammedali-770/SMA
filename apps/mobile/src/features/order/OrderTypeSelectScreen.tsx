/**
 * Order-type selection — the full-screen BLOCKING gate. The customer must choose
 * Pickup or Delivery and resolve a valid branch/address here before the menu is
 * usable. The screen never creates an order and never touches payment.
 */
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';

import { Header } from '../../components/Header';
import { LocationPickerMap } from '../../components/LocationPickerMap';
import { OpenClosedBadge } from '../../components/OpenClosedBadge';
import { radius, space } from '../../design-system/generated/tokens';
import { Button } from '../../design-system/ui/Button';
import { SelectableChip } from '../../design-system/ui/Chip';
import { columnStyles } from '../../design-system/ui/ContentColumn';
import { Field } from '../../design-system/ui/Field';
import { Notice } from '../../design-system/ui/Notice';
import { Text } from '../../design-system/ui/Text';
import { checkDescription, descriptionCopy, descriptionMessage } from './locationDescription';
import { useI18n } from '../../i18n/I18nProvider';
import { shouldBecomeDefault } from '../../store/addressBook';
import { mapConfig } from '../../lib/map';
import { distanceKm, type GeoPoint } from '../../lib/geo';
import { useAddressBook, useCart, useCatalog, useOrderContext } from '../../store';
import { isBranchOpen, pickupBranches, resolveDeliveryBranch } from './orderContext';
import { validateCartForBranch } from './cartValidation';
import { makeStyles } from '../../theme/makeStyles';
import { useThemeColors } from '../../theme/ThemeProvider';
import type { Branch, CartItem, OrderType, SavedAddress } from '../../types/models';

type Conflict = { apply: () => void | Promise<void>; invalid: CartItem[] };

export function OrderTypeSelectScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { t, pick, lang, rtlRow } = useI18n();
  const styles = useStyles();
  const { branches, deliveryZones, loading, error, reload, isAvailable } = useCatalog();
  const { context, valid, setPickup, setDelivery } = useOrderContext();
  const cart = useCart();

  const [tab, setTab] = useState<OrderType>(context?.orderType ?? 'pickup');
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const addressBook = useAddressBook();
  const savedAddresses = addressBook.addresses;
  const [deliveryMode, setDeliveryMode] = useState<'choose' | 'new'>('choose');
  const [pickedLat, setPickedLat] = useState<number | null>(null);
  const [pickedLng, setPickedLng] = useState<number | null>(null);
  const [landmark, setLandmark] = useState('');
  const [descTouched, setDescTouched] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const askedLocation = useRef(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const descOffsetRef = useRef(0);

  useEffect(() => {
    if (tab !== 'pickup' || location || askedLocation.current) return;
    askedLocation.current = true;
    let active = true;
    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (active) setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch { /* denied / unavailable → unsorted list */ }
    })();
    return () => { active = false; };
  }, [tab, location]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (valid) { router.replace('/(tabs)'); return true; }
      return true;
    });
    return () => sub.remove();
  }, [valid]);

  const done = useCallback(() => router.replace('/(tabs)'), []);

  const commit = useCallback(async (apply: () => void | Promise<void>) => {
    setBusy(true);
    try { await apply(); done(); }
    catch (e) { setResolveError(e instanceof Error ? e.message : t('somethingWentWrong')); }
    finally { setBusy(false); }
  }, [done, t]);

  const runSelection = useCallback((branchId: string, apply: () => void | Promise<void>) => {
    const v = validateCartForBranch(cart.items, branchId, isAvailable);
    if (!v.allValid) { setConflict({ apply, invalid: v.invalid }); return; }
    void commit(apply);
  }, [cart.items, isAvailable, commit]);

  const choosePickup = (b: Branch) => {
    if (!isBranchOpen(b)) return;
    setResolveError(null);
    runSelection(b.id, () => setPickup(b));
  };

  const chooseSavedAddress = (a: SavedAddress) => {
    const branch = resolveDeliveryBranch({ lat: a.lat, lng: a.lng }, branches, deliveryZones);
    if (!branch) { setResolveError(t('otDeliveryUnavailable')); return; }
    setResolveError(null);
    const saved = checkDescription(a.description);
    if (!saved.valid) {
      setPickedLat(a.lat);
      setPickedLng(a.lng);
      setLandmark('');
      setDescTouched(true);
      setDeliveryMode('new');
      return;
    }
    runSelection(branch.id, () => setDelivery({ branch, addressId: a.id, lat: a.lat, lng: a.lng, description: saved.value }));
  };

  const confirmNewAddress = () => {
    setDescTouched(true);
    const desc = checkDescription(landmark, resolvedAddress);
    if (!desc.valid) {
      scrollRef.current?.scrollTo({ y: Math.max(0, descOffsetRef.current - 24), animated: true });
      return;
    }
    if (pickedLat == null || pickedLng == null) return;
    const branch = resolveDeliveryBranch({ lat: pickedLat, lng: pickedLng }, branches, deliveryZones);
    if (!branch) { setResolveError(t('otDeliveryUnavailable')); return; }
    setResolveError(null);
    runSelection(branch.id, async () => {
      const created = await addressBook.create({
        label: desc.value.slice(0, 60),
        description: desc.value,
        latitude: pickedLat,
        longitude: pickedLng,
        isDefault: shouldBecomeDefault(savedAddresses),
      });
      setDelivery({ branch, addressId: created.id, lat: pickedLat, lng: pickedLng, description: desc.value });
    });
  };

  const removeConflictAndContinue = () => {
    if (!conflict) return;
    conflict.invalid.forEach((it) => cart.removeLine(it.cartItemId));
    const apply = conflict.apply;
    setConflict(null);
    void commit(apply);
  };

  const deliveryPossible = useMemo(
    () => deliveryZones.some((z) => z.isActive) && branches.some((b) => (b.deliveryEnabled ?? true) && isBranchOpen(b)),
    [deliveryZones, branches],
  );

  const sortedPickup = useMemo(() => pickupBranches(branches, location), [branches, location]);
  const mapLat = pickedLat ?? mapConfig.defaultCenter.lat;
  const mapLng = pickedLng ?? mapConfig.defaultCenter.lng;
  const descCheck = checkDescription(landmark, resolvedAddress);
  const descError = descTouched ? descriptionMessage(descCheck.problem, lang) : null;

  return (
    <View style={styles.root}>
      <Header title={t('otTitle')} showBack={valid} onBack={done} safeTop />

      <View style={styles.tabsBar}>
        <View style={[columnStyles.column, styles.tabs]}>
          <SelectableChip label={t('otPickup')} selected={tab === 'pickup'} onPress={() => { setTab('pickup'); setResolveError(null); }} style={styles.tab} />
          <SelectableChip label={t('otDelivery')} selected={tab === 'delivery'} onPress={() => { setTab('delivery'); setResolveError(null); }} style={styles.tab} />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.ember} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Notice title={error} tone="blocking" style={columnStyles.column} />
          <Button label={t('retry')} onPress={reload} variant="secondary" />
        </View>
      ) : tab === 'pickup' ? (
        <ScrollView contentContainerStyle={styles.list}>
          <View style={[columnStyles.column, styles.stack]}>
            <Text variant="title">{t('otPickupBranch')}</Text>
            {sortedPickup.map((b) => {
              const open = isBranchOpen(b);
              const selected = context?.orderType === 'pickup' && context.branchId === b.id;
              const dist = location ? distanceKm(location, { lat: b.latitude, lng: b.longitude }) : null;
              return (
                <Pressable
                  key={b.id}
                  onPress={() => choosePickup(b)}
                  disabled={!open}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !open, selected }}
                  style={[styles.card, selected && styles.cardSelected, !open && styles.cardDisabled]}
                >
                  <View style={[styles.cardTop, rtlRow]}>
                    <Text variant="heading" style={styles.name}>{pick(b.nameEn, b.nameAr)}</Text>
                    <OpenClosedBadge open={open} />
                  </View>
                  {pick(b.addressEn, b.addressAr) ? <Text variant="caption" tone="secondary">{pick(b.addressEn, b.addressAr)}</Text> : null}
                  {dist != null ? <Text variant="label" tone="secondary">{dist.toFixed(1)} {t('otKmAway')}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.listKeyboard}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
          >
            <View style={[columnStyles.column, styles.stack]}>
              {!deliveryPossible ? (
                <Notice title={t('otNoDeliveryZones')} tone="warning" />
              ) : deliveryMode === 'choose' ? (
                <>
                  <Text variant="title">{t('otSavedAddresses')}</Text>
                  {savedAddresses.length === 0 ? (
                    <Text variant="body" tone="secondary">{t('otNoSaved')}</Text>
                  ) : (
                    savedAddresses.map((a) => (
                      <Pressable key={a.id} onPress={() => chooseSavedAddress(a)} accessibilityRole="button" style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
                        <Text variant="heading">{a.label || t('deliveryAddress')}</Text>
                        {a.description ? <Text variant="caption" tone="secondary">{a.description}</Text> : null}
                      </Pressable>
                    ))
                  )}
                  {resolveError ? <Notice title={resolveError} tone="blocking" /> : null}
                  <Button label={t('otAddAddress')} onPress={() => { setResolveError(null); setDeliveryMode('new'); }} variant="secondary" />
                </>
              ) : (
                <>
                  <Text variant="title">{t('otAddAddress')}</Text>
                  <LocationPickerMap
                    lat={mapLat}
                    lng={mapLng}
                    lang={lang}
                    onChange={(la, ln) => { setPickedLat(la); setPickedLng(ln); setResolveError(null); }}
                    onAddressResolved={setResolvedAddress}
                    labels={{ locateHint: t('otMapMoveHint'), useMyLocation: t('otUseMyLocation'), setupRequired: t('otMapSetup') }}
                  />

                  <View onLayout={(e) => { descOffsetRef.current = e.nativeEvent.layout.y; }}>
                    {resolvedAddress ? (
                      <Text variant="caption" tone="tertiary" numberOfLines={2} style={styles.resolvedAddr}>
                        {`${descriptionCopy[lang].addressPrefix}: ${resolvedAddress}`}
                      </Text>
                    ) : null}
                    <Field
                      id="order-type-landmark"
                      label={descriptionCopy[lang].label}
                      required
                      value={landmark}
                      onChangeText={setLandmark}
                      onBlur={() => setDescTouched(true)}
                      onFocus={() => { scrollRef.current?.scrollTo({ y: Math.max(0, descOffsetRef.current - 24), animated: true }); }}
                      error={descError}
                      placeholder={descriptionCopy[lang].placeholder}
                      accessibilityHint={descriptionCopy[lang].placeholder}
                      multiline
                      inputStyle={styles.multiline}
                    />
                  </View>

                  {resolveError ? (
                    <Notice
                      title={resolveError}
                      action={pick('Move the pin to a location we deliver to.', 'حرّك الدبوس إلى موقع نقوم بالتوصيل إليه.')}
                      tone="blocking"
                    />
                  ) : null}

                  <Button label={t('otConfirmLocation')} onPress={confirmNewAddress} disabled={pickedLat == null || pickedLng == null} variant="primary" />
                  <Button label={t('otSavedAddresses')} onPress={() => { setResolveError(null); setDeliveryMode('choose'); }} variant="ghost" />
                </>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {busy ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.onEmber} />
          <Text variant="heading" tone="onEmber" align="center">{t('otResolving')}</Text>
        </View>
      ) : null}

      <Modal visible={conflict !== null} transparent animationType="fade" onRequestClose={() => setConflict(null)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + space.s4 }]}>
            <View style={[columnStyles.column, styles.sheetBody]}>
              <Text variant="title">{t('otCartWarnTitle')}</Text>
              <Text variant="body" tone="secondary">{t('otCartWarnBody')}</Text>
              <View style={styles.sheetActions}>
                <Button label={t('otRemoveContinue')} onPress={removeConflictAndContinue} variant="danger" />
                <Button label={t('otReviewCart')} onPress={() => { setConflict(null); router.push('/cart'); }} variant="secondary" />
                <Button label={t('cancel')} onPress={() => setConflict(null)} variant="ghost" />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((color) => ({
  root: { flex: 1, backgroundColor: color.appBg },
  flex: { flex: 1 },
  tabsBar: {
    padding: space.s4, backgroundColor: color.appSurface,
    borderBottomWidth: 1, borderBottomColor: color.appLine,
    alignItems: 'center' as const,
  },
  tabs: { flexDirection: 'row' as const, gap: space.s2 },
  tab: { flex: 1, minHeight: 44, justifyContent: 'center' as const },
  list: { padding: space.s4, alignItems: 'center' as const },
  listKeyboard: { padding: space.s4, paddingBottom: 260, alignItems: 'center' as const },
  stack: { gap: space.s3 },
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: space.s3, padding: space.s5 },
  card: {
    backgroundColor: color.appSurface, borderRadius: radius.lg, borderCurve: 'continuous' as const,
    padding: space.s4, borderWidth: 1.5, borderColor: color.appLine, gap: space.s1,
  },
  cardSelected: { borderColor: color.ember, backgroundColor: color.appSurface2 },
  cardDisabled: { opacity: 0.55 },
  pressed: { opacity: 0.9 },
  cardTop: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: space.s2 },
  name: { flex: 1 },
  multiline: { minHeight: 72, paddingTop: space.s3, textAlignVertical: 'top' as const },
  resolvedAddr: { marginBottom: space.s2 },
  overlay: {
    position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center' as const, justifyContent: 'center' as const, gap: space.s3,
    backgroundColor: color.scrim,
  },
  backdrop: { flex: 1, backgroundColor: color.scrim, justifyContent: 'flex-end' as const },
  sheet: {
    backgroundColor: color.appSurface,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: space.s5, alignItems: 'center' as const,
  },
  sheetBody: { gap: space.s2 },
  sheetActions: { gap: space.s2, marginTop: space.s3 },
}));
