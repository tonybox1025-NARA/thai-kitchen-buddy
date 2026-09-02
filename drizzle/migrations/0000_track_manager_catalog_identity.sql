-- Preserve Manager identity and keep internal set components out of sales menus.
ALTER TABLE public.menus
  ADD COLUMN IF NOT EXISTS manager_menu_id uuid,
  ADD COLUMN IF NOT EXISTS is_set boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_set_child boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS menus_manager_menu_id_unique
  ON public.menus (manager_menu_id)
  WHERE manager_menu_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS menus_sellable_catalog_idx
  ON public.menus (available, is_set_child, category_id, sort);