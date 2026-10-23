begin;
create or replace function public.crm_create_backup(p_label text default '手动备份')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare payload jsonb:='{}'; name text; data jsonb; result public.crm_backups;
begin
  if not public.can_delete_clients() then raise exception '仅老板可备份' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('crm_backups',0));
  if (select count(*) from public.crm_backups)>=10 then raise exception '已保存10份备份，请先下载留存并在管理界面处理旧备份；不会自动开通付费存储'; end if;
  foreach name in array array['clients','follow_ups','quotes','samples','audit_log','templates','saved_filters','client_tracking','client_attention_events','crm_pool_metadata','crm_pool_events','crm_client_state','crm_records','crm_business_events','mail_campaigns','mail_messages','mail_plans','mail_suppressions','crm_mail_inbound','crm_mail_review_holds'] loop
    if to_regclass(format('public.%I',name)) is null and name in('crm_mail_inbound','crm_mail_review_holds') then continue; end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t',name) into data;
    payload:=jsonb_set(payload,array[name],data);
  end loop;
  if octet_length(payload::text)>20000000 then raise exception '单份备份超过20MB，请先联系管理员安排离线备份；未开启付费服务'; end if;
  insert into public.crm_backups(created_by,label,checksum,payload,size_bytes)
    values(auth.uid(),left(coalesce(nullif(trim(p_label),''),'手动备份'),200),encode(sha256(convert_to(payload::text,'UTF8')),'hex'),payload,octet_length(payload::text)) returning * into result;
  return to_jsonb(result)-'payload';
