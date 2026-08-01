/**
 * Money display for the admin web app: official Saudi Riyal symbol then the
 * amount, symbol always to the LEFT in both RTL and LTR (dir="ltr" + isolate).
 * Western digits, two decimals — DISPLAY only; the machine-readable code stays
 * "SAR".
 *
 * Formatting and the accessible label come from the shared design-system money
 * module (`design-system/money.ts`), so the console and the mobile app cannot
 * drift on grouping, decimals, digit shape or how a price is announced.
 * Rendering is unchanged.
 */
import React from 'react';

import { formatAmount, priceAccessibilityLabel, type Lang } from '../design-system/generated/money';
import { SaudiRiyalSymbol } from './SaudiRiyalSymbol';

export function Price({
  amount,
  prefix,
  className,
  lang = 'en',
}: {
  amount: number;
  prefix?: string;
  className?: string;
  /**
   * Language for the screen-reader label only — the digits are identical in
   * both. Defaults to 'en' to preserve today's behaviour; panels that already
   * know the active language should pass it so Arabic users hear
   * "ريال سعودي" rather than "Saudi Riyal".
   */
  lang?: Lang;
}) {
  const value = formatAmount(amount);
  // `num` binds the IBM Plex Mono stack and tabular figures. Applied HERE
  // rather than left to call sites: money is the most prominent structured
  // number in the product, and the console had it mono in some tables and
  // proportional in others depending on who remembered the class. Tabular
  // figures also stop a column of totals jittering as digits change.
  return (
    <span
      className={`num${className ? ` ${className}` : ''}`}
      dir="ltr"
      aria-label={priceAccessibilityLabel(amount, lang, prefix)}
      style={{ unicodeBidi: 'isolate', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '0.2em' }}
    >
      {prefix ? <span>{prefix}</span> : null}
      <SaudiRiyalSymbol title="" />
      {value}
    </span>
  );
}