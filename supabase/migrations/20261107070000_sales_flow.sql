begin;

create table public.crm_inquiries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  client_id uuid references public.clients(id) on delete cascade,
  channel text not null check (channel in ('alibaba','exhibition','social','website','other')),
  company text not null check (length(btrim(company)) between 1 and 250),
  website text not null check (length(website)<=500),
  email text not null check (length(email)<=320),
  subject text not null check (length(btrim(subject)) between 1 and 300),
  original text not null check (length(btrim(original)) between 1 and 30000),
  received_at timestamptz not null
);
create index crm_inquiries_owner_time on public.crm_inquiries(owner_id,received_at desc);
create index crm_inquiries_client on public.crm_inquiries(client_id);
alter table public.crm_inquiries enable row level security;
create policy inquiries_read on public.crm_inquiries for select to authenticated using (
  public.is_active_user() and not public.crm_social_is_operator() and
  case when client_id is null then owner_id=auth.uid() or public.is_admin()
  else public.crm_client_access(client_id,true) and not public.crm_is_archived(client_id) end
);
revoke all on public.crm_inquiries from public,anon,authenticated;
grant select on public.crm_inquiries to authenticated;

create table public.crm_inquiry_progress (
  source text not null check (source in ('gmail','manual')),
  inquiry_id uuid not null,
  handled_at timestamptz not null,
  first_response_at timestamptz,
  note text not null check (length(btrim(note)) between 1 and 2000),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key(source,inquiry_id)
);
alter table public.crm_inquiry_progress enable row level security;
create policy inquiry_progress_read on public.crm_inquiry_progress for select to authenticated using (
  (source='manual' and exists(select 1 from public.crm_inquiries m where m.id=inquiry_id)) or
  (source='gmail' and exists(select 1 from public.crm_mail_inbound m where m.id=inquiry_id and m.kind='reply'
    and not public.crm_is_archived(m.client_id)))
);
revoke all on public.crm_inquiry_progress from public,anon,authenticated;
grant select on public.crm_inquiry_progress to authenticated;

create view public.crm_inquiry_inbox with (security_invoker=true) as
select u.*,p.handled_at,p.first_response_at,p.note from (
  select m.id,'manual'::text as source,m.channel,m.client_id,case when m.client_id is null then m.owner_id else c.owner_id end as owner_id,
    m.company,m.website,m.email,m.subject,m.original,m.received_at
  from public.crm_inquiries m left join public.clients c on c.id=m.client_id
  union all
  select g.id,'gmail','gmail',g.client_id,c.owner_id,c.company_name,''::text,g.from_email,
    g.subject,g.body,g.received_at
  from public.crm_mail_inbound g join public.clients c on c.id=public.crm_effective_client(g.client_id)
  where g.kind='reply' and not public.crm_is_archived(g.client_id)
) u left join public.crm_inquiry_progress p on (p.source,p.inquiry_id)=(u.source,u.id);
revoke all on public.crm_inquiry_inbox from public,anon,authenticated;
grant select on public.crm_inquiry_inbox to authenticated;

