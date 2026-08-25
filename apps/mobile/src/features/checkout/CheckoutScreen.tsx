/**
 * Checkout. All money math is a PREVIEW — place_order recomputes subtotal,
 * modifiers, delivery fee, coupon, VAT and loyalty server-side and is the only
 * order-creation path. Rules enforced here mirror the server so the user gets
 * fast feedback:
 *   - Order type is NOT preselected; the customer picks delivery or pickup.
 *   - The branch must be open (is_active) to place an order.
 *   - Delivery requires meeting the branch minimum.
 * The idempotency key from the cart store makes a retried submit safe.
 *
 * This file owns STATE AND DECISIONS ONLY. Every piece of layout lives in
 * `./view/*`, which are pure presentational components that receive resolved
 * values and handlers. That split is not cosmetic: the payment states are
 * driven by internal state rather than context, so extracting
 * `PaymentStatusDialog` is what makes "declined", "expired" and "still pending"
 * reviewable without running a real charge (see src/dev/fixtureData.ts).
 */
import * as Location from 'expo-location';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Header } from '../../components/Header';
import { color, space } from '../../design-system/generated/tokens';
import { Field } from '../../design-system/ui/Field';
import { checkDescription } from '../order/locationDescription';
import {
  ORDER_NOTE_MAX_LENGTH,
  checkOrderNote,
  normalizeOrderNote,
  orderNoteMessage,
  orderNoteRemainingMessage,
} from '../order/orderNote';
import { appliedCouponSurvives, decideQuantityChange, resolveBlockReason, type BlockReason } from './checkoutGuards';
import { mismatchWarning, type DeviceFix } from './deliveryLocationWarning';
import { canSubmitOrder, computePreviewTotals, lineTotal } from './previewTotals';
import { useI18n } from '../../i18n/I18nProvider';
import { failureMessage } from '../../lib/errors/reportFailure';
import { checkout, coupons, orders, payments } from '../../services/api';
import { preselectAddress } from '../../store/addressBook';
import { legalTitle } from '../../lib/legal';
import {
  availableMethods, checkoutBlocked, onlineUnavailableCashOn, resolveDefaultMethod,
  type PaymentMethod,
} from '../../lib/payment';
import { pointInPolygon } from '../../lib/geo';
import { useAddressBook, useAuth, useCart, useCatalog, useOrderContext } from '../../store';
import { availabilityLookup, validateCartForBranch } from '../order/cartValidation';
import type { CartItem, OrderType, SavedAddress } from '../../types/models';
import { cartLineLabel } from '../../utils/format';
import { recoverPendingSession } from './pendingSession';
import { clearPendingSession, loadPendingSession, savePendingSession } from './pendingSessionStore';
import { startCheckoutHandoff, type CheckoutHandoffResult } from './checkoutHandoff';
import { chooseCheckoutTransport } from './paymentFlow';
import { CheckoutFooter } from './view/CheckoutFooter';
import { CheckoutLines } from './view/CheckoutLines';
import { CouponRow } from './view/CouponRow';
import { DeliveryLocationSection } from './view/DeliveryLocationSection';
import { ConfirmDialog } from './view/Dialog';
import { LoyaltyToggle } from './view/LoyaltyToggle';
import { OrderTypeRow } from './view/OrderTypeRow';
import { PaymentMethodPicker } from './view/PaymentMethodPicker';
import { PaymentStatusDialog, type PayState } from './view/PaymentStatusDialog';
import { CONTENT_MAX_WIDTH } from './view/layout';
import { Section } from './view/Section';
import { TotalsCard } from './view/TotalsCard';
import { makeStyles } from '../../theme/makeStyles';

const LEGAL_DOCS = [
  'cancellation_refund_policy',
  'delivery_pickup_policy',
  'payment_policy',
] as const;

/**
 * The one blocking problem, resolved to copy. `amount` is separate from the
 * prose because a money figure has to render through `<Price>` rather than be
 * interpolated into a string — see the below-minimum case.
 */
