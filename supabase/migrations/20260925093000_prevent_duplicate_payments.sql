-- Prevent duplicate/over-collected payments at the database boundary.
--
-- A cashier can tap twice while a device or network is slow, and two devices
-- can also submit against the same open bill.  Client-side button disabling is
-- useful feedback, but only a row lock can make the balance check reliable.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS request_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS payments_request_key_uidx
  ON public.payments (request_key)
  WHERE request_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_payment_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric := 0;
  v_status public.bill_status;
  v_paid numeric := 0;
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  -- Serializes every payment attempt for the same bill, including attempts
  -- from another tablet/phone and old app versions that still insert directly.
  SELECT b.total, b.status
    INTO v_total, v_status
  FROM public.bills AS b
  WHERE b.id = NEW.bill_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'Bill is already closed';
  END IF;

  SELECT COALESCE(sum(p.amount), 0)
    INTO v_paid
  FROM public.payments AS p
  WHERE p.bill_id = NEW.bill_id;

  IF v_paid + NEW.amount > v_total + 0.001 THEN
    RAISE EXCEPTION 'Duplicate payment blocked: bill total %, already paid %, attempted %',
      v_total, v_paid, NEW.amount;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_payment_balance_before_insert ON public.payments;
CREATE TRIGGER guard_payment_balance_before_insert
BEFORE INSERT ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.guard_payment_balance();

-- One atomic API for new clients. It locks the bill, deduplicates retries with
-- request_key, validates the live database balance, and returns the authoritative
-- paid total used to decide whether checkout should be finalized.
CREATE OR REPLACE FUNCTION public.record_bill_payment(
  p_bill_id uuid,
  p_method public.payment_method,
  p_amount numeric,
  p_request_key uuid,
  p_cash_received numeric DEFAULT NULL,
  p_change_due numeric DEFAULT NULL,
  p_cash_breakdown jsonb DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_tip_amount numeric DEFAULT 0
)
RETURNS TABLE(
  payment_id uuid,
  method public.payment_method,
  amount numeric,
  cash_received numeric,
  change_due numeric,
  tip_amount numeric,
  reference text,
  paid_total numeric,
  bill_total numeric,
  fully_paid boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bill public.bills%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_paid numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF p_request_key IS NULL THEN
    RAISE EXCEPTION 'Payment request key is required';
  END IF;

  SELECT * INTO v_bill
  FROM public.bills AS b
  WHERE b.id = p_bill_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found';
  END IF;

  -- A network retry with the same request key returns the first result instead
  -- of creating another payment.
  SELECT * INTO v_payment
  FROM public.payments AS p
  WHERE p.request_key = p_request_key;

  IF FOUND THEN
    IF v_payment.bill_id <> p_bill_id
       OR v_payment.method <> p_method
       OR abs(v_payment.amount - p_amount) > 0.001 THEN
      RAISE EXCEPTION 'Payment request key was already used for different details';
    END IF;
  ELSE
    IF v_bill.status <> 'open' THEN
      RAISE EXCEPTION 'Bill is already closed';
    END IF;

    INSERT INTO public.payments (
      bill_id, method, amount, cash_received, change_due,
      cash_breakdown, reference, tip_amount, request_key
    ) VALUES (
      p_bill_id, p_method, p_amount, p_cash_received, p_change_due,
      p_cash_breakdown, p_reference, COALESCE(p_tip_amount, 0), p_request_key
    )
    RETURNING * INTO v_payment;
  END IF;

  SELECT COALESCE(sum(p.amount), 0)
    INTO v_paid
  FROM public.payments AS p
  WHERE p.bill_id = p_bill_id;

  RETURN QUERY SELECT
    v_payment.id,
    v_payment.method,
    v_payment.amount,
    v_payment.cash_received,
    v_payment.change_due,
    COALESCE(v_payment.tip_amount, 0),
    v_payment.reference,
    v_paid,
    v_bill.total,
    v_paid + 0.001 >= v_bill.total;
END;
$$;

REVOKE ALL ON FUNCTION public.record_bill_payment(
  uuid, public.payment_method, numeric, uuid, numeric, numeric, jsonb, text, numeric
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.record_bill_payment(
  uuid, public.payment_method, numeric, uuid, numeric, numeric, jsonb, text, numeric
) TO authenticated, service_role;

COMMENT ON COLUMN public.payments.request_key IS
  'Idempotency key generated once per cashier payment attempt.';

