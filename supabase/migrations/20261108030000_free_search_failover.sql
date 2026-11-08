begin;
-- Free-provider failover for automatic prospecting.
-- The Tavily company-wide monthly cap is copied from the claim function that is
-- already installed (900 on main, 980 if the open cap migration ran first).
-- This file does not choose between those numbers. Backup providers have their
-- own free budgets and do not consume the Tavily cap. Nothing here enables
-- payment, auto-reload, or a paid fallback.
-- SearXNG is inserted as an inactive registry row and is not in the failover
-- chain. Companies House is not a discovery search provider.

alter table public.crm_discovery_requests
  add column if not exists provider text;

alter table public.crm_discovery_requests
  drop constraint if exists crm_discovery_requests_provider_check;
alter table public.crm_discovery_requests
  add constraint crm_discovery_requests_provider_check
  check (provider is null or provider in ('tavily','firecrawl','serpapi','brave','searxng','reserved'));

create table if not exists public.crm_search_providers (
  id text primary key,
  display_name text not null,
  sort_order integer not null unique,
  monthly_attempt_cap integer check (monthly_attempt_cap is null or monthly_attempt_cap >= 0),
  in_failover boolean not null default false,
  active boolean not null default true,
  exhausted_until timestamptz,
  unit text not null default '次',
  note text not null default ''
);

create table if not exists public.crm_search_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.crm_discovery_jobs(id) on delete restrict,
  step integer,
  provider text not null check (provider in ('tavily','firecrawl','serpapi','brave','searxng')),
  kind text not null check (kind in ('search','scrape')),
  weight integer not null check (weight between 1 and 20),
  counts_as_attempt boolean not null default true,
  status text not null default 'started' check (status in ('started','completed','failed','unknown')),
  attempted_at timestamptz not null default now(),
  finished_at timestamptz,
  error text
);
create index if not exists crm_search_attempts_provider_month on public.crm_search_attempts(provider, attempted_at);
create unique index if not exists crm_search_attempts_step_provider
  on public.crm_search_attempts(job_id, step, provider, kind) where step is not null;

alter table public.crm_search_providers enable row level security;
alter table public.crm_search_attempts enable row level security;
revoke all on public.crm_search_providers, public.crm_search_attempts from public, anon, authenticated;
grant all on public.crm_search_providers, public.crm_search_attempts to service_role;

do $cap$
declare src text; cap integer; matched text[];
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'crm_discovery_claim'
  order by pg_get_function_identity_arguments(p.oid)
  limit 1;
  if src is null then
    raise exception '现有 crm_discovery_claim 不存在，无法读取 Tavily 月度尝试上限';
  end if;
  if src ~ '>=\s*980' then cap := 980;
  elsif src ~ '>=\s*900' then cap := 900;
  else
    matched := regexp_match(src, '>=\s*([0-9]+)');
    if matched is not null then cap := matched[1]::integer; end if;
  end if;
  if cap is null or cap < 1 or cap > 1000 then
    raise exception '无法从现有 crm_discovery_claim 读取 Tavily 月度尝试上限';
  end if;
  insert into public.crm_search_providers(id, display_name, sort_order, monthly_attempt_cap, in_failover, active, unit, note)
  values ('tavily','Tavily Free',10,cap,true,true,'次','沿用已安装的公司月度搜索尝试上限；只接受免费计划且按量付费关闭。')
  on conflict (id) do update set monthly_attempt_cap = excluded.monthly_attempt_cap, display_name = excluded.display_name, unit = excluded.unit, note = excluded.note;
end
$cap$;

insert into public.crm_search_providers(id, display_name, sort_order, monthly_attempt_cap, in_failover, active, unit, note)
values
  ('firecrawl','Firecrawl Free',20,1000,true,true,'积分','免费计划每月1000积分。搜索10条按2积分计入，官网抓取备份按1积分计入。不用增购或自动充值。'),
  ('serpapi','SerpAPI Free',30,250,true,true,'次','免费计划每月250次。免费次数用尽后停止，不使用增购次数。'),
  ('brave','Brave Search',40,1000,true,true,'次','只使用约1000次免费额度。CRM不开启自动充值。存储许可关闭时不保存摘录。'),
  ('searxng','SearXNG',50,null,false,false,'次','扩展位：本版不请求自建 SearXNG。')
on conflict (id) do update set display_name = excluded.display_name, sort_order = excluded.sort_order, monthly_attempt_cap = excluded.monthly_attempt_cap, in_failover = excluded.in_failover, active = excluded.active, unit = excluded.unit, note = excluded.note;

create or replace function public.crm_search_used(p_provider text)
returns integer language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce((
    select sum(weight)::integer from public.crm_search_attempts
    where provider = p_provider and counts_as_attempt
      and attempted_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
  ), 0) + case when p_provider = 'tavily' then (
    select count(*)::integer from public.crm_discovery_requests
    where provider is null
      and attempted_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
  ) else 0 end;