end;
$$;
create or replace function public.crm_list_backups()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.can_delete_clients() then raise exception '仅老板可查看备份' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(b)-'payload' order by created_at desc) from public.crm_backups b),'[]');
end;
$$;
create or replace function public.crm_get_backup(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.crm_backups;
begin
  if not public.can_delete_clients() then raise exception '仅老板可下载备份' using errcode='42501'; end if;
  select * into b from public.crm_backups where id=p_id;
  if not found then raise exception '备份不存在'; end if;
  return jsonb_build_object('format','delin-crm-backup','schema_version',b.schema_version,'id',b.id,'created_at',b.created_at,'checksum',b.checksum,'payload',b.payload);
end;
$$;
-- Import a portable file only as a staged snapshot. No roles, users, auth data,
-- credentials, OAuth refresh tokens or send quotas are imported or restored.
create or replace function public.crm_import_backup(p_backup jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare name text; data jsonb; payload jsonb; checksum text; result public.crm_backups;
begin
  if not public.can_delete_clients() then raise exception '仅老板可导入备份' using errcode='42501'; end if;
  if jsonb_typeof(p_backup) is distinct from 'object' or coalesce(p_backup->>'format','')<>'delin-crm-backup' or p_backup->>'schema_version' is distinct from '1' or jsonb_typeof(p_backup->'payload') is distinct from 'object' then raise exception '不是支持的CRM备份文件'; end if;
  payload:=p_backup->'payload';
  if octet_length(payload::text)>20000000 then raise exception '文件超过20MB'; end if;
  checksum:=encode(sha256(convert_to(payload::text,'UTF8')),'hex');
  if checksum is distinct from p_backup->>'checksum' then raise exception '备份校验失败，文件可能损坏'; end if;
  for name,data in select key,value from jsonb_each(payload) loop
    if name not in ('clients','follow_ups','quotes','samples','audit_log','templates','saved_filters','client_tracking','client_attention_events','crm_pool_metadata','crm_pool_events','crm_client_state','crm_records','crm_business_events','mail_campaigns','mail_messages','mail_plans','mail_suppressions','crm_mail_inbound','crm_mail_review_holds') then raise exception '备份包含不支持的数据表'; end if;
    if jsonb_typeof(data) is distinct from 'array' or jsonb_array_length(data)>50000 then raise exception '备份数据格式或数量不正确'; end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('crm_backups',0));
  if (select count(*) from public.crm_backups)>=10 then raise exception '已达到10份备份上限，请先处理旧备份'; end if;
  insert into public.crm_backups(created_by,label,checksum,payload,size_bytes) values(auth.uid(),'导入文件（待预览恢复）',checksum,payload,octet_length(payload::text)) returning * into result;
  return to_jsonb(result)-'payload';
end;
$$;
create or replace function public.crm_restore_backup(p_id uuid,p_checksum text,p_confirm boolean default false,p_expected jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  b public.crm_backups; name text; data jsonb; columns text; selected text; pk text; pk_columns text[];
  inserted bigint; updated_placeholders bigint; report jsonb:='{}'; missing_tables jsonb:='{}'; column_sets jsonb:='{}';
  item jsonb; field text; prepared jsonb; restored_rows jsonb; expected_row jsonb; new_clients uuid[]:='{}'; recycle_ids uuid[];
  fingerprint text; blocked text[]:='{}'; fk record; target_schema text; target_table text; target_field text; local_field text;
  missing_count bigint; table_order text[]:='{}'; pending text[]; ready text; sequence_name text; sequence_max bigint; sequence_value bigint;
  tracking_before jsonb:='[]'; relation_columns jsonb; sequence_cache bigint; sequence_called boolean;
  restore_tables text[]:=array['clients','follow_ups','quotes','samples','templates','saved_filters','client_tracking','client_attention_events','crm_pool_metadata','crm_pool_events','crm_client_state','crm_records','crm_business_events','audit_log','mail_campaigns','mail_messages','mail_plans','mail_suppressions','crm_mail_inbound','crm_mail_review_holds'];
begin
  if not public.can_delete_clients() then raise exception '仅老板可恢复备份' using errcode='42501'; end if;
  select * into b from public.crm_backups where id=p_id for share;
  if not found or b.checksum is distinct from p_checksum or b.schema_version<>1 then raise exception '备份不存在或校验值已变化'; end if;
  perform pg_advisory_xact_lock(hashtextextended('crm_restore',0));
  -- Build the entire preview before inserting anything: customer insert
  -- triggers may create tracking/audit rows, which must not change this plan.
  foreach name in array restore_tables loop
    data:=coalesce(b.payload->name,'[]');
    if jsonb_typeof(data) is distinct from 'array' then blocked:=array_append(blocked,name||' 备份格式不是数组'); continue; end if;
    if name='crm_client_state' then
      select coalesce(jsonb_agg(x),'[]') into data from jsonb_array_elements(data)x where exists(select 1 from jsonb_array_elements(coalesce(missing_tables->'clients','[]'))c where c->>'id'=x->>'client_id');
    end if;
    if jsonb_array_length(data)=0 then continue; end if;
    if to_regclass(format('public.%I',name)) is null then blocked:=array_append(blocked,name||' 当前数据库没有此表，不能自动恢复'); continue; end if;
    select array_agg(a.attname order by k.n) into pk_columns from pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(attnum,n) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum where c.contype='p' and c.conrelid=format('public.%I',name)::regclass;
    if cardinality(pk_columns) is distinct from 1 then blocked:=array_append(blocked,name||' 主键结构不支持自动恢复'); continue; end if;
    pk:=pk_columns[1];
    if exists(select 1 from jsonb_array_elements(data)x where jsonb_typeof(x) is distinct from 'object' or trim(coalesce(x->>pk,''))='') or (select count(distinct x->>pk) from jsonb_array_elements(data)x)<>jsonb_array_length(data) then blocked:=array_append(blocked,name||' 包含缺失或重复主键'); continue; end if;
    execute format('select coalesce(jsonb_agg(x),''[]''::jsonb) from jsonb_array_elements($1) x where not exists(select 1 from public.%I t where to_jsonb(t)->>%L=x->>%L)',name,pk,pk) into prepared using data;
    select coalesce(jsonb_agg(a.attname order by a.attnum),'[]') into relation_columns from pg_attribute a where a.attrelid=format('public.%I',name)::regclass and a.attnum>0 and not a.attisdropped and a.attgenerated='' and exists(select 1 from jsonb_array_elements(prepared)x where x?a.attname);
    column_sets:=jsonb_set(column_sets,array[name],relation_columns);
    if exists(select 1 from jsonb_array_elements(prepared)x cross join jsonb_array_elements_text(relation_columns)c where not (x?c)) then blocked:=array_append(blocked,name||' 行字段结构不一致，请使用原始完整备份'); end if;
    -- Populate records now, before the first INSERT, to validate UUID, numeric,
    -- JSON and timestamp casts. Retain the original column set so newly added
    -- columns absent in an older snapshot still receive their current defaults.
    begin
      execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from jsonb_populate_recordset(null::public.%I,$1) r',name) into prepared using prepared;
    exception when others then blocked:=array_append(blocked,name||' 字段类型与当前数据库不兼容：'||left(sqlerrm,160)); prepared:='[]'; end;
    if exists(select 1 from jsonb_array_elements(prepared)x join pg_attribute a on a.attrelid=format('public.%I',name)::regclass and a.attnum>0 and not a.attisdropped and a.attnotnull where (relation_columns?a.attname) and (x->a.attname is null or x->a.attname='null'::jsonb)) then blocked:=array_append(blocked,name||' 必填字段为空，不能恢复'); end if;
    if name in('follow_ups','quotes','samples') and exists(select 1 from jsonb_array_elements(prepared)x where x->>'author_id' is null) then blocked:=array_append(blocked,name||'.author_id 原作者为空，现有写入规则会改写作者，已阻止恢复'); end if;
    if name='clients' and exists(select 1 from jsonb_array_elements(prepared)x where x->>'created_by' is null) then blocked:=array_append(blocked,'clients.created_by 原创建人为空，现有写入规则会改写创建人，已阻止恢复'); end if;
    select md5(coalesce(string_agg(x->>pk,',' order by x->>pk),'')) into fingerprint from jsonb_array_elements(prepared)x;
    report:=jsonb_set(report,array[name],jsonb_build_object('missing',jsonb_array_length(prepared),'snapshot_rows',jsonb_array_length(data),'fingerprint',fingerprint));
    missing_tables:=jsonb_set(missing_tables,array[name],prepared);
    if jsonb_array_length(prepared)>0 then
      for field in select a.attname from pg_attribute a where a.attrelid=format('public.%I',name)::regclass and a.attnum>0 and not a.attisdropped and pg_get_serial_sequence(format('public.%I',name),a.attname) is not null loop
        sequence_name:=pg_get_serial_sequence(format('public.%I',name),field);
        select s.seqcache into sequence_cache from pg_sequence s where s.seqrelid=sequence_name::regclass;
        if sequence_cache<>1 then blocked:=array_append(blocked,name||'.'||field||' 序列缓存不是1，需管理员在维护窗口核对历史编号后恢复'); end if;
      end loop;
    end if;
  end loop;
  -- Every foreign-key dependency must already exist or be included among the
  -- missing rows. In particular, never reassign a former employee's customers
  -- or authorship to the boss merely to make an import pass.
  foreach name in array restore_tables loop
    prepared:=coalesce(missing_tables->name,'[]'); if jsonb_array_length(prepared)=0 then continue; end if;
    for fk in select c.* from pg_constraint c where c.contype='f' and c.conrelid=format('public.%I',name)::regclass loop
      if cardinality(fk.conkey)<>1 or cardinality(fk.confkey)<>1 then blocked:=array_append(blocked,name||' 包含复合关联键，需人工恢复'); continue; end if;
      select a.attname into local_field from pg_attribute a where a.attrelid=fk.conrelid and a.attnum=fk.conkey[1];
      select n.nspname,c.relname,a.attname into target_schema,target_table,target_field from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum=fk.confkey[1] where c.oid=fk.confrelid;
      execute format('select count(*) from jsonb_array_elements($1)x where x->>%L is not null and not exists(select 1 from %I.%I t where to_jsonb(t)->>%L=x->>%L) and not exists(select 1 from jsonb_array_elements($2)y where y->>%L=x->>%L)',local_field,target_schema,target_table,target_field,local_field,target_field,local_field)
        into missing_count using prepared,case when target_schema='public' then coalesce(missing_tables->target_table,'[]') else '[]'::jsonb end;
      if missing_count>0 then blocked:=array_append(blocked,name||'.'||local_field||' 缺少 '||target_schema||'.'||target_table||' 关联资料（'||missing_count||'条），未改写原归属'); end if;
    end loop;
  end loop;
  -- Order only tables with missing rows using the live FK graph; do not assume
  -- an undocumented baseline schema or disable constraints/triggers.
  select coalesce(array_agg(x),'{}'::text[]) into pending from unnest(restore_tables)x where jsonb_array_length(coalesce(missing_tables->x,'[]'))>0;
  while cardinality(pending)>0 loop
    select p into ready from unnest(pending)p where not exists(select 1 from pg_constraint c join pg_class ref on ref.oid=c.confrelid join pg_namespace ns on ns.oid=ref.relnamespace where c.contype='f' and c.conrelid=format('public.%I',p)::regclass and ns.nspname='public' and ref.relname=any(pending) and ref.relname<>p) order by array_position(restore_tables,p) limit 1;
    if ready is null then blocked:=array_append(blocked,'待恢复数据存在循环表关联，需人工恢复；未关闭数据库约束'); exit; end if;
    table_order:=array_append(table_order,ready); pending:=array_remove(pending,ready); ready:=null;
  end loop;
  select coalesce(array_agg(s.client_id),'{}'::uuid[]) into recycle_ids from public.crm_client_state s
    where s.merged_into is null and exists(select 1 from jsonb_array_elements(coalesce(b.payload->'clients','[]')) x where x->>'id'=s.client_id::text)
      and not exists(select 1 from jsonb_array_elements(coalesce(b.payload->'crm_client_state','[]')) x where x->>'client_id'=s.client_id::text);
  report:=report||jsonb_build_object('recycle_clients',jsonb_build_object('missing',cardinality(recycle_ids),'fingerprint',md5(coalesce((select string_agg(to_jsonb(s)::text,',' order by s.client_id) from public.crm_client_state s where s.client_id=any(recycle_ids)),''))),'_blocked',to_jsonb(blocked));
  if not p_confirm then return jsonb_build_object('applied',false,'report',report,'mode','missing_only','notice','仅补回缺失记录及回收站客户，不覆盖当前资料；恢复的邮件计划保持停止，不重放发信；历史来信不会重新触发处理；合并客户需单独恢复'); end if;
  if p_expected is null or report is distinct from p_expected then raise exception '恢复范围已变化，请重新预览后确认'; end if;
  if cardinality(blocked)>0 then raise exception '恢复已阻止，请先处理预览中的关联或格式问题：%',array_to_string(blocked,'；'); end if;
  -- Match existing client -> child/anchor writes. NOWAIT on sequence-owning
  -- tables below prevents a restore from waiting in a reverse audit lock cycle.
  perform c.id from public.clients c where c.id=any(recycle_ids) or exists(select 1 from jsonb_each(missing_tables)t cross join lateral jsonb_array_elements(t.value)x where x->>'client_id'=c.id::text or public.crm_effective_client(nullif(x->>'client_id','')::uuid)=c.id) order by c.id for update;
  -- Serialize every ordinary INSERT into sequence-owning tables before
  -- advancing a sequence. This also places fresh audit events above imported
  -- historic IDs. Sequence changes may leave gaps after a rollback, never a
  -- lower counter or an overwritten business row.
  foreach name in array table_order loop
    if exists(select 1 from pg_attribute a where a.attrelid=format('public.%I',name)::regclass and a.attnum>0 and not a.attisdropped and pg_get_serial_sequence(format('public.%I',name),a.attname) is not null) then
      begin execute format('lock table public.%I in share row exclusive mode nowait',name);
      exception when lock_not_available then raise exception '系统仍有业务正在写入，请稍后重新预览并恢复；当前资料未改动'; end;
    end if;
    for field in select a.attname from pg_attribute a where a.attrelid=format('public.%I',name)::regclass and a.attnum>0 and not a.attisdropped and pg_get_serial_sequence(format('public.%I',name),a.attname) is not null loop
      sequence_name:=pg_get_serial_sequence(format('public.%I',name),field);
      execute format('select greatest(coalesce((select max(%I)::bigint from public.%I),0),coalesce((select max((x->>%L)::bigint) from jsonb_array_elements($1)x),0))',field,name,field) into sequence_max using missing_tables->name;
      execute format('select last_value::bigint,is_called from %s',sequence_name::regclass) into sequence_value,sequence_called;
      if sequence_max>sequence_value or (sequence_max=sequence_value and not sequence_called) then perform setval(sequence_name::regclass,sequence_max,true); end if;
    end loop;
  end loop;
  -- Historic follow-up INSERT triggers update reminder anchors. Preserve and
  -- lock existing anchors so restoration cannot silently postpone reminders.
  perform client_id from public.client_tracking where client_id in(select (x->>'client_id')::uuid from jsonb_array_elements(coalesce(missing_tables->'follow_ups','[]'))x) order by client_id for update;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into tracking_before from public.client_tracking t where client_id in(select (x->>'client_id')::uuid from jsonb_array_elements(coalesce(missing_tables->'follow_ups','[]'))x);
  foreach name in array table_order loop
    data:=coalesce(missing_tables->name,'[]'); if jsonb_array_length(data)=0 then continue; end if;
    if name='crm_client_state' then select coalesce(jsonb_agg(x),'[]') into data from jsonb_array_elements(data)x where (x->>'client_id')::uuid=any(new_clients); end if;
    if jsonb_array_length(data)=0 then report:=jsonb_set(report,array[name,'restored'],'0'); continue; end if;
    prepared:='[]';
    for item in select value from jsonb_array_elements(data) loop
      if name='mail_campaigns' then item:=item||'{"status":"cancelled"}'::jsonb; end if;
      if name='mail_plans' then item:=item||'{"status":"stopped","last_error":"从备份恢复，需重新核对；未重启发信"}'::jsonb; end if;
      if name='mail_messages' and item->>'status' in('queued','sending') then item:=item||'{"status":"cancelled","error":"从备份恢复，未重新发送"}'::jsonb; end if;
      prepared:=prepared||jsonb_build_array(item);
    end loop;
    select string_agg(quote_ident(a.attname),',' order by a.attnum),string_agg('r.'||quote_ident(a.attname),',' order by a.attnum) into columns,selected from pg_attribute a
      where a.attrelid=format('public.%I',name)::regclass and a.attnum>0 and not a.attisdropped and a.attgenerated='' and (column_sets->name)?a.attname;
    execute format('with restored as(insert into public.%I(%s)%s select %s from jsonb_populate_recordset(null::public.%I,$1) r on conflict do nothing returning *) select coalesce(jsonb_agg(to_jsonb(restored)),''[]''::jsonb) from restored',name,columns,case when exists(select 1 from pg_attribute a where a.attrelid=format('public.%I',name)::regclass and a.attidentity='a') then ' overriding system value' else '' end,selected,name) into restored_rows using prepared;
    inserted:=jsonb_array_length(restored_rows);
    if name='clients' then select coalesce(array_agg((x->>'id')::uuid),'{}'::uuid[]) into new_clients from jsonb_array_elements(restored_rows)x; end if;
    if name='client_tracking' and cardinality(new_clients)>0 then
      -- A client INSERT creates an empty tracking placeholder. It is new in
      -- this transaction, so restore its snapshot flags/anchor rather than
      -- losing them to ON CONFLICT. Existing clients' tracking is untouched.
      update public.client_tracking t set attention_level=r.attention_level,invalid_reason=r.invalid_reason,marked_by=r.marked_by,marked_at=r.marked_at,reminder_owner_id=r.reminder_owner_id,email_anchor_at=r.email_anchor_at
        from jsonb_populate_recordset(null::public.client_tracking,prepared)r where t.client_id=r.client_id and r.client_id=any(new_clients) and not exists(select 1 from jsonb_array_elements(restored_rows)x where x->>'client_id'=r.client_id::text);
      get diagnostics updated_placeholders=row_count;
      inserted:=inserted+updated_placeholders;
    end if;
    select a.attname into pk from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1] where c.contype='p' and c.conrelid=format('public.%I',name)::regclass;
    for item in select value from jsonb_array_elements(restored_rows) loop
      select x into expected_row from jsonb_array_elements(prepared)x where x->>pk=item->>pk;
      for field in select jsonb_array_elements_text(column_sets->name) loop
        -- The inspected clients_guard always regenerates these derived keys
        -- and the modification timestamp on INSERT. Original ownership,
        -- creation attribution and business fields must still match exactly.
        if name='clients' and field in('updated_at','domain','name_key','phone_key','phone_key2') then continue; end if;
        if item->field is distinct from expected_row->field then raise exception '恢复已取消：%.% 被现有写入规则改写，未保留原记录；请联系管理员处理',name,field; end if;
      end loop;
    end loop;
    report:=jsonb_set(report,array[name,'restored'],to_jsonb(inserted));
  end loop;
  if exists(with recursive paths as(select s.client_id as origin,s.client_id as current_id,s.merged_into,array[s.client_id] as seen,false as cycle from public.crm_client_state s where s.client_id=any(new_clients) union all select p.origin,s.client_id,s.merged_into,p.seen||s.client_id,s.client_id=any(p.seen) from paths p join public.crm_client_state s on s.client_id=p.merged_into where not p.cycle and cardinality(p.seen)<=101) select 1 from paths where cycle or cardinality(seen)>100) then raise exception '备份合并记录存在循环，已取消全部恢复'; end if;
  update public.client_tracking t set reminder_owner_id=r.reminder_owner_id,email_anchor_at=r.email_anchor_at from jsonb_populate_recordset(null::public.client_tracking,tracking_before)r where t.client_id=r.client_id;
  delete from public.crm_client_state where client_id=any(recycle_ids) and merged_into is null;
  insert into public.crm_business_events(actor_id,action,detail) values(auth.uid(),'restore_backup',jsonb_build_object('backup_id',p_id,'report',report,'restored_client_ids',recycle_ids));
  return jsonb_build_object('applied',true,'report',report,'mode','missing_only','notice','仅补回缺失记录及回收站客户，当前资料未覆盖；恢复的邮件计划保持停止，不重放发信；历史来信仅恢复记录');
end;
$$;
create or replace function public.crm_delete_backup(p_id uuid,p_checksum text,p_confirmation text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.can_delete_clients() then raise exception '仅老板可管理备份' using errcode='42501'; end if;
  if p_confirmation is distinct from '已下载并确认删除此备份' then raise exception '请先下载并确认删除备份'; end if;
  delete from public.crm_backups where id=p_id and checksum=p_checksum;
  if not found then raise exception '备份已变化，请刷新'; end if;
  insert into public.crm_business_events(actor_id,action,detail) values(auth.uid(),'delete_backup',jsonb_build_object('backup_id',p_id));
end;
$$;
revoke all on function public.crm_create_backup(text),public.crm_list_backups(),public.crm_get_backup(uuid),public.crm_import_backup(jsonb),public.crm_restore_backup(uuid,text,boolean,jsonb),public.crm_delete_backup(uuid,text,text) from public,anon,authenticated;
grant execute on function public.crm_create_backup(text),public.crm_list_backups(),public.crm_get_backup(uuid),public.crm_import_backup(jsonb),public.crm_restore_backup(uuid,text,boolean,jsonb),public.crm_delete_backup(uuid,text,text) to authenticated;
commit;
