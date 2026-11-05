begin;
-- One immutable, readable snapshot per publication; source deletion must not erase notices.
alter table public.crm_learning_notices add column if not exists body text not null default '';
alter table public.crm_learning_notices add column if not exists published boolean not null default true;
alter table public.crm_learning_notices alter column material_id drop not null;
alter table public.crm_learning_notices drop constraint if exists crm_learning_notices_material_id_fkey;
alter table public.crm_learning_notices add constraint crm_learning_notices_material_id_fkey foreign key(material_id) references public.crm_learning_materials(id) on delete set null;
update public.crm_learning_notices n set body='旧版通知的资料说明（于2026-11-04补存，非当时正文快照）：'||E'\n'||coalesce(m.description,''),published=m.status='published' from public.crm_learning_materials m where n.material_id=m.id and n.body='';
drop policy if exists learning_notices_read on public.crm_learning_notices;
create policy learning_notices_read on public.crm_learning_notices for select to authenticated using(public.is_active_user() and published);
create or replace function public.crm_learning_notify() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status<>'published' then return new; end if;
 if tg_op='UPDATE' then
  if old.status='published' and (to_jsonb(new)-array['updated_at','sort_order'])=(to_jsonb(old)-array['updated_at','sort_order']) then return new; end if;
 end if;
 insert into crm_learning_notices(material_id,title,kind,body,published) values(new.id,new.title,case when tg_op='INSERT' then 'published' when old.status<>'published' then 'published' else 'updated' end,coalesce(new.description,''),true);
 return new;
end $$;
create or replace function public.crm_learning_unread() returns setof public.crm_learning_notices language sql stable security definer set search_path=public,pg_temp as $$
 select n.* from crm_learning_notices n where public.is_active_user() and n.published and not exists(select 1 from crm_learning_notice_reads r where r.notice_id=n.id and r.user_id=auth.uid()) order by n.created_at desc,n.id desc limit 100;
$$;
create or replace function public.crm_learning_ack(p_ids uuid[]) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.is_active_user() then raise exception '请使用启用账号登录'; end if;
 insert into crm_learning_notice_reads(notice_id,user_id) select n.id,auth.uid() from crm_learning_notices n where n.id=any(p_ids) and n.published on conflict do nothing;
end $$;
create or replace function public.crm_learning_history(p_offset integer default 0)
returns table(id uuid,title text,body text,kind text,created_at timestamptz,read_at timestamptz) language sql stable security definer set search_path=public,pg_temp as $$
 select n.id,n.title,n.body,n.kind,n.created_at,r.read_at from crm_learning_notices n left join crm_learning_notice_reads r on r.notice_id=n.id and r.user_id=auth.uid() where public.is_active_user() and n.published order by n.created_at desc,n.id desc limit 30 offset greatest(0,least(coalesce(p_offset,0),1000000));
$$;
revoke all on function public.crm_learning_history(integer) from public,anon;
grant execute on function public.crm_learning_history(integer) to authenticated;

-- Export authorization deliberately uses the named boss account, not the admin role alone.
create or replace function public.crm_can_export() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.can_delete_clients() and exists(select 1 from profiles where id=auth.uid() and active and role='admin' and username='boss');
$$;
revoke all on function public.crm_can_export() from public,anon;
grant execute on function public.crm_can_export() to authenticated;

