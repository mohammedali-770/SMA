import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronUp, ImageIcon, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { banners as bannerApi, DbHomepageBanner } from '../../lib/api';
import { isAllowedBannerSize, isAllowedBannerType, selectActiveBanners } from '../../lib/banners';

/**
 * Admin-only Banner Management. Admins add/enable/order/delete homepage banners
 * shown in the mobile app (above the search bar). Accountants are view-only.
 * Images upload to the public `banner-images` bucket (admin-only via RLS); the
 * secret/service-role key is never used here — only the anon client + RLS.
 */
type Draft = {
  title_en: string;
  title_ar: string;
  image_url: string;
  storage_path: string | null;
  is_active: boolean;
  sort_order: string;
  starts_at: string;
  ends_at: string;
  action_type: 'none' | 'category' | 'product';
  action_value: string;
};

const EMPTY_DRAFT: Draft = {
  title_en: '', title_ar: '', image_url: '', storage_path: null, is_active: true,
  sort_order: '0', starts_at: '', ends_at: '', action_type: 'none', action_value: '',
};

/** datetime-local value ("YYYY-MM-DDTHH:mm") -> ISO string, or null when empty. */
const toIso = (v: string): string | null => (v ? new Date(v).toISOString() : null);

export const BannerManagementPanel: React.FC = () => {
  const { currentUser, adminLang } = useApp();
  const isRTL = adminLang === 'ar';
  const isAccountant = currentUser.role === 'accountant';

  const [rows, setRows] = useState<DbHomepageBanner[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try { setRows(await bannerApi.list()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  // Which banners are LIVE right now (mirrors what the mobile app will show).
  const liveIds = new Set(selectActiveBanners<DbHomepageBanner>(rows, Date.now()).map(r => r.id));

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    if (!isAllowedBannerType({ type: file.type, name: file.name })) {
      setUploadError(isRTL ? 'صيغة غير مدعومة. استخدم JPG أو PNG أو WebP.' : 'Unsupported format. Use JPG, PNG, or WebP.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (!isAllowedBannerSize(file.size)) {
      setUploadError(isRTL ? 'حجم الصورة كبير جداً (الحد ٥ ميجابايت).' : 'Image too large (5 MB max).');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setUploading(true);
    try {
      const { path, publicUrl } = await bannerApi.uploadImage(file);
      setDraft(d => ({ ...d, image_url: publicUrl, storage_path: path }));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  const addBanner = async () => {
    if (!draft.image_url) { setUploadError(isRTL ? 'ارفع صورة البانر أولاً.' : 'Upload a banner image first.'); return; }
    setCreating(true); setError(null);
    try {
      await bannerApi.create({
        title_en: draft.title_en.trim() || null,
        title_ar: draft.title_ar.trim() || null,
        image_url: draft.image_url,
        storage_path: draft.storage_path,
        is_active: draft.is_active,
        sort_order: parseInt(draft.sort_order, 10) || 0,
        starts_at: toIso(draft.starts_at),
        ends_at: toIso(draft.ends_at),
        action_type: draft.action_type,
        action_value: draft.action_type === 'none' ? null : (draft.action_value.trim() || null),
      });
      setDraft(EMPTY_DRAFT);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const patch = async (id: string, p: Partial<DbHomepageBanner>) => {
    setBusyId(id); setError(null);
    try { await bannerApi.update(id, p); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyId(null); }
  };

  const remove = async (b: DbHomepageBanner) => {
    if (!window.confirm(isRTL ? 'حذف هذا البانر نهائياً؟' : 'Delete this banner permanently?')) return;
    setBusyId(b.id); setError(null);
    try {
      await bannerApi.remove(b.id);
      // Best-effort image cleanup (never block on it).
      if (b.storage_path) { try { await bannerApi.removeImage(b.storage_path); } catch { /* ignore */ } }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5 animate-fade-in text-xs animate-scale-up" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
      {/* The panel title lives in the dashboard shell header; this row carries
          only what the shell cannot say — the operating rule and the gate. */}
      <div className="flex justify-between items-start gap-3">
        <div>
          <p className="text-[11px] text-slate-600 font-medium leading-relaxed max-w-2xl">
            {isRTL ? 'تظهر في أعلى الصفحة الرئيسية للتطبيق (فوق شريط البحث). البانرات المفعّلة فقط تظهر للعملاء.' : 'Shown at the top of the app homepage (above search). Only active banners appear to customers.'}
          </p>
        </div>
        <span className="text-[8px] bg-indigo-100 text-primary px-2 py-0.5 rounded font-black flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" /> {isRTL ? 'للمشرف فقط' : 'Admin only'}
        </span>
      </div>

      {isAccountant && (
        <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-amber-900 text-[11px] font-bold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-700 flex-shrink-0" />
          {isRTL ? 'البانرات للعرض فقط — الإضافة والتعديل متاحان للمشرف.' : 'Banners are view-only for accountants — creating/editing is admin-only.'}
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-red-800 text-[11px] font-bold flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />{error}</span>
          <button onClick={() => void load()} className="sm-fill-danger text-[10px] font-black py-1 px-3 rounded-lg">{isRTL ? 'إعادة المحاولة' : 'Retry'}</button>
        </div>
      )}

      {/* ADD NEW BANNER */}
      {!isAccountant && (
        <div className="glass-card p-4 rounded-2xl bg-white/50 space-y-3">
          <span className="font-black text-slate-800 text-xs block border-b border-slate-100 pb-2">{isRTL ? 'إضافة بانر جديد' : 'Add New Banner'}</span>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Upload + preview */}
            <div className="space-y-2">
              <label className="block text-[9px] font-black text-slate-600">{isRTL ? 'صورة البانر' : 'Banner Image'}</label>
              <div className="aspect-[16/6] w-full rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center">
                {draft.image_url ? (
                  <img src={draft.image_url} alt="banner preview" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-slate-600 flex flex-col items-center gap-1"><ImageIcon className="w-6 h-6" /><span className="text-[9px] font-bold">{isRTL ? 'معاينة' : 'Preview'}</span></span>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void onPickFile(e)} disabled={uploading} className="block w-full text-[10px] file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-primary file:text-white file:font-black file:text-[10px] file:cursor-pointer" />
              {uploading && <span className="text-[10px] text-slate-600 font-bold flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> {isRTL ? 'جاري الرفع…' : 'Uploading…'}</span>}
              {uploadError && <span className="text-[10px] text-red-700 font-bold flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {uploadError}</span>}
              <p className="text-[9px] text-slate-600 font-medium">{isRTL ? 'المقاس المفضّل ١٢٠٠×٤٥٠ بكسل • JPG/WebP • أقل من ٥ ميجابايت' : 'Recommended 1200×450 px • JPG/WebP • under 5 MB'}</p>
            </div>

            {/* Fields */}
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-black text-slate-600 mb-1">{isRTL ? 'العنوان (EN) / اسم داخلي' : 'Title (EN) / internal'}</label>
                  <input value={draft.title_en} onChange={(e) => setDraft(d => ({ ...d, title_en: e.target.value }))} className="glass-input w-full p-2 font-bold text-slate-700 text-xs" placeholder="Summer Combo" />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-600 mb-1">{isRTL ? 'العنوان (AR)' : 'Title (AR)'}</label>
                  <input value={draft.title_ar} onChange={(e) => setDraft(d => ({ ...d, title_ar: e.target.value }))} className="glass-input w-full p-2 font-bold text-slate-700 text-xs" placeholder="عرض الصيف" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-black text-slate-600 mb-1">{isRTL ? 'الترتيب' : 'Sort order'}</label>
                  <input type="number" value={draft.sort_order} onChange={(e) => setDraft(d => ({ ...d, sort_order: e.target.value }))} className="glass-input w-full p-2 font-bold text-slate-700 text-xs" />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-600 mb-1">{isRTL ? 'الحالة' : 'Status'}</label>
                  <select value={draft.is_active ? 'true' : 'false'} onChange={(e) => setDraft(d => ({ ...d, is_active: e.target.value === 'true' }))} className="glass-input w-full p-2 font-bold text-slate-700 text-xs">
                    <option value="true">{isRTL ? 'مفعّل' : 'Active'}</option>
                    <option value="false">{isRTL ? 'معطّل' : 'Inactive'}</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-black text-slate-600 mb-1">{isRTL ? 'يبدأ (اختياري)' : 'Starts (optional)'}</label>
                  <input type="datetime-local" value={draft.starts_at} onChange={(e) => setDraft(d => ({ ...d, starts_at: e.target.value }))} className="glass-input w-full p-2 font-bold text-slate-700 text-[11px]" />
                </div>
                <div>
                  <label className="block text-[9px] font-black text-slate-600 mb-1">{isRTL ? 'ينتهي (اختياري)' : 'Ends (optional)'}</label>
                  <input type="datetime-local" value={draft.ends_at} onChange={(e) => setDraft(d => ({ ...d, ends_at: e.target.value }))} className="glass-input w-full p-2 font-bold text-slate-700 text-[11px]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[9px] font-black text-slate-600 mb-1">{isRTL ? 'الإجراء عند الضغط' : 'Tap action'}</label>
                  <select value={draft.action_type} onChange={(e) => setDraft(d => ({ ...d, action_type: e.target.value as Draft['action_type'] }))} className="glass-input w-full p-2 font-bold text-slate-700 text-xs">
                    <option value="none">{isRTL ? 'بدون' : 'None'}</option>
                    <option value="category">{isRTL ? 'فئة' : 'Category'}</option>
                    <option value="product">{isRTL ? 'منتج' : 'Product'}</option>
                  </select>
                </div>
                {draft.action_type !== 'none' && (
                  <div>
                    <label className="block text-[9px] font-black text-slate-600 mb-1">{draft.action_type === 'product' ? (isRTL ? 'معرّف المنتج' : 'Product ID') : (isRTL ? 'معرّف الفئة' : 'Category ID')}</label>
                    <input value={draft.action_value} onChange={(e) => setDraft(d => ({ ...d, action_value: e.target.value }))} className="glass-input w-full p-2 font-mono font-bold text-slate-700 text-[11px]" placeholder="uuid" />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={() => void addBanner()} disabled={creating || uploading || !draft.image_url} className="bg-primary hover:bg-primary/90 text-white text-[11px] font-black py-2 px-4 rounded-xl flex items-center gap-1.5 disabled:opacity-40">
              <Plus className="w-3.5 h-3.5" /> {creating ? (isRTL ? 'جاري الإضافة…' : 'Adding…') : (isRTL ? 'إضافة البانر' : 'Add Banner')}
            </button>
          </div>
        </div>
      )}

      {/* EXISTING BANNERS */}
      <div className="space-y-2">
        <span className="font-bold text-slate-700 text-xs">{isRTL ? `البانرات (${rows.length})` : `Banners (${rows.length})`}</span>
        {loading ? (
          <div className="py-8 text-center text-slate-600 text-xs font-bold animate-pulse">{isRTL ? 'جاري التحميل…' : 'Loading…'}</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-slate-600 text-[11px] font-bold">{isRTL ? 'لا توجد بانرات بعد.' : 'No banners yet.'}</div>
        ) : (
          <div className="space-y-2">
            {rows.map((b) => {
              const live = liveIds.has(b.id);
              const busy = busyId === b.id;
              return (
                <div key={b.id} className="glass-card bg-white/50 rounded-2xl p-2.5 flex items-center gap-3">
                  <div className="w-28 h-[42px] rounded-lg overflow-hidden bg-slate-100 flex-shrink-0 border border-slate-100">
                    <img src={b.image_url} alt={b.title_en ?? 'banner'} className="w-full h-full object-cover" loading="lazy"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-slate-800 text-[11px] truncate">{b.title_en || b.title_ar || (isRTL ? 'بدون عنوان' : 'Untitled')}</span>
                      <span className={`text-[7.5px] font-black px-1.5 py-0.5 rounded-full ${live ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}>
                        {live ? (isRTL ? 'ظاهر الآن' : 'LIVE') : (b.is_active ? (isRTL ? 'مجدول/منتهٍ' : 'SCHEDULED') : (isRTL ? 'معطّل' : 'OFF'))}
                      </span>
                    </div>
                    <span className="text-[9px] text-slate-600 font-bold">
                      {isRTL ? 'الترتيب' : 'Order'} {b.sort_order}
                      {b.starts_at ? ` • ${isRTL ? 'من' : 'from'} ${new Date(b.starts_at).toLocaleDateString()}` : ''}
                      {b.ends_at ? ` • ${isRTL ? 'إلى' : 'to'} ${new Date(b.ends_at).toLocaleDateString()}` : ''}
                    </span>
                  </div>
                  {!isAccountant && (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <div className="flex flex-col">
                        <button title={isRTL ? 'أعلى' : 'Up'} disabled={busy} onClick={() => void patch(b.id, { sort_order: b.sort_order - 1 })} className="text-slate-600 hover:text-primary disabled:opacity-30"><ChevronUp className="w-3.5 h-3.5" /></button>
                        <button title={isRTL ? 'أسفل' : 'Down'} disabled={busy} onClick={() => void patch(b.id, { sort_order: b.sort_order + 1 })} className="text-slate-600 hover:text-primary disabled:opacity-30"><ChevronDown className="w-3.5 h-3.5" /></button>
                      </div>
                      <button
                        disabled={busy}
                        onClick={() => void patch(b.id, { is_active: !b.is_active })}
                        className={`text-[9px] font-black px-2.5 py-1.5 rounded-lg disabled:opacity-40 ${b.is_active ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
                      >
                        {busy ? '…' : b.is_active ? (isRTL ? 'تعطيل' : 'Disable') : (isRTL ? 'تفعيل' : 'Enable')}
                      </button>
                      <button title={isRTL ? 'حذف' : 'Delete'} disabled={busy} onClick={() => void remove(b)} className="text-red-700 hover:text-red-600 disabled:opacity-30 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="bg-slate-50 border border-slate-200/50 p-3 rounded-xl flex items-start gap-2 text-slate-500 text-[10px] leading-relaxed mt-2">
          <Check className="w-4 h-4 text-green-700 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-extrabold text-slate-700 block mb-0.5">{isRTL ? 'كيف تظهر للعملاء' : 'How customers see them'}</span>
            {isRTL
              ? 'يعرض التطبيق البانرات المفعّلة فقط ضمن نطاق التاريخ، مرتّبة حسب الترتيب. أكثر من بانر = شريط متحرك تلقائي. لا يوجد بانر مفعّل = تختفي المساحة.'
              : 'The app shows only active, in-window banners, ordered by sort order. More than one = an auto-rotating carousel. No active banner = the area is hidden.'}
          </div>
        </div>
      </div>
    </div>
  );
};
