GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_ingredients TO authenticated;
GRANT ALL ON public.menu_ingredients TO service_role;
ALTER TABLE public.menu_ingredients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all menu_ingredients" ON public.menu_ingredients FOR ALL TO authenticated USING (true) WITH CHECK (true);