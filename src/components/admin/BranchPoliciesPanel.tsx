import React, { useState, Suspense } from 'react';
import { AlertTriangle, Map as MapIcon, Pencil, MapPin, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ADMIN_LOCALES } from './adminLocales';
import type { GeoJSONGeometry } from '../../lib/geo';
import type { Branch } from '../../types';
import { branchDeletionConfirmation } from './branchDeletion';

// Lazy so mapbox-gl loads only when an admin opens the zone editor.
const DeliveryZoneModal = React.lazy(() => import('./DeliveryZoneModal').then(m => ({ default: m.DeliveryZoneModal })));
const BranchEditModal = React.lazy(() => import('./BranchEditModal').then(m => ({ default: m.BranchEditModal })));

export const BranchPoliciesPanel: React.FC = () => {
  const {
    branches, products, updateBranchSettings, deleteBranch, isProductAvailableInBranch, toggleProductAvailability,
    currentUser, adminLang, deliveryZones, saveBranchDeliveryZone, clearBranchDeliveryZone,
  } = useApp();
  const isAccountant = currentUser.role === 'accountant';
  const t = ADMIN_LOCALES[adminLang];
  const isRTL = adminLang === 'ar';
  const [zoneBranchId, setZoneBranchId] = useState<string | null>(null);
  const [editBranchId, setEditBranchId] = useState<string | null>(null);
  const [deletingBranchId, setDeletingBranchId] = useState<string | null>(null);

  const zoneForBranch = (branchId: string) => deliveryZones.find(z => z.branchId === branchId && z.isActive);
  const zoneBranch = branches.find(b => b.id === zoneBranchId) ?? null;
  const editBranch = branches.find(b => b.id === editBranchId) ?? null;

  const handleSaveZone = async (branchId: string, geojson: GeoJSONGeometry) => {
    await saveBranchDeliveryZone(branchId, geojson);
  };
  const handleSaveBranch = async (patch: Partial<Branch>) => {
    if (editBranchId) await updateBranchSettings(editBranchId, patch);
  };

  const handleDeleteBranch = async (branch: Branch) => {
    if (isAccountant || deletingBranchId) return;
    if (!window.confirm(branchDeletionConfirmation(branch, isRTL))) return;

    setDeletingBranchId(branch.id);
    try {
      await deleteBranch(branch.id);
      if (editBranchId === branch.id) setEditBranchId(null);
      if (zoneBranchId === branch.id) setZoneBranchId(null);
    } catch {
      // AppContext surfaces the server/RLS error in the dashboard write banner.
    } finally {
      setDeletingBranchId(null);
    }
  };

  return (
            <div className="space-y-4 animate-fade-in">
              <h3 className="text-xs font-black text-gray-800 uppercase tracking-widest">{t.branch_tab}</h3>

              {/* Grid layout of Branches */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {branches.map(branch => {
                  const deliveryEnabled = branch.deliveryEnabled ?? true;
                  const pickupEnabled = branch.pickupEnabled ?? true;
                  const deliveryClosed = branch.deliveryTemporarilyClosed ?? false;
                  const hasCoords = Number.isFinite(branch.latitude) && Number.isFinite(branch.longitude)
                    && !(branch.latitude === 0 && branch.longitude === 0);
                  const hasZone = Boolean(zoneForBranch(branch.id));
                  return (
                  <div key={branch.id} className="glass-card p-3.5 rounded-2xl space-y-3">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <h4 className="text-xs font-black text-gray-900 truncate">{branch.nameEn}</h4>
                        <p className="text-[11px] font-bold text-gray-500 leading-tight truncate" dir="rtl">{branch.nameAr}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5 leading-tight truncate">{isRTL ? branch.addressAr : branch.addressEn}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full ${branch.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {branch.isActive ? 'OPEN' : 'CLOSED'}
                        </span>
                        <button
                          onClick={() => setEditBranchId(branch.id)}
                          className="flex items-center gap-1 text-[9px] font-black uppercase text-primary bg-primary/10 border border-primary/20 hover:bg-primary hover:text-white rounded-lg px-2 py-0.5 transition-all"
                        >
                          <Pencil className="w-2.5 h-2.5" />
                          {isAccountant ? (isRTL ? 'عرض' : 'View') : (isRTL ? 'تعديل' : 'Edit')}
                        </button>
                        {!isAccountant && (
                          <button
                            type="button"
                            onClick={() => { void handleDeleteBranch(branch); }}
                            disabled={deletingBranchId !== null}
                            aria-label={isRTL ? `حذف فرع ${branch.nameAr}` : `Delete branch ${branch.nameEn}`}
                            className="flex items-center gap-1 text-[9px] font-black uppercase text-red-600 bg-red-50 border border-red-200 hover:bg-red-600 hover:text-white rounded-lg px-2 py-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                            {deletingBranchId === branch.id
                              ? (isRTL ? 'جاري الحذف…' : 'Deleting…')
                              : (isRTL ? 'حذف' : 'Delete')}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Config status badges */}
                    <div className="flex flex-wrap gap-1">
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${hasCoords ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {isRTL ? 'الموقع' : 'Location'}: {hasCoords ? (isRTL ? 'محدّد' : 'Set') : (isRTL ? 'غير محدّد' : 'Not set')}
                      </span>
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${pickupEnabled ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                        {isRTL ? 'الاستلام' : 'Pickup'}: {pickupEnabled ? 'ON' : 'OFF'}
                      </span>
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${deliveryEnabled && !deliveryClosed ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                        {isRTL ? 'التوصيل' : 'Delivery'}: {deliveryClosed ? (isRTL ? 'موقوف' : 'PAUSED') : (deliveryEnabled ? 'ON' : 'OFF')}
                      </span>
                      <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${branch.lazywaitBranchId ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                        POS: {branch.lazywaitBranchId ? (isRTL ? 'مربوط' : 'Mapped') : (isRTL ? 'غير مربوط' : 'Unmapped')}
                      </span>
                    </div>

                    {/* Operational parameters toggles */}
                    <div className="pt-2 border-t border-slate-200/50 text-[10px] text-gray-600 space-y-2">
                      <div className="flex justify-between items-center">
                        <span>{t.delivery_fee}:</span>
                        <input
                          type="number"
                          disabled={isAccountant}
                          value={branch.deliveryFee}
                          onChange={(e) => updateBranchSettings(branch.id, { deliveryFee: parseFloat(e.target.value) || 0 })}
                          className="w-14 text-right bg-white/40 border border-slate-200 rounded px-1.5 py-0.5 text-xs font-bold disabled:opacity-50"
                        />
                      </div>

                      <div className="flex justify-between items-center">
                        <span>{isRTL ? 'الحد الأدنى للتوصيل' : 'Delivery minimum order'}:</span>
                        <input
                          type="number"
                          disabled={isAccountant}
                          value={branch.minDeliveryOrder}
                          onChange={(e) => updateBranchSettings(branch.id, { minDeliveryOrder: parseFloat(e.target.value) || 0 })}
                          className="w-14 text-right bg-white/40 border border-slate-200 rounded px-1.5 py-0.5 text-xs font-bold disabled:opacity-50"
                        />
                      </div>

                      <div className="flex justify-between items-center">
                        <span>{isRTL ? 'وقت التوصيل التقريبي (دقيقة)' : 'Estimated delivery time (min)'}:</span>
                        <input
                          type="number"
                          disabled={isAccountant}
                          value={branch.estimatedDeliveryMinutes ?? ''}
                          placeholder="—"
                          onChange={(e) => updateBranchSettings(branch.id, { estimatedDeliveryMinutes: e.target.value === '' ? undefined : (parseInt(e.target.value) || 0) })}
                          className="w-14 text-right bg-white/40 border border-slate-200 rounded px-1.5 py-0.5 text-xs font-bold disabled:opacity-50"
                        />
                      </div>

                      {/* Channel enablement toggles */}
                      <div className="grid grid-cols-2 gap-1.5 pt-1">
                        <button
                          onClick={() => updateBranchSettings(branch.id, { deliveryEnabled: !deliveryEnabled })}
                          disabled={isAccountant}
                          className={`py-1 rounded text-center text-[8.5px] font-black uppercase transition-all disabled:opacity-50 ${deliveryEnabled ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-400'}`}
                        >
                          {isRTL ? 'التوصيل' : 'Delivery'} {deliveryEnabled ? (isRTL ? 'مفعّل' : 'ON') : (isRTL ? 'معطّل' : 'OFF')}
                        </button>
                        <button
                          onClick={() => updateBranchSettings(branch.id, { pickupEnabled: !pickupEnabled })}
                          disabled={isAccountant}
                          className={`py-1 rounded text-center text-[8.5px] font-black uppercase transition-all disabled:opacity-50 ${pickupEnabled ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-400'}`}
                        >
                          {isRTL ? 'الاستلام' : 'Pickup'} {pickupEnabled ? (isRTL ? 'مفعّل' : 'ON') : (isRTL ? 'معطّل' : 'OFF')}
                        </button>
                      </div>

                      <button
                        onClick={() => updateBranchSettings(branch.id, { deliveryTemporarilyClosed: !deliveryClosed })}
                        disabled={isAccountant}
                        className={`w-full py-1 rounded text-center text-[8.5px] font-black uppercase transition-all disabled:opacity-50 ${deliveryClosed ? 'bg-amber-50 text-amber-700' : 'bg-white/40 text-slate-500'}`}
                      >
                        {deliveryClosed ? (isRTL ? 'التوصيل موقوف مؤقتاً' : 'Delivery temporarily closed') : (isRTL ? 'إيقاف التوصيل مؤقتاً' : 'Pause delivery temporarily')}
                      </button>

                      {/* Delivery zone controls */}
                      <div className="pt-2 border-t border-slate-200/50 space-y-1.5">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-slate-500">{isRTL ? 'منطقة التوصيل' : 'Delivery area'}:</span>
                          <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-full ${hasZone ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                            {hasZone ? (isRTL ? 'مُعدّة' : 'Configured') : (isRTL ? 'منطقة التوصيل غير مُعدّة' : 'Delivery area not configured')}
                          </span>
                        </div>
                        {hasCoords ? (
                          <button
                            onClick={() => setZoneBranchId(branch.id)}
                            className="w-full py-1.5 rounded-lg text-center text-[9px] font-black uppercase bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-white transition-all flex items-center justify-center gap-1"
                          >
                            <MapIcon className="w-3 h-3" />
                            {hasZone
                              ? (isAccountant ? (isRTL ? 'عرض منطقة التوصيل' : 'View delivery area') : (isRTL ? 'تعديل منطقة التوصيل' : 'Edit delivery area'))
                              : (isRTL ? 'رسم منطقة التوصيل' : 'Draw delivery area')}
                          </button>
                        ) : (
                          <div className="p-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-[8.5px] font-bold space-y-1.5">
                            <div className="flex items-start gap-1">
                              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                              {isRTL ? 'حدّد موقع الفرع قبل رسم منطقة التوصيل.' : 'Set branch location before drawing delivery area.'}
                            </div>
                            {!isAccountant && (
                              <button
                                onClick={() => setEditBranchId(branch.id)}
                                className="w-full py-1.5 rounded-lg text-center text-[9px] font-black uppercase bg-amber-500 text-white hover:bg-amber-600 transition-all flex items-center justify-center gap-1"
                              >
                                <MapPin className="w-3 h-3" />
                                {isRTL ? 'تحديد موقع الفرع' : 'Set branch location'}
                              </button>
                            )}
                          </div>
                        )}

                        {deliveryEnabled && !hasZone && hasCoords && (
                          <div className="p-1.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-[8.5px] font-bold flex items-start gap-1">
                            <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                            {isRTL ? 'التوصيل مفعّل ولكن لا توجد منطقة توصيل مُعدّة.' : 'Delivery is enabled but no delivery zone is configured.'}
                          </div>
                        )}
                      </div>

                      {/* Manual open close switch toggle */}
                      <button
                        onClick={() => updateBranchSettings(branch.id, { isActive: !branch.isActive })}
                        disabled={isAccountant}
                        className={`w-full py-1.5 rounded text-center text-[9px] font-black uppercase transition-all disabled:opacity-50 ${branch.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
                      >
                        {branch.isActive ? 'Close Branch Maintenance' : 'Open Branch Operational'}
                      </button>
                    </div>

                    {/* Custom Product Availability Sub Matrix */}
                    <div className="pt-2 border-t border-slate-200/50 space-y-1.5">
                      <span className="block text-[9px] text-gray-400 font-bold uppercase mb-1">{isRTL ? 'توفر الوجبات الفوري بالفرع:' : 'Branch Product Stock Availability:'}</span>
                      <div className="space-y-1 max-h-[140px] overflow-y-auto">
                        {products.map(p => {
                          const isAvailable = isProductAvailableInBranch(p.id, branch.id);
                          return (
                            <div key={p.id} className="flex justify-between items-center p-1.5 bg-white/30 rounded-lg text-[9.5px]">
                              <span className="font-semibold text-gray-700 truncate max-w-[130px]">{isRTL ? p.nameAr : p.nameEn}</span>
                              <button
                                onClick={() => toggleProductAvailability(p.id, branch.id)}
                                disabled={isAccountant || !branch.isActive}
                                className={`text-[8px] font-black px-2 py-0.5 rounded uppercase disabled:opacity-50 ${isAvailable ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                              >
                                {isAvailable ? 'Available' : 'Sold Out'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                  </div>
                  );
                })}
              </div>

              {zoneBranch && (
                <Suspense fallback={null}>
                  <DeliveryZoneModal
                    branch={zoneBranch}
                    existingZone={zoneForBranch(zoneBranch.id)}
                    disabled={isAccountant}
                    isRTL={isRTL}
                    onClose={() => setZoneBranchId(null)}
                    onSave={handleSaveZone}
                    onClear={clearBranchDeliveryZone}
                  />
                </Suspense>
              )}

              {editBranch && (
                <Suspense fallback={null}>
                  <BranchEditModal
                    branch={editBranch}
                    disabled={isAccountant}
                    isRTL={isRTL}
                    onClose={() => setEditBranchId(null)}
                    onSave={handleSaveBranch}
                  />
                </Suspense>
              )}
            </div>
  );
};
