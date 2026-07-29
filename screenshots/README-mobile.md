# Mobile screenshot harness

The customer app is gated behind a real Supabase session, so its screens cannot
be captured without credentials — and pointing a screenshot harness at
Production is not something to do casually.

`SPICY_MEAL_PREVIEW=1` makes `apps/mobile/metro.config.js` resolve
`services/api` to `apps/mobile/preview/apiStub.ts`, which returns demo rows for
the whole module surface. The screens, providers, navigation, i18n and theme are
the real ones; only the data is synthetic. Without that variable Metro never
resolves the stub, so the released bundle is unaffected.

```bash
cd apps/mobile
SPICY_MEAL_PREVIEW=1 npx expo start --web --port 8085
# in another shell, from the repo root:
node screenshots/mobile-capture.mjs          # both languages
node screenshots/mobile-capture.mjs en       # one language
```

Full-resolution PNGs land in `screenshots/mobile-out/` (gitignored). The
reviewed, downscaled copies are committed to `screenshots/mobile/`.
