-- User-defined time windows for the QR-by-time breakdown on the X/Z report and
-- the QR detail page. Stored as an array of { "start": "HH:MM", "end": "HH:MM" }.
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS qr_time_buckets jsonb NOT NULL DEFAULT '[]'::jsonb;
