ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS is_takeout boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.order_items.is_takeout IS
  'True when this individual item must be packed for takeaway, including items on a dine-in table.';
