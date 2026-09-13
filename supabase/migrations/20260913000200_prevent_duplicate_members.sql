CREATE OR REPLACE FUNCTION public.normalize_member_phone(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN digits = '' THEN NULL
    WHEN digits LIKE '0066%' THEN '0' || substr(digits, 5)
    WHEN digits LIKE '66%' AND length(digits) BETWEEN 11 AND 12 THEN '0' || substr(digits, 3)
    ELSE digits
  END
  FROM (SELECT regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g') AS digits) normalized;
$$;

CREATE INDEX IF NOT EXISTS members_normalized_phone_idx
  ON public.members (public.normalize_member_phone(phone))
  WHERE public.normalize_member_phone(phone) IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_or_get_member(
  p_full_name text,
  p_nickname text,
  p_phone text,
  p_signup_points integer,
  p_imported_from text,
  p_signup_description text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_phone text := public.normalize_member_phone(p_phone);
  v_member public.members%ROWTYPE;
  v_signup_points integer := GREATEST(COALESCE(p_signup_points, 0), 0);
BEGIN
  IF NULLIF(btrim(p_full_name), '') IS NULL THEN
    RAISE EXCEPTION 'Member name is required';
  END IF;

  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Phone number is required';
  END IF;

  -- Serializes all member creation attempts for the same normalized phone.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_phone, 0));

  SELECT * INTO v_member
  FROM public.members
  WHERE public.normalize_member_phone(phone) = v_phone
  ORDER BY
    CASE WHEN status = 'active' THEN 0 ELSE 1 END,
    created_at
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_member.status <> 'active' THEN
      UPDATE public.members
      SET status = 'active', updated_at = now()
      WHERE id = v_member.id
      RETURNING * INTO v_member;
    END IF;

    RETURN jsonb_build_object(
      'member_id', v_member.id,
      'created', false,
      'normalized_phone', v_phone
    );
  END IF;

  INSERT INTO public.members (
    full_name,
    nickname,
    phone,
    opening_points,
    current_points,
    imported_from
  )
  VALUES (
    btrim(p_full_name),
    NULLIF(btrim(p_nickname), ''),
    v_phone,
    v_signup_points,
    v_signup_points,
    NULLIF(btrim(p_imported_from), '')
  )
  RETURNING * INTO v_member;

  IF v_signup_points > 0 THEN
    INSERT INTO public.member_point_ledger (
      member_id,
      type,
      points,
      balance_after,
      description
    )
    VALUES (
      v_member.id,
      'signup_bonus',
      v_signup_points,
      v_signup_points,
      COALESCE(NULLIF(btrim(p_signup_description), ''), 'Signup bonus')
    );
  END IF;

  RETURN jsonb_build_object(
    'member_id', v_member.id,
    'created', true,
    'normalized_phone', v_phone
  );
END;
$$;
