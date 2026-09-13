/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Download, Upload } from 'lucide-react';

import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { branchConfig } from '../../lib/branchConfigApi';
import {
  areasTemplate, hoursTemplate, parseAreas, parseHours,
  type AreaPlan, type ExistingArea, type HoursPlan, type ImportBranch,
} from '../../lib/branchImport';

/**
 * Bulk import for branch trading hours and delivery areas.
 *
 * WHY IT EXISTS. Both features are built and RLS'd and both are empty: across
 * forty branches there are no working-hours rows and no delivery areas, so every
 * screen answering "when is this branch open" or "where does it deliver" shows a
 * dash. Doing that through the per-branch editors is forty visits; this is one
 * paste from a spreadsheet.
 *
 * IT ADDS NO SERVER SURFACE. Every write goes through the same two admin RPCs
 * the per-branch editors use — `admin_upsert_branch_working_hours` and
 * `admin_add_delivery_area` — so there is no migration, no new grant, and an
 * administrator can do nothing here that they could not already do one form at a
 * time. Parsing and planning live in `src/lib/branchImport.ts`, which is where
 * the rules are tested.
 *
 * NOTHING IS WRITTEN ON PASTE. Paste parses; a separate, explicitly labelled
 * button applies. The preview between them is the point of the screen: it names
 * the branches that will be touched and the rows that were refused, before
 * anything reaches the database.
 */

