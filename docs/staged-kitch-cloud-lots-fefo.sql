-- STAGED ONLY. Do not apply before a controlled test of cloud inventory movement reconciliation.
-- No stock quantity updates: allocations point to EXISTING negative movements.
create table if not exists public.kitch_cloud_lot_allocations(
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null references public.restaurants(id),
 branch_id uuid not null references public.branches(id),
 receipt_id uuid not null references public.kitch_receiving_entries(id),
 movement_id uuid not null references public.inventory_movements(id),
 allocated_qty numeric not null check(allocated_qty>0),
 created_by uuid not null references public.staff_access(id),
 created_at timestamptz not null default now(),
 unique(receipt_id,movement_id)
);
alter table public.kitch_cloud_lot_allocations enable row level security;
revoke all on public.kitch_cloud_lot_allocations from public,anon,authenticated;
create index if not exists kitch_cloud_lot_allocations_receipt_idx on public.kitch_cloud_lot_allocations(receipt_id);
create index if not exists kitch_cloud_lot_allocations_movement_idx on public.kitch_cloud_lot_allocations(movement_id);

create or replace function public.kitch_team_lot_ledger(
 p_staff_name text,p_pin text,p_action text default 'list',p_receipt_id uuid default null,
 p_movement_id uuid default null,p_quantity numeric default null)
 returns jsonb language plpgsql security definer set search_path='' as $fn$
declare a public.staff_access%rowtype;r public.kitch_receiving_entries%rowtype;
 m public.inventory_movements%rowtype;v_lot_used numeric;v_movement_used numeric;
begin
 if nullif(trim(coalesce(p_staff_name,'')),'') is null or trim(coalesce(p_pin,'')) !~ '^[0-9]{4}$' then raise exception 'Invalid staff credentials';end if;
 if (select count(*) from public.staff_access s where s.is_active=true
  and lower(trim(s.staff_name))=lower(trim(p_staff_name))
  and s.pin_hash=encode(extensions.digest(trim(p_pin),'sha256'),'hex'))<>1 then raise exception 'Invalid or ambiguous staff credentials';end if;
 select * into a from public.staff_access s where s.is_active=true and lower(trim(s.staff_name))=lower(trim(p_staff_name))
  and s.pin_hash=encode(extensions.digest(trim(p_pin),'sha256'),'hex') limit 1;
 if a.branch_id is null then raise exception 'Staff needs assigned location';end if;
 if p_action='list' then
  return jsonb_build_object(
   'lots',(select coalesce(jsonb_agg(jsonb_build_object(
      'receipt_id',r2.id,'ingredient_id',r2.ingredient_id,'ingredient',i.name,
      'supplier',r2.supplier,'invoice',r2.invoice_number,'expiry',r2.expiry_date,
      'received_at',r2.received_at,'unit',r2.unit,
      'received_qty',r2.delivered_qty-r2.rejected_qty,
      'allocated_qty',coalesce((select sum(k.allocated_qty) from public.kitch_cloud_lot_allocations k where k.receipt_id=r2.id),0),
      'remaining_qty',(r2.delivered_qty-r2.rejected_qty)-coalesce((select sum(k.allocated_qty) from public.kitch_cloud_lot_allocations k where k.receipt_id=r2.id),0)
    ) order by r2.expiry_date nulls last,r2.received_at),'[]'::jsonb)
    from public.kitch_receiving_entries r2 join public.ingredients i on i.id=r2.ingredient_id
    where r2.restaurant_id=a.restaurant_id and r2.branch_id=a.branch_id and r2.delivered_qty>r2.rejected_qty),
   'unallocated_movements',(select coalesce(jsonb_agg(jsonb_build_object(
     'movement_id',mv.id,'ingredient_id',mv.ingredient_id,'quantity',-mv.quantity_delta,
     'assigned_qty',coalesce((select sum(k.allocated_qty) from public.kitch_cloud_lot_allocations k where k.movement_id=mv.id),0),
     'remaining_unallocated',-mv.quantity_delta-coalesce((select sum(k.allocated_qty) from public.kitch_cloud_lot_allocations k where k.movement_id=mv.id),0),
     'occurred_at',mv.occurred_at,'source',mv.source_table) order by mv.occurred_at),'[]'::jsonb)
    from public.inventory_movements mv where mv.restaurant_id=a.restaurant_id and mv.branch_id=a.branch_id and mv.quantity_delta<0
     and mv.movement_type::text not in('transfer_out') and
     -mv.quantity_delta>coalesce((select sum(k.allocated_qty) from public.kitch_cloud_lot_allocations k where k.movement_id=mv.id),0))
  );
 end if;
 if p_action<>'allocate' then raise exception 'Invalid lot action';end if;
 if a.role::text not in('owner','operations_manager','kitchen_manager','store_manager','executive_chef') then raise exception 'Lot allocation is not permitted';end if;
 if p_receipt_id is null or p_movement_id is null or p_quantity is null or p_quantity<=0 then raise exception 'Invalid lot allocation';end if;
 perform pg_advisory_xact_lock(hashtextextended(a.restaurant_id::text||a.branch_id::text,0));
 select * into r from public.kitch_receiving_entries where id=p_receipt_id and restaurant_id=a.restaurant_id and branch_id=a.branch_id for update;
 select * into m from public.inventory_movements where id=p_movement_id and restaurant_id=a.restaurant_id and branch_id=a.branch_id for update;
 if r.id is null or m.id is null or r.ingredient_id<>m.ingredient_id or r.unit<>m.unit or m.quantity_delta>=0
 or m.movement_type::text='transfer_out' then raise exception 'Receipt and movement must match ingredient, unit and location';end if;
 if m.occurred_at<r.received_at then raise exception 'Cannot allocate usage to stock received later';end if;
 select coalesce(sum(allocated_qty),0) into v_lot_used from public.kitch_cloud_lot_allocations where receipt_id=r.id;
 select coalesce(sum(allocated_qty),0) into v_movement_used from public.kitch_cloud_lot_allocations where movement_id=m.id;
 if v_lot_used+p_quantity>r.delivered_qty-r.rejected_qty then raise exception 'Lot does not have enough remaining accepted quantity';end if;
 if v_movement_used+p_quantity> -m.quantity_delta then raise exception 'Allocation exceeds original stock usage';end if;
 insert into public.kitch_cloud_lot_allocations(restaurant_id,branch_id,receipt_id,movement_id,allocated_qty,created_by)
 values(a.restaurant_id,a.branch_id,r.id,m.id,p_quantity,a.id)
 on conflict(receipt_id,movement_id) do update set allocated_qty=public.kitch_cloud_lot_allocations.allocated_qty+excluded.allocated_qty;
 return jsonb_build_object('saved',true,'inventory_unchanged',true,'receipt_id',r.id,'movement_id',m.id);
end $fn$;
revoke all on function public.kitch_team_lot_ledger(text,text,text,uuid,uuid,numeric) from public;
grant execute on function public.kitch_team_lot_ledger(text,text,text,uuid,uuid,numeric) to anon,authenticated;
