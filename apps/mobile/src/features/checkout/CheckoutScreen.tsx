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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Notice, secondaryTextStyle } from '../../components/Notice';
import { QuantityStepper } from '../../components/QuantityStepper';
import { checkDescription, descriptionCopy, descriptionMessage } from '../order/locationDescription';
import { decideQuantityChange, resolveBlockReason, type BlockReason } from './checkoutGuards';
import { canSubmitOrder, computePreviewTotals, lineTotal } from './previewTotals';
import { useI18n } from '../../i18n/I18nProvider';
import { addresses, checkout, coupons, orders, payments } from '../../services/api';
import { mapAddress } from '../../lib/mappers';
import { legalTitle } from '../../lib/legal';
import {
  availableMethods, checkoutBlocked, onlineUnavailableCashOn, resolveDefaultMethod,
  type PaymentMethod,
} from '../../lib/payment';
import { pointInPolygon } from '../../lib/geo';
import { LocationPickerMap } from '../../components/LocationPickerMap';
import { useAuth, useCart, useCatalog, useOrderContext } from '../../store';
import { colors, font, radius, spacing } from '../../theme';
import { formatSAR } from '../../utils/format';
import { Price } from '../../components/Price';
import type { OrderType, SavedAddress } from '../../types/models';
import { recoverPendingSession } from './pendingSession';
import { clearPendingSession, loadPendingSession, savePendingSession } from './pendingSessionStore';
import { startCheckoutHandoff, type CheckoutHandoffResult } from './checkoutHandoff';
import { chooseCheckoutTransport } from './paymentFlow';

