/**
 * Checkout's content-column width.
 *
 * The constant now lives in the design system (`ui/ContentColumn`) because
 * Orders, Receipt, Profile and the order-type gate adopted the same pattern —
 * one number, not five. Re-exported here so Checkout's own imports keep
 * pointing at a checkout-local module.
 */
export { CONTENT_MAX_WIDTH } from '../../../design-system/ui/ContentColumn';
