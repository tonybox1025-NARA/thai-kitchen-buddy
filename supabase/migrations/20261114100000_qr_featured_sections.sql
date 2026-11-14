-- QR customer-menu "featured" sections: Today's Special / New Menu / Popular.
--
-- Purely additive curation layer. It marks EXISTING menus to also appear in
-- extra virtual sections at the top of the public QR menu. It does NOT touch
-- the menus / categories / category_id data, item ordering, Manager sync, or
-- any order / kitchen-print path. Removing these two tables restores the
-- previous behaviour exactly.
--
-- Access mirrors menus/categories: RLS on, any authenticated device account can
-- read and write; the public QR API reads with the service-role key (bypasses
-- RLS), so no anon policy is needed.

create table if not exists public.qr_featured_sections (
  key        text primary key check (key in ('special','new','popular')),
  name_th    text not null,
  name_en    text not null,
  emoji      text,
  sort       int  not null default 0,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.qr_featured_items (
  id          uuid primary key default gen_random_uuid(),
  section_key text not null references public.qr_featured_sections(key) on delete cascade,
  -- Deleting a menu simply drops it from the section; it never blocks the delete.
  menu_id     uuid not null references public.menus(id) on delete cascade,
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (section_key, menu_id)
);

create index if not exists qr_featured_items_section_idx
  on public.qr_featured_items (section_key, sort);

alter table public.qr_featured_sections enable row level security;
alter table public.qr_featured_items    enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'qr_featured_sections'
      and policyname = 'auth all qr_featured_sections'
  ) then
    create policy "auth all qr_featured_sections" on public.qr_featured_sections
      for all to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'qr_featured_items'
      and policyname = 'auth all qr_featured_items'
  ) then
    create policy "auth all qr_featured_items" on public.qr_featured_items
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Seed the three sections in the requested display order. Labels are editable
-- from the POS later, so the Thai wording here is only a starting default.
insert into public.qr_featured_sections (key, name_th, name_en, emoji, sort) values
  ('special', 'เมนูพิเศษวันนี้', 'Today''s Special', '⭐', 1),
  ('new',     'เมนูใหม่',        'New Menu',        '🆕', 2),
  ('popular', 'เมนูยอดนิยม',     'Popular',         '🔥', 3)
on conflict (key) do nothing;
