-- Audited, manager-approved emergency price changes initiated at the POS.
-- The Manager database remains canonical; the POS row is updated only after
-- the Manager bridge confirms the same price was saved there.

CREATE TABLE IF NOT EXISTS public.emergency_menu_price_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  menu_id uuid NOT NULL REFERENCES public.menus(id) ON DELETE RESTRICT,
  manager_menu_id uuid NOT NULL,
  old_price numeric(10,2) NOT NULL CHECK (old_price >= 0),
  new_price numeric(10,2) NOT NULL CHECK (new_price >= 0),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  requested_by uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  approved_by uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  approved_by_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending_manager'
    CHECK (status IN ('pending_manager', 'synced', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz
);

CREATE INDEX IF NOT EXISTS emergency_menu_price_changes_created_at_idx
  ON public.emergency_menu_price_changes (created_at DESC);
CREATE INDEX IF NOT EXISTS emergency_menu_price_changes_status_idx
  ON public.emergency_menu_price_changes (status, created_at DESC);

ALTER TABLE public.emergency_menu_price_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_menu_price_changes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read emergency price changes"
  ON public.emergency_menu_price_changes;
CREATE POLICY "authenticated read emergency price changes"
  ON public.emergency_menu_price_changes
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.emergency_menu_price_changes TO authenticated;
GRANT ALL ON public.emergency_menu_price_changes TO service_role;
REVOKE ALL ON public.emergency_menu_price_changes FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.prepare_emergency_menu_price_change(
  p_request_id uuid,
  p_menu_id uuid,
  p_new_price numeric,
  p_reason text,
  p_requested_by uuid,
  p_manager_pin text
)
RETURNS TABLE(
  change_id uuid,
  manager_menu_id uuid,
  old_price numeric,
  new_price numeric,
  approved_by uuid,
  approved_by_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_menu public.menus%ROWTYPE;
  v_requester public.staff%ROWTYPE;
  v_approver public.staff%ROWTYPE;
  v_change public.emergency_menu_price_changes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated POS session required';
  END IF;
  IF p_new_price IS NULL OR p_new_price < 0 OR p_new_price > 999999.99 THEN
    RAISE EXCEPTION 'Invalid new price';
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'A change reason is required';
  END IF;

  SELECT * INTO v_menu FROM public.menus m WHERE m.id = p_menu_id FOR UPDATE;
  IF NOT FOUND OR v_menu.manager_menu_id IS NULL THEN
    RAISE EXCEPTION 'Only Manager-linked menus can be synchronized';
  END IF;
  IF round(v_menu.price, 2) = round(p_new_price, 2) THEN
    RAISE EXCEPTION 'The new price is unchanged';
  END IF;

  SELECT * INTO v_requester
  FROM public.staff s
  WHERE s.id = p_requested_by AND s.active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active requesting staff not found'; END IF;

  SELECT * INTO v_approver
  FROM public.staff s
  WHERE s.active = true
    AND s.role IN ('admin'::public.app_role, 'manager'::public.app_role)
    AND s.pin_hash = crypt(p_manager_pin, s.pin_hash)
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Manager PIN approval failed'; END IF;

  INSERT INTO public.emergency_menu_price_changes (
    request_id, menu_id, manager_menu_id, old_price, new_price, reason,
    requested_by, approved_by, approved_by_name
  ) VALUES (
    p_request_id, v_menu.id, v_menu.manager_menu_id, v_menu.price,
    round(p_new_price, 2), btrim(p_reason), v_requester.id,
    v_approver.id, v_approver.name
  )
  ON CONFLICT (request_id) DO UPDATE SET request_id = EXCLUDED.request_id
  RETURNING * INTO v_change;

  RETURN QUERY SELECT v_change.id, v_change.manager_menu_id,
    v_change.old_price, v_change.new_price,
    v_change.approved_by, v_change.approved_by_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_emergency_menu_price_change(
  p_request_id uuid,
  p_success boolean,
  p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_change public.emergency_menu_price_changes%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  SELECT * INTO v_change
  FROM public.emergency_menu_price_changes c
  WHERE c.request_id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Price change request not found'; END IF;

  IF p_success THEN
    UPDATE public.menus SET price = v_change.new_price WHERE id = v_change.menu_id;
    UPDATE public.emergency_menu_price_changes
      SET status = 'synced', error_message = NULL, synced_at = now()
      WHERE id = v_change.id;
  ELSE
    UPDATE public.emergency_menu_price_changes
      SET status = 'failed', error_message = left(coalesce(p_error_message, 'Manager sync failed'), 1000)
      WHERE id = v_change.id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_emergency_menu_price_change(uuid, uuid, numeric, text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_emergency_menu_price_change(uuid, uuid, numeric, text, uuid, text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.finish_emergency_menu_price_change(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_emergency_menu_price_change(uuid, boolean, text)
  TO service_role;
