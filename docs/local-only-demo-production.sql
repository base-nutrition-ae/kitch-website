-- ISOLATED LOCAL DEMO ONLY. Never execute against hosted/production Supabase.
-- Studio URL must be http://127.0.0.1:54323; recipe specs match six synthetic KITCH Excel demo recipes.
-- This test ledger deducts aggregate demo stock. It is NOT batch/lot FEFO or production food-safety approval.
BEGIN;
DO $guard$
BEGIN
 IF to_regclass('public.kitch_local_demo_ingredients') IS NULL
    OR to_regclass('public.kitch_local_demo_receipts') IS NULL
    OR to_regclass('public.ingredients') IS NOT NULL
    OR to_regclass('public.inventory_balances') IS NOT NULL
    OR to_regprocedure('public.kitch_team_login(text,text)') IS NULL
 THEN RAISE EXCEPTION 'STOP: isolated KITCH local synthetic demo schema required'; END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS public.kitch_local_demo_recipe_specs (
 name text PRIMARY KEY, ingredient_lines jsonb NOT NULL,
 is_approved boolean NOT NULL DEFAULT true
);
ALTER TABLE public.kitch_local_demo_recipe_specs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitch_local_demo_recipe_specs FROM PUBLIC,anon,authenticated;
INSERT INTO public.kitch_local_demo_recipe_specs(name,ingredient_lines) VALUES
 ('Grilled Chicken & Brown Rice','[{"ingredient":"Chicken Breast","qty":1800,"unit":"g"},{"ingredient":"Brown Rice","qty":1000,"unit":"g"},{"ingredient":"Broccoli","qty":900,"unit":"g"},{"ingredient":"Olive Oil","qty":80,"unit":"ml"}]'::jsonb),
 ('Salmon & White Rice','[{"ingredient":"Salmon Fillet","qty":1600,"unit":"g"},{"ingredient":"White Rice","qty":1000,"unit":"g"},{"ingredient":"Spinach","qty":800,"unit":"g"},{"ingredient":"Olive Oil","qty":75,"unit":"ml"},{"ingredient":"Lemon","qty":120,"unit":"g"}]'::jsonb),
 ('Beef & Broccoli Rice Bowl','[{"ingredient":"Beef Strips","qty":1700,"unit":"g"},{"ingredient":"Brown Rice","qty":1100,"unit":"g"},{"ingredient":"Broccoli","qty":1200,"unit":"g"},{"ingredient":"Olive Oil","qty":80,"unit":"ml"},{"ingredient":"Garlic","qty":40,"unit":"g"}]'::jsonb),
 ('Garlic Prawns & Rice','[{"ingredient":"Prawns","qty":1600,"unit":"g"},{"ingredient":"White Rice","qty":1200,"unit":"g"},{"ingredient":"Cherry Tomato","qty":700,"unit":"g"},{"ingredient":"Garlic","qty":50,"unit":"g"},{"ingredient":"Olive Oil","qty":90,"unit":"ml"}]'::jsonb),
 ('Greek Yogurt Berry Oats','[{"ingredient":"Greek Yogurt","qty":2000,"unit":"g"},{"ingredient":"Rolled Oats","qty":550,"unit":"g"},{"ingredient":"Strawberries","qty":600,"unit":"g"},{"ingredient":"Honey","qty":120,"unit":"g"},{"ingredient":"Almonds","qty":100,"unit":"g"}]'::jsonb),
 ('Chicken & Avocado Salad','[{"ingredient":"Chicken Breast","qty":1500,"unit":"g"},{"ingredient":"Avocado","qty":700,"unit":"g"},{"ingredient":"Rocket Leaves","qty":500,"unit":"g"},{"ingredient":"Cherry Tomato","qty":650,"unit":"g"},{"ingredient":"Olive Oil","qty":80,"unit":"ml"},{"ingredient":"Lemon","qty":120,"unit":"g"}]'::jsonb)
ON CONFLICT(name) DO UPDATE SET ingredient_lines=excluded.ingredient_lines;

