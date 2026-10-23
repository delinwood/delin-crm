begin;
alter table public.mail_accounts add column if not exists read_enabled boolean not null default false;
alter table public.mail_accounts add column if not exists read_since timestamptz;
alter table public.mail_accounts add column if not exists read_history_id text;
alter table public.mail_accounts add column if not exists read_history_page text;
alter table public.mail_accounts add column if not exists read_seed_since timestamptz;
alter table public.mail_accounts add column if not exists read_seed_page text;
alter table public.mail_accounts add column if not exists read_last_sync_at timestamptz;
alter table public.mail_accounts add column if not exists read_gap_at timestamptz;
alter table public.mail_accounts add column if not exists read_error text;
alter table public.mail_accounts add column if not exists read_lease_until timestamptz;
alter table public.mail_oauth_states add column if not exists request_read boolean not null default false;
alter table public.mail_oauth_states add column if not exists seed_days integer not null default 0 check(seed_days in(0,7));
create table if not exists public.crm_research_jobs(
  id uuid primary key default gen_random_uuid(), client_id uuid not null references public.clients(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'queued' check(status in('queued','running','completed','failed','cancelled')),
  include_search boolean not null default false, created_at timestamptz not null default now(),finished_at timestamptz,
  lease_until timestamptz, error text, result_id uuid references public.crm_records(id) on delete set null
);
create unique index if not exists research_one_pending on public.crm_research_jobs(client_id) where status in('queued','running');
create table if not exists public.crm_inbound_queue(
  sender_id uuid not null references public.profiles(id) on delete cascade,provider_id text not null,
  attempts integer not null default 0,created_at timestamptz not null default now(),error text,
  primary key(sender_id,provider_id)
);
create table if not exists public.crm_mail_inbound(
  id uuid primary key default gen_random_uuid(),sender_id uuid not null references public.profiles(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  provider_id text not null,outbound_id uuid not null references public.mail_messages(id) on delete restrict,
  kind text not null check(kind in('reply','auto_reply','permanent_bounce','temporary_bounce','review','ignored')),
  from_email text not null,subject text not null,body text not null,received_at timestamptz not null,
  created_at timestamptz not null default now(),reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,review_note text,unique(sender_id,provider_id)
);
create index if not exists inbound_client_received on public.crm_mail_inbound(client_id,received_at desc);
create table if not exists public.crm_mail_review_holds(
  email text primary key,inbound_id uuid not null references public.crm_mail_inbound(id) on delete restrict,
  active boolean not null default true,reason text not null,expires_at timestamptz
);
create table if not exists public.crm_mail_company_window(
  client_id uuid primary key references public.clients(id) on delete restrict,
  last_attempt_at timestamptz not null,message_id uuid not null references public.mail_messages(id) on delete restrict
);
alter table public.crm_research_jobs enable row level security;
alter table public.crm_inbound_queue enable row level security;
alter table public.crm_mail_inbound enable row level security;
alter table public.crm_mail_review_holds enable row level security;
alter table public.crm_mail_company_window enable row level security;
revoke all on public.crm_research_jobs,public.crm_inbound_queue,public.crm_mail_inbound,public.crm_mail_review_holds,public.crm_mail_company_window from public,anon,authenticated;
grant select on public.crm_research_jobs,public.crm_mail_inbound to authenticated;
grant all on public.crm_research_jobs,public.crm_inbound_queue,public.crm_mail_inbound,public.crm_mail_review_holds,public.crm_mail_company_window to service_role;
grant execute on function public.crm_is_archived(uuid),public.crm_effective_client(uuid),public.crm_client_access(uuid,boolean) to service_role;
drop policy if exists research_jobs_read on public.crm_research_jobs;
create policy research_jobs_read on public.crm_research_jobs for select to authenticated using(public.is_active_user() and (public.is_admin() or (requested_by=auth.uid() and public.crm_client_access(client_id,true))));
drop policy if exists inbound_read on public.crm_mail_inbound;
create policy inbound_read on public.crm_mail_inbound for select to authenticated using(public.crm_client_access(client_id,true));

create or replace function public.crm_request_research(p_ids uuid[],p_search boolean default false)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare cid uuid; n integer:=0;
begin
  if public.is_active_user() is not true then raise exception '请先登录'; end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 10 or array_position(p_ids,null) is not null or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids)x) then raise exception '每批请选择1至10家不重复公司'; end if;
  p_search:=coalesce(p_search,false);
  -- One global lock precedes per-user locks, preventing parallel employees
  -- from overspending the shared monthly ceiling.
  if p_search then perform pg_advisory_xact_lock(hashtextextended('research:monthly-global',0)); end if;
  perform pg_advisory_xact_lock(hashtextextended('research:'||auth.uid()::text,0));
  if (select count(*) from public.crm_research_jobs where requested_by=auth.uid() and created_at>now()-interval '1 day')+cardinality(p_ids)>20 then raise exception '免费模式每个账号每天最多20家公司，未开启付费调用'; end if;
  if p_search and (select count(*) from public.crm_research_jobs where include_search and created_at>date_trunc('month',now()))+cardinality(p_ids)>100 then raise exception '免费模式每月最多100次全网搜索任务，已停止新增，不会自动购买额度'; end if;
  foreach cid in array p_ids loop
    if public.crm_client_access(cid,true) is not true or public.crm_is_archived(cid) then raise exception '只能补充自己负责的客户资料'; end if;
    insert into public.crm_research_jobs(client_id,requested_by,include_search) values(cid,auth.uid(),p_search) on conflict do nothing;
    if found then n:=n+1; end if;
  end loop;
  return n;
