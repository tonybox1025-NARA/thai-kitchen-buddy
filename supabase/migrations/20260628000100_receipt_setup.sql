ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS vat_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS service_fee_rate numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rounding_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS max_discount_percent numeric(5,2) NOT NULL DEFAULT 100;

ALTER TABLE public.settings
  ADD CONSTRAINT settings_rounding_mode_check
  CHECK (rounding_mode IN ('none', 'nearest_whole', 'up_whole', 'down_whole'));

ALTER TABLE public.settings
  ADD CONSTRAINT settings_service_fee_rate_check
  CHECK (service_fee_rate >= 0 AND service_fee_rate <= 100);

ALTER TABLE public.settings
  ADD CONSTRAINT settings_max_discount_percent_check
  CHECK (max_discount_percent >= 0 AND max_discount_percent <= 100);

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS service_fee_rate numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_fee_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rounding_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS rounding_adjustment numeric(10,2) NOT NULL DEFAULT 0;

ALTER TABLE public.bills
  ADD CONSTRAINT bills_rounding_mode_check
  CHECK (rounding_mode IN ('none', 'nearest_whole', 'up_whole', 'down_whole'));
