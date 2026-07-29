import { describe, expect, it } from 'vitest';
import type { Branch } from '../../types';
import { branchDeletionConfirmation, branchDeletionConfirmed } from './branchDeletion';

const branch: Branch = {
  id: 'branch-1',
  nameAr: 'فرع الاختبار',
  nameEn: 'Test Branch',
  addressAr: '',
  addressEn: '',
  phone: '',
  latitude: 0,
  longitude: 0,
  isActive: false,
  deliveryFee: 0,
  minDeliveryOrder: 0,
};

describe('branchDeletionConfirmation', () => {
  it('names the branch, warns it is irreversible, and spells out the cascade (English)', () => {
    const msg = branchDeletionConfirmation(branch, false);
    expect(msg).toContain('Permanently delete the branch “Test Branch”?');
    expect(msg).toContain('cannot be undone');
    // Silent-cascade awareness: the prompt must name what else gets removed.
    expect(msg).toContain('delivery area');
    expect(msg).toContain('product-availability');
    // Steers order-owning branches to deactivation instead of deletion.
    expect(msg).toContain('deactivate');
    expect(msg).toContain('Close Branch');
    // Type-to-confirm hardening.
    expect(msg).toContain('Type the branch name to confirm.');
  });

  it('names the branch, warns it is irreversible, and spells out the cascade (Arabic)', () => {
    const msg = branchDeletionConfirmation(branch, true);
    expect(msg).toContain('حذف فرع «فرع الاختبار» نهائياً؟');
    expect(msg).toContain('لا يمكن التراجع عنه');
    expect(msg).toContain('منطقة التوصيل');
    expect(msg).toContain('توفر المنتجات');
    expect(msg).toContain('إغلاق الفرع');
    expect(msg).toContain('اكتب اسم الفرع للتأكيد.');
  });
});

describe('branchDeletionConfirmed', () => {
  it('accepts the exact English name (whitespace / case tolerant)', () => {
    expect(branchDeletionConfirmed(branch, 'Test Branch')).toBe(true);
    expect(branchDeletionConfirmed(branch, '  test branch  ')).toBe(true);
  });

  it('accepts the exact Arabic name', () => {
    expect(branchDeletionConfirmed(branch, 'فرع الاختبار')).toBe(true);
  });

  it('rejects a cancelled prompt (null), empty input, and a mismatched name', () => {
    expect(branchDeletionConfirmed(branch, null)).toBe(false);
    expect(branchDeletionConfirmed(branch, '')).toBe(false);
    expect(branchDeletionConfirmed(branch, '   ')).toBe(false);
    expect(branchDeletionConfirmed(branch, 'Other Branch')).toBe(false);
  });
});
