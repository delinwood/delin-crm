begin;
-- crm_save_record never accepts this column. Only server triggers and the boss's
-- reviewed backup restore can write the original attribution snapshot.
alter table public.crm_records add column if not exists report_snapshot jsonb not null default '{}' check(jsonb_typeof(report_snapshot)='object');
create or replace view public.crm_records_view with(security_invoker=true) as
  select r.id,r.client_id,r.kind,r.data,r.version,r.created_by,r.updated_by,r.created_at,r.updated_at,r.deleted_at,
    public.crm_effective_client(r.client_id) as account_id,r.report_snapshot from public.crm_records r where deleted_at is null;
grant select on public.crm_records_view to authenticated;
create or replace function public.crm_capture_business_attribution()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare customer public.clients; person text; evidence text; stamp jsonb;
begin
  if tg_op='UPDATE' then new.report_snapshot:=old.report_snapshot; end if;
  if new.kind<>'opportunity' then return new; end if;
  if coalesce(new.data->>'inquiry_confirmed','false') not in('true','false') then raise exception '请选择是否收到真实询价'; end if;
  if new.data->>'inquiry_confirmed'='true' then
    evidence:=trim(coalesce(new.data->>'inquiry_evidence',''));
    if length(evidence) not between 2 and 4000 or coalesce(new.data->>'inquiry_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception '真实询价需填写客户提出需求的日期和确认依据'; end if;
    if (new.data->>'inquiry_date')::date>(now() at time zone 'Asia/Shanghai')::date then raise exception '询价日期不能是未来日期'; end if;
  end if;
  select * into customer from public.clients where id=public.crm_effective_client(new.client_id);
  if not found then return new; end if;
  select concat(coalesce(nullif(full_name,''),username),' (@',username,')') into person from public.profiles where id=customer.owner_id;
  stamp:=jsonb_build_object('owner_id',customer.owner_id,'owner_name',coalesce(nullif(person,''),'未分配'),
    'country',coalesce(nullif(customer.country,''),'未登记'),'product',coalesce(nullif(new.data->>'product',''),'未关联具体产品'),
    'source',coalesce(nullif(trim(new.data->>'source'),''),'未登记'),'captured_at',now());
  if new.data->>'inquiry_confirmed'='true' and not(new.report_snapshot?'inquiry') then
    new.report_snapshot:=new.report_snapshot||jsonb_build_object('inquiry',stamp);
  end if;
  if new.data->>'order_confirmed'='true' and new.data->>'stage' in('定金','出货') then
    if (new.data->>'order_date')::date>(now() at time zone 'Asia/Shanghai')::date then raise exception '已确认订单日期不能是未来日期'; end if;
    if not(new.report_snapshot?'order') then new.report_snapshot:=new.report_snapshot||jsonb_build_object('order',stamp); end if;
  end if;
  return new;
end;
$$;
revoke all on function public.crm_capture_business_attribution() from public,anon,authenticated;
drop trigger if exists crm_business_attribution on public.crm_records;
create trigger crm_business_attribution before insert or update on public.crm_records for each row execute function public.crm_capture_business_attribution();

create or replace function public.crm_set_default_contact(p_client uuid,p_contact uuid,p_version integer,p_current_email text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare customer public.clients; person public.crm_records; email text;
begin
  if not public.crm_client_access(p_client,true) or public.crm_is_archived(p_client) then raise exception '只能设置自己负责客户的默认联系人' using errcode='42501'; end if;
  perform id from public.mail_plans where public.crm_effective_client(client_id)=p_client order by id for update;
  select * into customer from public.clients where id=p_client for update;
  if not found or public.crm_client_access(p_client,true) is not true or public.crm_is_archived(p_client) then raise exception '账号状态或客户归属已变化，请刷新'; end if;
  select * into person from public.crm_records where id=p_contact for update;
  if not found or person.kind<>'contact' or person.deleted_at is not null or public.crm_effective_client(person.client_id) is distinct from p_client or person.version is distinct from p_version then raise exception '联系人已变化，请刷新后重试'; end if;
  email:=lower(trim(coalesce(person.data->>'email','')));
  if email !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)+$' then raise exception '请先填写有效的联系人邮箱'; end if;
  if lower(trim(coalesce(customer.company_email,''))) is distinct from lower(trim(coalesce(p_current_email,''))) then raise exception '默认邮箱已被其他人修改，请刷新核对'; end if;
  if exists(select 1 from public.mail_messages where public.crm_effective_client(client_id)=p_client and status='sending') then raise exception '该公司仍有邮件正在发送，请待发送结束后修改默认联系人'; end if;
  update public.mail_plans set status='paused',last_error='默认发信联系人已更改，请核对后重新创建计划' where public.crm_effective_client(client_id)=p_client and status='running';
  update public.mail_messages set status='cancelled',error='默认发信联系人已更改，请重新预览' where public.crm_effective_client(client_id)=p_client and status='queued';
  update public.clients set company_email=email,contact_name=person.data->>'name',
    contact_title=coalesce(nullif(person.data->>'role',''),contact_title),
    contact_linkedin=coalesce(nullif(person.data->>'linkedin',''),contact_linkedin) where id=p_client;
  insert into public.crm_business_events(client_id,record_id,actor_id,action,detail) values(p_client,p_contact,auth.uid(),'default_contact',jsonb_build_object('old_email',customer.company_email,'new_email',email,'name',person.data->>'name'));
end;
$$;
revoke all on function public.crm_set_default_contact(uuid,uuid,integer,text) from public,anon;
grant execute on function public.crm_set_default_contact(uuid,uuid,integer,text) to authenticated;

create or replace function public.crm_business_report(p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if not public.is_active_user() or not public.is_admin() then raise exception '仅老板可查看团队成交分析' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>3660 then raise exception '请选择有效日期范围，最多10年'; end if;
  with opportunities as (
    select r.*,c.owner_id,c.country,c.source_note from public.crm_records r
      join public.clients c on c.id=public.crm_effective_client(r.client_id)
      where r.kind='opportunity' and r.deleted_at is null
  ), activity as (
    select 'inquiry'::text as kind, r.id::text as event_id,public.crm_effective_client(r.client_id) as client_id,
      coalesce(nullif(r.report_snapshot#>>'{inquiry,owner_name}',''),'未分配') as owner,
      coalesce(nullif(r.report_snapshot#>>'{inquiry,country}',''),'未登记') as country,
      coalesce(nullif(r.report_snapshot#>>'{inquiry,product}',''),'未关联具体产品') as product,
      coalesce(nullif(r.report_snapshot#>>'{inquiry,source}',''),'未登记') as source
    from opportunities r where (case when r.data->>'inquiry_confirmed'='true' and coalesce(r.data->>'inquiry_date','')~'^\d{4}-\d{2}-\d{2}$' then (r.data->>'inquiry_date')::date end) between p_from and p_to
    union all
    select 'reply',i.id::text,public.crm_effective_client(i.client_id),case when p.id is null then '未分配' else concat(coalesce(nullif(p.full_name,''),p.username),' (@',p.username,')') end,coalesce(nullif(c.country,''),'未登记'),'未关联具体产品',coalesce(nullif(c.source_note,''),'未登记')
      from public.crm_mail_inbound i join public.clients c on c.id=public.crm_effective_client(i.client_id)
      left join public.profiles p on p.id=i.sender_id where i.kind='reply' and (i.received_at at time zone 'Asia/Shanghai')::date between p_from and p_to
    union all
    select 'sample',s.id::text,public.crm_effective_client(s.client_id),case when p.id is null then '未分配' else concat(coalesce(nullif(p.full_name,''),p.username),' (@',p.username,')') end,coalesce(nullif(c.country,''),'未登记'),'未关联具体产品',coalesce(nullif(c.source_note,''),'未登记')
      from public.samples s join public.clients c on c.id=public.crm_effective_client(s.client_id)
      left join public.profiles p on p.id=s.author_id where s.status in('已寄出','已签收','已反馈') and s.sent_date between p_from and p_to
  ), dimensions as (
    select a.*,v.dimension,v.label from activity a cross join lateral(values('owner',a.owner),('country',a.country),('product',a.product),('source',a.source)) v(dimension,label)
  ), activity_groups as (
    select dimension,label,count(distinct client_id) filter(where kind='reply') as reply_clients,
      count(*) filter(where kind='reply') as replies,count(*) filter(where kind='inquiry') as inquiries,
      count(*) filter(where kind='sample') as samples from dimensions group by dimension,label
  ), orders as (
    select r.*,coalesce(nullif(r.report_snapshot#>>'{order,owner_name}',''),'未分配') as owner,
      coalesce(nullif(r.report_snapshot#>>'{order,country}',''),'未登记') as order_country,
      coalesce(nullif(r.report_snapshot#>>'{order,product}',''),'未关联具体产品') as product,
      coalesce(nullif(r.report_snapshot#>>'{order,source}',''),'未登记') as source
    from opportunities r where (case when r.data->>'order_confirmed'='true' and r.data->>'stage' in('定金','出货')
      and coalesce(r.data->>'order_date','')~'^\d{4}-\d{2}-\d{2}$' then (r.data->>'order_date')::date end) between p_from and p_to
  ), order_groups as (
    select v.dimension,v.label,r.data->>'currency' as currency,count(*) as orders,
      sum(coalesce(nullif(r.data->>'amount','')::numeric,0)) as amount,
      sum(coalesce(nullif(r.data->>'deposit','')::numeric,0)) as deposit,
      count(*) filter(where nullif(r.data->>'cost','') is not null) as known_cost,
      sum(case when nullif(r.data->>'cost','') is not null then coalesce(nullif(r.data->>'amount','')::numeric,0)-(r.data->>'cost')::numeric else 0 end) as margin
    from orders r cross join lateral(values('owner',r.owner),('country',r.order_country),('product',r.product),('source',r.source)) v(dimension,label)
    group by v.dimension,v.label,r.data->>'currency'
  ) select jsonb_build_object('from',p_from,'to',p_to,'generated_at',now(),
    'activity',coalesce((select jsonb_agg(to_jsonb(a) order by dimension,label) from activity_groups a),'[]'),
    'orders',coalesce((select jsonb_agg(to_jsonb(a) order by dimension,label,currency) from order_groups a),'[]'),
    'totals',jsonb_build_object('reply_clients',(select count(distinct client_id) from activity where kind='reply'),
      'replies',(select count(*) from activity where kind='reply'),'inquiries',(select count(*) from activity where kind='inquiry'),
      'samples',(select count(*) from activity where kind='sample'),'orders',(select count(*) from orders))) into result;
  return result;
end;
$$;
revoke all on function public.crm_business_report(date,date) from public,anon;
grant execute on function public.crm_business_report(date,date) to authenticated;
commit;
