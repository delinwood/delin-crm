begin;
alter table public.crm_learning_materials add column if not exists ai_text text not null default '' check(length(ai_text)<=20000);
alter table public.crm_learning_materials add column if not exists ai_allowed boolean not null default false;
create table if not exists public.crm_ai_settings(
 id boolean primary key default true check(id), enabled boolean not null default false,
 private_consent boolean not null default false, daily_limit integer not null default 0 check(daily_limit between 0 and 200),
 updated_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);
insert into public.crm_ai_settings(id) values(true) on conflict do nothing;
alter table public.crm_ai_settings add column if not exists daily_token_limit integer not null default 50000 check(daily_token_limit between 1000 and 10000000);
alter table public.crm_ai_settings drop constraint if exists crm_ai_settings_daily_limit_check;
alter table public.crm_ai_settings add constraint crm_ai_settings_daily_limit_check check(daily_limit between 0 and 200);
alter table public.crm_ai_settings alter column daily_limit set default 0;
update public.crm_ai_settings set daily_limit=0 where id;

create table if not exists public.crm_ai_providers(
 id text primary key check(id in('qwen','gemini')), model text not null default '',
 enabled boolean not null default false, free_only_verified boolean not null default false,
 expires_at timestamptz, token_budget bigint not null default 0 check(token_budget between 0 and 100000000),
 priority integer not null default 0, private_allowed boolean not null default false,
 updated_at timestamptz not null default now(),
 check(id<>'gemini' or private_allowed=false)
);
insert into public.crm_ai_providers(id,model,priority) values('qwen','qwen-plus',1),('gemini','gemini-3-flash-preview',2) on conflict do nothing;
create table if not exists public.crm_ai_user_limits(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 daily_limit integer not null check(daily_limit between 0 and 200)
);
create table if not exists public.crm_ai_requests(
 id uuid primary key default gen_random_uuid(), request_id uuid not null,
 user_id uuid not null references public.profiles(id), provider text not null references public.crm_ai_providers(id),
 task text not null check(task in('knowledge','reply','research','training','daily','business')),
 client_id uuid references public.clients(id), status text not null default 'reserved' check(status in('reserved','completed','failed','uncertain')),
 reserved_tokens integer not null check(reserved_tokens between 1 and 60000),
 charged_tokens integer not null check(charged_tokens between 0 and 60000),
 actual_tokens integer, question text not null default '', result jsonb, error text,
 created_at timestamptz not null default now(), finished_at timestamptz,
 unique(request_id,provider)
);
create index if not exists crm_ai_user_date on public.crm_ai_requests(user_id,created_at desc);
alter table public.crm_ai_settings enable row level security;
alter table public.crm_ai_providers enable row level security;
alter table public.crm_ai_user_limits enable row level security;
alter table public.crm_ai_requests enable row level security;
revoke all on public.crm_ai_settings,public.crm_ai_providers,public.crm_ai_user_limits,public.crm_ai_requests from public,anon,authenticated;
grant select on public.crm_ai_settings,public.crm_ai_providers,public.crm_ai_user_limits,public.crm_ai_requests to authenticated;
grant all on public.crm_ai_settings,public.crm_ai_providers,public.crm_ai_user_limits,public.crm_ai_requests to service_role;
create policy crm_ai_settings_read on public.crm_ai_settings for select to authenticated using(public.is_active_user());
create policy crm_ai_providers_read on public.crm_ai_providers for select to authenticated using(public.is_active_user());
create policy crm_ai_limits_read on public.crm_ai_user_limits for select to authenticated using(public.is_active_user() and (user_id=auth.uid() or public.is_admin()));
create policy crm_ai_requests_read on public.crm_ai_requests for select to authenticated using(
 public.is_active_user() and (public.is_admin() or (user_id=auth.uid() and (client_id is null or public.crm_client_access(client_id,true))))
);
-- Only service_role may reserve calls. Serialize global and per-user budgets, including concurrent fallback calls.
create or replace function public.crm_ai_reserve(p_id uuid,p_request uuid,p_user uuid,p_provider text,p_task text,p_client uuid,p_tokens integer,p_question text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.crm_ai_settings; provider public.crm_ai_providers; person public.profiles; ceiling integer; cnt integer; spent bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('crm-ai-budget',0));
 select * into cfg from public.crm_ai_settings where id;
 select * into person from public.profiles where id=p_user and active;
 if not found or cfg.enabled is not true then raise exception 'AI功能未启用或账号已停用'; end if;
 if p_task is null or p_task not in('knowledge','reply','research','training','daily','business') or p_tokens is null or p_tokens not between 1 and 60000 then raise exception 'AI任务参数无效'; end if;
 if p_task='business' and person.role<>'admin' then raise exception '仅老板可查看经营问答' using errcode='42501'; end if;
 if p_task in('reply','research') and p_client is null then raise exception '请选择客户'; end if;
 if p_client is not null and not exists(select 1 from public.clients c where c.id=p_client and not public.crm_is_archived(c.id) and (person.role='admin' or c.owner_id=p_user)) then raise exception '客户权限已变化' using errcode='42501'; end if;
 if exists(select 1 from public.crm_ai_requests where request_id=p_request and user_id<>p_user) then raise exception '请求标识已使用'; end if;
 if exists(select 1 from public.crm_ai_requests where request_id=p_request and (status in('reserved','completed','uncertain') or task<>p_task or client_id is distinct from p_client)) then raise exception '此请求已处理或仍在处理中，请查看历史，勿重复提交'; end if;
 select * into provider from public.crm_ai_providers where id=p_provider for update;
 if not found or provider.enabled is not true or provider.free_only_verified is not true or provider.expires_at is null or provider.expires_at<=now() or provider.model !~ '^[A-Za-z0-9_.-]{1,100}$' then raise exception '模型未完成免费保护配置或额度已过期'; end if;
 if p_task in('reply','research','daily','business') and (cfg.private_consent is not true or provider.private_allowed is not true) then raise exception '该模型未获准处理内部业务资料'; end if;
 select coalesce((select daily_limit from public.crm_ai_user_limits where user_id=p_user),cfg.daily_limit) into ceiling;
 select count(distinct request_id) into cnt from public.crm_ai_requests where user_id=p_user and (created_at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date;
 if ceiling>0 and cnt>=ceiling and not exists(select 1 from public.crm_ai_requests where request_id=p_request and user_id=p_user and (created_at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date) then raise exception '今日AI次数已用完，不会转付费'; end if;
 if (select count(*) from public.crm_ai_requests where user_id=p_user and created_at>now()-interval '1 minute')>=6 then raise exception '请求过于频繁，请稍后重试'; end if;
 select coalesce(sum(r.charged_tokens),0) into spent from public.crm_ai_requests r where (r.created_at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date;
 if spent+p_tokens>cfg.daily_token_limit then raise exception '全公司今日AI Token安全额度已用完，明日恢复；不会转付费'; end if;
 select coalesce(sum(r.charged_tokens),0) into spent from public.crm_ai_requests r where r.provider=p_provider;
 if spent+p_tokens>provider.token_budget then raise exception '模型免费安全额度不足，已暂停'; end if;
 insert into public.crm_ai_requests(id,request_id,user_id,provider,task,client_id,reserved_tokens,charged_tokens,question)
 values(p_id,p_request,p_user,p_provider,p_task,p_client,p_tokens,p_tokens,left(p_question,2000));
 return p_id;
end;
$$;
create or replace function public.crm_ai_save_settings(p_enabled boolean,p_private boolean,p_daily integer,p_providers jsonb,p_limits jsonb default '[]')
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb; pid text; limituser uuid; budget bigint; spent bigint; expiry timestamptz;
begin
 if public.is_active_user() is not true or public.is_admin() is not true then raise exception '仅老板可配置AI' using errcode='42501'; end if;
 if p_daily is null or p_daily not between 0 and 200 or jsonb_typeof(p_providers) is distinct from 'array' or jsonb_array_length(p_providers)>2 or jsonb_typeof(p_limits) is distinct from 'array' or jsonb_array_length(p_limits)>100 then raise exception '配置格式无效'; end if;
 perform pg_advisory_xact_lock(hashtextextended('crm-ai-budget',0));
 update public.crm_ai_settings set enabled=p_enabled,private_consent=p_private,daily_limit=p_daily,updated_by=auth.uid(),updated_at=now() where id;
 for v in select value from jsonb_array_elements(p_providers) loop
  pid:=v->>'id'; budget:=(v->>'token_budget')::bigint; expiry:=nullif(v->>'expires_at','')::timestamptz;
  if pid is null or pid not in('qwen','gemini') or coalesce(v->>'model','') !~ '^[A-Za-z0-9_.-]{1,100}$' or budget is null or budget not between 0 and 100000000 then raise exception '模型配置格式无效'; end if;
  select coalesce(sum(charged_tokens),0) into spent from public.crm_ai_requests where provider=pid;
  if budget<spent then raise exception '总安全额度不得低于已计使用量'; end if;
  if coalesce((v->>'enabled')::boolean,false) and (coalesce((v->>'free_only_verified')::boolean,false) is not true or expiry is null or expiry<=now()) then raise exception '启用前需核实免费保护与有效期'; end if;
  update public.crm_ai_providers set model=v->>'model',enabled=coalesce((v->>'enabled')::boolean,false),free_only_verified=coalesce((v->>'free_only_verified')::boolean,false),
  expires_at=expiry,token_budget=budget,priority=coalesce((v->>'priority')::integer,0),
  private_allowed=case when pid='qwen' then coalesce((v->>'private_allowed')::boolean,false) else false end,updated_at=now() where id=pid;
 end loop;
 for v in select value from jsonb_array_elements(p_limits) loop
  limituser:=(v->>'user_id')::uuid;
  if not exists(select 1 from public.profiles where id=limituser and active) then raise exception '员工不存在或已停用'; end if;
  insert into public.crm_ai_user_limits(user_id,daily_limit) values(limituser,(v->>'daily_limit')::integer) on conflict(user_id) do update set daily_limit=excluded.daily_limit;
 end loop;
 insert into public.crm_business_events(actor_id,action,detail) values(auth.uid(),'ai_settings',jsonb_build_object('enabled',p_enabled,'private_consent',p_private,'daily_limit',p_daily));
end;
$$;
revoke all on function public.crm_ai_reserve(uuid,uuid,uuid,text,text,uuid,integer,text),public.crm_ai_save_settings(boolean,boolean,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.crm_ai_reserve(uuid,uuid,uuid,text,text,uuid,integer,text) to service_role;
grant execute on function public.crm_ai_save_settings(boolean,boolean,integer,jsonb,jsonb) to authenticated;

create or replace function public.crm_ai_usage(p_user uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('providers',coalesce((select jsonb_object_agg(provider,spent) from(select provider,sum(charged_tokens) spent from public.crm_ai_requests group by provider)t),'{}'),
 'today_tokens',(select coalesce(sum(charged_tokens),0) from public.crm_ai_requests where (created_at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date),
 'today_used',(select count(distinct request_id) from public.crm_ai_requests where user_id=p_user and (created_at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date));
$$;
revoke all on function public.crm_ai_usage(uuid) from public,anon,authenticated;
grant execute on function public.crm_ai_usage(uuid) to service_role;

create or replace function public.crm_ai_set_daily_tokens(p_tokens integer)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if public.is_active_user() is not true or public.is_admin() is not true then raise exception '仅老板可设置全公司每日Token额度' using errcode='42501'; end if;
 if p_tokens is null or p_tokens not between 1000 and 10000000 then raise exception '请设置1000至10000000的每日安全额度'; end if;
 perform pg_advisory_xact_lock(hashtextextended('crm-ai-budget',0));
 update public.crm_ai_settings set daily_token_limit=p_tokens,updated_by=auth.uid(),updated_at=now() where id;
end;
$$;
revoke all on function public.crm_ai_set_daily_tokens(integer) from public,anon,authenticated;
grant execute on function public.crm_ai_set_daily_tokens(integer) to authenticated;

commit;
