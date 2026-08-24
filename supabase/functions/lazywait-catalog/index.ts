import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, userClient } from '../_shared/supabaseClient.ts';
import { getProviderConfig } from '../_shared/secrets.ts';
import { lazywaitFetch, resolveLazywaitBaseUrl, type LazywaitConfig } from '../_shared/lazywait.ts';
import {
  type CatalogEntityType, normalizeCatalogPayload,
} from '../_shared/lazywaitCatalog.ts';

/**
 * lazywait-catalog — admin-initiated, SERVER-SIDE catalog pull.
 *
 * Pulls the confirmed Lazywait catalog endpoints and caches the normalized
 * records in `lazywait_catalog_items` so the admin can review suggested matches
 * and confirm ID mappings. The Lazywait API token stays server-side (read from
 * integration_settings via the service role); only non-secret catalog data
 * (names/ids/prices) and counts are ever returned.
 *
 * verify_jwt = true (config.toml) — plus an explicit is_admin() check, since a
 * valid JWT alone doesn't imply an admin. Never called by the app's customers.
 */
const ENDPOINTS: { entity: CatalogEntityType; path: string; key: string }[] = [
  { entity: 'branch',      path: '/platform/branches',          key: 'branches' },
  { entity: 'category',    path: '/menu/products/categories',   key: 'categories' },
  { entity: 'item',        path: '/menu/products/items',        key: 'items' },
  { entity: 'addon',       path: '/menu/addons',                key: 'addons' },
  { entity: 'addon_group', path: '/menu/addons-groups',         key: 'addon_groups' },
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // ---- Admin authorization (JWT already verified by the gateway) -----------
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);
  const asUser = userClient(authHeader);
  const { data: isAdmin, error: adminErr } = await asUser.rpc('is_admin');
  if (adminErr) return json({ error: 'authorization check failed' }, 500);
  if (isAdmin !== true) return json({ error: 'admin only' }, 403);

  const admin = adminClient();
  const cfg = await getProviderConfig(admin, 'lazywait');
  if (!cfg) return json({ error: 'lazywait not configured' }, 400);

  // Base URL: FAIL CLOSED. No fallback to the production host — a blank
  // base_url must not silently point catalog pulls (and the admin mapping UI
  // built from them) at a POS this branch does not use.
  const resolvedBase = resolveLazywaitBaseUrl((cfg.publicConfig as Record<string, unknown>).base_url);
  if (!resolvedBase.ok) return json({ error: resolvedBase.reason }, 400);

  const lw: LazywaitConfig = {
    baseUrl: resolvedBase.baseUrl,
    clientId: String((cfg.publicConfig as Record<string, unknown>).client_id ?? ''),
    apiToken: String((cfg.secretConfig as Record<string, unknown>).api_token ?? ''),
  };
  if (!lw.clientId || !lw.apiToken) {
    return json({ error: 'lazywait config missing client_id or api_token' }, 400);
  }

  const pulledAt = new Date().toISOString();
  const counts: Record<string, number> = {};
  const errors: { endpoint: string; message: string }[] = [];

  for (const ep of ENDPOINTS) {
    try {
      const res = await lazywaitFetch<unknown>(lw, { method: 'GET', path: ep.path, timeoutMs: 20000 });
      if (!res.ok) {
        counts[ep.key] = 0;
        errors.push({ endpoint: ep.path, message: safeErr(res.error) });
        continue;
      }
      const records = normalizeCatalogPayload(ep.entity, res.data);
      counts[ep.key] = records.length;

      if (records.length) {
        const rows = records.map((r) => ({
          entity_type: r.entity_type,
          lazywait_id: r.lazywait_id,
          name_en: r.name_en,
          name_ar: r.name_ar,
          name_other: r.name_other,
          parent_id: r.parent_id,
          prices: r.prices,
          branches_ids: r.branches_ids,
          min_selection: r.min_selection,
          max_selection: r.max_selection,
          multi_max: r.multi_max,
          raw: r.raw,
          pulled_at: pulledAt,
        }));
        const { error: upErr } = await admin
          .from('lazywait_catalog_items')
          .upsert(rows, { onConflict: 'entity_type,lazywait_id' });
        if (upErr) {
          errors.push({ endpoint: ep.path, message: safeErr(upErr.message) });
          continue;
        }
        // Prune rows of this entity that were NOT refreshed this run (removed
        // from Lazywait). Only when the pull succeeded with records, so a failed
        // or empty endpoint never wipes the cache.
        await admin.from('lazywait_catalog_items')
          .delete().eq('entity_type', ep.entity).lt('pulled_at', pulledAt);
      }
    } catch (e) {
      counts[ep.key] = 0;
      errors.push({ endpoint: ep.path, message: safeErr(e instanceof Error ? e.message : String(e)) });
    }
  }

  const status = errors.length === 0 ? 'success'
    : errors.length === ENDPOINTS.length ? 'error' : 'partial';

  await admin.from('lazywait_catalog_pulls').insert({ status, counts, errors });

  // Always 200 so the admin UI receives the structured (sanitized, non-secret)
  // per-endpoint errors; the `status` field distinguishes success/partial/error.
  return json({ status, counts, errors, pulled_at: pulledAt }, 200);
});

/** Truncate + strip anything token-shaped before returning/storing an error. */
function safeErr(msg: string | null | undefined): string {
  if (!msg) return 'unknown';
  return msg.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***').slice(0, 300);
}
