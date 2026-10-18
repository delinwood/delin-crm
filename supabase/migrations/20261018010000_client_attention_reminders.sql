-- Customer flags and server-owned reminder anchors; no automatic email sending.
begin;
create table if not exists public.client_tracking (
  client_id uuid primary key references public.clients(id) on delete cascade,
  attention_level text not null default '普通' check (attention_level in ('紧急','重要','普通','无效')),
  invalid_reason text not null default '',
  marked_by uuid references public.profiles(id) on delete set null,
  marked_at timestamptz,
  reminder_owner_id uuid,
  email_anchor_at timestamptz
);
create table if not exists public.client_attention_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  company_name text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  old_level text not null,
  new_level text not null,
  reason text not null default '',
  at timestamptz not null default now()
);
alter table public.client_tracking enable row level security;
alter table public.client_attention_events enable row level security;
revoke all on public.client_tracking, public.client_attention_events from anon, authenticated;
grant select on public.client_tracking, public.client_attention_events to authenticated;
drop policy if exists tracking_read on public.client_tracking;
create policy tracking_read on public.client_tracking for select to authenticated using (
  public.is_active_user() and (public.is_admin() or exists (
    select 1 from public.clients c where c.id = client_tracking.client_id and c.owner_id = auth.uid()
  ))
);
drop policy if exists attention_events_read on public.client_attention_events;
create policy attention_events_read on public.client_attention_events for select to authenticated using (
  public.is_active_user() and (public.is_admin() or exists (
    select 1 from public.clients c where c.id = client_attention_events.client_id and c.owner_id = auth.uid()
  ))
);

create or replace function public.sync_client_reminder_owner()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id then
    insert into public.client_tracking (client_id, reminder_owner_id, email_anchor_at)
    values (new.id, new.owner_id, case when new.owner_id is not null then now() end)
    on conflict (client_id) do update set reminder_owner_id = excluded.reminder_owner_id, email_anchor_at = excluded.email_anchor_at;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_client_reminder_owner() from public, anon, authenticated;
drop trigger if exists client_reminder_owner on public.clients;
create trigger client_reminder_owner after insert or update of owner_id on public.clients
for each row execute function public.sync_client_reminder_owner();

-- Existing assigned clients start their first three-day cycle at installation.
insert into public.client_tracking (client_id, reminder_owner_id, email_anchor_at)
select id, owner_id, case when owner_id is not null then now() end from public.clients
on conflict (client_id) do nothing;

create or replace function public.set_client_attention(p_client_id uuid, p_level text, p_reason text default '')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  customer public.clients;
  previous text;
  previous_reason text;
begin
  if not public.is_active_user() then raise exception '账号已停用或未登录' using errcode = '42501'; end if;
  if p_level is null or p_level not in ('紧急','重要','普通','无效') then raise exception '请选择有效的客户标记'; end if;
  if p_level = '无效' and length(trim(coalesce(p_reason,''))) = 0 then raise exception '请填写无效原因'; end if;
  select * into customer from public.clients where id = p_client_id for update;
  if not found or not (public.is_admin() or coalesce(customer.owner_id = auth.uid(), false)) then
    raise exception '只能标记自己负责的客户' using errcode = '42501';
  end if;
  if customer.status = '无效' and p_level <> '无效' then raise exception '此客户已被管理员设为无效，请联系老板恢复'; end if;
  select attention_level, invalid_reason into previous, previous_reason from public.client_tracking where client_id = p_client_id for update;
  if previous = p_level and previous_reason = (case when p_level = '无效' then trim(p_reason) else '' end) then return; end if;
  update public.client_tracking set attention_level = p_level,
    invalid_reason = case when p_level = '无效' then trim(p_reason) else '' end,
    marked_by = auth.uid(), marked_at = now(),
    email_anchor_at = case when previous = '无效' and p_level <> '无效' then
      case when customer.owner_id is not null then now() end else email_anchor_at end
  where client_id = p_client_id;
  insert into public.client_attention_events (client_id, company_name, actor_id, old_level, new_level, reason)
  values (p_client_id, customer.company_name, auth.uid(), coalesce(previous,'普通'), p_level,
    case when p_level = '无效' then trim(p_reason) else '' end);
end;
$$;
revoke all on function public.set_client_attention(uuid,text,text) from public, anon;
grant execute on function public.set_client_attention(uuid,text,text) to authenticated;

create or replace function public.sync_client_email_followup()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare current_owner uuid; sent_at timestamptz;
begin
  if new.channel <> 'email' then return new; end if;
  select owner_id into current_owner from public.clients where id = new.client_id for update;
  if current_owner is null or new.author_id is distinct from current_owner then return new; end if;
  sent_at = case when new.entry_date >= (now() at time zone 'Asia/Shanghai')::date then now()
    else new.entry_date::timestamp at time zone 'Asia/Shanghai' end;
  update public.client_tracking set email_anchor_at = greatest(email_anchor_at, sent_at)
  where client_id = new.client_id and reminder_owner_id = current_owner;
  return new;
end;
$$;
revoke all on function public.sync_client_email_followup() from public, anon, authenticated;
drop trigger if exists client_email_followup on public.follow_ups;
create trigger client_email_followup after insert on public.follow_ups
for each row execute function public.sync_client_email_followup();

create index if not exists client_attention_events_at on public.client_attention_events (at desc);
create index if not exists client_tracking_owner on public.client_tracking (reminder_owner_id);
commit;
