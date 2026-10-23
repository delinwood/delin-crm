begin;
create table if not exists public.crm_pool_metadata (
  client_id uuid primary key references public.clients(id) on delete cascade,
  pool_kind text not null default 'initial' check (pool_kind in ('initial','secondary')),
  return_reason text not null default '',
  previous_owner uuid references public.profiles(id) on delete set null,
  returned_at timestamptz
);
create table if not exists public.crm_pool_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  company_name text not null,
  action text not null check (action in ('claim','release')),
  actor_id uuid references public.profiles(id) on delete set null,
  previous_owner uuid references public.profiles(id) on delete set null,
  new_owner uuid references public.profiles(id) on delete set null,
  pool_kind text not null,
  reason text not null default '',
  at timestamptz not null default now()
);
create index if not exists crm_pool_events_client_at on public.crm_pool_events(client_id,at desc);
-- Private transaction-scoped capabilities: employees cannot write these rows.
create table if not exists public.crm_pool_transitions (
  client_id uuid not null,
  transaction_id bigint not null,
  actor_id uuid not null,
  previous_owner uuid,
  new_owner uuid,
  primary key(client_id,transaction_id)
);
alter table public.crm_pool_metadata enable row level security;
alter table public.crm_pool_events enable row level security;
alter table public.crm_pool_transitions enable row level security;
revoke all on public.crm_pool_metadata, public.crm_pool_events, public.crm_pool_transitions from public,anon,authenticated;
grant select on public.crm_pool_metadata, public.crm_pool_events to authenticated;
drop policy if exists pool_metadata_read on public.crm_pool_metadata;
create policy pool_metadata_read on public.crm_pool_metadata for select to authenticated using (
  public.is_active_user() and exists(select 1 from public.clients c where c.id=client_id)
);
drop policy if exists pool_events_read on public.crm_pool_events;
create policy pool_events_read on public.crm_pool_events for select to authenticated using (
  public.is_active_user() and (public.is_admin() or exists(select 1 from public.clients c where c.id=client_id))
);
create or replace function public.crm_pool_transition_allowed(p_client uuid,p_old uuid,p_new uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_active_user() and exists (
    select 1 from public.crm_pool_transitions t where t.client_id=p_client
      and t.transaction_id=txid_current() and t.actor_id=auth.uid()
      and t.previous_owner is not distinct from p_old and t.new_owner is not distinct from p_new
  );
$$;
revoke all on function public.crm_pool_transition_allowed(uuid,uuid,uuid) from public,anon,authenticated;
-- Keep every existing client guard. Only authenticated pool RPC transactions
-- receive the capability needed to pass the owner-change guard.
do $$
declare original text; patched text;
begin
  select pg_get_functiondef('public.clients_guard()'::regprocedure) into original;
  if position('crm_pool_transition_allowed' in original)=0 then
    patched:=replace(original,
      'if new.owner_id is distinct from old.owner_id then',
      'if new.owner_id is distinct from old.owner_id and not public.crm_pool_transition_allowed(old.id,old.owner_id,new.owner_id) then');
    if patched=original then raise exception 'Cannot identify existing client owner guard; migration stopped'; end if;
    execute patched;
  end if;
end;
$$;
-- Ensure the database visibility rule also includes unassigned leads.
drop policy if exists p_clients_select on public.clients;
create policy p_clients_select on public.clients for select to authenticated using (
  public.is_active_user() and (public.is_admin() or owner_id is null or owner_id=auth.uid())
);
-- A former creator cannot keep editing a lead after another employee claims it.
do $$
declare item record;
begin
  for item in select policyname from pg_policies where schemaname='public' and tablename='clients' and cmd='UPDATE' loop
    execute format('alter policy %I on public.clients using (public.is_active_user() and (public.is_admin() or owner_id=auth.uid())) with check (public.is_active_user() and (public.is_admin() or owner_id=auth.uid()))',item.policyname);
  end loop;
end;
$$;
-- Flags must be visible for unassigned leads, so invalid leads stay out of both pools.
drop policy if exists tracking_read on public.client_tracking;
create policy tracking_read on public.client_tracking for select to authenticated using (
  public.is_active_user() and (public.is_admin() or exists (
    select 1 from public.clients c where c.id=client_id and (c.owner_id is null or c.owner_id=auth.uid())
  ))
);
create or replace function public.claim_client(p_client_id uuid)
returns public.clients language plpgsql security definer set search_path=public,pg_temp as $$
declare customer public.clients; kind text;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role='sales') then
    raise exception '只有启用的业务员可以领取客户' using errcode='42501';
  end if;
  select * into customer from public.clients where id=p_client_id for update;
  if not found or customer.owner_id is not null then raise exception '客户已被领取，请刷新公海'; end if;
  if customer.status='无效' or exists(select 1 from public.client_tracking where client_id=p_client_id and attention_level='无效') then
    raise exception '无效客户不可领取，请联系老板审查';
  end if;
  select pool_kind into kind from public.crm_pool_metadata where client_id=p_client_id;
  kind:=coalesce(kind,'initial');
  insert into public.crm_pool_transitions values(p_client_id,txid_current(),auth.uid(),null,auth.uid());
  update public.clients set owner_id=auth.uid(),updated_at=now() where id=p_client_id returning * into customer;
  delete from public.crm_pool_transitions where client_id=p_client_id and transaction_id=txid_current();
  insert into public.crm_pool_events(client_id,company_name,action,actor_id,new_owner,pool_kind)
    values(p_client_id,customer.company_name,'claim',auth.uid(),auth.uid(),kind);
  return customer;
