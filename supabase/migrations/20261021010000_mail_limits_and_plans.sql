begin;
-- Zero means no CRM daily ceiling; Google limits and mailbox pacing still apply.
alter table public.mail_accounts drop constraint if exists mail_accounts_daily_limit_check;
alter table public.mail_accounts add constraint mail_accounts_daily_limit_check check(daily_limit>=0);
alter table public.mail_accounts add column quota_wait boolean not null default false;
create table public.mail_sender_settings (
  user_id uuid primary key references public.profiles(id),
  daily_limit integer not null default 50 check(daily_limit>=0),
  updated_at timestamptz not null default now()
);
insert into public.mail_sender_settings(user_id,daily_limit) select user_id,daily_limit from public.mail_accounts;
alter table public.mail_sender_settings enable row level security;
revoke all on public.mail_sender_settings from public,anon,authenticated;
grant all on public.mail_sender_settings to service_role;

create function public.mail_set_limit(p_actor uuid,p_user uuid,p_limit integer) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.mail_accounts;
begin
  if not exists(select 1 from public.profiles where id=p_actor and active and role='admin') then raise exception '仅老板可设置发信限额'; end if;
  if p_limit is null or p_limit<0 then raise exception '限额须为正整数，0表示不设系统每日上限'; end if;
  if not exists(select 1 from public.profiles where id=p_user and active) then raise exception '账号不存在或已停用'; end if;
  select * into a from public.mail_accounts where user_id=p_user for update;
  insert into public.mail_sender_settings(user_id,daily_limit) values(p_user,p_limit)
    on conflict(user_id) do update set daily_limit=excluded.daily_limit,updated_at=now();
  update public.mail_accounts set daily_limit=p_limit,updated_at=now(),
    next_send_at=case when quota_wait then greatest(now(),coalesce((select max(attempted_at)+interval '60 seconds' from public.mail_messages where sender_id=p_user),now())) else next_send_at end,
    quota_wait=false where user_id=p_user;
  return p_limit;
end $$;

create table public.mail_plans (
  id uuid primary key default gen_random_uuid(), batch_id uuid not null,
  name text not null, sender_id uuid not null references public.profiles(id),
  client_id uuid references public.clients(id) on delete set null,
  recipient text not null, company_name text not null, snapshot jsonb not null,
  drafts jsonb not null check(jsonb_array_length(drafts) between 1 and 3),
  next_run_at timestamptz not null, interval_days integer check(interval_days in(3,7)),
  max_sends integer not null default 3 check(max_sends between 0 and 100),
  sent_count integer not null default 0,
  status text not null default 'running' check(status in('running','paused','stopped','completed')),
  last_message_id uuid references public.mail_messages(id),
  lease_until timestamptz not null default now(), last_error text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(batch_id,client_id)
);
create unique index mail_plan_active_email on public.mail_plans(recipient) where status in('running','paused');
create index mail_plan_due on public.mail_plans(next_run_at) where status='running';
alter table public.mail_plans enable row level security;
revoke all on public.mail_plans from public,anon,authenticated;
grant select on public.mail_plans to authenticated;
grant all on public.mail_plans to service_role;
create policy mail_plan_read on public.mail_plans for select to authenticated using(public.is_active_user() and(sender_id=auth.uid() or public.is_admin()));

create function public.mail_client_snapshot(p_client public.clients) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
 select jsonb_build_object('company_name',coalesce((p_client).company_name,''),'contact_name',coalesce((p_client).contact_name,''),
 'country',coalesce((p_client).country,''),'city',coalesce((p_client).city,''),'customer_type',coalesce((p_client).customer_type,''),
 'products',coalesce(nullif(to_jsonb(p_client)->'products','null'::jsonb),'[]'::jsonb),'company_email',coalesce((p_client).company_email,''));
$$;

