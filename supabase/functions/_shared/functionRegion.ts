/**
 * Pin a function-to-function call to the database's region.
 *
 * A call from one Edge Function to another goes through the gateway and runs
 * nearest its CALLER. Moyasar's webhook, and every app call before the app
 * pinned its own calls, arrived in Mumbai (`ap-south-1`), so the POS kick and
 * the push it triggers ran there too, far from the Frankfurt database
 * (`eu-central-1`). Measured over 24 h to 2026-11-18 14:40 UTC, average
 * execution: lazywait-sync 0.65 s in Frankfurt, 5.7 s in Mumbai; push-dispatch
 * 1.1 s in Frankfurt, 3.2 s in Mumbai.
 *
 * `forceFunctionRegion` is Supabase's documented query parameter for this
 * (https://supabase.com/docs/guides/functions/regional-invocation). The
 * receiving function reads only its body and headers, so the parameter changes
 * nothing it does. Keep FUNCTION_REGION equal to the app's
 * (apps/mobile/src/lib/functionRegion.ts) and to the project's region.
 */
export const FUNCTION_REGION = 'eu-central-1';

export function internalFunctionUrl(supabaseUrl: string, name: string): string {
  return `${supabaseUrl}/functions/v1/${name}?forceFunctionRegion=${FUNCTION_REGION}`;
}
