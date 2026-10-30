begin;
create table public.crm_social_settings (
 id boolean primary key default true check(id), operator_id uuid references public.profiles(id),
 assignee_ids uuid[] not null default '{}'
);
insert into public.crm_social_settings(id,operator_id,assignee_ids) values(true,(select id from public.profiles where username='sales5' and active limit 1),array(select id from public.profiles where username in('howard','sales2') and active and role='sales'));
create function public.crm_social_is_boss() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from profiles where id=auth.uid() and active and role='admin' and username='boss')$$;
revoke all on function public.crm_social_is_boss() from public,anon;
grant execute on function public.crm_social_is_boss() to authenticated;
create table public.crm_social_leads (
 id uuid primary key default gen_random_uuid(), data jsonb not null default '{}',
 assignee_id uuid references public.profiles(id), client_id uuid references public.clients(id) on delete set null,
 transferred_at timestamptz, trashed_at timestamptz, trash_reason text, version integer not null default 1,
 created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.crm_social_events (
 id uuid primary key default gen_random_uuid(), lead_id uuid references public.crm_social_leads(id) on delete set null,
 actor_id uuid references public.profiles(id), action text not null, detail jsonb not null default '{}', at timestamptz not null default now()
);
create index on public.crm_social_leads(updated_at desc);
create index on public.crm_social_events(lead_id,at desc);
alter table public.crm_social_settings enable row level security;
alter table public.crm_social_leads enable row level security;
alter table public.crm_social_events enable row level security;
revoke all on public.crm_social_settings,public.crm_social_leads,public.crm_social_events from public,anon,authenticated;
grant select on public.crm_social_settings,public.crm_social_leads,public.crm_social_events to authenticated;
create policy social_settings_read on public.crm_social_settings for select to authenticated using(public.is_active_user());
create policy social_leads_read on public.crm_social_leads for select to authenticated using(public.is_active_user());
create policy social_events_read on public.crm_social_events for select to authenticated using(public.is_active_user());
create function public.crm_social_config(p_operator uuid,p_assignees uuid[]) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.crm_social_is_boss() then raise exception '只有老板可以设置运营和分配范围'; end if;
 if p_operator is not null and not exists(select 1 from profiles where id=p_operator and active) then raise exception '运营账号不可用'; end if;
 if cardinality(p_assignees)>20 or exists(select 1 from unnest(p_assignees) x where not exists(select 1 from profiles where id=x and active and role='sales')) then raise exception '请选择启用的业务员'; end if;
 update crm_social_settings set operator_id=p_operator,assignee_ids=coalesce(p_assignees,'{}') where id;
 insert into crm_social_events(lead_id,actor_id,action,detail) select id,auth.uid(),'config',jsonb_build_object('operator',p_operator,'assignees',p_assignees) from crm_social_leads order by created_at limit 1;
end $$;
create function public.crm_social_save(p_id uuid,p_version integer,p_data jsonb) returns public.crm_social_leads
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crm_social_leads; clean jsonb;
begin
 if not public.is_active_user() then raise exception '请登录启用的账号'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>20000 then raise exception '资料格式或长度不正确'; end if;
 select coalesce(jsonb_object_agg(key,value),'{}') into clean from jsonb_each(p_data) where key=any(array['company_name','country','contact_name','phone','email','website','platform','social_url','products','tags','notes','progress','precision','evidence','next_date']);
 if length(trim(coalesce(clean->>'company_name',''))) not between 1 and 200 then raise exception '请填写公司或客户名称（最多200字）'; end if;
 if coalesce(clean->>'progress','') not in('未分配','待联系','已联系','已回复','有需求','已报价','寄样','成交','暂停') or coalesce(clean->>'precision','') not in('待核实','精准','一般','不精准','无效') then raise exception '请选择开发进度和精准度'; end if;
 if p_id is null then
  insert into crm_social_leads(data,created_by,updated_by) values(clean,auth.uid(),auth.uid()) returning * into r;
 else
  select * into r from crm_social_leads where id=p_id for update;
  if not found or r.version<>p_version then raise exception '资料已被其他人修改，请刷新后重新编辑'; end if;
  if r.transferred_at is not null or r.trashed_at is not null then raise exception '客户已转公海或回收站，请先恢复或在客户档案编辑'; end if;
  insert into crm_social_events(lead_id,actor_id,action,detail) values(r.id,auth.uid(),'edit',jsonb_build_object('before',r.data,'after',clean));
  update crm_social_leads set data=clean,version=version+1,updated_by=auth.uid(),updated_at=now() where id=p_id returning * into r;
 end if;
 if p_id is null then insert into crm_social_events(lead_id,actor_id,action,detail) values(r.id,auth.uid(),'create',clean); end if;
 return r;
end $$;
create function public.crm_social_assign(p_id uuid,p_version integer,p_owner uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crm_social_leads; cfg public.crm_social_settings;
begin
 select * into cfg from crm_social_settings where id for share;
 if not public.is_active_user() or not(public.crm_social_is_boss() or coalesce(cfg.operator_id=auth.uid(),false)) then raise exception '只有运营和老板可以分配'; end if;
 if p_owner is not null and (not(p_owner=any(cfg.assignee_ids)) or not exists(select 1 from profiles where id=p_owner and active and role='sales')) then raise exception '请由老板先设置可分配的业务员'; end if;
 select * into r from crm_social_leads where id=p_id for update;
 if not found or r.version<>p_version or r.transferred_at is not null or r.trashed_at is not null then raise exception '记录已变化，请刷新'; end if;
 update crm_social_leads set assignee_id=p_owner,version=version+1,updated_by=auth.uid(),updated_at=now(),data=jsonb_set(data,'{progress}',to_jsonb(case when p_owner is null then '未分配' else '待联系' end)) where id=p_id;
 insert into crm_social_events(lead_id,actor_id,action,detail) values(p_id,auth.uid(),'assign',jsonb_build_object('before',r.assignee_id,'after',p_owner));
end $$;
create function public.crm_social_release(p_id uuid,p_version integer,p_reason text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crm_social_leads; cid uuid;
begin
 if not public.is_active_user() then raise exception '请登录启用的账号'; end if;
 if length(trim(coalesce(p_reason,''))) not between 2 and 2000 then raise exception '请填写2至2000字退回原因'; end if;
 select * into r from crm_social_leads where id=p_id for update;
 if not found or r.version<>p_version or r.transferred_at is not null or r.trashed_at is not null then raise exception '记录已变化或已转公海/回收站，请刷新'; end if;
 if not(public.crm_social_is_boss() or coalesce(r.assignee_id=auth.uid(),false) or exists(select 1 from crm_social_settings where id and operator_id=auth.uid())) then raise exception '仅负责人、运营和老板可转公海'; end if;
 if r.data->>'precision'='无效' then raise exception '无效客户请保留标记供团队审查，不转可领取的公海'; end if;
  -- Serialize with prospecting imports; do not reveal a private duplicate's details.
 perform pg_advisory_xact_lock(hashtext('crm_discovery_import'));
 if exists(select 1 from clients c where
   (length(public.norm_domain(r.data->>'website'))>0 and c.domain=public.norm_domain(r.data->>'website')) or
   (length(public.name_key(r.data->>'company_name'))>3 and c.name_key=public.name_key(r.data->>'company_name')) or
   (length(public.phone_key(r.data->>'phone'))>=7 and (c.phone_key=public.phone_key(r.data->>'phone') or c.phone_key2=public.phone_key(r.data->>'phone')))) then
  raise exception '客户管理中已有相同公司、网站或电话，请老板核实合并，避免重复入库';
 end if;
 -- Use the existing release transaction, including mail cancellation.
 insert into clients(company_name,country,website,company_email,company_phone,contact_name,products,tags,status,owner_id,created_by,notes,source_note)
 values(r.data->>'company_name',coalesce(r.data->>'country',''),coalesce(r.data->>'website',''),coalesce(r.data->>'email',''),coalesce(r.data->>'phone',''),coalesce(r.data->>'contact_name',''),'{}',array['社媒客户'],'未联系',auth.uid(),auth.uid(),r.data::text,'社媒共享表 · '||coalesce(r.data->>'social_url','')) returning id into cid;
 perform public.release_client(cid,p_reason);
 update crm_social_leads set client_id=cid,transferred_at=now(),version=version+1,updated_at=now(),updated_by=auth.uid() where id=p_id;
 insert into crm_social_events(lead_id,actor_id,action,detail) values(p_id,auth.uid(),'second_pool',jsonb_build_object('client_id',cid,'reason',p_reason,'assignee',r.assignee_id));
 return cid;
end $$;
revoke all on function public.crm_social_config(uuid,uuid[]),public.crm_social_save(uuid,integer,jsonb),public.crm_social_assign(uuid,integer,uuid),public.crm_social_release(uuid,integer,text) from public,anon;
grant execute on function public.crm_social_config(uuid,uuid[]),public.crm_social_save(uuid,integer,jsonb),public.crm_social_assign(uuid,integer,uuid),public.crm_social_release(uuid,integer,text) to authenticated;
create function public.crm_social_trash(p_id uuid,p_version integer,p_action text,p_reason text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crm_social_leads;
begin
 if not public.is_active_user() then raise exception '账号不可用'; end if;
 select * into r from crm_social_leads where id=p_id for update;
 if not found or r.version<>p_version or r.transferred_at is not null then raise exception '记录已变化，请刷新'; end if;
 if p_action='trash' then
  if r.trashed_at is not null or length(trim(coalesce(p_reason,''))) not between 2 and 2000 then raise exception '请填写2至2000字无价值原因'; end if;
  update crm_social_leads set trashed_at=now(),trash_reason=trim(p_reason),version=version+1,updated_by=auth.uid(),updated_at=now() where id=p_id;
 elsif p_action in('restore','delete') then
  if not public.crm_social_is_boss() then raise exception '只有老板可恢复或永久删除'; end if;
  if r.trashed_at is null then raise exception '请先移入回收站'; end if;
  if p_action='restore' then update crm_social_leads set trashed_at=null,trash_reason=null,version=version+1,updated_by=auth.uid(),updated_at=now() where id=p_id; end if;
 else raise exception '操作不正确';
 end if;
 insert into crm_social_events(lead_id,actor_id,action,detail) values(p_id,auth.uid(),p_action,jsonb_build_object('company_name',r.data->>'company_name','reason',coalesce(p_reason,r.trash_reason)));
 if p_action='delete' then
  -- Keep operator/time/reason audit, remove previously saved customer payloads.
  update crm_social_events set detail=jsonb_build_object('company_name',r.data->>'company_name','reason',r.trash_reason) where lead_id=p_id;
  delete from crm_social_leads where id=p_id;
 end if;
end $$;
revoke all on function public.crm_social_trash(uuid,integer,text,text) from public,anon;
grant execute on function public.crm_social_trash(uuid,integer,text,text) to authenticated;
commit;
