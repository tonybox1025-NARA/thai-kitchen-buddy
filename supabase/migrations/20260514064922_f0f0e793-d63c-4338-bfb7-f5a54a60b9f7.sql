
-- Make the helper view use caller permissions (fixes security-definer view lint)
alter view public.staff_public set (security_invoker = on);

-- Drop wide-open select policy and replace with a restricted one
drop policy if exists "auth read staff (no hash via direct)" on public.staff;
-- No direct policies on staff; clients read via staff_public (security_invoker view)
-- Grants: revoke direct select to ensure pin_hash never leaks
revoke select on public.staff from anon, authenticated;
grant select on public.staff_public to anon, authenticated;
-- Allow execute on RPCs
grant execute on function public.verify_staff_pin(text) to anon, authenticated;
grant execute on function public.set_staff_pin(uuid, text) to authenticated;
grant execute on function public.create_staff(text, app_role, text) to authenticated;

-- Helper RPC to list staff (id, name, role) safely
create or replace function public.list_staff()
returns table(id uuid, name text, role app_role, active boolean)
language sql stable security definer set search_path = public as $$
  select id, name, role, active from public.staff order by name;
$$;
grant execute on function public.list_staff() to authenticated;

-- Delete staff RPC (admin only; we don't enforce here, app does)
create or replace function public.delete_staff(_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.staff where id = _id;
$$;
grant execute on function public.delete_staff(uuid) to authenticated;
