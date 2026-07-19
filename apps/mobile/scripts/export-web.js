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
};

const r = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--clear', '--output-dir', '../../dist/app'], {
  env, stdio: 'inherit', cwd: __dirname + '/..',
});
process.exit(r.status ?? 1);
