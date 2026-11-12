/**
 * Accessible name for a menu card that opens the item's options.
 *
 * WHY THE PRICE IS IN THE NAME. When an item needs a choice, the whole card is
 * one button. A labelled button is announced as its label ONLY — natively and on
 * the web — so a card labelled with the product name hid the price from a
 * screen-reader user until they opened every item (R07#3). The visible price is
 * an SVG riyal mark plus digits, with no text equivalent of its own, so it is
 * spelled out through `priceAccessibilityLabel`, the helper `<Price>` uses.
 *
 * Framework-free so it is unit-tested under Node.
 */
import { priceAccessibilityLabel } from '../generated/money';

export function productCardAccessibilityLabel(
  name: string,
  price: number,
  lang: 'en' | 'ar',
  prefix?: string,
): string {
  return `${name}, ${priceAccessibilityLabel(price, lang, prefix)}`;
}
