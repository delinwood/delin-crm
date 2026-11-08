begin;
-- Company-wide automatic prospecting search attempts: 900 -> 980 per UTC month.
-- Tavily Free is 1000 credits/month; 980 keeps that buffer. Per-account 24h job
-- limits, the free-plan usage hard-stop, and paygo===0 checks stay unchanged.
-- Historical migrations still create the 900 versions; this replacement is the
-- live gate. Do not apply to production until approved.

create or replace function public.crm_discovery_claim()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.crm_discovery_jobs; c public.crm_discovery_candidates; token uuid; step integer; q text;
begin
  perform pg_advisory_xact_lock(hashtext('crm_discovery_worker'));
  if exists(select 1 from public.crm_discovery_jobs where status='running' and lease_until>now()) then return null; end if;
  select * into j from public.crm_discovery_jobs where status in('queued','running') and (lease_until is null or lease_until<=now()) order by updated_at,created_at for update skip locked limit 1;
  if not found then return null; end if;
  if not exists(select 1 from public.profiles where id=j.requested_by and active) then
    update public.crm_discovery_jobs set status='cancelled',error='提交账号已停用',finished_at=now(),lease_until=null,lease_token=null where id=j.id; return null;
  end if;
  update public.crm_discovery_requests set status='unknown',finished_at=now(),error='上次处理未确认结果；已计入尝试，不自动重试' where job_id=j.id and status='started';
  update public.crm_discovery_candidates set status='review',error='上次网页读取中断，请人工查看来源' where job_id=j.id and status='reading';
  token:=gen_random_uuid();
  if j.search_cursor<jsonb_array_length(j.queries) then
    if (select count(*) from public.crm_discovery_requests where attempted_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')>=980 then
      update public.crm_discovery_jobs set status='paused',error='本系统当月980次搜索尝试额度已用完；不自动付费',lease_until=null,lease_token=null,updated_at=now() where id=j.id; return null;
    end if;
    step:=j.search_cursor; q:=j.queries->>step;
    insert into public.crm_discovery_requests(job_id,step,query) values(j.id,step,q);
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
revoke all on function public.crm_discovery_claim() from public,anon,authenticated;
grant execute on function public.crm_discovery_claim() to service_role;

create or replace function public.crm_lookup_quota()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.is_active_user() then
    raise exception '请登录启用的账号' using errcode='42501';
  end if;
  return jsonb_build_object(
    'discovery_remaining', greatest(0,980 - (
      select count(*) from public.crm_discovery_requests
      where attempted_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'
    )),
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
revoke all on function public.crm_lookup_quota() from public,anon;
grant execute on function public.crm_lookup_quota() to authenticated;
commit;
