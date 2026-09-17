/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Building2, Store, Truck, UtensilsCrossed } from 'lucide-react';

import type { OpsStringKey } from '../opsStrings';
import type { OpsLangValue } from '../useOpsLang';

export type BranchTab = 'items' | 'general' | 'branch' | 'delivery';

/**
 * Items is FIRST and is the default, because it is the only tab a cashier opens
 * without being asked to. The three that follow are reference material and a
 * request form — things looked up once a shift, if that.
 */
const TABS: { key: BranchTab; label: OpsStringKey; Icon: typeof Store }[] = [
  { key: 'items', label: 'tabItems', Icon: UtensilsCrossed },
  { key: 'general', label: 'tabGeneral', Icon: Building2 },
  { key: 'branch', label: 'tabBranch', Icon: Store },
  { key: 'delivery', label: 'tabDelivery', Icon: Truck },
];

/**
 * Tab bar for the branch console.
 *
 * `role="tablist"` with roving `aria-selected` rather than links: the console is
 * a single screen behind a server-side branch assignment, and giving each tab a
 * URL would invite a bookmark that outlives the assignment.
 *
 * The badge on Items carries the closed count so a cashier reading another tab
 * still sees that something is off — the one piece of state that should never
 * need the right tab to be visible.
 */
export const BranchTabs: React.FC<{
  active: BranchTab;
  closedCount: number;
  i18n: OpsLangValue;
  onSelect: (tab: BranchTab) => void;
}> = ({ active, closedCount, i18n, onSelect }) => {
  const { t } = i18n;
  return (
    <div
      role="tablist"
      aria-label={t('branchConsole')}
      className="flex gap-1.5 overflow-x-auto border-b border-con-line"
    >
      {TABS.map(({ key, label, Icon }) => {
        const on = key === active;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={on}
            data-testid={`tab-${key}`}
            onClick={() => onSelect(key)}
            className={[
              'flex min-h-[52px] flex-1 shrink-0 flex-col items-center justify-center gap-0.5',
              'rounded-t-[var(--radius-ds-md)] border border-b-0 px-4 text-[13px] font-semibold',
              'whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2',
              on
                ? 'border-con-line bg-con-surface text-ember shadow-[inset_0_-2px_0_var(--color-ember)]'
                : 'border-transparent bg-transparent text-con-text-2',
            ].join(' ')}
          >
            <span className="flex items-center gap-1.5">
              <Icon className="size-4" aria-hidden="true" />
              {t(label)}
              {key === 'items' && closedCount > 0 ? (
                <span className="rounded-full bg-ember px-1.5 font-[var(--font-ds-num)] text-[10.5px] text-white">
                  {closedCount}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
};
