/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

import { AdminModal } from '../../admin/view/shared/AdminModal';
import { Button } from '../../../design-system/ui/Button';
import { Notice } from '../../../design-system/ui/Notice';
import { Text } from '../../../design-system/ui/Text';
import { StatusPill } from '../../../design-system/ui/StatusPill';
import type { Modifier, ModifierGroup, Product, ProductVariant } from '../../../types';
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
 * PER-TIER CLOSING IS REAL NOW, AND IT IS BEHIND A SWITCH. The server half
 * shipped in `20260923120000` (table + `set_variant_snooze`) and
 * `20260924120000` (both money-path functions refuse a closed tier). This sheet
 * is the operator half.
 *
 * `perSizeEnabled` comes from `app_settings.variant_closing_enabled`, and the
 * reason it exists is a clock, not a doubt about the feature. This console
 * deploys the moment the change merges; the customer app reaches a customer only
 * in the next EAS build. A build that does not know the refusal shows a generic
 * error at the payment step, because `failureMessage` returns a translated KEY
 * rather than the server's sentence. While the switch is off the Close buttons
 * are ABSENT — not disabled — and a notice explains what closing the item will
 * do instead. A disabled control the cashier cannot enable is a worse lie than
 * an explanation.
 *
 * IT GATES CLOSING ONLY, NEVER THE CLOSED STATE — a correction from review on
 * #395. A tier closed while the switch was on stays refused by `place_order`
 * and stays greyed out in the customer app after it is switched off again, so a
 * console that hid the closure would be the one component lying about it, and
 * would take away the only per-size Reopen there is. The switch also reads false
 * when its own query fails, which must not be able to strand stock. So a closed
 * tier always shows its pill, always counts toward "every size closed", and
 * always keeps its Reopen.
 *
 * OPTION GROUPS ARE HERE TOO, AND THAT IS A CORRECTION RATHER THAN A FLOURISH.
 * The first draft of this redesign replaced the per-product "Show options"
 * accordion with nothing, which would have silently removed the ability to close
 * a single option — a capability the server has supported since
 * `20260820140500_place_order_modifier_availability`. The existing suite caught
 * it. Options are sub-selections just as tiers are, so they belong in the same
 * sheet; the difference is that closing one of these actually works today.
 *
 * IT GOES THROUGH `AdminModal`, AND THE FIRST VERSION DID NOT — that is the
 * second correction, caught in review on #393. It hand-rolled a `fixed inset-0`
 * div carrying `role="dialog" aria-modal="true"` while moving no focus, trapping
 * none, restoring none, inerting nothing behind it and answering no Escape key.
 * `aria-modal` is a promise to assistive technology that the rest of the page is
 * unreachable, and Tab reached every tile underneath. `ModalShell` — which
 * `AdminModal` wraps, and which `CloseItemDialog`, `PauseDeliveryDialog` and the
 * reopen-all confirm already use — exists so there is exactly one place that
 * behaviour can be right; this was the only dialog in the console outside it.
 *
 * The visible cost is that it is a centred dialog rather than a sheet rising
 * from the bottom edge. That matches every other dialog here, which is worth
 * more than the animation was.
 */
export const VariantSheet: React.FC<{
  product: Product;
  closed: boolean;
  optionGroups: ModifierGroup[];
  closedOptionIds: Set<string>;
  closedVariantIds: Set<string>;
  /** `app_settings.variant_closing_enabled` — see the note above. */
  perSizeEnabled: boolean;
  i18n: OpsLangValue;
  busy?: boolean;
  onCloseWhole: () => void;
  onReopenWhole: () => void;
  onCloseOption: (m: Modifier) => void;
  onReopenOption: (m: Modifier) => void;
  onCloseVariant: (v: ProductVariant) => void;
  onReopenVariant: (v: ProductVariant) => void;
  onDismiss: () => void;
}> = ({
  product,
  closed,
  optionGroups,
  closedOptionIds,
  closedVariantIds,
  perSizeEnabled,
  i18n,
  busy,
  onCloseWhole,
  onReopenWhole,
  onCloseOption,
  onReopenOption,
  onCloseVariant,
  onReopenVariant,
  onDismiss,
}) => {
  const { t, isRTL } = i18n;
  const name = isRTL ? product.nameAr : product.nameEn;
  const tiers = activeVariants(product);
  // Not gated on the switch: a closed tier is refused by `place_order` whatever
  // the switch says, so the warning has to be true whenever the rows are.
  const everySizeClosed = tiers.length > 0 && tiers.every((v) => closedVariantIds.has(v.id));

  return (
    <AdminModal
      title={name}
      subtitle={`${tiers.length} ${t(tiers.length === 1 ? 'sizesCountOne' : 'sizesCount')}`}
      isRTL={isRTL}
      size="2xl"
      // `onDismiss` already refuses while an RPC is in flight, so Escape and the
      // ✕ inherit that guard rather than needing a second copy of it.
      onClose={onDismiss}
      footer={
        <>
          <Button
            label={closed ? t('reopen') : t('closeWholeItem')}
            onClick={closed ? onReopenWhole : onCloseWhole}
            disabled={busy}
            variant="primary"
          />
          <Button label={t('done')} onClick={onDismiss} disabled={busy} variant="secondary" />
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {tiers.length === 0 ? (
          <Text variant="body" tone="tertiary" as="p">
            {t('noResults')}
          </Text>
        ) : (
          tiers.map((v) => {
            const off = closedVariantIds.has(v.id);
            return (
              <div
                key={v.id}
                className={[
                  'flex items-center justify-between gap-3 rounded-[var(--radius-ds-md)] border p-3',
                  off ? 'border-danger-line bg-danger-tint' : 'border-con-line bg-con-surface',
                ].join(' ')}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Text variant="label" as="span">
                    {isRTL ? v.nameAr : v.nameEn}
                  </Text>
                  {/* A STATE, not the verb — the same distinction the option
                        rows below make, and for the same reason: the pill sits a
                        thumb from a button performing the opposite action. */}
                  {off ? <StatusPill label={t('stateClosed')} tone="danger" /> : null}
                </div>
                <div className="flex items-center gap-2">
                  <Text variant="caption" tone="tertiary" as="span" numeric>
                    {`${v.price.toFixed(2)} ${t('currency')}`}
                  </Text>
                  {/* REOPEN IS ALWAYS OFFERED; only CLOSE is switched. A tier
                        closed before the switch was turned off is still refused
                        by the server, so taking away the control that undoes it
                        would strand it with no way back from this console. */}
                  {off || perSizeEnabled ? (
                    <Button
                      label={off ? t('reopen') : t('close')}
                      data-testid={`size-${v.id}`}
                      onClick={() => (off ? onReopenVariant(v) : onCloseVariant(v))}
                      disabled={busy}
                      variant="secondary"
                    />
                  ) : null}
                </div>
              </div>
            );
          })
        )}
        {/* Closing every size takes the item off the menu as surely as closing
            the item does, and `place_order` refuses it — so say so here rather
            than leaving the cashier to infer it from four red rows. */}
        {everySizeClosed ? <Notice title={t('sizesAllClosed')} tone="warning" /> : null}
        {/* Two different things to say when the switch is off, because a
            cashier looking at a Reopen button needs to know why there is no
            Close beside it. */}
        {!perSizeEnabled && tiers.length > 0 ? (
          <Notice
            title={tiers.some((v) => closedVariantIds.has(v.id))
              ? t('sizesPerSizeOffReopenOnly')
              : t('sizesPerSizeSoon')}
            tone="info"
          />
        ) : null}

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
    </AdminModal>
  );
};
