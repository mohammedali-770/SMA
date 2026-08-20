/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, RefreshCw, Trash2, UserPlus } from 'lucide-react';

import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { OpsAccount, OpsAccountRole, staffAccounts } from '../../lib/staffAccountsApi';
import { branchesWithoutOperator, MIN_OPS_PASSWORD, validateNewOpsAccount } from './staffAccounts';

const SELECT = [
  'min-h-10 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-2.5',
  'text-[14px] text-con-text focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

const INPUT = [
  'min-h-10 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3',
  'text-[14px] text-con-text focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

export interface BranchOption { id: string; nameEn: string; nameAr: string }

/**
 * Create and manage the branch / call-centre operator accounts.
 *
 * Kept separate from the role editor above it on purpose. Those are two
 * genuinely different jobs: that one changes a global role on an account that
 * already exists, this one provisions and revokes shop-floor logins. Merging
 * them would put "delete this person's account" one mis-click away from
 * "change this person's role".
 */
export const StaffAccountsSection: React.FC<{
  lang: 'en' | 'ar';
  branches: BranchOption[];
  onChanged?: () => void;
}> = ({ lang, branches, onChanged }) => {
  const isRTL = lang === 'ar';
  const [accounts, setAccounts] = useState<OpsAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<OpsAccountRole>('branch_staff');
  const [branchId, setBranchId] = useState('');
  const [reason, setReason] = useState('');

  const branchName = (id: string | null) => {
    if (!id) return null;
    const b = branches.find((x) => x.id === id);
    return b ? (isRTL ? b.nameAr : b.nameEn) : id;
  };

  const refresh = async () => {
    setLoading(true); setError(null);
    try {
      setAccounts(await staffAccounts.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const unstaffed = useMemo(
    () => branchesWithoutOperator(branches, accounts),
    [branches, accounts],
  );

  const create = async () => {
    setError(null); setSaved(null);
    const problem = validateNewOpsAccount({ email, password, role, branchId }, isRTL);
    if (problem) { setError(problem); return; }

    setBusy(true);
    try {
      await staffAccounts.create({
        email: email.trim().toLowerCase(),
        password,
        fullName: fullName.trim(),
        role,
        branchId: role === 'branch_staff' ? branchId : null,
        reason: reason.trim() || 'Operations console account provisioning',
      });
      setEmail(''); setPassword(''); setFullName(''); setBranchId(''); setReason('');
      setSaved(isRTL ? 'تم إنشاء الحساب.' : 'Account created.');
      await refresh();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (account: OpsAccount) => {
    const next = window.prompt(isRTL
      ? `كلمة مرور جديدة لـ ${account.email} (${MIN_OPS_PASSWORD} حرفاً على الأقل)`
      : `New password for ${account.email} (at least ${MIN_OPS_PASSWORD} characters)`);
    if (next === null) return;
    if (next.length < MIN_OPS_PASSWORD) {
      setError(isRTL
        ? `كلمة المرور يجب ألا تقل عن ${MIN_OPS_PASSWORD} حرفاً.`
        : `Password must be at least ${MIN_OPS_PASSWORD} characters.`);
      return;
    }
    setBusy(true); setError(null); setSaved(null);
    try {
      await staffAccounts.resetPassword(account.id, next);
      setSaved(isRTL ? 'تم تحديث كلمة المرور.' : 'Password updated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (account: OpsAccount) => {
    const ok = window.confirm(isRTL
      ? `حذف حساب ${account.email} نهائياً؟`
      : `Permanently delete the account ${account.email}?`);
    if (!ok) return;
    setBusy(true); setError(null); setSaved(null);
    try {
      await staffAccounts.remove(account.id);
      setSaved(isRTL ? 'تم حذف الحساب.' : 'Account deleted.');
      await refresh();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <UserPlus className="size-4 text-ember" aria-hidden="true" />
          <Text variant="heading" as="h4">
            {isRTL ? 'حسابات الفروع ومركز الاتصال' : 'Branch & Call-Centre Accounts'}
          </Text>
        </div>
        <Button
          label={isRTL ? 'تحديث' : 'Refresh'}
          onClick={() => void refresh()}
          disabled={loading || busy}
          variant="secondary"
          leading={<RefreshCw className="size-4" />}
        />
      </div>

      {error ? <Notice title={isRTL ? 'تعذر تنفيذ العملية' : 'Action could not be completed'} action={error} tone="blocking" /> : null}
      {saved ? <Notice title={isRTL ? 'تم' : 'Done'} action={saved} tone="success" /> : null}

      {unstaffed.length > 0 ? (
        <Notice
          tone="warning"
          title={isRTL ? 'فروع بدون حساب تشغيل' : 'Branches with no operator account'}
          action={unstaffed.map((b) => (isRTL ? b.nameAr : b.nameEn)).join(isRTL ? '، ' : ', ')}
        />
      ) : null}

      {/* ---- create ---- */}
      <div className="grid gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3 md:grid-cols-2">
        <input
          aria-label={isRTL ? 'البريد الإلكتروني' : 'Email'}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={isRTL ? 'البريد الإلكتروني' : 'Email'}
          className={INPUT}
          disabled={busy}
          autoComplete="off"
        />
        <input
          aria-label={isRTL ? 'كلمة المرور' : 'Password'}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={isRTL ? `كلمة المرور (${MIN_OPS_PASSWORD}+ حرفاً)` : `Password (${MIN_OPS_PASSWORD}+ characters)`}
          className={INPUT}
          disabled={busy}
          autoComplete="new-password"
        />
        <input
          aria-label={isRTL ? 'الاسم' : 'Full name'}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder={isRTL ? 'الاسم' : 'Full name'}
          className={INPUT}
          disabled={busy}
        />
        <select
          aria-label={isRTL ? 'نوع الحساب' : 'Account type'}
          value={role}
          onChange={(e) => setRole(e.target.value as OpsAccountRole)}
          className={SELECT}
          disabled={busy}
        >
          <option value="branch_staff">{isRTL ? 'موظف فرع' : 'Branch operator'}</option>
          <option value="call_center">{isRTL ? 'مركز الاتصال' : 'Call centre'}</option>
        </select>
        <select
          aria-label={isRTL ? 'الفرع' : 'Branch'}
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className={SELECT}
          disabled={busy || role !== 'branch_staff'}
        >
          <option value="">{isRTL ? 'اختر الفرع' : 'Select a branch'}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{isRTL ? b.nameAr : b.nameEn}</option>
          ))}
        </select>
        <input
          aria-label={isRTL ? 'سبب الإنشاء' : 'Reason'}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={isRTL ? 'سبب الإنشاء (يُسجَّل في التدقيق)' : 'Reason (recorded in the audit trail)'}
          className={INPUT}
          disabled={busy}
        />
        <div className="md:col-span-2">
          <Button
            label={busy ? (isRTL ? 'جارٍ الإنشاء…' : 'Creating…') : (isRTL ? 'إنشاء الحساب' : 'Create account')}
            onClick={() => void create()}
            disabled={busy}
            leading={<UserPlus className="size-4" />}
          />
        </div>
      </div>

      {/* ---- existing ---- */}
      {loading ? (
        <Text variant="body" tone="tertiary" as="p">{isRTL ? 'جارٍ التحميل…' : 'Loading…'}</Text>
      ) : accounts.length === 0 ? (
        <Text variant="body" tone="tertiary" as="p">
          {isRTL ? 'لا توجد حسابات فروع أو مركز اتصال بعد.' : 'No branch or call-centre accounts yet.'}
        </Text>
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <div
              key={a.id}
              className="grid gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3 md:grid-cols-[minmax(200px,2fr)_auto] md:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Text variant="label" as="span">{a.fullName || a.email || a.id}</Text>
                  <StatusPill
                    label={a.role === 'branch_staff' ? (isRTL ? 'فرع' : 'BRANCH') : (isRTL ? 'مركز اتصال' : 'CALL CENTRE')}
                    tone={a.role === 'branch_staff' ? 'info' : 'neutral'}
                  />
                  {a.role === 'branch_staff' ? (
                    <StatusPill
                      label={branchName(a.branchId) ?? (isRTL ? 'بدون فرع' : 'No branch')}
                      tone={a.branchId ? 'success' : 'warning'}
                    />
                  ) : null}
                </div>
                <Text variant="caption" tone="tertiary" as="p" className="mt-1 break-all">{a.email}</Text>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  label={isRTL ? 'كلمة المرور' : 'Password'}
                  onClick={() => void resetPassword(a)}
                  disabled={busy}
                  variant="secondary"
                  leading={<KeyRound className="size-4" />}
                />
                <Button
                  label={isRTL ? 'حذف' : 'Delete'}
                  onClick={() => void remove(a)}
                  disabled={busy}
                  variant="secondary"
                  leading={<Trash2 className="size-4" />}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
