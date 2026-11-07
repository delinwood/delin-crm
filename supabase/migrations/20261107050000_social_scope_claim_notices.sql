begin;

-- Operations is a separate capability, not a general administrator.
update public.profiles p set role='sales'
from public.crm_social_settings s where s.id and p.id=s.operator_id and p.username<>'boss' and p.role='admin';

create or replace function public.crm_social_is_operator()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.crm_social_settings s join public.profiles p on p.id=s.operator_id
    where s.id and p.id=auth.uid() and p.active and p.username<>'boss');
$$;
revoke all on function public.crm_social_is_operator() from public,anon;
grant execute on function public.crm_social_is_operator() to authenticated,service_role;

create or replace function public.crm_guard_operator_settings()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.operator_id is not null and (new.operator_id=any(new.assignee_ids) or not exists(
    select 1 from public.profiles where id=new.operator_id and active and role='sales' and username<>'boss'
  )) then raise exception '运营必须使用独立的启用业务账号，不能同时作为领取人或管理员'; end if;
  return new;
end $$;
create trigger crm_guard_operator_settings before insert or update on public.crm_social_settings
for each row execute function public.crm_guard_operator_settings();

create policy clients_operator_scope on public.clients as restrictive for all to authenticated
using (not public.crm_social_is_operator()) with check (not public.crm_social_is_operator());

-- This legacy view runs as its owner, so filter the operational role explicitly.
do $view$
declare definition text;
begin
  select rtrim(pg_get_viewdef('public.clients_view'::regclass), E'; \n') into definition;
  execute 'create or replace view public.clients_view as select v.* from (' || definition ||
    ') v where not public.crm_social_is_operator()';
end $view$;

create or replace function public.crm_client_access(p_client uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_active_user() and not public.crm_social_is_operator() and exists(select 1 from public.clients c
    where c.id=public.crm_effective_client(p_client)
      and (public.is_admin() or c.owner_id=auth.uid() or (not p_write and c.owner_id is null)));
$$;

create policy social_operator_channel on public.crm_social_leads as restrictive for select to authenticated
using (not public.crm_social_is_operator() or coalesce(nullif(data->>'lead_channel',''),'social')='social');
create policy social_event_operator_channel on public.crm_social_events as restrictive for select to authenticated
using (not public.crm_social_is_operator() or exists(
  select 1 from public.crm_social_leads l where l.id=lead_id
    and coalesce(nullif(l.data->>'lead_channel',''),'social')='social'
));

create or replace function public.crm_guard_social_operator_channel()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.crm_social_is_operator() then
    if coalesce(nullif(new.data->>'lead_channel',''),'social')<>'social' then
      raise exception '运营只能管理社媒客户' using errcode='42501';
    end if;
    if tg_op='UPDATE' and coalesce(nullif(old.data->>'lead_channel',''),'social')<>'social' then
      raise exception '运营只能管理社媒客户' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
create trigger crm_guard_social_operator_channel before insert or update on public.crm_social_leads
for each row execute function public.crm_guard_social_operator_channel();

create or replace function public.crm_guard_client_distribution()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or public.crm_social_is_boss() then return new; end if;
  if public.crm_social_is_operator() then raise exception '运营只能管理社媒客户' using errcode='42501'; end if;
  if tg_op='INSERT' then
    if new.owner_id is null or new.owner_id=auth.uid() then return new; end if;
  elsif old.owner_id is not distinct from new.owner_id
    or public.crm_pool_transition_allowed(old.id,old.owner_id,new.owner_id) then return new;
  end if;
  raise exception '只有老板可以分配普通客户' using errcode='42501';
end $$;
create trigger crm_guard_client_distribution before insert or update on public.clients
for each row execute function public.crm_guard_client_distribution();

create or replace function public.crm_social_assign(p_id uuid,p_version integer,p_owner uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crm_social_leads; cfg public.crm_social_settings; channel text;
begin
  if not public.is_active_user() then raise exception '请登录启用的账号' using errcode='42501'; end if;
  select * into cfg from public.crm_social_settings where id for share;
  select * into r from public.crm_social_leads where id=p_id for update;
  if not found or r.version<>p_version or r.transferred_at is not null or r.trashed_at is not null then
    raise exception '记录已变化，请刷新';
  end if;
  channel:=coalesce(nullif(r.data->>'lead_channel',''),'social');
  if channel='social' then
    if not public.crm_social_is_operator() then raise exception '社媒客户仅由指定运营分配' using errcode='42501'; end if;
    if p_owner is not null and not coalesce(p_owner=any(cfg.assignee_ids),false) then raise exception '请先由老板设置可分配的业务员'; end if;
  elsif not public.crm_social_is_boss() then
    raise exception '其他公海仅由老板分配' using errcode='42501';
  end if;
  if p_owner is not null and (p_owner is not distinct from cfg.operator_id or not exists(
    select 1 from public.profiles where id=p_owner and active and role='sales'
  )) then raise exception '请选择启用的业务员'; end if;
  update public.crm_social_leads set assignee_id=p_owner,version=version+1,updated_by=auth.uid(),updated_at=now(),
    data=jsonb_set(data,'{progress}',to_jsonb(case when p_owner is null then '未分配' else '待联系' end)) where id=p_id;
  insert into public.crm_social_events(lead_id,actor_id,action,detail)
    values(p_id,auth.uid(),'assign',jsonb_build_object('before',r.assignee_id,'after',p_owner));
end $$;

create table public.crm_daily_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  claim_date date not null,
  claimed integer not null check(claimed between 1 and 30),
  primary key(user_id,claim_date)
);
alter table public.crm_daily_claims enable row level security;
revoke all on public.crm_daily_claims from public,anon,authenticated;
insert into public.crm_daily_claims(user_id,claim_date,claimed)
select actor_id,(now() at time zone 'Asia/Shanghai')::date,least(count(*),30)
from public.crm_pool_events where action='claim' and actor_id is not null
  and at >= (now() at time zone 'Asia/Shanghai')::date::timestamp at time zone 'Asia/Shanghai'
group by actor_id;

create or replace function public.crm_consume_daily_claim()
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role='sales')
     or public.crm_social_is_operator() then raise exception '只有启用的业务员可以自领公海客户' using errcode='42501'; end if;
  insert into public.crm_daily_claims as q(user_id,claim_date,claimed)
  values(auth.uid(),(now() at time zone 'Asia/Shanghai')::date,1)
  on conflict(user_id,claim_date) do update set claimed=q.claimed+1 where q.claimed<30;
  if not found then raise exception '今天已领取30家客户，请明天再领取'; end if;
