CREATE OR REPLACE FUNCTION public.set_member_point_expiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_months integer;
BEGIN
  IF NEW.points > 0
     AND NEW.expires_at IS NULL
     AND NEW.type IN ('signup_bonus', 'earn', 'adjust', 'refund_redeem_restore') THEN
    SELECT loyalty_points_expire_months INTO v_months
    FROM public.settings
    WHERE id = 1;

    IF COALESCE(v_months, 0) > 0 THEN
      NEW.expires_at := (CURRENT_DATE + make_interval(months => v_months))::date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_member_point_expiry ON public.member_point_ledger;
CREATE TRIGGER set_member_point_expiry
BEFORE INSERT ON public.member_point_ledger
FOR EACH ROW EXECUTE FUNCTION public.set_member_point_expiry();

ALTER TABLE public.member_point_ledger
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS member_point_ledger_approved_by_idx
  ON public.member_point_ledger (approved_by, created_at DESC)
  WHERE approved_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.expire_due_member_points()
RETURNS TABLE(members_expired integer, points_expired bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member record;
  v_current integer;
  v_expire_now integer;
  v_members integer := 0;
  v_points bigint := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  FOR v_member IN
    SELECT
      m.id,
      m.current_points,
      GREATEST(
        0,
        COALESCE(sum(l.points) FILTER (
          WHERE l.points > 0 AND l.expires_at IS NOT NULL AND l.expires_at <= CURRENT_DATE
        ), 0)
        - COALESCE(-sum(l.points) FILTER (WHERE l.points < 0), 0)
      )::integer AS due_points
    FROM public.members m
    JOIN public.member_point_ledger l ON l.member_id = m.id
    WHERE m.current_points > 0
    GROUP BY m.id, m.current_points
    HAVING GREATEST(
      0,
      COALESCE(sum(l.points) FILTER (
        WHERE l.points > 0 AND l.expires_at IS NOT NULL AND l.expires_at <= CURRENT_DATE
      ), 0)
      - COALESCE(-sum(l.points) FILTER (WHERE l.points < 0), 0)
    ) > 0
  LOOP
    SELECT current_points INTO v_current
    FROM public.members
    WHERE id = v_member.id
    FOR UPDATE;

    CONTINUE WHEN COALESCE(v_current, 0) <= 0;

    v_expire_now := LEAST(v_current, v_member.due_points);
    CONTINUE WHEN v_expire_now <= 0;

    UPDATE public.members
    SET current_points = v_current - v_expire_now, updated_at = now()
    WHERE id = v_member.id;

    INSERT INTO public.member_point_ledger
      (member_id, type, points, balance_after, description)
    VALUES
      (v_member.id, 'expire', -v_expire_now, v_current - v_expire_now,
       'Points expired on ' || CURRENT_DATE::text);

    v_members := v_members + 1;
    v_points := v_points + v_expire_now;
  END LOOP;

  RETURN QUERY SELECT v_members, v_points;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_due_member_points() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_due_member_points() TO authenticated;

CREATE OR REPLACE FUNCTION public.adjust_member_points(
  p_member_id uuid,
  p_delta integer,
  p_reason text,
  p_manager_pin text
)
RETURNS TABLE(balance_after integer, approved_by uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_approver public.staff%ROWTYPE;
  v_balance integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'Adjustment must not be zero';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Adjustment reason is required';
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

  SELECT current_points INTO v_balance
  FROM public.members
  WHERE id = p_member_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  IF v_balance + p_delta < 0 THEN
    RAISE EXCEPTION 'Adjustment exceeds current points';
  END IF;

  v_balance := v_balance + p_delta;
  UPDATE public.members
  SET current_points = v_balance, updated_at = now()
  WHERE id = p_member_id;

  INSERT INTO public.member_point_ledger
    (member_id, type, points, balance_after, description, approved_by)
  VALUES
    (p_member_id, 'adjust', p_delta, v_balance,
     btrim(p_reason) || ' (approved by ' || v_approver.name || ')', v_approver.id);

  RETURN QUERY SELECT v_balance, v_approver.id;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_member_points(uuid, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_member_points(uuid, integer, text, text) TO authenticated;
