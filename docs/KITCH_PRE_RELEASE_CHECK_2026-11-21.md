# KITCH final stabilization — controlled pre-release verification

Date: 2026-11-21
Branch: `kitch-final-stabilization`
**Status: NOT production-ready. No deployment approved.**

## Tests performed
- Frontend `public/assets/kitch-1.js` parsed successfully with JavaScript syntax validation.
- Each staged SQL migration executed successfully inside a PostgreSQL `BEGIN ... ROLLBACK` transaction:
  - `docs/staged-kitch-cloud-purchasing.sql`
  - `docs/staged-kitch-cloud-lots-fefo.sql`
  - `docs/staged-kitch-cloud-stock-controls.sql`
  - `docs/staged-kitch-cloud-stock-count.sql`
- Read-only postcheck: **1** receiving entry and **34** inventory movements; all four new cloud tables are absent. No data was imported, deleted, or manually adjusted.

## What these tests do NOT prove
- No signed-in staff RPC tests or browser UI integration tests were performed.
- No stock changes, invoicing approvals, receipt linking or FEFO allocation were executed.
- No concurrency/idempotency tests with real stock were performed.
- Rollback checks validate SQL can be created on the existing schema, not that workflows correctly behave.
- Published Netlify remains separate from this development branch.

## Release blockers
1. **FEFO is not automated.** Lot allocation remains a staged, manually invoked process. Production/waste/adjustment movements are not automatically consumed against the earliest-expiry lots. Stock balances must not be described as FEFO-reconciled.
2. **Cloud Stock Count concurrency needs testing.** The staged count reconciles current stock via movements, but other stock-writing RPCs must use the same ingredient/branch locking convention to prevent concurrent overselling/overwriting. Test with overlapping waste, receiving and production transactions.
3. **Browser-only legacy records remain.** Existing PO-0001, suppliers, historical waste/counts and exports are not automatically migrated or synchronized. There is no verified PO-to-receipt migration.
4. **Cloud Reports are only partially integrated.** Receiving totals are shown separately; CSV and Excel exports still use browser-local data.
5. **No full-role or multi-location security tests.** Test permissions with manager, receiving staff, production staff, separate branches, and invalid PINs.
6. **Cloud stock-control transaction retries must be tested.** Test duplicate and changed-payload transaction IDs as well as network failure after a successful write.
7. **No safe staging environment exists yet.** Any deployed client must not expose untested writes to production stock before a separately isolated test database or a transaction-safe test workflow is established.

## Required release gates
- Set up a non-production Supabase environment with synthetic stock and staff.
- Run migrations and check RPC permissions/RLS.
- Test Purchase Request → approve → mark sent → receive → link receipt → invoice review including mismatches, duplicate receipts, partial deliveries, and rejected amounts.
- Test expiry/FEFO with multiple lots, usage and waste; verify exact remaining quantity.
- Test waste, plus/minus adjustment, physical count finalization and concurrent updates; verify inventory movements and idempotency.
- Test reports and Excel/CSV outputs against cloud records.
- Test Safari and mobile layout with representative data.
- Only after passing these tests, merge or publish via one controlled release.

No production deployment or schema migration is authorized by this verification report.
