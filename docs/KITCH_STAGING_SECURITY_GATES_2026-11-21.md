# KITCH staging and security release gates — 2026-11-21

Status: BLOCKED pending isolated staging database. No changes to production DB.

## Environment discovery
- Connected Supabase projects: KITCH (active production), BASE Nutrition (separate product).
- No distinct KITCH staging Supabase project exists in connected project list.
- Production read-only check: 0 of the expected staged cloud tables and 0 of the expected staged RPCs are installed.
- Do not run the four staged SQL files or sample stock transactions against production.

## Read-only Supabase security advisor findings
- 35 findings: anonymous role can execute SECURITY DEFINER functions in public schema, including staff-PIN-based KITCH RPCs.
- 4 info findings: public tables have RLS enabled but no policies.
- Treat these as audit requirements, not proof of unauthorized access: inspect every function's internal role/PIN checks, object permissions, schema exposure and session model.
- Docs: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- Docs: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Next isolated staging process
1. Choose the Supabase organization for a separately billed/quoted `KITCH Staging` project; confirm any nonzero cost before creation.
2. Create an empty project with no production passwords, PINs, customer information or imported real stock.
3. Set up baseline schema and synthetic ingredients, branches and staff.
4. Review SECURITY DEFINER and RLS exposure before applying staged purchasing, lot ledger, stock-control and count SQL.
5. Run end-to-end cases: PR -> approval -> dispatch -> receiving -> invoice matching, partial/rejected/duplicate receipts; lot expiry and FEFO usage; concurrent waste, production and physical count; repeat transaction IDs; all staff roles and cross-branch denial.
6. Compare cloud reports and CSV/Excel exports against staged movements.
7. Verify mobile/Safari workflows and GitHub Actions. Merge/deploy only after all gates are passed.

This document is a plan and evidence record, not proof that business workflows were tested or approved.