end;
$$;
create or replace function public.crm_research_claim()
returns setof public.crm_research_jobs language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.crm_research_jobs j set status='cancelled',finished_at=now(),lease_until=null,error='客户归属、归档或账号状态已变化，未继续查询'
    where j.status in('queued','running') and not exists(select 1 from public.clients c join public.profiles p on p.id=j.requested_by where c.id=j.client_id and p.active and not public.crm_is_archived(c.id) and (p.role='admin' or c.owner_id=p.id));
  return query with target as(select id from public.crm_research_jobs where status='queued' or (status='running' and coalesce(lease_until,'-infinity')<now()) order by created_at for update skip locked limit 1)
    update public.crm_research_jobs j set status='running',lease_until=now()+interval '3 minutes' from target t where j.id=t.id returning j.*;
end;
$$;
-- Research output is immutable evidence written only by the service worker.
-- A user may explicitly adopt disclosed suggestions into empty CRM fields;
-- neither raw source evidence nor an existing company value is overwritten.
create or replace function public.crm_apply_research(p_record uuid,p_choices jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crm_records; target uuid; choice jsonb; suggestion jsonb; field text; value text; existing text; applied text[]:='{}'; skipped text[]:='{}';
begin
  if public.is_active_user() is not true then raise exception '请先登录有效账号' using errcode='42501'; end if;
  if jsonb_typeof(p_choices) is distinct from 'array' or jsonb_array_length(p_choices) not between 1 and 20 then raise exception '请选择1至20项有来源的资料'; end if;
  select * into r from public.crm_records where id=p_record and kind='research' and deleted_at is null;
  if not found then raise exception '原始研究记录不存在'; end if;
  target:=public.crm_effective_client(r.client_id);
  perform id from public.clients where id=target for update;
  if not found or public.crm_client_access(target,true) is not true or public.crm_is_archived(target) then raise exception '客户归属或归档状态已变化，不能应用资料' using errcode='42501'; end if;
  select * into r from public.crm_records where id=p_record and kind='research' and deleted_at is null for share;
  if not found or public.crm_effective_client(r.client_id) is distinct from target or jsonb_typeof(r.data->'suggestions') is distinct from 'array' then raise exception '原始研究记录已变化，请刷新'; end if;
  for choice in select x from jsonb_array_elements(p_choices) x loop
    if jsonb_typeof(choice) is distinct from 'object' or jsonb_typeof(choice->'value') is distinct from 'string' or trim(coalesce(choice->>'id',''))='' then raise exception '建议项目格式不正确'; end if;
    field:=choice->>'field'; value:=trim(choice->>'value');
    if field is null or field not in('company_email','company_phone','address','notes','website') or value='' or length(value)>10000 then raise exception '只能采纳公开的邮箱、电话、地址、备注或官网资料'; end if;
    select x into suggestion from jsonb_array_elements(r.data->'suggestions') x
      where x->>'id'=choice->>'id' and x->>'field'=field and x->'value'=choice->'value' and trim(coalesce(x->>'source_url',''))<>'' and trim(coalesce(x->>'checked_at',''))<>'' limit 1;
    if not found then raise exception '建议与原始来源不一致，请刷新后重新选择'; end if;
    if field='company_email' and (length(value)>320 or value !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)+$') then raise exception '建议邮箱格式不正确'; end if;
    if field='website' and (length(value)>2048 or value !~* '^https?://[^[:space:]]+$') then raise exception '建议官网格式不正确'; end if;
    execute format('select %I::text from public.clients where id=$1',field) into existing using target;
    if trim(coalesce(existing,''))<>'' then
      if not field=any(skipped) then skipped:=array_append(skipped,field); end if;
      continue;
    end if;
    execute format('update public.clients set %I=$1 where id=$2',field) using value,target;
    if not field=any(applied) then applied:=array_append(applied,field); end if;
  end loop;
  insert into public.crm_business_events(client_id,record_id,actor_id,action,detail)
    values(target,p_record,auth.uid(),'apply_research',jsonb_build_object('applied',applied,'skipped',skipped,'original_client_id',r.client_id));
  return jsonb_build_object('applied',applied,'skipped',skipped);
end;
$$;
create or replace function public.crm_sync_claim(p_sender uuid default null)
returns setof public.mail_accounts language plpgsql security definer set search_path=public,pg_temp as $$
begin
  return query with target as(select a.user_id from public.mail_accounts a join public.profiles p on p.id=a.user_id
    where a.connected and a.read_enabled and p.active and (p_sender is null or a.user_id=p_sender)
      and coalesce(a.read_lease_until,'-infinity')<now() order by a.read_last_sync_at nulls first for update of a skip locked limit 3)
    update public.mail_accounts a set read_lease_until=now()+interval '2 minutes' from target t where a.user_id=t.user_id returning a.*;
end;
$$;
create or replace function public.crm_reserve_company_mail(p_client uuid,p_message uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare root uuid; previous public.crm_mail_company_window; incoming public.mail_messages;
begin
  if public.crm_is_archived(p_client) then return false; end if;
  root:=public.crm_effective_client(p_client); if root is null then return false; end if;
  select * into incoming from public.mail_messages where id=p_message and client_id=p_client and status='sending';
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('company-mail:'||root::text,0));
  -- Re-read after serialization: a reply, reassignment or disconnect may have
  -- happened after the worker claimed this message. Never change a sending
  -- message to cancelled here: Google may already have accepted an attempt.
  select * into incoming from public.mail_messages where id=p_message and client_id=p_client and status='sending';
  if not found or public.crm_is_archived(p_client) or public.crm_effective_client(p_client) is distinct from root then return false; end if;
  if not exists(select 1 from public.mail_accounts a join public.profiles p on p.id=a.user_id join public.clients c on c.id=root where a.user_id=incoming.sender_id and a.connected and p.active and c.status<>'无效' and lower(trim(c.company_email))=incoming.recipient and (p.role='admin' or c.owner_id=p.id)) then return false; end if;
  if exists(select 1 from public.client_tracking where client_id=root and attention_level='无效') then return false; end if;
  if exists(select 1 from public.mail_plans p where p.last_message_id=p_message and (p.status<>'running' or exists(select 1 from public.clients c where c.id=root and c.status in('已回复','成交')) or public.mail_client_snapshot((select c from public.clients c where c.id=root)) is distinct from p.snapshot)) then return false; end if;
  select * into previous from public.crm_mail_company_window where client_id=root for update;
  -- A reservation is a single attempt, including repeated calls for the same
  -- message. An uncertain network result must never cause an automatic replay.
  if found and previous.last_attempt_at>now()-interval '24 hours' then return false; end if;
  if exists(select 1 from public.mail_suppressions where email=incoming.recipient) or exists(select 1 from public.crm_mail_review_holds where email=incoming.recipient and active and (expires_at is null or expires_at>now())) then return false; end if;
  if exists(select 1 from public.mail_messages m where m.id<>p_message and public.crm_effective_client(m.client_id)=root and m.attempted_at>now()-interval '24 hours' and m.status in('sent','unknown','sending','bounced')) then return false; end if;
  insert into public.crm_mail_company_window values(root,now(),p_message) on conflict(client_id) do update set last_attempt_at=excluded.last_attempt_at,message_id=excluded.message_id;
  return true;
end;
$$;
create or replace function public.crm_apply_inbound(p_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare incoming public.crm_mail_inbound; root uuid; recipient text;
begin
  select * into incoming from public.crm_mail_inbound where id=p_id for update;
  if not found then return; end if;
  root:=public.crm_effective_client(incoming.client_id); if root is null then return; end if;
  select m.recipient into recipient from public.mail_messages m where id=incoming.outbound_id;
  perform id from public.mail_plans where public.crm_effective_client(client_id)=root order by id for update;
  if incoming.kind='reply' then
    update public.mail_plans set status='stopped',last_error='已同步客户回复，后续自动邮件停止' where public.crm_effective_client(client_id)=root and status in('running','paused');
    update public.mail_messages set status='cancelled',error='客户已回复，取消后续自动邮件' where public.crm_effective_client(client_id)=root and status='queued';
    update public.clients set status='已回复' where id=root and status in('未联系','已联系');
  elsif incoming.kind in('permanent_bounce','temporary_bounce','review') then
    update public.mail_plans set status='paused',last_error='发现退信或待核实来信，已暂停，请在邮件中心审查' where public.crm_effective_client(client_id)=root and status='running';
    update public.mail_messages set status='cancelled',error='发现退信或待核实来信，暂停后续联系' where public.crm_effective_client(client_id)=root and status='queued';
    if incoming.kind in('permanent_bounce','temporary_bounce','review') then
      insert into public.crm_mail_review_holds(email,inbound_id,reason,expires_at) values(recipient,p_id,'退信待核实，暂不联系',case when incoming.kind='temporary_bounce' then now()+interval '24 hours' end)
        on conflict(email) do update set inbound_id=excluded.inbound_id,active=true,reason=excluded.reason,expires_at=case when (public.crm_mail_review_holds.active and public.crm_mail_review_holds.expires_at is null) or excluded.expires_at is null then null else greatest(public.crm_mail_review_holds.expires_at,excluded.expires_at) end;
    end if;
  end if;
end;
$$;
create or replace function public.crm_store_inbound(p_sender uuid,p_provider text,p_outbound uuid,p_kind text,p_received timestamptz,p_from text,p_subject text,p_body text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.mail_messages; root uuid; result uuid; actor public.profiles;
begin
  select * into actor from public.profiles where id=p_sender and active;
  if not found or not exists(select 1 from public.mail_accounts where user_id=p_sender and connected and read_enabled) then raise exception '同步授权未启用'; end if;
  if p_kind is null or p_kind not in('reply','auto_reply','permanent_bounce','temporary_bounce','review') or p_provider is null or p_provider !~ '^[a-zA-Z0-9_-]{8,100}$' or p_received is null or p_received>now()+interval '5 minutes' or p_from is null or p_subject is null or p_body is null then raise exception '来信格式无效'; end if;
  select * into m from public.mail_messages where id=p_outbound and sender_id=p_sender and status in('sent','unknown','bounced');
  if not found or coalesce(m.sent_at,m.attempted_at) is null or p_received<coalesce(m.sent_at,m.attempted_at)-interval '5 minutes' then raise exception '来信与发信记录无法匹配'; end if;
  root:=public.crm_effective_client(m.client_id);
  if root is null or not exists(select 1 from public.clients where id=root and (actor.role='admin' or owner_id=p_sender)) then raise exception '客户归属已变化，未同步来信'; end if;
  if p_kind in('reply','auto_reply') and lower(trim(p_from))<>lower(m.recipient) then raise exception '发件人与原收件人不一致，需人工核实'; end if;
  insert into public.crm_mail_inbound(sender_id,client_id,provider_id,outbound_id,kind,from_email,subject,body,received_at)
    values(p_sender,root,p_provider,p_outbound,p_kind,left(p_from,320),left(p_subject,1000),left(p_body,20000),p_received) on conflict(sender_id,provider_id) do nothing returning id into result;
  if result is not null then perform public.crm_apply_inbound(result); end if;
  return result;
end;
$$;
create or replace function public.crm_review_inbound(p_id uuid,p_decision text,p_note text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare incoming public.crm_mail_inbound; recipient text;
begin
  select * into incoming from public.crm_mail_inbound where id=p_id for update;
  if not found or not public.crm_client_access(incoming.client_id,true) then raise exception '无权审查此来信' using errcode='42501'; end if;
  if p_decision is null or p_decision not in('reply','permanent_bounce','temporary_bounce','ignored') or length(trim(coalesce(p_note,'')))<2 then raise exception '请选择处理方式并填写核实依据'; end if;
  update public.crm_mail_inbound set kind=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),review_note=left(p_note,2000) where id=p_id;
  perform public.crm_apply_inbound(p_id);
  if p_decision='permanent_bounce' then
    select m.recipient into recipient from public.mail_messages m where id=incoming.outbound_id;
    insert into public.mail_suppressions(email,reason) values(recipient,'已人工核实永久退信') on conflict(email) do nothing;
  end if;
  if p_decision in('reply','permanent_bounce','ignored') then update public.crm_mail_review_holds set active=false where inbound_id=p_id; end if;
  insert into public.crm_business_events(client_id,actor_id,action,detail) values(incoming.client_id,auth.uid(),'review_inbound',jsonb_build_object('inbound_id',p_id,'decision',p_decision,'note',p_note));
end;
$$;
revoke all on function public.crm_request_research(uuid[],boolean),public.crm_research_claim(),public.crm_apply_research(uuid,jsonb),public.crm_sync_claim(uuid),public.crm_reserve_company_mail(uuid,uuid),public.crm_apply_inbound(uuid),public.crm_store_inbound(uuid,text,uuid,text,timestamptz,text,text,text),public.crm_review_inbound(uuid,text,text) from public,anon,authenticated;
grant execute on function public.crm_request_research(uuid[],boolean),public.crm_apply_research(uuid,jsonb),public.crm_review_inbound(uuid,text,text) to authenticated;
grant execute on function public.crm_research_claim(),public.crm_sync_claim(uuid),public.crm_reserve_company_mail(uuid,uuid),public.crm_store_inbound(uuid,text,uuid,text,timestamptz,text,text,text) to service_role;
commit;
