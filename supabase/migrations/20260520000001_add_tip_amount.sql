-- Add tip_amount column to payments table
-- Tips are collected via QR but paid out to staff in cash.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS tip_amount numeric(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payments.tip_amount IS
  'Optional tip charged on top of bill amount (QR payments only). Paid out to staff in cash.';
