-- Refunds are paid from the cash drawer even when the original bill was paid
-- by QR, 60/40, card, cash, or a mix. Preserve both sides for audit/reconciliation.
ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS payout_method text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS original_payment_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.refunds
  DROP CONSTRAINT IF EXISTS refunds_payout_method_check;

ALTER TABLE public.refunds
  ADD CONSTRAINT refunds_payout_method_check
  CHECK (payout_method = 'cash');

CREATE OR REPLACE FUNCTION public.capture_refund_payment_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.payout_method := 'cash';

  -- The cash leaves the drawer that is open when the refund is performed,
  -- which may be a later shift than the original sale.
  SELECT id INTO NEW.shift_id
  FROM public.shifts
  WHERE status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF NEW.shift_id IS NULL THEN
    RAISE EXCEPTION 'An open register shift is required for a cash refund';
  END IF;

  SELECT COALESCE(jsonb_object_agg(method, amount), '{}'::jsonb)
  INTO NEW.original_payment_breakdown
  FROM (
    SELECT method::text AS method, sum(amount)::numeric(10,2) AS amount
    FROM public.payments
    WHERE bill_id = NEW.bill_id
    GROUP BY method
  ) payment_totals;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capture_refund_payment_context_trigger ON public.refunds;
CREATE TRIGGER capture_refund_payment_context_trigger
BEFORE INSERT ON public.refunds
FOR EACH ROW
EXECUTE FUNCTION public.capture_refund_payment_context();

-- Existing refunds in this POS were cash payouts. Backfill the original tender
-- snapshot so old records reconcile under the same rule.
UPDATE public.refunds refund
SET payout_method = 'cash',
    original_payment_breakdown = COALESCE((
      SELECT jsonb_object_agg(method, amount)
      FROM (
        SELECT payment.method::text AS method, sum(payment.amount)::numeric(10,2) AS amount
        FROM public.payments payment
        WHERE payment.bill_id = refund.bill_id
        GROUP BY payment.method
      ) payment_totals
    ), '{}'::jsonb);

REVOKE ALL ON FUNCTION public.capture_refund_payment_context() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_refund_payment_context() TO service_role;