export function CheckoutScreen() {
  const insets = useSafeAreaInsets();
  const { t, pick, lang, rtlText, rtlRow } = useI18n();
  const { profile } = useAuth();
  const { selectedBranch, brand, loyalty, payment, deliveryZones, branchIsOpen } = useCatalog();
  const cart = useCart();

  // Order type + branch are PRESELECTED from the order context (chosen in the
  // blocking selection flow) — never re-picked inline. "Change" re-opens that
  // flow after a confirmation (see the modal below).
  const orderCtx = useOrderContext();
  const orderType: OrderType | null = orderCtx.context?.orderType ?? null;
  const [showTypeChange, setShowTypeChange] = useState(false);
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
  // Mandatory delivery landmark. Seeded from the address chosen in the blocking
  // order-type gate so the customer never retypes it (section 2).
  const [addrDesc, setAddrDesc] = useState<string>(orderCtx.context?.deliveryDescription ?? '');
  const [descTouched, setDescTouched] = useState(false);
  // Reverse-geocoded address for the current pin. Context only — never the
  // delivery guidance, and never written into the description field.
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  // Set while a quantity change is settling; blocks submission so the server is
  // never handed a cart the customer has not seen priced, and drives the
  // stepper's `busy` state. Cleared by an effect once the cart re-renders (below)
  // — NOT synchronously in the handler, which was a no-op that never survived a
  // render.
  const [recalcLine, setRecalcLine] = useState<string | null>(null);
  // Synchronous twin of recalcLine. A second tap dispatched in the SAME frame,
  // before React commits the first, reads this ref (mutated inline) rather than
  // the not-yet-updated state, so a fast double-tap cannot enqueue two mutations
  // against one line. Reset together with recalcLine when the cart settles.
  const recalcRef = useRef<string | null>(null);
  // Line the customer is about to remove by decrementing past 1.
  const [confirmRemove, setConfirmRemove] = useState<{ cartItemId: string; name: string } | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const descOffsetRef = useRef(0);
  // Online-payment (Tap) flow overlay. null = not paying.
  type PayState = 'opening' | 'verifying' | 'pending' | 'failed' | 'cancelled' | 'expired' | 'error';
  // sessionId is the checkout-session flow: the order does not exist until
  // payment is verified server-side.
  const [payFlow, setPayFlow] = useState<{ state: PayState; sessionId?: string; message?: string } | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  // Only ONE Tap run may be in flight at a time. Without this, a fast double-tap
  // on Continue, or a slow-network mount-recovery racing a manual Place Order,
  // could push two Tap WebViews and fire two verifies for the same session.
  const payRunningRef = useRef(false);
  // Disables Place Order while an interrupted payment is still being resolved on
  // mount, so the user can't start a second run before recovery decides.
  const [recovering, setRecovering] = useState(true);

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
        // Preselect the address chosen in the order context (delivery), falling
        // back to the customer's default.
        const ctxId = orderCtx.context?.orderType === 'delivery' ? orderCtx.context.addressId : null;
        const def = (ctxId ? mapped.find((a) => a.id === ctxId) : undefined) ?? mapped.find((a) => a.isDefault) ?? mapped[0];
        if (def && Number.isFinite(def.lat) && Number.isFinite(def.lng)) {
          setAddressId(def.id);
          setPickedLat(def.lat);
          setPickedLng(def.lng);
        }
      })
      .catch(() => setAddressList([]));
    // Runs once on mount; the order context is read for the initial preselection only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On entry, resolve any payment interrupted by an app kill / cold start BEFORE
  // the customer can act. A captured charge routes to its receipt; an unresolved
  // one resumes THAT session — never a new charge. Runs once; recovery is
  // idempotent (verify is read-only, resume reopens the same charge).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rec = await recoverPendingSession({
          read: loadPendingSession,
          verify: (id) => payments.verifySession(id),
          clear: clearPendingSession,
        });
        if (!active) return;
        if (rec.kind === 'receipt') { cart.clear(); router.replace(`/receipt/${rec.orderId}`); }
        else if (rec.kind === 'resume') { void runTapPaymentSession(rec.sessionId); }
      } finally {
        // Re-enable Place Order once recovery has decided (a resumed charge takes
        // over the pay flow; anything else leaves a normal, placeable checkout).
        if (active) setRecovering(false);
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // One tested function (previewTotals) owns every dependent number, so editing
  // a quantity below moves the line total, subtotal, discounts, minimum-order
  // eligibility and the final total together. place_order remains authoritative.
  const availablePoints = profile?.loyaltyPoints ?? 0;
  const loyaltyEnabled = Boolean(loyalty?.isEnabled) && availablePoints >= (loyalty?.minPointsToRedeem ?? Infinity);
  const couponDiscount = couponResult?.ok ? couponResult.discount : 0;

  const totals = useMemo(() => computePreviewTotals({
    items: cart.items,
    orderType,
    deliveryFee: selectedBranch?.deliveryFee ?? 0,
    minDeliveryOrder: selectedBranch?.minDeliveryOrder ?? 0,
    couponDiscount,
    loyaltyPoints: redeemPoints ? availablePoints : 0,
    discountPerPoint: loyalty?.discountPerPoint ?? 0,
  }), [cart.items, orderType, selectedBranch, couponDiscount, redeemPoints, availablePoints, loyalty]);

  const deliveryFee = totals.deliveryFee;
  const loyaltyDiscountEst = totals.loyaltyDiscount;
  const totalEst = totals.total;
  const belowMin = totals.belowMinimum;

  // Delivery needs a landmark; pickup does not.
  const requiresDescription = orderType === 'delivery';
  const descCheck = checkDescription(addrDesc, resolvedAddress);
  const descError = descTouched && requiresDescription
    ? descriptionMessage(descCheck.problem, lang)
    : null;

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

  /**
   * The one blocking problem, split into "what happened" and "what to do".
   * Section 5: the title is the loudest thing on the footer and the action sits
   * directly beneath it — previously this was a single grey sentence rendered
   * *below* the policy-consent paragraph, so the legal text out-shouted the
   * reason the button was dead.
   */
  const block = useMemo((): { title: string; action: string | null } | null => {
    // Priority order (and, critically, empty-cart BEFORE below-minimum) lives in
    // the pure resolver; this only maps the winning reason to localized copy.
    const reason: BlockReason | null = resolveBlockReason({
      hasBranch: Boolean(selectedBranch),
      branchOpen,
      hasOrderType: Boolean(orderType),
      isEmpty: cart.items.length === 0,
      belowMinimum: belowMin,
      paymentUnavailable: paymentBlocked || !paymentMethod,
      deliveryBlocked: Boolean(deliveryBlockReason),
      needsDescription: requiresDescription && !descCheck.valid,
    });
    switch (reason) {
      case 'no-branch':
        return { title: t('selectBranchCta'), action: null };
      case 'branch-closed':
        return { title: t('branchClosedError'), action: pick('Try another branch or come back later.', 'جرّب فرعاً آخر أو عد لاحقاً.') };
      case 'no-order-type':
        return { title: t('chooseOrderType'), action: null };
      case 'empty-cart':
        return { title: pick('Your cart is empty', 'سلتك فارغة'), action: pick('Add an item to continue.', 'أضف صنفاً للمتابعة.') };
      case 'below-minimum':
        return {
          title: pick('Your order is below the delivery minimum', 'طلبك أقل من الحد الأدنى للتوصيل'),
          action: pick(
            `Add ${formatSAR(totals.missingForMinimum, lang)} more to your order, or switch to pickup.`,
            `أضف ${formatSAR(totals.missingForMinimum, lang)} إلى طلبك، أو حوّل إلى الاستلام.`,
          ),
        };
      case 'no-payment':
        return { title: pick('No payment method is available', 'لا توجد طريقة دفع متاحة'), action: pick('Please try again shortly.', 'يرجى المحاولة بعد قليل.') };
      case 'delivery-unserviceable':
        return { title: deliveryBlockReason as string, action: pick('Move the pin to your exact location.', 'حرّك الدبوس إلى موقعك بالضبط.') };
      case 'need-description':
        return {
          title: pick('Add a location description', 'أضف وصف الموقع'),
          action: descriptionMessage(descCheck.problem, lang),
        };
      default:
        return null;
    }
  }, [selectedBranch, branchOpen, orderType, belowMin, lang, t, paymentBlocked, paymentMethod, pick,
      deliveryBlockReason, totals.missingForMinimum, cart.items.length, requiresDescription, descCheck]);

  const canPlace = canSubmitOrder({
    totals,
    blocked: Boolean(block) || recovering,
    placing,
    pendingRecalc: recalcLine !== null,
    descriptionValid: descCheck.valid,
    requiresDescription,
  });

  /**
   * Quantity edits. The cart store is the single writer; this only guards the
   * interaction. `recalcLine` blocks submission and both stepper controls for
   * the frame the change settles in, so a fast double-tap cannot race.
   *
   * Changing the cart rotates the cart's idempotency key (see CartProvider), so
   * an edited cart is correctly treated as a different order.
   */
  const changeQuantity = (cartItemId: string, direction: 1 | -1) => {
    // Re-read the LIVE line from cart state at action time (never a captured
    // quantity), then let the pure guard decide. The decision is gated on the
    // synchronous ref so a same-frame double-tap is ignored rather than racing a
    // second decrement to zero.
    const item = cart.items.find((it) => it.cartItemId === cartItemId);
    if (!item) return;
    const decision = decideQuantityChange({
      recalcActive: recalcRef.current !== null,
      quantity: item.quantity,
      direction,
    });
    if (decision.kind === 'ignore') return;
    if (decision.kind === 'confirm-remove') {
      // Never drop a line silently — the app confirms removals everywhere else
      // (see the cart-conflict sheet in the order-type gate) and does so here.
      setConfirmRemove({ cartItemId, name: pick(item.product.nameEn, item.product.nameAr) });
      return;
    }
    // Mark the line as settling BEFORE mutating: the ref blocks the next
    // same-frame tap immediately; the state drives the stepper `busy` and blocks
    // submission until the effect below clears it once the cart re-renders.
    recalcRef.current = cartItemId;
    setRecalcLine(cartItemId);
    if (direction === 1) cart.incrementLine(cartItemId);
    else cart.decrementLine(cartItemId);
    // Coupons are validated against a subtotal that has just changed, so the
    // previous result no longer applies and must be re-entered.
    if (couponResult) setCouponResult(null);
  };

  // A quantity edit has settled once the cart — and therefore the preview totals
  // and this row — have re-rendered with the new value. Release the recalc guard
  // here so the stepper re-enables and submission unblocks. Doing it here rather
  // than synchronously in changeQuantity is the fix: previously recalcLine was
  // set and cleared in the same frame, so it never survived a render, the
  // stepper never showed `busy`, and submission was never actually blocked
  // mid-recalc.
  useEffect(() => {
    recalcRef.current = null;
    setRecalcLine(null);
  }, [cart.items]);

  const placeOrder = async () => {
    if (!canPlace || !selectedBranch || !orderType) return;
    setError(null);
    setPlacing(true);
    try {
      // Resolve any interrupted online payment FIRST — before creating ANY new
      // order, cash included. Otherwise a customer with an unresolved online charge
      // could switch to cash and place a second order while that charge may still
      // be captured. Recovery is idempotent (verify is read-only; resume reopens
      // the SAME charge).
      const rec = await recoverPendingSession({
        read: loadPendingSession,
        verify: (id) => payments.verifySession(id),
        clear: clearPendingSession,
      });
      if (rec.kind === 'receipt') { cart.clear(); router.replace(`/receipt/${rec.orderId}`); return; }
      if (rec.kind === 'resume') { await runTapPaymentSession(rec.sessionId); return; }

      // Resolve the delivery address: reuse the selected saved address when the
      // pin hasn't moved off it, otherwise persist the map-picked coordinates.
      let deliveryAddressId: string | null = null;
      if (orderType === 'delivery') {
        if (pickedLat == null || pickedLng == null) throw new Error(pick('Please select your location on the map', 'يرجى تحديد موقعك على الخريطة'));
        // Mandatory landmark, re-checked here and not only on the button: the
        // address row is written from this path, and it previously stored no
        // description at all.
        const desc = checkDescription(addrDesc, resolvedAddress);
        if (!desc.valid) {
          setDescTouched(true);
          throw new Error(descriptionMessage(desc.problem, lang) ?? descriptionCopy[lang].empty);
        }
        const saved = addressList.find((a) => a.id === addressId);
        if (saved && saved.lat === pickedLat && saved.lng === pickedLng && saved.description === desc.value) {
          deliveryAddressId = saved.id;
        } else if (saved && saved.lat === pickedLat && saved.lng === pickedLng) {
          // Same pin, edited landmark — update in place rather than creating a
          // near-duplicate address for the customer.
          const updated = await addresses.update(saved.id, { description: desc.value });
          deliveryAddressId = updated.id;
        } else {
          const created = await addresses.create({
            label: (addrLabel.trim() || desc.value).slice(0, 60),
            description: desc.value,
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
      if (isOnline) {
        // Any interrupted charge was already resolved at the top of placeOrder,
        // so beginning a new session here is safe.
        // NEW online flow: create a temporary checkout SESSION (not an order). The
        // real order is created only after the backend verifies the payment. A
        // zero-total online order (fully covered) is settled server-side and comes
        // back with order_id already set → straight to the receipt.
        const session = await checkout.begin(orderInput);
        if (session.order_id) {
          cart.clear();
          router.replace(`/receipt/${session.order_id}`);
        } else {
          // Keep the cart until payment actually succeeds — a failed/abandoned
          // payment must not wipe it, and there is no order to strand.
          await runTapPaymentSession(session.id);
        }
      } else {
        // Cash: unchanged. The order is created + synced to the POS now.
        const order = await orders.placeAndSync(orderInput);
        cart.clear();
        router.replace(`/receipt/${order.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('somethingWentWrong'));
    } finally {
      setPlacing(false);
    }
  };

  // ---- Tap online-payment flow (open hosted checkout → server verify) --------
  // Session-based: the order is created by the backend ONLY after the charge is
  // verified. `verifySession` returns the created order id, which we use to open
  // the receipt. The redirect result is never trusted — server verify decides.
  const runTapPaymentSession = async (sessionId: string) => {
    // Single-flight: a second concurrent run for the same (or any) session would
    // stack a duplicate Tap WebView and fire a redundant verify. Bail if one is
    // already in progress; the ref is reset in the finally below.
    if (payRunningRef.current) return;
    payRunningRef.current = true;
    try {
      // Persist the in-flight session BEFORE opening Tap so an app kill / cold start
      // recovers THIS charge instead of opening a new one. Awaited (not fire-and-
      // forget) so the write is committed before we hand off to the in-app WebView —
      // the exact window this recovery is meant to survive (see pendingSession.ts).
      await savePendingSession(sessionId, Date.now());
      setPayFlow({ state: 'opening', sessionId });
      const init = await payments.initiateSession(sessionId, lang === 'ar' ? 'ar' : 'en');
      if (init.status === 'already_paid' && init.orderId) { void clearPendingSession(); cart.clear(); setPayFlow(null); router.replace(`/receipt/${init.orderId}`); return; }
      if (init.status === 'disabled' || (!init.checkoutUrl && !init.needsVerify)) {
        setPayFlow({ state: 'error', sessionId, message: t('payUnavailable') });
        return;
      }
      if (init.checkoutUrl) {
        // Present Tap's hosted checkout. TEST → in-app WebView (strict allow-list,
        // Tap-hosted 3DS). LIVE/unknown → the external auth browser, which can
        // follow the issuer-bank ACS redirects a live 3DS challenge uses off-Tap.
        // Hide the overlay first — the chosen surface owns the UI while it's up.
        // The redirect result is NEVER trusted; verifyPaymentSession (server) below
        // decides the real outcome for BOTH transports.
        setPayFlow(null);
        let dismissed = false;
        if (chooseCheckoutTransport(init.mode) === 'in-app-webview') {
          const result = await openInAppTapCheckout(sessionId, init.checkoutUrl);
          dismissed = result === 'dismissed';
        } else {
          const result = await WebBrowser.openAuthSessionAsync(init.checkoutUrl, 'spicymeal://payment/return');
          dismissed = result.type === 'cancel' || result.type === 'dismiss';
        }
        await verifyPaymentSession(sessionId, { dismissed });
      } else {
        await verifyPaymentSession(sessionId);
      }
    } catch (e) {
      setPayFlow({ state: 'error', sessionId, message: e instanceof Error ? e.message : t('somethingWentWrong') });
    } finally {
      payRunningRef.current = false;
    }
  };

  // Push the in-app Tap checkout WebView and await its result. The Tap checkout
  // URL (which carries a short-lived token) is handed over IN MEMORY only — the
  // route param is just the non-secret checkout-session id.
  const openInAppTapCheckout = (sessionId: string, checkoutUrl: string): Promise<CheckoutHandoffResult> => {
    const done = startCheckoutHandoff(sessionId, checkoutUrl);
    router.push({ pathname: '/payment/checkout', params: { session: sessionId } });
    return done;
  };

  const verifyPaymentSession = async (sessionId: string, opts?: { dismissed?: boolean }) => {
    setPayFlow({ state: 'verifying', sessionId });
    setPayBusy(true);
    try {
      const res = await payments.verifySession(sessionId);
      if (res.status === 'paid' && res.orderId) { void clearPendingSession(); cart.clear(); setPayFlow(null); router.replace(`/receipt/${res.orderId}`); return; }
      // Only an EXPLICITLY terminal charge (failed/cancelled/expired) clears the
      // persisted session. An 'unknown' status — and 'paid' without a resolved
      // order id yet — the backend still treats as open, so we keep the session
      // and show it as pending (verify again), never abandoning a charge that may
      // still settle into a second one.
      const isTerminal = res.status === 'failed' || res.status === 'cancelled' || res.status === 'expired';
      const state: PayState =
        res.status === 'cancelled' ? 'cancelled'
        : res.status === 'expired' ? 'expired'
        : res.status === 'failed' ? 'failed'
        : 'pending';
      if (isTerminal) void clearPendingSession();
      // A user who closed the in-app checkout WITHOUT paying, on a still-open
      // (pending) charge, sees the "not completed — continue or try again" copy.
      // An automatic verify that simply lands on pending keeps the neutral copy.
      // Terminal/declined states never show a raw Tap error — only safe strings.
      const msgKey =
        state === 'pending' && opts?.dismissed ? 'payNotCompleted'
        : res.messageKey && res.messageKey.startsWith('pay') ? res.messageKey
        : state === 'cancelled' ? 'payCancelled'
        : state === 'expired' ? 'payExpired'
        : state === 'pending' ? 'payPending'
        : 'payFailed';
      setPayFlow({ state, sessionId, message: t(msgKey as never) });
    } catch (e) {
      // Transient verify error — KEEP the persisted session so recovery can
      // resolve it on the next launch / checkout entry (never a new charge).
      setPayFlow({ state: 'error', sessionId, message: e instanceof Error ? e.message : t('somethingWentWrong') });
    } finally {
      setPayBusy(false);
    }
  };

  // Dismiss the payment modal without paying. In the session flow no order exists
  // yet, so we simply close and keep the cart intact for a retry.
  const dismissPayFlow = () => setPayFlow(null);

  // Retry after a TERMINAL payment (failed/cancelled/expired): that session is
  // dead server-side, so clear it and begin a brand-new checkout. Never reuse a
  // consumed/expired sessionId (Phase-1 requirement: expired retry = fresh session).
  const retryFresh = async () => {
    await clearPendingSession();
    setPayFlow(null);
    await placeOrder();
  };

  return (
    <View style={styles.root}>
      <Header title={t('checkout')} showBack />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          // Tail room clears the sticky footer AND the keyboard, so the focused
          // description field and its message stay visible while typing.
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 260 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
        >
          {/* Order type + branch — PRESELECTED from the order context (read-only).
              Change re-opens the selection flow after a confirmation. */}
          <View style={[styles.otRow, rtlRow]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sectionTitle, rtlText]}>{t('orderType')}</Text>
              <Text style={[styles.otValue, rtlText]} numberOfLines={1}>
                {orderType === 'pickup' ? t('otPickup') : orderType === 'delivery' ? t('otDelivery') : ''}
                {selectedBranch ? ` · ${pick(selectedBranch.nameEn, selectedBranch.nameAr)}` : ''}
              </Text>
            </View>
            <Pressable onPress={() => setShowTypeChange(true)} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.otChange}>{t('otChange')}</Text>
            </Pressable>
          </View>

          {/* Payment method — availability is admin-controlled */}
          <View style={styles.block}>
            <Text style={[styles.sectionTitle, rtlText]}>{t('paymentMethodTitle')}</Text>
            {paymentBlocked ? (
              <Text style={[styles.note, rtlText, { color: colors.danger, fontWeight: '700' }]}>
                {pick('No payment method is currently available.', 'لا توجد طريقة دفع متاحة حالياً.')}
              </Text>
            ) : (
              <>
                <View style={styles.segment}>
                  {payMethods.map((m) => {
                    const label = m === 'online'
                      ? t('payOnline')
                      : orderType === 'delivery'
                        ? t('cashOnDelivery')
                        : t('cashOnPickup');
                    return <SegmentBtn key={m} label={label} active={paymentMethod === m} onPress={() => setPaymentMethod(m)} />;
                  })}
                </View>
                {paymentMethod === 'cash' ? (
                  <Text style={[styles.note, rtlText]}>{pick('Pay in cash when you receive your order.', 'يُدفع المبلغ نقداً عند استلام طلبك.')}</Text>
                ) : null}
                {showOnlineOutageNotice ? (
                  <Text style={[styles.note, rtlText, { color: colors.purple, fontWeight: '700' }]}>
                    {pick('Online payment is currently unavailable. Cash payment is enabled.', 'الدفع الإلكتروني غير متاح حالياً. الدفع النقدي مفعّل.')}
                  </Text>
                ) : null}
              </>
            )}
          </View>

          {/* Delivery location — map picker + optional details */}
          {orderType === 'delivery' ? (
            <View style={styles.block}>
              <Text style={[styles.sectionTitle, rtlText]}>{pick('Select your delivery location', 'حدّد موقع التوصيل')}</Text>
              <LocationPickerMap
                key={recenterSeed}
                lat={pickedLat ?? selectedBranch?.latitude ?? 24.7136}
                lng={pickedLng ?? selectedBranch?.longitude ?? 46.6753}
                lang={lang}
                onChange={(la, ln) => { setPickedLat(la); setPickedLng(ln); setAddressId(null); }}
                onAddressResolved={setResolvedAddress}
                labels={{
                  locateHint: pick('Move the pin to your exact location', 'حرّك الدبوس إلى موقعك بالضبط'),
                  useMyLocation: pick('Use my location', 'استخدم موقعي'),
                  setupRequired: pick('Map setup required — ask support to enable the map.', 'إعداد الخريطة مطلوب — تواصل مع الدعم لتفعيل الخريطة.'),
                }}
              />

              {/* Mandatory location description — the same field, label and
                  rule as the address gate (see order/locationDescription). */}
              <View onLayout={(e) => { descOffsetRef.current = e.nativeEvent.layout.y; }}>
                {/* The pin's own address, read-only, so the customer can check
                    the map is right without it counting as delivery guidance. */}
                {resolvedAddress ? (
                  <Text style={[styles.resolvedAddr, rtlText]} numberOfLines={2}>
                    {`${descriptionCopy[lang].addressPrefix}: ${resolvedAddress}`}
                  </Text>
                ) : null}
                <Text style={[styles.fieldLabel, rtlText]}>{descriptionCopy[lang].label}</Text>
                <TextInput
                  value={addrDesc}
                  onChangeText={setAddrDesc}
                  onBlur={() => setDescTouched(true)}
                  placeholder={descriptionCopy[lang].placeholder}
                  placeholderTextColor={colors.muted}
                  style={[styles.notesInput, rtlText, descError ? styles.inputError : null]}
                  multiline
                  accessibilityLabel={descriptionCopy[lang].label}
                />
                {descError ? <Text style={[styles.fieldError, rtlText]}>{descError}</Text> : null}
              </View>

              {/* Building / street stays genuinely optional and is clearly
                  secondary to the required landmark above. */}
              <TextInput
                value={addrLabel}
                onChangeText={setAddrLabel}
                placeholder={pick('Building / street / apartment (optional)', 'المبنى / الشارع / الشقة (اختياري)')}
                placeholderTextColor={colors.muted}
                style={[styles.couponInput, rtlText, { marginTop: spacing.sm }]}
              />

              {addressList.length > 0 ? (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={[styles.note, rtlText]}>{pick('Saved locations', 'المواقع المحفوظة')}</Text>
                  {addressList.map((a) => (
                    <Pressable
                      key={a.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: addressId === a.id }}
                      style={[styles.addrRow, rtlRow, addressId === a.id && styles.addrRowActive]}
                      onPress={() => chooseSavedAddress(a)}
                    >
                      <View style={[styles.radioDot, addressId === a.id && styles.radioDotOn]} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.addrLabel, rtlText]}>{a.label || t('deliveryAddress')}</Text>
                        {a.description ? <Text style={[styles.addrDesc, rtlText]}>{a.description}</Text> : null}
                      </View>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {deliveryBlockReason ? (
                <Text style={[styles.note, rtlText, { color: colors.danger, fontWeight: '700', marginTop: spacing.sm }]}>{deliveryBlockReason}</Text>
              ) : null}
            </View>
          ) : null}

          {/* Coupon */}
          <View style={styles.block}>
            <Text style={[styles.sectionTitle, rtlText]}>{t('couponTitle')}</Text>
            <View style={[styles.couponRow, rtlRow]}>
              <TextInput
                value={couponCode}
                onChangeText={(v) => { setCouponCode(v); setCouponResult(null); }}
                placeholder={t('couponPlaceholder')}
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
                style={[styles.couponInput, rtlText]}
              />
              <Button label={t('applyCoupon')} onPress={applyCoupon} loading={checkingCoupon} variant="secondary" style={styles.couponBtn} />
            </View>
            {couponResult ? (
              <Text style={[styles.couponMsg, rtlText, { color: couponResult.ok ? colors.success : colors.danger }]}>
                {couponResult.ok ? `${t('couponApplied')} −${formatSAR(couponResult.discount, lang)}` : couponResult.message}
              </Text>
            ) : null}
          </View>

          {/* Loyalty */}
          {loyaltyEnabled ? (
            <View style={styles.block}>
              <Pressable
                style={[styles.toggleRow, rtlRow]}
                onPress={() => setRedeemPoints((v) => !v)}
                accessibilityRole="switch"
                accessibilityState={{ checked: redeemPoints }}
                accessibilityLabel={t('useLoyalty')}
              >
                <View style={[styles.switch, redeemPoints && styles.switchOn]}>
                  <View style={[styles.knob, redeemPoints && styles.knobOn]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.toggleLabel, rtlText]}>{t('useLoyalty')}</Text>
                  <Text style={[styles.toggleSub, rtlText]}>{availablePoints} {t('pointsAvailable')}</Text>
                </View>
              </Pressable>
              <Text style={[styles.note, rtlText]}>{t('redeemHint')}</Text>
            </View>
          ) : null}

          {/* Notes */}
          <View style={styles.block}>
            <Text style={[styles.sectionTitle, rtlText]}>{t('orderNotes')}</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder={t('notesPlaceholder')}
              placeholderTextColor={colors.muted}
              style={[styles.notesInput, rtlText]}
              multiline
            />
          </View>

          {/* Editable cart lines — fix a below-minimum order without leaving
              Checkout and losing the pin, coupon and payment method. */}
          <View style={styles.block}>
            <Text style={[styles.sectionTitle, rtlText]}>{pick('Your items', 'أصنافك')}</Text>
            {cart.items.map((it) => {
              const name = pick(it.product.nameEn, it.product.nameAr);
              const mods = Object.values(it.selectedModifiers).flat();
              return (
                <View key={it.cartItemId} style={[styles.lineRow, rtlRow]}>
                  <View style={styles.lineInfo}>
                    <Text style={[styles.lineName, rtlText]} numberOfLines={2}>{name}</Text>
                    {mods.length > 0 ? (
                      <Text style={[styles.lineMods, rtlText]} numberOfLines={2}>
                        {mods.map((m) => pick(m.nameEn, m.nameAr)).join(' • ')}
                      </Text>
                    ) : null}
                    <Price amount={lineTotal(it)} size={font.sm} color={colors.muted} weight="700" />
                  </View>
                  <QuantityStepper
                    quantity={it.quantity}
                    busy={recalcLine === it.cartItemId}
                    itemLabel={name}
                    onIncrement={() => changeQuantity(it.cartItemId, 1)}
                    onDecrement={() => changeQuantity(it.cartItemId, -1)}
                    labels={{
                      increase: pick('Increase quantity', 'زيادة الكمية'),
                      decrease: pick('Decrease quantity', 'إنقاص الكمية'),
                      quantity: pick('Quantity', 'الكمية'),
                    }}
                  />
                </View>
              );
            })}
          </View>

          {/* Totals preview */}
          <View style={styles.totals}>
            <Row label={t('subtotal')} amount={totals.subtotal} />
            {orderType === 'delivery' ? <Row label={t('deliveryFee')} amount={deliveryFee} /> : null}
            {totals.couponDiscount > 0 ? <Row label={t('discount')} amount={totals.couponDiscount} negative accent /> : null}
            {loyaltyDiscountEst > 0 ? <Row label={t('loyaltyDiscount')} amount={loyaltyDiscountEst} negative accent /> : null}
            <Row label={t('vat')} value="" muted />
            <View style={styles.totalDivider} />
            <Row label={t('total')} amount={totalEst} big />
            <Text style={[styles.serverNote, rtlText]}>{`* ${pick('Final amounts are confirmed by the server.', 'يتم تأكيد المبالغ النهائية من الخادم.')}`}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Sticky place-order.
          Information hierarchy (section 5), top to bottom:
            1. the blocking problem + the exact fix — loudest;
            2. any submit error;
            3. the action itself;
            4. legal consent — smallest and quietest, still fully legible and
               link-accessible. It previously sat ABOVE the block reason in the
               same size, so the policy paragraph dominated the screen while the
               reason the button was dead read as a footnote. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
        {block ? (
          <Notice title={block.title} action={block.action} rtlText={rtlText} style={{ marginBottom: spacing.sm }} />
        ) : null}
        {error ? (
          <Notice title={error} rtlText={rtlText} style={{ marginBottom: spacing.sm }} />
        ) : null}
        <Button
          label={placing ? t('placingOrder') : t('placeOrder')}
          onPress={placeOrder}
          disabled={!canPlace}
          loading={placing}
          variant="danger"
        />
        <Text style={[styles.policy, rtlText]}>
          {pick('By placing this order, you agree to the ', 'بإتمام الطلب، فإنك توافق على ')}
          <Text accessibilityRole="link" style={styles.policyLink} onPress={() => router.push('/legal/cancellation_refund_policy')}>{legalTitle('cancellation_refund_policy', lang)}</Text>
          {pick(', ', '، ')}
          <Text accessibilityRole="link" style={styles.policyLink} onPress={() => router.push('/legal/delivery_pickup_policy')}>{legalTitle('delivery_pickup_policy', lang)}</Text>
          {pick(', and ', '، و')}
          <Text accessibilityRole="link" style={styles.policyLink} onPress={() => router.push('/legal/payment_policy')}>{legalTitle('payment_policy', lang)}</Text>
          {'.'}
        </Text>
      </View>

      {/* Confirm before a decrement removes the last unit of a line. */}
      <Modal visible={confirmRemove !== null} transparent animationType="fade" onRequestClose={() => setConfirmRemove(null)}>
        <View style={styles.payBackdrop}>
          <View style={styles.payCard}>
            <Text style={styles.payTitle}>{pick('Remove this item?', 'إزالة هذا الصنف؟')}</Text>
            <Text style={styles.payMsg}>{confirmRemove?.name ?? ''}</Text>
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Button
                label={pick('Remove', 'إزالة')}
                variant="danger"
                onPress={() => {
                  if (confirmRemove) {
                    cart.removeLine(confirmRemove.cartItemId);
                    if (couponResult) setCouponResult(null);
                  }
                  setConfirmRemove(null);
                }}
              />
              <Button label={t('cancel')} variant="secondary" onPress={() => setConfirmRemove(null)} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Online-payment (Tap) overlay. onRequestClose (Android back) dismisses the
          modal like Close — it never touches the persisted session, so recovery
          still resolves an in-flight charge; it never confirms/creates anything. */}
      <Modal visible={payFlow !== null} transparent animationType="fade" onRequestClose={dismissPayFlow}>
        <View style={styles.payBackdrop}>
          <View style={styles.payCard}>
            <Text style={styles.payTitle}>{t('payTitle')}</Text>
            {payFlow && (payFlow.state === 'opening' || payFlow.state === 'verifying') ? (
              <View style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg }}>
                <ActivityIndicator size="large" color={colors.purple} />
                <Text style={styles.payMsg}>{t(payFlow.state === 'opening' ? 'payOpening' : 'payVerifying')}</Text>
                {/* Escape hatch if initiate/verify stalls: dismiss keeps the session,
                    so a still-open charge is resolved by recovery on next entry. */}
                <Button label={t('cancel')} onPress={dismissPayFlow} variant="secondary" style={{ alignSelf: 'stretch' }} />
              </View>
            ) : payFlow ? (
              <>
                <Text style={styles.payMsg}>{payFlow.message ?? t('payFailed')}</Text>
                <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                  {payFlow.state === 'pending' ? (
                    <>
                      {/* Continue reopens the SAME Tap session (no new charge — the
                          server reuses the existing one); Check status re-verifies. */}
                      <Button label={t('payContinue')} onPress={() => payFlow.sessionId && void runTapPaymentSession(payFlow.sessionId)} loading={payBusy} variant="danger" />
                      <Button label={t('payVerifyAgain')} onPress={() => payFlow.sessionId && void verifyPaymentSession(payFlow.sessionId)} loading={payBusy} variant="secondary" />
                    </>
                  ) : payFlow.state === 'error' ? (
                    // Transient error: the session may still be alive — resume it (same charge).
                    <Button label={t('payTryAgain')} onPress={() => payFlow.sessionId && void runTapPaymentSession(payFlow.sessionId)} loading={payBusy} variant="danger" />
                  ) : (
                    // Terminal (failed/cancelled/expired): open a FRESH session, never reuse.
                    <Button label={t('payTryAgain')} onPress={() => void retryFresh()} loading={payBusy} variant="danger" />
                  )}
                  <Button label={t('close')} onPress={dismissPayFlow} variant="secondary" />
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Confirm before changing order type — it can change the branch, delivery
          fee, item availability and cart contents. Confirm → re-open selection. */}
      <Modal visible={showTypeChange} transparent animationType="fade" onRequestClose={() => setShowTypeChange(false)}>
        <View style={styles.payBackdrop}>
          <View style={styles.payCard}>
            <Text style={styles.payTitle}>{t('otChangeTypeTitle')}</Text>
            <Text style={styles.payMsg}>{t('otChangeTypeBody')}</Text>
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Button label={t('otChange')} onPress={() => { setShowTypeChange(false); router.push('/select'); }} variant="danger" />
              <Button label={t('cancel')} onPress={() => setShowTypeChange(false)} variant="secondary" />
            </View>
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

function Row({ label, value, amount, negative, big, accent, muted }: { label: string; value?: string; amount?: number; negative?: boolean; big?: boolean; accent?: boolean; muted?: boolean }) {
  const { rtlRow } = useI18n();
  return (
    <View style={[styles.row, rtlRow]}>
      <Text style={[styles.rowLabel, big && styles.rowLabelBig, muted && styles.rowMuted]}>{label}</Text>
      {amount != null ? (
        <Price amount={amount} prefix={negative ? '−' : undefined} size={big ? font.lg : font.md} color={accent ? colors.success : big ? colors.purple : colors.text} weight={big ? '800' : '700'} />
      ) : (
        <Text style={[styles.rowValue, big && styles.rowValueBig, accent && { color: colors.success }]}>{value}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  sectionTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  hint: { fontSize: font.sm, color: colors.muted, marginBottom: spacing.sm },
  otRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  otValue: { fontSize: font.md, color: colors.text, fontWeight: '700', marginTop: 2 },
  otChange: { color: colors.purple, fontWeight: '800', fontSize: font.sm },
  block: { marginTop: spacing.xl },
  note: { fontSize: font.sm, color: colors.muted, marginTop: spacing.xs },

  segment: { flexDirection: 'row', gap: spacing.md },
  segBtn: {
    flex: 1, paddingVertical: spacing.lg, borderRadius: radius.md, backgroundColor: colors.white,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'center',
  },
  segBtnActive: { borderColor: colors.purple, backgroundColor: colors.purpleBg },
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
  error: { color: colors.danger, fontWeight: '700', fontSize: font.sm, textAlign: 'center' },
  // Legal consent: quiet but fully legible, and now BELOW the action rather
  // than competing with the blocking message above it. Shared token so
  // "secondary" means the same thing on every screen.
  policy: { ...secondaryTextStyle, textAlign: 'center', marginTop: spacing.sm },

  // Mandatory-field affordances (location description).
  fieldLabel: { fontSize: font.sm, fontWeight: '800', color: colors.text, marginTop: spacing.md },
  inputError: { borderColor: colors.danger },
  resolvedAddr: { fontSize: font.xs, color: colors.muted, marginTop: spacing.md },
  fieldError: { color: colors.danger, fontWeight: '700', fontSize: font.sm, marginTop: spacing.xs },

  // Editable cart lines.
  lineRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  lineInfo: { flex: 1, gap: 2 },
  lineName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  lineMods: { fontSize: font.xs, color: colors.muted },
  policyLink: { color: colors.purple, fontWeight: '800' },

  payBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  payCard: { width: '100%', maxWidth: 400, backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.xl },
  payTitle: { fontSize: font.lg, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: spacing.sm },
  payMsg: { fontSize: font.md, color: colors.text, textAlign: 'center', lineHeight: 20 },
});
