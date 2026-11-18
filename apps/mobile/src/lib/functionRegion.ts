/**
 * Where the app's Edge Function calls RUN.
 *
 * Supabase runs a function in the region nearest the caller unless told
 * otherwise. For customers in Saudi Arabia that is Mumbai (`ap-south-1`), while
 * the database is in Frankfurt (`eu-central-1`, the project's region). Every
 * function reads and writes the database several times per call, and each of
 * those round trips crossed Mumbai-Frankfurt. Measured over 24 h to
 * 2026-11-18 14:40 UTC (average execution time):
 *
 *   lazywait-sync   Frankfurt 0.65 s   Mumbai 5.7 s
 *   push-dispatch   Frankfurt 1.1 s    Mumbai 3.2 s
 *   order-intake    Mumbai 7.9 s; payment-verify 3.4 s; payment-initiate 2.3 s
 *                   (no Frankfurt runs: every app call landed in Mumbai)
 *
 * Supabase's own guidance is to run database-heavy functions in the database's
 * region (https://supabase.com/docs/guides/functions/regional-invocation).
 *
 * HOW: the `forceFunctionRegion` QUERY PARAMETER only. supabase-js's own
 * `region` option also sends an `x-region` HEADER, which our functions' CORS
 * allow-list (`_shared/cors.ts`) does not include, so the web build's
 * preflight would refuse it. The query parameter needs no CORS change and no
 * server deploy; it is the form Supabase documents for CORS requests.
 *
 * A pinned region is not re-routed during a regional outage. That costs
 * nothing here: the database is in this region, so an outage of it stops the
 * functions regardless of where they run.
 */
export const FUNCTION_REGION = 'eu-central-1';

/** The function name with the region pin, as `supabase.functions.invoke` takes it. */
export function regionalFunction(name: string): string {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Unexpected function name: ${name}`);
  return `${name}?forceFunctionRegion=${FUNCTION_REGION}`;
}
