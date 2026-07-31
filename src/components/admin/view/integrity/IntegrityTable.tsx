/**
 * The incident table — PRESENTATION ONLY.
 *
 * Every action is a callback supplied by the panel; this component performs no
 * API call and makes no permission decision. `showAcknowledge` / `showSuppress`
 * are passed in already-evaluated, so the rule that triage controls are HIDDEN
 * (not disabled) without permission stays where the permission lives.
 *
 * Hidden rather than disabled is the correct behaviour and worth stating: the
 * underlying RPCs are `is_admin()`-gated and return 42501 to anyone else, so
 * offering a greyed-out button would advertise an action the caller can never
 * complete.
 *
 * Identifiers — rule codes, order numbers, branch ids, occurrence counts — all
 * render mono. They are structured values, and a column of them is scanned
 * vertically rather than read.
 */
import React from 'react';
import { CheckCircle2, ChevronDown, EyeOff, Loader2 } from 'lucide-react';

import { Button } from '../../../../design-system/ui/Button';
import { Field } from '../../../../design-system/ui/Field';
import { StatusPill } from '../../../../design-system/ui/StatusPill';
import { Text } from '../../../../design-system/ui/Text';
import { ageLabel, severityTone, shortId, statusTone } from './integrityView';

export interface IntegrityIncidentLike {
  id: string;
  rule_code: string;
  severity: string;
  status: string;
  order_number?: string | null;
  branch_id?: string | null;
  last_detected_at: string | null;
  occurrence_count: number;
}

const TH = 'py-1 pe-2 text-start';
const TD = 'py-1.5 pe-2 align-top';

export function IntegrityTable({
  incidents,
  busyId,
  expandedId,
  timeline,
  suppressForId,
  suppressReason,
  suppressHours,
  canAcknowledge,
  canSuppress,
  onToggleTimeline,
  onAcknowledge,
  onOpenSuppress,
  onSuppressReason,
  onSuppressHours,
  onSubmitSuppress,
}: {
  incidents: IntegrityIncidentLike[];
  busyId: string | null;
  expandedId: string | null;
  timeline: Record<string, unknown> | null;
  suppressForId: string | null;
  suppressReason: string;
  suppressHours: number;
  /** Already permission-evaluated per incident. */
  canAcknowledge: (incident: IntegrityIncidentLike) => boolean;
  canSuppress: (incident: IntegrityIncidentLike) => boolean;
  onToggleTimeline: (id: string) => void;
  onAcknowledge: (id: string) => void;
  onOpenSuppress: (id: string) => void;
  onSuppressReason: (v: string) => void;
  onSuppressHours: (v: number) => void;
  onSubmitSuppress: (id: string) => void;
}) {
  if (incidents.length === 0) {
    return (
      <Text variant="body" tone="tertiary" className="py-3">
        No incidents match the current filters.
      </Text>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-con-line">
            {['Rule', 'Sev', 'Status', 'Order', 'Branch', 'Last seen', 'Occ', ''].map((h, i) => (
              <th key={h || `sp-${i}`} className={TH}>
                <Text variant="caption" tone="tertiary" as="span">{h}</Text>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {incidents.map((i) => (
            <React.Fragment key={i.id}>
              <tr className="border-t border-con-line">
                <td className={TD}><Text variant="caption" numeric as="span">{i.rule_code}</Text></td>
                <td className={TD}><StatusPill label={i.severity} tone={severityTone(i.severity)} /></td>
                <td className={TD}><StatusPill label={i.status} tone={statusTone(i.status)} /></td>
                <td className={TD}>
                  <Text variant="caption" tone="secondary" numeric as="span">{i.order_number ?? '—'}</Text>
                </td>
                <td className={TD}>
                  <Text variant="caption" tone="tertiary" numeric as="span">{shortId(i.branch_id)}</Text>
                </td>
                <td className={TD}>
                  <Text variant="caption" tone="secondary" numeric as="span">{ageLabel(i.last_detected_at)}</Text>
                </td>
                <td className={TD}>
                  <Text variant="caption" tone="secondary" numeric as="span">{i.occurrence_count}</Text>
                </td>
                <td className={`${TD} whitespace-nowrap text-end`}>
                  <span className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onToggleTimeline(i.id)}
                      aria-expanded={expandedId === i.id}
                      className="ds-motion inline-flex min-h-8 items-center gap-0.5 rounded-[var(--radius-ds-sm)] px-2 hover:bg-con-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      <ChevronDown
                        className={`size-3 transition-transform ${expandedId === i.id ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                      <Text variant="caption" tone="secondary" as="span">Timeline</Text>
                    </button>

                    {/* HIDDEN, not disabled, without permission — see the docblock. */}
                    {canAcknowledge(i) && (
                      <button
                        type="button"
                        onClick={() => onAcknowledge(i.id)}
                        disabled={busyId === i.id}
                        className="ds-motion inline-flex min-h-8 items-center gap-0.5 rounded-[var(--radius-ds-sm)] px-2 hover:bg-info-tint disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        {busyId === i.id
                          ? <Loader2 className="size-3 animate-spin text-sky" aria-hidden="true" />
                          : <CheckCircle2 className="size-3 text-sky" aria-hidden="true" />}
                        <Text variant="caption" tone="info" as="span">Ack</Text>
                      </button>
                    )}

                    {canSuppress(i) && (
                      <button
                        type="button"
                        onClick={() => onOpenSuppress(i.id)}
                        aria-expanded={suppressForId === i.id}
                        className="ds-motion inline-flex min-h-8 items-center gap-0.5 rounded-[var(--radius-ds-sm)] px-2 hover:bg-con-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        <EyeOff className="size-3" aria-hidden="true" />
                        <Text variant="caption" tone="secondary" as="span">Suppress</Text>
                      </button>
                    )}
                  </span>
                </td>
              </tr>

              {suppressForId === i.id && (
                <tr className="bg-con-surface-2">
                  <td colSpan={8} className="px-2 py-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <Field
                        id={`suppress-reason-${i.id}`}
                        label="Reason"
                        required
                        value={suppressReason}
                        onValueChange={onSuppressReason}
                        placeholder="Why is this being hidden?"
                        className="min-w-[200px] flex-1"
                      />
                      <Field
                        id={`suppress-hours-${i.id}`}
                        label="For (hours)"
                        type="number"
                        min={1}
                        numeric
                        value={String(suppressHours)}
                        onValueChange={(v) => onSuppressHours(Number(v))}
                        className="w-24"
                      />
                      <Button
                        label="Confirm suppress"
                        onClick={() => onSubmitSuppress(i.id)}
                        disabled={busyId === i.id}
                        loading={busyId === i.id}
                        variant="secondary"
                        size="md"
                      />
                    </div>
                  </td>
                </tr>
              )}

              {expandedId === i.id && (
                <tr className="bg-con-surface-2">
                  <td colSpan={8} className="px-2 py-2">
                    <pre className="whitespace-pre-wrap break-all font-ds-num text-[11.5px] text-con-text-2">
                      {timeline ? JSON.stringify(timeline, null, 2) : 'Loading timeline…'}
                    </pre>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
