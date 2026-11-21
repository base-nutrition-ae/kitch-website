# KITCH free local staging — safe setup

**Status: launcher prepared, not run on your Mac. Database workflow tests are NOT yet passing.** The frontend repository contains a hard-coded production Supabase URL; do not run `npm run dev` for testing stock.

## Requirements
- Mac with OrbStack or Docker Desktop, plus Supabase CLI and Node.js.
- Download/clone the `kitch-final-stabilization` branch, not the live `main` branch.
- Free local testing has no additional Supabase organization subscription fee. Local computer resources are required.

Official Supabase local development guide: https://supabase.com/docs/guides/local-development

## Launch a local-only empty Supabase stack
From the repository root (Terminal):

```sh
supabase --help
supabase init
supabase start
supabase status --env
node scripts/prepare-local-staging.mjs
python3 -m http.server 8081 --directory .local-staging/public
```

Open http://localhost:8081. The launcher checks the API endpoint is `localhost` or `127.0.0.1`, replaces only the copied frontend assets, verifies the production Supabase endpoint is absent from staged JS/HTML, and never modifies `public/`.

**Do not use `npm run dev`**: that serves the original production-connected frontend.

## Essential limitation
A fresh local Supabase database is EMPTY. KITCH's established production schema, staff RPCs, login workflows, subscriptions, stock movements and recipe functions are not yet present. The four `docs/staged-kitch-cloud-*.sql` files are *incremental* scripts and **will not establish a complete baseline**. Do not assume login, receiving or inventory tests work until a safe, reviewed baseline migration and synthetic accounts are prepared. Do not import live users, PINs, payment records, or inventory.

## Release gates
1. Establish a reviewed synthetic baseline schema without copying production secrets or customer data.
2. Apply staged SQL only to this local database after dependency checks.
3. Test role boundaries, purchasing, receipts, production, FEFO, waste and concurrent physical counts.
4. Compare report exports to synthetic stock ledger.
5. Run `npm run check` on the original repository. This is static verification, not end-to-end proof.
6. Keep `main`, Netlify production and hosted KITCH Supabase untouched until staging tests pass.

Local generated files go to `.local-staging/` and must never be committed.