create function public.mail_plans_create(p_sender uuid,p_batch uuid,p_name text,p_start timestamptz,p_interval integer,p_max integer,p_targets jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare t jsonb; d jsonb; c public.clients; n integer;
begin
  perform 1 from public.mail_accounts where user_id=p_sender and connected for update;
  if not found then raise exception '请先连接 Gmail'; end if;
  if not exists(select 1 from public.profiles where id=p_sender and active) then raise exception '账号不可用'; end if;
  select count(*) into n from public.mail_plans where batch_id=p_batch and sender_id=p_sender;
  if n>0 then return n; end if;
  n:=jsonb_array_length(p_targets);
  if n<1 or n>400 or p_start<now()-interval '1 minute' or p_start>now()+interval '367 days' then raise exception '客户数量或首次时间不正确'; end if;
  if p_start is null or p_max is null or p_max<0 or p_max>100 or (p_interval is not null and p_interval not in(3,7)) or(p_interval is null and p_max<>1) then raise exception '重复计划参数不正确'; end if;
  perform pg_advisory_xact_lock(hashtextextended(value->>'recipient',0)) from jsonb_array_elements(p_targets) order by value->>'recipient';
  for t in select value from jsonb_array_elements(p_targets) loop
    select * into c from public.clients where id=(t->>'client_id')::uuid for share;
    if not found or not(coalesce(c.owner_id=p_sender,false) or exists(select 1 from public.profiles where id=p_sender and active and role='admin')) then raise exception '客户归属已变化，请重新预览'; end if;
    if c.status in('无效','已回复','成交') or exists(select 1 from public.client_tracking where client_id=c.id and attention_level='无效') then raise exception '客户无效、已回复或已成交'; end if;
    if lower(trim(c.company_email)) is distinct from t->>'recipient' or public.mail_client_snapshot(c) is distinct from t->'snapshot' then raise exception '客户资料已变化，请重新预览'; end if;
    if exists(select 1 from public.mail_suppressions where email=t->>'recipient') then raise exception '客户已退订或退信'; end if;
    if exists(select 1 from public.mail_plans where recipient=t->>'recipient' and status in('running','paused')) then raise exception '客户已有定时计划，请先停止原计划'; end if;
    if jsonb_array_length(t->'drafts') not between 1 and 3 then raise exception '邮件内容不完整'; end if;
    for d in select value from jsonb_array_elements(t->'drafts') loop
      if length(d->>'subject') not between 1 and 250 or length(d->>'body') not between 1 and 30000 or (d->>'subject')~E'[\r\n]' then raise exception '邮件内容不正确'; end if;
    end loop;
    insert into public.mail_plans(batch_id,name,sender_id,client_id,recipient,company_name,snapshot,drafts,next_run_at,interval_days,max_sends)
    values(p_batch,left(p_name,120),p_sender,c.id,t->>'recipient',c.company_name,t->'snapshot',t->'drafts',p_start,p_interval,p_max);
  end loop;
  return n;
end $$;

create function public.mail_plans_claim() returns setof public.mail_plans
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.mail_plans;
begin
  -- Failed/uncertain sends never trigger an automatic next round.
  update public.mail_plans p0 set status='paused',last_error='上封发送失败或状态待核实，请人工检查后处理',updated_at=now()
  where p0.status='running' and exists(select 1 from public.mail_messages m where m.id=p0.last_message_id and m.status in('failed','unknown','bounced','skipped','cancelled'));
  for p in select p0.* from public.mail_plans p0 join public.mail_accounts a on a.user_id=p0.sender_id
    where p0.status='running' and a.connected and p0.next_run_at<=now() and p0.lease_until<=now()
    and exists(select 1 from public.profiles where id=p0.sender_id and active)
    and not exists(select 1 from public.mail_messages m where m.id=p0.last_message_id and m.status in('queued','sending'))
    order by p0.next_run_at,p0.id for update of p0 skip locked limit 10 loop
    update public.mail_plans set lease_until=now()+interval '3 minutes' where id=p.id;
    return next p;
  end loop;
end $$;

create function public.mail_plan_enqueue(p_plan uuid,p_message jsonb) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.mail_plans; c public.clients; last_m public.mail_messages; draft jsonb; mid uuid;
begin
  select * into p from public.mail_plans where id=p_plan for update;
  if not found or p.status<>'running' or p.next_run_at>now() then return false; end if;
  perform 1 from public.mail_accounts where user_id=p.sender_id and connected for update;
  if not found or not exists(select 1 from public.profiles where id=p.sender_id and active) then return false; end if;
  if p.last_message_id is not null then
    select * into last_m from public.mail_messages where id=p.last_message_id;
    if last_m.status<>'sent' then return false; end if;
  end if;
  if p.max_sends>0 and p.sent_count>=p.max_sends then update public.mail_plans set status='completed' where id=p.id; return false; end if;
  select * into c from public.clients where id=p.client_id for share;
  if not found or c.status in('无效','已回复','成交') or exists(select 1 from public.client_tracking where client_id=c.id and attention_level='无效')
    or not(coalesce(c.owner_id=p.sender_id,false) or exists(select 1 from public.profiles where id=p.sender_id and active and role='admin'))
    or exists(select 1 from public.mail_suppressions where email=p.recipient) then
    update public.mail_plans set status='stopped',last_error='客户删除、无效、退订、退信或归属变化',updated_at=now() where id=p.id; return false;
  end if;
  if public.mail_client_snapshot(c) is distinct from p.snapshot then
    update public.mail_plans set status='paused',last_error='客户公司、联系人或产品资料已变化，请停止本计划并重新预览创建',updated_at=now() where id=p.id; return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p.recipient,0));
  if exists(select 1 from public.mail_messages where recipient=p.recipient and(status in('queued','sending') or(status in('sent','unknown','bounced') and coalesce(attempted_at,created_at)>now()-interval '24 hours'))) then
    update public.mail_plans set next_run_at=now()+interval '1 hour',lease_until=now(),last_error='客户已有排队或24小时内的发信记录，延后检查' where id=p.id; return false;
  end if;
  draft:=p.drafts->case when jsonb_array_length(p.drafts)=1 then 0 when p.sent_count=0 then 0 else 1+((p.sent_count-1)%(jsonb_array_length(p.drafts)-1)) end;
  mid:=(p_message->>'id')::uuid;
  perform public.mail_enqueue(p.sender_id,mid,p.name||' · 第'||(p.sent_count+1)||'轮',jsonb_build_array(jsonb_build_object(
    'id',mid,'client_id',p.client_id,'recipient',p.recipient,'subject',draft->>'subject','body',draft->>'body','unsubscribe_hash',p_message->>'unsubscribe_hash')));
  update public.mail_plans set last_message_id=mid,lease_until=now(),last_error=null,updated_at=now() where id=p.id;
  return true;
