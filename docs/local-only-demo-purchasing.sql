-- LOCAL ONLY KITCH Purchasing smoke fixture. Never run against hosted Supabase.
-- Local Studio http://127.0.0.1:54323
-- Does NOT alter ingredients, receipt quantities, inventory, or stock value.
BEGIN;
DO $guard$
BEGIN
 IF to_regclass('public.kitch_local_demo_ingredients') IS NULL
 OR to_regclass('public.kitch_local_demo_receipts') IS NULL
 OR to_regprocedure('public.kitch_team_login(text,text)') IS NULL
 OR to_regclass('public.ingredients') IS NOT NULL
 OR to_regclass('public.inventory_balances') IS NOT NULL
 THEN RAISE EXCEPTION 'STOP: isolated synthetic KITCH local demo only'; END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS public.kitch_local_demo_purchase_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_ref text NOT NULL UNIQUE,
 supplier_name text NOT NULL,
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 1 AND 100),
 delivery_date date,
 notes text,
 status text NOT NULL DEFAULT 'Pending Approval'
  CHECK(status IN ('Pending Approval','Approved','Open','Rejected','Closed')),
 invoice_status text NOT NULL DEFAULT 'Pending Review'
  CHECK(invoice_status IN ('Pending Review','Approved','Hold')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kitch_local_demo_purchase_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitch_local_demo_purchase_orders FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS public.kitch_local_demo_purchase_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.kitch_local_demo_purchase_orders(id),
 receipt_id uuid NOT NULL UNIQUE REFERENCES public.kitch_local_demo_receipts(id),
 line_key text NOT NULL,
 linked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kitch_local_demo_purchase_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kitch_local_demo_purchase_links FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.kitch_team_purchase_cloud(
 p_staff_name text,p_pin text,p_action text,p_order_id uuid DEFAULT NULL,
 p_order_ref text DEFAULT NULL,p_supplier_name text DEFAULT NULL,p_lines jsonb DEFAULT NULL,
 p_delivery_date date DEFAULT NULL,p_notes text DEFAULT NULL,p_receipt_id uuid DEFAULT NULL,
 p_line_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE
 o public.kitch_local_demo_purchase_orders%ROWTYPE;
 r public.kitch_local_demo_receipts%ROWTYPE;
 i public.kitch_local_demo_ingredients%ROWTYPE;
 line jsonb; selected_line jsonb; v_id uuid; v_count integer:=0;
 v_qty numeric;v_price numeric;v_received numeric;v_has_links integer;
 v_links jsonb;v_result jsonb;v_mismatches integer;
BEGIN
 IF lower(btrim(coalesce(p_staff_name,'')))<>'demo manager' OR p_pin IS DISTINCT FROM '1357'
 THEN RAISE EXCEPTION 'Local Demo Manager credentials required'; END IF;
 IF p_action='list' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',o2.id,'order_ref',o2.order_ref,'supplier',o2.supplier_name,
   'lines',o2.lines,'delivery_date',o2.delivery_date,'notes',o2.notes,
   'status',o2.status,'invoice_status',o2.invoice_status,
   'receipt_links',(
    SELECT coalesce(jsonb_agg(jsonb_build_object(
     'receipt_id',l.receipt_id,'line_key',l.line_key,'accepted',r2.accepted,
     'unit_price',r2.price,'invoice',r2.invoice,'supplier',r2.supplier,
     'ingredient_id',r2.ingredient_id,'received_at',r2.received_at
    ) ORDER BY r2.received_at),'[]'::jsonb)
    FROM public.kitch_local_demo_purchase_links l
    JOIN public.kitch_local_demo_receipts r2 ON r2.id=l.receipt_id WHERE l.order_id=o2.id
   )
  ) ORDER BY o2.created_at DESC),'[]'::jsonb) INTO v_result
  FROM public.kitch_local_demo_purchase_orders o2;
  RETURN v_result;
 END IF;
 IF p_action='create' THEN
  IF nullif(btrim(coalesce(p_order_ref,'')),'') IS NULL OR length(p_order_ref)>80
  OR nullif(btrim(coalesce(p_supplier_name,'')),'') IS NULL OR length(p_supplier_name)>200
  OR p_lines IS NULL OR jsonb_typeof(p_lines)<>'array'
  OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'Valid supplier, order number and 1–100 lines required'; END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
   v_count:=v_count+1;
   IF line->>'line_key' IS DISTINCT FROM 'line-'||v_count
   THEN RAISE EXCEPTION 'Invalid line sequence'; END IF;
   SELECT * INTO i FROM public.kitch_local_demo_ingredients
   WHERE id=(line->>'ingredient_id')::uuid AND is_active;
   IF NOT FOUND OR i.base_unit IS DISTINCT FROM line->>'unit'
   OR i.name IS DISTINCT FROM line->>'name'
   THEN RAISE EXCEPTION 'Invalid ingredient, name or base unit on line %',v_count; END IF;
   v_qty:=(line->>'qty')::numeric;v_price:=(line->>'price')::numeric;
   IF v_qty IS NULL OR v_price IS NULL OR v_qty<=0 OR v_qty>100000000
      OR v_price<0 OR v_price>100000000
   THEN RAISE EXCEPTION 'Invalid quantity or price on line %',v_count; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) p
             WHERE p.value->>'ingredient_id'=line->>'ingredient_id'
             GROUP BY p.value->>'ingredient_id' HAVING count(*)>1)
   THEN RAISE EXCEPTION 'Duplicate ingredient in purchase order'; END IF;
  END LOOP;
  INSERT INTO public.kitch_local_demo_purchase_orders(order_ref,supplier_name,lines,delivery_date,notes)
  VALUES(btrim(p_order_ref),btrim(p_supplier_name),p_lines,p_delivery_date,left(coalesce(p_notes,''),500))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('saved',true,'id',v_id,'local_demo',true);
 END IF;

 IF p_order_id IS NULL THEN RAISE EXCEPTION 'Order ID required'; END IF;
 SELECT * INTO o FROM public.kitch_local_demo_purchase_orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
 IF p_action='approve' THEN
  IF o.status<>'Pending Approval' THEN RAISE EXCEPTION 'Order is not pending approval'; END IF;
  UPDATE public.kitch_local_demo_purchase_orders SET status='Approved',updated_at=now() WHERE id=o.id;
 ELSIF p_action='reject' THEN
  IF o.status<>'Pending Approval' THEN RAISE EXCEPTION 'Order is not pending approval'; END IF;
  UPDATE public.kitch_local_demo_purchase_orders SET status='Rejected',updated_at=now() WHERE id=o.id;
 ELSIF p_action='mark_sent' THEN
  IF o.status<>'Approved' THEN RAISE EXCEPTION 'Approve the request before marking sent'; END IF;
  UPDATE public.kitch_local_demo_purchase_orders SET status='Open',updated_at=now() WHERE id=o.id;
 ELSIF p_action='link_receipt' THEN
  IF o.status<>'Open' THEN RAISE EXCEPTION 'Only sent orders can link receipts'; END IF;
  SELECT * INTO r FROM public.kitch_local_demo_receipts WHERE id=p_receipt_id;
  IF NOT FOUND OR lower(btrim(r.supplier))<>lower(btrim(o.supplier_name))
  THEN RAISE EXCEPTION 'Supplier or receipt does not match'; END IF;
  SELECT value INTO selected_line FROM jsonb_array_elements(o.lines)
   WHERE value->>'line_key'=p_line_key LIMIT 1;
  IF selected_line IS NULL OR (selected_line->>'ingredient_id')::uuid<>r.ingredient_id
  OR selected_line->>'unit'<>r.unit
  THEN RAISE EXCEPTION 'Receipt ingredient or stock unit mismatch'; END IF;
  IF r.accepted<=0 OR nullif(btrim(r.invoice),'') IS NULL
  THEN RAISE EXCEPTION 'Receipt must contain accepted stock and supplier invoice'; END IF;
  IF EXISTS(SELECT 1 FROM public.kitch_local_demo_purchase_links WHERE receipt_id=r.id)
  THEN RAISE EXCEPTION 'Receipt line already linked'; END IF;
  SELECT coalesce(sum(rr.accepted),0) INTO v_received
   FROM public.kitch_local_demo_purchase_links l
   JOIN public.kitch_local_demo_receipts rr ON rr.id=l.receipt_id
   WHERE l.order_id=o.id AND l.line_key=p_line_key;
  IF v_received+r.accepted>(selected_line->>'qty')::numeric
  THEN RAISE EXCEPTION 'Received quantity exceeds ordered quantity'; END IF;
  INSERT INTO public.kitch_local_demo_purchase_links(order_id,receipt_id,line_key)
   VALUES(o.id,r.id,p_line_key);
 ELSIF p_action='approve_invoice' THEN
  IF o.status<>'Open' OR o.invoice_status='Approved'
  THEN RAISE EXCEPTION 'Invoice approval not permitted'; END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(o.lines) LOOP
   SELECT coalesce(sum(rr.accepted),0),count(*) INTO v_received,v_has_links
    FROM public.kitch_local_demo_purchase_links l
    JOIN public.kitch_local_demo_receipts rr ON rr.id=l.receipt_id
    WHERE l.order_id=o.id AND l.line_key=line->>'line_key';
   IF v_received<>(line->>'qty')::numeric OR v_has_links=0
   THEN RAISE EXCEPTION 'Invoice approval requires fully matched quantities'; END IF;
  END LOOP;
  SELECT count(*) INTO v_mismatches FROM public.kitch_local_demo_purchase_links l
   JOIN public.kitch_local_demo_receipts rr ON rr.id=l.receipt_id
   CROSS JOIN LATERAL jsonb_array_elements(o.lines) ln
   WHERE l.order_id=o.id AND ln->>'line_key'=l.line_key
   AND abs(rr.price-(ln->>'price')::numeric)>0.01;
  IF v_mismatches>0 THEN RAISE EXCEPTION 'Invoice price mismatch: review variance'; END IF;
  UPDATE public.kitch_local_demo_purchase_orders SET invoice_status='Approved',updated_at=now() WHERE id=o.id;
 ELSIF p_action='hold_invoice' THEN
  IF o.invoice_status='Approved' THEN RAISE EXCEPTION 'Approved invoice cannot be held'; END IF;
  UPDATE public.kitch_local_demo_purchase_orders SET invoice_status='Hold',updated_at=now() WHERE id=o.id;
 ELSE
  RAISE EXCEPTION 'Unknown purchasing action';
 END IF;
 RETURN jsonb_build_object('saved',true,'order_id',o.id,'local_demo',true);
END $fn$;

REVOKE EXECUTE ON FUNCTION public.kitch_team_purchase_cloud(text,text,text,uuid,text,text,jsonb,date,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kitch_team_purchase_cloud(text,text,text,uuid,text,text,jsonb,date,text,uuid,text) TO anon,authenticated;
COMMIT;
SELECT count(*) AS local_purchase_orders FROM public.kitch_local_demo_purchase_orders;
