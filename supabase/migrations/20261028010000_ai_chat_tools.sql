begin;
create table if not exists public.crm_ai_tool_actions(
 user_id uuid not null references public.profiles(id), nonce uuid not null,
 reminder_id uuid not null references public.crm_reminders(id), created_at timestamptz not null default now(),
 primary key(user_id,nonce)
);
alter table public.crm_ai_tool_actions enable row level security;
revoke all on public.crm_ai_tool_actions from public,anon,authenticated;
grant all on public.crm_ai_tool_actions to service_role;
create or replace function public.crm_ai_create_reminder(p_nonce uuid,p_data jsonb)
returns public.crm_reminders language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crm_reminders; prior uuid;
begin
 if public.is_active_user() is not true or p_nonce is null then raise exception '请先登录有效账号'; end if;
 perform pg_advisory_xact_lock(hashtextextended('crm-ai-reminder:'||auth.uid()::text||p_nonce::text,0));
 select reminder_id into prior from public.crm_ai_tool_actions where user_id=auth.uid() and nonce=p_nonce;
 if found then select * into r from public.crm_reminders where id=prior and user_id=auth.uid();return r;end if;
 r:=public.crm_save_reminder(p_data,null,null);
 insert into public.crm_ai_tool_actions(user_id,nonce,reminder_id) values(auth.uid(),p_nonce,r.id);
 return r;
end;
$$;
revoke all on function public.crm_ai_create_reminder(uuid,jsonb) from public,anon;
grant execute on function public.crm_ai_create_reminder(uuid,jsonb) to authenticated;
alter table public.crm_ai_requests drop constraint if exists crm_ai_requests_task_check;
alter table public.crm_ai_requests add constraint crm_ai_requests_task_check check(task in('chat','knowledge','reply','research','training','daily','business'));
alter table public.crm_ai_requests add column if not exists related_client_ids uuid[] not null default '{}';
-- Any referenced customer transfer invalidates the whole saved chat for its former owner.
create or replace function public.crm_ai_can_access_clients(p_ids uuid[])
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.is_active_user() and not exists(select 1 from unnest(coalesce(p_ids,'{}'::uuid[])) x where public.crm_client_access(x,true) is not true);
$$;
revoke all on function public.crm_ai_can_access_clients(uuid[]) from public,anon;
grant execute on function public.crm_ai_can_access_clients(uuid[]) to authenticated;
drop policy if exists crm_ai_requests_read on public.crm_ai_requests;
create policy crm_ai_requests_read on public.crm_ai_requests for select to authenticated using(
 public.is_active_user() and (public.is_admin() or (user_id=auth.uid() and (client_id is null or public.crm_client_access(client_id,true)) and public.crm_ai_can_access_clients(related_client_ids)))
);
create or replace function public.crm_ai_reserve(p_id uuid,p_request uuid,p_user uuid,p_provider text,p_task text,p_client uuid,p_tokens integer,p_question text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.crm_ai_settings; provider public.crm_ai_providers; person public.profiles; ceiling integer; cnt integer; spent bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('crm-ai-budget',0));
 select * into cfg from public.crm_ai_settings where id;
 select * into person from public.profiles where id=p_user and active;
 if not found or cfg.enabled is not true then raise exception 'AI功能未启用或账号已停用'; end if;
 if p_task is null or p_task not in('chat','knowledge','reply','research','training','daily','business') or p_tokens is null or p_tokens not between 1 and 60000 then raise exception 'AI任务参数无效'; end if;
 if p_task='business' and person.role<>'admin' then raise exception '仅老板可查看经营问答' using errcode='42501'; end if;
 if p_task in('reply','research') and p_client is null then raise exception '请选择客户'; end if;
 if p_client is not null and not exists(select 1 from public.clients c where c.id=p_client and not public.crm_is_archived(c.id) and (person.role='admin' or c.owner_id=p_user)) then raise exception '客户权限已变化' using errcode='42501'; end if;
 if exists(select 1 from public.crm_ai_requests where request_id=p_request and user_id<>p_user) then raise exception '请求标识已使用'; end if;
 if exists(select 1 from public.crm_ai_requests where request_id=p_request and (status in('reserved','completed','uncertain') or task<>p_task or client_id is distinct from p_client)) then raise exception '此请求已处理或仍在处理中，请查看历史，勿重复提交'; end if;
 select * into provider from public.crm_ai_providers where id=p_provider for update;
 if not found or provider.enabled is not true or provider.free_only_verified is not true or provider.expires_at is null or provider.expires_at<=now() or provider.model !~ '^[A-Za-z0-9_.-]{1,100}$' then raise exception '模型未完成免费保护配置或额度已过期'; end if;
 if p_task in('chat','reply','research','daily','business') and (cfg.private_consent is not true or provider.private_allowed is not true) then raise exception '该模型未获准处理内部业务资料'; end if;
 select coalesce((select daily_limit from public.crm_ai_user_limits where user_id=p_user),cfg.daily_limit) into ceiling;
 select count(distinct request_id) into cnt from public.crm_ai_requests where user_id=p_user and (created_at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date;
 if ceiling>0 and cnt>=ceiling and not exists(select 1 from public.crm_ai_requests where request_id=p_request and user_id=p_user and (created_at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date) then raise exception '今日AI次数已用完，不会转付费'; end if;
 if (select count(*) from public.crm_ai_requests where user_id=p_user and created_at>now()-interval '1 minute')>=6 then raise exception '请求过于频繁，请稍后重试'; end if;
 select coalesce(sum(r.charged_tokens),0) into spent from public.crm_ai_requests r where (r.created_at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date;
 if spent+p_tokens>cfg.daily_token_limit then raise exception '全公司今日AI Token安全额度已用完，明日恢复；不会转付费'; end if;
 select coalesce(sum(r.charged_tokens),0) into spent from public.crm_ai_requests r where r.provider=p_provider;
 if spent+p_tokens>provider.token_budget then raise exception '模型免费安全额度不足，已暂停'; end if;
 insert into public.crm_ai_requests(id,request_id,user_id,provider,task,client_id,reserved_tokens,charged_tokens,question)
 values(p_id,p_request,p_user,p_provider,p_task,p_client,p_tokens,p_tokens,left(p_question,8000));
 return p_id;
end;
$$;
commit;
