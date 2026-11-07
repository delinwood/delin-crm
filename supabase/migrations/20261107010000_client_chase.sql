begin;
alter table public.client_tracking
  add column if not exists chase_assigned_at timestamptz,
  add column if not exists chase_reply_at timestamptz,
  add column if not exists chase_grace_until timestamptz;

update public.client_tracking t
set chase_assigned_at=coalesce(
      (select max(a.at) from public.audit_log a where a.client_id=c.id and a.action='assign'),
      t.email_anchor_at,c.created_at,now()),
    chase_grace_until=now()+interval '15 days'
from public.clients c
where c.id=t.client_id and c.owner_id=t.reminder_owner_id and t.chase_assigned_at is null;

create or replace function public.sync_client_reminder_owner()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' or new.owner_id is distinct from old.owner_id then
    insert into public.client_tracking(client_id,reminder_owner_id,email_anchor_at,chase_assigned_at)
    values(new.id,new.owner_id,case when new.owner_id is not null then now() end,
           case when new.owner_id is not null then now() end)
    on conflict(client_id) do update set
      reminder_owner_id=excluded.reminder_owner_id,
      email_anchor_at=excluded.email_anchor_at,
      chase_assigned_at=excluded.chase_assigned_at,
      chase_reply_at=null,chase_grace_until=null;
  end if;
  return new;
end $$;

create or replace function public.sync_client_email_followup()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare current_owner uuid; contacted_at timestamptz;
begin
  select owner_id into current_owner from public.clients where id=new.client_id for update;
  if current_owner is null or new.author_id is distinct from current_owner then return new; end if;
  if new.entry_date>(now() at time zone 'Asia/Shanghai')::date then return new; end if;
  contacted_at=case when new.entry_date=(now() at time zone 'Asia/Shanghai')::date then now()
    else new.entry_date::timestamp at time zone 'Asia/Shanghai' end;
  update public.client_tracking set email_anchor_at=greatest(email_anchor_at,contacted_at)
  where client_id=new.client_id and reminder_owner_id=current_owner;
  return new;
end $$;

create or replace function public.crm_mark_chased(p_client uuid,p_channel text,p_note text,p_replied boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.clients; note text:=trim(coalesce(p_note,''));
begin
  select * into c from public.clients where id=p_client for update;
  if not found or c.owner_id is distinct from auth.uid()
    or not exists(select 1 from public.profiles where id=auth.uid() and active and role='sales')
    or c.status in('无效','成交') or public.crm_is_archived(p_client)
    or exists(select 1 from public.client_tracking where client_id=p_client and attention_level='无效')
  then raise exception '只能登记自己正在跟进的客户' using errcode='42501'; end if;
  if p_channel is null or p_channel not in('email','phone','whatsapp','linkedin','wechat','meeting','other')
    or length(note) not between 1 and 2000 or p_replied is null
  then raise exception '请选择联系渠道并填写本次实际沟通内容'; end if;
  perform public.add_follow_up(p_client,(now() at time zone 'Asia/Shanghai')::date,p_channel,
    case when p_replied then '已追单 · 客户已回复：' else '已追单：' end||note,
    c.next_follow_up,case when p_replied and c.status in('未联系','已联系','已回复') then '已回复'
                          when c.status='未联系' then '已联系' else c.status end);
  if p_replied then
    update public.client_tracking set chase_reply_at=now() where client_id=p_client and reminder_owner_id=auth.uid();
  end if;
end $$;
revoke all on function public.crm_mark_chased(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.crm_mark_chased(uuid,text,text,boolean) to authenticated;

-- Only the private scheduler can create a no-session release capability.
create or replace function public.crm_pool_transition_allowed(p_client uuid,p_old uuid,p_new uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.crm_pool_transitions t where t.client_id=p_client
      and t.transaction_id=txid_current()
      and t.previous_owner is not distinct from p_old and t.new_owner is not distinct from p_new
      and ((public.is_active_user() and t.actor_id=auth.uid()) or
           (auth.uid() is null and p_new is null and t.actor_id=p_old))
  );
$$;

create or replace function public.crm_chase_overdue()
returns table(client_id uuid,owner_id uuid,reason text)
language sql stable security definer set search_path=public,pg_temp as $$
  select c.id,c.owner_id,case when clocks.contact_at<=now()-interval '15 days'
    then '系统回收：连续15天未记录联系' else '系统回收：连续90天未收到已登记回复' end
  from public.clients c
  join public.profiles p on p.id=c.owner_id and p.role='sales'
  join public.client_tracking t on t.client_id=c.id and t.reminder_owner_id=c.owner_id
  cross join lateral (
    select max(i.received_at) as replied_at from public.crm_mail_inbound i
    where i.client_id=c.id and i.kind='reply'
  ) inbound
  cross join lateral (
    select greatest(t.chase_assigned_at,t.email_anchor_at,t.chase_reply_at,inbound.replied_at) as contact_at,
           greatest(t.chase_assigned_at,t.chase_reply_at,inbound.replied_at) as reply_at
  ) clocks
  where c.status not in('无效','成交') and t.attention_level<>'无效'
    and t.chase_assigned_at is not null
    and coalesce(t.chase_grace_until,'-infinity')<=now()
    and not public.crm_is_archived(c.id)
    and (clocks.contact_at<=now()-interval '15 days' or clocks.reply_at<=now()-interval '90 days');
$$;

create or replace function public.crm_recycle_overdue_chase()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare candidate record; c public.clients; why text; moved integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('crm_recycle_overdue_chase',0)) then return 0; end if;
  for candidate in select * from public.crm_chase_overdue() order by client_id loop
    perform id from public.mail_plans where client_id=candidate.client_id order by id for update;
    perform id from public.mail_messages where client_id=candidate.client_id and status in('queued','sending') order by id for update;
    select * into c from public.clients where id=candidate.client_id for update;
    if not found or c.owner_id is distinct from candidate.owner_id then continue; end if;
    perform 1 from public.client_tracking where client_id=c.id for update;
    select o.reason into why from public.crm_chase_overdue() o where o.client_id=c.id;
    if not found or exists(select 1 from public.mail_messages where client_id=c.id and status='sending') then continue; end if;

    update public.mail_plans set status='stopped',last_error=why,updated_at=now()
      where client_id=c.id and status in('running','paused');
    update public.mail_messages set status='cancelled',error=why where client_id=c.id and status='queued';
    insert into public.crm_pool_metadata(client_id,pool_kind,return_reason,previous_owner,returned_at)
      values(c.id,'initial',why,c.owner_id,now())
      on conflict(client_id) do update set pool_kind=excluded.pool_kind,return_reason=excluded.return_reason,
        previous_owner=excluded.previous_owner,returned_at=excluded.returned_at;
    insert into public.crm_pool_transitions values(c.id,txid_current(),c.owner_id,c.owner_id,null);
    update public.clients set owner_id=null,next_follow_up=null where id=c.id;
    delete from public.crm_pool_transitions where client_id=c.id and transaction_id=txid_current();
    insert into public.crm_pool_events(client_id,company_name,action,previous_owner,pool_kind,reason)
      values(c.id,c.company_name,'release',c.owner_id,'initial',why);
    moved:=moved+1;
  end loop;
  return moved;
end $$;
revoke all on function public.crm_chase_overdue(),public.crm_recycle_overdue_chase() from public,anon,authenticated;
create extension if not exists pg_cron;
-- 08:15 Beijing time.
select cron.schedule('crm-client-chase-recycle','15 0 * * *','select public.crm_recycle_overdue_chase()');
commit;
