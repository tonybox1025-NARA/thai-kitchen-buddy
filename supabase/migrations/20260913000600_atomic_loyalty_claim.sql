CREATE OR REPLACE FUNCTION public.claim_receipt_loyalty_points(
  p_claim_token text,
  p_guest_token text
)
RETURNS TABLE(
  claim_status text,
  member_id uuid,
  member_name text,
  current_points integer,
  member_group_en text,
  points_awarded integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.loyalty_claim_tokens%ROWTYPE;
  v_member public.members%ROWTYPE;
  v_points integer;
  v_existing_points integer;
  v_balance integer;
BEGIN
  IF NULLIF(btrim(p_guest_token), '') IS NULL OR length(p_guest_token) < 20 THEN
    RAISE EXCEPTION 'Invalid guest token';
  END IF;

  SELECT * INTO v_claim
  FROM public.loyalty_claim_tokens
  WHERE token = p_claim_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Claim not found';
  END IF;

  IF v_claim.status = 'open'
     AND v_claim.expires_at IS NOT NULL
     AND v_claim.expires_at < now() THEN
    RAISE EXCEPTION 'Claim expired';
  END IF;

  SELECT * INTO v_member
  FROM public.members
  WHERE guest_token = p_guest_token
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.members (
      full_name, nickname, guest_token, imported_from,
      member_group_en, member_group_th, opening_points, current_points
    ) VALUES (
      'Guest Member', 'Guest', p_guest_token, 'guest_wallet',
      'Guest Wallet', 'Guest Wallet', 0, 0
    )
    ON CONFLICT (guest_token)
      WHERE guest_token IS NOT NULL AND guest_token <> ''
    DO NOTHING
    RETURNING * INTO v_member;

    IF NOT FOUND THEN
      SELECT * INTO v_member
      FROM public.members
      WHERE guest_token = p_guest_token
      FOR UPDATE;
    END IF;
  END IF;

  IF v_claim.status = 'claimed' THEN
    SELECT * INTO v_member FROM public.members WHERE id = v_claim.member_id;
    RETURN QUERY SELECT
      'claimed'::text, v_member.id, v_member.full_name,
      v_member.current_points, v_member.member_group_en, 0;
    RETURN;
  END IF;
  IF v_claim.status <> 'open' THEN
    RAISE EXCEPTION 'Claim is not available';
  END IF;

  v_points := GREATEST(0, COALESCE(v_claim.claim_points, 0));
  SELECT points INTO v_existing_points
  FROM public.member_point_ledger
  WHERE bill_id = v_claim.bill_id AND type = 'earn';

  IF v_existing_points IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.member_point_ledger
      WHERE bill_id = v_claim.bill_id AND type = 'earn' AND member_id <> v_member.id
    ) THEN
      RAISE EXCEPTION 'Bill points already belong to another member';
    END IF;
    v_points := 0;
  ELSIF v_points > 0 THEN
    v_balance := v_member.current_points + v_points;
    UPDATE public.members
    SET current_points = v_balance, updated_at = now()
    WHERE id = v_member.id;

    INSERT INTO public.member_point_ledger
      (member_id, bill_id, type, points, balance_after, description)
    VALUES
      (v_member.id, v_claim.bill_id, 'earn', v_points, v_balance,
       'Earned from receipt QR');
    v_member.current_points := v_balance;
  END IF;

  UPDATE public.loyalty_claim_tokens
  SET member_id = v_member.id, status = 'claimed', claimed_at = now()
  WHERE id = v_claim.id;

  RETURN QUERY SELECT
    'claimed'::text, v_member.id, v_member.full_name,
    v_member.current_points, v_member.member_group_en, v_points;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_receipt_loyalty_points(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_receipt_loyalty_points(text, text)
  TO service_role;
