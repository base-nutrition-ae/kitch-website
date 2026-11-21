# KITCH Local Demo Login — UI Smoke Test ONLY

The browser uses `kitch_team_login`, `kitch_team_workspace_info`, `kitch_team_inventory_read`, and `kitch_team_recipe_sync` in its Team flow. A fresh local Supabase stack does not contain them.

## Important
This fixture is NOT the actual KITCH database schema, business logic, authentication, inventory ledger or an authorization test. It uses a public synthetic PIN, returns empty inventory and empty recipes, and is intentionally unsuitable for any hosted database. It is for a limited visual smoke test only.

## Local-only steps
1. Keep Docker, `supabase start`, and the web server at `http://127.0.0.1:8081` running.
2. Open **http://127.0.0.1:54323** in Safari. Confirm the address is **127.0.0.1**, never supabase.com.
3. In local Supabase Studio, open **SQL Editor**.
4. Copy the full contents of `docs/local-only-demo-login.sql` from the repository and run it **only in this local Studio**.
5. Reload **http://127.0.0.1:8081**, click **Sign In → Team**.
6. Use Staff Name: **Demo Manager**; PIN: **1357**. This is a publicly documented disposable demo credential, never a real staff PIN.
7. Confirm whether the dashboard appears; report any subsequent missing RPCs. **Do not use the buttons to create stock transactions** — this is only a login/UI smoke test.

## What this test proves
Only that the local browser can connect to local RPC endpoints and render an empty staff dashboard. It does not prove security, real staff login, stock counts, FEFO, waste, production or invoice matching.

For end-to-end tests we still need a reviewed, accurate baseline schema with synthetic data. Do not reuse these four demo stubs as the basis for a production release.
