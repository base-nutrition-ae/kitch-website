# KITCH — Local multi-item Receiving

This is an isolated **local synthetic demonstration**. It is not the production stock ledger, supplier invoice authorization, real staff permissions, HACCP workflow, or file attachment service.

## What was built
- One supplier + one invoice header, up to 100 ingredient lines
- Ingredient name selector; separate receiving unit per line
- g/kg, ml/ltr, pcs, pkt/box with explicit pack quantity and size unit
- Delivered and rejected quantity, invoice unit price, expiry, production date and optional temperature per line
- Preview of converted accepted stock and invoice total
- One database RPC `kitch_team_receive_invoice_demo`: all accepted quantities commit together or all roll back
- Expired items, bad units, repeated ingredients and duplicate supplier invoices blocked in local SQL
- Receiving History groups lines into one supplier invoice row and one printable report

## Install SQL in local Supabase ONLY

1. Open **http://127.0.0.1:54323** (do not open your online Supabase dashboard).
2. Open SQL Editor → New Query and paste ALL of [local-only-demo-multi-receiving.sql](local-only-demo-multi-receiving.sql).
3. Click Run. The final result is `saved_demo_receipt_lines` and should show the count of your previously saved demo receipt lines.

## Update local KITCH preview

In the Terminal window *not* running Python, run one at a time:

```bash
cd ~/Downloads/kitch-website-kitch-final-stabilization
curl -fL https://raw.githubusercontent.com/base-nutrition-ae/kitch-website/kitch-final-stabilization/public/index.html -o public/index.html
curl -fL https://raw.githubusercontent.com/base-nutrition-ae/kitch-website/kitch-final-stabilization/public/assets/kitch-multi-receiving.js -o public/assets/kitch-multi-receiving.js
node scripts/prepare-local-staging.mjs
```

Leave your Python web server running. Open **http://127.0.0.1:8081**, press Cmd+Shift+R, sign in Demo Manager/1357, open Receiving → + New Receiving.

## Example test (use a new synthetic invoice)

Header: Supplier `Demo Supplier B`, Invoice `LOCAL-MULTI-003`

- Brown Rice: 1 kg delivered; 0.1 kg rejected; AED 8/kg; expiry 2027-06-30 → accepted 900 g, AED 7.20.
- Broccoli: 2 boxes delivered; 0 rejected; 5 kg per box; AED 80/box; expiry 2027-06-30 → accepted 10,000 g, AED 160.

Expected total: **AED 167.20**, two ingredient lines saved together, and one grouped Receiving history row. Brown Rice stock rises by 0.9 kg, Broccoli stock by 10 kg.

If any line is invalid (expiry in past, incorrect conversion, duplicate ingredient), the entire transaction is rejected without applying another line.

**Do not use a previous invoice number** such as `f5555`. Do not attach actual supplier files. This local fixture does not store attachments or implement batch-level FEFO, weighted average costing, food safety approval, production deductions, or secure production staff authorization.
