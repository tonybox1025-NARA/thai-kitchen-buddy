-- Customer QR and Crew devices are ordering/service surfaces only.
-- Loyalty redemption is finalized through the authenticated SUNMI payment flow.
-- Keep the legacy reservation function available only to trusted backend work.
REVOKE ALL ON FUNCTION public.reserve_customer_bill_loyalty(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_customer_bill_loyalty(uuid, text, integer)
  TO service_role;

