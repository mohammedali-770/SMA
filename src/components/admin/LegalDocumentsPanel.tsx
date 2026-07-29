import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Eye, EyeOff, FileText, ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { legalDocs as legalApi, DbLegalDocument } from '../../lib/api';
import { activeLegalDocs, legalDocOrder } from '../../lib/legal';

/**
 * Admin-only Legal Documents editor. Admins edit the AR/EN title + content,
 * version, effective date, active flag, and requires_acceptance for each policy
 * document; the mobile app reads only ACTIVE documents. Accountants are
 * view-only. Content is plain text with preserved line breaks (no rich editor).
 * Seeded content is an editable placeholder, not lawyer-reviewed legal advice.
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

export const LegalDocumentsPanel: React.FC = () => {
  const { currentUser, adminLang } = useApp();
  const isRTL = adminLang === 'ar';
  const isAccountant = currentUser.role === 'accountant';

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
    <div className="space-y-5 animate-fade-in text-xs animate-scale-up" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
      {/* Title comes from the shell header; the not-legal-advice caveat stays. */}
      <div className="flex justify-between items-start gap-3">
        <div>
          <p className="text-[11px] text-slate-600 font-medium leading-relaxed max-w-2xl">
            {isRTL ? 'حرّر السياسات بالعربية والإنجليزية — تظهر المفعّلة في التطبيق. المحتوى قابل للتعديل وليس استشارة قانونية.' : 'Edit policies in AR & EN — active ones show in the app. Content is editable placeholder text, not legal advice.'}
          </p>
        </div>
        <span className="text-[8px] bg-indigo-100 text-primary px-2 py-0.5 rounded font-black flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" /> {isRTL ? 'للمشرف فقط' : 'Admin only'}
        </span>
      </div>

      {isAccountant && (
        <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-amber-900 text-[11px] font-bold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-700 flex-shrink-0" />
          {isRTL ? 'المستندات للعرض فقط — التعديل متاح للمشرف.' : 'Documents are view-only for accountants — editing is admin-only.'}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-800 text-[11px] font-bold flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />{error}</span>
          <button onClick={() => void load()} className="sm-fill-danger text-[10px] font-black py-1 px-3 rounded-lg">{isRTL ? 'إعادة المحاولة' : 'Retry'}</button>
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-slate-600 text-xs font-bold animate-pulse">{isRTL ? 'جاري التحميل…' : 'Loading…'}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
          {/* Document list */}
          <div className="space-y-1.5">
            <span className="text-[9px] font-black text-slate-600 px-1">{isRTL ? `المستندات (${activeCount}/${rows.length} مفعّل)` : `Documents (${activeCount}/${rows.length} active)`}</span>
            {ordered.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={`w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all ${
                  d.id === selectedId ? 'bg-primary/10 text-primary border-primary/20' : 'bg-white/50 text-slate-600 border-transparent hover:bg-white/80'
                }`}
              >
                <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="flex-1 font-bold text-[11px] truncate">{isRTL ? d.title_ar : d.title_en}</span>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${d.is_active ? 'bg-green-500' : 'bg-slate-300'}`} title={d.is_active ? 'active' : 'inactive'} />
              </button>
            ))}
          </div>

          {/* Editor */}
          {draft && selected ? (
            <div className="glass-card bg-white/50 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="font-black text-slate-800 text-xs">{isRTL ? draft.title_ar : draft.title_en}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPreview((p) => !p)} className="text-[10px] font-black text-slate-600 hover:text-primary flex items-center gap-1">
                    {preview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} {preview ? (isRTL ? 'تحرير' : 'Edit') : (isRTL ? 'معاينة' : 'Preview')}
                  </button>
                  <span className="text-[8px] font-mono text-slate-600">{selected.document_type}</span>
                </div>
              </div>

              {preview ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {(['en', 'ar'] as const).map((l) => (
                    <div key={l} className="bg-white border border-slate-100 rounded-xl p-3" dir={l === 'ar' ? 'rtl' : 'ltr'}>
                      <div className="font-black text-slate-800 text-[12px] mb-1">{l === 'ar' ? draft.title_ar : draft.title_en}</div>
                      <div className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-wrap">{l === 'ar' ? draft.content_ar : draft.content_en}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] font-black text-slate-600 mb-1">{isRTL ? 'العنوان (EN)' : 'Title (EN)'}</label>
                      <input value={draft.title_en} onChange={(e) => setDraft({ ...draft, title_en: e.target.value })} disabled={isAccountant} className="glass-input w-full p-2 font-bold text-slate-700 text-xs" />
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-slate-600 mb-1">{isRTL ? 'العنوان (AR)' : 'Title (AR)'}</label>
                      <input value={draft.title_ar} onChange={(e) => setDraft({ ...draft, title_ar: e.target.value })} disabled={isAccountant} dir="rtl" className="glass-input w-full p-2 font-bold text-slate-700 text-xs" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[9px] font-black text-slate-600 mb-1">{isRTL ? 'المحتوى (EN)' : 'Content (EN)'}</label>
                    <textarea value={draft.content_en} onChange={(e) => setDraft({ ...draft, content_en: e.target.value })} disabled={isAccountant} rows={9} className="glass-input w-full p-2 font-semibold text-slate-700 text-[11px] leading-relaxed" />
                  </div>
                  <div>
                    <label className="block text-[9px] font-black text-slate-600 mb-1">{isRTL ? 'المحتوى (AR)' : 'Content (AR)'}</label>
                    <textarea value={draft.content_ar} onChange={(e) => setDraft({ ...draft, content_ar: e.target.value })} disabled={isAccountant} dir="rtl" rows={9} className="glass-input w-full p-2 font-semibold text-slate-700 text-[11px] leading-relaxed" />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[9px] font-black text-slate-600 mb-1">{isRTL ? 'الإصدار' : 'Version'}</label>
                      <input value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} disabled={isAccountant} className="glass-input w-full p-2 font-bold text-slate-700 text-xs" />
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-slate-600 mb-1">{isRTL ? 'تاريخ السريان' : 'Effective date'}</label>
                      <input type="date" value={draft.effective_date} onChange={(e) => setDraft({ ...draft, effective_date: e.target.value })} disabled={isAccountant} className="glass-input w-full p-2 font-bold text-slate-700 text-[11px]" />
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-slate-600 mb-1">{isRTL ? 'الحالة' : 'Status'}</label>
                      <select value={draft.is_active ? 'true' : 'false'} onChange={(e) => setDraft({ ...draft, is_active: e.target.value === 'true' })} disabled={isAccountant} className="glass-input w-full p-2 font-bold text-slate-700 text-xs">
                        <option value="true">{isRTL ? 'مفعّل' : 'Active'}</option>
                        <option value="false">{isRTL ? 'معطّل' : 'Inactive'}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-slate-600 mb-1">{isRTL ? 'يتطلب الموافقة' : 'Requires acceptance'}</label>
                      <select value={draft.requires_acceptance ? 'true' : 'false'} onChange={(e) => setDraft({ ...draft, requires_acceptance: e.target.value === 'true' })} disabled={isAccountant} className="glass-input w-full p-2 font-bold text-slate-700 text-xs">
                        <option value="false">{isRTL ? 'لا' : 'No'}</option>
                        <option value="true">{isRTL ? 'نعم' : 'Yes'}</option>
                      </select>
                    </div>
                  </div>

                  {!isAccountant && (
                    <div className="flex justify-end items-center gap-3 border-t border-slate-100 pt-3">
                      {savedOk && !dirty && <span className="text-[10px] text-green-700 font-bold flex items-center gap-1"><Check className="w-3.5 h-3.5" /> {isRTL ? 'تم الحفظ' : 'Saved'}</span>}
                      <button onClick={() => void save()} disabled={saving || !dirty} className="bg-primary hover:bg-primary/90 text-white text-[11px] font-black py-2 px-4 rounded-xl disabled:opacity-40">
                        {saving ? (isRTL ? 'جاري الحفظ…' : 'Saving…') : (isRTL ? 'حفظ التغييرات' : 'Save Changes')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-slate-600 text-[11px] font-bold">{isRTL ? 'اختر مستنداً.' : 'Select a document.'}</div>
          )}
        </div>
      )}
    </div>
  );
};
