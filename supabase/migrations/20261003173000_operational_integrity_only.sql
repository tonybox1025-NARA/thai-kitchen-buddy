-- Keep the live dashboard quiet unless staff can act on an operational problem.
-- Accounting mismatches are preserved for the non-blocking close review shown
-- in Reports > Z Report History. Staff-tab credit is a normal workflow, never
-- a customer payment error.

CREATE OR REPLACE FUNCTION public.get_integrity_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'checked_at', now(),
    'open_shifts', (SELECT count(*) FROM shifts WHERE status = 'open'),
    'table_projection_mismatches', (
      SELECT count(*) FROM restaurant_tables t
      LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open'
      WHERE (o.id IS NULL AND t.status <> 'available') OR (o.id IS NOT NULL AND t.status = 'available')),
    'duplicate_open_orders_per_table', (
      SELECT count(*) FROM (SELECT table_id FROM orders WHERE status = 'open' AND table_id IS NOT NULL GROUP BY table_id HAVING count(*) > 1) d),
    'duplicate_bills_per_order', (
      SELECT count(*) FROM (SELECT order_id FROM bills GROUP BY order_id HAVING count(*) > 1) d),
    'open_orders_without_shift', (SELECT count(*) FROM orders WHERE status = 'open' AND shift_id IS NULL),
    'orphan_open_bills_inert', (
      SELECT count(*) FROM bills b JOIN orders o ON o.id = b.order_id
      WHERE b.status = 'open' AND o.status <> 'open' AND b.quarantined_at IS NULL
        AND public.bill_is_financially_inert(b.id)),
    'orphan_open_bills_inert_ids', (
      SELECT coalesce(jsonb_agg(b.id ORDER BY b.created_at), '[]'::jsonb) FROM bills b JOIN orders o ON o.id = b.order_id
      WHERE b.status = 'open' AND o.status <> 'open' AND b.quarantined_at IS NULL
        AND public.bill_is_financially_inert(b.id)),
    'orphan_open_bills_with_money', (
      SELECT count(*) FROM bills b JOIN orders o ON o.id = b.order_id
      WHERE b.status = 'open' AND o.status <> 'open' AND b.quarantined_at IS NULL
        AND NOT public.bill_is_financially_inert(b.id)
        AND NOT (o.source = 'staff_meal' AND EXISTS (
          SELECT 1 FROM staff_tab_charges stc WHERE stc.order_id = o.id AND stc.status <> 'voided'
        ))),
    'orphan_open_bills_quarantined', (SELECT count(*) FROM bills WHERE quarantined_at IS NOT NULL),
    'print_pending', (SELECT count(*) FROM print_jobs WHERE status = 'pending'),
    'print_pending_oldest_seconds', (SELECT extract(epoch FROM now() - min(created_at))::int FROM print_jobs WHERE status = 'pending'),
    'print_pending_max_attempts', (SELECT coalesce(max(attempts), 0) FROM print_jobs WHERE status = 'pending'),
    'print_failed_legacy', (SELECT count(*) FROM print_jobs WHERE status = 'failed'),
    'last_heal_at', (SELECT max(healed_at) FROM integrity_heal_audit)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_operational_integrity_issues()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH duplicate_orders AS (
    SELECT
      'duplicate_open_orders'::text AS kind,
      (array_agg(o.id ORDER BY o.opened_at DESC))[1] AS order_id,
      t.code AS table_code,
      NULL::text AS order_number,
      count(*)::integer AS record_count
    FROM orders o
    JOIN restaurant_tables t ON t.id = o.table_id
    WHERE o.status = 'open'
    GROUP BY o.table_id, t.code
    HAVING count(*) > 1
  ),
  duplicate_bills AS (
    SELECT
      'duplicate_bills'::text AS kind,
      o.id AS order_id,
      t.code AS table_code,
      o.order_number,
      count(b.id)::integer AS record_count
    FROM bills b
    JOIN orders o ON o.id = b.order_id
    LEFT JOIN restaurant_tables t ON t.id = o.table_id
    WHERE o.status = 'open' AND b.quarantined_at IS NULL
    GROUP BY o.id, t.code, o.order_number
    HAVING count(b.id) > 1
  ),
  issues AS (
    SELECT * FROM duplicate_orders
    UNION ALL
    SELECT * FROM duplicate_bills
  )
  SELECT coalesce(jsonb_agg(to_jsonb(issues) ORDER BY table_code NULLS LAST, order_number NULLS LAST), '[]'::jsonb)
  FROM issues;
$$;

REVOKE ALL ON FUNCTION public.get_operational_integrity_issues() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_operational_integrity_issues() TO authenticated;
