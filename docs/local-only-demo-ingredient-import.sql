-- KITCH LOCAL DEMO INGREDIENT IMPORT FIX (NOT PRODUCTION)
-- Apply ONLY in Supabase Studio at http://127.0.0.1:54323
-- Synthetic Team credential: Demo Manager / 1357
-- This is a demo data store, NOT a production inventory movement ledger.
-- Idempotent: rerunning preserves imported sample rows; reimporting updates
-- quantities rather than accumulating them.
BEGIN;

-- Production KITCH already has an ingredients table. Abort before any DDL
-- if someone mistakenly runs this script against that schema.
DO $$
BEGIN
 IF to_regclass('public.ingredients') IS NOT NULL
 OR to_regclass('public.inventory_balances') IS NOT NULL
 OR to_regclass('public.kitch_local_demo_ingredients') IS NULL
    AND to_regprocedure('public.kitch_team_login(text,text)') IS NULL
 THEN
  RAISE EXCEPTION 'STOP: expected fresh local synthetic-login database, not production KITCH';
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.kitch_local_demo_ingredients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
 name_key text GENERATED ALWAYS AS (lower(btrim(name))) STORED UNIQUE,
 sku text NOT NULL DEFAULT '',
 category text NOT NULL DEFAULT '',
 supplier_name text NOT NULL DEFAULT '',
 receiving_type text NOT NULL DEFAULT 'Room Temperature',
 base_unit text NOT NULL CHECK (base_unit IN ('g','kg','ml','ltr','pcs')),
 reference_cost numeric NOT NULL DEFAULT 0 CHECK (reference_cost >= 0),
 last_unit_cost numeric NOT NULL DEFAULT 0 CHECK (last_unit_cost >= 0),
 par_target numeric NOT NULL DEFAULT 0 CHECK (par_target >= 0),
 minimum_stock numeric NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
 quantity_on_hand numeric NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
 is_active boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kitch_local_demo_ingredients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitch_local_demo_ingredients FROM PUBLIC, anon, authenticated;

-- Never create or replace the real production RPC in any hosted database.
CREATE OR REPLACE FUNCTION public.kitch_team_upsert_ingredient_by_staff(
 p_staff_name text, p_pin text, p_name text, p_base_unit text,
 p_category text DEFAULT NULL, p_unit_cost numeric DEFAULT 0,
 p_sku text DEFAULT NULL, p_receiving_type text DEFAULT NULL,
 p_reference_cost numeric DEFAULT 0, p_par numeric DEFAULT 0,
 p_minimum numeric DEFAULT 0, p_opening_stock numeric DEFAULT 0,
 p_opening_unit_cost numeric DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
 v_id uuid;
 v_row public.kitch_local_demo_ingredients%ROWTYPE;
BEGIN
 IF lower(btrim(coalesce(p_staff_name,''))) <> 'demo manager'
    OR coalesce(p_pin,'') <> '1357'
 THEN RAISE EXCEPTION 'Local demo account required' USING ERRCODE = '28000'; END IF;
 IF nullif(btrim(coalesce(p_name,'')),'') IS NULL
    OR p_base_unit NOT IN ('g','kg','ml','ltr','pcs')
    OR coalesce(p_opening_stock,0)<0
    OR coalesce(p_opening_unit_cost,0)<0
    OR coalesce(p_unit_cost,0)<0
    OR coalesce(p_reference_cost,0)<0
    OR coalesce(p_par,0)<0
    OR coalesce(p_minimum,0)<0
 THEN RAISE EXCEPTION 'Invalid ingredient, unit, quantity, cost, or PAR'; END IF;

 INSERT INTO public.kitch_local_demo_ingredients
  (name, sku, category, supplier_name, receiving_type, base_unit,
   reference_cost, last_unit_cost, par_target, minimum_stock, quantity_on_hand)
 VALUES
  (btrim(p_name), coalesce(p_sku,''), coalesce(p_category,''), '',
   coalesce(nullif(p_receiving_type,''),'Room Temperature'), p_base_unit,
   coalesce(p_reference_cost,0), coalesce(p_unit_cost,0),
   coalesce(p_par,0), coalesce(p_minimum,0), coalesce(p_opening_stock,0))
 ON CONFLICT (name_key) DO UPDATE SET
  name=EXCLUDED.name, sku=EXCLUDED.sku, category=EXCLUDED.category,
  receiving_type=EXCLUDED.receiving_type,
  base_unit=EXCLUDED.base_unit,
  reference_cost=EXCLUDED.reference_cost,
  last_unit_cost=EXCLUDED.last_unit_cost,
  par_target=EXCLUDED.par_target,
  minimum_stock=EXCLUDED.minimum_stock,
  quantity_on_hand=EXCLUDED.quantity_on_hand,
  updated_at=now()
 RETURNING * INTO v_row;

 RETURN jsonb_build_object('id',v_row.id,'name',v_row.name,'sku',v_row.sku);
END;
$fn$;

-- Replaces only the temporary login fixture's empty inventory-read function.
CREATE OR REPLACE FUNCTION public.kitch_team_inventory_read(
 p_staff_name text, p_pin text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
 v_ingredients jsonb;
 v_balances jsonb;
BEGIN
 IF lower(btrim(coalesce(p_staff_name,''))) <> 'demo manager'
    OR coalesce(p_pin,'') <> '1357'
 THEN RAISE EXCEPTION 'Local demo account required' USING ERRCODE='28000'; END IF;

 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'sku',sku,'name',name,'base_unit',base_unit,
  'category',category,'supplier_name',supplier_name,
  'last_unit_cost',last_unit_cost,'receiving_type',receiving_type,
  'reference_cost',reference_cost,'par_target',par_target,
  'minimum_stock',minimum_stock,'is_active',is_active
 ) ORDER BY name),'[]'::jsonb)
 INTO v_ingredients FROM public.kitch_local_demo_ingredients WHERE is_active=true;

 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'ingredient_id',id,
  'branch_id','33333333-3333-4333-8333-333333333333',
  'unit',base_unit,
  'quantity_on_hand',quantity_on_hand,
  'indicative_unit_cost',last_unit_cost
 ) ORDER BY name),'[]'::jsonb)
 INTO v_balances FROM public.kitch_local_demo_ingredients WHERE is_active=true;

 RETURN jsonb_build_object(
  'restaurant_id','22222222-2222-4222-8222-222222222222',
  'branch_id','33333333-3333-4333-8333-333333333333',
  'ingredients',v_ingredients,'balances',v_balances
 );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.kitch_team_upsert_ingredient_by_staff(text,text,text,text,text,numeric,text,text,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kitch_team_inventory_read(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kitch_team_upsert_ingredient_by_staff(text,text,text,text,text,numeric,text,text,numeric,numeric,numeric,numeric,numeric) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kitch_team_inventory_read(text,text) TO anon,authenticated;

COMMIT;

-- Local read-back diagnostic (no personal data):
SELECT count(*) AS imported_ingredients,
       coalesce(sum(quantity_on_hand),0) AS total_quantity_across_mixed_units
FROM public.kitch_local_demo_ingredients;
