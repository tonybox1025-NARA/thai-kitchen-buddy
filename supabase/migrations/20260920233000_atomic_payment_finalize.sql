-- Finalize payment, loyalty, order, and table state in one transaction.
-- The payment row is inserted immediately before this RPC. If any validation or
-- loyalty step fails, the RPC rolls back without leaving a half-closed bill.
CREATE OR REPLACE FUNCTION public.finalize_bill_payment(
  p_bill_id uuid,
  p_member_id uuid DEFAULT NULL,
  p_redeem_points integer DEFAULT 0,
  p_earn_points integer DEFAULT 0,
  p_cashier_id uuid DEFAULT NULL
)
RETURNS TABLE(bill_status public.bill_status, balance_after integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill public.bills%ROWTYPE;
  v_paid numeric := 0;
  v_balance integer := NULL;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF COALESCE(p_redeem_points, 0) < 0 OR COALESCE(p_earn_points, 0) < 0 THEN
    RAISE EXCEPTION 'Point amounts must not be negative';
  END IF;

  SELECT * INTO v_bill
  FROM public.bills
  WHERE id = p_bill_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  -- Retrying an already successful confirmation must not award points twice.
  IF v_bill.status = 'paid' THEN
    IF v_bill.member_id IS NOT NULL THEN
      SELECT current_points INTO v_balance
      FROM public.members
      WHERE id = v_bill.member_id;
    END IF;
    RETURN QUERY SELECT v_bill.status, v_balance;
    RETURN;
  END IF;

  IF v_bill.status <> 'open' THEN
    RAISE EXCEPTION 'Bill cannot be finalized from status %', v_bill.status;
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_paid
  FROM public.payments
  WHERE bill_id = p_bill_id;

  IF v_paid + 0.001 < v_bill.total THEN
    RAISE EXCEPTION 'Bill is not fully paid';
  END IF;

  IF p_member_id IS NOT NULL THEN
    SELECT result.balance_after INTO v_balance
    FROM public.process_bill_loyalty(
      p_bill_id,
      p_member_id,
      COALESCE(p_redeem_points, 0),
      COALESCE(p_earn_points, 0)
    ) AS result;
  ELSIF COALESCE(p_redeem_points, 0) > 0 OR COALESCE(p_earn_points, 0) > 0 THEN
    RAISE EXCEPTION 'Member is required when processing points';
  END IF;

  UPDATE public.bills
  SET status = 'paid',
      paid_at = COALESCE(paid_at, now()),
      cashier_id = COALESCE(p_cashier_id, cashier_id)
  WHERE id = p_bill_id;

  UPDATE public.orders
  SET status = 'closed',
      closed_at = COALESCE(closed_at, now())
  WHERE id = v_bill.order_id;

  UPDATE public.restaurant_tables AS table_row
  SET status = 'available',
      guests = 0,
      has_qr_alert = false
  FROM public.orders AS order_row
  WHERE order_row.id = v_bill.order_id
    AND table_row.id = order_row.table_id;

  RETURN QUERY SELECT 'paid'::public.bill_status, v_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_bill_payment(uuid, uuid, integer, integer, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_bill_payment(uuid, uuid, integer, integer, uuid)
  TO authenticated, service_role;