end;
$$;
revoke all on function public.claim_client(uuid) from public,anon;
grant execute on function public.claim_client(uuid) to authenticated;
create or replace function public.release_client(p_client_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare customer public.clients;
begin
  if not public.is_active_user() then raise exception '账号已停用或未登录' using errcode='42501'; end if;
  if length(trim(coalesce(p_reason,'')))<2 or length(p_reason)>2000 then raise exception '请填写2至2000字的退回原因'; end if;
  -- Consistent lock order with the mail completion/state functions.
  perform id from public.mail_plans where client_id=p_client_id order by id for update;
  select * into customer from public.clients where id=p_client_id for update;
  if not found or customer.owner_id is null or not (public.is_admin() or customer.owner_id=auth.uid()) then
    raise exception '只能退回自己负责的客户' using errcode='42501';
  end if;
  if customer.status='无效' or exists(select 1 from public.client_tracking where client_id=p_client_id and attention_level='无效') then
    raise exception '无效客户请保留在无效客户组，由老板审查';
  end if;
  update public.mail_plans set status='stopped',last_error='客户已退回第二公海，原计划停止'
    where client_id=p_client_id and status in ('running','paused');
  update public.mail_messages set status='cancelled',error='客户已退回第二公海' where client_id=p_client_id and status='queued';
  insert into public.crm_pool_metadata(client_id,pool_kind,return_reason,previous_owner,returned_at)
    values(p_client_id,'secondary',trim(p_reason),customer.owner_id,now())
    on conflict(client_id) do update set pool_kind='secondary',return_reason=excluded.return_reason,
      previous_owner=excluded.previous_owner,returned_at=excluded.returned_at;
  insert into public.crm_pool_transitions values(p_client_id,txid_current(),auth.uid(),customer.owner_id,null);
  update public.clients set owner_id=null,next_follow_up=null,updated_at=now() where id=p_client_id;
  delete from public.crm_pool_transitions where client_id=p_client_id and transaction_id=txid_current();
  insert into public.crm_pool_events(client_id,company_name,action,actor_id,previous_owner,pool_kind,reason)
    values(p_client_id,customer.company_name,'release',auth.uid(),customer.owner_id,'secondary',trim(p_reason));
end;
$$;
revoke all on function public.release_client(uuid,text) from public,anon;
grant execute on function public.release_client(uuid,text) to authenticated;
commit;
