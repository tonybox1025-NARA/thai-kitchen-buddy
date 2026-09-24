-- Per-line discounts for temporary promotions / stock-clearance pricing.
-- These never change the menu's base price and can coexist with a bill discount.
create table if not exists public.order_item_discounts (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  item_name_th text,
  item_name_en text,
  qty integer not null check (qty > 0),
  type text not null check (type in ('percent', 'fixed')),
  value numeric(10,2) not null check (value > 0),
  amount numeric(10,2) not null check (amount > 0),
  reason text,
  applied_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bill_id, order_item_id)
);

create index if not exists order_item_discounts_bill_id_idx
  on public.order_item_discounts (bill_id);

alter table public.order_item_discounts enable row level security;

drop policy if exists "Authenticated staff manage item discounts" on public.order_item_discounts;
create policy "Authenticated staff manage item discounts"
  on public.order_item_discounts
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.order_item_discounts to authenticated;

comment on table public.order_item_discounts is
  'Temporary per-order-line discounts. Menu catalog prices remain unchanged.';
