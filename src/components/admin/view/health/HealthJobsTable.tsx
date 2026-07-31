/**
 * Scheduled-jobs table — PRESENTATION ONLY.
 *
 * Job names and cron cadences are identifiers, so they render mono. The
 * "last success" cell keeps its exact-time hover title: the relative age is
 * what an operator scans, the absolute instant is what they quote in an
 * incident channel.
 *
 * Cron COMMANDS and secrets are never rendered here — only the allowlisted
 * name, cadence and outcome. That constraint belongs to the RPC, and this
 * component simply has no field to display them.
 */
import React from 'react';

import { StatusPill } from '../../../../design-system/ui/StatusPill';
import { Text } from '../../../../design-system/ui/Text';
import type { OperationsHealthJob } from '../../../../lib/operationsHealthApi';
import { STATE_LABELS, exactTime, healthStateTone, relativeAge, type AdminLang } from './healthView';

export function HealthJobsTable({ jobs, lang }: { jobs: OperationsHealthJob[]; lang: AdminLang }) {
  const isAr = lang === 'ar';
  const headers = isAr
    ? ['المهمة', 'الجدولة', 'الحالة', 'آخر نتيجة', 'آخر نجاح']
    : ['Job', 'Cadence', 'State', 'Latest result', 'Last success'];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px]">
        <thead>
          <tr className="border-b border-con-line">
            {headers.map((h) => (
              <th key={h} className="px-2 py-2 text-start">
                <Text variant="caption" tone="tertiary" as="span">{h}</Text>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.job_name} className="border-t border-con-line">
              <td className="px-2 py-2">
                <Text variant="caption" numeric as="span">{job.job_name}</Text>
              </td>
              <td className="px-2 py-2">
                <Text variant="caption" tone="secondary" numeric as="span">{job.schedule ?? '—'}</Text>
              </td>
              <td className="px-2 py-2">
                <StatusPill label={STATE_LABELS[job.state][lang]} tone={healthStateTone(job.state)} />
              </td>
              <td className="px-2 py-2">
                <Text variant="caption" tone="secondary" as="span">{job.latest_status ?? '—'}</Text>
              </td>
              <td className="px-2 py-2" title={exactTime(job.latest_success_at, lang)}>
                <Text variant="caption" tone="secondary" numeric as="span">
                  {relativeAge(job.latest_success_at, lang)}
                </Text>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
