-- The original combine function used a CASE expression whose string branches
-- were inferred as text. restaurant_tables.status is the table_status enum, so
-- PostgreSQL rejected the assignment at runtime. Patch the installed function
-- in place while preserving its security and grant configuration.
DO $migration$
DECLARE
  v_definition text;
  v_original text := 'SET status = CASE WHEN v_target_table.status = ''bill_requested'' THEN ''bill_requested'' ELSE ''occupied'' END,';
  v_fixed text := 'SET status = CASE WHEN v_target_table.status = ''bill_requested'' THEN ''bill_requested''::public.table_status ELSE ''occupied''::public.table_status END,';
BEGIN
  SELECT pg_get_functiondef('public.combine_open_table_orders(uuid,uuid,uuid)'::regprocedure)
    INTO v_definition;

  IF position(v_original IN v_definition) = 0 THEN
    IF position('''bill_requested''::public.table_status' IN v_definition) > 0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'combine_open_table_orders has an unexpected definition; refusing an unsafe rewrite';
  END IF;

  EXECUTE replace(v_definition, v_original, v_fixed);
END;
$migration$;

REVOKE ALL ON FUNCTION public.combine_open_table_orders(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.combine_open_table_orders(uuid, uuid, uuid) TO authenticated, service_role;