$$;
revoke all on function public.crm_search_used(text) from public, anon, authenticated;
grant execute on function public.crm_search_used(text) to service_role;

create or replace function public.crm_discovery_provider_quota()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.display_name,
    'limit', p.monthly_attempt_cap,
    'remaining', case when p.monthly_attempt_cap is null then null else greatest(0, p.monthly_attempt_cap - public.crm_search_used(p.id)) end,
    'unit', p.unit,
    'in_failover', p.in_failover,
    'exhausted', p.exhausted_until is not null and p.exhausted_until > now(),
    'note', p.note
  ) order by p.sort_order), '[]'::jsonb)
  from public.crm_search_providers p
  where p.in_failover;
$$;
revoke all on function public.crm_discovery_provider_quota() from public, anon, authenticated;
grant execute on function public.crm_discovery_provider_quota() to service_role;

create or replace function public.crm_lookup_quota()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare providers jsonb;
begin
  if not public.is_active_user() then
    raise exception '请登录启用的账号' using errcode='42501';
  end if;
  providers := public.crm_discovery_provider_quota();
  return jsonb_build_object(
    'discovery_remaining', (
      select (item->>'remaining')::integer from jsonb_array_elements(providers) item where item->>'id' = 'tavily'
    ),
    'discovery_cap', (
      select (item->>'limit')::integer from jsonb_array_elements(providers) item where item->>'id' = 'tavily'
    ),
    'discovery_providers', providers,
    'research_daily_remaining', greatest(0,20 - (
      select count(*) from public.crm_research_jobs
      where requested_by=auth.uid() and created_at > now()-interval '1 day'
    )),
    'research_search_remaining', greatest(0,100 - (
      select count(*) from public.crm_research_jobs
      where include_search and created_at > date_trunc('month',now())
    ))
  );
end $$;
revoke all on function public.crm_lookup_quota() from public, anon;
grant execute on function public.crm_lookup_quota() to authenticated;

create or replace function public.crm_discovery_redact_result(p jsonb)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare item jsonb; out jsonb := '[]'::jsonb; src jsonb; data jsonb;
begin
  if p is null or jsonb_typeof(p->'results') is distinct from 'array' then return p; end if;
  for item in select value from jsonb_array_elements(p->'results') loop
    src := coalesce(item->'source', '{}'::jsonb);
    if src->>'provider' = 'brave' and src->>'storage' is distinct from 'rights_ok' then
      src := jsonb_build_object(
        'url', src->>'url',
        'title', '',
        'excerpt', '',
        'checked_at', src->>'checked_at',
        'kind', 'search_index',
        'provider', 'brave',
        'storage', 'ephemeral'
      );
      data := (coalesce(item->'data', '{}'::jsonb) - 'raw' - 'payload' - 'markdown' - 'html' - 'description')
        || jsonb_build_object('evidence', '[]'::jsonb, 'suggestions', '[]'::jsonb, 'notice', 'Brave 结果只在当次内存中参与排序，摘录未写入 CRM。请用随后读取的官网原文核实。');
      item := item || jsonb_build_object('title', coalesce(item->>'domain', ''), 'source', src, 'data', data);
    end if;
    out := out || jsonb_build_array(item);
  end loop;
  return p || jsonb_build_object('results', out);
end $$;
revoke all on function public.crm_discovery_redact_result(jsonb) from public, anon, authenticated;

