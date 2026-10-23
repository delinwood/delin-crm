begin;
create table if not exists public.crm_client_state (
  client_id uuid primary key references public.clients(id) on delete restrict,
  archived_at timestamptz not null default now(),
  archived_by uuid references public.profiles(id) on delete set null,
  reason text not null default '',
  merged_into uuid references public.clients(id) on delete restrict,
  check(client_id is distinct from merged_into)
);
create table if not exists public.crm_records (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  kind text not null check(kind in ('qualification','contact','opportunity','document','research','inbound')),
  data jsonb not null default '{}' check(jsonb_typeof(data)='object'),
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists crm_one_qualification on public.crm_records(client_id) where kind='qualification' and deleted_at is null;
create index if not exists crm_records_client_kind on public.crm_records(client_id,kind,updated_at desc);
create table if not exists public.crm_business_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete restrict,
  record_id uuid,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}',
  at timestamptz not null default now()
);
create index if not exists crm_business_events_at on public.crm_business_events(client_id,at desc);
create table if not exists public.crm_backups (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  label text not null,
  schema_version integer not null default 1,
  checksum text not null,
  payload jsonb not null,
  size_bytes integer not null
);
alter table public.crm_client_state enable row level security;
alter table public.crm_records enable row level security;
alter table public.crm_business_events enable row level security;
alter table public.crm_backups enable row level security;
revoke all on public.crm_client_state,public.crm_records,public.crm_business_events,public.crm_backups from public,anon,authenticated;
grant select on public.crm_records,public.crm_business_events to authenticated;
grant all on public.crm_client_state,public.crm_records,public.crm_business_events,public.crm_backups to service_role;

create or replace function public.crm_is_archived(p_client uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.crm_client_state where client_id=p_client);
$$;
create or replace function public.crm_effective_client(p_client uuid)
returns uuid language plpgsql stable security definer set search_path=public,pg_temp as $$
declare next_id uuid; current_id uuid:=p_client; seen uuid[]:='{}';
begin
  if p_client is null then return null; end if;
  loop
    if current_id=any(seen) or cardinality(seen)>100 then return null; end if;
    seen:=array_append(seen,current_id);
    select merged_into into next_id from public.crm_client_state where client_id=current_id;
    if not found then return current_id; end if;
    if next_id is null then return null; end if;
    current_id:=next_id;
  end loop;
