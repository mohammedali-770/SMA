import { corsHeaders, json } from '../_shared/cors.ts';

/**
 * latency-probe — a THROWAWAY diagnostic. Delete it once the question below is
 * answered; it exists to settle one thing and has no place in the product.
 *
 * THE QUESTION. On 2026-08-30 the gateway's `origin_time` showed PostgREST calls
 * from Mumbai ranging 165-1265 ms while the same statements from Frankfurt cost
 * 26-35 ms. The cross-region difference is established (same statement, same
 * function, same minute — docs/ORDER_CONFIRMATION_FLOW.md). What is NOT
 * established is the spread WITHIN Mumbai. A tempting reading was "each cold
 * isolate pays ~1 s once to open its connection, then ~180 ms per call", and
 * review rejected it: the calls in that trace do different work, two of them run
 * concurrently, and the sequence is not monotonic.
 *
 * THE DESIGN, which removes every one of those objections.
 *
 *   1. ONE statement, repeated. Every request is byte-identical, so query cost is
 *      a CONSTANT and cannot explain any difference between call 1 and call N.
 *      This is the whole trick; nothing else in the design matters as much.
 *   2. STRICTLY SEQUENTIAL. Each call is awaited before the next starts, so
 *      there is no concurrency and no pool contention between them.
 *   3. `isolate_age_ms` is reported, so a COLD run (near zero) and a WARM run
 *      (large) can be told apart. That is the actual experiment:
 *
 *        cold isolate, call 1 slow, calls 2..N fast  -> per-isolate setup cost
 *        warm isolate, ALL calls fast                -> confirms it is per-isolate
 *        every call the same, cold and warm alike    -> the setup story is dead
 *
 *   4. A final call to a DIFFERENT trivial table, to show whether "warm" is a
 *      property of the connection or of the specific query.
 *
 * SAFETY. Read-only, and deliberately at the LOWEST privilege available: it
 * authenticates as `anon` with the publishable key, reading `branches` — which
 * `branches_select_active_public` (migration 20260810143000) grants to anon for
 * active rows. It holds no service-role key, writes nothing, touches no order,
 * and logs numbers only. The single column it selects is `id`.
 *
 * NO npm DEPENDENCY, so its own boot is not the thing being measured.
 */

const MODULE_LOADED_AT = Date.now();

/** Sequential repetitions of the identical statement. */
const REPEATS = 8;

/** Identifies these requests in the gateway log, where `origin_time` lives. */
const CLIENT_INFO = 'sma-latency-probe/1';

Deno.serve(async (req: Request) => {
  const t0 = Date.now();
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')?.replace(/\/+$/, '');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return json({ error: 'Missing SUPABASE_URL / SUPABASE_ANON_KEY' }, 500);

  const headers = {
    apikey: anon,
    Authorization: `Bearer ${anon}`,
    'Accept-Profile': 'public',
    'X-Client-Info': CLIENT_INFO,
  };

  // The identical statement. Built once and reused verbatim so there is no
  // chance of the requests differing by a character.
  const same = `${url}/rest/v1/branches?select=id&is_active=eq.true&limit=1`;
  const other = `${url}/rest/v1/categories?select=id&limit=1`;

  const ms: number[] = [];
  const status: number[] = [];
  for (let i = 0; i < REPEATS; i += 1) {
    const s = Date.now();
    try {
      const res = await fetch(same, { headers });
      await res.text();
      status.push(res.status);
    } catch {
      status.push(0);
    }
    ms.push(Date.now() - s); // sequential: this await completes before the next starts
  }

  // A DIFFERENT trivial read, last, on the now-warm connection.
  const otherStart = Date.now();
  let otherStatus = 0;
  try {
    const res = await fetch(other, { headers });
    await res.text();
    otherStatus = res.status;
  } catch { /* recorded as 0 */ }
  const otherMs = Date.now() - otherStart;

  // Numbers only. No rows, no ids, no headers, no key material.
  const out = {
    at: 'latency-probe',
    isolate_age_ms: t0 - MODULE_LOADED_AT,
    repeats: REPEATS,
    same_query_ms: ms,
    same_query_status: status,
    other_query_ms: otherMs,
    other_query_status: otherStatus,
    total_ms: Date.now() - t0,
  };
  console.log(JSON.stringify(out));
  return json(out);
});
