begin;
create table public.crm_reorder_plans (
  client_id uuid primary key references public.clients(id) on delete cascade,
  product text not null check(length(trim(product)) between 1 and 300),
  last_order_on date,
  next_purchase_on date not null,
  remind_days integer not null check(remind_days between 0 and 180),
  basis text not null check(length(trim(basis)) between 1 and 2000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table public.crm_work_outcomes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  task_key text not null check(length(task_key) between 1 and 200),
  outcome text not null check(length(trim(outcome)) between 1 and 2000),
  next_on date,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index crm_work_outcomes_client_task on public.crm_work_outcomes(client_id,task_key,created_at desc);
alter table public.crm_reorder_plans enable row level security;
alter table public.crm_work_outcomes enable row level security;
revoke all on public.crm_reorder_plans,public.crm_work_outcomes from public,anon,authenticated;
grant select on public.crm_reorder_plans,public.crm_work_outcomes to authenticated;
create policy reorder_read on public.crm_reorder_plans for select to authenticated using(public.crm_client_access(client_id,true));
create policy work_outcomes_read on public.crm_work_outcomes for select to authenticated using(public.crm_client_access(client_id,true));

create function public.crm_save_reorder_plan(p_client uuid,p_product text,p_last date,p_next date,p_days int,p_basis text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.clients;
begin
  select * into c from public.clients where id=p_client for update;
  if not found or not public.crm_client_access(p_client,true) or public.crm_is_archived(p_client)
    or c.status is distinct from '成交' then raise exception '只能为有权限的成交客户设置补货计划' using errcode='42501'; end if;
  if p_next is null or p_last>p_next then raise exception '请填写有效的补货日期'; end if;
  insert into public.crm_reorder_plans(client_id,product,last_order_on,next_purchase_on,remind_days,basis,updated_by)
  values(p_client,trim(p_product),p_last,p_next,p_days,trim(p_basis),auth.uid())
  on conflict(client_id) do update set product=excluded.product,last_order_on=excluded.last_order_on,
    next_purchase_on=excluded.next_purchase_on,remind_days=excluded.remind_days,basis=excluded.basis,
    updated_by=excluded.updated_by,updated_at=now();
end $$;
create function public.crm_finish_work_item(p_client uuid,p_key text,p_outcome text,p_next date)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from public.clients where id=p_client for share;
  if not found or not public.crm_client_access(p_client,true) or public.crm_is_archived(p_client)
  then raise exception '只能处理有权限的客户待办' using errcode='42501'; end if;
  if p_next<(now() at time zone 'Asia/Shanghai')::date then raise exception '下一步日期不能早于今天'; end if;
  insert into public.crm_work_outcomes(client_id,task_key,outcome,next_on,actor_id)
    values(p_client,p_key,trim(p_outcome),p_next,auth.uid());
end $$;
revoke all on function public.crm_save_reorder_plan(uuid,text,date,date,int,text),public.crm_finish_work_item(uuid,text,text,date) from public,anon;
grant execute on function public.crm_save_reorder_plan(uuid,text,date,date,int,text),public.crm_finish_work_item(uuid,text,text,date) to authenticated;
notify pgrst, 'reload schema';
commit;
