-- A points discount is a reservation against one member's balance. Never let
-- a new write leave redeemed points on a Bill after its member link is cleared.
-- This trigger deliberately does not rewrite historical rows; recovery remains
-- explicit and auditable by reconnecting the original member at checkout.
CREATE OR REPLACE FUNCTION public.enforce_bill_points_member_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.points_redeemed, 0) > 0 AND NEW.member_id IS NULL THEN
    RAISE EXCEPTION 'A member is required for a points redemption';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_bill_member_for_points_redemption ON public.bills;
CREATE TRIGGER require_bill_member_for_points_redemption
BEFORE INSERT OR UPDATE OF member_id, points_redeemed ON public.bills
FOR EACH ROW EXECUTE FUNCTION public.enforce_bill_points_member_link();
