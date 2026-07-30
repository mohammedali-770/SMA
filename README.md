# 🌶️ Spicy Meal — Monorepo Platform

A prototype for a Saudi fast-food brand ("Spicy Meal") that combines three
synchronized surfaces in one interactive sandbox:

- **📱 Customer Mobile App** — an Expo/React-Native-style ordering emulator
  (bilingual EN/AR, menu with modifier groups, cart, Saudi short-address
  checkout, VAT-inclusive invoicing, and loyalty points).
- **🖥️ Admin POS Panel** — an administrative command center for live orders,
  menu/category CRUD, per-branch availability, bulk CSV menu upload, and
  brand/payment/SMS/notification/loyalty settings.
- **⚙️ Supabase Console** — a live view of the in-memory PostgreSQL-style
  tables backing the app.

All three views share a single client-side store (React Context + a
`localStorage`-backed emulator), so an action on one screen updates the others
in real time.

## Tech stack

- [Vite 6](https://vitejs.dev/) + [React 19](https://react.dev/) + TypeScript
- [Tailwind CSS 4](https://tailwindcss.com/) (via `@tailwindcss/vite`)
- [lucide-react](https://lucide.dev/) icons, [motion](https://motion.dev/) animation

## Getting started

**Node 22 is the repository standard** — `.nvmrc` is the single source of truth
and every CI workflow reads it. Node 20 cannot run the unit suite at all. See
[docs/NODE_VERSION.md](docs/NODE_VERSION.md).

```bash
# Match the repository's Node version
nvm use

# Install dependencies
npm install

# Start the dev server (http://localhost:3000)
npm run dev

# Type-check the project
npm run lint

# Produce a production build in dist/
npm run build

# Preview the production build locally
npm run preview
```

## Project structure

```
src/
  App.tsx                     # Top-level shell + workspace tab switcher
  main.tsx                    # React entry point
  index.css                   # Tailwind theme + frosted-glass utilities
  types.ts                    # Shared domain types
  context/AppContext.tsx      # Global store: cart, orders, menu, settings
  data/initialData.ts         # Seed branches, menu, modifiers, orders, settings
  utils/calculations.ts       # VAT breakdown, Haversine distance, CSV menu parser
  components/
    MobileEmulator.tsx        # Customer ordering app
    AdminDashboard.tsx        # Administrative POS panel
    DatabasePlayground.tsx    # Live database table inspector
```

## Mobile (Expo) wrapper

This directory also carries an Expo/EAS configuration (`app.json`, `eas.json`,
`babel.config.js`, `metro.config.js`) for packaging the web app into native
Android/iOS binaries. See [`README_MOBILE.md`](./README_MOBILE.md) for the EAS
build instructions.

## Configuration

Copy `env.example` to `.env` and populate values as needed
(`GEMINI_API_KEY`, `APP_URL`). These are optional for local UI development.
