/**
 * Comped customers — the people who order at no charge.
 *
 * WHAT A COMP IS. Membership is AUTOMATIC (there is no code to type and none to
 * leak), it zeroes EVERYTHING including the delivery fee, and there is NO CAP.
 * `place_order` and `compute_order_snapshot` read `public.comp_members`
 * themselves; nothing the customer's app sends decides it.
 *
 * WHY THE SCREEN LOOKS CAUTIOUS. The absence of a cap is the risk in this
 * feature. One wrongly-added member is unlimited free food and no downstream
 * control stops it, so this panel makes every change TRACEABLE even though it
 * cannot make one BOUNDED: a mandatory reason, a permanent audit table, a
 * confirmation naming the person, and an is_admin() (role AND AAL2) gate on the
 * write. That is also why removal is one click with no reason-free path — the
 * fast action is the safe one.
 *
 * Mirrors StaffAccessPanel, which does the same job for roles.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Gift, RefreshCw, Search, UserMinus } from 'lucide-react';

import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import {
  compMembers, type CompAuditEntry, type CompCandidate, type CompMember,
} from '../../lib/compMembersApi';

const INPUT = [
  'min-h-10 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3',
  'text-[14px] text-con-text focus-visible:outline-2 focus-visible:outline-offset-2',
].join(' ');

function candidateName(c: CompCandidate): string {
  return c.full_name?.trim() || c.email?.trim() || c.phone_number?.trim() || c.id;
}

function memberName(m: CompMember): string {
  return m.full_name?.trim() || m.phone_number?.trim() || m.profile_id;
}

export const CompMembersPanel: React.FC<{ lang: 'en' | 'ar' }> = ({ lang }) => {
  const isRTL = lang === 'ar';
  const [members, setMembers] = useState<CompMember[]>([]);
  const [audit, setAudit] = useState<CompAuditEntry[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CompCandidate[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true); setError(null);
    try {
      const [rows, auditRows] = await Promise.all([compMembers.list(), compMembers.listAudit(50)]);
      setMembers(rows);
      setAudit(auditRows);
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
      setResults(await compMembers.search(q, 20));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  /** The ids already comped, so the search list can say so instead of offering
   *  an Add that the server would refuse as a no-op. */
  const activeIds = useMemo(
    () => new Set(members.filter((m) => m.is_active).map((m) => m.profile_id)),
    [members],
  );

  const apply = async (userId: string, name: string, active: boolean) => {
    const reason = (reasons[userId] ?? '').trim();
    setSaved(null); setError(null);
    if (reason.length < 3) {
      setError(isRTL
        ? 'السبب مطلوب (3 أحرف على الأقل) — هذا هو سجل سبب حصول الشخص على وجبات مجانية.'
        : 'A reason is required (at least 3 characters) — it is the record of why this person eats free.');
      return;
    }
    // Named, and explicit about what it means. "Are you sure?" would not tell
    // the operator that they are authorising unlimited free orders.
    const ok = window.confirm(active
      ? (isRTL
        ? `جعل ${name} عميل ضيافة؟ ستكون جميع طلباته مجانية بالكامل (شاملة رسوم التوصيل) وبدون حد أقصى، حتى يتم إيقافه.`
        : `Make ${name} a comped customer? Every order they place will be free in full — delivery fee included — with no cap, until you switch it off.`)
      : (isRTL
        ? `إيقاف الضيافة عن ${name}؟ سيدفع ثمن طلبه القادم بالكامل.`
        : `Stop comping ${name}? Their next order will be charged in full.`));
    if (!ok) return;

    setBusyId(userId);
    try {
      await compMembers.set(userId, active, reason);
      setReasons((prev) => ({ ...prev, [userId]: '' }));
      setSaved(active
        ? (isRTL ? 'تمت الإضافة وتسجيلها في سجل التدقيق.' : 'Added, and written to the audit trail.')
        : (isRTL ? 'تم الإيقاف وتسجيله في سجل التدقيق.' : 'Removed, and written to the audit trail.'));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const reasonField = (id: string, placeholder: string) => (
    <input
      aria-label={`${id} reason`}
      value={reasons[id] ?? ''}
      onChange={(e) => setReasons((p) => ({ ...p, [id]: e.target.value }))}
      placeholder={placeholder}
      className={INPUT}
      disabled={busyId === id}
    />
  );

  return (
    <div className="space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-con-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Gift className="size-5 text-ember" aria-hidden="true" />
            <Text variant="title" as="h3">{isRTL ? 'عملاء الضيافة' : 'Comped Customers'}</Text>
          </div>
          <Text variant="caption" tone="tertiary" as="p" className="mt-1">
            {isRTL
              ? 'عملاء تكون جميع طلباتهم مجانية تلقائياً، مع سبب إلزامي وسجل تدقيق دائم.'
              : 'Customers whose every order is free automatically, with a mandatory reason and a permanent audit trail.'}
          </Text>
        </div>
        <Button
          label={isRTL ? 'تحديث' : 'Refresh'}
          onClick={() => void refresh()}
          disabled={loading}
          variant="secondary"
          leading={<RefreshCw className="size-4" />}
        />
      </div>

      <Notice
        title={isRTL ? 'لا يوجد حد أقصى' : 'There is no cap'}
        action={isRTL
          ? 'كل طلب من عميل الضيافة مجاني بالكامل، شاملاً رسوم التوصيل، ولا يوجد حد يومي أو شهري. الإضافة الخاطئة تعني طعاماً مجانياً بلا حدود حتى يتم إيقافها من هنا.'
          : 'Every order a comped customer places is free in full, delivery fee included, with no daily or monthly limit. A wrongly-added member is unlimited free food until it is switched off here.'}
        tone="warning"
      />
      {error ? <Notice title={isRTL ? 'تعذر تنفيذ العملية' : 'Action could not be completed'} action={error} tone="blocking" /> : null}
      {saved ? <Notice title={isRTL ? 'تم الحفظ' : 'Saved'} action={saved} tone="success" /> : null}

      <Card className="space-y-3">
        <Text variant="heading" as="h4">{isRTL ? 'الأعضاء الحاليون' : 'Current Members'}</Text>
        {loading ? <Text variant="body" tone="tertiary" as="p">{isRTL ? 'جارٍ التحميل…' : 'Loading…'}</Text> : null}
        {!loading && members.length === 0 ? (
          <Text variant="body" tone="tertiary" as="p">
            {isRTL ? 'لا يوجد عملاء ضيافة.' : 'No comped customers.'}
          </Text>
        ) : null}
        <div className="space-y-2">
          {members.map((m) => (
            <div
              key={m.profile_id}
              className="grid gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3 md:grid-cols-[minmax(180px,1.5fr)_minmax(180px,1fr)_auto] md:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Text variant="label" as="span">{memberName(m)}</Text>
                  <StatusPill
                    label={m.is_active ? (isRTL ? 'مفعّل' : 'ACTIVE') : (isRTL ? 'موقوف' : 'INACTIVE')}
                    tone={m.is_active ? 'success' : 'neutral'}
                  />
                </div>
                <Text variant="caption" tone="tertiary" as="p" className="mt-1 break-all">
                  {m.note || m.phone_number || m.profile_id}
                </Text>
              </div>
              {reasonField(m.profile_id, m.is_active
                ? (isRTL ? 'سبب الإيقاف' : 'Reason for removing')
                : (isRTL ? 'سبب إعادة التفعيل' : 'Reason for re-adding'))}
              <Button
                label={busyId === m.profile_id
                  ? (isRTL ? 'جارٍ الحفظ…' : 'Saving…')
                  : m.is_active ? (isRTL ? 'إيقاف' : 'Remove') : (isRTL ? 'إعادة تفعيل' : 'Re-add')}
                onClick={() => void apply(m.profile_id, memberName(m), !m.is_active)}
                disabled={busyId !== null}
                variant="secondary"
                leading={m.is_active ? <UserMinus className="size-4" /> : <Gift className="size-4" />}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-3">
        <Text variant="heading" as="h4">{isRTL ? 'إضافة عميل' : 'Add a Customer'}</Text>
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            aria-label={isRTL ? 'البحث عن عميل' : 'Search customers'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void doSearch(); }}
            placeholder={isRTL ? 'الاسم أو البريد أو رقم الجوال' : 'Name, email, or phone'}
            className={`${INPUT} flex-1`}
          />
          <Button
            label={searching ? (isRTL ? 'جارٍ البحث…' : 'Searching…') : (isRTL ? 'بحث' : 'Search')}
            onClick={() => void doSearch()}
            disabled={searching}
            leading={<Search className="size-4" />}
          />
        </div>
        <div className="space-y-2">
          {results.map((c) => {
            const already = activeIds.has(c.id);
            return (
              <div
                key={c.id}
                className="grid gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3 md:grid-cols-[minmax(180px,1.5fr)_minmax(180px,1fr)_auto] md:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Text variant="label" as="span">{candidateName(c)}</Text>
                    {already ? (
                      <StatusPill label={isRTL ? 'ضيافة بالفعل' : 'ALREADY COMPED'} tone="success" />
                    ) : null}
                  </div>
                  <Text variant="caption" tone="tertiary" as="p" className="mt-1 break-all">
                    {c.email || c.phone_number || c.id}
                  </Text>
                </div>
                {reasonField(c.id, isRTL ? 'سبب منح الضيافة' : 'Reason for comping')}
                <Button
                  label={busyId === c.id
                    ? (isRTL ? 'جارٍ الحفظ…' : 'Saving…')
                    : (isRTL ? 'منح الضيافة' : 'Comp')}
                  onClick={() => void apply(c.id, candidateName(c), true)}
                  disabled={already || busyId !== null}
                  variant="secondary"
                  leading={<Gift className="size-4" />}
                />
              </div>
            );
          })}
          {!searching && query.trim().length >= 2 && results.length === 0 ? (
            <Text variant="body" tone="tertiary" as="p">{isRTL ? 'لا توجد نتائج.' : 'No matching customers.'}</Text>
          ) : null}
        </div>
      </Card>

      <Card flush className="overflow-hidden">
        <div className="border-b border-con-line p-3">
          <Text variant="heading" as="h4">{isRTL ? 'سجل تغييرات الضيافة' : 'Comp Change Audit'}</Text>
          <Text variant="caption" tone="tertiary" as="p" className="mt-1">
            {isRTL
              ? 'سجل دائم — لا يُحذف عند إيقاف العضوية، حتى يظل الطلب القديم قابلاً للتفسير.'
              : 'Permanent — it is not cleared when a membership ends, so an old free order stays explicable.'}
          </Text>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-start">
            <thead><tr className="border-b border-con-line">
              {[
                isRTL ? 'العميل' : 'Customer',
                isRTL ? 'التغيير' : 'Change',
                isRTL ? 'السبب' : 'Reason',
                isRTL ? 'الوقت' : 'Time',
              ].map((h) => (
                <th key={h} className="px-3 py-2"><Text variant="caption" tone="tertiary" as="span">{h}</Text></th>
              ))}
            </tr></thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-t border-con-line">
                  <td className="px-3 py-2">
                    <Text variant="caption" as="span">
                      {a.target_name || (isRTL ? 'حساب محذوف' : 'Deleted account')}
                    </Text>
                  </td>
                  <td className="px-3 py-2">
                    <Text variant="caption" as="span">
                      {a.now_active
                        ? (isRTL ? 'مُنحت الضيافة' : 'Comped')
                        : (isRTL ? 'أُوقفت الضيافة' : 'Comp removed')}
                    </Text>
                  </td>
                  <td className="px-3 py-2"><Text variant="caption" as="span">{a.reason}</Text></td>
                  <td className="px-3 py-2">
                    <Text variant="caption" numeric as="span">
                      {new Date(a.changed_at).toLocaleString(isRTL ? 'ar-SA' : 'en-GB')}
                    </Text>
                  </td>
                </tr>
              ))}
              {audit.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center">
                  <Text variant="body" tone="tertiary" as="span">
                    {isRTL ? 'لا توجد تغييرات مسجلة.' : 'No comp changes recorded.'}
                  </Text>
                </td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
