/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import { Button } from '../../../../design-system/ui/Button';
import { Field } from '../../../../design-system/ui/Field';
import { Notice } from '../../../../design-system/ui/Notice';
import { StatusPill } from '../../../../design-system/ui/StatusPill';
import { Text } from '../../../../design-system/ui/Text';
import { DeliveryArea, branchConfig } from '../../../../lib/branchConfigApi';
import { reorder } from './workingHours';

const ICON_BTN =
  'ds-motion inline-flex size-9 items-center justify-center rounded-[var(--radius-ds-md)] ' +
  'border border-con-line bg-con-surface text-con-text-2 transition-colors duration-150 ' +
  'hover:bg-con-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40';

/**
 * Named delivery areas for one branch.
 *
 * These are ADVISORY — a reference list for call-centre staff taking phone
 * orders. Delivery eligibility is decided solely by the branch's map polygon, so
 * disabling an area here does NOT stop the app accepting orders from it. That is
 * counter-intuitive enough that the notice says it in the UI rather than only in
 * the docs, because the person disabling "النسيم" will otherwise assume
 * otherwise.
 *
 * Areas are their own rows, so each change is written immediately and the list
 * reloaded — the same model as banners, not the modal's atomic draft.
 */
export const DeliveryAreasEditor: React.FC<{
  branchId: string;
  disabled?: boolean;
  isRTL: boolean;
}> = ({ branchId, disabled, isRTL }) => {
  const label = (en: string, ar: string) => (isRTL ? ar : en);
  const [areas, setAreas] = React.useState<DeliveryArea[]>([]);
  const [nameAr, setNameAr] = React.useState('');
  const [nameEn, setNameEn] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setAreas(await branchConfig.areas(branchId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [branchId]);

  React.useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const move = (index: number, delta: number) => {
    const next = reorder(areas, index, delta);
    void run(async () => {
      for (const { item, sortOrder } of next) {
        if (item.sortOrder !== sortOrder) await branchConfig.moveArea(item.id, sortOrder);
      }
    });
  };

  return (
    <div className="space-y-2 border-t border-con-line pt-3">
      <Text variant="label" as="p">{label('Delivery areas', 'مناطق التوصيل')}</Text>
      <Notice
        tone="warning"
        title={label('Call-centre reference only', 'مرجع لمركز الاتصال فقط')}
        action={label(
          'These names help staff answer the phone. They do not control the app — delivery is decided by the branch map area, so disabling one here does not stop orders from it.',
          'هذه الأسماء لمساعدة الموظفين عند الرد على الهاتف. لا تتحكم في التطبيق — التوصيل يُحدَّد من منطقة الفرع على الخريطة، وإيقاف منطقة هنا لا يمنع الطلبات منها.',
        )}
      />
      {error ? <Notice title={label('Action failed', 'تعذّر تنفيذ العملية')} action={error} tone="blocking" /> : null}

      {areas.length === 0 ? (
        <Text variant="caption" tone="tertiary" as="p">
          {label('No areas yet.', 'لا توجد مناطق بعد.')}
        </Text>
      ) : (
        <div className="space-y-1.5">
          {areas.map((a, i) => (
            <div key={a.id} className="flex items-center gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-2">
              <div className="min-w-0 flex-1">
                <Text variant="label" as="span">{isRTL ? a.nameAr : (a.nameEn || a.nameAr)}</Text>
                {a.isDisabled ? (
                  <StatusPill label={label('Disabled', 'موقوفة')} tone="warning" className="ms-2" />
                ) : null}
              </div>
              {!disabled && (
                <>
                  <button type="button" className={ICON_BTN} disabled={busy || i === 0}
                    onClick={() => move(i, -1)} aria-label={label(`Move ${a.nameAr} up`, `تحريك ${a.nameAr} لأعلى`)}>
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" className={ICON_BTN} disabled={busy || i === areas.length - 1}
                    onClick={() => move(i, 1)} aria-label={label(`Move ${a.nameAr} down`, `تحريك ${a.nameAr} لأسفل`)}>
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" className={ICON_BTN} disabled={busy}
                    onClick={() => {
                      if (window.confirm(label(`Delete the area "${a.nameAr}"?`, `حذف منطقة "${a.nameAr}"؟`))) {
                        void run(() => branchConfig.deleteArea(a.id));
                      }
                    }}
                    aria-label={label(`Delete ${a.nameAr}`, `حذف ${a.nameAr}`)}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Field label={label('Area name (Arabic)', 'اسم المنطقة (عربي)')} value={nameAr}
            onValueChange={setNameAr} disabled={busy} dir="rtl" />
          <Field label={label('Area name (English)', 'اسم المنطقة (إنجليزي)')} value={nameEn}
            onValueChange={setNameEn} disabled={busy} />
          <Button
            label={label('Add', 'إضافة')}
            onClick={() => {
              if (!nameAr.trim()) return;
              void run(async () => {
                await branchConfig.addArea(branchId, nameAr, nameEn);
                setNameAr(''); setNameEn('');
              });
            }}
            disabled={busy || !nameAr.trim()}
            variant="secondary"
            leading={<Plus className="size-4" />}
          />
        </div>
      )}
    </div>
  );
};
