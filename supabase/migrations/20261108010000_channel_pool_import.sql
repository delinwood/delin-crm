begin;

-- Reuse the existing private transaction capability for a generated new customer ID.
-- Only the bulk import function below can grant the null-to-null creation capability.
do $$
declare
  original text:=pg_get_functiondef('public.clients_guard()'::regprocedure);
  marker text:='new[.]owner_id := auth[.]uid[(][)];[[:blank:]]*-- sales create for themselves only';
begin
  if original !~ marker then
    raise exception '找不到原客户归属规则，已停止部署';
  end if;
  execute regexp_replace(original,marker,
    'if not public.crm_pool_transition_allowed(new.id,null,null) then '||
    'new.owner_id := auth.uid(); end if;');
end
$$;

create function public.crm_import_channel_pool(p_channel text,p_rows jsonb)
returns integer
language plpgsql security definer set search_path=''
as $$
declare
  item jsonb;
  customer public.clients;
  new_id uuid;
  actor uuid:=auth.uid();
  boss boolean:=public.crm_social_is_boss() is true;
  social_operator boolean:=public.crm_social_is_operator() is true;
  total integer:=0;
begin
  if public.is_active_user() is not true then
    raise exception '请登录启用的账号' using errcode='42501';
  end if;
  if p_channel is null or p_channel not in ('google','social','exhibition','international') then
    raise exception '目标公海不正确';
  end if;
  if (social_operator and p_channel<>'social') or
     (p_channel='social' and not (social_operator or boss)) then
    raise exception '此账号不能导入该公海' using errcode='42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception '导入资料必须是列表';
  end if;
  perform pg_advisory_xact_lock(hashtext('crm_discovery_import'));
  for item in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(item) is distinct from 'object' then
      raise exception '第 % 条客户格式不正确，本批未导入',total+1;
    end if;
    begin
      if p_channel='google' then
        select * into customer from jsonb_populate_record(null::public.clients,
          item-ARRAY['id','owner_id','created_by','allow_duplicate','status']);
        if length(btrim(coalesce(customer.company_name,'')))=0 then
          raise exception '请填写公司名称';
        end if;
        new_id:=gen_random_uuid();
        insert into public.crm_pool_transitions(client_id,transaction_id,actor_id)
        values(new_id,txid_current(),actor);
        insert into public.clients(id,company_name,customer_type,country,state,city,address,company_phone,whatsapp,
          company_email,website,contact_name,contact_title,contact_linkedin,products,apollo_criteria,priority,
          status,owner_id,created_by,next_follow_up,tags,notes,source_note,allow_duplicate)
        values(new_id,customer.company_name,customer.customer_type,customer.country,customer.state,customer.city,
          customer.address,customer.company_phone,customer.whatsapp,customer.company_email,customer.website,
          customer.contact_name,customer.contact_title,customer.contact_linkedin,coalesce(customer.products,'{}'),
          customer.apollo_criteria,coalesce(customer.priority,'C'),'未联系',null,actor,customer.next_follow_up,
          coalesce(customer.tags,'{}'),customer.notes,customer.source_note,false);
        delete from public.crm_pool_transitions where client_id=new_id and transaction_id=txid_current();
      else
        perform public.crm_social_save(null,0,item||jsonb_build_object(
          'lead_channel',p_channel,'progress','未分配','precision','待核实'
        ));
      end if;
    exception when others then
      raise exception '第 % 条客户导入失败，本批未导入：%',total+1,sqlerrm;
    end;
    total:=total+1;
  end loop;
  return total;
end
$$;
revoke all on function public.crm_import_channel_pool(text,jsonb) from public,anon;
grant execute on function public.crm_import_channel_pool(text,jsonb) to authenticated;

commit;
