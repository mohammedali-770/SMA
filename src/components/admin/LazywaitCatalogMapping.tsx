import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, Circle, DownloadCloud, Loader2, X } from 'lucide-react';

import {
  catalog, lazywaitCatalog,
  DbBranch, DbCategory, DbProduct, DbModifierGroup, DbModifier,
  DbLazywaitCatalogItem, LazywaitMappingStatus, LazywaitPullResult, LazywaitImportResult,
  LazywaitCatalogEntity, LazywaitMappingEntity, LazywaitPriceRef,
} from '../../lib/api';
import { suggestBestMatch, MatchLevel } from '../../lib/lazywaitMatch';
import { Button } from '../../design-system/ui/Button';
import { Card } from '../../design-system/ui/Card';
import { Notice } from '../../design-system/ui/Notice';
import { StatusPill, type PillTone } from '../../design-system/ui/StatusPill';
import { Text } from '../../design-system/ui/Text';
import { useDsFontClass } from '../../design-system/ui/useDsLang';

/**
 * Admin catalog mapping: pull the Lazywait catalog server-side, review suggested
 * matches (by normalized Arabic/English/Turkish name), and CONFIRM ID mappings
 * onto local records — never overwriting local names/prices, never exposing a
 * secret. Accountants (disabled) can view status but not edit.
 *
 * RESTYLED ONLY. Every call, argument, confirmation prompt and piece of copy in
 * this file is the one that was here before: `pull()`, `importToApp()`,
 * `setMapping(entity, id, lazywaitId, priceRef)` with its price-selection
 * fallback to `prices[0]`, and `clearMapping(entity, id)`. The Lazywait
 * integration itself is untouched.
 */
const ENTITIES: { key: LazywaitMappingEntity; catalogType: LazywaitCatalogEntity; label: string }[] = [
  { key: 'branch', catalogType: 'branch', label: 'Branches' },
  { key: 'category', catalogType: 'category', label: 'Categories' },
  { key: 'product', catalogType: 'item', label: 'Products' },
  { key: 'modifier_group', catalogType: 'addon_group', label: 'Groups' },
  { key: 'modifier', catalogType: 'addon', label: 'Modifiers' },
];

/**
 * Match confidence → pill tone.
 *
 * `low` and `medium` deliberately share the warning tone: both mean "a human
 * must look at this", and splitting them into two colours invited an operator
 * to treat `medium` as good enough to confirm blind.
 */
const LEVEL_TONE: Record<MatchLevel, PillTone> = {
  high: 'success',
  medium: 'warning',
  low: 'warning',
  none: 'neutral',
};

const SELECT = [
  'ds-motion min-h-9 w-full max-w-[220px] rounded-[var(--radius-ds-md)] border border-con-line',
  'bg-con-surface px-2 text-[13px] text-con-text transition-colors duration-150',
  'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
].join(' ');

const TH = 'py-1 pe-2 text-start';
const TD = 'py-1.5 pe-2 align-top';

interface LocalRow { id: string; nameEn: string; nameAr: string; currentId: string | null; product?: DbProduct }

function catalogLabel(c: DbLazywaitCatalogItem): string {
  return `${c.name_en || c.name_ar || c.name_other || '(unnamed)'} — ${c.lazywait_id}`;
}

