-- 1. Enable RLS on add-on tables
ALTER TABLE public.addon_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addon_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_addons ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.addon_groups TO anon;
GRANT SELECT ON public.addon_options TO anon;
GRANT SELECT ON public.menu_addons TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.addon_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.addon_options TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_addons TO authenticated;
GRANT ALL ON public.addon_groups TO service_role;
GRANT ALL ON public.addon_options TO service_role;
GRANT ALL ON public.menu_addons TO service_role;

CREATE POLICY "anon select addon_groups" ON public.addon_groups FOR SELECT TO anon USING (true);
CREATE POLICY "auth all addon_groups" ON public.addon_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon select addon_options" ON public.addon_options FOR SELECT TO anon USING (true);
CREATE POLICY "auth all addon_options" ON public.addon_options FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon select menu_addons" ON public.menu_addons FOR SELECT TO anon USING (true);
CREATE POLICY "auth all menu_addons" ON public.menu_addons FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. print_jobs: remove anonymous read/write
DROP POLICY IF EXISTS "anon select print_jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "anon update print_jobs" ON public.print_jobs;
REVOKE ALL ON public.print_jobs FROM anon;
GRANT ALL ON public.print_jobs TO service_role;

-- 3. settings: remove anonymous read, expose safe public view
DROP POLICY IF EXISTS "anon select settings" ON public.settings;
REVOKE ALL ON public.settings FROM anon;
GRANT ALL ON public.settings TO service_role;

DROP VIEW IF EXISTS public.settings_public;
CREATE VIEW public.settings_public WITH (security_invoker = off) AS
  SELECT id, restaurant_name, starting_cash FROM public.settings;
GRANT SELECT ON public.settings_public TO anon, authenticated;

-- 4. Staff management RPCs now require a valid admin PIN
CREATE OR REPLACE FUNCTION public.is_admin_pin(_pin text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff s
    WHERE s.active = true
      AND s.role = 'admin'::app_role
      AND s.pin_hash = crypt(_pin, s.pin_hash)
  );
$$;
REVOKE ALL ON FUNCTION public.is_admin_pin(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_pin(text) TO authenticated;

DROP FUNCTION IF EXISTS public.create_staff(text, app_role, text);
CREATE OR REPLACE FUNCTION public.create_staff(_name text, _role app_role, _pin text, _admin_pin text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _admin_pin IS NULL OR NOT public.is_admin_pin(_admin_pin) THEN
    RAISE EXCEPTION 'Admin PIN required';
  END IF;
  INSERT INTO public.staff (name, role, pin_hash)
  VALUES (_name, _role, crypt(_pin, gen_salt('bf')))
  RETURNING id INTO new_id;
  RETURN new_id;
END; $$;
REVOKE ALL ON FUNCTION public.create_staff(text, app_role, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_staff(text, app_role, text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.delete_staff(uuid);
CREATE OR REPLACE FUNCTION public.delete_staff(_id uuid, _admin_pin text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _admin_pin IS NULL OR NOT public.is_admin_pin(_admin_pin) THEN
    RAISE EXCEPTION 'Admin PIN required';
  END IF;
  DELETE FROM public.staff WHERE id = _id;
END; $$;
REVOKE ALL ON FUNCTION public.delete_staff(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_staff(uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.set_staff_pin(uuid, text);
CREATE OR REPLACE FUNCTION public.set_staff_pin(_staff_id uuid, _pin text, _admin_pin text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _admin_pin IS NULL OR NOT public.is_admin_pin(_admin_pin) THEN
    RAISE EXCEPTION 'Admin PIN required';
  END IF;
  UPDATE public.staff SET pin_hash = crypt(_pin, gen_salt('bf')) WHERE id = _staff_id;
END; $$;
REVOKE ALL ON FUNCTION public.set_staff_pin(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_staff_pin(uuid, text, text) TO authenticated;

-- 5. Fix mutable search_path on trigger function
CREATE OR REPLACE FUNCTION public.update_menu_cost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  target_menu_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_menu_id := OLD.menu_id;
  ELSE
    target_menu_id := NEW.menu_id;
  END IF;

  UPDATE public.menus
  SET cost = (
    SELECT COALESCE(SUM(mi.quantity * i.cost_per_unit), 0)
    FROM public.menu_ingredients mi
    JOIN public.ingredients i ON i.id = mi.ingredient_id
    WHERE mi.menu_id = target_menu_id
  )
  WHERE id = target_menu_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;