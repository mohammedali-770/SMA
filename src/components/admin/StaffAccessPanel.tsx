import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, ShieldCheck, UserCog } from 'lucide-react';

import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { RoleAuditEntry, StaffAccount, StaffRole, staffAccess } from '../../lib/staffAccessApi';

const SELECT = [
  'min-h-10 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-2.5',
  'text-[14px] text-con-text focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

const INPUT = [
  'min-h-10 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3',
  'text-[14px] text-con-text focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

const roleTone = (role: StaffRole) => role === 'admin' ? 'danger' : role === 'accountant' ? 'info' : 'neutral';

function displayName(user: StaffAccount) {
  return user.full_name?.trim() || user.email?.trim() || user.phone_number?.trim() || user.id;
}

export const StaffAccessPanel: React.FC<{ lang: 'en' | 'ar'; currentUserId: string }> = ({ lang, currentUserId }) => {
  const isRTL = lang === 'ar';
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [audit, setAudit] = useState<RoleAuditEntry[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StaffAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, StaffRole>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const refresh = async () => {
    setLoading(true); setError(null);
    try {
      const [staffRows, auditRows] = await Promise.all([staffAccess.listStaff(), staffAccess.listAudit(50)]);
      setStaff(staffRows);
      setAudit(auditRows);
      setRoles((prev) => {
        const next = { ...prev };
        for (const row of [...staffRows, ...results]) if (!next[row.id]) next[row.id] = row.role;
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doSearch = async () => {
    const q = query.trim();
    setSaved(null); setError(null);
    if (q.length < 2) {
      setError(isRTL ? 'اكتب حرفين على الأقل للبحث.' : 'Enter at least 2 characters to search.');
      return;
    }
    setSearching(true);
    try {
      const rows = await staffAccess.searchCandidates(q, 20);
      setResults(rows);
      setRoles((prev) => {
        const next = { ...prev };
        for (const row of rows) if (!next[row.id]) next[row.id] = row.role;
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  const applyRole = async (user: StaffAccount) => {
    const role = roles[user.id] ?? user.role;
    const reason = (reasons[user.id] ?? '').trim();
    setSaved(null); setError(null);
    if (user.id === currentUserId) {
      setError(isRTL ? 'لا يمكن تغيير صلاحية حسابك من هذه الشاشة.' : 'You cannot change your own role from this screen.');
      return;
    }
    if (role === user.role) {
      setError(isRTL ? 'اختر صلاحية مختلفة أولاً.' : 'Choose a different role first.');
      return;
    }
    if (reason.length < 3) {
      setError(isRTL ? 'سبب التغيير مطلوب (3 أحرف على الأقل).' : 'A reason is required (at least 3 characters).');
      return;
    }
    const ok = window.confirm(isRTL
      ? `تغيير صلاحية ${displayName(user)} من ${user.role} إلى ${role}؟`
      : `Change ${displayName(user)} from ${user.role} to ${role}?`);
    if (!ok) return;

    setBusyId(user.id);
    try {
      await staffAccess.setRole(user.id, role, reason);
      setReasons((prev) => ({ ...prev, [user.id]: '' }));
      setSaved(isRTL ? 'تم حفظ تغيير الصلاحية وتسجيله في سجل التدقيق.' : 'Role change saved and written to the audit trail.');
      const q = query.trim();
      if (q.length >= 2) setResults(await staffAccess.searchCandidates(q, 20));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const resultIds = useMemo(() => new Set(results.map((r) => r.id)), [results]);
  const currentStaff = staff.filter((s) => !resultIds.has(s.id));
  const roleEditor = (user: StaffAccount) => (
    <div key={user.id} className="grid gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3 md:grid-cols-[minmax(180px,1.5fr)_120px_minmax(180px,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Text variant="label" as="span">{displayName(user)}</Text>
          <StatusPill label={user.role.toUpperCase()} tone={roleTone(user.role)} />
          {user.id === currentUserId ? <StatusPill label={isRTL ? 'حسابك' : 'You'} tone="success" /> : null}
        </div>
        <Text variant="caption" tone="tertiary" as="p" className="mt-1 break-all">
          {user.email || user.phone_number || user.id}
        </Text>
      </div>
      <select
        aria-label={`${displayName(user)} role`}
        value={roles[user.id] ?? user.role}
        onChange={(e) => setRoles((p) => ({ ...p, [user.id]: e.target.value as StaffRole }))}
        className={SELECT}
        disabled={busyId === user.id || user.id === currentUserId}
      >
        <option value="customer">{isRTL ? 'عميل' : 'Customer'}</option>
        <option value="accountant">{isRTL ? 'محاسب' : 'Accountant'}</option>
        <option value="admin">{isRTL ? 'مشرف' : 'Admin'}</option>
      </select>
      <input
        aria-label={`${displayName(user)} reason`}
        value={reasons[user.id] ?? ''}
        onChange={(e) => setReasons((p) => ({ ...p, [user.id]: e.target.value }))}
        placeholder={isRTL ? 'سبب منح/إلغاء الصلاحية' : 'Reason for access change'}
        className={INPUT}
        disabled={busyId === user.id || user.id === currentUserId}
      />
      <Button
        label={busyId === user.id ? (isRTL ? 'جارٍ الحفظ…' : 'Saving…') : (isRTL ? 'تطبيق' : 'Apply')}
        onClick={() => void applyRole(user)}
        disabled={busyId !== null || user.id === currentUserId}
        variant="secondary"
      />
    </div>
  );

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-con-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <UserCog className="size-5 text-ember" aria-hidden="true" />
            <Text variant="title" as="h3">{isRTL ? 'صلاحيات الموظفين' : 'Staff Access'}</Text>
          </div>
          <Text variant="caption" tone="tertiary" as="p" className="mt-1">
            {isRTL ? 'منح وإلغاء صلاحيات عامة لحسابات موجودة فقط، مع سجل تدقيق إلزامي.' : 'Grant or revoke global roles for existing accounts only, with a mandatory audit trail.'}
          </Text>
        </div>
        <Button label={isRTL ? 'تحديث' : 'Refresh'} onClick={() => void refresh()} disabled={loading} variant="secondary" leading={<RefreshCw className="size-4" />} />
      </div>

      <Notice
        title={isRTL ? 'لا يوجد إنشاء حسابات إدارية من هذه الشاشة' : 'No admin account creation on this screen'}
        action={isRTL ? 'يجب أن يكون المستخدم مسجلاً بالفعل. الصلاحيات هنا عامة على النظام؛ صلاحيات الفروع المنفصلة ليست مفعلة بعد.' : 'The user must already have an account. Roles here are global; branch-scoped permissions are not enabled yet.'}
        tone="warning"
      />
      {error ? <Notice title={isRTL ? 'تعذر تنفيذ العملية' : 'Action could not be completed'} action={error} tone="blocking" /> : null}
      {saved ? <Notice title={isRTL ? 'تم الحفظ' : 'Saved'} action={saved} tone="success" /> : null}

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-ember" aria-hidden="true" />
          <Text variant="heading" as="h4">{isRTL ? 'الموظفون الحاليون' : 'Current Staff'}</Text>
        </div>
        {loading ? <Text variant="body" tone="tertiary" as="p">{isRTL ? 'جارٍ التحميل…' : 'Loading…'}</Text> : null}
        {!loading && staff.length === 0 ? <Text variant="body" tone="tertiary" as="p">{isRTL ? 'لا توجد حسابات موظفين.' : 'No staff accounts found.'}</Text> : null}
        <div className="space-y-2">{results.filter((r) => r.role !== 'customer').map(roleEditor)}{currentStaff.map(roleEditor)}</div>
      </Card>

      <Card className="space-y-3">
        <Text variant="heading" as="h4">{isRTL ? 'البحث عن حساب موجود' : 'Find an Existing Account'}</Text>
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            aria-label={isRTL ? 'البحث عن مستخدم' : 'Search users'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void doSearch(); }}
            placeholder={isRTL ? 'الاسم أو البريد أو رقم الجوال' : 'Name, email, or phone'}
            className={`${INPUT} flex-1`}
          />
          <Button label={searching ? (isRTL ? 'جارٍ البحث…' : 'Searching…') : (isRTL ? 'بحث' : 'Search')} onClick={() => void doSearch()} disabled={searching} leading={<Search className="size-4" />} />
        </div>
        <div className="space-y-2">
          {results.map(roleEditor)}
          {!searching && query.trim().length >= 2 && results.length === 0 ? (
            <Text variant="body" tone="tertiary" as="p">{isRTL ? 'لا توجد نتائج.' : 'No matching accounts.'}</Text>
          ) : null}
        </div>
      </Card>

      <Card flush className="overflow-hidden">
        <div className="border-b border-con-line p-3">
          <Text variant="heading" as="h4">{isRTL ? 'سجل تغييرات الصلاحيات' : 'Role Change Audit'}</Text>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-start">
            <thead><tr className="border-b border-con-line">
              {[isRTL ? 'المستخدم' : 'User', isRTL ? 'التغيير' : 'Change', isRTL ? 'السبب' : 'Reason', isRTL ? 'بواسطة' : 'Changed by', isRTL ? 'الوقت' : 'Time'].map((h) => <th key={h} className="px-3 py-2"><Text variant="caption" tone="tertiary" as="span">{h}</Text></th>)}
            </tr></thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-t border-con-line">
                  <td className="px-3 py-2"><Text variant="caption" as="span">{a.target_name || a.target_email || (isRTL ? 'حساب محذوف' : 'Deleted account')}</Text></td>
                  <td className="px-3 py-2"><Text variant="caption" numeric as="span">{a.old_role} → {a.new_role}</Text></td>
                  <td className="px-3 py-2"><Text variant="caption" as="span">{a.reason}</Text></td>
                  <td className="px-3 py-2"><Text variant="caption" as="span">{a.changed_by_name || a.changed_by_email || '—'}</Text></td>
                  <td className="px-3 py-2"><Text variant="caption" numeric as="span">{new Date(a.changed_at).toLocaleString(isRTL ? 'ar-SA' : 'en-GB')}</Text></td>
                </tr>
              ))}
              {audit.length === 0 ? <tr><td colSpan={5} className="p-6 text-center"><Text variant="body" tone="tertiary" as="span">{isRTL ? 'لا توجد تغييرات صلاحيات مسجلة.' : 'No role changes recorded.'}</Text></td></tr> : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