end;
$$;
create or replace function public.crm_client_access(p_client uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.is_active_user() and exists(select 1 from public.clients c
    where c.id=public.crm_effective_client(p_client)
      and (public.is_admin() or c.owner_id=auth.uid() or (not p_write and c.owner_id is null)));
$$;
revoke all on function public.crm_is_archived(uuid),public.crm_effective_client(uuid),public.crm_client_access(uuid,boolean) from public,anon;
grant execute on function public.crm_is_archived(uuid),public.crm_effective_client(uuid),public.crm_client_access(uuid,boolean) to authenticated,service_role;
drop policy if exists p_clients_select on public.clients;
create policy p_clients_select on public.clients for select to authenticated using (
  public.is_active_user() and not public.crm_is_archived(id) and (public.is_admin() or owner_id is null or owner_id=auth.uid())
);
drop policy if exists crm_client_archive_guard on public.clients;
create policy crm_client_archive_guard on public.clients as restrictive for all to authenticated using(not public.crm_is_archived(id)) with check(not public.crm_is_archived(id));
drop policy if exists records_read on public.crm_records;
create policy records_read on public.crm_records for select to authenticated using (
  public.crm_client_access(client_id,false) and (kind not in ('inbound','opportunity','document') or public.crm_client_access(client_id,true))
);
drop policy if exists business_events_read on public.crm_business_events;
create policy business_events_read on public.crm_business_events for select to authenticated using ((public.is_active_user() and public.is_admin()) or public.crm_client_access(client_id,true));
create or replace view public.crm_records_view with(security_invoker=true) as
  select r.*,public.crm_effective_client(r.client_id) as account_id from public.crm_records r where deleted_at is null;
grant select on public.crm_records_view to authenticated;

-- A regex alone accepts dates such as 2026-02-31. Verified facts and order
-- metadata must carry a real calendar date.
create or replace function public.crm_valid_date(p_value text)
returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  return to_char(p_value::date,'YYYY-MM-DD')=p_value;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;
revoke all on function public.crm_valid_date(text) from public,anon,authenticated;

create or replace function public.crm_save_record(p_kind text,p_client uuid,p_data jsonb,p_id uuid default null,p_version integer default null)
returns public.crm_records language plpgsql security definer set search_path=public,pg_temp as $$
declare prior public.crm_records; result public.crm_records; item jsonb; field text; fact jsonb; total numeric:=0; qty numeric; price numeric; root uuid; v integer;
begin
  if public.is_active_user() is not true then raise exception '请先登录有效账号' using errcode='42501'; end if;
  -- Serialize the ownership/archive check with pool transfer and merge RPCs.
  perform id from public.clients where id=p_client for update;
  if not found or public.crm_client_access(p_client,true) is not true or public.crm_is_archived(p_client) then raise exception '只能编辑自己负责的有效客户' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('qualification','contact','opportunity','document') then raise exception '不支持的记录类型；研究来源由后台保存，不能手动覆盖'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>200000 then raise exception '记录格式不正确或内容过大'; end if;
  if p_id is not null then
    select * into prior from public.crm_records where id=p_id for update;
    if not found then raise exception '原记录不存在，请刷新后重试'; end if;
    if found and (public.crm_effective_client(prior.client_id) is distinct from p_client or prior.kind<>p_kind or prior.deleted_at is not null) then raise exception '记录归属或状态已变化'; end if;
    if found and (p_version is null or prior.version<>p_version) then raise exception '记录已被更新，请刷新后再编辑'; end if;
    if found and p_kind='document' then raise exception '已保存的报价/PI不可覆盖，请另存新版本'; end if;
  end if;
  if p_kind='qualification' then
    for field,fact in select key,value from jsonb_each(p_data) loop
      if field not in ('sells_products','wholesale','warehouse','import_evidence','annual_volume','thickness','wear_layer','dimensions','finish','locking','certification','purchase_mode','stores','distribution','projects','supplier','reorder_cycle','next_purchase') then raise exception '未知的采购档案字段'; end if;
      if jsonb_typeof(fact) is distinct from 'object' or coalesce(fact->>'state','pending') not in ('pending','confirmed','no') then raise exception '请选择待确认、已确认或已确认没有'; end if;
      if fact->>'state' in ('confirmed','no') and (length(trim(coalesce(fact->>'source','')))=0 or not public.crm_valid_date(fact->>'date')) then raise exception '已确认资料必须填写来源和有效核实日期'; end if;
      if length(coalesce(fact->>'value',''))>4000 or length(coalesce(fact->>'source',''))>4000 then raise exception '单项资料过长'; end if;
    end loop;
  elsif p_kind='contact' then
    if length(trim(coalesce(p_data->>'name','')))=0 then raise exception '请填写联系人姓名'; end if;
    if coalesce(p_data->>'email','')<>'' and (p_data->>'email' !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)+$') then raise exception '联系人邮箱格式不正确'; end if;
    if p_data->>'verified'='true' and (trim(coalesce(p_data->>'source',''))='' or not public.crm_valid_date(p_data->>'checked_at')) then raise exception '核实联系人需填写来源和有效日期'; end if;
    p_data:=jsonb_set(p_data,'{email}',to_jsonb(lower(trim(coalesce(p_data->>'email','')))));
  elsif p_kind='opportunity' then
    if trim(coalesce(p_data->>'title',''))='' or coalesce(p_data->>'stage','') not in ('确认需求','发送资料','寄样','报价','议价','定金','出货','输单') then raise exception '请填写商机名称和有效阶段'; end if;
    if coalesce(p_data->>'currency','') !~ '^[A-Z]{3}$' then raise exception '请选择币种'; end if;
    foreach field in array array['amount','cost','quantity','deposit'] loop
      if coalesce(p_data->>field,'')<>'' and (p_data->>field !~ '^\d+(\.\d{1,6})?$' or (p_data->>field)::numeric>1000000000000) then raise exception '金额/数量必须为合理的非负数'; end if;
    end loop;
    if p_data->>'stage' in ('定金','出货') and coalesce(p_data->>'order_confirmed','false')<>'true' then raise exception '进入定金/出货阶段前请确认已形成真实订单'; end if;
    if p_data->>'stage' in ('定金','出货') then
      if trim(coalesce(p_data->>'order_no',''))='' or not public.crm_valid_date(p_data->>'order_date') or coalesce(nullif(p_data->>'amount','')::numeric,0)<=0 then raise exception '确认订单需要订单编号、有效日期和正数金额'; end if;
      perform pg_advisory_xact_lock(hashtextextended(p_client::text||lower(trim(p_data->>'order_no')),0));
      if exists(select 1 from public.crm_records r where public.crm_effective_client(r.client_id)=p_client and r.kind='opportunity' and r.deleted_at is null and r.id is distinct from p_id and r.data->>'order_confirmed'='true' and lower(trim(r.data->>'order_no'))=lower(trim(p_data->>'order_no'))) then raise exception '该客户已有相同订单编号，不能重复统计订单'; end if;
    end if;
    if coalesce(nullif(p_data->>'deposit','')::numeric,0)>coalesce(nullif(p_data->>'amount','')::numeric,0) then raise exception '已收定金不能超过订单金额'; end if;
    if p_data->>'stage'='输单' and trim(coalesce(p_data->>'lost_reason',''))='' then raise exception '请填写输单原因'; end if;
    if prior.id is not null and prior.data->>'stage' is distinct from p_data->>'stage' then
      insert into public.crm_business_events(client_id,record_id,actor_id,action,detail) values(p_client,p_id,auth.uid(),'stage_change',jsonb_build_object('from',prior.data->>'stage','to',p_data->>'stage'));
    end if;
  elsif p_kind='document' then
    if coalesce(p_data->>'doc_type','') not in ('quote','pi') or coalesce(p_data->>'currency','') !~ '^[A-Z]{3}$' then raise exception '请填写单据类型和币种'; end if;
    if jsonb_typeof(p_data->'lines') is distinct from 'array' or jsonb_array_length(p_data->'lines') not between 1 and 200 then raise exception '单据需有1至200项产品'; end if;
    for item in select value from jsonb_array_elements(p_data->'lines') loop
      if jsonb_typeof(item) is distinct from 'object' or trim(coalesce(item->>'product',''))='' or coalesce(item->>'qty','') !~ '^\d+(\.\d{1,6})?$' or coalesce(item->>'price','') !~ '^\d+(\.\d{1,6})?$' then raise exception '请填写产品、数量和单价'; end if;
      qty:=(item->>'qty')::numeric; price:=(item->>'price')::numeric;
      if qty<=0 or qty>1000000000 or price>1000000000 then raise exception '产品数量或价格超出范围'; end if;
      total:=total+round(qty*price,2);
    end loop;
    if coalesce(p_data->>'freight','0') !~ '^\d+(\.\d{1,2})?$' or coalesce(p_data->>'discount','0') !~ '^\d+(\.\d{1,2})?$' then raise exception '运费和折扣必须为非负金额'; end if;
    if (p_data->>'discount')::numeric>total then raise exception '折扣不能高于产品金额'; end if;
    if coalesce(p_data->>'revision_of','')<>'' then
      select * into prior from public.crm_records where id=(p_data->>'revision_of')::uuid and public.crm_effective_client(client_id)=p_client and kind='document' and deleted_at is null for update;
      if not found or prior.data->>'doc_type'<>p_data->>'doc_type' then raise exception '原单据不存在或类型不同'; end if;
      root:=coalesce(nullif(prior.data->>'root_id','')::uuid,prior.id);
      perform pg_advisory_xact_lock(hashtextextended(root::text,0));
      select coalesce(max((data->>'revision')::integer),0)+1 into v from public.crm_records where kind='document' and data->>'root_id'=root::text;
      p_data:=p_data||jsonb_build_object('root_id',root,'revision',v,'number',prior.data->>'number');
      p_id:=coalesce(p_id,gen_random_uuid()); prior:=null;
    else
      p_id:=coalesce(p_id,gen_random_uuid());
      p_data:=p_data||jsonb_build_object('root_id',p_id,'revision',1,'number',case when p_data->>'doc_type'='pi' then 'PI-' else 'Q-' end||to_char(now(),'YYYYMMDD')||'-'||upper(left(p_id::text,8)));
    end if;
    p_data:=p_data||jsonb_build_object('subtotal',total,'total',total+coalesce((p_data->>'freight')::numeric,0)-coalesce((p_data->>'discount')::numeric,0));
  end if;
  if prior.id is not null then
    update public.crm_records set data=p_data,version=version+1,updated_at=now(),updated_by=auth.uid() where id=prior.id returning * into result;
  else
    insert into public.crm_records(id,client_id,kind,data,created_by,updated_by) values(coalesce(p_id,gen_random_uuid()),p_client,p_kind,p_data,auth.uid(),auth.uid()) returning * into result;
  end if;
  insert into public.crm_business_events(client_id,record_id,actor_id,action,detail) values(p_client,result.id,auth.uid(),case when prior.id is null then 'create_record' else 'update_record' end,jsonb_build_object('kind',p_kind,'version',result.version));
  return result;
end;
$$;
revoke all on function public.crm_save_record(text,uuid,jsonb,uuid,integer) from public,anon;
grant execute on function public.crm_save_record(text,uuid,jsonb,uuid,integer) to authenticated;

create or replace function public.crm_archive_clients(p_ids uuid[],p_reason text default '移入回收站')
returns uuid[] language plpgsql security definer set search_path=public,pg_temp as $$
declare cid uuid; result uuid[]:='{}';
begin
  if not public.can_delete_clients() then raise exception '仅老板可移入回收站' using errcode='42501'; end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 10000 or array_position(p_ids,null) is not null or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids)x) then raise exception '请选择1至10000家不重复客户'; end if;
  p_reason:=left(coalesce(nullif(trim(p_reason),''),'移入回收站'),2000);
  perform id from public.mail_plans where client_id=any(p_ids) order by id for update;
  perform id from public.clients where id=any(p_ids) order by id for update;
  foreach cid in array p_ids loop
    if not exists(select 1 from public.clients where id=cid) or public.crm_is_archived(cid) then raise exception '客户已变化，请刷新后重试'; end if;
    insert into public.crm_client_state(client_id,archived_by,reason) values(cid,auth.uid(),left(p_reason,2000));
    insert into public.crm_business_events(client_id,actor_id,action,detail) values(cid,auth.uid(),'archive',jsonb_build_object('reason',p_reason));
    result:=array_append(result,cid);
  end loop;
  update public.mail_plans set status='stopped',last_error='客户已移入回收站' where client_id=any(p_ids) and status in ('running','paused');
  update public.mail_messages set status='cancelled',error='客户已移入回收站' where client_id=any(p_ids) and status='queued';
  return result;
