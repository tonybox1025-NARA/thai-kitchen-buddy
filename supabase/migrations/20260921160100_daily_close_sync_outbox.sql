BEGIN;

CREATE TABLE IF NOT EXISTS public.daily_close_sync_outbox (
  shift_id uuid PRIMARY KEY REFERENCES public.shifts(id) ON DELETE RESTRICT,
  business_day date NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','sending','sent','failed','disabled')),
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  synced_at timestamptz,
  payload_hash text,
  manager_result jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.daily_close_sync_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_close_sync_outbox FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_close_sync_outbox FROM PUBLIC, anon;
GRANT SELECT ON public.daily_close_sync_outbox TO authenticated;
GRANT ALL ON public.daily_close_sync_outbox TO service_role;
CREATE POLICY "Signed-in staff read close sync status"
  ON public.daily_close_sync_outbox FOR SELECT TO authenticated USING (true);

COMMIT;
