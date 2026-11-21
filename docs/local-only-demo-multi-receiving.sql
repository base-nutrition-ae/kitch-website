-- LOCAL-ONLY multi-line receiving test. NEVER run in hosted/production Supabase.
-- Studio: http://127.0.0.1:54323
BEGIN;
DO $guard$
BEGIN
 IF to_regclass('public.kitch_local_demo_ingredients') IS NULL
 OR to_regclass('public.kitch_local_demo_receipts') IS NULL
 OR to_regclass('public.ingredients') IS NOT NULL
 OR to_regclass('public.inventory_balances') IS NOT NULL
 THEN RAISE EXCEPTION 'STOP: This is NOT the isolated KITCH local demo schema'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.kitch_team_receive_invoice_demo(
 p_staff_name text,
 p_pin text,
 p_supplier text,
 p_invoice text,
 p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $fn$
DECLARE
 ln jsonb;
 r record;
 i integer := 0;
 line_count integer;
 accepted_total numeric := 0;
 total_amount numeric := 0;
 ing_id uuid;
 qty numeric;
 rejected numeric;
 cost numeric;
 expiry date;
 temp numeric;
 provided_unit text;
 saved_id uuid;
 ids uuid[] := array[]::uuid[];
BEGIN
 IF lower(btrim(coalesce(p_staff_name,''))) <> 'demo manager' OR p_pin IS DISTINCT FROM '1357'
 THEN RAISE EXCEPTION 'Local synthetic Demo Manager login required'; END IF;
 IF nullif(btrim(coalesce(p_supplier,'')),'') IS NULL
 OR nullif(btrim(coalesce(p_invoice,'')),'') IS NULL
 OR length(p_supplier)>200 OR length(p_invoice)>100
 THEN RAISE EXCEPTION 'Supplier/invoice required (max lengths 200/100)'; END IF;
 IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)<1
 OR jsonb_array_length(p_lines)>100
 THEN RAISE EXCEPTION 'Invoice must have between 1 and 100 ingredient lines'; END IF;

 -- Serialize deliveries for this supplier invoice and refuse duplicate invoice submissions.
 PERFORM pg_advisory_xact_lock(hashtextextended(lower(btrim(p_supplier))||':'||lower(btrim(p_invoice)),0));
 IF EXISTS (SELECT 1 FROM public.kitch_local_demo_receipts
            WHERE lower(btrim(supplier))=lower(btrim(p_supplier))
              AND lower(btrim(invoice))=lower(btrim(p_invoice)))
 THEN RAISE EXCEPTION 'Supplier invoice already received; no stock was changed'; END IF;

 -- Validate every line before any writes.
 FOR ln IN SELECT value FROM jsonb_array_elements(p_lines)
 LOOP
   i:=i+1;
   IF jsonb_typeof(ln)<>'object' OR (ln->>'ingredient_id') IS NULL
   OR (ln->>'delivered') IS NULL OR (ln->>'rejected') IS NULL
   OR (ln->>'price') IS NULL OR (ln->>'unit') IS NULL
   THEN RAISE EXCEPTION 'Missing fields on line %', i; END IF;
   BEGIN
    ing_id := (ln->>'ingredient_id')::uuid;
    qty := (ln->>'delivered')::numeric;
    rejected := (ln->>'rejected')::numeric;
    cost := (ln->>'price')::numeric;
    expiry := nullif(ln->>'expiry','')::date;
    temp := nullif(ln->>'temperature','')::numeric;
   EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow
   THEN RAISE EXCEPTION 'Invalid numeric, UUID, or date on line %',i; END;
   IF qty<=0 OR rejected<0 OR rejected>qty OR cost<0 OR qty>1000000000
   OR qty IS NULL OR rejected IS NULL OR cost IS NULL
   THEN RAISE EXCEPTION 'Invalid quantities or price on line %',i; END IF;
   IF expiry IS NOT NULL AND expiry<current_date
   THEN RAISE EXCEPTION 'Expired ingredient on line %, expiry %',i,expiry; END IF;
   IF ing_id=ANY(ids) THEN RAISE EXCEPTION 'Duplicate ingredient on invoice (line %) — combine it into one line',i; END IF;
   ids:=array_append(ids,ing_id);
   SELECT id,base_unit INTO r FROM public.kitch_local_demo_ingredients WHERE id=ing_id AND is_active;
   IF NOT FOUND THEN RAISE EXCEPTION 'Unknown/archived ingredient on line %',i; END IF;
   provided_unit:=ln->>'unit';
   IF provided_unit IS DISTINCT FROM r.base_unit
   THEN RAISE EXCEPTION 'Wrong stock base unit on line % (expected %)',i,r.base_unit; END IF;
   IF EXISTS (SELECT 1 FROM public.kitch_local_demo_receipts WHERE ingredient_id=ing_id AND invoice=btrim(p_invoice))
   THEN RAISE EXCEPTION 'Invoice already recorded for ingredient on line %',i; END IF;
 END LOOP;

 -- Save every line in the SAME database function/transaction. If any error
 -- occurs below, Postgres rolls back every inserted receipt and stock change.
 i:=0;
 FOR ln IN SELECT value FROM jsonb_array_elements(p_lines)
 LOOP
   i:=i+1;
   ing_id:=(ln->>'ingredient_id')::uuid;
   qty:=(ln->>'delivered')::numeric;
   rejected:=(ln->>'rejected')::numeric;
   cost:=(ln->>'price')::numeric;
   expiry:=nullif(ln->>'expiry','')::date;
   temp:=nullif(ln->>'temperature','')::numeric;
   INSERT INTO public.kitch_local_demo_receipts
    (ingredient_id,supplier,invoice,delivered,rejected,unit,price,expiry,temperature)
   VALUES(ing_id,btrim(p_supplier),btrim(p_invoice),qty,rejected,ln->>'unit',cost,expiry,temp)
   RETURNING id INTO saved_id;
   UPDATE public.kitch_local_demo_ingredients
     SET quantity_on_hand=quantity_on_hand+(qty-rejected),last_unit_cost=cost,updated_at=now()
   WHERE id=ing_id;
   accepted_total:=accepted_total+(qty-rejected);
   total_amount:=total_amount+(qty-rejected)*cost;
 END LOOP;
 RETURN jsonb_build_object('saved_lines',i,'total_aed',round(total_amount,2),'local_demo',true);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.kitch_team_receive_invoice_demo(text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kitch_team_receive_invoice_demo(text,text,text,text,jsonb) TO anon,authenticated;
COMMIT;

SELECT count(*) AS saved_demo_receipt_lines FROM public.kitch_local_demo_receipts;
