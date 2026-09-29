-- Opening a table must be idempotent. Staff may tap repeatedly on a slow
-- connection, and POS and customer QR requests may arrive at the same time.
create or replace function public.open_table_order_safely(
  p_table_id uuid,
  p_shift_id uuid,
  p_guests integer,
  p_opened_by uuid default null,
  p_source public.order_source default 'pos',
  p_is_test boolean default false
)
returns table(order_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  -- All callers for the same table serialize on one transaction lock.
  perform pg_advisory_xact_lock(hashtextextended(p_table_id::text, 0));

  select o.id into v_order_id
  from public.orders o
  where o.table_id = p_table_id and o.status = 'open'
  order by o.opened_at desc
  limit 1;

  if v_order_id is not null then
    order_id := v_order_id;
    created := false;
    return next;
    return;
  end if;

  insert into public.orders(table_id, shift_id, guests, opened_by, source, is_test)
  values(p_table_id, p_shift_id, greatest(1, coalesce(p_guests, 1)), p_opened_by, p_source, coalesce(p_is_test, false))
  returning id into v_order_id;

  update public.restaurant_tables
  set status = 'occupied', guests = greatest(1, coalesce(p_guests, 1))
  where id = p_table_id;

  order_id := v_order_id;
  created := true;
  return next;
end;
$$;

revoke all on function public.open_table_order_safely(uuid, uuid, integer, uuid, public.order_source, boolean) from public;
grant execute on function public.open_table_order_safely(uuid, uuid, integer, uuid, public.order_source, boolean) to anon, authenticated, service_role;
