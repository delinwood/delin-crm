-- Append inside the migration's transaction and ROLLBACK. No provider call is made.
do $$
declare boss uuid; client public.clients; campaign uuid:=gen_random_uuid(); message uuid:=gen_random_uuid();
  payload jsonb; result uuid; claimed integer; caught boolean:=false;
begin
  select id into boss from public.profiles where active and role='admin' order by created_at limit 1;
  select c.* into client from public.clients c where c.company_email like '%@%' and c.status<>'无效'
    and not exists(select 1 from public.client_tracking t where t.client_id=c.id and t.attention_level='无效') limit 1;
  if boss is null or client.id is null then raise exception 'Smoke test requires one active admin and a valid client reference'; end if;
  if has_table_privilege('authenticated','public.mail_accounts','SELECT') or has_table_privilege('anon','public.mail_accounts','SELECT') then raise exception 'Token table exposed'; end if;
  if has_function_privilege('authenticated','public.mail_claim()','EXECUTE') or has_function_privilege('anon','public.mail_enqueue(uuid,uuid,text,jsonb)','EXECUTE') then raise exception 'Worker RPC exposed'; end if;
  insert into public.mail_accounts(user_id,email,refresh_cipher,daily_limit) values(boss,'offline-test@example.invalid','not-a-real-token',1);
  payload:=jsonb_build_array(jsonb_build_object('id',message,'client_id',client.id,'recipient',lower(trim(client.company_email)),
    'subject','OFFLINE TRANSACTION TEST - NEVER SEND','body','Rollback-only smoke test','unsubscribe_hash','smoke-test-not-a-token'));
  result:=public.mail_enqueue(boss,campaign,'Rollback-only smoke test',payload);
  if result<>campaign then raise exception 'Enqueue failed'; end if;
  result:=public.mail_enqueue(boss,campaign,'Repeated submission',payload);
  if (select count(*) from public.mail_messages where campaign_id=campaign)<>1 then raise exception 'Idempotency failed'; end if;
  select count(*) into claimed from public.mail_claim();
  if claimed<>1 then raise exception 'Worker did not claim one message'; end if;
  if (select status from public.mail_messages where id=message)<>'sending' then raise exception 'Claim status failed'; end if;
  update public.mail_accounts set next_send_at=now() where user_id=boss;
  select count(*) into claimed from public.mail_claim();
  if claimed<>0 then raise exception 'Quota did not block subsequent attempt'; end if;
  perform public.mail_finish(message,'offline-fake-provider-id');
  if (select status from public.mail_messages where id=message)<>'sent' then raise exception 'Finish status failed'; end if;
  begin
    perform public.mail_enqueue(boss,gen_random_uuid(),'Duplicate recipient',payload);
  exception when others then caught:=true; end;
  if not caught then raise exception 'Duplicate send allowed'; end if;
  caught:=false;
  begin
    perform public.mail_enqueue(boss,gen_random_uuid(),'Over cap',(select jsonb_agg(payload->0) from generate_series(1,401)));
  exception when others then caught:=true; end;
  if not caught then raise exception '400 cap failed'; end if;
end $$;
rollback;
select 'PASS: schema, secret isolation, RPC isolation, enqueue idempotency, claim, quota, finish, duplicate protection, 400 cap; all writes rolled back' as result;
