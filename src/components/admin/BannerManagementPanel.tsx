import React, { useEffect, useRef, useState } from 'react';
import { Check, ImageIcon, Loader2, Plus, ShieldCheck } from 'lucide-react';

import { useApp } from '../../context/AppContext';
import { banners as bannerApi, DbHomepageBanner } from '../../lib/api';
import { isAllowedBannerSize, isAllowedBannerType, selectActiveBanners } from '../../lib/banners';
import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Field } from '../../design-system/ui/Field';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { useDsFontClass } from '../../design-system/ui/useDsLang';
import { BannerRow } from './view/banners/BannerRow';

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

/** Native select, styled to match the design-system Field it sits beside. */
const SELECT = [
  'ds-motion min-h-11 w-full rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3',
  'text-[15px] text-con-text transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

export const BannerManagementPanel: React.FC = () => {
  const { currentUser, adminLang } = useApp();
  const isRTL = adminLang === 'ar';
  const isAccountant = currentUser.role === 'accountant';
  const family = useDsFontClass();

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
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-start justify-between gap-3 border-b border-con-line pb-3">
        <div className="min-w-0">
          <Text variant="title" as="h3">{isRTL ? 'بانرات الصفحة الرئيسية' : 'Homepage Banners'}</Text>
          <Text variant="caption" tone="tertiary" as="p" className="mt-0.5">
            {isRTL
              ? 'تظهر في أعلى الصفحة الرئيسية للتطبيق (فوق شريط البحث). البانرات المفعّلة فقط تظهر للعملاء.'
              : 'Shown at the top of the app homepage (above search). Only active banners appear to customers.'}
          </Text>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1">
          <ShieldCheck className="size-3 text-sky" aria-hidden="true" />
          <StatusPill label={isRTL ? 'للمشرف فقط' : 'Admin only'} tone="info" />
        </span>
      </div>

      {/* Read-only rather than hidden: an accountant reconciling a promotion
          still needs to see which banners were running. */}
      {isAccountant && (
        <Notice
          title={isRTL
            ? 'البانرات للعرض فقط — الإضافة والتعديل متاحان للمشرف.'
            : 'Banners are view-only for accountants — creating/editing is admin-only.'}
          tone="warning"
        />
      )}

      {error && (
        <Notice title={error} tone="blocking">
          <Button label={isRTL ? 'إعادة المحاولة' : 'Retry'} onClick={() => { void load(); }} variant="secondary" />
        </Notice>
      )}

      {!isAccountant && (
        <Card className="space-y-3">
          <Text variant="heading" as="h4" className="border-b border-con-line pb-2">
            {isRTL ? 'إضافة بانر جديد' : 'Add New Banner'}
          </Text>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Text variant="caption" tone="tertiary" as="p">{isRTL ? 'صورة البانر' : 'Banner Image'}</Text>
              <div className="flex aspect-[16/6] w-full items-center justify-center overflow-hidden rounded-[var(--radius-ds-md)] border-2 border-dashed border-con-line bg-con-surface-2">
                {draft.image_url ? (
                  <img src={draft.image_url} alt="banner preview" className="size-full object-cover" />
                ) : (
                  <span className="flex flex-col items-center gap-1 text-con-text-3">
                    <ImageIcon className="size-6" aria-hidden="true" />
                    <Text variant="caption" tone="tertiary" as="span">{isRTL ? 'معاينة' : 'Preview'}</Text>
                  </span>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => void onPickFile(e)}
                disabled={uploading}
                aria-label={isRTL ? 'اختر صورة البانر' : 'Choose banner image'}
                className={`block w-full text-[13px] text-con-text-2 file:me-2 file:cursor-pointer file:rounded-[var(--radius-ds-md)] file:border-0 file:bg-ember file:px-3 file:py-1.5 file:text-[13px] file:font-bold file:text-on-ember ${family}`}
              />
              {uploading && (
                <Text variant="caption" tone="secondary" as="span" className="flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" /> {isRTL ? 'جاري الرفع…' : 'Uploading…'}
                </Text>
              )}
              {uploadError && <Notice title={uploadError} tone="blocking" />}
              <Text variant="caption" tone="tertiary" as="p">
                {isRTL
                  ? 'المقاس المفضّل ١٢٠٠×٤٥٠ بكسل • JPG/WebP • أقل من ٥ ميجابايت'
                  : 'Recommended 1200×450 px • JPG/WebP • under 5 MB'}
              </Text>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Field
                  label={isRTL ? 'العنوان (EN) / اسم داخلي' : 'Title (EN) / internal'}
                  value={draft.title_en}
                  onValueChange={(v) => setDraft(d => ({ ...d, title_en: v }))}
                  placeholder="Summer Combo"
                />
                <Field
                  label={isRTL ? 'العنوان (AR)' : 'Title (AR)'}
                  value={draft.title_ar}
                  onValueChange={(v) => setDraft(d => ({ ...d, title_ar: v }))}
                  placeholder="عرض الصيف"
                  dir="rtl"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field
                  label={isRTL ? 'الترتيب' : 'Sort order'}
                  type="number"
                  numeric
                  value={draft.sort_order}
                  onValueChange={(v) => setDraft(d => ({ ...d, sort_order: v }))}
                />
                <label className="flex flex-col gap-2">
                  <span className="text-start text-[13px] font-semibold text-con-text-2">{isRTL ? 'الحالة' : 'Status'}</span>
                  <select
                    value={draft.is_active ? 'true' : 'false'}
                    onChange={(e) => setDraft(d => ({ ...d, is_active: e.target.value === 'true' }))}
                    className={`${SELECT} ${family}`}
                  >
                    <option value="true">{isRTL ? 'مفعّل' : 'Active'}</option>
                    <option value="false">{isRTL ? 'معطّل' : 'Inactive'}</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field
                  label={isRTL ? 'يبدأ (اختياري)' : 'Starts (optional)'}
                  type="datetime-local"
                  numeric
                  value={draft.starts_at}
                  onValueChange={(v) => setDraft(d => ({ ...d, starts_at: v }))}
                />
                <Field
                  label={isRTL ? 'ينتهي (اختياري)' : 'Ends (optional)'}
                  type="datetime-local"
                  numeric
                  value={draft.ends_at}
                  onValueChange={(v) => setDraft(d => ({ ...d, ends_at: v }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-2">
                  <span className="text-start text-[13px] font-semibold text-con-text-2">{isRTL ? 'الإجراء عند الضغط' : 'Tap action'}</span>
                  <select
                    value={draft.action_type}
                    onChange={(e) => setDraft(d => ({ ...d, action_type: e.target.value as Draft['action_type'] }))}
                    className={`${SELECT} ${family}`}
                  >
                    <option value="none">{isRTL ? 'بدون' : 'None'}</option>
                    <option value="category">{isRTL ? 'فئة' : 'Category'}</option>
                    <option value="product">{isRTL ? 'منتج' : 'Product'}</option>
                  </select>
                </label>
                {draft.action_type !== 'none' && (
                  <Field
                    label={draft.action_type === 'product'
                      ? (isRTL ? 'معرّف المنتج' : 'Product ID')
                      : (isRTL ? 'معرّف الفئة' : 'Category ID')}
                    value={draft.action_value}
                    onValueChange={(v) => setDraft(d => ({ ...d, action_value: v }))}
                    numeric
                    placeholder="uuid"
                  />
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              label={creating ? (isRTL ? 'جاري الإضافة…' : 'Adding…') : (isRTL ? 'إضافة البانر' : 'Add Banner')}
              onClick={() => { void addBanner(); }}
              disabled={creating || uploading || !draft.image_url}
              loading={creating}
              leading={<Plus className="size-3.5" aria-hidden="true" />}
            />
          </div>
        </Card>
      )}

      <div className="space-y-2">
        <Text variant="caption" tone="secondary" as="p">
          {isRTL ? `البانرات (${rows.length})` : `Banners (${rows.length})`}
        </Text>

        {loading ? (
          <Text variant="body" tone="tertiary" as="p" className="py-8 text-center">
            {isRTL ? 'جاري التحميل…' : 'Loading…'}
          </Text>
        ) : rows.length === 0 ? (
          <Text variant="body" tone="tertiary" as="p" className="py-8 text-center">
            {isRTL ? 'لا توجد بانرات بعد.' : 'No banners yet.'}
          </Text>
        ) : (
          <div className="space-y-2">
            {rows.map((b) => (
              <BannerRow
                key={b.id}
                banner={b}
                live={liveIds.has(b.id)}
                busy={busyId === b.id}
                canEdit={!isAccountant}
                isRTL={isRTL}
                onMove={(delta) => { void patch(b.id, { sort_order: b.sort_order + delta }); }}
                onToggleActive={() => { void patch(b.id, { is_active: !b.is_active }); }}
                onDelete={() => { void remove(b); }}
              />
            ))}
          </div>
        )}

        <div className="mt-2 flex items-start gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface-2 p-3">
          <Check className="mt-0.5 size-4 shrink-0 text-mint" aria-hidden="true" />
          <div>
            <Text variant="label" as="p">{isRTL ? 'كيف تظهر للعملاء' : 'How customers see them'}</Text>
            <Text variant="caption" tone="secondary" as="p" className="mt-0.5">
              {isRTL
                ? 'يعرض التطبيق البانرات المفعّلة فقط ضمن نطاق التاريخ، مرتّبة حسب الترتيب. أكثر من بانر = شريط متحرك تلقائي. لا يوجد بانر مفعّل = تختفي المساحة.'
                : 'The app shows only active, in-window banners, ordered by sort order. More than one = an auto-rotating carousel. No active banner = the area is hidden.'}
            </Text>
          </div>
        </div>
      </div>
    </div>
  );
};
