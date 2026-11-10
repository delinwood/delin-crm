-- Mail delivery visibility, WhatsApp reach fields, and manual inquiry sources.
-- Apply once in the Supabase SQL Editor as the project owner, after the boss approves
-- this pull request. Do not run it on production before that approval.
-- The CRM does not apply this file by itself. It does not send mail or call a paid API.
-- Safe to re-run: new columns use IF NOT EXISTS, and functions use CREATE OR REPLACE.
begin;

alter table public.clients add column if not exists timezone text;
alter table public.clients add column if not exists reach_channel text;

-- Existing rows stay valid when timezone and reach channel are empty.
-- A value, once entered, must be a real time zone or one of the known channels.
create or replace function public.crm_guard_reach_profile()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.timezone is not null then
    new.timezone:=btrim(new.timezone);
    if new.timezone='' then new.timezone:=null;
    elsif not exists(select 1 from pg_timezone_names where name=new.timezone) then
      raise exception '请选择有效时区';
    end if;
  end if;
  if new.reach_channel is not null then
    new.reach_channel:=btrim(new.reach_channel);
    if new.reach_channel='' then new.reach_channel:=null;
    elsif new.reach_channel not in('email','whatsapp','phone','other') then
      raise exception '联系渠道不正确';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists crm_guard_reach_profile on public.clients;
create trigger crm_guard_reach_profile before insert or update on public.clients
for each row execute function public.crm_guard_reach_profile();

-- Same wrapping style as deal_note: keep the current view and append the new columns.
do $view$
declare definition text;
begin
  if exists(select 1 from pg_attribute
    where attrelid='public.clients_view'::regclass and attname='timezone' and not attisdropped)
    and exists(select 1 from pg_attribute
    where attrelid='public.clients_view'::regclass and attname='reach_channel' and not attisdropped) then
    return;
  end if;
  select rtrim(pg_get_viewdef('public.clients_view'::regclass), E'; \n') into definition;
  execute 'create or replace view public.clients_view as select v.*, c.timezone, c.reach_channel from ('
    || definition || ') v left join public.clients c on c.id=v.id';