const TEXTAREA = [
  'ds-motion w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-2.5',
  'font-ds-num text-[13px] text-con-text transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

const DOWNLOAD_LINK = [
  'ds-motion inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-ds-md)]',
  'focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

function templateHref(body: string): string {
  return `data:text/tab-separated-values;charset=utf-8,${encodeURIComponent(body)}`;
}

interface ApplyOutcome {
  done: number;
  skipped: number;
  failures: string[];
}

export interface BranchDataImportPanelProps {
  branches: readonly ImportBranch[];
  lang: 'en' | 'ar';
  /** Accountants read the console; they do not write to it. */
  disabled?: boolean;
}

export const BranchDataImportPanel: React.FC<BranchDataImportPanelProps> = ({
  branches, lang, disabled = false,
}) => {
  const isRTL = lang === 'ar';

  const [hoursText, setHoursText] = useState('');
  const [hoursPlan, setHoursPlan] = useState<HoursPlan | null>(null);
  const [hoursBusy, setHoursBusy] = useState(false);
  const [hoursOutcome, setHoursOutcome] = useState<ApplyOutcome | null>(null);

  const [areasText, setAreasText] = useState('');
  const [areasPlan, setAreasPlan] = useState<AreaPlan | null>(null);
  const [areasBusy, setAreasBusy] = useState(false);
  const [areasOutcome, setAreasOutcome] = useState<ApplyOutcome | null>(null);
  const [existing, setExisting] = useState<ExistingArea[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const hoursSheet = useMemo(() => hoursTemplate(branches), [branches]);
  const areasSheet = useMemo(() => areasTemplate(branches), [branches]);

  /**
   * Read the areas that already exist so the plan can mark duplicates.
   *
   * `admin_add_delivery_area` always INSERTs, so without this a second run of
   * the same sheet silently doubles every area. Read at PARSE time rather than
   * at mount: the administrator may have added areas in the editor since this
   * screen opened, and a stale list would call a real duplicate new.
   */
  const handleParseAreas = async () => {
    setAreasOutcome(null); setLoadError(null);
    let rows: ExistingArea[] = existing;
    try {
      rows = (await branchConfig.allAreas()).map((a) => ({ branchId: a.branchId, nameAr: a.nameAr }));
      setExisting(rows);
    } catch (e) {
      // Parse anyway, but say plainly that duplicate detection is not available
      // — silently marking everything "new" is how a list gets doubled.
      setLoadError(e instanceof Error ? e.message : String(e));
    }
    setAreasPlan(parseAreas(areasText, branches, rows));
  };

  const handleApplyHours = async () => {
    if (!hoursPlan || disabled) return;
    setHoursBusy(true);
    const outcome: ApplyOutcome = { done: 0, skipped: 0, failures: [] };
    // Sequential rather than Promise.all: forty concurrent RPCs is unkind to a
    // free-plan database, and a serial run can say exactly how far it got.
    for (const row of hoursPlan.rows) {
      try {
        await branchConfig.saveWorkingHours(row.branch.id, row.days);
        outcome.done += 1;
      } catch (e) {
        outcome.failures.push(`${row.branch.nameEn}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setHoursOutcome(outcome);
    setHoursBusy(false);
  };

  const handleApplyAreas = async () => {
    if (!areasPlan || disabled) return;
    setAreasBusy(true);
    const outcome: ApplyOutcome = { done: 0, skipped: 0, failures: [] };
    for (const row of areasPlan.rows) {
      if (row.duplicate) { outcome.skipped += 1; continue; }
      try {
        await branchConfig.addArea(row.branch.id, row.nameAr, row.nameEn);
        outcome.done += 1;
      } catch (e) {
        outcome.failures.push(`${row.branch.nameEn} / ${row.nameAr}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setAreasOutcome(outcome);
    // The rows just written are duplicates now; re-plan so a second Apply on the
    // same paste is a no-op rather than a doubling.
    setAreasPlan({
      ...areasPlan,
      rows: areasPlan.rows.map((r) => ({ ...r, duplicate: true })),
    });
    setAreasBusy(false);
  };

  const errorList = (errors: { line: number; message: string }[]) => (
    <Notice
      title={isRTL ? `صفوف مرفوضة: ${errors.length}` : `${errors.length} row(s) refused`}
      action={isRTL
        ? 'صحّح هذه الصفوف وألصق مرة أخرى. لن تُكتب.'
        : 'Correct these rows and paste again. They will not be written.'}
      tone="warning"
    >
      <ul className="list-disc ps-4">
        {errors.map((e, i) => (
          <li key={i}>
            <Text variant="caption" tone="secondary" as="span">
              {isRTL ? `سطر ${e.line}: ${e.message}` : `line ${e.line}: ${e.message}`}
            </Text>
          </li>
        ))}
      </ul>
    </Notice>
  );

  const outcomeNotice = (outcome: ApplyOutcome) => (
    <Notice
      title={outcome.failures.length === 0
        ? (isRTL ? 'تم التطبيق' : 'Applied')
        : (isRTL ? 'تم التطبيق جزئيًا' : 'Partly applied')}
      action={[
        isRTL ? `كُتب: ${outcome.done}` : `written: ${outcome.done}`,
        outcome.skipped > 0 ? (isRTL ? `مكرر متجاوَز: ${outcome.skipped}` : `duplicates skipped: ${outcome.skipped}`) : '',
        outcome.failures.length > 0 ? (isRTL ? `فشل: ${outcome.failures.length}` : `failed: ${outcome.failures.length}`) : '',
      ].filter(Boolean).join(' · ')}
      tone={outcome.failures.length === 0 ? 'success' : 'blocking'}
    >
      {outcome.failures.length > 0 ? (
        <ul className="list-disc ps-4">
          {outcome.failures.map((f, i) => (
            <li key={i}><Text variant="caption" tone="danger" as="span">{f}</Text></li>
          ))}
        </ul>
      ) : null}
    </Notice>
  );

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-2">
        <Upload className="size-4 text-ember" aria-hidden="true" />
        <Text variant="title" as="h3">
          {isRTL ? 'استيراد بيانات الفروع' : 'Branch data import'}
        </Text>
      </div>

      <Notice
        title={isRTL ? 'لا يُكتب شيء حتى تضغط تطبيق' : 'Nothing is written until you press Apply'}
        action={isRTL
          ? 'اللصق يفحص فقط. راجع المعاينة أولًا.'
          : 'Pasting only checks the sheet. Read the preview first.'}
        tone="info"
      />

      {/* ---------------------------------------------------------------- */}
      {/* Working hours                                                    */}
      {/* ---------------------------------------------------------------- */}
      <Card className="space-y-3">
        <div>
          <Text variant="title" as="h4">{isRTL ? 'ساعات العمل' : 'Working hours'}</Text>
          <Text variant="body" tone="tertiary" as="p" className="mt-1">
            {isRTL
              ? 'صف لكل فرع وعمود لكل يوم. الخلية إما 11:00-02:00 أو "closed". النافذة التي تنتهي بعد منتصف الليل صحيحة.'
              : 'One row per branch, one column per day. A cell is either 11:00-02:00 or "closed". A window that ends after midnight is valid.'}
          </Text>
        </div>

        <a href={templateHref(hoursSheet)} download="branch_working_hours.tsv" className={DOWNLOAD_LINK}>
          <Download className="size-4 text-ember" aria-hidden="true" />
          <Text variant="label" tone="ember" as="span" className="underline">
            {isRTL ? 'تنزيل قالب بكل الفروع' : 'Download a template listing every branch'}
          </Text>
        </a>

        <label className="block space-y-1.5">
          <Text variant="caption" tone="tertiary" as="span" className="block">
            {isRTL ? 'الصق هنا' : 'Paste here'}
          </Text>
          <textarea
            rows={6}
            dir="ltr"
            value={hoursText}
            onChange={(e) => { setHoursText(e.target.value); setHoursPlan(null); setHoursOutcome(null); }}
            placeholder="branch&#9;sun&#9;mon&#9;tue&#9;wed&#9;thu&#9;fri&#9;sat"
            className={TEXTAREA}
          />
        </label>

        <Button
          label={isRTL ? 'فحص' : 'Check'}
          variant="secondary"
          onClick={() => { setHoursOutcome(null); setHoursPlan(parseHours(hoursText, branches)); }}
          disabled={hoursText.trim() === '' || hoursBusy}
        />

        {hoursPlan ? (
          <div className="space-y-3 rounded-[var(--radius-ds-lg)] border border-con-line bg-con-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                label={isRTL ? `فروع جاهزة: ${hoursPlan.rows.length}` : `${hoursPlan.rows.length} branch(es) ready`}
                tone={hoursPlan.rows.length > 0 ? 'success' : 'neutral'}
              />
              {hoursPlan.errors.length > 0 ? (
                <StatusPill
                  label={isRTL ? `مرفوض: ${hoursPlan.errors.length}` : `${hoursPlan.errors.length} refused`}
                  tone="warning"
                />
              ) : null}
            </div>

            {hoursPlan.errors.length > 0 ? errorList(hoursPlan.errors) : null}

            {hoursPlan.rows.length > 0 ? (
              <div className="max-h-[180px] overflow-y-auto rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface">
                <ul>
                  {hoursPlan.rows.map((r) => (
                    <li key={r.branch.id} className="flex items-center justify-between gap-2 border-b border-con-line px-3 py-1.5 last:border-b-0">
                      <Text variant="caption" as="span">{isRTL ? r.branch.nameAr : r.branch.nameEn}</Text>
                      <Text variant="caption" tone="tertiary" numeric as="span">
                        {r.closedCount === 0
                          ? (isRTL ? 'سبعة أيام عمل' : 'open 7 days')
                          : (isRTL ? `مغلق ${r.closedCount} يوم` : `${r.closedCount} day(s) closed`)}
                      </Text>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Button
              label={hoursBusy
                ? (isRTL ? '...جاري التطبيق' : 'Applying…')
                : (isRTL ? `تطبيق على ${hoursPlan.rows.length} فرع` : `Apply to ${hoursPlan.rows.length} branch(es)`)}
              onClick={() => { void handleApplyHours(); }}
              disabled={disabled || hoursBusy || hoursPlan.rows.length === 0}
              className="w-full"
            />
          </div>
        ) : null}

        {hoursOutcome ? outcomeNotice(hoursOutcome) : null}
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Delivery areas                                                   */}
      {/* ---------------------------------------------------------------- */}
      <Card className="space-y-3">
        <div>
          <Text variant="title" as="h4">{isRTL ? 'مناطق التوصيل' : 'Delivery areas'}</Text>
          <Text variant="body" tone="tertiary" as="p" className="mt-1">
            {isRTL
              ? 'صف لكل منطقة. الاسم العربي مطلوب والإنجليزي اختياري. المنطقة الموجودة مسبقًا تُتجاوز ولا تُضاف مرتين.'
              : 'One row per area. The Arabic name is required, the English one optional. An area a branch already has is skipped rather than added twice.'}
          </Text>
        </div>

        <a href={templateHref(areasSheet)} download="branch_delivery_areas.tsv" className={DOWNLOAD_LINK}>
          <Download className="size-4 text-ember" aria-hidden="true" />
          <Text variant="label" tone="ember" as="span" className="underline">
            {isRTL ? 'تنزيل قالب بكل الفروع' : 'Download a template listing every branch'}
          </Text>
        </a>

        <label className="block space-y-1.5">
          <Text variant="caption" tone="tertiary" as="span" className="block">
            {isRTL ? 'الصق هنا' : 'Paste here'}
          </Text>
          <textarea
            rows={6}
            dir="ltr"
            value={areasText}
            onChange={(e) => { setAreasText(e.target.value); setAreasPlan(null); setAreasOutcome(null); }}
            placeholder="branch&#9;name_ar&#9;name_en"
            className={TEXTAREA}
          />
        </label>

        <Button
          label={isRTL ? 'فحص' : 'Check'}
          variant="secondary"
          onClick={() => { void handleParseAreas(); }}
          disabled={areasText.trim() === '' || areasBusy}
        />

        {loadError ? (
          <Notice
            title={isRTL ? 'تعذّر قراءة المناطق الحالية' : 'Existing areas could not be read'}
            action={isRTL
              ? `لا يمكن كشف المكرر، وقد تُضاف المنطقة مرتين. ${loadError}`
              : `Duplicates cannot be detected, so an area may be added twice. ${loadError}`}
            tone="warning"
          />
        ) : null}

        {areasPlan ? (
          <div className="space-y-3 rounded-[var(--radius-ds-lg)] border border-con-line bg-con-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                label={isRTL
                  ? `مناطق جديدة: ${areasPlan.rows.filter((r) => !r.duplicate).length}`
                  : `${areasPlan.rows.filter((r) => !r.duplicate).length} new area(s)`}
                tone={areasPlan.rows.some((r) => !r.duplicate) ? 'success' : 'neutral'}
              />
              {areasPlan.rows.some((r) => r.duplicate) ? (
                <StatusPill
                  label={isRTL
                    ? `موجود مسبقًا: ${areasPlan.rows.filter((r) => r.duplicate).length}`
                    : `${areasPlan.rows.filter((r) => r.duplicate).length} already there`}
                  tone="info"
                />
              ) : null}
              {areasPlan.errors.length > 0 ? (
                <StatusPill
                  label={isRTL ? `مرفوض: ${areasPlan.errors.length}` : `${areasPlan.errors.length} refused`}
                  tone="warning"
                />
              ) : null}
            </div>

            {areasPlan.errors.length > 0 ? errorList(areasPlan.errors) : null}

            {areasPlan.rows.length > 0 ? (
              <div className="max-h-[180px] overflow-y-auto rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface">
                <ul>
                  {areasPlan.rows.map((r, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 border-b border-con-line px-3 py-1.5 last:border-b-0">
                      <Text variant="caption" as="span">
                        {(isRTL ? r.branch.nameAr : r.branch.nameEn)} — {r.nameAr}
                        {r.nameEn ? ` (${r.nameEn})` : ''}
                      </Text>
                      {r.duplicate ? (
                        <Text variant="caption" tone="tertiary" as="span">
                          {isRTL ? 'موجودة — تُتجاوز' : 'already there — skipped'}
                        </Text>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Button
              label={areasBusy
                ? (isRTL ? '...جاري التطبيق' : 'Applying…')
                : (isRTL
                  ? `إضافة ${areasPlan.rows.filter((r) => !r.duplicate).length} منطقة`
                  : `Add ${areasPlan.rows.filter((r) => !r.duplicate).length} area(s)`)}
              onClick={() => { void handleApplyAreas(); }}
              disabled={disabled || areasBusy || !areasPlan.rows.some((r) => !r.duplicate)}
              className="w-full"
            />
          </div>
        ) : null}

        {areasOutcome ? outcomeNotice(areasOutcome) : null}
      </Card>
    </div>
  );
};