CREATE TABLE IF NOT EXISTS public.kitch_local_demo_production_runs (
 request_id uuid PRIMARY KEY,
 recipe_name text NOT NULL,
 batches numeric NOT NULL CHECK(batches>0),
 ingredient_lines jsonb NOT NULL,
 stock_usage_cost numeric NOT NULL DEFAULT 0,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 payload jsonb,
 revision integer NOT NULL DEFAULT 0
);
ALTER TABLE public.kitch_local_demo_production_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitch_local_demo_production_runs FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.kitch_team_start_production(
 p_staff_name text,p_pin text,p_request_id uuid,p_recipe_key text,p_batches numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $func$
DECLARE
 v_recipe public.kitch_local_demo_recipe_specs%ROWTYPE;
 v_line jsonb; v_ing public.kitch_local_demo_ingredients%ROWTYPE;
 v_qty numeric; v_factor numeric; v_need numeric; v_cost numeric:=0;
 v_lines jsonb:='[]'::jsonb; v_count integer:=0;
 v_existing public.kitch_local_demo_production_runs%ROWTYPE;
BEGIN
 IF lower(btrim(coalesce(p_staff_name,'')))<>'demo manager' OR p_pin IS DISTINCT FROM '1357'
 THEN RAISE EXCEPTION 'Local Demo Manager required'; END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Request ID required'; END IF;
 IF p_batches IS NULL OR p_batches<>trunc(p_batches) OR p_batches<1 OR p_batches>100
 THEN RAISE EXCEPTION 'Use a whole number of batches from 1 to 100'; END IF;
 -- A unique request ID cannot deduct twice, even if retried after a network failure.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 SELECT * INTO v_existing FROM public.kitch_local_demo_production_runs WHERE request_id=p_request_id;
 IF FOUND THEN
  IF v_existing.recipe_name<>p_recipe_key OR v_existing.batches<>p_batches
  THEN RAISE EXCEPTION 'Request ID already used for a different production'; END IF;
  RETURN jsonb_build_object('saved',true,'already_processed',true,'request_id',p_request_id,'stock_usage_cost',v_existing.stock_usage_cost);
 END IF;
 SELECT * INTO v_recipe FROM public.kitch_local_demo_recipe_specs
 WHERE name=p_recipe_key AND is_approved;
 IF NOT FOUND THEN RAISE EXCEPTION 'Recipe is not registered as approved in LOCAL demo: %',p_recipe_key; END IF;
 IF jsonb_typeof(v_recipe.ingredient_lines)<>'array' OR jsonb_array_length(v_recipe.ingredient_lines)<1
 THEN RAISE EXCEPTION 'Invalid demo recipe specification'; END IF;

 -- All validations and deductions are in one PostgreSQL transaction (RPC call).
 FOR v_line IN SELECT value FROM jsonb_array_elements(v_recipe.ingredient_lines) LOOP
  v_count:=v_count+1;
  SELECT * INTO v_ing FROM public.kitch_local_demo_ingredients
  WHERE name_key=lower(btrim(v_line->>'ingredient')) AND is_active FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing ingredient in local stock: %',v_line->>'ingredient'; END IF;
  v_qty=(v_line->>'qty')::numeric*p_batches;
  IF v_qty<=0 OR v_qty>100000000 THEN RAISE EXCEPTION 'Invalid quantity in recipe'; END IF;
  v_factor:=NULL;
  IF v_ing.base_unit=(v_line->>'unit') THEN v_factor:=1;
  ELSIF v_ing.base_unit='g' AND v_line->>'unit'='kg' THEN v_factor:=1000;
  ELSIF v_ing.base_unit='kg' AND v_line->>'unit'='g' THEN v_factor:=0.001;
  ELSIF v_ing.base_unit='ml' AND v_line->>'unit' IN ('ltr','l') THEN v_factor:=1000;
  ELSIF v_ing.base_unit IN ('ltr','l') AND v_line->>'unit'='ml' THEN v_factor:=0.001;
  END IF;
  IF v_factor IS NULL THEN RAISE EXCEPTION 'Recipe unit mismatch for %',v_ing.name; END IF;
  v_need=v_qty*v_factor;
  IF v_ing.quantity_on_hand<v_need
  THEN RAISE EXCEPTION 'Insufficient stock: % requires % %, available % %',
    v_ing.name,v_need,v_ing.base_unit,v_ing.quantity_on_hand,v_ing.base_unit; END IF;
  UPDATE public.kitch_local_demo_ingredients
  SET quantity_on_hand=quantity_on_hand-v_need,updated_at=now()
  WHERE id=v_ing.id AND quantity_on_hand>=v_need;
  IF NOT FOUND THEN RAISE EXCEPTION 'Concurrent stock change; no production committed'; END IF;
  v_cost=v_cost+v_need*v_ing.last_unit_cost;
  v_lines=v_lines||jsonb_build_array(jsonb_build_object(
   'ingredient_id',v_ing.id,'name',v_ing.name,'quantity',v_need,
   'unit',v_ing.base_unit,'unit_cost',v_ing.last_unit_cost,
   'cost',v_need*v_ing.last_unit_cost
  ));
 END LOOP;
 INSERT INTO public.kitch_local_demo_production_runs(request_id,recipe_name,batches,ingredient_lines,stock_usage_cost)
 VALUES(p_request_id,p_recipe_key,p_batches,v_lines,v_cost);
 RETURN jsonb_build_object('saved',true,'already_processed',false,'request_id',p_request_id,
  'ingredient_lines',v_count,'stock_usage_cost',v_cost,'local_demo',true);
END $func$;

CREATE OR REPLACE FUNCTION public.kitch_team_production_dashboard(
 p_staff_name text,p_pin text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $func$
DECLARE v_count integer;v_cost numeric;v_history jsonb;
BEGIN
 IF lower(trim(coalesce(p_staff_name,'')))<>'demo manager' OR p_pin IS DISTINCT FROM '1357'
 THEN RAISE EXCEPTION 'Local Demo Manager required'; END IF;
 SELECT count(*),coalesce(sum(stock_usage_cost),0) INTO v_count,v_cost
 FROM public.kitch_local_demo_production_runs;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'request_id',request_id,'occurred_at',occurred_at,
  'ingredient_lines',jsonb_array_length(ingredient_lines),
  'stock_usage_cost',stock_usage_cost,'recipe_name',recipe_name
 ) ORDER BY occurred_at DESC),'[]'::jsonb) INTO v_history
 FROM public.kitch_local_demo_production_runs;
 RETURN jsonb_build_object('stock_deducted_runs',v_count,'stock_usage_cost',v_cost,
 'branch_id','33333333-3333-4333-8333-333333333333','history',v_history);
