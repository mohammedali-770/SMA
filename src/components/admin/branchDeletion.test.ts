import { describe, expect, it } from 'vitest';
import type { Branch } from '../../types';
import { branchDeletionConfirmation } from './branchDeletion';

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
  it('names the branch and warns that English deletion is irreversible', () => {
    expect(branchDeletionConfirmation(branch, false)).toBe(
      'Permanently delete “Test Branch”? This action cannot be undone.',
    );
  });

  it('names the branch and warns that Arabic deletion is irreversible', () => {
    expect(branchDeletionConfirmation(branch, true)).toBe(
      'هل أنت متأكد من حذف فرع «فرع الاختبار» نهائياً؟ لا يمكن التراجع عن هذا الإجراء.',
    );
  });
});
