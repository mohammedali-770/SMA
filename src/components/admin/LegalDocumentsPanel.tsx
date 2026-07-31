import React, { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, FileText, ShieldCheck } from 'lucide-react';

import { useApp } from '../../context/AppContext';
import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Field } from '../../design-system/ui/Field';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { useDsFontClass } from '../../design-system/ui/useDsLang';
import { legalDocs as legalApi, DbLegalDocument } from '../../lib/api';
import { activeLegalDocs, legalDocOrder } from '../../lib/legal';

/**
 * Admin-only Legal Documents editor. Admins edit the AR/EN title + content,
 * version, effective date, active flag, and requires_acceptance for each policy
 * document; the mobile app reads only ACTIVE documents. Accountants are
 * view-only. Content is plain text with preserved line breaks (no rich editor).
 * Seeded content is an editable placeholder, not lawyer-reviewed legal advice.
 *
 * Save stays disabled until the draft actually differs from the stored row.
 * These documents carry a version and an effective date, so a no-op save would
 * write a new `updated_at` for a document nobody changed.
 */
type Draft = {
  title_en: string; title_ar: string;
  content_en: string; content_ar: string;
  version: string; effective_date: string;
  is_active: boolean; requires_acceptance: boolean;
};

const toDraft = (d: DbLegalDocument): Draft => ({
  title_en: d.title_en, title_ar: d.title_ar,
  content_en: d.content_en, content_ar: d.content_ar,
  version: d.version, effective_date: d.effective_date ?? '',
  is_active: d.is_active, requires_acceptance: d.requires_acceptance,
});

const TEXTAREA = [
  'ds-motion w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-2.5',
  'text-[13px] leading-relaxed text-con-text transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
].join(' ');

const SELECT = [
  'ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3',
  'text-[15px] text-con-text transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
].join(' ');

const LABEL = 'text-start text-[13px] font-semibold text-con-text-2';

