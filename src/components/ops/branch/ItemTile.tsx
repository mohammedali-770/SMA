/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';

import { Text } from '../../../design-system/ui/Text';
import type { Product } from '../../../types';
import { activeVariants, fromPrice } from '../branchConsole';
import type { OpsLangValue } from '../useOpsLang';

export type TileState = 'open' | 'closed' | 'partial';

/**
 * One product on the cashier grid.
 *
 * WHY A TILE AND NOT A ROW. The list this replaces put one product per full
 * width, so a fifty-five item catalog is a long scroll and every item looks the
 * same. A cashier mid-rush is looking for one thing they already know the shape
 * of. Tiles put twelve on a screen and let colour and photograph do the finding.
 *
 * THE WHOLE TILE IS THE BUTTON. The list had a separate `Close` control per row,
 * which is a small target on a counter iPad and puts the action a thumb-width
 * from the neighbouring row's action. Here the target is the tile, and what it
 * opens depends on the item: a sheet when there are tiers to choose between, the
 * close dialog when there are not.
 *
 * THE TILE CARRIES NO `aria-label`, AND THAT IS DELIBERATE RATHER THAN AN
 * OMISSION. The first draft set `aria-label={name}`, which overrides the
 * button's content for assistive technology — so a screen reader announced
 * "Spicy Fries" for a tile whose ribbon said it was off. The row this replaces
 * exposed that state as ordinary text. Letting the name compute from content
 * puts it back.
 */
export const ItemTile: React.FC<{
  product: Product;
  state: TileState;
  hue: string;
  countdown: string | null;
  i18n: OpsLangValue;
  disabled?: boolean;
  onPick: () => void;
}> = ({ product, state, hue, countdown, i18n, disabled, onPick }) => {
  const { t, isRTL } = i18n;
  const name = isRTL ? product.nameAr : product.nameEn;
  const tiers = activeVariants(product);
  const price = fromPrice(product);
  /**
   * A photograph that FAILS to load must become the fallback, not a broken
   * image. Found by opening the grid in a real browser rather than in jsdom:
   * four tiles rendered the browser's broken-image glyph on a white box, which
   * is worse than the coloured block they were supposed to degrade to — it
   * reads as the console being broken. Storage is a separate origin from the
   * app, so an expired object, a bucket permission change or a captive network
   * produces this without anything else going wrong.
   */
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(product.imageUrl) && !imageFailed;

  const closed = state === 'closed';
  const partial = state === 'partial';

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      data-testid={`tile-${product.id}`}
      className={[
        'relative flex min-h-[150px] flex-col overflow-hidden rounded-[var(--radius-ds-lg)]',
        'border text-start focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:opacity-60',
        closed ? 'border-danger-line bg-danger-tint' : 'border-con-line bg-con-surface',
      ].join(' ')}
    >
      {closed ? (
        <span className="absolute top-2 z-10 rounded-full bg-danger-ds px-2 py-0.5 text-[10.5px] font-bold text-white ltr:left-2 rtl:right-2">
          {t('stateClosed')}
        </span>
      ) : null}
      {/*
        TWO WORDINGS FOR ONE STATE, because a ribbon and a sentence are not
        interchangeable. A tile has room for "Partly closed" and no more, but
        that phrase does not say WHY a cashier may not sell the item — and the
        row this replaced said so in full. The short one is hidden from
        assistive technology so it is not read twice.
      */}
      {partial ? (
        <>
          <span
            aria-hidden="true"
            className="absolute top-2 z-10 rounded-full bg-warn px-2 py-0.5 text-[10.5px] font-bold text-white ltr:left-2 rtl:right-2"
          >
            {t('partiallyClosed')}
          </span>
          <span className="sr-only">{t('blockedByOptions')}</span>
        </>
      ) : null}
      {countdown ? (
        <span className="absolute top-2 z-10 rounded-full bg-brand-ink/80 px-2 py-0.5 font-[var(--font-ds-num)] text-[10.5px] text-white ltr:right-2 rtl:left-2">
          {countdown}
        </span>
      ) : null}

      {/*
        The photograph when there is one, the category block when there is not.
        `object-cover` rather than `contain`: a menu photograph that letterboxes
        looks like a loading error on a grid of solid blocks.
      */}
      {showImage ? (
        <img
          src={product.imageUrl}
          alt=""
          aria-hidden="true"
          loading="lazy"
          onError={() => setImageFailed(true)}
          className={`h-[86px] w-full object-cover ${closed ? 'grayscale' : ''}`}
        />
      ) : (
        <div
          aria-hidden="true"
          className={`h-[86px] w-full ${closed ? 'grayscale' : ''}`}
          style={{ background: hue }}
        />
      )}

      <div className="flex flex-1 flex-col gap-0.5 p-3">
        <Text variant="label" as="span">{name}</Text>
        {/* "From" only when there is something to be cheapest OF. A single-tier
            item has one price, and calling it a starting price is a small lie
            that a cashier quoting it over the counter would have to unpick. */}
        <Text variant="caption" tone="tertiary" as="span" numeric>
          {tiers.length > 1
            ? `${t('fromPrice')} ${price.toFixed(2)} ${t('currency')}`
            : `${price.toFixed(2)} ${t('currency')}`}
        </Text>
        {tiers.length > 1 ? (
          <Text variant="caption" as="span" className="font-semibold text-sky">
            {`${tiers.length} ${t(tiers.length === 1 ? 'sizesCountOne' : 'sizesCount')} ›`}
          </Text>
        ) : null}
      </div>
    </button>
  );
};