END $func$;

CREATE OR REPLACE FUNCTION public.kitch_team_production_records(
 p_staff_name text,p_pin text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $func$
DECLARE v_records jsonb;
BEGIN
 IF lower(trim(coalesce(p_staff_name,'')))<>'demo manager' OR p_pin IS DISTINCT FROM '1357'
 THEN RAISE EXCEPTION 'Local Demo Manager required'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'request_id',request_id,'payload',payload,'revision',revision
 ) ORDER BY occurred_at DESC),'[]'::jsonb) INTO v_records
 FROM public.kitch_local_demo_production_runs WHERE payload IS NOT NULL;
 RETURN v_records;
END $func$;

CREATE OR REPLACE FUNCTION public.kitch_team_save_production_record(
 p_staff_name text,p_pin text,p_request_id uuid,p_payload jsonb,p_expected_revision integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $func$
DECLARE v_rev int;
BEGIN
 IF lower(trim(coalesce(p_staff_name,'')))<>'demo manager' OR p_pin IS DISTINCT FROM '1357'
 THEN RAISE EXCEPTION 'Local Demo Manager required'; END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
 OR p_payload->>'cloud_request_id' IS DISTINCT FROM p_request_id::text
 THEN RAISE EXCEPTION 'Production record/request mismatch'; END IF;
 IF pg_column_size(p_payload)>65536 THEN RAISE EXCEPTION 'Demo completion record too large'; END IF;
 UPDATE public.kitch_local_demo_production_runs
 SET payload=p_payload,revision=revision+1
 WHERE request_id=p_request_id AND revision=coalesce(p_expected_revision,0)
 RETURNING revision INTO v_rev;
 IF NOT FOUND THEN RAISE EXCEPTION 'Production record missing or version conflict'; END IF;
 RETURN jsonb_build_object('saved',true,'revision',v_rev);
END $func$;

REVOKE ALL ON FUNCTION public.kitch_team_start_production(text,text,uuid,text,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kitch_team_production_dashboard(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kitch_team_production_records(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kitch_team_save_production_record(text,text,uuid,jsonb,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kitch_team_start_production(text,text,uuid,text,numeric) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kitch_team_production_dashboard(text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kitch_team_production_records(text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kitch_team_save_production_record(text,text,uuid,jsonb,integer) TO anon,authenticated;
COMMIT;

-- Read-only verification (before production, should show zero runs):
SELECT count(*) AS production_runs,coalesce(sum(stock_usage_cost),0) AS stock_usage_cost
FROM public.kitch_local_demo_production_runs;
