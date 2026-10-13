-- Allow active employees to view unassigned clients and enable atomic claiming.

drop policy if exists p_clients_select on public.clients;
create policy p_clients_select
on public.clients
for select
to authenticated
using (
  is_admin()
  or (
    is_active_user()
    and (owner_id is null or owner_id = auth.uid() or created_by = auth.uid())
  )
);

create or replace function public.claim_client(p_client_id uuid)
returns public.clients
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claimed public.clients;
begin
  if not public.is_active_user() then
    raise exception '账号已停用或未登录';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and active and role = 'sales'
  ) then
    raise exception '只有启用的业务员可以从公海领取客户';
  end if;

  update public.clients
  set owner_id = auth.uid(), updated_at = now()
  where id = p_client_id and owner_id is null
  returning * into claimed;

  if not found then
    raise exception '该客户已被领取或不在公海';
  end if;

  return claimed;
end;
$$;

revoke all on function public.claim_client(uuid) from public, anon;
grant execute on function public.claim_client(uuid) to authenticated;
