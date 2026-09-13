/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BookOpen, Eye, EyeOff, ExternalLink, Phone } from 'lucide-react';

import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { Text } from '../../design-system/ui/Text';
import type { BranchReferenceRow } from '../../lib/opsApi';
import { displayValue, isHidden, orderedEntries, safeHref, telHref } from './branchReference';
import type { OpsLangValue } from './useOpsLang';

/**
 * The branch reference sheet: numbers, links, notes and credentials.
 *
 * THE REVEAL IS A USER ACTION AND NOTHING ELSE. Every reveal writes a server
 * audit row, so this component must never call it from a render, an effect, a
 * prefetch or a retry — a reveal-on-mount would write a row every time the
 * screen opened and make the trail worthless for the question it exists to
 * answer. The only call site is the button's onClick.
 *
 * Revealed values live in component state and are dropped when the screen
 * unmounts. Hiding one forgets it locally; showing it again is a fresh reveal
 * and a fresh audit row, which is the honest accounting.
 */
export const BranchReferenceCard: React.FC<{
  entries: BranchReferenceRow[];
  i18n: OpsLangValue;
  onReveal: (entryId: string) => Promise<string>;
}> = ({ entries, i18n, onReveal }) => {
  const { t, isRTL } = i18n;
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = orderedEntries(entries);
  const hasSecret = rows.some((r) => r.kind === 'secret');

  const reveal = async (id: string) => {
    setPending(id);
    setError(null);
    try {
      const value = await onReveal(id);
      setRevealed((prev) => ({ ...prev, [id]: value }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };

  const hide = (id: string) =>
    setRevealed((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <BookOpen className="size-4 text-ember" aria-hidden="true" />
        <Text variant="heading" as="h2">
          {t('referenceSection')}
        </Text>
      </div>

      {error ? <Notice title={t('referenceRevealFailed')} action={error} tone="blocking" /> : null}

      {rows.length === 0 ? (
        <Notice title={t('referenceEmptyTitle')} action={t('referenceEmptyBody')} tone="info" />
      ) : (
        <div className="space-y-2">
          {rows.map((entry) => {
            const label = isRTL ? entry.labelAr : entry.labelEn;
            const shown = displayValue(entry, revealed[entry.id]);
            const hidden = isHidden(entry, revealed[entry.id]);
            const href = safeHref(entry);
            const tel = telHref(entry);

            return (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-ds-md)] border border-con-line bg-con-surface p-3"
              >
                <div className="min-w-0">
                  <Text variant="label" as="p">
                    {label}
                  </Text>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-[15px] text-ember-text underline break-all"
                    >
                      {shown}
                      <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                    </a>
                  ) : tel ? (
                    <a
                      href={tel}
                      className="inline-flex items-center gap-1 text-[15px] text-ember-text underline"
                    >
                      <Phone className="size-3 shrink-0" aria-hidden="true" />
                      <span dir="ltr">{shown}</span>
                    </a>
                  ) : (
                    <Text
                      variant="body"
                      tone={hidden ? 'tertiary' : 'secondary'}
                      as="p"
                      numeric={entry.kind === 'secret'}
                    >
                      <span dir={entry.kind === 'secret' ? 'ltr' : undefined} className="break-all">
                        {shown}
                      </span>
                    </Text>
                  )}
                </div>

                {entry.kind === 'secret' ? (
                  hidden ? (
                    <Button
                      label={pending === entry.id ? t('loading') : t('referenceReveal')}
                      onClick={() => {
                        void reveal(entry.id);
                      }}
                      disabled={pending !== null}
                      variant="secondary"
                      leading={<Eye className="size-4" />}
                    />
                  ) : (
                    <Button
                      label={t('referenceHide')}
                      onClick={() => hide(entry.id)}
                      variant="secondary"
                      leading={<EyeOff className="size-4" />}
                    />
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {hasSecret ? (
        <Text variant="caption" tone="tertiary" as="p">
          {t('referenceAuditNotice')}
        </Text>
      ) : null}
    </Card>
  );
};
