-- Staff may keep an item available on the POS while hiding it from the
-- customer table-QR menu (for example, free refills and review rewards).
ALTER TABLE public.menus
  ADD COLUMN IF NOT EXISTS available_qr boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.menus.available_qr IS
  'Whether customers may see and order this item from the public table QR menu.';

CREATE INDEX IF NOT EXISTS menus_qr_availability_idx
  ON public.menus (available, available_qr, is_set_child, category_id, sort);
