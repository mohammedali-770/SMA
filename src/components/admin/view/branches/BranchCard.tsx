/**
 * One branch on the policies board — PRESENTATION plus direct edits.
 *
 * Every write goes out through a callback the panel supplies; this component
 * makes no permission decision of its own and calls no API. `disabled` arrives
 * already evaluated.
 *
 * The numeric fields save on CHANGE, exactly as before — there is no Save
 * button on this card and never was. That is deliberate for a board an operator
 * uses to react to a busy Friday: the fee they typed is the fee that applies.
 *
 * Delete stays a raw <button> rather than the design-system Button because it
 * needs a per-branch `aria-label` ("Delete branch Olaya") — one generic "Delete"
 * repeated across a grid of cards names nothing.
 */
import React from 'react';
import { AlertTriangle, Map as MapIcon, MapPin, Pencil, Trash2 } from 'lucide-react';

import { NumericCommitField } from '../NumericCommitField';
import { Card } from '../../../../design-system/ui/Card';
import { StatusPill } from '../../../../design-system/ui/StatusPill';
import { Text } from '../../../../design-system/ui/Text';
import { useDsFontClass } from '../../../../design-system/ui/useDsLang';
import type { Branch, Product } from '../../../../types';
import { ADMIN_LOCALES } from '../../adminLocales';
import { ToggleChip } from '../shared/ToggleChip';

const NUM_INPUT = [
  'ds-motion min-h-9 w-16 rounded-[var(--radius-ds-sm)] border border-con-line bg-con-surface px-1.5',
  'num text-end text-[13px] text-con-text transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
].join(' ');