end;
$$;
create or replace function public.delete_clients(p_ids uuid[])
returns uuid[] language sql security definer set search_path=public,pg_temp as $$select public.crm_archive_clients(p_ids);$$;
create or replace function public.crm_soft_delete_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- Direct DELETE has already locked the client row. Calling the archive RPC
  -- here would reverse its plans -> clients lock order. All CRM buttons use
  -- delete_clients(), which performs the recoverable operation safely.
  raise exception '请通过客户回收站操作删除，禁止直接永久删除客户' using errcode='42501';
end;
$$;
drop trigger if exists a_crm_soft_delete on public.clients;
create trigger a_crm_soft_delete before delete on public.clients for each row execute function public.crm_soft_delete_trigger();
create or replace function public.crm_restore_client(p_client uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.can_delete_clients() then raise exception '仅老板可恢复客户' using errcode='42501'; end if;
  perform id from public.clients where id=p_client for update;
  delete from public.crm_client_state where client_id=p_client;
  if not found then raise exception '客户不在回收站'; end if;
  insert into public.crm_business_events(client_id,actor_id,action) values(p_client,auth.uid(),'restore');
end;
$$;
create or replace function public.crm_recycle_list()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.can_delete_clients() then raise exception '仅老板可查看回收站' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('company_name',c.company_name,'owner_id',c.owner_id,'country',c.country)) from public.crm_client_state s join public.clients c on c.id=s.client_id),'[]');
end;
$$;
create or replace function public.crm_merge_clients(p_source uuid,p_target uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.can_delete_clients() then raise exception '仅老板可合并客户' using errcode='42501'; end if;
  if p_source is null or p_target is null or p_source=p_target or length(trim(coalesce(p_reason,'')))<2 then raise exception '请选择两家不同的公司并填写合并依据'; end if;
  perform id from public.mail_plans where client_id in (p_source,p_target) order by id for update;
  perform id from public.clients where id in (p_source,p_target) order by id for update;
  if (select count(*) from public.clients where id in(p_source,p_target))<>2 or public.crm_is_archived(p_source) or public.crm_is_archived(p_target) then raise exception '客户已变化，请刷新'; end if;
  if exists(select 1 from public.crm_records a join public.crm_records b on lower(trim(a.data->>'order_no'))=lower(trim(b.data->>'order_no')) where a.kind='opportunity' and b.kind='opportunity' and a.deleted_at is null and b.deleted_at is null and public.crm_effective_client(a.client_id)=p_source and public.crm_effective_client(b.client_id)=p_target and coalesce(trim(a.data->>'order_no'),'')<>'' and a.data->>'order_confirmed'='true' and b.data->>'order_confirmed'='true') then raise exception '两家公司存在重复订单编号，请先核对订单后再合并'; end if;
  insert into public.crm_client_state(client_id,archived_by,reason,merged_into) values(p_source,auth.uid(),'合并：'||left(p_reason,1900),p_target);
  update public.mail_plans set status='stopped',last_error='客户已合并，请重新核对后创建计划' where client_id in(p_source,p_target) and status in('running','paused');
  update public.mail_messages set status='cancelled',error='客户已合并，请重新核对' where client_id in(p_source,p_target) and status='queued';
  insert into public.crm_business_events(client_id,actor_id,action,detail) values(p_target,auth.uid(),'merge',jsonb_build_object('source',p_source,'reason',p_reason));
end;
$$;
create or replace function public.crm_client_bundle(p_client uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare ids uuid[];
begin
  if not public.crm_client_access(p_client,false) or public.crm_is_archived(p_client) then raise exception '无权查看客户' using errcode='42501'; end if;
  select array_agg(id) into ids from public.clients where public.crm_effective_client(id)=p_client;
  return jsonb_build_object(
    'records',coalesce((select jsonb_agg(to_jsonb(r)) from public.crm_records r where client_id=any(ids) and deleted_at is null and (kind not in('inbound','opportunity','document') or public.crm_client_access(p_client,true))),'[]'),
    'merged',coalesce((select jsonb_agg(jsonb_build_object('id',id,'company_name',company_name)) from public.clients where id=any(ids) and id<>p_client),'[]'),
    'history',case when public.crm_client_access(p_client,true) then jsonb_build_object(
      'logs',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('author_name',p.full_name,'original_company',c.company_name)) from public.follow_ups l left join public.profiles p on p.id=l.author_id join public.clients c on c.id=l.client_id where l.client_id=any(ids) and l.client_id<>p_client),'[]'),
      'quotes',coalesce((select jsonb_agg(to_jsonb(q)||jsonb_build_object('author_name',p.full_name,'original_company',c.company_name)) from public.quotes q left join public.profiles p on p.id=q.author_id join public.clients c on c.id=q.client_id where q.client_id=any(ids) and q.client_id<>p_client),'[]'),
      'samples',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('author_name',p.full_name,'original_company',c.company_name)) from public.samples s left join public.profiles p on p.id=s.author_id join public.clients c on c.id=s.client_id where s.client_id=any(ids) and s.client_id<>p_client),'[]')) else '{}'::jsonb end);
