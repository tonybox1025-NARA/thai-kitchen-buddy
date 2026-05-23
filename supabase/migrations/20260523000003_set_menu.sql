-- Add set_config column to order_items for storing set meal selections
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS set_config jsonb;
