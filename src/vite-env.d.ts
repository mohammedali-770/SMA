/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  /** The new opaque publishable key; wins over the anon key when set (src/lib/supabaseKey.ts). */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Legacy JWT anon key — retired by Supabase by end-2026 (docs/SUPABASE_API_KEYS.md). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
