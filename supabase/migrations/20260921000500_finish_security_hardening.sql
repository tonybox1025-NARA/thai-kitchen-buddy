-- Clear the remaining security-advisor findings after the main backup/queue
-- lockdown. Public customer routes read settings through server-side APIs, so
-- the anon database role does not need direct table access.

DO $$
BEGIN
  IF to_regclass('public.menu_duplicate_cleanup_map_20260919') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.menu_duplicate_cleanup_map_20260919 ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE public.menu_duplicate_cleanup_map_20260919 FORCE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.menu_duplicate_cleanup_map_20260919 FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.menu_duplicate_cleanup_map_20260919 TO service_role';
  END IF;
END;
$$;

-- Remove obsolete policy objects as well as their underlying privileges. The
-- authenticated POS policy created by the previous migration remains active.
DROP POLICY IF EXISTS "anon bridge select" ON public.print_jobs;
DROP POLICY IF EXISTS "anon bridge update" ON public.print_jobs;
DROP POLICY IF EXISTS "anon select print_jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "anon update print_jobs" ON public.print_jobs;
DROP POLICY IF EXISTS "anon insert print_jobs" ON public.print_jobs;
REVOKE ALL ON TABLE public.print_jobs FROM PUBLIC, anon;

-- RLS policies filter rows, not columns. Even though the old migration used a
-- column-level grant, removing direct anon table access is clearer and avoids
-- accidental exposure when settings columns change later.
DROP POLICY IF EXISTS "anon select settings safe columns" ON public.settings;
DROP POLICY IF EXISTS "anon select settings" ON public.settings;
DROP POLICY IF EXISTS "anon update settings" ON public.settings;
REVOKE ALL ON TABLE public.settings FROM PUBLIC, anon;

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.settings TO authenticated;
GRANT ALL ON TABLE public.settings TO service_role;
