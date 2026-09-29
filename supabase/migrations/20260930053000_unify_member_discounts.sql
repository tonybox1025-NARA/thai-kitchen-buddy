-- One authoritative rule for every loyalty redemption path. A points discount
-- is always stored as loyalty_discount_amount and reported as MB Discount.
create or replace function public.loyalty_discount_for_points(p_points integer)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case coalesce(p_points, 0)
    when 0 then 0
    when 500 then 25
    when 1000 then 50
    when 2000 then 100
    when 5000 then 300
    when 10000 then 600
    when 15000 then 1000
    else null
  end::numeric;
$$;

create or replace function public.sync_bill_loyalty_discount()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_discount numeric;
begin
  v_discount := public.loyalty_discount_for_points(new.points_redeemed);
  if v_discount is null then raise exception 'Invalid loyalty reward tier: %', new.points_redeemed; end if;
  new.loyalty_discount_amount := v_discount;
  return new;
end;
$$;

drop trigger if exists sync_bill_loyalty_discount on public.bills;
create trigger sync_bill_loyalty_discount
before insert or update of points_redeemed on public.bills
for each row execute function public.sync_bill_loyalty_discount();

-- Repair historical rows written by the staff-assisted payment path.
update public.bills
set loyalty_discount_amount = public.loyalty_discount_for_points(points_redeemed)
where loyalty_discount_amount is distinct from public.loyalty_discount_for_points(points_redeemed)
  and public.loyalty_discount_for_points(points_redeemed) is not null;

-- Extend Z-close validation so a future regression cannot be silently closed.
create or replace function public.get_shift_close_blockers(p_shift_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with open_orders as (
    select o.id,o.order_number,o.source::text source,t.code table_code,
      coalesce((select sum(oi.qty*oi.unit_price) from public.order_items oi where oi.order_id=o.id and oi.status<>'voided'),0) amount
    from public.orders o left join public.restaurant_tables t on t.id=o.table_id
    where o.shift_id=p_shift_id and o.status='open' and not coalesce(o.is_test,false)
  ), open_bills as (
    select b.id,b.order_id,b.total from public.bills b
    where b.shift_id=p_shift_id and b.status='open' and not coalesce(b.is_test,false)
  ), active_tables as (
    select t.id,t.code,t.status::text status from public.restaurant_tables t
    where t.status<>'available' and not coalesce(t.is_test,false)
  ), loyalty_issues as (
    select b.id,b.points_redeemed,b.loyalty_discount_amount,
      public.loyalty_discount_for_points(b.points_redeemed) expected_discount
    from public.bills b
    where b.shift_id=p_shift_id and not coalesce(b.is_test,false)
      and (public.loyalty_discount_for_points(b.points_redeemed) is null
        or b.loyalty_discount_amount is distinct from public.loyalty_discount_for_points(b.points_redeemed))
  )
  select jsonb_build_object(
    'has_blockers',exists(select 1 from open_orders) or exists(select 1 from open_bills)
      or exists(select 1 from active_tables) or exists(select 1 from loyalty_issues),
    'open_orders',coalesce((select jsonb_agg(to_jsonb(o) order by o.table_code nulls last,o.order_number nulls last) from open_orders o),'[]'::jsonb),
    'open_bills',coalesce((select jsonb_agg(to_jsonb(b)) from open_bills b),'[]'::jsonb),
    'active_tables',coalesce((select jsonb_agg(to_jsonb(t) order by t.code) from active_tables t),'[]'::jsonb),
    'loyalty_issues',coalesce((select jsonb_agg(to_jsonb(l)) from loyalty_issues l),'[]'::jsonb)
  );
$$;
