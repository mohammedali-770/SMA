/**
 * Checkout. All money math is a PREVIEW — place_order recomputes subtotal,
 * modifiers, delivery fee, coupon, VAT and loyalty server-side and is the only
 * order-creation path. Rules enforced here mirror the server so the user gets
 * fast feedback:
 *   - Order type is NOT preselected; the customer picks delivery or pickup.
 *   - The branch must be open (is_active) to place an order.
 *   - Delivery requires meeting the branch minimum.
 * The idempotency key from the cart store makes a retried submit safe.
 */
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { useI18n } from '../../i18n/I18nProvider';
import { addresses, coupons, orders, payments } from '../../services/api';
import { mapAddress } from '../../lib/mappers';
import { legalTitle } from '../../lib/legal';
import {
  availableMethods, checkoutBlocked, onlineUnavailableCashOn, resolveDefaultMethod,
  type PaymentMethod,
} from '../../lib/payment';
import { pointInPolygon } from '../../lib/geo';
import { LocationPickerMap } from '../../components/LocationPickerMap';
import { useAuth, useCart, useCatalog } from '../../store';
import { colors, font, radius, spacing } from '../../theme';
import { formatSAR } from '../../utils/format';
import type { OrderType, SavedAddress } from '../../types/models';

export function CheckoutScreen() {
  const insets = useSafeAreaInsets();
  const { t, pick, lang } = useI18n();
  const { profile } = useAuth();
  const { selectedBranch, brand, loyalty, payment, deliveryZones, branchIsOpen } = useCatalog();
  const cart = useCart();

  const [orderType, setOrderType] = useState<OrderType | null>(null); // never preselected
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(resolveDefaultMethod(payment));
  const [addressList, setAddressList] = useState<SavedAddress[]>([]);
  const [addressId, setAddressId] = useState<string | null>(null);
  // Map-picked delivery location (null until the customer confirms one).
  const [pickedLat, setPickedLat] = useState<number | null>(null);
  const [pickedLng, setPickedLng] = useState<number | null>(null);
  const [addrLabel, setAddrLabel] = useState('');
  // Bump to remount + recenter the map (saved-address tap / geolocation), without
  // remounting on every pin drag.
  const [recenterSeed, setRecenterSeed] = useState(0);
  const [couponCode, setCouponCode] = useState('');
  const [couponResult, setCouponResult] = useState<{ ok: boolean; message: string; discount: number } | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState(false);
  const [notes, setNotes] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Online-payment (Tap) flow overlay. null = not paying.
  type PayState = 'opening' | 'verifying' | 'pending' | 'failed' | 'cancelled' | 'expired' | 'error';
  const [payFlow, setPayFlow] = useState<{ state: PayState; orderId: string; message?: string } | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const branchOpen = branchIsOpen(selectedBranch);
  const vatPct = brand?.vatPercentage ?? 15;

  // Payment availability (admin-controlled; place_order re-validates server-side).
  const payMethods = availableMethods(payment);
  const paymentBlocked = checkoutBlocked(payment);
  const showOnlineOutageNotice = onlineUnavailableCashOn(payment);

  // Keep the chosen method valid as availability changes (e.g. admin turns online
  // off mid-session). Never assume cash unless it's actually enabled.
  useEffect(() => {
    setPaymentMethod((prev) =>
      prev && payMethods.includes(prev) ? prev : resolveDefaultMethod(payment),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment.onlineEnabled, payment.cashEnabled, payment.defaultMethod]);

  useEffect(() => {
    addresses.listMine()
      .then((rows) => {
        const mapped = rows.map(mapAddress);
        setAddressList(mapped);
        const def = mapped.find((a) => a.isDefault) ?? mapped[0];
        if (def && Number.isFinite(def.lat) && Number.isFinite(def.lng)) {
          setAddressId(def.id);
          setPickedLat(def.lat);
          setPickedLng(def.lng);
        }
      })
      .catch(() => setAddressList([]));
  }, []);

  // Select a saved location: use its coords + recenter the map on it.
  const chooseSavedAddress = (a: SavedAddress) => {
    setAddressId(a.id);
    setPickedLat(a.lat);
    setPickedLng(a.lng);
    setRecenterSeed((s) => s + 1);
  };

  const applyCoupon = async () => {
    const code = couponCode.trim();
    if (!code) return;
    setCheckingCoupon(true);
    setCouponResult(null);
    try {
      const res = await coupons.validate(code, cart.subtotal);
      setCouponResult({ ok: res.valid, message: res.message, discount: Number(res.discount_amount) || 0 });
    } catch (e) {
      setCouponResult({ ok: false, message: e instanceof Error ? e.message : t('somethingWentWrong'), discount: 0 });
    } finally {
      setCheckingCoupon(false);
    }
  };

  // ---- Preview math (display only) ----
  const availablePoints = profile?.loyaltyPoints ?? 0;
  const loyaltyEnabled = Boolean(loyalty?.isEnabled) && availablePoints >= (loyalty?.minPointsToRedeem ?? Infinity);
  const deliveryFee = orderType === 'delivery' ? (selectedBranch?.deliveryFee ?? 0) : 0;
  const couponDiscount = couponResult?.ok ? couponResult.discount : 0;
  const loyaltyDiscountEst = redeemPoints && loyalty
    ? Math.min(availablePoints * loyalty.discountPerPoint, Math.max(0, cart.subtotal - couponDiscount))
    : 0;
  const totalEst = Math.max(0, cart.subtotal + deliveryFee - couponDiscount - loyaltyDiscountEst);

  const belowMin = orderType === 'delivery'
    && cart.subtotal < (selectedBranch?.minDeliveryOrder ?? 0);

  // ---- Delivery serviceability pre-check (UX only; place_order is authoritative) ----
  const branchZone = deliveryZones.find((z) => z.branchId === selectedBranch?.id && z.isActive);
  const branchDeliveryOff = selectedBranch
    ? !(selectedBranch.deliveryEnabled ?? true) || (selectedBranch.deliveryTemporarilyClosed ?? false)
    : false;
  const hasPickedCoords = pickedLat != null && pickedLng != null;
  const insideZone = Boolean(
    hasPickedCoords && branchZone
    && pointInPolygon({ lat: pickedLat as number, lng: pickedLng as number }, branchZone.geojson),
  );
  const deliveryBlockReason: string | null =
    orderType !== 'delivery' ? null
    : branchDeliveryOff ? pick('Delivery is currently closed for this branch', 'التوصيل مغلق حالياً لهذا الفرع')
    : !hasPickedCoords ? pick('Please select your location on the map', 'يرجى تحديد موقعك على الخريطة')
    : !branchZone ? pick('Delivery is not available for this location', 'التوصيل غير متاح لهذا الموقع')
    : !insideZone ? pick('Outside delivery area', 'خارج منطقة التوصيل')
    : null;

  const blockReason = useMemo(() => {
    if (!selectedBranch) return t('selectBranchCta');
    if (!branchOpen) return t('branchClosedError');
    if (!orderType) return t('chooseOrderType');
    if (belowMin) return `${t('minOrderError')} ${formatSAR(selectedBranch?.minDeliveryOrder ?? 0, lang)}`;
    if (paymentBlocked || !paymentMethod) return pick('No payment method is currently available.', 'لا توجد طريقة دفع متاحة حالياً.');
    if (deliveryBlockReason) return deliveryBlockReason;
    return null;
  }, [selectedBranch, branchOpen, orderType, belowMin, lang, t, paymentBlocked, paymentMethod, pick, deliveryBlockReason]);

  const canPlace = !blockReason && cart.items.length > 0 && !placing;

  const placeOrder = async () => {
    if (!canPlace || !selectedBranch || !orderType) return;
    setError(null);
    setPlacing(true);
    try {
      // Resolve the delivery address: reuse the selected saved address when the
      // pin hasn't moved off it, otherwise persist the map-picked coordinates.
      let deliveryAddressId: string | null = null;
      if (orderType === 'delivery') {
        if (pickedLat == null || pickedLng == null) throw new Error(pick('Please select your location on the map', 'يرجى تحديد موقعك على الخريطة'));
        const saved = addressList.find((a) => a.id === addressId);
        if (saved && saved.lat === pickedLat && saved.lng === pickedLng) {
          deliveryAddressId = saved.id;
        } else {
          const created = await addresses.create({
            label: addrLabel.trim() || pick('Delivery location', 'موقع التوصيل'),
            latitude: pickedLat,
            longitude: pickedLng,
            isDefault: addressList.length === 0,
          });
          deliveryAddressId = created.id;
        }
      }

      const orderInput = {
        branchId: selectedBranch.id,
        orderType,
        items: cart.toOrderItems(),
        addressId: deliveryAddressId,
        couponCode: couponResult?.ok ? couponCode.trim() : null,
        notes: notes.trim() || null,
        loyaltyPoints: redeemPoints ? availablePoints : 0,
        idempotencyKey: cart.idempotencyKey,
        paymentMethod,
      };
      const isOnline = paymentMethod === 'online';
      // Online orders are created pending and are NOT sent to the POS until the
      // payment is verified (the DB trigger holds them in 'awaiting_payment');
      // cash orders sync to the POS now, as before.
      const order = isOnline ? await orders.place(orderInput) : await orders.placeAndSync(orderInput);
      cart.clear();

      // Zero-total (e.g. full coupon/loyalty) never touches Tap — go straight to
      // the receipt. Online orders with a real total go through Tap checkout.
      if (isOnline && Number(order.total) > 0) {
        await runTapPayment(order.id);
      } else {
        router.replace(`/receipt/${order.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('somethingWentWrong'));
    } finally {
      setPlacing(false);
    }
  };

  // ---- Tap online-payment flow (open hosted checkout → server verify) --------
  const runTapPayment = async (orderId: string) => {
    setPayFlow({ state: 'opening', orderId });
    try {
      const init = await payments.initiate(orderId, lang === 'ar' ? 'ar' : 'en');
      if (init.status === 'already_paid') { router.replace(`/receipt/${orderId}`); return; }
      if (init.status === 'disabled' || (!init.checkoutUrl && !init.needsVerify)) {
        setPayFlow({ state: 'error', orderId, message: t('payUnavailable') });
        return;
      }
      if (init.checkoutUrl) {
        // Opens the Tap hosted page; returns when it redirects to spicymeal://.
        // The result is NOT trusted — server verify is authoritative.
        await WebBrowser.openAuthSessionAsync(init.checkoutUrl, 'spicymeal://payment/return');
      }
      await verifyPayment(orderId);
    } catch (e) {
      setPayFlow({ state: 'error', orderId, message: e instanceof Error ? e.message : t('somethingWentWrong') });
    }
  };

  const verifyPayment = async (orderId: string) => {
    setPayFlow({ state: 'verifying', orderId });
    setPayBusy(true);
    try {
      const res = await payments.verify(orderId);
      if (res.status === 'paid') { setPayFlow(null); router.replace(`/receipt/${orderId}`); return; }
      const state: PayState =
        res.status === 'cancelled' ? 'cancelled'
        : res.status === 'expired' ? 'expired'
        : res.status === 'pending' ? 'pending'
        : 'failed';
      const msgKey = res.messageKey && res.messageKey.startsWith('pay') ? res.messageKey : (
        state === 'cancelled' ? 'payCancelled' : state === 'expired' ? 'payExpired' : state === 'pending' ? 'payPending' : 'payFailed'
      );
      setPayFlow({ state, orderId, message: t(msgKey as never) });
    } catch (e) {
      setPayFlow({ state: 'error', orderId, message: e instanceof Error ? e.message : t('somethingWentWrong') });
    } finally {
      setPayBusy(false);
    }
  };

  const dismissPayFlowToReceipt = () => {
    const id = payFlow?.orderId;
    setPayFlow(null);
    if (id) router.replace(`/receipt/${id}`);
  };

  return (
    <View style={styles.root}>
      <Header title={t('checkout')} showBack />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 190 }} keyboardShouldPersistTaps="handled">
          {/* Order type — no preselection */}
          <Text style={styles.sectionTitle}>{t('orderType')}</Text>
          <Text style={styles.hint}>{t('chooseOrderType')}</Text>
          <View style={styles.segment}>
            <SegmentBtn label={t('delivery')} active={orderType === 'delivery'} onPress={() => setOrderType('delivery')} />
            <SegmentBtn label={t('pickup')} active={orderType === 'pickup'} onPress={() => setOrderType('pickup')} />
          </View>

          {/* Payment method — availability is admin-controlled */}
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>{pick('Payment method', 'طريقة الدفع')}</Text>
            {paymentBlocked ? (
              <Text style={[styles.note, { color: colors.red, fontWeight: '700' }]}>
                {pick('No payment method is currently available.', 'لا توجد طريقة دفع متاحة حالياً.')}
              </Text>
            ) : (
              <>
                <View style={styles.segment}>
                  {payMethods.map((m) => {
                    const label = m === 'online'
                      ? pick('Online Payment', 'الدفع الإلكتروني')
                      : orderType === 'delivery'
                        ? pick('Cash on Delivery', 'نقداً عند التوصيل')
                        : pick('Cash on Pickup', 'نقداً عند الاستلام');
                    return <SegmentBtn key={m} label={label} active={paymentMethod === m} onPress={() => setPaymentMethod(m)} />;
                  })}
                </View>
                {paymentMethod === 'cash' ? (
                  <Text style={styles.note}>{pick('Pay in cash when you receive your order.', 'يُدفع المبلغ نقداً عند استلام طلبك.')}</Text>
                ) : null}
                {showOnlineOutageNotice ? (
                  <Text style={[styles.note, { color: colors.purple, fontWeight: '700' }]}>
                    {pick('Online payment is currently unavailable. Cash payment is enabled.', 'الدفع الإلكتروني غير متاح حالياً. الدفع النقدي مفعّل.')}
                  </Text>
                ) : null}
              </>
            )}
          </View>

          {/* Delivery location — map picker + optional details */}
          {orderType === 'delivery' ? (
            <View style={styles.block}>
              <Text style={styles.sectionTitle}>{pick('Select your delivery location', 'حدّد موقع التوصيل')}</Text>
              <LocationPickerMap
                key={recenterSeed}
                lat={pickedLat ?? selectedBranch?.latitude ?? 24.7136}
                lng={pickedLng ?? selectedBranch?.longitude ?? 46.6753}
                onChange={(la, ln) => { setPickedLat(la); setPickedLng(ln); setAddressId(null); }}
                labels={{
                  moveHint: pick('Move the pin to your exact location', 'حرّك الدبوس إلى موقعك بالضبط'),
                  useMyLocation: pick('Use my location', 'استخدم موقعي'),
                  setupRequired: pick('Map setup required — ask support to enable the map.', 'إعداد الخريطة مطلوب — تواصل مع الدعم لتفعيل الخريطة.'),
                }}
              />

              <TextInput
                value={addrLabel}
                onChangeText={setAddrLabel}
                placeholder={pick('Building / street / apartment (optional)', 'المبنى / الشارع / الشقة (اختياري)')}
                placeholderTextColor={colors.muted}
                style={[styles.couponInput, { marginTop: spacing.md }]}
              />

              {addressList.length > 0 ? (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={styles.note}>{pick('Saved locations', 'المواقع المحفوظة')}</Text>
                  {addressList.map((a) => (
                    <Pressable
                      key={a.id}
                      style={[styles.addrRow, addressId === a.id && styles.addrRowActive]}
                      onPress={() => chooseSavedAddress(a)}
                    >
                      <View style={[styles.radioDot, addressId === a.id && styles.radioDotOn]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.addrLabel}>{a.label || t('deliveryAddress')}</Text>
                        {a.description ? <Text style={styles.addrDesc}>{a.description}</Text> : null}
                      </View>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {deliveryBlockReason ? (
                <Text style={[styles.note, { color: colors.red, fontWeight: '700', marginTop: spacing.sm }]}>{deliveryBlockReason}</Text>
              ) : null}
            </View>
          ) : null}

          {/* Coupon */}
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>{t('couponTitle')}</Text>
            <View style={styles.couponRow}>
              <TextInput
                value={couponCode}
                onChangeText={(v) => { setCouponCode(v); setCouponResult(null); }}
                placeholder={t('couponPlaceholder')}
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
                style={styles.couponInput}
              />
              <Button label={t('applyCoupon')} onPress={applyCoupon} loading={checkingCoupon} variant="secondary" style={styles.couponBtn} />
            </View>
            {couponResult ? (
              <Text style={[styles.couponMsg, { color: couponResult.ok ? colors.success : colors.red }]}>
                {couponResult.ok ? `${t('couponApplied')} −${formatSAR(couponResult.discount, lang)}` : couponResult.message}
              </Text>
            ) : null}
          </View>

          {/* Loyalty */}
          {loyaltyEnabled ? (
            <View style={styles.block}>
              <Pressable style={styles.toggleRow} onPress={() => setRedeemPoints((v) => !v)}>
                <View style={[styles.switch, redeemPoints && styles.switchOn]}>
                  <View style={[styles.knob, redeemPoints && styles.knobOn]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleLabel}>{t('useLoyalty')}</Text>
                  <Text style={styles.toggleSub}>{availablePoints} {t('pointsAvailable')}</Text>
                </View>
              </Pressable>
              <Text style={styles.note}>{t('redeemHint')}</Text>
            </View>
          ) : null}

          {/* Notes */}
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>{t('orderNotes')}</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder={t('notesPlaceholder')}
              placeholderTextColor={colors.muted}
              style={styles.notesInput}
              multiline
            />
          </View>

          {/* Totals preview */}
          <View style={styles.totals}>
            <Row label={t('subtotal')} value={formatSAR(cart.subtotal, lang)} />
            {orderType === 'delivery' ? <Row label={t('deliveryFee')} value={formatSAR(deliveryFee, lang)} /> : null}
            {couponDiscount > 0 ? <Row label={t('discount')} value={`−${formatSAR(couponDiscount, lang)}`} accent /> : null}
            {loyaltyDiscountEst > 0 ? <Row label={t('loyaltyDiscount')} value={`−${formatSAR(loyaltyDiscountEst, lang)}`} accent /> : null}
            <Row label={t('vat')} value="" muted />
            <View style={styles.totalDivider} />
            <Row label={t('total')} value={formatSAR(totalEst, lang)} big />
            <Text style={styles.serverNote}>{`* ${pick('Final amounts are confirmed by the server.', 'يتم تأكيد المبالغ النهائية من الخادم.')}`}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Sticky place-order */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
        {/* Policy links shown before Confirm & Order (does not block checkout). */}
        <Text style={styles.policy}>
          {pick('By placing this order, you agree to the ', 'بإتمام الطلب، فإنك توافق على ')}
          <Text style={styles.policyLink} onPress={() => router.push('/legal/cancellation_refund_policy')}>{legalTitle('cancellation_refund_policy', lang)}</Text>
          {pick(', ', '، ')}
          <Text style={styles.policyLink} onPress={() => router.push('/legal/delivery_pickup_policy')}>{legalTitle('delivery_pickup_policy', lang)}</Text>
          {pick(', and ', '، و')}
          <Text style={styles.policyLink} onPress={() => router.push('/legal/payment_policy')}>{legalTitle('payment_policy', lang)}</Text>
          {'.'}
        </Text>
        {blockReason ? <Text style={styles.blockReason}>{blockReason}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          label={placing ? t('placingOrder') : t('placeOrder')}
          onPress={placeOrder}
          disabled={!canPlace}
          loading={placing}
          variant="danger"
        />
      </View>

      {/* Online-payment (Tap) overlay */}
      <Modal visible={payFlow !== null} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.payBackdrop}>
          <View style={styles.payCard}>
            <Text style={styles.payTitle}>{t('payTitle')}</Text>
            {payFlow && (payFlow.state === 'opening' || payFlow.state === 'verifying') ? (
              <View style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg }}>
                <ActivityIndicator size="large" color={colors.purple} />
                <Text style={styles.payMsg}>{t(payFlow.state === 'opening' ? 'payOpening' : 'payVerifying')}</Text>
              </View>
            ) : payFlow ? (
              <>
                <Text style={styles.payMsg}>{payFlow.message ?? t('payFailed')}</Text>
                <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                  {payFlow.state === 'pending' ? (
                    <Button label={t('payVerifyAgain')} onPress={() => void verifyPayment(payFlow.orderId)} loading={payBusy} variant="danger" />
                  ) : (
                    <Button label={t('payTryAgain')} onPress={() => void runTapPayment(payFlow.orderId)} loading={payBusy} variant="danger" />
                  )}
                  <Button label={t('payViewOrder')} onPress={dismissPayFlowToReceipt} variant="secondary" />
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SegmentBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segBtn, active && styles.segBtnActive]} onPress={onPress} accessibilityRole="button">
      <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
    </Pressable>
  );
}

function Row({ label, value, big, accent, muted }: { label: string; value: string; big?: boolean; accent?: boolean; muted?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, big && styles.rowLabelBig, muted && styles.rowMuted]}>{label}</Text>
      <Text style={[styles.rowValue, big && styles.rowValueBig, accent && { color: colors.success }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  sectionTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  hint: { fontSize: font.sm, color: colors.muted, marginBottom: spacing.sm },
  block: { marginTop: spacing.xl },
  note: { fontSize: font.sm, color: colors.muted, marginTop: spacing.xs },

  segment: { flexDirection: 'row', gap: spacing.md },
  segBtn: {
    flex: 1, paddingVertical: spacing.lg, borderRadius: radius.md, backgroundColor: colors.white,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'center',
  },
  segBtnActive: { borderColor: colors.purple, backgroundColor: '#f1edfb' },
  segText: { fontSize: font.md, fontWeight: '800', color: colors.muted },
  segTextActive: { color: colors.purple },

  addrRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginTop: spacing.sm,
    backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border,
  },
  addrRowActive: { borderColor: colors.purple },
  radioDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border },
  radioDotOn: { borderColor: colors.purple, backgroundColor: colors.purple },
  addrLabel: { fontSize: font.md, fontWeight: '800', color: colors.text },
  addrDesc: { fontSize: font.sm, color: colors.muted },

  couponRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  couponInput: {
    flex: 1, borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: font.md, color: colors.text, backgroundColor: colors.white,
  },
  couponBtn: { minWidth: 96 },
  couponMsg: { marginTop: spacing.sm, fontSize: font.sm, fontWeight: '700' },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switch: { width: 48, height: 28, borderRadius: 14, backgroundColor: colors.border, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: colors.purple },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.white },
  knobOn: { alignSelf: 'flex-end' },
  toggleLabel: { fontSize: font.md, fontWeight: '800', color: colors.text },
  toggleSub: { fontSize: font.sm, color: colors.muted },

  notesInput: {
    borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md,
    minHeight: 76, textAlignVertical: 'top', fontSize: font.md, color: colors.text, backgroundColor: colors.white,
  },

  totals: { marginTop: spacing.xxl, backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.xs },
  rowLabel: { fontSize: font.md, color: colors.text, fontWeight: '600' },
  rowLabelBig: { fontSize: font.lg, fontWeight: '800' },
  rowMuted: { color: colors.muted, fontSize: font.sm },
  rowValue: { fontSize: font.md, color: colors.text, fontWeight: '700' },
  rowValueBig: { fontSize: font.lg, fontWeight: '800', color: colors.purple },
  totalDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  serverNote: { fontSize: font.xs, color: colors.muted, marginTop: spacing.sm },

  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.white,
    borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm,
  },
  blockReason: { color: colors.warning, fontWeight: '700', fontSize: font.sm, textAlign: 'center' },
  error: { color: colors.red, fontWeight: '700', fontSize: font.sm, textAlign: 'center' },
  policy: { color: colors.muted, fontSize: font.xs, lineHeight: 17, textAlign: 'center' },
  policyLink: { color: colors.purple, fontWeight: '800' },

  payBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  payCard: { width: '100%', maxWidth: 400, backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.xl },
  payTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: spacing.sm },
  payMsg: { fontSize: font.md, color: colors.text, textAlign: 'center', lineHeight: 20 },
});