end $$;
revoke all on function public.crm_consume_daily_claim() from public,anon,authenticated;

-- Reuse the production claim transaction and its existing locking and audit.
do $claim$
declare definition text; patched text;
begin
  select pg_get_functiondef('public.claim_client(uuid)'::regprocedure) into definition;
  patched:=replace(definition,'  select pool_kind into kind', '  if customer.status=' || quote_literal('成交') || ' then raise exception ' || quote_literal('已成交客户不可从公海领取') || '; end if;'
    || chr(10) || '  perform public.crm_consume_daily_claim();' || chr(10) || '  select pool_kind into kind');
  if patched=definition then raise exception '原公海领取函数不匹配，迁移已停止'; end if;
  execute patched;
end $claim$;

create or replace function public.crm_claim_shared_lead(p_id uuid,p_version integer)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crm_social_leads;
begin
  select * into r from public.crm_social_leads where id=p_id for update;
  if not found or r.version<>p_version or r.assignee_id is not null
    or r.transferred_at is not null or r.trashed_at is not null
    or coalesce(r.data->>'precision','')='无效' or coalesce(r.data->>'progress','')='成交'
  then raise exception '客户已被领取或不在可领取范围，请刷新'; end if;
  if coalesce(r.data->>'lead_channel','social') not in ('exhibition','international') then
    raise exception '社媒客户只能由运营分配' using errcode='42501';
  end if;
  perform public.crm_consume_daily_claim();
  update public.crm_social_leads set assignee_id=auth.uid(),version=version+1,
    updated_by=auth.uid(),updated_at=now(),data=jsonb_set(data,'{progress}','"待联系"')
    where id=p_id;
  insert into public.crm_social_events(lead_id,actor_id,action,detail)
    values(p_id,auth.uid(),'claim',jsonb_build_object('after',auth.uid()));
end $$;
revoke all on function public.crm_claim_shared_lead(uuid,integer) from public,anon;
grant execute on function public.crm_claim_shared_lead(uuid,integer) to authenticated;

