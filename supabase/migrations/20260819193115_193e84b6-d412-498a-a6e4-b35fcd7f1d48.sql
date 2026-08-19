DROP VIEW IF EXISTS public.settings_public;

CREATE POLICY "anon select settings safe columns" ON public.settings
  FOR SELECT TO anon USING (true);

REVOKE ALL ON public.settings FROM anon;
GRANT SELECT (id, restaurant_name, starting_cash, receipt_logo_url, address, receipt_promo, vat_enabled, vat_mode, vat_rate) ON public.settings TO anon;