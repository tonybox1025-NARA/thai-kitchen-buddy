ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES public.members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bills_member_id_idx ON public.bills (member_id);

CREATE UNIQUE INDEX IF NOT EXISTS member_point_ledger_bill_earn_key
  ON public.member_point_ledger (bill_id, type)
  WHERE bill_id IS NOT NULL AND type = 'earn';
