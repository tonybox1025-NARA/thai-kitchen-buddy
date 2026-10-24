-- Keep an open Bill aligned with the authoritative, non-voided order lines.
--
-- A bill may already exist while staff add or void an item from another POS
-- screen/device.  Previously the payment screen could collect the new amount
-- while the Bill row retained the old amount, creating a false close-review
-- warning.  Recalculate at the database boundary so old and new clients share
-- the same invariant.

create or replace function public.refresh_open_bill_totals_for_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill public.bills%rowtype;
  v_settings public.settings%rowtype;
  v_subtotal numeric := 0;
  v_bill_discount numeric := 0;
  v_item_discount numeric := 0;
  v_discount_total numeric := 0;
  v_after_discount numeric := 0;
  v_service_fee numeric := 0;
  v_taxable_base numeric := 0;
  v_vat numeric := 0;
  v_before_rounding numeric := 0;
  v_total numeric := 0;
  v_rounding_adjustment numeric := 0;
begin
  select * into v_bill
  from public.bills
  where order_id = p_order_id and status = 'open'
  for update;

  if not found then return; end if;

  select coalesce(sum(oi.qty * oi.unit_price), 0)
  into v_subtotal
  from public.order_items oi
  where oi.order_id = p_order_id and oi.status <> 'voided';

  select coalesce(sum(bd.amount), 0)
  into v_bill_discount
  from public.bill_discounts bd
  where bd.bill_id = v_bill.id;

  select coalesce(sum(oid.amount), 0)
  into v_item_discount
  from public.order_item_discounts oid
  join public.order_items oi on oi.id = oid.order_item_id
  where oid.bill_id = v_bill.id and oi.status <> 'voided';

  v_discount_total := round(v_bill_discount + v_item_discount, 2);
  v_after_discount := greatest(
    0,
    v_subtotal - v_discount_total
      - coalesce(v_bill.member_discount_amount, 0)
      - coalesce(v_bill.loyalty_discount_amount, 0)
  );
  v_service_fee := round(v_after_discount * coalesce(v_bill.service_fee_rate, 0) / 100, 2);
  v_taxable_base := v_after_discount + v_service_fee;

  select * into v_settings from public.settings where id = 1;
  if coalesce(v_settings.vat_enabled, true) then
    if v_bill.vat_mode = 'exclusive' then
      v_vat := round(v_taxable_base * coalesce(v_bill.vat_rate, 0) / 100, 2);
      v_before_rounding := v_taxable_base + v_vat;
    else
      v_vat := round(v_taxable_base - v_taxable_base / (1 + coalesce(v_bill.vat_rate, 0) / 100), 2);
      v_before_rounding := v_taxable_base;
    end if;
  else
    v_vat := 0;
    v_before_rounding := v_taxable_base;
  end if;

  v_total := case v_bill.rounding_mode
    when 'nearest_whole' then round(v_before_rounding)
    when 'up_whole' then ceil(v_before_rounding)
    when 'down_whole' then floor(v_before_rounding)
    else round(v_before_rounding, 2)
  end;
  v_rounding_adjustment := round(v_total - v_before_rounding, 2);

  update public.bills
  set subtotal = v_subtotal,
      discount_amount = v_discount_total,
      service_fee_amount = v_service_fee,
      vat_amount = v_vat,
      rounding_adjustment = v_rounding_adjustment,
      total = v_total
  where id = v_bill.id;
end;
$$;

revoke all on function public.refresh_open_bill_totals_for_order(uuid) from public, anon;
grant execute on function public.refresh_open_bill_totals_for_order(uuid) to authenticated, service_role;

create or replace function public.refresh_open_bill_after_order_item_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_open_bill_totals_for_order(old.order_id);
    return old;
  end if;

  perform public.refresh_open_bill_totals_for_order(new.order_id);
  if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
    perform public.refresh_open_bill_totals_for_order(old.order_id);
  end if;
  return new;
end;
$$;

drop trigger if exists refresh_open_bill_after_order_item_change on public.order_items;
create trigger refresh_open_bill_after_order_item_change
after insert or update of order_id, qty, unit_price, status or delete
on public.order_items
for each row
execute function public.refresh_open_bill_after_order_item_change();

comment on function public.refresh_open_bill_totals_for_order(uuid) is
  'Recomputes an open Bill from non-voided order lines and saved discounts whenever its order changes.';
