begin;
-- Tokens and OAuth state are NEVER exposed to authenticated/anon roles.
create table public.mail_accounts (
  user_id uuid primary key references public.profiles(id),
  email text not null unique, refresh_cipher text not null,
  connected boolean not null default true,
  daily_limit integer not null default 50 check (daily_limit between 1 and 400),
  next_send_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.mail_oauth_states (
  state_hash text primary key, user_id uuid not null references public.profiles(id),
  verifier text not null, expires_at timestamptz not null default now() + interval '10 minutes'
);
create table public.mail_campaigns (
  id uuid primary key, sender_id uuid not null references public.profiles(id),
  name text not null, status text not null default 'running' check (status in ('running','paused','cancelled','completed')),
  created_at timestamptz not null default now()
);
create table public.mail_messages (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.mail_campaigns(id),
  sender_id uuid not null references public.profiles(id), client_id uuid references public.clients(id) on delete set null,
  company_name text not null, recipient text not null, subject text not null, body text not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','unknown','skipped','cancelled','bounced')),
  error text, provider_id text, unsubscribe_hash text unique not null,
  created_at timestamptz not null default now(), attempted_at timestamptz, sent_at timestamptz,
  unique(campaign_id,recipient)
);
create table public.mail_suppressions (
  email text primary key, reason text not null, created_at timestamptz not null default now()
);
create index mail_queue on public.mail_messages(status,created_at);
create index mail_sender_time on public.mail_messages(sender_id,attempted_at);
alter table public.mail_accounts enable row level security;
alter table public.mail_oauth_states enable row level security;
alter table public.mail_campaigns enable row level security;
alter table public.mail_messages enable row level security;
alter table public.mail_suppressions enable row level security;
revoke all on public.mail_accounts,public.mail_oauth_states,public.mail_campaigns,public.mail_messages,public.mail_suppressions from public,anon,authenticated;
grant select on public.mail_campaigns,public.mail_messages to authenticated;
create policy mail_campaign_read on public.mail_campaigns for select to authenticated using (public.is_active_user() and (sender_id=auth.uid() or public.is_admin()));
create policy mail_message_read on public.mail_messages for select to authenticated using (public.is_active_user() and (sender_id=auth.uid() or public.is_admin()));
grant all on public.mail_accounts,public.mail_oauth_states,public.mail_campaigns,public.mail_messages,public.mail_suppressions to service_role;

-- Serializes overlapping submissions for one sender; all checks are authoritative.
create function public.mail_enqueue(p_sender uuid,p_id uuid,p_name text,p_messages jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.mail_accounts; m jsonb; c public.clients; n integer;
begin
  select * into a from public.mail_accounts where user_id=p_sender and connected for update;
  if not found then raise exception '请先连接 Gmail'; end if;
  if not exists(select 1 from public.profiles where id=p_sender and active) then raise exception '账号不可用'; end if;
  if exists(select 1 from public.mail_campaigns where id=p_id and sender_id=p_sender) then return p_id; end if;
  n:=jsonb_array_length(p_messages);
  if n<1 or n>400 then raise exception '单次仅允许1至400封'; end if;
  insert into public.mail_campaigns(id,sender_id,name) values(p_id,p_sender,left(p_name,120));
  -- Consistent advisory locks prevent simultaneous senders from duplicating a recipient.
  perform pg_advisory_xact_lock(hashtextextended(value->>'recipient',0))
    from jsonb_array_elements(p_messages) order by value->>'recipient';
  for m in select value from jsonb_array_elements(p_messages) loop
    select * into c from public.clients where id=(m->>'client_id')::uuid for share;
    if not found or not (coalesce(c.owner_id=p_sender,false) or exists(select 1 from public.profiles where id=p_sender and role='admin' and active)) then
      raise exception '客户归属已变化，请重新预览';
    end if;
    if c.status='无效' or exists(select 1 from public.client_tracking where client_id=c.id and attention_level='无效') then raise exception '不能发送无效客户'; end if;
    if lower(trim(c.company_email)) is distinct from m->>'recipient' then raise exception '邮箱已变化，请重新预览'; end if;
    if exists(select 1 from public.mail_suppressions where email=m->>'recipient') then raise exception '客户已退订或退信'; end if;
    if exists(select 1 from public.mail_messages where recipient=m->>'recipient' and
      (status in ('queued','sending') or (status in ('sent','unknown','bounced') and coalesce(attempted_at,created_at)>now()-interval '24 hours'))) then
      raise exception '客户已在队列或24小时内已发送，请勿重复发送';
    end if;
    if length(m->>'subject') not between 1 and 250 or length(m->>'body') not between 1 and 30000 then raise exception '标题或正文长度不正确'; end if;
    insert into public.mail_messages(id,campaign_id,sender_id,client_id,company_name,recipient,subject,body,unsubscribe_hash)
    values((m->>'id')::uuid,p_id,p_sender,c.id,c.company_name,m->>'recipient',m->>'subject',m->>'body',m->>'unsubscribe_hash');
  end loop;
  return p_id;
end $$;

-- One message per mailbox per minute, rolling 24h quota includes uncertain attempts.
create function public.mail_claim() returns setof public.mail_messages
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.mail_accounts; m public.mail_messages; used integer;
begin
  update public.mail_messages set status='unknown',error='发送状态待核实；请检查发件箱，系统不自动重试' where status='sending' and attempted_at<now()-interval '10 minutes';
  update public.mail_campaigns k set status='completed' where status='running' and not exists(select 1 from public.mail_messages where campaign_id=k.id and status in ('queued','sending'));
  for a in select a0.* from public.mail_accounts a0 where connected and next_send_at<=now()
    and exists(select 1 from public.profiles p where p.id=a0.user_id and p.active)
    and exists(select 1 from public.mail_messages q join public.mail_campaigns k on k.id=q.campaign_id
      where q.sender_id=a0.user_id and q.status='queued' and k.status='running')
    order by next_send_at for update of a0 skip locked limit 3 loop
    if not exists(select 1 from public.profiles where id=a.user_id and active) then continue; end if;
    select count(*) into used from public.mail_messages where sender_id=a.user_id and attempted_at>now()-interval '24 hours';
    if used>=a.daily_limit then
      update public.mail_accounts set next_send_at=(select min(attempted_at)+interval '24 hours 1 second'
        from public.mail_messages where sender_id=a.user_id and attempted_at>now()-interval '24 hours') where user_id=a.user_id;
      continue;
    end if;
    select q.* into m from public.mail_messages q join public.mail_campaigns k on k.id=q.campaign_id
      where q.sender_id=a.user_id and q.status='queued' and k.status='running' order by q.created_at,q.id for update of q skip locked limit 1;
    if not found then continue; end if;
    if exists(select 1 from public.mail_suppressions where email=m.recipient) or not exists(
      select 1 from public.clients c where c.id=m.client_id and c.status<>'无效' and lower(trim(c.company_email))=m.recipient
      and (c.owner_id=a.user_id or exists(select 1 from public.profiles where id=a.user_id and active and role='admin'))
      and not exists(select 1 from public.client_tracking where client_id=c.id and attention_level='无效')) then
      update public.mail_messages set status='skipped',error='已退订、无效、邮箱或归属变化' where id=m.id; continue;
    end if;
    update public.mail_messages set status='sending',attempted_at=now() where id=m.id returning * into m;
    update public.mail_accounts set next_send_at=now()+interval '60 seconds' where user_id=a.user_id;
    return next m;
  end loop;
end $$;

-- Saving Gmail acceptance and resetting reminders are a single transaction.
create function public.mail_finish(p_id uuid,p_provider text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.mail_messages;
begin
  select * into m from public.mail_messages where id=p_id for update;
  if not found or m.status<>'sending' then return; end if;
  update public.mail_messages set status='sent',provider_id=p_provider,sent_at=now(),error=null where id=p_id;
  update public.client_tracking set email_anchor_at=now() where client_id=m.client_id and reminder_owner_id=m.sender_id;
end $$;
revoke all on function public.mail_enqueue(uuid,uuid,text,jsonb),public.mail_claim(),public.mail_finish(uuid,text) from public,anon,authenticated;
grant execute on function public.mail_enqueue(uuid,uuid,text,jsonb),public.mail_claim(),public.mail_finish(uuid,text) to service_role;
commit;
