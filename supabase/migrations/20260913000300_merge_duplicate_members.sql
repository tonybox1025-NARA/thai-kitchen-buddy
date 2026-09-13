ALTER TABLE public.member_point_ledger
  DROP CONSTRAINT IF EXISTS member_point_ledger_type_check;

ALTER TABLE public.member_point_ledger
  ADD CONSTRAINT member_point_ledger_type_check
  CHECK (type IN (
    'opening', 'signup_bonus', 'earn', 'redeem', 'adjust', 'expire',
    'refund_earn_reversal', 'refund_redeem_restore', 'member_merge'
  ));

CREATE TABLE IF NOT EXISTS public.member_merge_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survivor_member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  merged_member_id uuid NOT NULL,
  survivor_before jsonb NOT NULL,
  merged_member_before jsonb NOT NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  merged_by uuid DEFAULT auth.uid(),
  approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL
);

ALTER TABLE public.member_merge_audit
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL;

ALTER TABLE public.member_merge_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read member merge audit"
  ON public.member_merge_audit;
CREATE POLICY "authenticated can read member merge audit"
  ON public.member_merge_audit FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated can create member merge audit"
  ON public.member_merge_audit;

REVOKE INSERT, UPDATE, DELETE ON public.member_merge_audit FROM authenticated;
GRANT SELECT ON public.member_merge_audit TO authenticated;

CREATE OR REPLACE FUNCTION public.merge_duplicate_members(
  p_survivor_member_id uuid,
  p_merged_member_id uuid,
  p_manager_pin text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_survivor public.members%ROWTYPE;
  v_merged public.members%ROWTYPE;
  v_phone_survivor text;
  v_phone_merged text;
  v_new_balance int;
  v_approver public.staff%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v_approver
  FROM public.staff s
  WHERE s.active = true
    AND s.role IN ('manager'::public.app_role, 'admin'::public.app_role)
    AND s.pin_hash = crypt(p_manager_pin, s.pin_hash)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manager PIN required';
  END IF;

  IF p_survivor_member_id = p_merged_member_id THEN
    RAISE EXCEPTION 'Select two different members';
  END IF;

  SELECT * INTO v_survivor FROM public.members
  WHERE id = p_survivor_member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Surviving member not found'; END IF;

  SELECT * INTO v_merged FROM public.members
  WHERE id = p_merged_member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Duplicate member not found'; END IF;

  v_phone_survivor := public.normalize_member_phone(v_survivor.phone);
  v_phone_merged := public.normalize_member_phone(v_merged.phone);
  IF v_phone_survivor IS NULL OR v_phone_survivor <> v_phone_merged THEN
    RAISE EXCEPTION 'Members must have the same normalized phone number';
  END IF;

  IF v_survivor.line_user_id IS NOT NULL AND v_merged.line_user_id IS NOT NULL
     AND v_survivor.line_user_id <> v_merged.line_user_id THEN
    RAISE EXCEPTION 'LINE accounts conflict; manual review required';
  END IF;
  IF v_survivor.guest_token IS NOT NULL AND v_merged.guest_token IS NOT NULL
     AND v_survivor.guest_token <> v_merged.guest_token THEN
    RAISE EXCEPTION 'Guest wallets conflict; manual review required';
  END IF;

  v_new_balance := v_survivor.current_points + v_merged.current_points;

  INSERT INTO public.member_merge_audit
    (survivor_member_id, merged_member_id, survivor_before, merged_member_before, approved_by)
  VALUES
    (v_survivor.id, v_merged.id, to_jsonb(v_survivor), to_jsonb(v_merged), v_approver.id);

  UPDATE public.bills SET member_id = v_survivor.id WHERE member_id = v_merged.id;
  UPDATE public.loyalty_claim_tokens SET member_id = v_survivor.id WHERE member_id = v_merged.id;
  UPDATE public.member_point_ledger SET member_id = v_survivor.id WHERE member_id = v_merged.id;

  -- Release partial unique identity indexes before copying either identity to
  -- the surviving row. The original values remain in the immutable audit row.
  UPDATE public.members
  SET line_user_id = NULL, guest_token = NULL
  WHERE id = v_merged.id;

  UPDATE public.members
  SET
    first_name = COALESCE(NULLIF(v_survivor.first_name, ''), v_merged.first_name),
    last_name = COALESCE(NULLIF(v_survivor.last_name, ''), v_merged.last_name),
    nickname = COALESCE(NULLIF(v_survivor.nickname, ''), v_merged.nickname),
    email = COALESCE(NULLIF(v_survivor.email, ''), v_merged.email),
    birthday = COALESCE(v_survivor.birthday, v_merged.birthday),
    gender = COALESCE(NULLIF(v_survivor.gender, ''), v_merged.gender),
    line_user_id = COALESCE(v_survivor.line_user_id, v_merged.line_user_id),
    guest_token = COALESCE(v_survivor.guest_token, v_merged.guest_token),
    current_points = v_new_balance,
    opening_points = v_survivor.opening_points + v_merged.opening_points,
    legacy_visit_count = v_survivor.legacy_visit_count + v_merged.legacy_visit_count,
    legacy_total_spend = v_survivor.legacy_total_spend + v_merged.legacy_total_spend,
    legacy_average_spend = CASE
      WHEN v_survivor.legacy_visit_count + v_merged.legacy_visit_count > 0
      THEN (v_survivor.legacy_total_spend + v_merged.legacy_total_spend)
        / (v_survivor.legacy_visit_count + v_merged.legacy_visit_count)
      ELSE 0
    END,
    legacy_last_visit_at = GREATEST(v_survivor.legacy_last_visit_at, v_merged.legacy_last_visit_at),
    status = CASE WHEN v_survivor.status = 'active' OR v_merged.status = 'active'
      THEN 'active' ELSE v_survivor.status END,
    updated_at = now()
  WHERE id = v_survivor.id;

  DELETE FROM public.members WHERE id = v_merged.id;

  INSERT INTO public.member_point_ledger
    (member_id, type, points, balance_after, description)
  VALUES
    (v_survivor.id, 'member_merge', 0, v_new_balance,
     'Merged duplicate member ' || v_merged.full_name || ' (' || v_merged.id || ')');

  RETURN jsonb_build_object(
    'member_id', v_survivor.id,
    'merged_member_id', v_merged.id,
    'current_points', v_new_balance
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_duplicate_members(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_members(uuid, uuid, text) TO authenticated;
