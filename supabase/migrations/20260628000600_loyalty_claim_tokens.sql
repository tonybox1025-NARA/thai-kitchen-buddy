CREATE TABLE IF NOT EXISTS public.loyalty_claim_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  bill_id uuid NOT NULL UNIQUE REFERENCES public.bills(id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'expired')),
  claim_points int NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loyalty_claim_tokens_token_idx ON public.loyalty_claim_tokens (token);
CREATE INDEX IF NOT EXISTS loyalty_claim_tokens_member_idx ON public.loyalty_claim_tokens (member_id);

ALTER TABLE public.loyalty_claim_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'loyalty_claim_tokens'
      AND policyname = 'authenticated can manage loyalty_claim_tokens'
  ) THEN
    CREATE POLICY "authenticated can manage loyalty_claim_tokens"
      ON public.loyalty_claim_tokens
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS guest_token text;

CREATE UNIQUE INDEX IF NOT EXISTS members_guest_token_key
  ON public.members (guest_token)
  WHERE guest_token IS NOT NULL AND guest_token <> '';
