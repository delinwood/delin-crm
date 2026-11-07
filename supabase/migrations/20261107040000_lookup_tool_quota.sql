begin;
create or replace function public.crm_lookup_quota()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.is_active_user() then
    raise exception '请登录启用的账号' using errcode='42501';
  end if;
  return jsonb_build_object(
    'discovery_remaining', greatest(0,900 - (
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

insert into public.crm_learning_materials(id,title,description,notice_body,category,required,status,sort_order,external_url,created_by)
select '83a89dbf-ed3f-46f7-89ba-b93559931d85','客户核实工具与免费额度',
$body$从左侧“客户核实工具”进入。先用官网补资料，再根据缺项选择工具：查域名用 RDAP，核对仓库地址用 Google 地图，找采购角色用 Apollo，验证已知邮箱用 Hunter。海关和企业信用查询可从同页打开对应官网。

查询前先看额度。CRM 的自动获客和补资料页会分别显示系统上限和当前可用次数。外部工具请查看本人获授权账号里的余额。使用同一个账号时，官网和接口可能共用额度，切换入口不会重置。

核实后，把公开来源、核对日期和仍不确定的项目记入采购档案。有邮箱或地图地址并不等于已经证实采购意愿。$body$,
'左侧已新增「客户核实工具」。请先读工具说明和额度，再从页面打开官网或进入 CRM 自动查询。','开发流程',false,'published',0,'https://delinwood.github.io/delin-crm/#/lookup-tools',id
from public.profiles where username='boss' and role='admin' and active
on conflict(id) do nothing;
commit;
