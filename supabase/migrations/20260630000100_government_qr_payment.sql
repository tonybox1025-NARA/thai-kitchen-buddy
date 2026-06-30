ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'gov_qr';

ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS gov_qr_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gov_qr_label text NOT NULL DEFAULT '60/40',
  ADD COLUMN IF NOT EXISTS gov_qr_customer_percent numeric(5,2) NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS gov_qr_government_percent numeric(5,2) NOT NULL DEFAULT 40;

DO $$
BEGIN
  ALTER TABLE public.settings
    ADD CONSTRAINT settings_gov_qr_customer_percent_check
    CHECK (gov_qr_customer_percent >= 0 AND gov_qr_customer_percent <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.settings
    ADD CONSTRAINT settings_gov_qr_government_percent_check
    CHECK (gov_qr_government_percent >= 0 AND gov_qr_government_percent <= 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