export const LegalDocumentsPanel: React.FC = () => {
  const { currentUser, adminLang } = useApp();
  const isRTL = adminLang === 'ar';
  const isAccountant = currentUser.role === 'accountant';
  const family = useDsFontClass();

  const [rows, setRows] = useState<DbLegalDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [preview, setPreview] = useState(false);

  const ordered = useMemo(
    () => rows.slice().sort((a, b) => legalDocOrder(a.document_type) - legalDocOrder(b.document_type)),
    [rows],
  );
  const selected = ordered.find((r) => r.id === selectedId) ?? null;

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const list = await legalApi.list();
      setRows(list);
      setSelectedId((prev) => prev ?? list.slice().sort((a, b) => legalDocOrder(a.document_type) - legalDocOrder(b.document_type))[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  // Load the selected doc into the editable draft.
  useEffect(() => { setDraft(selected ? toDraft(selected) : null); setSavedOk(false); setPreview(false); }, [selectedId, selected?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!(selected && draft) && JSON.stringify(draft) !== JSON.stringify(toDraft(selected));

  const save = async () => {
    if (!selected || !draft) return;
    setSaving(true); setError(null); setSavedOk(false);
    try {
      await legalApi.update(selected.id, {
        title_en: draft.title_en, title_ar: draft.title_ar,
        content_en: draft.content_en, content_ar: draft.content_ar,
        version: draft.version.trim() || '1.0',
        effective_date: draft.effective_date ? draft.effective_date : null,
        is_active: draft.is_active, requires_acceptance: draft.requires_acceptance,
      });
      setSavedOk(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const activeCount = activeLegalDocs(rows).length;

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-start justify-between gap-3 border-b border-con-line pb-3">
        <div className="min-w-0">
          <Text variant="title" as="h3">
            {isRTL ? 'المستندات القانونية والسياسات' : 'Legal Documents & Policies'}
          </Text>
          <Text variant="caption" tone="tertiary" as="p" className="mt-0.5">
            {isRTL
              ? 'حرّر السياسات بالعربية والإنجليزية — تظهر المفعّلة في التطبيق. المحتوى قابل للتعديل وليس استشارة قانونية.'
              : 'Edit policies in AR & EN — active ones show in the app. Content is editable placeholder text, not legal advice.'}
          </Text>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1">
          <ShieldCheck className="size-3 text-sky" aria-hidden="true" />
          <StatusPill label={isRTL ? 'للمشرف فقط' : 'Admin only'} tone="info" />
        </span>
      </div>

      {isAccountant && (
        <Notice
          title={isRTL ? 'المستندات للعرض فقط — التعديل متاح للمشرف.' : 'Documents are view-only for accountants — editing is admin-only.'}
          tone="warning"
        />
      )}
      {error && (
        <Notice title={error} tone="blocking">
          <Button label={isRTL ? 'إعادة المحاولة' : 'Retry'} onClick={() => { void load(); }} variant="secondary" />
        </Notice>
      )}

      {loading ? (
        <Text variant="body" tone="tertiary" as="p" className="py-8 text-center">
          {isRTL ? 'جاري التحميل…' : 'Loading…'}
        </Text>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
          <div className="space-y-1.5">
            <Text variant="caption" tone="tertiary" as="p" className="px-1">
              {isRTL ? `المستندات (${activeCount}/${rows.length} مفعّل)` : `Documents (${activeCount}/${rows.length} active)`}
            </Text>
            {ordered.map((d) => {
              const active = d.id === selectedId;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedId(d.id)}
                  aria-current={active ? 'true' : undefined}
                  className={[
                    'ds-motion flex w-full items-center gap-2 rounded-[var(--radius-ds-md)] border px-2.5 py-2 text-start',
                    'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
                    active ? 'border-ember bg-ember' : 'border-transparent bg-con-surface-2 hover:bg-con-surface',
                  ].join(' ')}
                >
                  <FileText className={`size-3.5 shrink-0 ${active ? 'text-on-ember' : 'text-con-text-2'}`} aria-hidden="true" />
                  <Text variant="label" tone={active ? 'onEmber' : 'secondary'} as="span" className="flex-1 truncate">
                    {isRTL ? d.title_ar : d.title_en}
                  </Text>
                  {/* A dot rather than a pill: the list is scanned, and eight
                      pills would compete with the selected row. */}
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${d.is_active ? 'bg-mint' : 'bg-con-text-3'}`}
                    title={d.is_active ? 'active' : 'inactive'}
                  />
                </button>
              );
            })}
          </div>

          {draft && selected ? (
            <Card className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-con-line pb-2">
                <Text variant="heading" as="span">{isRTL ? draft.title_ar : draft.title_en}</Text>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreview((p) => !p)}
                    className="ds-motion inline-flex min-h-9 items-center gap-1 rounded-[var(--radius-ds-md)] px-2 transition-colors duration-150 hover:bg-con-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {preview
                      ? <EyeOff className="size-3.5 text-con-text-2" aria-hidden="true" />
                      : <Eye className="size-3.5 text-con-text-2" aria-hidden="true" />}
                    <Text variant="caption" tone="secondary" as="span">
                      {preview ? (isRTL ? 'تحرير' : 'Edit') : (isRTL ? 'معاينة' : 'Preview')}
                    </Text>
                  </button>
                  <Text variant="caption" tone="tertiary" numeric as="span">{selected.document_type}</Text>
                </div>
              </div>

              {preview ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {(['en', 'ar'] as const).map((l) => (
                    <div
                      key={l}
                      className="rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3"
                      dir={l === 'ar' ? 'rtl' : 'ltr'}
                    >
                      <Text variant="label" as="p" className="mb-1">{l === 'ar' ? draft.title_ar : draft.title_en}</Text>
                      <Text variant="caption" tone="secondary" as="p" className="whitespace-pre-wrap leading-relaxed">
                        {l === 'ar' ? draft.content_ar : draft.content_en}
                      </Text>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Field
                      label={isRTL ? 'العنوان (EN)' : 'Title (EN)'}
                      value={draft.title_en}
                      onValueChange={(v) => setDraft({ ...draft, title_en: v })}
                      disabled={isAccountant}
                    />
                    <Field
                      label={isRTL ? 'العنوان (AR)' : 'Title (AR)'}
                      value={draft.title_ar}
                      onValueChange={(v) => setDraft({ ...draft, title_ar: v })}
                      disabled={isAccountant}
                      dir="rtl"
                    />
                  </div>

                  <label className="block space-y-2">
                    <span className={`block ${LABEL}`}>{isRTL ? 'المحتوى (EN)' : 'Content (EN)'}</span>
                    <textarea
                      value={draft.content_en}
                      onChange={(e) => setDraft({ ...draft, content_en: e.target.value })}
                      disabled={isAccountant}
                      rows={9}
                      className={`${TEXTAREA} font-ds-en`}
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className={`block ${LABEL}`}>{isRTL ? 'المحتوى (AR)' : 'Content (AR)'}</span>
                    <textarea
                      value={draft.content_ar}
                      onChange={(e) => setDraft({ ...draft, content_ar: e.target.value })}
                      disabled={isAccountant}
                      dir="rtl"
                      rows={9}
                      className={`${TEXTAREA} font-ds-ar`}
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Field
                      label={isRTL ? 'الإصدار' : 'Version'}
                      numeric
                      value={draft.version}
                      onValueChange={(v) => setDraft({ ...draft, version: v })}
                      disabled={isAccountant}
                    />
                    <Field
                      label={isRTL ? 'تاريخ السريان' : 'Effective date'}
                      type="date"
                      numeric
                      value={draft.effective_date}
                      onValueChange={(v) => setDraft({ ...draft, effective_date: v })}
                      disabled={isAccountant}
                    />
                    <label className="flex flex-col gap-2">
                      <span className={LABEL}>{isRTL ? 'الحالة' : 'Status'}</span>
                      <select
                        value={draft.is_active ? 'true' : 'false'}
                        onChange={(e) => setDraft({ ...draft, is_active: e.target.value === 'true' })}
                        disabled={isAccountant}
                        className={`${SELECT} ${family}`}
                      >
                        <option value="true">{isRTL ? 'مفعّل' : 'Active'}</option>
                        <option value="false">{isRTL ? 'معطّل' : 'Inactive'}</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className={LABEL}>{isRTL ? 'يتطلب الموافقة' : 'Requires acceptance'}</span>
                      <select
                        value={draft.requires_acceptance ? 'true' : 'false'}
                        onChange={(e) => setDraft({ ...draft, requires_acceptance: e.target.value === 'true' })}
                        disabled={isAccountant}
                        className={`${SELECT} ${family}`}
                      >
                        <option value="false">{isRTL ? 'لا' : 'No'}</option>
                        <option value="true">{isRTL ? 'نعم' : 'Yes'}</option>
                      </select>
                    </label>
                  </div>

                  {!isAccountant && (
                    <div className="flex items-center justify-end gap-3 border-t border-con-line pt-3">
                      {savedOk && !dirty && (
                        <Text variant="caption" tone="success" as="span">{isRTL ? 'تم الحفظ' : 'Saved'}</Text>
                      )}
                      <Button
                        label={saving ? (isRTL ? 'جاري الحفظ…' : 'Saving…') : (isRTL ? 'حفظ التغييرات' : 'Save Changes')}
                        onClick={() => { void save(); }}
                        disabled={saving || !dirty}
                        loading={saving}
                      />
                    </div>
                  )}
                </>
              )}
            </Card>
          ) : (
            <Text variant="body" tone="tertiary" as="p" className="py-8 text-center">
              {isRTL ? 'اختر مستنداً.' : 'Select a document.'}
            </Text>
          )}
        </div>
      )}
    </div>
  );
};