-- Keep assignment and editing permissions intact; restrict social soft/hard removal to boss.
create or replace function public.crm_social_trash(p_id uuid,p_version integer,p_action text,p_reason text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.crm_social_leads;
begin
 if not public.is_active_user() or not public.can_delete_clients() then raise exception '仅老板可移入回收站、恢复或删除客户' using errcode='42501'; end if;
 select * into r from public.crm_social_leads where id=p_id for update;
 if not found or r.version<>p_version then raise exception '记录已变化，请刷新'; end if;
 if p_action='trash' then
  if r.transferred_at is not null or r.trashed_at is not null or length(trim(coalesce(p_reason,''))) not between 2 and 2000 then raise exception '请填写2至2000字回收原因，且记录须未转移'; end if;
  update public.crm_social_leads set trashed_at=now(),trash_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now(),version=version+1 where id=p_id;
 elsif p_action='restore' then
  if r.trashed_at is null then raise exception '客户不在回收站'; end if;
  update public.crm_social_leads set trashed_at=null,trash_reason=null,updated_by=auth.uid(),updated_at=now(),version=version+1 where id=p_id;
 elsif p_action='delete' then
  if r.trashed_at is null then raise exception '请先移入回收站'; end if;
  insert into public.crm_social_events(lead_id,actor_id,action,detail) values(p_id,auth.uid(),'delete',jsonb_build_object('before',to_jsonb(r),'reason',r.trash_reason));
  delete from public.crm_social_leads where id=p_id;
  return;
 else raise exception '不支持的操作'; end if;
 insert into public.crm_social_events(lead_id,actor_id,action,detail) values(p_id,auth.uid(),p_action,jsonb_build_object('reason',p_reason,'before',to_jsonb(r)));
end $$;

-- Dedicated review audit keeps old grades and original fields without rewriting notes.
create table if not exists public.crm_priority_reviews(
 id uuid primary key default gen_random_uuid(),client_id uuid references public.clients(id) on delete set null,
 batch_id text not null,company_name text not null,old_priority text,new_priority text not null check(new_priority in('A','B','C','D')),
 reason text not null,import_evidence text not null,source_note text not null default '',before_snapshot jsonb not null,
 reviewed_at timestamptz not null default now(),unique(batch_id,client_id)
);
alter table public.crm_priority_reviews enable row level security;
revoke all on public.crm_priority_reviews from public,anon,authenticated;
grant select on public.crm_priority_reviews to authenticated;
create policy crm_priority_reviews_read on public.crm_priority_reviews for select to authenticated using(public.is_active_user() and (public.can_delete_clients() or (client_id is not null and public.crm_client_access(client_id,false))));
create or replace function public.crm_priority_history(p_client uuid) returns setof public.crm_priority_reviews language sql stable security definer set search_path=public,pg_temp as $$
 select r.* from public.crm_priority_reviews r where r.client_id=p_client and public.is_active_user() and public.crm_client_access(p_client,false) order by reviewed_at desc,id desc;
$$;
revoke all on function public.crm_priority_history(uuid) from public,anon;
grant execute on function public.crm_priority_history(uuid) to authenticated;
-- Existing A+ may remain during the short staged migration, visibly marked as legacy.
do $$ declare r record; begin
 for r in select conname from pg_constraint where conrelid='public.clients'::regclass and contype='c' and pg_get_constraintdef(oid) ~ '\mpriority\M' loop
  execute format('alter table public.clients drop constraint %I',r.conname);
 end loop;
end $$;
alter table public.clients add constraint clients_priority_abcd_check check(priority is null or priority in('A','B','C','D','A+'));
alter table public.clients alter column priority set default 'C';

-- No email is sent by this migration. New C/D/legacy queue entries are blocked.
create or replace function public.crm_mail_grade_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status in('queued','sending') and coalesce((select priority from public.clients where id=new.client_id),'C') not in('A','B') then
  raise exception 'C待核实、D非目标或旧等级客户不能进入批量/自动发信队列，请先补证并重新分级';
 end if;
 return new;
end $$;
revoke all on function public.crm_mail_grade_guard() from public,anon,authenticated;
create trigger crm_mail_grade_guard before insert on public.mail_messages for each row execute function public.crm_mail_grade_guard();
-- Re-check grade when claiming already queued mail, using the currently deployed implementation.
do $$declare src text; needle text:='where c.id=m.client_id and c.status<>''无效'''; begin
 select pg_get_functiondef('public.mail_claim()'::regprocedure) into src;
 if position(needle in src)=0 then raise exception 'mail_claim版本已变化，请人工复核后再部署'; end if;
 execute replace(src,needle,needle||' and coalesce(c.priority,''C'') in(''A'',''B'')');
end $$;
commit;
