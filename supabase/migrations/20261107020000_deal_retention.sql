begin;

alter table public.clients add column if not exists deal_note text;

-- Keep the existing directory columns, query and view options.
do $view$
declare definition text;
begin
  if not exists (select 1 from pg_attribute
    where attrelid='public.clients_view'::regclass and attname='deal_note' and not attisdropped) then
    select rtrim(pg_get_viewdef('public.clients_view'::regclass), E'; \n') into definition;
    execute 'create or replace view public.clients_view as select v.*, c.deal_note from ('
      || definition || ') v left join public.clients c on c.id=v.id';
  end if;
end $view$;

create or replace function public.crm_guard_deal_retention()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' then
    if old.status='成交' and old.owner_id is not null and new.owner_id is null then
      raise exception '已成交客户保留负责人，不能退回公海';
    end if;
    if new.status is not distinct from old.status and new.deal_note is not distinct from old.deal_note then
      return new;
    end if;
  end if;
  if new.status='成交' then
    if new.owner_id is null then raise exception '请为已成交客户指定负责人'; end if;
    new.deal_note := regexp_replace(coalesce(new.deal_note,''), '^[[:space:]　]+|[[:space:]　]+$', '', 'g');
    if length(new.deal_note) not between 1 and 2000 then
      raise exception '请填写成交说明（1至2000字）';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists crm_guard_deal_retention on public.clients;
create trigger crm_guard_deal_retention before insert or update of status,owner_id,deal_note
on public.clients for each row execute function public.crm_guard_deal_retention();

-- Reuse the normal follow-up permission and recording path in the same transaction.
create or replace function public.crm_add_deal_follow_up(
  p_client uuid,p_date date,p_channel text,p_content text,p_next date,p_note text
) returns void language plpgsql set search_path=public,pg_temp as $$
begin
  if not public.is_active_user() then raise exception '请登录启用的账号'; end if;
  if length(regexp_replace(coalesce(p_note,''), '^[[:space:]　]+|[[:space:]　]+$', '', 'g')) not between 1 and 2000 then
    raise exception '请填写成交说明（1至2000字）';
  end if;
  update public.clients set deal_note=p_note where id=p_client
    and (owner_id=auth.uid() or public.is_admin()) and not public.crm_is_archived(p_client);
  if not found then raise exception '只能登记有权限且未归档的客户' using errcode='42501'; end if;
  perform public.add_follow_up(p_client,p_date,p_channel,p_content,p_next,'成交');
end $$;
revoke all on function public.crm_add_deal_follow_up(uuid,date,text,text,date,text) from public,anon;
grant execute on function public.crm_add_deal_follow_up(uuid,date,text,text,date,text) to authenticated;

create or replace function public.crm_chase_overdue()
returns table(client_id uuid,owner_id uuid,reason text)
language sql stable security definer set search_path=public,pg_temp as $$
  select c.id,c.owner_id,'系统回收：连续30天未记录联系'::text
  from public.clients c
  join public.profiles p on p.id=c.owner_id and p.role='sales'
  join public.client_tracking t on t.client_id=c.id and t.reminder_owner_id=c.owner_id
  cross join lateral (
    select max(i.received_at) as replied_at from public.crm_mail_inbound i
    where i.client_id=c.id and i.kind='reply'
  ) inbound
  where c.status not in('无效','成交') and t.attention_level<>'无效'
    and t.chase_assigned_at is not null
    and coalesce(t.chase_grace_until,'-infinity')<=now()
    and not public.crm_is_archived(c.id)
    and greatest(t.chase_assigned_at,t.email_anchor_at,t.chase_reply_at,inbound.replied_at)<=now()-interval '30 days';
$$;
-- Former owners can review their own releases after someone else claims the customer.
drop policy if exists pool_own_release_read on public.crm_pool_events;
create policy pool_own_release_read on public.crm_pool_events for select to authenticated
using (public.is_active_user() and action='release' and previous_owner=auth.uid());

notify pgrst, 'reload schema';
commit;
