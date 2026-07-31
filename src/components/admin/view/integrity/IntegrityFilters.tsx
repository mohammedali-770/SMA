/**
 * Incident filters — PRESENTATION ONLY.
 *
 * Native `<select>` elements, styled with design-system tokens rather than
 * replaced. A custom listbox would have to reimplement keyboard navigation,
 * typeahead and the mobile picker; the native control already does all three
 * correctly and is the accessible default. The design system governs how it
 * LOOKS, not whether it is a real form control.
 *
 * The status filter defaults to `unresolved` upstream, so the list matches the
 * health counts — acknowledging or suppressing a defect must not make it vanish
 * from the operator's view.
 */
import React from 'react';

import { Text } from '../../../../design-system/ui/Text';
import { useDsFontClass } from '../../../../design-system/ui/useDsLang';
import { RULE_CODES } from './integrityView';

const SELECT = [
  'ds-motion min-h-9 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface',
  'px-2 text-[13px] text-con-text transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

export function IntegrityFilters({
  severity,
  onSeverity,
  status,
  onStatus,
  rule,
  onRule,
}: {
  severity: string;
  onSeverity: (v: string) => void;
  status: string;
  onStatus: (v: string) => void;
  rule: string;
  onRule: (v: string) => void;
}) {
  const family = useDsFontClass();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex items-center gap-1.5">
        <Text variant="caption" tone="tertiary" as="span">Severity</Text>
        <select
          value={severity}
          onChange={(e) => onSeverity(e.target.value)}
          className={`${SELECT} ${family}`}
        >
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
        </select>
      </label>

      <label className="inline-flex items-center gap-1.5">
        <Text variant="caption" tone="tertiary" as="span">Status</Text>
        <select
          value={status}
          onChange={(e) => onStatus(e.target.value)}
          className={`${SELECT} ${family}`}
        >
          <option value="unresolved">Unresolved (active)</option>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="suppressed">Suppressed</option>
          <option value="resolved">Resolved</option>
        </select>
      </label>

      <label className="inline-flex items-center gap-1.5">
        <Text variant="caption" tone="tertiary" as="span">Rule</Text>
        {/* Rule codes are identifiers, so they read mono. */}
        <select
          value={rule}
          onChange={(e) => onRule(e.target.value)}
          className={`${SELECT} font-ds-num max-w-[240px]`}
        >
          <option value="">All rules</option>
          {RULE_CODES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
    </div>
  );
}
