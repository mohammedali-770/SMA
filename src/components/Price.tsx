/**
 * Money display for the admin web app: official Saudi Riyal symbol then the
 * amount, symbol always to the LEFT in both RTL and LTR (dir="ltr" + isolate).
 * Western digits, two decimals — DISPLAY only; the machine-readable code stays
 * "SAR".
 */
import React from 'react';

import { SaudiRiyalSymbol } from './SaudiRiyalSymbol';

export function Price({ amount, prefix, className }: { amount: number; prefix?: string; className?: string }) {
  const value = amount.toFixed(2);
  return (
    <span
      className={className}
      dir="ltr"
      aria-label={(prefix ? prefix + ' ' : '') + value + ' Saudi Riyal'}
      style={{ unicodeBidi: 'isolate', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '0.2em' }}
    >
      {prefix ? <span>{prefix}</span> : null}
      <SaudiRiyalSymbol title="" />
      {value}
    </span>
  );
}