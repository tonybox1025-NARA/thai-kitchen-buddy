-- Staff tabs: record employee consumption now, collect payment later, and keep
-- both events out of ordinary customer sales. Sent order items remain available
-- to inventory/item-sales reporting so stock is reduced on the consumption day.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS staff_debtor_id uuid REFERENCES public.staff(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.staff_tab_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE RESTRICT,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','voided')),
  charged_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  charged_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.staff_tab_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL REFERENCES public.shifts(id) ON DELETE RESTRICT,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL CHECK (method IN ('cash','qr')),
  received_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_tab_settlement_items (
  settlement_id uuid NOT NULL REFERENCES public.staff_tab_settlements(id) ON DELETE RESTRICT,
  charge_id uuid NOT NULL UNIQUE REFERENCES public.staff_tab_charges(id) ON DELETE RESTRICT,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (settlement_id, charge_id)
);

CREATE INDEX IF NOT EXISTS staff_tab_charges_staff_status_idx
  ON public.staff_tab_charges(staff_id, status, charged_at);
CREATE INDEX IF NOT EXISTS staff_tab_settlements_shift_idx
  ON public.staff_tab_settlements(shift_id, created_at);

ALTER TABLE public.staff_tab_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_tab_charges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.staff_tab_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_tab_settlements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.staff_tab_settlement_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_tab_settlement_items FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.staff_tab_charges, public.staff_tab_settlements,
  public.staff_tab_settlement_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.staff_tab_charges, public.staff_tab_settlements,
  public.staff_tab_settlement_items TO service_role;

CREATE OR REPLACE FUNCTION public.start_staff_tab_order(
  p_staff_id uuid,
  p_pin text,
  p_opened_by uuid
)
RETURNS TABLE(order_id uuid, order_number text, staff_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  approver public.staff%ROWTYPE;
  debtor public.staff%ROWTYPE;
  open_shift uuid;
  next_number integer;
  created_order uuid;
  created_number text;
BEGIN
  SELECT * INTO approver
  FROM public.staff
  WHERE active AND pin_hash = crypt(p_pin, pin_hash)
  LIMIT 1;
  IF approver.id IS NULL THEN RAISE EXCEPTION 'Invalid PIN'; END IF;
  IF approver.id <> p_staff_id AND approver.role NOT IN ('admin','manager') THEN
    RAISE EXCEPTION 'Use the selected employee PIN or a manager PIN';
  END IF;

  SELECT * INTO debtor FROM public.staff WHERE id = p_staff_id AND active;
  IF debtor.id IS NULL THEN RAISE EXCEPTION 'Employee is not active'; END IF;
  SELECT id INTO open_shift FROM public.shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF open_shift IS NULL THEN RAISE EXCEPTION 'Open the register first'; END IF;

  SELECT count(*) + 1 INTO next_number FROM public.orders WHERE source = 'staff_meal';
  created_number := 'ST-' || lpad(next_number::text, 3, '0');
  INSERT INTO public.orders(shift_id, source, order_number, opened_by, staff_debtor_id)
  VALUES (open_shift, 'staff_meal', created_number, p_opened_by, p_staff_id)
  RETURNING id INTO created_order;

  RETURN QUERY SELECT created_order, created_number, debtor.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_staff_tab_charge(
  p_order_id uuid,
  p_charged_by uuid
)
RETURNS TABLE(charge_id uuid, amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ord public.orders%ROWTYPE;
  total numeric(10,2);
  created_charge uuid;
BEGIN
  SELECT * INTO ord FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF ord.id IS NULL OR ord.source <> 'staff_meal' OR ord.staff_debtor_id IS NULL THEN
    RAISE EXCEPTION 'This is not a named staff order';
  END IF;
  IF ord.status <> 'open' THEN RAISE EXCEPTION 'Staff order is already closed'; END IF;
  IF EXISTS (SELECT 1 FROM public.order_items WHERE order_id = p_order_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Send all items before recording the staff tab';
  END IF;
  SELECT coalesce(sum(qty * unit_price), 0) INTO total
  FROM public.order_items WHERE order_id = p_order_id AND status <> 'voided';
  IF total <= 0 THEN RAISE EXCEPTION 'Staff order is empty'; END IF;

  INSERT INTO public.staff_tab_charges(order_id, staff_id, shift_id, amount, charged_by)
  VALUES (ord.id, ord.staff_debtor_id, ord.shift_id, total, p_charged_by)
  RETURNING id INTO created_charge;
  UPDATE public.orders SET status = 'closed', closed_at = now() WHERE id = ord.id;
  RETURN QUERY SELECT created_charge, total;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_tab_summary()
RETURNS TABLE(staff_id uuid, staff_name text, unpaid_count bigint, outstanding numeric, oldest_charge timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name, count(c.id), coalesce(sum(c.amount), 0)::numeric,
         min(c.charged_at)
  FROM public.staff s
  JOIN public.staff_tab_charges c ON c.staff_id = s.id AND c.status = 'unpaid'
  GROUP BY s.id, s.name
  ORDER BY min(c.charged_at), s.name;
$$;

CREATE OR REPLACE FUNCTION public.settle_staff_tab(
  p_staff_id uuid,
  p_method text,
  p_pin text,
  p_received_by uuid
)
RETURNS TABLE(settlement_id uuid, amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  approver public.staff%ROWTYPE;
  open_shift uuid;
  total numeric(10,2);
  created_settlement uuid;
BEGIN
  IF p_method NOT IN ('cash','qr') THEN RAISE EXCEPTION 'Payment method must be cash or QR'; END IF;
  SELECT * INTO approver FROM public.staff
  WHERE active AND pin_hash = crypt(p_pin, pin_hash) LIMIT 1;
  IF approver.id IS NULL THEN RAISE EXCEPTION 'Invalid PIN'; END IF;
  IF approver.id <> p_staff_id AND approver.role NOT IN ('admin','manager') THEN
    RAISE EXCEPTION 'Use the employee PIN or a manager PIN';
  END IF;
  SELECT id INTO open_shift FROM public.shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF open_shift IS NULL THEN RAISE EXCEPTION 'Open the register first'; END IF;

  PERFORM id FROM public.staff_tab_charges
  WHERE staff_id = p_staff_id AND status = 'unpaid' FOR UPDATE;
  SELECT coalesce(sum(amount), 0) INTO total
  FROM public.staff_tab_charges WHERE staff_id = p_staff_id AND status = 'unpaid';
  IF total <= 0 THEN RAISE EXCEPTION 'No outstanding staff tab'; END IF;

  INSERT INTO public.staff_tab_settlements(staff_id, shift_id, amount, method, received_by)
  VALUES (p_staff_id, open_shift, total, p_method, p_received_by)
  RETURNING id INTO created_settlement;
  INSERT INTO public.staff_tab_settlement_items(settlement_id, charge_id, amount)
  SELECT created_settlement, id, amount FROM public.staff_tab_charges
  WHERE staff_id = p_staff_id AND status = 'unpaid';
  UPDATE public.staff_tab_charges SET status = 'paid', settled_at = now()
  WHERE staff_id = p_staff_id AND status = 'unpaid';
  RETURN QUERY SELECT created_settlement, total;
END;
$$;

REVOKE ALL ON FUNCTION public.start_staff_tab_order(uuid,text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_staff_tab_charge(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_tab_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_staff_tab(uuid,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_staff_tab_order(uuid,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_staff_tab_charge(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_tab_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_staff_tab(uuid,text,text,uuid) TO authenticated;
