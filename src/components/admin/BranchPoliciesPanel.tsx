import React, { Suspense, useState } from 'react';

import { useApp } from '../../context/AppContext';
import { Text } from '../../design-system/ui/Text';
import type { GeoJSONGeometry } from '../../lib/geo';
import type { Branch } from '../../types';
import { ADMIN_LOCALES } from './adminLocales';
import { branchDeletionConfirmation, branchDeletionConfirmed } from './branchDeletion';
import { BranchCard } from './view/branches/BranchCard';

// Lazy so mapbox-gl loads only when an admin opens the zone editor.
const DeliveryZoneModal = React.lazy(() => import('./DeliveryZoneModal').then(m => ({ default: m.DeliveryZoneModal })));
const BranchEditModal = React.lazy(() => import('./BranchEditModal').then(m => ({ default: m.BranchEditModal })));

/**
 * Branch policies — the board an operator uses to react to the day.
 *
 * Every numeric field and toggle writes THROUGH `updateBranchSettings` on
 * change; there is no Save button on a card and never was. Deliberate: the fee
 * you typed is the fee that applies, which is what a manager wants at 8pm on a
 * Friday.
 *
 * This file owns THE WRITES, THE PERMISSION GATE AND THE DELETE CONFIRMATION.
 * Presentation is in `./view/branches/BranchCard.tsx`.
 */
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
    // Type-to-confirm: the admin must type the branch name (either language) for
    // this irreversible, cascade-removing delete. Cancelled/empty/mismatched
    // input aborts. The friendly FK guard (orders/sessions) lives server-side in
    // api.deleteBranch + AppContext.
    const typed = window.prompt(branchDeletionConfirmation(branch, isRTL));
    if (!branchDeletionConfirmed(branch, typed)) return;

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
    <div className="space-y-4">
      <Text variant="heading" as="h3">{t.branch_tab}</Text>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {branches.map((branch) => (
          <BranchCard
            key={branch.id}
            branch={branch}
            products={products}
            adminLang={adminLang}
            isAccountant={isAccountant}
            deleting={deletingBranchId === branch.id}
            hasZone={Boolean(zoneForBranch(branch.id))}
            isProductAvailableInBranch={isProductAvailableInBranch}
            onUpdate={(patch) => updateBranchSettings(branch.id, patch)}
            onToggleProduct={(productId) => toggleProductAvailability(productId, branch.id)}
            onEdit={() => setEditBranchId(branch.id)}
            onOpenZone={() => setZoneBranchId(branch.id)}
            onDelete={() => { void handleDeleteBranch(branch); }}
          />
        ))}
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
