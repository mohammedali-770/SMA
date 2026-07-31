import React, { Suspense, useState } from 'react';
import { MapPin } from 'lucide-react';

import { Button } from '../../design-system/ui/Button';
import { Field } from '../../design-system/ui/Field';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import type { Branch } from '../../types';
import { AdminModal } from './view/shared/AdminModal';
import { ToggleChip } from './view/shared/ToggleChip';

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
 *
 * Validation, the save payload and the read-only mode are carried over exactly.
 * Note that `disabled` hides the Save button entirely rather than greying it:
 * an accountant's write is refused by RLS, so a live-looking button would
 * advertise something they can never complete.
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
    <AdminModal
      title={`${disabled ? label('View branch', 'عرض الفرع') : label('Edit branch', 'تعديل الفرع')}: ${isRTL ? branch.nameAr : branch.nameEn}`}
      isRTL={isRTL}
      onClose={onClose}
      footer={
        <>
          <Button label={label('Cancel', 'إلغاء')} onClick={onClose} variant="ghost" />
          {!disabled && (
            <Button
              label={busy ? label('Saving…', 'جارٍ الحفظ…') : label('Save', 'حفظ')}
              onClick={() => { void handleSave(); }}
              disabled={busy}
              loading={busy}
            />
          )}
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={label('Name (English)', 'الاسم (إنجليزي)')} value={nameEn} onValueChange={setNameEn} disabled={disabled} required />
        <Field label={label('Name (Arabic)', 'الاسم (عربي)')} value={nameAr} onValueChange={setNameAr} disabled={disabled} required dir="rtl" />
        <Field label={label('Address (English)', 'العنوان (إنجليزي)')} value={addressEn} onValueChange={setAddressEn} disabled={disabled} />
        <Field label={label('Address (Arabic)', 'العنوان (عربي)')} value={addressAr} onValueChange={setAddressAr} disabled={disabled} dir="rtl" />
        <Field label={label('Phone', 'الهاتف')} value={phone} onValueChange={setPhone} disabled={disabled} numeric placeholder="+9665XXXXXXXX" />
        <Field label={label('Estimated delivery (min)', 'وقت التوصيل (دقيقة)')} type="number" value={etaMin} onValueChange={setEtaMin} disabled={disabled} numeric placeholder="—" />
        <Field label={label('Delivery fee (SAR)', 'رسوم التوصيل')} type="number" value={String(deliveryFee)} onValueChange={(v) => setDeliveryFee(num(v))} disabled={disabled} numeric />
        <Field label={label('Delivery minimum (SAR)', 'الحد الأدنى للتوصيل')} type="number" value={String(minDeliveryOrder)} onValueChange={(v) => setMinDeliveryOrder(num(v))} disabled={disabled} numeric />
      </div>

      {/* Branch location setter */}
      <div className="space-y-2 border-t border-con-line pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0 text-con-text-2" aria-hidden="true" />
            <Text variant="label" as="span">{label('Branch location', 'موقع الفرع')}</Text>
          </span>
          {/* Warning, not neutral, when unset: a branch with no pin cannot be
              distance-matched, so this is a real gap rather than a blank field. */}
          <StatusPill
            label={locationSet ? label('Set', 'محدّد') : label('Not set', 'غير محدّد')}
            tone={locationSet ? 'success' : 'warning'}
          />
        </div>
        {!disabled && (
          <Text variant="caption" tone="tertiary" as="p">
            {label('Click the map to drop the branch pin, or type the coordinates.', 'اضغط على الخريطة لتحديد موقع الفرع، أو أدخل الإحداثيات يدوياً.')}
          </Text>
        )}
        <Suspense fallback={<div className="h-40 rounded-[var(--radius-ds-md)] bg-con-surface-2" />}>
          <LocationPicker lat={lat} lng={lng} isRTL={isRTL} onChange={(la, lo) => { if (!disabled) { setLat(la); setLng(lo); } }} />
        </Suspense>
        <div className="grid grid-cols-2 gap-3">
          <Field label={label('Latitude', 'خط العرض')} type="number" step="0.000001" value={lat ? String(lat) : ''} onValueChange={(v) => setLat(num(v))} disabled={disabled} numeric />
          <Field label={label('Longitude', 'خط الطول')} type="number" step="0.000001" value={lng ? String(lng) : ''} onValueChange={(v) => setLng(num(v))} disabled={disabled} numeric />
        </div>
      </div>

      {/* Channel toggles */}
      <div className="grid grid-cols-3 gap-2 border-t border-con-line pt-3">
        <ToggleChip on={deliveryEnabled} disabled={disabled} onToggle={() => setDeliveryEnabled(v => !v)} label={label('Delivery', 'التوصيل')} />
        <ToggleChip on={pickupEnabled} disabled={disabled} onToggle={() => setPickupEnabled(v => !v)} label={label('Pickup', 'الاستلام')} />
        <ToggleChip on={isActive} disabled={disabled} onToggle={() => setIsActive(v => !v)} label={label('Open', 'مفتوح')} />
      </div>

      {error && <Notice title={error} tone="blocking" />}
    </AdminModal>
  );
};
