/**
 * Order-type selection — the full-screen BLOCKING gate. The customer must choose
 * Pickup or Delivery and resolve a valid branch/address here before the menu is
 * usable. Two tabs (Pickup / Delivery, EN+AR, RTL-aware):
 *   - Pickup: branches nearest-first (when location is granted), open/closed
 *     badge, only an OPEN branch is selectable.
 *   - Delivery: pick a saved address OR drop a map pin + a landmark, then the
 *     nearest OPEN branch whose active zone covers the point is resolved. No
 *     covering branch → a friendly "out of zone" message; no selection is made.
 * Every selection runs the cart through validateCartForBranch first; conflicting
 * items are only removed after the customer confirms (never silently).
 *
 * The screen never creates an order and never touches payment — it only sets the
 * order context (the server re-validates branch + zone when the order is placed).
 */
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';

import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { LocationPickerMap } from '../../components/LocationPickerMap';
import { useI18n } from '../../i18n/I18nProvider';
import { addresses } from '../../services/api';
import { mapAddress } from '../../lib/mappers';
import { mapConfig } from '../../lib/map';
import { distanceKm, type GeoPoint } from '../../lib/geo';
import { useCart, useCatalog, useOrderContext } from '../../store';
import { colors, font, radius, shadow, spacing } from '../../theme';
import { isBranchOpen, pickupBranches, resolveDeliveryBranch } from './orderContext';
import { validateCartForBranch } from './cartValidation';
import type { Branch, CartItem, OrderType, SavedAddress } from '../../types/models';

type Conflict = { apply: () => void | Promise<void>; invalid: CartItem[] };

