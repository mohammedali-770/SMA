# Admin console screenshots

Captures of the real admin console, used as the visual record for the WCAG
contrast pass.

The console is gated behind a Supabase session, so it cannot be captured without
credentials — and pointing a harness at Production is not something to do
casually. `AppContextStub.tsx` supplies the same context contract from the
repository's own bundled demo data instead, so the **real components** render
with the **real stylesheet** and only the data is synthetic.

```bash
npx vite --config vite.screenshots.config.ts   # terminal 1
node screenshots/capture.mjs                   # terminal 2
```

Output: `out/*.png` (full resolution, gitignored) and `web/*.jpg` (downscaled,
committed).

Nothing here ships. `vite.screenshots.config.ts` is a separate config and the
context alias exists only there; the production build uses `vite.config.ts` and
never resolves the stub.

`capture.mjs` matches sidebar tabs by their rendered label, so renaming a tab
fails the run loudly rather than silently capturing the wrong panel.
