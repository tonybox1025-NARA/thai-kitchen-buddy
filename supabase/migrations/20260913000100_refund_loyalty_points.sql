ALTER TABLE public.member_point_ledger
  DROP CONSTRAINT IF EXISTS member_point_ledger_type_check;

ALTER TABLE public.member_point_ledger
  ADD CONSTRAINT member_point_ledger_type_check
  CHECK (type IN (
    'opening', 'signup_bonus', 'earn', 'redeem', 'adjust', 'expire',
    'refund_earn_reversal', 'refund_redeem_restore'
  ));

ALTER TABLE public.member_point_ledger
  ADD COLUMN IF NOT EXISTS refund_id uuid REFERENCES public.refunds(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS member_point_ledger_refund_type_key
  ON public.member_point_ledger (refund_id, type)
  WHERE refund_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.refund_bill_with_loyalty(
  p_bill_id uuid,
  p_amount numeric,
  p_reason text,
  p_refunded_by uuid
)
RETURNS public.refunds
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_bill public.bills%ROWTYPE;
  v_refund public.refunds%ROWTYPE;
  v_previous_refunds numeric := 0;
  v_cumulative_refunds numeric;
  v_refund_fraction numeric;
  v_earn_points integer := 0;
  v_redeemed_points integer := 0;
  v_already_reversed integer := 0;
  v_already_restored integer := 0;
  v_reverse_now integer := 0;
  v_restore_now integer := 0;
  v_points_per_baht numeric := 1;
  v_earn_member_id uuid;
  v_redeem_member_id uuid;
  v_balance integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be greater than zero';
  END IF;

  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Refund reason is required';
  END IF;

  SELECT * INTO v_bill
  FROM public.bills
  WHERE id = p_bill_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  IF v_bill.status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'Only paid bills can be refunded';
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_previous_refunds
  FROM public.refunds
  WHERE bill_id = p_bill_id;

  IF v_previous_refunds + p_amount > v_bill.total THEN
    RAISE EXCEPTION 'Refund exceeds the remaining refundable amount';
  END IF;

  INSERT INTO public.refunds (bill_id, amount, reason, refunded_by, shift_id)
  VALUES (p_bill_id, p_amount, btrim(p_reason), p_refunded_by, v_bill.shift_id)
  RETURNING * INTO v_refund;

  v_cumulative_refunds := v_previous_refunds + p_amount;
  v_refund_fraction := CASE
    WHEN v_bill.total <= 0 THEN 1
    ELSE LEAST(1, v_cumulative_refunds / v_bill.total)
  END;

  SELECT member_id, GREATEST(points, 0)
  INTO v_earn_member_id, v_earn_points
  FROM public.member_point_ledger
  WHERE bill_id = p_bill_id AND type = 'earn'
  ORDER BY created_at
  LIMIT 1;

  IF v_earn_member_id IS NOT NULL AND v_earn_points > 0 THEN
    SELECT COALESCE(-sum(points), 0)::integer INTO v_already_reversed
    FROM public.member_point_ledger
    WHERE bill_id = p_bill_id AND type = 'refund_earn_reversal';

    v_reverse_now := GREATEST(
      0,
      LEAST(v_earn_points, floor(v_earn_points * v_refund_fraction)::integer) - v_already_reversed
    );

    IF v_reverse_now > 0 THEN
      SELECT current_points INTO v_balance
      FROM public.members
      WHERE id = v_earn_member_id
      FOR UPDATE;

      v_balance := v_balance - v_reverse_now;
      UPDATE public.members SET current_points = v_balance, updated_at = now()
      WHERE id = v_earn_member_id;

      INSERT INTO public.member_point_ledger
        (member_id, bill_id, refund_id, type, points, balance_after, description)
      VALUES
        (v_earn_member_id, p_bill_id, v_refund.id, 'refund_earn_reversal',
         -v_reverse_now, v_balance, 'Earned points reversed for refund');
    END IF;
  END IF;

  SELECT member_id, GREATEST(-points, 0)
  INTO v_redeem_member_id, v_redeemed_points
  FROM public.member_point_ledger
  WHERE bill_id = p_bill_id AND type = 'redeem'
  ORDER BY created_at
  LIMIT 1;

  IF v_redeem_member_id IS NOT NULL AND v_redeemed_points > 0 THEN
    SELECT COALESCE(sum(points), 0)::integer INTO v_already_restored
    FROM public.member_point_ledger
    WHERE bill_id = p_bill_id AND type = 'refund_redeem_restore';

    v_restore_now := GREATEST(
      0,
      LEAST(v_redeemed_points, floor(v_redeemed_points * v_refund_fraction)::integer) - v_already_restored
    );

    IF v_restore_now > 0 THEN
      SELECT current_points INTO v_balance
      FROM public.members
      WHERE id = v_redeem_member_id
      FOR UPDATE;

      v_balance := v_balance + v_restore_now;
      UPDATE public.members SET current_points = v_balance, updated_at = now()
      WHERE id = v_redeem_member_id;

      INSERT INTO public.member_point_ledger
        (member_id, bill_id, refund_id, type, points, balance_after, description)
      VALUES
        (v_redeem_member_id, p_bill_id, v_refund.id, 'refund_redeem_restore',
         v_restore_now, v_balance, 'Redeemed points restored for refund');
    END IF;
  END IF;

  SELECT COALESCE(loyalty_points_per_baht, 1) INTO v_points_per_baht
  FROM public.settings
  WHERE id = 1;

  v_points_per_baht := COALESCE(v_points_per_baht, 1);

  UPDATE public.loyalty_claim_tokens
  SET claim_points = GREATEST(
        0,
        floor(GREATEST(v_bill.total - v_cumulative_refunds, 0) * v_points_per_baht)::integer
      ),
      total_amount = GREATEST(v_bill.total - v_cumulative_refunds, 0),
      status = CASE
        WHEN v_cumulative_refunds >= v_bill.total THEN 'expired'
        ELSE status
      END
  WHERE bill_id = p_bill_id
    AND status = 'open';

  UPDATE public.bills
  SET status = CASE
    WHEN v_cumulative_refunds >= total THEN 'refunded'::public.bill_status
    ELSE 'partial_refund'::public.bill_status
  END
  WHERE id = p_bill_id;

  RETURN v_refund;
END;
$$;