end $view$;

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid='public.crm_inquiries'::regclass and contype='c'
      and pg_get_constraintdef(oid) ilike '%channel%'
  loop
    execute format('alter table public.crm_inquiries drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.crm_inquiries add constraint crm_inquiries_channel_check
  check (channel in ('alibaba','platform','email','exhibition','social','website','other'));

-- Empty client fields may be filled from a disclosed page. Person rows stay in the
-- research record and are saved manually as extra contacts; this function does not invent email.
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
    if field is null or field not in('company_email','company_phone','address','notes','website','whatsapp','contact_name','contact_title') or value='' or length(value)>10000 then
      raise exception '只能采纳页面上已有的邮箱、电话、WhatsApp、联系人、职位、地址、备注或官网';
    end if;
    select x into suggestion from jsonb_array_elements(r.data->'suggestions') x
      where x->>'id'=choice->>'id' and x->>'field'=field and x->'value'=choice->'value' and trim(coalesce(x->>'source_url',''))<>'' and trim(coalesce(x->>'checked_at',''))<>'' limit 1;
    if not found then raise exception '建议与原始来源不一致，请刷新后重新选择'; end if;
    if field='company_email' and (length(value)>320 or value !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9-]+(\.[A-Z0-9-]+)+$') then raise exception '建议邮箱格式不正确'; end if;
    if field='website' and (length(value)>2048 or value !~* '^https?://[^[:space:]]+$') then raise exception '建议官网格式不正确'; end if;
    if field='whatsapp' and (value !~ '^[0-9+(). -]{7,32}$' or length(regexp_replace(value,'\D','','g')) not between 7 and 15) then raise exception '建议的 WhatsApp 号码格式不正确'; end if;
    if field in('contact_name','contact_title') and (length(value)>200 or position('@' in value)>0) then raise exception '联系人或职位不正确'; end if;
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
    contact_linkedin=coalesce(nullif(person.data->>'linkedin',''),contact_linkedin),
    whatsapp=coalesce(nullif(btrim(whatsapp),''), nullif(btrim(coalesce(person.data->>'whatsapp','')),'')) where id=p_client;
  insert into public.crm_business_events(client_id,record_id,actor_id,action,detail) values(p_client,p_contact,auth.uid(),'default_contact',jsonb_build_object('old_email',customer.company_email,'new_email',email,'name',person.data->>'name'));
end;
$$;

-- Names the WhatsApp person without changing the company email or pausing mail.
create or replace function public.crm_set_whatsapp_contact(p_client uuid,p_contact uuid,p_version integer)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare person public.crm_records; phone text; person_name text;
begin
  if public.is_active_user() is not true or not public.crm_client_access(p_client,true) or public.crm_is_archived(p_client) then
    raise exception '只能设置自己负责客户的默认联系人' using errcode='42501';
  end if;
  perform id from public.clients where id=p_client for update;
  if not found or public.crm_client_access(p_client,true) is not true or public.crm_is_archived(p_client) then
    raise exception '账号状态或客户归属已变化，请刷新';
  end if;
  select * into person from public.crm_records where id=p_contact for update;
  if not found or person.kind<>'contact' or person.deleted_at is not null
    or public.crm_effective_client(person.client_id) is distinct from p_client
    or person.version is distinct from p_version then
    raise exception '联系人已变化，请刷新后重试';
  end if;
  person_name:=btrim(coalesce(person.data->>'name',''));
  if length(person_name) not between 1 and 200 then raise exception '请填写联系人姓名'; end if;
  phone:=nullif(btrim(coalesce(nullif(person.data->>'whatsapp',''), person.data->>'phone','')),'');
  update public.clients set
    contact_name=person_name,
    contact_title=coalesce(nullif(btrim(coalesce(person.data->>'role','')),''), contact_title),
    whatsapp=coalesce(phone, whatsapp),
    reach_channel='whatsapp'
  where id=p_client;
  insert into public.crm_business_events(client_id,record_id,actor_id,action,detail)
    values(p_client,p_contact,auth.uid(),'whatsapp_contact',jsonb_build_object('name',person_name,'whatsapp',phone));
end;
$$;

alter table public.client_tracking add column if not exists whatsapp_touch_at timestamptz;
alter table public.client_tracking add column if not exists whatsapp_next_on date;

-- Records a real WhatsApp conversation, or only the next reminder. It never sends a message.
create or replace function public.crm_log_whatsapp_touch(p_client uuid,p_note text,p_next date,p_sync boolean default false)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.clients; note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
  if public.is_active_user() is not true or public.crm_social_is_operator() then
    raise exception '账号无权登记 WhatsApp' using errcode='42501';
  end if;
  select * into c from public.clients where id=p_client for update;
  if not found or c.owner_id is distinct from auth.uid()
    or not exists(select 1 from public.profiles where id=auth.uid() and active and role='sales')
    or c.status='无效' or public.crm_is_archived(p_client)
    or exists(select 1 from public.client_tracking where client_id=p_client and attention_level='无效')
  then raise exception '只能登记自己正在跟进的客户' using errcode='42501'; end if;
  if note is null and p_next is null then raise exception '请填写本次沟通，或选择下次 WhatsApp 日期'; end if;
  if note is not null and length(note)>2000 then raise exception '沟通记录请控制在2000字以内'; end if;
  if p_next is not null and (p_next<(now() at time zone 'Asia/Shanghai')::date or p_next>(now() at time zone 'Asia/Shanghai')::date+730) then
    raise exception '下次 WhatsApp 日期需为今天或两年内';
  end if;
  if note is not null then
    perform public.add_follow_up(p_client,(now() at time zone 'Asia/Shanghai')::date,'whatsapp','WhatsApp：'||note,
      case when coalesce(p_sync,false) and p_next is not null then p_next else c.next_follow_up end,
      case when c.status='未联系' then '已联系' else c.status end);
  elsif coalesce(p_sync,false) and p_next is not null then
    update public.clients set next_follow_up=p_next where id=p_client;
  end if;
  update public.client_tracking set
    whatsapp_touch_at=case when note is not null then now() else whatsapp_touch_at end,
    whatsapp_next_on=coalesce(p_next, whatsapp_next_on)
  where client_id=p_client and reminder_owner_id=auth.uid();
  if not found then
    begin
      insert into public.client_tracking(client_id,reminder_owner_id,whatsapp_touch_at,whatsapp_next_on)
      values(p_client,auth.uid(),case when note is not null then now() end,p_next);
    exception when unique_violation then
      raise exception '追单归属已变化，请刷新';
    end;
  end if;
end;
$$;

-- Sales see a suppression only when they sent to that address or can open the client. The boss sees the list.
create or replace function public.crm_mail_unsubscribes()
returns table(email text, reason text, created_at timestamptz, company_name text, client_id uuid)
language sql stable security definer set search_path=public,pg_temp as $$
  select s.email, s.reason, s.created_at, match.company_name, match.id
  from public.mail_suppressions s
  left join lateral (
    select c.id, c.company_name from public.clients c
    where lower(btrim(c.company_email))=s.email and public.crm_client_access(c.id, false)
    order by c.updated_at desc nulls last
    limit 1
  ) match on true
  where public.is_active_user() and not public.crm_social_is_operator()
    and (
      public.is_admin()
      or match.id is not null
      or exists(select 1 from public.mail_messages m where lower(m.recipient)=s.email and m.sender_id=auth.uid())
    )
  order by s.created_at desc;
$$;

revoke all on function public.crm_apply_research(uuid,jsonb),
  public.crm_set_default_contact(uuid,uuid,integer,text),
  public.crm_set_whatsapp_contact(uuid,uuid,integer),
  public.crm_log_whatsapp_touch(uuid,text,date,boolean),
  public.crm_mail_unsubscribes() from public,anon,authenticated;
grant execute on function public.crm_apply_research(uuid,jsonb),
  public.crm_set_default_contact(uuid,uuid,integer,text),
  public.crm_set_whatsapp_contact(uuid,uuid,integer),
  public.crm_log_whatsapp_touch(uuid,text,date,boolean),
  public.crm_mail_unsubscribes() to authenticated;

commit;
