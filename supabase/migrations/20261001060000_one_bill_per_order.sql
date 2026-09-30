-- A single restaurant order has one bill throughout checkout, payment, and
-- refund. Repeated checkout requests previously raced between SELECT and
-- INSERT, leaving several unpaid bills beside the real paid bill.

create table if not exists public.bill_duplicate_cleanup_audit (
  id uuid primary key default gen_random_uuid(),
  duplicate_bill_id uuid not null unique,
  order_id uuid not null,
  bill_snapshot jsonb not null,
  reason text not null,
  archived_at timestamptz not null default now()
);

alter table public.bill_duplicate_cleanup_audit enable row level security;

-- Preserve an exact audit snapshot before removing only clearly inert rows:
-- unpaid bills with no payment, discount, loyalty, points, or refund activity,
-- where the same closed order already has a settled bill.
with safe_duplicates as (
  select b.*
  from public.bills b
  join public.orders o on o.id = b.order_id and o.status = 'closed'
  where b.status = 'open'
    and exists (
      select 1 from public.bills kept
      where kept.order_id = b.order_id
        and kept.id <> b.id
        and kept.status in ('paid', 'partial_refund', 'refunded')
    )
    and not exists (select 1 from public.payments p where p.bill_id = b.id)
    and not exists (select 1 from public.bill_discounts d where d.bill_id = b.id)
    and not exists (select 1 from public.order_item_discounts d where d.bill_id = b.id)
    and not exists (select 1 from public.loyalty_claim_tokens t where t.bill_id = b.id)
    and not exists (select 1 from public.member_point_ledger l where l.bill_id = b.id)
    and not exists (select 1 from public.refunds r where r.bill_id = b.id)
), archived as (
  insert into public.bill_duplicate_cleanup_audit (
    duplicate_bill_id, order_id, bill_snapshot, reason
  )
  select id, order_id, to_jsonb(safe_duplicates),
         'Removed inert duplicate bill before enforcing one bill per order'
  from safe_duplicates
  on conflict (duplicate_bill_id) do nothing
  returning duplicate_bill_id
)
delete from public.bills b
using archived a
where b.id = a.duplicate_bill_id;

create unique index if not exists bills_one_per_order_idx
  on public.bills (order_id);