export function OrderTypeSelectScreen() {
  const insets = useSafeAreaInsets();
  const { t, pick } = useI18n();
  const { branches, deliveryZones, loading, error, reload, isAvailable } = useCatalog();
  const { context, valid, setPickup, setDelivery } = useOrderContext();
  const cart = useCart();

  const [tab, setTab] = useState<OrderType>(context?.orderType ?? 'pickup');
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [deliveryMode, setDeliveryMode] = useState<'choose' | 'new'>('choose');
  const [pickedLat, setPickedLat] = useState<number | null>(null);
  const [pickedLng, setPickedLng] = useState<number | null>(null);
  const [landmark, setLandmark] = useState('');
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const askedLocation = useRef(false);

  // Load the customer's saved addresses once.
  useEffect(() => {
    addresses.listMine()
      .then((rows) => setSavedAddresses(rows.map(mapAddress)))
      .catch(() => setSavedAddresses([]));
  }, []);

  // Ask for location only when the Pickup tab is opened (optional — the list
  // still works without it, just unsorted).
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

  // BLOCKING: hardware back only leaves when a valid context already exists (i.e.
  // the customer arrived here via "Change"); otherwise it is swallowed.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (valid) { router.replace('/(tabs)'); return true; }
      return true;
    });
    return () => sub.remove();
  }, [valid]);

  const done = useCallback(() => router.replace('/(tabs)'), []);

  // Apply a selection, but validate the cart against the target branch first.
  const commit = useCallback(async (apply: () => void | Promise<void>) => {
    setBusy(true);
    try { await apply(); done(); }
    catch (e) { setResolveError(e instanceof Error ? e.message : t('somethingWentWrong')); }
    finally { setBusy(false); }
  }, [done, t]);

  // Validate the cart against the target branch; only surface the conflict sheet
  // when some line is no longer orderable (availability mirrors the menu filter).
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
    runSelection(branch.id, () => setDelivery({ branch, addressId: a.id, lat: a.lat, lng: a.lng, description: a.description || null }));
  };

  const confirmNewAddress = () => {
    if (pickedLat == null || pickedLng == null) return;
    const branch = resolveDeliveryBranch({ lat: pickedLat, lng: pickedLng }, branches, deliveryZones);
    if (!branch) { setResolveError(t('otDeliveryUnavailable')); return; }
    setResolveError(null);
    const desc = landmark.trim() || null;
    runSelection(branch.id, async () => {
      const created = await addresses.create({
        label: (landmark.trim() || pick('Delivery location', 'موقع التوصيل')).slice(0, 60),
        description: desc,
        latitude: pickedLat,
        longitude: pickedLng,
        isDefault: savedAddresses.length === 0,
      });
      setDelivery({ branch, addressId: created.id, lat: pickedLat, lng: pickedLng, description: desc });
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

  return (
    <View style={styles.root}>
      <Header title={t('otTitle')} showBack={valid} onBack={done} />

      {/* Pickup / Delivery tabs */}
      <View style={styles.tabs}>
        <TabButton label={t('otPickup')} active={tab === 'pickup'} onPress={() => { setTab('pickup'); setResolveError(null); }} />
        <TabButton label={t('otDelivery')} active={tab === 'delivery'} onPress={() => { setTab('delivery'); setResolveError(null); }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.purple} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.err}>{error}</Text>
          <Button label={t('retry')} onPress={reload} variant="secondary" />
        </View>
      ) : tab === 'pickup' ? (
        <ScrollView contentContainerStyle={styles.list}>
          <Text style={styles.sectionTitle}>{t('otPickupBranch')}</Text>
          {sortedPickup.map((b) => {
            const open = isBranchOpen(b);
            const selected = context?.orderType === 'pickup' && context.branchId === b.id;
            const dist = location ? distanceKm(location, { lat: b.latitude, lng: b.longitude }) : null;
            return (
              <Pressable
                key={b.id}
                onPress={() => choosePickup(b)}
                disabled={!open}
                style={[styles.card, shadow.card, selected && styles.cardSelected, !open && styles.cardDisabled]}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.name}>{pick(b.nameEn, b.nameAr)}</Text>
                  <View style={[styles.badge, open ? styles.badgeOpen : styles.badgeClosed]}>
                    <Text style={[styles.badgeText, { color: open ? colors.success : colors.red }]}>{open ? t('open') : t('closed')}</Text>
                  </View>
                </View>
                {pick(b.addressEn, b.addressAr) ? <Text style={styles.address}>{pick(b.addressEn, b.addressAr)}</Text> : null}
                {dist != null ? <Text style={styles.meta}>{dist.toFixed(1)} {t('otKmAway')}</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        // Delivery tab
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {!deliveryPossible ? (
            <View style={styles.notice}><Text style={styles.noticeText}>{t('otNoDeliveryZones')}</Text></View>
          ) : deliveryMode === 'choose' ? (
            <>
              <Text style={styles.sectionTitle}>{t('otSavedAddresses')}</Text>
              {savedAddresses.length === 0 ? (
                <Text style={styles.muted}>{t('otNoSaved')}</Text>
              ) : (
                savedAddresses.map((a) => (
                  <Pressable key={a.id} onPress={() => chooseSavedAddress(a)} style={[styles.card, shadow.card]}>
                    <Text style={styles.name}>{a.label || t('deliveryAddress')}</Text>
                    {a.description ? <Text style={styles.address}>{a.description}</Text> : null}
                  </Pressable>
                ))
              )}
              {resolveError ? <Text style={styles.err}>{resolveError}</Text> : null}
              <Button label={t('otAddAddress')} onPress={() => { setResolveError(null); setDeliveryMode('new'); }} variant="secondary" style={{ marginTop: spacing.md }} />
            </>
          ) : (
            <>
              <Text style={styles.sectionTitle}>{t('otAddAddress')}</Text>
              <LocationPickerMap
                lat={mapLat}
                lng={mapLng}
                onChange={(la, ln) => { setPickedLat(la); setPickedLng(ln); setResolveError(null); }}
                labels={{ moveHint: t('otMapMoveHint'), useMyLocation: t('otUseMyLocation'), setupRequired: t('otMapSetup') }}
              />
              <Text style={[styles.label, { marginTop: spacing.md }]}>{t('otLocationDesc')}</Text>
              <TextInput
                value={landmark}
                onChangeText={setLandmark}
                placeholder={t('otLocationDescPlaceholder')}
                placeholderTextColor={colors.muted}
                style={styles.input}
                multiline
              />
              {resolveError ? <Text style={styles.err}>{resolveError}</Text> : null}
              <Button
                label={t('otConfirmLocation')}
                onPress={confirmNewAddress}
                disabled={pickedLat == null || pickedLng == null}
                variant="danger"
                style={{ marginTop: spacing.md }}
              />
              <Button label={t('otSavedAddresses')} onPress={() => { setResolveError(null); setDeliveryMode('choose'); }} variant="ghost" style={{ marginTop: spacing.xs }} />
            </>
          )}
        </ScrollView>
      )}

      {busy ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.purple} />
          <Text style={styles.overlayText}>{t('otResolving')}</Text>
        </View>
      ) : null}

      {/* Cart-conflict confirmation (never silently drops items) */}
      <Modal visible={conflict !== null} transparent animationType="fade" onRequestClose={() => setConflict(null)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <Text style={styles.sheetTitle}>{t('otCartWarnTitle')}</Text>
            <Text style={styles.sheetBody}>{t('otCartWarnBody')}</Text>
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Button label={t('otRemoveContinue')} onPress={removeConflictAndContinue} variant="danger" />
              <Button label={t('otReviewCart')} onPress={() => { setConflict(null); router.push('/cart'); }} variant="secondary" />
              <Button label={t('cancel')} onPress={() => setConflict(null)} variant="ghost" />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  tabs: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.purple, alignItems: 'center', backgroundColor: colors.white },
  tabActive: { backgroundColor: colors.purple },
  tabText: { color: colors.purple, fontWeight: '800', fontSize: font.md },
  tabTextActive: { color: colors.white },

  list: { padding: spacing.lg, gap: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  sectionTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  muted: { fontSize: font.sm, color: colors.muted },
  label: { fontSize: font.sm, fontWeight: '800', color: colors.text },

  card: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1.5, borderColor: 'transparent', gap: spacing.xs },
  cardSelected: { borderColor: colors.purple },
  cardDisabled: { opacity: 0.55 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: font.md, fontWeight: '800', color: colors.text, flex: 1, paddingRight: spacing.sm },
  address: { fontSize: font.sm, color: colors.muted },
  meta: { fontSize: font.sm, color: colors.text, fontWeight: '700' },
  badge: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  badgeOpen: { backgroundColor: '#e7f6ee' },
  badgeClosed: { backgroundColor: '#fdeaec' },
  badgeText: { fontSize: font.xs, fontWeight: '800' },

  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, minHeight: 64, textAlignVertical: 'top', fontSize: font.md, color: colors.text, backgroundColor: colors.white, marginTop: spacing.xs },
  notice: { backgroundColor: '#fdeaec', padding: spacing.lg, borderRadius: radius.md },
  noticeText: { color: colors.red, fontWeight: '700', fontSize: font.sm },
  err: { color: colors.red, fontWeight: '700', fontSize: font.sm, marginTop: spacing.sm },

  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: 'rgba(246,245,250,0.75)' },
  overlayText: { color: colors.text, fontWeight: '800', fontSize: font.md },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl },
  sheetTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text },
  sheetBody: { fontSize: font.md, color: colors.text, marginTop: spacing.sm, lineHeight: 21 },
});
