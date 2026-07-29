import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Loader2, AlertCircle, Check, X, DownloadCloud, CheckCircle2, Circle } from 'lucide-react';
import {
  catalog, lazywaitCatalog,
  DbBranch, DbCategory, DbProduct, DbModifierGroup, DbModifier,
  DbLazywaitCatalogItem, LazywaitMappingStatus, LazywaitPullResult, LazywaitImportResult,
  LazywaitCatalogEntity, LazywaitMappingEntity, LazywaitPriceRef,
} from '../../lib/api';
import { suggestBestMatch, MatchLevel } from '../../lib/lazywaitMatch';

/**
 * Admin catalog mapping: pull the Lazywait catalog server-side, review suggested
 * matches (by normalized Arabic/English/Turkish name), and CONFIRM ID mappings
 * onto local records — never overwriting local names/prices, never exposing a
 * secret. Accountants (disabled) can view status but not edit.
 */
const ENTITIES: { key: LazywaitMappingEntity; catalogType: LazywaitCatalogEntity; label: string }[] = [
  { key: 'branch', catalogType: 'branch', label: 'Branches' },
  { key: 'category', catalogType: 'category', label: 'Categories' },
  { key: 'product', catalogType: 'item', label: 'Products' },
  { key: 'modifier_group', catalogType: 'addon_group', label: 'Groups' },
  { key: 'modifier', catalogType: 'addon', label: 'Modifiers' },
];