end $$;

create function public.mail_plan_state(p_actor uuid,p_id uuid,p_state text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.mail_plans;
begin
  select * into p from public.mail_plans where id=p_id for update;
  if not found or not exists(select 1 from public.profiles where id=p_actor and active and(id=p.sender_id or role='admin')) then raise exception '无权操作计划'; end if;
  if p_state not in('running','paused','stopped') or p.status in('stopped','completed') then raise exception '计划已结束或状态不正确'; end if;
  if p_state='running' and exists(select 1 from public.mail_messages where id=p.last_message_id and status in('failed','unknown','bounced','skipped','cancelled')) then raise exception '请先核实上封邮件；如需重新发送，请停止此计划并重新创建'; end if;
  update public.mail_plans set status=p_state,updated_at=now() where id=p_id;
  if p.last_message_id is not null then
    if p_state='stopped' then
      update public.mail_messages set status='cancelled',error='自动计划已停止' where id=p.last_message_id and status='queued';
      update public.mail_campaigns set status='cancelled' where id=(select campaign_id from public.mail_messages where id=p.last_message_id) and status in('running','paused');
    elsif p_state='paused' then update public.mail_campaigns set status='paused' where id=(select campaign_id from public.mail_messages where id=p.last_message_id) and status='running';
    else update public.mail_campaigns set status='running' where id=(select campaign_id from public.mail_messages where id=p.last_message_id) and status='paused'; end if;
  end if;
end $$;

create or replace function public.mail_finish(p_id uuid,p_provider text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.mail_messages;
begin
  perform 1 from public.mail_plans where last_message_id=p_id for update;
  select * into m from public.mail_messages where id=p_id for update;
  if not found or m.status<>'sending' then return; end if;
  update public.mail_messages set status='sent',provider_id=p_provider,sent_at=now(),error=null where id=p_id;
  update public.client_tracking set email_anchor_at=now() where client_id=m.client_id and reminder_owner_id=m.sender_id;
  update public.mail_plans set sent_count=sent_count+1,
    next_run_at=now()+make_interval(days=>coalesce(interval_days,0)),
    status=case when interval_days is null or(max_sends>0 and sent_count+1>=max_sends) then 'completed' else status end,
    updated_at=now() where last_message_id=p_id;
end $$;

-- Existing campaigns and queues continue unchanged; quota zero is unlimited in CRM only.
create or replace function public.mail_claim() returns setof public.mail_messages
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.mail_accounts; m public.mail_messages; used integer;
begin
  update public.mail_messages set status='unknown',error='发送状态待核实；请检查发件箱，系统不自动重试' where status='sending' and attempted_at<now()-interval '10 minutes';
  update public.mail_campaigns k set status='completed' where status='running' and not exists(select 1 from public.mail_messages where campaign_id=k.id and status in('queued','sending'));
  for a in select a0.* from public.mail_accounts a0 where connected and next_send_at<=now()
    and exists(select 1 from public.profiles where id=a0.user_id and active)
    and exists(select 1 from public.mail_messages q join public.mail_campaigns k on k.id=q.campaign_id where q.sender_id=a0.user_id and q.status='queued' and k.status='running')
    order by next_send_at for update of a0 skip locked limit 3 loop
    select count(*) into used from public.mail_messages where sender_id=a.user_id and attempted_at>now()-interval '24 hours';
    if a.daily_limit>0 and used>=a.daily_limit then
      update public.mail_accounts set quota_wait=true,next_send_at=(select min(attempted_at)+interval '24 hours 1 second' from public.mail_messages where sender_id=a.user_id and attempted_at>now()-interval '24 hours') where user_id=a.user_id;
      continue;
    end if;
    select q.* into m from public.mail_messages q join public.mail_campaigns k on k.id=q.campaign_id where q.sender_id=a.user_id and q.status='queued' and k.status='running' order by q.created_at,q.id for update of q skip locked limit 1;
    if not found then continue; end if;
    if exists(select 1 from public.mail_suppressions where email=m.recipient) or not exists(select 1 from public.clients c where c.id=m.client_id and c.status<>'无效' and lower(trim(c.company_email))=m.recipient
      and(c.owner_id=a.user_id or exists(select 1 from public.profiles where id=a.user_id and active and role='admin')) and not exists(select 1 from public.client_tracking where client_id=c.id and attention_level='无效'))
      or exists(select 1 from public.mail_plans p where p.last_message_id=m.id and(p.status<>'running' or (select status from public.clients where id=m.client_id) in('已回复','成交') or public.mail_client_snapshot((select c from public.clients c where c.id=m.client_id)) is distinct from p.snapshot)) then
      update public.mail_messages set status='skipped',error='已退订、无效、邮箱/归属/资料或自动计划状态变化' where id=m.id; continue;
    end if;
    update public.mail_messages set status='sending',attempted_at=now() where id=m.id returning * into m;
    update public.mail_accounts set quota_wait=false,next_send_at=now()+interval '60 seconds' where user_id=a.user_id;
    return next m;
  end loop;
end $$;
revoke all on function public.mail_set_limit(uuid,uuid,integer),public.mail_client_snapshot(public.clients),public.mail_plans_create(uuid,uuid,text,timestamptz,integer,integer,jsonb),public.mail_plans_claim(),public.mail_plan_enqueue(uuid,jsonb),public.mail_plan_state(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.mail_set_limit(uuid,uuid,integer),public.mail_client_snapshot(public.clients),public.mail_plans_create(uuid,uuid,text,timestamptz,integer,integer,jsonb),public.mail_plans_claim(),public.mail_plan_enqueue(uuid,jsonb),public.mail_plan_state(uuid,uuid,text) to service_role;
commit;
