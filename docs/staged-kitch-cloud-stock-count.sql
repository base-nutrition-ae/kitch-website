-- STAGED ONLY: apply only after controlled integration tests. Does not update existing inventory until finalize RPC is invoked.
create table if not exists public.kitch_cloud_stock_counts(
 id uuid primary key,restaurant_id uuid not null references public.restaurants(id),
 branch_id uuid not null references public.branches(id),staff_id uuid not null references public.staff_access(id),
 status text not null default 'Completed' check(status='Completed'),
 lines jsonb not null check(jsonb_typeof(lines)='array' and jsonb_array_length(lines)>0),
 total_variance_cost numeric not null default 0,completed_at timestamptz not null default now());
alter table public.kitch_cloud_stock_counts enable row level security;
revoke all on public.kitch_cloud_stock_counts from public,anon,authenticated;
create index if not exists kitch_cloud_counts_location_idx on public.kitch_cloud_stock_counts(restaurant_id,branch_id,completed_at);

create or replace function public.kitch_team_stock_count_cloud(
 p_staff_name text,p_pin text,p_action text,p_count_id uuid default null,p_lines jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare a public.staff_access%rowtype;rec record;entry jsonb;seen uuid[]='{}'::uuid[];
 qty numeric;expected numeric;actual numeric;delta numeric;unit_cost numeric;total_cost numeric:=0;
 line_out jsonb:='[]'::jsonb;old public.kitch_cloud_stock_counts%rowtype;
begin
 if nullif(trim(coalesce(p_staff_name,'')),'') is null or trim(coalesce(p_pin,'')) !~ '^[0-9]{4}$' then raise exception 'Invalid staff credentials';end if;
 if (select count(*) from public.staff_access s where s.is_active
   and lower(trim(s.staff_name))=lower(trim(p_staff_name)) and s.pin_hash=encode(extensions.digest(trim(p_pin),'sha256'),'hex'))<>1 then raise exception 'Invalid staff credentials';end if;
 select * into a from public.staff_access s where s.is_active and lower(trim(s.staff_name))=lower(trim(p_staff_name))
   and s.pin_hash=encode(extensions.digest(trim(p_pin),'sha256'),'hex') limit 1;
 if a.branch_id is null or a.role::text not in ('owner','operations_manager','kitchen_manager','store_manager','executive_chef') then raise exception 'Stock count not permitted for this staff account';end if;
 if p_action='snapshot' then
  return jsonb_build_object('branch_id',a.branch_id,'ingredients',
   (select coalesce(jsonb_agg(jsonb_build_object('ingredient_id',i.id,'name',i.name,'sku',i.sku,'unit',i.base_unit,
    'system_qty',coalesce((select sum(m.quantity_delta) from public.inventory_movements m where m.restaurant_id=a.restaurant_id and m.branch_id=a.branch_id and m.ingredient_id=i.id and m.unit=i.base_unit),0),
    'unit_cost',coalesce(i.last_unit_cost,i.reference_cost,0)) order by i.name),'[]'::jsonb)
    from public.ingredients i where i.restaurant_id=a.restaurant_id and i.is_active));
 end if;
 if p_action='history' then
  return (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'date',c.completed_at,'lines',c.lines,'total_variance_cost',c.total_variance_cost) order by c.completed_at desc),'[]'::jsonb)
   from public.kitch_cloud_stock_counts c where c.restaurant_id=a.restaurant_id and c.branch_id=a.branch_id);
 end if;
 if p_action<>'finalize' then raise exception 'Unknown stock count action';end if;
 if p_count_id is null or p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 1000 then raise exception 'Invalid stock count';end if;
 -- Idempotency is checked before and after location-wide lock.
 select * into old from public.kitch_cloud_stock_counts where id=p_count_id;
 if found then
  if old.restaurant_id<>a.restaurant_id or old.branch_id<>a.branch_id then raise exception 'Count reference belongs to another location';end if;
  return jsonb_build_object('saved',true,'already_recorded',true,'count_id',old.id,'total_variance_cost',old.total_variance_cost);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(a.restaurant_id::text||':'||a.branch_id::text,0));
 select * into old from public.kitch_cloud_stock_counts where id=p_count_id;
 if found then return jsonb_build_object('saved',true,'already_recorded',true,'count_id',old.id,'total_variance_cost',old.total_variance_cost);end if;
 for entry in select value from jsonb_array_elements(p_lines) loop
  if nullif(entry->>'ingredient_id','') is null or nullif(entry->>'physical_qty','') is null or nullif(entry->>'expected_qty','') is null then raise exception 'Count line missing ingredient or quantities';end if;
  if (entry->>'ingredient_id')::uuid=any(seen) then raise exception 'Duplicate ingredient in count';end if;
  seen:=array_append(seen,(entry->>'ingredient_id')::uuid);
  select id,name,base_unit,last_unit_cost,reference_cost into rec from public.ingredients where id=(entry->>'ingredient_id')::uuid and restaurant_id=a.restaurant_id and is_active;
  if not found then raise exception 'Ingredient not found in restaurant';end if;
  qty:=(entry->>'physical_qty')::numeric;expected:=(entry->>'expected_qty')::numeric;
  if qty<0 or qty>1000000 or expected<0 or expected>1000000 or entry->>'unit'<>rec.base_unit then raise exception 'Invalid count quantity or unit';end if;
  select coalesce(sum(m.quantity_delta),0) into actual from public.inventory_movements m where m.restaurant_id=a.restaurant_id and m.branch_id=a.branch_id and m.ingredient_id=rec.id and m.unit=rec.base_unit;
  -- Reject a stale physical count if stock changed between opening and finalizing.
  if abs(actual-expected)>0.000001 then raise exception 'Stock changed since counting for %. Refresh count and recount.',rec.name;end if;
  delta:=qty-actual;unit_cost:=coalesce(rec.last_unit_cost,rec.reference_cost,0);total_cost:=total_cost+abs(delta*unit_cost);
  line_out:=line_out||jsonb_build_array(jsonb_build_object('ingredient_id',rec.id,'name',rec.name,'unit',rec.base_unit,
   'system_qty',actual,'physical_qty',qty,'variance_qty',delta,'variance_cost',abs(delta*unit_cost)));
  if abs(delta)>0.000001 then
   insert into public.inventory_movements(restaurant_id,branch_id,ingredient_id,movement_type,quantity_delta,unit,unit_cost,source_table,source_id,notes)
   values(a.restaurant_id,a.branch_id,rec.id,'stock_adjustment',delta,rec.base_unit,unit_cost,'kitch_cloud_stock_counts',p_count_id,'Physical stock count reconciliation');
  end if;
 end loop;
 insert into public.kitch_cloud_stock_counts(id,restaurant_id,branch_id,staff_id,lines,total_variance_cost)
 values(p_count_id,a.restaurant_id,a.branch_id,a.id,line_out,total_cost);
 return jsonb_build_object('saved',true,'already_recorded',false,'count_id',p_count_id,'total_variance_cost',total_cost);
end $fn$;
revoke all on function public.kitch_team_stock_count_cloud(text,text,text,uuid,jsonb) from public;
grant execute on function public.kitch_team_stock_count_cloud(text,text,text,uuid,jsonb) to anon,authenticated;
