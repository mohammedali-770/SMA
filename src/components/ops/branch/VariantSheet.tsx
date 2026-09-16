/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

import { Button } from '../../../design-system/ui/Button';
import { Notice } from '../../../design-system/ui/Notice';
import { Text } from '../../../design-system/ui/Text';
import { StatusPill } from '../../../design-system/ui/StatusPill';
import type { Modifier, ModifierGroup, Product } from '../../../types';
import { activeVariants } from '../branchConsole';
import type { OpsLangValue } from '../useOpsLang';

/**
 * The price tiers behind one product, with what each costs.
 *
 * WHY THIS EXISTS AT ALL. Fifty-nine products carry tiers and one carries a
 * modifier group, so the accordion this sits beside — which only ever showed
 * modifier groups — was invisible on all but one item. A cashier closing
 * "وجبة عائلية دنر" could not see that it means nine different prices.
 *
 * WHAT IT CANNOT DO YET, SAID ON THE SHEET RATHER THAN DISCOVERED. Closing a
 * single TIER needs a `branch_variant_availability` table, a `set_variant_snooze`
 * RPC and a `place_order` that refuses a closed tier — none of which exist. The
 * per-tier buttons are therefore absent, not disabled: a disabled control that
 * never becomes enabled is a worse lie than an explanation. The footer closes
 * the whole product, which is exactly what the old row did, and the notice says
 * that is what will happen.
 *
 * OPTION GROUPS ARE HERE TOO, AND THAT IS A CORRECTION RATHER THAN A FLOURISH.
 * The first draft of this redesign replaced the per-product "Show options"
 * accordion with nothing, which would have silently removed the ability to close
 * a single option — a capability the server has supported since
 * `20260820140500_place_order_modifier_availability`. The existing suite caught
 * it. Options are sub-selections just as tiers are, so they belong in the same
 * sheet; the difference is that closing one of these actually works today.
 */
export const VariantSheet: React.FC<{
  product: Product;
  closed: boolean;
  optionGroups: ModifierGroup[];
  closedOptionIds: Set<string>;
  i18n: OpsLangValue;
  busy?: boolean;
  onCloseWhole: () => void;
  onReopenWhole: () => void;
  onCloseOption: (m: Modifier) => void;
  onReopenOption: (m: Modifier) => void;
  onDismiss: () => void;
}> = ({
  product,
  closed,
  optionGroups,
  closedOptionIds,
  i18n,
  busy,
  onCloseWhole,
  onReopenWhole,
  onCloseOption,
  onReopenOption,
  onDismiss,
}) => {
  const { t, isRTL } = i18n;
  const name = isRTL ? product.nameAr : product.nameEn;
  const tiers = activeVariants(product);

  return (
    <div
      className="fixed inset-0 z-40 grid items-end justify-items-center bg-brand-ink/45"
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onDismiss();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-t-[20px] bg-con-surface">
        <div className="border-b border-con-line p-4">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-con-line" aria-hidden="true" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Text variant="heading" as="h2">
                {name}
              </Text>
              <Text variant="caption" tone="tertiary" as="p">
                {`${tiers.length} ${t(tiers.length === 1 ? 'sizesCountOne' : 'sizesCount')}`}
              </Text>
            </div>
            <Button label={t('cancel')} onClick={onDismiss} disabled={busy} variant="ghost" />
          </div>
        </div>

        <div className="flex flex-col gap-2 overflow-auto p-4">
          {tiers.length === 0 ? (
            <Text variant="body" tone="tertiary" as="p">
              {t('noResults')}
            </Text>
          ) : (
            tiers.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3"
              >
                <Text variant="label" as="span">
                  {isRTL ? v.nameAr : v.nameEn}
                </Text>
                <Text variant="caption" tone="tertiary" as="span" numeric>
                  {`${v.price.toFixed(2)} ${t('currency')}`}
                </Text>
              </div>
            ))
          )}
          {tiers.length > 0 ? <Notice title={t('sizesPerSizeSoon')} tone="info" /> : null}

          {optionGroups.map((g) => (
            <div key={g.id} className="flex flex-col gap-2 border-t border-con-line pt-3">
              <div className="flex items-center gap-2">
                <Text variant="caption" tone="tertiary" as="h3">
                  {isRTL ? g.nameAr : g.nameEn}
                </Text>
                <StatusPill
                  label={g.isRequired ? t('requiredGroup') : t('optionalGroup')}
                  tone={g.isRequired ? 'danger' : 'neutral'}
                />
              </div>
              {g.modifiers.map((m) => {
                const off = closedOptionIds.has(m.id);
                return (
                  <div
                    key={m.id}
                    className={[
                      'flex items-center justify-between gap-3 rounded-[var(--radius-ds-md)] border p-3',
                      off ? 'border-danger-line bg-danger-tint' : 'border-con-line bg-con-surface',
                    ].join(' ')}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Text variant="body" as="span">
                        {isRTL ? m.nameAr : m.nameEn}
                      </Text>
                      {/* A STATE, not the verb. The pill sits a thumb from the
                          button that performs the opposite action, and
                          labelling it with the same word the button uses reads
                          as two buttons rather than a status and a control. */}
                      {off ? <StatusPill label={t('stateClosed')} tone="danger" /> : null}
                    </div>
                    <Button
                      label={off ? t('reopen') : t('close')}
                      data-testid={`option-${m.id}`}
                      onClick={() => (off ? onReopenOption(m) : onCloseOption(m))}
                      disabled={busy}
                      variant="secondary"
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex gap-3 border-t border-con-line p-4">
          <Button
            label={closed ? t('reopen') : t('closeWholeItem')}
            onClick={closed ? onReopenWhole : onCloseWhole}
            disabled={busy}
            variant="primary"
            className="flex-1"
          />
          <Button
            label={t('done')}
            onClick={onDismiss}
            disabled={busy}
            variant="secondary"
            className="flex-1"
          />
        </div>
      </div>
    </div>
  );
};
