import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Branch } from '../../types';
import { BRANCH_CASCADE_TABLES } from '../../lib/branchDeletion';
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
  it('names the branch, warns it is irreversible, and lists what goes with it (English)', () => {
    const msg = branchDeletionConfirmation(branch, false);
    expect(msg).toContain('Permanently delete the branch “Test Branch”?');
    expect(msg).toContain('cannot be undone');
    // Everything the cascade removes must be named, not just the first two
    // tables the prompt was written for (audit F-WAD-01-005).
    for (const part of [
      'working hours', 'delivery zone', 'delivery areas', 'availability', 'staff assignments',
      'discount campaigns', 'points campaigns', 'delivery requests', 'reference sheet', 'credentials',
    ]) expect(msg).toContain(part);
    // The audit rows and the orphaned secrets are the parts nobody expects.
    expect(msg).toContain('delivery pause events');
    expect(msg).toContain('availability closure events');
    expect(msg).toContain('who revealed a stored credential');
    expect(msg).toMatch(/vault.*NOT deleted/);
    // Steers order-owning branches to deactivation, by the button's real name.
    expect(msg).toContain('deactivate');
    expect(msg).toContain('“Close Branch Maintenance”');
    expect(msg).not.toContain('“Close Branch”');
    expect(msg).toContain('Type the branch name to confirm.');
  });

  it('names the branch, warns it is irreversible, and lists what goes with it (Arabic)', () => {
    const msg = branchDeletionConfirmation(branch, true);
    expect(msg).toContain('حذف فرع «فرع الاختبار» نهائياً؟');
    expect(msg).toContain('لا يمكن التراجع عن ذلك');
    expect(msg).toContain('ساعات العمل');
    expect(msg).toContain('مناطق التوصيل');
    expect(msg).toContain('تعيينات الموظفين');
    expect(msg).toContain('سجل من كشف بيانات دخول محفوظة');
    expect(msg).toContain('لا تُحذف مع الفرع');
    expect(msg).toContain('«إغلاق الفرع للصيانة»');
    expect(msg).toContain('اكتب اسم الفرع للتأكيد.');
  });

  it('no longer claims the delete touches only two kinds of row', () => {
    expect(branchDeletionConfirmation(branch, false)).not.toMatch(/also deletes its delivery area and all product-availability settings/);
  });
});

describe('BRANCH_CASCADE_TABLES', () => {
  // The prompt describes the cascade; this is what keeps the description
  // from going stale the next time a table is hung off `branches`.
  const dir = join(process.cwd(), 'supabase', 'migrations');
  const found = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    let table: string | null = null;
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      const create = /create table (?:if not exists )?public\.(\w+)/i.exec(line);
      if (create) table = create[1];
      if (table && /references public\.branches\(id\)\s+on delete cascade/i.test(line)) found.add(table);
    }
  }

  it('is exactly the set of tables whose foreign key to branches cascades', () => {
    expect([...found].sort()).toEqual([...BRANCH_CASCADE_TABLES].sort());
    expect(BRANCH_CASCADE_TABLES).toHaveLength(14);
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
