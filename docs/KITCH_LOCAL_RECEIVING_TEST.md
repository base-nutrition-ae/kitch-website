# KITCH local demo — Receiving smoke test

This is a **local-only stub** for practicing a single receiving workflow with synthetic ingredients. Not production logic, true role authorization, supplier matching, proof storage, FEFO, batch consumption, valuation accounting or invoice approvals.

## Install
1. Keep Supabase local Docker and KITCH preview running.
2. Open **http://127.0.0.1:54323** (NOT hosted Supabase).
3. In SQL Editor, run the entire `docs/local-only-demo-receiving.sql` file. It requires the earlier local demo ingredient fixture and stops if the real production-style ingredients or inventory_balances tables exist.
4. Expect `local_demo_receipt_count = 0` if no demo receipts exist.

## Test one sample receipt
1. In KITCH at **http://127.0.0.1:8081**, log in with synthetic **Demo Manager / 1357**.
2. Inventory: note Brown Rice's opening quantity (15 kg = 15,000 g).
3. Open **More → Receiving → + New Receiving**.
4. Select **Brown Rice**; supplier `Demo Supplier B`; invoice `LOCAL-RCPT-001`; delivered `1000` g; rejected `100` g; price `0.008` AED/g; expiry optional; **leave invoice attachment empty**.
5. Confirm. Expected accepted 900 g and new balance 15,900 g (15.9 kg). The same invoice/ingredient combination is rejected on a second attempt to prevent duplicate receipt in this demo.
6. Check Receiving history for a line of 900 g and total AED 7.20, then refresh and verify Brown Rice remains at 15.9 kg.

## Safety
- No real records, PINs, invoices or payments.
- Never paste this into online Supabase or merge it as a production migration.
- This implementation updates a single demo balance and stores simple receipt lines only; it does **not** implement stock movement accounting, weighted average costing, FEFO or permissions. The production code remains blocked until a true baseline schema, security and concurrency tests exist.
- Avoid **Production, Waste, Stock Count, Transfers and Invoice Matching** writes in this local smoke-test environment.
