-- Add takeout and staff_meal order sources
ALTER TYPE public.order_source ADD VALUE IF NOT EXISTS 'takeout';
ALTER TYPE public.order_source ADD VALUE IF NOT EXISTS 'staff_meal';

-- Add order_number for display identifiers (TO-001, ST-001)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_number text;

COMMENT ON COLUMN public.orders.order_number IS
  'Display identifier for takeout (TO-001) and staff meal (ST-001) orders. Null for dine-in table orders.';
