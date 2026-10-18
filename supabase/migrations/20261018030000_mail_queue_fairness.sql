create or replace function public.mail_claim() returns setof public.mail_messages
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