const LEVEL_TONE: Record<MatchLevel, string> = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-orange-100 text-orange-700',
  none: 'bg-slate-100 text-slate-400',
};

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
      <div className="flex justify-between items-center">
        <div>
          <span className="text-[10px] font-black text-slate-600">Catalog Mapping</span>
          <p className="text-[8.5px] text-slate-600 font-medium mt-0.5">
            {status?.last_pull_at ? `Last pull ${new Date(status.last_pull_at).toLocaleString()}` : 'Not pulled yet'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={runPull}
            disabled={disabled || pulling || importing || loading}
            className="glass-btn-primary text-[9px] py-1.5 px-3 font-black text-white disabled:opacity-50 flex items-center gap-1"
          >
            {pulling ? <Loader2 className="w-3 h-3 animate-spin" /> : <DownloadCloud className="w-3 h-3" />} Pull from Lazywait
          </button>
          <button
            onClick={runImport}
            disabled={disabled || importing || pulling || loading || items.length === 0}
            title={items.length === 0 ? 'Pull the Lazywait catalog first' : 'Import the pulled catalog into your app menu'}
            className="glass-btn-primary text-[9px] py-1.5 px-3 font-black text-white disabled:opacity-40 flex items-center gap-1"
          >
            {importing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Import to App
          </button>
        </div>
      </div>

      {error && <div className="text-[10px] font-bold text-red-700 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{error}</div>}
      {msg && <div className="text-[10px] font-bold text-green-700 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{msg}</div>}
      {pull && pull.errors.length > 0 && (
        <div className="text-[9px] font-bold text-amber-700 bg-amber-50 rounded-lg p-2 space-y-0.5">
          {pull.errors.map((e, i) => <div key={i}>⚠ {e.endpoint}: {e.message}</div>)}
        </div>
      )}

      {/* Readiness + summary */}
      {status && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="glass-card rounded-xl p-2.5 bg-white/40">
            <div className="text-[9px] font-black mb-1.5 flex items-center gap-1.5">
              Pickup sync readiness
              <span className={`px-1.5 py-0.5 rounded-full text-[8px] ${status.readiness.ready ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                {status.readiness.ready ? 'READY' : 'NOT READY'}
              </span>
            </div>
            <div className="space-y-1">
              {readinessItems.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[9.5px] font-bold text-slate-600">
                  {r.ok ? <CheckCircle2 className="w-3 h-3 text-green-700" /> : <Circle className="w-3 h-3 text-slate-500" />}
                  {r.label}
                </div>
              ))}
            </div>
          </div>
          <div className="glass-card rounded-xl p-2.5 bg-white/40">
            <div className="text-[9px] font-black mb-1.5">Mapping status</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[9.5px] font-bold text-slate-600">
              <SummaryRow label="Branches" c={status.branches} />
              <SummaryRow label="Categories" c={status.categories} />
              <SummaryRow label="Products" c={status.products} />
              <SummaryRow label="Groups" c={status.modifier_groups} />
              <SummaryRow label="Modifiers" c={status.modifiers} />
              <div className="flex justify-between">
                <span>Blocked orders</span>
                <span className={status.blocked_orders ? 'text-red-700' : 'text-green-600'}>{status.blocked_orders}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Entity tabs */}
      <div className="flex gap-1 flex-wrap">
        {ENTITIES.map((e) => {
          const c = status?.[e.key === 'modifier_group' ? 'modifier_groups' : (e.key === 'branch' ? 'branches' : e.key === 'category' ? 'categories' : e.key === 'product' ? 'products' : 'modifiers')];
          return (
            <button
              key={e.key}
              onClick={() => setTab(e.key)}
              className={`text-[9px] font-black px-2.5 py-1 rounded-full ${tab === e.key ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {e.label}{c ? ` ${c.mapped}/${c.total}` : ''}
            </button>
          );
        })}
      </div>

      {/* Mapping table for the active entity */}
      {loading ? (
        <div className="text-[10px] text-slate-600 font-bold flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
      ) : cands.length === 0 ? (
        <p className="text-[10px] text-slate-600 font-medium">No Lazywait {active.label.toLowerCase()} pulled yet — click “Pull from Lazywait”.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-slate-600 font-bold text-xs text-left">
                <th className="py-1 pr-2">Local (EN / AR)</th>
                <th className="py-1 pr-2">Suggested match</th>
                <th className="py-1 pr-2">Map to Lazywait</th>
                <th className="py-1 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const suggestion = suggestBestMatch<DbLazywaitCatalogItem>(row, cands);
                const selectedId = chosen[row.id] ?? row.currentId ?? suggestion?.candidate.lazywait_id ?? '';
                const selectedCand = cands.find((c) => c.lazywait_id === selectedId);
                const prices = (tab === 'product' && selectedCand?.prices) || [];
                return (
                  <tr key={row.id} className="border-t border-slate-100 align-top">
                    <td className="py-1.5 pr-2">
                      <div className="font-bold text-slate-700">{row.nameEn || '—'}</div>
                      <div className="text-slate-600" dir="rtl">{row.nameAr || '—'}</div>
                      {row.currentId && (
                        <span className="inline-flex items-center gap-1 text-[8px] font-black text-green-700 mt-0.5">
                          <Check className="w-2.5 h-2.5" /> mapped: {row.currentId}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      {suggestion ? (
                        <div>
                          <div className="text-slate-600 font-semibold">{catalogLabel(suggestion.candidate)}</div>
                          <span className={`inline-block px-1.5 py-0.5 rounded-full font-black text-[8px] mt-0.5 ${LEVEL_TONE[suggestion.level]}`}>
                            {suggestion.level}{suggestion.requiresConfirmation ? ' · review' : ''}
                          </span>
                        </div>
                      ) : <span className="text-slate-600">no suggestion</span>}
                    </td>
                    <td className="py-1.5 pr-2 space-y-1">
                      <select
                        value={selectedId}
                        disabled={disabled}
                        aria-label={`Lazywait mapping for ${row.nameEn || row.id}`}
                        onChange={(e) => setChosen((m) => ({ ...m, [row.id]: e.target.value }))}
                        className="glass-input p-1 text-[10px] w-full max-w-[220px] disabled:opacity-50"
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
                          className="glass-input p-1 text-[9px] w-full max-w-[220px] disabled:opacity-50"
                        >
                          {prices.map((pr, i) => (
                            <option key={i} value={pr.price_id ?? ''}>
                              {(pr.name || 'price')}{pr.price_with_vat != null ? ` — ${pr.price_with_vat}` : ''}{pr.price_id ? ` (${pr.price_id})` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => confirm(tab, row, selectedId, cands)}
                        disabled={disabled || !selectedId || busy === row.id}
                        className="glass-btn-primary text-[9px] py-1 px-2.5 font-black text-white disabled:opacity-40 inline-flex items-center gap-1"
                      >
                        {busy === row.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Confirm
                      </button>
                      {row.currentId && (
                        <button
                          onClick={() => clear(tab, row)}
                          disabled={disabled || busy === row.id}
                          className="text-[9px] py-1 px-2 font-black text-red-700 disabled:opacity-40 inline-flex items-center gap-1 ml-1"
                        >
                          <X className="w-3 h-3" /> Clear
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[8.5px] text-slate-600 font-medium leading-snug">
        <b>Import to App</b> makes Lazywait the menu source: it creates/updates your categories &amp; products from
        the latest pull (prices from Lazywait), hides local items not in Lazywait, and keeps branch delivery settings.
        Individual <b>Confirm</b> mappings below only link IDs (they never overwrite local data). price_id,
        addons/modifiers and delivery are mapped for reference but intentionally NOT sent in Create Order yet.
      </p>
    </div>
  );
};

const SummaryRow: React.FC<{ label: string; c: { mapped: number; total: number } }> = ({ label, c }) => (
  <div className="flex justify-between">
    <span>{label}</span>
    <span className={c.total > 0 && c.mapped === c.total ? 'text-green-700' : 'text-slate-500'}>{c.mapped}/{c.total}</span>
  </div>
);
