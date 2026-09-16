-- Dynamic SET composition published by the Manager app.
-- Child menus remain hidden from ordinary sale but retain their names and costs
-- so the POS and QR ordering screens can build the selector from Manager data.
CREATE TABLE IF NOT EXISTS public.menu_set_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_set_item_id uuid UNIQUE,
  set_menu_id uuid NOT NULL REFERENCES public.menus(id) ON DELETE CASCADE,
  child_menu_id uuid NOT NULL REFERENCES public.menus(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  group_key text NOT NULL DEFAULT 'items',
  group_name text NOT NULL DEFAULT 'Items',
  min_select integer NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select integer NOT NULL DEFAULT 1 CHECK (max_select > 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (set_menu_id, child_menu_id, group_key)
);

CREATE INDEX IF NOT EXISTS menu_set_items_set_menu_idx
  ON public.menu_set_items (set_menu_id, sort_order);

ALTER TABLE public.menu_set_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read menu set items" ON public.menu_set_items;
CREATE POLICY "authenticated read menu set items" ON public.menu_set_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "public read menu set items" ON public.menu_set_items;
CREATE POLICY "public read menu set items" ON public.menu_set_items
  FOR SELECT TO anon USING (true);
