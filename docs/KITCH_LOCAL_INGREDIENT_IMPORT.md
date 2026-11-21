# Fix local KITCH Ingredient Master Excel import

**LOCAL DEMO ONLY. This does not install the real production ingredient/inventory workflow.**

Your browser successfully read 25 Excel rows, but its `kitch_team_upsert_ingredient_by_staff` RPC is absent from the temporary local login fixture.

## Install the local demo import implementation
1. Keep Docker, local Supabase and KITCH preview running.
2. Open **http://127.0.0.1:54323** (local Studio). Do not use supabase.com.
3. SQL Editor → New query. Copy all of [local-only-demo-ingredient-import.sql](local-only-demo-ingredient-import.sql) and Run.
4. The SQL checks for the absence of production `ingredients` and `inventory_balances` tables before modifying the local schema. If it aborts, **stop** and do not bypass this guard.
5. Open **http://127.0.0.1:8081**, refresh, sign in as **Demo Manager** / **1357**.
6. Inventory → Upload / Import Excel → select the same 25-ingredient workbook → **Update / add ingredients** → Import.
7. After success, close the import dialog, refresh Inventory, then reload the Safari page and check that 25 ingredients remain present. Do not choose Replace.
8. If it fails, send the exact error. Don't repeatedly click Retry without inspecting the error.

## Expected behavior and limits
- Imports or updates the same ingredient name; rerunning does not duplicate rows.
- Displays unit, category, prices, PAR, minimum and *synthetic* opening quantity in local Inventory.
- Values shown are illustrative, not restaurant-stock data.
- **Not** a transaction ledger. Receiving, waste, stock count, FEFO, transfers, multi-location and production deductions are NOT implemented by this test fixture. Do not use them yet.
- This fixture exposes intentionally simple publicly known test credentials and MUST NEVER be deployed to a remote or customer database.
- Do not run `npm run dev` because it serves the production-connected frontend. Keep using the local staging preview.

Optional confirmation query in local Studio:
```sql
select count(*) as ingredient_count from public.kitch_local_demo_ingredients;
```
