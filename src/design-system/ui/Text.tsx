/**
 * Design-system typography (admin console).
 *
 * The mirror of `apps/mobile/src/design-system/ui/Text.tsx`, and deliberately
 * the same API — `variant` / `tone` — so a component ported between the two
 * products reads identically. The type scale matches `design-system/tokens.ts`.
 *
 * Font family follows the ACTIVE LANGUAGE, not the string's content: Arabic
 * copy gets IBM Plex Sans Arabic, Latin copy IBM Plex Sans. They are one
 * superfamily drawn to the same skeleton, so a console that mixes them stays
 * coherent. On the web the browser resolves weights normally, so unlike React
 * Native there is one family per language rather than one per weight.
 */
import React from 'react';

import { useDsFontClass } from './useDsLang';

export type TextVariant =
  | 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption';
export type TextTone =
  | 'primary' | 'secondary' | 'tertiary' | 'ember' | 'success' | 'danger' | 'warning' | 'info' | 'onEmber';

/** Size + weight per variant. Matches the canonical scale. */
const VARIANT: Record<TextVariant, string> = {
  display: 'text-[26px] leading-8 font-bold',
  title: 'text-xl leading-[26px] font-bold',
  heading: 'text-[17px] leading-[23px] font-bold',
  body: 'text-[15px] leading-[22px] font-normal',
  label: 'text-[13px] leading-[18px] font-semibold',
  caption: 'text-[11.5px] leading-4 font-medium',
};

const TONE: Record<TextTone, string> = {
  primary: 'text-con-text',
  secondary: 'text-con-text-2',
  tertiary: 'text-con-text-3',
  ember: 'text-ember',
  success: 'text-mint',
  danger: 'text-danger-ds',
  warning: 'text-amber-ink',
  info: 'text-sky',
  onEmber: 'text-on-ember',
};

type Element = 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'div' | 'label';

interface Props extends React.HTMLAttributes<HTMLElement> {
  variant?: TextVariant;
  tone?: TextTone;
  /**
   * The rendered tag. Variant chooses SIZE, not semantics — a heading-sized
   * label is still a label — so the element is always explicit.
   */
  as?: Element;
  /** Structured numbers (money, counts, refs, timestamps) render mono. */
  numeric?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Text({
  variant = 'body',
  tone = 'primary',
  as: Tag = 'p',
  numeric,
  className = '',
  children,
  ...rest
}: Props) {
  // Via the shared defensive hook, not useApp(): useApp throws without a
  // provider, which would make this primitive unrenderable in a unit test.
  const family = useDsFontClass(numeric);

  return (
    <Tag
      {...rest}
      className={[family, VARIANT[variant], TONE[tone], className].filter(Boolean).join(' ')}
    >
      {children}
    </Tag>
  );
}
