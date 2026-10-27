begin;
create table if not exists public.crm_reminders(
 id uuid primary key default gen_random_uuid(),user_id uuid not null default auth.uid() references public.profiles(id),
 title text not null check(length(trim(title)) between 1 and 160),content text not null default '' check(length(content)<=3000),
 start_at timestamptz not null,next_at timestamptz not null,
 frequency text not null default 'once' check(frequency in('once','minutes','hours','days','weeks','months','years')),
 every_n integer not null default 1 check(every_n between 1 and 365),
 status text not null default 'active' check(status in('active','paused','completed','deleted')),
 version integer not null default 1,lease_until timestamptz,last_fired_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists crm_reminders_due on public.crm_reminders(user_id,next_at) where status='active';
alter table public.crm_reminders enable row level security;
revoke all on public.crm_reminders from public,anon,authenticated;
grant select on public.crm_reminders to authenticated;
create policy crm_reminders_own_read on public.crm_reminders for select to authenticated using(public.is_active_user() and user_id=auth.uid());
create or replace function public.crm_reminder_next(p_start timestamptz,p_frequency text,p_every integer,p_after timestamptz)
returns timestamptz language plpgsql immutable set search_path=public,pg_temp as $$
declare seconds bigint; n bigint; months integer; base timestamp; candidate timestamp; previous timestamp;
begin
 if p_frequency='once' then return null; end if;
 if p_frequency is null or p_every is null or p_every not between 1 and 365 then raise exception '重复规则无效'; end if;
 if p_start>p_after then return p_start; end if;
 seconds:=case p_frequency when 'minutes' then 60 when 'hours' then 3600 when 'days' then 86400 when 'weeks' then 604800 else null end;
 if seconds is not null then
  seconds:=seconds*p_every;n:=floor(extract(epoch from(p_after-p_start))/seconds)::bigint+1;
  return p_start+make_interval(secs=>(n*seconds)::double precision);
 end if;
 if p_frequency not in('months','years') then raise exception '重复规则无效'; end if;
 months:=p_every*case when p_frequency='years' then 12 else 1 end;
 base:=p_start at time zone 'Asia/Shanghai';previous:=p_after at time zone 'Asia/Shanghai';
 n:=greatest(0,floor(((extract(year from previous)-extract(year from base))*12+extract(month from previous)-extract(month from base))/months)::integer);
 loop
  candidate:=base+make_interval(months=>(n*months)::integer);
  if candidate>previous then return candidate at time zone 'Asia/Shanghai'; end if;n:=n+1;
 end loop;
end;
$$;
create or replace function public.crm_save_reminder(p_data jsonb,p_id uuid default null,p_version integer default null)
returns public.crm_reminders language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crm_reminders; starttime timestamptz; freq text; n integer; titletext text;
begin
 if public.is_active_user() is not true then raise exception '请先登录有效账号' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('crm-reminders:'||auth.uid()::text,0));
 titletext:=trim(p_data->>'title');freq:=coalesce(p_data->>'frequency','once');n:=coalesce((p_data->>'every_n')::integer,1);starttime:=(p_data->>'start_at')::timestamptz;
 if titletext is null or length(titletext) not between 1 and 160 or starttime is null or starttime<now()-interval '10 years' or starttime>now()+interval '10 years' or n not between 1 and 365 or freq not in('once','minutes','hours','days','weeks','months','years') then raise exception '请检查标题、日期与重复频率'; end if;
 if p_id is null then
  if(select count(*) from public.crm_reminders where user_id=auth.uid() and status<>'deleted')>=200 then raise exception '每个账号最多保存200项提醒，请清理已完成事项'; end if;
  insert into public.crm_reminders(user_id,title,content,start_at,next_at,frequency,every_n)
   values(auth.uid(),titletext,coalesce(p_data->>'content',''),starttime,starttime,freq,n) returning * into r;
 else
  update public.crm_reminders set title=titletext,content=coalesce(p_data->>'content',''),start_at=starttime,next_at=starttime,frequency=freq,every_n=n,status='active',lease_until=null,version=version+1,updated_at=now()
   where id=p_id and user_id=auth.uid() and version=p_version and status<>'deleted' returning * into r;
  if not found then raise exception '提醒已变化或不属于你，请刷新后重试' using errcode='42501'; end if;
 end if;return r;
end;
$$;
create or replace function public.crm_claim_reminders()
returns setof public.crm_reminders language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if public.is_active_user() is not true then return; end if;
 return query with picked as(select id from public.crm_reminders where user_id=auth.uid() and status='active' and next_at<=now() and coalesce(lease_until,'-infinity')<now() order by next_at for update skip locked limit 5)
 update public.crm_reminders r set lease_until=now()+interval '5 minutes',last_fired_at=now() from picked p where r.id=p.id returning r.*;
end;
$$;
create or replace function public.crm_reminder_action(p_id uuid,p_version integer,p_action text,p_minutes integer default 10)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crm_reminders; nexttime timestamptz;
begin
 if public.is_active_user() is not true then raise exception '请先登录有效账号' using errcode='42501'; end if;
 select * into r from public.crm_reminders where id=p_id and user_id=auth.uid() and version=p_version and status<>'deleted' for update;
 if not found then raise exception '提醒已被其他窗口处理，请刷新' using errcode='42501'; end if;
 if p_action='done' then
  nexttime:=public.crm_reminder_next(r.start_at,r.frequency,r.every_n,greatest(now(),r.next_at));
  update public.crm_reminders set next_at=coalesce(nexttime,next_at),status=case when nexttime is null then 'completed' else 'active' end,lease_until=null,version=version+1,updated_at=now() where id=r.id;
 elsif p_action='snooze' then
  if p_minutes is null or p_minutes not in(5,10,30,60) then raise exception '请选择5、10、30或60分钟'; end if;
  update public.crm_reminders set next_at=now()+make_interval(mins=>p_minutes),status='active',lease_until=null,version=version+1,updated_at=now() where id=r.id;
 elsif p_action in('pause','resume','delete') then
  update public.crm_reminders set status=case p_action when 'pause' then 'paused' when 'resume' then 'active' else 'deleted' end,lease_until=null,version=version+1,updated_at=now() where id=r.id;
 else raise exception '操作无效';end if;
end;
$$;
revoke all on function public.crm_reminder_next(timestamptz,text,integer,timestamptz),public.crm_save_reminder(jsonb,uuid,integer),public.crm_claim_reminders(),public.crm_reminder_action(uuid,integer,text,integer) from public,anon,authenticated;
grant execute on function public.crm_save_reminder(jsonb,uuid,integer),public.crm_claim_reminders(),public.crm_reminder_action(uuid,integer,text,integer) to authenticated;
commit;
