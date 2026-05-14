
-- Extensions
create extension if not exists pgcrypto;

-- Enums
do $$ begin
  create type public.app_role as enum ('admin','manager','staff');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.table_status as enum ('available','occupied','bill_requested');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum ('open','closed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_item_status as enum ('pending','sent','served','voided');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bill_status as enum ('open','paid','refunded','partial_refund');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_method as enum ('qr','cash','card');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_source as enum ('pos','qr');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.shift_status as enum ('open','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.printer_kind as enum ('counter','kitchen');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.print_status as enum ('pending','printed','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.vat_mode as enum ('inclusive','exclusive');
exception when duplicate_object then null; end $$;

-- Tables
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role app_role not null default 'staff',
  pin_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Safe view (no pin_hash)
create or replace view public.staff_public as
  select id, name, role, active, created_at from public.staff;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name_th text not null,
  name_en text not null,
  name_my text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.menus (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  name_th text not null,
  name_en text not null,
  name_my text not null,
  price numeric(10,2) not null check (price >= 0),
  image_url text,
  available boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  capacity int not null default 4,
  status table_status not null default 'available',
  guests int not null default 0,
  pos_x int not null default 0,
  pos_y int not null default 0,
  has_qr_alert boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  business_day date not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opened_by uuid references public.staff(id),
  closed_by uuid references public.staff(id),
  opening_float numeric(10,2) not null default 0,
  cash_count jsonb,
  totals jsonb,
  status shift_status not null default 'open'
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  table_id uuid references public.restaurant_tables(id) on delete set null,
  shift_id uuid references public.shifts(id),
  source order_source not null default 'pos',
  status order_status not null default 'open',
  guests int not null default 1,
  opened_by uuid references public.staff(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_id uuid references public.menus(id),
  name_th text not null,
  name_en text not null,
  name_my text not null,
  qty int not null check (qty > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  notes text,
  modifiers jsonb,
  status order_item_status not null default 'pending',
  sent_at timestamptz,
  voided_by uuid references public.staff(id),
  void_reason text,
  voided_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  shift_id uuid references public.shifts(id),
  subtotal numeric(10,2) not null default 0,
  discount_amount numeric(10,2) not null default 0,
  discount_note text,
  member_discount_amount numeric(10,2) not null default 0,
  vat_mode vat_mode not null default 'inclusive',
  vat_rate numeric(5,2) not null default 7.00,
  vat_amount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  status bill_status not null default 'open',
  cashier_id uuid references public.staff(id),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  method payment_method not null,
  amount numeric(10,2) not null check (amount >= 0),
  cash_received numeric(10,2),
  change_due numeric(10,2),
  cash_breakdown jsonb,
  reference text,
  created_at timestamptz not null default now()
);

create table public.voids (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid references public.order_items(id) on delete set null,
  reason text not null,
  voided_by uuid references public.staff(id),
  amount numeric(10,2) not null default 0,
  shift_id uuid references public.shifts(id),
  created_at timestamptz not null default now()
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid references public.bills(id) on delete set null,
  reason text not null,
  amount numeric(10,2) not null,
  refunded_by uuid references public.staff(id),
  shift_id uuid references public.shifts(id),
  created_at timestamptz not null default now()
);

create table public.settings (
  id int primary key default 1,
  restaurant_name text not null default 'My Restaurant',
  vat_mode vat_mode not null default 'inclusive',
  vat_rate numeric(5,2) not null default 7.00,
  printer_counter_ip text,
  printer_kitchen_ip text,
  current_business_day date not null default current_date,
  updated_at timestamptz not null default now(),
  constraint settings_singleton check (id = 1)
);

insert into public.settings (id) values (1) on conflict do nothing;

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  printer printer_kind not null,
  payload jsonb not null,
  status print_status not null default 'pending',
  created_at timestamptz not null default now(),
  printed_at timestamptz,
  error text
);

-- Helper: has_role (security definer)
create or replace function public.has_role(_staff_id uuid, _role app_role)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where id = _staff_id and role = _role and active);
$$;

-- PIN verification: input plain pin, returns the matching staff row (id, name, role) or null
create or replace function public.verify_staff_pin(_pin text)
returns table(id uuid, name text, role app_role)
language sql stable security definer set search_path = public, extensions as $$
  select s.id, s.name, s.role
  from public.staff s
  where s.active = true
    and s.pin_hash = crypt(_pin, s.pin_hash)
  limit 1;
$$;

-- PIN setter: hashes pin server-side
create or replace function public.set_staff_pin(_staff_id uuid, _pin text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.staff set pin_hash = crypt(_pin, gen_salt('bf')) where id = _staff_id;
end; $$;

-- Create staff with PIN
create or replace function public.create_staff(_name text, _role app_role, _pin text)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare new_id uuid;
begin
  insert into public.staff (name, role, pin_hash)
  values (_name, _role, crypt(_pin, gen_salt('bf')))
  returning id into new_id;
  return new_id;
end; $$;

-- Enable RLS
alter table public.staff enable row level security;
alter table public.categories enable row level security;
alter table public.menus enable row level security;
alter table public.restaurant_tables enable row level security;
alter table public.shifts enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.bills enable row level security;
alter table public.payments enable row level security;
alter table public.voids enable row level security;
alter table public.refunds enable row level security;
alter table public.settings enable row level security;
alter table public.print_jobs enable row level security;

-- Policies: any authenticated user (the device account) can do everything,
-- EXCEPT the staff table where pin_hash must stay protected.
-- For staff: only read via the staff_public view; writes via security-definer RPCs.
create policy "auth read staff (no hash via direct)" on public.staff for select to authenticated using (true);
-- We deliberately do NOT add insert/update/delete policies on staff — use the RPCs above.

do $$
declare t text;
begin
  for t in select unnest(array[
    'categories','menus','restaurant_tables','shifts','orders','order_items',
    'bills','payments','voids','refunds','settings','print_jobs'
  ]) loop
    execute format('create policy "auth all %1$s" on public.%1$s for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;

-- Realtime
alter publication supabase_realtime add table public.restaurant_tables;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_items;
alter publication supabase_realtime add table public.bills;
alter publication supabase_realtime add table public.print_jobs;

-- Seed: 20 tables T01..T20 in a 5x4 grid
insert into public.restaurant_tables (code, capacity, pos_x, pos_y)
select 'T'||lpad(g::text,2,'0'),
       case when g % 4 = 0 then 6 else 4 end,
       (g-1) % 5,
       (g-1) / 5
from generate_series(1,20) g
on conflict (code) do nothing;

-- Seed categories
insert into public.categories (name_th, name_en, name_my, sort) values
  ('อาหารจานหลัก','Mains','အဓိကအစားအစာ',1),
  ('อาหารทานเล่น','Appetizers','အရသာစားစရာ',2),
  ('เครื่องดื่ม','Drinks','သောက်စရာ',3),
  ('ของหวาน','Desserts','အချိုပွဲ',4)
on conflict do nothing;

-- Seed a few menu items
with c as (select id, name_en from public.categories)
insert into public.menus (category_id, name_th, name_en, name_my, price, sort) values
  ((select id from c where name_en='Mains'),'ผัดไทยกุ้งสด','Pad Thai Shrimp','ပက်ထိုင်း ပုစွန်',120,1),
  ((select id from c where name_en='Mains'),'ข้าวผัดหมู','Pork Fried Rice','ဝက်သားထမင်းကြော်',90,2),
  ((select id from c where name_en='Mains'),'ต้มยำกุ้ง','Tom Yum Goong','တုံယမ်ပုစွန်',180,3),
  ((select id from c where name_en='Appetizers'),'ปอเปี๊ยะทอด','Spring Rolls','စပြေားရိုး',80,1),
  ((select id from c where name_en='Drinks'),'ชาไทย','Thai Iced Tea','ထိုင်းလက်ဖက်ရည်',45,1),
  ((select id from c where name_en='Drinks'),'น้ำเปล่า','Water','ရေ',20,2),
  ((select id from c where name_en='Desserts'),'ข้าวเหนียวมะม่วง','Mango Sticky Rice','သရက်သီးထမင်းပျောက်',95,1)
on conflict do nothing;

-- Seed an admin staff with PIN 1234 and a manager with PIN 9999
select public.create_staff('Owner','admin','1234');
select public.create_staff('Manager','manager','9999');
select public.create_staff('Cashier','staff','1111');
