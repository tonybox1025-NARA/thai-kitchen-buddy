-- Audit log for payment method corrections
-- Scenario 1: quick-fix within 10 min of payment (admin/manager)
-- Scenario 2: Z-report adjustment before shift close (admin/manager)
CREATE TABLE IF NOT EXISTS public.payment_corrections (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id     uuid        NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  bill_id        uuid        NOT NULL REFERENCES public.bills(id)    ON DELETE CASCADE,
  corrected_by   uuid        REFERENCES public.staff(id),
  old_method     text        NOT NULL,
  new_method     text        NOT NULL,
  reason         text,
  corrected_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_corrections_bill_idx ON public.payment_corrections(bill_id);
CREATE INDEX IF NOT EXISTS payment_corrections_at_idx   ON public.payment_corrections(corrected_at);

COMMENT ON TABLE public.payment_corrections IS
  'Immutable audit trail for payment method corrections. Never updated or deleted.';
