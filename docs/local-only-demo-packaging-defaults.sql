-- ONLY install in local Supabase Studio http://127.0.0.1:54323
-- KITCH local demo package defaults linked to the Ingredient Master.
-- This is NOT a hosted/production migration or real access-control model.
BEGIN;
DO $$
BEGIN
 IF to_regclass('public.kitch_local_demo_ingredients') IS NULL
 OR to_regclass('public.kitch_local_demo_receipts') IS NULL
 OR to_regclass('public.ingredients') IS NOT NULL
 OR to_regclass('public.inventory_balances') IS NOT NULL
 THEN RAISE EXCEPTION 'STOP: not isolated KITCH local demo'; END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.kitch_local_demo_packaging(
 ingredient_id uuid PRIMARY KEY REFERENCES public.kitch_local_demo_ingredients(id) ON DELETE CASCADE,
 receive_unit text NOT NULL CHECK(receive_unit IN ('g','kg','ml','ltr','pcs','pkt','box')),
 size numeric NOT NULL CHECK(size>0),
 size_unit text NOT NULL CHECK(size_unit IN ('g','kg','ml','ltr','pcs')),
 purchase_price numeric NOT NULL CHECK(purchase_price>=0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kitch_local_demo_packaging ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitch_local_demo_packaging FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.kitch_team_packaging_defaults_demo(
 p_staff_name text,p_pin text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $body$
DECLARE out_rows jsonb;
BEGIN
 IF lower(btrim(coalesce(p_staff_name,''))) <> 'demo manager' OR p_pin IS DISTINCT FROM '1357'
 THEN RAISE EXCEPTION 'Local demo credentials required'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('ingredient_id',ingredient_id,'receive_unit',receive_unit,
  'pack_size',size,'pack_unit',size_unit,'purchase_price',purchase_price)),'[]'::jsonb)
 INTO out_rows FROM public.kitch_local_demo_packaging;
 RETURN out_rows;
END $body$;
CREATE OR REPLACE FUNCTION public.kitch_team_save_packaging_demo(
 p_staff_name text,p_pin text,p_ingredient_id uuid,p_receive_unit text,
 p_pack_size numeric,p_pack_unit text,p_purchase_price numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
DECLARE b text; factor numeric;
BEGIN
 IF lower(btrim(coalesce(p_staff_name,''))) <> 'demo manager' OR p_pin IS DISTINCT FROM '1357'
 THEN RAISE EXCEPTION 'Local demo credentials required'; END IF;
 SELECT base_unit INTO b FROM public.kitch_local_demo_ingredients WHERE id=p_ingredient_id AND is_active;
 IF b IS NULL THEN RAISE EXCEPTION 'Unknown ingredient'; END IF;
 IF p_receive_unit NOT IN ('pcs','pkt','box') OR p_pack_size IS NULL OR p_pack_size<=0
 OR p_purchase_price IS NULL OR p_purchase_price<0
 THEN RAISE EXCEPTION 'Invalid packaging values'; END IF;
 factor:=CASE
 WHEN p_pack_unit=b THEN 1
 WHEN b='g' AND p_pack_unit='kg' THEN 1000
 WHEN b='kg' AND p_pack_unit='g' THEN 0.001
 WHEN b='ml' AND p_pack_unit='ltr' THEN 1000
 WHEN b='ltr' AND p_pack_unit='ml' THEN 0.001
 ELSE NULL END;
 IF factor IS NULL THEN RAISE EXCEPTION 'Package size unit incompatible with Ingredient Master base unit'; END IF;
 INSERT INTO public.kitch_local_demo_packaging
 (ingredient_id,receive_unit,size,size_unit,purchase_price)
 VALUES (p_ingredient_id,p_receive_unit,p_pack_size,p_pack_unit,p_purchase_price)
 ON CONFLICT(ingredient_id) DO UPDATE SET
 receive_unit=EXCLUDED.receive_unit,size=EXCLUDED.size,size_unit=EXCLUDED.size_unit,
 purchase_price=EXCLUDED.purchase_price,updated_at=now();
 RETURN jsonb_build_object('ingredient_id',p_ingredient_id,'receive_unit',p_receive_unit,
 'pack_size',p_pack_size,'pack_unit',p_pack_unit,'purchase_price',p_purchase_price);
END $body$;
REVOKE EXECUTE ON FUNCTION public.kitch_team_packaging_defaults_demo(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kitch_team_save_packaging_demo(text,text,uuid,text,numeric,text,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kitch_team_packaging_defaults_demo(text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kitch_team_save_packaging_demo(text,text,uuid,text,numeric,text,numeric) TO anon,authenticated;
COMMIT;
SELECT count(*) AS packaging_defaults_saved FROM public.kitch_local_demo_packaging;
