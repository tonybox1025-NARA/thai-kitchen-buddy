-- Every real paid bill receives one immutable, searchable receipt number.
-- Allocation happens in PostgreSQL so two tills can never issue the same number.

ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS receipt_number text;
CREATE SEQUENCE IF NOT EXISTS public.receipt_number_seq AS bigint START WITH 1;

CREATE OR REPLACE FUNCTION public.assign_bill_receipt_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'paid' AND NOT COALESCE(NEW.is_test, false) AND NEW.receipt_number IS NULL THEN
    NEW.receipt_number := 'LM-' || lpad(nextval('public.receipt_number_seq')::text, 8, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_bill_receipt_number_trigger ON public.bills;
CREATE TRIGGER assign_bill_receipt_number_trigger
BEFORE INSERT OR UPDATE OF status ON public.bills
FOR EACH ROW EXECUTE FUNCTION public.assign_bill_receipt_number();

-- Historical numbering changes no amount, payment, loyalty, order, or shift data.
WITH numbered AS (
  SELECT id,
    COALESCE((SELECT max(substring(receipt_number FROM 4)::bigint)
      FROM public.bills WHERE receipt_number ~ '^LM-[0-9]{8}$'), 0)
    + row_number() OVER (ORDER BY paid_at NULLS LAST, created_at, id) AS n
  FROM public.bills
  WHERE status IN ('paid', 'partial_refund', 'refunded')
    AND NOT COALESCE(is_test, false) AND receipt_number IS NULL
)
UPDATE public.bills b
SET receipt_number = 'LM-' || lpad(numbered.n::text, 8, '0')
FROM numbered WHERE b.id = numbered.id;

SELECT setval(
  'public.receipt_number_seq',
  GREATEST(1, COALESCE((SELECT max(substring(receipt_number FROM 4)::bigint) FROM public.bills WHERE receipt_number ~ '^LM-[0-9]{8}$'), 0)),
  COALESCE((SELECT count(*) > 0 FROM public.bills WHERE receipt_number ~ '^LM-[0-9]{8}$'), false)
);

CREATE UNIQUE INDEX IF NOT EXISTS bills_receipt_number_uidx
  ON public.bills(receipt_number) WHERE receipt_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS bills_receipt_number_search_idx
  ON public.bills(receipt_number text_pattern_ops) WHERE receipt_number IS NOT NULL;

COMMENT ON COLUMN public.bills.receipt_number IS
  'Immutable customer receipt number assigned when a real bill becomes paid.';
