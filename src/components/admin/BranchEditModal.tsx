import React, { useState, Suspense } from 'react';
import { X, MapPin, AlertTriangle, Save } from 'lucide-react';
import type { Branch } from '../../types';

// Lazy so mapbox-gl only loads when the modal is actually opened.
const LocationPicker = React.lazy(() =>
  import('../mobile/LocationPicker').then(m => ({ default: m.LocationPicker })));

interface Props {
  branch: Branch;
  disabled: boolean;       // accountant / non-admin → view-only
  isRTL: boolean;
  onClose: () => void;
  onSave: (patch: Partial<Branch>) => Promise<void>;
}

const num = (v: string): number => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Admin branch editor (modal). Edits name (EN/AR), address (EN/AR), phone,
 * branch LOCATION (map pin + manual lat/lng), fees, minimums, ETA, and channel
 * toggles — then saves via the admin-only branch update path (server RLS is the
 * real gate; accountants open this read-only). Cancel closes without saving.
 */
export const BranchEditModal: React.FC<Props> = ({ branch, disabled, isRTL, onClose, onSave }) => {
  const [nameEn, setNameEn] = useState(branch.nameEn ?? '');
  const [nameAr, setNameAr] = useState(branch.nameAr ?? '');
  const [addressEn, setAddressEn] = useState(branch.addressEn ?? '');
  const [addressAr, setAddressAr] = useState(branch.addressAr ?? '');
  const [phone, setPhone] = useState(branch.phone ?? '');
  const [lat, setLat] = useState<number>(Number.isFinite(branch.latitude) ? branch.latitude : 0);
  const [lng, setLng] = useState<number>(Number.isFinite(branch.longitude) ? branch.longitude : 0);
  const [deliveryFee, setDeliveryFee] = useState<number>(branch.deliveryFee ?? 0);
  const [minDeliveryOrder, setMinDeliveryOrder] = useState<number>(branch.minDeliveryOrder ?? 0);
  const [etaMin, setEtaMin] = useState<string>(branch.estimatedDeliveryMinutes != null ? String(branch.estimatedDeliveryMinutes) : '');
  const [deliveryEnabled, setDeliveryEnabled] = useState<boolean>(branch.deliveryEnabled ?? true);
  const [pickupEnabled, setPickupEnabled] = useState<boolean>(branch.pickupEnabled ?? true);
  const [isActive, setIsActive] = useState<boolean>(branch.isActive ?? true);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const locationSet = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

  const validate = (): string | null => {
    if (!nameEn.trim() || !nameAr.trim()) return isRTL ? 'الاسم بالعربية والإنجليزية مطلوب.' : 'English and Arabic names are required.';
    if (locationSet && (lat < -90 || lat > 90)) return isRTL ? 'خط العرض يجب أن يكون بين -90 و 90.' : 'Latitude must be between -90 and 90.';
    if (locationSet && (lng < -180 || lng > 180)) return isRTL ? 'خط الطول يجب أن يكون بين -180 و 180.' : 'Longitude must be between -180 and 180.';
    if (deliveryFee < 0 || minDeliveryOrder < 0) return isRTL ? 'القيم لا يمكن أن تكون سالبة.' : 'Values cannot be negative.';
    return null;
  };

  const handleSave = async () => {
    setError(null);
    const v = validate();
    if (v) { setError(v); return; }
    setBusy(true);
    try {
      const eta = etaMin.trim() === '' ? undefined : Math.max(0, parseInt(etaMin, 10) || 0);
      await onSave({
        nameEn: nameEn.trim(), nameAr: nameAr.trim(),
        addressEn: addressEn.trim(), addressAr: addressAr.trim(), phone: phone.trim(),
        latitude: lat, longitude: lng,
        deliveryFee, minDeliveryOrder, estimatedDeliveryMinutes: eta,
        deliveryEnabled, pickupEnabled, isActive,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : (isRTL ? 'فشل الحفظ.' : 'Save failed.'));
    } finally {
      setBusy(false);
    }
  };

  const label = (en: string, ar: string) => (isRTL ? ar : en);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 sticky top-0 bg-white">
          <h3 className="text-sm font-black text-slate-800">
            {disabled ? label('View branch', 'عرض الفرع') : label('Edit branch', 'تعديل الفرع')}: {isRTL ? branch.nameAr : branch.nameEn}
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <Field label={label('Name (English)', 'الاسم (إنجليزي)')}>
              <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} disabled={disabled} className="edit-input" />
            </Field>
            <Field label={label('Name (Arabic)', 'الاسم (عربي)')}>
              <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} disabled={disabled} dir="rtl" className="edit-input" />
            </Field>
            <Field label={label('Address (English)', 'العنوان (إنجليزي)')}>
              <input value={addressEn} onChange={(e) => setAddressEn(e.target.value)} disabled={disabled} className="edit-input" />
            </Field>
            <Field label={label('Address (Arabic)', 'العنوان (عربي)')}>
              <input value={addressAr} onChange={(e) => setAddressAr(e.target.value)} disabled={disabled} dir="rtl" className="edit-input" />
            </Field>
            <Field label={label('Phone', 'الهاتف')}>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={disabled} className="edit-input" placeholder="+9665XXXXXXXX" />
            </Field>
            <Field label={label('Estimated delivery (min)', 'وقت التوصيل (دقيقة)')}>
              <input type="number" value={etaMin} onChange={(e) => setEtaMin(e.target.value)} disabled={disabled} className="edit-input" placeholder="—" />
            </Field>
            <Field label={label('Delivery fee (SAR)', 'رسوم التوصيل')}>
              <input type="number" value={deliveryFee} onChange={(e) => setDeliveryFee(num(e.target.value))} disabled={disabled} className="edit-input" />
            </Field>
            <Field label={label('Delivery minimum (SAR)', 'الحد الأدنى للتوصيل')}>
              <input type="number" value={minDeliveryOrder} onChange={(e) => setMinDeliveryOrder(num(e.target.value))} disabled={disabled} className="edit-input" />
            </Field>
          </div>

          {/* Branch location setter */}
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-black text-slate-700 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {label('Branch location', 'موقع الفرع')}</span>
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${locationSet ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                {locationSet ? label('Set', 'محدّد') : label('Not set', 'غير محدّد')}
              </span>
            </div>
            {!disabled && (
              <p className="text-[10px] text-slate-500 font-semibold">
                {label('Click the map to drop the branch pin, or type the coordinates.', 'اضغط على الخريطة لتحديد موقع الفرع، أو أدخل الإحداثيات يدوياً.')}
              </p>
            )}
            <Suspense fallback={<div className="h-40 rounded-lg bg-slate-50 animate-pulse" />}>
              <LocationPicker lat={lat} lng={lng} isRTL={isRTL} onChange={(la, lo) => { if (!disabled) { setLat(la); setLng(lo); } }} />
            </Suspense>
            <div className="grid grid-cols-2 gap-3">
              <Field label={label('Latitude', 'خط العرض')}>
                <input type="number" value={lat || ''} onChange={(e) => setLat(num(e.target.value))} disabled={disabled} className="edit-input" step="0.000001" />
              </Field>
              <Field label={label('Longitude', 'خط الطول')}>
                <input type="number" value={lng || ''} onChange={(e) => setLng(num(e.target.value))} disabled={disabled} className="edit-input" step="0.000001" />
              </Field>
            </div>
          </div>

          {/* Channel toggles */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100">
            <Toggle on={deliveryEnabled} disabled={disabled} onClick={() => setDeliveryEnabled(v => !v)} label={label('Delivery', 'التوصيل')} />
            <Toggle on={pickupEnabled} disabled={disabled} onClick={() => setPickupEnabled(v => !v)} label={label('Pickup', 'الاستلام')} />
            <Toggle on={isActive} disabled={disabled} onClick={() => setIsActive(v => !v)} label={label('Open', 'مفتوح')} />
          </div>

          {error && (
            <div className="p-2 bg-red-50 border border-red-100 rounded-lg text-red-700 text-[11px] font-bold flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-100 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-3 py-1.5 rounded-xl text-xs font-black text-slate-600 bg-slate-100 hover:bg-slate-200">
            {label('Cancel', 'إلغاء')}
          </button>
          {!disabled && (
            <button onClick={() => void handleSave()} disabled={busy} className="px-3 py-1.5 rounded-xl text-xs font-black text-white bg-primary hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5">
              <Save className="w-3.5 h-3.5" /> {busy ? label('Saving…', 'جارٍ الحفظ…') : label('Save', 'حفظ')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="block text-[9px] font-black text-slate-400 uppercase mb-1">{label}</span>
    {children}
  </label>
);

const Toggle: React.FC<{ on: boolean; disabled: boolean; onClick: () => void; label: string }> = ({ on, disabled, onClick, label }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`py-1.5 rounded-lg text-center text-[10px] font-black uppercase transition-all disabled:opacity-50 ${on ? 'bg-green-50 text-green-600 border border-green-200' : 'bg-slate-100 text-slate-400 border border-slate-200'}`}
  >
    {label} {on ? 'ON' : 'OFF'}
  </button>
);
