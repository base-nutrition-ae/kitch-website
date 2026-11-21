-- KITCH LOCAL DEMO: receiving smoke test ONLY. Never run online.
-- Run exclusively at http://127.0.0.1:54323 after local-only-demo-ingredient-import.sql.
-- No real invoices, actual inventory or production credentials.
BEGIN;
DO $guard$
BEGIN
 IF to_regclass('public.kitch_local_demo_ingredients') IS NULL
    OR to_regclass('public.ingredients') IS NOT NULL
    OR to_regclass('public.inventory_balances') IS NOT NULL
 THEN RAISE EXCEPTION 'STOP: not a fresh isolated local KITCH demo database'; END IF;
 IF to_regprocedure('public.kitch_team_login(text,text)') IS NULL
 THEN RAISE EXCEPTION 'STOP: local demo login fixture not installed'; END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS public.kitch_local_demo_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ingredient_id uuid NOT NULL REFERENCES public.kitch_local_demo_ingredients(id),
 supplier text NOT NULL CHECK(length(trim(supplier))>0),
 invoice text NOT NULL CHECK(length(trim(invoice))>0),
 delivered numeric NOT NULL CHECK(delivered>0),
 rejected numeric NOT NULL CHECK(rejected>=0 AND rejected<=delivered),
 accepted numeric GENERATED ALWAYS AS (delivered-rejected) STORED,
 unit text NOT NULL,
 price numeric NOT NULL CHECK(price>=0),
 expiry date,
 temperature numeric,
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (ingredient_id,invoice)
);
ALTER TABLE public.kitch_local_demo_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitch_local_demo_receipts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.kitch_team_receive_stock(
 p_staff_name text,p_pin text,p_ingredient_id uuid,p_supplier text,
 p_invoice_number text,p_invoice_filename text,
 p_delivered_qty numeric,p_rejected_qty numeric,p_unit text,
 p_unit_price numeric,p_expiry_date date,p_temperature numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $fn$
DECLARE
 v_ing public.kitch_local_demo_ingredients%ROWTYPE;
 v_receipt public.kitch_local_demo_receipts%ROWTYPE;
BEGIN
 IF lower(trim(coalesce(p_staff_name,''))) <> 'demo manager' OR p_pin <> '1357'
 THEN RAISE EXCEPTION 'Local demo credentials required' USING ERRCODE='28000'; END IF;
 IF nullif(trim(coalesce(p_supplier,'')),'') IS NULL
    OR nullif(trim(coalesce(p_invoice_number,'')),'') IS NULL
    OR p_delivered_qty IS NULL OR p_delivered_qty<=0
    OR p_rejected_qty IS NULL OR p_rejected_qty<0 OR p_rejected_qty>p_delivered_qty
    OR p_unit_price IS NULL OR p_unit_price<0
 THEN RAISE EXCEPTION 'Invalid receiving quantities, supplier, invoice or cost'; END IF;
 SELECT * INTO v_ing FROM public.kitch_local_demo_ingredients
  WHERE id=p_ingredient_id AND is_active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ingredient not found'; END IF;
 IF p_unit IS DISTINCT FROM v_ing.base_unit THEN
  RAISE EXCEPTION 'Receiving unit does not match Ingredient Master'; END IF;
 INSERT INTO public.kitch_local_demo_receipts
 (ingredient_id,supplier,invoice,delivered,rejected,unit,price,expiry,temperature)
 VALUES (p_ingredient_id,trim(p_supplier),trim(p_invoice_number),
 p_delivered_qty,p_rejected_qty,p_unit,p_unit_price,p_expiry_date,p_temperature)
 ON CONFLICT (ingredient_id,invoice) DO NOTHING RETURNING * INTO v_receipt;
 IF v_receipt.id IS NULL THEN
  RAISE EXCEPTION 'Duplicate invoice for this ingredient; receiving not added twice';
 END IF;
 UPDATE public.kitch_local_demo_ingredients
 SET quantity_on_hand=quantity_on_hand+v_receipt.accepted,
     last_unit_cost=p_unit_price,updated_at=now()
 WHERE id=p_ingredient_id;
 RETURN jsonb_build_object('id',v_receipt.id,'accepted_qty',v_receipt.accepted);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.kitch_team_receiving_history(
 p_staff_name text,p_pin text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $fn$
DECLARE v_result jsonb;
BEGIN
 IF lower(trim(coalesce(p_staff_name,''))) <> 'demo manager' OR p_pin <> '1357'
 THEN RAISE EXCEPTION 'Local demo credentials required' USING ERRCODE='28000'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',r.id,'date',r.received_at,'invoice',r.invoice,'supplier',r.supplier,
 'ingredient',i.name,'accepted',r.accepted,'rejected',r.rejected,
 'unit',r.unit,'price',r.price,'total',r.accepted*r.price,
 'expiry',r.expiry,'temperature',r.temperature,'has_attachment',false
 ) ORDER BY r.received_at DESC),'[]'::jsonb)
 INTO v_result FROM public.kitch_local_demo_receipts r
 JOIN public.kitch_local_demo_ingredients i ON i.id=r.ingredient_id;
 RETURN v_result;
END;
$fn$;

-- The UI always attempts this after receiving; explicitly acknowledge only
-- an empty local attachment. No file contents are stored by this test fixture.
CREATE OR REPLACE FUNCTION public.kitch_team_receiving_attach(
 p_staff_name text,p_pin text,p_receipt_id uuid,p_filename text,
 p_mime text,p_base64 text,p_production_date date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $fn$
BEGIN
 IF lower(trim(coalesce(p_staff_name,''))) <> 'demo manager' OR p_pin <> '1357'
 THEN RAISE EXCEPTION 'Local demo credentials required' USING ERRCODE='28000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.kitch_local_demo_receipts WHERE id=p_receipt_id)
 THEN RAISE EXCEPTION 'Receipt not found'; END IF;
 IF nullif(p_filename,'') IS NOT NULL OR nullif(p_base64,'') IS NOT NULL
 THEN RAISE EXCEPTION 'Local demo does not support invoice file uploads'; END IF;
 RETURN jsonb_build_object('local_demo',true,'attachment_saved',false);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.kitch_team_receive_stock(text,text,uuid,text,text,text,numeric,numeric,text,numeric,date,numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kitch_team_receiving_history(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kitch_team_receiving_attach(text,text,uuid,text,text,text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kitch_team_receive_stock(text,text,uuid,text,text,text,numeric,numeric,text,numeric,date,numeric) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kitch_team_receiving_history(text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kitch_team_receiving_attach(text,text,uuid,text,text,text,date) TO anon,authenticated;
COMMIT;

SELECT count(*) AS local_demo_receipt_count FROM public.kitch_local_demo_receipts;
