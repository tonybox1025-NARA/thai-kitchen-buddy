-- A Z close is a financial boundary. Block it while operational work remains
-- open, including stale clients that still update the shift row directly.
create or replace function public.get_shift_close_blockers(p_shift_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with open_orders as (
    select o.id, o.order_number, o.source::text as source, t.code as table_code,
      coalesce((select sum(oi.qty * oi.unit_price) from public.order_items oi
                where oi.order_id = o.id and oi.status <> 'voided'), 0) as amount
    from public.orders o
    left join public.restaurant_tables t on t.id = o.table_id
    where o.shift_id = p_shift_id and o.status = 'open' and coalesce(o.is_test, false) = false
  ), open_bills as (
    select b.id, b.order_id, b.total
    from public.bills b
    where b.shift_id = p_shift_id and b.status = 'open' and coalesce(b.is_test, false) = false
  ), active_tables as (
    select t.id, t.code, t.status::text as status
    from public.restaurant_tables t
    where t.status <> 'available' and coalesce(t.is_test, false) = false
  )
  select jsonb_build_object(
    'has_blockers', exists(select 1 from open_orders) or exists(select 1 from open_bills) or exists(select 1 from active_tables),
    'open_orders', coalesce((select jsonb_agg(to_jsonb(o) order by o.table_code nulls last, o.order_number nulls last) from open_orders o), '[]'::jsonb),
    'open_bills', coalesce((select jsonb_agg(to_jsonb(b)) from open_bills b), '[]'::jsonb),
    'active_tables', coalesce((select jsonb_agg(to_jsonb(t) order by t.code) from active_tables t), '[]'::jsonb)
  );
$$;

create or replace function public.prevent_unsafe_shift_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_blockers jsonb;
begin
  if old.status = 'open' and new.status = 'closed' then
    v_blockers := public.get_shift_close_blockers(new.id);
    if coalesce((v_blockers ->> 'has_blockers')::boolean, false) then
      raise exception 'Z close blocked: open tables, orders, or bills remain'
        using detail = v_blockers::text;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_unsafe_shift_close on public.shifts;
create trigger prevent_unsafe_shift_close
before update of status on public.shifts
for each row execute function public.prevent_unsafe_shift_close();

create or replace function public.close_shift_safely(
  p_shift_id uuid, p_closed_by uuid, p_cash_count jsonb, p_totals jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_status public.shift_status; v_blockers jsonb;
begin
  select status into v_status from public.shifts where id = p_shift_id for update;
  if not found then raise exception 'Shift not found'; end if;
  if v_status <> 'open' then return jsonb_build_object('closed', false, 'reason', 'already_closed'); end if;

  v_blockers := public.get_shift_close_blockers(p_shift_id);
  if coalesce((v_blockers ->> 'has_blockers')::boolean, false) then
    return jsonb_build_object('closed', false, 'reason', 'blocked', 'blockers', v_blockers);
  end if;

  update public.shifts set closed_at = now(), closed_by = p_closed_by, status = 'closed',
    cash_count = p_cash_count, totals = p_totals where id = p_shift_id;
  return jsonb_build_object('closed', true);
end;
$$;

revoke all on function public.get_shift_close_blockers(uuid) from public;
revoke all on function public.close_shift_safely(uuid, uuid, jsonb, jsonb) from public;
grant execute on function public.get_shift_close_blockers(uuid) to anon, authenticated;
grant execute on function public.close_shift_safely(uuid, uuid, jsonb, jsonb) to anon, authenticated;

-- Serialize new orders and payments against Z close. Once the close lock is
-- released, attempts to append activity to a closed shift are rejected.
create or replace function public.require_open_shift_for_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status public.shift_status;
begin
  if new.shift_id is null then return new; end if;
  select status into v_status from public.shifts where id = new.shift_id for share;
  if v_status is distinct from 'open' then raise exception 'Cannot create an order in a closed shift'; end if;
  return new;
end;
$$;

drop trigger if exists require_open_shift_for_order on public.orders;
create trigger require_open_shift_for_order before insert or update of shift_id on public.orders
for each row execute function public.require_open_shift_for_order();

create or replace function public.require_open_shift_for_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status public.shift_status;
begin
  select s.status into v_status from public.bills b join public.shifts s on s.id = b.shift_id
  where b.id = new.bill_id for share of s;
  if v_status is distinct from 'open' then raise exception 'Cannot add a payment to a closed shift'; end if;
  return new;
end;
$$;

drop trigger if exists require_open_shift_for_payment on public.payments;
create trigger require_open_shift_for_payment before insert on public.payments
for each row execute function public.require_open_shift_for_payment();
