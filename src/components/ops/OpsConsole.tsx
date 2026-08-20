/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Headset, Languages } from 'lucide-react';

import { useApp } from '../../context/AppContext';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { Text } from '../../design-system/ui/Text';
import { opsApi } from '../../lib/opsApi';
import { BranchConsole } from './BranchConsole';
import { useOpsLang } from './useOpsLang';

/**
 * Shell for the branch-operations roles.
 *
 * Deliberately NOT wrapped in StaffMfaGate: these accounts sign in with email
 * and password from shared shop-floor hardware (owner decision 2026-08-20), and
 * their server-side capability is narrow enough to make that safe. The routing
 * decision itself lives in `src/lib/roles.ts`.
 *
 * The call-centre board is a later phase; that role currently gets a scoped
 * placeholder rather than a branch console it has no branch for.
 */
export const OpsConsole: React.FC = () => {
  const { currentUser } = useApp();
  const i18n = useOpsLang();
  const { t, dir } = i18n;

  const [branchId, setBranchId] = React.useState<string | null>(null);
  const [resolving, setResolving] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const isCallCentre = currentUser.role === 'call_center';

  React.useEffect(() => {
    if (isCallCentre) { setResolving(false); return; }
    let disposed = false;
    void (async () => {
      try {
        const id = await opsApi.myBranchId();
        if (!disposed) setBranchId(id);
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!disposed) setResolving(false);
      }
    })();
    return () => { disposed = true; };
  }, [isCallCentre]);

  return (
    <main className="flex-grow w-full max-w-3xl mx-auto p-4 md:p-6 space-y-4" dir={dir}>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={i18n.toggle}
          className="ds-motion inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface px-3 transition-colors duration-150 hover:bg-con-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Languages className="size-4 text-con-text-2" aria-hidden="true" />
          <Text variant="label" tone="secondary" as="span">{t('language')}</Text>
        </button>
      </div>

      {isCallCentre ? (
        <Card className="space-y-3 p-5">
          <div className="flex items-center gap-3">
            <Headset className="size-6 text-ember" aria-hidden="true" />
            <Text variant="title" as="h1">{t('callCentreConsole')}</Text>
          </div>
          <Notice title={t('callCentreScope')} tone="info" />
        </Card>
      ) : resolving ? (
        <Text variant="body" tone="tertiary" as="p">{t('loading')}</Text>
      ) : error ? (
        <Notice title={t('loadFailed')} action={error} tone="blocking" />
      ) : (
        <BranchConsole branchId={branchId} i18n={i18n} />
      )}
    </main>
  );
};
