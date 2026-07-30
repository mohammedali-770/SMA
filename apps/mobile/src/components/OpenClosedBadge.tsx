/** Shared open/closed status pill (menu context card, branch selection, …). */
import React from 'react';

import { StatusPill } from '../design-system/ui/Chip';
import { useI18n } from '../i18n/I18nProvider';

export function OpenClosedBadge({ open }: { open: boolean }) {
  const { t } = useI18n();
  return <StatusPill label={open ? t('open') : t('closed')} tone={open ? 'success' : 'danger'} />;
}
