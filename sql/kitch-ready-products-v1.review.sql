-- KITCH Ready Products V1: isolated from ingredient master/inventory.
-- REVIEW ONLY. Do not apply to the production Supabase database until an approved release.
-- Tables are RLS-enabled, API privileges revoked, all actions via authorized RPC.
create table if not exists public.kitch_ready_products (
 id bigint generated always as identity primary key,
 restaurant_id uuid not null references public.restaurants(id),
 sku text not null check (sku ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
 name text not null check (length(trim(name)) between 1 and 160),
 category text not null default 'Prepared Food',
 unit text not null check (unit in ('pcs','portion','pack','kg','g','ltr','ml')),
 pack_size numeric not null default 1 check(pack_size>0 and pack_size<=100000),
 unit_cost numeric not null default 0 check(unit_cost>=0),
 source text not null default 'Central Kitchen',
 shelf_life_days integer not null default 1 check(shelf_life_days between 0 and 3650),
 storage text not null default 'Chilled' check(lower(storage) in ('chilled','frozen','ambient','hot')),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(restaurant_id,sku),
 unique(id,restaurant_id)
);
create table if not exists public.kitch_ready_batches (
 id bigint generated always as identity primary key,
 restaurant_id uuid not null references public.restaurants(id),
 product_id bigint not null,
 branch_id uuid not null references public.branches(id),
 batch_no text not null check(length(trim(batch_no)) between 1 and 80),
 produced_on date not null default current_date,
 expiry_date date not null,
 created_at timestamptz not null default now(),
 unique(restaurant_id,product_id,branch_id,batch_no),
 foreign key(product_id,restaurant_id) references public.kitch_ready_products(id,restaurant_id),
 check(expiry_date>=produced_on)
);
create table if not exists public.kitch_ready_requests (
 id bigint generated always as identity primary key,
 restaurant_id uuid not null references public.restaurants(id),
 branch_id uuid not null references public.branches(id),
 product_id bigint not null,
 qty numeric not null check(qty>0 and qty<=100000),
 unit text not null,
 status text not null default 'Requested' check(status in ('Requested','Accepted','In Transfer','Received','Cancelled')),
 batch_id bigint references public.kitch_ready_batches(id),
 sent_qty numeric not null default 0 check(sent_qty>=0),
 accepted_qty numeric not null default 0 check(accepted_qty>=0),
 rejected_qty numeric not null default 0 check(rejected_qty>=0),
 requested_by text,
 accepted_by text,
 dispatched_by text,
 received_by text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(product_id,restaurant_id) references public.kitch_ready_products(id,restaurant_id)
);
create table if not exists public.kitch_ready_movements (
 id bigint generated always as identity primary key,
 restaurant_id uuid not null references public.restaurants(id),
 branch_id uuid not null references public.branches(id),
 product_id bigint not null,
 batch_id bigint not null references public.kitch_ready_batches(id),
 request_id bigint references public.kitch_ready_requests(id),
 kind text not null check(kind in ('production_in','dispatch_out','receive_in','rejection_in')),
 qty_delta numeric not null check(qty_delta<>0),
 recorded_by text not null,
 created_at timestamptz not null default now(),
 foreign key(product_id,restaurant_id) references public.kitch_ready_products(id,restaurant_id)
);
create index if not exists kitch_ready_products_restaurant on public.kitch_ready_products(restaurant_id,active);
create index if not exists kitch_ready_batches_restaurant on public.kitch_ready_batches(restaurant_id,branch_id,product_id);
create index if not exists kitch_ready_requests_restaurant on public.kitch_ready_requests(restaurant_id,branch_id,status);
create index if not exists kitch_ready_movements_balance on public.kitch_ready_movements(restaurant_id,branch_id,batch_id);
alter table public.kitch_ready_products enable row level security;
alter table public.kitch_ready_batches enable row level security;
alter table public.kitch_ready_requests enable row level security;
alter table public.kitch_ready_movements enable row level security;
revoke all on public.kitch_ready_products,public.kitch_ready_batches,public.kitch_ready_requests,public.kitch_ready_movements from public,anon,authenticated;
-- The RPC is the only exposed API. No direct inserts or updates are granted.
create or replace function public.kitch_ready_product_action(
 p_action text,
 p_payload jsonb default '{}'::jsonb,
 p_staff_name text default null,
 p_pin text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
 a public.staff_access%rowtype;
 v_owner uuid;
 v_restaurant uuid;
 v_role text;
 v_branch uuid;
 v_central uuid;
 v_product public.kitch_ready_products%rowtype;
 v_batch public.kitch_ready_batches%rowtype;
 v_request public.kitch_ready_requests%rowtype;
 v_row jsonb;
 v_rows jsonb;
 v_sku text;
 v_name text;
 v_unit text;
 v_qty numeric;
 v_accepted numeric;
 v_rejected numeric;
 v_available numeric;
 v_batch_no text;
 v_expiry date;
 v_produced date;
 v_count int:=0;
 v_user text;
begin
 -- An owner is verified by the current authenticated user; staff by a unique active PIN identity.
 -- Explicit staff PIN authentication takes precedence over any retained browser owner JWT.
 -- This prevents an operational staff session from inheriting another user's owner scope.
 if p_staff_name is null and auth.uid() is not null then
  select o.restaurant_id into v_owner from public.kitch_office_owners o
  where o.user_id=auth.uid() and o.is_active=true limit 1;
 end if;
 if v_owner is not null then
  v_restaurant:=v_owner; v_role:='owner';v_user:='Main Office';
 else
  if p_staff_name is null or p_pin !~ '^[0-9]{4}
  if (select count(*) from public.staff_access s where s.is_active and lower(trim(s.staff_name))=lower(trim(p_staff_name))
   and s.pin_hash=encode(extensions.digest(p_pin,'sha256'),'hex'))<>1 then raise exception 'Invalid staff credentials';end if;
  select * into a from public.staff_access s where s.is_active and lower(trim(s.staff_name))=lower(trim(p_staff_name))
   and s.pin_hash=encode(extensions.digest(p_pin,'sha256'),'hex') limit 1;
  v_restaurant:=a.restaurant_id;v_branch:=a.branch_id;v_role:=a.role::text;v_user:=a.staff_name;
 end if;
 if v_restaurant is null then raise exception 'Unauthorized';end if;
 if p_action='overview' then
  return jsonb_build_object(
   'catalog',(select coalesce(jsonb_agg(to_jsonb(p) order by p.name),'[]'::jsonb) from public.kitch_ready_products p where p.restaurant_id=v_restaurant),
   'requests',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('sku',p.sku,'product_name',p.name,'branch_name',b.name)
      order by r.id desc),'[]'::jsonb)
     from public.kitch_ready_requests r
     join public.kitch_ready_products p on p.id=r.product_id
     join public.branches b on b.id=r.branch_id
     where r.restaurant_id=v_restaurant and (v_role in ('owner','store_manager','operations_manager') or r.branch_id=v_branch))
  );
 end if;
 if p_action='import' then
  if v_role not in ('owner','store_manager','operations_manager') then raise exception 'Catalog management not permitted';end if;
  v_rows:=p_payload->'products';
  if jsonb_typeof(v_rows)<>'array' or jsonb_array_length(v_rows)<1 or jsonb_array_length(v_rows)>500 then raise exception 'Import 1–500 ready products';end if;
  for v_row in select value from jsonb_array_elements(v_rows) loop
   v_sku:=upper(trim(v_row->>'sku'));v_name:=trim(v_row->>'name');v_unit:=lower(trim(v_row->>'unit'));
   if v_sku !~ '^[A-Z0-9][A-Z0-9_-]{1,39}$' or length(v_name) not between 1 and 160
      or v_unit not in ('pcs','portion','pack','kg','g','ltr','ml') then raise exception 'Invalid ready product SKU/name/unit';end if;
   insert into public.kitch_ready_products(restaurant_id,sku,name,category,unit,pack_size,unit_cost,source,shelf_life_days,storage,active)
    values(v_restaurant,v_sku,v_name,coalesce(nullif(trim(v_row->>'category'),''),'Prepared Food'),v_unit,
     (v_row->>'pack_size')::numeric,(v_row->>'unit_cost')::numeric,'Central Kitchen',
     (v_row->>'shelf_life_days')::integer,coalesce(nullif(trim(v_row->>'storage'),''),'Chilled'),
     coalesce((v_row->>'active')::boolean,true))
   on conflict(restaurant_id,sku) do update
    set name=excluded.name,category=excluded.category,unit_cost=excluded.unit_cost,
        pack_size=excluded.pack_size,shelf_life_days=excluded.shelf_life_days,storage=excluded.storage,
        active=excluded.active,updated_at=now()
    where public.kitch_ready_products.unit=excluded.unit;
   if not found then raise exception 'Unit cannot change for a stocked product %',v_sku;end if;
   v_count:=v_count+1;
  end loop;
  return jsonb_build_object('saved',true,'count',v_count);
 end if;
 if p_action='batch' then
  if v_role not in ('owner','store_manager','operations_manager','kitchen_manager','production_staff') then raise exception 'Batch recording not permitted';end if;
  v_sku:=upper(trim(p_payload->>'sku'));v_qty:=(p_payload->>'qty')::numeric;
  v_batch_no:=trim(p_payload->>'batch_no');
  v_produced:=(p_payload->>'produced_on')::date;v_expiry:=(p_payload->>'expiry_date')::date;
  if v_qty is null or v_qty<=0 or v_qty>100000 or length(v_batch_no) not between 1 and 80 or v_expiry<v_produced then raise exception 'Invalid production batch';end if;
  select * into v_product from public.kitch_ready_products p where p.restaurant_id=v_restaurant and p.sku=v_sku and p.active;
  if not found then raise exception 'Ready product not found';end if;
  select id into v_central from public.branches b where b.restaurant_id=v_restaurant and b.is_active
     and (lower(b.name) like '%central%kitchen%' or lower(b.code) like '%central%kitchen%') limit 1;
  if v_central is null then raise exception 'Central Kitchen branch must be configured first';end if;
  if v_role='production_staff' and v_branch is distinct from v_central then raise exception 'Production permission is limited to Central Kitchen';end if;
  insert into public.kitch_ready_batches(restaurant_id,product_id,branch_id,batch_no,produced_on,expiry_date)
   values(v_restaurant,v_product.id,v_central,v_batch_no,v_produced,v_expiry)
   on conflict(restaurant_id,product_id,branch_id,batch_no) do nothing;
  select * into v_batch from public.kitch_ready_batches b where b.restaurant_id=v_restaurant and b.product_id=v_product.id and b.branch_id=v_central and b.batch_no=v_batch_no for update;
  if v_batch.produced_on<>v_produced or v_batch.expiry_date<>v_expiry then raise exception 'Existing batch date mismatch';end if;
  insert into public.kitch_ready_movements(restaurant_id,branch_id,product_id,batch_id,kind,qty_delta,recorded_by)
   values(v_restaurant,v_central,v_product.id,v_batch.id,'production_in',v_qty,v_user);
  return jsonb_build_object('saved',true,'batch_id',v_batch.id);
 end if;
 if p_action='create' then
  if v_role not in ('owner','operations_manager','kitchen_manager') then raise exception 'Request not permitted';end if;
  v_branch:=coalesce(v_branch,(p_payload->>'branch_id')::uuid);
  if v_branch is null or not exists(select 1 from public.branches b where b.id=v_branch and b.restaurant_id=v_restaurant and b.is_active) then raise exception 'Active destination branch required';end if;
  v_sku:=upper(trim(p_payload->>'sku'));v_qty:=(p_payload->>'qty')::numeric;v_unit:=lower(trim(p_payload->>'unit'));
  select * into v_product from public.kitch_ready_products p where p.restaurant_id=v_restaurant and p.sku=v_sku and p.active;
  if not found or v_unit<>v_product.unit or v_qty is null or v_qty<=0 or v_qty>100000 then raise exception 'Invalid ready product or quantity';end if;
  insert into public.kitch_ready_requests(restaurant_id,branch_id,product_id,qty,unit,requested_by)
   values(v_restaurant,v_branch,v_product.id,v_qty,v_product.unit,v_user);
  return jsonb_build_object('saved',true);
 end if;
 v_qty:=(p_payload->>'request_id')::bigint;
 if v_qty is null then raise exception 'Request ID required';end if;
 select * into v_request from public.kitch_ready_requests r where r.id=v_qty and r.restaurant_id=v_restaurant for update;
 if not found then raise exception 'Request not found';end if;
 select * into v_product from public.kitch_ready_products p where p.id=v_request.product_id and p.restaurant_id=v_restaurant;
 if p_action='accept' then
  if v_role not in ('owner','store_manager','operations_manager') or v_request.status<>'Requested' then raise exception 'Cannot accept request';end if;
  update public.kitch_ready_requests set status='Accepted',accepted_by=v_user,updated_at=now() where id=v_request.id;
  return jsonb_build_object('saved',true);
 end if;
 if p_action='dispatch' then
  if v_role not in ('owner','store_manager','operations_manager') or v_request.status<>'Accepted' then raise exception 'Cannot dispatch request';end if;
  v_batch_no:=trim(p_payload->>'batch_no');
  v_expiry:=(p_payload->>'expiry_date')::date;
  v_qty:=(p_payload->>'qty')::numeric;
  if v_qty is null or v_qty<=0 or v_qty>v_request.qty then raise exception 'Dispatch exceeds request';end if;
  select id into v_central from public.branches b where b.restaurant_id=v_restaurant and b.is_active
     and (lower(b.name) like '%central%kitchen%' or lower(b.code) like '%central%kitchen%') limit 1;
  if v_central is null then raise exception 'Central Kitchen not configured';end if;
  select * into v_batch from public.kitch_ready_batches b where b.restaurant_id=v_restaurant
    and b.product_id=v_product.id and b.branch_id=v_central and b.batch_no=v_batch_no and b.expiry_date=v_expiry for update;
  if not found or v_batch.expiry_date<current_date then raise exception 'Valid unexpired production batch not found';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_restaurant::text||v_batch.id::text,0));
  select coalesce(sum(m.qty_delta),0) into v_available from public.kitch_ready_movements m
    where m.restaurant_id=v_restaurant and m.branch_id=v_central and m.batch_id=v_batch.id;
  if v_qty>v_available then raise exception 'Insufficient finished-batch stock';end if;
  insert into public.kitch_ready_movements(restaurant_id,branch_id,product_id,batch_id,request_id,kind,qty_delta,recorded_by)
   values(v_restaurant,v_central,v_product.id,v_batch.id,v_request.id,'dispatch_out',-v_qty,v_user);
  update public.kitch_ready_requests set status='In Transfer',batch_id=v_batch.id,sent_qty=v_qty,dispatched_by=v_user,updated_at=now() where id=v_request.id;
  return jsonb_build_object('saved',true);
 end if;
 if p_action='receive' then
  if v_role not in ('owner','operations_manager','kitchen_manager') or (v_role<>'owner' and v_branch is distinct from v_request.branch_id)
     or v_request.status<>'In Transfer' then raise exception 'Cannot receive request';end if;
  v_accepted:=(p_payload->>'accepted_qty')::numeric;v_rejected:=(p_payload->>'rejected_qty')::numeric;
  if v_accepted is null or v_rejected is null or v_accepted<0 or v_rejected<0 or v_accepted+v_rejected<>v_request.sent_qty then raise exception 'Accepted and rejected amounts must reconcile exactly to dispatched quantity';end if;
  -- Short-delivered or rejected items remain out of branch stock; handled by reconciliation.
  if v_accepted>0 then
   insert into public.kitch_ready_movements(restaurant_id,branch_id,product_id,batch_id,request_id,kind,qty_delta,recorded_by)
    values(v_restaurant,v_request.branch_id,v_product.id,v_request.batch_id,v_request.id,'receive_in',v_accepted,v_user);
  end if;
  update public.kitch_ready_requests set status='Received',accepted_qty=v_accepted,rejected_qty=v_rejected,received_by=v_user,updated_at=now() where id=v_request.id;
  return jsonb_build_object('saved',true);
 end if;
 raise exception 'Unsupported Ready Products action';
