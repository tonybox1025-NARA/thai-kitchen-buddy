-- Lock down operational backup tables and the printer queue. These tables may
-- contain menu history, order details, or receipt payloads and must never be
-- readable through the public/anonymous PostgREST role.

DO $$
DECLARE
  backup_table text;
BEGIN
  FOREACH backup_table IN ARRAY ARRAY[
    'catalog_reset_addon_backup',
    'menu_addon_duplicate_backup_20260919',
    'menu_duplicate_backup_20260919'
  ] LOOP
    IF to_regclass('public.' || backup_table) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', backup_table);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', backup_table);
      EXECUTE format(
        'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        backup_table
      );
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', backup_table);
    END IF;
  END LOOP;
END;
$$;

-- POS devices are authenticated and still need to enqueue/read their jobs.
-- The local print bridge uses service_role. Anonymous callers get no table
-- privileges even if an obsolete permissive policy still exists in the DB.
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.print_jobs FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.print_jobs TO authenticated;
GRANT ALL ON TABLE public.print_jobs TO service_role;

DROP POLICY IF EXISTS "auth all print_jobs" ON public.print_jobs;
CREATE POLICY "auth all print_jobs"
  ON public.print_jobs
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
