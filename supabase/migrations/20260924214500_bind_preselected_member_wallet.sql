-- A receipt can already be assigned to a member at the register. In that case
-- the receipt is marked claimed before the customer scans it. Bind the phone's
-- guest token to that same member when the customer opens their wallet, rather
-- than creating a second zero-point member.
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
  v_token_owner public.members%ROWTYPE;
  v_points integer;
  v_existing_points integer;
  v_balance integer;
  v_owner_activity integer := 0;
  v_line_user_id text;
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

  -- Register-selected members reach the customer as an already-claimed token.
  -- Explicitly attach this phone to that member before returning the wallet.
  IF v_claim.status = 'claimed' THEN
    SELECT * INTO v_member
    FROM public.members
    WHERE id = v_claim.member_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Claimed member not found';
    END IF;

    SELECT * INTO v_token_owner
    FROM public.members
    WHERE guest_token = p_guest_token
    FOR UPDATE;

    IF FOUND AND v_token_owner.id <> v_member.id THEN
      SELECT
        (SELECT count(*) FROM public.member_point_ledger l WHERE l.member_id = v_token_owner.id)
        + (SELECT count(*) FROM public.bills b WHERE b.member_id = v_token_owner.id)
        + (SELECT count(*) FROM public.loyalty_claim_tokens c
           WHERE c.member_id = v_token_owner.id AND c.id <> v_claim.id)
      INTO v_owner_activity;

      IF COALESCE(v_token_owner.current_points, 0) <> 0 OR v_owner_activity <> 0 THEN
        RAISE EXCEPTION 'This phone is linked to another active membership';
      END IF;

      IF v_member.line_user_id IS NOT NULL
         AND v_token_owner.line_user_id IS NOT NULL
         AND v_member.line_user_id <> v_token_owner.line_user_id THEN
        RAISE EXCEPTION 'LINE accounts conflict; staff review is required';
      END IF;

      v_line_user_id := COALESCE(v_member.line_user_id, v_token_owner.line_user_id);

      -- Release unique identity values, preserve a trace, and remove only the
      -- verified empty temporary wallet.
      INSERT INTO public.member_merge_audit
        (survivor_member_id, merged_member_id, survivor_before, merged_member_before)
      VALUES
        (v_member.id, v_token_owner.id, to_jsonb(v_member), to_jsonb(v_token_owner));

      UPDATE public.members
      SET guest_token = NULL, line_user_id = NULL
      WHERE id = v_token_owner.id;

      UPDATE public.loyalty_claim_tokens
      SET member_id = v_member.id
      WHERE member_id = v_token_owner.id;

      DELETE FROM public.members WHERE id = v_token_owner.id;
    ELSE
      v_line_user_id := v_member.line_user_id;
    END IF;

    IF v_member.guest_token IS NOT NULL
       AND v_member.guest_token <> p_guest_token THEN
      RAISE EXCEPTION 'This membership is already linked to another phone';
    END IF;

    UPDATE public.members
    SET guest_token = p_guest_token,
        line_user_id = COALESCE(line_user_id, v_line_user_id),
        updated_at = now()
    WHERE id = v_member.id
    RETURNING * INTO v_member;

    RETURN QUERY SELECT
      'claimed'::text, v_member.id, v_member.full_name,
      v_member.current_points, v_member.member_group_en, 0;
    RETURN;
  END IF;

  IF v_claim.status <> 'open' THEN
    RAISE EXCEPTION 'Claim is not available';
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
