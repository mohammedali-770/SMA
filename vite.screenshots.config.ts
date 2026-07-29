/**
 * Vite config for the screenshot harness only.
 *
 * Aliases the app context to a demo-data stub so the console renders without a
 * Supabase session. This config is never used by `npm run build` — the shipped
 * app is built by vite.config.ts and is unaffected.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^(\.\.\/)+context\/AppContext$/,
        replacement: fileURLToPath(new URL('./screenshots/AppContextStub.tsx', import.meta.url)),
      },
      {
        find: /^\.\/context\/AppContext$/,
        replacement: fileURLToPath(new URL('./screenshots/AppContextStub.tsx', import.meta.url)),
      },
    ],
  },
  server: { port: 4180, host: '127.0.0.1' },
});
