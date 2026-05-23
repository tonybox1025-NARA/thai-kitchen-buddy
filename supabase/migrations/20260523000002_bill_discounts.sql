-- bill_discounts: structured discount/coupon log — one record per bill
-- Replaces the ad-hoc discount_amount on bills for tracking purposes;
-- bills.discount_amount is still kept in sync for quick aggregation in reports.

CREATE TABLE IF NOT EXISTS public.bill_discounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id          uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('percent', 'fixed', 'free_item')),
  percent_value    numeric,      -- e.g. 10 → 10 % off
  fixed_value      numeric,      -- e.g. 50 → ฿50 off
  free_item_id     uuid,         -- order_items.id
  free_item_name   text,         -- snapshot of item name at time of discount
  amount           numeric NOT NULL,  -- calculated THB reduction
  applied_by       uuid REFERENCES public.staff(id),
  applied_at       timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bill_discounts IS
  'One-per-bill structured discount record. DELETE + INSERT to replace.';

ALTER TABLE public.bill_discounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can manage bill_discounts"
  ON public.bill_discounts
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