export const LazywaitCatalogMapping: React.FC<{ disabled: boolean }> = ({ disabled }) => {
  const [branches, setBranches] = useState<DbBranch[]>([]);
  const [categories, setCategories] = useState<DbCategory[]>([]);
  const [products, setProducts] = useState<DbProduct[]>([]);
  const [groups, setGroups] = useState<DbModifierGroup[]>([]);
  const [modifiers, setModifiers] = useState<DbModifier[]>([]);
  const [items, setItems] = useState<DbLazywaitCatalogItem[]>([]);
  const [status, setStatus] = useState<LazywaitMappingStatus | null>(null);

  const [tab, setTab] = useState<LazywaitMappingEntity>('branch');
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [chosenPrice, setChosenPrice] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pull, setPull] = useState<LazywaitPullResult | null>(null);

  const family = useDsFontClass();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, c, p, g, m, it, st] = await Promise.all([
        catalog.branches(), catalog.categories(), catalog.products(),
        catalog.modifierGroups(), catalog.modifiers(),
        lazywaitCatalog.items(), lazywaitCatalog.status(),
      ]);
      setBranches(b); setCategories(c); setProducts(p); setGroups(g); setModifiers(m);
      setItems(it); setStatus(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load catalog mapping');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const runPull = async () => {
    setPulling(true); setError(null); setMsg(null); setPull(null);
    try {
      const res = await lazywaitCatalog.pull();
      setPull(res);
      const total = Object.values(res.counts).reduce((a, n) => a + n, 0);
      if (res.status === 'error') setError('Catalog pull failed — see endpoint errors below.');
      else setMsg(`Pulled Lazywait catalog (${total} records${res.status === 'partial' ? ', some endpoints failed' : ''})`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pull failed');
    } finally {
      setPulling(false);
    }
  };

  const runImport = async () => {
    if (!window.confirm(
      'Import the Lazywait catalog into your app menu?\n\n' +
      'Lazywait becomes the menu source: categories & products are created/updated ' +
      'from the latest pull, and any local items NOT in Lazywait are hidden ' +
      '(deactivated, not deleted). Branch delivery settings are kept. Continue?'
    )) return;
    setImporting(true); setError(null); setMsg(null);
    try {
      const r: LazywaitImportResult = await lazywaitCatalog.importToApp();
      setMsg(
        `Imported from Lazywait — products: +${r.products.created} new / ${r.products.updated} updated` +
        `${r.products.deactivated ? ` / ${r.products.deactivated} hidden` : ''}; ` +
        `categories: +${r.categories.created} / ${r.categories.updated} updated` +
        `${r.categories.deactivated ? ` / ${r.categories.deactivated} hidden` : ''}.`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const candidatesByType = useMemo(() => {
    const map: Record<string, DbLazywaitCatalogItem[]> = {};
    for (const it of items) (map[it.entity_type] ??= []).push(it);
    return map;
  }, [items]);

  const localRows = (entity: LazywaitMappingEntity): LocalRow[] => {
    switch (entity) {
      case 'branch': return branches.map((b) => ({ id: b.id, nameEn: b.name_en, nameAr: b.name_ar, currentId: b.lazywait_branch_id ?? null }));
      case 'category': return categories.map((c) => ({ id: c.id, nameEn: c.name_en, nameAr: c.name_ar, currentId: c.lazywait_category_id ?? null }));
      case 'product': return products.map((p) => ({ id: p.id, nameEn: p.name_en, nameAr: p.name_ar, currentId: p.lazywait_item_id ?? null, product: p }));
      case 'modifier_group': return groups.map((g) => ({ id: g.id, nameEn: g.name_en, nameAr: g.name_ar, currentId: g.lazywait_group_id ?? null }));
      case 'modifier': return modifiers.map((m) => ({ id: m.id, nameEn: m.name_en, nameAr: m.name_ar, currentId: m.lazywait_addon_id ?? null }));
    }
  };

  const confirm = async (entity: LazywaitMappingEntity, row: LocalRow, lwId: string, cands: DbLazywaitCatalogItem[]) => {
    if (!lwId) return;
    setBusy(row.id); setError(null); setMsg(null);
    try {
      let priceRef: LazywaitPriceRef | null = null;
      if (entity === 'product') {
        const cand = cands.find((c) => c.lazywait_id === lwId);
        const prices = cand?.prices ?? [];
        if (prices.length) {
          const pick = chosenPrice[row.id];
          priceRef = prices.find((pr) => pr.price_id === pick) ?? prices[0];
        }
      }
      await lazywaitCatalog.setMapping(entity, row.id, lwId, priceRef);
      setMsg('Mapping confirmed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Confirm failed');
    } finally {
      setBusy(null);
    }
  };

  const clear = async (entity: LazywaitMappingEntity, row: LocalRow) => {
    setBusy(row.id); setError(null); setMsg(null);
    try {
      await lazywaitCatalog.clearMapping(entity, row.id);
      setMsg('Mapping cleared');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Clear failed');
    } finally {
      setBusy(null);
    }
  };

  const active = ENTITIES.find((e) => e.key === tab)!;
  const cands = candidatesByType[active.catalogType] ?? [];
  const rows = localRows(tab);

  const readinessItems = status ? [
    { ok: status.readiness.secrets, label: 'Lazywait secrets configured' },
    { ok: status.readiness.branch_mapped, label: 'At least one branch mapped' },
    { ok: status.readiness.active_products_mapped, label: 'All active products mapped' },
    { ok: status.readiness.no_blocked_orders, label: 'No orders blocked by missing mapping' },
  ] : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Text variant="label" tone="secondary" as="p">Catalog Mapping</Text>
          <Text variant="caption" tone="tertiary" numeric as="p" className="mt-0.5">
            {status?.last_pull_at ? `Last pull ${new Date(status.last_pull_at).toLocaleString()}` : 'Not pulled yet'}
          </Text>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            label="Pull from Lazywait"
            onClick={() => { void runPull(); }}
            disabled={disabled || pulling || importing || loading}
            loading={pulling}
            variant="secondary"
            leading={<DownloadCloud className="size-3.5" aria-hidden="true" />}
          />
          {/* Import is the destructive one — it rewrites the app menu from
              Lazywait and hides local items — so it carries the primary weight
              and its own typed confirmation. */}
          <Button
            label="Import to App"
            onClick={() => { void runImport(); }}
            disabled={disabled || importing || pulling || loading || items.length === 0}
            loading={importing}
            leading={<Check className="size-3.5" aria-hidden="true" />}
          />
        </div>
      </div>

      {error && <Notice title={error} tone="blocking" />}
      {msg && <Notice title={msg} tone="success" />}
      {pull && pull.errors.length > 0 && (
        <div className="space-y-0.5 rounded-[var(--radius-ds-md)] border border-warn-line bg-warn-tint p-2">
          {pull.errors.map((e, i) => (
            <Text key={i} variant="caption" tone="warning" as="p">⚠ {e.endpoint}: {e.message}</Text>
          ))}
        </div>
      )}

      {status && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <Card className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Text variant="caption" tone="secondary" as="span">Pickup sync readiness</Text>
              <StatusPill
                label={status.readiness.ready ? 'READY' : 'NOT READY'}
                tone={status.readiness.ready ? 'success' : 'warning'}
              />
            </div>
            {readinessItems.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5">
                {r.ok
                  ? <CheckCircle2 className="size-3 shrink-0 text-mint" aria-hidden="true" />
                  : <Circle className="size-3 shrink-0 text-con-text-3" aria-hidden="true" />}
                <Text variant="caption" tone="secondary" as="span">{r.label}</Text>
              </div>
            ))}
          </Card>

          <Card className="space-y-1.5">
            <Text variant="caption" tone="secondary" as="p">Mapping status</Text>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <SummaryRow label="Branches" c={status.branches} />
              <SummaryRow label="Categories" c={status.categories} />
              <SummaryRow label="Products" c={status.products} />
              <SummaryRow label="Groups" c={status.modifier_groups} />
              <SummaryRow label="Modifiers" c={status.modifiers} />
              <div className="flex justify-between gap-2">
                <Text variant="caption" tone="secondary" as="span">Blocked orders</Text>
                <Text variant="caption" tone={status.blocked_orders ? 'danger' : 'success'} numeric as="span">
                  {status.blocked_orders}
                </Text>
              </div>
            </div>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {ENTITIES.map((e) => {
          const c = status?.[e.key === 'modifier_group' ? 'modifier_groups' : (e.key === 'branch' ? 'branches' : e.key === 'category' ? 'categories' : e.key === 'product' ? 'products' : 'modifiers')];
          return (
            <button
              key={e.key}
              type="button"
              onClick={() => setTab(e.key)}
              aria-pressed={tab === e.key}
              className={[
                'ds-motion inline-flex min-h-9 items-center rounded-full px-2.5',
                'transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2',
                tab === e.key ? 'bg-ember' : 'bg-con-surface-2 hover:bg-con-surface',
              ].join(' ')}
            >
              <Text variant="caption" tone={tab === e.key ? 'onEmber' : 'secondary'} as="span">
                {e.label}{c ? ` ${c.mapped}/${c.total}` : ''}
              </Text>
            </button>
          );
        })}
      </div>

      {loading ? (
        <Text variant="caption" tone="tertiary" as="p" className="flex items-center gap-1.5">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Loading…
        </Text>
      ) : cands.length === 0 ? (
        <Text variant="caption" tone="tertiary" as="p">
          No Lazywait {active.label.toLowerCase()} pulled yet — click “Pull from Lazywait”.
        </Text>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-con-line">
                {['Local (EN / AR)', 'Suggested match', 'Map to Lazywait', ''].map((h, i) => (
                  <th key={h || `sp-${i}`} className={TH}>
                    <Text variant="caption" tone="tertiary" as="span">{h}</Text>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const suggestion = suggestBestMatch<DbLazywaitCatalogItem>(row, cands);
                const selectedId = chosen[row.id] ?? row.currentId ?? suggestion?.candidate.lazywait_id ?? '';
                const selectedCand = cands.find((c) => c.lazywait_id === selectedId);
                const prices = (tab === 'product' && selectedCand?.prices) || [];
                return (
                  <tr key={row.id} className="border-t border-con-line">
                    <td className={TD}>
                      <Text variant="caption" as="p">{row.nameEn || '—'}</Text>
                      <Text variant="caption" tone="tertiary" as="p" dir="rtl">{row.nameAr || '—'}</Text>
                      {row.currentId && (
                        <span className="mt-0.5 inline-flex items-center gap-1">
                          <Check className="size-2.5 text-mint" aria-hidden="true" />
                          <Text variant="caption" tone="success" numeric as="span">mapped: {row.currentId}</Text>
                        </span>
                      )}
                    </td>

                    <td className={TD}>
                      {suggestion ? (
                        <div>
                          <Text variant="caption" tone="secondary" as="p">{catalogLabel(suggestion.candidate)}</Text>
                          <StatusPill
                            className="mt-0.5"
                            label={`${suggestion.level}${suggestion.requiresConfirmation ? ' · review' : ''}`}
                            tone={LEVEL_TONE[suggestion.level]}
                          />
                        </div>
                      ) : (
                        <Text variant="caption" tone="tertiary" as="span">no suggestion</Text>
                      )}
                    </td>

                    <td className={`${TD} space-y-1`}>
                      <select
                        value={selectedId}
                        disabled={disabled}
                        aria-label={`Lazywait mapping for ${row.nameEn || row.id}`}
                        onChange={(e) => setChosen((m) => ({ ...m, [row.id]: e.target.value }))}
                        className={`${SELECT} ${family}`}
                      >
                        <option value="">— select —</option>
                        {cands.map((c) => <option key={c.id} value={c.lazywait_id}>{catalogLabel(c)}</option>)}
                      </select>
                      {tab === 'product' && prices.length > 1 && (
                        <select
                          value={chosenPrice[row.id] ?? prices[0].price_id ?? ''}
                          disabled={disabled}
                          aria-label={`Price for ${row.nameEn || row.id}`}
                          onChange={(e) => setChosenPrice((m) => ({ ...m, [row.id]: e.target.value }))}
                          className={`${SELECT} ${family}`}
                        >
                          {prices.map((pr, i) => (
                            <option key={i} value={pr.price_id ?? ''}>
                              {(pr.name || 'price')}{pr.price_with_vat != null ? ` — ${pr.price_with_vat}` : ''}{pr.price_id ? ` (${pr.price_id})` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    <td className={`${TD} whitespace-nowrap text-end`}>
                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => { void confirm(tab, row, selectedId, cands); }}
                          disabled={disabled || !selectedId || busy === row.id}
                          className="ds-motion inline-flex min-h-8 items-center gap-1 rounded-[var(--radius-ds-sm)] bg-ember px-2.5 transition-opacity duration-150 hover:opacity-90 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          {busy === row.id
                            ? <Loader2 className="size-3 animate-spin text-on-ember" aria-hidden="true" />
                            : <Check className="size-3 text-on-ember" aria-hidden="true" />}
                          <Text variant="caption" tone="onEmber" as="span">Confirm</Text>
                        </button>
                        {row.currentId && (
                          <button
                            type="button"
                            onClick={() => { void clear(tab, row); }}
                            disabled={disabled || busy === row.id}
                            className="ds-motion inline-flex min-h-8 items-center gap-1 rounded-[var(--radius-ds-sm)] px-2 transition-colors duration-150 hover:bg-danger-tint disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2"
                          >
                            <X className="size-3 text-danger-ds" aria-hidden="true" />
                            <Text variant="caption" tone="danger" as="span">Clear</Text>
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Text variant="caption" tone="tertiary" as="p">
        <b>Import to App</b> makes Lazywait the menu source: it creates/updates your categories &amp; products from
        the latest pull (prices from Lazywait), hides local items not in Lazywait, and keeps branch delivery settings.
        Individual <b>Confirm</b> mappings below only link IDs (they never overwrite local data). price_id,
        addons/modifiers and delivery are mapped for reference but intentionally NOT sent in Create Order yet.
      </Text>
    </div>
  );
};

const SummaryRow: React.FC<{ label: string; c: { mapped: number; total: number } }> = ({ label, c }) => (
  <div className="flex justify-between gap-2">
    <Text variant="caption" tone="secondary" as="span">{label}</Text>
    <Text variant="caption" tone={c.total > 0 && c.mapped === c.total ? 'success' : 'secondary'} numeric as="span">
      {c.mapped}/{c.total}
    </Text>
  </div>
);
