/**
 * The console's modal shell: sticky header, scrolling body, sticky footer.
 *
 * Every admin editor had its own copy of this — branch, delivery zone, product,
 * banner — and they had drifted on radius, backdrop, header weight and whether
 * the footer stuck. One shell means one answer.
 *
 * `role="dialog"` WITHOUT `aria-modal`: nothing here traps focus or marks the
 * page inert, and telling a screen reader the page behind is hidden when it is
 * not is worse than saying nothing. Adding real focus management would be a
 * behaviour change, and these migrations do not make one.
 */
import React from 'react';
import { X } from 'lucide-react';

import { Text } from '../../../../design-system/ui/Text';

export function AdminModal({
  title,
  subtitle,
  isRTL,
  onClose,
  footer,
  size = 'lg',
  children,
}: {
  title: string;
  subtitle?: string | null;
  isRTL: boolean;
  onClose: () => void;
  /** Buttons, laid out by the caller. Omit for a read-only sheet. */
  footer?: React.ReactNode;
  size?: 'md' | 'lg' | 'xl' | '2xl';
  children: React.ReactNode;
}) {
  const width = { md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl', '2xl': 'max-w-3xl' }[size];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-ink/60 p-4"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div
        role="dialog"
        aria-label={title}
        className={`flex max-h-[90vh] w-full ${width} flex-col overflow-hidden rounded-[var(--radius-ds-lg)] border border-con-line bg-con-surface`}
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-con-line px-4 py-3">
          <div className="min-w-0">
            <Text variant="heading" as="h3">{title}</Text>
            {subtitle && (
              <Text variant="caption" tone="tertiary" as="p" className="mt-0.5">{subtitle}</Text>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isRTL ? 'إغلاق' : 'Close'}
            className="ds-motion inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-con-line bg-con-surface-2 transition-colors duration-150 hover:bg-con-surface focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <X className="size-4 text-con-text-2" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{children}</div>

        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-con-line px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