end
$function$;
revoke all on function public.kitch_ready_product_action(text,jsonb,text,text) from public;
grant execute on function public.kitch_ready_product_action(text,jsonb,text,text) to anon,authenticated;
-- Test: unauthorized request must throw; tenant A catalog must never appear for tenant B.
-- Test: duplicate dispatch / receipt cannot create extra movement rows.
-- Test: missing batch / expired batch / insufficient stock fails without a movement.
 then raise exception 'Staff authentication required';end if;
  if (select count(*) from public.staff_access s where s.is_active and lower(trim(s.staff_name))=lower(trim(p_staff_name))
   and s.pin_hash=encode(extensions.digest(p_pin,'sha256'),'hex'))<>1 then raise exception 'Invalid staff credentials';end if;
  select * into a from public.staff_access s where s.is_active and lower(trim(s.staff_name))=lower(trim(p_staff_name))
   and s.pin_hash=encode(extensions.digest(p_pin,'sha256'),'hex') limit 1;
  v_restaurant:=a.restaurant_id;v_branch:=a.branch_id;v_role:=a.role::text;v_user:=a.staff_name;
 end if;
 if v_restaurant is null then raise exception 'Unauthorized';end if;
 if p_action='overview' then
  return jsonb_build_object(
   'catalog',(select coalesce(jsonb_agg(to_jsonb(p) order by p.name),'[]'::jsonb) from public.kitch_ready_products p where p.restaurant_id=v_restaurant),
   'requests',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('sku',p.sku,'product_name',p.name,'branch_name',b.name)
      order by r.id desc),'[]'::jsonb)
     from public.kitch_ready_requests r
     join public.kitch_ready_products p on p.id=r.product_id
     join public.branches b on b.id=r.branch_id
     where r.restaurant_id=v_restaurant and (v_role in ('owner','store_manager','operations_manager') or r.branch_id=v_branch))
  );
 end if;
 if p_action='import' then
  if v_role not in ('owner','store_manager','operations_manager') then raise exception 'Catalog management not permitted';end if;
  v_rows:=p_payload->'products';
  if jsonb_typeof(v_rows)<>'array' or jsonb_array_length(v_rows)<1 or jsonb_array_length(v_rows)>500 then raise exception 'Import 1–500 ready products';end if;
  for v_row in select value from jsonb_array_elements(v_rows) loop
   v_sku:=upper(trim(v_row->>'sku'));v_name:=trim(v_row->>'name');v_unit:=lower(trim(v_row->>'unit'));
   if v_sku !~ '^[A-Z0-9][A-Z0-9_-]{1,39}$' or length(v_name) not between 1 and 160
      or v_unit not in ('pcs','portion','pack','kg','g','ltr','ml') then raise exception 'Invalid ready product SKU/name/unit';end if;
   insert into public.kitch_ready_products(restaurant_id,sku,name,category,unit,pack_size,unit_cost,source,shelf_life_days,storage,active)
    values(v_restaurant,v_sku,v_name,coalesce(nullif(trim(v_row->>'category'),''),'Prepared Food'),v_unit,
     (v_row->>'pack_size')::numeric,(v_row->>'unit_cost')::numeric,'Central Kitchen',
     (v_row->>'shelf_life_days')::integer,coalesce(nullif(trim(v_row->>'storage'),''),'Chilled'),
     coalesce((v_row->>'active')::boolean,true))
   on conflict(restaurant_id,sku) do update
    set name=excluded.name,category=excluded.category,unit_cost=excluded.unit_cost,
        pack_size=excluded.pack_size,shelf_life_days=excluded.shelf_life_days,storage=excluded.storage,
        active=excluded.active,updated_at=now()
    where public.kitch_ready_products.unit=excluded.unit;
   if not found then raise exception 'Unit cannot change for a stocked product %',v_sku;end if;
   v_count:=v_count+1;
  end loop;
  return jsonb_build_object('saved',true,'count',v_count);
 end if;
 if p_action='batch' then
  if v_role not in ('owner','store_manager','operations_manager','kitchen_manager','production_staff') then raise exception 'Batch recording not permitted';end if;
  v_sku:=upper(trim(p_payload->>'sku'));v_qty:=(p_payload->>'qty')::numeric;
  v_batch_no:=trim(p_payload->>'batch_no');
  v_produced:=(p_payload->>'produced_on')::date;v_expiry:=(p_payload->>'expiry_date')::date;
  if v_qty is null or v_qty<=0 or v_qty>100000 or length(v_batch_no) not between 1 and 80 or v_expiry<v_produced then raise exception 'Invalid production batch';end if;
  select * into v_product from public.kitch_ready_products p where p.restaurant_id=v_restaurant and p.sku=v_sku and p.active;
  if not found then raise exception 'Ready product not found';end if;
  select id into v_central from public.branches b where b.restaurant_id=v_restaurant and b.is_active
     and (lower(b.name) like '%central%kitchen%' or lower(b.code) like '%central%kitchen%') limit 1;
  if v_central is null then raise exception 'Central Kitchen branch must be configured first';end if;
  if v_role='production_staff' and v_branch is distinct from v_central then raise exception 'Production permission is limited to Central Kitchen';end if;
  insert into public.kitch_ready_batches(restaurant_id,product_id,branch_id,batch_no,produced_on,expiry_date)
   values(v_restaurant,v_product.id,v_central,v_batch_no,v_produced,v_expiry)
   on conflict(restaurant_id,product_id,branch_id,batch_no) do nothing;
  select * into v_batch from public.kitch_ready_batches b where b.restaurant_id=v_restaurant and b.product_id=v_product.id and b.branch_id=v_central and b.batch_no=v_batch_no for update;
  if v_batch.produced_on<>v_produced or v_batch.expiry_date<>v_expiry then raise exception 'Existing batch date mismatch';end if;
  insert into public.kitch_ready_movements(restaurant_id,branch_id,product_id,batch_id,kind,qty_delta,recorded_by)
   values(v_restaurant,v_central,v_product.id,v_batch.id,'production_in',v_qty,v_user);
  return jsonb_build_object('saved',true,'batch_id',v_batch.id);
 end if;
 if p_action='create' then
  if v_role not in ('owner','operations_manager','kitchen_manager') then raise exception 'Request not permitted';end if;
  v_branch:=coalesce(v_branch,(p_payload->>'branch_id')::uuid);
  if v_branch is null or not exists(select 1 from public.branches b where b.id=v_branch and b.restaurant_id=v_restaurant and b.is_active) then raise exception 'Active destination branch required';end if;
  v_sku:=upper(trim(p_payload->>'sku'));v_qty:=(p_payload->>'qty')::numeric;v_unit:=lower(trim(p_payload->>'unit'));
  select * into v_product from public.kitch_ready_products p where p.restaurant_id=v_restaurant and p.sku=v_sku and p.active;
  if not found or v_unit<>v_product.unit or v_qty is null or v_qty<=0 or v_qty>100000 then raise exception 'Invalid ready product or quantity';end if;
  insert into public.kitch_ready_requests(restaurant_id,branch_id,product_id,qty,unit,requested_by)
   values(v_restaurant,v_branch,v_product.id,v_qty,v_product.unit,v_user);
  return jsonb_build_object('saved',true);
 end if;
 v_qty:=(p_payload->>'request_id')::bigint;
 if v_qty is null then raise exception 'Request ID required';end if;
 select * into v_request from public.kitch_ready_requests r where r.id=v_qty and r.restaurant_id=v_restaurant for update;
 if not found then raise exception 'Request not found';end if;
 select * into v_product from public.kitch_ready_products p where p.id=v_request.product_id and p.restaurant_id=v_restaurant;
 if p_action='accept' then
  if v_role not in ('owner','store_manager','operations_manager') or v_request.status<>'Requested' then raise exception 'Cannot accept request';end if;
  update public.kitch_ready_requests set status='Accepted',accepted_by=v_user,updated_at=now() where id=v_request.id;
  return jsonb_build_object('saved',true);
 end if;
 if p_action='dispatch' then
  if v_role not in ('owner','store_manager','operations_manager') or v_request.status<>'Accepted' then raise exception 'Cannot dispatch request';end if;
  v_batch_no:=trim(p_payload->>'batch_no');
  v_expiry:=(p_payload->>'expiry_date')::date;
  v_qty:=(p_payload->>'qty')::numeric;
  if v_qty is null or v_qty<=0 or v_qty>v_request.qty then raise exception 'Dispatch exceeds request';end if;
  select id into v_central from public.branches b where b.restaurant_id=v_restaurant and b.is_active
     and (lower(b.name) like '%central%kitchen%' or lower(b.code) like '%central%kitchen%') limit 1;
  if v_central is null then raise exception 'Central Kitchen not configured';end if;
  select * into v_batch from public.kitch_ready_batches b where b.restaurant_id=v_restaurant
    and b.product_id=v_product.id and b.branch_id=v_central and b.batch_no=v_batch_no and b.expiry_date=v_expiry for update;
  if not found or v_batch.expiry_date<current_date then raise exception 'Valid unexpired production batch not found';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_restaurant::text||v_batch.id::text,0));
  select coalesce(sum(m.qty_delta),0) into v_available from public.kitch_ready_movements m
    where m.restaurant_id=v_restaurant and m.branch_id=v_central and m.batch_id=v_batch.id;
  if v_qty>v_available then raise exception 'Insufficient finished-batch stock';end if;
  insert into public.kitch_ready_movements(restaurant_id,branch_id,product_id,batch_id,request_id,kind,qty_delta,recorded_by)
   values(v_restaurant,v_central,v_product.id,v_batch.id,v_request.id,'dispatch_out',-v_qty,v_user);
  update public.kitch_ready_requests set status='In Transfer',batch_id=v_batch.id,sent_qty=v_qty,dispatched_by=v_user,updated_at=now() where id=v_request.id;
  return jsonb_build_object('saved',true);
 end if;
 if p_action='receive' then
  if v_role not in ('owner','operations_manager','kitchen_manager') or (v_role<>'owner' and v_branch is distinct from v_request.branch_id)
     or v_request.status<>'In Transfer' then raise exception 'Cannot receive request';end if;
  v_accepted:=(p_payload->>'accepted_qty')::numeric;v_rejected:=(p_payload->>'rejected_qty')::numeric;
  if v_accepted is null or v_rejected is null or v_accepted<0 or v_rejected<0 or v_accepted+v_rejected>v_request.sent_qty then raise exception 'Invalid receiving quantities';end if;
  -- Short-delivered or rejected items remain out of branch stock; handled by reconciliation.
  if v_accepted>0 then
   insert into public.kitch_ready_movements(restaurant_id,branch_id,product_id,batch_id,request_id,kind,qty_delta,recorded_by)
    values(v_restaurant,v_request.branch_id,v_product.id,v_request.batch_id,v_request.id,'receive_in',v_accepted,v_user);
  end if;
  update public.kitch_ready_requests set status='Received',accepted_qty=v_accepted,rejected_qty=v_rejected,received_by=v_user,updated_at=now() where id=v_request.id;
  return jsonb_build_object('saved',true);
 end if;
 raise exception 'Unsupported Ready Products action';
end
$function$;
revoke all on function public.kitch_ready_product_action(text,jsonb,text,text) from public;
grant execute on function public.kitch_ready_product_action(text,jsonb,text,text) to anon,authenticated;
-- Test: unauthorized request must throw; tenant A catalog must never appear for tenant B.
-- Test: duplicate dispatch / receipt cannot create extra movement rows.
-- Test: missing batch / expired batch / insufficient stock fails without a movement.
