/**
 * Console navigation — PRESENTATION ONLY.
 *
 * Renders `visibleNav()` and reports which tab was clicked. It decides nothing
 * about visibility: three tabs are capability-gated behind runtime probes, and
 * that lives with the probes in AdminDashboard.
 *
 * Responsive by structure rather than by breakpoint guesswork: a horizontal
 * scrolling strip on narrow widths, a fixed column from `md` up. That is the
 * shape the console already had — the change is that twelve copies of the
 * class list became one.
 *
 * The selected tab fills with ember, the one interactive colour. Everything
 * else is quiet until hovered, so at a glance the sidebar answers "where am I"
 * with a single mark rather than twelve competing ones.
 */
import React from 'react';

import { Text } from '../../../design-system/ui/Text';
import { visibleNav, type AdminTab, type GatedVisibility } from './adminNav';

export function AdminSidebar({
  active,
  onSelect,
  visibility,
  lang,
  liveOrderCount,
}: {
  active: AdminTab;
  onSelect: (tab: AdminTab) => void;
  visibility: GatedVisibility;
  lang: 'en' | 'ar';
  /** Active-order count; renders as a badge on Live Orders when non-zero. */
  liveOrderCount: number;
}) {
  return (
    <nav
      aria-label={lang === 'ar' ? 'أقسام لوحة التحكم' : 'Console sections'}
      className={[
        'flex w-full shrink-0 flex-row gap-1 overflow-x-auto p-3',
        'border-b border-con-line bg-con-surface-2',
        'md:w-[228px] md:flex-col md:overflow-x-visible md:border-b-0 md:border-e',
      ].join(' ')}
    >
      {visibleNav(visibility).map(({ tab, icon: Icon, en, ar }) => {
        const selected = active === tab;
        const showBadge = tab === 'orders' && liveOrderCount > 0;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onSelect(tab)}
            aria-current={selected ? 'page' : undefined}
            className={[
              'ds-motion flex min-h-11 w-full items-center justify-between gap-2 whitespace-nowrap',
              'rounded-[var(--radius-ds-md)] px-3 py-2.5 transition-colors duration-150',
              'focus-visible:outline-2 focus-visible:outline-offset-2',
              selected ? 'bg-ember' : 'text-con-text hover:bg-con-surface',
            ].join(' ')}
          >
            <span className="flex items-center gap-2">
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <Text variant="label" tone={selected ? 'onEmber' : 'primary'} as="span">
                {lang === 'ar' ? ar : en}
              </Text>
            </span>

            {showBadge ? (
              // The count is a structured number, so it renders mono like every
              // other figure in the product.
              <span
                className={[
                  'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5',
                  selected ? 'bg-on-ember' : 'bg-ember',
                ].join(' ')}
              >
                <Text variant="caption" numeric tone={selected ? 'ember' : 'onEmber'} as="span">
                  {liveOrderCount}
                </Text>
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
