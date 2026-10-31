begin;
create table public.crm_learning_notices(
 id uuid primary key default gen_random_uuid(), material_id uuid not null references public.crm_learning_materials(id) on delete cascade,
 title text not null, kind text not null check(kind in('published','updated')), created_at timestamptz not null default now()
);
create table public.crm_learning_notice_reads(
 notice_id uuid not null references public.crm_learning_notices(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 read_at timestamptz not null default now(), primary key(notice_id,user_id)
);
alter table public.crm_learning_notices enable row level security;
alter table public.crm_learning_notice_reads enable row level security;
revoke all on public.crm_learning_notices,public.crm_learning_notice_reads from public,anon,authenticated;
grant select on public.crm_learning_notices,public.crm_learning_notice_reads to authenticated;
create policy learning_notices_read on public.crm_learning_notices for select to authenticated using(public.is_active_user() and exists(select 1 from public.crm_learning_materials m where m.id=material_id and m.status='published'));
create policy learning_notice_reads_read on public.crm_learning_notice_reads for select to authenticated using(public.is_active_user() and user_id=auth.uid());
create function public.crm_learning_notify() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status<>'published' then return new; end if;
 if tg_op='UPDATE' then
  if old.status='published' and (to_jsonb(new)-array['updated_at','sort_order'])=(to_jsonb(old)-array['updated_at','sort_order']) then return new; end if;
 end if;
 insert into crm_learning_notices(material_id,title,kind) values(new.id,new.title,case when tg_op='INSERT' then 'published' when old.status<>'published' then 'published' else 'updated' end);
 return new;
end $$;
revoke all on function public.crm_learning_notify() from public,anon,authenticated;
create trigger crm_learning_notify after insert or update on public.crm_learning_materials for each row execute function public.crm_learning_notify();
create function public.crm_learning_unread() returns setof public.crm_learning_notices language sql stable security definer set search_path=public,pg_temp as $$
 select n.* from crm_learning_notices n join crm_learning_materials m on m.id=n.material_id
 where public.is_active_user() and m.status='published' and not exists(select 1 from crm_learning_notice_reads r where r.notice_id=n.id and r.user_id=auth.uid())
 order by n.created_at desc,n.id limit 100;
$$;
create function public.crm_learning_ack(p_ids uuid[]) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.is_active_user() then raise exception '请使用启用账号登录'; end if;
 insert into crm_learning_notice_reads(notice_id,user_id)
 select n.id,auth.uid() from crm_learning_notices n join crm_learning_materials m on m.id=n.material_id
 where n.id=any(p_ids) and m.status='published' on conflict do nothing;
end $$;
revoke all on function public.crm_learning_unread(),public.crm_learning_ack(uuid[]) from public,anon;
grant execute on function public.crm_learning_unread(),public.crm_learning_ack(uuid[]) to authenticated;
-- Announce the manual just published, including to employees who were offline.
insert into crm_learning_notices(material_id,title,kind) select id,title,'updated' from crm_learning_materials where status='published' and title like '%CRM%2026-10-31%';
commit;
