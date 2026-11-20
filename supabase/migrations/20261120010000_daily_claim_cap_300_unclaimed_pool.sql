begin;

-- Daily self-claim cap becomes 300 per salesperson, still one Beijing-time
-- total across every pool. Existing crm_daily_claims rows are not updated,
-- deleted, or reset. Claim locking, deduplication, and the two existing claim
-- entry points stay in place; both already call crm_consume_daily_claim().
--
-- Apply this file once, before publishing the matching frontend.
-- The rollback at the bottom is comments only; do not execute it with the forward migration.

create or replace function public.crm_daily_claim_cap()
returns integer language sql immutable parallel safe set search_path=public,pg_temp as $$
  select 300
$$;
revoke all on function public.crm_daily_claim_cap() from public,anon;
grant execute on function public.crm_daily_claim_cap() to authenticated,service_role;

do $cap$
declare cname text;
begin
  if to_regclass('public.crm_daily_claims') is null then
    raise exception '每日领取计数表不存在，迁移已停止';
  end if;
  -- Refuse to rewrite history. Abort with the rows untouched if any count
  -- cannot satisfy the new bound.
  if exists(select 1 from public.crm_daily_claims where claimed < 1 or claimed > public.crm_daily_claim_cap()) then
    raise exception '已有每日领取计数超出新上限，迁移已停止且未改写计数';
  end if;
  for cname in
    select con.conname from pg_constraint con
    where con.conrelid='public.crm_daily_claims'::regclass and con.contype='c'
      and pg_get_constraintdef(con.oid) ~* 'claimed'
  loop
    execute format('alter table public.crm_daily_claims drop constraint %I', cname);
  end loop;
  alter table public.crm_daily_claims
    add constraint crm_daily_claims_claimed_check check (claimed between 1 and 300);
end
$cap$;

create or replace function public.crm_consume_daily_claim()
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare cap integer := public.crm_daily_claim_cap();
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role='sales')
     or public.crm_social_is_operator() then
    raise exception '只有启用的业务员可以自领公海客户' using errcode='42501';
  end if;
  if cap is null or cap < 1 then raise exception '每日自领额度未配置'; end if;
  insert into public.crm_daily_claims as q(user_id,claim_date,claimed)
  values(auth.uid(),(now() at time zone 'Asia/Shanghai')::date,1)
  on conflict(user_id,claim_date) do update set claimed=q.claimed+1 where q.claimed<cap;
  if not found then raise exception '今天已领取%家客户，请明天再领取', cap; end if;
end $$;
revoke all on function public.crm_consume_daily_claim() from public,anon,authenticated;

create or replace function public.crm_daily_claim_remaining()
returns integer language sql stable security definer set search_path=public,pg_temp as $$
  select case when exists(select 1 from public.profiles where id=auth.uid() and active and role='sales')
    and not public.crm_social_is_operator() then public.crm_daily_claim_cap()-coalesce((select claimed from public.crm_daily_claims
      where user_id=auth.uid() and claim_date=(now() at time zone 'Asia/Shanghai')::date),0) else null end;
$$;
revoke all on function public.crm_daily_claim_remaining() from public,anon;
grant execute on function public.crm_daily_claim_remaining() to authenticated;

