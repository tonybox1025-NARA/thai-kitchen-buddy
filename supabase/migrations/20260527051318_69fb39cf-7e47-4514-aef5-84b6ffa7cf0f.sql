
-- Remove unsafe anonymous policies (QR flows go through server-side service-role endpoints)
DROP POLICY IF EXISTS "anon select settings" ON public.settings;
DROP POLICY IF EXISTS "anon update settings" ON public.settings;
DROP POLICY IF EXISTS "anon select print_jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "anon update print_jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "anon insert print_jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "anon update restaurant_tables" ON public.restaurant_tables;
DROP POLICY IF EXISTS "anon insert order_items" ON public.order_items;
DROP POLICY IF EXISTS "anon insert orders" ON public.orders;

-- Lock down SECURITY DEFINER functions: no anon execute
REVOKE EXECUTE ON FUNCTION public.verify_staff_pin(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_staff() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_staff(text, public.app_role, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_staff(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_staff_pin(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.verify_staff_pin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_staff(text, public.app_role, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_pin(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
