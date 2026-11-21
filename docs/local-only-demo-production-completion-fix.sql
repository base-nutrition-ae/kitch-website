-- KITCH LOCAL STAGING ONLY: normalize oversized production-completion payloads.
-- Run at local Supabase Studio http://127.0.0.1:54323 only.
-- Does not affect inventory or restart production.
BEGIN;
DO $guard$
BEGIN
 IF to_regclass('public.kitch_local_demo_production_runs') IS NULL
 OR to_regclass('public.kitch_local_demo_ingredients') IS NULL
 OR to_regclass('public.ingredients') IS NOT NULL
 OR to_regclass('public.inventory_balances') IS NOT NULL
 THEN RAISE EXCEPTION 'STOP: local demo production fixture not found'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.kitch_team_save_production_record(
 p_staff_name text,p_pin text,p_request_id uuid,p_payload jsonb,p_expected_revision integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $func$
DECLARE v_rev integer; v_payload jsonb;
BEGIN
 IF lower(btrim(coalesce(p_staff_name,'')))<>'demo manager'
    OR p_pin IS DISTINCT FROM '1357'
 THEN RAISE EXCEPTION 'Local demo credentials required'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
    OR p_payload->>'cloud_request_id' IS DISTINCT FROM p_request_id::text
 THEN RAISE EXCEPTION 'Production record/request mismatch'; END IF;
 -- Images in data URLs can greatly exceed the metadata limit.
 -- This local fixture intentionally does not persist images; never silently
 -- apply this behavior to production or compliance evidence systems.
 v_payload:=p_payload - 'production_proof' - 'qc_photo';
 v_payload:=v_payload || jsonb_build_object(
  'production_proof','', 'qc_photo','', 'local_proof_storage','browser_only');
 IF pg_column_size(v_payload)>65536 THEN
   RAISE EXCEPTION 'Local production metadata exceeds 64 KB after image removal';
 END IF;
 UPDATE public.kitch_local_demo_production_runs
 SET payload=v_payload,revision=revision+1
 WHERE request_id=p_request_id
 AND revision=coalesce(p_expected_revision,0)
 RETURNING revision INTO v_rev;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Production run not found or revision conflict; no stock changed';
 END IF;
 RETURN jsonb_build_object('saved',true,'revision',v_rev,'proof_saved',false);
END $func$;
REVOKE EXECUTE ON FUNCTION public.kitch_team_save_production_record(text,text,uuid,jsonb,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kitch_team_save_production_record(text,text,uuid,jsonb,integer) TO anon,authenticated;
COMMIT;
-- Confirm existing deduction history before retry. Does NOT change stock.
SELECT request_id,recipe_name,batches,revision,
 CASE WHEN payload IS NULL THEN 'Completion pending' ELSE 'Completion metadata saved' END AS completion_status
FROM public.kitch_local_demo_production_runs ORDER BY occurred_at DESC LIMIT 10;
