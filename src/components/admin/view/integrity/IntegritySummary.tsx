/**
 * Watchdog health summary — PRESENTATION ONLY.
 *
 * Four figures an operator scans before reading any row. Counts render mono,
 * because they are structured numbers and a column of proportional digits is
 * harder to compare at a glance.
 *
 * Open Critical is danger-toned and Open Warning is warning-toned even at zero.
 * That is deliberate: the tone belongs to the CATEGORY, not the value, so the
 * eye learns where "critical" lives on the card and does not have to re-read
 * the labels every time the numbers change.
 */
import React from 'react';
import { Clock } from 'lucide-react';

import { Card } from '../../../../design-system/ui/Card';
import { StatusPill } from '../../../../design-system/ui/StatusPill';
import { Text } from '../../../../design-system/ui/Text';
import { ageLabel, stateTone } from './integrityView';

export interface IntegrityHealthLike {
  overall_state?: string | null;
  watchdog_cron_active?: boolean | null;
  open_critical_count?: number | null;
  oldest_open_critical_at?: string | null;
  open_warning_count?: number | null;
  acknowledged_count?: number | null;
  suppressed_count?: number | null;
  latest_successful_run_at?: string | null;
  incidents_opened_last_24h?: number | null;
  incidents_resolved_last_24h?: number | null;
}

function Tile({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-1">
      <Text variant="caption" tone="tertiary" as="p">{label}</Text>
      {children}
    </Card>
  );
}

export function IntegritySummary({ health }: { health: IntegrityHealthLike | null }) {
  const state = health?.overall_state ?? 'healthy';

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <Tile label="Overall State">
        <span><StatusPill label={state} tone={stateTone(state)} /></span>
        <Text variant="caption" tone="tertiary" as="p">
          cron {health?.watchdog_cron_active ? 'active' : 'inactive'}
        </Text>
      </Tile>

      <Tile label="Open Critical">
        <Text variant="display" tone="danger" numeric as="p">{health?.open_critical_count ?? 0}</Text>
        <Text variant="caption" tone="tertiary" as="p">
          oldest {ageLabel(health?.oldest_open_critical_at ?? null)}
        </Text>
      </Tile>

      <Tile label="Open Warning">
        <Text variant="display" tone="warning" numeric as="p">{health?.open_warning_count ?? 0}</Text>
        <Text variant="caption" tone="tertiary" as="p">
          ack {health?.acknowledged_count ?? 0} · suppressed {health?.suppressed_count ?? 0}
        </Text>
      </Tile>

      <Tile
        label={
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" aria-hidden="true" /> Last Scan
          </span>
        }
      >
        <Text variant="heading" as="p">
          {health?.latest_successful_run_at ? `${ageLabel(health.latest_successful_run_at)} ago` : '—'}
        </Text>
        <Text variant="caption" tone="tertiary" as="p">
          24h: +{health?.incidents_opened_last_24h ?? 0} / −{health?.incidents_resolved_last_24h ?? 0}
        </Text>
      </Tile>
    </div>
  );
}
