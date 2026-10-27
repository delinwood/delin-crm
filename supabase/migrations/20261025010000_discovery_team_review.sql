begin;

-- Share public-web prospecting jobs and candidates with active CRM staff so
-- they can review them. Keep job controls and audit details with owner/admin.
drop policy if exists discovery_job_read on public.crm_discovery_jobs;
drop policy if exists discovery_request_read on public.crm_discovery_requests;
drop policy if exists discovery_candidate_read on public.crm_discovery_candidates;
drop policy if exists discovery_event_read on public.crm_discovery_events;

create policy discovery_job_read on public.crm_discovery_jobs
  for select to authenticated using (public.is_active_user());
create policy discovery_request_read on public.crm_discovery_requests
  for select to authenticated using (
    public.is_active_user() and exists (
      select 1 from public.crm_discovery_jobs j where j.id=job_id
    )
  );
create policy discovery_candidate_read on public.crm_discovery_candidates
  for select to authenticated using (
    public.is_active_user() and exists (
      select 1 from public.crm_discovery_jobs j where j.id=job_id
    )
  );
create policy discovery_event_read on public.crm_discovery_events
  for select to authenticated using (
    public.is_active_user() and exists (
      select 1 from public.crm_discovery_jobs j
      where j.id=job_id and (j.requested_by=auth.uid() or public.is_admin())
    )
  );

-- Do not expose task nonces or worker lease tokens to the team.
revoke select on public.crm_discovery_jobs from authenticated;
grant select (
  id, requested_by, criteria, queries, target_count, search_cursor, status,
  created_at, updated_at, finished_at, error
) on public.crm_discovery_jobs to authenticated;

-- Imported customer IDs are private CRM references. Staff can see the shared
-- candidate status, but must use normal client permissions to see the record.
revoke select on public.crm_discovery_candidates from authenticated;
grant select (
  id, job_id, domain, website, title, sources, data, score, status, error,
  created_at, checked_at
) on public.crm_discovery_candidates to authenticated;

create or replace function public.crm_discovery_import(p_candidate uuid,p_data jsonb,p_pool boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.crm_discovery_candidates; j public.crm_discovery_jobs; d jsonb:=p_data; company text; country text; site text; ph text; cid uuid; own uuid; products text[]; evidence text;
begin
  select * into c from public.crm_discovery_candidates where id=p_candidate for update;
  if not found then raise exception '候选资料不存在'; end if;
  select * into j from public.crm_discovery_jobs where id=c.job_id for update;
  if not public.is_active_user() then raise exception '请先登录启用的CRM账号'; end if;
  -- The result list is shared, but the client record and its owner are not.
  if c.status='imported' then return jsonb_build_object('status','imported'); end if;
  if c.status not in('review','duplicate') then raise exception '请等待公开资料读取完成后再审查'; end if;
  if p_pool and not public.is_admin() then raise exception '只有老板可以导入公海，业务员导入到自己的客户'; end if;
  if d->>'reviewed' is distinct from 'true' then raise exception '请先核实公司身份、国家和B端采购匹配依据'; end if;
  company:=trim(d->>'company_name'); country:=trim(d->>'country'); evidence:=trim(d->>'evidence'); site:=c.website; ph:=regexp_replace(coalesce(d->>'company_phone',''),'[^0-9]','','g');
  if company is null or length(company) not between 2 and 200 or country is null or length(country) not between 2 and 80 or evidence is null or length(evidence) not between 8 and 2000 then raise exception '请填写核实后的公司名称、国家和采购匹配依据（至少8字）'; end if;
  if d->>'customer_type' is null or d->>'customer_type' not in('importer','distributor','wholesaler','brand','other') then raise exception '请选择经核实的客户类型'; end if;
  if length(coalesce(d->>'company_email',''))>254 or (coalesce(d->>'company_email','')<>'' and not (d->>'company_email'~*'^[A-Z0-9.!#$%&''*+/=?^_|{}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$')) or length(coalesce(d->>'company_phone',''))>100 or length(coalesce(d->>'address',''))>1000 then raise exception '联系方式格式或长度无效'; end if;
  if jsonb_typeof(d->'products') is distinct from 'array' then raise exception '请选择已核实的销售产品'; end if;
  select array_agg(distinct value) into products from jsonb_array_elements_text(d->'products');
  if cardinality(products) is null or cardinality(products) not between 1 and 11 or exists(select 1 from unnest(products) v where v not in('laminate','engineered','spc','uv_panel','pvc_fluted','pvc_grille','coex_panel','wpc_panel','pvc_marble','acoustic','wpc_decking')) then raise exception '至少选择一种实际匹配产品'; end if;
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
      '人工确认的产品/采购匹配依据：'||evidence||E'\n'||left(coalesce(d->>'notes',''),3000)||E'\n未证实的进口记录、仓库和采购量仍待确认。') returning id into cid;
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
  if not found or not public.is_active_user() then raise exception '无权操作此候选'; end if;
  if c.status not in('review','duplicate','rejected') or length(trim(coalesce(p_reason,''))) not between 2 and 500 then raise exception '请在资料读取完成后填写淘汰原因'; end if;
  update public.crm_discovery_candidates set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),error=trim(p_reason) where id=c.id;
  insert into public.crm_discovery_events(job_id,candidate_id,actor_id,action,detail) values(c.job_id,c.id,auth.uid(),'reject',jsonb_build_object('reason',trim(p_reason)));
end $$;

commit;
