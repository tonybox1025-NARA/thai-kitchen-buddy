-- Convert the first receipt-number release to LMYYYYMMDD001 format.
-- This changes receipt identifiers only; sales, payments, loyalty, orders, and shifts are untouched.

CREATE TABLE IF NOT EXISTS public.receipt_number_counters (
  receipt_date date PRIMARY KEY,
  last_value integer NOT NULL CHECK (last_value > 0)
);

ALTER TABLE public.receipt_number_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.receipt_number_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.receipt_number_counters TO service_role;

CREATE OR REPLACE FUNCTION public.assign_bill_receipt_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt_date date;
  v_daily_number integer;
BEGIN
  IF NEW.status = 'paid' AND NOT COALESCE(NEW.is_test, false) AND NEW.receipt_number IS NULL THEN
    v_receipt_date := (COALESCE(NEW.paid_at, now()) AT TIME ZONE 'Asia/Bangkok')::date;

    INSERT INTO public.receipt_number_counters(receipt_date, last_value)
    VALUES (v_receipt_date, 1)
    ON CONFLICT (receipt_date) DO UPDATE
      SET last_value = public.receipt_number_counters.last_value + 1
    RETURNING last_value INTO v_daily_number;

    NEW.receipt_number := 'LM'
      || to_char(v_receipt_date, 'YYYYMMDD')
      || lpad(v_daily_number::text, GREATEST(3, length(v_daily_number::text)), '0');
  END IF;
  RETURN NEW;
END;
$$;

-- Renumber the just-introduced identifiers deterministically by Bangkok payment date.
-- Block checkout writes briefly so no paid Bill can miss the one-time conversion.
LOCK TABLE public.bills IN SHARE ROW EXCLUSIVE MODE;

WITH numbered AS (
  SELECT
    id,
    (COALESCE(paid_at, created_at) AT TIME ZONE 'Asia/Bangkok')::date AS receipt_date,
    row_number() OVER (
      PARTITION BY (COALESCE(paid_at, created_at) AT TIME ZONE 'Asia/Bangkok')::date
      ORDER BY paid_at NULLS LAST, created_at, id
    ) AS n
  FROM public.bills
  WHERE status IN ('paid', 'partial_refund', 'refunded')
    AND NOT COALESCE(is_test, false)
)
UPDATE public.bills b
SET receipt_number = 'LM'
  || to_char(numbered.receipt_date, 'YYYYMMDD')
  || lpad(numbered.n::text, GREATEST(3, length(numbered.n::text)), '0')
FROM numbered
WHERE b.id = numbered.id;

TRUNCATE TABLE public.receipt_number_counters;

INSERT INTO public.receipt_number_counters(receipt_date, last_value)
SELECT
  to_date(substring(receipt_number FROM 3 FOR 8), 'YYYYMMDD'),
  max(substring(receipt_number FROM 11)::integer)
FROM public.bills
WHERE receipt_number ~ '^LM[0-9]{11,}$'
GROUP BY 1;

DROP SEQUENCE IF EXISTS public.receipt_number_seq;

COMMENT ON COLUMN public.bills.receipt_number IS
  'Immutable customer receipt number: LM + Bangkok payment date + daily sequence.';
COMMENT ON TABLE public.receipt_number_counters IS
  'Atomic per-Bangkok-date counters used only for paid Bill receipt numbers.';