interface BlockMessage {
  title: string;
  action: string | null;
  amount?: number;
  amountLabel?: string;
}

export function CheckoutScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { t, pick, lang } = useI18n();
  const { profile } = useAuth();
  // `brand.vatPercentage` IS read now. The VAT row is still a label-only note
  // with no amount — prices are VAT-inclusive, so there is nothing to add — but
  // the copy used to hardcode "15%" while the rate is admin-configurable, so a
  // branch on any other rate showed customers a FALSE tax rate. This
  // interpolates the configured rate into the label and changes nothing about
  // the calculation, the inclusivity or the totals.
  const { selectedBranch, loyalty, payment, deliveryZones, branchIsOpen, brand, refreshAvailability } = useCatalog();
  const cart = useCart();

  // Order type + branch are PRESELECTED from the order context (chosen in the
  // blocking selection flow) — never re-picked inline. "Change" re-opens that
  // flow after a confirmation (see the modal below).
  const orderCtx = useOrderContext();
  const orderType: OrderType | null = orderCtx.context?.orderType ?? null;
  const [showTypeChange, setShowTypeChange] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(resolveDefaultMethod(payment));
  // The SHARED address book, not a private copy. This screen stays mounted while
  // the customer edits addresses in Profile, so a local fetched-once list would
  // keep offering an address that has since been edited or deleted.
  const addressBook = useAddressBook();
  const addressList = addressBook.addresses;
  const [addressId, setAddressId] = useState<string | null>(null);
  // The CONFIRMED delivery point, seeded from the order context — the location
  // the customer already resolved on the blocking order-type gate. Checkout
  // confirms that decision rather than asking for it a second time, and the
  // only way it changes here is selecting a different SAVED location.
  //
  // Seeding from the context (not only from a saved-address lookup) is
  // deliberate: the context carries the exact point the branch was resolved
  // against, so what the customer sees is what the order will use even if the
  // address book is still loading or has since been edited.
  const [pickedLat, setPickedLat] = useState<number | null>(
    orderCtx.context?.orderType === 'delivery' ? orderCtx.context.deliveryLat : null,
  );
  const [pickedLng, setPickedLng] = useState<number | null>(
    orderCtx.context?.orderType === 'delivery' ? orderCtx.context.deliveryLng : null,
  );
  // The change-location picker. `pendingAddressId` is held apart from
  // `addressId` so cancelling cannot leave the order pointed at a location the
  // customer only browsed past.
  const [changingLocation, setChangingLocation] = useState(false);
  const [pendingAddressId, setPendingAddressId] = useState<string | null>(null);
  // Best-effort device position, for the distance WARNING only. Never blocks,
  // never prompts — see the effect below.
  const [deviceFix, setDeviceFix] = useState<DeviceFix | null>(null);
  const [couponCode, setCouponCode] = useState('');
  /**
   * The applied coupon, TAGGED WITH THE SUBTOTAL IT WAS VALIDATED AGAINST.
   *
   * `validate_coupon` is a function of (code, subtotal) — minimum-spend and
   * percentage discounts both move with the basket — and `place_order`
   * re-runs it against the recomputed subtotal, raising `Coupon rejected: %`
   * on a mismatch (20260710120100_place_order_delivery_zone.sql:207-209, and
   * the same check in begin_checkout_session). A stale result is therefore not
   * a cosmetic wrong number on the totals card: it is an order that FAILS at
   * submit, after the customer has committed.
   *
   * Tagging is what makes the invalidation reliable. It used to be cleared by
   * hand in the two mutation handlers on this screen, which covered the
   * stepper and the remove dialog and nothing else — a line edited on the
   * product screen came back to a Checkout that had stayed mounted, holding a
   * discount computed for a basket that no longer existed.
   */
  const [couponResult, setCouponResult] = useState<
    { ok: boolean; message: string; discount: number; subtotal: number } | null
  >(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState(false);
  const [notes, setNotes] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  // Online-payment (Tap) flow overlay. null = not paying.
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

  // Preselect ONCE, as soon as the shared book has settled. The rule is
  // unchanged — the address carried in the order context wins, then the
  // customer's default, then the first saved row — but it now lives in
  // `preselectAddress` so the order-type gate cannot drift from it.
  //
  // The guard is a ref rather than a dependency list: the book updates whenever
  // an address is edited anywhere in the app, and re-running this would yank the
  // customer's chosen pin back to their default mid-checkout.
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current) return;
    if (addressBook.status === 'idle' || addressBook.status === 'loading') return;
    preselected.current = true;
    const ctxId = orderCtx.context?.orderType === 'delivery' ? orderCtx.context.addressId : null;
    const def = preselectAddress(addressList, ctxId);
    if (def) {
      setAddressId(def.id);
      // Only fill a pin the order context did not already supply. The context
      // point is what the branch was resolved against, so it wins; overwriting
      // it from a fallback address would silently move the delivery.
      setPickedLat((prev) => (prev == null ? def.lat : prev));
      setPickedLng((prev) => (prev == null ? def.lng : prev));
    }
    // The order context is read for the initial preselection only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressBook.status, addressList]);

  /**
   * Read the device position ONCE, for the distance warning and nothing else.
   *
   * It never prompts: `getForegroundPermissionsAsync` only reports a grant the
   * customer has already given elsewhere (the order-type gate asks, in the
   * context where the answer is actually useful). Asking for location for the
   * first time on the payment screen would be both surprising and easy to
   * refuse, and a refusal here must cost nothing — the whole feature is one
   * advisory line. Every failure is swallowed: no fix simply means no warning.
   */
  useEffect(() => {
    if (orderType !== 'delivery') return;
    let active = true;
    void (async () => {
      try {
        const { granted } = await Location.getForegroundPermissionsAsync();
        if (!granted || !active) return;
        const known = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
        if (known && active) {
          setDeviceFix({ lat: known.coords.latitude, lng: known.coords.longitude, accuracyM: known.coords.accuracy });
        }
        const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (fresh && active) {
          setDeviceFix({ lat: fresh.coords.latitude, lng: fresh.coords.longitude, accuracyM: fresh.coords.accuracy });
        }
      } catch { /* no permission, no hardware, no fix — all mean "no warning" */ }
    })();
    return () => { active = false; };
  }, [orderType]);

  // The selected address disappearing (deleted from Profile while Checkout was
  // mounted) must not leave a dangling id that place_order would reject. The
  // pin the customer can see stays where it is; only the saved-address link is
  // dropped, so the order proceeds as a map-picked location.
  useEffect(() => {
    if (addressId && !addressList.some((a) => a.id === addressId)) setAddressId(null);
  }, [addressId, addressList]);

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

  /**
   * The change-location flow. Three separate handlers rather than one, because
   * selecting a row and COMMITTING it are different acts: a customer scrolling
   * the list has not changed their delivery address until they confirm, and
   * cancelling must leave the order exactly as it was.
   *
   * Note what is missing: there is no "edit this location" here, and no way to
   * create one. Both belong to location settings, which owns the landmark —
   * having Checkout write it too is what let one address carry two different
   * descriptions depending on which screen last saved it.
   */
  const startLocationChange = () => { setPendingAddressId(addressId); setChangingLocation(true); };
  const cancelLocationChange = () => { setPendingAddressId(null); setChangingLocation(false); };
  const confirmLocationChange = () => {
    const next = addressList.find((a) => a.id === pendingAddressId);
    if (!next) return;
    setAddressId(next.id);
    setPickedLat(next.lat);
    setPickedLng(next.lng);
    setChangingLocation(false);
    setPendingAddressId(null);
  };
  const selectPendingAddress = (a: SavedAddress) => setPendingAddressId(a.id);
  const goToLocationSettings = () => { setChangingLocation(false); setPendingAddressId(null); router.push('/profile/addresses'); };

  const applyCoupon = async () => {
    const code = couponCode.trim();
    if (!code) return;
    setCheckingCoupon(true);
    setCouponResult(null);
    try {
      // Captured before the await so the tag is the basket actually sent, not
      // whatever it has become by the time the response lands.
      const validatedAgainst = cart.subtotal;
      const res = await coupons.validate(code, validatedAgainst);
      setCouponResult({
        ok: res.valid, message: res.message,
        discount: Number(res.discount_amount) || 0, subtotal: validatedAgainst,
      });
    } catch (e) {
      // Transport only: a coupon that is expired/invalid comes back on the
      // SUCCESS path as res.message, so nothing meaningful is lost here.
      setCouponResult({ ok: false, message: failureMessage(e, t, { subsystem: 'checkout', op: 'validate_coupon' }), discount: 0, subtotal: cart.subtotal });
    } finally {
      setCheckingCoupon(false);
    }
  };

  /**
   * Drop an applied coupon as soon as the basket it was priced against changes.
   *
   * Watching the SUBTOTAL rather than each mutation site is the point: the cart
   * can move from the stepper, the remove dialog, the product editor reached by
   * tapping a line, or the Cart screen behind this one — and this screen stays
   * mounted through all of it. Every previous fix added another `setCouponResult(null)`
   * to whichever handler had been noticed; the ones nobody thought of shipped a
   * discount the server would later reject outright.
   *
   * An unapplied rejection message is left alone: it is about the code, not the
   * basket, and clearing it would erase the explanation the customer is reading.
   */
  useEffect(() => {
    setCouponResult((prev) => (appliedCouponSurvives(prev, cart.subtotal) ? prev : null));
  }, [cart.subtotal]);

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

  // The confirmed location, and the landmark that travels WITH it.
  //
  // The landmark is read off the saved address rather than a field on this
  // screen. Checkout no longer edits it — location settings owns it — so the
  // only question left here is whether the address the customer is about to
  // order to actually carries one. An address written by the order-type gate
  // always does; one created before the landmark became mandatory may not, and
  // that is what this still guards.
  const selectedAddress = useMemo(
    () => addressList.find((a) => a.id === addressId) ?? null,
    [addressList, addressId],
  );
  const requiresDescription = orderType === 'delivery';
  const descCheck = checkDescription(selectedAddress?.description);
  const noteCheck = checkOrderNote(notes);

  // Advisory only — see deliveryLocationWarning. Never feeds a block.
  const gpsWarning = useMemo(
    () => (orderType === 'delivery' ? mismatchWarning(deviceFix, { lat: pickedLat, lng: pickedLng }, lang) : null),
    [orderType, deviceFix, pickedLat, pickedLng, lang],
  );

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
    : !hasPickedCoords ? pick('No delivery location is selected', 'لم يتم تحديد موقع التوصيل')
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
  const block = useMemo((): BlockMessage | null => {
    // Priority order (and, critically, empty-cart BEFORE below-minimum) lives in
    // the pure resolver; this only maps the winning reason to localized copy.
    const reason: BlockReason | null = resolveBlockReason({
      hasBranch: Boolean(selectedBranch),
      branchOpen,
      hasOrderType: Boolean(orderType),
      isEmpty: cart.items.length === 0,
      belowMinimum: totals.belowMinimum,
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
        // The shortfall is a MONEY FIGURE, so it renders through <Price> on its
        // own row rather than being interpolated into the sentence: a number
        // inside a template string cannot carry the SAMA riyal glyph, and the
        // previous `formatSAR(...)` here printed the letters "SAR" — the one
        // thing the design system forbids for a visible amount.
        return {
          title: pick('Your order is below the delivery minimum', 'طلبك أقل من الحد الأدنى للتوصيل'),
          amount: totals.missingForMinimum,
          amountLabel: pick('Still needed', 'المتبقي'),
          action: pick('Add more items, or switch to pickup.', 'أضف أصنافاً أخرى، أو حوّل إلى الاستلام.'),
        };
      case 'no-payment':
        return { title: pick('No payment method is available', 'لا توجد طريقة دفع متاحة'), action: pick('Please try again shortly.', 'يرجى المحاولة بعد قليل.') };
      case 'delivery-unserviceable':
        // The fix is no longer "move the pin" — Checkout does not move pins any
        // more. It is to pick a different saved location, or add one in
        // location settings.
        return { title: deliveryBlockReason as string, action: pick('Choose a different saved location.', 'اختر موقعاً محفوظاً آخر.') };
      case 'need-description':
        // Likewise: the landmark belongs to the saved location, so the fix is to
        // edit it where it lives, not to retype it here.
        return {
          title: pick('This location needs delivery guidance', 'هذا الموقع يحتاج إرشادات توصيل'),
          action: pick('Open location settings and add a nearby landmark.', 'افتح إعدادات المواقع وأضف أقرب معلم.'),
        };
      default:
        return null;
    }
  }, [selectedBranch, branchOpen, orderType, totals.belowMinimum, lang, t, paymentBlocked, paymentMethod, pick,
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
      setConfirmRemove({ cartItemId, name: cartLineLabel(item, pick) });
      return;
    }
    // Mark the line as settling BEFORE mutating: the ref blocks the next
    // same-frame tap immediately; the state drives the stepper `busy` and blocks
    // submission until the effect below clears it once the cart re-renders.
    recalcRef.current = cartItemId;
    setRecalcLine(cartItemId);
    if (direction === 1) cart.incrementLine(cartItemId);
    else cart.decrementLine(cartItemId);
    // The coupon is invalidated by the effect below, which watches the subtotal
    // rather than each mutation site.
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
      // Availability can change between browsing and paying — a cashier closes
      // an item mid-order. Without this, the only signal was place_order's raw
      // "A product in your cart is not available at the selected branch", at the
      // very end of the flow and without saying WHICH product. Check first, and
      // name them. Options count too: a line naming a closed modifier is just
      // as unorderable as one naming a closed product. A failed refresh returns null; in that case say nothing and
      // let the server remain the authority, rather than blocking a valid order
      // on a flaky network.
      const fresh = await refreshAvailability();
      if (fresh) {
        const soldOut = validateCartForBranch(
          cart.items, selectedBranch.id,
          availabilityLookup(fresh.products), availabilityLookup(fresh.modifiers),
        ).invalid;
        if (soldOut.length > 0) {
          const names = soldOut.map((it) => cartLineLabel(it, pick)).join('، ');
          setError(`${t('soldOutNow')}: ${names}. ${t('soldOutBody')}`);
          return;
        }
      }

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

      // Resolve the delivery address. Checkout SELECTS one; it never writes one.
      //
      // Every delivery order arrives here with a saved address behind it: the
      // order-type gate is blocking and its `confirmNewAddress` always persists
      // the chosen point through `addressBook.create`. So the three-way
      // create/update/reuse dance that used to live here is gone, and with it
      // the second place a landmark could be written — the duplication
      // `order/locationDescription` exists to prevent.
      let deliveryAddressId: string | null = null;
      if (orderType === 'delivery') {
        const saved = addressList.find((a) => a.id === addressId);
        if (!saved) throw new Error(pick('No delivery location is selected', 'لم يتم تحديد موقع التوصيل'));
        // The landmark is the saved location's own. An address with an unusable
        // one is fixed in location settings, not retyped here.
        const desc = checkDescription(saved.description);
        if (!desc.valid) {
          throw new Error(pick(
            'This location needs delivery guidance. Open location settings and add a nearby landmark.',
            'هذا الموقع يحتاج إرشادات توصيل. افتح إعدادات المواقع وأضف أقرب معلم.',
          ));
        }
        deliveryAddressId = saved.id;
      }

      const orderInput = {
        branchId: selectedBranch.id,
        orderType,
        items: cart.toOrderItems(),
        addressId: deliveryAddressId,
        couponCode: couponResult?.ok ? couponCode.trim() : null,
        notes: normalizeOrderNote(notes),
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
      setError(failureMessage(e, t, { subsystem: 'checkout', op: 'place_order' }));
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
      // FROZEN PATH — left exactly as it was. Improving this message is
      // payment work under CLAUDE.md section 6 and was never owner-approved;
      // the branch asserted a "scoped exception" that did not exist. It does
      // still leak raw provider text to the customer — see docs/OWNER_ACTIONS.md.
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
      // FROZEN PATH — see the note on the open_checkout catch above.
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

  // ---- Presentation ---------------------------------------------------------

  const isDelivery = orderType === 'delivery';
  const orderTypeLabel =
    orderType === 'pickup' ? t('otPickup') : orderType === 'delivery' ? t('otDelivery') : '';

  const paymentLabelFor = (m: PaymentMethod) =>
    m === 'online' ? t('payOnline')
    : isDelivery ? t('cashOnDelivery')
    : t('cashOnPickup');

  return (
    <View style={styles.root}>
      <Header title={t('checkout')} showBack safeTop />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          // Tail room clears the sticky footer AND the keyboard, so the focused
          // description field and its message stay visible while typing.
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.column}>
          <OrderTypeRow
            typeLabel={orderTypeLabel}
            branchName={selectedBranch ? pick(selectedBranch.nameEn, selectedBranch.nameAr) : null}
            changeLabel={t('otChange')}
            onChange={() => setShowTypeChange(true)}
          />

          <Section title={t('paymentMethodTitle')}>
            <PaymentMethodPicker
              methods={payMethods}
              selected={paymentMethod}
              onSelect={setPaymentMethod}
              labelFor={paymentLabelFor}
              blocked={paymentBlocked}
              blockedTitle={pick('No payment method is currently available.', 'لا توجد طريقة دفع متاحة حالياً.')}
              outageNotice={showOnlineOutageNotice
                ? pick('Online payment is currently unavailable. Cash payment is enabled.', 'الدفع الإلكتروني غير متاح حالياً. الدفع النقدي مفعّل.')
                : null}
              cashNote={paymentMethod === 'cash'
                ? pick('Pay in cash when you receive your order.', 'يُدفع المبلغ نقداً عند استلام طلبك.')
                : null}
            />
          </Section>

          {isDelivery ? (
            <Section title={changingLocation
              ? pick('Choose your delivery location', 'اختر موقع التوصيل')
              : pick('Delivery location', 'موقع التوصيل')}>
              <DeliveryLocationSection
                lang={lang}
                lat={pickedLat}
                lng={pickedLng}
                locationLabel={selectedAddress?.label?.trim() || t('deliveryAddress')}
                locationDescription={selectedAddress?.description ?? orderCtx.context?.deliveryDescription ?? ''}
                changing={changingLocation}
                onStartChange={startLocationChange}
                onCancelChange={cancelLocationChange}
                onConfirmChange={confirmLocationChange}
                onManageLocations={goToLocationSettings}
                addresses={addressList}
                selectedAddressId={changingLocation ? pendingAddressId : addressId}
                onSelectAddress={selectPendingAddress}
                gpsWarning={gpsWarning}
                blockReason={deliveryBlockReason}
                labels={{
                  change: pick('Change location', 'تغيير الموقع'),
                  confirm: pick('Confirm location', 'تأكيد الموقع'),
                  cancel: t('cancel'),
                  savedTitle: pick('Saved locations', 'المواقع المحفوظة'),
                  savedFallbackLabel: t('deliveryAddress'),
                  manageTitle: pick('Manage saved locations', 'إدارة المواقع المحفوظة'),
                  manageSubtitle: pick('Add a new location or edit a saved one', 'أضف موقعاً جديداً أو عدّل موقعاً محفوظاً'),
                  missing: pick('No delivery location is selected', 'لم يتم تحديد موقع التوصيل'),
                }}
                mapLabels={{
                  locateHint: pick('Move the pin to your exact location', 'حرّك الدبوس إلى موقعك بالضبط'),
                  useMyLocation: pick('Use my location', 'استخدم موقعي'),
                  setupRequired: pick('Map setup required — ask support to enable the map.', 'إعداد الخريطة مطلوب — تواصل مع الدعم لتفعيل الخريطة.'),
                }}
              />
            </Section>
          ) : null}

          <Section title={t('couponTitle')}>
            <CouponRow
              code={couponCode}
              onChangeCode={(v) => { setCouponCode(v); setCouponResult(null); }}
              onApply={applyCoupon}
              applying={checkingCoupon}
              label={t('couponTitle')}
              placeholder={t('couponPlaceholder')}
              applyLabel={t('applyCoupon')}
              result={couponResult}
              appliedLabel={t('couponApplied')}
            />
          </Section>

          {loyaltyEnabled ? (
            <Section>
              <LoyaltyToggle
                on={redeemPoints}
                onToggle={() => setRedeemPoints((v) => !v)}
                label={t('useLoyalty')}
                pointsLabel={`${availablePoints} ${t('pointsAvailable')}`}
              />
            </Section>
          ) : null}

          <Section title={t('orderNotes')}>
            <Field
              id="checkout-notes"
              label={t('orderNotes')}
              labelHidden
              value={notes}
              onChangeText={setNotes}
              placeholder={t('notesPlaceholder')}
              multiline
              inputStyle={styles.multiline}
              // The server enforces the same bound
              // (supabase/migrations/20260819120000_order_note_length_limit.sql).
              // This stops the customer reaching it rather than being refused
              // after tapping Place order.
              maxLength={ORDER_NOTE_MAX_LENGTH}
              hint={orderNoteRemainingMessage(notes, lang) ?? undefined}
              error={orderNoteMessage(noteCheck.problem, lang)}
            />
          </Section>

          {/* Editable cart lines — fix a below-minimum order without leaving
              Checkout and losing the pin, coupon and payment method. */}
          <Section title={pick('Your items', 'أصنافك')}>
            <CheckoutLines
              items={cart.items}
              recalcLineId={recalcLine}
              nameOf={(it) => cartLineLabel(it, pick)}
              modifierSummaryOf={(it) => modifierSummary(it, pick)}
              amountOf={lineTotal}
              onIncrement={(id) => changeQuantity(id, 1)}
              onDecrement={(id) => changeQuantity(id, -1)}
              // Same destination the Cart screen uses, so one line edited from
              // either screen goes through one editor and one cart.updateItem.
              onEdit={(it) => router.push({ pathname: '/product/[id]', params: { id: it.product.id, cartItemId: it.cartItemId } })}
              editLabel={pick('Edit item', 'تعديل المنتج')}
            />
          </Section>

          <TotalsCard
            totals={totals}
            isDelivery={isDelivery}
            labels={{
              subtotal: t('subtotal'),
              deliveryFee: t('deliveryFee'),
              discount: t('discount'),
              loyaltyDiscount: t('loyaltyDiscount'),
              // Single substitution at the point of use. The i18n layer has no
              // interpolation and this PR does not add one for a single string.
              vat: t('vat').replace('{rate}', String(brand?.vatPercentage ?? 15)),
              total: t('total'),
            }}
            serverNote={`* ${pick('Final amounts are confirmed by the server.', 'يتم تأكيد المبالغ النهائية من الخادم.')}`}
          />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <CheckoutFooter
        block={block}
        error={error}
        submitLabel={placing ? t('placingOrder') : t('placeOrder')}
        submitDisabled={!canPlace}
        submitting={placing}
        onSubmit={placeOrder}
        consentPrefix={pick('By placing this order, you agree to the ', 'بإتمام الطلب، فإنك توافق على ')}
        consentSeparator={pick(', ', '، ')}
        consentLastSeparator={pick(', and ', '، و')}
        links={LEGAL_DOCS.map((doc) => ({
          key: doc,
          title: legalTitle(doc, lang),
          onPress: () => router.push(`/legal/${doc}`),
        }))}
        paddingBottom={insets.bottom + space.s2}
      />

      {/* Confirm before a decrement removes the last unit of a line. */}
      <ConfirmDialog
        visible={confirmRemove !== null}
        title={pick('Remove this item?', 'إزالة هذا الصنف؟')}
        message={confirmRemove?.name ?? ''}
        confirmLabel={pick('Remove', 'إزالة')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          if (confirmRemove) {
            cart.removeLine(confirmRemove.cartItemId);
          }
          setConfirmRemove(null);
        }}
        onCancel={() => setConfirmRemove(null)}
      />

      {/* Online-payment (Tap) overlay. Dismissing (including Android back) never
          touches the persisted session, so recovery still resolves an in-flight
          charge; it never confirms or creates anything. */}
      <PaymentStatusDialog
        state={payFlow?.state ?? null}
        // `?? t('payFailed')` preserves the original fallback: a state that
        // somehow arrives without a message must not render an empty dialog.
        message={payFlow ? (payFlow.message ?? t('payFailed')) : null}
        busy={payBusy}
        labels={{
          title: t('payTitle'),
          opening: t('payOpening'),
          verifying: t('payVerifying'),
          cancel: t('cancel'),
          close: t('close'),
          continuePayment: t('payContinue'),
          verifyAgain: t('payVerifyAgain'),
          tryAgain: t('payTryAgain'),
          statusPending: t('payStatusPending'),
          statusFailed: t('payStatusFailed'),
          statusCancelled: t('payStatusCancelled'),
          statusExpired: t('payStatusExpired'),
        }}
        onContinue={() => payFlow?.sessionId && void runTapPaymentSession(payFlow.sessionId)}
        onVerifyAgain={() => payFlow?.sessionId && void verifyPaymentSession(payFlow.sessionId)}
        onResume={() => payFlow?.sessionId && void runTapPaymentSession(payFlow.sessionId)}
        onRetryFresh={() => void retryFresh()}
        onClose={dismissPayFlow}
      />

      {/* Confirm before changing order type — it can change the branch, delivery
          fee, item availability and cart contents. Confirm → re-open selection. */}
      <ConfirmDialog
        visible={showTypeChange}
        title={t('otChangeTypeTitle')}
        message={t('otChangeTypeBody')}
        confirmLabel={t('otChange')}
        cancelLabel={t('cancel')}
        onConfirm={() => { setShowTypeChange(false); router.push('/select'); }}
        onCancel={() => setShowTypeChange(false)}
      />
    </View>
  );
}

function modifierSummary(it: CartItem, pick: (en: string, ar: string) => string): string {
  const mods = Object.values(it.selectedModifiers).flat();
  return mods.map((m) => pick(m.nameEn, m.nameAr)).join(' · ');
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.appBg },
  flex: { flex: 1 },
  scroll: {
    padding: space.s4,
    // Tail room clears the sticky footer AND the keyboard.
    paddingBottom: 260,
    // Centre the capped column. `alignItems` on the content container plus
    // `width: '100%'` on the child, rather than `alignSelf` on the container
    // itself — the latter centres on web but is not dependable for a
    // ScrollView's content container on native.
    alignItems: 'center',
  },
  // Checkout is one column of decisions. On a tablet, letting it run the full
  // width turns a 40-character line into a 120-character one and drags the
  // money column metres from its labels. Below the cap — every phone — this
  // changes nothing.
  column: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, gap: space.s5 },
  multiline: { minHeight: 84, paddingTop: space.s3, textAlignVertical: 'top' },
}));
