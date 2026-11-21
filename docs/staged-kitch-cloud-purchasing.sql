-- Staged migration only: not applied to production. Does not modify existing receipts or stock.
create table if not exists public.kitch_cloud_purchase_orders(
 id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id),
 branch_id uuid not null references public.branches(id), order_ref text not null, supplier_name text not null,
 lines jsonb not null check(jsonb_typeof(lines)='array' and jsonb_array_length(lines)>0),
 delivery_date date, notes text, status text not null default 'Pending Approval'
 check(status in('Pending Approval','Approved','Open','Rejected','Closed')),
 created_by uuid references public.staff_access(id), approved_by uuid references public.staff_access(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(restaurant_id,order_ref));
alter table public.kitch_cloud_purchase_orders enable row level security;
revoke all on public.kitch_cloud_purchase_orders from public,anon,authenticated;
create table if not exists public.kitch_cloud_purchase_receipt_links(
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.kitch_cloud_purchase_orders(id),
 receipt_id uuid not null unique references public.kitch_receiving_entries(id), line_key text not null,created_at timestamptz not null default now());
alter table public.kitch_cloud_purchase_receipt_links enable row level security;
revoke all on public.kitch_cloud_purchase_receipt_links from public,anon,authenticated;
create or replace function public.kitch_team_purchase_cloud(
 p_staff_name text,p_pin text,p_action text,p_order_id uuid default null,p_order_ref text default null,
 p_supplier_name text default null,p_lines jsonb default null,p_delivery_date date default null,
 p_notes text default null,p_receipt_id uuid default null,p_line_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare a public.staff_access%rowtype;o public.kitch_cloud_purchase_orders%rowtype;
 r public.kitch_receiving_entries%rowtype;l jsonb;i public.ingredients%rowtype;q numeric;v_id uuid;v_linked_qty numeric;v_paid numeric;v_existing integer;
begin
 if p_pin !~ '^[0-9]{4}$' or nullif(trim(coalesce(p_staff_name,'')),'') is null then raise exception 'Invalid staff credentials';end if;
 if (select count(*) from public.staff_access x where x.is_active and lower(trim(x.staff_name))=lower(trim(p_staff_name)) and x.pin_hash=encode(extensions.digest(trim(p_pin),'sha256'),'hex'))<>1 then raise exception 'Invalid staff credentials';end if;
 select * into a from public.staff_access x where x.is_active and lower(trim(x.staff_name))=lower(trim(p_staff_name)) and x.pin_hash=encode(extensions.digest(trim(p_pin),'sha256'),'hex') limit 1;
 if a.branch_id is null then raise exception 'Staff must have an assigned location';end if;
 if p_action='list' then
 return (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'order_ref',x.order_ref,'supplier',x.supplier_name,
  'lines',x.lines,'delivery_date',x.delivery_date,'notes',x.notes,'status',x.status,'branch_id',x.branch_id,
  'updated_at',x.updated_at,'receipt_links',(
   select coalesce(jsonb_agg(jsonb_build_object('receipt_id',rl.receipt_id,'line_key',rl.line_key,
      'accepted',rr.delivered_qty-rr.rejected_qty,'unit_price',rr.unit_price,'invoice',rr.invoice_number,
      'supplier',rr.supplier,'ingredient_id',rr.ingredient_id,'received_at',rr.received_at)
      order by rr.received_at),'[]'::jsonb)
   from public.kitch_cloud_purchase_receipt_links rl
   join public.kitch_receiving_entries rr on rr.id=rl.receipt_id where rl.order_id=x.id
  )) order by x.created_at desc),'[]'::jsonb)
 from public.kitch_cloud_purchase_orders x where x.restaurant_id=a.restaurant_id
 and (x.branch_id=a.branch_id or a.role::text in('owner','operations_manager')));
 end if;
 if p_action='create' then
  if a.role::text not in('owner','operations_manager','kitchen_manager','executive_chef') then raise exception 'Purchase creation not permitted';end if;
  if nullif(trim(coalesce(p_order_ref,'')),'') is null or nullif(trim(coalesce(p_supplier_name,'')),'') is null
   or p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100
   or length(p_order_ref)>80 or length(p_supplier_name)>200 then raise exception 'Invalid order';end if;
  for l in select value from jsonb_array_elements(p_lines) loop
   select * into i from public.ingredients where id=(l->>'ingredient_id')::uuid and restaurant_id=a.restaurant_id and is_active;
   if not found or i.base_unit<>l->>'unit' then raise exception 'Invalid ingredient or unit';end if;
   q:=nullif(l->>'qty','')::numeric;
   if q is null or q<=0 or q>100000 or (l->>'price')::numeric<0 then raise exception 'Invalid quantity or price';end if;
  end loop;
  insert into public.kitch_cloud_purchase_orders(restaurant_id,branch_id,order_ref,supplier_name,lines,delivery_date,notes,created_by)
  values(a.restaurant_id,a.branch_id,trim(p_order_ref),trim(p_supplier_name),p_lines,p_delivery_date,p_notes,a.id)
  returning id into v_id;
  return jsonb_build_object('saved',true,'id',v_id);
 end if;
 select * into o from public.kitch_cloud_purchase_orders x where x.id=p_order_id and x.restaurant_id=a.restaurant_id
 and (x.branch_id=a.branch_id or a.role::text in('owner','operations_manager')) for update;
 if not found then raise exception 'Purchase order not found';end if;
 if p_action='approve' then
  if a.role::text not in('owner','operations_manager','kitchen_manager','executive_chef') or o.status<>'Pending Approval' then raise exception 'Approval not permitted';end if;
  update public.kitch_cloud_purchase_orders set status='Approved',approved_by=a.id,updated_at=now() where id=o.id;
 elsif p_action='reject' then
  if a.role::text not in('owner','operations_manager','kitchen_manager','executive_chef') or o.status<>'Pending Approval' then raise exception 'Rejection not permitted';end if;
  update public.kitch_cloud_purchase_orders set status='Rejected',updated_at=now() where id=o.id;
 elsif p_action='mark_sent' then
  if a.role::text not in('owner','operations_manager','kitchen_manager','executive_chef') or o.status<>'Approved' then raise exception 'Sending not permitted';end if;
  update public.kitch_cloud_purchase_orders set status='Open',updated_at=now() where id=o.id;
 elsif p_action='link_receipt' then
  if a.role::text not in('owner','operations_manager','kitchen_manager','executive_chef','receiving_staff') or o.status not in('Approved','Open') then raise exception 'Receipt link not permitted';end if;
  select * into r from public.kitch_receiving_entries where id=p_receipt_id and restaurant_id=a.restaurant_id and branch_id=o.branch_id;
  if not found or lower(trim(r.supplier))<>lower(trim(o.supplier_name)) then raise exception 'Receipt or supplier mismatch';end if;
  select value into l from jsonb_array_elements(o.lines) where value->>'line_key'=p_line_key limit 1;
  if l is null or (l->>'ingredient_id')::uuid<>r.ingredient_id or l->>'unit'<>r.unit then raise exception 'Receipt item mismatch';end if;
  if r.delivered_qty-r.rejected_qty<=0 then raise exception 'Receipt accepted quantity invalid';end if;
  if nullif(trim(coalesce(r.invoice_number,'')),'') is null then raise exception 'Receipt invoice number is missing';end if;
  if exists(select 1 from public.kitch_cloud_purchase_receipt_links where receipt_id=r.id) then raise exception 'Receipt already linked to an order';end if;
  select coalesce(sum(rr.delivered_qty-rr.rejected_qty),0) into v_linked_qty
   from public.kitch_cloud_purchase_receipt_links rl
   join public.kitch_receiving_entries rr on rr.id=rl.receipt_id
   where rl.order_id=o.id and rl.line_key=p_line_key;
  if v_linked_qty+(r.delivered_qty-r.rejected_qty)>(l->>'qty')::numeric then raise exception 'Linked receipts exceed ordered quantity';end if;
  insert into public.kitch_cloud_purchase_receipt_links(order_id,receipt_id,line_key) values(o.id,r.id,p_line_key);
 else raise exception 'Unknown action';end if;
 return jsonb_build_object('saved',true,'order_id',o.id);
end $fn$;
revoke all on function public.kitch_team_purchase_cloud(text,text,text,uuid,text,text,jsonb,date,text,uuid,text) from public;
grant execute on function public.kitch_team_purchase_cloud(text,text,text,uuid,text,text,jsonb,date,text,uuid,text) to anon,authenticated;
