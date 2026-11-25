import React, { Suspense, useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';

import { Button } from '../../design-system/ui/Button';
import { Field } from '../../design-system/ui/Field';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import type { Branch } from '../../types';
import { AdminModal } from './view/shared/AdminModal';
import { ToggleChip } from './view/shared/ToggleChip';
import { WorkingHoursEditor } from './view/branches/WorkingHoursEditor';
import { DeliveryAreasEditor } from './view/branches/DeliveryAreasEditor';
import { validateWeek, weekFrom } from './view/branches/workingHours';
import { WorkingHoursDay, branchConfig } from '../../lib/branchConfigApi';

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

/**
 * A typed number, or `null` when the box is blank or not a number. The fields
 * keep the TEXT as state and parse it only here, at save: a number round-tripped
 * through `parseFloat` on every keystroke rewrites `10.0` to `10` and loses the
 * zero the next digit needed (`10.05` became `105`), and turns a cleared field
 * into a real `0`.
 */
const parseTyped = (v: string): number | null => {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
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
  const [email, setEmail] = useState(branch.email ?? '');
  // Hours live in their own table, so they load here and save alongside the
  // branch patch — one Save button, not two.
  const [week, setWeek] = useState<WorkingHoursDay[]>(() => weekFrom([]));
  const [hoursLoaded, setHoursLoaded] = useState(false);
  // A read that failed, as opposed to one that has not finished. The editor
  // says so rather than showing seven closed days as if they were the truth.
  const [hoursError, setHoursError] = useState(false);
  // Typed text, not numbers: see `parseTyped`. An unset pin (0, 0) shows blank.
  const [latText, setLatText] = useState<string>(
    Number.isFinite(branch.latitude) && branch.latitude ? String(branch.latitude) : '');
  const [lngText, setLngText] = useState<string>(
    Number.isFinite(branch.longitude) && branch.longitude ? String(branch.longitude) : '');
  const [feeText, setFeeText] = useState<string>(String(branch.deliveryFee ?? 0));
  const [minText, setMinText] = useState<string>(String(branch.minDeliveryOrder ?? 0));
  const [etaMin, setEtaMin] = useState<string>(branch.estimatedDeliveryMinutes != null ? String(branch.estimatedDeliveryMinutes) : '');
  const [deliveryEnabled, setDeliveryEnabled] = useState<boolean>(branch.deliveryEnabled ?? true);
  const [pickupEnabled, setPickupEnabled] = useState<boolean>(branch.pickupEnabled ?? true);
  const [isActive, setIsActive] = useState<boolean>(branch.isActive ?? true);
  // What each field held when the modal opened. Save sends only the fields that
  // differ from this: the branch board writes toggles and fees at once, so a
  // modal left open across someone else's change must not write the old values
  // of fields it never touched back over it (F-WAD-01-002).
  const initial = useRef({
    nameEn, nameAr, addressEn, addressAr, phone, email, latText, lngText, feeText, minText, etaMin,
    deliveryEnabled, pickupEnabled, isActive,
  });

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Blank means "no pin" (stored as 0, 0, as before). Unparseable text is not
  // blank, so it fails validation instead of silently becoming "no pin".
  const lat = latText.trim() === '' ? 0 : parseTyped(latText);
  const lng = lngText.trim() === '' ? 0 : parseTyped(lngText);
  const locationSet = lat !== null && lng !== null && !(lat === 0 && lng === 0);

  const validate = (): string | null => {
    if (!nameEn.trim() || !nameAr.trim()) return isRTL ? 'الاسم بالعربية والإنجليزية مطلوب.' : 'English and Arabic names are required.';
    if (lat === null || lng === null) return isRTL ? 'إحداثيات الفرع يجب أن تكون أرقاماً.' : 'The branch coordinates must be numbers.';
    if ((latText.trim() === '') !== (lngText.trim() === '')) return isRTL ? 'أدخل خط العرض وخط الطول معاً، أو اتركهما فارغين.' : 'Enter both latitude and longitude, or leave both blank.';
    if (locationSet && (lat < -90 || lat > 90)) return isRTL ? 'خط العرض يجب أن يكون بين -90 و 90.' : 'Latitude must be between -90 and 90.';
    if (locationSet && (lng < -180 || lng > 180)) return isRTL ? 'خط الطول يجب أن يكون بين -180 و 180.' : 'Longitude must be between -180 and 180.';
    const fee = parseTyped(feeText);
    const min = parseTyped(minText);
    if (fee === null) return isRTL ? 'رسوم التوصيل يجب أن تكون رقماً.' : 'The delivery fee must be a number.';
    if (min === null) return isRTL ? 'الحد الأدنى للتوصيل يجب أن يكون رقماً.' : 'The delivery minimum must be a number.';
    if (fee < 0 || min < 0) return isRTL ? 'القيم لا يمكن أن تكون سالبة.' : 'Values cannot be negative.';
    return null;
  };

  /** Only the fields the administrator changed since the modal opened. */
  const changedPatch = (): Partial<Branch> => {
    const was = initial.current;
    const out: Partial<Branch> = {};
    if (nameEn !== was.nameEn) out.nameEn = nameEn.trim();
    if (nameAr !== was.nameAr) out.nameAr = nameAr.trim();
    if (addressEn !== was.addressEn) out.addressEn = addressEn.trim();
    if (addressAr !== was.addressAr) out.addressAr = addressAr.trim();
    if (phone !== was.phone) out.phone = phone.trim();
    if (email !== was.email) out.email = email.trim();
    // The pin is one fact: both coordinates travel together.
    if (latText !== was.latText || lngText !== was.lngText) {
      out.latitude = lat ?? 0;
      out.longitude = lng ?? 0;
    }
    if (feeText !== was.feeText) out.deliveryFee = parseTyped(feeText) ?? 0;
    if (minText !== was.minText) out.minDeliveryOrder = parseTyped(minText) ?? 0;
    if (etaMin !== was.etaMin && etaMin.trim() !== '') out.estimatedDeliveryMinutes = Math.max(0, parseInt(etaMin, 10) || 0);
    if (deliveryEnabled !== was.deliveryEnabled) out.deliveryEnabled = deliveryEnabled;
    if (pickupEnabled !== was.pickupEnabled) out.pickupEnabled = pickupEnabled;
    if (isActive !== was.isActive) out.isActive = isActive;
    return out;
  };

  const handleSave = async () => {
    setError(null);
    const v = validate() ?? validateWeek(week, isRTL);
    if (v) { setError(v); return; }
    setBusy(true);
    try {
      const patch = changedPatch();
      // Nothing changed on the branch row: an empty update is not a write worth
      // making (hours below are their own table).
      if (Object.keys(patch).length > 0) await onSave(patch);
      // Hours are a separate table with its own admin RPC. NOTE: this does not
      // wait for the branch write to land. `updateBranchSettings` is
      // fire-and-forget, so `onSave` resolves at once and a refused branch edit
      // still reaches here (audit F-WAD-01-001, open: it needs the context
      // function to return its promise).
      if (hoursLoaded) await branchConfig.saveWorkingHours(branch.id, week);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : (isRTL ? 'فشل الحفظ.' : 'Save failed.'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const stored = await branchConfig.workingHours(branch.id);
        // ONLY on success. `week` starts as seven closed days, and `hoursLoaded`
        // is what authorizes Save to write it — so marking a FAILED read as
        // loaded means an admin who came to fix a phone number silently
        // overwrites the branch's real trading hours as closed all week. A
        // failed read must leave hours untouched, not merely look empty.
        if (!disposed) { setWeek(weekFrom(stored)); setHoursLoaded(true); }
      } catch {
        // Hours are supplementary; a failure here must not block editing the
        // branch itself. The rows show every day closed until reload, and Save
        // leaves the stored schedule alone.
        if (!disposed) setHoursError(true);
      }
    })();
    return () => { disposed = true; };
  }, [branch.id]);

  const label = (en: string, ar: string) => (isRTL ? ar : en);

  return (
    <AdminModal
      title={`${disabled ? label('View branch', 'عرض الفرع') : label('Edit branch', 'تعديل الفرع')}: ${isRTL ? branch.nameAr : branch.nameEn}`}
      // Seven weekday rows and an area list do not fit the default max-w-lg.
      size="xl"
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
        <Field label={label('Contact email', 'البريد الإلكتروني')} type="email" value={email} onValueChange={setEmail} disabled={disabled} placeholder="branch@example.com" hint={label('Visible to customers, like the phone number.', 'ظاهر للعملاء، مثل رقم الهاتف.')} />
        <Field label={label('Estimated delivery (min)', 'وقت التوصيل (دقيقة)')} type="number" value={etaMin} onValueChange={setEtaMin} disabled={disabled} numeric placeholder="—" />
        <Field label={label('Delivery fee (SAR)', 'رسوم التوصيل')} type="number" value={feeText} onValueChange={setFeeText} disabled={disabled} numeric />
        <Field label={label('Delivery minimum (SAR)', 'الحد الأدنى للتوصيل')} type="number" value={minText} onValueChange={setMinText} disabled={disabled} numeric />
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
          <LocationPicker lat={lat ?? 0} lng={lng ?? 0} isRTL={isRTL} onChange={(la, lo) => { if (!disabled) { setLatText(String(la)); setLngText(String(lo)); } }} />
        </Suspense>
        <div className="grid grid-cols-2 gap-3">
          <Field label={label('Latitude', 'خط العرض')} type="number" step="0.000001" value={latText} onValueChange={setLatText} disabled={disabled} numeric />
          <Field label={label('Longitude', 'خط الطول')} type="number" step="0.000001" value={lngText} onValueChange={setLngText} disabled={disabled} numeric />
        </div>
      </div>

      {/* Channel toggles */}
      <div className="grid grid-cols-3 gap-2 border-t border-con-line pt-3">
        <ToggleChip on={deliveryEnabled} disabled={disabled} onToggle={() => setDeliveryEnabled(v => !v)} label={label('Delivery', 'التوصيل')} />
        <ToggleChip on={pickupEnabled} disabled={disabled} onToggle={() => setPickupEnabled(v => !v)} label={label('Pickup', 'الاستلام')} />
        <ToggleChip on={isActive} disabled={disabled} onToggle={() => setIsActive(v => !v)} label={label('Open', 'مفتوح')} />
      </div>

      {hoursError ? (
        <p className="text-xs font-bold text-danger-ink">
          {label(
            'Working hours could not be loaded. They are shown blank and will NOT be saved — reopen this branch to edit them.',
            'تعذّر تحميل ساعات العمل. تظهر فارغة ولن يتم حفظها — أعد فتح الفرع لتعديلها.',
          )}
        </p>
      ) : null}
      <WorkingHoursEditor
        week={week}
        disabled={disabled || hoursError}
        isRTL={isRTL}
        onChange={setWeek}
      />

      <DeliveryAreasEditor branchId={branch.id} disabled={disabled} isRTL={isRTL} />

      {error && <Notice title={error} tone="blocking" />}
    </AdminModal>
  );
};
