-- Record the employee who physically opens and closes each register shift.
-- This is deliberately independent of app authentication: the signed-in account
-- remains available in opened_by/closed_by, while these names identify the crew
-- member who performed the cash procedure.

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS opened_operator_name text,
  ADD COLUMN IF NOT EXISTS closed_operator_name text;

ALTER TABLE public.shifts
  DROP CONSTRAINT IF EXISTS shifts_opened_operator_name_allowed,
  DROP CONSTRAINT IF EXISTS shifts_closed_operator_name_allowed;

ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_opened_operator_name_allowed
    CHECK (opened_operator_name IS NULL OR opened_operator_name IN ('THA', 'GIFT', 'TANNIE', 'JAY', 'TONY')),
  ADD CONSTRAINT shifts_closed_operator_name_allowed
    CHECK (closed_operator_name IS NULL OR closed_operator_name IN ('THA', 'GIFT', 'TANNIE', 'JAY', 'TONY'));

CREATE OR REPLACE FUNCTION public.open_shift_safely(
  p_opened_by uuid,
  p_opening_float numeric,
  p_business_day date,
  p_print_jobs jsonb,
  p_operator_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_shift_id uuid;
  v_shift jsonb;
BEGIN
  IF p_operator_name IS NULL OR p_operator_name NOT IN ('THA', 'GIFT', 'TANNIE', 'JAY', 'TONY') THEN
    RAISE EXCEPTION 'Valid opening employee is required';
  END IF;

  v_result := public.open_shift_safely(p_opened_by, p_opening_float, p_business_day, p_print_jobs);
  v_shift_id := (v_result->'shift'->>'id')::uuid;

  UPDATE public.shifts
  SET opened_operator_name = p_operator_name
  WHERE id = v_shift_id
    AND opened_operator_name IS NULL;

  SELECT to_jsonb(s) INTO v_shift FROM public.shifts s WHERE s.id = v_shift_id;
  RETURN v_result || jsonb_build_object('shift', v_shift);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_shift_with_ticket(
  p_shift_id uuid,
  p_closed_by uuid,
  p_cash_count jsonb,
  p_totals jsonb,
  p_print_payload jsonb,
  p_operator_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_operator_name IS NULL OR p_operator_name NOT IN ('THA', 'GIFT', 'TANNIE', 'JAY', 'TONY') THEN
    RAISE EXCEPTION 'Valid closing employee is required';
  END IF;

  v_result := public.close_shift_safely(p_shift_id, p_closed_by, p_cash_count, p_totals);

  IF COALESCE((v_result->>'closed')::boolean, false) THEN
    UPDATE public.shifts
    SET closed_operator_name = p_operator_name
    WHERE id = p_shift_id
      AND closed_operator_name IS NULL;

    IF p_print_payload IS NOT NULL THEN
      PERFORM public.enqueue_print_job(
        'z:' || p_shift_id::text,
        'counter',
        p_print_payload,
        'z',
        p_shift_id,
        NULL
      );
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.open_shift_safely(uuid, numeric, date, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_shift_with_ticket(uuid, uuid, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_shift_safely(uuid, numeric, date, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_shift_with_ticket(uuid, uuid, jsonb, jsonb, jsonb, text) TO authenticated, service_role;

COMMENT ON COLUMN public.shifts.opened_operator_name IS 'Crew member selected at the start of the opening cash workflow.';
COMMENT ON COLUMN public.shifts.closed_operator_name IS 'Crew member selected at the start of the Z-close workflow.';
