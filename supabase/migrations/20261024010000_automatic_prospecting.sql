begin;
-- Public-company discovery is separate from customer records and outbound mail.
create table if not exists public.crm_discovery_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id) on delete restrict,
  nonce uuid not null, criteria jsonb not null,
  queries jsonb not null check(jsonb_typeof(queries)='array' and jsonb_array_length(queries) between 1 and 6),
  target_count integer not null check(target_count between 5 and 50),
  search_cursor integer not null default 0,
  status text not null default 'queued' check(status in('queued','running','completed','failed','paused','cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), finished_at timestamptz,
  lease_token uuid, lease_until timestamptz, error text,
  unique(requested_by,nonce)
);
create table if not exists public.crm_discovery_requests (
  job_id uuid not null references public.crm_discovery_jobs(id) on delete restrict,
  step integer not null, query text not null, attempted_at timestamptz not null default now(),
  finished_at timestamptz, status text not null default 'started' check(status in('started','completed','failed','unknown')),
  error text, primary key(job_id,step)
);
create index if not exists discovery_attempt_date on public.crm_discovery_requests(attempted_at);
create table if not exists public.crm_discovery_candidates (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.crm_discovery_jobs(id) on delete restrict,
  domain text not null, website text not null, title text not null default '',
  sources jsonb not null default '[]', data jsonb not null default '{}', score integer not null default 0,
  status text not null default 'waiting' check(status in('waiting','reading','review','imported','duplicate','rejected')),
  error text, client_id uuid references public.clients(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete restrict, reviewed_at timestamptz,
  created_at timestamptz not null default now(), checked_at timestamptz,
  unique(job_id,domain)
);
create table if not exists public.crm_discovery_events (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references public.crm_discovery_jobs(id) on delete restrict,
  candidate_id uuid references public.crm_discovery_candidates(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  action text not null, detail jsonb not null default '{}', at timestamptz not null default now()
);
alter table public.crm_discovery_jobs enable row level security;
alter table public.crm_discovery_requests enable row level security;
alter table public.crm_discovery_candidates enable row level security;
alter table public.crm_discovery_events enable row level security;
revoke all on public.crm_discovery_jobs,public.crm_discovery_requests,public.crm_discovery_candidates,public.crm_discovery_events from public,anon,authenticated;
grant select on public.crm_discovery_jobs,public.crm_discovery_requests,public.crm_discovery_candidates,public.crm_discovery_events to authenticated;
grant all on public.crm_discovery_jobs,public.crm_discovery_requests,public.crm_discovery_candidates,public.crm_discovery_events to service_role;
drop policy if exists discovery_job_read on public.crm_discovery_jobs;
drop policy if exists discovery_request_read on public.crm_discovery_requests;
drop policy if exists discovery_candidate_read on public.crm_discovery_candidates;
drop policy if exists discovery_event_read on public.crm_discovery_events;
create policy discovery_job_read on public.crm_discovery_jobs for select to authenticated using(public.is_active_user() and (requested_by=auth.uid() or public.is_admin()));
create policy discovery_request_read on public.crm_discovery_requests for select to authenticated using(exists(select 1 from public.crm_discovery_jobs j where j.id=job_id));
create policy discovery_candidate_read on public.crm_discovery_candidates for select to authenticated using(exists(select 1 from public.crm_discovery_jobs j where j.id=job_id));
create policy discovery_event_read on public.crm_discovery_events for select to authenticated using(exists(select 1 from public.crm_discovery_jobs j where j.id=job_id));

create or replace function public.crm_discovery_start(p_nonce uuid,p_country text,p_city text,p_groups text[],p_types text[],p_count integer default 20)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare existing uuid; result uuid; words text; qs jsonb:='[]'; n integer; kind text; place text; buyers text;
begin
  if not public.is_active_user() then raise exception '请先登录启用的CRM账号'; end if;
  perform pg_advisory_xact_lock(hashtext('crm_discovery_start'));
  select id into existing from public.crm_discovery_jobs where requested_by=auth.uid() and nonce=p_nonce;
  if found then return existing; end if;
  if p_nonce is null or p_country is null or length(trim(p_country)) not between 2 and 80 or p_country~'[[:cntrl:]]' or length(coalesce(p_city,''))>80 or coalesce(p_city,'')~'[[:cntrl:]]' then raise exception '请填写有效的国家和城市'; end if;
  if p_count is null or p_count not between 5 and 50 or coalesce(cardinality(p_groups),0) not between 1 and 3 or coalesce(cardinality(p_types),0) not between 1 and 4 then raise exception '每任务选择1至3类产品、1至4类买家和5至50家候选上限'; end if;
  if exists(select 1 from unnest(p_groups) g where g is null or g not in('spc','laminate','engineered','wall','acoustic','wpc')) or exists(select 1 from unnest(p_types) t where t is null or t not in('importer','distributor','wholesaler','contractor')) then raise exception '产品或买家类型无效'; end if;
  if (select count(*) from public.crm_discovery_jobs where requested_by=auth.uid() and created_at>now()-interval '24 hours')>=10 then raise exception '每个账号24小时内最多10个搜索任务'; end if;
  if (select count(*) from public.crm_discovery_jobs where requested_by=auth.uid() and status in('queued','running','paused'))>=3 then raise exception '最多保留3个未完成搜索任务，请先完成或取消旧任务'; end if;
  select string_agg('"'||kw||'"',' OR ') into words from (select distinct case g when 'spc' then 'SPC flooring' when 'laminate' then 'laminate flooring' when 'engineered' then 'engineered wood flooring' when 'wall' then 'PVC wall panels" OR "WPC wall panels" OR "UV wall panels" OR "co-extruded wall panels' when 'acoustic' then 'acoustic wall panels' when 'wpc' then 'WPC decking" OR "WPC cladding' end kw from unnest(p_groups) g) x;
  place:=trim(p_country)||case when trim(coalesce(p_city,''))<>'' then ' '||trim(p_city) else '' end;
  n:=least(6,greatest(2,ceil(p_count/10.0)::integer+1));
  select string_agg(case t when 'wholesaler' then 'wholesale' else t end,' OR ') into buyers from unnest(p_types) t;
  qs:=jsonb_build_array('('||words||') ('||buyers||') '||place);
  foreach kind in array p_types loop
    qs:=qs||jsonb_build_array('('||words||') '||case kind when 'wholesaler' then 'wholesale building materials warehouse' when 'contractor' then 'commercial fit out contractor projects' else kind end||' '||place);
  end loop;
  qs:=qs||jsonb_build_array('('||words||') trade supplier distribution warehouse '||place,'('||words||') importer distributor contact company '||place,'('||words||') wholesale projects contact '||place,'('||words||') building materials supplier '||place);
  select jsonb_agg(value order by ordinality) into qs from jsonb_array_elements(qs) with ordinality where ordinality<=n;
  insert into public.crm_discovery_jobs(requested_by,nonce,criteria,queries,target_count) values(auth.uid(),p_nonce,jsonb_build_object('country',trim(p_country),'city',trim(coalesce(p_city,'')),'groups',p_groups,'types',p_types),qs,p_count) returning id into result;
  insert into public.crm_discovery_events(job_id,actor_id,action) values(result,auth.uid(),'request');
  return result;
end $$;

-- Claim and reserve BEFORE any external request. An expired/ambiguous search is
-- accounted for once and never replayed. One global lease protects free Reader RPM.
create or replace function public.crm_discovery_claim()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.crm_discovery_jobs; c public.crm_discovery_candidates; token uuid; step integer; q text;
begin
  perform pg_advisory_xact_lock(hashtext('crm_discovery_worker'));
  if exists(select 1 from public.crm_discovery_jobs where status='running' and lease_until>now()) then return null; end if;
  select * into j from public.crm_discovery_jobs where status in('queued','running') and (lease_until is null or lease_until<=now()) order by updated_at,created_at for update skip locked limit 1;
  if not found then return null; end if;
  if not exists(select 1 from public.profiles where id=j.requested_by and active) then
    update public.crm_discovery_jobs set status='cancelled',error='提交账号已停用',finished_at=now(),lease_until=null,lease_token=null where id=j.id; return null;
  end if;
  update public.crm_discovery_requests set status='unknown',finished_at=now(),error='上次处理未确认结果；已计入尝试，不自动重试' where job_id=j.id and status='started';
  update public.crm_discovery_candidates set status='review',error='上次网页读取中断，请人工查看来源' where job_id=j.id and status='reading';
  token:=gen_random_uuid();
  if j.search_cursor<jsonb_array_length(j.queries) then
    if (select count(*) from public.crm_discovery_requests where attempted_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')>=900 then
      update public.crm_discovery_jobs set status='paused',error='本系统当月900次搜索尝试额度已用完；不自动付费',lease_until=null,lease_token=null,updated_at=now() where id=j.id; return null;
    end if;
    step:=j.search_cursor; q:=j.queries->>step;
    insert into public.crm_discovery_requests(job_id,step,query) values(j.id,step,q);
    update public.crm_discovery_jobs set status='running',search_cursor=search_cursor+1,lease_token=token,lease_until=now()+interval '90 seconds',updated_at=now(),error=null where id=j.id;
    return jsonb_build_object('kind','search','job',to_jsonb(j),'lease',token,'step',step,'query',q);
  end if;
  select * into c from public.crm_discovery_candidates where job_id=j.id and status='waiting' order by score desc,created_at,id for update skip locked limit 1;
  if not found then
    update public.crm_discovery_jobs set status='completed',finished_at=now(),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
    return null;
  end if;
  update public.crm_discovery_candidates set status='reading' where id=c.id;
  update public.crm_discovery_jobs set status='running',lease_token=token,lease_until=now()+interval '90 seconds',updated_at=now() where id=j.id;
  return jsonb_build_object('kind','read','job',to_jsonb(j),'candidate',to_jsonb(c),'lease',token);
end $$;

create or replace function public.crm_discovery_finish(p_job uuid,p_lease uuid,p_kind text,p_step integer default null,p_candidate uuid default null,p_result jsonb default '{}',p_error text default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.crm_discovery_jobs; item jsonb; existing uuid;
begin
  select * into j from public.crm_discovery_jobs where id=p_job for update;
  if not found or j.status<>'running' or j.lease_token is distinct from p_lease then return false; end if;
  if not exists(select 1 from public.profiles where id=j.requested_by and active) then
    update public.crm_discovery_jobs set status='cancelled',lease_token=null,lease_until=null,error='账号已停用',finished_at=now() where id=j.id; return false;
  end if;
  if p_kind='search' then
    if not exists(select 1 from public.crm_discovery_requests where job_id=j.id and step=p_step and status='started') then raise exception '搜索尝试状态已变化'; end if;
    if p_error is null then
      for item in select value from jsonb_array_elements(coalesce(p_result->'results','[]')) limit 20 loop
        select id into existing from public.crm_discovery_candidates where job_id=j.id and domain=item->>'domain';
        if found then
          update public.crm_discovery_candidates set sources=case when jsonb_array_length(sources)<6 then sources||jsonb_build_array(item->'source') else sources end,score=greatest(score,coalesce((item->>'score')::integer,0)) where id=existing;
        elsif (select count(*) from public.crm_discovery_candidates where job_id=j.id)<j.target_count then
          insert into public.crm_discovery_candidates(job_id,domain,website,title,sources,data,score) values(j.id,item->>'domain',item->>'website',left(item->>'title',300),jsonb_build_array(item->'source'),coalesce(item->'data','{}'),coalesce((item->>'score')::integer,0));
        end if;
      end loop;
    end if;
    update public.crm_discovery_requests set status=case when p_error is null then 'completed' else 'failed' end,finished_at=now(),error=left(p_error,500) where job_id=j.id and step=p_step;
  elsif p_kind='read' then
    update public.crm_discovery_candidates set status='review',data=case when p_error is null then p_result else data end,score=case when p_error is null then coalesce((p_result->>'score')::integer,score) else score end,checked_at=now(),error=left(p_error,500) where id=p_candidate and job_id=j.id and status='reading';
  else raise exception '无效的搜索阶段'; end if;
  update public.crm_discovery_jobs set lease_token=null,lease_until=null,updated_at=now(),error=case when p_error is not null then left(p_error,500) else error end where id=j.id;
  return true;
end $$;

create or replace function public.crm_discovery_state(p_job uuid,p_state text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.crm_discovery_jobs;
begin
  select * into j from public.crm_discovery_jobs where id=p_job for update;
  if not found or not public.is_active_user() or (j.requested_by<>auth.uid() and not public.is_admin()) then raise exception '无权操作搜索任务'; end if;
  if p_state not in('paused','queued','cancelled') or j.status in('completed','cancelled') then raise exception '此任务不可进行该操作'; end if;
  update public.crm_discovery_requests set status='unknown',finished_at=now(),error='用户暂停或取消期间请求可能已提交，不自动重复搜索' where job_id=j.id and status='started';
  update public.crm_discovery_candidates set status='review',error='用户暂停期间网页读取中断，请人工核实' where job_id=j.id and status='reading';
  if p_state='cancelled' then
    update public.crm_discovery_candidates set status='review',error='任务已取消，未读取此候选官网；请人工打开搜索来源核实' where job_id=j.id and status='waiting';
  end if;
  update public.crm_discovery_jobs set status=p_state,lease_token=null,lease_until=null,updated_at=now(),error=null,finished_at=case when p_state='cancelled' then now() else null end where id=j.id;
  insert into public.crm_discovery_events(job_id,actor_id,action) values(j.id,auth.uid(),p_state);
end $$;

create or replace function public.crm_discovery_import(p_candidate uuid,p_data jsonb,p_pool boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.crm_discovery_candidates; j public.crm_discovery_jobs; d jsonb:=p_data; company text; country text; site text; ph text; cid uuid; own uuid; products text[]; evidence text;
begin
  select * into c from public.crm_discovery_candidates where id=p_candidate for update;
  if not found then raise exception '候选资料不存在'; end if;
  select * into j from public.crm_discovery_jobs where id=c.job_id for update;
  if not public.is_active_user() or (j.requested_by<>auth.uid() and not public.is_admin()) then raise exception '只能审查自己的获客结果'; end if;
  if c.status='imported' then return jsonb_build_object('status','imported','id',c.client_id); end if;
  if c.status not in('review','duplicate') then raise exception '请等待公开资料读取完成后再审查'; end if;
  if p_pool and not public.is_admin() then raise exception '只有老板可以导入公海，业务员导入到自己的客户'; end if;
  if d->>'reviewed' is distinct from 'true' then raise exception '请先核实公司身份、国家和B端采购匹配依据'; end if;
  company:=trim(d->>'company_name'); country:=trim(d->>'country'); evidence:=trim(d->>'evidence'); site:=c.website; ph:=regexp_replace(coalesce(d->>'company_phone',''),'[^0-9]','','g');
  if company is null or length(company) not between 2 and 200 or country is null or length(country) not between 2 and 80 or evidence is null or length(evidence) not between 8 and 2000 then raise exception '请填写核实后的公司名称、国家和采购匹配依据（至少8字）'; end if;
  if d->>'customer_type' is null or d->>'customer_type' not in('importer','distributor','wholesaler','brand','other') then raise exception '请选择经核实的客户类型'; end if;
  if length(coalesce(d->>'company_email',''))>254 or (coalesce(d->>'company_email','')<>'' and not (d->>'company_email'~*'^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$')) or length(coalesce(d->>'company_phone',''))>100 or length(coalesce(d->>'address',''))>1000 then raise exception '联系方式格式或长度无效'; end if;
  if jsonb_typeof(d->'products') is distinct from 'array' then raise exception '请选择已核实的销售产品'; end if;
  select array_agg(distinct value) into products from jsonb_array_elements_text(d->'products');
  if cardinality(products) is null or cardinality(products) not between 1 and 11 or exists(select 1 from unnest(products) v where v not in('laminate','engineered','spc','uv_panel','pvc_fluted','pvc_grille','coex_panel','wpc_panel','pvc_marble','acoustic','wpc_decking')) then raise exception '至少选择一种实际匹配产品'; end if;
  -- Serialize imports across tasks. Keep the original clients_guard duplicate
  -- protection, including matches against clients not visible to this employee.
  perform pg_advisory_xact_lock(hashtext('crm_discovery_import'));
  if exists(select 1 from public.clients x where x.domain=public.norm_domain(site) or (length(ph)>=7 and (x.phone_key=public.phone_key(d->>'company_phone') or x.phone_key2=public.phone_key(d->>'company_phone'))) or (length(public.name_key(company))>3 and x.name_key=public.name_key(company))) then
    update public.crm_discovery_candidates set status='duplicate',reviewed_by=auth.uid(),reviewed_at=now(),error='CRM内已有相同网站、电话或公司名称，已阻止重复导入' where id=c.id;
    insert into public.crm_discovery_events(job_id,candidate_id,actor_id,action) values(j.id,c.id,auth.uid(),'duplicate');
    return jsonb_build_object('status','duplicate');
  end if;
  own:=case when p_pool then null else auth.uid() end;
  insert into public.clients(company_name,country,website,company_email,company_phone,address,customer_type,products,priority,status,owner_id,created_by,tags,source_note,notes)
    values(company,country,site,coalesce(d->>'company_email',''),coalesce(d->>'company_phone',''),coalesce(d->>'address',''),d->>'customer_type',products,'B','未联系',own,auth.uid(),array['自动获客','已人工审查'],
      '自动获客 · '||to_char(now(),'YYYY-MM-DD')||' · 来源 '||site||' · 公开索引：'||left(c.sources::text,5000),
      '人工确认的产品/采购匹配依据：'||evidence||E'\n' ||left(coalesce(d->>'notes',''),3000)||E'\n未证实的进口记录、仓库和采购量仍待确认。') returning id into cid;
  insert into public.crm_records(client_id,kind,data,created_by,updated_by) values(cid,'research',c.data||jsonb_build_object('method','automatic_prospecting','source_job',j.id,'company_name',company,'country',country,'website',site,'search_sources',c.sources,'reviewed_evidence',evidence,'notice','公开资料候选经人工审查导入；进口记录和采购量需另有证据。'),auth.uid(),auth.uid());
  update public.crm_discovery_candidates set status='imported',client_id=cid,error=null,reviewed_by=auth.uid(),reviewed_at=now() where id=c.id;
  insert into public.crm_discovery_events(job_id,candidate_id,actor_id,action,detail) values(j.id,c.id,auth.uid(),'import',jsonb_build_object('client_id',cid,'pool',p_pool,'evidence',evidence));
  insert into public.crm_business_events(client_id,actor_id,action,detail) values(cid,auth.uid(),'discovery_import',jsonb_build_object('job',j.id,'candidate',c.id));
  return jsonb_build_object('status','imported','id',cid);
end $$;

create or replace function public.crm_discovery_reject(p_candidate uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.crm_discovery_candidates;
begin
  select * into c from public.crm_discovery_candidates where id=p_candidate for update;
  if not found or not public.is_active_user() or not exists(select 1 from public.crm_discovery_jobs where id=c.job_id and (requested_by=auth.uid() or public.is_admin())) then raise exception '无权操作此候选'; end if;
  if c.status not in('review','duplicate','rejected') or length(trim(coalesce(p_reason,''))) not between 2 and 500 then raise exception '请在资料读取完成后填写淘汰原因'; end if;
  update public.crm_discovery_candidates set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),error=trim(p_reason) where id=c.id;
  insert into public.crm_discovery_events(job_id,candidate_id,actor_id,action,detail) values(c.job_id,c.id,auth.uid(),'reject',jsonb_build_object('reason',trim(p_reason)));
end $$;
revoke all on function public.crm_discovery_start(uuid,text,text,text[],text[],integer),public.crm_discovery_state(uuid,text),public.crm_discovery_import(uuid,jsonb,boolean),public.crm_discovery_reject(uuid,text),public.crm_discovery_claim(),public.crm_discovery_finish(uuid,uuid,text,integer,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.crm_discovery_start(uuid,text,text,text[],text[],integer),public.crm_discovery_state(uuid,text),public.crm_discovery_import(uuid,jsonb,boolean),public.crm_discovery_reject(uuid,text) to authenticated;
grant execute on function public.crm_discovery_claim(),public.crm_discovery_finish(uuid,uuid,text,integer,uuid,jsonb,text) to service_role;
commit;
