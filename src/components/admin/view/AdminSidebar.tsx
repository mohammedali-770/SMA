/**
 * Console navigation — PRESENTATION ONLY.
 *
 * Renders `resolveNavGroups()` and reports which tab was clicked. It decides
 * nothing about visibility: three tabs are capability-gated behind runtime
 * probes, and that lives with the probes in AdminDashboard. Tabs, routes and
 * panels are untouched — this file changes how twelve destinations are
 * PRESENTED, not what they are.
 *
 * Twelve flat buttons is past the point where a list is scanned rather than
 * read, so they are grouped and the groups collapse. Two rules keep that from
 * hiding things:
 *
 *   Overview is never collapsible. It is the landing tab and the place the
 *   shell returns you to when a gated tab disappears, so it stays one click
 *   away at all times.
 *
 *   The group holding the active tab is always expanded, including when the
 *   shell moves you somewhere on its own. You can never be on a page the
 *   sidebar is hiding.
 *
 * Responsive by structure: a compact drawer below `lg` — one trigger showing
 * where you are, opening a full navigation over the content — and a fixed
 * column from `lg` up. The old horizontal scrolling strip is gone; it was the
 * reason the console scrolled sideways on a tablet.
 *
 * RTL comes from logical properties (`border-e`, `start-0`, `text-start`)
 * rather than a mirrored stylesheet, so Arabic anchors the drawer to the right
 * edge and English to the left with no branching.
 *
 * The selected tab fills with ember, the one interactive colour. Everything
 * else is quiet until hovered, so at a glance the sidebar answers "where am I"
 * with a single mark rather than twelve competing ones.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';

import { Text } from '../../../design-system/ui/Text';
import {
  initialExpandedGroups, resolveNavGroups, withActiveGroupExpanded,
  type AdminNavGroupId, type AdminNavItem, type AdminTab, type GatedVisibility,
  type ResolvedNavGroup,
} from './adminNav';

const COPY = {
  en: {
    nav: 'Console sections', menu: 'Menu', close: 'Close menu', open: 'Open menu',
    live: (n: number) => `${n} live ${n === 1 ? 'order' : 'orders'}`,
  },
  ar: {
    nav: 'أقسام لوحة التحكم', menu: 'القائمة', close: 'إغلاق القائمة', open: 'فتح القائمة',
    live: (n: number) => `${n} طلبات مباشرة`,
  },
} as const;

/**
 * The Live Orders count, as a pill. Rendered on the item and, when its group
 * is collapsed, on the group header — so collapsing never hides the count.
 *
 * The digit alone is meaningless to a screen reader: absorbed into the group
 * header's name it read as "Operations 7", and on the compact trigger it was a
 * bare "7" with nothing beside it. The visible glyph is therefore hidden from
 * the accessibility tree and replaced with the same count in words.
 */
function CountBadge({ count, srLabel, onEmber }: {
  count: number;
  srLabel: string;
  onEmber: boolean;
}) {
  return (
    <span
      className={[
        'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5',
        onEmber ? 'bg-on-ember' : 'bg-ember',
      ].join(' ')}
    >
      <Text
        variant="caption"
        numeric
        tone={onEmber ? 'ember' : 'onEmber'}
        as="span"
        aria-hidden="true"
      >
        {count}
      </Text>
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}

function NavButton({
  item, selected, lang, liveOrderCount, indented, onSelect,
}: {
  item: AdminNavItem;
  selected: boolean;
  lang: 'en' | 'ar';
  liveOrderCount: number;
  indented: boolean;
  onSelect: (tab: AdminTab) => void;
}) {
  const { tab, icon: Icon, en, ar } = item;
  const showBadge = tab === 'orders' && liveOrderCount > 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(tab)}
      aria-current={selected ? 'page' : undefined}
      className={[
        'ds-motion flex min-h-11 w-full items-center justify-between gap-2 text-start',
        'rounded-[var(--radius-ds-md)] px-3 py-2.5 transition-colors duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        indented ? 'ps-6' : '',
        selected ? 'bg-ember' : 'text-con-text hover:bg-con-surface',
      ].filter(Boolean).join(' ')}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <Text variant="label" tone={selected ? 'onEmber' : 'primary'} as="span" className="truncate">
          {lang === 'ar' ? ar : en}
        </Text>
      </span>

      {showBadge ? (
        <CountBadge count={liveOrderCount} srLabel={COPY[lang].live(liveOrderCount)} onEmber={selected} />
      ) : null}
    </button>
  );
}

