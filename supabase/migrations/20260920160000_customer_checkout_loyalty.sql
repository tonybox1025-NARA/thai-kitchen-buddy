-- Customer bill requests and pre-payment loyalty reservations.
-- Points are only reserved here. process_bill_loyalty remains the only place
-- that actually debits/credits the member ledger after payment succeeds.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS checkout_requested_at timestamptz;

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS loyalty_reserved_at timestamptz,
  ADD COLUMN IF NOT EXISTS loyalty_reservation_source text,
  ADD COLUMN IF NOT EXISTS loyalty_discount_amount numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.bills
  DROP CONSTRAINT IF EXISTS bills_loyalty_reservation_source_check;

ALTER TABLE public.bills
  ADD CONSTRAINT bills_loyalty_reservation_source_check
  CHECK (loyalty_reservation_source IS NULL OR loyalty_reservation_source IN ('customer_qr', 'pos'));

CREATE INDEX IF NOT EXISTS bills_open_member_reservation_idx
  ON public.bills (member_id, status, loyalty_reserved_at)
  WHERE member_id IS NOT NULL AND points_redeemed > 0 AND status = 'open';

CREATE OR REPLACE FUNCTION public.reserve_customer_bill_loyalty(
  p_bill_id uuid,
  p_guest_token text,
  p_redeem_points integer
)
RETURNS TABLE(
  member_id uuid,
  member_name text,
  current_points integer,
  reserved_points integer,
  discount_amount numeric,
  available_points integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill public.bills%ROWTYPE;
  v_member public.members%ROWTYPE;
  v_discount numeric(12,2) := 0;
  v_other_reserved integer := 0;
  v_available integer := 0;
BEGIN
  IF p_guest_token IS NULL OR length(p_guest_token) < 20 THEN
    RAISE EXCEPTION 'Wallet is required';
  END IF;

  IF COALESCE(p_redeem_points, 0) NOT IN (0, 500, 1000, 2000, 5000, 10000, 15000) THEN
    RAISE EXCEPTION 'Invalid reward tier';
  END IF;

  v_discount := CASE COALESCE(p_redeem_points, 0)
    WHEN 500 THEN 25
    WHEN 1000 THEN 50
    WHEN 2000 THEN 100
    WHEN 5000 THEN 300
    WHEN 10000 THEN 600
    WHEN 15000 THEN 1000
    ELSE 0
  END;

  SELECT * INTO v_bill
  FROM public.bills
  WHERE id = p_bill_id
  FOR UPDATE;
  IF NOT FOUND OR v_bill.status <> 'open' THEN
    RAISE EXCEPTION 'Bill is not available';
  END IF;

  SELECT * INTO v_member
  FROM public.members
  WHERE guest_token = p_guest_token AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member wallet not found';
  END IF;

  SELECT COALESCE(sum(points_redeemed), 0)::integer INTO v_other_reserved
  FROM public.bills
  WHERE member_id = v_member.id
    AND id <> p_bill_id
    AND status = 'open'
    AND loyalty_reserved_at IS NOT NULL
    AND loyalty_reserved_at > now() - interval '30 minutes';

  v_available := GREATEST(0, v_member.current_points - v_other_reserved);
  IF p_redeem_points > v_available THEN
    RAISE EXCEPTION 'Insufficient available points';
  END IF;
  IF v_discount > v_bill.subtotal THEN
    RAISE EXCEPTION 'Reward exceeds bill subtotal';
  END IF;

  UPDATE public.bills
  SET member_id = v_member.id,
      points_redeemed = p_redeem_points,
      loyalty_discount_amount = v_discount,
      loyalty_reserved_at = now(),
      loyalty_reservation_source = 'customer_qr'
  WHERE id = p_bill_id;

  RETURN QUERY SELECT
    v_member.id,
    v_member.full_name,
    v_member.current_points,
    p_redeem_points,
    v_discount,
    v_available;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_customer_bill_loyalty(uuid, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_customer_bill_loyalty(uuid, text, integer)
  TO authenticated, service_role;