const ROW_BTN = [
  'ds-motion inline-flex min-h-8 w-full items-center justify-center gap-1 rounded-[var(--radius-ds-sm)]',
  'border px-2 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

export function BranchCard({
  branch,
  products,
  adminLang,
  isAccountant,
  deleting,
  hasZone,
  isProductAvailableInBranch,
  onUpdate,
  onToggleProduct,
  onEdit,
  onOpenZone,
  onDelete,
}: {
  branch: Branch;
  products: Product[];
  adminLang: 'en' | 'ar';
  isAccountant: boolean;
  deleting: boolean;
  hasZone: boolean;
  isProductAvailableInBranch: (productId: string, branchId: string) => boolean;
  onUpdate: (patch: Partial<Branch>) => void;
  onToggleProduct: (productId: string) => void;
  onEdit: () => void;
  onOpenZone: () => void;
  onDelete: () => void;
}) {
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const family = useDsFontClass();

  const deliveryEnabled = branch.deliveryEnabled ?? true;
  const pickupEnabled = branch.pickupEnabled ?? true;
  const deliveryClosed = branch.deliveryTemporarilyClosed ?? false;
  const hasCoords = Number.isFinite(branch.latitude) && Number.isFinite(branch.longitude)
    && !(branch.latitude === 0 && branch.longitude === 0);

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Text variant="label" as="h4" className="truncate">{branch.nameEn}</Text>
          <Text variant="caption" tone="secondary" as="p" className="truncate" dir="rtl">{branch.nameAr}</Text>
          <Text variant="caption" tone="tertiary" as="p" className="mt-0.5 truncate">
            {isRTL ? branch.addressAr : branch.addressEn}
          </Text>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusPill
            label={branch.isActive ? 'OPEN' : 'CLOSED'}
            tone={branch.isActive ? 'success' : 'danger'}
          />
          <button type="button" onClick={onEdit} className={`${ROW_BTN} border-con-line bg-con-surface-2 hover:bg-con-surface`}>
            <Pencil className="size-2.5 text-ember" aria-hidden="true" />
            <Text variant="caption" tone="ember" as="span">
              {isAccountant ? (isRTL ? 'عرض' : 'View') : (isRTL ? 'تعديل' : 'Edit')}
            </Text>
          </button>
          {/* HIDDEN, not disabled, for an accountant: the delete is RLS-gated,
              so a greyed button would advertise an impossible action. */}
          {!isAccountant && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              aria-label={isRTL ? `حذف فرع ${branch.nameAr}` : `Delete branch ${branch.nameEn}`}
              className={`${ROW_BTN} border-danger-line bg-danger-tint hover:brightness-95`}
            >
              <Trash2 className="size-2.5 text-danger-ds" aria-hidden="true" />
              <Text variant="caption" tone="danger" as="span">
                {deleting ? (isRTL ? 'جاري الحذف…' : 'Deleting…') : (isRTL ? 'حذف' : 'Delete')}
              </Text>
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        <StatusPill
          label={`${isRTL ? 'الموقع' : 'Location'}: ${hasCoords ? (isRTL ? 'محدّد' : 'Set') : (isRTL ? 'غير محدّد' : 'Not set')}`}
          tone={hasCoords ? 'success' : 'warning'}
        />
        <StatusPill
          label={`${isRTL ? 'الاستلام' : 'Pickup'}: ${pickupEnabled ? 'ON' : 'OFF'}`}
          tone={pickupEnabled ? 'success' : 'neutral'}
        />
        <StatusPill
          label={`${isRTL ? 'التوصيل' : 'Delivery'}: ${deliveryClosed ? (isRTL ? 'موقوف' : 'PAUSED') : (deliveryEnabled ? 'ON' : 'OFF')}`}
          tone={deliveryEnabled && !deliveryClosed ? 'success' : 'neutral'}
        />
        <StatusPill
          label={`POS: ${branch.lazywaitBranchId ? (isRTL ? 'مربوط' : 'Mapped') : (isRTL ? 'غير مربوط' : 'Unmapped')}`}
          tone={branch.lazywaitBranchId ? 'info' : 'neutral'}
        />
      </div>

      {/*
        These three write real operating policy — a delivery fee, an order
        minimum and a promised ETA — straight to the live database. They commit
        on blur/Enter, never on keystroke: the previous `parseFloat(v) || 0`
        onChange persisted `2` while an operator typed `25`, and persisted a
        genuine 0 SAR fee the moment the field was cleared to retype it.
        A rejected entry restores the stored value instead of writing.
      */}
      <div className="space-y-2 border-t border-con-line pt-3">
        <NumericCommitField
          label={t.delivery_fee}
          value={branch.deliveryFee}
          onCommit={(v) => onUpdate({ deliveryFee: v ?? 0 })}
          disabled={isAccountant}
          min={0}
        />
        <NumericCommitField
          label={isRTL ? 'الحد الأدنى للتوصيل' : 'Delivery minimum order'}
          value={branch.minDeliveryOrder}
          onCommit={(v) => onUpdate({ minDeliveryOrder: v ?? 0 })}
          disabled={isAccountant}
          min={0}
        />
        <NumericCommitField
          label={isRTL ? 'وقت التوصيل التقريبي (دقيقة)' : 'Estimated delivery time (min)'}
          value={branch.estimatedDeliveryMinutes ?? null}
          onCommit={(v) => onUpdate({ estimatedDeliveryMinutes: v ?? undefined })}
          disabled={isAccountant}
          placeholder="—"
          min={0}
          integer
          allowEmpty
        />

        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <ToggleChip
            on={deliveryEnabled}
            disabled={isAccountant}
            onToggle={() => onUpdate({ deliveryEnabled: !deliveryEnabled })}
            label={isRTL ? 'التوصيل' : 'Delivery'}
            onLabel={isRTL ? 'مفعّل' : 'ON'}
            offLabel={isRTL ? 'معطّل' : 'OFF'}
          />
          <ToggleChip
            on={pickupEnabled}
            disabled={isAccountant}
            onToggle={() => onUpdate({ pickupEnabled: !pickupEnabled })}
            label={isRTL ? 'الاستلام' : 'Pickup'}
            onLabel={isRTL ? 'مفعّل' : 'ON'}
            offLabel={isRTL ? 'معطّل' : 'OFF'}
          />
        </div>

        <button
          type="button"
          onClick={() => onUpdate({ deliveryTemporarilyClosed: !deliveryClosed })}
          disabled={isAccountant}
          aria-pressed={deliveryClosed}
          className={`${ROW_BTN} ${deliveryClosed ? 'border-warn-line bg-warn-tint' : 'border-con-line bg-con-surface-2'}`}
        >
          <Text variant="caption" tone={deliveryClosed ? 'warning' : 'tertiary'} as="span">
            {deliveryClosed
              ? (isRTL ? 'التوصيل موقوف مؤقتاً' : 'Delivery temporarily closed')
              : (isRTL ? 'إيقاف التوصيل مؤقتاً' : 'Pause delivery temporarily')}
          </Text>
        </button>

        <div className="space-y-1.5 border-t border-con-line pt-2">
          <div className="flex items-center justify-between gap-2">
            <Text variant="caption" tone="secondary" as="span">
              {isRTL ? 'منطقة التوصيل' : 'Delivery area'}:
            </Text>
            <StatusPill
              label={hasZone
                ? (isRTL ? 'مُعدّة' : 'Configured')
                : (isRTL ? 'منطقة التوصيل غير مُعدّة' : 'Delivery area not configured')}
              tone={hasZone ? 'success' : 'neutral'}
            />
          </div>

          {hasCoords ? (
            <button type="button" onClick={onOpenZone} className={`${ROW_BTN} border-con-line bg-con-surface-2 hover:bg-con-surface`}>
              <MapIcon className="size-3 text-ember" aria-hidden="true" />
              <Text variant="caption" tone="ember" as="span">
                {hasZone
                  ? (isAccountant ? (isRTL ? 'عرض منطقة التوصيل' : 'View delivery area') : (isRTL ? 'تعديل منطقة التوصيل' : 'Edit delivery area'))
                  : (isRTL ? 'رسم منطقة التوصيل' : 'Draw delivery area')}
              </Text>
            </button>
          ) : (
            <div className="space-y-1.5 rounded-[var(--radius-ds-md)] border border-warn-line bg-warn-tint p-2">
              <div className="flex items-start gap-1">
                <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-ink" aria-hidden="true" />
                <Text variant="caption" tone="warning" as="span">
                  {isRTL ? 'حدّد موقع الفرع قبل رسم منطقة التوصيل.' : 'Set branch location before drawing delivery area.'}
                </Text>
              </div>
              {!isAccountant && (
                <button type="button" onClick={onEdit} className={`${ROW_BTN} border-transparent bg-amber-ink hover:brightness-110`}>
                  <MapPin className="size-3 text-on-ember" aria-hidden="true" />
                  <Text variant="caption" tone="onEmber" as="span">
                    {isRTL ? 'تحديد موقع الفرع' : 'Set branch location'}
                  </Text>
                </button>
              )}
            </div>
          )}

          {/* The contradiction worth surfacing: delivery is switched on, so the
              app will offer it, but no zone means no address can be accepted. */}
          {deliveryEnabled && !hasZone && hasCoords && (
            <div className="flex items-start gap-1 rounded-[var(--radius-ds-md)] border border-warn-line bg-warn-tint p-2">
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-ink" aria-hidden="true" />
              <Text variant="caption" tone="warning" as="span">
                {isRTL ? 'التوصيل مفعّل ولكن لا توجد منطقة توصيل مُعدّة.' : 'Delivery is enabled but no delivery zone is configured.'}
              </Text>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onUpdate({ isActive: !branch.isActive })}
          disabled={isAccountant}
          className={`${ROW_BTN} ${branch.isActive ? 'border-danger-line bg-danger-tint hover:brightness-95' : 'border-mint-line bg-mint-tint hover:brightness-95'}`}
        >
          <Text variant="caption" tone={branch.isActive ? 'danger' : 'success'} as="span">
            {branch.isActive ? 'Close Branch Maintenance' : 'Open Branch Operational'}
          </Text>
        </button>
      </div>

      <div className="space-y-1.5 border-t border-con-line pt-3">
        <Text variant="caption" tone="tertiary" as="p">
          {isRTL ? 'توفر الوجبات الفوري بالفرع:' : 'Branch Product Stock Availability:'}
        </Text>
        <div className={`max-h-[140px] space-y-1 overflow-y-auto ${family}`}>
          {products.map((p) => {
            const isAvailable = isProductAvailableInBranch(p.id, branch.id);
            return (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-ds-sm)] bg-con-surface-2 p-1.5">
                <Text variant="caption" tone="secondary" as="span" className="max-w-[130px] truncate">
                  {isRTL ? p.nameAr : p.nameEn}
                </Text>
                {/* Disabled while the branch is closed: availability inside a
                    shut branch is not a decision anyone can act on. */}
                <button
                  type="button"
                  onClick={() => onToggleProduct(p.id)}
                  disabled={isAccountant || !branch.isActive}
                  aria-pressed={isAvailable}
                  className={[
                    'ds-motion inline-flex min-h-7 shrink-0 items-center rounded-[var(--radius-ds-sm)] px-2',
                    'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                    isAvailable ? 'bg-mint-tint' : 'bg-danger-tint',
                  ].join(' ')}
                >
                  <Text variant="caption" tone={isAvailable ? 'success' : 'danger'} as="span">
                    {isAvailable ? 'Available' : 'Sold Out'}
                  </Text>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
