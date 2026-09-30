-- restaurant_tables is a projection of the authoritative open order state.
-- Normalize legacy/direct client writes so a table can never be marked free
-- while an open order owns it, or occupied without an open order.
CREATE OR REPLACE FUNCTION public.normalize_table_state_from_open_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guests integer;
BEGIN
  SELECT o.guests INTO v_guests
  FROM public.orders o
  WHERE o.table_id = NEW.id AND o.status = 'open'
  LIMIT 1;

  IF v_guests IS NULL THEN
    NEW.status := 'available';
    NEW.guests := 0;
  ELSE
    NEW.status := CASE
      WHEN NEW.status = 'bill_requested' THEN 'bill_requested'::public.table_status
      ELSE 'occupied'::public.table_status
    END;
    NEW.guests := greatest(1, v_guests);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_table_state_from_open_order ON public.restaurant_tables;
CREATE TRIGGER normalize_table_state_from_open_order
BEFORE INSERT OR UPDATE OF status, guests ON public.restaurant_tables
FOR EACH ROW EXECUTE FUNCTION public.normalize_table_state_from_open_order();

REVOKE ALL ON FUNCTION public.normalize_table_state_from_open_order() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_table_state_from_open_order() TO service_role;