drop function if exists public.crm_discovery_claim();
create function public.crm_discovery_claim(p_providers text[] default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.crm_discovery_jobs; c public.crm_discovery_candidates; token uuid; step integer; q text; allowed text[];
begin
  perform pg_advisory_xact_lock(hashtext('crm_discovery_worker'));
  if exists(select 1 from public.crm_discovery_jobs where status='running' and lease_until>now()) then return null; end if;
  select * into j from public.crm_discovery_jobs where status in('queued','running') and (lease_until is null or lease_until<=now()) order by updated_at,created_at for update skip locked limit 1;
  if not found then return null; end if;
  if not exists(select 1 from public.profiles where id=j.requested_by and active) then
    update public.crm_discovery_jobs set status='cancelled',error='提交账号已停用',finished_at=now(),lease_until=null,lease_token=null where id=j.id; return null;
  end if;
  update public.crm_discovery_requests set status='unknown',finished_at=now(),error='上次处理未确认结果；已计入尝试，不自动重试' where job_id=j.id and status='started';
  update public.crm_search_attempts set status='unknown',finished_at=now(),error='上次处理未确认结果；已计入尝试，不自动重试' where job_id=j.id and status='started';
  update public.crm_discovery_candidates set status='review',error='上次网页读取中断，请人工查看来源' where job_id=j.id and status='reading';
  token:=gen_random_uuid();
  if j.search_cursor<jsonb_array_length(j.queries) then
    select coalesce(array_agg(distinct item), array[]::text[]) into allowed
    from unnest(coalesce(p_providers, array['tavily'])) item
    where item in ('tavily','firecrawl','serpapi','brave');
    if not exists (
      select 1 from public.crm_search_providers p
      where p.id = any(allowed) and p.in_failover and p.active
        and (p.exhausted_until is null or p.exhausted_until<=now())
        and p.monthly_attempt_cap is not null
        and public.crm_search_used(p.id) < p.monthly_attempt_cap
    ) then
      update public.crm_discovery_jobs set status='paused',error='免费搜索源都已用尽或未配置；不会自动付费',lease_until=null,lease_token=null,updated_at=now() where id=j.id; return null;
    end if;
    step:=j.search_cursor; q:=j.queries->>step;
    insert into public.crm_discovery_requests(job_id,step,query,provider) values(j.id,step,q,'reserved');
    update public.crm_discovery_jobs set status='running',search_cursor=search_cursor+1,lease_token=token,lease_until=now()+interval '90 seconds',updated_at=now(),error=null where id=j.id;
    return jsonb_build_object('kind','search','job',to_jsonb(j),'lease',token,'step',step,'query',q);
  end if;
  select * into c from public.crm_discovery_candidates where job_id=j.id and status='waiting' order by score desc,created_at,id for update skip locked limit 1;
  if not found then
    update public.crm_discovery_jobs set status='completed',finished_at=now(),lease_token=null,lease_until=null,updated_at=now() where id=j.id;
    return null;
  end if;
  update public.crm_discovery_candidates set status='reading' where id=c.id;
  update public.crm_discovery_jobs set status='running',lease_token=token,lease_until=now()+interval '90 seconds',updated_at=now() where id=j.id;
  return jsonb_build_object('kind','read','job',to_jsonb(j),'candidate',to_jsonb(c),'lease',token);
end $$;
revoke all on function public.crm_discovery_claim(text[]) from public, anon, authenticated;
grant execute on function public.crm_discovery_claim(text[]) to service_role;

create or replace function public.crm_search_attempt_begin(p_job uuid, p_lease uuid, p_step integer, p_provider text, p_kind text, p_weight integer)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.crm_discovery_jobs; attempt_id uuid; cap integer; used integer;
begin
  if p_provider not in ('tavily','firecrawl','serpapi','brave') or p_kind not in ('search','scrape') or p_weight is null or p_weight not between 1 and 20 then
    raise exception '搜索源无效';
  end if;
  if p_kind='search' and p_step is null then raise exception '搜索尝试缺少步骤'; end if;
  select * into j from public.crm_discovery_jobs where id=p_job for update;
  if not found or j.status<>'running' or j.lease_token is distinct from p_lease then raise exception '获客任务状态已变化'; end if;
  if p_kind='search' and not exists(select 1 from public.crm_discovery_requests where job_id=j.id and step=p_step and status='started') then
    raise exception '搜索尝试状态已变化';
  end if;
  if exists(select 1 from public.crm_search_attempts where job_id=j.id and step=p_step and provider=p_provider and kind=p_kind and p_step is not null) then
    raise exception '该免费搜索源本次查询已尝试过' using errcode='P0001';
  end if;
  select monthly_attempt_cap into cap from public.crm_search_providers
  where id=p_provider and in_failover and active and (exhausted_until is null or exhausted_until<=now());
  if cap is null then raise exception '免费搜索额度已用尽；不会自动付费' using errcode='P0001'; end if;
  used := public.crm_search_used(p_provider);
  if used + p_weight > cap then raise exception '免费搜索额度已用尽；不会自动付费' using errcode='P0001'; end if;
  begin
    insert into public.crm_search_attempts(job_id,step,provider,kind,weight) values(j.id,p_step,p_provider,p_kind,p_weight) returning crm_search_attempts.id into attempt_id;
  exception when unique_violation then
    raise exception '该免费搜索源本次查询已尝试过' using errcode='P0001';
  end;
  if p_kind='search' then
    update public.crm_discovery_requests set provider=p_provider where job_id=j.id and step=p_step and status='started';
  end if;
  return attempt_id;
end $$;
revoke all on function public.crm_search_attempt_begin(uuid,uuid,integer,text,text,integer) from public, anon, authenticated;
grant execute on function public.crm_search_attempt_begin(uuid,uuid,integer,text,text,integer) to service_role;

create or replace function public.crm_search_attempt_finish(p_attempt uuid, p_lease uuid, p_status text, p_error text, p_count boolean, p_exhaust boolean)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare row public.crm_search_attempts; j public.crm_discovery_jobs;
begin
  if p_status not in ('completed','failed','unknown') then raise exception '搜索尝试状态无效'; end if;
  select * into row from public.crm_search_attempts where id=p_attempt for update;
  if not found then return false; end if;
  select * into j from public.crm_discovery_jobs where id=row.job_id for update;
  if not found or j.lease_token is distinct from p_lease then return false; end if;
  update public.crm_search_attempts
    set status=p_status, finished_at=now(), counts_as_attempt=coalesce(p_count,true), error=left(p_error,500)
    where id=row.id;
  if p_exhaust then
    update public.crm_search_providers
      set exhausted_until=(date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC'
      where id=row.provider;
  end if;
  return true;
end $$;
revoke all on function public.crm_search_attempt_finish(uuid,uuid,text,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.crm_search_attempt_finish(uuid,uuid,text,text,boolean,boolean) to service_role;

create or replace function public.crm_discovery_finish(p_job uuid,p_lease uuid,p_kind text,p_step integer default null,p_candidate uuid default null,p_result jsonb default '{}',p_error text default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.crm_discovery_jobs; item jsonb; existing uuid;
begin
  select * into j from public.crm_discovery_jobs where id=p_job for update;
  if not found or j.status<>'running' or j.lease_token is distinct from p_lease then return false; end if;
  if not exists(select 1 from public.profiles where id=j.requested_by and active) then
    update public.crm_discovery_jobs set status='cancelled',lease_token=null,lease_until=null,error='账号已停用',finished_at=now() where id=j.id; return false;
  end if;
  if p_kind='search' then
    if not exists(select 1 from public.crm_discovery_requests where job_id=j.id and step=p_step and status='started') then raise exception '搜索尝试状态已变化'; end if;
    if p_error is null then
      p_result := public.crm_discovery_redact_result(coalesce(p_result,'{}'::jsonb));
      for item in select value from jsonb_array_elements(coalesce(p_result->'results','[]')) limit 20 loop
        select id into existing from public.crm_discovery_candidates where job_id=j.id and domain=item->>'domain';
        if found then
          update public.crm_discovery_candidates set sources=case when jsonb_array_length(sources)<6 then sources||jsonb_build_array(item->'source') else sources end,score=greatest(score,coalesce((item->>'score')::integer,0)) where id=existing;
        elsif (select count(*) from public.crm_discovery_candidates where job_id=j.id)<j.target_count then
          insert into public.crm_discovery_candidates(job_id,domain,website,title,sources,data,score) values(j.id,item->>'domain',item->>'website',left(item->>'title',300),jsonb_build_array(item->'source'),coalesce(item->'data','{}'),coalesce((item->>'score')::integer,0));
        end if;
      end loop;
    end if;
    update public.crm_discovery_requests set status=case when p_error is null then 'completed' else 'failed' end,finished_at=now(),error=left(p_error,500) where job_id=j.id and step=p_step;
  elsif p_kind='read' then
    update public.crm_discovery_candidates set status='review',data=case when p_error is null then p_result else data end,score=case when p_error is null then coalesce((p_result->>'score')::integer,score) else score end,checked_at=now(),error=left(p_error,500) where id=p_candidate and job_id=j.id and status='reading';
  else raise exception '无效的搜索阶段'; end if;
  update public.crm_discovery_jobs set lease_token=null,lease_until=null,updated_at=now(),error=case when p_error is not null then left(p_error,500) else error end where id=j.id;
  return true;
end $$;

create or replace function public.crm_discovery_state(p_job uuid,p_state text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.crm_discovery_jobs;
begin
  select * into j from public.crm_discovery_jobs where id=p_job for update;
  if not found or not public.is_active_user() or (j.requested_by<>auth.uid() and not public.is_admin()) then raise exception '无权操作搜索任务'; end if;
  if p_state not in('paused','queued','cancelled') or j.status in('completed','cancelled') then raise exception '此任务不可进行该操作'; end if;
  update public.crm_discovery_requests set status='unknown',finished_at=now(),error='用户暂停或取消期间请求可能已提交，不自动重复搜索' where job_id=j.id and status='started';
  update public.crm_search_attempts set status='unknown',finished_at=now(),error='用户暂停或取消期间请求可能已提交，不自动重复搜索' where job_id=j.id and status='started';
  update public.crm_discovery_candidates set status='review',error='用户暂停期间网页读取中断，请人工核实' where job_id=j.id and status='reading';
  if p_state='cancelled' then
    update public.crm_discovery_candidates set status='review',error='任务已取消，未读取此候选官网；请人工打开搜索来源核实' where job_id=j.id and status='waiting';
  end if;
  update public.crm_discovery_jobs set status=p_state,lease_token=null,lease_until=null,updated_at=now(),error=null,finished_at=case when p_state='cancelled' then now() else null end where id=j.id;
  insert into public.crm_discovery_events(job_id,actor_id,action) values(j.id,auth.uid(),p_state);
end $$;

commit;
