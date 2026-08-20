/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

import { Field } from '../../../../design-system/ui/Field';
import { Text } from '../../../../design-system/ui/Text';
import { ToggleChip } from '../shared/ToggleChip';
import type { WorkingHoursDay } from '../../../../lib/branchConfigApi';
import { WEEKDAYS, crossesMidnight } from './workingHours';

/**
 * Seven fixed weekday rows over a single draft, following `SettingsPanel`'s
 * channel-rows shape rather than seven sets of `useState`.
 *
 * These hours are ADVISORY: nothing closes the branch at closing time. Branch
 * open/closed for ordering is still `is_active`. The hint says so, because a
 * screen full of times invites the opposite assumption.
 */
export const WorkingHoursEditor: React.FC<{
  week: WorkingHoursDay[];
  disabled?: boolean;
  isRTL: boolean;
  onChange: (week: WorkingHoursDay[]) => void;
}> = ({ week, disabled, isRTL, onChange }) => {
  const label = (en: string, ar: string) => (isRTL ? ar : en);

  const patch = (dayOfWeek: number, next: Partial<WorkingHoursDay>) => {
    onChange(week.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...next } : d)));
  };

  return (
    <div className="space-y-2 border-t border-con-line pt-3">
      <Text variant="label" as="p">{label('Working hours', 'ساعات العمل')}</Text>
      <Text variant="caption" tone="tertiary" as="p">
        {label(
          'Shown to staff for reference. Orders are not blocked outside these hours — use Open/Closed for that.',
          'للعرض والمرجع فقط. لا يتم إيقاف الطلبات خارج هذه الأوقات — استخدم مفتاح مفتوح/مغلق لذلك.',
        )}
      </Text>

      <div className="space-y-1.5">
        {WEEKDAYS.map(({ index, en, ar }) => {
          const day = week.find((d) => d.dayOfWeek === index);
          if (!day) return null;
          const overnight = !day.isClosed && crossesMidnight(day);
          return (
            <div
              key={index}
              className="grid grid-cols-[minmax(72px,1fr)_1fr_1fr_auto] items-end gap-2"
            >
              <Text variant="caption" tone="secondary" as="span" className="pb-2">
                {isRTL ? ar : en}
              </Text>
              <Field
                label={label('Opens', 'يفتح')}
                type="time"
                numeric
                value={day.opensAt ?? ''}
                onValueChange={(v) => patch(index, { opensAt: v || null })}
                disabled={disabled || day.isClosed}
              />
              <Field
                label={label('Closes', 'يغلق')}
                type="time"
                numeric
                value={day.closesAt ?? ''}
                onValueChange={(v) => patch(index, { closesAt: v || null })}
                disabled={disabled || day.isClosed}
                // A window ending before it starts is valid and means overnight.
                // Saying so inline is what stops it reading as a typo.
                hint={overnight ? label('next day', 'اليوم التالي') : undefined}
              />
              <div className="pb-0.5">
                <ToggleChip
                  on={!day.isClosed}
                  disabled={disabled}
                  onToggle={() => patch(index, {
                    isClosed: !day.isClosed,
                    ...(day.isClosed ? {} : { opensAt: null, closesAt: null }),
                  })}
                  label={label('Open', 'مفتوح')}
                  onLabel={label('OPEN', 'مفتوح')}
                  offLabel={label('CLOSED', 'مغلق')}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
