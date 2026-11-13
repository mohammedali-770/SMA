/**
 * Selection state, exposed on BOTH native and the web export (R07#4).
 *
 * WHY NOT `accessibilityState`. React Native maps it natively, but
 * react-native-web 0.21 ignores it — only `disabled` is read, and only from the
 * `disabled` prop — so on the web export no radio, checkbox, switch or chip
 * reported whether it was on (WCAG 4.1.2, Level A; axe `aria-required-attr` on
 * every radio). React Native 0.88's `aria-*` props reach both: natively they
 * fold into the same accessibility state, and on the web they become the DOM
 * attributes. Checked and busy are a one-to-one swap (`aria-checked`,
 * `aria-busy`) and need no helper.
 *
 * SELECTED IS THE EXCEPTION, because ARIA allows `aria-selected` only on
 * tab, option, row and gridcell. A selected chip or branch card is a BUTTON, so
 * on the web it reports `aria-pressed` — the toggle-button state — while
 * natively it keeps the `selected` state VoiceOver and TalkBack already
 * announce. A radio reports `aria-checked` on the web and keeps both natively.
 *
 * Framework-free so it is unit-tested under Node; callers pass `Platform.OS`.
 */

/** A toggle-style button: a chip, a segment, the chosen branch card. */
export function selectedButtonState(
  selected: boolean,
  os: string,
): { 'aria-selected': boolean } | { 'aria-pressed': boolean } {
  return os === 'web' ? { 'aria-pressed': selected } : { 'aria-selected': selected };
}

/** A radio that also reported `selected` natively. */
export function selectedRadioState(
  selected: boolean,
  os: string,
): { 'aria-checked': boolean; 'aria-selected'?: boolean } {
  return os === 'web'
    ? { 'aria-checked': selected }
    : { 'aria-checked': selected, 'aria-selected': selected };
}
