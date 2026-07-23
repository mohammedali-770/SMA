/**
 * Web export wrapper: injects the PUBLIC client env (same shippable values as
 * the eas.json build env — the anon key is public by design; RLS is the
 * security boundary) and runs the Expo static export. A committed script is
 * used instead of a .env file because the repo gitignores .env* everywhere,
 * and the Vercel build must be reproducible from a clean checkout.
 * NO secrets belong in this file.
 */
const { spawnSync } = require('child_process');

const env = {
  ...process.env,
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL
    ?? 'https://wxfmmnihidsdyemasstf.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4Zm1tbmloaWRzZHllbWFzc3RmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NzM3MzIsImV4cCI6MjA5OTA0OTczMn0.F4xEfsAXqvGfXvcaEqzdrbWi5RoTJBVYo4OophZYeKo',
  // Sentry (web) build metadata — PUBLIC values only. Vercel provides
  // VERCEL_ENV ('production' | 'preview') and the deploy commit sha at build
  // time; mapping them into EXPO_PUBLIC_* lets Metro inline them so the /app
  // bundle tags its environment/release correctly. Absent locally → the
  // runtime falls back to hostname heuristics (see observability/webConfig).
  // The SENTRY_AUTH_TOKEN secret is NOT read or forwarded here.
  ...(process.env.VERCEL_ENV ? { EXPO_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV } : {}),
  ...(process.env.VERCEL_GIT_COMMIT_SHA
    ? { EXPO_PUBLIC_WEB_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA } : {}),
};

// `npx` is `npx.cmd` on Windows. Node >= 22 refuses to spawn a .cmd/.bat
// without a shell (EINVAL, CVE-2024-27980 hardening) and the bare `npx`
// name is otherwise unresolved (ENOENT), so on Windows the export must run
// through the shell. Linux CI/Vercel keep the original no-shell spawn. The
// argument list is fixed and contains no shell metacharacters, so enabling
// the shell here is safe (DEP0190).
const r = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--clear', '--output-dir', '../../dist/app'], {
  env, stdio: 'inherit', cwd: __dirname + '/..', shell: process.platform === 'win32',
});

// Surface a spawn failure (e.g. binary not found) instead of exiting 1
// silently, which previously masked the Windows failure above.
if (r.error) {
  console.error('[export-web] failed to run expo export:', r.error.message);
}
process.exit(r.status ?? 1);
