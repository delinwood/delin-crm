-- Only the active owner account may delete customers, including via direct API.
begin;

create or replace function public.can_delete_clients()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = auth.uid() and p.active and p.role = 'admin'
      and lower(u.email) = 'delinwood666@gmail.com'
  );
$$;
revoke all on function public.can_delete_clients() from public, anon;
grant execute on function public.can_delete_clients() to authenticated;

create or replace function public.guard_client_delete_owner()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.can_delete_clients() then
    raise exception '仅老板账号可以删除客户' using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke all on function public.guard_client_delete_owner() from public, anon, authenticated;
drop trigger if exists clients_owner_delete_guard on public.clients;
create trigger clients_owner_delete_guard
before delete on public.clients
for each row execute function public.guard_client_delete_owner();

create or replace function public.delete_clients(p_ids uuid[])
returns uuid[]
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  requested uuid[];
  deleted uuid[];
begin
  if not public.can_delete_clients() then
    raise exception '仅老板账号可以删除客户' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 10000
    or array_position(p_ids, null) is not null then
    raise exception '请选择1至10000家客户，且客户ID不能为空';
  end if;
  select array_agg(distinct x) into requested from unnest(p_ids) x;
  with removed as (
    delete from public.clients where id = any(requested) returning id
  ) select coalesce(array_agg(id), '{}'::uuid[]) into deleted from removed;
  if cardinality(deleted) <> cardinality(requested) then
    -- Raising rolls back the entire batch, including existing audit triggers.
    raise exception '部分客户已变化，请刷新后重试';
  end if;
  return deleted;
end;
$$;
revoke all on function public.delete_clients(uuid[]) from public, anon;
grant execute on function public.delete_clients(uuid[]) to authenticated;

commit;