create function public.crm_inquiry_create(p_channel text,p_company text,p_website text,p_email text,p_subject text,p_original text,p_received timestamptz,p_client uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
  if public.is_active_user() is not true or public.crm_social_is_operator() then
    raise exception '账号无权录入询盘' using errcode='42501';
  end if;
  if p_client is not null then
    perform 1 from public.clients where id=p_client for update;
    if public.crm_client_access(p_client,true) is not true or public.crm_is_archived(p_client)
      or public.crm_effective_client(p_client) is distinct from p_client then
      raise exception '只能关联当前有权处理的客户' using errcode='42501';
    end if;
  end if;
  if p_received is null or p_received>now() then raise exception '收到时间不能晚于现在'; end if;
  insert into public.crm_inquiries(owner_id,client_id,channel,company,website,email,subject,original,received_at)
  values(auth.uid(),p_client,p_channel,btrim(p_company),btrim(p_website),btrim(p_email),btrim(p_subject),p_original,p_received)
  returning id into new_id;
  return new_id;
end $$;

create function public.crm_inquiry_update(p_source text,p_id uuid,p_client uuid,p_note text,p_response timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare client_key uuid; received timestamptz; saved_owner uuid; handled timestamptz:=clock_timestamp();
begin
  if public.is_active_user() is not true or public.crm_social_is_operator() then
    raise exception '账号无权处理询盘' using errcode='42501';
  end if;
  if p_source='gmail' then
    select client_id,received_at into client_key,received from public.crm_mail_inbound where id=p_id and kind='reply' for update;
  elsif p_source='manual' then
    select client_id,received_at,owner_id into client_key,received,saved_owner from public.crm_inquiries where id=p_id for update;
  else raise exception '无效询盘来源';
  end if;
  if not found then raise exception '询盘不存在或不可处理'; end if;
  if client_key is not null then
    perform 1 from public.clients where id=public.crm_effective_client(client_key) for update;
    if public.crm_client_access(client_key,true) is not true or public.crm_is_archived(client_key) then
      raise exception '只能处理当前有权访问的客户询盘' using errcode='42501';
    end if;
  elsif saved_owner is distinct from auth.uid() and public.is_admin() is not true then
    raise exception '只能处理自己负责的询盘' using errcode='42501';
  end if;
  if p_client is not null then
    if p_source<>'manual' or client_key is not null then raise exception '此询盘已有客户档案'; end if;
    perform 1 from public.clients where id=p_client for update;
    if public.crm_client_access(p_client,true) is not true or public.crm_is_archived(p_client)
      or public.crm_effective_client(p_client) is distinct from p_client then
      raise exception '只能关联当前有权处理的客户' using errcode='42501';
    end if;
    update public.crm_inquiries set client_id=p_client where id=p_id;
  end if;
  if p_note is null then
    if p_client is null or p_response is not null then raise exception '请填写处理结果'; end if;
    return;
  end if;
  if p_response is not null and (p_response<received or p_response>handled) then
    raise exception '首次回复时间必须介于收到时间和现在之间';
  end if;
  insert into public.crm_inquiry_progress(source,inquiry_id,handled_at,first_response_at,note,updated_by)
  values(p_source,p_id,handled,p_response,btrim(p_note),auth.uid())
  on conflict(source,inquiry_id) do update set
    first_response_at=coalesce(public.crm_inquiry_progress.first_response_at,excluded.first_response_at),
    note=excluded.note,updated_by=excluded.updated_by;
end $$;

create function public.crm_inquiry_stats(p_since timestamptz)
returns table(total bigint,pending bigint,responded bigint,median_minutes numeric)
language sql stable security invoker set search_path='' as $$
 select count(*),count(*) filter(where handled_at is null),count(first_response_at),
   round((percentile_cont(0.5) within group(order by extract(epoch from first_response_at-received_at)/60))::numeric,1)
 from public.crm_inquiry_inbox where received_at>=p_since
$$;

create table public.crm_purchase_evidence (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  category text not null check (category in ('website','shipment','customer','registry','other')),
  product text not null check (length(btrim(product)) between 1 and 200),
  match text not null check (match in ('match','mismatch','pending')),
  source text not null check (length(btrim(source)) between 1 and 1000),
  detail text not null check (length(btrim(detail)) between 1 and 5000),
  evidence_on date not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null
);
create index crm_purchase_evidence_client_time on public.crm_purchase_evidence(client_id,evidence_on desc);
alter table public.crm_purchase_evidence enable row level security;
create policy evidence_read on public.crm_purchase_evidence for select to authenticated using (
  public.crm_client_access(client_id,true) and not public.crm_is_archived(client_id)
);
create policy evidence_add on public.crm_purchase_evidence for insert to authenticated with check (
  public.crm_client_access(client_id,true) and not public.crm_is_archived(client_id)
  and public.crm_effective_client(client_id)=client_id and created_by=auth.uid() and evidence_on<=current_date
);
revoke all on public.crm_purchase_evidence from public,anon,authenticated;
grant select,insert(client_id,category,product,match,source,detail,evidence_on) on public.crm_purchase_evidence to authenticated;

create table public.crm_order_milestones (
  opportunity_id uuid not null references public.crm_records(id) on delete cascade,
  step text not null check(step in ('spec','deposit','production','inspection','loading','shipping','balance')),
  due_on date,
  done_on date,
  note text not null check(length(note)<=4000),
  quote_id uuid references public.crm_records(id) on delete set null,
  pi_id uuid references public.crm_records(id) on delete set null,
  sample_id uuid references public.samples(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key(opportunity_id,step),
  check (step='spec' or (quote_id is null and pi_id is null and sample_id is null))
);
alter table public.crm_order_milestones enable row level security;
create policy milestones_read on public.crm_order_milestones for select to authenticated using (
  exists(select 1 from public.crm_records r where r.id=opportunity_id and r.kind='opportunity' and r.deleted_at is null
    and public.crm_client_access(r.client_id,true) and not public.crm_is_archived(r.client_id))
);
revoke all on public.crm_order_milestones from public,anon,authenticated;
grant select on public.crm_order_milestones to authenticated;

create function public.crm_order_save_step(p_opportunity uuid,p_step text,p_due date,p_done date,p_note text,
  p_quote uuid,p_pi uuid,p_sample uuid,p_previous timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare deal public.crm_records; saved_at timestamptz; client_key uuid;
begin
  select * into deal from public.crm_records where id=p_opportunity and kind='opportunity' and deleted_at is null;
  if not found then raise exception '找不到商机'; end if;
  client_key:=public.crm_effective_client(deal.client_id);
  perform 1 from public.clients where id=client_key for update;
  select * into deal from public.crm_records where id=p_opportunity and kind='opportunity' and deleted_at is null for update;
  if not found or public.crm_client_access(deal.client_id,true) is not true or public.crm_is_archived(deal.client_id)
    or public.crm_effective_client(deal.client_id) is distinct from client_key then
    raise exception '无权维护此订单' using errcode='42501';
  end if;
  if deal.data->>'order_confirmed' is distinct from 'true' or coalesce(deal.data->>'stage','') not in ('定金','出货') then
    raise exception '请先在商机档案确认真实订单';
  end if;
  select updated_at into saved_at from public.crm_order_milestones where opportunity_id=p_opportunity and step=p_step;
  if saved_at is distinct from p_previous then raise exception '此节点已更新，请刷新后再保存'; end if;
  if p_done>current_date then raise exception '完成日期不能在未来'; end if;
  if p_quote is not null and not exists(select 1 from public.crm_records r where r.id=p_quote and r.kind='document'
    and r.data->>'doc_type'='quote' and r.deleted_at is null and public.crm_effective_client(r.client_id)=client_key)
    then raise exception '请选择同一客户的报价版本'; end if;
  if p_pi is not null and not exists(select 1 from public.crm_records r where r.id=p_pi and r.kind='document'
    and r.data->>'doc_type'='pi' and r.deleted_at is null and public.crm_effective_client(r.client_id)=client_key)
    then raise exception '请选择同一客户的 PI 版本'; end if;
  if p_sample is not null and not exists(select 1 from public.samples r where r.id=p_sample
    and public.crm_effective_client(r.client_id)=client_key) then raise exception '请选择同一客户的寄样记录'; end if;
  insert into public.crm_order_milestones(opportunity_id,step,due_on,done_on,note,quote_id,pi_id,sample_id,updated_by)
  values(p_opportunity,p_step,p_due,p_done,btrim(p_note),p_quote,p_pi,p_sample,auth.uid())
  on conflict(opportunity_id,step) do update set due_on=excluded.due_on,done_on=excluded.done_on,note=excluded.note,
    quote_id=excluded.quote_id,pi_id=excluded.pi_id,sample_id=excluded.sample_id,updated_by=excluded.updated_by,updated_at=clock_timestamp();
end $$;

revoke all on function public.crm_inquiry_create(text,text,text,text,text,text,timestamptz,uuid),
 public.crm_inquiry_update(text,uuid,uuid,text,timestamptz),public.crm_inquiry_stats(timestamptz),
 public.crm_order_save_step(uuid,text,date,date,text,uuid,uuid,uuid,timestamptz) from public,anon;
grant execute on function public.crm_inquiry_create(text,text,text,text,text,text,timestamptz,uuid),
 public.crm_inquiry_update(text,uuid,uuid,text,timestamptz),public.crm_inquiry_stats(timestamptz),
 public.crm_order_save_step(uuid,text,date,date,text,uuid,uuid,uuid,timestamptz) to authenticated;

commit;
