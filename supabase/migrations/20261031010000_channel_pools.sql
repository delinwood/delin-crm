begin;
do $$
declare src text; patched text;
begin
 src:=pg_get_functiondef('public.crm_social_save(uuid,integer,jsonb)'::regprocedure);
 patched:=replace(src,'''next_date'']','''next_date'',''lead_channel'']');
 if patched=src then raise exception 'Save whitelist changed; migration stopped'; end if;
 patched:=replace(patched,'if p_id is null then'||chr(10)||'  insert into',
  'if coalesce(clean->>''lead_channel'',''social'') not in(''social'',''exhibition'',''international'') then raise exception ''来源分类不正确''; end if;'||chr(10)||
  'if p_id is not null and exists(select 1 from crm_social_leads where id=p_id and coalesce(data->>''lead_channel'',''social'')<>coalesce(clean->>''lead_channel'',''social'')) then raise exception ''不能在编辑时变更所属公海''; end if;'||chr(10)||
  'if p_id is null then'||chr(10)||'  insert into');
 execute patched;
 src:=pg_get_functiondef('public.crm_social_release(uuid,integer,text)'::regprocedure);
 execute replace(src,'社媒共享表 · ','客户共享公海 · ');
end $$;
commit;
