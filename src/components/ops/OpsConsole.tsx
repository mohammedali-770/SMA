/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Store, Headset, ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { opsApi } from '../../lib/opsApi';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';

/**
 * Landing surface for the branch-operations roles.
 *
 * PHASE 1 SCOPE. The snooze controls, delivery pause and call-centre board are
 * later phases. What ships here is the scoping proof: the operator sees who
 * they are signed in as and which branch the server has pinned them to, read
 * through the same RLS policy the later write paths will authorize against. If
 * this screen shows the right branch, branch scoping works end to end; if it
 * shows nothing, the account has no assignment and no later phase would have
 * worked either.
 *
 * Deliberately NOT wrapped in StaffMfaGate — these accounts sign in with email
 * and password from shared shop-floor hardware (owner decision 2026-08-20).
 */
export const OpsConsole: React.FC = () => {
  const { currentUser, branches } = useApp();
  const [branchId, setBranchId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const isCallCenter = currentUser.role === 'call_center';

  React.useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const id = await opsApi.myBranchId();
        if (!disposed) setBranchId(id);
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => { disposed = true; };
  }, []);

  const branch = branches.find(b => b.id === branchId) ?? null;

  return (
    <main className="flex-grow p-4 md:p-6 max-w-3xl mx-auto w-full space-y-4" dir="rtl">
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          {isCallCenter
            ? <Headset className="w-6 h-6 text-ember" aria-hidden />
            : <Store className="w-6 h-6 text-ember" aria-hidden />}
          <div className="min-w-0">
            <h1 className="text-lg font-black text-con-text leading-tight">
              {isCallCenter ? 'لوحة مركز الاتصال' : 'لوحة الفرع'}
            </h1>
            <p className="text-xs font-bold text-con-text-2 truncate">
              {currentUser.fullName || currentUser.email}
            </p>
          </div>
        </div>

        {isCallCenter ? (
          <Notice tone="info" title="صلاحية على كل الفروع">
            حسابك يتابع إغلاقات جميع الفروع. أدوات المتابعة والتحكم في التوصيل ستظهر هنا.
          </Notice>
        ) : loading ? (
          <p className="text-sm font-bold text-con-text-2">جارٍ تحميل بيانات الفرع…</p>
        ) : error ? (
          <Notice tone="blocking" title="تعذّر تحميل الفرع">{error}</Notice>
        ) : branch ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-con-line p-3">
            <div className="min-w-0">
              <p className="text-sm font-black text-con-text truncate">{branch.nameAr}</p>
              <p className="text-xs font-bold text-con-text-2 truncate">{branch.nameEn}</p>
            </div>
            <StatusPill
              tone={branch.isActive ? 'success' : 'warning'}
              label={branch.isActive ? 'مفتوح' : 'مغلق'}
            />
          </div>
        ) : (
          <Notice tone="warning" title="لم يتم ربط حسابك بفرع">
            تواصل مع المسؤول لربط حسابك بالفرع الذي تعمل فيه.
          </Notice>
        )}

        <div className="flex items-start gap-2 rounded-xl bg-con-surface/50 p-3">
          <ShieldCheck className="w-4 h-4 text-con-text-3 mt-0.5 shrink-0" aria-hidden />
          <p className="text-xs font-bold text-con-text-2 leading-relaxed">
            أدوات إيقاف الأصناف مؤقتاً والتحكم في التوصيل قيد الإضافة.
          </p>
        </div>
      </Card>
    </main>
  );
};
