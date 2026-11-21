-- KITCH staged cloud stock controls. NOT APPLIED TO LIVE DATABASE.
-- All stock mutations are atomic, tied to staff + assigned branch, idempotent by transaction UUID.
create table if not exists public.kitch_cloud_stock_controls(
 id uuid primary key,restaurant_id uuid not null references public.restaurants(id),
 branch_id uuid not null references public.branches(id),
 ingredient_id uuid not null references public.ingredients(id),
 staff_id uuid not null references public.staff_access(id),
 control_type text not null check(control_type in ('waste','adjustment')),
 quantity_delta numeric not null check(quantity_delta<>0),
 unit text not null,unit_cost numeric not null,
 reason text not null,note text,created_at timestamptz not null default now());
alter table public.kitch_cloud_stock_controls enable row level security;
revoke all on public.kitch_cloud_stock_controls from public,anon,authenticated;
create index if not exists kitch_cloud_stock_controls_location_idx on public.kitch_cloud_stock_controls(restaurant_id,branch_id,created_at);

create or replace function public.kitch_team_cloud_stock_control(
 p_staff_name text,p_pin text,p_transaction_id uuid,p_ingredient_id uuid,
 p_action text,p_quantity_delta numeric,p_unit text,p_reason text,p_note text default null)
 returns jsonb language plpgsql security definer set search_path='' as $fn$
declare a public.staff_access%rowtype;i public.ingredients%rowtype;bal numeric;
 price numeric; prior public.kitch_cloud_stock_controls%rowtype; mt public.inventory_movement_type;
begin
 if nullif(trim(coalesce(p_staff_name,'')),'') is null or trim(coalesce(p_pin,'')) !~ '^[0-9]{4}$' then raise exception 'Invalid staff credentials';end if;
 if (select count(*) from public.staff_access x where x.is_active
  and lower(trim(x.staff_name))=lower(trim(p_staff_name)) and x.pin_hash=encode(extensions.digest(trim(p_pin),'sha256'),'hex'))<>1 then
  raise exception 'Invalid staff credentials';end if;
 select * into a from public.staff_access x where x.is_active and lower(trim(x.staff_name))=lower(trim(p_staff_name))
 and x.pin_hash=encode(extensions.digest(trim(p_pin),'sha256'),'hex') limit 1;
 if a.branch_id is null then raise exception 'No assigned location';end if;
 if a.role::text not in ('owner','operations_manager','kitchen_manager','executive_chef','store_manager','receiving_staff') then raise exception 'Staff role not permitted';end if;
 if p_action not in ('waste','adjustment') then raise exception 'Invalid action';end if;
 if p_action='adjustment' and a.role::text not in ('owner','operations_manager','kitchen_manager','executive_chef','store_manager') then raise exception 'Adjustment requires manager role';end if;
 if p_action='waste' and (p_quantity_delta is null or p_quantity_delta>=0) then raise exception 'Waste must be a negative quantity';end if;
 if p_quantity_delta is null or p_quantity_delta=0 or abs(p_quantity_delta)>100000 then raise exception 'Invalid quantity';end if;
 if p_transaction_id is null or nullif(trim(coalesce(p_reason,'')),'') is null or length(p_reason)>200 or length(coalesce(p_note,''))>2000 then raise exception 'Invalid reference or reason';end if;
 select * into i from public.ingredients where id=p_ingredient_id and restaurant_id=a.restaurant_id and is_active;
 if not found or lower(trim(p_unit))<>lower(trim(i.base_unit)) then raise exception 'Ingredient or base unit mismatch';end if;
 -- Idempotency: if client retries an already-completed transaction, do not deduct stock again.
 select * into prior from public.kitch_cloud_stock_controls where id=p_transaction_id;
 if found then
  if prior.restaurant_id<>a.restaurant_id or prior.branch_id<>a.branch_id or prior.ingredient_id<>i.id or prior.control_type<>p_action
   or prior.quantity_delta<>p_quantity_delta or prior.unit<>p_unit or prior.reason<>trim(p_reason) then
    raise exception 'Transaction ID already used with different details';end if;
  return jsonb_build_object('saved',true,'already_recorded',true,'transaction_id',prior.id);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(a.restaurant_id::text||':'||a.branch_id::text||':'||i.id::text,0));
 -- Recheck after lock to prevent race during retries.
 select * into prior from public.kitch_cloud_stock_controls where id=p_transaction_id;
 if found then return jsonb_build_object('saved',true,'already_recorded',true,'transaction_id',prior.id);end if;
 select coalesce(sum(m.quantity_delta),0) into bal from public.inventory_movements m
  where m.restaurant_id=a.restaurant_id and m.branch_id=a.branch_id and m.ingredient_id=i.id and lower(trim(m.unit))=lower(trim(i.base_unit));
 if bal+p_quantity_delta<0 then raise exception 'Insufficient cloud inventory: available % %',bal,i.base_unit;end if;
 price:=coalesce(i.last_unit_cost,i.reference_cost,0);
 mt:=case when p_action='waste' then 'waste'::public.inventory_movement_type else 'stock_adjustment'::public.inventory_movement_type end;
 insert into public.kitch_cloud_stock_controls(id,restaurant_id,branch_id,ingredient_id,staff_id,control_type,quantity_delta,unit,unit_cost,reason,note)
 values(p_transaction_id,a.restaurant_id,a.branch_id,i.id,a.id,p_action,p_quantity_delta,i.base_unit,price,trim(p_reason),nullif(trim(coalesce(p_note,'')),''));
 insert into public.inventory_movements(restaurant_id,branch_id,ingredient_id,movement_type,quantity_delta,unit,unit_cost,source_table,source_id,notes)
 values(a.restaurant_id,a.branch_id,i.id,mt,p_quantity_delta,i.base_unit,price,'kitch_cloud_stock_controls',p_transaction_id,trim(p_reason));
 return jsonb_build_object('saved',true,'already_recorded',false,'transaction_id',p_transaction_id,'before_qty',bal,'after_qty',bal+p_quantity_delta,'unit',i.base_unit);
end $fn$;
revoke all on function public.kitch_team_cloud_stock_control(text,text,uuid,uuid,text,numeric,text,text,text) from public;
grant execute on function public.kitch_team_cloud_stock_control(text,text,uuid,uuid,text,numeric,text,text,text) to anon,authenticated;