function NavGroup({
  group, active, expanded, lang, liveOrderCount, surface, onToggle, onSelect,
}: {
  group: ResolvedNavGroup;
  active: AdminTab;
  expanded: boolean;
  lang: 'en' | 'ar';
  liveOrderCount: number;
  /**
   * Which copy of the tree this is. The drawer and the column render the same
   * groups, and while the drawer is open BOTH are in the DOM — the column is
   * only hidden by CSS. Without this, every disclosure panel id would exist
   * twice and each `aria-controls` would point at an ambiguous target.
   */
  surface: 'column' | 'drawer';
  onToggle: (id: AdminNavGroupId) => void;
  onSelect: (tab: AdminTab) => void;
}) {
  const { id, icon: Icon, en, ar, collapsible, items } = group;
  const panelId = `admin-nav-${surface}-group-${id}`;

  // A pinned group is a plain list with no header — Overview is one item, and
  // wrapping it in a disclosure would be chrome around a single button.
  if (!collapsible) {
    return (
      <div className="flex flex-col gap-1">
        {items.map((item) => (
          <NavButton
            key={item.tab}
            item={item}
            selected={active === item.tab}
            lang={lang}
            liveOrderCount={liveOrderCount}
            indented={false}
            onSelect={onSelect}
          />
        ))}
      </div>
    );
  }

  const holdsActive = items.some((item) => item.tab === active);
  // Collapsed groups still have to answer "is anything waiting for me?".
  const collapsedCount = !expanded && items.some((item) => item.tab === 'orders')
    ? liveOrderCount
    : 0;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={[
          'ds-motion flex min-h-11 w-full items-center justify-between gap-2 text-start',
          'rounded-[var(--radius-ds-md)] px-3 py-2.5 transition-colors duration-150',
          'focus-visible:outline-2 focus-visible:outline-offset-2 hover:bg-con-surface',
        ].join(' ')}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-con-text-3" aria-hidden="true" />
          {/* Not `label`: a group is a heading for the items under it, and
              reading identically to them is what made the flat list hard to
              scan in the first place. */}
          <Text variant="caption" tone="tertiary" as="span" className="truncate uppercase tracking-wide">
            {lang === 'ar' ? ar : en}
          </Text>
          {/* A dot marks the group you are inside while it is collapsed. */}
          {holdsActive && !expanded ? (
            <span className="size-1.5 shrink-0 rounded-full bg-ember" aria-hidden="true" />
          ) : null}
        </span>

        <span className="flex shrink-0 items-center gap-1.5">
          {collapsedCount > 0 ? (
            <CountBadge count={collapsedCount} srLabel={COPY[lang].live(collapsedCount)} onEmber={false} />
          ) : null}
          <ChevronDown
            className={[
              'ds-motion size-4 text-con-text-3 transition-transform duration-150',
              expanded ? 'rotate-180' : '',
            ].filter(Boolean).join(' ')}
            aria-hidden="true"
          />
        </span>
      </button>

      {expanded ? (
        <div id={panelId} className="flex flex-col gap-1">
          {items.map((item) => (
            <NavButton
              key={item.tab}
              item={item}
              selected={active === item.tab}
              lang={lang}
              liveOrderCount={liveOrderCount}
              indented
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AdminSidebar({
  active,
  onSelect,
  visibility,
  lang,
  liveOrderCount,
}: {
  active: AdminTab;
  onSelect: (tab: AdminTab) => void;
  visibility: GatedVisibility;
  lang: 'en' | 'ar';
  /** Active-order count; renders as a badge on Live Orders when non-zero. */
  liveOrderCount: number;
}) {
  const copy = COPY[lang];
  const groups = resolveNavGroups(visibility);

  const [expanded, setExpanded] = useState<ReadonlySet<AdminNavGroupId>>(
    () => initialExpandedGroups(active),
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Focus follows the drawer: into it on open, back to the trigger that opened
  // it on every close path (pick, Escape, backdrop, X). Without this the drawer
  // unmounts under the caret and focus falls to <body>, so the next Tab starts
  // from the top of the document instead of where the operator was.
  //
  // Deliberately NOT a focus trap, and deliberately no role="dialog"/aria-modal:
  // the content behind is not inert, and this repo's ModalShell already states
  // that claiming modality without real inertness is worse than saying nothing.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const everOpened = useRef(false);

  // The shell can change the active tab without the sidebar being touched —
  // it resets to Overview when a gated tab's probe comes back missing. Reopen
  // whichever group now holds it. `withActiveGroupExpanded` returns the same
  // set when nothing changed, so this settles immediately.
  useEffect(() => {
    setExpanded((current) => withActiveGroupExpanded(current, active));
  }, [active]);

  const toggleGroup = useCallback((id: AdminNavGroupId) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const select = useCallback((tab: AdminTab) => {
    onSelect(tab);
    setDrawerOpen(false);
  }, [onSelect]);

  useEffect(() => {
    if (drawerOpen) {
      everOpened.current = true;
      closeRef.current?.focus();
      return;
    }
    // Guarded, so a first render does not steal focus from the page.
    if (everOpened.current) triggerRef.current?.focus();
  }, [drawerOpen]);

  // Escape closes the drawer, the one interaction a keyboard user expects from
  // anything covering the page.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const activeItem = groups.flatMap((g) => g.items).find((item) => item.tab === active);
  const activeLabel = activeItem ? (lang === 'ar' ? activeItem.ar : activeItem.en) : copy.menu;

  const tree = (surface: 'column' | 'drawer') => (
    <div className="flex flex-col gap-2">
      {groups.map((group) => (
        <NavGroup
          key={group.id}
          group={group}
          active={active}
          expanded={expanded.has(group.id)}
          lang={lang}
          liveOrderCount={liveOrderCount}
          surface={surface}
          onToggle={toggleGroup}
          onSelect={select}
        />
      ))}
    </div>
  );

  return (
    <>
      {/* Compact trigger — tablet and narrower. Names the current page so the
          drawer is not the only way to find out where you are. */}
      <div className="flex items-center gap-2 border-b border-con-line bg-con-surface-2 p-3 lg:hidden">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label={copy.open}
          aria-expanded={drawerOpen}
          className={[
            'ds-motion flex min-h-11 items-center gap-2 rounded-[var(--radius-ds-md)]',
            'border border-con-line px-3 py-2.5 transition-colors duration-150',
            'hover:bg-con-surface focus-visible:outline-2 focus-visible:outline-offset-2',
          ].join(' ')}
        >
          <Menu className="size-4 shrink-0" aria-hidden="true" />
          <Text variant="label" as="span">{copy.menu}</Text>
        </button>

        <Text
          variant="label"
          tone="secondary"
          as="span"
          className="truncate"
          data-testid="admin-nav-current"
        >
          {activeLabel}
        </Text>

        {liveOrderCount > 0 ? (
          <span className="ms-auto shrink-0">
            <CountBadge count={liveOrderCount} srLabel={copy.live(liveOrderCount)} onEmber={false} />
          </span>
        ) : null}
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label={copy.close}
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 size-full bg-brand-ink/60"
          />
          {/* `start-0` anchors to the left in LTR and the right in RTL. */}
          <nav
            aria-label={copy.nav}
            className={[
              'absolute bottom-0 start-0 top-0 flex w-[264px] max-w-[85vw] flex-col',
              'overflow-y-auto border-e border-con-line bg-con-surface-2 p-3',
            ].join(' ')}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <Text variant="label" tone="secondary" as="span">{copy.menu}</Text>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label={copy.close}
                className={[
                  'ds-motion flex size-9 items-center justify-center rounded-[var(--radius-ds-md)]',
                  'transition-colors duration-150 hover:bg-con-surface',
                  'focus-visible:outline-2 focus-visible:outline-offset-2',
                ].join(' ')}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
            {tree('drawer')}
          </nav>
        </div>
      ) : null}

      {/* Fixed column — desktop. */}
      <nav
        aria-label={copy.nav}
        className={[
          'hidden w-[228px] shrink-0 overflow-y-auto p-3',
          'border-e border-con-line bg-con-surface-2 lg:block',
        ].join(' ')}
      >
        {tree('column')}
      </nav>
    </>
  );
}
