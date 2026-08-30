# VHC Warehouse — Mobile

Expo (SDK 57) / React Native companion app for the VHC Warehouse + Pharmacy
Supabase backend. Read-through dashboards plus stock, orders, alerts, and
admin/backup tooling.

## Requirements

- Node 20+
- A Supabase project with the schema in `../supabase/migrations` applied
- Expo CLI via `npx expo` (no global install needed)

## Setup

```bash
npm install
cp .env.example .env   # then fill in your Supabase URL + publishable anon key
npm start
```

`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are required. The
anon key is a *publishable* key (RLS enforces access), safe to ship in the
bundle. The app throws a clear error on startup if either is missing.

## Scripts

| command | purpose |
| --- | --- |
| `npm start` | Expo dev server |
| `npm run android` / `npm run ios` / `npm run web` | platform dev targets |
| `npm test` | Jest unit tests |
| `npm run lint` | ESLint |
| `npm run verify` | lint + tests + `expo export` production bundle |

## Builds (EAS)

Profiles are defined in `eas.json`; each carries the `EXPO_PUBLIC_*` env it needs.

```bash
npx eas build --profile development --platform android   # dev client
npx eas build --profile preview --platform android      # internal APK
npx eas build --profile production --platform android    # store build
```

To move Supabase config out of `eas.json`, set the two `EXPO_PUBLIC_*` vars as
EAS project Environment Variables and delete the `env` blocks.

## Backend

The DB is shared with the desktop Warehouse app and Pharmacy POS. Migrations are
applied manually via the Supabase SQL editor — see `../supabase/README.md`.
`supabase/migrations/_DRAFT_*` files are **not applied**; see their headers.
