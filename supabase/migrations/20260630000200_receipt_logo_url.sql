ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS receipt_logo_url text;