create or replace function public.crm_daily_claim_remaining()
returns integer language sql stable security definer set search_path=public,pg_temp as $$
  select case when exists(select 1 from public.profiles where id=auth.uid() and active and role='sales')
    and not public.crm_social_is_operator() then 30-coalesce((select claimed from public.crm_daily_claims
      where user_id=auth.uid() and claim_date=(now() at time zone 'Asia/Shanghai')::date),0) else null end;
$$;
revoke all on function public.crm_daily_claim_remaining() from public,anon;
grant execute on function public.crm_daily_claim_remaining() to authenticated;

create table public.crm_social_notices(
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.crm_social_leads(id) on delete set null,
  company_name text not null,
  sender_id uuid references public.profiles(id) on delete set null,
  recipient_id uuid references public.profiles(id) on delete cascade,
  nonce uuid not null,
  body text not null check(length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  remind_at timestamptz not null default now(),
  read_at timestamptz,
  cancelled_at timestamptz,
  unique(sender_id,nonce)
);
create index crm_social_notices_inbox on public.crm_social_notices(recipient_id,remind_at desc);
alter table public.crm_social_notices enable row level security;
revoke all on public.crm_social_notices from public,anon,authenticated;
grant select on public.crm_social_notices to authenticated;
create policy crm_social_notices_read on public.crm_social_notices for select to authenticated using(
  public.is_active_user() and (sender_id=auth.uid() or public.crm_social_is_boss()
    or (recipient_id=auth.uid() and cancelled_at is null and remind_at<=now()))
);

create or replace function public.crm_social_send_notice(p_lead uuid,p_version integer,p_body text,p_remind_at timestamptz,p_nonce uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crm_social_leads; note text:=btrim(coalesce(p_body,'')); sent uuid;
begin
  if not public.crm_social_is_operator() then raise exception '仅指定运营可以发送社媒提醒' using errcode='42501'; end if;
  if length(note) not between 1 and 2000 or p_nonce is null then raise exception '请填写1至2000字的跟进备注'; end if;
  select id into sent from public.crm_social_notices where sender_id=auth.uid() and nonce=p_nonce;
  if found then return sent; end if;
  select * into r from public.crm_social_leads where id=p_lead for update;
  if not found or r.version<>p_version or coalesce(nullif(r.data->>'lead_channel',''),'social')<>'social'
    or r.transferred_at is not null or r.trashed_at is not null
    or not exists(select 1 from public.profiles where id=r.assignee_id and role='sales' and active)
  then raise exception '请刷新并确认这是已分配的社媒客户'; end if;
  insert into public.crm_social_notices(lead_id,company_name,sender_id,recipient_id,nonce,body,remind_at)
  values(r.id,r.data->>'company_name',auth.uid(),r.assignee_id,p_nonce,note,greatest(coalesce(p_remind_at,now()),now()))
  on conflict(sender_id,nonce) do nothing returning id into sent;
  if sent is null then select id into sent from public.crm_social_notices where sender_id=auth.uid() and nonce=p_nonce; end if;
  return sent;
end $$;
revoke all on function public.crm_social_send_notice(uuid,integer,text,timestamptz,uuid) from public,anon;
grant execute on function public.crm_social_send_notice(uuid,integer,text,timestamptz,uuid) to authenticated;

create or replace function public.crm_social_ack_notice(p_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_active_user() then raise exception '请登录启用的账号' using errcode='42501'; end if;
  update public.crm_social_notices set read_at=coalesce(read_at,now())
  where id=p_id and recipient_id=auth.uid() and cancelled_at is null and remind_at<=now();
  if not found then raise exception '提醒不可确认' using errcode='42501'; end if;
end $$;
revoke all on function public.crm_social_ack_notice(uuid) from public,anon;
grant execute on function public.crm_social_ack_notice(uuid) to authenticated;

create or replace function public.crm_social_cancel_future_notices()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.crm_social_notices set cancelled_at=now()
  where lead_id=new.id and cancelled_at is null and remind_at>now()
    and (recipient_id is distinct from new.assignee_id or new.transferred_at is not null or new.trashed_at is not null);
  return new;
end $$;
create trigger crm_social_cancel_future_notices after update of assignee_id,transferred_at,trashed_at
on public.crm_social_leads for each row execute function public.crm_social_cancel_future_notices();

notify pgrst, 'reload schema';
commit;
