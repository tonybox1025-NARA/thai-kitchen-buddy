-- Archive (soft-delete) resigned staff, and stop historical references from
-- blocking staff removal.
--
-- Applied to production (project 36755238-...) on 2026-10-23 via the Lovable
-- connector; this file is committed for parity/history.
--
-- Rationale: deleting a staff row failed on FK constraints like
-- orders_staff_debtor_id_fkey, because past orders/bills/voids reference them.
-- Those records (including cancelled/voided ones) must simply remain as history
-- and must not block anything. So:
--   * resigned staff are deactivated (active=false) and hidden from the staff
--     list, with a separate archived list to view / reactivate / delete them;
--   * every nullable "action-by" FK to staff becomes ON DELETE SET NULL, so a
--     true delete keeps the record and only clears the staff link.
-- Owner / approver FKs that are NOT NULL (staff_tab_charges.staff_id,
-- staff_tab_settlements.staff_id, emergency_menu_price_changes.requested_by /
-- approved_by) intentionally stay RESTRICT — those require a real person, so
-- such staff are archived rather than deleted.

-- Staff list shows only active staff.
create or replace function public.list_staff_profiles()
returns table(id uuid, name text, role app_role, job_position text, active boolean)
language sql stable security definer set search_path to 'public'
as $func$
  select s.id, s.name, s.role, s.position, s.active
  from public.staff s
  where s.active
  order by s.name;
$func$;

-- Inactive (resigned) staff list for the archived section.
create or replace function public.list_archived_staff_profiles()
returns table(id uuid, name text, role app_role, job_position text, active boolean)
language sql stable security definer set search_path to 'public'
as $func$
  select s.id, s.name, s.role, s.position, s.active
  from public.staff s
  where not s.active
  order by s.name;
$func$;

-- Archive / restore a staff. Admin-PIN gated, same as delete_staff.
create or replace function public.set_staff_active(_id uuid, _active boolean, _admin_pin text default null)
returns void language plpgsql security definer set search_path to 'public','extensions'
as $func$
begin
  if auth.uid() is null then raise exception 'Forbidden'; end if;
  if _admin_pin is null or not public.is_admin_pin(_admin_pin) then
    raise exception 'Admin PIN required';
  end if;
  update public.staff set active = _active where id = _id;
end; $func$;

revoke all on function public.list_archived_staff_profiles() from public;
grant execute on function public.list_archived_staff_profiles() to authenticated;
revoke all on function public.set_staff_active(uuid, boolean, text) from public;
grant execute on function public.set_staff_active(uuid, boolean, text) to authenticated;

-- Nullable "action-by" references -> ON DELETE SET NULL (keep the record, clear the staff link).
alter table public.orders drop constraint orders_staff_debtor_id_fkey,
  add constraint orders_staff_debtor_id_fkey foreign key (staff_debtor_id) references public.staff(id) on delete set null;
alter table public.orders drop constraint orders_opened_by_fkey,
  add constraint orders_opened_by_fkey foreign key (opened_by) references public.staff(id) on delete set null;
alter table public.orders drop constraint orders_closed_by_fkey,
  add constraint orders_closed_by_fkey foreign key (closed_by) references public.staff(id) on delete set null;
alter table public.bills drop constraint bills_cashier_id_fkey,
  add constraint bills_cashier_id_fkey foreign key (cashier_id) references public.staff(id) on delete set null;
alter table public.bill_discounts drop constraint bill_discounts_applied_by_fkey,
  add constraint bill_discounts_applied_by_fkey foreign key (applied_by) references public.staff(id) on delete set null;
alter table public.order_item_discounts drop constraint order_item_discounts_applied_by_fkey,
  add constraint order_item_discounts_applied_by_fkey foreign key (applied_by) references public.staff(id) on delete set null;
alter table public.order_items drop constraint order_items_voided_by_fkey,
  add constraint order_items_voided_by_fkey foreign key (voided_by) references public.staff(id) on delete set null;
alter table public.order_table_merges drop constraint order_table_merges_merged_by_fkey,
  add constraint order_table_merges_merged_by_fkey foreign key (merged_by) references public.staff(id) on delete set null;
alter table public.order_table_moves drop constraint order_table_moves_moved_by_fkey,
  add constraint order_table_moves_moved_by_fkey foreign key (moved_by) references public.staff(id) on delete set null;
alter table public.refunds drop constraint refunds_refunded_by_fkey,
  add constraint refunds_refunded_by_fkey foreign key (refunded_by) references public.staff(id) on delete set null;
alter table public.shift_close_review_items drop constraint shift_close_review_items_resolved_by_fkey,
  add constraint shift_close_review_items_resolved_by_fkey foreign key (resolved_by) references public.staff(id) on delete set null;
alter table public.shifts drop constraint shifts_opened_by_fkey,
  add constraint shifts_opened_by_fkey foreign key (opened_by) references public.staff(id) on delete set null;
alter table public.shifts drop constraint shifts_closed_by_fkey,
  add constraint shifts_closed_by_fkey foreign key (closed_by) references public.staff(id) on delete set null;
alter table public.voids drop constraint voids_voided_by_fkey,
  add constraint voids_voided_by_fkey foreign key (voided_by) references public.staff(id) on delete set null;
