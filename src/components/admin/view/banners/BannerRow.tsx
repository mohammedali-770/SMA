/**
 * One homepage banner — PRESENTATION ONLY.
 *
 * The LIVE pill is computed by the panel from `selectActiveBanners`, the same
 * function the mobile app uses, so this row shows what a customer would
 * actually see rather than what the `is_active` flag alone claims. A banner can
 * be active AND invisible because its date window has not opened, and telling
 * those two apart is the whole point of the pill.
 *
 * Reorder, enable/disable and delete are callbacks; the row makes no permission
 * decision. It is not rendered at all for an accountant.
 */
import React from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';

import { StatusPill } from '../../../../design-system/ui/StatusPill';
import { Text } from '../../../../design-system/ui/Text';
import type { DbHomepageBanner } from '../../../../lib/api';

const ICON_BTN = [
  'ds-motion inline-flex size-7 items-center justify-center rounded-[var(--radius-ds-sm)]',
  'transition-colors duration-150 hover:bg-con-surface-2 disabled:opacity-30',
  'focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

export function BannerRow({
  banner,
  live,
  busy,
  canEdit,
  isRTL,
  onMove,
  onToggleActive,
  onDelete,
}: {
  banner: DbHomepageBanner;
  live: boolean;
  busy: boolean;
  canEdit: boolean;
  isRTL: boolean;
  onMove: (delta: number) => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const b = banner;
  const stateLabel = live
    ? (isRTL ? 'ظاهر الآن' : 'LIVE')
    : b.is_active
      ? (isRTL ? 'مجدول/منتهٍ' : 'SCHEDULED')
      : (isRTL ? 'معطّل' : 'OFF');

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-2.5">
      <div className="h-[42px] w-28 shrink-0 overflow-hidden rounded-[var(--radius-ds-sm)] border border-con-line bg-con-surface-2">
        <img
          src={b.image_url}
          alt={b.title_en ?? 'banner'}
          loading="lazy"
          className="size-full object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Text variant="label" as="span" className="truncate">
            {b.title_en || b.title_ar || (isRTL ? 'بدون عنوان' : 'Untitled')}
          </Text>
          {/* SCHEDULED is a warning, not neutral: an admin who set the dates
              wrong sees an "active" banner nobody is being shown. */}
          <StatusPill
            label={stateLabel}
            tone={live ? 'success' : b.is_active ? 'warning' : 'neutral'}
          />
        </div>
        <Text variant="caption" tone="tertiary" as="p">
          {isRTL ? 'الترتيب' : 'Order'} <span className="num">{b.sort_order}</span>
          {b.starts_at ? ` • ${isRTL ? 'من' : 'from'} ${new Date(b.starts_at).toLocaleDateString()}` : ''}
          {b.ends_at ? ` • ${isRTL ? 'إلى' : 'to'} ${new Date(b.ends_at).toLocaleDateString()}` : ''}
        </Text>
      </div>

      {canEdit && (
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="flex flex-col">
            <button type="button" title={isRTL ? 'أعلى' : 'Up'} aria-label={isRTL ? 'أعلى' : 'Move up'}
              disabled={busy} onClick={() => onMove(-1)} className={ICON_BTN}>
              <ChevronUp className="size-3.5 text-con-text-2" aria-hidden="true" />
            </button>
            <button type="button" title={isRTL ? 'أسفل' : 'Down'} aria-label={isRTL ? 'أسفل' : 'Move down'}
              disabled={busy} onClick={() => onMove(1)} className={ICON_BTN}>
              <ChevronDown className="size-3.5 text-con-text-2" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={onToggleActive}
            className={[
              'ds-motion inline-flex min-h-9 items-center rounded-[var(--radius-ds-md)] px-2.5',
              'transition-colors duration-150 hover:brightness-95 disabled:opacity-40',
              'focus-visible:outline-2 focus-visible:outline-offset-2',
              b.is_active ? 'bg-warn-tint' : 'bg-mint-tint',
            ].join(' ')}
          >
            <Text variant="caption" tone={b.is_active ? 'warning' : 'success'} as="span">
              {busy ? '…' : b.is_active ? (isRTL ? 'تعطيل' : 'Disable') : (isRTL ? 'تفعيل' : 'Enable')}
            </Text>
          </button>

          <button type="button" title={isRTL ? 'حذف' : 'Delete'}
            aria-label={isRTL ? 'حذف البانر' : 'Delete banner'}
            disabled={busy} onClick={onDelete} className={ICON_BTN}>
            <Trash2 className="size-3.5 text-danger-ds" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
