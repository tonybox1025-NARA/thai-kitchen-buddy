-- Keep a line-level audit trail for refunds made after a bill is paid.
-- The actual payout remains a cash refund in public.refunds; original tenders
-- are never rewritten.
CREATE TABLE IF NOT EXISTS public.refund_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.refunds(id) ON DELETE CASCADE,
  order_item_id uuid REFERENCES public.order_items(id) ON DELETE SET NULL,
  name_th text NOT NULL,
  name_en text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  unit_price numeric(10,2) NOT NULL CHECK (unit_price >= 0),
  gross_amount numeric(10,2) NOT NULL CHECK (gross_amount >= 0),
  refund_amount numeric(10,2) NOT NULL CHECK (refund_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refund_items_refund_id_idx
  ON public.refund_items(refund_id);

CREATE INDEX IF NOT EXISTS refund_items_order_item_id_idx
  ON public.refund_items(order_item_id);

ALTER TABLE public.refund_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated manage refund items" ON public.refund_items;
CREATE POLICY "authenticated manage refund items"
  ON public.refund_items
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.refund_items FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.refund_items TO authenticated;

-- p_items example:
-- [{"order_item_id":"...","qty":1},{"order_item_id":"...","qty":2}]
-- The item amount is allocated in the same proportion as bill total / menu
-- subtotal, so bill-wide discounts, service charge, and VAT are reflected.
CREATE OR REPLACE FUNCTION public.refund_bill_items_with_loyalty(
  p_bill_id uuid,
  p_items jsonb,
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
  v_selection_count integer := 0;
  v_gross numeric := 0;
  v_refund_amount numeric := 0;
  v_remaining_refundable numeric := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Select at least one item to refund';
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

  -- Reject duplicate item ids and malformed/non-positive quantities.
  WITH requested AS (
    SELECT item.order_item_id, item.qty
    FROM jsonb_to_recordset(p_items) AS item(order_item_id uuid, qty integer)
  )
  SELECT count(*), COALESCE(sum(oi.unit_price * requested.qty), 0)
  INTO v_selection_count, v_gross
  FROM requested
  JOIN public.order_items oi ON oi.id = requested.order_item_id
  WHERE oi.order_id = v_bill.order_id
    AND oi.status <> 'voided'
    AND requested.qty > 0;

  IF v_selection_count <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'One or more refund items are invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS item(order_item_id uuid, qty integer)
    GROUP BY item.order_item_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'The same item cannot be selected twice';
  END IF;

  IF EXISTS (
    WITH requested AS (
      SELECT item.order_item_id, item.qty
      FROM jsonb_to_recordset(p_items) AS item(order_item_id uuid, qty integer)
    ), refunded AS (
      SELECT ri.order_item_id, COALESCE(sum(ri.qty), 0)::integer AS qty
      FROM public.refund_items ri
      JOIN public.refunds r ON r.id = ri.refund_id
      WHERE r.bill_id = p_bill_id
      GROUP BY ri.order_item_id
    )
    SELECT 1
    FROM requested
    JOIN public.order_items oi ON oi.id = requested.order_item_id
    LEFT JOIN refunded ON refunded.order_item_id = requested.order_item_id
    WHERE requested.qty > oi.qty - COALESCE(refunded.qty, 0)
  ) THEN
    RAISE EXCEPTION 'Refund quantity exceeds the remaining item quantity';
  END IF;

  SELECT GREATEST(v_bill.total - COALESCE(sum(r.amount), 0), 0)
  INTO v_remaining_refundable
  FROM public.refunds r
  WHERE r.bill_id = p_bill_id;

  v_refund_amount := round(
    CASE
      WHEN v_bill.subtotal > 0 THEN v_gross * v_bill.total / v_bill.subtotal
      ELSE v_gross
    END,
    2
  );
  v_refund_amount := LEAST(v_refund_amount, v_remaining_refundable);

  IF v_refund_amount <= 0 THEN
    RAISE EXCEPTION 'No refundable amount remains';
  END IF;

  SELECT * INTO v_refund
  FROM public.refund_bill_with_loyalty(
    p_bill_id,
    v_refund_amount,
    p_reason,
    p_refunded_by
  );

  INSERT INTO public.refund_items (
    refund_id,
    order_item_id,
    name_th,
    name_en,
    qty,
    unit_price,
    gross_amount,
    refund_amount
  )
  SELECT
    v_refund.id,
    oi.id,
    oi.name_th,
    oi.name_en,
    requested.qty,
    oi.unit_price,
    round(oi.unit_price * requested.qty, 2),
    round(
      v_refund_amount * (oi.unit_price * requested.qty) / NULLIF(v_gross, 0),
      2
    )
  FROM jsonb_to_recordset(p_items) AS requested(order_item_id uuid, qty integer)
  JOIN public.order_items oi ON oi.id = requested.order_item_id;

  RETURN v_refund;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refund_bill_items_with_loyalty(uuid, jsonb, text, uuid)
  TO authenticated;
