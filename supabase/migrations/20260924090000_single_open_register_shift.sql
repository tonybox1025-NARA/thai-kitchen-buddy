-- A physical register can have only one open shift. Touch screens and slow
-- networks may submit the open action twice; enforce the invariant in Postgres
-- so concurrent clients cannot create two open shifts.

DO $$
DECLARE
  keeper uuid;
BEGIN
  SELECT id INTO keeper
  FROM public.shifts
  WHERE status = 'open'
  ORDER BY opened_at DESC, id DESC
  LIMIT 1;

  IF keeper IS NOT NULL THEN
    UPDATE public.shifts
    SET status = 'closed',
        closed_at = COALESCE(closed_at, opened_at)
    WHERE status = 'open'
      AND id <> keeper;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS shifts_only_one_open_idx
  ON public.shifts ((1))
  WHERE status = 'open';
