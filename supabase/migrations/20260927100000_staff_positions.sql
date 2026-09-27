-- Job titles are separate from authorization roles. This lets the restaurant
-- represent its real hierarchy without accidentally granting sensitive POS
-- permissions to supervisors, shift leaders, or captains.
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS position text;

UPDATE public.staff
SET position = CASE
  WHEN lower(name) = 'owner' THEN 'owner'
  WHEN role = 'admin'::public.app_role THEN 'general_manager'
  WHEN role = 'manager'::public.app_role THEN 'manager'
  ELSE 'staff'
END
WHERE position IS NULL;

ALTER TABLE public.staff
  ALTER COLUMN position SET DEFAULT 'staff',
  ALTER COLUMN position SET NOT NULL;

ALTER TABLE public.staff DROP CONSTRAINT IF EXISTS staff_position_check;
ALTER TABLE public.staff ADD CONSTRAINT staff_position_check CHECK (
  position IN (
    'owner', 'general_manager', 'manager', 'assistant_manager',
    'supervisor', 'shift_leader', 'captain', 'staff'
  )
);

CREATE OR REPLACE FUNCTION public.list_staff_profiles()
RETURNS TABLE(id uuid, name text, role public.app_role, job_position text, active boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name, s.role, s.position, s.active
  FROM public.staff s
  ORDER BY s.name;
$$;

CREATE OR REPLACE FUNCTION public.create_staff_profile(
  _name text,
  _position text,
  _pin text,
  _admin_pin text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  new_id uuid;
  mapped_role public.app_role;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF NOT public.is_admin_pin(_admin_pin) THEN RAISE EXCEPTION 'Admin PIN required'; END IF;
  IF _position NOT IN (
    'owner', 'general_manager', 'manager', 'assistant_manager',
    'supervisor', 'shift_leader', 'captain', 'staff'
  ) THEN RAISE EXCEPTION 'Invalid position'; END IF;

  mapped_role := CASE
    WHEN _position IN ('owner', 'general_manager') THEN 'admin'::public.app_role
    WHEN _position IN ('manager', 'assistant_manager') THEN 'manager'::public.app_role
    ELSE 'staff'::public.app_role
  END;

  INSERT INTO public.staff (name, role, position, pin_hash)
  VALUES (trim(_name), mapped_role, _position, crypt(_pin, gen_salt('bf')))
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_staff_position(
  _staff_id uuid,
  _position text,
  _admin_pin text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mapped_role public.app_role;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF NOT public.is_admin_pin(_admin_pin) THEN RAISE EXCEPTION 'Admin PIN required'; END IF;
  IF _position NOT IN (
    'owner', 'general_manager', 'manager', 'assistant_manager',
    'supervisor', 'shift_leader', 'captain', 'staff'
  ) THEN RAISE EXCEPTION 'Invalid position'; END IF;

  mapped_role := CASE
    WHEN _position IN ('owner', 'general_manager') THEN 'admin'::public.app_role
    WHEN _position IN ('manager', 'assistant_manager') THEN 'manager'::public.app_role
    ELSE 'staff'::public.app_role
  END;

  UPDATE public.staff
  SET position = _position, role = mapped_role
  WHERE id = _staff_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff member not found'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.list_staff_profiles() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_staff_profile(text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_staff_position(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_staff_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_staff_profile(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_position(uuid,text,text) TO authenticated;
