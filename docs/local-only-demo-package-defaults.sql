-- KITCH LOCAL-ONLY: master package defaults for synthetic inventory.
-- Run ONLY at http://127.0.0.1:54323 after earlier demo SQL.
BEGIN;
DO $$
BEGIN
 IF to_regclass('public.kitch_local_demo_ingredients') IS NULL
 OR to_regclass('public.ingredients') IS NOT NULL
 OR to_regclass('public.inventory_balances') IS NOT NULL
 THEN RAISE EXCEPTION 'STOP: this script is for KITCH LOCAL DEMO only'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.kitch_local_demo_packages (
 ingredient_id uuid PRIMARY KEY REFERENCES public.kitch_local_demo_ingredients(id) ON DELETE CASCADE,
 purchase_unit text NOT NULL CHECK (purchase_unit IN ('g','kg','ml','ltr','pcs','pkt','box')),
 pack_size numeric NOT NULL CHECK (pack_size>0),
 pack_unit text NOT NULL CHECK (pack_unit IN ('g','kg','ml','ltr','pcs')),
 unit_price numeric NOT NULL CHECK (unit_price>=0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kitch_local_demo_packages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitch_local_demo_packages FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.kitch_team_local_package_defaults(
 p_staff_name text,p_pin text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog, public AS $fn$
DECLARE v jsonb;
BEGIN
 IF lower(trim(coalesce(p_staff_name,''))) <> 'demo manager' OR p_pin IS DISTINCT FROM '1357'
 THEN RAISE EXCEPTION 'Local demo account required'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
 'ingredient_id',ingredient_id,'purchase_unit',purchase_unit,
 'pack_size',pack_size,'pack_unit',pack_unit,'unit_price',unit_price
 )), '[]'::jsonb) INTO v FROM public.kitch_local_demo_packages;
 RETURN v;
END $fn$;

CREATE OR REPLACE FUNCTION public.kitch_team_local_save_package(
 p_staff_name text,p_pin text,p_ingredient_id uuid,
 p_purchase_unit text,p_pack_size numeric,p_pack_unit text,p_unit_price numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $fn$
DECLARE base text; ratio numeric;
BEGIN
 IF lower(trim(coalesce(p_staff_name,''))) <> 'demo manager' OR p_pin IS DISTINCT FROM '1357'
 THEN RAISE EXCEPTION 'Local demo account required'; END IF;
 SELECT base_unit INTO base FROM public.kitch_local_demo_ingredients
 WHERE id=p_ingredient_id AND is_active FOR UPDATE;
 IF base IS NULL THEN RAISE EXCEPTION 'Ingredient not found'; END IF;
 IF p_purchase_unit NOT IN ('pcs','pkt','box') OR p_pack_size IS NULL OR p_pack_size<=0
 OR p_unit_price IS NULL OR p_unit_price<0 THEN RAISE EXCEPTION 'Invalid package definition'; END IF;
 IF p_pack_unit=base THEN ratio:=1;
 ELSIF base='g' AND p_pack_unit='kg' THEN ratio:=1000;
 ELSIF base='kg' AND p_pack_unit='g' THEN ratio:=.001;
 ELSIF base='ml' AND p_pack_unit='ltr' THEN ratio:=1000;
 ELSIF base='ltr' AND p_pack_unit='ml' THEN ratio:=.001;
 ELSE RAISE EXCEPTION 'Package unit incompatible with inventory base unit'; END IF;
 IF p_pack_size*ratio>1000000000 THEN RAISE EXCEPTION 'Package quantity too large'; END IF;
 INSERT INTO public.kitch_local_demo_packages(ingredient_id,purchase_unit,pack_size,pack_unit,unit_price)
 VALUES(p_ingredient_id,p_purchase_unit,p_pack_size,p_pack_unit,p_unit_price)
 ON CONFLICT(ingredient_id) DO UPDATE SET purchase_unit=excluded.purchase_unit,
 pack_size=excluded.pack_size,pack_unit=excluded.pack_unit,
 unit_price=excluded.unit_price,updated_at=now();
 RETURN jsonb_build_object('saved',true,'base_units_per_package',p_pack_size*ratio);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.kitch_team_local_package_defaults(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kitch_team_local_save_package(text,text,uuid,text,numeric,text,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kitch_team_local_package_defaults(text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kitch_team_local_save_package(text,text,uuid,text,numeric,text,numeric) TO anon,authenticated;
COMMIT;
SELECT count(*) AS saved_package_defaults FROM public.kitch_local_demo_packages;