-- Two narrow actions for a customer that is still unclaimed at lock time.
-- Neither action assigns the customer or consumes the daily claim counter.
-- Invalid uses the existing attention flag and attention audit. Second pool
-- uses the existing pool_kind/return_reason/event columns; no new pool field.
create or replace function public.crm_pool_unclaimed_action(p_client_id uuid, p_action text, p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  customer public.clients;
  previous text;
  kind text;
  reason text := trim(coalesce(p_reason,''));
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and active and role='sales')
     or public.crm_social_is_operator() then
    raise exception '只有启用的业务员可以处理未领取的公海客户' using errcode='42501';
  end if;
  if p_action is distinct from 'invalid' and p_action is distinct from 'secondary' then
    raise exception '只能标记为无效客户或放入第二公海' using errcode='42501';
  end if;
  if p_action='invalid' and length(reason)=0 then raise exception '请填写无效原因'; end if;
  if p_action='secondary' and (length(reason)<2 or length(p_reason)>2000) then
    raise exception '请填写2至2000字的退回原因';
  end if;

  if p_action='secondary' then
    perform id from public.mail_plans where client_id=p_client_id order by id for update;
  end if;
  select * into customer from public.clients where id=p_client_id for update;
  if not found then raise exception '客户不存在，请刷新公海'; end if;
  if customer.owner_id is not null then
    raise exception '客户已被领取，请刷新公海' using errcode='42501';
  end if;
  if public.crm_is_archived(p_client_id) then raise exception '客户已在回收站，请刷新公海'; end if;
  if customer.status='成交' then raise exception '已成交客户不可从公海处理'; end if;
  if customer.status='无效' or exists(select 1 from public.client_tracking where client_id=p_client_id and attention_level='无效') then
    raise exception '无效客户请保留在无效客户组，由老板审查';
  end if;

  if p_action='invalid' then
    select attention_level into previous from public.client_tracking where client_id=p_client_id for update;
    insert into public.client_tracking as t(client_id,attention_level,invalid_reason,marked_by,marked_at)
    values(p_client_id,'无效',reason,auth.uid(),now())
    on conflict(client_id) do update set attention_level='无效', invalid_reason=excluded.invalid_reason,
      marked_by=excluded.marked_by, marked_at=excluded.marked_at;
    insert into public.client_attention_events(client_id,company_name,actor_id,old_level,new_level,reason)
    values(p_client_id,customer.company_name,auth.uid(),coalesce(previous,'普通'),'无效',reason);
  else
    select pool_kind into kind from public.crm_pool_metadata where client_id=p_client_id for update;
    if coalesce(kind,'initial')='secondary' then raise exception '客户已在第二公海，请刷新'; end if;
    update public.mail_plans set status='stopped',last_error='客户已退回第二公海，原计划停止'
      where client_id=p_client_id and status in ('running','paused');
    update public.mail_messages set status='cancelled',error='客户已退回第二公海'
      where client_id=p_client_id and status='queued';
    insert into public.crm_pool_metadata(client_id,pool_kind,return_reason,previous_owner,returned_at)
    values(p_client_id,'secondary',reason,customer.owner_id,now())
    on conflict(client_id) do update set pool_kind='secondary', return_reason=excluded.return_reason,
      previous_owner=excluded.previous_owner, returned_at=excluded.returned_at;
    insert into public.crm_pool_events(client_id,company_name,action,actor_id,previous_owner,pool_kind,reason)
    values(p_client_id,customer.company_name,'release',auth.uid(),customer.owner_id,'secondary',reason);
  end if;
end $$;
revoke all on function public.crm_pool_unclaimed_action(uuid,text,text) from public,anon;
grant execute on function public.crm_pool_unclaimed_action(uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;

-- Rollback, for review only. Do not execute it with this change.
-- The forward migration does not update or delete crm_daily_claims.
--
-- 1. Remove only the new unclaimed action:
-- drop function if exists public.crm_pool_unclaimed_action(uuid,text,text);
--
-- 2. Restore the 30 cap without rewriting counts, and only when every stored
--    count is still between 1 and 30. If any row is above 30, leave the
--    constraint and the rows as they are; do not reduce those counts.
--
-- do $rollback$
-- begin
--   if exists(select 1 from public.crm_daily_claims where claimed>30) then
--     raise exception '已有计数超过30，不能把约束改回30，也没有改写计数';
--   end if;
--   alter table public.crm_daily_claims drop constraint crm_daily_claims_claimed_check;
--   alter table public.crm_daily_claims add constraint crm_daily_claims_claimed_check check (claimed between 1 and 30);
-- end $rollback$;
--
-- Then recreate crm_daily_claim_cap() as `select 30`, and recreate
-- crm_consume_daily_claim() / crm_daily_claim_remaining() from
-- 20261107050000_social_scope_claim_notices.sql so they compare against 30.
-- Leave claim_client, crm_claim_shared_lead, set_client_attention, and
-- release_client unchanged; this migration does not replace them.
