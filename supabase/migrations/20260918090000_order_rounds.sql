-- Persistent order rounds for table additions from both POS and QR ordering.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS round_number integer,
  ADD COLUMN IF NOT EXISTS round_source text;

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_round_source_check;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_round_source_check
  CHECK (round_source IS NULL OR round_source IN ('pos', 'qr'));

-- Recover historical rounds from the shared sent_at timestamp used by each send.
WITH ranked AS (
  SELECT id,
         dense_rank() OVER (PARTITION BY order_id ORDER BY sent_at) AS recovered_round
  FROM public.order_items
  WHERE sent_at IS NOT NULL AND status <> 'voided'
)
UPDATE public.order_items oi
SET round_number = ranked.recovered_round
FROM ranked
WHERE oi.id = ranked.id AND oi.round_number IS NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS next_round integer NOT NULL DEFAULT 1;

UPDATE public.orders o
SET next_round = greatest(1, coalesce(r.max_round, 0) + 1)
FROM (
  SELECT order_id, max(round_number) AS max_round
  FROM public.order_items
  GROUP BY order_id
) r
WHERE r.order_id = o.id;

CREATE INDEX IF NOT EXISTS order_items_order_round_idx
  ON public.order_items(order_id, round_number);

-- UPDATE ... RETURNING makes allocation atomic even when QR and POS submit together.
CREATE OR REPLACE FUNCTION public.allocate_order_round(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allocated integer;
BEGIN
  UPDATE public.orders
  SET next_round = next_round + 1
  WHERE id = p_order_id AND status = 'open'
  RETURNING next_round - 1 INTO allocated;

  IF allocated IS NULL THEN
    RAISE EXCEPTION 'Open order not found: %', p_order_id;
  END IF;
  RETURN allocated;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_order_round(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_order_round(uuid) TO anon, authenticated;
