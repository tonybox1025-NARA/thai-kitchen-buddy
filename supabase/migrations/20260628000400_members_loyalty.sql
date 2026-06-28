ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS loyalty_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS loyalty_points_per_baht numeric(10,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS loyalty_signup_bonus int NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS loyalty_points_expire_months int NOT NULL DEFAULT 6;

CREATE TABLE IF NOT EXISTS public.members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_code text,
  first_name text,
  last_name text,
  nickname text,
  full_name text NOT NULL,
  phone text,
  email text,
  birthday date,
  gender text,
  member_group_th text,
  member_group_en text,
  member_level text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  opening_points int NOT NULL DEFAULT 0,
  current_points int NOT NULL DEFAULT 0,
  legacy_visit_count int NOT NULL DEFAULT 0,
  legacy_total_spend numeric(12,2) NOT NULL DEFAULT 0,
  legacy_average_spend numeric(12,2) NOT NULL DEFAULT 0,
  legacy_last_visit_at date,
  notes text,
  imported_from text,
  legacy_source_row int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.member_point_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  bill_id uuid REFERENCES public.bills(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('opening', 'signup_bonus', 'earn', 'redeem', 'adjust', 'expire')),
  points int NOT NULL,
  balance_after int NOT NULL,
  description text,
  expires_at date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS members_phone_idx
  ON public.members (phone)
  WHERE phone IS NOT NULL AND phone <> '';

CREATE INDEX IF NOT EXISTS members_full_name_idx ON public.members (full_name);
CREATE INDEX IF NOT EXISTS members_nickname_idx ON public.members (nickname);
CREATE INDEX IF NOT EXISTS members_legacy_source_idx ON public.members (imported_from, legacy_source_row);
CREATE INDEX IF NOT EXISTS member_point_ledger_member_idx ON public.member_point_ledger (member_id, created_at DESC);

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_point_ledger ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'members'
      AND policyname = 'authenticated can manage members'
  ) THEN
    CREATE POLICY "authenticated can manage members"
      ON public.members
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'member_point_ledger'
      AND policyname = 'authenticated can manage member_point_ledger'
  ) THEN
    CREATE POLICY "authenticated can manage member_point_ledger"
      ON public.member_point_ledger
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
