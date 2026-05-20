-- Add cancel_reason and closed_by to orders so table-close details are persisted
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES public.staff(id);

COMMENT ON COLUMN public.orders.cancel_reason IS
  'Reason recorded when an order is cancelled (Close Table flow). Null for normally completed orders.';
COMMENT ON COLUMN public.orders.closed_by IS
  'Staff member who closed/cancelled the order. Null for normally completed orders.';
