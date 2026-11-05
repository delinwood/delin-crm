begin;
alter table public.crm_learning_materials add column if not exists notice_body text not null default '' check(length(notice_body)<=20000);
create or replace function public.crm_learning_notify() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status<>'published' then return new; end if;
 if tg_op='UPDATE' then
  if old.status='published' and (to_jsonb(new)-array['updated_at','sort_order'])=(to_jsonb(old)-array['updated_at','sort_order']) then return new; end if;
 end if;
 insert into crm_learning_notices(material_id,title,kind,body,published)
 values(new.id,new.title,case when tg_op='INSERT' then 'published' when old.status<>'published' then 'published' else 'updated' end,
 coalesce(nullif(trim(new.notice_body),''),new.description,''),true);
 return new;
end $$;
commit;