end;
$$;
revoke all on function public.crm_archive_clients(uuid[],text),public.delete_clients(uuid[]),public.crm_soft_delete_trigger(),public.crm_restore_client(uuid),public.crm_recycle_list(),public.crm_merge_clients(uuid,uuid,text),public.crm_client_bundle(uuid) from public,anon,authenticated;
grant execute on function public.crm_archive_clients(uuid[],text),public.delete_clients(uuid[]),public.crm_restore_client(uuid),public.crm_recycle_list(),public.crm_merge_clients(uuid,uuid,text),public.crm_client_bundle(uuid) to authenticated;

-- Existing history tables must not expose archived customers through an older helper.
do $$
declare pol record; tab text;
begin
  for pol in select tablename,policyname,qual from pg_policies where schemaname='public' and tablename in ('follow_ups','quotes','samples','client_tracking','crm_pool_metadata') and cmd='SELECT' loop
    execute format('alter policy %I on public.%I using ((%s) and public.crm_client_access(client_id,false))',pol.policyname,pol.tablename,coalesce(pol.qual,'true'));
  end loop;
  for pol in select policyname,qual,with_check from pg_policies where schemaname='public' and tablename='clients' and cmd='UPDATE' loop
    execute format('alter policy %I on public.clients using ((%s) and not public.crm_is_archived(id)) with check ((%s) and not public.crm_is_archived(id))',pol.policyname,coalesce(pol.qual,'true'),coalesce(pol.with_check,pol.qual,'true'));
  end loop;
  foreach tab in array array['follow_ups','quotes','samples'] loop
    execute format('drop policy if exists crm_archive_insert_guard on public.%I',tab);
    execute format('create policy crm_archive_insert_guard on public.%I as restrictive for insert to authenticated with check(public.crm_client_access(client_id,true) and not public.crm_is_archived(client_id))',tab);
    execute format('drop policy if exists crm_archive_update_guard on public.%I',tab);
    execute format('create policy crm_archive_update_guard on public.%I as restrictive for update to authenticated using(public.crm_client_access(client_id,true) and not public.crm_is_archived(client_id)) with check(public.crm_client_access(client_id,true) and not public.crm_is_archived(client_id))',tab);
  end loop;
end;
$$;
-- Pool RPCs bypass SELECT RLS, so they also explicitly reject archived records.
do $$
declare fn text; original text; patched text;
begin
  foreach fn in array array['public.claim_client(uuid)','public.release_client(uuid,text)'] loop
    select pg_get_functiondef(fn::regprocedure) into original;
    if position('crm_is_archived' in original)=0 then
      patched:=replace(original,'if customer.status=''无效'' or exists','if public.crm_is_archived(p_client_id) or customer.status=''无效'' or exists');
      if patched=original then raise exception 'Cannot identify pool validity guard'; end if;
      execute patched;
    end if;
  end loop;
  select pg_get_functiondef('public.set_client_attention(uuid,text,text)'::regprocedure) into original;
  if position('crm_is_archived' in original)=0 then
    patched:=replace(original,'if not found or not (public.is_admin()','if not found or public.crm_is_archived(p_client_id) or not (public.is_admin()');
    if patched=original then raise exception 'Cannot identify customer attention ownership guard'; end if;
    execute patched;
  end if;
end;
$$;
commit;
