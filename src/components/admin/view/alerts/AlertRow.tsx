/**
 * One alert in the inbox — PRESENTATION ONLY.
 *
 * There is no acknowledge control here, and that is the CURRENT CONTRACT rather
 * than an omission: `operationsAlertsApi` exposes no acknowledgement endpoint.
 * The row expands to a read-only timeline and nothing more.
 *
 * `events === null` means "fetching"; `[]` means fetched-and-empty OR
 * fetch-failed. The panel deliberately caches `[]` on failure so a broken
 * timeline renders "No events" instead of spinning forever — preserved from
 * the original.
 *
 * Condition codes and fingerprints render mono: they are identifiers an
 * operator copies into an incident channel, not prose.
 */
import React from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

import { StatusPill } from '../../../../design-system/ui/StatusPill';
import { Text } from '../../../../design-system/ui/Text';
import type { OperationsAlert, OperationsAlertEvent } from '../../../../lib/operationsAlertsApi';
import { exactTime, relativeAge } from '../adminTime';
import {
  eventLabel, severityLabel, severityTone, statusLabel, statusTone, subsystemLabel,
  type AdminLang,
} from './alertsView';

export function AlertRow({
  alert,
  lang,
  expanded,
  events,
  onToggle,
}: {
  alert: OperationsAlert;
  lang: AdminLang;
  expanded: boolean;
  /** null = loading; [] = empty or failed. */
  events: OperationsAlertEvent[] | null;
  onToggle: (id: string) => void;
}) {
  const isAr = lang === 'ar';

  return (
    <div className="rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface">
      <button
        type="button"
        onClick={() => onToggle(alert.id)}
        aria-expanded={expanded}
        className="ds-motion flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-con-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Text variant="label" as="span">{subsystemLabel(alert.subsystem, lang)}</Text>
            <Text variant="caption" tone="secondary" numeric as="span">{alert.condition_code}</Text>
            <StatusPill label={severityLabel(alert.severity, lang)} tone={severityTone(alert.severity)} />
            <StatusPill label={statusLabel(alert.status, lang)} tone={statusTone(alert.status)} />
            {alert.baseline && (
              <StatusPill label={isAr ? 'خط الأساس' : 'Baseline'} tone="info" />
            )}
          </div>
          <Text variant="caption" tone="tertiary" as="p" className="mt-0.5">
            {isAr ? 'أول رصد' : 'First seen'}:{' '}
            <span title={exactTime(alert.first_seen_at, lang)}>{relativeAge(alert.first_seen_at, lang)}</span>
            {' · '}
            {isAr ? 'آخر رصد' : 'Last seen'}:{' '}
            <span title={exactTime(alert.last_seen_at, lang)}>{relativeAge(alert.last_seen_at, lang)}</span>
            {' · '}
            {isAr ? 'مرات الرصد' : 'Occurrences'}: {alert.occurrence_count}
            {' · '}
            {isAr ? 'الجيل' : 'Generation'}: {alert.generation}
          </Text>
        </div>
        {expanded
          ? <ChevronUp className="size-4 shrink-0 text-con-text-3" aria-hidden="true" />
          : <ChevronDown className="size-4 shrink-0 text-con-text-3" aria-hidden="true" />}
      </button>

      {expanded && (
        <div className="space-y-1.5 border-t border-con-line px-3 py-2">
          <Text variant="caption" tone="secondary" numeric as="p" className="break-all">
            {alert.fingerprint}
          </Text>

          {events === null ? (
            <Text variant="caption" tone="tertiary" as="p" className="flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              {isAr ? 'جاري تحميل الأحداث…' : 'Loading timeline…'}
            </Text>
          ) : events.length === 0 ? (
            <Text variant="caption" tone="tertiary" as="p">
              {isAr ? 'لا توجد أحداث.' : 'No events.'}
            </Text>
          ) : (
            <ul className="space-y-1">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2">
                  <StatusPill label={severityLabel(e.severity, lang)} tone={severityTone(e.severity)} />
                  <Text variant="caption" tone="secondary" as="span">{eventLabel(e.event_type, lang)}</Text>
                  <Text variant="caption" tone="tertiary" numeric as="span" title={exactTime(e.created_at, lang)}>
                    {relativeAge(e.created_at, lang)}
                  </Text>
                  {e.notification_suppressed && (
                    <Text variant="caption" tone="tertiary" as="span">
                      {isAr ? '(بدون إشعار)' : '(notification suppressed)'}
                    </Text>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
